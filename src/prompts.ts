import fs from 'fs';
import path from 'path';
import { StageDefinition } from './types';
import { EccKnowledgeAdapter, defaultEccAdapter } from './ecc-adapter';

export interface PromptContext {
  pipelineId: string;
  objective: string;
  workspace: string;
  pipelineDir: string;
  taskId: string;
  dispatchId: string;
  stage: StageDefinition;
  inputs?: string[];
  fixIteration?: number;
  adapter?: EccKnowledgeAdapter;
}

export function buildProjectContextSnippet(workspace: string): string {
  const contextFiles = [
    'package.json', 'README.md',
    'tsconfig.json', 'pyproject.toml', 'Cargo.toml',
    'go.mod', 'composer.json', 'Gemfile',
    '.gemini/GEMINI.md',
  ];

  const found: string[] = [];
  for (const f of contextFiles) {
    const fullPath = path.join(workspace, f);
    try {
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        found.push(fullPath);
      }
    } catch {
      // ignore inaccessible files
    }
  }

  if (found.length === 0) return '';

  return `
PROJECT CONTEXT (Read these files FIRST for tech stack awareness):
${found.map(f => `- ${f}`).join('\n')}
`;
}

export function buildWorkerCompletionSnippet(_taskId: string, _dispatchId: string, defaultSubject: string, outputs?: string[]): string {
  const outputFilesList = outputs && outputs.length > 0
    ? `\nMandatory output artifacts to persist:\n${outputs.map(f => `- ${f}`).join('\n')}`
    : '';

  return `
STAGE COMPLETION CONTRACT:
${defaultSubject}
1. Persist all generated artifacts and findings to the pipeline directory.${outputFilesList}
2. Ensure all acceptance criteria and quality gates for this stage are satisfied.
`;
}

export const SIMPLICITY_DIRECTIVE = `
SIMPLICITY & ANTI-OVER-ENGINEERING DIRECTIVE (Rule 2 & Rule 3):
1. MINIMUM CODE THAT SOLVES THE PROBLEM (Rule 2):
   - Do NOT add configuration properties (e.g. Spring @Value, custom formatters, dynamic strategies) unless explicitly requested.
   - Do NOT add abstraction layers, helper classes, or speculative fallback logic for single-use code.
   - If a simple string format or constant solves the problem, use it directly. Never invent speculative configurability.
2. SURGICAL CHANGES (Rule 3):
   - Touch only what you must. Every changed line must trace directly to the objective.
   - Clean up only your own changes. Do not refactor unrelated code.
3. OVER-ENGINEERING (XỬ LÝ THỪA) DETECTION CHECKLIST:
   - [ ] YAGNI Violation: Did you add ANY unrequested configuration property, format flag, or fallback mechanism? -> If YES, REMOVE IT.
   - [ ] Blast Radius: Is the change larger than the problem (e.g. 50 lines for a 1-line string fix)? -> If YES, REDUCE TO MINIMAL FIX.
   - [ ] Defensive Overkill: Did you add try-catch fallback for a setting you invented? -> If YES, REMOVE SETTING AND FALLBACK.
   - [ ] Single-Use Abstraction: Did you introduce an interface or strategy used only once? -> If YES, INLINE IT.
`.trim();

export const LOG_TRIAGE_DIRECTIVE = `
LOG TRIAGE & TARGETED VERIFICATION PROTOCOL:
1. TARGETED TESTING ONLY:
   - Run ONLY the specific test class or test file affected by changes (e.g. ./mvnw test -Dtest=<TargetClassTest> or bun test <file>).
   - NEVER repeatedly run the entire test suite or full project builds across multiple stages when only a localized file was changed.
2. CONCISE LOG EXTRACTION:
   - When inspecting test or build output, extract ONLY:
     a) The specific Exception name and message.
     b) The primary failure line / stack trace frame in application code.
   - Do NOT spam full build logs or terminal output into state or artifacts.
3. COMMAND BUDGET:
   - Avoid guessing and repetitive command loops. Analyze root causes before running commands.
`.trim();

