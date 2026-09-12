---
description: Orchestrate multi-stage workflows with Orca native orchestration
---

Run or inspect an autonomous multi-stage workflow pipeline using Orca:

- **Initialize config**: `pipeline init` (or `bun run ~/.gemini/config/plugins/pipeline/bin/pipeline.ts init`)
- **Start a pipeline**: `pipeline start --profile <profile> "<objective>"` (or `bun run ~/.gemini/config/plugins/pipeline/bin/pipeline.ts start ...`)
- **View status**: `pipeline status [pipeline-id]`
- **List runs**: `pipeline list`
- **Health check**: `pipeline doctor`
- **View logs / artifacts**: `pipeline logs <pipeline-id>`
- **Stop pipeline**: `pipeline stop <pipeline-id>`

Available profiles: `simple`, `standard` (default), `secure`, `full`.
Configuration is stored at `~/.gemini/config/pipeline/config.yml` (Antigravity) or `~/.omp/pipeline/config.yml` (OMP).
