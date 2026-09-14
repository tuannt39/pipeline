import { describe, expect, it } from 'bun:test';
import { loadProfile, BUILTIN_PROFILES } from '../src/profiles';
import { DEFAULT_CONFIG } from '../src/config';
import { validateDAG, getReadyStages } from '../src/dag';
import { PipelineState } from '../src/types';

describe('ECC Profile', () => {
  it('loads ecc profile successfully and matches 20 stages', () => {
    const config = structuredClone(DEFAULT_CONFIG);
    const profile = loadProfile('ecc', config);

    expect(profile.name).toBe('ecc');
    expect(profile.stages.length).toBe(20);

    const expectedStageIds = [
      'requirement',
      'acceptance',
      'impact-analysis',
      'blueprint',
      'architecture',
      'design-patterns',
      'adr',
      'architecture-review',
      'plan',
      'acceptance-tests',
      'tdd',
      'implement',
      'code-review',
      'security-review',
      'design-conformance',
      'remediation',
      'test',
      'verification',
      'audit',
      'evidence',
    ];

    const actualStageIds = profile.stages.map((s) => s.id);
    expect(actualStageIds).toEqual(expectedStageIds);
  });

  it('validates acyclic DAG for ecc profile', () => {
    const config = structuredClone(DEFAULT_CONFIG);
    const profile = loadProfile('ecc', config);
    expect(() => validateDAG(profile)).not.toThrow();
  });

  it('verifies architecture-review requires approval before plan can run', () => {
    const config = structuredClone(DEFAULT_CONFIG);
    const profile = loadProfile('ecc', config);

    const archReview = profile.stages.find((s) => s.id === 'architecture-review');
    expect(archReview).toBeDefined();
    expect(archReview?.require_approval).toBe(true);

    const planStage = profile.stages.find((s) => s.id === 'plan');
    expect(planStage).toBeDefined();
    expect(planStage?.deps).toContain('architecture-review');
  });

  it('blocks plan stage from being ready when waiting_approval after architecture-review', () => {
    const config = structuredClone(DEFAULT_CONFIG);
    const profile = loadProfile('ecc', config);

    const stagesState: Record<string, { status: any }> = {};
    for (const stage of profile.stages) {
      stagesState[stage.id] = { status: 'pending' };
    }

    // Mark stages 1-8 completed, but pipeline status is waiting_approval
    const prePlanStages = [
      'requirement',
      'acceptance',
      'impact-analysis',
      'blueprint',
      'architecture',
      'design-patterns',
      'adr',
      'architecture-review',
    ];
    for (const sId of prePlanStages) {
      stagesState[sId] = { status: 'completed' };
    }

    const stateWaiting: PipelineState = {
      id: 'pipe-ecc-test-1',
      objective: 'test ecc flow',
      profile: 'ecc',
      workspace: { mode: 'active', path: '/test' },
      status: 'waiting_approval',
      stages: stagesState,
      fixLoops: 0,
      approval: {
        required: true,
        stageId: 'architecture-review',
        approved: false,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // When status is waiting_approval, getReadyStages must return empty array
    const readyWhileWaiting = getReadyStages(stateWaiting, profile);
    expect(readyWhileWaiting.length).toBe(0);

    // After approval is granted and status is running
    const stateApproved: PipelineState = {
      ...stateWaiting,
      status: 'running',
      approval: {
        required: true,
        stageId: 'architecture-review',
        approved: true,
      },
    };

    const readyAfterApproval = getReadyStages(stateApproved, profile);
    expect(readyAfterApproval.length).toBe(1);
    expect(readyAfterApproval[0].id).toBe('plan');
  });
});
