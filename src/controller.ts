import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { OrcaClient } from './orca';
import { WorkerSpawner, ROLE_TO_AGY_SUBAGENT, isProcessAlive } from './spawner';
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
import { EccKnowledgeAdapter, configureDefaultEccAdapter } from './ecc-adapter';

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
  private eccAdapter: EccKnowledgeAdapter;

  constructor(options: ControllerOptions) {
    this.config = options.config;
    this.cwd = options.cwd || process.cwd();
    this.orca = options.orca || new OrcaClient({ command: this.config.orca.command, cwd: this.cwd });
    this.spawner = options.spawner || new WorkerSpawner(this.orca);
    this.eccAdapter = new EccKnowledgeAdapter({
      eccPath: this.config.ecc?.path,
      cacheTtlMs: this.config.ecc?.cache_ttl_ms,
    });
    configureDefaultEccAdapter({
      eccPath: this.config.ecc?.path,
      cacheTtlMs: this.config.ecc?.cache_ttl_ms,
    });
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

    // Create Orca Run if available
    let runId = `run-${id}`;
    if (this.orca.isAvailable()) {
      try {
        const runRes = await this.orca.runCreate({
          objective: `Pipeline [${id}] - ${options.objective}`,
        });
        runId = runRes.id;
      } catch (err: any) {
        console.warn(`[pipeline-controller] orca run-create fallback to local ID:`, err.message);
      }
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

    // Reset status if previously failed or escalated, or if waiting_approval was approved
    if (state.status === 'failed' || state.status === 'escalated') {
      state.status = 'running';
      for (const [sId, sState] of Object.entries(state.stages)) {
        if (sState.status === 'failed') {
          sState.status = 'pending';
          sState.error = undefined;
        }
      }
      saveState(pipelineDir, state);
    } else if (state.status === 'waiting_approval' && state.approval?.approved) {
      state.status = 'running';
      saveState(pipelineDir, state);
    }

    let runId = `run-${pipelineId}`;
    if (this.orca.isAvailable()) {
      try {
        const runRes = await this.orca.runCreate({
          objective: `Pipeline [${pipelineId}] (resumed) - ${state.objective}`,
        });
        runId = runRes.id;
      } catch (err: any) {
        console.warn(`[pipeline-controller] orca run-create fallback to local ID:`, err.message);
      }
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

    const statusIntervalMs = this.config.defaults.status_interval_ms || 180000;
    let lastStatusCheckTime = Date.now();
    const maxLoops = 1000;
    let iteration = 0;

    while (iteration++ < maxLoops) {
      state = loadState(pipelineDir);

      // Periodic status check job (every 3 minutes by default)
      const now = Date.now();
      if (now - lastStatusCheckTime >= statusIntervalMs) {
        lastStatusCheckTime = now;
        this.printPeriodicStatusBanner(state, profile);
        onUpdate?.(state);
      }

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

      // Handle waiting for user plan approval
      if (state.status === 'waiting_approval') {
        // If interactive TTY session, prompt user directly
        if (process.stdin.isTTY) {
          const result = await this.askUserApprovalTTY(state);
          if (result === 'approved') {
            this.approvePlan(pipelineDir, 'interactive-user');
            state = loadState(pipelineDir);
            onUpdate?.(state);
            continue;
          } else if (result.startsWith('revise:')) {
            const feedback = result.slice('revise:'.length);
            this.requestPlanRevision(pipelineDir, feedback);
            state = loadState(pipelineDir);
            onUpdate?.(state);
            continue;
          } else {
            state.status = 'aborted';
            saveState(pipelineDir, state);
            onUpdate?.(state);
            return state;
          }
        }

        // Check if approval was granted externally on disk (e.g. via `pipeline approve`)
        const diskState = loadState(pipelineDir);
        if (diskState.approval?.approved || diskState.status !== 'waiting_approval') {
          state = diskState;
          onUpdate?.(state);
          continue;
        }

        // In non-interactive mode, check Orca messages for explicit user approval only
        try {
          const delivery = await this.orca.check({
            runId,
            wait: true,
            timeoutMs: 3000,
            types: ['user_approval'],
          });

          if (delivery && delivery.messages && delivery.messages.length > 0) {
            for (const msg of delivery.messages) {
              const sender = (msg.from || '').toLowerCase();
              const isUserSender = sender === 'user' || sender === 'human' || sender === 'operator' || sender === 'reviewer';
              if (msg.type === 'user_approval' && (isUserSender || msg.payload?.confirmed === true)) {
                this.approvePlan(pipelineDir, msg.from || 'user');
                state = loadState(pipelineDir);
                onUpdate?.(state);
                break;
              }
            }
          }
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        const refreshed = loadState(pipelineDir);
        if (refreshed.approval?.approved || refreshed.status !== 'waiting_approval') {
          state = refreshed;
          onUpdate?.(state);
        }
        continue;
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

      // Wait for Orca events if available, or sleep briefly in standalone mode
      if (this.orca.isAvailable()) {
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
      } else {
        // Standalone direct runner mode: poll interval
        await new Promise((resolve) => setTimeout(resolve, 1500));
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

    // Check for plan approval gate
    const requiresApproval =
      stageDef.require_approval ??
      (stageId === 'plan' && this.config.policies.require_plan_approval !== false);

    if (requiresApproval && !state.approval?.approved) {
      // Validate plan quality and warn if issues detected
      const validation = this.validatePlanArtifact(pipelineDir, stageDef);
      if (!validation.valid) {
        console.warn(`[pipeline-controller] ⚠️ Plan quality warnings:`);
        for (const issue of validation.issues) {
          console.warn(`  - ${issue}`);
        }
      }

      updateStageState(state, stageId, {
        status: 'completed',
        endTime: new Date().toISOString(),
        notes: notes || 'Plan generated. Awaiting user plan approval.',
        modifiedFiles: filesModified ? String(filesModified).split(',') : undefined,
      });

      state.approval = {
        required: true,
        stageId,
        approved: false,
      };
      state.status = 'waiting_approval';
      saveState(pipelineDir, state);

      this.printApprovalBanner(state, pipelineDir);
      return true;
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

  public printApprovalBanner(state: PipelineState, pipelineDir: string): void {
    const planPath = path.join(pipelineDir, 'plan.md');
    console.log(`\n================================================================================`);
    console.log(`⏸️  **Awaiting Plan approval** — Please review the generated plan to continue.`);
    console.log(`Pipeline ID:  ${state.id}`);
    console.log(`Objective:    ${state.objective}`);
    console.log(`Plan file:    ${planPath}`);
    console.log(`\nNext steps:`);
    console.log(`  1. Review the generated plan in: ${planPath}`);
    console.log(`  2. (Optional) Edit or update plan.md directly if any adjustments are needed.`);
    console.log(`  3. To approve and proceed to implementation:`);
    console.log(`     • Terminal: Run 'pipeline approve ${state.id}'`);
    console.log(`     • Chat / TTY: Respond with "approved", "ok", "proceed", or "lgtm"`);
    console.log(`  4. To request a revision with feedback:`);
    console.log(`     • Terminal: Run 'pipeline revise ${state.id} "Your feedback here"'`);
    console.log(`================================================================================\n`);
  }

  private async askUserApprovalTTY(state: PipelineState): Promise<'approved' | 'cancelled' | string> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question('Review plan.md. (a)pprove / (r)evise / (c)ancel: ', (answer) => {
        rl.close();
        const trimmed = answer.trim().toLowerCase();
        if (['y', 'yes', 'a', 'approved', 'approve', 'proceed', 'go ahead', 'lgtm', 'ok'].includes(trimmed)) {
          resolve('approved');
        } else if (trimmed.startsWith('r') && trimmed !== 'reject') {
          // Ask for revision feedback
          const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
          rl2.question('Revision feedback: ', (feedback) => {
            rl2.close();
            resolve(`revise:${feedback.trim() || 'Please improve the plan'}`);
          });
        } else {
          resolve('cancelled');
        }
      });
    });
  }

  public approvePlan(pipelineIdOrDir: string, approvedBy: string = 'user'): PipelineState {
    const pipelineDir = pipelineIdOrDir.includes(path.sep)
      ? pipelineIdOrDir
      : getPipelineDir(pipelineIdOrDir, this.config.artifacts.root, this.cwd);
    const state = loadState(pipelineDir);

    state.approval = {
      required: true,
      stageId: state.approval?.stageId || 'plan',
      approved: true,
      approvedAt: new Date().toISOString(),
      approvedBy,
    };

    if (state.status === 'waiting_approval') {
      state.status = 'running';
    }

    saveState(pipelineDir, state);
    console.log(`[pipeline-controller] Plan approved for pipeline "${state.id}" by ${approvedBy}. Resuming workflow.`);
    return state;
  }

  public requestPlanRevision(pipelineIdOrDir: string, feedback: string): PipelineState {
    const pipelineDir = pipelineIdOrDir.includes(path.sep)
      ? pipelineIdOrDir
      : getPipelineDir(pipelineIdOrDir, this.config.artifacts.root, this.cwd);
    const state = loadState(pipelineDir);

    const planStageId = state.approval?.stageId || 'plan';

    updateStageState(state, planStageId, {
      status: 'pending',
      notes: `Revision requested: ${feedback.slice(0, 200)}`,
    });

    state.approval = undefined;
    state.status = 'running';

    const feedbackContent = `\n\n## Plan Revision Feedback (${new Date().toISOString()})\n${feedback}\n`;
    const requestPath = path.join(pipelineDir, 'request.md');
    try {
      fs.appendFileSync(requestPath, feedbackContent);
    } catch {
      // Non-critical: feedback is also stored in stage notes
    }

    saveState(pipelineDir, state);
    console.log(`[pipeline-controller] Plan revision requested for pipeline "${state.id}". Re-running plan stage.`);
    return state;
  }

  private validatePlanArtifact(pipelineDir: string, stage: StageDefinition): {
    valid: boolean;
    issues: string[];
  } {
    const planContent = readArtifact(pipelineDir, 'plan.md') || '';
    const issues: string[] = [];

    if (planContent.length < 500) {
      issues.push('Plan is suspiciously short (< 500 chars)');
    }

    const requiredPatterns = [
      { pattern: /##.*(?:objective|summary|overview)/i, label: 'Objective/Summary section' },
      { pattern: /##.*(?:implementation|changes|plan|steps)/i, label: 'Implementation/Changes section' },
      { pattern: /##.*(?:test|testing|verification)/i, label: 'Test strategy section' },
    ];

    for (const { pattern, label } of requiredPatterns) {
      if (!pattern.test(planContent)) {
        issues.push(`Missing: ${label}`);
      }
    }

    return { valid: issues.length === 0, issues };
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
        // If the worker terminal is still active in Orca, do NOT spawn the next stage session early.
        // Allow the current worker to complete its final turn (tests, wrap-up, status check, worker_done).
        if (stageState.terminalHandle && activeTerminals && activeTerminals.has(stageState.terminalHandle)) {
          continue;
        }

        console.log(`[pipeline-controller] Stage "${stageId}" reached final step with artifacts satisfied (${outputs.join(', ')}). Advancing stage.`);
        this.completeStage(stageId, pipelineDir, profile, state, undefined, `Artifact contract satisfied (${outputs.join(', ')})`);
        changed = true;
        continue;
      }

      // Check if worker died without satisfying outputs
      let workerDied = false;
      if (stageState.terminalHandle) {
        if (stageState.terminalHandle.startsWith('pid:')) {
          const pid = parseInt(stageState.terminalHandle.slice(4), 10);
          if (pid && !isProcessAlive(pid)) {
            workerDied = true;
          }
        } else if (activeTerminals && !activeTerminals.has(stageState.terminalHandle)) {
          workerDied = true;
        }
      }

      // If outputs are not satisfied and worker process/terminal died
      if (!allOutputsPresent && workerDied) {
        const currentRetries = stageState.retries || 0;
        if (currentRetries < this.config.policies.max_stage_retries) {
          console.warn(`[pipeline-controller] Worker for stage "${stageId}" is no longer active. Retrying (${currentRetries + 1}/${this.config.policies.max_stage_retries})...`);
          updateStageState(state, stageId, {
            status: 'pending',
            retries: currentRetries + 1,
            error: 'Worker process/terminal closed prematurely',
          });
          saveState(pipelineDir, state);
          changed = true;
        } else {
          updateStageState(state, stageId, {
            status: 'failed',
            endTime: new Date().toISOString(),
            error: `Stage worker closed and exceeded max retries (${currentRetries})`,
          });
          saveState(pipelineDir, state);
          changed = true;
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
    if (this.orca.isAvailable()) {
      try {
        const taskRes = await this.orca.taskCreate({
          spec: `Task for stage ${stage.id} in pipeline ${state.id}`,
          taskTitle: `${state.id} / ${stage.id}`,
          runId,
        });
        taskId = taskRes.id;
      } catch (err: any) {
        console.warn(`[pipeline-controller] task-create fallback:`, err.message);
      }
    }

    const dispatchId = `disp-${stage.id}-${Date.now()}`;
    const persona =
      stage.subagent ||
      (this.config.defaults.agent === 'agy' ? ROLE_TO_AGY_SUBAGENT[stage.role] : undefined) ||
      this.eccAdapter.getRolePersona(stage.role);
    console.log(`\n[Pipeline] Preparing stage "${stage.id}" (${stage.role})...`);
    console.log(this.eccAdapter.formatStageEccBanner(stage, persona));
    const eccSummary = this.eccAdapter.getStageEccSummary(stage, persona);

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
      adapter: this.eccAdapter,
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
        cwd: this.cwd,
      });
      actualDispatchId = spawnRes.dispatchId || dispatchId;
      terminalHandle = spawnRes.terminalHandle;

      updateStageState(state, stage.id, {
        status: 'running',
        taskId,
        dispatchId: actualDispatchId,
        terminalHandle,
        startTime: new Date().toISOString(),
        ecc: eccSummary,
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
    const eccStatus = this.eccAdapter.getEccStatusSummary();
    lines.push(`## ECC Knowledge & Governance`);
    lines.push(`- **Source**: ${eccStatus.configured && eccStatus.valid ? `External (${eccStatus.path})` : 'Built-in offline methodologies'}`);
    lines.push(`- **Components Detected**: ${eccStatus.skillsCount} skills, ${eccStatus.rulesCount} rules, ${eccStatus.workflowsCount} workflows`);
    lines.push(``);
    lines.push(`## Artifacts List`);
    const files = fs.readdirSync(pipelineDir).filter((f) => f.endsWith('.md') || f.endsWith('.json'));
    for (const file of files) {
      lines.push(`- [${file}](./${file})`);
    }

    writeArtifact(pipelineDir, 'result.md', lines.join('\n'));
  }

  public printPeriodicStatusBanner(state: PipelineState, profile: PipelineProfile): void {
    const elapsedMs = Date.now() - new Date(state.createdAt).getTime();
    const elapsedMinutes = Math.floor(elapsedMs / 60000);
    const elapsedSeconds = Math.floor((elapsedMs % 60000) / 1000);
    const timeStr = new Date().toLocaleTimeString();

    console.log(`\n--------------------------------------------------------------------------------`);
    console.log(`[${timeStr}] [Pipeline Status Check - Periodic 3m Ticker]`);
    const statusNotice = state.status === 'waiting_approval' ? ' (⏸️ Awaiting Plan approval)' : '';
    console.log(`Pipeline ID: ${state.id} | Status: ${state.status.toUpperCase()}${statusNotice} | Profile: ${profile.name}`);
    const eccStatus = this.eccAdapter.getEccStatusSummary();
    const eccLabel = eccStatus.configured && eccStatus.valid
      ? `${eccStatus.path} (external: ${eccStatus.skillsCount} skills, ${eccStatus.rulesCount} rules, ${eccStatus.workflowsCount} workflows)`
      : `Built-in offline methodologies (${eccStatus.skillsCount} skills, 7 specialist personas)`;
    console.log(`ECC:         ${eccLabel}`);
    console.log(`Objective:   ${state.objective}`);
    console.log(`Duration:    ${elapsedMinutes}m ${elapsedSeconds}s | Fix Loops: ${state.fixLoops}`);
    console.log(`Stages:`);

    for (const stage of profile.stages) {
      const s = state.stages[stage.id];
      const statusLabel = s?.status || 'pending';
      const icon = statusLabel === 'completed' ? '✓' : statusLabel === 'running' ? '●' : statusLabel === 'failed' ? '✗' : '○';
      let extra = '';
      if (statusLabel === 'running' && s?.startTime) {
        const stageDurationSec = Math.floor((Date.now() - new Date(s.startTime).getTime()) / 1000);
        extra = ` (active ${stageDurationSec}s, term: ${s.terminalHandle || 'n/a'})`;
      } else if (s?.notes) {
        extra = ` (${s.notes})`;
      } else if (s?.error) {
        extra = ` (Error: ${s.error})`;
      }
      console.log(`  ${icon} ${stage.id.padEnd(16)} [${statusLabel.padEnd(9)}]${extra}`);
    }
    console.log(`--------------------------------------------------------------------------------\n`);
  }
}