export function buildAnalystPrompt(ctx: PromptContext): string {
  const outputs = ctx.stage.outputs && ctx.stage.outputs.length > 0
    ? ctx.stage.outputs
    : ['analysis.md'];
  const outputFilesList = outputs.map((f) => `- ${path.join(ctx.pipelineDir, f)}`).join('\n');
  const inputList = ctx.inputs && ctx.inputs.length > 0
    ? `\nMANDATORY INPUTS (READ FIRST):\n${ctx.inputs.map((f) => `- ${path.join(ctx.pipelineDir, f)}`).join('\n')}\n`
    : '';
  const projectContext = buildProjectContextSnippet(ctx.workspace);

  return `
ROLE:
Analytical specialist agent (${ctx.stage.id}).

PIPELINE: ${ctx.pipelineId}
OBJECTIVE: ${ctx.objective}
WORKSPACE: ${ctx.workspace}
${projectContext}${inputList}
DO NOT:
- modify application source code
- commit changes
- create git worktree

MANDATORY OUTPUT ARTIFACTS TO PRODUCE:
${outputFilesList}

ANALYSIS PROTOCOL:
1. PROBLEM & LOG INVESTIGATION:
   - Identify observed symptoms, error logs, and failure traces.
   - Distinguish symptom (e.g. exception message) from root cause (e.g. dynamic vs static data conflict).
2. MINIMAL SURGICAL SCOPE:
   - Identify the exact minimal files and lines that require change.
   - Propose the cleanest, direct solution.
3. ANTI-OVER-ENGINEERING (Simplicity First):
   - Reject unrequested configurability, speculative properties, and extraneous abstraction layers.

${SIMPLICITY_DIRECTIVE}

${buildWorkerCompletionSnippet(ctx.taskId, ctx.dispatchId, `Analysis complete for ${ctx.stage.id} in ${ctx.pipelineId}`, outputs)}
`.trim();
}

