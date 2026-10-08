import { describe, expect, it } from 'bun:test';
import { resolveWorkerCommand, ROLE_TO_AGY_SUBAGENT, isImplementationStage } from '../src/spawner';
import { StageDefinition } from '../src/types';

describe('Antigravity Worker Command Resolution & Roles', () => {
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

  it('correctly identifies implementation stages vs analytical stages', () => {
    expect(isImplementationStage({ id: 'implement', role: 'coder' })).toBe(true);
    expect(isImplementationStage({ id: 'fix', role: 'fixer' })).toBe(true);
    expect(isImplementationStage({ id: 'feature', role: 'developer' })).toBe(true);
    expect(isImplementationStage({ id: 'custom', role: 'any', mode: 'goal' })).toBe(true);

    expect(isImplementationStage({ id: 'plan', role: 'planner' })).toBe(false);
    expect(isImplementationStage({ id: 'architecture', role: 'architect' })).toBe(false);
    expect(isImplementationStage({ id: 'security', role: 'security' })).toBe(false);
    expect(isImplementationStage({ id: 'test', role: 'tester' })).toBe(false);
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

  it('resolves stage command with custom flags properly on agy', () => {
    const stageWithFlags: StageDefinition = {
      id: 'implement',
      role: 'coder',
      flags: ['--worktree', 'my-branch'],
    };
    const cmdFlags = resolveWorkerCommand(stageWithFlags);
    expect(cmdFlags).toContain('agy --agent fullstack-developer');
    expect(cmdFlags).toContain('--worktree my-branch');
    expect(cmdFlags).toContain('--dangerously-skip-permissions');
  });

  it('handles auto agent resolution and ensures skip-permissions on agy', () => {
    const stage: StageDefinition = {
      id: 'plan',
      role: 'planner',
      agent: 'auto',
    };

    const cmdAgy = resolveWorkerCommand(stage);
    expect(cmdAgy).toContain('agy');
    expect(cmdAgy).toContain('--agent workflow-orchestrator');
    expect(cmdAgy).toContain('--dangerously-skip-permissions');
  });
});
