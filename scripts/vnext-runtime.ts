#!/usr/bin/env bun

/**
 * Development/source-repository wrapper for the project-local vNext Runtime.
 *
 * The authoritative implementation lives under runtime/vnext/src. Target
 * projects execute the generated Node artifact at
 * .workflow-system/runtime/dist/cli.js instead of this Bun wrapper.
 */

export * from '../runtime/vnext/src/kernel';
export * from '../runtime/vnext/src/bootstrap';
export * from '../runtime/vnext/src/prepare-task-adapter';

import { runCli } from '../runtime/vnext/src/kernel';
import { PREPARE_TASK_ADAPTER_COMMANDS, runPrepareTaskAdapterCli } from '../runtime/vnext/src/prepare-task-adapter';

if (import.meta.main) {
  const args = process.argv.slice(2);
  let runner: Promise<number>;
  if (PREPARE_TASK_ADAPTER_COMMANDS.includes(args[0] as (typeof PREPARE_TASK_ADAPTER_COMMANDS)[number])) {
    runner = runPrepareTaskAdapterCli(args);
  } else runner = runCli(args);
  runner.then((exitCode) => {
    process.exitCode = exitCode;
  });
}
