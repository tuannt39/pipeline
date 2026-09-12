---
name: pipeline
description: Orchestrate multi-stage autonomous workflows with Orca native orchestration (Plan -> Specialist Parallel Analysis -> Implement -> Test -> Review -> Fix Loop).
---

# Orca Pipeline Orchestration Skill

This skill allows Antigravity agents to execute, inspect, and supervise autonomous multi-stage software engineering workflows using the **Orca Pipeline Orchestrator**.

## When to Use

Activate this skill when:
- The user requests a multi-stage workflow, complex feature implementation, or cross-cutting architectural refactor.
- Work should be broken down into discrete phases with strict role boundaries (e.g. read-only planning/architecture vs. implementation vs. testing vs. independent review).
- Work benefits from parallel specialist analysis (`architect`, `security`, `pattern`).
- Independent verification and an autonomous fix loop (`implement` -> `test` -> `review` -> `fix`) are required.

## Available Profiles

| Profile | Stages | Recommended For |
| :--- | :--- | :--- |
| `simple` | `implement` -> `test` -> `review` | Quick bugfixes, small tasks, isolated edits |
| `standard` | `plan` -> `implement` -> `test` -> `review` | Default feature development with review fix loop |
| `secure` | `plan` -> parallel [`architecture`, `security`, `pattern`] -> `implement` -> `test` -> `review` -> `final-security` | Security-critical, auth, API, multi-tenant changes |
| `full` | `spec` -> parallel [`architecture`, `security`, `pattern`] -> `plan` -> `implement` -> `test` -> `security-review` -> `review` | Large architectural redesigns and enterprise workflows |

## CLI Commands

The orchestrator executable is located at `bin/pipeline.ts` or available via `pipeline`:

```bash
# 1. Start a new pipeline run
bun run bin/pipeline.ts start "Objective description"
bun run bin/pipeline.ts start --profile secure "Implement OAuth PKCE login"

# 2. Inspect active or specific pipeline status
bun run bin/pipeline.ts status
bun run bin/pipeline.ts status pipe-<id>

# 3. List recent pipeline executions
bun run bin/pipeline.ts list

# 4. View stage artifacts and logs
bun run bin/pipeline.ts logs <pipeline-id>

# 5. Stop a running pipeline
bun run bin/pipeline.ts stop <pipeline-id>

# 6. Diagnostic health check
bun run bin/pipeline.ts doctor
```

## Role Permissions & Artifact Contracts

- **Read-Only Specialists**: Stages with roles `planner`, `architect`, `security`, `pattern`, `reviewer`, `security-review` have `read_only: true` enforced. They inspect the codebase and write structured markdown artifacts (`plan.md`, `architecture.md`, `security-plan.md`, `pattern.md`, `review.md`), but cannot modify source code.
- **Implementers**: Only `coder` and `fixer` roles are permitted to modify source code and files.
- **Artifact Directory**: All stage outputs and contracts are stored in `.omp/pipelines/<pipeline-id>/`.
