import { describe, expect, it } from 'bun:test';
import {
  buildPlannerPrompt,
  buildArchitectPrompt,
  buildSecurityPrompt,
  buildPatternPrompt,
  buildCoderPrompt,
  buildTesterPrompt,
  buildReviewerPrompt,
  buildFixPrompt,
} from '../src/prompts';

describe('Prompt Compiler', () => {
  const baseCtx = {
    pipelineId: 'pipe-test-001',
    objective: 'Implement OAuth login',
    workspace: '/test/workspace',
    pipelineDir: '/test/workspace/.omp/pipelines/pipe-test-001',
    taskId: 'task-123',
    dispatchId: 'disp-456',
    stage: { id: 'plan', role: 'planner' },
  };

  it('builds planner prompt with read_only restrictions and plan.md contract', () => {
    const prompt = buildPlannerPrompt(baseCtx);
    expect(prompt).toContain('ROLE:\nYou are the planning agent.');
    expect(prompt).toContain('DO NOT:\n- modify application source code');
    expect(prompt).toContain('/test/workspace/.omp/pipelines/pipe-test-001/plan.md');
    expect(prompt).toContain('orca orchestration send');
    expect(prompt).toContain('--type worker_done');
  });

  it('builds architect prompt with architecture.md contract', () => {
    const prompt = buildArchitectPrompt({ ...baseCtx, stage: { id: 'architecture', role: 'architect' } });
    expect(prompt).toContain('software architect specialist');
    expect(prompt).toContain('architecture.md');
    expect(prompt).toContain('DO NOT:\n- modify application source code');
    expect(prompt).toContain('--type worker_done');
  });

  it('builds security prompt with security-plan.md contract', () => {
    const prompt = buildSecurityPrompt({ ...baseCtx, stage: { id: 'security', role: 'security' } });
    expect(prompt).toContain('application security specialist');
    expect(prompt).toContain('security-plan.md');
    expect(prompt).toContain('--type worker_done');
  });

  it('builds coder prompt requiring implementation.md output', () => {
    const prompt = buildCoderPrompt({
      ...baseCtx,
      stage: { id: 'implement', role: 'coder' },
      inputs: ['plan.md', 'security-plan.md'],
    });
    expect(prompt).toContain('Implementation agent (coder)');
    expect(prompt).toContain('implementation.md');
    expect(prompt).toContain('plan.md');
    expect(prompt).toContain('security-plan.md');
    expect(prompt).toContain('--type worker_done');
  });

  it('builds reviewer prompt expecting review.md with VERDICT', () => {
    const prompt = buildReviewerPrompt({ ...baseCtx, stage: { id: 'review', role: 'reviewer' } });
    expect(prompt).toContain('Independent reviewer agent');
    expect(prompt).toContain('DO NOT TRUST blindly');
    expect(prompt).toContain('VERDICT: PASS');
    expect(prompt).toContain('VERDICT: FAIL');
    expect(prompt).toContain('--type worker_done');
  });

  it('builds fix prompt referencing reviewer feedback', () => {
    const prompt = buildFixPrompt({
      ...baseCtx,
      stage: { id: 'fix', role: 'fix' },
      fixIteration: 2,
    });
    expect(prompt).toContain('Fix agent (iteration 2)');
    expect(prompt).toContain('review.md');
  });
});
