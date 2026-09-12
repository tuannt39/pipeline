# OMP Pipeline Orchestrator

A thin, robust **Pipeline Orchestrator** for [Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi) leveraging [Orca Native Orchestration](https://github.com/stablyai/orca).

Instead of running an ad-hoc custom scheduler or managing processes manually, the pipeline orchestrator uses **Orca** as the sole worker lifecycle authority (`Run` → `Task` → `Dispatch` / `worker-start` → `check --wait` → `worker_done`).

---

## Architecture Overview

```text
┌───────────────────────────────────────────────────────────┐
│                       OMP MAIN                            │
│                                                           │
│  User runs: /pipeline --profile secure <objective>        │
│  OMP Extension: ~/.omp/agent/extensions/pipeline.ts       │
└───────────────────────────┬───────────────────────────────┘
                            │ Spawns detached runner
                            ▼
┌───────────────────────────────────────────────────────────┐
│                  PIPELINE CONTROLLER                      │
│                                                           │
│  • Config & Profiles (simple, standard, secure, full)     │
│  • DAG Resolution & Ready Stages                          │
│  • State: .omp/pipelines/<id>/state.json                  │
│  • Artifact Contract: .omp/pipelines/<id>/*.md            │
│  • Policies: Review FAIL -> Fix -> Test -> Review loop    │
└───────────────────────────┬───────────────────────────────┘
                            │ Orca CLI Verbs
                            ▼
┌───────────────────────────────────────────────────────────┐
│                    ORCA ORCHESTRATION                     │
│                                                           │
│  run-create → task-create → worker-start / dispatch       │
│  check --wait (event stream) ← worker_done / escalation   │
└───────────────┬────────────────┬────────────────┬─────────┘
                │                │                │
                ▼                ▼                ▼
             OMP-Plan        OMP-Architect    OMP-Implement
           (read_only)        (read_only)        (write)
                │                │                │
                └──────────┬─────┴────────────────┘
                           ▼
              Read & Write Artifact Contracts:
              .omp/pipelines/<pipeline-id>/
```

---

## Features

- **Orca Native Lifecycle**: No zombie processes or detached PIDs; workers are spawned, supervised, and retired via Orca.
- **Strict Role Boundaries**:
  - `Planner`, `Architect`, `Security`, and `Pattern` specialists have `read_only: true` and cannot modify source code.
  - Only `Implement` (Coder) and `Fix` agents are permitted to modify code.
- **Parallel Specialist Stages**: In `secure` and `full` profiles, `architect`, `security`, and `design-pattern` run in parallel from `plan.md`.
- **Artifact Contracts**: No messy transcript handoffs between agents. Each agent consumes explicit `.md` input files and produces explicit `.md` output files.
- **Source of Truth**: `state.json` tracks the state of every stage, task ID, dispatch ID, and retry loop.
- **Autonomous Fix Loop**: If independent code review produces `VERDICT: FAIL`, the orchestrator automatically schedules a `fix` stage, re-runs tests, and re-reviews up to `max_fix_loops` before escalating.
- **OMP Extension**: Interactive slash command `/pipeline` with tab completion and background execution so the OMP TUI stays responsive.

---

## Available Profiles

| Profile | Flow | Use Case |
|---|---|---|
| `simple` | `IMPLEMENT` → `TEST` → `REVIEW` | Quick bug fixes, typos, small features |
| `standard` | `PLAN` → `IMPLEMENT` → `TEST` → `REVIEW` | Default production workflow with fix loop |
| `secure` | `PLAN` → `[ARCHITECT, SECURITY, PATTERN]` in parallel → `IMPLEMENT` → `TEST` → `REVIEW` → `FINAL-SECURITY` | Security-critical, auth, API, or multi-tenant code |
| `full` | `SPEC` → `[ARCHITECT, SECURITY, PATTERN]` → `PLAN` → `IMPLEMENT` → `TEST` → `SECURITY-2` → `REVIEW` | Large cross-cutting architectural refactors |

---

## Configuration

Central configuration is stored at `~/.omp/pipeline/config.yml`:

```yaml
version: 1

orca:
  command: orca

workspace:
  default: active
  create_worktree_only_when_requested: true

defaults:
  profile: standard
  agent: omp
  timeout_ms: 3600000
  max_retries: 2

artifacts:
  root: .omp/pipelines

policies:
  require_plan_before_implementation: true
  require_review_before_success: true
  require_tests_before_merge: true
  max_fix_loops: 3
  max_stage_retries: 2
  max_pipeline_retries: 1

profiles:
  simple: ~/.omp/pipeline/profiles/simple.yml
  standard: ~/.omp/pipeline/profiles/standard.yml
  secure: ~/.omp/pipeline/profiles/secure.yml
  full: ~/.omp/pipeline/profiles/full.yml
```

---

## CLI Usage

Run directly via `bin/pipeline.ts` or `bun run pipeline`:

```bash
# Start pipeline with default profile (standard)
./bin/pipeline.ts start "Implement OAuth login"

# Start with secure profile
./bin/pipeline.ts start --profile secure "Implement OAuth login with PKCE"

# Inspect status of active or specific pipeline
./bin/pipeline.ts status
./bin/pipeline.ts status pipe-20260913-000100-abc1

# List recent pipeline runs
./bin/pipeline.ts list

# Stop a running pipeline
./bin/pipeline.ts stop <id>

# View generated artifacts
./bin/pipeline.ts logs <id>
```

---

## OMP Extension Usage

Inside any OMP session:

```text
/pipeline Implement OAuth login
/pipeline --profile secure Implement OAuth login
/pipeline status
/pipeline list
/pipeline stop <id>
/pipeline logs <id>
```

---

## Testing

```bash
bun test
bun run typecheck
```
