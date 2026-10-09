import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { ROLE_TO_AGY_SUBAGENT } from './spawner';
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
import { classifyObjective } from './triage';
import { buildPromptForStage } from './prompts';
import { EccKnowledgeAdapter, configureDefaultEccAdapter } from './ecc-adapter';

export interface ControllerOptions {
  config: PipelineConfig;
  cwd?: string;
}

export class PipelineController {
  private config: PipelineConfig;
  private cwd: string;
  private eccAdapter: EccKnowledgeAdapter;

  constructor(options: ControllerOptions) {
    this.config = options.config;
    this.cwd = options.cwd || process.cwd();
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
    let profileName = options.profileName || this.config.defaults.profile;
    let triageNotes = '';

    if (profileName === 'auto') {
      const triage = classifyObjective(options.objective);
      profileName = triage.profile;
      triageNotes = `[Auto-Triage] Automatically routed to "${triage.profile}" profile (${triage.confidence} confidence): ${triage.rationale}`;
      console.log(`[pipeline-controller] ${triageNotes}`);
    }

    const profile = loadProfile(profileName, this.config, this.cwd);

    validateDAG(profile);

    const pipelineDir = getPipelineDir(id, this.config.artifacts.root, this.cwd);
    fs.mkdirSync(pipelineDir, { recursive: true });

    const worktreeMode = options.worktree || this.config.workspace.default;
    const state = initPipelineState(id, options.objective, profile, this.cwd, worktreeMode);
    if (triageNotes && profile.stages.length > 0) {
      const firstStageId = profile.stages[0].id;
      if (state.stages[firstStageId]) {
        state.stages[firstStageId].notes = triageNotes;
      }
    }

    saveState(pipelineDir, state);

    // Write initial request.md
    writeArtifact(
      pipelineDir,
      'request.md',
      `# Pipeline Request: ${id}\n\n**Objective**: ${options.objective}\n**Profile**: ${profile.name}${triageNotes ? `\n**Triage**: ${triageNotes}` : ''}\n**Workspace**: ${this.cwd} (${worktreeMode})\n**Created**: ${state.createdAt}\n`
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
    const { dir, profile } = await this.createPipeline(options);
    return this.runLoop(dir, profile, options.onUpdate);
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

    return this.runLoop(pipelineDir, profile, onUpdate);
  }

  async runLoop(
    pipelineDir: string,
    profile: PipelineProfile,
    onUpdate?: (state: PipelineState) => void
  ): Promise<PipelineState> {
    let state = loadState(pipelineDir);
    onUpdate?.(state);

    const startTime = Date.now();
    const timeoutMs = this.config.defaults.timeout_ms || 3600000;
    const tickerIntervalMs = this.config.defaults.status_interval_ms || 180000;
    let lastTickerTime = Date.now();

    while (state.status !== 'completed' && state.status !== 'failed' && state.status !== 'aborted' && state.status !== 'escalated') {
      // Check timeout
      if (Date.now() - startTime > timeoutMs) {
        state.status = 'failed';
        saveState(pipelineDir, state);
        onUpdate?.(state);
        return state;
      }

      // Periodic status ticker banner
      if (Date.now() - lastTickerTime >= tickerIntervalMs) {
        this.printPeriodicStatusBanner(state, profile);
        lastTickerTime = Date.now();
      }

      // Handle waiting for user plan approval
      if (state.status === 'waiting_approval') {
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

        // Sleep briefly waiting for approval
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const refreshed = loadState(pipelineDir);
        if (refreshed.approval?.approved || refreshed.status !== 'waiting_approval') {
          state = refreshed;
          onUpdate?.(state);
        }
        continue;
      }

      // Check for ready stages and dispatch them
      const readyStages = getReadyStages(state, profile);
      for (const stage of readyStages) {
        await this.dispatchStage(pipelineDir, stage, state);
        onUpdate?.(state);
      }

      // Reconcile running stages based on disk artifacts
      const changed = await this.reconcileRunningStages(pipelineDir, profile, state);
      if (changed) {
        state = loadState(pipelineDir);
        onUpdate?.(state);
        continue;
      }

      // Check if any stage is running
      const hasRunningStages = Object.values(state.stages).some((s) => s.status === 'running');
      if (!hasRunningStages && readyStages.length === 0) {
        const finalCheck = isPipelineFinished(state, profile);
        state.status = finalCheck.success ? 'completed' : 'failed';
        saveState(pipelineDir, state);
        onUpdate?.(state);
        return state;
      }

      // Sleep briefly before next tick
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    state = loadState(pipelineDir);
    return state;
  }

  public completeStage(
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
          updateStageState(state, stageId, {
            status: 'failed',
            error: `Exceeded maximum review fix loops (${this.config.policies.max_fix_loops})`,
          });
          state.status = 'escalated';
          saveState(pipelineDir, state);
          return true;
        }
      }
    }

