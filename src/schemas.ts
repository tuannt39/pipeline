import { z } from 'zod';

export const StageStatusSchema = z.enum([
  'pending',
  'ready',
  'running',
  'completed',
  'failed',
  'skipped',
]);

export const PipelineStatusSchema = z.enum([
  'pending',
  'running',
  'waiting_approval',
  'completed',
  'failed',
  'aborted',
  'escalated',
]);

export const StageDefinitionSchema = z
  .object({
    id: z.string().min(1, 'Stage id is required'),
    role: z.string().min(1, 'Stage role is required'),
    agent: z.string().optional(),
    subagent: z.string().optional(),
    model: z.string().optional(),
    effort: z.enum(['low', 'medium', 'high']).optional(),
    flags: z.array(z.string()).optional(),
    worktree: z.string().optional(),
    mode: z.string().optional(),
    read_only: z.boolean().optional(),
    require_approval: z.boolean().optional(),
    inputs: z.array(z.string()).optional(),
    outputs: z.array(z.string()).optional(),
    deps: z.array(z.string()).optional(),
    next: z.array(z.string()).optional(),
    skills: z.array(z.string()).optional(),
    ecc_agent: z.string().optional(),
    ecc_skills: z.array(z.string()).optional(),
    ecc_rules: z.array(z.string()).optional(),
    ecc_workflows: z.array(z.string()).optional(),
    on: z.record(z.string(), z.string().optional()).optional(),
  })
  .passthrough();

export const PipelineProfileSchema = z
  .object({
    name: z.string().min(1, 'Profile name is required'),
    description: z.string().optional(),
    stages: z.array(StageDefinitionSchema).min(1, 'Profile must have at least one stage'),
  })
  .passthrough();

export const PipelinePoliciesSchema = z
  .object({
    require_plan_before_implementation: z.boolean().optional(),
    require_plan_approval: z.boolean().default(true),
    require_review_before_success: z.boolean().optional(),
    require_tests_before_merge: z.boolean().optional(),
    max_fix_loops: z.number().int().nonnegative().default(3),
    max_stage_retries: z.number().int().nonnegative().default(2),
    max_pipeline_retries: z.number().int().nonnegative().default(1),
  })
  .passthrough();

export const PipelineConfigSchema = z
  .object({
    version: z.number().int().positive().default(1),
    orca: z
      .object({
        command: z.string().default('orca'),
      })
      .passthrough()
      .default({ command: 'orca' }),
    workspace: z
      .object({
        default: z.enum(['active', 'new']).default('active'),
        create_worktree_only_when_requested: z.boolean().default(true),
      })
      .passthrough()
      .default({ default: 'active', create_worktree_only_when_requested: true }),
    defaults: z
      .object({
        profile: z.string().default('ecc'),
        agent: z.string().default('auto'),
        timeout_ms: z.number().int().positive().default(3600000),
        max_retries: z.number().int().nonnegative().default(2),
        status_interval_ms: z.number().int().positive().default(180000),
      })
      .passthrough()
      .default({
        profile: 'ecc',
        agent: 'auto',
        timeout_ms: 3600000,
        max_retries: 2,
        status_interval_ms: 180000,
      }),
    artifacts: z
      .object({
        root: z.string().default('.pipeline'),
      })
      .passthrough()
      .default({ root: '.pipeline' }),
    policies: PipelinePoliciesSchema.default({
      require_plan_before_implementation: true,
      require_plan_approval: true,
      require_review_before_success: true,
      require_tests_before_merge: true,
      max_fix_loops: 3,
      max_stage_retries: 2,
      max_pipeline_retries: 1,
    }),
    profiles: z.record(z.string(), z.string()).default({}),
    ecc: z
      .object({
        path: z.string().optional(),
        auto_sync: z.boolean().default(false),
        cache_ttl_ms: z.number().int().positive().default(60000),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const StageStateSchema = z
  .object({
    status: StageStatusSchema,
    taskId: z.string().optional(),
    dispatchId: z.string().optional(),
    terminalHandle: z.string().optional(),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    error: z.string().optional(),
    retries: z.number().int().nonnegative().optional(),
    modifiedFiles: z.array(z.string()).optional(),
    notes: z.string().optional(),
  })
  .passthrough();

export const PipelineStateSchema = z
  .object({
    id: z.string().min(1, 'Pipeline id is required'),
    objective: z.string(),
    profile: z.string(),
    workspace: z
      .object({
        mode: z.string(),
        path: z.string(),
      })
      .passthrough(),
    status: PipelineStatusSchema,
    stages: z.record(z.string(), StageStateSchema),
    fixLoops: z.number().int().nonnegative().default(0),
    approval: z
      .object({
        required: z.boolean(),
        stageId: z.string().optional(),
        approved: z.boolean(),
        approvedAt: z.string().optional(),
        approvedBy: z.string().optional(),
      })
      .optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();

export const OrcaWorkerDonePayloadSchema = z
  .object({
    task_id: z.string().optional(),
    dispatch_id: z.string().optional(),
    outcome: z.enum(['succeeded', 'failed']),
    files_modified: z.string().optional(),
    report_path: z.string().optional(),
    phase: z.string().optional(),
  })
  .passthrough();

export const OrcaMessageSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    from: z.string().optional(),
    to: z.string().optional(),
    subject: z.string().optional(),
    body: z.string().optional(),
    priority: z.string().optional(),
    payload: z.union([OrcaWorkerDonePayloadSchema, z.record(z.string(), z.unknown())]).optional(),
    created_at: z.string().optional(),
  })
  .passthrough();

export const OrcaDeliverySchema = z
  .object({
    id: z.string().optional(),
    delivery_id: z.string().optional(),
    messages: z.array(OrcaMessageSchema),
  })
  .passthrough();

export function validatePipelineConfig(data: unknown) {
  return PipelineConfigSchema.parse(data);
}

export function safeValidatePipelineConfig(data: unknown) {
  return PipelineConfigSchema.safeParse(data);
}

export function validatePipelineProfile(data: unknown) {
  return PipelineProfileSchema.parse(data);
}

export function safeValidatePipelineProfile(data: unknown) {
  return PipelineProfileSchema.safeParse(data);
}

export function validateStageDefinition(data: unknown) {
  return StageDefinitionSchema.parse(data);
}

export function safeValidateStageDefinition(data: unknown) {
  return StageDefinitionSchema.safeParse(data);
}

export function validatePipelineState(data: unknown) {
  return PipelineStateSchema.parse(data);
}

export function safeValidatePipelineState(data: unknown) {
  return PipelineStateSchema.safeParse(data);
}
