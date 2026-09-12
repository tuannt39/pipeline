import fs from 'fs';
import path from 'path';
import { OrcaClient } from './orca';
import { WorkerSpawner } from './spawner';
import { PipelineConfig, PipelineProfile, PipelineState, StageDefinition } from './types';
import { getReadyStages, isPipelineFinished, validateDAG } from './dag';
import {
  generatePipelineId,
  getPipelineDir,
  initPipelineState,
  loadState,
  saveState,
  updateStageState,
  writeArtifact,
  readArtifact,
} from './state';
import { loadProfile } from './profiles';
import { buildPromptForStage } from './prompts';

export interface ControllerOptions {
  config: PipelineConfig;
  orca?: OrcaClient;
  spawner?: WorkerSpawner;
  cwd?: string;
}

export class PipelineController {
  private config: PipelineConfig;
  private orca: OrcaClient;
  private spawner: WorkerSpawner;
  private cwd: string;

  constructor(options: ControllerOptions) {
    this.config = options.config;
    this.cwd = options.cwd || process.cwd();
    this.orca = options.orca || new OrcaClient({ command: this.config.orca.command, cwd: this.cwd });
    this.spawner = options.spawner || new WorkerSpawner(this.orca);
  }

  async createPipeline(options: {
    id?: string;
    objective: string;
    profileName?: string;
    worktree?: string;
  }): Promise<{ id: string; dir: string; state: PipelineState; profile: PipelineProfile }> {
    const id = options.id || generatePipelineId();
    const profileName = options.profileName || this.config.defaults.profile;
    const profile = loadProfile(profileName, this.config, this.cwd);

    validateDAG(profile);

    const pipelineDir = getPipelineDir(id, this.config.artifacts.root, this.cwd);
    fs.mkdirSync(pipelineDir, { recursive: true });

    const worktreeMode = options.worktree || this.config.workspace.default;
    const state = initPipelineState(id, options.objective, profile, this.cwd, worktreeMode);

    saveState(pipelineDir, state);

    // Write initial request.md
    writeArtifact(
      pipelineDir,
      'request.md',
      `# Pipeline Request: ${id}\n\n**Objective**: ${options.objective}\n**Profile**: ${profile.name}\n**Workspace**: ${this.cwd} (${worktreeMode})\n**Created**: ${state.createdAt}\n`
    );

    return { id, dir: pipelineDir, state, profile };
  }

  async runPipeline(options: {
    id?: string;
    objective: string;
    profileName?: string;
    worktree?: string;
    onUpdate?: (state: PipelineState) => void;
  }): Promise<PipelineState> {
    const { id, dir, profile } = await this.createPipeline(options);

    // Create Orca Run
    let runId: string;
    try {
      const runRes = await this.orca.runCreate({
        objective: `Pipeline [${id}] - ${options.objective}`,
      });
      runId = runRes.id;
    } catch (err: any) {
      console.warn(`[pipeline-controller] orca run-create fallback to local ID:`, err.message);
      runId = `run-${id}`;
    }

    return this.runLoop(dir, runId, profile, options.onUpdate);
  }

  async resumePipeline(
    pipelineId: string,
    onUpdate?: (state: PipelineState) => void
  ): Promise<PipelineState> {
    const pipelineDir = getPipelineDir(pipelineId, this.config.artifacts.root, this.cwd);
    const state = loadState(pipelineDir);
    const profile = loadProfile(state.profile, this.config, this.cwd);

    // Reset status if previously failed or escalated
    if (state.status === 'failed' || state.status === 'escalated') {
      state.status = 'running';
      for (const [sId, sState] of Object.entries(state.stages)) {
        if (sState.status === 'failed') {
          sState.status = 'pending';
          sState.error = undefined;
        }
      }
      saveState(pipelineDir, state);
    }

    let runId: string;
    try {
      const runRes = await this.orca.runCreate({
        objective: `Pipeline [${pipelineId}] (resumed) - ${state.objective}`,
      });
      runId = runRes.id;
    } catch (err: any) {
      console.warn(`[pipeline-controller] orca run-create fallback to local ID:`, err.message);
      runId = `run-${pipelineId}`;
    }

    return this.runLoop(pipelineDir, runId, profile, onUpdate);
  }

