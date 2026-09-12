# Technology Stack & Architecture Specification (`@omp/pipeline`)

## 1. Executive Summary

`@omp/pipeline` is an autonomous multi-stage workflow pipeline orchestrator designed to operate across dual host harnesses—**Google Antigravity (`agy`)** and **Oh My Pi (`omp`)**—while delegating all process execution, supervision, and lifecycle authority to **Orca Native Orchestration**.

The architecture enforces strict role boundaries, deterministic acyclic stage dependency graphs (DAGs), artifact file contracts (`.md`), atomic state persistence (`state.json`), and schema-validated configurations using TypeScript and Zod.

---

## 2. Full-Stack Layer Architecture

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                          1. HOST HARNESS LAYER                              │
│                                                                             │
│  [Oh My Pi (OMP)]                               [Google Antigravity (AGY)]  │
│  • Extension: src/extension.ts                  • Manifest: gemini-ext.json │
│  • Interactive Slash: /pipeline                 • Skill: skills/pipeline/   │
│  • Command CLI: omp                             • Command: commands/pipeline│
│  • Worktree: .omp/pipelines/                    • Worktree: .agents/pipeline│
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ Spawns CLI invocation / Subagent dispatch
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       2. PIPELINE CONTROLLER LAYER                          │
│                                                                             │
│  • CLI Entrypoint: bin/pipeline.ts -> src/cli.ts                            │
│  • Config Engine: src/config.ts (YAML parser + multi-path discovery)        │
│  • Schema Validation: src/schemas.ts (Zod runtime verification)             │
│  • DAG Engine: src/dag.ts (Kahn's Topological Sort & Cycle Detection)       │
│  • Profile Registry: src/profiles.ts (simple, standard, secure, full)       │
│  • State Engine: src/state.ts (Atomic file renames, state.json)             │
│  • Prompt Compiler: src/prompts.ts (Role-specific worker contracts)         │
│  • Autonomous Fix Loop: Automatic rework trigger on Review FAIL             │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ CLI Stdio JSON IPC
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     3. ORCA NATIVE ORCHESTRATION LAYER                      │
│                                                                             │
│  • IPC Client: src/orca.ts (run-create, task-create, worker-start, check)   │
│  • Protocol: CLI argument flags with JSON responses over stdout             │
│  • Supervision: Non-blocking check --wait polling loop with delivery ack   │
│  • Process Authority: Zero detached zombie processes; Orca owns lifecycle  │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ Dispatches supervised agent sessions
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      4. SPECIALIST AGENT WORKER LAYER                       │
│                                                                             │
│  • Plan: workflow-orchestrator (Read-Only) -> plan.md                       │
│  • Architect: architect-reviewer (Read-Only) -> architecture.md             │
│  • Security: security-auditor (Read-Only) -> security-plan.md               │
│  • Pattern: architect-reviewer (Read-Only) -> pattern.md                    │
│  • Implement: fullstack-developer (Write Mode) -> implementation.md         │
│  • Test: test-automator (Verify Mode) -> test.md                            │
│  • Review: code-reviewer (Independent Audit) -> review.md                   │
│                                                                             │
│  Artifact File Contracts: .agents/pipelines/<pipeline-id>/*.md              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Technology Stack Breakdown

### 3.1. Runtime Environment Layer
- **Bun (`>= 1.2.4`)**:
  - Primary execution runtime for CLI binaries (`bun run bin/pipeline.ts`).
  - High-performance package manager (`bun.lockb` / `bun.lock`).
  - Built-in test runner (`bun test`) executing unit, DAG, and schema test suites in sub-second durations.
- **Node.js (`>= 20.0.0` / 22 LTS compatibility)**:
  - All application runtime modules (`src/`) adhere strictly to standard Node.js APIs (`node:fs`, `node:path`, `node:os`, `node:child_process`).
  - Zero dependency on Bun-specific native bindings in core orchestrator code, ensuring full portability between Node.js and Bun runtimes.

### 3.2. Language & Compilation Layer
- **TypeScript (`v5.7.3`)**:
  - Compiler Target: `ES2022`.
  - Module Resolution: `Bundler` with `ESNext` module output.
  - Type Safety: Strict mode enabled (`"strict": true`, `"noImplicitAny": true`, `"skipLibCheck": true`).
  - Validation: Type checking verified via `tsc --noEmit`.

### 3.3. Data Serialization & Schema Validation Layer
- **`yaml` (`^2.7.0`)**:
  - Used for parsing and generating human-readable configuration files (`config.yml`, `default-config.yml`) and workflow profile definitions (`profiles/*.yml`).
  - Preserves formatting, supports comments, and handles multi-tier directory discovery.
- **`zod` (`^3.24.2`)**:
  - TypeScript-first runtime schema validation engine (`src/schemas.ts`).
  - Validates:
    - Pipeline configurations (`PipelineConfigSchema`) with safe fallback to defaults.
    - Workflow profiles and stage definitions (`PipelineProfileSchema`, `StageDefinitionSchema`).
    - Execution state graphs (`PipelineStateSchema`, `StageStateSchema`).
    - Orca inter-process communication messages (`OrcaWorkerDonePayloadSchema`, `OrcaMessageSchema`, `OrcaDeliverySchema`).
  - Guarantees runtime data correctness and protects against malformed configuration files.

### 3.4. Process Orchestration & IPC Layer
- **Orca Native Orchestration**:
  - The pipeline orchestrator does not manage detached background PIDs or child processes directly.
  - Instead, it acts as an **Orca Orchestrator Client** (`src/orca.ts`), communicating via standard JSON CLI commands:
    ```bash
    orca orchestration run-create --title "..." --json
    orca orchestration task-create --run-id "..." --title "..." --json
    orca orchestration worker-start --task-id "..." --agent "..." --worktree "..." --instruction "..." --json
    orca orchestration check --wait --delivery-ack "..." --json
    orca orchestration send --type worker_done --outcome succeeded --json
    ```
  - Resilient Fallback: If `worker-start` is unsupported by an agent harness (e.g. OMP headless sessions), Orca automatically falls back to `terminal create` + `terminal send` + `dispatch create`.

### 3.5. State Persistence & Storage Layer
- **Atomic File Operations (`src/state.ts`)**:
  - Pipeline state is persisted to disk at `<root>/<pipeline-id>/state.json`.
  - To prevent file corruption during concurrent reads or sudden terminations, writes are performed atomically:
    1. Serialize state JSON to a temporary file (`state.json.tmp.<timestamp>`).
    2. Atomic rename (`fs.renameSync`) to `state.json`.
- **Artifact Contracts**:
  - Agents communicate exclusively via persisted markdown artifacts on disk (e.g., `plan.md`, `architecture.md`, `implementation.md`, `test.md`, `review.md`).
  - No raw transcript passing or unstructured context pollution across stages.
  - If a worker crashes or times out, the orchestrator reconciles state by verifying artifact presence and integrity on disk.

---

## 4. Multi-Agent Specialist Roles & Permissions

| Role | Default Subagent (AGY) | Harness Mode | Permissions | Output Contract |
|:---|:---|:---|:---:|:---|
| **Planner** (`planner`) | `workflow-orchestrator` | `/plan` | `read_only: true` | `plan.md` |
| **Architect** (`architect`) | `architect-reviewer` | `/plan` | `read_only: true` | `architecture.md` |
| **Security** (`security`) | `security-auditor` | `/plan` | `read_only: true` | `security-plan.md` |
| **Pattern** (`design-pattern`) | `architect-reviewer` | `/plan` | `read_only: true` | `pattern.md` |
| **Coder** (`coder`) | `fullstack-developer` | `/goal` | `read_only: false` (Write) | `implementation.md` |
| **Tester** (`tester`) | `test-automator` | `/goal` | `read_only: false` (Verify) | `test.md` |
| **Reviewer** (`reviewer`) | `code-reviewer` | `/plan` | `read_only: true` | `review.md` (`VERDICT: PASS/FAIL`) |
| **Security Review** (`security-review`)| `security-auditor` | `/plan` | `read_only: true` | `security-review.md` |

---

## 5. Directed Acyclic Graph (DAG) Execution & Fix Loop

1. **Cycle Detection & Topological Resolution (`src/dag.ts`)**:
   - Profiles define stage dependencies via explicit `deps: [...]` or sequential `next: [...]` links.
   - The DAG engine uses **Kahn's Algorithm** to ensure zero cyclic dependencies at profile load time.
   - Independent stages (e.g., `architecture`, `security`, and `pattern` in the `secure` profile) run in parallel once their dependencies are satisfied.
2. **Autonomous Fix Loop (`src/controller.ts`)**:
   - When a `reviewer` stage produces `VERDICT: FAIL`, the controller intercepts the verdict.
   - If `fixLoops < policies.max_fix_loops`, the controller automatically inserts a dynamic `fix` stage referencing review feedback, followed by re-verification (`test`) and re-audit (`review`).
   - If `max_fix_loops` is exceeded, the pipeline transitions to `escalated` status without infinite looping.

---

## 6. Dependency Matrix

### 6.1. Production Runtime Dependencies
| Dependency | Version Range | Purpose |
|:---|:---|:---|
| [`yaml`](https://www.npmjs.com/package/yaml) | `^2.7.0` | Parsing and serialization of YAML configurations and profiles |
| [`zod`](https://www.npmjs.com/package/zod) | `^3.24.2` | Runtime schema validation for configs, profiles, stages, and states |

### 6.2. Development & Build Tooling
| Dependency | Version Range | Purpose |
|:---|:---|:---|
| [`typescript`](https://www.npmjs.com/package/typescript) | `^5.7.3` | Type checking and compilation |
| [`@types/node`](https://www.npmjs.com/package/@types/node) | `^22.13.9` | Node.js standard library type declarations |
| [`bun-types`](https://www.npmjs.com/package/bun-types) | `^1.2.4` | Bun runtime and test runner type definitions |

### 6.3. External Subsystems & CLI Binaries
| Binary | Required / Optional | Description |
|:---|:---:|:---|
| `orca` | **Required** | Central process orchestration engine daemon |
| `agy` | **Optional** | Google Antigravity host CLI harness for subagents |
| `omp` | **Optional** | Oh My Pi interactive host CLI harness |
| `git` | **Required** | Worktree management and file tracking |

---

## 7. Verification & Quality Gates

All modifications to this project must pass the following three-stage quality gate:
```bash
# 1. Type Safety Verification (Zero TS errors)
bun run typecheck

# 2. Automated Test Suite (Unit, DAG, Spawner, Controller, Schemas)
bun test

# 3. Production Build Validation
bun run build
```
