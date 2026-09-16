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
      pipelineDir: '/test/workspace/.pipeline/pipe-ecc-prompt-test',
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
      pipelineDir: '/test/workspace/.pipeline/pipe-skills-prompt-test',
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

  it('loads skills, rules, and workflows JIT on-demand directly without calling initialize()', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-jit-test-'));
    const skillDir = path.join(tempDir, 'skills', 'jit-skill');
    const rulesDir = path.join(tempDir, 'rules', 'typescript');
    const workflowDir = path.join(tempDir, 'workflows');

    fs.mkdirSync(skillDir, { recursive: true });
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.mkdirSync(workflowDir, { recursive: true });

    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: jit-skill\n---\n### JIT Skill Procedure\nExecute immediate analysis.',
      'utf-8'
    );
    fs.writeFileSync(
      path.join(rulesDir, 'coding-style.md'),
      '---\nname: ts-coding-style\n---\n### TypeScript Rules\nUse strict types and no any.',
      'utf-8'
    );
    fs.writeFileSync(
      path.join(workflowDir, 'orch-review.md'),
      '### Review Workflow\n1. Check diff\n2. Run linter',
      'utf-8'
    );

    try {
      const adapter = new EccKnowledgeAdapter({ eccPath: tempDir });
      // Notice: DO NOT call adapter.initialize()! Verify JIT direct resolution!
      expect(adapter.isExternalConfigured()).toBe(true);

      const skillRes = adapter.getSkillInstructionSync('jit-skill');
      expect(skillRes).toContain('[ECC METHODOLOGY: JIT-SKILL]');
      expect(skillRes).toContain('Execute immediate analysis.');

      const ruleRes = adapter.getRuleInstructionSync('typescript/coding-style');
      expect(ruleRes).toContain('[ECC RULE: TYPESCRIPT/CODING-STYLE]');
      expect(ruleRes).toContain('Use strict types and no any.');

      const workflowRes = adapter.getWorkflowInstructionSync('orch-review');
      expect(workflowRes).toContain('[ECC WORKFLOW: ORCH-REVIEW]');
      expect(workflowRes).toContain('Check diff');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('injects ecc_rules and ecc_workflows into buildPromptForStage', () => {
    const stage: StageDefinition = {
      id: 'implement',
      role: 'coder',
      ecc_skills: ['coding-standards'],
      ecc_rules: ['typescript/coding-style'],
      ecc_workflows: ['orch-review'],
    };

    const prompt = buildPromptForStage({
      pipelineId: 'pipe-jit-prompt-test',
      objective: 'Verify rules and workflows injection',
      workspace: '/test/workspace',
      pipelineDir: '/test/workspace/.pipeline/pipe-jit-prompt-test',
      taskId: 'task-jit',
      dispatchId: 'disp-jit',
      stage,
    });

    expect(prompt).toContain('MANDATORY ENGINEERING METHODOLOGIES & GUIDELINES:');
    expect(prompt).toContain('CODING-STANDARDS');
    expect(prompt).toContain('MANDATORY CODING RULES & CONVENTIONS:');
    expect(prompt).toContain('TYPESCRIPT/CODING-STYLE');
    expect(prompt).toContain('SPECIALIZED STAGE WORKFLOW SPECIFICATIONS:');
    expect(prompt).toContain('ORCH-REVIEW');
  });

  it('verifies full ECC external directory layout dynamically with skills, rules, workflows and banner', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-external-fixture-'));
    const skillDir = path.join(tempDir, 'skills', 'search-first');
    const rulesDir = path.join(tempDir, 'rules', 'typescript');
    const workflowsDir = path.join(tempDir, 'workflows');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.mkdirSync(workflowsDir, { recursive: true });

    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: search-first\n---\nTOOL AVAILABILITY PREFLIGHT\nPARALLEL SEARCH\nVerify existing code before writing.',
      'utf-8'
    );
    fs.writeFileSync(
      path.join(rulesDir, 'coding-standards.md'),
      '# Coding Standards\nSurgical edits only.',
      'utf-8'
    );
    fs.writeFileSync(
      path.join(workflowsDir, 'orch-review.md'),
      '# Orchestration Review Workflow\nInspect diff thoroughly.',
      'utf-8'
    );

    try {
      const adapter = new EccKnowledgeAdapter({ eccPath: tempDir });
      expect(adapter.isExternalConfigured()).toBe(true);
      expect(adapter.getEccPath()).toBe(tempDir);

      const status = adapter.getEccStatusSummary();
      expect(status.configured).toBe(true);
      expect(status.valid).toBe(true);
      expect(status.skillsCount).toBeGreaterThanOrEqual(1);
      expect(status.rulesCount).toBeGreaterThanOrEqual(1);
      expect(status.workflowsCount).toBeGreaterThanOrEqual(1);

      const searchFirst = adapter.getSkillInstructionSync('search-first');
      expect(searchFirst).toContain('[ECC METHODOLOGY: SEARCH-FIRST]');
      expect(searchFirst).toContain('TOOL AVAILABILITY PREFLIGHT');
      expect(searchFirst).toContain('PARALLEL SEARCH');

      const stage: StageDefinition = {
        id: 'requirement',
        role: 'analyst',
        ecc_skills: ['search-first'],
        ecc_rules: ['typescript/coding-standards'],
        ecc_workflows: ['orch-review'],
      };

      const summary = adapter.getStageEccSummary(stage, 'workflow-orchestrator');
      expect(summary.source).toBe('external');
      expect(summary.skills[0].source).toBe('external');
      expect(summary.rules[0].source).toBe('external');
      expect(summary.workflows[0].source).toBe('external');

      const banner = adapter.formatStageEccBanner(stage, 'workflow-orchestrator');
      expect(banner).toContain('[ECC Governance]');
      expect(banner).toContain('search-first [external]');
      expect(banner).toContain('typescript/coding-standards [external]');
      expect(banner).toContain('orch-review [external]');

      // Prompt injection with ECC Governance Context header
      const prompt = buildPromptForStage({
        pipelineId: 'pipe-ecc-banner-test',
        objective: 'Verify ECC banner and methodology context in prompt',
        workspace: '/test/workspace',
        pipelineDir: '/test/workspace/.pipeline/pipe-ecc-banner-test',
        taskId: 'task-ecc',
        dispatchId: 'disp-ecc',
        stage,
        adapter,
      });

      expect(prompt).toContain('[ECC GOVERNANCE & METHODOLOGY CONTEXT]');
      expect(prompt).toContain('search-first [external]');
      expect(prompt).toContain('typescript/coding-standards [external]');
      expect(prompt).toContain('orch-review [external]');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('verifies environment ECC directory if specified in ECC_DIR or ECC_PATH without hardcoding', () => {
    const envEcc = process.env.ECC_DIR || process.env.ECC_PATH;
    if (envEcc && fs.existsSync(envEcc)) {
      const adapter = new EccKnowledgeAdapter({ eccPath: envEcc });
      expect(adapter.isExternalConfigured()).toBe(true);
      const status = adapter.getEccStatusSummary();
      expect(status.valid).toBe(true);
    }
  });
});
