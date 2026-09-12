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
          timeoutMs: 15000,
          types: ['worker_done', 'escalation', 'question'],
        });

        if (delivery && delivery.messages && delivery.messages.length > 0) {
          for (const msg of delivery.messages) {
            await this.handleOrcaMessage(msg, pipelineDir, profile, state);
          }

          // Acknowledge delivery batch if ID present
          if (delivery.delivery_id || delivery.id) {
            await this.orca.check({
              runId,
              ackDeliveryId: delivery.delivery_id || delivery.id,
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

  private async dispatchStage(
    pipelineDir: string,
    runId: string,
    stage: StageDefinition,
    state: PipelineState
  ): Promise<void> {
    const prompt = buildPromptForStage({
      pipelineId: state.id,
      objective: state.objective,
      workspace: state.workspace.path,
      pipelineDir,
      taskId: `task-${stage.id}`,
      dispatchId: `disp-${stage.id}`,
      stage,
      inputs: stage.inputs,
      fixIteration: state.fixLoops,
    });

    let taskId = `task-${stage.id}-${Date.now()}`;
    try {
      const taskRes = await this.orca.taskCreate({
        spec: prompt,
        taskTitle: `${state.id} / ${stage.id}`,
        runId,
      });
      taskId = taskRes.id;
    } catch (err: any) {
      console.warn(`[pipeline-controller] task-create failed, using fallback taskId:`, err.message);
    }

    let dispatchId = `disp-${stage.id}-${Date.now()}`;
    let terminalHandle: string | undefined;

    try {
      const spawnRes = await this.spawner.spawnWorker({
        stage,
        taskId,
        runId,
        worktree: state.workspace.mode,
        title: `${state.id}-${stage.id}`,
      });
      dispatchId = spawnRes.dispatchId;
      terminalHandle = spawnRes.terminalHandle;
    } catch (err: any) {
      console.warn(`[pipeline-controller] spawnWorker failed:`, err.message);
    }

    updateStageState(state, stage.id, {
      status: 'running',
      taskId,
      dispatchId,
      startTime: new Date().toISOString(),
    });

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
        // Special check for review stage
        if (matchedStageId === 'review') {
          const reviewContent = readArtifact(pipelineDir, 'review.md') || '';
          const isFail = /VERDICT:\s*FAIL/i.test(reviewContent);

          if (isFail) {
            if (state.fixLoops < this.config.policies.max_fix_loops) {
              state.fixLoops += 1;
              // Trigger fix loop: reset implement, test, and review to pending
              updateStageState(state, matchedStageId, {
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
              return;
            } else {
              // Exceeded max fix loops -> escalate
              updateStageState(state, matchedStageId, {
                status: 'failed',
                error: `Review failed after maximum fix loops (${state.fixLoops})`,
              });
              state.status = 'escalated';
              saveState(pipelineDir, state);
              return;
            }
          }
        }

        // Standard stage success
        updateStageState(state, matchedStageId, {
          status: 'completed',
          endTime: new Date().toISOString(),
          modifiedFiles: filesModified ? String(filesModified).split(',') : undefined,
        });
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
