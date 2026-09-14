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

## Instructions for the Agent

When the user asks to start or run a pipeline (or invokes `/pipeline <objective>`):
1. **Immediately execute the pipeline** in the background using `run_command`:
   ```bash
   pipeline start [--profile <profile>] "<objective>"
   ```
2. Running this command creates an Orca orchestration run and automatically opens and focuses a new dedicated worker tab in the Orca Desktop interface.
3. Inform the user of the Pipeline ID and that the dedicated worker tab has been opened in Orca.

## Available Profiles
 
| Profile | Stages | Recommended For |
| :--- | :--- | :--- |
| `full` | `spec` -> parallel [`architecture`, `security`, `pattern`] -> `plan` -> `implement` -> `test` -> `security-review` -> `review` | **Default**: Complete architectural analysis, plan approval gate, implementation & security verification |
| `ecc` | `requirement` -> `acceptance` -> `impact-analysis` -> `blueprint` -> `architecture` -> `design-patterns` -> `adr` -> `architecture-review` -> [USER CONFIRMATION] -> `plan` -> `acceptance-tests` -> `tdd` -> `implement` -> `code-review` -> `security-review` -> `design-conformance` -> `remediation` -> `test` -> `verification` -> `audit` -> `evidence` | Full 20-stage ECC engineering lifecycle in single AGY session with user confirmation gate before plan creation |
| `standard` | `plan` -> `implement` -> `test` -> `review` | Feature development with review fix loop |
| `secure` | `plan` -> parallel [`architecture`, `security`, `pattern`] -> `implement` -> `test` -> `review` -> `final-security` | Security-critical, auth, API, multi-tenant changes |
| `simple` | `implement` -> `test` -> `review` | Quick bugfixes, small tasks, isolated edits |

 
## CLI Commands
 
The orchestrator executable is available globally via `pipeline` or directly via `bun run bin/pipeline.ts`:
 
```bash
# 0. Initialize configuration and profiles (run once or auto-initialized on first start)
pipeline init
# or if running from plugin directory:
bun run ~/.gemini/config/plugins/pipeline/bin/pipeline.ts init

# 1. Start a new pipeline run (uses default profile: full)
pipeline start "Objective description"
pipeline start --profile standard "Implement simple feature"
pipeline start --profile secure "Implement OAuth PKCE login"

# 2. Approve plan stage (Mandatory Plan Approval Gate)
pipeline approve <pipeline-id>

# 3. Inspect active or specific pipeline status
pipeline status
pipeline status pipe-<id>

# 4. List recent pipeline executions
pipeline list

# 5. View stage artifacts and logs
pipeline logs <pipeline-id>

# 6. Stop a running pipeline
pipeline stop <pipeline-id>

# 7. Resume a paused or approved pipeline
pipeline resume <pipeline-id>

# 8. Diagnostic health check
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

## Plan Approval Gate (Mandatory Hard Stop)

When executing workflows that include the `plan` stage (such as `full` and `standard`), the orchestrator enforces a mandatory gate:
- Once `plan.md` is generated, the pipeline halts and sets status to `waiting_approval`.
- Awaiting banner is displayed:
  `⏸️ **Awaiting Plan approval** — Please respond to continue.`
- Execution will **NOT** transition to `implement` until explicit user approval is provided:
  - In interactive terminals, prompt `[y/N]` directly.
  - In background/Orca sessions, approve via `pipeline approve <pipeline-id>`.

## ECC Profile: Single-Session Execution & Pre-Plan Confirmation Gate

When executing the `ecc` profile (`/pipeline --profile ecc <objective>`):
1. **Single AGY Session Execution**:
   - The entire 20-stage engineering lifecycle executes sequentially within the **current active AGY session**, applying ECC methodology (`tdd-workflow`, `verification-loop`, `security-review`, `coding-standards`, `backend-patterns`).
2. **Mandatory User Confirmation BEFORE Creating `plan.md`**:
   - The pipeline executes pre-plan stages (1–8: `requirement` -> `acceptance` -> `impact-analysis` -> `blueprint` -> `architecture` -> `design-patterns` -> `adr` -> `architecture-review`).
   - At the end of Stage 8 (`architecture-review`), the pipeline marks `require_approval: true` and **MUST HALT** in `waiting_approval`.
   - The agent summarizes the requirements, proposed architecture, design patterns, and ADR decisions, and requests user confirmation:
     *"Pre-plan analysis and architecture design are complete. Do you confirm to create plan.md and proceed to implementation?"*
   - **`plan.md` MUST NOT BE CREATED until the user explicitly confirms.**
3. **Post-Confirmation Execution**:
   - Upon user approval, Stage 9 (`plan`) creates `plan.md` and `test-plan.md`.
   - The pipeline continues through `acceptance-tests`, `tdd`, `implement`, `code-review`, `security-review`, `design-conformance`, `remediation`, `test`, `verification`, `audit`, and `evidence`.
   - Final state is marked `RELEASE READY` only when all evidence domains in `evidence.json` pass.