export function buildPlannerPrompt(ctx: PromptContext): string {
  const planFile = path.join(ctx.pipelineDir, 'plan.md');
  const hasPrePlanInputs = ctx.inputs && ctx.inputs.length > 0;
  const projectContext = buildProjectContextSnippet(ctx.workspace);

  const inputSection = hasPrePlanInputs
    ? `
MANDATORY INPUTS (PRE-PLAN STAGES ARTIFACTS):
${ctx.inputs!.map((f) => `- ${path.join(ctx.pipelineDir, f)}`).join('\n')}

Read and thoroughly synthesize all completed pre-plan analysis artifacts before drafting plan.md.
`
    : `
MANDATORY RESEARCH PROTOCOL (Execute in this exact order before writing plan.md):
1. SCAN PROJECT STRUCTURE:
   - Run: find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' | head -200
   - Identify: language, framework, package manager, test runner, build system

2. ANALYZE EXISTING PATTERNS:
   - Examine 3-5 representative source files to understand coding conventions
   - Identify existing design patterns, naming conventions, file organization
   - Check for existing tests and test patterns

3. ASSESS SCOPE & IMPACT:
   - Identify ALL files that need modification for the objective
   - Map dependencies between affected files
   - Check for related tests that need updating

4. VERIFY CURRENT STATE:
   - Run: git status && git log --oneline -5
   - Check for uncommitted changes or WIP work

DO NOT proceed to writing plan.md until ALL research steps are complete.
`;

  const structureSection = hasPrePlanInputs
    ? `
plan.md MUST BE A COMPREHENSIVE 360° MASTER PLAN CONTAINING:
PART I: PRE-PLAN ANALYSIS & ARCHITECTURAL BASELINE (Consolidate Stages 1–8 findings)
1. Requirements & Business Rules (Synthesize business context and constraints from requirement.md / business-rules.md)
2. Acceptance Criteria (Clear behavioral & technical conditions from acceptance.md)
3. Impact Analysis & Affected Components (From impact-analysis.md)
4. System Blueprint & Target Architecture (From blueprint.md and architecture.md)
5. Design Patterns & Coding Standards (From design-patterns.md)
6. Architecture Decision Records (Core decisions and tradeoffs from adr/ADR-001.md)
7. Architecture Review & User Confirmation (Approved baseline from architecture-review.md)

PART II: EXECUTION & VERIFICATION ROADMAP (Detailed plan for Stages 9–20)
8. Relevant files to create or touch (surgical changes list)
9. Proposed implementation steps (TDD setup, implementation sequence)
10. Test strategy & acceptance test specifications (test-plan.md, acceptance-tests)
11. Code review & security review verification criteria
12. Remediation, verification loop, and evidence domain criteria for release readiness
`
    : `
plan.md MUST CONTAIN these exact sections with ## headers:

## 1. Objective Summary
- Restate the objective in your own words
- Success criteria (measurable outcomes)

## 2. Codebase Analysis
- Project tech stack (language, framework, key dependencies)
- Existing architecture patterns identified
- Relevant conventions and style guide

## 3. Impact Analysis
Table of files to create, modify, or delete with reasons:
| File | Action | Reason |
|------|--------|--------|

## 4. Implementation Plan
Step-by-step with exact file paths and code-level changes.
Each step must specify: file path, what changes, and dependencies on prior steps.

## 5. Dependencies & Prerequisites
- New packages/libraries needed
- Configuration changes required

## 6. Risk Assessment
| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|

## 7. Test Strategy
- Existing tests to verify (list commands)
- New tests to write
- Edge cases to cover

## 8. Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2
`;

  return `
ROLE:
You are the planning agent.

PIPELINE: ${ctx.pipelineId}
OBJECTIVE: ${ctx.objective}
WORKSPACE: ${ctx.workspace}
${projectContext}${inputSection}
DO NOT:
- modify application source code
- commit changes
- create git worktree

MUST PRODUCE:
${planFile}
${structureSection}
PLAN APPROVAL GATE:
Upon completing plan.md, the orchestrator triggers a mandatory approval gate (⏸️ Awaiting Plan approval). The user reviews and must approve this plan before implementation can start. Ensure your plan is clear, comprehensive, and unambiguous.

SELF-VERIFICATION BEFORE COMPLETION:
Before reporting completion, verify your plan addresses:
- [ ] Every aspect of the stated objective
- [ ] Specific file paths (not vague references)
- [ ] Concrete test strategy with verifiable commands
- [ ] Clear acceptance criteria
- [ ] Simplicity Audit: No unrequested properties, fallback logic, or speculative abstractions
If any check fails, revise plan.md before reporting done.

${SIMPLICITY_DIRECTIVE}

${buildWorkerCompletionSnippet(ctx.taskId, ctx.dispatchId, `Plan complete for ${ctx.pipelineId}`)}
`.trim();
}

export function buildArchitectPrompt(ctx: PromptContext): string {
  const outputFile = path.join(ctx.pipelineDir, 'architecture.md');
  const inputList = (ctx.inputs || ['plan.md'])
    .map((f) => `- ${path.join(ctx.pipelineDir, f)}`)
    .join('\n');

  return `
ROLE:
You are the software architect specialist.

PIPELINE: ${ctx.pipelineId}
OBJECTIVE: ${ctx.objective}
WORKSPACE: ${ctx.workspace}

READ MANDATORY INPUTS:
${inputList}

DO NOT:
- modify application source code
- commit changes

MUST PRODUCE:
${outputFile}

architecture.md MUST CONTAIN:
1. High-level architecture and component relationships
2. Data flow & state management design
3. Interface boundaries, API signatures, and contracts
4. Scalability, modularity, and future evolution considerations
5. Simplicity & YAGNI Justification: Explain why the proposed design is the minimum necessary architecture. Explicitly reject unrequested configurability or speculative abstractions.

${SIMPLICITY_DIRECTIVE}

${buildWorkerCompletionSnippet(ctx.taskId, ctx.dispatchId, `Architecture design complete for ${ctx.pipelineId}`)}
`.trim();
}

