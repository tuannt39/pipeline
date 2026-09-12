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
});
