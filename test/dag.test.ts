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

  it('computes initial ready stages for ecc profile as requirement', () => {
    const profile = BUILTIN_PROFILES.ecc;
    const stages: Record<string, { status: any }> = {};
    for (const s of profile.stages) {
      stages[s.id] = { status: 'pending' };
    }
    const state: PipelineState = {
      id: 'test-ecc-1',
      objective: 'test ecc',
      profile: 'ecc',
      workspace: { mode: 'active', path: '/test' },
      status: 'pending',
      stages,
      fixLoops: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const ready = getReadyStages(state, profile);
    expect(ready.length).toBe(1);
    expect(ready[0].id).toBe('requirement');
  });

  it('computes acceptance-tests as next ready stage after plan is completed and approved', () => {
    const profile = BUILTIN_PROFILES.ecc;
    const stages: Record<string, { status: any }> = {};
    for (const s of profile.stages) {
      stages[s.id] = { status: 'pending' };
    }
    // Mark all pre-plan stages as completed
    const completedStages = [
      'requirement', 'acceptance', 'impact-analysis', 'blueprint',
      'architecture', 'design-patterns', 'adr', 'architecture-review', 'plan',
    ];
    for (const sId of completedStages) {
      stages[sId] = { status: 'completed' };
    }

    const state: PipelineState = {
      id: 'test-ecc-post-plan',
      objective: 'test ecc post plan',
      profile: 'ecc',
      workspace: { mode: 'active', path: '/test' },
      status: 'running',
      stages,
      fixLoops: 0,
      approval: { required: true, stageId: 'plan', approved: true },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const ready = getReadyStages(state, profile);
    expect(ready.length).toBe(1);
    expect(ready[0].id).toBe('acceptance-tests');
  });

  it('verifies implement stage becomes ready only after tdd completes', () => {
    const profile = BUILTIN_PROFILES.ecc;
    const stages: Record<string, { status: any }> = {};
    for (const s of profile.stages) {
      stages[s.id] = { status: 'pending' };
    }
    // Mark stages up to acceptance-tests completed but NOT tdd
    const completedStages = [
      'requirement', 'acceptance', 'impact-analysis', 'blueprint',
      'architecture', 'design-patterns', 'adr', 'architecture-review', 'plan',
      'acceptance-tests',
    ];
    for (const sId of completedStages) {
      stages[sId] = { status: 'completed' };
    }

    const state: PipelineState = {
      id: 'test-ecc-partial',
      objective: 'test ecc partial',
      profile: 'ecc',
      workspace: { mode: 'active', path: '/test' },
      status: 'running',
      stages,
      fixLoops: 0,
      approval: { required: true, stageId: 'plan', approved: true },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const ready = getReadyStages(state, profile);
    expect(ready.map((s) => s.id)).toEqual(['tdd']);
    // implement is not ready yet — tdd not completed
    expect(ready.some((s) => s.id === 'implement')).toBe(false);
  });
});
