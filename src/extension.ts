import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { listPipelines, getPipelineDir, loadState } from './state';
import { loadConfig } from './config';
import { formatStatus } from './cli';

export function resolveRunnerBin(): string {
  const candidates = [
    path.resolve(__dirname, '..', 'bin', 'pipeline.ts'),
    path.resolve(__dirname, 'bin', 'pipeline.ts'),
    path.resolve(process.cwd(), 'bin', 'pipeline.ts'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

export const RUNNER_BIN_PATH = resolveRunnerBin();

export default function (pi: any): void {
  pi.registerCommand('pipeline', {
    description: 'Orchestrate multi-stage workflows with Orca native orchestration',
    getArgumentCompletions(argument: string) {
      const trimmed = argument.trim().toLowerCase();
      const subcommands = [
        { label: 'doctor', value: 'doctor', description: 'Run pipeline diagnostic health check' },
        { label: 'status', value: 'status', description: 'Show status of active or latest pipeline' },
        { label: 'list', value: 'list', description: 'List recent pipeline runs' },
        { label: 'stop', value: 'stop', description: 'Stop a running pipeline' },
        { label: 'logs', value: 'logs', description: 'Show artifacts and logs for pipeline' },
        { label: '--profile simple', value: '--profile simple', description: 'Run fast-path (implement -> test -> review)' },
        { label: '--profile standard', value: '--profile standard', description: 'Run standard (plan -> implement -> test -> review)' },
        { label: '--profile secure', value: '--profile secure', description: 'Run secure (plan -> 3 parallel specialists -> implement -> review)' },
        { label: '--profile full', value: '--profile full', description: 'Run full enterprise workflow' },
      ];

      if (!trimmed) return subcommands;
      return subcommands.filter((cmd) => cmd.label.startsWith(trimmed));
    },

    async handler(argStr: string, ctx: any) {
      const raw = argStr.trim();
      const cwd = ctx.cwd || process.cwd();
      const config = loadConfig(undefined, cwd);

      if (!raw) {
        // Show status of most recent pipeline
        const pipelines = listPipelines(config.artifacts.root, cwd);
        if (pipelines.length === 0) {
          ctx.ui?.notify?.('No active pipelines found. Run `/pipeline <objective>` to start one.', 'info');
          return;
        }
        const latest = pipelines[0];
        ctx.ui?.notify?.(`Pipeline: ${latest.id} [${latest.state.status}]`, 'info');
        if (typeof pi.sendUserMessage === 'function') {
          // Display formatted status
          pi.sendMessage?.({
            customType: 'pipeline-status',
            content: formatStatus(latest.state),
            display: true,
          });
        }
        return;
      }

      const parts = raw.split(/\s+/);
      const subcmd = parts[0].toLowerCase();

      if (subcmd === 'doctor') {
        const checks: string[] = [];
        try {
          const { execSync } = require('child_process');
          const orcaVer = execSync('orca --version', { encoding: 'utf8' }).trim();
          checks.push(`✔ Orca CLI: ${orcaVer}`);
        } catch {
          checks.push(`✗ Orca CLI: Not found in PATH (orca)`);
        }
        const cfg = loadConfig(undefined, cwd);
        checks.push(`✔ Config: profile=${cfg.defaults.profile}, agent=${cfg.defaults.agent}`);
        const { BUILTIN_PROFILES } = require('./profiles');
        checks.push(`✔ Profiles: ${Object.keys(BUILTIN_PROFILES).join(', ')}`);
        const bin = resolveRunnerBin();
        if (fs.existsSync(bin)) {
          checks.push(`✔ Runner Binary: ${bin}`);
        } else {
          checks.push(`✗ Runner Binary: Missing at ${bin}`);
        }
        const report = `Pipeline Doctor:\n${checks.join('\n')}`;
        ctx.ui?.notify?.(report, 'info');
        return;
      }

      if (subcmd === 'status') {
        const targetId = parts[1];
        const pipelines = listPipelines(config.artifacts.root, cwd);
        if (pipelines.length === 0) {
          ctx.ui?.notify?.('No pipelines found.', 'info');
          return;
        }
        const state = targetId
          ? loadState(getPipelineDir(targetId, config.artifacts.root, cwd))
          : pipelines[0].state;

        ctx.ui?.notify?.(`Pipeline ${state.id}: ${state.status.toUpperCase()}`, 'info');
        return;
      }

      if (subcmd === 'list') {
        const pipelines = listPipelines(config.artifacts.root, cwd);
        if (pipelines.length === 0) {
          ctx.ui?.notify?.('No pipelines found.', 'info');
          return;
        }
        const listText = pipelines
          .slice(0, 5)
          .map((p) => `• ${p.id} [${p.state.status.toUpperCase()}] - ${p.state.objective.slice(0, 50)}`)
          .join('\n');
        ctx.ui?.notify?.(`Recent Pipelines:\n${listText}`, 'info');
        return;
      }

      if (subcmd === 'stop') {
        const targetId = parts[1];
        if (!targetId) {
          ctx.ui?.notify?.('Specify pipeline ID: /pipeline stop <id>', 'error');
          return;
        }
        try {
          const dir = getPipelineDir(targetId, config.artifacts.root, cwd);
          const state = loadState(dir);
          state.status = 'aborted';
          fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state, null, 2), 'utf8');
          ctx.ui?.notify?.(`Pipeline ${targetId} stopped.`, 'info');
        } catch (e: any) {
          ctx.ui?.notify?.(`Failed to stop ${targetId}: ${e.message}`, 'error');
        }
        return;
      }

      // Starting a new pipeline
      let profile = config.defaults.profile;
      let objectiveParts: string[] = [];

      for (let i = 0; i < parts.length; i++) {
        if (parts[i] === '--profile' && i + 1 < parts.length) {
          profile = parts[++i];
        } else {
          objectiveParts.push(parts[i]);
        }
      }

      const objective = objectiveParts.join(' ').trim();
      if (!objective) {
        ctx.ui?.notify?.('Please provide an objective: /pipeline <objective>', 'warning');
        return;
      }

      ctx.ui?.notify?.(`Starting Pipeline [${profile}]: "${objective}"`, 'info');

      // Spawn runner detached so OMP TUI remains fully interactive and responsive
      const outLog = path.join(cwd, '.omp', 'pipeline-runner.log');
      fs.mkdirSync(path.dirname(outLog), { recursive: true });
      const outFd = fs.openSync(outLog, 'a');

      const runnerProcess = spawn(
        'bun',
        ['run', RUNNER_BIN_PATH, 'start', '--profile', profile, objective],
        {
          cwd,
          detached: true,
          stdio: ['ignore', outFd, outFd],
          env: process.env,
        }
      );

      runnerProcess.unref();

      ctx.ui?.notify?.(`Pipeline runner launched in background. Check \`/pipeline status\` or \`.omp/pipelines/\``, 'info');
    },
  });
}
