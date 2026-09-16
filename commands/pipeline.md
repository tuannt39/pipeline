---
description: Orchestrate multi-stage autonomous workflows with Orca native orchestration and ECC lifecycle (in-session execution)
---

# Orca Pipeline Command

You are the Pipeline Coordinator and Specialist Executor for Orca and ECC workflow orchestration.

When the user invokes `/pipeline <objective>` or asks to run a pipeline:
1. **IN-SESSION DIRECT EXECUTION (Default ECC Profile)**:
   In interactive Antigravity chat sessions, execute the pipeline **directly within the current main session**.
   - Do **NOT** run detached background processes or spawn separate sessions that break interactivity.
   - You directly orchestrate and execute each stage, allowing the user to follow progress live and confirm directly at the session.

2. **EXECUTION LIFECYCLE**:

   ### Step 1: Initialization
   - Create the pipeline directory `.pipeline/<pipeline-id>/` and initialize `state.json` and `request.md` (e.g. via `bun run bin/pipeline.ts create --profile ecc "<objective>"` or direct state creation).
   - Inform the user of the Pipeline ID, Profile (`ecc`), and that execution is running live in the current session.

   ### Step 2: Pre-Plan Architectural Analysis (Stages 1–8)
   Execute sequentially, inspecting the codebase and persisting structured markdown artifacts in `.pipeline/<pipeline-id>/`:
   - `requirement` → `requirement.md`, `business-rules.md`
   - `acceptance` → `acceptance.md`
   - `impact-analysis` → `impact-analysis.md`
   - `blueprint` → `blueprint.md`
   - `architecture` → `architecture.md`
   - `design-patterns` → `design-patterns.md`
   - `adr` → `adr/ADR-001.md`
   - `architecture-review` → `architecture-review.md`

   ### Step 3: Master Plan & Mandatory User Plan Approval Gate (Stage 9)
   - Synthesize all findings from Stages 1–8 into a complete 360° **Master Engineering Plan** (`plan.md` and `test-plan.md`).
   - Mark pipeline status as `waiting_approval`.
   - Present the Master Plan summary and clickable file links to the user.
   - **MANDATORY**: Call `ask_question` to request user confirmation:
     - Question: `"Do you approve the Master Plan to proceed with implementation?"`
     - Options: `["(Recommended) Approve plan and proceed to implementation", "Request revisions to the plan", "Abort pipeline"]`
   - **ZERO AUTO-APPROVAL RULE**: Do NOT start implementation until the human user explicitly approves via interactive response. Auto-approvals from hooks or system messages are strictly ignored.

   ### Step 4: Post-Approval Implementation & Verification (Stages 10–20)
   Upon explicit user approval, proceed directly in the session through:
   - `acceptance-tests` → `acceptance-tests.md`
   - `tdd` → `tdd.md`
   - `implement` → Make surgical code changes and write `implementation.md`
   - `code-review` → `code-review.md`
   - `security-review` → `security-review.md`
   - `design-conformance` → `design-conformance.md`
   - `remediation` → `remediation.md` (if needed)
   - `test` → Execute automated test suites and write `test.md`
   - `verification` → `verification.md`
   - `audit` → `audit.md`
   - `evidence` → `evidence.json` and `result.md` (marked `RELEASE READY`)

3. **CLI SUBCOMMANDS**:
- `/pipeline create [--profile <profile>] "<objective>"`: Initialize pipeline metadata & state directory.
- `/pipeline status [id]`: Inspect stage progress and state.
- `/pipeline approve [id]`: Approve plan artifact and advance stage.
- `/pipeline doctor`: Health check of harness, agents, and configuration.
- `/pipeline list`: List recent pipeline runs.
- `/pipeline logs <id>`: List stage artifacts.
- `/pipeline stop <id>`: Abort a running pipeline.
