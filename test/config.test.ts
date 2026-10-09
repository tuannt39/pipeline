import { describe, expect, it } from 'bun:test';
import { loadConfig, DEFAULT_CONFIG } from '../src/config';
import { loadProfile, BUILTIN_PROFILES } from '../src/profiles';

describe('Config and Profiles', () => {
  it('loads default config when no custom file exists', () => {
    const config = loadConfig('/non/existent/path/config.yml');
    expect(config.version).toBe(1);
    expect(config.workspace.default).toBe('active');
    expect(config.defaults.profile).toBe('auto');
    expect(config.defaults.agent).toBe('agy');
    expect(config.policies.require_plan_approval).toBe(true);
    expect(config.policies.max_fix_loops).toBe(3);
    expect(config.artifacts.root).toBe('.pipeline');
  });

  it('detects default agent harness as pure Antigravity agy', () => {
    const { detectDefaultAgent, hasCommand } = require('../src/config');
    const detected = detectDefaultAgent();
    expect(detected).toBe('agy');
    expect(typeof hasCommand('bun')).toBe('boolean');
    expect(hasCommand('bun')).toBe(true);
    expect(hasCommand('non_existent_binary_xyz123')).toBe(false);
  });

  it('loads builtin ecc profile with agy agent defaults', () => {
    const config = structuredClone(DEFAULT_CONFIG);
    const profile = loadProfile('ecc', config);
    expect(profile.name).toBe('ecc');
    expect(profile.stages.length).toBe(20);
    for (const stage of profile.stages) {
      expect(stage.agent).toBe('agy');
    }
  });

  it('supports loading custom profiles from disk or config, preserving multi-profile extensibility', () => {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-custom-profile-'));
    try {
      const customProfilePath = path.join(tempDir, 'custom.yml');
      const customYaml = `name: custom
description: Custom engineering workflow
stages:
  - id: custom-plan
    role: planner
    outputs: [plan.md]
    next: [custom-exec]
  - id: custom-exec
    role: coder
    inputs: [plan.md]
    outputs: [result.md]
    deps: [custom-plan]
`;
      fs.writeFileSync(customProfilePath, customYaml, 'utf8');

      const config = structuredClone(DEFAULT_CONFIG);
      config.profiles['custom'] = customProfilePath;

      const profile = loadProfile('custom', config);
      expect(profile.name).toBe('custom');
      expect(profile.stages.length).toBe(2);
      expect(profile.stages[0].id).toBe('custom-plan');
      expect(profile.stages[1].id).toBe('custom-exec');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('throws descriptive error when requested profile does not exist', () => {
    const config = structuredClone(DEFAULT_CONFIG);
    expect(() => loadProfile('non-existent-profile', config)).toThrow(
      /Pipeline profile "non-existent-profile" not found/
    );
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
      expect(content).toContain('profile: auto');
      expect(content).toContain('root: .pipeline');
      expect(content).toContain('ecc:');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('initializes configuration with Windows backslashes in eccPath without YAML parse errors', () => {
    const { initConfiguration, loadConfig } = require('../src/config');
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-init-winpath-'));
    try {
      const windowsPathWithEscapes = 'D:\\test\\git\\new\\path';
      const res = initConfiguration({
        linkBin: false,
        local: true,
        cwd: tempDir,
        force: true,
        eccPath: windowsPathWithEscapes,
      });
      expect(fs.existsSync(res.configPath)).toBe(true);
      const loaded = loadConfig(res.configPath);
      expect(loaded.ecc?.path).toBe('D:/test/git/new/path');
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
    expect(config.defaults.profile).toBe('auto');

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

  it('saves default configuration with pure Antigravity agent on init or run', () => {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const { initConfiguration, normalizeAgent, loadConfig } = require('../src/config');

    expect(normalizeAgent('agy')).toBe('agy');
    expect(normalizeAgent('antigravity')).toBe('agy');
    expect(normalizeAgent('gemini')).toBe('agy');
    expect(normalizeAgent('any-agent')).toBe('agy');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-agent-init-'));
    try {
      // Local init for agy
      const resAgy = initConfiguration({
        local: true,
        cwd: tempDir,
        force: true,
      });
      expect(resAgy.agent).toBe('agy');
      expect(fs.existsSync(resAgy.configPath)).toBe(true);
      const contentAgy = fs.readFileSync(resAgy.configPath, 'utf8');
      expect(contentAgy).toContain('agent: agy');

      // Loading config
      const loaded = loadConfig(resAgy.configPath, tempDir);
      expect(loaded.defaults.agent).toBe('agy');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('verifies ECC agent, rule, and workflow synchronization for ecc profile', () => {
    const config = structuredClone(DEFAULT_CONFIG);
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


