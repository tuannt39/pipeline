import { OrcaClient } from './orca';
import { StageDefinition } from './types';
import { detectDefaultAgent } from './config';

export const ROLE_TO_AGY_SUBAGENT: Record<string, string> = {
  architect: 'architect-reviewer',
  security: 'security-auditor',
  'security-review': 'security-auditor',
  tester: 'test-automator',
  qa: 'test-automator',
  reviewer: 'code-reviewer',
  review: 'code-reviewer',
  coder: 'fullstack-developer',
  fixer: 'fullstack-developer',
  developer: 'fullstack-developer',
};

export function resolveWorkerCommand(stage: StageDefinition, defaultAgent: string = 'auto'): string {
  let agentType = stage.agent && stage.agent !== 'auto' ? stage.agent : defaultAgent;
  if (!agentType || agentType === 'auto') {
    agentType = detectDefaultAgent();
  }

  // If stage.agent already contains custom invocation/flags
  if (stage.agent && stage.agent.includes(' ')) {
    if (stage.agent.startsWith('agy') && !stage.agent.includes('--dangerously-skip-permissions')) {
      return `${stage.agent} --dangerously-skip-permissions`;
    }
    return stage.agent;
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
    if (stage.flags && stage.flags.length > 0) {
      parts.push(...stage.flags);
    }
    if (!parts.includes('--dangerously-skip-permissions')) {
      parts.push('--dangerously-skip-permissions');
    }
    return parts.join(' ');
  }

  // omp or other CLI
  if (stage.flags && stage.flags.length > 0) {
    return [agentType, ...stage.flags].join(' ');
  }

  return agentType;
}

export interface SpawnResult {
  dispatchId: string;
  terminalHandle?: string;
  method: 'worker-start' | 'fallback-terminal';
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
  }): Promise<SpawnResult> {
    const { stage, taskId, runId, worktree, title, defaultAgent, prompt } = options;
    const agentCmd = resolveWorkerCommand(stage, defaultAgent);

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

    // 2. Fallback path: terminal create + dispatch (without --inject) + terminalSend
    try {
      const termRes = await this.orca.terminalCreate({
        worktree: worktree || stage.worktree || 'active',
        title: title || `${agentCmd.split(' ')[0]}-${stage.id}`,
        command: agentCmd,
      });

      const dispatchRes = await this.orca.dispatch({
        taskId,
        toHandle: termRes.handle,
        inject: false,
        runId,
      });

      if (prompt && termRes.handle) {
        // Allow the TUI agent a moment to initialize its input listener
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
      throw new Error(`WorkerSpawner failed both worker-start and fallback terminal create: ${fallbackErr.message}`);
    }
  }
}
