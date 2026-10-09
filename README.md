# Pipeline Orchestrator

A thin, robust **Pipeline Orchestrator** for [Google Antigravity (AGY)](https://github.com/google-deepmind/antigravity), leveraging the ECC Engineering Lifecycle.

The pipeline orchestrator runs natively and interactively in-session within Google Antigravity, executing stages directly and maintaining full interactivity with the user.

---

## Architecture Overview

```text
┌───────────────────────────────────────────────────────────┐
│               GOOGLE ANTIGRAVITY SESSION                  │
│                                                           │
│  User runs: /pipeline <objective>                         │
│  Skill/Command: skills/pipeline/SKILL.md                  │
│  Interactive Plan Gate: ask_question                      │
└───────────────────────────┬───────────────────────────────┘
                            │ Dispatches stages
                            ▼
┌───────────────────────────────────────────────────────────┐
│                  PIPELINE CONTROLLER                      │
│                                                           │
│  • Profile & DAG Engine (profiles/ecc.yml, custom YAML)   │
│  • State: .pipeline/<id>/state.json                       │
│  • Artifact Contract: .pipeline/<id>/*.md                 │
│  • ECC Knowledge Adapter: /github/ECC JIT injection       │
│  • Mandatory User Plan Approval Gate                      │
└───────────────────────────┬───────────────────────────────┘
                            │ Direct In-Session Execution
                            ▼
┌───────────────────────────────────────────────────────────┐
│             ANTIGRAVITY SPECIALIST SUBAGENTS              │
│                                                           │
│  planner   → workflow-orchestrator                        │
│  analyst   → technical-writer                             │
│  architect → architect-reviewer                           │
│  security  → security-auditor                             │
│  coder     → fullstack-developer                          │
│  tester    → test-automator                               │
│  reviewer  → code-reviewer                                │
└───────────────────────────┬───────────────────────────────┘
                            ▼
              Read & Write Artifact Contracts:
              .pipeline/<pipeline-id>/
```

---

## Features

- **Google Antigravity Native**: Single-session in-session execution and seamless delegation to built-in Antigravity subagents.
- **Strict Role Boundaries**:
  - `Planner`, `Architect`, `Security`, and `Reviewer` specialists have `read_only: true` and cannot modify source code.
  - Only `Coder` and `Fixer` roles are permitted to modify code.
- **ECC Lifecycle Integration**: 20-stage engineering methodology with JIT skill, rule, and workflow injection from ECC knowledge bases.
- **Mandatory User Plan Approval Gate**: `plan.md` and `test-plan.md` require explicit user confirmation before any code implementation begins.
- **Autonomous Fix Loop**: If independent code review produces `VERDICT: FAIL`, the orchestrator automatically schedules remediation, re-tests, and re-reviews.

---

## Technology Stack

- **Runtime**: [Bun](https://bun.sh/) (`>= 1.2.4`) with full [Node.js](https://nodejs.org/) (`>= 20.0.0`) API compatibility.
- **Language**: [TypeScript](https://www.typescriptlang.org/) (`v5.7.3`) with strict compiler checks (`ES2022`).
- **Orchestration**: Google Antigravity In-Session Orchestration (DAG execution, stage state persistence, interactive approval gate).
- **Host Integration**: [Google Antigravity (`agy`)](https://github.com/google-deepmind/antigravity).
- **Knowledge Framework**: [ECC Lifecycle & Methodologies](https://github.com/affaan-m/everything-claude-code).

---

## Available Profiles

| Profile | Flow | Use Case |
|---|---|---|
| `auto` | Auto-Triage → (`patch` \| `investigate` \| `ecc`) | **Default & Smart Routing**: Tự động phân tích mục tiêu & độ phức tạp để chọn profile tối ưu nhất. Người dùng không cần chọn thủ công! |
| `patch` | `RCA` → `PLAN` → [GATE] → `IMPLEMENT` → `VERIFY` → `REVIEW` → `EVIDENCE` | **Surgical Bugfix & Logic Patch**: 6 stages cho sửa lỗi logic/chuỗi cụ thể (như `resolvePaQlnCouncilMemberSearchTerm`), triệt tiêu xử lý thừa |
| `investigate` | `LOG-ANALYSIS` → `ROOT-CAUSE` → `IMPACT-SCOPE` → `REMEDIATION-PLAN` | **Diagnostic & Log Investigation**: 4 read-only stages cho điều tra log và chẩn đoán nguyên nhân mà không sửa code |
| `ecc` | Full 20 stages ECC Lifecycle | **Enterprise Feature & Architecture**: Dành cho tính năng lớn, đa module hoặc refactor kiến trúc rộng |

*Note: Custom profiles can be passed directly via `--profile <path-to-yaml>`.*


---

## Configuration

Configuration is automatically initialized on first run or by running `pipeline init` at `~/.gemini/config/pipeline/config.yml`.

```yaml
version: 1

workspace:
  default: active
  create_worktree_only_when_requested: true

defaults:
  profile: auto
  agent: agy
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
  auto: profiles/auto.yml
  ecc: profiles/ecc.yml
  patch: profiles/patch.yml
  investigate: profiles/investigate.yml

ecc:
  path: "" # Optional path to clone of ECC (e.g. /home/tuannt/Documents/github/ECC or via ECC_DIR env)
  auto_sync: false
```

Run `pipeline init` anytime to scaffold configuration:
```bash
# Initialize for Google Antigravity (AGY)
pipeline init --agy

# Initialize locally within project (.pipeline/config.yml)
pipeline init --local
```

---

## Installation

Install directly into Antigravity CLI:

```bash
agy plugin install https://github.com/tuannt39/pipeline
```

Verify the installation:
```bash
agy plugin list
pipeline doctor
```

---

## CLI Usage

Run directly via `bin/pipeline.ts` or `bun run pipeline`:

```bash
# Start pipeline with default profile (auto - smart auto-triage)
./bin/pipeline.ts start "Implement OAuth login"

# Approve plan stage when paused at approval gate
./bin/pipeline.ts approve <pipeline-id>

# Inspect status of active or specific pipeline
./bin/pipeline.ts status
./bin/pipeline.ts status pipe-20261009-000100-abc1

# List recent pipeline runs
./bin/pipeline.ts list

# Stop a running pipeline
./bin/pipeline.ts stop <id>

# View generated artifacts
./bin/pipeline.ts logs <id>
```

---

## Testing

```bash
bun test
bun run typecheck
```
