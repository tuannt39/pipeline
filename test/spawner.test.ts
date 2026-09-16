import { describe, expect, it } from 'bun:test';
import { resolveWorkerCommand, ROLE_TO_AGY_SUBAGENT, WorkerSpawner, isProcessAlive } from '../src/spawner';
import { OrcaClient } from '../src/orca';
import { StageDefinition } from '../src/types';

describe('WorkerSpawner & Command Resolution', () => {
  it('resolves Antigravity subagents and flags correctly', () => {
    const archStage: StageDefinition = {
      id: 'architecture',
      role: 'architect',
      agent: 'agy',
    };
    const cmd = resolveWorkerCommand(archStage);
    expect(cmd).toContain('agy');
    expect(cmd).toContain('--agent architect-reviewer');
    expect(cmd).toContain('--dangerously-skip-permissions');
  });

  it('maps all standard specialist roles to specialized Antigravity subagents', () => {
    const roles = [
      { role: 'planner', expected: 'workflow-orchestrator', mode: 'plan' },
      { role: 'analyst', expected: 'technical-writer', mode: 'plan' },
      { role: 'spec-writer', expected: 'technical-writer', mode: 'plan' },
      { role: 'architect', expected: 'architect-reviewer', mode: 'plan' },
      { role: 'security', expected: 'security-auditor', mode: 'plan' },
      { role: 'coder', expected: 'fullstack-developer', mode: 'accept-edits' },
      { role: 'developer', expected: 'fullstack-developer', mode: 'accept-edits' },
      { role: 'tester', expected: 'test-automator', mode: 'plan' },
      { role: 'verifier', expected: 'test-automator', mode: 'plan' },
      { role: 'reviewer', expected: 'code-reviewer', mode: 'plan' },
    ];

    for (const { role, expected, mode } of roles) {
      const stage: StageDefinition = { id: role, role, agent: 'agy' };
      const cmd = resolveWorkerCommand(stage);
      expect(cmd).toBe(`agy --agent ${expected} --mode ${mode} --dangerously-skip-permissions`);
    }
  });

  it('verifies isProcessAlive works for existing process', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    // Invalid PID that shouldn't exist
    expect(isProcessAlive(99999999)).toBe(false);
  });

  it('spawns worker in standalone direct execution mode when Orca is not available', async () => {
    const mockOrca = new OrcaClient({ isAvailable: false });
    const spawner = new WorkerSpawner(mockOrca);

    const res = await spawner.spawnWorker({
      stage: { id: 'requirement', role: 'analyst' },
      taskId: 'task-test-standalone',
      runId: 'run-standalone-1',
    });

    expect(res.method).toBe('standalone-process');
    expect(res.dispatchId).toContain('disp-standalone-requirement');
    expect(res.terminalHandle).toBeDefined();
    expect(res.terminalHandle?.startsWith('pid:')).toBe(true);
  });

  it('includes taskFile parameter with /plan for analytical stages and /goal for implementer stages', () => {
    const stagePlan: StageDefinition = { id: 'plan', role: 'planner', agent: 'agy' };
    const cmdPlan = resolveWorkerCommand(stagePlan, 'agy', '/tmp/task-plan.md');
    expect(cmdPlan).toContain('--mode plan');
    expect(cmdPlan).toContain('-i "/plan Execute task specifications in /tmp/task-plan.md"');

    const stageCoder: StageDefinition = { id: 'implement', role: 'coder', agent: 'agy' };
    const cmdCoder = resolveWorkerCommand(stageCoder, 'agy', '/tmp/task-coder.md');
    expect(cmdCoder).toContain('--mode accept-edits');
    expect(cmdCoder).toContain('-i "/goal Execute task specifications in /tmp/task-coder.md"');

    const stageOmp: StageDefinition = { id: 'plan', role: 'planner', agent: 'omp' };
    const cmdOmp = resolveWorkerCommand(stageOmp, 'omp', '/tmp/task-plan.md');
    expect(cmdOmp).toContain('"Execute task specifications in /tmp/task-plan.md"');
  });

  it('honors explicit subagent override, model, and custom flags', () => {
    const customStage: StageDefinition = {
      id: 'custom',
      role: 'developer',
      agent: 'agy',
      subagent: 'backend-specialist',
      model: 'gemini-2.5-pro',
      flags: ['--mode', 'goal'],
    };

    const cmd = resolveWorkerCommand(customStage);
    expect(cmd).toBe('agy --agent backend-specialist --model gemini-2.5-pro --mode goal --dangerously-skip-permissions');
  });

  it('resolves omp agent command properly', () => {
    const stage: StageDefinition = {
      id: 'implement',
      role: 'coder',
      agent: 'omp',
    };
    const cmd = resolveWorkerCommand(stage);
    expect(cmd).toBe('omp');

    const stageWithFlags: StageDefinition = {
      id: 'implement',
      role: 'coder',
      agent: 'omp',
      flags: ['--worktree', 'my-branch'],
    };
    const cmdFlags = resolveWorkerCommand(stageWithFlags);
    expect(cmdFlags).toBe('omp --worktree my-branch');
  });

  it('handles auto agent resolution and ensures skip-permissions on agy', () => {
    const stage: StageDefinition = {
      id: 'plan',
      role: 'planner',
      agent: 'auto',
    };

    const cmdAgy = resolveWorkerCommand(stage, 'agy');
    expect(cmdAgy).toContain('agy');
    expect(cmdAgy).toContain('--dangerously-skip-permissions');

    const cmdOmp = resolveWorkerCommand(stage, 'omp');
    expect(cmdOmp).toBe('omp');
  });
});
