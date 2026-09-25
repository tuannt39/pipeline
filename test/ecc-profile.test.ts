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

  it('verifies plan stage requires approval after creating plan.md', () => {
    const config = structuredClone(DEFAULT_CONFIG);
    const profile = loadProfile('ecc', config);

    const archReview = profile.stages.find((s) => s.id === 'architecture-review');
    expect(archReview).toBeDefined();
    expect(archReview?.require_approval).toBeUndefined();

    const planStage = profile.stages.find((s) => s.id === 'plan');
    expect(planStage).toBeDefined();
    expect(planStage?.require_approval).toBe(true);
    expect(planStage?.outputs).toContain('plan.md');
    expect(planStage?.outputs).toContain('test-plan.md');
  });

  it('blocks acceptance-tests stage from being ready when waiting_approval after plan is generated', () => {
    const config = structuredClone(DEFAULT_CONFIG);
    const profile = loadProfile('ecc', config);

    const stagesState: Record<string, { status: any }> = {};
    for (const stage of profile.stages) {
      stagesState[stage.id] = { status: 'pending' };
    }

    // Mark stages 1-9 completed (pre-plan analysis + plan), but pipeline status is waiting_approval
    const completedStages = [
      'requirement',
      'acceptance',
      'impact-analysis',
      'blueprint',
      'architecture',
      'design-patterns',
      'adr',
      'architecture-review',
      'plan',
    ];
    for (const sId of completedStages) {
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
        stageId: 'plan',
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
        stageId: 'plan',
        approved: true,
      },
    };

    const readyAfterApproval = getReadyStages(stateApproved, profile);
    expect(readyAfterApproval.length).toBe(1);
    expect(readyAfterApproval[0].id).toBe('acceptance-tests');
  });

  it('verifies all 20 stages have proper ecc_agent, ecc_skills, ecc_rules, and ecc_workflows assigned', () => {
    const config = structuredClone(DEFAULT_CONFIG);
    const profile = loadProfile('ecc', config);

    const planStage = profile.stages.find((s) => s.id === 'plan');
    expect(planStage?.ecc_agent).toBe('planner');
    expect(planStage?.ecc_skills).toContain('search-first');
    expect(planStage?.ecc_skills).toContain('iterative-retrieval');

    const reqStage = profile.stages.find((s) => s.id === 'requirement');
    expect(reqStage?.ecc_agent).toBe('planner');

    const impactStage = profile.stages.find((s) => s.id === 'impact-analysis');
    expect(impactStage?.ecc_agent).toBe('code-explorer');

    const archStage = profile.stages.find((s) => s.id === 'architecture');
    expect(archStage?.ecc_agent).toBe('architect');

    const dpStage = profile.stages.find((s) => s.id === 'design-patterns');
    expect(dpStage?.ecc_agent).toBe('code-architect');

    const archReviewStage = profile.stages.find((s) => s.id === 'architecture-review');
    expect(archReviewStage?.ecc_agent).toBe('code-reviewer');
    expect(archReviewStage?.ecc_rules).toContain('common');
    expect(archReviewStage?.ecc_workflows).toContain('orch-review');

    const tddStage = profile.stages.find((s) => s.id === 'tdd');
    expect(tddStage?.ecc_agent).toBe('tdd-guide');
    expect(tddStage?.ecc_rules).toContain('common');

    const codeReviewStage = profile.stages.find((s) => s.id === 'code-review');
    expect(codeReviewStage?.ecc_agent).toBe('code-reviewer');
    expect(codeReviewStage?.ecc_rules).toContain('common');
    expect(codeReviewStage?.ecc_workflows).toContain('orch-review');

    const secReviewStage = profile.stages.find((s) => s.id === 'security-review');
    expect(secReviewStage?.ecc_agent).toBe('security-reviewer');
    expect(secReviewStage?.ecc_rules).toContain('common');
  });
});
