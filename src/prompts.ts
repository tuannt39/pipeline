import path from 'path';
import { StageDefinition } from './types';

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
  return `
ROLE:
You are the planning agent.

PIPELINE: ${ctx.pipelineId}
OBJECTIVE: ${ctx.objective}
WORKSPACE: ${ctx.workspace}

READ:
- Entire repository structure and code files relevant to the objective
- Current git state and branch history

DO NOT:
- modify application source code
- commit changes
- create git worktree

MUST PRODUCE:
${planFile}

plan.md MUST CONTAIN:
1. Current architecture analysis
2. Relevant files to touch
3. Proposed changes step-by-step
4. Dependencies & library requirements
5. Risks & mitigations
6. Test strategy
7. Acceptance criteria

PLAN APPROVAL GATE:
Upon completing plan.md, the orchestrator triggers a mandatory approval gate (⏸️ Awaiting Plan approval). The user reviews and must approve this plan before implementation can start. Ensure your plan is clear, comprehensive, and unambiguous.
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
  switch (ctx.stage.role) {
    case 'planner':
      return buildPlannerPrompt(ctx);
    case 'architect':
      return buildArchitectPrompt(ctx);
    case 'security':
      return buildSecurityPrompt(ctx);
    case 'design-pattern':
    case 'pattern':
      return buildPatternPrompt(ctx);
    case 'coder':
      return buildCoderPrompt(ctx);
    case 'tester':
      return buildTesterPrompt(ctx);
    case 'reviewer':
    case 'security-review':
      return buildReviewerPrompt(ctx);
    case 'fix':
      return buildFixPrompt(ctx);
    default:
      if (ctx.stage.mode === 'analysis' || ctx.stage.read_only) {
        return buildPlannerPrompt(ctx);
      }
      return buildCoderPrompt(ctx);
  }
}
