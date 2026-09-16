import fs from 'fs';
import path from 'path';
import os from 'os';
import yaml from 'yaml';
import { execSync } from 'child_process';
import { PipelineConfig } from './types';
import { PipelineConfigSchema, safeValidatePipelineConfig } from './schemas';
export { validatePipelineConfig, safeValidatePipelineConfig } from './schemas';

export function hasCommand(cmd: string): boolean {
  try {
    const checkCmd = process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`;
    execSync(checkCmd, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function normalizeAgent(agent?: string): 'agy' | 'omp' {
  if (!agent) return 'agy';
  const clean = agent.trim().toLowerCase();
  if (clean === 'agy' || clean === 'antigravity' || clean === 'gemini') {
    return 'agy';
  }
  if (clean === 'omp' || clean === 'pi' || clean === 'oh-my-pi') {
    return 'omp';
  }
  return clean === 'omp' ? 'omp' : 'agy';
}

export function detectDefaultAgent(): 'agy' | 'omp' {
  const envAgent = process.env.PIPELINE_AGENT || process.env.AGENT;
  if (envAgent) return normalizeAgent(envAgent);
  if (process.env.ANTIGRAVITY_AGENT === '1') return 'agy';
  if (process.env.OMP_WORKTREE_DIR) return 'omp';
  if (hasCommand('agy')) return 'agy';
  if (hasCommand('omp')) return 'omp';
  return 'agy';
}

export const PACKAGE_ROOT = path.resolve(__dirname, '..');

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
    profile: 'ecc',
    agent: 'auto',
    timeout_ms: 3600000,
    max_retries: 2,
    status_interval_ms: 180000,
  },
  artifacts: {
    root: '.pipeline',
  },
  policies: {
    require_plan_before_implementation: true,
    require_plan_approval: true,
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
    ecc: 'profiles/ecc.yml',
  },
  ecc: {
    path: process.env.ECC_DIR || process.env.ECC_PATH || '',
    auto_sync: false,
    cache_ttl_ms: 60000,
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

  const isAgy = detectDefaultAgent() === 'agy';

  const agyCandidates = [
    path.join(cwd, '.pipeline', 'config.yml'),
    path.join(cwd, '.pipeline', 'config.yaml'),
    path.join(os.homedir(), '.pipeline', 'config.yml'),
    path.join(os.homedir(), '.pipeline', 'config.yaml'),
    path.join(cwd, '.agents', 'pipeline', 'config.yml'),
    path.join(os.homedir(), '.gemini', 'config', 'pipeline', 'config.yml'),
    path.join(os.homedir(), '.gemini', 'config', 'pipeline', 'config.yaml'),
    path.join(os.homedir(), '.gemini', 'pipeline', 'config.yml'),
    path.join(os.homedir(), '.gemini', 'pipeline', 'config.yaml'),
    path.join(cwd, '.omp', 'pipeline', 'config.yml'),
    path.join(cwd, '.omp', 'pipeline', 'config.yaml'),
    path.join(os.homedir(), '.omp', 'pipeline', 'config.yml'),
    path.join(os.homedir(), '.omp', 'pipeline', 'config.yaml'),
  ];

  const ompCandidates = [
    path.join(cwd, '.pipeline', 'config.yml'),
    path.join(cwd, '.pipeline', 'config.yaml'),
    path.join(os.homedir(), '.pipeline', 'config.yml'),
    path.join(os.homedir(), '.pipeline', 'config.yaml'),
    path.join(cwd, '.omp', 'pipeline', 'config.yml'),
    path.join(cwd, '.omp', 'pipeline', 'config.yaml'),
    path.join(os.homedir(), '.omp', 'pipeline', 'config.yml'),
    path.join(os.homedir(), '.omp', 'pipeline', 'config.yaml'),
    path.join(cwd, '.agents', 'pipeline', 'config.yml'),
    path.join(os.homedir(), '.gemini', 'config', 'pipeline', 'config.yml'),
    path.join(os.homedir(), '.gemini', 'config', 'pipeline', 'config.yaml'),
  ];

  const candidates = isAgy ? agyCandidates : ompCandidates;

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

export interface InitConfigOptions {
  targetAgent?: string;
  targetEnv?: 'gemini' | 'omp';
  force?: boolean;
  linkBin?: boolean;
  local?: boolean;
  cwd?: string;
  eccPath?: string;
}

export function initConfiguration(options?: InitConfigOptions): {
  configPath: string;
  created: boolean;
  linkedBin?: string;
  agent: 'agy' | 'omp';
} {
  let resolvedAgent: 'agy' | 'omp';
  if (options?.targetAgent) {
    resolvedAgent = normalizeAgent(options.targetAgent);
  } else if (options?.targetEnv) {
    resolvedAgent = options.targetEnv === 'omp' ? 'omp' : 'agy';
  } else {
    resolvedAgent = detectDefaultAgent();
  }

  const isAgy = resolvedAgent === 'agy';
  const cwd = options?.cwd || process.cwd();

  const baseDir = options?.local
    ? path.join(cwd, '.pipeline')
    : isAgy
    ? path.join(os.homedir(), '.gemini', 'config', 'pipeline')
    : path.join(os.homedir(), '.omp', 'pipeline');

  const configPath = path.join(baseDir, 'config.yml');
  const profilesDir = path.join(baseDir, 'profiles');

  const created = !fs.existsSync(configPath) || options?.force === true;

  if (created) {
    fs.mkdirSync(profilesDir, { recursive: true });

    const artifactsRoot = '.pipeline';
    const eccDir = options?.eccPath || process.env.ECC_DIR || process.env.ECC_PATH || '';

    const configYaml = `version: 1

orca:
  command: orca

workspace:
  default: active
  create_worktree_only_when_requested: true

defaults:
  profile: ecc
  agent: ${resolvedAgent}
  timeout_ms: 3600000
  max_retries: 2
  status_interval_ms: 180000

artifacts:
  root: ${artifactsRoot}

policies:
  require_plan_before_implementation: true
  require_plan_approval: true
  require_review_before_success: true
  require_tests_before_merge: true
  max_fix_loops: 3
  max_stage_retries: 2
  max_pipeline_retries: 1

profiles:
  simple: ${profilesDir}/simple.yml
  standard: ${profilesDir}/standard.yml
  secure: ${profilesDir}/secure.yml
  full: ${profilesDir}/full.yml
  ecc: ${profilesDir}/ecc.yml

ecc:
  path: "${eccDir}"
  auto_sync: false
`;
    fs.writeFileSync(configPath, configYaml, 'utf8');

    // Copy profile files from package profiles directory
    const pkgProfiles = path.join(PACKAGE_ROOT, 'profiles');
    if (fs.existsSync(pkgProfiles)) {
      const files = fs.readdirSync(pkgProfiles);
      for (const file of files) {
        if (file.endsWith('.yml') || file.endsWith('.yaml')) {
          const src = path.join(pkgProfiles, file);
          const dest = path.join(profilesDir, file);
          if (!fs.existsSync(dest) || options?.force) {
            fs.copyFileSync(src, dest);
          }
        }
      }
    }
  }

  // Setup global CLI launcher in ~/.local/bin/pipeline if directory exists
  let linkedBin: string | undefined;
  if (options?.linkBin !== false) {
    const localBin = path.join(os.homedir(), '.local', 'bin');
    if (fs.existsSync(localBin)) {
      const targetLink = path.join(localBin, 'pipeline');
      const binScript = path.join(PACKAGE_ROOT, 'bin', 'pipeline.ts');
      try {
        if (fs.existsSync(targetLink)) {
          fs.unlinkSync(targetLink);
        }
        const wrapperContent = `#!/usr/bin/env bash\nexec bun run "${binScript}" "$@"\n`;
        fs.writeFileSync(targetLink, wrapperContent, { mode: 0o755 });
        linkedBin = targetLink;
      } catch {
        // ignore if cannot write to localBin
      }
    }
  }

  return { configPath, created, linkedBin, agent: resolvedAgent };
}