  async runLoop(
    pipelineDir: string,
    runId: string,
    profile: PipelineProfile,
    onUpdate?: (state: PipelineState) => void
  ): Promise<PipelineState> {
    let state = loadState(pipelineDir);
    state.status = 'running';
    saveState(pipelineDir, state);
    onUpdate?.(state);

    const maxLoops = 1000;
    let iteration = 0;

    while (iteration++ < maxLoops) {
      state = loadState(pipelineDir);

      // Reconcile running stages against disk artifacts
      const reconciled = await this.reconcileRunningStages(pipelineDir, profile, state);
      if (reconciled) {
        state = loadState(pipelineDir);
        onUpdate?.(state);
      }

      const checkFinished = isPipelineFinished(state, profile);
      if (checkFinished.finished) {
        if (checkFinished.success) {
          state.status = 'completed';
          this.generateResultArtifact(pipelineDir, state, profile);
        } else {
          state.status = state.status === 'aborted' ? 'aborted' : 'failed';
        }
        saveState(pipelineDir, state);
        onUpdate?.(state);
        return state;
      }

      // Find ready stages
      const readyStages = getReadyStages(state, profile);

      for (const stage of readyStages) {
        await this.dispatchStage(pipelineDir, runId, stage, state);
        state = loadState(pipelineDir);
        onUpdate?.(state);
      }

      // Check if any stage is running
      const hasRunningStages = Object.values(state.stages).some((s) => s.status === 'running');
      if (!hasRunningStages && readyStages.length === 0) {
        // No ready stages and none running, evaluate termination
        const finalCheck = isPipelineFinished(state, profile);
        state.status = finalCheck.success ? 'completed' : 'failed';
        saveState(pipelineDir, state);
        onUpdate?.(state);
        return state;
      }

      // Wait for Orca events
      try {
        const delivery = await this.orca.check({
          runId,
          wait: true,
          timeoutMs: 3000,
          types: ['worker_done', 'escalation', 'question'],
        });

        if (delivery && delivery.messages && delivery.messages.length > 0) {
          for (const msg of delivery.messages) {
            await this.handleOrcaMessage(msg, pipelineDir, profile, state);
          }

          // Acknowledge delivery batch if ID present (support deliveryId and delivery_id)
          const ackId = (delivery as any).deliveryId || delivery.delivery_id || (delivery as any).id;
          if (ackId) {
            await this.orca.check({
              runId,
              ackDeliveryId: ackId,
            });
          }

          state = loadState(pipelineDir);
          onUpdate?.(state);
        }
      } catch (checkErr: any) {
        console.warn(`[pipeline-controller] check wait error (retrying):`, checkErr.message);
      }
    }

    state = loadState(pipelineDir);
    return state;
  }

  private completeStage(
    stageId: string,
    pipelineDir: string,
    profile: PipelineProfile,
    state: PipelineState,
    filesModified?: string[],
    notes?: string
  ): boolean {
    const stageDef = profile.stages.find((s) => s.id === stageId);
    if (!stageDef) return false;

    // Special check for review stage
    if (stageId === 'review') {
      const reviewContent = readArtifact(pipelineDir, 'review.md') || '';
      const isFail = /VERDICT:\s*FAIL/i.test(reviewContent);

      if (isFail) {
        if (state.fixLoops < this.config.policies.max_fix_loops) {
          state.fixLoops += 1;
          // Trigger fix loop: reset implement, test, and review to pending
          updateStageState(state, stageId, {
            status: 'pending',
            notes: `Review failed (Loop #${state.fixLoops}). Scheduling fix.`,
          });

          if (state.stages['test']) {
            updateStageState(state, 'test', { status: 'pending' });
          }
          if (state.stages['implement']) {
            updateStageState(state, 'implement', { status: 'pending' });
          }
          saveState(pipelineDir, state);
          return true;
        } else {
          // Exceeded max fix loops -> escalate
          updateStageState(state, stageId, {
            status: 'failed',
            error: `Review failed after maximum fix loops (${state.fixLoops})`,
          });
          state.status = 'escalated';
          saveState(pipelineDir, state);
          return true;
        }
      }
    }

    // Standard stage success
    updateStageState(state, stageId, {
      status: 'completed',
      endTime: new Date().toISOString(),
      notes: notes || 'Stage completed',
      modifiedFiles: filesModified ? String(filesModified).split(',') : undefined,
    });
    saveState(pipelineDir, state);
    return true;
  }

