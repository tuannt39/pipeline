import path from 'path';
import fs from 'fs';
import { findConfigFile, hasCommand, isRealOrcaCli, detectDefaultAgent, normalizeAgent, loadConfig, initConfiguration } from './config';
import { defaultEccAdapter, configureDefaultEccAdapter } from './ecc-adapter';
import { loadProfile } from './profiles';
import { PipelineController } from './controller';
import { getPipelineDir, listPipelines, loadState, saveState, updateStageState } from './state';
import { PipelineState } from './types';

export function formatStatus(state: PipelineState): string {
  const lines: string[] = [];
  lines.push(`Pipeline:  ${state.id}`);
  lines.push(`Objective: ${state.objective}`);
  lines.push(`Profile:   ${state.profile}`);

  const eccStatus = defaultEccAdapter.getEccStatusSummary();
  const eccLabel = eccStatus.configured && eccStatus.valid
    ? `${eccStatus.path} (external: ${eccStatus.skillsCount} skills, ${eccStatus.rulesCount} rules, ${eccStatus.workflowsCount} workflows)`
    : eccStatus.configured
    ? `${eccStatus.path} (inaccessible - fallback to built-in)`
    : `Built-in offline methodologies (${eccStatus.skillsCount} core skills, 7 specialist personas)`;
  lines.push(`ECC:       ${eccLabel}`);

  if (state.status === 'waiting_approval') {
    lines.push(`Status:    WAITING_APPROVAL ⏸️ (Awaiting user plan approval)`);
    lines.push(`Notice:    Run 'pipeline approve ${state.id}' to continue implementation.`);
  } else {
    lines.push(`Status:    ${state.status.toUpperCase()}`);
  }
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
  configureDefaultEccAdapter({ eccPath: config.ecc?.path });

  switch (command) {
    case 'doctor': {
      const activeAgent = detectDefaultAgent();
      const isRealOrca = isRealOrcaCli(config.orca.command);
      const hasAgy = hasCommand('agy');
      const hasOmp = hasCommand('omp');

      console.log('Pipeline Orchestrator Doctor:');
      console.log('------------------------------------------------------------');
      const orcaStatusLabel = isRealOrca
        ? '✓ Found (Orca Native Orchestrator)'
        : hasCommand(config.orca.command)
        ? '○ GNOME Screen Reader detected (Falling back to Direct Standalone Runner)'
        : '○ Not installed (Using Direct Standalone Runner)';
      console.log(`Orca CLI (${config.orca.command}):      ${orcaStatusLabel}`);
      console.log(`Antigravity CLI (agy): ${hasAgy ? '✓ Found' : '○ Not installed'}`);
      console.log(`Oh-My-Pi CLI (omp):    ${hasOmp ? '✓ Found' : '○ Not installed'}`);
      console.log(`Active Harness Agent:  ${activeAgent.toUpperCase()} (configured default: ${config.defaults.agent})`);
      console.log(`Artifacts Root:        ${config.artifacts.root}`);

      const eccStatus = defaultEccAdapter.getEccStatusSummary();
      if (eccStatus.configured) {
        if (eccStatus.valid) {
          console.log(`ECC Knowledge Path:    ${eccStatus.path} (✓ Accessible - external JIT enabled)`);
          console.log(`  ├─ Discovered Skills:    ${eccStatus.skillsCount}`);
          console.log(`  ├─ Discovered Rules:     ${eccStatus.rulesCount}`);
          console.log(`  ├─ Discovered Workflows: ${eccStatus.workflowsCount}`);
          console.log(`  └─ Discovered Prompts:   ${eccStatus.promptsCount}`);
        } else {
          console.log(`ECC Knowledge Path:    ${eccStatus.path} (✗ Directory not found, falling back to built-in)`);
        }
      } else {
        console.log(`ECC Knowledge Path:    Not configured (Using built-in offline methodologies: ${eccStatus.skillsCount} core skills, 7 specialist personas)`);
      }
      break;
    }
    case 'init': {
      let targetAgent: string | undefined;
      let force = false;
      let local = false;

      for (let i = 1; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--force' || arg === '-f') {
          force = true;
        } else if (arg === '--local' || arg === '-l') {
          local = true;
        } else if (arg === '--gemini' || arg === '--agy' || arg === '--antigravity') {
          targetAgent = 'agy';
        } else if (arg === '--omp' || arg === '--pi') {
          targetAgent = 'omp';
        } else if ((arg === '--agent' || arg === '-a') && i + 1 < argv.length) {
          targetAgent = argv[++i];
        }
      }

      const res = initConfiguration({ targetAgent, force, local, linkBin: true, cwd });
      console.log('Pipeline Initialized:');
      console.log('------------------------------------------------------------');
      console.log(`Default Agent: ${res.agent.toUpperCase()} (${res.agent === 'agy' ? 'Antigravity' : 'Oh-My-Pi'})`);
      console.log(`Config file:   ${res.configPath} (${res.created ? 'created' : 'already exists'})`);
      if (res.linkedBin) {
        console.log(`CLI launcher:  ${res.linkedBin}`);
      }
      console.log(`To customize settings, edit ${res.configPath}`);
      break;
    }
    case 'create':
    case 'new': {
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
        console.error('Error: Objective is required. Usage: pipeline create [--profile <profile>] <objective>');
        process.exit(1);
      }

      const controller = new PipelineController({ config, cwd });
      const { id, dir, state, profile } = await controller.createPipeline({
        objective,
        profileName,
        worktree,
      });

      console.log(`Pipeline created successfully:`);
      console.log(`  ID:        ${id}`);
      console.log(`  Profile:   ${profile.name}`);
      console.log(`  Objective: ${state.objective}`);
      console.log(`  Directory: ${dir}`);
      console.log(`\nRun 'pipeline status ${id}' to inspect progress.`);
      break;
    }
    case 'stage':
    case 'set-stage': {
      const targetId = argv[1];
      const stageId = argv[2];
      const stageStatus = argv[3] as any;
      let notes: string | undefined;
      let error: string | undefined;

      for (let i = 4; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--notes' && i + 1 < argv.length) {
          notes = argv[++i];
        } else if (arg === '--error' && i + 1 < argv.length) {
          error = argv[++i];
        }
      }

      if (!targetId || !stageId || !stageStatus) {
        console.error('Usage: pipeline stage <pipeline-id> <stage-id> <pending|running|completed|failed|skipped> [--notes <notes>] [--error <error>]');
        process.exit(1);
      }

      const pipelineDir = getPipelineDir(targetId, config.artifacts.root, cwd);
      const state = loadState(pipelineDir);

      const updateData: any = { status: stageStatus };
      if (stageStatus === 'running') updateData.startTime = new Date().toISOString();
      if (stageStatus === 'completed' || stageStatus === 'failed') updateData.endTime = new Date().toISOString();
      if (notes) updateData.notes = notes;
      if (error) updateData.error = error;

      updateStageState(state, stageId, updateData);
      saveState(pipelineDir, state);
      console.log(`Stage "${stageId}" in pipeline "${targetId}" updated to "${stageStatus}".`);
      break;
    }
    case 'start': {
      let profileName = config.defaults.profile;
      let worktree = config.workspace.default;
      let agentOverride: string | undefined;
      const objectiveParts: string[] = [];

      for (let i = 1; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--profile' && i + 1 < argv.length) {
          profileName = argv[++i];
        } else if (arg === '--worktree' && i + 1 < argv.length) {
          worktree = argv[++i] as any;
        } else if ((arg === '--agent' || arg === '-a') && i + 1 < argv.length) {
          agentOverride = argv[++i];
        } else if (arg === '--agy' || arg === '--antigravity') {
          agentOverride = 'agy';
        } else if (arg === '--omp') {
          agentOverride = 'omp';
        } else {
          objectiveParts.push(arg);
        }
      }

      if (agentOverride) {
        config.defaults.agent = normalizeAgent(agentOverride);
      }

      const objective = objectiveParts.join(' ').trim();
      if (!objective) {
        console.error('Error: Objective is required. Usage: pipeline start [--profile <profile>] [--agent <agent>] <objective>');
        process.exit(1);
      }

      console.log(`Starting pipeline with profile "${profileName}" on agent "${config.defaults.agent.toUpperCase()}"...`);
      const eccStatus = defaultEccAdapter.getEccStatusSummary();
      const eccInfo = eccStatus.configured && eccStatus.valid
        ? `${eccStatus.path} (external: ${eccStatus.skillsCount} skills, ${eccStatus.rulesCount} rules, ${eccStatus.workflowsCount} workflows)`
        : 'Built-in offline methodologies (8 core skills, 7 specialist personas)';
      console.log(`[ECC Active] ${eccInfo}`);

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

    case 'approve': {
      const targetId = argv[1];
      const pipelines = listPipelines(config.artifacts.root, cwd);

      if (pipelines.length === 0) {
        console.error('Error: No pipelines found to approve.');
        process.exit(1);
      }

      let pipelineId = targetId;
      if (!pipelineId || pipelineId.startsWith('-')) {
        const candidate = pipelines.find((p) => p.state.status === 'waiting_approval');
        pipelineId = candidate ? candidate.id : pipelines[0].id;
      }

      const controller = new PipelineController({ config, cwd });
      const pipelineDir = getPipelineDir(pipelineId, config.artifacts.root, cwd);
      const updatedState = controller.approvePlan(pipelineDir, 'user');

      console.log(`Plan approved for pipeline "${pipelineId}".`);
      console.log(`Status is now: ${updatedState.status.toUpperCase()}`);

      const shouldResume = argv.includes('--resume') || argv.includes('-r');
      if (shouldResume) {
        console.log(`Resuming pipeline ${pipelineId}...`);
        const finalState = await controller.resumePipeline(pipelineId, (st) => {
          process.stdout.write(`\r[${st.status}] Resuming stages...`);
        });
        console.log('\n\n' + formatStatus(finalState));
      } else {
        console.log(`To continue execution, background runner will automatically advance, or run: pipeline resume ${pipelineId}`);
      }
      break;
    }

    case 'revise': {
      const targetId = argv[1];
      const feedbackParts: string[] = [];

      for (let i = 2; i < argv.length; i++) {
        feedbackParts.push(argv[i]);
      }

      const feedback = feedbackParts.join(' ').trim();
      if (!targetId || !feedback) {
        console.error('Usage: pipeline revise <pipeline-id> <feedback>');
        console.error('Example: pipeline revise pipe-abc123 "Add more detail on database migration"');
        process.exit(1);
      }

      const controller = new PipelineController({ config, cwd });
      const updatedState = controller.requestPlanRevision(targetId, feedback);

      console.log(`Plan revision requested for pipeline "${targetId}".`);
      console.log(`Status is now: ${updatedState.status.toUpperCase()}`);
      console.log(`To re-run the pipeline, use: pipeline resume ${targetId}`);
      break;
    }

    case 'watch': {
      let targetId: string | undefined;
      let intervalSec = 180; // 3 minutes default

      for (let i = 1; i < argv.length; i++) {
        if (argv[i] === '--interval' && i + 1 < argv.length) {
          intervalSec = parseInt(argv[++i], 10) || 180;
        } else if (!targetId) {
          targetId = argv[i];
        }
      }

      const pipelines = listPipelines(config.artifacts.root, cwd);
      if (pipelines.length === 0) {
        console.log('No pipelines found.');
        return;
      }

      const pipelineId = targetId || pipelines[0].id;
      const pipelineDir = getPipelineDir(pipelineId, config.artifacts.root, cwd);
      console.log(`Watching pipeline ${pipelineId} (interval: ${intervalSec}s, Ctrl+C to stop)...\n`);

      const controller = new PipelineController({ config, cwd });
      const render = () => {
        try {
          const st = loadState(pipelineDir);
          const prof = loadProfile(st.profile, config, cwd);
          controller.printPeriodicStatusBanner(st, prof);
        } catch (err: any) {
          console.error(`Failed to read pipeline status:`, err.message);
        }
      };

      render();
      const timer = setInterval(render, intervalSec * 1000);
      process.on('SIGINT', () => {
        clearInterval(timer);
        process.exit(0);
      });
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
  pipeline init [--agy|--antigravity|--omp|--agent <agent>] [--local] [--force]
  pipeline doctor
  pipeline create [--profile <profile>] [--worktree <worktree>] <objective>
  pipeline start [--profile <profile>] [--agent <agy|omp>] [--worktree <worktree>] <objective>
  pipeline stage <id> <stage-id> <status> [--notes <notes>] [--error <error>]
  pipeline approve [<id>] [--resume]
  pipeline revise <id> <feedback>
  pipeline resume [<id>]
  pipeline watch [<id>] [--interval <sec>]
  pipeline status [<id>]
  pipeline list
  pipeline stop <id>
  pipeline logs <id>
  pipeline <objective>

PROFILES:
  ecc        Default: 20-stage ECC engineering lifecycle with 360° master plan & plan approval gate
  full       Enterprise: spec -> [architect, security, pattern] -> plan -> implement -> test -> review
  standard   Production: plan -> implement -> test -> review (with review fix loop)
  secure     Parallel: plan -> [architect, security, pattern] -> implement -> test -> review -> final-security
  simple     Fast path: plan -> implement -> test -> review
`);
}