export function ensureConfigExists(cwd: string = process.cwd(), requestedAgent?: string): string {
  const targetAgent = requestedAgent ? normalizeAgent(requestedAgent) : detectDefaultAgent();
  const isAgy = targetAgent === 'agy';
  const expectedHomeConfig = isAgy
    ? path.join(os.homedir(), '.gemini', 'config', 'pipeline', 'config.yml')
    : path.join(os.homedir(), '.omp', 'pipeline', 'config.yml');

  if (fs.existsSync(expectedHomeConfig)) {
    return expectedHomeConfig;
  }

  const existing = findConfigFile(undefined, cwd);
  if (existing) return existing;

  const res = initConfiguration({ targetAgent, cwd });
  return res.configPath;
}

export function loadConfig(
  customPath?: string,
  cwd: string = process.cwd(),
  requestedAgent?: string
): PipelineConfig {
  let configFile: string | null = null;
  if (customPath) {
    configFile = findConfigFile(customPath, cwd);
  } else {
    configFile = ensureConfigExists(cwd, requestedAgent);
  }

  if (!configFile || !fs.existsSync(configFile)) {
    const fallback = structuredClone(DEFAULT_CONFIG);
    if (requestedAgent) {
      fallback.defaults.agent = normalizeAgent(requestedAgent);
    }
    return fallback;
  }

  try {
    const content = fs.readFileSync(configFile, 'utf8');
    const parsed = (yaml.parse(content) ?? {}) as Partial<PipelineConfig>;

    const merged = {
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
        agent: requestedAgent
          ? normalizeAgent(requestedAgent)
          : parsed.defaults?.agent || DEFAULT_CONFIG.defaults.agent,
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
      ecc: {
        ...DEFAULT_CONFIG.ecc,
        ...(parsed.ecc || {}),
      },
    };

    const validated = PipelineConfigSchema.safeParse(merged);
    if (!validated.success) {
      console.warn(`[pipeline-config] Config validation warning for ${configFile}:`, validated.error.format());
      return structuredClone(DEFAULT_CONFIG);
    }

    return validated.data as PipelineConfig;
  } catch (err) {
    console.warn(`[pipeline-config] Failed to load config from ${configFile}, using defaults:`, err);
    return structuredClone(DEFAULT_CONFIG);
  }
}
