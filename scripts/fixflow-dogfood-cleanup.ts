/**
 * Preserve one real prepare-task dogfood specimen, then restore FixFlow to
 * its committed baseline. This is deliberately target-specific operational
 * tooling: it never upgrades a Distribution or invokes a workflow Skill.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkTargetRoot, normalizeAbsoluteRootPath } from './guard-target-root';
import { isFrozenPath } from './vnext-migration-pack';

export const FIXFLOW_ROOT = 'E:\\coding\\dogfood\\fixflow';
export const CURRENT_TASK_PATH = 'docs/workflow/CURRENT_TASK.md';
export const TASK_BASIS_PATH = 'docs/workflow/task-basis/TASK_BASIS-001.md';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const CURRENT_TASK_STATUS = ` M ${CURRENT_TASK_PATH}`;
const TASK_BASIS_STATUS = `?? ${TASK_BASIS_PATH}`;
const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NODE_COMMAND = process.platform === 'win32' ? 'node.exe' : 'node';

export type FixflowDogfoodCleanupOptions = {
  version: string;
  apply: boolean;
  /** Standalone cleanup pushes by default; release orchestration may opt out. */
  push?: boolean;
};

type CommandResult = {
  command: string;
  status: number;
  stdout: string;
  stderr: string;
};

export type FixflowDogfoodCleanupReport = {
  target_root: string;
  version: string;
  branch: string;
  baseline_head: string;
  initial_status: string[];
  specimen_branch: string | null;
  specimen_commit: string | null;
  action: 'dry-run' | 'already-clean' | 'cleaned';
  validation: {
    validate_contract: 'not-run' | 'passed';
    validate: 'not-run' | 'passed';
  };
};

function fail(message: string): never {
  throw new Error(message);
}

function requireSemver(version: string): void {
  if (!SEMVER.test(version)) fail(`--version must be an exact x.y.z semantic version; received ${JSON.stringify(version)}.`);
}

function versionToken(version: string): string {
  requireSemver(version);
  return version.replaceAll('.', '');
}

export function expectedFixflowDogfoodBranch(version: string): RegExp {
  return new RegExp(`^dogfood/round[1-9]\\d*-v${versionToken(version)}$`, 'u');
}

export function specimenBranchName(version: string, date = new Date()): string {
  const yyyy = date.getFullYear().toString().padStart(4, '0');
  const mm = (date.getMonth() + 1).toString().padStart(2, '0');
  const dd = date.getDate().toString().padStart(2, '0');
  return `dogfood/prepare-task-v${versionToken(version)}-failure-specimen-${yyyy}${mm}${dd}`;
}

export function parseFixflowDogfoodCleanupArgs(args: string[]): FixflowDogfoodCleanupOptions | 'help' {
  let version: string | undefined;
  let apply = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--help' || arg === '-h') return 'help';
    if (arg === '--apply') {
      if (apply) fail('--apply was supplied more than once.');
      apply = true;
      continue;
    }
    if (arg === '--version') {
      if (version !== undefined) fail('--version was supplied more than once.');
      const value = args[index + 1];
      if (!value || value.startsWith('--')) fail('--version requires an exact x.y.z value.');
      version = value;
      index += 1;
      continue;
    }
    fail(`Unknown argument: ${arg}`);
  }

  if (!version) fail('--version is required.');
  requireSemver(version);
  return { version, apply };
}

export function isOnlyCurrentTaskWorktreeModification(statusLines: string[]): boolean {
  return statusLines.length === 1 && statusLines[0] === CURRENT_TASK_STATUS;
}

export function isOnlyPreparedTaskSpecimenModification(statusLines: string[]): boolean {
  return statusLines.length === 2
    && statusLines.includes(CURRENT_TASK_STATUS)
    && statusLines.includes(TASK_BASIS_STATUS);
}

function preparedTaskSpecimenPaths(statusLines: string[]): string[] | null {
  if (isOnlyCurrentTaskWorktreeModification(statusLines)) return [CURRENT_TASK_PATH];
  if (isOnlyPreparedTaskSpecimenModification(statusLines)) return [CURRENT_TASK_PATH, TASK_BASIS_PATH];
  return null;
}