    // Check mandatory plan approval gate
    if (stageDef.require_approval) {
      if (stageId === 'plan') {
        const validation = this.validatePlanArtifact(pipelineDir, stageDef);
        if (!validation.valid) {
          updateStageState(state, stageId, {
            status: 'failed',
            error: `Plan validation failed: ${validation.issues.join('; ')}`,
          });
          saveState(pipelineDir, state);
          return false;
        }
      }

      updateStageState(state, stageId, {
        status: 'completed',
        endTime: new Date().toISOString(),
        modifiedFiles: filesModified,
        notes: notes || 'Stage completed. Halting for mandatory plan approval.',
      });

      state.status = 'waiting_approval';
      state.approval = {
        required: true,
        stageId,
        approved: false,
      };

      saveState(pipelineDir, state);
      this.printApprovalBanner(state, pipelineDir);
      return true;
    }

    // Normal stage completion
    updateStageState(state, stageId, {
      status: 'completed',
      endTime: new Date().toISOString(),
      modifiedFiles: filesModified,
      notes,
    });

    // Check if entire pipeline finished successfully
    const finishedCheck = isPipelineFinished(state, profile);
    if (finishedCheck.finished && finishedCheck.success) {
      state.status = 'completed';
      this.generateResultArtifact(pipelineDir, state, profile);
    }

    saveState(pipelineDir, state);
    return true;
  }

  public printApprovalBanner(state: PipelineState, pipelineDir: string): void {
    const planFile = path.join(pipelineDir, 'plan.md');
    const testPlanFile = path.join(pipelineDir, 'test-plan.md');
    const hasTestPlan = fs.existsSync(testPlanFile);

    console.log(`\n================================================================================`);
    console.log(`⏸️  AWAITING PLAN APPROVAL (Mandatory Gate for Profile "${state.profile}")`);
    console.log(`================================================================================`);
    console.log(`The master plan and execution roadmap have been generated:`);
    console.log(`  • Plan File:      ${planFile}`);
    if (hasTestPlan) {
      console.log(`  • Test Plan:      ${testPlanFile}`);
    }
    console.log(`\nNext Steps:`);
    console.log(`  1. Review the plan artifact: cat ${planFile}`);
    console.log(`  2. In Antigravity interactive chat: Respond to approve or ask for adjustments.`);
    console.log(`  3. To approve via CLI: Run 'pipeline approve ${state.id}'`);
    console.log(`  4. To request a revision with feedback: Run 'pipeline revise ${state.id} "Feedback"'`);
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
    const profile = loadProfile(state.profile, this.config, this.cwd);

    if (state.approval) {
      state.approval.approved = true;
      state.approval.approvedAt = new Date().toISOString();
      state.approval.approvedBy = approvedBy;
    }

    state.status = 'running';

    const approvalStageId = state.approval?.stageId || 'plan';
    if (state.stages[approvalStageId]?.status === 'running' || state.stages[approvalStageId]?.status === 'pending') {
      updateStageState(state, approvalStageId, {
        status: 'completed',
        notes: `Approved by ${approvedBy}`,
      });
    }

    saveState(pipelineDir, state);
    console.log(`[pipeline-controller] Plan approved by ${approvedBy} for pipeline "${state.id}". Resuming pipeline.`);
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
      notes: `Revision requested: ${feedback}`,
    });

    state.status = 'running';
    if (state.approval) {
      state.approval.approved = false;
    }

    writeArtifact(pipelineDir, 'plan-feedback.md', `# Plan Revision Feedback\n\n${feedback}\n`);
    saveState(pipelineDir, state);
    console.log(`[pipeline-controller] Plan revision recorded for pipeline "${state.id}".`);
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
          if (stageStartMs > 0 && stat.mtimeMs < stageStartMs - 2000) {
            allOutputsPresent = false;
            break;
          }
          if (now - stat.mtimeMs < 1000) {
            allFilesSettled = false;
          }
        } catch {
          allOutputsPresent = false;
          break;
        }
      }

      if (allOutputsPresent && allFilesSettled) {
        console.log(`[pipeline-controller] Stage "${stageId}" artifacts satisfied (${outputs.join(', ')}). Advancing stage.`);
        this.completeStage(stageId, pipelineDir, profile, state, undefined, `Artifact contract satisfied (${outputs.join(', ')})`);
        changed = true;
      }
    }

    return changed;
  }

  private async dispatchStage(
    pipelineDir: string,
    stage: StageDefinition,
    state: PipelineState
  ): Promise<void> {
    const taskId = `task-${stage.id}-${Date.now()}`;
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

    writeArtifact(pipelineDir, `task-${stage.id}.md`, prompt);

    updateStageState(state, stage.id, {
      status: 'running',
      taskId,
      dispatchId,
      startTime: new Date().toISOString(),
      ecc: eccSummary,
    });

    saveState(pipelineDir, state);
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
        extra = ` (active ${stageDurationSec}s)`;
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
