import { describe, expect, it } from 'bun:test';
import {
  PipelineConfigSchema,
  PipelineProfileSchema,
  StageDefinitionSchema,
  PipelineStateSchema,
  OrcaWorkerDonePayloadSchema,
  OrcaMessageSchema,
  OrcaDeliverySchema,
  validatePipelineConfig,
  safeValidatePipelineConfig,
  validatePipelineProfile,
  safeValidatePipelineProfile,
  validateStageDefinition,
  safeValidateStageDefinition,
  validatePipelineState,
  safeValidatePipelineState,
} from '../src/schemas';
import { DEFAULT_CONFIG } from '../src/config';
import { BUILTIN_PROFILES } from '../src/profiles';

describe('Zod Schemas and Runtime Validation', () => {
  describe('PipelineConfigSchema', () => {
    it('validates DEFAULT_CONFIG successfully', () => {
      const parsed = validatePipelineConfig(DEFAULT_CONFIG);
      expect(parsed.version).toBe(1);
      expect(parsed.orca.command).toBe('orca');
      expect(parsed.workspace.default).toBe('active');
      expect(parsed.policies.max_fix_loops).toBe(3);
    });

    it('populates defaults when given an empty or minimal object', () => {
      const parsed = validatePipelineConfig({});
      expect(parsed.version).toBe(1);
      expect(parsed.orca.command).toBe('orca');
      expect(parsed.defaults.profile).toBe('ecc');
      expect(parsed.policies.require_plan_approval).toBe(true);
      expect(parsed.policies.max_fix_loops).toBe(3);
      expect(parsed.policies.max_stage_retries).toBe(2);
    });

    it('rejects invalid fields in config', () => {
      const invalidVersion = safeValidatePipelineConfig({ version: -1 });
      expect(invalidVersion.success).toBe(false);

      const invalidWorkspace = safeValidatePipelineConfig({
        workspace: { default: 'invalid_mode' },
      });
      expect(invalidWorkspace.success).toBe(false);

      const invalidPolicies = safeValidatePipelineConfig({
        policies: { max_fix_loops: -5 },
      });
      expect(invalidPolicies.success).toBe(false);
    });
  });

  describe('PipelineProfileSchema', () => {
    it('validates all builtin profiles (simple, standard, secure, full)', () => {
      for (const [name, profile] of Object.entries(BUILTIN_PROFILES)) {
        const res = safeValidatePipelineProfile(profile);
        expect(res.success).toBe(true);
        if (res.success) {
          expect(res.data.name).toBe(name);
          expect(res.data.stages.length).toBeGreaterThan(0);
        }
      }
    });

    it('rejects a profile without a name or empty stages', () => {
      const noName = safeValidatePipelineProfile({
        stages: [{ id: 'plan', role: 'planner' }],
      });
      expect(noName.success).toBe(false);

      const emptyStages = safeValidatePipelineProfile({
        name: 'empty',
        stages: [],
      });
      expect(emptyStages.success).toBe(false);
    });
  });

  describe('StageDefinitionSchema', () => {
    it('validates a complete stage definition', () => {
      const stage = {
        id: 'review',
        role: 'reviewer',
        agent: 'agy',
        subagent: 'code-reviewer',
        model: 'gemini-2.5-pro',
        effort: 'high' as const,
        flags: ['--strict'],
        worktree: 'active',
        mode: 'review',
        read_only: true,
        inputs: ['plan.md', 'implementation.md', 'test.md'],
        outputs: ['review.md'],
        deps: ['test'],
        next: ['fix'],
        on: {
          pass: 'completed',
          fail: 'fix',
        },
      };

      const parsed = validateStageDefinition(stage);
      expect(parsed.id).toBe('review');
      expect(parsed.role).toBe('reviewer');
      expect(parsed.subagent).toBe('code-reviewer');
      expect(parsed.effort).toBe('high');
      expect(parsed.on?.fail).toBe('fix');
    });

    it('rejects stage missing id or role', () => {
      expect(StageDefinitionSchema.safeParse({ id: '' }).success).toBe(false);
      expect(StageDefinitionSchema.safeParse({ role: 'coder' }).success).toBe(false);
      expect(StageDefinitionSchema.safeParse({ id: 's1' }).success).toBe(false);
    });
  });

  describe('PipelineStateSchema', () => {
    it('validates a pipeline state record', () => {
      const state = {
        id: 'pipe-20260913-010509-test',
        objective: 'Test pipeline run',
        profile: 'standard',
        workspace: {
          mode: 'active',
          path: '/home/user/workspace',
        },
        status: 'running' as const,
        stages: {
          plan: {
            status: 'completed' as const,
            taskId: 'task_001',
            dispatchId: 'disp_001',
            retries: 0,
          },
          implement: {
            status: 'running' as const,
            taskId: 'task_002',
          },
        },
        fixLoops: 0,
        createdAt: '2026-09-13T01:05:09.000Z',
        updatedAt: '2026-09-13T01:06:00.000Z',
      };

      const validated = validatePipelineState(state);
      expect(validated.id).toBe('pipe-20260913-010509-test');
      expect(validated.stages.plan.status).toBe('completed');
      expect(validated.stages.implement.status).toBe('running');
    });

    it('rejects state with invalid status or missing id', () => {
      const invalid = PipelineStateSchema.safeParse({
        id: '',
        objective: 'Test',
        profile: 'standard',
        workspace: { mode: 'active', path: '/test' },
        status: 'unknown_status',
        stages: {},
      });
      expect(invalid.success).toBe(false);
    });
  });

  describe('Orca Schemas', () => {
    it('validates OrcaWorkerDonePayloadSchema', () => {
      const payload = {
        task_id: 'task_123',
        dispatch_id: 'disp_456',
        outcome: 'succeeded' as const,
        files_modified: 'src/cli.ts',
        report_path: '.pipeline/pipe-1/implementation.md',
      };
      const res = OrcaWorkerDonePayloadSchema.safeParse(payload);
      expect(res.success).toBe(true);
    });

    it('validates OrcaDeliverySchema with messages', () => {
      const delivery = {
        delivery_id: 'del_789',
        messages: [
          {
            id: 'msg_001',
            type: 'worker_done',
            from: 'worker-1',
            to: 'orchestrator',
            subject: 'Done',
            body: 'Finished successfully',
            payload: {
              outcome: 'succeeded',
            },
          },
        ],
      };
      const res = OrcaDeliverySchema.safeParse(delivery);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.messages[0].type).toBe('worker_done');
      }
    });

    it('rejects OrcaWorkerDonePayloadSchema with invalid outcome', () => {
      const payload = {
        task_id: 'task_123',
        outcome: 'unknown_outcome',
      };
      const res = OrcaWorkerDonePayloadSchema.safeParse(payload);
      expect(res.success).toBe(false);
    });

    it('validates OrcaMessageSchema with generic payload dictionary', () => {
      const message = {
        id: 'msg_999',
        type: 'log_event',
        payload: {
          key1: 'val1',
          key2: 123,
          nested: { active: true },
        },
      };
      const res = OrcaMessageSchema.safeParse(message);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.id).toBe('msg_999');
        expect(res.data.type).toBe('log_event');
      }
    });

    it('rejects OrcaMessageSchema missing id or type', () => {
      expect(OrcaMessageSchema.safeParse({ id: 'msg_1' }).success).toBe(false);
      expect(OrcaMessageSchema.safeParse({ type: 'worker_done' }).success).toBe(false);
    });
  });

  describe('Edge Cases and Helper Functions', () => {
    it('verifies safeValidateStageDefinition helper and passthrough arbitrary fields', () => {
      const stageWithCustom = {
        id: 'custom-stage',
        role: 'tester',
        custom_metadata: { priority: 'P0' },
      };
      const res = safeValidateStageDefinition(stageWithCustom);
      expect(res.success).toBe(true);
      if (res.success) {
        expect((res.data as any).custom_metadata.priority).toBe('P0');
      }
    });

    it('rejects stage definition with invalid effort', () => {
      const invalidEffort = {
        id: 'test-effort',
        role: 'tester',
        effort: 'super-high',
      };
      const res = safeValidateStageDefinition(invalidEffort);
      expect(res.success).toBe(false);
    });

    it('verifies safeValidatePipelineState helper with various pipeline and stage statuses', () => {
      const validStatuses = ['pending', 'running', 'completed', 'failed', 'aborted', 'escalated'] as const;
      for (const status of validStatuses) {
        const state = {
          id: `pipe-test-${status}`,
          objective: 'Test status check',
          profile: 'standard',
          workspace: { mode: 'active', path: '/test' },
          status,
          stages: {
            test: { status: 'completed' as const },
          },
          fixLoops: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        const res = safeValidatePipelineState(state);
        expect(res.success).toBe(true);
      }

      const invalidStageStatus = {
        id: 'pipe-test-invalid',
        objective: 'Test invalid stage status',
        profile: 'standard',
        workspace: { mode: 'active', path: '/test' },
        status: 'running',
        stages: {
          test: { status: 'in_progress' }, // Invalid, should be 'running'
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      expect(safeValidatePipelineState(invalidStageStatus).success).toBe(false);
    });
  });
});

