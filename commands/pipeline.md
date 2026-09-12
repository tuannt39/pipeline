---
description: Orchestrate multi-stage workflows with Orca native orchestration
---

Run or inspect an autonomous multi-stage workflow pipeline using Orca:

- **Start a pipeline**: `bun run bin/pipeline.ts start --profile <profile> "<objective>"`
- **View status**: `bun run bin/pipeline.ts status [pipeline-id]`
- **List runs**: `bun run bin/pipeline.ts list`
- **Health check**: `bun run bin/pipeline.ts doctor`
- **View logs / artifacts**: `bun run bin/pipeline.ts logs <pipeline-id>`
- **Stop pipeline**: `bun run bin/pipeline.ts stop <pipeline-id>`

Available profiles: `simple`, `standard` (default), `secure`, `full`.
