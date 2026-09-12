import { OrcaClient } from './orca';
import { StageDefinition } from './types';

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
  }): Promise<SpawnResult> {
    const { stage, taskId, runId, worktree, title } = options;
    const agentCmd = stage.agent || 'omp';

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

    // 2. Fallback path: terminal create + dispatch --inject
    try {
      const termRes = await this.orca.terminalCreate({
        worktree: worktree || stage.worktree || 'active',
        title: title || `omp-${stage.id}`,
        command: agentCmd,
      });

      const dispatchRes = await this.orca.dispatch({
        taskId,
        toHandle: termRes.handle,
        inject: true,
        runId,
      });

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
