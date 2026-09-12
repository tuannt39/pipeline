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
    expect(config.policies.max_fix_loops).toBe(3);
  });

  it('loads all builtin profiles', () => {
    const config = structuredClone(DEFAULT_CONFIG);
    const profiles = ['simple', 'standard', 'secure', 'full'];

    for (const name of profiles) {
      const profile = loadProfile(name, config);
      expect(profile.name).toBe(name);
      expect(profile.stages.length).toBeGreaterThan(0);
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
