import fs from 'fs';
import path from 'path';
import os from 'os';
import yaml from 'yaml';
import { PipelineConfig, PipelineProfile } from './types';
import { resolveHome } from './config';

export const PACKAGE_ROOT = path.resolve(__dirname, '..');

export const BUILTIN_PROFILES: Record<string, PipelineProfile> = {
  simple: {
    name: 'simple',
    description: 'Fast path for simple changes (implement -> test -> review)',
    stages: [
      {
        id: 'implement',
        role: 'coder',
        agent: 'auto',
        worktree: 'active',
        mode: 'goal',
        outputs: ['implementation.md'],
        next: ['test'],
      },
      {
        id: 'test',
        role: 'tester',
        agent: 'auto',
        worktree: 'active',
        mode: 'verify',
        inputs: ['implementation.md'],
        outputs: ['test.md'],
        next: ['review'],
      },
      {
        id: 'review',
        role: 'reviewer',
        agent: 'auto',
        worktree: 'active',
        mode: 'review',
        inputs: ['implementation.md', 'test.md'],
        outputs: ['review.md'],
        on: {
          pass: 'completed',
          fail: 'fix',
        },
      },
    ],
  },
  standard: {
    name: 'standard',
    description: 'Standard workflow (plan -> implement -> test -> review with fix loop)',
    stages: [
      {
        id: 'plan',
        role: 'planner',
        agent: 'auto',
        worktree: 'active',
        mode: 'analysis',
        read_only: true,
        outputs: ['plan.md'],
        next: ['implement'],
      },
      {
        id: 'implement',
        role: 'coder',
        agent: 'auto',
        worktree: 'active',
        mode: 'goal',
        inputs: ['plan.md'],
        outputs: ['implementation.md'],
        next: ['test'],
      },
      {
        id: 'test',
        role: 'tester',
        agent: 'auto',
        worktree: 'active',
        mode: 'verify',
        inputs: ['plan.md', 'implementation.md'],
        outputs: ['test.md'],
        next: ['review'],
      },
      {
        id: 'review',
        role: 'reviewer',
        agent: 'auto',
        worktree: 'active',
        mode: 'review',
        inputs: ['plan.md', 'implementation.md', 'test.md'],
        outputs: ['review.md'],
        on: {
          pass: 'completed',
          fail: 'fix',
        },
      },
    ],
  },
  secure: {
    name: 'secure',
    description: 'Secure workflow with parallel architect, security, and pattern specialists',
    stages: [
      {
        id: 'plan',
        role: 'planner',
        agent: 'auto',
        worktree: 'active',
        mode: 'analysis',
        read_only: true,
        outputs: ['plan.md'],
        next: ['architecture', 'security', 'pattern'],
      },
      {
        id: 'architecture',
        role: 'architect',
        agent: 'auto',
        worktree: 'active',
        read_only: true,
        inputs: ['plan.md'],
        outputs: ['architecture.md'],
        deps: ['plan'],
        next: ['implement'],
      },
      {
        id: 'security',
        role: 'security',
        agent: 'auto',
        worktree: 'active',
        read_only: true,
        inputs: ['plan.md'],
        outputs: ['security-plan.md'],
        deps: ['plan'],
        next: ['implement'],
      },
      {
        id: 'pattern',
        role: 'design-pattern',
        agent: 'auto',
        worktree: 'active',
        read_only: true,
        inputs: ['plan.md'],
        outputs: ['pattern.md'],
        deps: ['plan'],
        next: ['implement'],
      },
      {
        id: 'implement',
        role: 'coder',
        agent: 'auto',
        worktree: 'active',
        mode: 'goal',
        inputs: ['plan.md', 'architecture.md', 'security-plan.md', 'pattern.md'],
        outputs: ['implementation.md'],
        deps: ['architecture', 'security', 'pattern'],
        next: ['test'],
      },
      {
        id: 'test',
        role: 'tester',
        agent: 'auto',
        worktree: 'active',
        mode: 'verify',
        inputs: ['plan.md', 'implementation.md'],
        outputs: ['test.md'],
        next: ['review'],
      },
      {
        id: 'review',
        role: 'reviewer',
        agent: 'auto',
        worktree: 'active',
        mode: 'review',
        inputs: ['plan.md', 'implementation.md', 'test.md'],
        outputs: ['review.md'],
        on: {
          pass: 'final-security',
          fail: 'fix',
        },
      },
      {
        id: 'final-security',
        role: 'security-review',
        agent: 'auto',
        worktree: 'active',
        read_only: true,
        inputs: ['plan.md', 'security-plan.md', 'implementation.md', 'review.md'],
        outputs: ['security-review.md'],
        deps: ['review'],
        on: {
          pass: 'completed',
          fail: 'fix',
        },
      },
    ],
  },
  full: {
    name: 'full',
    description: 'Full enterprise specification, architecture, security, pattern, and verification workflow',
    stages: [
      {
        id: 'spec',
        role: 'spec-writer',
        agent: 'auto',
        worktree: 'active',
        read_only: true,
        outputs: ['spec.md'],
        next: ['architecture', 'security', 'pattern'],
      },
      {
        id: 'architecture',
        role: 'architect',
        agent: 'auto',
        worktree: 'active',
        read_only: true,
        inputs: ['spec.md'],
        outputs: ['architecture.md'],
        deps: ['spec'],
        next: ['plan'],
      },
      {
        id: 'security',
        role: 'security',
        agent: 'auto',
        worktree: 'active',
        read_only: true,
        inputs: ['spec.md'],
        outputs: ['security-plan.md'],
        deps: ['spec'],
        next: ['plan'],
      },
      {
        id: 'pattern',
        role: 'design-pattern',
        agent: 'auto',
        worktree: 'active',
        read_only: true,
        inputs: ['spec.md'],
        outputs: ['pattern.md'],
        deps: ['spec'],
        next: ['plan'],
      },
      {
        id: 'plan',
        role: 'planner',
        agent: 'auto',
        worktree: 'active',
        mode: 'analysis',
        read_only: true,
        inputs: ['spec.md', 'architecture.md', 'security-plan.md', 'pattern.md'],
        outputs: ['plan.md'],
        deps: ['architecture', 'security', 'pattern'],
        next: ['implement'],
      },
      {
        id: 'implement',
        role: 'coder',
        agent: 'auto',
        worktree: 'active',
        mode: 'goal',
        inputs: ['spec.md', 'plan.md', 'architecture.md', 'security-plan.md', 'pattern.md'],
        outputs: ['implementation.md'],
        deps: ['plan'],
        next: ['test'],
      },
      {
        id: 'test',
        role: 'tester',
        agent: 'auto',
        worktree: 'active',
        mode: 'verify',
        inputs: ['spec.md', 'plan.md', 'implementation.md'],
        outputs: ['test.md'],
        next: ['security-2'],
      },
      {
        id: 'security-2',
        role: 'security-review',
        agent: 'auto',
        worktree: 'active',
        read_only: true,
        inputs: ['spec.md', 'security-plan.md', 'implementation.md', 'test.md'],
        outputs: ['security-review.md'],
        deps: ['test'],
        next: ['review'],
      },
      {
        id: 'review',
        role: 'reviewer',
        agent: 'auto',
        worktree: 'active',
        mode: 'review',
        inputs: ['spec.md', 'plan.md', 'implementation.md', 'test.md', 'security-review.md'],
        outputs: ['review.md'],
        on: {
          pass: 'completed',
          fail: 'fix',
        },
      },
    ],
  },
};