export function splitPorcelainStatusOutput(output: string): string[] {
  // Porcelain v1 deliberately encodes an unstaged modification as a leading
  // space followed by M. Only trim the trailing line ending, never the start.
  const trimmedEnd = output.trimEnd();
  return trimmedEnd ? trimmedEnd.split(/\r?\n/u) : [];
}

export function assertBootstrapBaselineCurrentTask(content: string): void {
  const expectedFields: Array<[string, RegExp]> = [
    ['task_id = 000', /^\s*task_id:\s*["']?000["']?\s*$/mu],
    ['task_slug = bootstrap-baseline', /^\s*task_slug:\s*bootstrap-baseline\s*$/mu],
    ['workflow_status = closed', /^\s*workflow_status:\s*closed\s*$/mu],
    ['lifecycle_state = archived', /^\s*lifecycle_state:\s*archived\s*$/mu],
    ['execution_log = []', /^\s*execution_log:\s*\[\]\s*$/mu],
    ['applied_proposals = []', /^\s*applied_proposals:\s*\[\]\s*$/mu],
  ];
  const missing = expectedFields.filter(([, matcher]) => !matcher.test(content)).map(([description]) => description);
  if (missing.length > 0) fail(`HEAD ${CURRENT_TASK_PATH} is not the closed bootstrap baseline: ${missing.join(', ')}.`);
}

function commandDisplay(command: string, args: string[]): string {
  return [command, ...args.map(arg => JSON.stringify(arg))].join(' ');
}

function run(command: string, args: string[], cwd: string, allowFailure = false): CommandResult {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.error) fail(`Could not run ${commandDisplay(command, args)}: ${result.error.message}`);
  const commandResult: CommandResult = {
    command: commandDisplay(command, args),
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
  if (!allowFailure && commandResult.status !== 0) {
    const detail = [commandResult.stderr.trim(), commandResult.stdout.trim()].filter(Boolean).join('\n');
    fail(`${commandResult.command} failed with exit ${commandResult.status}.${detail ? `\n${detail}` : ''}`);
  }
  return commandResult;
}

function git(root: string, args: string[], allowFailure = false): CommandResult {
  return run('git', args, root, allowFailure);
}

function gitOutput(root: string, args: string[]): string {
  return git(root, args).stdout.trim();
}

function requireFile(filePath: string): void {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) fail(`Required file is missing: ${filePath}`);
}

function readJson(filePath: string, label: string): Record<string, unknown> {
  requireFile(filePath);
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(`${label} must be a JSON object.`);
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error) fail(`${label} is invalid: ${error.message}`);
    throw error;
  }
}

function expectObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function assertProfileAndReceipt(root: string): void {
  const profilePath = path.join(root, '.workflow-system', 'PROJECT_PROFILE.yaml');
  requireFile(profilePath);
  const profile = fs.readFileSync(profilePath, 'utf8');
  const expectedProfileFields: Array<[string, RegExp]> = [
    ['project.name = FixFlow', /^\s*name:\s*FixFlow\s*$/mu],
    ['project.slug = fixflow', /^\s*slug:\s*fixflow\s*$/mu],
    ['bootstrap_mode = greenfield', /^\s*bootstrap_mode:\s*greenfield\s*$/mu],
  ];
  const missing = expectedProfileFields.filter(([, matcher]) => !matcher.test(profile)).map(([description]) => description);
  if (missing.length > 0) fail(`FixFlow project profile does not match the dogfood baseline: ${missing.join(', ')}.`);

  const receipt = readJson(path.join(root, '.workflow-system', 'vnext', 'BOOTSTRAP_RECEIPT.json'), 'Bootstrap receipt');
  const project = expectObject(receipt.project, 'Bootstrap receipt.project');
  if (receipt.mode !== 'greenfield' || project.name !== 'FixFlow' || project.slug !== 'fixflow') {
    fail('Bootstrap receipt does not prove the expected FixFlow greenfield baseline.');
  }
}

