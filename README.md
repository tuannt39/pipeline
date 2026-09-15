# Pipeline Orchestrator

A thin, robust **Pipeline Orchestrator** with dual-harness support for [Google Antigravity (AGY)](https://github.com/google-deepmind/antigravity) and [Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi), leveraging [Orca Native Orchestration](https://github.com/stablyai/orca).

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
│  • State: .pipeline/<id>/state.json                       │
│  • Artifact Contract: .pipeline/<id>/*.md                 │
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
             Plan           Architect        Implement
            (read_only)        (read_only)        (write)
                │                │                │
                └──────────┬─────┴────────────────┘
                           ▼
              Read & Write Artifact Contracts:
              .pipeline/<pipeline-id>/
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

## Technology Stack

- **Runtime**: [Bun](https://bun.sh/) (`>= 1.2.4`) for execution and rapid testing, with full [Node.js](https://nodejs.org/) (`>= 20.0.0`) API compatibility.
- **Language**: [TypeScript](https://www.typescriptlang.org/) (`v5.7.3`) with strict compiler checks (`ES2022`).
- **Orchestration**: [Orca Native Orchestration](https://github.com/stablyai/orca) (`run` → `task` → `worker-start` / `dispatch` → `check --wait` → `worker_done`).
- **Data & Validation**: [YAML](https://www.npmjs.com/package/yaml) configuration with [Zod](https://zod.dev/) runtime schema validation.
- **Host Integration**: Dual-harness support for both **Oh My Pi (`omp`)** and **Google Antigravity (`agy`)**.

For a deep-dive analysis into layers, role boundaries, IPC protocols, and state management, see the detailed [Tech Stack Specification](TECHSTACK.md).

---

## Available Profiles

| Profile | Flow | Use Case |
|---|---|---|
| `ecc` | `REQUIREMENT` → `ACCEPTANCE` → `IMPACT` → `BLUEPRINT` → `ARCH` → `PATTERNS` → `ADR` → `ARCH-REVIEW` → [GATE] → `PLAN` → `ACC-TESTS` → `TDD` → `IMPLEMENT` → `CODE-REVIEW` → `SEC-REVIEW` → `DESIGN-CONFORMANCE` → `REMEDIATION` → `TEST` → `VERIFICATION` → `AUDIT` → `EVIDENCE` | **Default**: Comprehensive 20-stage ECC engineering lifecycle with pre-plan confirmation gate and 360° master plan |
| `full` | `SPEC` → `[ARCHITECT, SECURITY, PATTERN]` → `PLAN` → [GATE] → `IMPLEMENT` → `TEST` → `SECURITY-2` → `REVIEW` | Complete multi-stage analysis, mandatory plan approval gate, implementation & security verification |
| `standard` | `PLAN` → [GATE] → `IMPLEMENT` → `TEST` → `REVIEW` | Production workflow with plan approval and fix loop |
| `secure` | `PLAN` → `[ARCHITECT, SECURITY, PATTERN]` in parallel → `IMPLEMENT` → `TEST` → `REVIEW` → `FINAL-SECURITY` | Security-critical, auth, API, or multi-tenant code |
| `simple` | `IMPLEMENT` → `TEST` → `REVIEW` | Quick bug fixes, typos, small features |

---

## Configuration

Configuration is automatically initialized on first run or by running `pipeline init`.
- **For Antigravity (AGY)**: `~/.gemini/config/pipeline/config.yml`
- **For Oh-My-Pi (OMP)**: `~/.omp/pipeline/config.yml`

```yaml
version: 1

orca:
  command: orca

workspace:
  default: active
  create_worktree_only_when_requested: true

defaults:
  profile: ecc
  agent: auto # auto-detects 'agy' or 'omp'
  timeout_ms: 3600000
  max_retries: 2

artifacts:
  root: .pipeline

policies:
  require_plan_before_implementation: true
  require_plan_approval: true
  require_review_before_success: true
  require_tests_before_merge: true
  max_fix_loops: 3
  max_stage_retries: 2
  max_pipeline_retries: 1

profiles:
  simple: ~/.gemini/config/pipeline/profiles/simple.yml
  standard: ~/.gemini/config/pipeline/profiles/standard.yml
  secure: ~/.gemini/config/pipeline/profiles/secure.yml
  full: ~/.gemini/config/pipeline/profiles/full.yml
```

Run `pipeline init` anytime to scaffold configuration, copy default profiles, and link the global CLI binary:
```bash
# Initialize for Antigravity
pipeline init --gemini

# Initialize for OMP
pipeline init --omp
```

---

## Installation

### For Antigravity (AGY)
Install directly into Antigravity CLI:

```bash
agy plugin install https://github.com/tuannt39/pipeline
```

Verify the installation:
```bash
agy plugin list
```

### For Oh-My-Pi (OMP)
Install directly into Oh-My-Pi using the plugin manager:

```bash
omp install git:github.com/tuannt39/pipeline
```

Verify the installation:
```bash
omp plugin list
omp plugin doctor
```

---

## CLI Usage

Run directly via `bin/pipeline.ts` or `bun run pipeline`:

```bash
# Start pipeline with default profile (full)
./bin/pipeline.ts start "Implement OAuth login"

# Approve plan stage when paused at approval gate
./bin/pipeline.ts approve <pipeline-id>

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
/pipeline doctor
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
