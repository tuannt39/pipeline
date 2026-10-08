import fs from 'fs';
import path from 'path';
import os from 'os';
import yaml from 'yaml';
import { PipelineConfig, PipelineProfile } from './types';
import { PipelineProfileSchema, safeValidatePipelineProfile } from './schemas';
import { resolveHome, PACKAGE_ROOT } from './config';
export { PACKAGE_ROOT, safeValidatePipelineProfile };

export const BUILTIN_PROFILES: Record<string, PipelineProfile> = {
  ecc: {
    name: 'ecc',
    description:
      'Single-session full engineering pipeline with ECC methodology and mandatory user plan approval gate',
    stages: [
      {
        id: 'requirement',
        role: 'analyst',
        agent: 'auto',
        ecc_agent: 'planner',
        worktree: 'active',
        read_only: true,
        ecc_skills: ['search-first', 'iterative-retrieval'],
        outputs: ['requirement.md', 'business-rules.md'],
        next: ['acceptance'],
      },
      {
        id: 'acceptance',
        role: 'analyst',
        agent: 'auto',
        ecc_agent: 'planner',
        worktree: 'active',
        read_only: true,
        ecc_skills: ['search-first', 'iterative-retrieval'],
        inputs: ['requirement.md'],
        outputs: ['acceptance.md'],
        deps: ['requirement'],
        next: ['impact-analysis'],
      },
      {
        id: 'impact-analysis',
        role: 'analyst',
        agent: 'auto',
        ecc_agent: 'code-explorer',
        worktree: 'active',
        read_only: true,
        ecc_skills: ['search-first', 'iterative-retrieval'],
        inputs: ['requirement.md', 'acceptance.md'],
        outputs: ['impact-analysis.md'],
        deps: ['acceptance'],
        next: ['blueprint'],
      },
      {
        id: 'blueprint',
        role: 'architect',
        agent: 'auto',
        ecc_agent: 'architect',
        worktree: 'active',
        read_only: true,
        ecc_skills: ['search-first', 'iterative-retrieval'],
        inputs: ['requirement.md', 'acceptance.md', 'impact-analysis.md'],
        outputs: ['blueprint.md'],
        deps: ['impact-analysis'],
        next: ['architecture'],
      },
      {
        id: 'architecture',
        role: 'architect',
        agent: 'auto',
        ecc_agent: 'architect',
        worktree: 'active',
        read_only: true,
        ecc_skills: ['backend-patterns', 'api-design'],
        inputs: ['blueprint.md'],
        outputs: ['architecture.md'],
        deps: ['blueprint'],
        next: ['design-patterns'],
      },
      {
        id: 'design-patterns',
        role: 'architect',
        agent: 'auto',
        ecc_agent: 'code-architect',
        worktree: 'active',
        read_only: true,
        ecc_skills: ['backend-patterns'],
        inputs: ['architecture.md', 'blueprint.md'],
        outputs: ['design-patterns.md'],
        deps: ['architecture'],
        next: ['adr'],
      },
      {
        id: 'adr',
        role: 'architect',
        agent: 'auto',
        ecc_agent: 'architect',
        worktree: 'active',
        read_only: true,
        ecc_skills: ['backend-patterns'],
        inputs: ['architecture.md', 'design-patterns.md'],
        outputs: ['adr/ADR-001.md'],
        deps: ['design-patterns'],
        next: ['architecture-review'],
      },
      {
        id: 'architecture-review',
        role: 'reviewer',
        agent: 'auto',
        ecc_agent: 'code-reviewer',
        worktree: 'active',
        read_only: true,
        ecc_skills: ['search-first'],
        ecc_rules: ['common'],
        ecc_workflows: ['orch-review'],
        inputs: ['architecture.md', 'design-patterns.md', 'adr/ADR-001.md'],
        outputs: ['architecture-review.md'],
        deps: ['adr'],
        next: ['plan'],
      },
      {
        id: 'plan',
        role: 'planner',
        agent: 'auto',
        ecc_agent: 'planner',
        worktree: 'active',
        read_only: true,
        require_approval: true,
        ecc_skills: ['search-first', 'iterative-retrieval'],
        inputs: [
          'requirement.md',
          'business-rules.md',
          'acceptance.md',
          'impact-analysis.md',
          'blueprint.md',
          'architecture.md',
          'design-patterns.md',
          'adr/ADR-001.md',
          'architecture-review.md',
        ],
        outputs: ['plan.md', 'test-plan.md'],
        deps: ['architecture-review'],
        next: ['acceptance-tests'],
      },
      {
        id: 'acceptance-tests',
        role: 'tester',
        agent: 'auto',
        ecc_agent: 'tdd-guide',
        worktree: 'active',
        read_only: true,
        ecc_skills: ['tdd-workflow'],
        ecc_rules: ['common'],
        inputs: ['acceptance.md', 'plan.md'],
        outputs: ['acceptance-tests.md'],
        deps: ['plan'],
        next: ['tdd'],
      },
      {
        id: 'tdd',
        role: 'developer',
        agent: 'auto',
        ecc_agent: 'tdd-guide',
        worktree: 'active',
        ecc_skills: ['tdd-workflow'],
        ecc_rules: ['common'],
        inputs: ['plan.md', 'acceptance-tests.md'],
        outputs: ['tdd.md'],
        deps: ['acceptance-tests'],
        next: ['implement'],
      },
      {
        id: 'implement',
        role: 'coder',
        agent: 'auto',
        worktree: 'active',
        ecc_skills: ['coding-standards'],
        ecc_rules: ['common'],
        inputs: ['plan.md', 'tdd.md', 'architecture.md'],
        outputs: ['implementation.md'],
        deps: ['tdd'],
        next: ['code-review'],
      },
      {
        id: 'code-review',
        role: 'reviewer',
        agent: 'auto',
        ecc_agent: 'code-reviewer',
        worktree: 'active',
        read_only: true,
        ecc_skills: ['coding-standards'],
        ecc_rules: ['common'],
        ecc_workflows: ['orch-review'],
        inputs: ['plan.md', 'implementation.md'],
        outputs: ['code-review.md'],
        deps: ['implement'],
        next: ['security-review'],
      },
      {
        id: 'security-review',
        role: 'security-review',
        agent: 'auto',
        ecc_agent: 'security-reviewer',
        worktree: 'active',
        read_only: true,
        ecc_skills: ['security-review'],
        ecc_rules: ['common'],
        inputs: ['implementation.md'],
        outputs: ['security-review.md'],
        deps: ['code-review'],
        next: ['design-conformance'],
      },
      {
        id: 'design-conformance',
        role: 'reviewer',
        agent: 'auto',
        ecc_agent: 'code-reviewer',
        worktree: 'active',
        read_only: true,
        ecc_skills: ['backend-patterns'],
        ecc_rules: ['common'],
        inputs: ['architecture.md', 'design-patterns.md', 'implementation.md'],
        outputs: ['design-conformance.md'],
        deps: ['security-review'],
        next: ['remediation'],
      },
      {
        id: 'remediation',
        role: 'coder',
        agent: 'auto',
        worktree: 'active',
        ecc_skills: ['coding-standards'],
        ecc_rules: ['common'],
        inputs: ['code-review.md', 'security-review.md', 'design-conformance.md'],
        outputs: ['remediation.md'],
        deps: ['design-conformance'],
        next: ['test'],
      },
      {
        id: 'test',
        role: 'tester',
        agent: 'auto',
        ecc_agent: 'tdd-guide',
        worktree: 'active',
        ecc_skills: ['verification-loop', 'tdd-workflow'],
        ecc_rules: ['common'],
        inputs: ['implementation.md', 'plan.md'],
        outputs: ['test.md'],
        deps: ['remediation'],
        next: ['verification'],
      },
      {
        id: 'verification',
        role: 'verifier',
        agent: 'auto',
        ecc_agent: 'tdd-guide',
        worktree: 'active',
        ecc_skills: ['verification-loop'],
        ecc_rules: ['common'],
        inputs: ['implementation.md', 'test.md'],
        outputs: ['verification.md'],
        deps: ['test'],
        next: ['audit'],
      },
      {
        id: 'audit',
        role: 'reviewer',
        agent: 'auto',
        ecc_agent: 'code-reviewer',
        worktree: 'active',
        read_only: true,
        ecc_skills: ['verification-loop'],
        ecc_rules: ['common'],
        inputs: ['requirement.md', 'architecture.md', 'implementation.md', 'verification.md'],
        outputs: ['audit.md'],
        deps: ['verification'],
        next: ['evidence'],
      },
      {
        id: 'evidence',
        role: 'reviewer',
        agent: 'auto',
        ecc_agent: 'code-reviewer',
        worktree: 'active',
        read_only: true,
        ecc_skills: ['verification-loop'],
        ecc_rules: ['common'],
        inputs: ['audit.md', 'verification.md'],
        outputs: ['evidence.json', 'result.md'],
        deps: ['audit'],
      },
    ],
  },
};