function assertDistributionIdentity(root: string, version: string): void {
  const state = readJson(path.join(root, '.workflow-system', 'vnext', 'DISTRIBUTION_STATE.json'), 'Distribution state');
  if (state.distribution_state !== 'vnext' || state.distribution_version !== version) {
    fail(`Distribution identity must be vnext / ${version}.`);
  }

  const runtime = readJson(path.join(root, '.workflow-system', 'runtime', 'package.json'), 'Runtime package');
  if (runtime.version !== version) fail(`Runtime package version must be ${version}.`);

  const runtimeContract = path.join(root, '.workflow-system', 'vnext', 'RUNTIME_CONTRACT.yaml');
  requireFile(runtimeContract);
  if (!new RegExp(`^\\s*package_version:\\s*${version.replace(/\./gu, '\\.')}\\s*$`, 'mu').test(fs.readFileSync(runtimeContract, 'utf8'))) {
    fail(`Runtime contract package_version must be ${version}.`);
  }
}

function assertNoTask001(root: string): void {
  const result = git(root, ['grep', '-n', '-I', '-e', 'TASK-001', '-e', 'task-001', 'HEAD', '--', '.'], true);
  if (result.status === 0) fail(`HEAD must not contain TASK-001/task-001.\n${result.stdout.trim()}`);
  if (result.status !== 1) fail(`Could not check for TASK-001/task-001.\n${result.stderr.trim()}`);
}

function assertTargetRoot(root: string): void {
  if (normalizeAbsoluteRootPath(root) !== normalizeAbsoluteRootPath(FIXFLOW_ROOT)) {
    fail(`This cleanup is locked to ${FIXFLOW_ROOT}.`);
  }
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) fail(`FixFlow target root does not exist: ${root}`);
  const gitRoot = gitOutput(root, ['rev-parse', '--show-toplevel']);
  if (normalizeAbsoluteRootPath(gitRoot) !== normalizeAbsoluteRootPath(root)) fail(`FixFlow target must be its own Git root; got ${gitRoot}.`);
  const guard = checkTargetRoot(SOURCE_ROOT, root);
  if (!guard.allowed) fail(`Target root guard rejected FixFlow: ${guard.message}`);
}

function assertNoFreeze(root: string): void {
  if (isFrozenPath(root, CURRENT_TASK_PATH)) fail(`${CURRENT_TASK_PATH} is frozen; specimen preservation and restore are not allowed.`);
  if (isFrozenPath(root, TASK_BASIS_PATH)) fail(`${TASK_BASIS_PATH} is frozen; specimen preservation and restore are not allowed.`);
}

function localOrFetchedRemoteBranchExists(root: string, branch: string): boolean {
  const local = git(root, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], true);
  if (local.status !== 0 && local.status !== 1) fail(`Could not inspect local specimen branch ${branch}.`);
  const fetchedRemote = git(root, ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${branch}`], true);
  if (fetchedRemote.status !== 0 && fetchedRemote.status !== 1) fail(`Could not inspect fetched remote specimen branch ${branch}.`);
  return local.status === 0 || fetchedRemote.status === 0;
}

function assertRemoteBranchAbsent(root: string, branch: string): void {
  const result = git(root, ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`]);
  if (result.stdout.trim().length > 0) fail(`Remote specimen branch already exists: origin/${branch}.`);
}

function runRuntimeValidation(root: string, command: 'validate-contract' | 'validate'): void {
  const entrypoint = path.join(root, '.workflow-system', 'runtime', 'dist', 'cli.js');
  requireFile(entrypoint);
  run(NODE_COMMAND, [entrypoint, command, '--root', root], root);
}