export function buildSecurityPrompt(ctx: PromptContext): string {
  const outputFile = path.join(ctx.pipelineDir, 'security-plan.md');
  const inputList = (ctx.inputs || ['plan.md'])
    .map((f) => `- ${path.join(ctx.pipelineDir, f)}`)
    .join('\n');

  return `
ROLE:
You are the application security specialist.

PIPELINE: ${ctx.pipelineId}
OBJECTIVE: ${ctx.objective}
WORKSPACE: ${ctx.workspace}

READ MANDATORY INPUTS:
${inputList}

DO NOT:
- modify application source code
- commit changes

MUST PRODUCE:
${outputFile}

security-plan.md MUST CONTAIN:
1. Threat model and attack surface assessment
2. Authentication, authorization, and token handling verification
3. Input validation, sanitization, and data protection requirements
4. Dependency vulnerability and security policy checks
${buildWorkerCompletionSnippet(ctx.taskId, ctx.dispatchId, `Security plan complete for ${ctx.pipelineId}`)}
`.trim();
}

export function buildPatternPrompt(ctx: PromptContext): string {
  const outputFile = path.join(ctx.pipelineDir, 'pattern.md');
  const inputList = (ctx.inputs || ['plan.md'])
    .map((f) => `- ${path.join(ctx.pipelineDir, f)}`)
    .join('\n');

  return `
ROLE:
You are the design patterns and code quality specialist.

PIPELINE: ${ctx.pipelineId}
OBJECTIVE: ${ctx.objective}
WORKSPACE: ${ctx.workspace}

READ MANDATORY INPUTS:
${inputList}

DO NOT:
- modify application source code
- commit changes

MUST PRODUCE:
${outputFile}

pattern.md MUST CONTAIN:
1. Idiomatic design patterns suited for this codebase and stack
2. Code reuse, abstractions, and clean code guidelines
3. Anti-patterns to strictly avoid
4. Naming conventions and file organization guidelines
5. Anti-Over-Engineering Guard: Reject unrequested flexibility, dynamic strategies, or speculative properties. Keep implementations direct and simple.

${SIMPLICITY_DIRECTIVE}

${buildWorkerCompletionSnippet(ctx.taskId, ctx.dispatchId, `Design pattern guidelines complete for ${ctx.pipelineId}`)}
`.trim();
}

export function buildCoderPrompt(ctx: PromptContext): string {
  const outputFile = path.join(ctx.pipelineDir, 'implementation.md');
  const inputList = (ctx.inputs && ctx.inputs.length > 0 ? ctx.inputs : ['plan.md'])
    .map((f) => `- ${path.join(ctx.pipelineDir, f)}`)
    .join('\n');

  return `
ROLE:
Implementation agent (coder).

PIPELINE: ${ctx.pipelineId}
OBJECTIVE: ${ctx.objective}
WORKSPACE: ${ctx.workspace}

MANDATORY INPUTS (READ CAREFULLY FIRST):
${inputList}

RULES:
- Inspect repository before editing
- Follow the plan and specialist guidelines strictly
- Do not silently reduce scope
- Do not rewrite unrelated files
- Implement clean, production-ready code with appropriate comments
- Run relevant tests and verify your changes build
- Do not modify pipeline state manually
- Strict Simplicity: Write the absolute minimum code to satisfy the plan. Never add unrequested properties, configs, or fallback strategies.
- Targeted Testing: Verify using targeted test commands only.

${SIMPLICITY_DIRECTIVE}

${LOG_TRIAGE_DIRECTIVE}

MUST PRODUCE:
${outputFile}

implementation.md MUST INCLUDE:
1. Summary of changes made
2. Changed and created files list
3. Tests executed and their results
4. Known limitations or notes for the reviewer
${buildWorkerCompletionSnippet(ctx.taskId, ctx.dispatchId, `Implementation complete for ${ctx.pipelineId}`)}
`.trim();
}

export function buildTesterPrompt(ctx: PromptContext): string {
  const outputFile = path.join(ctx.pipelineDir, 'test.md');
  const inputList = (ctx.inputs && ctx.inputs.length > 0 ? ctx.inputs : ['plan.md', 'implementation.md'])
    .map((f) => `- ${path.join(ctx.pipelineDir, f)}`)
    .join('\n');

  return `
ROLE:
Test verification and QA agent.

PIPELINE: ${ctx.pipelineId}
OBJECTIVE: ${ctx.objective}
WORKSPACE: ${ctx.workspace}

MANDATORY INPUTS:
${inputList}

RULES:
- Inspect the modified codebase
- Run the full relevant test suite using targeted test commands
- Add automated unit or integration tests if coverage is missing
- Check edge cases and error handling

${LOG_TRIAGE_DIRECTIVE}

MUST PRODUCE:
${outputFile}

test.md MUST INCLUDE:
1. Test suites executed and commands used
2. Test pass/fail statistics
3. Edge case tests added
4. Regression risk analysis
${buildWorkerCompletionSnippet(ctx.taskId, ctx.dispatchId, `Testing complete for ${ctx.pipelineId}`)}
`.trim();
}

