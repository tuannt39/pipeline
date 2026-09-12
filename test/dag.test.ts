import { describe, expect, it } from 'bun:test';
import { validateDAG, getReadyStages, isPipelineFinished } from '../src/dag';
import { BUILTIN_PROFILES } from '../src/profiles';
import { PipelineState } from '../src/types';

describe('DAG Engine', () => {
  it('validates acyclic graphs for all builtin profiles', () => {
    for (const profile of Object.values(BUILTIN_PROFILES)) {
      expect(() => validateDAG(profile)).not.toThrow();
    }
  });

  it('detects cycles in invalid profiles', () => {
    const cyclicProfile = {
      name: 'cyclic',
      stages: [
        { id: 'stageA', role: 'coder', next: ['stageB'] },
        { id: 'stageB', role: 'tester', next: ['stageC'] },
        { id: 'stageC', role: 'reviewer', next: ['stageA'] },
      ],
    };

    expect(() => validateDAG(cyclicProfile as any)).toThrow(/Cycle detected/);
  });

  it('computes initial ready stages for standard profile', () => {
    const profile = BUILTIN_PROFILES.standard;
    const state: PipelineState = {
      id: 'test-1',
      objective: 'test',
      profile: 'standard',
      workspace: { mode: 'active', path: '/test' },
      status: 'pending',
      stages: {
        plan: { status: 'pending' },
        implement: { status: 'pending' },
        test: { status: 'pending' },
        review: { status: 'pending' },
      },
      fixLoops: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const ready = getReadyStages(state, profile);
    expect(ready.length).toBe(1);
    expect(ready[0].id).toBe('plan');
  });

  it('computes parallel ready stages in secure profile once plan is completed', () => {
    const profile = BUILTIN_PROFILES.secure;
    const state: PipelineState = {
      id: 'test-secure',
      objective: 'secure task',
      profile: 'secure',
      workspace: { mode: 'active', path: '/test' },
      status: 'running',
      stages: {
        plan: { status: 'completed' },
        architecture: { status: 'pending' },
        security: { status: 'pending' },
        pattern: { status: 'pending' },
        implement: { status: 'pending' },
        test: { status: 'pending' },
        review: { status: 'pending' },
        'final-security': { status: 'pending' },
      },
      fixLoops: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const ready = getReadyStages(state, profile);
    expect(ready.length).toBe(3);
    const ids = ready.map((s) => s.id).sort();
    expect(ids).toEqual(['architecture', 'pattern', 'security']);
  });

  it('verifies implement stage becomes ready only when all 3 specialists complete', () => {
    const profile = BUILTIN_PROFILES.secure;
    const state: PipelineState = {
      id: 'test-secure-partial',
      objective: 'secure task',
      profile: 'secure',
      workspace: { mode: 'active', path: '/test' },
      status: 'running',
      stages: {
        plan: { status: 'completed' },
        architecture: { status: 'completed' },
        security: { status: 'completed' },
        pattern: { status: 'pending' }, // not completed yet!
        implement: { status: 'pending' },
        test: { status: 'pending' },
        review: { status: 'pending' },
        'final-security': { status: 'pending' },
      },
      fixLoops: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const ready = getReadyStages(state, profile);
    expect(ready.map((s) => s.id)).toEqual(['pattern']);
    // implement is not ready yet!
    expect(ready.some((s) => s.id === 'implement')).toBe(false);
  });
});