export function recoverInterruptedSpecimenCapture(version: string): boolean {
  const root = path.resolve(FIXFLOW_ROOT);
  assertTargetRoot(root);
  assertNoFreeze(root);
  const specimenBranch = specimenBranchName(version);
  const baselineCandidates = git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']).stdout.trim().split(/\r?\n/u)
    .filter(branch => branch && expectedFixflowDogfoodBranch(version).test(branch));
  if (baselineCandidates.length !== 1) fail(`Could not resolve one baseline dogfood branch for ${version}; found ${baselineCandidates.join(', ') || '(none)'}.`);
  const baselineBranch = baselineCandidates[0]!;
  const currentBranch = gitOutput(root, ['branch', '--show-current']);
  if (currentBranch !== specimenBranch) return false;
  const baselineHead = gitOutput(root, ['rev-parse', baselineBranch]);
  const status = splitPorcelainStatusOutput(git(root, ['status', '--porcelain=v1', '--untracked-files=all']).stdout);
  if (status.length > 0) {
    const stagedCurrentOnly = status.length === 1 && status[0] === `M  ${CURRENT_TASK_PATH}`;
    const stagedPair = status.length === 2
      && status.includes(`M  ${CURRENT_TASK_PATH}`)
      && status.includes(`A  ${TASK_BASIS_PATH}`);
    if (!stagedCurrentOnly && !stagedPair) {
      fail(`Interrupted specimen branch ${specimenBranch} has unexpected worktree state: ${status.join(', ')}`);
    }
    git(root, ['commit', '-m', `dogfood: capture v${version} prepare-task failure specimen`]);
  }
  const specimenParent = gitOutput(root, ['rev-parse', 'HEAD^']);
  if (specimenParent !== baselineHead) fail(`Interrupted specimen parent changed unexpectedly: expected ${baselineHead}, got ${specimenParent}.`);
  git(root, ['switch', baselineBranch]);
  if (gitOutput(root, ['rev-parse', 'HEAD']) !== baselineHead) fail('Baseline branch HEAD changed while recovering the interrupted specimen.');
  git(root, ['restore', '--source=HEAD', '--', CURRENT_TASK_PATH]);
  const finalStatus = git(root, ['status', '--porcelain=v1', '--untracked-files=all']).stdout.trim();
  if (finalStatus) fail(`FixFlow is not clean after recovering ${CURRENT_TASK_PATH}: ${finalStatus}`);
  runRuntimeValidation(root, 'validate-contract');
  runRuntimeValidation(root, 'validate');
  return true;
}

function validatePreflight(options: FixflowDogfoodCleanupOptions): Omit<FixflowDogfoodCleanupReport, 'specimen_branch' | 'specimen_commit' | 'action' | 'validation'> & { clean: boolean } {
  const root = path.resolve(FIXFLOW_ROOT);
  assertTargetRoot(root);
  assertNoFreeze(root);

  const branch = gitOutput(root, ['branch', '--show-current']);
  if (!expectedFixflowDogfoodBranch(options.version).test(branch)) {
    fail(`FixFlow must be on a dogfood round branch for ${options.version}; current branch is ${branch || '(detached HEAD)'}.`);
  }
  const baselineHead = gitOutput(root, ['rev-parse', 'HEAD']);
  const initialStatus = splitPorcelainStatusOutput(git(root, ['status', '--porcelain=v1', '--untracked-files=all']).stdout);
  const clean = initialStatus.length === 0;
  if (!clean && preparedTaskSpecimenPaths(initialStatus) === null) {
    fail(`Refusing to clean: expected a clean tree, ${CURRENT_TASK_STATUS}, or the exact CURRENT_TASK + Task Basis pair; got ${initialStatus.join(', ') || '(unparseable status)'}.`);
  }

  assertDistributionIdentity(root, options.version);
  assertProfileAndReceipt(root);
  assertBootstrapBaselineCurrentTask(git(root, ['show', `HEAD:${CURRENT_TASK_PATH}`]).stdout);
  assertNoTask001(root);

  return {
    target_root: root,
    version: options.version,
    branch,
    baseline_head: baselineHead,
    initial_status: initialStatus,
    clean,
  };
}

