import { describe, expect, it } from 'bun:test';
import { OrcaClient, ExecResult } from '../src/orca';
import { WorkerSpawner } from '../src/spawner';

describe('Orca Client & WorkerSpawner', () => {
  it('creates run and parses run id', async () => {
    const mockExec = async (cmd: string, args: string[]): Promise<ExecResult> => {
      expect(cmd).toBe('orca');
      expect(args).toContain('run-create');
      expect(args).toContain('--objective');
      return {
        stdout: JSON.stringify({ ok: true, result: { run: { id: 'run_12345' } } }),
        stderr: '',
        exitCode: 0,
      };
    };

    const client = new OrcaClient({ execFn: mockExec });
    const res = await client.runCreate({ objective: 'Test Run' });
    expect(res.id).toBe('run_12345');
  });

  it('creates task and parses task id', async () => {
    const mockExec = async (cmd: string, args: string[]): Promise<ExecResult> => {
      expect(args).toContain('task-create');
      return {
        stdout: JSON.stringify({ ok: true, result: { task: { id: 'task_abc' } } }),
        stderr: '',
        exitCode: 0,
      };
    };

    const client = new OrcaClient({ execFn: mockExec });
    const res = await client.taskCreate({ spec: 'Do something', taskTitle: 'My Task' });
    expect(res.id).toBe('task_abc');
  });

  it('spawns worker with primary worker-start path', async () => {
    const mockExec = async (cmd: string, args: string[]): Promise<ExecResult> => {
      if (args.includes('worker-start')) {
        return {
          stdout: JSON.stringify({
            ok: true,
            result: { dispatch: { id: 'disp_999' }, terminal: { handle: 'term_111' } },
          }),
          stderr: '',
          exitCode: 0,
        };
      }
      throw new Error('Unexpected command');
    };

    const client = new OrcaClient({ execFn: mockExec });
    const spawner = new WorkerSpawner(client);

    const res = await spawner.spawnWorker({
      stage: { id: 'plan', role: 'planner' },
      taskId: 'task_1',
      runId: 'run_1',
    });

    expect(res.dispatchId).toBe('disp_999');
    expect(res.method).toBe('worker-start');
  });

  it('falls back to terminal create + dispatch when worker-start fails', async () => {
    const mockExec = async (cmd: string, args: string[]): Promise<ExecResult> => {
      if (args.includes('worker-start')) {
        return {
          stdout: '',
          stderr: 'Agent omp not supported in worker-start',
          exitCode: 1,
        };
      }
      if (args.includes('terminal') && args.includes('create')) {
        return {
          stdout: JSON.stringify({ ok: true, result: { terminal: { handle: 'term_fallback_456' } } }),
          stderr: '',
          exitCode: 0,
        };
      }
      if (args.includes('dispatch')) {
        return {
          stdout: JSON.stringify({ ok: true, result: { dispatch: { id: 'disp_fallback_789' } } }),
          stderr: '',
          exitCode: 0,
        };
      }
      throw new Error(`Unexpected command: ${args.join(' ')}`);
    };

    const client = new OrcaClient({ execFn: mockExec });
    const spawner = new WorkerSpawner(client);

    const res = await spawner.spawnWorker({
      stage: { id: 'plan', role: 'planner' },
      taskId: 'task_1',
      runId: 'run_1',
    });

    expect(res.dispatchId).toBe('disp_fallback_789');
    expect(res.terminalHandle).toBe('term_fallback_456');
    expect(res.method).toBe('fallback-terminal');
  });
});
