/**
 * Publish one committed local Vibe Governance release candidate into FixFlow.
 * The target is fixed deliberately: this is dogfood release tooling, not a
 * general-purpose installer.
 */

import { spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDistributionVersionLockstep } from './build-vibe-governance-distribution';
import { FIXFLOW_ROOT, cleanupFixflowDogfood, recoverInterruptedSpecimenCapture, splitPorcelainStatusOutput } from './fixflow-dogfood-cleanup';
import { isFrozenPath } from './vnext-migration-pack';

const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_ROOT = path.join(SOURCE_ROOT, 'packages', 'vibe-governance');
const ARTIFACT_ROOT = 'E:\\coding\\dogfood-artifacts\\vibe-governance';
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const CURRENT_BRANCH = /^dogfood\/round([1-9]\d*)-v(\d+)$/u;
const NODE_COMMAND = process.platform === 'win32' ? 'node.exe' : 'node';
const NPM_COMMAND = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const RELEASE_SCRIPT_PATHS = new Set([
  'scripts/build-vibe-governance-distribution.ts',
  'scripts/guard-target-root.ts',
  'scripts/vibe-governance-distribution.ts',
  'scripts/vnext-migration-pack.ts',
  'scripts/vnext-runtime.ts',
]);
const SOURCE_VERSION_PATHS = [
  'VERSION',
  'package.json',
  'packages/vibe-governance/package.json',
  'runtime/vnext/package.json',
  'runtime/vnext/package-lock.json',
  '.workflow-system/vnext/RUNTIME_CONTRACT.yaml',
  'runtime/vnext/src/kernel.ts',
  'docs/workflow/BASELINES.md',
  'docs/workflow/ROADMAP.md',
  'docs/workflow/STATUS.md',
] as const;
const SOURCE_COMMIT_PATHS = [
  ...SOURCE_VERSION_PATHS,
  'runtime/vnext/dist/cli.js',
  'docs/workflow/generated',
  'docs/workflow/SKILL_REGISTRY.md',
] as const;
const SOURCE_FREEZE_PATHS = [
  ...SOURCE_VERSION_PATHS,
  'runtime/vnext/dist/cli.js',
  'docs/workflow/generated',
  'docs/workflow/SKILL_REGISTRY.md',
] as const;

type CommandResult = {
  command: string;
  status: number;
  stdout: string;
  stderr: string;
};

export type FixflowDogfoodUpgradeOptions = {
  version: string;
  apply: boolean;
};

export type FixflowDogfoodPathClassification = {
  A_distribution_managed: string[];
  B_runtime_dependency: string[];
  C_governance: string[];
  D_product: string[];
  E_unknown: string[];
};

export type FixflowDogfoodUpgradeReport = {
  target_root: string;
  source_head: string;
  source_before_version: string;
  source_version: string;
  source_release_commit: string | null;
  target_from_version: string;
  baseline_branch: string;
  baseline_head: string;
  upgrade_branch: string;
  tarball: string | null;
  tarball_sha256: string | null;
  action: 'dry-run' | 'upgraded';
  specimen_branch: string | null;
  upgrade_commit: string | null;
  manifest_digest: string | null;
  ownership: FixflowDogfoodPathClassification | null;
};

type SourceReleaseIdentity = {
  head: string;
  version: string;
};

type SourceReleaseStart = {
  source: SourceReleaseIdentity;
  initialNonReleaseStatus: string[];
  resumeVersionBump: boolean;
};

type SourceVersionUpdate = {
  relativePath: string;
  content: string;
};

function fail(message: string): never {
  throw new Error(message);
}

function requireSemver(version: string): void {
  if (!SEMVER.test(version)) fail(`--version must be an exact x.y.z semantic version; received ${JSON.stringify(version)}.`);
}

export function versionRegexLiteral(version: string): string {
  requireSemver(version);
  return version.replaceAll('.', '\\.');
}

function versionToken(version: string): string {
  requireSemver(version);
  return version.replaceAll('.', '');
}

export function nextFixflowDogfoodBranch(currentBranch: string, fromVersion: string, toVersion: string): string {
  const match = CURRENT_BRANCH.exec(currentBranch);
  if (!match || match[2] !== versionToken(fromVersion)) {
    fail(`Current FixFlow branch ${currentBranch || '(detached HEAD)'} does not identify dogfood version ${fromVersion}.`);
  }
  const round = Number(match[1]);
  return `dogfood/round${round + 1}-v${versionToken(toVersion)}`;
}

