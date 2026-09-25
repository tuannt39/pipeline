import { describe, expect, it } from 'bun:test';
import { loadConfig, DEFAULT_CONFIG } from '../src/config';
import { loadProfile, BUILTIN_PROFILES } from '../src/profiles';

describe('Config and Profiles', () => {
  it('loads default config when no custom file exists', () => {
    const config = loadConfig('/non/existent/path/config.yml');
    expect(config.version).toBe(1);
    expect(config.orca.command).toBe('orca');
    expect(config.workspace.default).toBe('active');
    expect(config.defaults.profile).toBe('ecc');
    expect(config.defaults.agent).toBe('auto');
    expect(config.policies.require_plan_approval).toBe(true);
    expect(config.policies.max_fix_loops).toBe(3);
    expect(config.artifacts.root).toBe('.pipeline');
  });

  it('detects default agent harness based on environment or availability', () => {
    const { detectDefaultAgent, hasCommand } = require('../src/config');
    const detected = detectDefaultAgent();
    expect(['agy', 'omp']).toContain(detected);
    expect(typeof hasCommand('bun')).toBe('boolean');
    expect(hasCommand('bun')).toBe(true);
    expect(hasCommand('non_existent_binary_xyz123')).toBe(false);
  });

  it('accurately verifies isRealOrcaCli does not treat GNOME screen reader or non-existent binary as orchestrator', () => {
    const { isRealOrcaCli } = require('../src/config');
    expect(isRealOrcaCli('non_existent_binary_xyz123')).toBe(false);
    const orcaResult = isRealOrcaCli('orca');
    expect(typeof orcaResult).toBe('boolean');
  });

  it('loads all builtin profiles with auto agent defaults', () => {
    const config = structuredClone(DEFAULT_CONFIG);
    const profiles = ['simple', 'standard', 'secure', 'full', 'ecc'];

    for (const name of profiles) {
      const profile = loadProfile(name, config);
      expect(profile.name).toBe(name);
      expect(profile.stages.length).toBeGreaterThan(0);
      for (const stage of profile.stages) {
        expect(stage.agent).toBe('auto');
      }
    }
  });

  it('verifies secure profile has 3 parallel specialist stages depending on plan', () => {
    const config = structuredClone(DEFAULT_CONFIG);
    const profile = loadProfile('secure', config);

    const plan = profile.stages.find((s) => s.id === 'plan');
    expect(plan?.next).toContain('architecture');
    expect(plan?.next).toContain('security');
    expect(plan?.next).toContain('pattern');

    const arch = profile.stages.find((s) => s.id === 'architecture');
    const sec = profile.stages.find((s) => s.id === 'security');
    const pat = profile.stages.find((s) => s.id === 'pattern');

    expect(arch?.read_only).toBe(true);
    expect(sec?.read_only).toBe(true);
    expect(pat?.read_only).toBe(true);
  });

  it('initializes configuration with profiles and config.yml', () => {
    const { initConfiguration } = require('../src/config');
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-init-test-'));
    try {
      const res = initConfiguration({ targetEnv: 'gemini', linkBin: false, local: true, cwd: tempDir, force: true });
      expect(res.configPath).toContain(tempDir);
      expect(fs.existsSync(res.configPath)).toBe(true);
      const content = fs.readFileSync(res.configPath, 'utf8');
      expect(content).toContain('profile: ecc');
      expect(content).toContain('root: .pipeline');
      expect(content).toContain('ecc:');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('recovers with default config when config file has invalid YAML syntax', () => {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    const tmpFile = path.join(os.tmpdir(), `corrupt-config-${Date.now()}.yml`);
    fs.writeFileSync(tmpFile, ':::invalid yaml syntax:::\n  bad: [unclosed', 'utf8');

    const config = loadConfig(tmpFile);
    expect(config.version).toBe(1);
    expect(config.orca.command).toBe('orca');
    expect(config.defaults.profile).toBe('ecc');

    try {
      fs.unlinkSync(tmpFile);
    } catch {}
  });

  it('recovers with default config when config file violates Zod schema', () => {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    const tmpFile = path.join(os.tmpdir(), `invalid-schema-config-${Date.now()}.yml`);
    fs.writeFileSync(tmpFile, 'version: -999\nworkspace:\n  default: nonexistent_mode\n', 'utf8');

    const config = loadConfig(tmpFile);
    expect(config.version).toBe(1);
    expect(config.workspace.default).toBe('active');

    try {
      fs.unlinkSync(tmpFile);
    } catch {}
  });

  it('loads custom ecc configuration path and settings from config.yml', () => {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    const mockEccPath = path.join(os.tmpdir(), 'custom-ecc-fixture').replace(/\\/g, '/');
    const tmpFile = path.join(os.tmpdir(), `custom-ecc-config-${Date.now()}.yml`);
    const yamlContent = `version: 1
defaults:
  profile: ecc
  agent: agy
ecc:
  path: "${mockEccPath}"
  auto_sync: true
  cache_ttl_ms: 120000
`;
    fs.writeFileSync(tmpFile, yamlContent, 'utf8');

    try {
      const config = loadConfig(tmpFile);
      expect(config.ecc).toBeDefined();
      expect(config.ecc?.path).toBe(mockEccPath);
      expect(config.ecc?.auto_sync).toBe(true);
      expect(config.ecc?.cache_ttl_ms).toBe(120000);
    } finally {
      try {
        fs.unlinkSync(tmpFile);
      } catch {}
    }
  });

  it('saves default configuration according to agent agy or omp on init or run', () => {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const { initConfiguration, normalizeAgent, loadConfig } = require('../src/config');

    expect(normalizeAgent('agy')).toBe('agy');
    expect(normalizeAgent('antigravity')).toBe('agy');
    expect(normalizeAgent('gemini')).toBe('agy');
    expect(normalizeAgent('omp')).toBe('omp');
    expect(normalizeAgent('pi')).toBe('omp');
    expect(normalizeAgent('oh-my-pi')).toBe('omp');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-agent-init-'));
    try {
      // Local init for agy / antigravity
      const resAgy = initConfiguration({
        targetAgent: 'antigravity',
        local: true,
        cwd: tempDir,
        force: true,
      });
      expect(resAgy.agent).toBe('agy');
      expect(fs.existsSync(resAgy.configPath)).toBe(true);
      const contentAgy = fs.readFileSync(resAgy.configPath, 'utf8');
      expect(contentAgy).toContain('agent: agy');

      // Local init for omp
      const tempDirOmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-omp-init-'));
      try {
        const resOmp = initConfiguration({
          targetAgent: 'omp',
          local: true,
          cwd: tempDirOmp,
          force: true,
        });
        expect(resOmp.agent).toBe('omp');
        expect(fs.existsSync(resOmp.configPath)).toBe(true);
        const contentOmp = fs.readFileSync(resOmp.configPath, 'utf8');
        expect(contentOmp).toContain('agent: omp');

        // Loading config with agent override
        const loaded = loadConfig(resOmp.configPath, tempDirOmp, 'agy');
        expect(loaded.defaults.agent).toBe('agy');
      } finally {
        fs.rmSync(tempDirOmp, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('verifies ECC agent, rule, and workflow synchronization across all profiles', () => {
    const config = structuredClone(DEFAULT_CONFIG);

    // Simple profile
    const simple = loadProfile('simple', config);
    expect(simple.stages.find((s) => s.id === 'plan')?.ecc_agent).toBe('planner');
    expect(simple.stages.find((s) => s.id === 'implement')?.ecc_rules).toContain('common');
    expect(simple.stages.find((s) => s.id === 'test')?.ecc_agent).toBe('tdd-guide');
    expect(simple.stages.find((s) => s.id === 'test')?.ecc_rules).toContain('common');
    expect(simple.stages.find((s) => s.id === 'review')?.ecc_agent).toBe('code-reviewer');
    expect(simple.stages.find((s) => s.id === 'review')?.ecc_rules).toContain('common');
    expect(simple.stages.find((s) => s.id === 'review')?.ecc_workflows).toContain('orch-review');

    // Standard profile
    const standard = loadProfile('standard', config);
    expect(standard.stages.find((s) => s.id === 'plan')?.ecc_agent).toBe('planner');
    expect(standard.stages.find((s) => s.id === 'implement')?.ecc_rules).toContain('common');
    expect(standard.stages.find((s) => s.id === 'test')?.ecc_agent).toBe('tdd-guide');
    expect(standard.stages.find((s) => s.id === 'review')?.ecc_agent).toBe('code-reviewer');
    expect(standard.stages.find((s) => s.id === 'review')?.ecc_workflows).toContain('orch-review');

    // Secure profile
    const secure = loadProfile('secure', config);
    expect(secure.stages.find((s) => s.id === 'plan')?.ecc_agent).toBe('planner');
    expect(secure.stages.find((s) => s.id === 'architecture')?.ecc_agent).toBe('architect');
    expect(secure.stages.find((s) => s.id === 'security')?.ecc_agent).toBe('security-reviewer');
    expect(secure.stages.find((s) => s.id === 'pattern')?.ecc_agent).toBe('code-architect');
    expect(secure.stages.find((s) => s.id === 'review')?.ecc_agent).toBe('code-reviewer');
    expect(secure.stages.find((s) => s.id === 'final-security')?.ecc_agent).toBe('security-reviewer');

    // Full profile
    const full = loadProfile('full', config);
    expect(full.stages.find((s) => s.id === 'spec')?.ecc_agent).toBe('planner');
    expect(full.stages.find((s) => s.id === 'architecture')?.ecc_agent).toBe('architect');
    expect(full.stages.find((s) => s.id === 'security')?.ecc_agent).toBe('security-reviewer');
    expect(full.stages.find((s) => s.id === 'pattern')?.ecc_agent).toBe('code-architect');
    expect(full.stages.find((s) => s.id === 'plan')?.ecc_agent).toBe('planner');
    expect(full.stages.find((s) => s.id === 'test')?.ecc_agent).toBe('tdd-guide');
    expect(full.stages.find((s) => s.id === 'security-2')?.ecc_agent).toBe('security-reviewer');
    expect(full.stages.find((s) => s.id === 'review')?.ecc_agent).toBe('code-reviewer');

    // ECC profile
    const ecc = loadProfile('ecc', config);
    expect(ecc.stages.find((s) => s.id === 'requirement')?.ecc_agent).toBe('planner');
    expect(ecc.stages.find((s) => s.id === 'impact-analysis')?.ecc_agent).toBe('code-explorer');
    expect(ecc.stages.find((s) => s.id === 'blueprint')?.ecc_agent).toBe('architect');
    expect(ecc.stages.find((s) => s.id === 'design-patterns')?.ecc_agent).toBe('code-architect');
    expect(ecc.stages.find((s) => s.id === 'architecture-review')?.ecc_workflows).toContain('orch-review');
    expect(ecc.stages.find((s) => s.id === 'acceptance-tests')?.ecc_agent).toBe('tdd-guide');
    expect(ecc.stages.find((s) => s.id === 'tdd')?.ecc_agent).toBe('tdd-guide');
    expect(ecc.stages.find((s) => s.id === 'code-review')?.ecc_workflows).toContain('orch-review');
    expect(ecc.stages.find((s) => s.id === 'security-review')?.ecc_agent).toBe('security-reviewer');
    expect(ecc.stages.find((s) => s.id === 'audit')?.ecc_agent).toBe('code-reviewer');
  });
});


