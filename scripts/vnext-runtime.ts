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
export * from '../runtime/vnext/src/execute-step-adapter';
export * from '../runtime/vnext/src/review-change-adapter';

import { runCli } from '../runtime/vnext/src/kernel';
import { PREPARE_TASK_ADAPTER_COMMANDS, runPrepareTaskAdapterCli } from '../runtime/vnext/src/prepare-task-adapter';
import { EXECUTE_STEP_ADAPTER_COMMANDS, runExecuteStepAdapterCli } from '../runtime/vnext/src/execute-step-adapter';
import { REVIEW_CHANGE_ADAPTER_COMMANDS, runReviewChangeAdapterCli } from '../runtime/vnext/src/review-change-adapter';
import { runFileContextCli } from '../runtime/vnext/src/file-context-cli';

if (import.meta.main) {
  const args = process.argv.slice(2);
  let runner: Promise<number>;
  if (args[0] === 'file-context') runner = runFileContextCli(args.slice(1));
  else if (PREPARE_TASK_ADAPTER_COMMANDS.includes(args[0] as (typeof PREPARE_TASK_ADAPTER_COMMANDS)[number])) {
    runner = runPrepareTaskAdapterCli(args);
  } else if (EXECUTE_STEP_ADAPTER_COMMANDS.includes(args[0] as (typeof EXECUTE_STEP_ADAPTER_COMMANDS)[number])) {
    runner = runExecuteStepAdapterCli(args);
  } else if (REVIEW_CHANGE_ADAPTER_COMMANDS.includes(args[0] as (typeof REVIEW_CHANGE_ADAPTER_COMMANDS)[number])) {
    runner = runReviewChangeAdapterCli(args);
  } else runner = runCli(args);
  runner.then((exitCode) => {
    process.exitCode = exitCode;
  });
}
