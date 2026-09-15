import { describe, expect, it } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  EccKnowledgeAdapter,
  BUILTIN_ECC_SKILLS,
  BUILTIN_ROLE_PERSONAS,
  defaultEccAdapter,
} from '../src/ecc-adapter';
import { buildPromptForStage } from '../src/prompts';
import { StageDefinition } from '../src/types';

describe('EccKnowledgeAdapter', () => {
  it('initializes without external directory and reports not configured', () => {
    const adapter = new EccKnowledgeAdapter({ eccPath: undefined });
    expect(adapter.isExternalConfigured()).toBe(false);
    expect(adapter.getEccPath()).toBeUndefined();
  });

  it('provides all 8 core ECC methodologies via built-in fallback', async () => {
    const adapter = new EccKnowledgeAdapter();
    const skills = [
      'search-first',
      'iterative-retrieval',
      'backend-patterns',
      'api-design',
      'tdd-workflow',
      'coding-standards',
      'security-review',
      'verification-loop',
    ];

    for (const skill of skills) {
      const asyncRes = await adapter.getSkillInstruction(skill);
      const syncRes = adapter.getSkillInstructionSync(skill);

      expect(asyncRes).toContain('[ECC METHODOLOGY:');
      expect(syncRes).toContain('[ECC METHODOLOGY:');
      expect(asyncRes).toBe(BUILTIN_ECC_SKILLS[skill]);
      expect(syncRes).toBe(BUILTIN_ECC_SKILLS[skill]);
    }
  });

  it('resolves multiple skills into a formatted guideline block', async () => {
    const adapter = new EccKnowledgeAdapter();
    const resolved = await adapter.resolveStageSkills(['tdd-workflow', 'security-review']);

    expect(resolved).toContain('MANDATORY ENGINEERING METHODOLOGIES & GUIDELINES:');
    expect(resolved).toContain('TDD-WORKFLOW');
    expect(resolved).toContain('Red-Green-Refactor');
    expect(resolved).toContain('SECURITY-REVIEW');
    expect(resolved).toContain('Threat Modeling');
  });

  it('provides specialized role personas for all 7 standard specialist roles', () => {
    const adapter = new EccKnowledgeAdapter();
    expect(adapter.getRolePersona('workflow-orchestrator')).toContain('Workflow Orchestrator');
    expect(adapter.getRolePersona('architect-reviewer')).toContain('Software Architect');
    expect(adapter.getRolePersona('security-auditor')).toContain('Application Security');
    expect(adapter.getRolePersona('test-automator')).toContain('QA Automation');
    expect(adapter.getRolePersona('code-reviewer')).toContain('Code Review');
    expect(adapter.getRolePersona('fullstack-developer')).toContain('Implementation Specialist');
    expect(adapter.getRolePersona('technical-writer')).toContain('Technical Documentation');
  });

  it('reads and indexes external ECC directory when configured', async () => {
    // Create temporary mock ECC directory
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-mock-'));
    const skillsDir = path.join(tempDir, 'skills', 'custom-ecc-skill');
    fs.mkdirSync(skillsDir, { recursive: true });

    const skillContent = `---
name: custom-ecc-skill
description: Custom ECC skill for testing
---
### Custom Procedure
1. Verify database migration
2. Check replication lag
`;
    fs.writeFileSync(path.join(skillsDir, 'SKILL.md'), skillContent, 'utf-8');

    try {
      const adapter = new EccKnowledgeAdapter({ eccPath: tempDir });
      expect(adapter.isExternalConfigured()).toBe(true);

      await adapter.initialize();
      const instruction = await adapter.getSkillInstruction('custom-ecc-skill');
      expect(instruction).toContain('[ECC METHODOLOGY: CUSTOM-ECC-SKILL]');
      expect(instruction).toContain('Verify database migration');
      expect(instruction).toContain('Check replication lag');
      // Verify frontmatter was cleaned
      expect(instruction).not.toContain('name: custom-ecc-skill');

      // Test sync retrieval from cache
      const syncInstruction = adapter.getSkillInstructionSync('custom-ecc-skill');
      expect(syncInstruction).toContain('Verify database migration');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('falls back to built-in knowledge when skill is not in external directory', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-empty-'));
    try {
      const adapter = new EccKnowledgeAdapter({ eccPath: tempDir });
      await adapter.initialize();

      const instruction = await adapter.getSkillInstruction('tdd-workflow');
      expect(instruction).toContain('Red-Green-Refactor');
      expect(instruction).toBe(BUILTIN_ECC_SKILLS['tdd-workflow']);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('injects ECC skill guidelines into prompt when stage defines ecc_skills', () => {
    const stage: StageDefinition = {
      id: 'requirement',
      role: 'analyst',
      read_only: true,
      ecc_skills: ['search-first', 'iterative-retrieval'],
    };

    const prompt = buildPromptForStage({
      pipelineId: 'pipe-ecc-prompt-test',
      objective: 'Verify ECC skills injection',
      workspace: '/test/workspace',
      pipelineDir: '/test/workspace/.omp/pipelines/pipe-ecc-prompt-test',
      taskId: 'task-1',
      dispatchId: 'disp-1',
      stage,
    });

    expect(prompt).toContain('MANDATORY ENGINEERING METHODOLOGIES & GUIDELINES:');
    expect(prompt).toContain('[ECC METHODOLOGY: SEARCH-FIRST]');
    expect(prompt).toContain('Never guess or assume codebase structure');
    expect(prompt).toContain('[ECC METHODOLOGY: ITERATIVE-RETRIEVAL]');
  });

  it('injects ECC skill guidelines into prompt when stage defines generic skills attribute', () => {
    const stage: StageDefinition = {
      id: 'tdd',
      role: 'coder',
      skills: ['tdd-workflow', 'coding-standards'],
    };

    const prompt = buildPromptForStage({
      pipelineId: 'pipe-skills-prompt-test',
      objective: 'Verify generic skills injection',
      workspace: '/test/workspace',
      pipelineDir: '/test/workspace/.omp/pipelines/pipe-skills-prompt-test',
      taskId: 'task-2',
      dispatchId: 'disp-2',
      stage,
    });

    expect(prompt).toContain('MANDATORY ENGINEERING METHODOLOGIES & GUIDELINES:');
    expect(prompt).toContain('[ECC METHODOLOGY: TDD-WORKFLOW]');
    expect(prompt).toContain('Red-Green-Refactor');
    expect(prompt).toContain('[ECC METHODOLOGY: CODING-STANDARDS]');
    expect(prompt).toContain('Surgical Changes');
  });
});