  private async reconcileRunningStages(
    pipelineDir: string,
    profile: PipelineProfile,
    state: PipelineState
  ): Promise<boolean> {
    let changed = false;

    // Fetch active terminals from Orca to verify liveness
    let activeTerminals: Set<string> | null = null;
    try {
      const listRes = await this.orca.terminalList();
      activeTerminals = new Set(listRes.terminals.filter((t) => t.connected).map((t) => t.handle));
    } catch {
      activeTerminals = null;
    }

    for (const [stageId, stageState] of Object.entries(state.stages)) {
      if (stageState.status !== 'running') continue;

      const stageDef = profile.stages.find((s) => s.id === stageId);
      if (!stageDef) continue;

      const outputs = stageDef.outputs || [];
      let allOutputsPresent = outputs.length > 0;
      let allFilesSettled = true;
      const now = Date.now();
      const stageStartMs = stageState.startTime ? new Date(stageState.startTime).getTime() : 0;

      for (const outName of outputs) {
        const outPath = path.join(pipelineDir, outName);
        if (!fs.existsSync(outPath)) {
          allOutputsPresent = false;
          break;
        }
        try {
          const stat = fs.statSync(outPath);
          if (stat.size === 0) {
            allOutputsPresent = false;
            break;
          }
          // File must be modified during or after stage start (allowing 2s clock skew)
          if (stageStartMs > 0 && stat.mtimeMs < stageStartMs - 2000) {
            allOutputsPresent = false;
            break;
          }
          // Ensure at least 2 seconds passed since last modification
          if (now - stat.mtimeMs < 2000) {
            allFilesSettled = false;
          }
        } catch {
          allOutputsPresent = false;
          break;
        }
      }

      if (allOutputsPresent && allFilesSettled) {
        console.log(`[pipeline-controller] Stage "${stageId}" satisfied artifact contract (${outputs.join(', ')}). Advancing stage.`);
        this.completeStage(stageId, pipelineDir, profile, state, undefined, `Artifact contract satisfied (${outputs.join(', ')})`);
        changed = true;
        continue;
      }

      // If outputs are not satisfied and worker terminal died
      if (!allOutputsPresent && stageState.terminalHandle && activeTerminals) {
        if (!activeTerminals.has(stageState.terminalHandle)) {
          const currentRetries = stageState.retries || 0;
          if (currentRetries < this.config.policies.max_stage_retries) {
            console.warn(`[pipeline-controller] Worker terminal for stage "${stageId}" is no longer active. Retrying (${currentRetries + 1}/${this.config.policies.max_stage_retries})...`);
            updateStageState(state, stageId, {
              status: 'pending',
              retries: currentRetries + 1,
              error: 'Worker terminal closed prematurely',
            });
            saveState(pipelineDir, state);
            changed = true;
          } else {
            updateStageState(state, stageId, {
              status: 'failed',
              endTime: new Date().toISOString(),
              error: `Stage worker terminal closed and exceeded max retries (${currentRetries})`,
            });
            saveState(pipelineDir, state);
            changed = true;
          }
        }
      }
    }

    return changed;
  }

