#!/usr/bin/env bun

/**
 * Development/source-repository wrapper for the project-local vNext Runtime.
 *
 * The authoritative implementation lives under runtime/vnext/src. Target
 * projects execute the generated Node artifact at
 * .workflow-system/runtime/dist/cli.js instead of this Bun wrapper.
 */

export * from '../runtime/vnext/src/kernel';

import { runCli } from '../runtime/vnext/src/kernel';

if (import.meta.main) {
  runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
