import { describe, expect, it } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { runCli, formatStatus } from '../src/cli';
import { loadState, getPipelineDir } from '../src/state';
import { DEFAULT_CONFIG } from '../src/config';
import { loadProfile } from '../src/profiles';
import { initPipelineState } from '../src/state';

describe('CLI Commands & In-Session Helpers', () => {
  it('formats status output correctly', () => {
    const profile = loadProfile('ecc', DEFAULT_CONFIG);
    const state = initPipelineState('test-pipe-1', 'Test Objective', profile, '/mock/workspace', 'active');
    state.stages['requirement'].status = 'completed';
    state.stages['acceptance'].status = 'running';

    const output = formatStatus(state);
    expect(output).toContain('Pipeline:  test-pipe-1');
    expect(output).toContain('Objective: Test Objective');
    expect(output).toContain('Profile:   ecc');
    expect(output).toContain('✓ requirement      [completed]');
    expect(output).toContain('● acceptance       [running]');
  });

  it('handles pipeline create command and initializes directory structure', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-cli-test-'));
    const origCwd = process.cwd();
    process.chdir(tempDir);

    try {
      // Mock console output
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => logs.push(args.join(' '));

      await runCli(['create', '--profile', 'ecc', 'Design System Architecture']);

      console.log = origLog;

      const fullLog = logs.join('\n');
      expect(fullLog).toContain('Pipeline created successfully:');
      expect(fullLog).toContain('Profile:   ecc');
      expect(fullLog).toContain('Objective: Design System Architecture');

      const match = fullLog.match(/ID:\s+(pipe-[a-zA-Z0-9-]+)/);
      expect(match).not.toBeNull();
      const pipelineId = match![1];

      const pipelineDir = getPipelineDir(pipelineId, '.pipeline', tempDir);
      expect(fs.existsSync(pipelineDir)).toBe(true);

      const state = loadState(pipelineDir);
      expect(state.id).toBe(pipelineId);
      expect(state.profile).toBe('ecc');
      expect(state.objective).toBe('Design System Architecture');
      expect(state.status).toBe('pending');
      expect(state.stages['requirement'].status).toBe('pending');
    } finally {
      process.chdir(origCwd);
    }
  });

  it('handles pipeline stage update command', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-cli-test-'));
    const origCwd = process.cwd();
    process.chdir(tempDir);

    try {
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => logs.push(args.join(' '));

      // 1. Create pipeline
      await runCli(['create', '--profile', 'ecc', 'Build Auth Module']);
      const createLog = logs.join('\n');
      const match = createLog.match(/ID:\s+(pipe-[a-zA-Z0-9-]+)/);
      const pipelineId = match![1];

      logs.length = 0;

      // 2. Update requirement stage to completed
      await runCli(['stage', pipelineId, 'requirement', 'completed', '--notes', 'Analyzed auth requirements']);
      expect(logs.join('\n')).toContain(`Stage "requirement" in pipeline "${pipelineId}" updated to "completed".`);

      const pipelineDir = getPipelineDir(pipelineId, '.pipeline', tempDir);
      let state = loadState(pipelineDir);
      expect(state.stages['requirement'].status).toBe('completed');
      expect(state.stages['requirement'].notes).toBe('Analyzed auth requirements');
      expect(state.stages['requirement'].endTime).toBeDefined();

      logs.length = 0;

      // 3. Update acceptance stage to running
      await runCli(['stage', pipelineId, 'acceptance', 'running']);
      state = loadState(pipelineDir);
      expect(state.stages['acceptance'].status).toBe('running');
      expect(state.stages['acceptance'].startTime).toBeDefined();

      // 4. Check status command output
      logs.length = 0;
      await runCli(['status', pipelineId]);
      const statusLog = logs.join('\n');
      expect(statusLog).toContain('✓ requirement      [completed]');
      expect(statusLog).toContain('● acceptance       [running]');

      console.log = origLog;
    } finally {
      process.chdir(origCwd);
    }
  });
});