export function parseFixflowDogfoodUpgradeArgs(args: string[]): FixflowDogfoodUpgradeOptions | 'help' {
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

function commandFailureDetail(result: CommandResult): string {
  return [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n');
}

function runWithBuildWriteRetry(command: string, args: string[], cwd: string): CommandResult {
  let result = run(command, args, cwd, true);
  for (let attempt = 1; attempt < 3 && result.status !== 0; attempt += 1) {
    if (!/EUNKNOWN:\s*failed to write file/iu.test(commandFailureDetail(result))) break;
    result = run(command, args, cwd, true);
  }
  if (result.status !== 0) {
    const detail = commandFailureDetail(result);
    fail(`${result.command} failed with exit ${result.status}.${detail ? `\n${detail}` : ''}`);
  }
  return result;
}

function git(root: string, args: string[], allowFailure = false): CommandResult {
  return run('git', args, root, allowFailure);
}

function gitOutput(root: string, args: string[]): string {
  return git(root, args).stdout.trim();
}

function readHeadFile(relativePath: string): string {
  return git(SOURCE_ROOT, ['show', `HEAD:${relativePath}`]).stdout;
}

function readHeadJson(relativePath: string, label: string): Record<string, unknown> {
  return parseJsonText(readHeadFile(relativePath), label);
}

function parseJsonText(text: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail(`${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(`${label} must be a JSON object.`);
  return parsed as Record<string, unknown>;
}

function readJson(filePath: string, label: string): Record<string, unknown> {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) fail(`${label} is missing: ${filePath}`);
  return parseJsonText(fs.readFileSync(filePath, 'utf8'), label);
}

function sha256(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function compareVersions(left: string, right: string): number {
  requireSemver(left);
  requireSemver(right);
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index]! - b[index]!;
  }
  return 0;
}

export function isReleaseSurfacePath(relativePath: string): boolean {
  return relativePath === 'VERSION'
    || relativePath === 'package.json'
    || relativePath.startsWith('.workflow-system/vnext/')
    || relativePath.startsWith('runtime/vnext/')
    || relativePath.startsWith('templates/vnext/')
    || relativePath.startsWith('templates/skills/')
    || relativePath.startsWith('packages/vibe-governance/')
    || RELEASE_SCRIPT_PATHS.has(relativePath);
}

function releaseSurfaceChanges(): string[] {
  return splitPorcelainStatusOutput(git(SOURCE_ROOT, ['status', '--porcelain=v1', '--untracked-files=all']).stdout)
    .filter(line => isSourceCommitPath(line.slice(3).replace(/\\/gu, '/')));
}

function nonReleaseSourceStatus(): string[] {
  return splitPorcelainStatusOutput(git(SOURCE_ROOT, ['status', '--porcelain=v1', '--untracked-files=all']).stdout)
    .filter(line => !isSourceCommitPath(line.slice(3).replace(/\\/gu, '/')));
}

function assertSourceCommitSetClean(): void {
  const changed = splitPorcelainStatusOutput(git(SOURCE_ROOT, ['status', '--porcelain=v1', '--untracked-files=all']).stdout);
  const stagedByRelease = changed.filter(line => isSourceCommitPath(line.slice(3).replace(/\\/gu, '/')));
  if (stagedByRelease.length > 0) fail(`Source release commit paths must be clean before an automatic version bump.\n${stagedByRelease.join('\n')}`);
}

function readSourceReleaseIdentity(): SourceReleaseIdentity {
  const sourceStatus = releaseSurfaceChanges();
  if (sourceStatus.length > 0) fail(`The Vibe Governance release surface must be committed and clean before building a pinned tarball.\n${sourceStatus.join('\n')}`);
  assertSourceCommitSetClean();
  const versionFile = fs.readFileSync(path.join(SOURCE_ROOT, 'VERSION'), 'utf8').trim();
  const rootPackage = readJson(path.join(SOURCE_ROOT, 'package.json'), 'Root package');
  const lockstepVersion = validateDistributionVersionLockstep(SOURCE_ROOT);
  if (versionFile !== rootPackage.version || versionFile !== lockstepVersion) {
    fail(`Source release versions must already be lockstep; VERSION=${versionFile}, root=${String(rootPackage.version)}, Distribution/Runtime=${lockstepVersion}.`);
  }
  return { head: gitOutput(SOURCE_ROOT, ['rev-parse', 'HEAD']), version: versionFile };
}

function readSourceReleaseHeadIdentity(): SourceReleaseIdentity {
  const versionFile = readHeadFile('VERSION').trim();
  requireSemver(versionFile);
  const rootPackage = readHeadJson('package.json', 'Committed root package');
  const distributionPackage = readHeadJson('packages/vibe-governance/package.json', 'Committed Distribution package');
  const runtimePackage = readHeadJson('runtime/vnext/package.json', 'Committed Runtime package');
  const runtimeLock = readHeadJson('runtime/vnext/package-lock.json', 'Committed Runtime lockfile');
  const lockPackages = runtimeLock.packages;
  const lockRoot = lockPackages && typeof lockPackages === 'object' && !Array.isArray(lockPackages)
    ? (lockPackages as Record<string, unknown>)['']
    : undefined;
  const lockVersion = lockRoot && typeof lockRoot === 'object' && !Array.isArray(lockRoot)
    ? (lockRoot as Record<string, unknown>).version
    : undefined;
  if (rootPackage.version !== versionFile || distributionPackage.version !== versionFile || runtimePackage.version !== versionFile || runtimeLock.version !== versionFile || lockVersion !== versionFile) {
    fail(`Committed source release versions are not lockstep at ${versionFile}.`);
  }
  return { head: gitOutput(SOURCE_ROOT, ['rev-parse', 'HEAD']), version: versionFile };
}

function readSourceReleaseStart(requestedVersion: string, apply: boolean): SourceReleaseStart {
  const initialNonReleaseStatus = nonReleaseSourceStatus();
  const sourceStatus = releaseSurfaceChanges();
  if (sourceStatus.length === 0) {
    return { source: readSourceReleaseIdentity(), initialNonReleaseStatus, resumeVersionBump: false };
  }
  const nonPlainModifications = sourceStatus.filter(line => !/^ [MD] /u.test(line) && !/^\?\? /u.test(line));
  if (nonPlainModifications.length > 0) {
    fail(`Source release changes can include only ordinary unstaged modifications, deletions, or new release-surface files; resolve staged paths first.\n${nonPlainModifications.join('\n')}`);
  }
  const source = readSourceReleaseHeadIdentity();
  const fromVersion = source.version;
  requireSemver(fromVersion);
  if (compareVersions(fromVersion, requestedVersion) >= 0) {
    fail(`Committed source release is already at ${fromVersion}; requested version must be newer.`);
  }
  planSourceVersionBump(fromVersion, requestedVersion, relativePath => fs.readFileSync(path.join(SOURCE_ROOT, relativePath), 'utf8'));
  return { source, initialNonReleaseStatus, resumeVersionBump: apply };
}

function assertSourceStillCleanAfterBuild(): void {
  const sourceStatus = releaseSurfaceChanges();
  if (sourceStatus.length > 0) fail(`Release build changed the Vibe Governance release surface. Commit the regenerated release outputs before retrying.\n${sourceStatus.join('\n')}`);
}

function assertSourceVersionPathsNotFrozen(): void {
  const frozen = SOURCE_FREEZE_PATHS.filter(relativePath => isFrozenPath(SOURCE_ROOT, relativePath));
  if (frozen.length > 0) fail(`Source release version paths are frozen: ${frozen.join(', ')}.`);
}

function replaceOne(text: string, matcher: RegExp, replacement: string, label: string): string {
  const flags = matcher.flags.includes('g') ? matcher.flags : `${matcher.flags}g`;
  const matches = [...text.matchAll(new RegExp(matcher.source, flags))];
  if (matches.length !== 1) fail(`${label} must contain exactly one replaceable version value.`);
  return text.replace(matcher, replacement);
}

function replaceVersionOrKeep(text: string, fromVersionPattern: string, toVersionPattern: string, field: 'package_version' | 'VNEXT_RUNTIME_PACKAGE_VERSION' | '- 当前版本：', replacement: string, label: string): string {
  const matcher = (versionPattern: string): RegExp => {
    if (field === 'package_version') return new RegExp(`^([\\t ]*package_version:[\\t ]*)${versionPattern}[\\t ]*$`, 'mu');
    if (field === 'VNEXT_RUNTIME_PACKAGE_VERSION') return new RegExp(`(VNEXT_RUNTIME_PACKAGE_VERSION\\s*=\\s*['\"])${versionPattern}(['\"])`, 'u');
    return new RegExp(`^([\\t ]*- 当前版本：)${versionPattern}[\\t ]*$`, 'mu');
  };
  const current = matcher(toVersionPattern);
  const previous = matcher(fromVersionPattern);
  const targetFlags = current.flags.includes('g') ? current.flags : `${current.flags}g`;
  const previousFlags = previous.flags.includes('g') ? previous.flags : `${previous.flags}g`;
  const targetMatches = [...text.matchAll(new RegExp(current.source, targetFlags))].length;
  const previousMatches = [...text.matchAll(new RegExp(previous.source, previousFlags))].length;
  if (targetMatches === 1 && previousMatches === 0) return text;
  return replaceOne(text, previous, replacement, label);
}

function updateJsonVersionText(relativePath: string, text: string, fromVersion: string, toVersion: string, updateLockRoot = false): string {
  const document = parseJsonText(text, relativePath);
  if (document.version !== fromVersion && document.version !== toVersion) fail(`${relativePath}.version must equal ${fromVersion} or ${toVersion} before release bump.`);
  if (document.version === toVersion) {
    if (updateLockRoot) {
      const packages = document.packages;
      const rootPackage = packages && typeof packages === 'object' && !Array.isArray(packages)
        ? (packages as Record<string, unknown>)['']
        : undefined;
      if (!rootPackage || typeof rootPackage !== 'object' || Array.isArray(rootPackage) || (rootPackage as Record<string, unknown>).version !== toVersion) {
        fail(`${relativePath}.packages[\"\"].version must equal ${toVersion} when the lockfile is already bumped.`);
      }
    }
    return text;
  }
  document.version = toVersion;
  if (updateLockRoot) {
    const packages = document.packages;
    if (!packages || typeof packages !== 'object' || Array.isArray(packages)) fail(`${relativePath}.packages must be an object.`);
    const rootPackage = (packages as Record<string, unknown>)[''];
    if (!rootPackage || typeof rootPackage !== 'object' || Array.isArray(rootPackage) || (rootPackage as Record<string, unknown>).version !== fromVersion) {
      fail(`${relativePath}.packages[\"\"].version must equal ${fromVersion} before release bump.`);
    }
    (rootPackage as Record<string, unknown>).version = toVersion;
  }
  return `${JSON.stringify(document, null, 2)}\n`;
}

function planSourceVersionBump(fromVersion: string, toVersion: string, readFile: (relativePath: string) => string): SourceVersionUpdate[] {
  const versionText = readFile('VERSION');
  const versionValue = versionText.trim();
  if (versionValue !== fromVersion && versionValue !== toVersion) fail(`VERSION must equal ${fromVersion} or ${toVersion} before release bump.`);
  const updates: SourceVersionUpdate[] = [{ relativePath: 'VERSION', content: versionValue === toVersion ? versionText : `${toVersion}\n` }];
  for (const [relativePath, updateLockRoot] of [
    ['package.json', false],
    ['packages/vibe-governance/package.json', false],
    ['runtime/vnext/package.json', false],
    ['runtime/vnext/package-lock.json', true],
  ] as const) {
    updates.push({ relativePath, content: updateJsonVersionText(relativePath, readFile(relativePath), fromVersion, toVersion, updateLockRoot) });
  }
  const contractPath = '.workflow-system/vnext/RUNTIME_CONTRACT.yaml';
  updates.push({
    relativePath: contractPath,
    content: replaceVersionOrKeep(readFile(contractPath), versionRegexLiteral(fromVersion), versionRegexLiteral(toVersion), 'package_version', `$1${toVersion}`, 'Runtime contract'),
  });
  const kernelPath = 'runtime/vnext/src/kernel.ts';
  updates.push({
    relativePath: kernelPath,
    content: replaceVersionOrKeep(readFile(kernelPath), versionRegexLiteral(fromVersion), versionRegexLiteral(toVersion), 'VNEXT_RUNTIME_PACKAGE_VERSION', `$1${toVersion}$2`, 'Runtime source'),
  });
  for (const relativePath of ['docs/workflow/BASELINES.md', 'docs/workflow/ROADMAP.md', 'docs/workflow/STATUS.md']) {
    updates.push({
      relativePath,
      content: replaceVersionOrKeep(readFile(relativePath), versionRegexLiteral(fromVersion), versionRegexLiteral(toVersion), '- 当前版本：', `$1${toVersion}`, relativePath),
    });
  }
  return updates;
}

function applySourceVersionBump(fromVersion: string, toVersion: string, resume: boolean): void {
  void resume;
  assertSourceVersionPathsNotFrozen();
  const updates = planSourceVersionBump(fromVersion, toVersion, relativePath => fs.readFileSync(path.join(SOURCE_ROOT, relativePath), 'utf8'));
  for (const update of updates) fs.writeFileSync(path.join(SOURCE_ROOT, update.relativePath), update.content, 'utf8');
}

function isSourceCommitPath(relativePath: string): boolean {
  return SOURCE_VERSION_PATHS.includes(relativePath as typeof SOURCE_VERSION_PATHS[number])
    || relativePath === 'runtime/vnext/dist/cli.js'
    || relativePath === 'docs/workflow/SKILL_REGISTRY.md'
    || relativePath.startsWith('docs/workflow/generated/')
    || isReleaseSurfacePath(relativePath);
}

function validateAndCommitSourceRelease(fromVersion: string, toVersion: string, initialNonReleaseStatus: string[], resumeVersionBump: boolean): string {
  applySourceVersionBump(fromVersion, toVersion, resumeVersionBump);
  for (const [command, args] of [
    ['bun', ['run', 'gen:all']],
    ['bun', ['run', 'build:vnext-runtime']],
    ['bun', ['run', 'validate:vnext-source']],
    ['bun', ['run', 'validate:vnext-runtime']],
    ['bun', ['run', 'validate:protocol']],
    ['bun', ['run', 'validate:freshness']],
    ['bun', ['run', 'test:workflow-all']],
    ['bun', ['run', 'workflow:health', '--root', '.']],
  ] as const) {
    if (command === 'bun' && args[0] === 'run' && args[1] === 'validate:vnext-runtime') runWithBuildWriteRetry(command, [...args], SOURCE_ROOT);
    else run(command, [...args], SOURCE_ROOT);
  }

  const changed = splitPorcelainStatusOutput(git(SOURCE_ROOT, ['status', '--porcelain=v1', '--untracked-files=all']).stdout);
  const initialNonRelease = new Set(initialNonReleaseStatus);
  const unexpected = changed.filter(line => !isSourceCommitPath(line.slice(3).replace(/\\/gu, '/')) && !initialNonRelease.has(line));
  if (unexpected.length > 0) fail(`Source release generation changed paths outside its committed release set: ${unexpected.join(', ')}.`);
  const pathsToStage = new Set<string>(SOURCE_COMMIT_PATHS);
  for (const line of changed) {
    const relativePath = line.slice(3).replace(/\\/gu, '/');
    if (isSourceCommitPath(relativePath)) pathsToStage.add(relativePath);
  }
  git(SOURCE_ROOT, ['add', '--', ...pathsToStage]);
  git(SOURCE_ROOT, ['diff', '--cached', '--check']);
  git(SOURCE_ROOT, ['commit', '-m', `chore: release Vibe Governance ${toVersion}`]);
  return gitOutput(SOURCE_ROOT, ['rev-parse', 'HEAD']);
}

function readTargetDistributionVersion(): string {
  const state = readJson(path.join(FIXFLOW_ROOT, '.workflow-system', 'vnext', 'DISTRIBUTION_STATE.json'), 'FixFlow Distribution state');
  if (state.distribution_state !== 'vnext' || typeof state.distribution_version !== 'string') fail('FixFlow must have a valid vNext Distribution state.');
  requireSemver(state.distribution_version);
  return state.distribution_version;
}

function assertBranchAbsent(root: string, branch: string, checkRemote: boolean): void {
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
    const result = git(root, ['show-ref', '--verify', '--quiet', ref], true);
    if (result.status === 0) fail(`Target dogfood branch already exists: ${ref}.`);
    if (result.status !== 1) fail(`Could not inspect ${ref}.`);
  }
  if (checkRemote) {
    const remote = git(root, ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`]);
    if (remote.stdout.trim()) fail(`Target dogfood branch already exists in origin: ${branch}.`);
  }
}

function buildPinnedTarball(version: string): { tarball: string; sha256: string; manifest: Record<string, unknown> } {
  run('bun', ['run', 'build:vibe-governance-distribution'], SOURCE_ROOT);
  if (validateDistributionVersionLockstep(SOURCE_ROOT) !== version) fail(`Distribution build did not retain requested version ${version}.`);
  assertSourceStillCleanAfterBuild();
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), `vibe-governance-${version}-`));
  try {
    const packed = run(NPM_COMMAND, ['pack', '--json', '--pack-destination', staging], PACKAGE_ROOT);
    const entries = JSON.parse(packed.stdout) as Array<{ filename?: unknown }>;
    const filename = entries[0]?.filename;
    if (typeof filename !== 'string' || !filename.endsWith('.tgz')) fail('npm pack did not report a tarball filename.');
    const stagedTarball = path.join(staging, filename);
    if (!fs.existsSync(stagedTarball)) fail(`npm pack did not create ${stagedTarball}.`);
    const stagedHash = sha256(stagedTarball);
    const artifactDir = path.join(ARTIFACT_ROOT, version);
    const tarball = path.join(artifactDir, `vibe-governance-${version}.tgz`);
    if (fs.existsSync(tarball)) {
      if (sha256(tarball) !== stagedHash) {
        fail(`Pinned tarball already exists with different bytes: ${tarball}. Bump the release version; this script never overwrites a fixed artifact.`);
      }
    } else {
      fs.mkdirSync(artifactDir, { recursive: true });
      fs.copyFileSync(stagedTarball, tarball);
    }
    const manifest = readJson(path.join(PACKAGE_ROOT, 'payload', 'distribution-manifest.json'), 'Built Distribution manifest');
    if (manifest.distribution_version !== version) fail(`Built manifest version must be ${version}.`);
    return { tarball, sha256: stagedHash, manifest };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function runPublishedBinUpgrade(tarball: string): void {
  const npmRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fixflow-vibe-governance-npm-'));
  try {
    run(NPM_COMMAND, ['init', '-y', '--silent'], npmRoot);
    run(NPM_COMMAND, ['pkg', 'set', 'name=fixflow-vibe-governance-upgrade', 'version=1.0.0', 'private=true', '--silent'], npmRoot);
    run(NPM_COMMAND, ['install', '--no-audit', '--no-fund', '--ignore-scripts', '--silent', tarball], npmRoot);
    const bin = path.join(npmRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'vibe-governance.cmd' : 'vibe-governance');
    if (!fs.existsSync(bin)) fail(`Published-bin was not installed: ${bin}`);
    const result = run(bin, ['upgrade', '--root', FIXFLOW_ROOT, '--json'], npmRoot);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(result.stdout) as Record<string, unknown>;
    } catch (error) {
      fail(`Published-bin upgrade did not emit JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (body.status !== 'upgraded' || body.read_back_verified !== true) {
      fail(`Published-bin upgrade must return status=upgraded and read_back_verified=true; got ${JSON.stringify(body)}.`);
    }
  } finally {
    fs.rmSync(npmRoot, { recursive: true, force: true });
  }
}

function assertUpgradedIdentity(version: string, manifest: Record<string, unknown>): void {
  const state = readJson(path.join(FIXFLOW_ROOT, '.workflow-system', 'vnext', 'DISTRIBUTION_STATE.json'), 'Post-upgrade Distribution state');
  const runtime = readJson(path.join(FIXFLOW_ROOT, '.workflow-system', 'runtime', 'package.json'), 'Post-upgrade Runtime package');
  const contract = fs.readFileSync(path.join(FIXFLOW_ROOT, '.workflow-system', 'vnext', 'RUNTIME_CONTRACT.yaml'), 'utf8');
  const cli = fs.readFileSync(path.join(FIXFLOW_ROOT, '.workflow-system', 'runtime', 'dist', 'cli.js'), 'utf8');
  if (state.distribution_state !== 'vnext' || state.distribution_version !== version || state.manifest_digest !== manifest.manifest_digest || runtime.version !== version) {
    fail('Post-upgrade Distribution or Runtime identity does not match the pinned release.');
  }
  const escaped = version.replace(/\./gu, '\\.');
  if (!new RegExp(`^\\s*package_version:\\s*${escaped}\\s*$`, 'mu').test(contract) || !new RegExp(`VNEXT_RUNTIME_PACKAGE_VERSION\\s*=\\s*["']${escaped}["']`, 'u').test(cli)) {
    fail(`Post-upgrade Runtime contract or generated CLI does not embed ${version}.`);
  }
  run(NODE_COMMAND, [path.join(FIXFLOW_ROOT, '.workflow-system', 'runtime', 'dist', 'cli.js'), 'validate-contract', '--root', FIXFLOW_ROOT], FIXFLOW_ROOT);
  run(NODE_COMMAND, [path.join(FIXFLOW_ROOT, '.workflow-system', 'runtime', 'dist', 'cli.js'), 'validate', '--root', FIXFLOW_ROOT], FIXFLOW_ROOT);
}

function isGovernancePath(targetPath: string): boolean {
  return targetPath.startsWith('docs/workflow/')
    || targetPath.startsWith('docs/designs/')
    || targetPath === '.workflow-system/PROJECT_PROFILE.yaml'
    || targetPath === '.workflow-system/vnext/BOOTSTRAP_RECEIPT.json';
}

function isProductPath(targetPath: string): boolean {
  return targetPath.startsWith('src/')
    || targetPath.startsWith('app/')
    || targetPath.startsWith('lib/')
    || targetPath === 'package.json'
    || targetPath === 'package-lock.json';
}

export function classifyFixflowChanges(statusLines: string[], managedPaths: Iterable<string>): FixflowDogfoodPathClassification {
  const managed = new Set(managedPaths);
  managed.add('.workflow-system/vnext/DISTRIBUTION_STATE.json');
  const result: FixflowDogfoodPathClassification = {
    A_distribution_managed: [],
    B_runtime_dependency: [],
    C_governance: [],
    D_product: [],
    E_unknown: [],
  };
  for (const line of statusLines) {
    const targetPath = line.slice(3).replace(/\\/gu, '/');
    if (managed.has(targetPath)) result.A_distribution_managed.push(targetPath);
    else if (targetPath.startsWith('.workflow-system/runtime/node_modules/')) result.B_runtime_dependency.push(targetPath);
    else if (isGovernancePath(targetPath)) result.C_governance.push(targetPath);
    else if (isProductPath(targetPath)) result.D_product.push(targetPath);
    else result.E_unknown.push(targetPath);
  }
  return result;
}

function commitUpgrade(branch: string, version: string, manifest: Record<string, unknown>): { commit: string; ownership: FixflowDogfoodPathClassification } {
  const statusLines = splitPorcelainStatusOutput(git(FIXFLOW_ROOT, ['status', '--porcelain=v1', '--untracked-files=all']).stdout);
  const artifacts = manifest.artifacts;
  if (!Array.isArray(artifacts)) fail('Built Distribution manifest.artifacts must be an array.');
  const managedPaths = artifacts.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof (item as Record<string, unknown>).target_path !== 'string') fail('Built Distribution manifest contains an invalid target_path.');
    return (item as Record<string, unknown>).target_path as string;
  });
  const ownership = classifyFixflowChanges(statusLines, managedPaths);
  if (ownership.C_governance.length || ownership.D_product.length || ownership.E_unknown.length) {
    fail(`Upgrade changed non-Distribution paths: ${JSON.stringify(ownership)}.`);
  }
  const allowedPaths = [...ownership.A_distribution_managed, ...ownership.B_runtime_dependency];
  if (allowedPaths.length === 0) fail('Published-bin upgrade reported success but changed no Distribution-owned paths.');
  git(FIXFLOW_ROOT, ['add', '--', ...allowedPaths]);
  git(FIXFLOW_ROOT, ['diff', '--cached', '--check']);
  const remaining = git(FIXFLOW_ROOT, ['status', '--porcelain=v1', '--untracked-files=all']).stdout.trim();
  if (remaining.split(/\r?\n/u).some(line => line.startsWith('??') || line.startsWith(' M') || line.startsWith(' D'))) fail(`Unexpected unstaged or untracked paths remain after staging: ${remaining}`);
  git(FIXFLOW_ROOT, ['commit', '-m', `chore: upgrade Vibe Governance to ${version}`]);
  const commit = gitOutput(FIXFLOW_ROOT, ['rev-parse', 'HEAD']);
  if (gitOutput(FIXFLOW_ROOT, ['branch', '--show-current']) !== branch) fail(`FixFlow left the expected upgrade branch ${branch}.`);
  return { commit, ownership };
}

export function upgradeFixflowDogfood(options: FixflowDogfoodUpgradeOptions): FixflowDogfoodUpgradeReport {
  const sourceStart = readSourceReleaseStart(options.version, options.apply);
  const sourceBefore = sourceStart.source;
  const initialNonReleaseStatus = sourceStart.initialNonReleaseStatus;
  if (compareVersions(sourceBefore.version, options.version) > 0) fail(`Source is already at newer version ${sourceBefore.version}; requested version is ${options.version}.`);
  const fromVersion = readTargetDistributionVersion();
  recoverInterruptedSpecimenCapture(fromVersion);
  const baselineBranch = gitOutput(FIXFLOW_ROOT, ['branch', '--show-current']);
  const baselineHead = gitOutput(FIXFLOW_ROOT, ['rev-parse', 'HEAD']);
  if (compareVersions(fromVersion, options.version) >= 0) fail(`FixFlow is already at ${fromVersion}; requested upgrade version must be newer.`);
  const upgradeBranch = nextFixflowDogfoodBranch(baselineBranch, fromVersion, options.version);
  assertBranchAbsent(FIXFLOW_ROOT, upgradeBranch, false);
  if (!options.apply) {
    return {
      target_root: FIXFLOW_ROOT,
      source_head: sourceBefore.head,
      source_before_version: sourceBefore.version,
      source_version: options.version,
      source_release_commit: sourceBefore.version === options.version ? null : 'would-create',
      target_from_version: fromVersion,
      baseline_branch: baselineBranch,
      baseline_head: baselineHead,
      upgrade_branch: upgradeBranch,
      tarball: null,
      tarball_sha256: null,
      action: 'dry-run',
      specimen_branch: null,
      upgrade_commit: null,
      manifest_digest: null,
      ownership: null,
    };
  }

  const sourceReleaseCommit = sourceBefore.version === options.version
    ? null
    : validateAndCommitSourceRelease(sourceBefore.version, options.version, initialNonReleaseStatus, sourceStart.resumeVersionBump);
  const sourceAfter = readSourceReleaseIdentity();
  if (sourceAfter.version !== options.version) fail(`Source release commit did not produce version ${options.version}.`);
  const artifact = buildPinnedTarball(options.version);
  const cleanup = cleanupFixflowDogfood({ version: fromVersion, apply: true, push: false });
  if (gitOutput(FIXFLOW_ROOT, ['branch', '--show-current']) !== baselineBranch || gitOutput(FIXFLOW_ROOT, ['rev-parse', 'HEAD']) !== baselineHead) {
    fail('FixFlow baseline changed while preserving the prepare-task specimen.');
  }
  git(FIXFLOW_ROOT, ['switch', '-c', upgradeBranch]);
  runPublishedBinUpgrade(artifact.tarball);
  assertUpgradedIdentity(options.version, artifact.manifest);
  const committed = commitUpgrade(upgradeBranch, options.version, artifact.manifest);
  const finalStatus = git(FIXFLOW_ROOT, ['status', '--porcelain=v1', '--untracked-files=all']).stdout.trim();
  if (finalStatus) fail(`FixFlow is not clean after the upgrade commit: ${finalStatus}`);

  return {
    target_root: FIXFLOW_ROOT,
    source_head: sourceAfter.head,
    source_before_version: sourceBefore.version,
    source_version: options.version,
    source_release_commit: sourceReleaseCommit,
    target_from_version: fromVersion,
    baseline_branch: baselineBranch,
    baseline_head: baselineHead,
    upgrade_branch: upgradeBranch,
    tarball: artifact.tarball,
    tarball_sha256: artifact.sha256,
    action: 'upgraded',
    specimen_branch: cleanup.specimen_branch,
    upgrade_commit: committed.commit,
    manifest_digest: String(artifact.manifest.manifest_digest),
    ownership: committed.ownership,
  };
}

export function fixflowDogfoodUpgradeUsage(): string {
  return [
    'Usage:',
    '  bun run dogfood:fixflow:upgrade -- --version <x.y.z>',
    '  bun run dogfood:fixflow:upgrade -- --version <x.y.z> --apply',
    '',
    `Target: ${FIXFLOW_ROOT}`,
    'The committed source release must be lockstep; ordinary unstaged changes and new release-surface files are included in the local release commit after validation.',
    'With --apply, bump the source release to --version when needed, generate and validate it, create a local source commit, preserve the sole CURRENT_TASK specimen if present, build a fixed local tarball, install it through the published bin, validate, and create a local target commit. It never pushes.',
  ].join('\n');
}

if (import.meta.main) {
  try {
    const options = parseFixflowDogfoodUpgradeArgs(process.argv.slice(2));
    if (options === 'help') console.log(fixflowDogfoodUpgradeUsage());
    else console.log(JSON.stringify(upgradeFixflowDogfood(options), null, 2));
  } catch (error) {
    console.error(`FIXFLOW DOGFOOD UPGRADE: FAIL\n${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
