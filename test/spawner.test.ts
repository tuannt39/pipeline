import { describe, expect, it } from 'bun:test';
import { resolveWorkerCommand, ROLE_TO_AGY_SUBAGENT } from '../src/spawner';
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
      { role: 'architect', expected: 'architect-reviewer' },
      { role: 'security', expected: 'security-auditor' },
      { role: 'coder', expected: 'fullstack-developer' },
      { role: 'tester', expected: 'test-automator' },
      { role: 'reviewer', expected: 'code-reviewer' },
    ];

    for (const { role, expected } of roles) {
      const stage: StageDefinition = { id: role, role, agent: 'agy' };
      const cmd = resolveWorkerCommand(stage);
      expect(cmd).toBe(`agy --agent ${expected} --dangerously-skip-permissions`);
    }
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
