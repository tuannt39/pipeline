import { PipelineProfile, PipelineState, StageDefinition } from './types';

export interface StageGraph {
  stages: Map<string, StageDefinition>;
  dependencies: Map<string, Set<string>>; // stageId -> set of stageIds it depends on
  dependents: Map<string, Set<string>>;   // stageId -> set of stageIds that depend on it
}

export function buildStageGraph(profile: PipelineProfile): StageGraph {
  const stages = new Map<string, StageDefinition>();
  const dependencies = new Map<string, Set<string>>();
  const dependents = new Map<string, Set<string>>();

  for (const stage of profile.stages) {
    stages.set(stage.id, stage);
    if (!dependencies.has(stage.id)) dependencies.set(stage.id, new Set());
    if (!dependents.has(stage.id)) dependents.set(stage.id, new Set());
  }

  for (const stage of profile.stages) {
    // Explicit deps
    if (stage.deps) {
      for (const dep of stage.deps) {
        if (!stages.has(dep)) {
          throw new Error(`Stage "${stage.id}" declares non-existent dependency "${dep}"`);
        }
        dependencies.get(stage.id)!.add(dep);
        dependents.get(dep)!.add(stage.id);
      }
    }

    // Forward links (next)
    if (stage.next) {
      for (const nxt of stage.next) {
        if (!stages.has(nxt)) {
          throw new Error(`Stage "${stage.id}" declares non-existent next stage "${nxt}"`);
        }
        dependencies.get(nxt)!.add(stage.id);
        dependents.get(stage.id)!.add(nxt);
      }
    }
  }

  return { stages, dependencies, dependents };
}

export function validateDAG(profile: PipelineProfile): void {
  const { stages, dependencies } = buildStageGraph(profile);

  // Cycle detection via Kahn's algorithm
  const inDegree = new Map<string, number>();
  for (const [id, deps] of dependencies) {
    inDegree.set(id, deps.size);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  let visitedCount = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    visitedCount++;

    const stage = stages.get(current);
    const nextStages = new Set<string>();

    if (stage?.next) {
      for (const n of stage.next) nextStages.add(n);
    }
    for (const [otherId, deps] of dependencies) {
      if (deps.has(current)) nextStages.add(otherId);
    }

    for (const nxt of nextStages) {
      const remaining = (inDegree.get(nxt) || 1) - 1;
      inDegree.set(nxt, remaining);
      if (remaining === 0) {
        queue.push(nxt);
      }
    }
  }

  if (visitedCount !== stages.size) {
    throw new Error(`Cycle detected in pipeline profile "${profile.name}". Cannot resolve execution order.`);
  }
}

export function getReadyStages(
  state: PipelineState,
  profile: PipelineProfile
): StageDefinition[] {
  // If pipeline is awaiting user approval, do not dispatch next stages
  if (state.status === 'waiting_approval') {
    return [];
  }

  const { stages, dependencies } = buildStageGraph(profile);
  const ready: StageDefinition[] = [];

  for (const [stageId, stage] of stages) {
    const stageState = state.stages[stageId];
    const currentStatus = stageState?.status || 'pending';

    // Only pending stages can become ready
    if (currentStatus !== 'pending') continue;

    // Check all dependencies
    const deps = dependencies.get(stageId) || new Set();
    let allDepsCompleted = true;

    for (const dep of deps) {
      const depState = state.stages[dep];
      if (!depState || depState.status !== 'completed') {
        allDepsCompleted = false;
        break;
      }
    }

    if (allDepsCompleted) {
      ready.push(stage);
    }
  }

  return ready;
}

export function isPipelineFinished(
  state: PipelineState,
  profile: PipelineProfile
): { finished: boolean; success: boolean; reason?: string } {
  if (state.status === 'completed') return { finished: true, success: true };
  if (state.status === 'failed') return { finished: true, success: false, reason: 'Pipeline failed' };
  if (state.status === 'aborted') return { finished: true, success: false, reason: 'Pipeline aborted by user' };
  if (state.status === 'escalated') return { finished: true, success: false, reason: 'Pipeline escalated' };
  if (state.status === 'waiting_approval') return { finished: false, success: false };

  // Check if any stage failed
  for (const [id, s] of Object.entries(state.stages)) {
    if (s.status === 'failed') {
      return { finished: true, success: false, reason: `Stage "${id}" failed: ${s.error || 'Unknown error'}` };
    }
  }

  // Check if all stages in profile are completed
  const allCompleted = profile.stages.every(
    (stage) => state.stages[stage.id]?.status === 'completed'
  );

  if (allCompleted) {
    return { finished: true, success: true };
  }

  return { finished: false, success: false };
}
