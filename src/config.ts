import fs from 'fs';
import path from 'path';
import os from 'os';
import yaml from 'yaml';
import { execSync } from 'child_process';
import { PipelineConfig } from './types';

export function hasCommand(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function detectDefaultAgent(): 'agy' | 'omp' {
  if (process.env.ANTIGRAVITY_AGENT === '1') return 'agy';
  if (process.env.OMP_WORKTREE_DIR) return 'omp';
  if (hasCommand('agy')) return 'agy';
  if (hasCommand('omp')) return 'omp';
  return 'agy';
}

export const DEFAULT_CONFIG: PipelineConfig = {
  version: 1,
  orca: {
    command: 'orca',
  },
  workspace: {
    default: 'active',
    create_worktree_only_when_requested: true,
  },
  defaults: {
    profile: 'standard',
    agent: 'auto',
    timeout_ms: 3600000,
    max_retries: 2,
  },
  artifacts: {
    root: '.omp/pipelines',
  },
  policies: {
    require_plan_before_implementation: true,
    require_review_before_success: true,
    require_tests_before_merge: true,
    max_fix_loops: 3,
    max_stage_retries: 2,
    max_pipeline_retries: 1,
  },
  profiles: {
    simple: 'profiles/simple.yml',
    standard: 'profiles/standard.yml',
    secure: 'profiles/secure.yml',
    full: 'profiles/full.yml',
  },
};

export function resolveHome(filepath: string): string {
  if (filepath.startsWith('~/') || filepath === '~') {
    return path.join(os.homedir(), filepath.slice(1));
  }
  return filepath;
}

export function findConfigFile(customPath?: string, cwd: string = process.cwd()): string | null {
  if (customPath) {
    const resolved = path.resolve(cwd, resolveHome(customPath));
    return fs.existsSync(resolved) ? resolved : null;
  }

  const candidates = [
    path.join(cwd, '.pipeline', 'config.yml'),
    path.join(cwd, '.pipeline', 'config.yaml'),
    path.join(cwd, '.agents', 'pipeline', 'config.yml'),
    path.join(cwd, '.omp', 'pipeline', 'config.yml'),
    path.join(cwd, '.omp', 'pipeline', 'config.yaml'),
    path.join(os.homedir(), '.gemini', 'config', 'pipeline', 'config.yml'),
    path.join(os.homedir(), '.gemini', 'config', 'pipeline', 'config.yaml'),
    path.join(os.homedir(), '.omp', 'pipeline', 'config.yml'),
    path.join(os.homedir(), '.omp', 'pipeline', 'config.yaml'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

export function loadConfig(customPath?: string, cwd: string = process.cwd()): PipelineConfig {
  const configFile = findConfigFile(customPath, cwd);
  if (!configFile) {
    return structuredClone(DEFAULT_CONFIG);
  }

  try {
    const content = fs.readFileSync(configFile, 'utf8');
    const parsed = yaml.parse(content) as Partial<PipelineConfig>;

    return {
      version: parsed.version ?? DEFAULT_CONFIG.version,
      orca: {
        ...DEFAULT_CONFIG.orca,
        ...(parsed.orca || {}),
      },
      workspace: {
        ...DEFAULT_CONFIG.workspace,
        ...(parsed.workspace || {}),
      },
      defaults: {
        ...DEFAULT_CONFIG.defaults,
        ...(parsed.defaults || {}),
      },
      artifacts: {
        ...DEFAULT_CONFIG.artifacts,
        ...(parsed.artifacts || {}),
      },
      policies: {
        ...DEFAULT_CONFIG.policies,
        ...(parsed.policies || {}),
      },
      profiles: {
        ...DEFAULT_CONFIG.profiles,
        ...(parsed.profiles || {}),
      },
    };
  } catch (err) {
    console.warn(`[pipeline-config] Failed to load config from ${configFile}, using defaults:`, err);
    return structuredClone(DEFAULT_CONFIG);
  }
}
