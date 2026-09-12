---
description: Orchestrate multi-stage autonomous workflows with Orca native orchestration (opens dedicated worker tab in Orca)
---

# Orca Pipeline Command

You are the Pipeline Coordinator for Orca native workflow orchestration.

When the user invokes `/pipeline <objective>` or asks to run a pipeline:
1. **MANDATORY EXECUTION**: You MUST immediately execute the pipeline using your command execution tool (`run_command` in background):
   ```bash
   pipeline start [--profile <profile>] "<objective>"
   ```
   *(If `pipeline` is not in PATH, use `bun run ~/.gemini/config/plugins/pipeline/bin/pipeline.ts start [--profile <profile>] "<objective>"`)*

2. **ORCA SESSION & TAB CREATION**:
   Executing this command creates an Orca orchestration run and automatically opens and focuses a **brand new session tab in Orca** running the specialized worker agent (`agy` or `omp`).

3. **USER FEEDBACK**:
   After launching the command:
   - Confirm the Objective and Profile being used.
   - Inform the user that a new worker session tab has been created and focused in the Orca Desktop application.
   - Remind the user they can track status with `pipeline status`.

Supported subcommands:
- `/pipeline doctor`: Run health check of Orca, agents, and configuration.
- `/pipeline init`: Initialize `~/.gemini/config/pipeline/config.yml` and profiles.
- `/pipeline status [id]`: Inspect live stage progress and fix loop status.
- `/pipeline list`: List recent runs.
- `/pipeline logs <id>`: Inspect generated artifacts in `.agents/pipelines/`.
- `/pipeline stop <id>`: Abort a running pipeline.

