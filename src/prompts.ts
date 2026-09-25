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

export function buildWorkerCompletionSnippet(taskId: string, dispatchId: string, defaultSubject: string): string {
  return `
WHEN FINISHED:
You MUST notify the orchestrator by running this bash command with your terminal/bash execution tool (do NOT merely print this in your markdown response):
\`\`\`bash
orca orchestration send \\
  --type worker_done \\
  --subject "${defaultSubject}" \\
  --body "Completed stage work according to specification" \\
  --task-id "${taskId}" \\
  --dispatch-id "${dispatchId}" \\
  --outcome succeeded \\
  --json
\`\`\`

If you encountered an unrecoverable failure, report:
\`\`\`bash
orca orchestration send \\
  --type worker_done \\
  --subject "${defaultSubject} FAILED" \\
  --body "Explanation of the failure" \\
  --task-id "${taskId}" \\
  --dispatch-id "${dispatchId}" \\
  --outcome failed \\
  --json
\`\`\`
`;
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
If any check fails, revise plan.md before reporting done.
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
- Run the full relevant test suite
- Add automated unit or integration tests if coverage is missing
- Check edge cases and error handling

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

RUN:
- Build and test commands to verify independently

MUST PRODUCE:
${outputFile}

review.md MUST CONTAIN:
1. Summary of findings
2. Detailed code review comments (file by file)
3. Verdict on a single line at the very end:
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
- Run tests to ensure regressions are resolved
- Update ${outputFile} with fix details

MUST UPDATE:
${outputFile}
${buildWorkerCompletionSnippet(ctx.taskId, ctx.dispatchId, `Fix iteration ${ctx.fixIteration || 1} complete for ${ctx.pipelineId}`)}
`.trim();
}

export function buildPromptForStage(ctx: PromptContext): string {
  let prompt = '';
  switch (ctx.stage.role) {
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
      if (ctx.stage.mode === 'analysis' || ctx.stage.read_only) {
        prompt = buildPlannerPrompt(ctx);
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
