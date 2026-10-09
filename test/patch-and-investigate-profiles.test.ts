import { describe, expect, it } from 'bun:test';
import { loadProfile, BUILTIN_PROFILES } from '../src/profiles';
import { DEFAULT_CONFIG } from '../src/config';
import { validateDAG, getReadyStages } from '../src/dag';
import {
  buildAnalystPrompt,
  buildPlannerPrompt,
  buildCoderPrompt,
  buildReviewerPrompt,
  buildPromptForStage,
  SIMPLICITY_DIRECTIVE,
  LOG_TRIAGE_DIRECTIVE,
} from '../src/prompts';
import { PipelineState } from '../src/types';

describe('Patch and Investigate Profiles', () => {
  it('loads patch profile successfully and matches 6 stages', () => {
    const config = structuredClone(DEFAULT_CONFIG);
    const profile = loadProfile('patch', config);

    expect(profile.name).toBe('patch');
    expect(profile.stages.length).toBe(6);

    const expectedStageIds = ['rca', 'plan', 'implement', 'verify', 'review', 'evidence'];
    expect(profile.stages.map((s) => s.id)).toEqual(expectedStageIds);
  });

  it('validates acyclic DAG for patch profile', () => {
    const config = structuredClone(DEFAULT_CONFIG);
    const profile = loadProfile('patch', config);
    expect(() => validateDAG(profile)).not.toThrow();
  });

  it('verifies patch profile halts at plan stage for mandatory user plan approval gate', () => {
    const config = structuredClone(DEFAULT_CONFIG);
    const profile = loadProfile('patch', config);

    const planStage = profile.stages.find((s) => s.id === 'plan');
    expect(planStage).toBeDefined();
    expect(planStage?.require_approval).toBe(true);
    expect(planStage?.outputs).toContain('plan.md');

    // Mock initial pipeline state
    const state: PipelineState = {
      id: 'pipe-test-patch',
      objective: 'Fix resolvePaQlnCouncilMemberSearchTerm logic bug',
      profile: 'patch',
      workspace: { mode: 'active', path: '/test/workspace' },
      status: 'waiting_approval',
      approval: { required: true, stageId: 'plan', approved: false },
      stages: {
        rca: { status: 'completed' },
        plan: { status: 'completed' },
        implement: { status: 'pending' },
        verify: { status: 'pending' },
        review: { status: 'pending' },
        evidence: { status: 'pending' },
      },
      fixLoops: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const readyStages = getReadyStages(state, profile);
    // When waiting for approval, implement should NOT be ready
    expect(readyStages).toEqual([]);

    // After approval
    expect(state.approval).toBeDefined();
    state.approval!.approved = true;
    state.status = 'running';
    const readyAfterApproval = getReadyStages(state, profile);
    expect(readyAfterApproval.map((s) => s.id)).toEqual(['implement']);
  });

  it('loads investigate profile successfully and matches 4 read-only stages', () => {
    const config = structuredClone(DEFAULT_CONFIG);
    const profile = loadProfile('investigate', config);

    expect(profile.name).toBe('investigate');
    expect(profile.stages.length).toBe(4);

    const expectedStageIds = ['log-analysis', 'root-cause', 'impact-scope', 'remediation-plan'];
    expect(profile.stages.map((s) => s.id)).toEqual(expectedStageIds);

    // All stages in investigate profile must be read-only
    for (const stage of profile.stages) {
      expect(stage.read_only).toBe(true);
    }
    expect(() => validateDAG(profile)).not.toThrow();
  });

  it('compiles analyst prompt for rca and log-analysis with simplicity directive and no plan.md requirement', () => {
    const prompt = buildAnalystPrompt({
      pipelineId: 'pipe-patch-001',
      objective: 'Investigate searchTerm mismatch',
      workspace: '/test/workspace',
      pipelineDir: '/test/workspace/.pipeline/pipe-patch-001',
      taskId: 'task-rca',
      dispatchId: 'disp-rca',
      stage: {
        id: 'rca',
        role: 'analyst',
        outputs: ['root-cause-analysis.md', 'impact.md'],
      },
    });

    expect(prompt).toContain('Analytical specialist agent (rca)');
    expect(prompt).toContain('root-cause-analysis.md');
    expect(prompt).toContain('impact.md');
    expect(prompt).toContain('Distinguish symptom');
    expect(prompt).toContain('MINIMAL SURGICAL SCOPE');
    expect(prompt).toContain(SIMPLICITY_DIRECTIVE);
    // Should NOT confuse analyst with planner
    expect(prompt).not.toContain('You are the planning agent');
  });

  it('verifies prompt dispatcher uses buildAnalystPrompt for analyst role in dispatch', () => {
    const prompt = buildPromptForStage({
      pipelineId: 'pipe-patch-002',
      objective: 'Diagnose log failure',
      workspace: '/test/workspace',
      pipelineDir: '/test/workspace/.pipeline/pipe-patch-002',
      taskId: 'task-log',
      dispatchId: 'disp-log',
      stage: {
        id: 'log-analysis',
        role: 'analyst',
        outputs: ['log-analysis.md'],
      },
    });

    expect(prompt).toContain('Analytical specialist agent (log-analysis)');
    expect(prompt).toContain('log-analysis.md');
    expect(prompt).toContain('SIMPLICITY & ANTI-OVER-ENGINEERING DIRECTIVE');
  });

  it('verifies coder and reviewer prompts contain Simplicity and Log Triage directives', () => {
    const coderPrompt = buildCoderPrompt({
      pipelineId: 'pipe-patch-003',
      objective: 'Apply surgical fix',
      workspace: '/test/workspace',
      pipelineDir: '/test/workspace/.pipeline/pipe-patch-003',
      taskId: 'task-code',
      dispatchId: 'disp-code',
      stage: { id: 'implement', role: 'coder' },
    });

    expect(coderPrompt).toContain(SIMPLICITY_DIRECTIVE);
    expect(coderPrompt).toContain(LOG_TRIAGE_DIRECTIVE);
    expect(coderPrompt).toContain('Targeted Testing');

    const reviewerPrompt = buildReviewerPrompt({
      pipelineId: 'pipe-patch-004',
      objective: 'Review surgical change',
      workspace: '/test/workspace',
      pipelineDir: '/test/workspace/.pipeline/pipe-patch-004',
      taskId: 'task-rev',
      dispatchId: 'disp-rev',
      stage: { id: 'review', role: 'reviewer' },
    });

    expect(reviewerPrompt).toContain('Simplicity & Over-Engineering');
    expect(reviewerPrompt).toContain(SIMPLICITY_DIRECTIVE);
    expect(reviewerPrompt).toContain(LOG_TRIAGE_DIRECTIVE);
  });

  it('classifies real-world resolvePaQlnCouncilMemberSearchTerm case as patch profile', () => {
    const { classifyObjective } = require('../src/triage');
    const realWorldObjective =
      'phân tích nghiên cứu tìm hiểu xử lý resolvePaQlnCouncilMemberSearchTerm src\\main\\java\\vn\\com\\msb\\leno\\eb\\domain\\esign\\EsignIntegrationService.java Thông tin councilApproval.getCouncilsCode() là động, nhưng SearchTerm trong file template doc, pdf ở vị trí ký là cố định';

    const result = classifyObjective(realWorldObjective);
    expect(result.profile).toBe('patch');
    expect(result.confidence).toBe('high');
    expect(result.detectedSignals.isBugfixOrPatch).toBe(true);
    expect(result.detectedSignals.hasSpecificFileTarget).toBe(true);
    expect(result.detectedSignals.targetFiles.length).toBeGreaterThan(0);
    expect(result.rationale).toContain('Localized bugfix/patch detected');
  });

  it('classifies read-only log investigation case as investigate profile', () => {
    const { classifyObjective } = require('../src/triage');
    const objective = 'chỉ phân tích tìm hiểu nguyên nhân lỗi và chẩn đoán log hệ thống';

    const result = classifyObjective(objective);
    expect(result.profile).toBe('investigate');
    expect(result.confidence).toBe('high');
    expect(result.detectedSignals.isInvestigateOnly).toBe(true);
  });

  it('classifies enterprise architecture / feature development case as ecc profile', () => {
    const { classifyObjective } = require('../src/triage');
    const objective = 'xây dựng tính năng OAuth2 SSO login và tái cấu trúc hệ thống microservices';

    const result = classifyObjective(objective);
    expect(result.profile).toBe('ecc');
    expect(result.detectedSignals.isArchitectureOrFeature).toBe(true);
  });

  it('integrates auto-triage in PipelineController to auto-route profile when profile is auto', async () => {
    const { PipelineController } = require('../src/controller');
    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-auto-triage-test-'));
    const controller = new PipelineController({
      config: structuredClone(DEFAULT_CONFIG),
      cwd: tempDir,
    });

    const created = await controller.createPipeline({
      objective: 'fix bug resolvePaQlnCouncilMemberSearchTerm in src/main/java/EsignService.java',
      profileName: 'auto',
    });

    // Should have automatically routed to 'patch'
    expect(created.profile.name).toBe('patch');
    expect(created.state.profile).toBe('patch');

    // request.md should document Auto-Triage
    const requestMd = fs.readFileSync(path.join(created.dir, 'request.md'), 'utf8');
    expect(requestMd).toContain('Auto-Triage');
  });

  it('defaults to auto profile and auto-routes when profileName is omitted', async () => {
    const { PipelineController } = require('../src/controller');
    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-default-auto-test-'));
    const controller = new PipelineController({
      config: structuredClone(DEFAULT_CONFIG),
      cwd: tempDir,
    });

    // 1. Without profileName, bugfix should route to patch
    const bugfixRun = await controller.createPipeline({
      objective: 'Sửa lỗi null pointer trong EsignService.java',
    });
    expect(bugfixRun.profile.name).toBe('patch');

    // 2. Without profileName, enterprise feature should route to ecc
    const featureRun = await controller.createPipeline({
      objective: 'Xây dựng tính năng OAuth2 SSO toàn diện',
    });
    expect(featureRun.profile.name).toBe('ecc');

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
