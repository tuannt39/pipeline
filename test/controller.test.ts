import { describe, expect, it } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { PipelineController } from '../src/controller';
import { DEFAULT_CONFIG } from '../src/config';
import { OrcaClient, ExecResult } from '../src/orca';
import { WorkerSpawner } from '../src/spawner';
import { writeArtifact } from '../src/state';

describe('PipelineController and Fix Loop', () => {
  it('handles review failure and triggers fix loop within max_fix_loops', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-test-'));
    const config = structuredClone(DEFAULT_CONFIG);
    config.artifacts.root = path.join(tempDir, '.omp', 'pipelines');
    config.policies.max_fix_loops = 2;

    let checkCount = 0;
    const mockExec = async (cmd: string, args: string[]): Promise<ExecResult> => {
      if (args.includes('run-create')) {
        return {
          stdout: JSON.stringify({ ok: true, result: { run: { id: 'test_run_1' } } }),
          stderr: '',
          exitCode: 0,
        };
      }
      if (args.includes('task-create')) {
        return {
          stdout: JSON.stringify({ ok: true, result: { task: { id: `task_${Math.random()}` } } }),
          stderr: '',
          exitCode: 0,
        };
      }
      if (args.includes('worker-start')) {
        return {
          stdout: JSON.stringify({ ok: true, result: { dispatch: { id: `disp_${Math.random()}` } } }),
          stderr: '',
          exitCode: 0,
        };
      }
      if (args.includes('check')) {
        checkCount++;
        // Simulate review stage reporting worker_done with FAIL on first review, PASS on second review
        if (checkCount === 1) {
          // Plan completed
          return {
            stdout: JSON.stringify({
              ok: true,
              result: {
                delivery: {
                  delivery_id: 'd1',
                  messages: [
                    {
                      id: 'm1',
                      type: 'worker_done',
                      payload: { outcome: 'succeeded' },
                    },
                  ],
                },
              },
            }),
            stderr: '',
            exitCode: 0,
          };
        }
        if (checkCount === 2) {
          // Implement completed
          return {
            stdout: JSON.stringify({
              ok: true,
              result: {
                delivery: {
                  delivery_id: 'd2',
                  messages: [
                    {
                      id: 'm2',
                      type: 'worker_done',
                      payload: { outcome: 'succeeded' },
                    },
                  ],
                },
              },
            }),
            stderr: '',
            exitCode: 0,
          };
        }
        if (checkCount === 3) {
          // Test completed
          return {
            stdout: JSON.stringify({
              ok: true,
              result: {
                delivery: {
                  delivery_id: 'd3',
                  messages: [
                    {
                      id: 'm3',
                      type: 'worker_done',
                      payload: { outcome: 'succeeded' },
                    },
                  ],
                },
              },
            }),
            stderr: '',
            exitCode: 0,
          };
        }
        if (checkCount === 4) {
          // Review completed but review.md has FAIL
          return {
            stdout: JSON.stringify({
              ok: true,
              result: {
                delivery: {
                  delivery_id: 'd4',
                  messages: [
                    {
                      id: 'm4',
                      type: 'worker_done',
                      payload: { outcome: 'succeeded' },
                    },
                  ],
                },
              },
            }),
            stderr: '',
            exitCode: 0,
          };
        }

        // Empty delivery for subsequent checks
        return {
          stdout: JSON.stringify({ ok: true, result: { delivery: { messages: [] } } }),
          stderr: '',
          exitCode: 0,
        };
      }

      return { stdout: JSON.stringify({ ok: true }), stderr: '', exitCode: 0 };
    };

    const client = new OrcaClient({ execFn: mockExec });
    const spawner = new WorkerSpawner(client);
    const controller = new PipelineController({ config, orca: client, spawner, cwd: tempDir });

    const { id, dir, state, profile } = await controller.createPipeline({
      objective: 'Implement OAuth',
      profileName: 'standard',
    });

    // Write review.md with VERDICT: FAIL to test fix loop triggering
    writeArtifact(dir, 'review.md', '# Code Review\n\nFound bug in token refresh.\n\nVERDICT: FAIL');

    // Simulate handling message m4 (review worker_done)
    const msg = {
      id: 'm4',
      type: 'worker_done',
      payload: { outcome: 'succeeded' },
    };

    // Mark plan, implement, test, review state
    state.stages.plan.status = 'completed';
    state.stages.implement.status = 'completed';
    state.stages.test.status = 'completed';
    state.stages.review.status = 'running';

    await (controller as any).handleOrcaMessage(
      msg,
      dir,
      profile,
      state
    );

    // Should have triggered fix loop: fixLoops = 1, implement & test reset to pending
    expect(state.fixLoops).toBe(1);
    expect(state.stages.implement.status as string).toBe('pending');
    expect(state.stages.test.status as string).toBe('pending');
    expect(state.stages.review.status as string).toBe('pending');

    // Clean up
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
