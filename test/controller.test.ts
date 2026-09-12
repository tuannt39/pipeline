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

  it('reconciles running stage when artifact contract is satisfied on disk', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-recon-'));
    const config = structuredClone(DEFAULT_CONFIG);
    config.artifacts.root = path.join(tempDir, '.omp', 'pipelines');

    const client = new OrcaClient({
      execFn: async () => ({ stdout: JSON.stringify({ ok: true }), stderr: '', exitCode: 0 }),
    });
    const spawner = new WorkerSpawner(client);
    const controller = new PipelineController({ config, orca: client, spawner, cwd: tempDir });

    const { dir, state, profile } = await controller.createPipeline({
      objective: 'Build payment flow',
      profileName: 'standard',
    });

    // Mark plan as running
    state.stages.plan.status = 'running';
    state.stages.plan.startTime = new Date(Date.now() - 5000).toISOString();

    // Plan output is plan.md
    writeArtifact(dir, 'plan.md', '# Architecture Plan\n\n1. Payment gateway setup\n2. Webhooks\n');

    // Manually set mtimeMs back a bit so it is settled (> 2s old)
    const planPath = path.join(dir, 'plan.md');
    const pastTime = (Date.now() - 3000) / 1000;
    fs.utimesSync(planPath, pastTime, pastTime);

    // Call reconcileRunningStages (no terminal handle => immediate artifact completion)
    const changed = await (controller as any).reconcileRunningStages(dir, profile, state);

    expect(changed).toBe(true);
    expect(state.stages.plan.status as string).toBe('completed');
    expect(state.stages.plan.notes).toContain('Artifact contract satisfied');

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('does not advance stage while worker terminal is still active in Orca', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-recon-active-'));
    const config = structuredClone(DEFAULT_CONFIG);
    config.artifacts.root = path.join(tempDir, '.omp', 'pipelines');

    // Mock client where term_worker_1 is still active and connected
    const client = new OrcaClient({
      execFn: async (cmd, args) => {
        if (args.includes('list') && args.includes('terminal')) {
          return {
            stdout: JSON.stringify({
              ok: true,
              result: { terminals: [{ handle: 'term_worker_1', connected: true }] },
            }),
            stderr: '',
            exitCode: 0,
          };
        }
        return { stdout: JSON.stringify({ ok: true }), stderr: '', exitCode: 0 };
      },
    });
    const spawner = new WorkerSpawner(client);
    const controller = new PipelineController({ config, orca: client, spawner, cwd: tempDir });

    const { dir, state, profile } = await controller.createPipeline({
      objective: 'Implement OAuth',
      profileName: 'standard',
    });

    state.stages.plan.status = 'completed';
    state.stages.implement.status = 'running';
    state.stages.implement.terminalHandle = 'term_worker_1';
    state.stages.implement.startTime = new Date(Date.now() - 5000).toISOString();

    // implementation.md exists on disk
    writeArtifact(dir, 'implementation.md', '# Implementation Report\nDone.');
    const implPath = path.join(dir, 'implementation.md');
    const pastTime = (Date.now() - 3000) / 1000;
    fs.utimesSync(implPath, pastTime, pastTime);

    // 1. Reconcile while terminal is active -> should NOT complete yet
    const changedActive = await (controller as any).reconcileRunningStages(dir, profile, state);
    expect(changedActive).toBe(false);
    expect(state.stages.implement.status as string).toBe('running');

    // 2. Now simulate terminal exiting/closing (not in active list)
    const deadClient = new OrcaClient({
      execFn: async (cmd, args) => {
        if (args.includes('list') && args.includes('terminal')) {
          return {
            stdout: JSON.stringify({
              ok: true,
              result: { terminals: [] },
            }),
            stderr: '',
            exitCode: 0,
          };
        }
        return { stdout: JSON.stringify({ ok: true }), stderr: '', exitCode: 0 };
      },
    });
    (controller as any).orca = deadClient;

    // Reconcile after terminal closed -> completes final step and advances
    const changedDead = await (controller as any).reconcileRunningStages(dir, profile, state);
    expect(changedDead).toBe(true);
    expect(state.stages.implement.status as string).toBe('completed');

    // 3. Test printPeriodicStatusBanner executes cleanly
    expect(() => controller.printPeriodicStatusBanner(state, profile)).not.toThrow();

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});