  private async dispatchStage(
    pipelineDir: string,
    runId: string,
    stage: StageDefinition,
    state: PipelineState
  ): Promise<void> {
    let taskId = `task-${stage.id}-${Date.now()}`;
    try {
      const taskRes = await this.orca.taskCreate({
        spec: `Task for stage ${stage.id} in pipeline ${state.id}`,
        taskTitle: `${state.id} / ${stage.id}`,
        runId,
      });
      taskId = taskRes.id;
    } catch (err: any) {
      console.warn(`[pipeline-controller] task-create failed, using fallback taskId:`, err.message);
    }

    const dispatchId = `disp-${stage.id}-${Date.now()}`;

    const prompt = buildPromptForStage({
      pipelineId: state.id,
      objective: state.objective,
      workspace: state.workspace.path,
      pipelineDir,
      taskId,
      dispatchId,
      stage,
      inputs: stage.inputs,
      fixIteration: state.fixLoops,
    });

    const taskFile = path.join(pipelineDir, `task-${stage.id}.md`);
    writeArtifact(pipelineDir, `task-${stage.id}.md`, prompt);

    let actualDispatchId = dispatchId;
    let terminalHandle: string | undefined;

    try {
      const spawnRes = await this.spawner.spawnWorker({
        stage,
        taskId,
        runId,
        worktree: state.workspace.mode,
        title: `[Pipeline] ${stage.id.toUpperCase()} (${stage.role})`,
        defaultAgent: this.config.defaults.agent,
        prompt,
        taskFile,
        focus: true,
      });
      actualDispatchId = spawnRes.dispatchId || dispatchId;
      terminalHandle = spawnRes.terminalHandle;

      updateStageState(state, stage.id, {
        status: 'running',
        taskId,
        dispatchId: actualDispatchId,
        terminalHandle,
        startTime: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error(`[pipeline-controller] spawnWorker failed for stage "${stage.id}":`, err.message);
      updateStageState(state, stage.id, {
        status: 'failed',
        taskId,
        error: `Spawn failed: ${err.message}`,
        endTime: new Date().toISOString(),
      });
    }

    saveState(pipelineDir, state);
  }

  private async handleOrcaMessage(
    msg: any,
    pipelineDir: string,
    profile: PipelineProfile,
    state: PipelineState
  ): Promise<void> {
    if (msg.type === 'worker_done') {
      const payload = msg.payload || {};
      const taskId = payload.task_id || msg.taskId;
      const dispatchId = payload.dispatch_id || msg.dispatchId;
      const outcome = payload.outcome || 'succeeded';
      const filesModified = payload.files_modified;

      // Find matching stage
      let matchedStageId: string | null = null;
      if (taskId || dispatchId) {
        for (const [sId, sState] of Object.entries(state.stages)) {
          if ((taskId && sState.taskId === taskId) || (dispatchId && sState.dispatchId === dispatchId)) {
            matchedStageId = sId;
            break;
          }
        }
      }

      // Match by stage name if in task or dispatch string
      if (!matchedStageId && (taskId || dispatchId)) {
        for (const sId of Object.keys(state.stages)) {
          if ((taskId && taskId.includes(sId)) || (dispatchId && dispatchId.includes(sId))) {
            matchedStageId = sId;
            break;
          }
        }
      }

      // Fallback match if only one stage is currently running
      if (!matchedStageId) {
        const runningStages = Object.entries(state.stages).filter(([_, s]) => s.status === 'running');
        if (runningStages.length === 1) {
          matchedStageId = runningStages[0][0];
        }
      }

      if (!matchedStageId) return;

      const stageDef = profile.stages.find((s) => s.id === matchedStageId);
      const stageState = state.stages[matchedStageId];

      if (outcome === 'succeeded') {
        this.completeStage(
          matchedStageId,
          pipelineDir,
          profile,
          state,
          filesModified ? String(filesModified).split(',') : undefined
        );
      } else {
        // Outcome failed
        const currentRetries = stageState.retries || 0;
        if (currentRetries < this.config.policies.max_stage_retries) {
          updateStageState(state, matchedStageId, {
            status: 'pending',
            retries: currentRetries + 1,
            error: msg.body || 'Stage worker reported failure',
          });
        } else {
          updateStageState(state, matchedStageId, {
            status: 'failed',
            endTime: new Date().toISOString(),
            error: msg.body || 'Stage failed and reached max retries',
          });
        }
      }

      saveState(pipelineDir, state);
    } else if (msg.type === 'escalation') {
      let payload = msg.payload || {};
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload);
        } catch {
          payload = {};
        }
      }
      const taskId = payload.task_id || payload.taskId || msg.taskId;
      const dispatchId = payload.dispatch_id || payload.dispatchId || msg.dispatchId;

      // Find matching stage
      let matchedStageId: string | null = null;
      if (taskId || dispatchId) {
        for (const [sId, sState] of Object.entries(state.stages)) {
          if ((taskId && sState.taskId === taskId) || (dispatchId && sState.dispatchId === dispatchId)) {
            matchedStageId = sId;
            break;
          }
        }
      }

      if (!matchedStageId && (taskId || dispatchId)) {
        for (const sId of Object.keys(state.stages)) {
          if ((taskId && taskId.includes(sId)) || (dispatchId && dispatchId.includes(sId))) {
            matchedStageId = sId;
            break;
          }
        }
      }

      if (!matchedStageId) {
        const runningStages = Object.entries(state.stages).filter(([_, s]) => s.status === 'running');
        if (runningStages.length === 1) {
          matchedStageId = runningStages[0][0];
        }
      }

      if (matchedStageId) {
        // Check if stage artifact was actually produced
        const stageDef = profile.stages.find((s) => s.id === matchedStageId);
        const outputs = stageDef?.outputs || [];
        let allOutputsReady = outputs.length > 0;
        for (const out of outputs) {
          const p = path.join(pipelineDir, out);
          if (!fs.existsSync(p) || fs.statSync(p).size === 0) {
            allOutputsReady = false;
            break;
          }
        }

        if (allOutputsReady) {
          console.log(`[pipeline-controller] Worker for stage "${matchedStageId}" exited with artifact contract satisfied. Advancing stage.`);
          this.completeStage(matchedStageId, pipelineDir, profile, state, undefined, `Artifact contract satisfied (${outputs.join(', ')})`);
          saveState(pipelineDir, state);
          return;
        }

        const stageState = state.stages[matchedStageId];
        const currentRetries = stageState?.retries || 0;
        if (currentRetries < this.config.policies.max_stage_retries) {
          console.warn(`[pipeline-controller] Worker for stage "${matchedStageId}" stopped prematurely. Retrying (${currentRetries + 1}/${this.config.policies.max_stage_retries})...`);
          updateStageState(state, matchedStageId, {
            status: 'pending',
            retries: currentRetries + 1,
            error: msg.body || 'Worker stopped prematurely',
          });
          saveState(pipelineDir, state);
          return;
        } else {
          updateStageState(state, matchedStageId, {
            status: 'failed',
            endTime: new Date().toISOString(),
            error: msg.body || `Stage worker failed after ${currentRetries} retries`,
          });
        }
      }

      state.status = 'escalated';
      saveState(pipelineDir, state);
    }
  }

  private generateResultArtifact(pipelineDir: string, state: PipelineState, profile: PipelineProfile): void {
    const lines: string[] = [
      `# Pipeline Completed: ${state.id}`,
      ``,
      `**Objective**: ${state.objective}`,
      `**Profile**: ${profile.name}`,
      `**Status**: ${state.status}`,
      `**Started**: ${state.createdAt}`,
      `**Finished**: ${new Date().toISOString()}`,
      `**Fix Loops**: ${state.fixLoops}`,
      ``,
      `## Stages Summary`,
      ``,
    ];

    for (const stage of profile.stages) {
      const s = state.stages[stage.id];
      const icon = s?.status === 'completed' ? '✓' : s?.status === 'failed' ? '✗' : '○';
      lines.push(`- **${icon} ${stage.id}** (${stage.role}): ${s?.status || 'pending'}`);
      if (stage.outputs) {
        for (const out of stage.outputs) {
          lines.push(`  - Artifact: \`${out}\``);
        }
      }
    }

    lines.push(``);
    lines.push(`## Artifacts List`);
    const files = fs.readdirSync(pipelineDir).filter((f) => f.endsWith('.md') || f.endsWith('.json'));
    for (const file of files) {
      lines.push(`- [${file}](./${file})`);
    }

    writeArtifact(pipelineDir, 'result.md', lines.join('\n'));
  }
}