export function buildReviewerPrompt(ctx: PromptContext): string {
  const outputFile = path.join(ctx.pipelineDir, 'review.md');
  const inputList = (ctx.inputs && ctx.inputs.length > 0 ? ctx.inputs : ['plan.md', 'implementation.md', 'test.md'])
    .map((f) => `- ${path.join(ctx.pipelineDir, f)}`)
    .join('\n');

  return `
ROLE:
Independent reviewer agent.

DO NOT TRUST blindly:
- planner
- coder
- implementation.md

PIPELINE: ${ctx.pipelineId}
OBJECTIVE: ${ctx.objective}
WORKSPACE: ${ctx.workspace}

READ MANDATORY ARTIFACTS:
${inputList}

VERIFY IN CODEBASE:
1. Requirements satisfaction against objective
2. Full git diff (inspect all changed lines)
3. Architectural consistency and code quality
4. Security implications (secrets, validation, sanitization)
5. Test coverage and edge cases
6. Simplicity & Over-Engineering: Verify that no unrequested properties, fallback logic, or speculative abstractions were added. If over-engineering is detected, report VERDICT: FAIL and demand removal.

${SIMPLICITY_DIRECTIVE}

${LOG_TRIAGE_DIRECTIVE}

RUN:
- Build and test commands to verify independently (use targeted test commands)

MUST PRODUCE:
${outputFile}

review.md MUST CONTAIN:
1. Summary of findings
2. Detailed code review comments (file by file)
3. Simplicity & Over-Engineering Audit (confirm zero unrequested complexity)
4. Verdict on a single line at the very end:
   VERDICT: PASS
   or
   VERDICT: FAIL (with required fixes listed)
${buildWorkerCompletionSnippet(ctx.taskId, ctx.dispatchId, `Review complete for ${ctx.pipelineId}`)}
`.trim();
}

export function buildFixPrompt(ctx: PromptContext): string {
  const outputFile = path.join(ctx.pipelineDir, 'implementation.md');
  const reviewFile = path.join(ctx.pipelineDir, 'review.md');
  const inputList = (ctx.inputs || ['plan.md', 'implementation.md', 'review.md'])
    .map((f) => `- ${path.join(ctx.pipelineDir, f)}`)
    .join('\n');

  return `
ROLE:
Fix agent (iteration ${ctx.fixIteration || 1}).

The independent reviewer reported issues during review. You must resolve all points raised.

PIPELINE: ${ctx.pipelineId}
OBJECTIVE: ${ctx.objective}
WORKSPACE: ${ctx.workspace}

READ MANDATORY INPUTS:
${inputList}
Carefully study reviewer comments in: ${reviewFile}

RULES:
- Address all failed items in review.md
- Make surgical code fixes
- Strictly adhere to Simplicity First: Remove any unrequested complexity or over-engineering flagged by review
- Run targeted tests to ensure regressions are resolved
- Update ${outputFile} with fix details

${SIMPLICITY_DIRECTIVE}

${LOG_TRIAGE_DIRECTIVE}

MUST UPDATE:
${outputFile}
${buildWorkerCompletionSnippet(ctx.taskId, ctx.dispatchId, `Fix iteration ${ctx.fixIteration || 1} complete for ${ctx.pipelineId}`)}
`.trim();
}

