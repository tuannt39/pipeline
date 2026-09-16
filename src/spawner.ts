import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { OrcaClient } from './orca';
import { StageDefinition } from './types';
import { detectDefaultAgent } from './config';

export const ROLE_TO_AGY_SUBAGENT: Record<string, string> = {
  planner: 'workflow-orchestrator',
  plan: 'workflow-orchestrator',
  analyst: 'technical-writer',
  'spec-writer': 'technical-writer',
  spec: 'technical-writer',
  architect: 'architect-reviewer',
  architecture: 'architect-reviewer',
  security: 'security-auditor',
  'security-review': 'security-auditor',
  pattern: 'architect-reviewer',
  'design-pattern': 'architect-reviewer',
  tester: 'test-automator',
  qa: 'test-automator',
  verifier: 'test-automator',
  reviewer: 'code-reviewer',
  review: 'code-reviewer',
  coder: 'fullstack-developer',
  fixer: 'fullstack-developer',
  developer: 'fullstack-developer',
};

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function isImplementationStage(stage: StageDefinition): boolean {
  const role = stage.role?.toLowerCase() || '';
  const id = stage.id?.toLowerCase() || '';
  return (
    stage.mode === 'goal' ||
    role === 'coder' ||
    role === 'fixer' ||
    role === 'developer' ||
    id === 'implement' ||
    id === 'fix'
  );
}

export function resolveWorkerCommand(
  stage: StageDefinition,
  defaultAgent: string = 'auto',
  taskFile?: string,
  headless: boolean = false
): string {
  let agentType = stage.agent && stage.agent !== 'auto' ? stage.agent : defaultAgent;
  if (!agentType || agentType === 'auto') {
    agentType = detectDefaultAgent();
  }

  const isImpl = isImplementationStage(stage);
  const slashCommand = isImpl ? '/goal' : '/plan';
  const promptFlag = headless ? '-p' : '-i';

  // If stage.agent already contains custom invocation/flags
  if (stage.agent && stage.agent.includes(' ')) {
    let cmd = stage.agent;
    if (cmd.startsWith('agy') && !cmd.includes('--dangerously-skip-permissions')) {
      cmd = `${cmd} --dangerously-skip-permissions`;
    }
    if (taskFile && cmd.startsWith('agy') && !cmd.includes('-i') && !cmd.includes('-p') && !cmd.includes('--prompt')) {
      cmd = `${cmd} ${promptFlag} "${slashCommand} Execute task specifications in ${taskFile}"`;
    }
    return cmd;
  }

  if (agentType === 'agy') {
    const parts: string[] = ['agy'];
    const subagent = stage.subagent || ROLE_TO_AGY_SUBAGENT[stage.role];
    if (subagent) {
      parts.push('--agent', subagent);
    }
    if (stage.model) {
      parts.push('--model', stage.model);
    }

    // Set mode for agy: accept-edits for implementer, plan for other analytical/review stages
    const hasExplicitModeFlag = stage.flags && stage.flags.includes('--mode');
    if (!hasExplicitModeFlag) {
      const modeValue = isImpl ? 'accept-edits' : 'plan';
      parts.push('--mode', modeValue);
    }

    if (stage.flags && stage.flags.length > 0) {
      parts.push(...stage.flags);
    }
    if (!parts.includes('--dangerously-skip-permissions')) {
      parts.push('--dangerously-skip-permissions');
    }
    if (taskFile) {
      parts.push(promptFlag, `"${slashCommand} Execute task specifications in ${taskFile}"`);
    }
    return parts.join(' ');
  }

  // omp or other CLI
  const parts: string[] = [agentType];
  if (stage.flags && stage.flags.length > 0) {
    parts.push(...stage.flags);
  }
  if (taskFile) {
    parts.push(`"Execute task specifications in ${taskFile}"`);
  }

  return parts.join(' ');
}

export interface SpawnResult {
  dispatchId: string;
  terminalHandle?: string;
  method: 'worker-start' | 'fallback-terminal' | 'standalone-process';
}

export class WorkerSpawner {
  private orca: OrcaClient;

