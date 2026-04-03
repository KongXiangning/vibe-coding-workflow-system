#!/usr/bin/env bun

/**
 * Validation runner for the workflow-system.
 *
 * Reads the validation matrix from PROJECT_PROFILE.yaml, enforces layer
 * precedence (protocol-first per §16.3), executes bound entrypoints, and
 * produces a structured ValidationReport.
 *
 * Implements WORKFLOW_PROTOCOL.md §16.
 */

import * as path from 'path';
import { spawnSync } from 'child_process';
import { parse } from 'yaml';
import { readText, resolveRoot } from './workflow-core';
import {
  type BlockerLevel,
  type ValidationEntrypoint,
  type ValidationLayer,
  type ValidationReport,
  type ValidationResult,
  buildValidationReport,
  getBoundEntrypoints,
  isValidBlockerLevel,
  isValidLayer,
  parseValidationMatrix,
  partitionByLayer,
} from './validation-model';

// --- Types ---

export type RunValidationOptions = {
  root?: string;
  layer?: ValidationLayer;
  maxBlockerLevel?: BlockerLevel;
  json?: boolean;
  dryRun?: boolean;
};

type RunValidationCliArgs = {
  layer?: ValidationLayer;
  maxBlockerLevel?: BlockerLevel;
  json: boolean;
  dryRun: boolean;
};

// --- CLI ---