export function cleanupFixflowDogfood(options: FixflowDogfoodCleanupOptions): FixflowDogfoodCleanupReport {
  const preflight = validatePreflight(options);
  const { clean, ...reportBase } = preflight;
  const validation = { validate_contract: 'not-run', validate: 'not-run' } as const;
  if (clean) {
    return {
      ...reportBase,
      specimen_branch: null,
      specimen_commit: null,
      action: 'already-clean',
      validation,
    };
  }

  const specimenBranch = specimenBranchName(options.version);
  if (localOrFetchedRemoteBranchExists(preflight.target_root, specimenBranch)) {
    fail(`Specimen branch already exists locally or in fetched origin refs: ${specimenBranch}.`);
  }
  if (!options.apply) {
    return {
      ...reportBase,
      specimen_branch: specimenBranch,
      specimen_commit: null,
      action: 'dry-run',
      validation,
    };
  }

  // Only standalone cleanup needs the actual remote check. The release
  // orchestrator deliberately preserves its specimen locally without push.
  if (options.push ?? true) assertRemoteBranchAbsent(preflight.target_root, specimenBranch);
  git(preflight.target_root, ['switch', '-c', specimenBranch]);
  const specimenPaths = preparedTaskSpecimenPaths(preflight.initial_status);
  if (!specimenPaths) fail('Prepared-task specimen paths changed after preflight.');
  git(preflight.target_root, ['add', '--', ...specimenPaths]);
  // CURRENT_TASK.md and its linked Task Basis are the user-owned failure specimen. Preserve their exact
  // bytes, including intentional trailing blank lines; generic whitespace
  // checks must not reject the artifact being captured.
  git(preflight.target_root, ['commit', '-m', `dogfood: capture v${options.version} prepare-task failure specimen`]);

  const specimenCommit = gitOutput(preflight.target_root, ['rev-parse', 'HEAD']);
  const specimenParent = gitOutput(preflight.target_root, ['rev-parse', 'HEAD^']);
  if (specimenParent !== preflight.baseline_head) fail(`Specimen commit parent changed unexpectedly: expected ${preflight.baseline_head}, got ${specimenParent}.`);
  const changedPaths = git(preflight.target_root, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']).stdout.trim().split(/\r?\n/u).filter(Boolean);
  if (changedPaths.length !== specimenPaths.length || specimenPaths.some(item => !changedPaths.includes(item))) {
    fail(`Specimen commit must contain only ${specimenPaths.join(', ')}; got ${changedPaths.join(', ') || '(none)'}.`);
  }

  // When enabled, pushing is intentionally before restore: a failed push
  // leaves the specimen committed on its own local branch and leaves the
  // baseline file untouched. The release orchestrator can deliberately keep
  // both commits local with push=false.
  if (options.push ?? true) git(preflight.target_root, ['push', 'origin', specimenBranch]);
  git(preflight.target_root, ['switch', preflight.branch]);
  if (gitOutput(preflight.target_root, ['rev-parse', 'HEAD']) !== preflight.baseline_head) {
    fail(`Baseline branch HEAD changed unexpectedly after specimen capture.`);
  }
  git(preflight.target_root, ['restore', '--source=HEAD', '--', CURRENT_TASK_PATH]);

  const finalStatus = git(preflight.target_root, ['status', '--porcelain=v1', '--untracked-files=all']).stdout.trim();
  if (finalStatus) fail(`FixFlow is not clean after restoring ${CURRENT_TASK_PATH}: ${finalStatus}`);
  runRuntimeValidation(preflight.target_root, 'validate-contract');
  runRuntimeValidation(preflight.target_root, 'validate');

  return {
    ...reportBase,
    specimen_branch: specimenBranch,
    specimen_commit: specimenCommit,
    action: 'cleaned',
    validation: { validate_contract: 'passed', validate: 'passed' },
  };
}

export function fixflowDogfoodCleanupUsage(): string {
  return [
    'Usage:',
    '  bun run dogfood:fixflow:cleanup -- --version <x.y.z>',
    '  bun run dogfood:fixflow:cleanup -- --version <x.y.z> --apply',
    '',
    `The target is fixed to ${FIXFLOW_ROOT}.`,
    'Without --apply, perform the full read-only preflight and print the specimen branch that would be created.',
    '--apply preserves exactly docs/workflow/CURRENT_TASK.md and its linked TASK_BASIS-001.md when present in a new specimen branch, pushes it by default, then restores the baseline worktree.',
  ].join('\n');
}

if (import.meta.main) {
  try {
    const options = parseFixflowDogfoodCleanupArgs(process.argv.slice(2));
    if (options === 'help') {
      console.log(fixflowDogfoodCleanupUsage());
    } else {
      console.log(JSON.stringify(cleanupFixflowDogfood(options), null, 2));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`FIXFLOW DOGFOOD CLEANUP: FAIL\n${message}`);
    process.exitCode = 1;
  }
}
