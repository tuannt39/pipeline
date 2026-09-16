import fs from 'fs';
import path from 'path';
import type { StageEccItem, StageEccSummary, EccStatusSummary, StageDefinition } from './types';
export type { StageEccItem, StageEccSummary, EccStatusSummary } from './types';

export interface EccCatalogItem {
  name: string;
  category: 'skill' | 'rule' | 'prompt' | 'workflow';
  path: string;
}

export const BUILTIN_ECC_SKILLS: Record<string, string> = {
  'search-first': `
[ECC METHODOLOGY: SEARCH-FIRST]
- Never guess or assume codebase structure, existing libraries, APIs, or naming conventions.
- Always use grep, find, and file viewing tools to verify existing implementations before drafting specs or writing code.
- Locate and examine adjacent components to maintain idiomatic consistency across the project.
- Identify existing utilities, helper functions, and dependencies before introducing new abstractions.
`.trim(),

  'iterative-retrieval': `
[ECC METHODOLOGY: ITERATIVE-RETRIEVAL]
- Retrieve context progressively in layers: directory overview -> module structure -> relevant source files -> precise symbol definitions.
- Avoid dumping entire files into context when a targeted slice or grep search suffices.
- Pinpoint call sites, data contracts, and type definitions before making architectural decisions.
`.trim(),

  'backend-patterns': `
[ECC METHODOLOGY: BACKEND-PATTERNS]
- Enforce strict separation of concerns: domain logic, data access, and transport/API layers must be cleanly decoupled.
- Utilize established design patterns (e.g. Repository, Service Layer, Dependency Injection, Factory) where appropriate.
- Maintain clear interface contracts and modular boundaries for long-term maintainability and testability.
- Avoid leaky abstractions or mixing business validation with infrastructure code.
`.trim(),

  'api-design': `
[ECC METHODOLOGY: API-DESIGN]
- Design clear, deterministic API contracts with explicit request and response schemas (e.g., Zod, JSON Schema).
- Ensure robust validation and sanitization for all input payloads and parameters.
- Provide structured, descriptive error responses with distinct machine-readable error codes.
- Guarantee backward compatibility and avoid breaking contract changes without versioning.
`.trim(),

  'tdd-workflow': `
[ECC METHODOLOGY: TDD-WORKFLOW]
- Follow the strict Red-Green-Refactor cycle:
  1. RED: Write automated tests asserting acceptance criteria and edge cases first. Verify they fail as expected.
  2. GREEN: Implement the minimum surgical code required to make all tests pass.
  3. REFACTOR: Clean up code, remove duplication, and optimize without altering passing test behaviors.
- Ensure high test reliability; never mock what you can easily test with realistic fixtures.
`.trim(),

  'coding-standards': `
[ECC METHODOLOGY: CODING-STANDARDS]
- Surgical Changes: Touch only lines strictly necessary for the objective. Do not reformat adjacent unrelated code.
- Clean up own mess: Remove any unused imports, variables, functions, or dead code created by your changes.
- Match existing style, naming conventions, and patterns found in the codebase.
- No speculative features, unrequested configurability, or premature abstractions (YAGNI).
`.trim(),

  'security-review': `
[ECC METHODOLOGY: SECURITY-REVIEW]
- Threat Modeling: Identify attack surfaces, trust boundaries, and potential vulnerability vectors.
- Authentication & Authorization: Enforce least privilege, strict session/token validation, and access controls.
- Input Sanitization & Validation: Guard against injection attacks (SQLi, NoSQLi, Command Injection, XSS, SSRF, Path Traversal).
- Secrets & Sensitive Data: Never log credentials, API keys, tokens, or PII. Ensure safe credential storage.
`.trim(),

  'verification-loop': `
[ECC METHODOLOGY: VERIFICATION-LOOP]
- Independent Verification: Run the full test suite and verify build integrity before marking any stage complete.
- Edge Case Matrix: Test boundary values, null/undefined inputs, network failures, and error handling branches.
- Regression Prevention: Ensure existing test suites remain 100% green.
- Evidence Documentation: Record executed test commands, pass/fail counts, and outputs in verification artifacts.
`.trim(),
};