export function buildPromptForStage(ctx: PromptContext): string {
  let prompt = '';
  switch (ctx.stage.role) {
    case 'analyst':
    case 'spec':
    case 'spec-writer':
      prompt = buildAnalystPrompt(ctx);
      break;
    case 'planner':
      prompt = buildPlannerPrompt(ctx);
      break;
    case 'architect':
      prompt = buildArchitectPrompt(ctx);
      break;
    case 'security':
      prompt = buildSecurityPrompt(ctx);
      break;
    case 'design-pattern':
    case 'pattern':
      prompt = buildPatternPrompt(ctx);
      break;
    case 'coder':
      prompt = buildCoderPrompt(ctx);
      break;
    case 'tester':
      prompt = buildTesterPrompt(ctx);
      break;
    case 'reviewer':
    case 'security-review':
      prompt = buildReviewerPrompt(ctx);
      break;
    case 'fix':
      prompt = buildFixPrompt(ctx);
      break;
    default:
      if (ctx.stage.mode === 'analysis') {
        prompt = buildAnalystPrompt(ctx);
      } else if (ctx.stage.read_only) {
        prompt = ctx.stage.outputs?.includes('plan.md') ? buildPlannerPrompt(ctx) : buildAnalystPrompt(ctx);
      } else {
        prompt = buildCoderPrompt(ctx);
      }
      break;
  }

  // Dynamic Skill, Rule & Workflow Injection via JIT EccKnowledgeAdapter
  const adapter = ctx.adapter || defaultEccAdapter;
  const eccSummary = adapter.getStageEccSummary(ctx.stage, ctx.stage.subagent);

  const eccBlocks: string[] = [];

  const effectiveAgent = ctx.stage.ecc_agent || eccSummary.agent?.name;
  if (effectiveAgent && effectiveAgent !== 'none') {
    const agentInstruction = adapter.getAgentInstructionSync(effectiveAgent);
    if (agentInstruction) eccBlocks.push(agentInstruction);
  }

  const skills = [...new Set([...(ctx.stage.skills || []), ...(ctx.stage.ecc_skills || [])])];
  if (skills.length > 0) {
    const skillGuideline = adapter.resolveStageSkillsSync(skills);
    if (skillGuideline) eccBlocks.push(skillGuideline);
  }

  const rules = ctx.stage.ecc_rules;
  if (rules && rules.length > 0) {
    const ruleGuideline = adapter.resolveStageRulesSync(rules);
    if (ruleGuideline) eccBlocks.push(ruleGuideline);
  }

  const workflows = ctx.stage.ecc_workflows;
  if (workflows && workflows.length > 0) {
    const workflowGuideline = adapter.resolveStageWorkflowsSync(workflows);
    if (workflowGuideline) eccBlocks.push(workflowGuideline);
  }

  if (eccBlocks.length > 0) {
    const combinedEcc = eccBlocks.join('\n\n');
    const completionMarker = 'WHEN FINISHED:';
    if (prompt.includes(completionMarker)) {
      prompt = prompt.replace(completionMarker, `${combinedEcc}\n\n${completionMarker}`);
    } else {
      prompt = `${prompt}\n\n${combinedEcc}`;
    }
  }

  const eccHeaderLines: string[] = [
    '================================================================================',
    '[ECC GOVERNANCE & METHODOLOGY CONTEXT]',
    `ECC Directory:      ${eccSummary.configuredPath ? `${eccSummary.configuredPath} (${eccSummary.source})` : 'Built-in offline methodologies'}`,
    `Stage Role/ID:      ${ctx.stage.id} (${ctx.stage.role})`,
    `Agent Persona:      ${eccSummary.agentPersona}`,
  ];
  if (eccSummary.agent) {
    eccHeaderLines.push(`Injected Agent:     ${eccSummary.agent.name} [${eccSummary.agent.source}]`);
  }
  if (eccSummary.skills.length > 0) {
    eccHeaderLines.push(`Injected Skills:    ${eccSummary.skills.map((s) => `${s.name} [${s.source}]`).join(', ')}`);
  }
  if (eccSummary.rules.length > 0) {
    eccHeaderLines.push(`Injected Rules:     ${eccSummary.rules.map((r) => `${r.name} [${r.source}]`).join(', ')}`);
  }
  if (eccSummary.workflows.length > 0) {
    eccHeaderLines.push(`Injected Workflows: ${eccSummary.workflows.map((w) => `${w.name} [${w.source}]`).join(', ')}`);
  }
  eccHeaderLines.push('================================================================================');

  return `${eccHeaderLines.join('\n')}\n\n${prompt}`;
}
