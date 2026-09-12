export type StageStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

export type PipelineStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'aborted'
  | 'escalated';

export interface StageDefinition {
  id: string;
  role: string;
  agent?: string;
  subagent?: string;
  model?: string;
  effort?: 'low' | 'medium' | 'high';
  flags?: string[];
  worktree?: 'active' | 'new' | string;
  mode?: 'analysis' | 'goal' | 'verify' | 'review' | string;
  read_only?: boolean;
  inputs?: string[];
  outputs?: string[];
  deps?: string[];
  next?: string[];
  on?: {
    pass?: string;
    fail?: string;
    [key: string]: string | undefined;
  };
}

export interface PipelineProfile {
  name: string;
  description?: string;
  stages: StageDefinition[];
}

export interface PipelinePolicies {
  require_plan_before_implementation?: boolean;
  require_review_before_success?: boolean;
  require_tests_before_merge?: boolean;
  max_fix_loops: number;
  max_stage_retries: number;
  max_pipeline_retries: number;
}

export interface PipelineConfig {
  version: number;
  orca: {
    command: string;
  };
  workspace: {
    default: 'active' | 'new';
    create_worktree_only_when_requested: boolean;
  };
  defaults: {
    profile: string;
    agent: string;
    timeout_ms: number;
    max_retries: number;
  };
  artifacts: {
    root: string;
  };
  policies: PipelinePolicies;
  profiles: Record<string, string>;
}

export interface StageState {
  status: StageStatus;
  taskId?: string;
  dispatchId?: string;
  startTime?: string;
  endTime?: string;
  error?: string;
  retries?: number;
  modifiedFiles?: string[];
  notes?: string;
}

export interface PipelineState {
  id: string;
  objective: string;
  profile: string;
  workspace: {
    mode: string;
    path: string;
  };
  status: PipelineStatus;
  stages: Record<string, StageState>;
  fixLoops: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrcaWorkerDonePayload {
  task_id?: string;
  dispatch_id?: string;
  outcome: 'succeeded' | 'failed';
  files_modified?: string;
  report_path?: string;
  phase?: string;
  [key: string]: unknown;
}

export interface OrcaMessage {
  id: string;
  type: string;
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  priority?: string;
  payload?: OrcaWorkerDonePayload | Record<string, unknown>;
  created_at?: string;
}

export interface OrcaDelivery {
  id?: string;
  delivery_id?: string;
  messages: OrcaMessage[];
}