function parseCliArgs(argv: string[]): RunValidationCliArgs {
  const parsed: RunValidationCliArgs = {
    json: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--layer') {
      const value = argv[i + 1];
      if (!value || !isValidLayer(value)) {
        throw new Error(`--layer requires "protocol" or "project". Got: "${value ?? ''}"`);
      }
      parsed.layer = value;
      i++;
    } else if (arg.startsWith('--layer=')) {
      const value = arg.slice('--layer='.length);
      if (!isValidLayer(value)) {
        throw new Error(`--layer requires "protocol" or "project". Got: "${value}"`);
      }
      parsed.layer = value;
    } else if (arg === '--blocker-level') {
      const value = argv[i + 1];
      if (!value || !isValidBlockerLevel(value)) {
        throw new Error(`--blocker-level requires a valid blocker level. Got: "${value ?? ''}"`);
      }
      parsed.maxBlockerLevel = value;
      i++;
    } else if (arg.startsWith('--blocker-level=')) {
      const value = arg.slice('--blocker-level='.length);
      if (!isValidBlockerLevel(value)) {
        throw new Error(`--blocker-level requires a valid blocker level. Got: "${value}"`);
      }
      parsed.maxBlockerLevel = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

// --- Execution ---

const BLOCKER_SEVERITY: Record<BlockerLevel, number> = {
  'blocks-generator': 3,
  'blocks-merge': 2,
  'blocks-ship': 1,
  'warning-only': 0,
};

function shouldRun(entrypoint: ValidationEntrypoint, maxBlockerLevel?: BlockerLevel): boolean {
  if (!maxBlockerLevel) return true;
  return BLOCKER_SEVERITY[entrypoint.blocker_level] >= BLOCKER_SEVERITY[maxBlockerLevel];
}

export function executeEntrypoint(
  entrypoint: ValidationEntrypoint,
  cwd: string,
): ValidationResult {
  const parts = entrypoint.command.split(/\s+/);
  const result = spawnSync(parts[0], parts.slice(1), {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    shell: true,
  });

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();

  if (result.error) {
    return {
      entrypoint: entrypoint.name,
      layer: entrypoint.layer,
      blocker_level: entrypoint.blocker_level,
      status: 'failed',
      error: result.error.message,
    };
  }

  if (result.status !== 0) {
    return {
      entrypoint: entrypoint.name,
      layer: entrypoint.layer,
      blocker_level: entrypoint.blocker_level,
      status: 'failed',
      output,
      error: `Exit code: ${result.status}`,
    };
  }

  return {
    entrypoint: entrypoint.name,
    layer: entrypoint.layer,
    blocker_level: entrypoint.blocker_level,
    status: 'passed',
    output,
  };
}

function skipResult(entrypoint: ValidationEntrypoint, reason: string): ValidationResult {
  return {
    entrypoint: entrypoint.name,
    layer: entrypoint.layer,
    blocker_level: entrypoint.blocker_level,
    status: 'skipped',
    output: reason,
  };
}

export function loadMatrixFromProfile(root: string): ValidationEntrypoint[] {
  const profilePath = path.join(root, 'PROJECT_PROFILE.yaml');
  const profile = parse(readText(profilePath)) as Record<string, unknown>;
  const validation = profile.validation as Record<string, unknown> | undefined;
  if (!validation || !Array.isArray(validation.matrix)) {
    throw new Error('PROJECT_PROFILE.yaml is missing validation.matrix array.');
  }
  return parseValidationMatrix(validation.matrix).entrypoints;
}

export function runValidation(options: RunValidationOptions = {}): ValidationReport {
  const root = path.resolve(options.root ?? resolveRoot());
  const allEntrypoints = loadMatrixFromProfile(root);

  let filtered = allEntrypoints;
  if (options.layer) {
    filtered = filtered.filter(e => e.layer === options.layer);
  }

  const { protocol, project } = partitionByLayer(filtered);
  const boundProtocol = getBoundEntrypoints(protocol);
  const boundProject = getBoundEntrypoints(project);

  // Protocol-first: run protocol entrypoints
  const protocolResults: ValidationResult[] = [];
  for (const entry of boundProtocol) {
    if (!shouldRun(entry, options.maxBlockerLevel)) {
      protocolResults.push(skipResult(entry, `Blocker level ${entry.blocker_level} below threshold ${options.maxBlockerLevel}`));
      continue;
    }
    if (options.dryRun) {
      protocolResults.push(skipResult(entry, 'dry-run mode'));
      continue;
    }
    protocolResults.push(executeEntrypoint(entry, root));
  }

  // Check protocol pass before running project
  const protocolPassed = protocolResults.every(
    r => r.status === 'passed' || r.status === 'skipped' || r.blocker_level === 'warning-only',
  );

  const projectResults: ValidationResult[] = [];
  for (const entry of boundProject) {
    if (!shouldRun(entry, options.maxBlockerLevel)) {
      projectResults.push(skipResult(entry, `Blocker level ${entry.blocker_level} below threshold ${options.maxBlockerLevel}`));
      continue;
    }
    if (!protocolPassed) {
      projectResults.push(skipResult(entry, 'Protocol-level validation failed; project results are non-authoritative.'));
      continue;
    }
    if (options.dryRun) {
      projectResults.push(skipResult(entry, 'dry-run mode'));
      continue;
    }
    projectResults.push(executeEntrypoint(entry, root));
  }

  return buildValidationReport(protocolResults, projectResults);
}

// --- Formatting ---

function formatReport(report: ValidationReport): string {
  const lines: string[] = [];

  lines.push('=== Protocol-level validation ===');
  for (const r of report.protocol_results) {
    const icon = r.status === 'passed' ? '✓' : r.status === 'skipped' ? '○' : '✗';
    lines.push(`  ${icon} ${r.entrypoint} [${r.blocker_level}] — ${r.status}${r.error ? `: ${r.error}` : ''}`);
  }
  lines.push(`  Protocol: ${report.protocol_passed ? 'PASSED' : 'FAILED'}`);
  lines.push('');

  lines.push('=== Project-level validation ===');
  if (report.project_results.length === 0) {
    lines.push('  (no bound project-level entrypoints)');
  } else {
    for (const r of report.project_results) {
      const icon = r.status === 'passed' ? '✓' : r.status === 'skipped' ? '○' : '✗';
      lines.push(`  ${icon} ${r.entrypoint} [${r.blocker_level}] — ${r.status}${r.error ? `: ${r.error}` : ''}`);
    }
    lines.push(`  Project: ${report.project_passed ? 'PASSED' : 'FAILED'}${!report.project_authoritative ? ' (non-authoritative)' : ''}`);
  }
  lines.push('');

  if (report.blocked_gates.length > 0) {
    lines.push(`Blocked gates: ${report.blocked_gates.join(', ')}`);
  } else {
    lines.push('No gates blocked.');
  }

  return lines.join('\n');
}

// --- Main ---

function main(): void {
  const args = parseCliArgs(process.argv.slice(2));
  const report = runValidation({
    layer: args.layer,
    maxBlockerLevel: args.maxBlockerLevel,
    json: args.json,
    dryRun: args.dryRun,
  });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReport(report));
  }

  const hasBlockingFailure = report.blocked_gates.length > 0;
  if (hasBlockingFailure) {
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}
