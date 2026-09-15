import fs from 'fs';
import path from 'path';

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
            // Check for SKILL.md or main file
            const skillFile = path.join(fullDirPath, entry.name, 'SKILL.md');
            if (fs.existsSync(skillFile)) {
              this.catalog.set(entry.name.toLowerCase(), {
                name: entry.name,
                category,
                path: skillFile,
              });
            } else {
              // Catalog directory name
              this.catalog.set(entry.name.toLowerCase(), {
                name: entry.name,
                category,
                path: path.join(fullDirPath, entry.name),
              });
            }
          } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.yml'))) {
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
    const key = skillName.toLowerCase().trim();

    // 1. Try reading from external ECC folder if available
    if (this.eccPath) {
      if (!this.initialized) {
        await this.initialize();
      }

      const item = this.catalog.get(key);
      if (item) {
        const cached = this.cache.get(item.path);
        const now = Date.now();
        if (cached && now - cached.timestamp < this.cacheTtlMs) {
          return cached.content;
        }

        try {
          // Read-only access
          let filePath = item.path;
          const stat = await fs.promises.stat(filePath);
          if (stat.isDirectory()) {
            const potentialFile = path.join(filePath, 'SKILL.md');
            if (fs.existsSync(potentialFile)) {
              filePath = potentialFile;
            }
          }

          if (fs.existsSync(filePath) && (await fs.promises.stat(filePath)).isFile()) {
            const raw = await fs.promises.readFile(filePath, 'utf-8');
            // Clean frontmatter if present
            const cleaned = raw.replace(/^---[\s\S]*?---\s*/, '').trim();
            const formatted = `[ECC METHODOLOGY: ${skillName.toUpperCase()}]\n${cleaned}`;
            this.cache.set(item.path, { content: formatted, timestamp: now });
            return formatted;
          }
        } catch {
          // Fall through to builtin
        }
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
    if (!skillNames || skillNames.length === 0) {
      return '';
    }

    const instructions: string[] = [];
    for (const name of skillNames) {
      const instr = await this.getSkillInstruction(name);
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

  public getSkillInstructionSync(skillName: string): string {
    const key = skillName.toLowerCase().trim();

    if (this.eccPath) {
      const item = this.catalog.get(key);
      if (item) {
        const cached = this.cache.get(item.path);
        if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
          return cached.content;
        }

        try {
          let filePath = item.path;
          if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
            const potential = path.join(filePath, 'SKILL.md');
            if (fs.existsSync(potential)) {
              filePath = potential;
            }
          }

          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const cleaned = raw.replace(/^---[\s\S]*?---\s*/, '').trim();
            const formatted = `[ECC METHODOLOGY: ${skillName.toUpperCase()}]\n${cleaned}`;
            this.cache.set(item.path, { content: formatted, timestamp: Date.now() });
            return formatted;
          }
        } catch {
          // Fall through to builtin
        }
      }
    }

    if (BUILTIN_ECC_SKILLS[key]) {
      return BUILTIN_ECC_SKILLS[key];
    }

    return `[METHODOLOGY: ${skillName.toUpperCase()}]\nApply standard engineering best practices for ${skillName}.`;
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

  public getRolePersona(role: string): string {
    const key = role.toLowerCase().trim();
    if (BUILTIN_ROLE_PERSONAS[key]) {
      return BUILTIN_ROLE_PERSONAS[key];
    }
    return `Specialist for role: ${role}`;
  }
}

// Global singleton instance for shared pipeline execution
export const defaultEccAdapter = new EccKnowledgeAdapter();