export function resolveProfilePath(profileName: string, config: PipelineConfig, cwd: string = process.cwd()): string | null {
  const candidates: string[] = [];

  // 1. Direct file path support (e.g. --profile ./custom.yml or /path/to/profile.yaml)
  if (profileName.endsWith('.yml') || profileName.endsWith('.yaml') || fs.existsSync(path.resolve(cwd, resolveHome(profileName)))) {
    const directCandidate = path.resolve(cwd, resolveHome(profileName));
    if (fs.existsSync(directCandidate) && fs.statSync(directCandidate).isFile()) {
      return directCandidate;
    }
  }

  const profileConfigPath = config.profiles[profileName];
  if (profileConfigPath) {
    candidates.push(path.resolve(cwd, resolveHome(profileConfigPath)));
    candidates.push(path.resolve(PACKAGE_ROOT, resolveHome(profileConfigPath)));
  }

  candidates.push(path.join(cwd, '.pipeline', 'profiles', `${profileName}.yml`));
  candidates.push(path.join(cwd, '.pipeline', 'profiles', `${profileName}.yaml`));
  candidates.push(path.join(os.homedir(), '.pipeline', 'profiles', `${profileName}.yml`));
  candidates.push(path.join(os.homedir(), '.pipeline', 'profiles', `${profileName}.yaml`));
  candidates.push(path.join(os.homedir(), '.gemini', 'config', 'pipeline', 'profiles', `${profileName}.yml`));
  candidates.push(path.join(os.homedir(), '.gemini', 'config', 'pipeline', 'profiles', `${profileName}.yaml`));
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
      const parsed = yaml.parse(content);
      const validated = PipelineProfileSchema.safeParse(parsed);
      if (validated.success) {
        const profile = validated.data as PipelineProfile;
        for (const stage of profile.stages) {
          if (!stage.agent) {
            stage.agent = config.defaults?.agent || 'auto';
          }
        }
        return profile;
      }
      console.warn(`[pipeline-profile] Invalid profile schema in ${profilePath}:`, validated.error.format());
    } catch (err) {
      console.warn(`[pipeline-profile] Failed to load profile from ${profilePath}:`, err);
    }
  }

  if (BUILTIN_PROFILES[profileName]) {
    const builtin = BUILTIN_PROFILES[profileName];
    const validated = PipelineProfileSchema.safeParse(builtin);
    if (validated.success) {
      return structuredClone(validated.data as PipelineProfile);
    }
    return structuredClone(builtin);
  }

  throw new Error(`Pipeline profile "${profileName}" not found. Available profiles: ${Object.keys(BUILTIN_PROFILES).join(', ')}`);
}
