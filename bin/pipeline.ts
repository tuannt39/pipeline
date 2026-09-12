#!/usr/bin/env bun
import { runCli } from '../src/cli';

runCli().catch((err) => {
  console.error('[pipeline error]', err);
  process.exit(1);
});
