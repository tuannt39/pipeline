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

The orchestrator executable is available globally via `pipeline` or directly via `bun run bin/pipeline.ts`:

```bash
# 0. Initialize configuration and profiles (run once or auto-initialized on first start)
pipeline init
# or if running from plugin directory:
bun run ~/.gemini/config/plugins/pipeline/bin/pipeline.ts init

# 1. Start a new pipeline run
pipeline start "Objective description"
pipeline start --profile secure "Implement OAuth PKCE login"

# 2. Inspect active or specific pipeline status
pipeline status
pipeline status pipe-<id>

# 3. List recent pipeline executions
pipeline list

# 4. View stage artifacts and logs
pipeline logs <pipeline-id>

# 5. Stop a running pipeline
pipeline stop <pipeline-id>

# 6. Diagnostic health check
pipeline doctor
```

## Dual-Harness Execution (Antigravity & OMP)

The pipeline orchestrator is dual-harness native:
- **Google Antigravity (`agy`)**: When running in Antigravity or when `agy` is available, stages automatically dispatch to specialized built-in Antigravity subagents:
  - `architect` → `architect-reviewer`
  - `security` / `security-review` → `security-auditor`
  - `coder` / `fixer` → `fullstack-developer`
  - `tester` → `test-automator`
  - `reviewer` → `code-reviewer`
  Headless worker stages automatically include `--dangerously-skip-permissions` to ensure continuous autonomous execution without hanging on user confirmation dialogs.
- **Oh-My-Pi (`omp`)**: When running in OMP, stages seamlessly dispatch workers to the `omp` interactive CLI harness.
- **Auto-Detection**: Configured default `agent: auto` automatically detects the active environment or available CLI (`agy` prioritized if inside Antigravity).

## Role Permissions & Artifact Contracts

- **Read-Only Specialists**: Stages with roles `planner`, `architect`, `security`, `pattern`, `reviewer`, `security-review` have `read_only: true` enforced. They inspect the codebase and write structured markdown artifacts (`plan.md`, `architecture.md`, `security-plan.md`, `pattern.md`, `review.md`), but cannot modify source code.
- **Implementers**: Only `coder` and `fixer` roles are permitted to modify source code and files.
- **Artifact Directory**: All stage outputs and contracts are stored in `.omp/pipelines/<pipeline-id>/` (or configured `artifacts.root`).

