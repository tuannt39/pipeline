import { StageDefinition } from './types';

export const ROLE_TO_AGY_SUBAGENT: Record<string, string> = {
  planner: 'workflow-orchestrator',
  plan: 'workflow-orchestrator',
  analyst: 'technical-writer',
  'spec-writer': 'technical-writer',
  spec: 'technical-writer',
  architect: 'architect-reviewer',
  architecture: 'architect-reviewer',
  security: 'security-auditor',
  'security-review': 'security-auditor',
  pattern: 'architect-reviewer',
  'design-pattern': 'architect-reviewer',
  tester: 'test-automator',
  qa: 'test-automator',
  verifier: 'test-automator',
  reviewer: 'code-reviewer',
  review: 'code-reviewer',
  coder: 'fullstack-developer',
  fixer: 'fullstack-developer',
  developer: 'fullstack-developer',
};

export function isImplementationStage(stage: StageDefinition): boolean {
  const role = stage.role?.toLowerCase() || '';
  const id = stage.id?.toLowerCase() || '';
  return (
    stage.mode === 'goal' ||
    role === 'coder' ||
    role === 'fixer' ||
    role === 'developer' ||
    id === 'implement' ||
    id === 'fix'
  );
}

export function resolveWorkerCommand(
  stage: StageDefinition,
  defaultAgent: string = 'agy',
  taskFile?: string,
  headless: boolean = false
): string {
  const isImpl = isImplementationStage(stage);
  const slashCommand = isImpl ? '/goal' : '/plan';
  const promptFlag = headless ? '-p' : '-i';

  // If stage.agent already contains custom invocation/flags
  if (stage.agent && stage.agent.includes(' ')) {
    let cmd = stage.agent;
    if (cmd.startsWith('agy') && !cmd.includes('--dangerously-skip-permissions')) {
      cmd = `${cmd} --dangerously-skip-permissions`;
    }
    if (taskFile && cmd.startsWith('agy') && !cmd.includes('-i') && !cmd.includes('-p') && !cmd.includes('--prompt')) {
      cmd = `${cmd} ${promptFlag} "${slashCommand} Execute task specifications in ${taskFile}"`;
    }
    return cmd;
  }

  const parts: string[] = ['agy'];
  const subagent = stage.subagent || ROLE_TO_AGY_SUBAGENT[stage.role];
  if (subagent) {
    parts.push('--agent', subagent);
  }
  if (stage.model) {
    parts.push('--model', stage.model);
  }

  // Set mode for agy: accept-edits for implementer, plan for other analytical/review stages
  const hasExplicitModeFlag = stage.flags && stage.flags.includes('--mode');
  if (!hasExplicitModeFlag) {
    const modeValue = isImpl ? 'accept-edits' : 'plan';
    parts.push('--mode', modeValue);
  }

  if (stage.flags && stage.flags.length > 0) {
    parts.push(...stage.flags);
  }
  if (!parts.includes('--dangerously-skip-permissions')) {
    parts.push('--dangerously-skip-permissions');
  }
  if (taskFile) {
    parts.push(promptFlag, `"${slashCommand} Execute task specifications in ${taskFile}"`);
  }
  return parts.join(' ');
}
