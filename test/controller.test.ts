import { describe, expect, it } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { PipelineController } from '../src/controller';
import { DEFAULT_CONFIG } from '../src/config';
import { writeArtifact, saveState, loadState } from '../src/state';
import { getReadyStages } from '../src/dag';

describe('PipelineController (Single-Session In-Session Execution)', () => {
  it('handles review failure and triggers fix loop within max_fix_loops using custom profile', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-test-'));
    const config = structuredClone(DEFAULT_CONFIG);
    config.artifacts.root = path.join(tempDir, '.pipeline');
    config.policies.max_fix_loops = 2;

    const customProfilePath = path.join(tempDir, 'custom-loop.yml');
    fs.writeFileSync(
      customProfilePath,
      `name: custom-loop
description: Custom profile for fix loop testing
stages:
  - id: plan
    role: planner
    outputs: [plan.md]
    next: [implement]
  - id: implement
    role: coder
    inputs: [plan.md]
    outputs: [implementation.md]
    deps: [plan]
    next: [test]
  - id: test
    role: tester
    inputs: [implementation.md]
    outputs: [test.md]
    deps: [implement]
    next: [review]
  - id: review
    role: reviewer
    inputs: [implementation.md, test.md]
    outputs: [review.md]
    deps: [test]
`,
      'utf8'
    );
    config.profiles['custom-loop'] = customProfilePath;

    const controller = new PipelineController({ config, cwd: tempDir });

    const { dir, state, profile } = await controller.createPipeline({
      objective: 'Implement OAuth',
      profileName: 'custom-loop',
    });

    writeArtifact(dir, 'review.md', '# Code Review\n\nFound bug in token refresh.\n\nVERDICT: FAIL');

    state.stages.plan.status = 'completed';
    state.stages.implement.status = 'completed';
    state.stages.test.status = 'completed';
    state.stages.review.status = 'running';

    const completed = controller.completeStage('review', dir, profile, state);
    expect(completed).toBe(true);

    expect(state.fixLoops).toBe(1);
    expect(state.stages.implement.status as string).toBe('pending');
    expect(state.stages.test.status as string).toBe('pending');
    expect(state.stages.review.status as string).toBe('pending');

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('reconciles running stage when artifact contract is satisfied on disk', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-recon-'));
    const config = structuredClone(DEFAULT_CONFIG);
    config.artifacts.root = path.join(tempDir, '.pipeline');

    const controller = new PipelineController({ config, cwd: tempDir });

    const { dir, state, profile } = await controller.createPipeline({
      objective: 'Build payment flow',
      profileName: 'ecc',
    });

    state.stages.implement.status = 'running';
    state.stages.implement.startTime = new Date(Date.now() - 5000).toISOString();

    writeArtifact(dir, 'implementation.md', '# Implementation Report\n\n1. Payment gateway setup\n2. Webhooks\n');

    const implPath = path.join(dir, 'implementation.md');
    const pastTime = (Date.now() - 3000) / 1000;
    fs.utimesSync(implPath, pastTime, pastTime);

    const changed = await (controller as any).reconcileRunningStages(dir, profile, state);

    expect(changed).toBe(true);
    expect(state.stages.implement.status as string).toBe('completed');
    expect(state.stages.implement.notes).toContain('Artifact contract satisfied');

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('enforces Plan Approval Gate when plan completes, pauses with waiting_approval, and resumes after approval', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-plan-gate-'));
    const config = structuredClone(DEFAULT_CONFIG);
    config.artifacts.root = path.join(tempDir, '.pipeline');
    config.policies.require_plan_approval = true;

    const controller = new PipelineController({ config, cwd: tempDir });

    const { dir, state, profile } = await controller.createPipeline({
      objective: 'Build Auth Service',
      profileName: 'ecc',
    });

    state.stages['requirement'].status = 'completed';
    state.stages['acceptance'].status = 'completed';
    state.stages['impact-analysis'].status = 'completed';
    state.stages['blueprint'].status = 'completed';
    state.stages['architecture'].status = 'completed';
    state.stages['design-patterns'].status = 'completed';
    state.stages['adr'].status = 'completed';
    state.stages['architecture-review'].status = 'completed';
    state.stages['plan'].status = 'running';

    const validPlan = `
# Master Engineering Plan: Auth Service

## Executive Summary & Objectives
Comprehensive plan for authenticating users via OAuth PKCE.

## Target Architecture & Implementation Steps
Step 1: Build JWT validation service.
Step 2: Add middleware for route protection.

## Test Strategy and Verification
Acceptance tests and unit tests for token expiration.
`.repeat(3); // make sure > 500 chars

    writeArtifact(dir, 'plan.md', validPlan);
    writeArtifact(dir, 'test-plan.md', '# Auth Service Test Plan\nDetailed tests.');
    saveState(dir, state);

    const completed = controller.completeStage('plan', dir, profile, state);
    expect(completed).toBe(true);

    expect(state.status).toBe('waiting_approval');
    expect(state.approval?.required).toBe(true);
    expect(state.approval?.approved).toBe(false);
    expect(state.stages.plan.status as string).toBe('completed');

    const readyWhileWaiting = getReadyStages(state, profile);
    expect(readyWhileWaiting.length).toBe(0);

    const updatedState = controller.approvePlan(dir, 'test-reviewer');
    expect(updatedState.status).toBe('running');
    expect(updatedState.approval?.approved).toBe(true);
    expect(updatedState.approval?.approvedBy).toBe('test-reviewer');

    const readyAfterApproval = getReadyStages(updatedState, profile);
    expect(readyAfterApproval.some((s) => s.id === 'acceptance-tests')).toBe(true);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('bypasses approval gate when policies.require_plan_approval is false and stage does not explicitly require approval', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-plan-nogate-'));
    const config = structuredClone(DEFAULT_CONFIG);
    config.artifacts.root = path.join(tempDir, '.pipeline');
    config.policies.require_plan_approval = false;

    const controller = new PipelineController({ config, cwd: tempDir });

    const { dir, state, profile } = await controller.createPipeline({
      objective: 'Build Quick Feature',
      profileName: 'ecc',
    });

    state.stages.implement.status = 'running';
    const completed = controller.completeStage('implement', dir, profile, state);
    expect(completed).toBe(true);
    expect(state.status).not.toBe('waiting_approval');
    expect(state.stages.implement.status as string).toBe('completed');

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('supports plan revision request and resets plan stage to pending', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-plan-revise-'));
    const config = structuredClone(DEFAULT_CONFIG);
    config.artifacts.root = path.join(tempDir, '.pipeline');

    const controller = new PipelineController({ config, cwd: tempDir });

    const { dir, state } = await controller.createPipeline({
      objective: 'Build API Gateway',
      profileName: 'ecc',
    });

    state.status = 'waiting_approval';
    state.approval = { required: true, stageId: 'plan', approved: false };
    state.stages.plan.status = 'completed';
    saveState(dir, state);

    const revisedState = controller.requestPlanRevision(dir, 'Add database migration details');
    expect(revisedState.status).toBe('running');
    expect(revisedState.approval?.approved).toBe(false);
    expect(revisedState.stages.plan.status as string).toBe('pending');
    expect(revisedState.stages.plan.notes).toContain('Revision requested');

    const feedbackPath = path.join(dir, 'plan-feedback.md');
    expect(fs.existsSync(feedbackPath)).toBe(true);
    expect(fs.readFileSync(feedbackPath, 'utf8')).toContain('Add database migration details');

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
