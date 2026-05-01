#!/usr/bin/env bun

/**
 * Generator output freshness checks.
 *
 * Compares committed generated artifacts against current generator dry-run
 * output to ensure template changes are reflected before merge.
 *
 * Implements WORKFLOW_PROTOCOL.md §16.5.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';
import {
  getWorkflowGeneratedDir,
  getWorkflowProfilePath,
  getWorkflowRegistryPath,
  loadProfile,
  resolveRoot,
  validateProfilePathSemantics,
} from './workflow-core';

// --- Types ---

export type FreshnessTarget = {
  name: string;
  generatorCommand: string[];
  outputDir: string;
  filePattern: string;
};

export type FreshnessResult = {
  target: string;
  status: 'fresh' | 'stale' | 'error';
  stale_files: string[];
  error?: string;
};

export type FreshnessReport = {
  results: FreshnessResult[];
  all_fresh: boolean;
};

// --- Constants ---

export const FRESHNESS_TARGETS: readonly FreshnessTarget[] = [
  {
    name: 'workflow-skills',
    generatorCommand: ['run', 'scripts/gen-workflow-skills.ts', '--dry-run'],
    outputDir: 'docs/workflow/generated/workflow-skills',
    filePattern: '.SKILL.md',
  },
  {
    name: 'workflow-docs',
    generatorCommand: ['run', 'scripts/gen-workflow-docs.ts', '--dry-run'],
    outputDir: 'docs/workflow/generated/workflow-docs',
    filePattern: '.md',
  },
  {
    name: 'registry',
    generatorCommand: ['run', 'scripts/gen-registry.ts', '--dry-run'],
    outputDir: 'docs/workflow',
    filePattern: 'SKILL_REGISTRY.md',
  },
];

const SCRIPT_ROOT = path.resolve(import.meta.dir, '..');

// --- Implementation ---

function readDirFiles(dir: string, pattern: string): Map<string, string> {
  const files = new Map<string, string>();
  if (!fs.existsSync(dir)) return files;

  for (const entry of fs.readdirSync(dir)) {
    if (entry.endsWith(pattern) || entry === pattern) {
      const fullPath = path.join(dir, entry);
      if (fs.statSync(fullPath).isFile()) {
        files.set(entry, fs.readFileSync(fullPath, 'utf8'));
      }
    }
  }
  return files;
}

function snapshotOutput(dir: string, pattern: string): Map<string, string> {
  if (pattern === 'SKILL_REGISTRY.md') {
    const fullPath = path.join(dir, pattern);
    if (fs.existsSync(fullPath)) {
      return new Map([[pattern, fs.readFileSync(fullPath, 'utf8')]]);
    }
    return new Map();
  }
  return readDirFiles(dir, pattern);
}

function materializeCommand(command: string[]): string[] {
  return command
    .filter(arg => arg !== '--dry-run')
    .map(arg => (arg.startsWith('scripts/') ? path.join(SCRIPT_ROOT, arg) : arg));
}

function copyFreshnessInputs(root: string, tempRoot: string): void {
  const copies = [
    [getWorkflowProfilePath(root), getWorkflowProfilePath(tempRoot)],
    [path.join(root, 'VERSION'), path.join(tempRoot, 'VERSION')],
    [path.join(root, 'templates', 'skills'), path.join(tempRoot, 'templates', 'skills')],
    [path.join(root, 'templates', 'docs'), path.join(tempRoot, 'templates', 'docs')],
  ] as const;

  for (const [source, target] of copies) {
    if (!fs.existsSync(source)) {
      continue;
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { recursive: true });
  }
}

function generateExpectedOutput(root: string, target: FreshnessTarget): Map<string, string> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-freshness-'));

  try {
    copyFreshnessInputs(root, tempRoot);

    const bunExe = process.execPath;
    const result = spawnSync(bunExe, materializeCommand(target.generatorCommand), {
      cwd: SCRIPT_ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
      env: {
        ...process.env,
        WORKFLOW_SYSTEM_ROOT: tempRoot,
      },
    });

    if (result.error || result.status !== 0) {
      throw new Error(
        result.error?.message ??
          `Generator exited with code ${result.status}: ${(result.stderr ?? '').trim()}`,
      );
    }

    return snapshotOutput(resolveFreshnessOutputDir(tempRoot, target), target.filePattern);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function resolveFreshnessOutputDir(root: string, target: FreshnessTarget): string {
  const profile = loadProfile(getWorkflowProfilePath(root));
  validateProfilePathSemantics(profile);
  if (target.name === 'workflow-skills') {
    return getWorkflowGeneratedDir(root, profile, 'workflow-skills');
  }
  if (target.name === 'workflow-docs') {
    return getWorkflowGeneratedDir(root, profile, 'workflow-docs');
  }
  if (target.name === 'registry') {
    return path.dirname(getWorkflowRegistryPath(root, profile));
  }
  return path.join(root, target.outputDir);
}

export function checkFreshness(root: string, target: FreshnessTarget): FreshnessResult {
  const outputDir = resolveFreshnessOutputDir(root, target);
  const committed = snapshotOutput(outputDir, target.filePattern);

  const staleFiles: string[] = [];
  try {
    const expected = generateExpectedOutput(root, target);
    for (const [file, content] of expected) {
      if (committed.get(file) !== content) {
        staleFiles.push(file);
      }
    }
    for (const file of committed.keys()) {
      if (!expected.has(file)) {
        staleFiles.push(`${file} (orphaned)`);
      }
    }
  } catch (error) {
    return {
      target: target.name,
      status: 'error',
      stale_files: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    target: target.name,
    status: staleFiles.length > 0 ? 'stale' : 'fresh',
    stale_files: staleFiles,
  };
}

export function runFreshnessChecks(root?: string): FreshnessReport {
  const resolvedRoot = path.resolve(root ?? resolveRoot());
  const results = FRESHNESS_TARGETS.map(target => checkFreshness(resolvedRoot, target));
  return {
    results,
    all_fresh: results.every(r => r.status === 'fresh'),
  };
}

// --- Main ---

function main(): void {
  const json = process.argv.includes('--json');
  const report = runFreshnessChecks();

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const result of report.results) {
      const icon = result.status === 'fresh' ? '✓' : result.status === 'stale' ? '✗' : '!';
      console.log(`${icon} ${result.target}: ${result.status}`);
      if (result.stale_files.length > 0) {
        for (const file of result.stale_files) {
          console.log(`  - ${file}`);
        }
      }
      if (result.error) {
        console.log(`  error: ${result.error}`);
      }
    }
    console.log(`\n${report.all_fresh ? 'All generators are fresh.' : 'STALE: Regenerate and commit.'}`);
  }

  if (!report.all_fresh) {
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}
