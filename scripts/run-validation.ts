#!/usr/bin/env bun

/**
 * Validation runner for the workflow-system.
 *
 * Reads the validation matrix from .workflow-system/PROJECT_PROFILE.yaml, enforces layer
 * precedence (protocol-first per §16.3), executes bound entrypoints, and
 * produces a structured ValidationReport.
 *
 * Implements WORKFLOW_PROTOCOL.md §16.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { parse } from 'yaml';
import {
  getWorkflowDocPath,
  getWorkflowGeneratedDir,
  getWorkflowProfilePath,
  loadProfile,
  readText,
  resolveRoot,
} from './workflow-core';
import { validatePropagationGovernanceDocs } from './propagation-governance';
import {
  parseInboxArtifactPath,
  parseSuspendedTaskArtifactPath,
  validateInboxArtifactPackage,
  validateSuspendedTaskPackage,
  validateBaselineCoverageForBoundSlots,
  validateLifecycleGovernanceDoc,
  validateWorkflowGuideCaptureContract,
  type LifecycleGovernanceDoc,
} from './workflow-doc-contracts';
import { extractCurrentTaskStateFromCurrentTask } from './task-identity';
import {
  type BlockerLevel,
  type ValidationEntrypoint,
  type ValidationLayer,
  type ValidationReport,
  type ValidationResult,
  buildValidationReport,
  getBoundEntrypoints,
  isEntrypointBound,
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

type GovernanceHomeCheck = {
  file: LifecycleGovernanceDoc;
  entrypoint: 'baseline-governance-home' | 'decisions-governance-home' | 'roadmap-governance-home';
  validateContent: (content: string, entrypoints: readonly ValidationEntrypoint[]) => void;
};

type EntrypointExecutionContext = {
  cwd: string;
  env?: NodeJS.ProcessEnv;
};

type SuspendedTaskPackageCheck = {
  entrypoint: 'suspended-task-package-validation';
  blocker_level: 'blocks-merge';
};

type InboxArtifactCheck = {
  entrypoint: 'inbox-artifact-validation';
  blocker_level: 'blocks-merge';
};

type WorkflowGuideCaptureCheck = {
  entrypoint: 'workflow-guide-capture-validation';
  blocker_level: 'blocks-merge';
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

const GOVERNANCE_HOME_CHECKS: readonly GovernanceHomeCheck[] = [
  {
    file: 'ROADMAP.md',
    entrypoint: 'roadmap-governance-home',
    validateContent: content => {
      validateLifecycleGovernanceDoc('ROADMAP.md', content);
    },
  },
  {
    file: 'DECISIONS.md',
    entrypoint: 'decisions-governance-home',
    validateContent: content => {
      validateLifecycleGovernanceDoc('DECISIONS.md', content);
    },
  },
  {
    file: 'BASELINES.md',
    entrypoint: 'baseline-governance-home',
    validateContent: (content, entrypoints) => {
      validateLifecycleGovernanceDoc('BASELINES.md', content);
      const boundOptionalSlots = getBoundOptionalProjectSlots(entrypoints).map(entry => entry.name);
      if (boundOptionalSlots.length > 0) {
        validateBaselineCoverageForBoundSlots(content, boundOptionalSlots);
      }
    },
  },
] as const;

const WORKFLOW_SYSTEM_SOURCE_ROOT = path.resolve(import.meta.dir, '..');
const SUSPENDED_TASK_PACKAGE_CHECK: SuspendedTaskPackageCheck = {
  entrypoint: 'suspended-task-package-validation',
  blocker_level: 'blocks-merge',
};
const INBOX_ARTIFACT_CHECK: InboxArtifactCheck = {
  entrypoint: 'inbox-artifact-validation',
  blocker_level: 'blocks-merge',
};
const WORKFLOW_GUIDE_CAPTURE_CHECK: WorkflowGuideCaptureCheck = {
  entrypoint: 'workflow-guide-capture-validation',
  blocker_level: 'blocks-merge',
};

function shouldRun(entrypoint: ValidationEntrypoint, maxBlockerLevel?: BlockerLevel): boolean {
  if (!maxBlockerLevel) return true;
  return BLOCKER_SEVERITY[entrypoint.blocker_level] >= BLOCKER_SEVERITY[maxBlockerLevel];
}

export function executeEntrypoint(
  entrypoint: ValidationEntrypoint,
  cwd: string,
  env?: NodeJS.ProcessEnv,
): ValidationResult {
  const parts = entrypoint.command.split(/\s+/);
  const result = spawnSync(parts[0], parts.slice(1), {
    cwd,
    encoding: 'utf8',
    env: env ?? process.env,
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

export function resolveEntrypointExecutionContext(
  entrypoint: ValidationEntrypoint,
  root: string,
): EntrypointExecutionContext {
  if (entrypoint.layer === 'protocol' && entrypoint.owner === 'workflow-system') {
    return {
      cwd: WORKFLOW_SYSTEM_SOURCE_ROOT,
      env: {
        ...process.env,
        WORKFLOW_SYSTEM_ROOT: root,
      },
    };
  }

  return { cwd: root };
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
  const profilePath = getWorkflowProfilePath(root);
  const profile = parse(readText(profilePath)) as Record<string, unknown>;
  const validation = profile.validation as Record<string, unknown> | undefined;
  if (!validation || !Array.isArray(validation.matrix)) {
    throw new Error('.workflow-system/PROJECT_PROFILE.yaml is missing validation.matrix array.');
  }
  return parseValidationMatrix(validation.matrix).entrypoints;
}

function getBoundProjectEntrypoints(entrypoints: readonly ValidationEntrypoint[]): ValidationEntrypoint[] {
  return entrypoints.filter(entry => entry.layer === 'project' && isEntrypointBound(entry));
}

function resolveGovernanceDocPath(root: string, file: LifecycleGovernanceDoc): string {
  const profile = loadProfile(getWorkflowProfilePath(root));
  const livePath = getWorkflowDocPath(root, profile, file);
  try {
    readText(livePath);
    return livePath;
  } catch {}

  const generatedPath = path.join(getWorkflowGeneratedDir(root, profile, 'workflow-docs'), file);
  try {
    readText(generatedPath);
    return generatedPath;
  } catch {}

  throw new Error(
    `Missing ${file} governance home. Expected live doc at ${livePath} or generated skeleton at ${generatedPath}.`,
  );
}

function getBoundOptionalProjectSlots(entrypoints: readonly ValidationEntrypoint[]): ValidationEntrypoint[] {
  return getBoundProjectEntrypoints(entrypoints).filter(entry =>
    ['performance', 'reliability', 'compatibility', 'security', 'deploy'].includes(entry.name),
  );
}

function buildProjectGovernanceHomeFailure(
  entrypoints: ValidationEntrypoint[],
  entrypoint: GovernanceHomeCheck['entrypoint'],
  error: Error,
): ValidationResult {
  const relevant = getBoundProjectEntrypoints(entrypoints);
  const blockerLevel = relevant.reduce<BlockerLevel>(
    (current, entry) =>
      BLOCKER_SEVERITY[entry.blocker_level] > BLOCKER_SEVERITY[current] ? entry.blocker_level : current,
    'warning-only',
  );

  return {
    entrypoint,
    layer: 'project',
    blocker_level: blockerLevel,
    status: 'failed',
    error: error.message,
  };
}

function buildPropagationGovernanceFailure(
  layer: ValidationLayer,
  blockerLevel: BlockerLevel,
  error: Error,
): ValidationResult {
  return {
    entrypoint: layer === 'protocol' ? 'propagation-governance-surface' : 'propagation-governance-home',
    layer,
    blocker_level: blockerLevel,
    status: 'failed',
    error: error.message,
  };
}

function listFilesRecursively(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const files: string[] = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const absolutePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursively(absolutePath));
      continue;
    }
    if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

function validateSuspendedTaskArtifacts(root: string): void {
  const artifactFiles = [
    ...listFilesRecursively(path.join(root, 'TASKS', 'paused')),
    ...listFilesRecursively(path.join(root, 'TASKS', 'interrupted')),
  ];

  for (const filePath of artifactFiles) {
    const relativePath = path.relative(root, filePath).replace(/\\/g, '/');
    if (parseSuspendedTaskArtifactPath(relativePath) === null) {
      throw new Error(
        `Stray suspended artifact detected at ${relativePath}; expected only TASKS/paused/TASK-<TASK_ID>-<TASK_SLUG>.md or TASKS/interrupted/TASK-<TASK_ID>-<TASK_SLUG>.md.`,
      );
    }

    validateSuspendedTaskPackage(relativePath, readText(filePath));
  }
}

function readArtifactKind(content: string): string | null {
  const match = /^\s*(?:-\s*)?artifact_kind\s*:\s*(.*?)\s*$/m.exec(content);
  return match?.[1]?.trim() || null;
}

function validateInboxCurrentTaskState(root: string): void {
  const profile = loadProfile(getWorkflowProfilePath(root));
  const currentTaskPath = getWorkflowDocPath(root, profile, 'CURRENT_TASK.md');
  if (!fs.existsSync(currentTaskPath)) {
    return;
  }

  const { lifecycleState } = extractCurrentTaskStateFromCurrentTask(readText(currentTaskPath));
  if (!lifecycleState) {
    return;
  }

  if (['capture', 'backlog_item', 'inbox_item'].includes(lifecycleState)) {
    throw new Error(
      'CURRENT_TASK.md lifecycle state must not use capture, backlog_item, or inbox_item; inbox artifacts are record-only and must stay outside the lifecycle tuple.',
    );
  }
}

function validateMisplacedInboxArchiveArtifacts(root: string): void {
  const taskRoot = path.join(root, 'TASKS');
  if (!fs.existsSync(taskRoot)) {
    return;
  }

  for (const entry of fs.readdirSync(taskRoot, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    const relativePath = path.join('TASKS', entry.name).replace(/\\/g, '/');
    if (!/^TASKS\/TASK-[0-9]{3,}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(relativePath)) {
      continue;
    }

    const artifactKind = readArtifactKind(readText(path.join(taskRoot, entry.name)));
    if (artifactKind === 'inbox_item') {
      throw new Error(
        `Inbox artifact must not be stored at ${relativePath}; use TASKS/inbox/INBOX-<YYYYMMDD>-<short-id>-<slug>.md instead.`,
      );
    }
  }
}

function validateInboxArtifacts(root: string): void {
  const artifactFiles = listFilesRecursively(path.join(root, 'TASKS', 'inbox'));

  for (const filePath of artifactFiles) {
    const relativePath = path.relative(root, filePath).replace(/\\/g, '/');
    if (parseInboxArtifactPath(relativePath) === null) {
      throw new Error(
        `Stray inbox artifact detected at ${relativePath}; expected only TASKS/inbox/INBOX-<YYYYMMDD>-<short-id>-<slug>.md.`,
      );
    }

    validateInboxArtifactPackage(relativePath, readText(filePath));
  }

  validateMisplacedInboxArchiveArtifacts(root);
  validateInboxCurrentTaskState(root);
}

function validateWorkflowGuideCapture(root: string): void {
  const profile = loadProfile(getWorkflowProfilePath(root));
  const generatedGuidePath = path.join(getWorkflowGeneratedDir(root, profile, 'workflow-docs'), 'WORKFLOW_GUIDE.md');
  if (!fs.existsSync(generatedGuidePath)) {
    return;
  }

  validateWorkflowGuideCaptureContract(readText(generatedGuidePath));
}

function buildSuspendedTaskPackageFailure(error: Error): ValidationResult {
  return {
    entrypoint: SUSPENDED_TASK_PACKAGE_CHECK.entrypoint,
    layer: 'protocol',
    blocker_level: SUSPENDED_TASK_PACKAGE_CHECK.blocker_level,
    status: 'failed',
    error: error.message,
  };
}

function buildInboxArtifactFailure(error: Error): ValidationResult {
  return {
    entrypoint: INBOX_ARTIFACT_CHECK.entrypoint,
    layer: 'protocol',
    blocker_level: INBOX_ARTIFACT_CHECK.blocker_level,
    status: 'failed',
    error: error.message,
  };
}

function buildWorkflowGuideCaptureFailure(error: Error): ValidationResult {
  return {
    entrypoint: WORKFLOW_GUIDE_CAPTURE_CHECK.entrypoint,
    layer: 'protocol',
    blocker_level: WORKFLOW_GUIDE_CAPTURE_CHECK.blocker_level,
    status: 'failed',
    error: error.message,
  };
}

function validateProjectGovernanceHomes(root: string, entrypoints: ValidationEntrypoint[]): ValidationResult[] {
  if (getBoundProjectEntrypoints(entrypoints).length === 0) {
    return [];
  }

  const failures: ValidationResult[] = [];
  for (const check of GOVERNANCE_HOME_CHECKS) {
    try {
      const docPath = resolveGovernanceDocPath(root, check.file);
      check.validateContent(readText(docPath), entrypoints);
    } catch (error) {
      failures.push(
        buildProjectGovernanceHomeFailure(
          entrypoints,
          check.entrypoint,
          error instanceof Error ? error : new Error(String(error)),
        ),
      );
    }
  }

  return failures;
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
  const thresholdProject = boundProject.filter(entry => shouldRun(entry, options.maxBlockerLevel));

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
    const execution = resolveEntrypointExecutionContext(entry, root);
    protocolResults.push(executeEntrypoint(entry, execution.cwd, execution.env));
  }

  if (options.layer !== 'project') {
    if (shouldRun(
      {
        name: SUSPENDED_TASK_PACKAGE_CHECK.entrypoint,
        layer: 'protocol',
        command: '',
        blocker_level: SUSPENDED_TASK_PACKAGE_CHECK.blocker_level,
        description: 'Validate suspended task packages and stray artifact paths.',
        phase: 'P9',
        owner: 'workflow-system',
      },
      options.maxBlockerLevel,
    )) {
      try {
        validateSuspendedTaskArtifacts(root);
      } catch (error) {
        protocolResults.push(
          buildSuspendedTaskPackageFailure(error instanceof Error ? error : new Error(String(error))),
        );
      }
    }

    if (shouldRun(
      {
        name: INBOX_ARTIFACT_CHECK.entrypoint,
        layer: 'protocol',
        command: '',
        blocker_level: INBOX_ARTIFACT_CHECK.blocker_level,
        description: 'Validate inbox artifacts, archive-path pollution, and lifecycle contamination.',
        phase: 'P9',
        owner: 'workflow-system',
      },
      options.maxBlockerLevel,
    )) {
      try {
        validateInboxArtifacts(root);
      } catch (error) {
        protocolResults.push(buildInboxArtifactFailure(error instanceof Error ? error : new Error(String(error))));
      }
    }

    if (shouldRun(
      {
        name: WORKFLOW_GUIDE_CAPTURE_CHECK.entrypoint,
        layer: 'protocol',
        command: '',
        blocker_level: WORKFLOW_GUIDE_CAPTURE_CHECK.blocker_level,
        description: 'Validate capture-work-item guide snippets when the guide exposes that branch.',
        phase: 'P9',
        owner: 'workflow-system',
      },
      options.maxBlockerLevel,
    )) {
      try {
        validateWorkflowGuideCapture(root);
      } catch (error) {
        protocolResults.push(
          buildWorkflowGuideCaptureFailure(error instanceof Error ? error : new Error(String(error))),
        );
      }
    }

    try {
      validatePropagationGovernanceDocs(root, 'protocol');
    } catch (error) {
      protocolResults.push(
        buildPropagationGovernanceFailure(
          'protocol',
          'blocks-merge',
          error instanceof Error ? error : new Error(String(error)),
        ),
      );
    }
  }

  // Check protocol pass before running project
  const protocolPassed = protocolResults.every(
    r => r.status === 'passed' || r.status === 'skipped' || r.blocker_level === 'warning-only',
  );

  const projectResults: ValidationResult[] = [];
  const governanceHomeFailures = options.layer === 'protocol'
    ? []
    : [
        ...validateProjectGovernanceHomes(root, thresholdProject),
        ...(() => {
          if (getBoundProjectEntrypoints(thresholdProject).length === 0) {
            return [];
          }
          try {
            validatePropagationGovernanceDocs(root, 'project');
            return [];
          } catch (error) {
            const relevant = getBoundProjectEntrypoints(thresholdProject);
            const blockerLevel = relevant.reduce<BlockerLevel>(
              (current, entry) =>
                BLOCKER_SEVERITY[entry.blocker_level] > BLOCKER_SEVERITY[current] ? entry.blocker_level : current,
              'warning-only',
            );
            return [
              buildPropagationGovernanceFailure(
                'project',
                blockerLevel,
                error instanceof Error ? error : new Error(String(error)),
              ),
            ];
          }
        })(),
      ];

  if (protocolPassed && governanceHomeFailures.length > 0) {
    projectResults.push(...governanceHomeFailures);
  }

  for (const entry of boundProject) {
    if (!shouldRun(entry, options.maxBlockerLevel)) {
      projectResults.push(skipResult(entry, `Blocker level ${entry.blocker_level} below threshold ${options.maxBlockerLevel}`));
      continue;
    }
    if (!protocolPassed) {
      projectResults.push(skipResult(entry, 'Protocol-level validation failed; project results are non-authoritative.'));
      continue;
    }
    if (governanceHomeFailures.length > 0) {
      projectResults.push(skipResult(entry, 'Project lifecycle governance home validation failed.'));
      continue;
    }
    if (options.dryRun) {
      projectResults.push(skipResult(entry, 'dry-run mode'));
      continue;
    }
    const execution = resolveEntrypointExecutionContext(entry, root);
    projectResults.push(executeEntrypoint(entry, execution.cwd, execution.env));
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
