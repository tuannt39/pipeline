import path from 'path';
import fs from 'fs';
import { findConfigFile, hasCommand, detectDefaultAgent, loadConfig, initConfiguration } from './config';
import { PipelineController } from './controller';
import { getPipelineDir, listPipelines, loadState, saveState } from './state';
import { PipelineState } from './types';

export function formatStatus(state: PipelineState): string {
  const lines: string[] = [];
  lines.push(`Pipeline:  ${state.id}`);
  lines.push(`Objective: ${state.objective}`);
  lines.push(`Profile:   ${state.profile}`);
  lines.push(`Status:    ${state.status.toUpperCase()}`);
  lines.push(`Workspace: ${state.workspace.mode} (${state.workspace.path})`);
  lines.push(`Fix Loops: ${state.fixLoops}`);
  lines.push(``);
  lines.push(`Stages:`);

  for (const [id, stage] of Object.entries(state.stages)) {
    let icon = '○';
    let statusLabel = stage.status;
    if (stage.status === 'completed') icon = '✓';
    else if (stage.status === 'running') icon = '●';
    else if (stage.status === 'failed') icon = '✗';
    else if (stage.status === 'skipped') icon = '-';

    let extra = '';
    if (stage.error) extra = ` (Error: ${stage.error})`;
    else if (stage.notes) extra = ` (${stage.notes})`;
    else if (stage.retries && stage.retries > 0) extra = ` (Retries: ${stage.retries})`;

    lines.push(`  ${icon} ${id.padEnd(16)} [${statusLabel}]${extra}`);
  }

  return lines.join('\n');
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const command = argv[0];

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    printHelp();
    return;
  }

  const cwd = process.cwd();
  const config = loadConfig(undefined, cwd);

  switch (command) {
    case 'doctor': {
      const activeAgent = detectDefaultAgent();
      const hasOrca = hasCommand(config.orca.command);
      const hasAgy = hasCommand('agy');
      const hasOmp = hasCommand('omp');

      console.log('Pipeline Orchestrator Doctor:');
      console.log('------------------------------------------------------------');
      console.log(`Orca CLI (${config.orca.command}):      ${hasOrca ? '✓ Found' : '✗ Not found (orca CLI needed for task orchestration)'}`);
      console.log(`Antigravity CLI (agy): ${hasAgy ? '✓ Found' : '○ Not installed'}`);
      console.log(`Oh-My-Pi CLI (omp):    ${hasOmp ? '✓ Found' : '○ Not installed'}`);
      console.log(`Active Harness Agent:  ${activeAgent.toUpperCase()} (configured default: ${config.defaults.agent})`);
      console.log(`Config File:           ${findConfigFile(undefined, cwd) || 'Using defaults'}`);
      console.log(`Artifacts Root:        ${config.artifacts.root}`);
      break;
    }
    case 'init': {
      let targetEnv: 'gemini' | 'omp' | undefined;
      let force = false;

      for (let i = 1; i < argv.length; i++) {
        if (argv[i] === '--force' || argv[i] === '-f') {
          force = true;
        } else if (argv[i] === '--gemini' || argv[i] === '--agy') {
          targetEnv = 'gemini';
        } else if (argv[i] === '--omp') {
          targetEnv = 'omp';
        }
      }

      const res = initConfiguration({ targetEnv, force, linkBin: true });
      console.log('Pipeline Initialized:');
      console.log('------------------------------------------------------------');
      console.log(`Config file:  ${res.configPath} (${res.created ? 'created' : 'already exists'})`);
      if (res.linkedBin) {
        console.log(`CLI launcher: ${res.linkedBin}`);
      }
      console.log(`To customize settings, edit ${res.configPath}`);
      break;
    }
    case 'start': {
      let profileName = config.defaults.profile;
      let worktree = config.workspace.default;
      const objectiveParts: string[] = [];

      for (let i = 1; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--profile' && i + 1 < argv.length) {
          profileName = argv[++i];
        } else if (arg === '--worktree' && i + 1 < argv.length) {
          worktree = argv[++i] as any;
        } else {
          objectiveParts.push(arg);
        }
      }

      const objective = objectiveParts.join(' ').trim();
      if (!objective) {
        console.error('Error: Objective is required. Usage: pipeline start [--profile <profile>] <objective>');
        process.exit(1);
      }

      console.log(`Starting pipeline with profile "${profileName}"...`);
      const controller = new PipelineController({ config, cwd });
      const finalState = await controller.runPipeline({
        objective,
        profileName,
        worktree,
        onUpdate: (st) => {
          // Render progress
          process.stdout.write(`\r[${st.status}] Updated stage states...`);
        },
      });

      console.log('\n\n' + formatStatus(finalState));
      break;
    }

    case 'status': {
      const targetId = argv[1];
      const pipelines = listPipelines(config.artifacts.root, cwd);

      if (pipelines.length === 0) {
        console.log('No pipelines found.');
        return;
      }

      let state: PipelineState;
      if (targetId) {
        const dir = getPipelineDir(targetId, config.artifacts.root, cwd);
        state = loadState(dir);
      } else {
        state = pipelines[0].state;
      }

      console.log(formatStatus(state));
      break;
    }

    case 'list': {
      const pipelines = listPipelines(config.artifacts.root, cwd);
      if (pipelines.length === 0) {
        console.log('No pipeline runs found.');
        return;
      }

      console.log('Recent Pipelines:');
      console.log('------------------------------------------------------------');
      for (const p of pipelines) {
        const date = new Date(p.state.createdAt).toLocaleString();
        console.log(`${p.id.padEnd(30)} [${p.state.status.toUpperCase().padEnd(9)}] ${p.state.profile.padEnd(10)} ${date}`);
        console.log(`  Objective: ${p.state.objective}`);
      }
      break;
    }

    case 'stop': {
      const targetId = argv[1];
      if (!targetId) {
        console.error('Error: Pipeline ID is required. Usage: pipeline stop <id>');
        process.exit(1);
      }

      const dir = getPipelineDir(targetId, config.artifacts.root, cwd);
      const state = loadState(dir);
      state.status = 'aborted';
      saveState(dir, state);
      console.log(`Pipeline ${targetId} marked as aborted.`);
      break;
    }

    case 'logs': {
      const targetId = argv[1];
      if (!targetId) {
        console.error('Error: Pipeline ID is required. Usage: pipeline logs <id>');
        process.exit(1);
      }

      const dir = getPipelineDir(targetId, config.artifacts.root, cwd);
      console.log(`Artifacts in ${dir}:`);
      const files = fs.readdirSync(dir);
      for (const file of files) {
        console.log(`- ${file}`);
      }
      break;
    }

    case 'resume': {
      const targetId = argv[1];
      const pipelines = listPipelines(config.artifacts.root, cwd);

      if (pipelines.length === 0) {
        console.log('No pipelines found to resume.');
        return;
      }

      let pipelineId = targetId;
      if (!pipelineId) {
        // Pick the latest incomplete or running pipeline
        const candidate = pipelines.find((p) => p.state.status !== 'completed' && p.state.status !== 'aborted');
        pipelineId = candidate ? candidate.id : pipelines[0].id;
      }

      console.log(`Resuming pipeline ${pipelineId}...`);
      const controller = new PipelineController({ config, cwd });
      const finalState = await controller.resumePipeline(pipelineId, (st) => {
        process.stdout.write(`\r[${st.status}] Resuming stages...`);
      });

      console.log('\n\n' + formatStatus(finalState));
      break;
    }

    default: {
      // If first argument is not a known subcommand, treat all args as an objective
      const objective = argv.join(' ').trim();
      console.log(`Starting pipeline with default profile "${config.defaults.profile}"...`);
      const controller = new PipelineController({ config, cwd });
      const finalState = await controller.runPipeline({
        objective,
        profileName: config.defaults.profile,
        worktree: config.workspace.default,
      });
      console.log('\n' + formatStatus(finalState));
      break;
    }
  }
}

function printHelp(): void {
  console.log(`
Pipeline Orchestrator (Antigravity & OMP, powered by Orca native orchestration)

USAGE:
  pipeline init [--gemini|--omp] [--force]
  pipeline doctor
  pipeline start [--profile <profile>] [--worktree <worktree>] <objective>
  pipeline resume [<id>]
  pipeline status [<id>]
  pipeline list
  pipeline stop <id>
  pipeline logs <id>
  pipeline <objective>

PROFILES:
  simple     Fast path: implement -> test -> review
  standard   Default: plan -> implement -> test -> review (with review fix loop)
  secure     Parallel: plan -> [architect, security, pattern] -> implement -> test -> review -> final-security
  full       Complete: spec -> [architect, security, pattern] -> plan -> implement -> test -> security-2 -> review
`);
}