export function resolveProfilePath(profileName: string, config: PipelineConfig, cwd: string = process.cwd()): string | null {
  const profileConfigPath = config.profiles[profileName];
  const candidates: string[] = [];

  if (profileConfigPath) {
    candidates.push(path.resolve(cwd, resolveHome(profileConfigPath)));
    candidates.push(path.resolve(PACKAGE_ROOT, resolveHome(profileConfigPath)));
  }

  candidates.push(path.join(cwd, '.pipeline', 'profiles', `${profileName}.yml`));
  candidates.push(path.join(cwd, '.pipeline', 'profiles', `${profileName}.yaml`));
  candidates.push(path.join(cwd, '.agents', 'pipeline', 'profiles', `${profileName}.yml`));
  candidates.push(path.join(cwd, '.agents', 'pipeline', 'profiles', `${profileName}.yaml`));
  candidates.push(path.join(cwd, '.omp', 'pipeline', 'profiles', `${profileName}.yml`));
  candidates.push(path.join(cwd, '.omp', 'pipeline', 'profiles', `${profileName}.yaml`));
  candidates.push(path.join(os.homedir(), '.gemini', 'config', 'pipeline', 'profiles', `${profileName}.yml`));
  candidates.push(path.join(os.homedir(), '.gemini', 'config', 'pipeline', 'profiles', `${profileName}.yaml`));
  candidates.push(path.join(os.homedir(), '.omp', 'pipeline', 'profiles', `${profileName}.yml`));
  candidates.push(path.join(os.homedir(), '.omp', 'pipeline', 'profiles', `${profileName}.yaml`));
  candidates.push(path.join(PACKAGE_ROOT, 'profiles', `${profileName}.yml`));
  candidates.push(path.join(PACKAGE_ROOT, 'profiles', `${profileName}.yaml`));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

export function loadProfile(profileName: string, config: PipelineConfig, cwd: string = process.cwd()): PipelineProfile {
  const profilePath = resolveProfilePath(profileName, config, cwd);

  if (profilePath) {
    try {
      const content = fs.readFileSync(profilePath, 'utf8');
      const parsed = yaml.parse(content) as PipelineProfile;
      if (parsed && parsed.name && Array.isArray(parsed.stages)) {
        return parsed;
      }
    } catch (err) {
      console.warn(`[pipeline-profile] Failed to load profile from ${profilePath}:`, err);
    }
  }

  if (BUILTIN_PROFILES[profileName]) {
    return structuredClone(BUILTIN_PROFILES[profileName]);
  }

  throw new Error(`Pipeline profile "${profileName}" not found. Available profiles: ${Object.keys(BUILTIN_PROFILES).join(', ')}`);
}
