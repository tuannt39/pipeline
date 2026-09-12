import { describe, expect, it } from 'bun:test';
import { loadConfig, DEFAULT_CONFIG } from '../src/config';
import { loadProfile, BUILTIN_PROFILES } from '../src/profiles';

describe('Config and Profiles', () => {
  it('loads default config when no custom file exists', () => {
    const config = loadConfig('/non/existent/path/config.yml');
    expect(config.version).toBe(1);
    expect(config.orca.command).toBe('orca');
    expect(config.workspace.default).toBe('active');
    expect(config.defaults.profile).toBe('standard');
    expect(config.defaults.agent).toBe('auto');
    expect(config.policies.max_fix_loops).toBe(3);
  });

  it('detects default agent harness based on environment or availability', () => {
    const { detectDefaultAgent, hasCommand } = require('../src/config');
    const detected = detectDefaultAgent();
    expect(['agy', 'omp']).toContain(detected);
    expect(typeof hasCommand('bun')).toBe('boolean');
    expect(hasCommand('bun')).toBe(true);
    expect(hasCommand('non_existent_binary_xyz123')).toBe(false);
  });

  it('loads all builtin profiles with auto agent defaults', () => {
    const config = structuredClone(DEFAULT_CONFIG);
    const profiles = ['simple', 'standard', 'secure', 'full'];

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
    const res = initConfiguration({ targetEnv: 'gemini', linkBin: false });
    expect(res.configPath).toContain('.gemini');
    expect(require('fs').existsSync(res.configPath)).toBe(true);
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
    expect(config.defaults.profile).toBe('standard');

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

  it('throws a descriptive error when loading a non-existent profile', () => {
    const config = structuredClone(DEFAULT_CONFIG);
    expect(() => loadProfile('non_existent_profile_xyz', config)).toThrow(
      /Pipeline profile "non_existent_profile_xyz" not found/
    );
  });
});