export const BUILTIN_ROLE_PERSONAS: Record<string, string> = {
  'workflow-orchestrator': 'Senior Workflow Orchestrator & Multi-Stage Process Specialist. Responsible for requirements synthesis, DAG planning, and dependency coordination.',
  'architect-reviewer': 'Senior Software Architect Specialist. Responsible for system boundaries, component relationships, data flow design, and architectural decision records (ADR).',
  'security-auditor': 'Application Security & DevSecOps Specialist. Responsible for threat modeling, vulnerability detection, authentication auditing, and input sanitization enforcement.',
  'test-automator': 'QA Automation & Test Specialist. Responsible for automated test design, edge case coverage, TDD red-green verification, and regression prevention.',
  'code-reviewer': 'Senior Code Review Specialist. Responsible for independent critique, verification of git diffs against requirements, style conformity, and security checks.',
  'fullstack-developer': 'Core Implementation Specialist. Responsible for surgical code implementation, adherence to architecture specifications, and test suite execution.',
  'technical-writer': 'Technical Documentation & Specification Specialist. Responsible for precise acceptance criteria, API specifications, and clear system blueprints.',
};

export class EccKnowledgeAdapter {
  private eccPath?: string;
  private catalog: Map<string, EccCatalogItem> = new Map();
  private cache: Map<string, { content: string; timestamp: number }> = new Map();
  private cacheTtlMs: number;
  private initialized = false;

  constructor(options?: { eccPath?: string; cacheTtlMs?: number }) {
    this.eccPath = this.resolveEccPath(options?.eccPath);
    this.cacheTtlMs = options?.cacheTtlMs ?? 60000;
  }

  public setEccPath(explicitPath?: string): void {
    this.eccPath = this.resolveEccPath(explicitPath);
    this.cache.clear();
    this.catalog.clear();
    this.initialized = false;
  }

