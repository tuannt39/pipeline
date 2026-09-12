import fs from 'fs';
import path from 'path';
import { PipelineProfile, PipelineState, StageState } from './types';

export function generatePipelineId(prefix: string = 'pipe'): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const sec = String(now.getSeconds()).padStart(2, '0');
  const rand = Math.random().toString(36).substring(2, 6);
  return `${prefix}-${yyyy}${mm}${dd}-${hh}${min}${sec}-${rand}`;
}

export function resolvePipelineRoot(rootDir: string = '.omp/pipelines', cwd: string = process.cwd()): string {
  return path.resolve(cwd, rootDir);
}

export function getPipelineDir(pipelineId: string, rootDir: string = '.omp/pipelines', cwd: string = process.cwd()): string {
  return path.join(resolvePipelineRoot(rootDir, cwd), pipelineId);
}

export function initPipelineState(
  id: string,
  objective: string,
  profile: PipelineProfile,
  workspacePath: string,
  workspaceMode: string = 'active'
): PipelineState {
  const stages: Record<string, StageState> = {};
  for (const stage of profile.stages) {
    stages[stage.id] = {
      status: 'pending',
      retries: 0,
    };
  }

  const now = new Date().toISOString();
  return {
    id,
    objective,
    profile: profile.name,
    workspace: {
      mode: workspaceMode,
      path: workspacePath,
    },
    status: 'pending',
    stages,
    fixLoops: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function saveState(pipelineDir: string, state: PipelineState): void {
  fs.mkdirSync(pipelineDir, { recursive: true });
  state.updatedAt = new Date().toISOString();

  const statePath = path.join(pipelineDir, 'state.json');
  const tempPath = path.join(pipelineDir, `state.json.tmp.${Date.now()}`);

  fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tempPath, statePath);
}

export function loadState(pipelineDir: string): PipelineState {
  const statePath = path.join(pipelineDir, 'state.json');
  if (!fs.existsSync(statePath)) {
    throw new Error(`State file not found at ${statePath}`);
  }
  const content = fs.readFileSync(statePath, 'utf8');
  return JSON.parse(content) as PipelineState;
}

export function listPipelines(rootDir: string = '.omp/pipelines', cwd: string = process.cwd()): Array<{ id: string; state: PipelineState; dir: string }> {
  const root = resolvePipelineRoot(rootDir, cwd);
  if (!fs.existsSync(root)) return [];

  const entries = fs.readdirSync(root, { withFileTypes: true });
  const results: Array<{ id: string; state: PipelineState; dir: string }> = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const dir = path.join(root, entry.name);
      try {
        const state = loadState(dir);
        results.push({ id: entry.name, state, dir });
      } catch {
        // Skip incomplete or non-state directories
      }
    }
  }

  results.sort((a, b) => new Date(b.state.createdAt).getTime() - new Date(a.state.createdAt).getTime());
  return results;
}

export function updateStageState(
  state: PipelineState,
  stageId: string,
  update: Partial<StageState>
): void {
  const current = state.stages[stageId] || { status: 'pending', retries: 0 };
  state.stages[stageId] = {
    ...current,
    ...update,
  };
}

export function writeArtifact(pipelineDir: string, filename: string, content: string): string {
  fs.mkdirSync(pipelineDir, { recursive: true });
  const filepath = path.join(pipelineDir, filename);
  fs.writeFileSync(filepath, content, 'utf8');
  return filepath;
}

export function readArtifact(pipelineDir: string, filename: string): string | null {
  const filepath = path.join(pipelineDir, filename);
  if (!fs.existsSync(filepath)) return null;
  return fs.readFileSync(filepath, 'utf8');
}