  constructor(orca: OrcaClient) {
    this.orca = orca;
  }

  async spawnWorker(options: {
    stage: StageDefinition;
    taskId: string;
    runId: string;
    worktree?: string;
    title?: string;
    defaultAgent?: string;
    prompt?: string;
    taskFile?: string;
    focus?: boolean;
    cwd?: string;
  }): Promise<SpawnResult> {
    const { stage, taskId, runId, worktree, title, defaultAgent, prompt, taskFile, focus, cwd } = options;

    // If real Orca CLI is available, use Orca native orchestration (interactive tab with -i)
    if (this.orca.isAvailable()) {
      const agentCmd = resolveWorkerCommand(stage, defaultAgent, taskFile, false);

      // 1. Primary path: worker-start
      try {
        const startRes = await this.orca.workerStart({
          taskId,
          agent: agentCmd,
          worktree: worktree || stage.worktree || 'active',
          runId,
          taskTitle: title || `${stage.id}: ${stage.role}`,
        });

        if (startRes.dispatchId) {
          return {
            dispatchId: startRes.dispatchId,
            terminalHandle: startRes.terminalHandle,
            method: 'worker-start',
          };
        }
      } catch (err: any) {
        console.warn(`[worker-spawner] worker-start failed for stage "${stage.id}", falling back to terminal create + dispatch:`, err.message);
      }

      // 2. Fallback path: terminal create + switch + dispatch (without --inject)
      try {
        const termTitle = title || `[Pipeline] ${stage.id.toUpperCase()} (${stage.role})`;
        const termRes = await this.orca.terminalCreate({
          worktree: worktree || stage.worktree || 'active',
          title: termTitle,
          command: agentCmd,
          focus: focus !== false,
        });

        // Switch to the terminal to ensure it is visible as a new focused tab in Orca UI
        try {
          await this.orca.terminalSwitch({ terminal: termRes.handle });
        } catch (switchErr: any) {
          console.warn(`[worker-spawner] terminalSwitch failed:`, switchErr.message);
        }

        const dispatchRes = await this.orca.dispatch({
          taskId,
          toHandle: termRes.handle,
          inject: false,
          runId,
        });

        // Deliver prompt via terminalSend only if taskFile wasn't used in command
        if (!taskFile && prompt && termRes.handle) {
          await new Promise((r) => setTimeout(r, 1000));
          try {
            await this.orca.terminalSend({
              handle: termRes.handle,
              text: prompt,
              enter: true,
            });
          } catch (sendErr: any) {
            console.warn(`[worker-spawner] terminalSend prompt failed:`, sendErr.message);
          }
        }

        return {
          dispatchId: dispatchRes.dispatchId,
          terminalHandle: termRes.handle,
          method: 'fallback-terminal',
        };
      } catch (fallbackErr: any) {
        console.warn(`[worker-spawner] Orca terminal create failed, falling back to standalone direct execution:`, fallbackErr.message);
      }
    }

    // 3. Standalone direct subprocess execution path (when Orca is not available or failed)
    try {
      const standaloneCmd = resolveWorkerCommand(stage, defaultAgent, taskFile, true);
      const logDir = taskFile ? path.dirname(taskFile) : (cwd || process.cwd());
      const stageLog = path.join(logDir, `stage-${stage.id}.log`);
      fs.mkdirSync(logDir, { recursive: true });
      const outFd = fs.openSync(stageLog, 'a');

      const workingDir = worktree && worktree !== 'active' ? worktree : (cwd || process.cwd());
      const child = spawn(standaloneCmd, {
        shell: true,
        detached: true,
        stdio: ['ignore', outFd, outFd],
        env: process.env,
        cwd: workingDir,
      });

      child.unref();

      const dispatchId = `disp-standalone-${stage.id}-${Date.now()}`;
      const terminalHandle = child.pid ? `pid:${child.pid}` : undefined;

      return {
        dispatchId,
        terminalHandle,
        method: 'standalone-process',
      };
    } catch (standaloneErr: any) {
      throw new Error(`WorkerSpawner standalone execution failed for stage "${stage.id}": ${standaloneErr.message}`);
    }
  }
}