  private resolveEccPath(explicitPath?: string): string | undefined {
    const candidate =
      explicitPath ||
      process.env.ECC_DIR ||
      process.env.ECC_PATH ||
      '';

    if (!candidate || candidate.trim() === '') {
      return undefined;
    }

    const resolved = path.resolve(candidate.trim());
    try {
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        return resolved;
      }
    } catch {
      // Path cannot be accessed or invalid
    }
    return undefined;
  }

  public isExternalConfigured(): boolean {
    return !!this.eccPath;
  }

  public getEccPath(): string | undefined {
    return this.eccPath;
  }

  /**
   * Direct O(1) path resolver for skills in external ECC directory
   */
  public resolveSkillFilePath(skillName: string): string | undefined {
    if (!this.eccPath) return undefined;
    const cleanName = skillName.trim();
    const candidates = [
      path.join(this.eccPath, 'skills', cleanName, 'SKILL.md'),
      path.join(this.eccPath, 'skills', `${cleanName}.md`),
      path.join(this.eccPath, 'skills', cleanName, 'README.md'),
      path.join(this.eccPath, 'skills', cleanName.toLowerCase(), 'SKILL.md'),
      path.join(this.eccPath, 'skills', `${cleanName.toLowerCase()}.md`),
    ];

    for (const cand of candidates) {
      try {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
          return cand;
        }
      } catch {
        // ignore invalid paths
      }
    }
    return undefined;
  }

  /**
   * Direct O(1) path resolver for rules in external ECC directory
   */
  public resolveRuleFilePath(ruleRef: string): string | undefined {
    if (!this.eccPath) return undefined;
    const cleanRef = ruleRef.trim();
    const candidates = [
      path.join(this.eccPath, 'rules', `${cleanRef}.md`),
      path.join(this.eccPath, 'rules', cleanRef, 'RULE.md'),
      path.join(this.eccPath, 'rules', cleanRef, 'README.md'),
      path.join(this.eccPath, 'rules', `${cleanRef.toLowerCase()}.md`),
      path.join(this.eccPath, 'rules', cleanRef),
    ];

    for (const cand of candidates) {
      try {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
          return cand;
        }
      } catch {
        // ignore invalid paths
      }
    }
    return undefined;
  }

  /**
   * Direct O(1) path resolver for workflows in external ECC directory
   */
  public resolveWorkflowFilePath(workflowRef: string): string | undefined {
    if (!this.eccPath) return undefined;
    const cleanRef = workflowRef.trim();
    const candidates = [
      path.join(this.eccPath, 'workflows', `${cleanRef}.md`),
      path.join(this.eccPath, 'workflows', `${cleanRef}.workflow.js`),
      path.join(this.eccPath, 'workflows', workflowRef, 'WORKFLOW.md'),
      path.join(this.eccPath, 'workflows', cleanRef, 'README.md'),
      path.join(this.eccPath, 'workflows', cleanRef),
    ];

    for (const cand of candidates) {
      try {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
          return cand;
        }
      } catch {
        // ignore invalid paths
      }
    }
    return undefined;
  }

  public async initialize(): Promise<void> {
    if (this.initialized) return;
    this.catalog.clear();

    if (this.eccPath) {
      await this.scanDirectory(this.eccPath);
    }
    this.initialized = true;
  }

  private async scanDirectory(baseDir: string): Promise<void> {
    const subdirsToScan: Array<{ dirName: string; category: EccCatalogItem['category'] }> = [
      { dirName: 'skills', category: 'skill' },
      { dirName: 'rules', category: 'rule' },
      { dirName: 'prompts', category: 'prompt' },
      { dirName: 'workflows', category: 'workflow' },
    ];

    for (const { dirName, category } of subdirsToScan) {
      const fullDirPath = path.join(baseDir, dirName);
      try {
        if (!fs.existsSync(fullDirPath)) continue;
        const entries = await fs.promises.readdir(fullDirPath, { withFileTypes: true });

        for (const entry of entries) {
          if (entry.isDirectory()) {
            const skillFile = path.join(fullDirPath, entry.name, 'SKILL.md');
            if (fs.existsSync(skillFile)) {
              this.catalog.set(entry.name.toLowerCase(), {
                name: entry.name,
                category,
                path: skillFile,
              });
            } else {
              this.catalog.set(entry.name.toLowerCase(), {
                name: entry.name,
                category,
                path: path.join(fullDirPath, entry.name),
              });
            }
          } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.yml') || entry.name.endsWith('.js'))) {
            const baseName = path.parse(entry.name).name.toLowerCase();
            this.catalog.set(baseName, {
              name: baseName,
              category,
              path: path.join(fullDirPath, entry.name),
            });
          }
        }
      } catch {
        // Read-only scan failure tolerance
      }
    }
  }

  public async getSkillInstruction(skillName: string): Promise<string> {
    return this.getSkillInstructionSync(skillName);
  }

  public getSkillInstructionSync(skillName: string): string {
    const key = skillName.toLowerCase().trim();

    // 1. Direct O(1) JIT file lookup from external ECC directory
    const filePath = this.resolveSkillFilePath(skillName) || (this.catalog.get(key)?.path);
    if (filePath) {
      const cached = this.cache.get(filePath);
      const now = Date.now();
      if (cached && now - cached.timestamp < this.cacheTtlMs) {
        return cached.content;
      }

      try {
        let targetFile = filePath;
        if (fs.existsSync(targetFile) && fs.statSync(targetFile).isDirectory()) {
          const potential = path.join(targetFile, 'SKILL.md');
          if (fs.existsSync(potential)) {
            targetFile = potential;
          }
        }

        if (fs.existsSync(targetFile) && fs.statSync(targetFile).isFile()) {
          const raw = fs.readFileSync(targetFile, 'utf-8');
          const cleaned = raw.replace(/^---[\s\S]*?---\s*/, '').trim();
          const lineCount = cleaned.split('\n').length;
          const formatted = `[ECC METHODOLOGY: ${skillName.toUpperCase()}]\n${cleaned}`;
          this.cache.set(filePath, { content: formatted, timestamp: now });
          console.log(`  ↳ [ECC JIT] Loaded skill '${skillName}' from ${targetFile} (${lineCount} lines)`);
          return formatted;
        }
      } catch {
        // Fall through to builtin
      }
    }

    // 2. Fallback to builtin offline knowledge base
    if (BUILTIN_ECC_SKILLS[key]) {
      return BUILTIN_ECC_SKILLS[key];
    }

    // 3. Fallback for generic skills
    return `[METHODOLOGY: ${skillName.toUpperCase()}]\nApply standard engineering best practices for ${skillName}.`;
  }

  public async resolveStageSkills(skillNames: string[]): Promise<string> {
    return this.resolveStageSkillsSync(skillNames);
  }

  public resolveStageSkillsSync(skillNames: string[]): string {
    if (!skillNames || skillNames.length === 0) {
      return '';
    }

    const instructions: string[] = [];
    for (const name of skillNames) {
      const instr = this.getSkillInstructionSync(name);
      if (instr) {
        instructions.push(instr);
      }
    }

    if (instructions.length === 0) {
      return '';
    }

    return `
MANDATORY ENGINEERING METHODOLOGIES & GUIDELINES:
${instructions.join('\n\n')}
`.trim();
  }

  public getRuleInstructionSync(ruleRef: string): string {
    const key = ruleRef.toLowerCase().trim();
    const filePath = this.resolveRuleFilePath(ruleRef) || (this.catalog.get(key)?.path);

    if (filePath) {
      const cached = this.cache.get(filePath);
      const now = Date.now();
      if (cached && now - cached.timestamp < this.cacheTtlMs) {
        return cached.content;
      }

      try {
        let targetFile = filePath;
        if (fs.existsSync(targetFile) && fs.statSync(targetFile).isDirectory()) {
          const potential = path.join(targetFile, 'RULE.md');
          if (fs.existsSync(potential)) targetFile = potential;
        }

        if (fs.existsSync(targetFile) && fs.statSync(targetFile).isFile()) {
          const raw = fs.readFileSync(targetFile, 'utf-8');
          const cleaned = raw.replace(/^---[\s\S]*?---\s*/, '').trim();
          const lineCount = cleaned.split('\n').length;
          const formatted = `[ECC RULE: ${ruleRef.toUpperCase()}]\n${cleaned}`;
          this.cache.set(filePath, { content: formatted, timestamp: now });
          console.log(`  ↳ [ECC JIT] Loaded rule '${ruleRef}' from ${targetFile} (${lineCount} lines)`);
          return formatted;
        }
      } catch {
        // Fall through
      }
    }

    return `[ECC RULE: ${ruleRef.toUpperCase()}]\nAdhere strictly to repository coding conventions and architecture patterns for ${ruleRef}.`;
  }

  public resolveStageRulesSync(ruleRefs: string[]): string {
    if (!ruleRefs || ruleRefs.length === 0) {
      return '';
    }

    const instructions: string[] = [];
    for (const ref of ruleRefs) {
      const instr = this.getRuleInstructionSync(ref);
      if (instr) {
        instructions.push(instr);
      }
    }

    if (instructions.length === 0) {
      return '';
    }

    return `
MANDATORY CODING RULES & CONVENTIONS:
${instructions.join('\n\n')}
`.trim();
  }

  public getWorkflowInstructionSync(workflowRef: string): string {
    const key = workflowRef.toLowerCase().trim();
    const filePath = this.resolveWorkflowFilePath(workflowRef) || (this.catalog.get(key)?.path);

    if (filePath) {
      const cached = this.cache.get(filePath);
      const now = Date.now();
      if (cached && now - cached.timestamp < this.cacheTtlMs) {
        return cached.content;
      }

      try {
        let targetFile = filePath;
        if (fs.existsSync(targetFile) && fs.statSync(targetFile).isDirectory()) {
          const potential = path.join(targetFile, 'WORKFLOW.md');
          if (fs.existsSync(potential)) targetFile = potential;
        }

        if (fs.existsSync(targetFile) && fs.statSync(targetFile).isFile()) {
          const raw = fs.readFileSync(targetFile, 'utf-8');
          const cleaned = raw.replace(/^---[\s\S]*?---\s*/, '').trim();
          const lineCount = cleaned.split('\n').length;
          const formatted = `[ECC WORKFLOW: ${workflowRef.toUpperCase()}]\n${cleaned}`;
          this.cache.set(filePath, { content: formatted, timestamp: now });
          console.log(`  ↳ [ECC JIT] Loaded workflow '${workflowRef}' from ${targetFile} (${lineCount} lines)`);
          return formatted;
        }
      } catch {
        // Fall through
      }
    }

    return `[ECC WORKFLOW: ${workflowRef.toUpperCase()}]\nExecute stage workflow according to specification for ${workflowRef}.`;
  }

  public resolveStageWorkflowsSync(workflowRefs: string[]): string {
    if (!workflowRefs || workflowRefs.length === 0) {
      return '';
    }

    const instructions: string[] = [];
    for (const ref of workflowRefs) {
      const instr = this.getWorkflowInstructionSync(ref);
      if (instr) {
        instructions.push(instr);
      }
    }

    if (instructions.length === 0) {
      return '';
    }

    return `
SPECIALIZED STAGE WORKFLOW SPECIFICATIONS:
${instructions.join('\n\n')}
`.trim();
  }

  public getRolePersona(role: string): string {
    const key = role.toLowerCase().trim();
    if (BUILTIN_ROLE_PERSONAS[key]) {
      return BUILTIN_ROLE_PERSONAS[key];
    }
    return `Specialist for role: ${role}`;
  }

  private countFilesInSubdir(subdirName: string, extensions: string[]): number {
    if (!this.eccPath) return 0;
    const targetDir = path.join(this.eccPath, subdirName);
    try {
      if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
        return 0;
      }
      const entries = fs.readdirSync(targetDir, { withFileTypes: true });
      let count = 0;
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const hasSpec = extensions.some((ext) => fs.existsSync(path.join(targetDir, entry.name, ext)));
          if (hasSpec || extensions.includes('.md')) count++;
        } else if (entry.isFile()) {
          if (extensions.some((ext) => entry.name.endsWith(ext))) count++;
        }
      }
      return count;
    } catch {
      return 0;
    }
  }

  public getEccStatusSummary(): EccStatusSummary {
    if (!this.eccPath) {
      return {
        configured: false,
        valid: false,
        skillsCount: Object.keys(BUILTIN_ECC_SKILLS).length,
        rulesCount: 0,
        workflowsCount: 0,
        promptsCount: 0,
        source: 'builtin',
      };
    }

    let valid = false;
    let skillsCount = 0;
    let rulesCount = 0;
    let workflowsCount = 0;
    let promptsCount = 0;

    try {
      valid = fs.existsSync(this.eccPath) && fs.statSync(this.eccPath).isDirectory();
      if (valid) {
        skillsCount = this.countFilesInSubdir('skills', ['SKILL.md', '.md']);
        rulesCount = this.countFilesInSubdir('rules', ['RULE.md', '.md']);
        workflowsCount = this.countFilesInSubdir('workflows', ['WORKFLOW.md', '.md', '.workflow.js']);
        promptsCount = this.countFilesInSubdir('prompts', ['.md', '.txt']);
      }
    } catch {
      valid = false;
    }

    return {
      configured: true,
      path: this.eccPath,
      valid,
      skillsCount: valid ? skillsCount : Object.keys(BUILTIN_ECC_SKILLS).length,
      rulesCount,
      workflowsCount,
      promptsCount,
      source: valid ? 'external' : 'builtin',
    };
  }

  public inspectSkill(skillName: string): StageEccItem {
    const key = skillName.toLowerCase().trim();
    const filePath = this.resolveSkillFilePath(skillName) || this.catalog.get(key)?.path;
    if (filePath && fs.existsSync(filePath)) {
      return { name: skillName, source: 'external', path: filePath };
    }
    return { name: skillName, source: 'builtin' };
  }

  public inspectRule(ruleRef: string): StageEccItem {
    const key = ruleRef.toLowerCase().trim();
    const filePath = this.resolveRuleFilePath(ruleRef) || this.catalog.get(key)?.path;
    if (filePath && fs.existsSync(filePath)) {
      return { name: ruleRef, source: 'external', path: filePath };
    }
    return { name: ruleRef, source: 'builtin' };
  }

  public inspectWorkflow(workflowRef: string): StageEccItem {
    const key = workflowRef.toLowerCase().trim();
    const filePath = this.resolveWorkflowFilePath(workflowRef) || this.catalog.get(key)?.path;
    if (filePath && fs.existsSync(filePath)) {
      return { name: workflowRef, source: 'external', path: filePath };
    }
    return { name: workflowRef, source: 'builtin' };
  }

  public getStageEccSummary(stage: StageDefinition, agentPersona?: string): StageEccSummary {
    const rawSkills = stage.skills || stage.ecc_skills || [];
    const rawRules = stage.ecc_rules || [];
    const rawWorkflows = stage.ecc_workflows || [];

    const skills = rawSkills.map((s) => this.inspectSkill(s));
    const rules = rawRules.map((r) => this.inspectRule(r));
    const workflows = rawWorkflows.map((w) => this.inspectWorkflow(w));

    const hasExternal =
      skills.some((s) => s.source === 'external') ||
      rules.some((r) => r.source === 'external') ||
      workflows.some((w) => w.source === 'external');
    const hasBuiltin =
      skills.some((s) => s.source === 'builtin') ||
      rules.some((r) => r.source === 'builtin') ||
      workflows.some((w) => w.source === 'builtin');

    let source: 'external' | 'builtin' | 'mixed' = 'builtin';
    if (hasExternal && hasBuiltin) source = 'mixed';
    else if (hasExternal) source = 'external';

    const persona = agentPersona || stage.subagent || this.getRolePersona(stage.role);

    return {
      configuredPath: this.eccPath,
      source,
      agentPersona: persona,
      skills,
      rules,
      workflows,
    };
  }

  public formatStageEccBanner(stage: StageDefinition, agentPersona?: string): string {
    const summary = this.getStageEccSummary(stage, agentPersona);
    const lines: string[] = [];

    const eccPathLabel = this.eccPath
      ? `${this.eccPath} (${summary.source})`
      : 'Not configured (using built-in offline methodologies)';

    lines.push(`  [ECC Governance] Stage: "${stage.id}" (${stage.role}) | Agent Persona: ${summary.agentPersona}`);
    lines.push(`  ├─ ECC Directory: ${eccPathLabel}`);

    if (summary.skills.length > 0) {
      const formattedSkills = summary.skills.map((s) =>
        s.source === 'external' ? `${s.name} [external]` : `${s.name} [builtin]`
      );
      lines.push(`  ├─ Skills:        ${formattedSkills.join(', ')}`);
    } else {
      lines.push(`  ├─ Skills:        None assigned`);
    }

    if (summary.rules.length > 0) {
      const formattedRules = summary.rules.map((r) =>
        r.source === 'external' ? `${r.name} [external]` : `${r.name} [builtin]`
      );
      lines.push(`  ├─ Rules:         ${formattedRules.join(', ')}`);
    }

    if (summary.workflows.length > 0) {
      const formattedWorkflows = summary.workflows.map((w) =>
        w.source === 'external' ? `${w.name} [external]` : `${w.name} [builtin]`
      );
      lines.push(`  └─ Flows/Wf:      ${formattedWorkflows.join(', ')}`);
    } else {
      lines.push(`  └─ Flows/Wf:      Standard stage execution`);
    }

    return lines.join('\n');
  }
}

// Global singleton instance for shared pipeline execution
export const defaultEccAdapter = new EccKnowledgeAdapter();

export function configureDefaultEccAdapter(options?: { eccPath?: string; cacheTtlMs?: number }): void {
  if (options?.eccPath) {
    defaultEccAdapter.setEccPath(options.eccPath);
  }
}
