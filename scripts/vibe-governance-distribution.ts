/**
 * Vibe Governance Distribution boundary.
 *
 * This module is the source for the ephemeral `vibe-governance` Node CLI.
 * It owns distribution classification, manifest admission, destination
 * ownership, and the transaction journal.  It deliberately does not parse
 * legacy documents: `vnext-migration-pack.ts` remains the only
 * legacy-aware implementation and is invoked as a black-box conversion
 * boundary by `migrate`.
 */

import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  applyAtomicFileTransaction,
  computeScopedTreeHash,
  createMigrationPack,
  installMigrationPack,
  isFrozenPath,
  prepareRuntimeDistribution,
  validateMigrationPack,
  validateVNextBundle,
  type MigrationIssue,
  type MigrationOperationResult,
  type RuntimeDistributionIdentity,
  type VNextBundleArtifact,
  type VNextBundleManifest,
} from './vnext-migration-pack';
import {
  VNEXT_RUNTIME_ENTRYPOINT_RELATIVE_PATH,
  VNEXT_RUNTIME_LOCKFILE_RELATIVE_PATH,
  VNEXT_RUNTIME_NODE_MIN_VERSION,
  VNEXT_RUNTIME_PACKAGE_MANIFEST_RELATIVE_PATH,
  VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH,
  validateRuntimeEnvironment,
  validateVNextRuntimeContract,
} from './vnext-runtime';
import { checkTargetRoot } from './guard-target-root';
import { parseDocument } from 'yaml';

export const VIBE_GOVERNANCE_PRODUCT = 'Vibe Governance' as const;
export const VIBE_GOVERNANCE_PACKAGE_NAME = 'vibe-governance' as const;
export const VIBE_GOVERNANCE_DISTRIBUTION_MANIFEST_FILE = 'distribution-manifest.json' as const;
export const VIBE_GOVERNANCE_DISTRIBUTION_MANIFEST_KIND = 'vibe-governance-distribution-manifest' as const;
export const VIBE_GOVERNANCE_DISTRIBUTION_STATE_RELATIVE_PATH = '.workflow-system/vnext/DISTRIBUTION_STATE.json' as const;
export const VIBE_GOVERNANCE_DISTRIBUTION_IN_PROGRESS_RELATIVE_PATH = '.workflow-system/vnext/DISTRIBUTION_IN_PROGRESS.json' as const;
export const VIBE_GOVERNANCE_RUNTIME_DEPENDENCY_RELATIVE_PATH = '.workflow-system/runtime/node_modules' as const;
export const VIBE_GOVERNANCE_BOOTSTRAP_SUPPORT_TEMPLATE_RELATIVE_PATH = '.workflow-system/runtime/support/bootstrap/CURRENT_TASK.md.tmpl' as const;

export type DistributionStateName = 'uninstalled' | 'legacy' | 'vnext';
export type DistributionOperation = 'install' | 'migrate' | 'upgrade';

export type DistributionManifestArtifact = {
  source_path: string;
  target_path: string;
  category: 'protocol' | 'schema' | 'skill' | 'runtime' | 'config';
  required: boolean;
  checksum: string;
};

export type DistributionManifest = {
  schema_version: 1;
  kind: typeof VIBE_GOVERNANCE_DISTRIBUTION_MANIFEST_KIND;
  product: typeof VIBE_GOVERNANCE_PRODUCT;
  package_name: typeof VIBE_GOVERNANCE_PACKAGE_NAME;
  distribution_version: string;
  minimum_node: string;
  runtime_dependency_path: typeof VIBE_GOVERNANCE_RUNTIME_DEPENDENCY_RELATIVE_PATH;
  artifact_source: 'embedded-release';
  artifacts: DistributionManifestArtifact[];
  state: {
    path: typeof VIBE_GOVERNANCE_DISTRIBUTION_STATE_RELATIVE_PATH;
    in_progress_path: typeof VIBE_GOVERNANCE_DISTRIBUTION_IN_PROGRESS_RELATIVE_PATH;
  };
  support: {
    bundle_path: 'vnext-bundle';
    bundle_manifest_sha256: string;
    migration_source_path: 'migration-source';
  };
  manifest_digest: string;
};

export type DistributionState = {
  schema_version: 1;
  kind: 'vibe-governance-distribution-state';
  distribution_state: 'vnext';
  distribution_version: string;
  manifest_digest: string;
  installed_at: string;
  managed_files: Array<{ path: string; checksum: string; category: string }>;
  legacy_compatibility: 'absent';
  recovery_boundary: 'distribution-journal';
};

export type DistributionJournal = {
  schema_version: 1;
  kind: 'vibe-governance-distribution-in-progress';
  operation: DistributionOperation;
  from_state: DistributionStateName;
  to_state: 'vnext';
  distribution_version: string;
  manifest_digest: string;
  preimage_tree_hash: string;
  planned_writes: string[];
  planned_deletes: string[];
  recovery: 'rollback-read-back-fail-closed';
};

export type DistributionClassification = {
  state: DistributionStateName;
  version: string | null;
  valid: boolean;
  reasons: string[];
};

export type DistributionIssue = {
  code: string;
  message: string;
  path?: string;
};

export type DistributionOperationResult = {
  operation: DistributionOperation;
  status: 'installed' | 'upgraded' | 'no-op' | 'migration-required' | 'upgrade-required' | 'ready' | 'rejected';
  target_root: string;
  distribution_version: string;
  classification: DistributionClassification;
  planned_writes: string[];
  planned_deletes: string[];
  blockers: DistributionIssue[];
  warnings: DistributionIssue[];
  read_back_verified: boolean;
  /** Optional fresh-install UX hint; not Distribution, Runtime, or governance state. */
  next?: typeof VIBE_GOVERNANCE_FRESH_INSTALL_NEXT_HINT;
  migration?: MigrationOperationResult;
};

export type DistributionOperationOptions = {
  targetRoot: string;
  packageRoot?: string;
  dryRun?: boolean;
  testHooks?: {
    afterPromotion?: () => void;
  };
};

type LoadedPayload = {
  packageRoot: string;
  payloadRoot: string;
  sourceRoot: string;
  bundleDir: string;
  manifest: DistributionManifest;
  bundle: VNextBundleManifest;
};

type OldManagedEntry = { path: string; checksum: string };

const NODE_COMMAND = process.platform === 'win32' ? 'node.exe' : 'node';
const REQUIRED_SKILL_TARGET = /^\.agents\/skills\/[a-z][a-z0-9-]*\/SKILL\.md$/u;
const HASH64 = /^[a-f0-9]{64}$/u;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/u;
const LEGACY_HOST_SKILL_DIRECTORIES = ['.claude/skills', '.codex/skills', '.factory/skills'] as const;
const OLD_RUNTIME_PACKAGE_NAME = 'vibe-coding-vnext-runtime';
const MIGRATION_ONLY_BUNDLE_TARGETS = new Set(['docs/workflow/CURRENT_TASK.md']);

export const VIBE_GOVERNANCE_FRESH_INSTALL_NEXT_HINT = 'invoke the `bootstrap-project` Agent Skill' as const;

function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map(key => [key, stableValue((value as Record<string, unknown>)[key])]));
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function now(): string {
  return new Date().toISOString();
}

function expectRecord(value: unknown, location: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${location} must be a mapping.`);
  return value as Record<string, unknown>;
}

function expectString(value: unknown, location: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${location} must be a non-empty string.`);
  return value.trim();
}

function expectBoolean(value: unknown, location: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${location} must be a boolean.`);
  return value;
}

function expectExactKeys(value: Record<string, unknown>, keys: readonly string[], location: string): void {
  const allowed = new Set(keys);
  const missing = keys.filter(key => !(key in value));
  const extra = Object.keys(value).filter(key => !allowed.has(key));
  if (missing.length > 0 || extra.length > 0) throw new Error(`${location} keys mismatch; missing=[${missing.join(', ')}], unexpected=[${extra.join(', ')}].`);
}

function normalizeRepoPath(value: string, location: string): string {
  const normalized = value.replace(/\\/gu, '/').trim().replace(/^\.\//u, '');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//u.test(normalized) || normalized.split('/').some(part => !part || part === '..') || /[\0-\x1F\x7F]/u.test(normalized)) {
    throw new Error(`${location} must be a safe repository-relative path.`);
  }
  return normalized;
}

function resolveRepoPath(root: string, relativePath: string, location: string): string {
  const normalized = normalizeRepoPath(relativePath, location);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...normalized.split('/'));
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  if (resolved !== resolvedRoot && !resolved.startsWith(prefix)) throw new Error(`${location} escapes its root.`);
  return resolved;
}

function readJson(filePath: string, location: string): Record<string, unknown> {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error(`${location} is missing.`);
  try {
    return expectRecord(JSON.parse(fs.readFileSync(filePath, 'utf8')), location);
  } catch (error) {
    throw new Error(`${location} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readSha256(filePath: string): string {
  return sha256(fs.readFileSync(filePath));
}

function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

function parseVersion(value: string): [number, number, number] | null {
  const match = SEMVER.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compareVersions(left: string, right: string): number | null {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function packageRootFromModule(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFile), '..');
}

function packageRootFor(options?: DistributionOperationOptions): string {
  return path.resolve(options?.packageRoot ?? packageRootFromModule());
}

function payloadPaths(packageRoot: string): { payloadRoot: string; sourceRoot: string; bundleDir: string } {
  const payloadRoot = path.join(packageRoot, 'payload');
  return { payloadRoot, sourceRoot: path.join(payloadRoot, 'migration-source'), bundleDir: path.join(payloadRoot, 'vnext-bundle') };
}

function manifestDigest(raw: Record<string, unknown>): string {
  return sha256(stableJson({ ...raw, manifest_digest: '' }));
}

export function isDistributionOwnedTarget(targetPath: string): boolean {
  if (targetPath === '.workflow-system/WORKFLOW_PROTOCOL.md' || targetPath === '.workflow-system/FILE_SCHEMAS.md') return true;
  if (targetPath === '.workflow-system/vnext/SOURCE_CONTRACT.yaml' || targetPath === '.workflow-system/vnext/RUNTIME_CONTRACT.yaml') return true;
  if (targetPath.startsWith('.workflow-system/runtime/')) return true;
  return REQUIRED_SKILL_TARGET.test(targetPath);
}

function validateDistributionManifest(payloadRoot: string): DistributionManifest {
  const manifestPath = path.join(payloadRoot, VIBE_GOVERNANCE_DISTRIBUTION_MANIFEST_FILE);
  const raw = readJson(manifestPath, 'Distribution Manifest');
  expectExactKeys(raw, ['schema_version', 'kind', 'product', 'package_name', 'distribution_version', 'minimum_node', 'runtime_dependency_path', 'artifact_source', 'artifacts', 'state', 'support', 'manifest_digest'], 'Distribution Manifest');
  if (raw.schema_version !== 1 || raw.kind !== VIBE_GOVERNANCE_DISTRIBUTION_MANIFEST_KIND || raw.product !== VIBE_GOVERNANCE_PRODUCT || raw.package_name !== VIBE_GOVERNANCE_PACKAGE_NAME || raw.artifact_source !== 'embedded-release') {
    throw new Error('Distribution Manifest identity is invalid.');
  }
  const distributionVersion = expectString(raw.distribution_version, 'Distribution Manifest.distribution_version');
  if (!parseVersion(distributionVersion)) throw new Error('Distribution Manifest.distribution_version must be semver.');
  const minimumNode = expectString(raw.minimum_node, 'Distribution Manifest.minimum_node');
  if (minimumNode !== VNEXT_RUNTIME_NODE_MIN_VERSION) throw new Error('Distribution Manifest.minimum_node must match the Runtime contract.');
  const runtimeDependencyPath = normalizeRepoPath(expectString(raw.runtime_dependency_path, 'Distribution Manifest.runtime_dependency_path'), 'Distribution Manifest.runtime_dependency_path');
  if (runtimeDependencyPath !== VIBE_GOVERNANCE_RUNTIME_DEPENDENCY_RELATIVE_PATH) throw new Error('Distribution Manifest.runtime_dependency_path is not canonical.');
  validateRuntimeEnvironment(process.versions.node, minimumNode);
  if (raw.manifest_digest !== manifestDigest(raw)) throw new Error('Distribution Manifest checksum does not match its canonical content.');

  const state = expectRecord(raw.state, 'Distribution Manifest.state');
  expectExactKeys(state, ['path', 'in_progress_path'], 'Distribution Manifest.state');
  if (state.path !== VIBE_GOVERNANCE_DISTRIBUTION_STATE_RELATIVE_PATH || state.in_progress_path !== VIBE_GOVERNANCE_DISTRIBUTION_IN_PROGRESS_RELATIVE_PATH) throw new Error('Distribution Manifest state paths are not canonical.');
  const support = expectRecord(raw.support, 'Distribution Manifest.support');
  expectExactKeys(support, ['bundle_path', 'bundle_manifest_sha256', 'migration_source_path'], 'Distribution Manifest.support');
  if (support.bundle_path !== 'vnext-bundle' || support.migration_source_path !== 'migration-source' || typeof support.bundle_manifest_sha256 !== 'string' || !HASH64.test(support.bundle_manifest_sha256)) throw new Error('Distribution Manifest support payload is invalid.');

  if (!Array.isArray(raw.artifacts) || raw.artifacts.length === 0) throw new Error('Distribution Manifest.artifacts must be non-empty.');
  const artifacts: DistributionManifestArtifact[] = [];
  const targetPaths = new Set<string>();
  for (const [index, item] of raw.artifacts.entries()) {
    const artifact = expectRecord(item, `Distribution Manifest.artifacts[${index}]`);
    expectExactKeys(artifact, ['source_path', 'target_path', 'category', 'required', 'checksum'], `Distribution Manifest.artifacts[${index}]`);
    const sourcePath = normalizeRepoPath(expectString(artifact.source_path, `Distribution Manifest.artifacts[${index}].source_path`), 'Distribution Manifest source path');
    const targetPath = normalizeRepoPath(expectString(artifact.target_path, `Distribution Manifest.artifacts[${index}].target_path`), 'Distribution Manifest target path');
    if (!sourcePath.startsWith('vnext-bundle/')) throw new Error(`Distribution Manifest artifact source must be inside vnext-bundle: ${sourcePath}`);
    if (!isDistributionOwnedTarget(targetPath)) throw new Error(`Distribution Manifest target is outside the default-deny ownership boundary: ${targetPath}`);
    if (targetPaths.has(targetPath)) throw new Error(`Distribution Manifest contains duplicate target ${targetPath}.`);
    targetPaths.add(targetPath);
    const category = expectString(artifact.category, `Distribution Manifest.artifacts[${index}].category`);
    if (!['protocol', 'schema', 'skill', 'runtime', 'config'].includes(category)) throw new Error(`Distribution Manifest artifact category is unsupported: ${category}`);
    const checksum = expectString(artifact.checksum, `Distribution Manifest.artifacts[${index}].checksum`);
    if (!HASH64.test(checksum)) throw new Error(`Distribution Manifest artifact checksum is invalid: ${targetPath}`);
    artifacts.push({ source_path: sourcePath, target_path: targetPath, category: category as DistributionManifestArtifact['category'], required: expectBoolean(artifact.required, `Distribution Manifest.artifacts[${index}].required`), checksum });
    const fullPath = resolveRepoPath(payloadRoot, sourcePath, `Distribution Manifest artifact ${sourcePath}`);
    if (!fileExists(fullPath) || !fs.statSync(fullPath).isFile()) throw new Error(`Distribution Manifest artifact is missing: ${sourcePath}`);
    if (readSha256(fullPath) !== checksum) throw new Error(`Distribution Manifest artifact checksum mismatch: ${sourcePath}`);
  }
  const sorted = [...artifacts].sort((left, right) => left.target_path.localeCompare(right.target_path));
  if (stableJson(artifacts) !== stableJson(sorted)) throw new Error('Distribution Manifest artifacts must be sorted by target_path.');

  return {
    schema_version: 1,
    kind: VIBE_GOVERNANCE_DISTRIBUTION_MANIFEST_KIND,
    product: VIBE_GOVERNANCE_PRODUCT,
    package_name: VIBE_GOVERNANCE_PACKAGE_NAME,
    distribution_version: distributionVersion,
    minimum_node: minimumNode,
    runtime_dependency_path: VIBE_GOVERNANCE_RUNTIME_DEPENDENCY_RELATIVE_PATH,
    artifact_source: 'embedded-release',
    artifacts,
    state: {
      path: VIBE_GOVERNANCE_DISTRIBUTION_STATE_RELATIVE_PATH,
      in_progress_path: VIBE_GOVERNANCE_DISTRIBUTION_IN_PROGRESS_RELATIVE_PATH,
    },
    support: {
      bundle_path: 'vnext-bundle',
      bundle_manifest_sha256: support.bundle_manifest_sha256,
      migration_source_path: 'migration-source',
    },
    manifest_digest: expectString(raw.manifest_digest, 'Distribution Manifest.manifest_digest'),
  };
}

function distributionArtifactFromBundle(bundle: VNextBundleManifest, targetPath: string): VNextBundleArtifact {
  const artifact = bundle.artifacts.find(candidate => candidate.target_path === targetPath);
  if (!artifact) throw new Error(`Distribution payload is missing bundle artifact ${targetPath}.`);
  return artifact;
}

function loadDistributionPayload(packageRoot: string): LoadedPayload {
  const { payloadRoot, sourceRoot, bundleDir } = payloadPaths(packageRoot);
  const manifest = validateDistributionManifest(payloadRoot);
  const bundleManifestPath = path.join(bundleDir, 'vnext-bundle.json');
  if (!fileExists(bundleManifestPath) || readSha256(bundleManifestPath) !== manifest.support.bundle_manifest_sha256) throw new Error('Distribution payload vNext bundle manifest checksum mismatch.');
  if (!fileExists(path.join(sourceRoot, '.workflow-system', 'vnext', 'SOURCE_CONTRACT.yaml'))) throw new Error('Distribution payload migration source is incomplete.');
  const bundle = validateVNextBundle({ bundleDir, sourceRoot, portable: true });
  const manifestTargets = new Set(manifest.artifacts.map(artifact => artifact.target_path));
  const bundleDistributionArtifacts = bundle.artifacts.filter(artifact => !MIGRATION_ONLY_BUNDLE_TARGETS.has(artifact.target_path));
  if (manifest.artifacts.length !== bundleDistributionArtifacts.length) throw new Error('Distribution Manifest must account for every non-migration-only vNext bundle artifact.');
  for (const bundleArtifact of bundleDistributionArtifacts) {
    if (!manifestTargets.has(bundleArtifact.target_path)) throw new Error(`Distribution Manifest omits bundle artifact ${bundleArtifact.target_path}.`);
  }
  for (const artifact of manifest.artifacts) {
    const bundleArtifact = distributionArtifactFromBundle(bundle, artifact.target_path);
    if (`vnext-bundle/${bundleArtifact.source_path}` !== artifact.source_path || bundleArtifact.checksum !== artifact.checksum || bundleArtifact.category !== artifact.category || bundleArtifact.required !== artifact.required || (bundleArtifact.required && artifact.required !== true)) {
      throw new Error(`Distribution Manifest does not match vNext bundle artifact ${artifact.target_path}.`);
    }
  }
  if (!manifestTargets.has('.workflow-system/WORKFLOW_PROTOCOL.md') || !manifestTargets.has('.workflow-system/FILE_SCHEMAS.md') || !manifestTargets.has(VNEXT_RUNTIME_ENTRYPOINT_RELATIVE_PATH) || !manifestTargets.has(VNEXT_RUNTIME_PACKAGE_MANIFEST_RELATIVE_PATH) || !manifestTargets.has(VNEXT_RUNTIME_LOCKFILE_RELATIVE_PATH) || !manifestTargets.has(VIBE_GOVERNANCE_BOOTSTRAP_SUPPORT_TEMPLATE_RELATIVE_PATH)) {
    throw new Error('Distribution Manifest is missing required Runtime/protocol/schema/Bootstrap support artifacts.');
  }
  const payload: LoadedPayload = { packageRoot, payloadRoot, sourceRoot, bundleDir, manifest, bundle };
  const runtimeIdentity = runtimeIdentityFromPayload(payload);
  if (runtimeIdentity.package_version !== manifest.distribution_version) {
    throw new Error('Distribution Manifest.distribution_version must match the embedded Runtime package version.');
  }
  return payload;
}

function parseDistributionState(value: unknown, location: string): DistributionState {
  const state = expectRecord(value, location);
  expectExactKeys(state, ['schema_version', 'kind', 'distribution_state', 'distribution_version', 'manifest_digest', 'installed_at', 'managed_files', 'legacy_compatibility', 'recovery_boundary'], location);
  if (state.schema_version !== 1 || state.kind !== 'vibe-governance-distribution-state' || state.distribution_state !== 'vnext' || state.legacy_compatibility !== 'absent' || state.recovery_boundary !== 'distribution-journal') throw new Error(`${location} is not a valid vNext Distribution State.`);
  const version = expectString(state.distribution_version, `${location}.distribution_version`);
  if (!parseVersion(version)) throw new Error(`${location}.distribution_version must be semver.`);
  const digest = expectString(state.manifest_digest, `${location}.manifest_digest`);
  if (!HASH64.test(digest)) throw new Error(`${location}.manifest_digest is invalid.`);
  expectString(state.installed_at, `${location}.installed_at`);
  if (!Array.isArray(state.managed_files)) throw new Error(`${location}.managed_files must be a list.`);
  const paths = new Set<string>();
  const managedFiles = state.managed_files.map((rawItem, index) => {
    const item = expectRecord(rawItem, `${location}.managed_files[${index}]`);
    expectExactKeys(item, ['path', 'checksum', 'category'], `${location}.managed_files[${index}]`);
    const relativePath = normalizeRepoPath(expectString(item.path, `${location}.managed_files[${index}].path`), `${location}.managed_files[${index}].path`);
    if (!isDistributionOwnedTarget(relativePath) || relativePath === VIBE_GOVERNANCE_DISTRIBUTION_STATE_RELATIVE_PATH) throw new Error(`${location}.managed_files contains a path outside the manifest-owned surface: ${relativePath}`);
    if (paths.has(relativePath)) throw new Error(`${location}.managed_files contains duplicate path ${relativePath}.`);
    paths.add(relativePath);
    const checksum = expectString(item.checksum, `${location}.managed_files[${index}].checksum`);
    if (!HASH64.test(checksum)) throw new Error(`${location}.managed_files[${index}].checksum is invalid.`);
    return { path: relativePath, checksum, category: expectString(item.category, `${location}.managed_files[${index}].category`) };
  }).sort((left, right) => left.path.localeCompare(right.path));
  return {
    schema_version: 1,
    kind: 'vibe-governance-distribution-state',
    distribution_state: 'vnext',
    distribution_version: version,
    manifest_digest: digest,
    installed_at: expectString(state.installed_at, `${location}.installed_at`),
    managed_files: managedFiles,
    legacy_compatibility: 'absent',
    recovery_boundary: 'distribution-journal',
  };
}

function statePath(targetRoot: string, manifest: DistributionManifest): string {
  return resolveRepoPath(targetRoot, manifest.state.path, 'Distribution State path');
}

function journalPath(targetRoot: string, manifest: DistributionManifest): string {
  return resolveRepoPath(targetRoot, manifest.state.in_progress_path, 'Distribution journal path');
}

function readDistributionState(targetRoot: string, manifest: DistributionManifest): DistributionState | null {
  const filePath = statePath(targetRoot, manifest);
  if (!fileExists(filePath)) return null;
  return parseDistributionState(readJson(filePath, 'Distribution State'), 'Distribution State');
}

function findOldVersion(targetRoot: string): string | null {
  const oldStatePath = path.join(targetRoot, '.workflow-system', 'vnext', 'INSTALL_STATE.json');
  if (fileExists(oldStatePath)) {
    try {
      const state = readJson(oldStatePath, 'legacy vNext INSTALL_STATE.json');
      const distribution = state.runtime_distribution;
      if (distribution && typeof distribution === 'object' && !Array.isArray(distribution) && typeof (distribution as Record<string, unknown>).package_version === 'string') return (distribution as Record<string, unknown>).package_version as string;
      if (typeof state.distribution_version === 'string') return state.distribution_version;
    } catch {
      return 'invalid';
    }
  }
  const packagePath = path.join(targetRoot, ...VNEXT_RUNTIME_PACKAGE_MANIFEST_RELATIVE_PATH.split('/'));
  if (fileExists(packagePath)) {
    try {
      const packageManifest = readJson(packagePath, 'vNext Runtime package.json');
      if (packageManifest.name === OLD_RUNTIME_PACKAGE_NAME && typeof packageManifest.version === 'string') return packageManifest.version;
    } catch {
      return 'invalid';
    }
  }
  return null;
}

function hasLegacyHostSurface(targetRoot: string): boolean {
  for (const relativeDirectory of LEGACY_HOST_SKILL_DIRECTORIES) {
    const directory = path.join(targetRoot, ...relativeDirectory.split('/'));
    if (!fileExists(directory)) continue;
    const stack = [directory];
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(fullPath);
        else if (entry.isFile() && (/^workflow-system-.+\.SKILL\.md$/u.test(entry.name) || (entry.name === 'SKILL.md' && /^workflow-system-.+$/u.test(path.basename(current))))) return true;
      }
    }
  }
  const generated = path.join(targetRoot, 'docs', 'workflow', 'generated', 'workflow-skills');
  if (fileExists(generated)) {
    for (const entry of fs.readdirSync(generated)) if (entry.includes('workflow-system-')) return true;
  }
  return false;
}

function hasLegacySurface(targetRoot: string): boolean {
  const hasEntries = (relativePath: string): boolean => {
    const directory = path.join(targetRoot, ...relativePath.split('/'));
    return fileExists(directory) && fs.statSync(directory).isDirectory() && fs.readdirSync(directory).length > 0;
  };
  const legacyProtocol = path.join(targetRoot, '.workflow-system', 'WORKFLOW_PROTOCOL.md');
  if (fileExists(legacyProtocol) && /Protocol-Version\s*:\s*0\./iu.test(fs.readFileSync(legacyProtocol, 'utf8'))) return true;
  return fileExists(path.join(targetRoot, '.workflow-system', 'install-state.json'))
    || fileExists(path.join(targetRoot, '.workflow-system', 'WORKFLOW_CAPABILITIES.yaml'))
    || fileExists(path.join(targetRoot, '.workflow-system', 'vnext', 'MIGRATION_PACK_SCHEMA.yaml'))
    || hasEntries('templates/skills')
    || hasEntries('templates/docs')
    || hasLegacyHostSurface(targetRoot);
}

function hasOldVNextSurface(targetRoot: string): boolean {
  return fileExists(path.join(targetRoot, '.workflow-system', 'vnext', 'INSTALL_STATE.json'))
    || fileExists(path.join(targetRoot, '.workflow-system', 'vnext', 'MIGRATION_RECEIPT.json'))
    || findOldVersion(targetRoot) !== null;
}

function hasPartialDistributionSurface(targetRoot: string, manifest: DistributionManifest): boolean {
  if (fileExists(statePath(targetRoot, manifest)) || fileExists(journalPath(targetRoot, manifest))) return true;
  if (manifest.artifacts.some(artifact => fileExists(path.join(targetRoot, ...artifact.target_path.split('/'))))) return true;
  const vnextDirectory = path.join(targetRoot, '.workflow-system', 'vnext');
  return fileExists(vnextDirectory) && fs.readdirSync(vnextDirectory).some(entry => entry !== 'MIGRATION_PACK_SCHEMA.yaml');
}

export function classifyDistribution(targetRoot: string, manifest?: DistributionManifest): DistributionClassification {
  const resolvedRoot = path.resolve(targetRoot);
  let effectiveManifest = manifest;
  const reasons: string[] = [];
  if (!effectiveManifest) {
    try {
      effectiveManifest = validateDistributionManifest(path.join(packageRootFromModule(), 'payload'));
    } catch {
      // Payload validation is reported by the operation entrypoint. State
      // classification itself remains useful for diagnostics.
    }
  }
  const distributionStatePath = path.join(resolvedRoot, ...VIBE_GOVERNANCE_DISTRIBUTION_STATE_RELATIVE_PATH.split('/'));
  if (fileExists(distributionStatePath)) {
    try {
      const state = parseDistributionState(readJson(distributionStatePath, 'Distribution State'), 'Distribution State');
      const hybrid = hasLegacySurface(resolvedRoot);
      if (hybrid) reasons.push('legacy and vNext distribution surfaces are present together.');
      if (fileExists(path.join(resolvedRoot, ...VIBE_GOVERNANCE_DISTRIBUTION_IN_PROGRESS_RELATIVE_PATH.split('/')))) reasons.push('an interrupted Distribution transaction is present.');
      return { state: 'vnext', version: state.distribution_version, valid: !hybrid && reasons.length === 0, reasons };
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : String(error));
      return { state: 'vnext', version: 'invalid', valid: false, reasons };
    }
  }
  const oldVNext = hasOldVNextSurface(resolvedRoot);
  const legacy = hasLegacySurface(resolvedRoot);
  if (oldVNext) {
    if (legacy) reasons.push('legacy and older vNext distribution surfaces are present together.');
    if (fileExists(path.join(resolvedRoot, ...VIBE_GOVERNANCE_DISTRIBUTION_IN_PROGRESS_RELATIVE_PATH.split('/')))) reasons.push('an interrupted Distribution transaction is present.');
    return { state: 'vnext', version: findOldVersion(resolvedRoot), valid: !legacy && reasons.length === 0, reasons };
  }
  if (legacy) return { state: 'legacy', version: null, valid: true, reasons: [] };
  if (effectiveManifest && hasPartialDistributionSurface(resolvedRoot, effectiveManifest)) {
    return { state: 'uninstalled', version: null, valid: false, reasons: ['a partial vNext distribution surface exists without a completed Distribution State.'] };
  }
  return { state: 'uninstalled', version: null, valid: true, reasons: [] };
}

function stateContent(manifest: DistributionManifest, installedAt = now()): string {
  const state: DistributionState = {
    schema_version: 1,
    kind: 'vibe-governance-distribution-state',
    distribution_state: 'vnext',
    distribution_version: manifest.distribution_version,
    manifest_digest: manifest.manifest_digest,
    installed_at: installedAt,
    managed_files: manifest.artifacts.map(artifact => ({ path: artifact.target_path, checksum: artifact.checksum, category: artifact.category })).sort((left, right) => left.path.localeCompare(right.path)),
    legacy_compatibility: 'absent',
    recovery_boundary: 'distribution-journal',
  };
  return `${JSON.stringify(state, null, 2)}\n`;
}

function distributionIssue(code: string, message: string, pathValue?: string): DistributionIssue {
  return pathValue ? { code, message, path: pathValue } : { code, message };
}

function resultBase(operation: DistributionOperation, targetRoot: string, manifest: DistributionManifest, classification: DistributionClassification): DistributionOperationResult {
  return { operation, status: 'rejected', target_root: path.resolve(targetRoot), distribution_version: manifest.distribution_version, classification, planned_writes: [], planned_deletes: [], blockers: [], warnings: [], read_back_verified: false };
}

function distributionPreimagePaths(
  manifest: DistributionManifest,
  plannedWrites: readonly string[],
  plannedDeletes: readonly string[],
): string[] {
  return [...new Set([
    ...plannedWrites,
    ...plannedDeletes,
    manifest.state.path,
    manifest.state.in_progress_path,
    manifest.runtime_dependency_path,
  ])].sort((left, right) => left.localeCompare(right));
}

function computeDistributionPreimageHash(
  targetRoot: string,
  manifest: DistributionManifest,
  plannedWrites: readonly string[],
  plannedDeletes: readonly string[],
): string {
  const includedPaths = distributionPreimagePaths(manifest, plannedWrites, plannedDeletes);
  // The journal is created after the preimage and is removed after a verified
  // commit/rollback. Keep it explicit in the control scope, but exclude it
  // from the content comparison just as the existing transaction protocol did.
  return computeScopedTreeHash(targetRoot, includedPaths, [manifest.state.in_progress_path]);
}

function stateManagedMap(state: DistributionState | null): Map<string, string> {
  return new Map((state?.managed_files ?? []).map(entry => [entry.path, entry.checksum]));
}

function oldInstallManagedMap(targetRoot: string): Map<string, string> {
  const oldStatePath = path.join(targetRoot, '.workflow-system', 'vnext', 'INSTALL_STATE.json');
  if (!fileExists(oldStatePath)) return new Map();
  try {
    const raw = readJson(oldStatePath, 'legacy vNext INSTALL_STATE.json');
    if (!Array.isArray(raw.managed_files)) return new Map();
    const result = new Map<string, string>();
    for (const item of raw.managed_files) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const pathValue = typeof (item as Record<string, unknown>).path === 'string' ? (item as Record<string, unknown>).path as string : '';
      const checksum = typeof (item as Record<string, unknown>).checksum === 'string' ? (item as Record<string, unknown>).checksum as string : '';
      if (pathValue && checksum && HASH64.test(checksum)) result.set(pathValue.replace(/\\/gu, '/'), checksum);
    }
    return result;
  } catch {
    return new Map();
  }
}

function admittedOldManagedMap(targetRoot: string, state: DistributionState | null): Map<string, string> {
  // A validated Distribution State is authoritative even when its managed
  // file list is empty. Never fall through to the older INSTALL_STATE shape;
  // the two state formats have different ownership semantics.
  return state ? stateManagedMap(state) : oldInstallManagedMap(targetRoot);
}

function plannedCurrentDistributionDeletes(
  manifest: DistributionManifest,
  oldManaged: ReadonlyMap<string, string>,
): string[] {
  const currentManifestPaths = new Set(manifest.artifacts.map(artifact => artifact.target_path));
  // A current-format Distribution State is an admission of every path in
  // managed_files. Safe upgrade convergence is therefore the exact set
  // difference, after verifyOldManagedFiles has checked every old checksum.
  return [...oldManaged.keys()]
    .filter(relativePath => !currentManifestPaths.has(relativePath))
    .sort();
}

function plannedLegacyInstallCompatibilityDeletes(
  manifest: DistributionManifest,
  oldManaged: ReadonlyMap<string, string>,
): string[] {
  const currentManifestPaths = new Set(manifest.artifacts.map(artifact => artifact.target_path));
  // A vNext INSTALL_STATE.json is an older, wider compatibility shape. Its
  // entries cannot be blanket-deleted during the first Distribution upgrade;
  // retain the existing narrow mapping for known legacy host files only.
  return [...oldManaged.keys()]
    .filter(relativePath => LEGACY_HOST_SKILL_DIRECTORIES.some(prefix => relativePath === prefix || relativePath.startsWith(`${prefix}/`)))
    .filter(relativePath => !currentManifestPaths.has(relativePath))
    .sort();
}

function plannedDistributionDeletes(
  manifest: DistributionManifest,
  oldState: DistributionState | null,
  oldManaged: ReadonlyMap<string, string>,
): string[] {
  return oldState
    ? plannedCurrentDistributionDeletes(manifest, oldManaged)
    : plannedLegacyInstallCompatibilityDeletes(manifest, oldManaged);
}

function verifyOldManagedFiles(targetRoot: string, state: DistributionState | null): DistributionIssue[] {
  const managed = admittedOldManagedMap(targetRoot, state);
  const issues: DistributionIssue[] = [];
  for (const [relativePath, checksum] of managed) {
    const fullPath = path.join(targetRoot, ...relativePath.split('/'));
    if (!fileExists(fullPath) || !fs.statSync(fullPath).isFile()) issues.push(distributionIssue('MANAGED_TARGET_DRIFT', `Previously managed vNext path is missing: ${relativePath}`, relativePath));
    else if (readSha256(fullPath) !== checksum) issues.push(distributionIssue('MANAGED_TARGET_DRIFT', `Previously managed vNext path drifted: ${relativePath}`, relativePath));
  }
  return issues;
}

function validateDestinations(targetRoot: string, manifest: DistributionManifest, operation: DistributionOperation, oldState: DistributionState | null): DistributionIssue[] {
  const issues: DistributionIssue[] = [];
  const oldManaged = admittedOldManagedMap(targetRoot, oldState);
  for (const artifact of manifest.artifacts) {
    const targetPath = resolveRepoPath(targetRoot, artifact.target_path, 'Distribution target');
    if (!fileExists(targetPath)) continue;
    if (!fs.statSync(targetPath).isFile()) {
      issues.push(distributionIssue('MANAGED_TARGET_CONFLICT', 'Distribution target is not a regular file.', artifact.target_path));
      continue;
    }
    const actual = readSha256(targetPath);
    if (actual === artifact.checksum) continue;
    if (operation === 'upgrade' && oldManaged.get(artifact.target_path) === actual) continue;
    issues.push(distributionIssue('MANAGED_TARGET_CONFLICT', 'Distribution-managed target differs from the admitted payload.', artifact.target_path));
  }
  const stateFile = statePath(targetRoot, manifest);
  if (fileExists(stateFile)) {
    if (operation !== 'upgrade' || !oldState) issues.push(distributionIssue('MANAGED_TARGET_CONFLICT', 'Distribution State already exists and is not an exact admitted upgrade preimage.', manifest.state.path));
  }
  const runtimeDirectory = path.join(targetRoot, ...VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH.split('/'));
  const runtimeDependencyDirectory = resolveRepoPath(targetRoot, manifest.runtime_dependency_path, 'Distribution Runtime dependency path');
  if (fileExists(runtimeDependencyDirectory) && !fs.statSync(runtimeDependencyDirectory).isDirectory()) {
    issues.push(distributionIssue('MANAGED_TARGET_CONFLICT', 'Distribution Runtime dependency target is not a directory.', manifest.runtime_dependency_path));
  } else if (fileExists(runtimeDependencyDirectory) && oldManaged.size === 0) {
    issues.push(distributionIssue('MANAGED_TARGET_CONFLICT', 'Distribution Runtime dependency directory exists without an admitted prior Distribution owner.', manifest.runtime_dependency_path));
  }
  if (operation === 'install' && fileExists(runtimeDirectory) && !oldState) issues.push(distributionIssue('MANAGED_TARGET_CONFLICT', 'Project-local Runtime directory already exists without an admitted Distribution State.', VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH));
  return issues;
}

function runtimeIdentityFromPayload(payload: LoadedPayload): RuntimeDistributionIdentity {
  const packageArtifact = distributionArtifactFromBundle(payload.bundle, VNEXT_RUNTIME_PACKAGE_MANIFEST_RELATIVE_PATH);
  const lockArtifact = distributionArtifactFromBundle(payload.bundle, VNEXT_RUNTIME_LOCKFILE_RELATIVE_PATH);
  const entryArtifact = distributionArtifactFromBundle(payload.bundle, VNEXT_RUNTIME_ENTRYPOINT_RELATIVE_PATH);
  const contractPath = path.join(payload.sourceRoot, '.workflow-system', 'vnext', 'RUNTIME_CONTRACT.yaml');
  const parsed = parseDocument(fs.readFileSync(contractPath, 'utf8'), { uniqueKeys: true });
  const contract = parsed.toJS() as Record<string, unknown>;
  const runtime = contract.runtime_distribution as Record<string, unknown>;
  return {
    kind: 'project-local-node',
    package_path: VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH,
    entrypoint: VNEXT_RUNTIME_ENTRYPOINT_RELATIVE_PATH,
    package_version: expectString(runtime.package_version, 'Runtime contract package_version'),
    node_min_version: expectString(runtime.node_min_version, 'Runtime contract node_min_version'),
    package_lock_sha256: lockArtifact.checksum,
    entrypoint_sha256: entryArtifact.checksum,
  };
}

function validateRuntimeReadBack(targetRoot: string): void {
  const identity = validateVNextRuntimeContract(targetRoot, true).runtime_distribution;
  if (identity.package_path !== VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH || identity.entrypoint !== VNEXT_RUNTIME_ENTRYPOINT_RELATIVE_PATH) throw new Error('Project-local Runtime read-back identity is not canonical.');
  try {
    execFileSync(NODE_COMMAND, [path.join(targetRoot, ...VNEXT_RUNTIME_ENTRYPOINT_RELATIVE_PATH.split('/')), 'validate-contract', '--root', targetRoot], { cwd: targetRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_PATH: undefined, BUN_INSTALL: undefined } });
  } catch (error) {
    const detail = error && typeof error === 'object' && 'stderr' in error ? String((error as { stderr?: unknown }).stderr ?? '') : '';
    throw new Error(`Project-local Runtime contract self-check failed: ${detail.trim() || (error instanceof Error ? error.message : String(error))}`);
  }
}

function verifyDistributionInstallation(targetRoot: string, payload: LoadedPayload): void {
  const state = readDistributionState(targetRoot, payload.manifest);
  if (!state) throw new Error('Distribution State was not promoted.');
  if (state.distribution_version !== payload.manifest.distribution_version || state.manifest_digest !== payload.manifest.manifest_digest) throw new Error('Distribution State read-back identity mismatch.');
  const expectedFiles = payload.manifest.artifacts.map(artifact => ({ path: artifact.target_path, checksum: artifact.checksum, category: artifact.category })).sort((left, right) => left.path.localeCompare(right.path));
  if (stableJson(state.managed_files) !== stableJson(expectedFiles)) throw new Error('Distribution State managed-file read-back mismatch.');
  for (const artifact of payload.manifest.artifacts) {
    const targetPath = resolveRepoPath(targetRoot, artifact.target_path, 'Distribution read-back target');
    if (!fileExists(targetPath) || !fs.statSync(targetPath).isFile() || readSha256(targetPath) !== artifact.checksum) throw new Error(`Distribution artifact read-back mismatch: ${artifact.target_path}`);
  }
  const runtimeDependencyDirectory = resolveRepoPath(targetRoot, payload.manifest.runtime_dependency_path, 'Distribution Runtime dependency read-back path');
  if (!fileExists(runtimeDependencyDirectory) || !fs.statSync(runtimeDependencyDirectory).isDirectory()) throw new Error('Project-local Runtime dependency directory read-back mismatch.');
  const skillTargets = payload.manifest.artifacts.filter(artifact => artifact.category === 'skill');
  if (skillTargets.some(artifact => !REQUIRED_SKILL_TARGET.test(artifact.target_path))) throw new Error('Distribution read-back contains a non-canonical Skill path.');
  validateRuntimeReadBack(targetRoot);
}

export type InstalledDistributionValidation = {
  manifest: DistributionManifest;
  bundle: VNextBundleManifest;
  state: DistributionState;
};

/**
 * Read-only prerequisite validation for administrative consumers such as
 * bootstrap-project. The Distribution module remains the sole owner of
 * Distribution State, payload admission, artifact checksums, canonical Skill
 * paths, and project-local Runtime read-back. Callers receive evidence; they
 * do not receive permission to promote or receipt-own these artifacts.
 */
export function validateInstalledDistribution(targetRoot: string, packageRoot?: string): InstalledDistributionValidation {
  const payload = loadDistributionPayload(path.resolve(packageRoot ?? packageRootFromModule()));
  const resolvedTargetRoot = path.resolve(targetRoot);
  const classification = classifyDistribution(resolvedTargetRoot, payload.manifest);
  if (!classification.valid || classification.state !== 'vnext') {
    throw new Error(`Installed Distribution is not a valid current vNext distribution: ${classification.reasons.join(' ') || classification.state}.`);
  }
  const state = readDistributionState(resolvedTargetRoot, payload.manifest);
  if (!state) throw new Error('Installed Distribution State is missing.');
  verifyDistributionInstallation(resolvedTargetRoot, payload);
  return { manifest: payload.manifest, bundle: payload.bundle, state };
}

function writeJournal(targetRoot: string, journal: DistributionJournal, manifest: DistributionManifest): void {
  const markerPath = journalPath(targetRoot, manifest);
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  const tempPath = `${markerPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(journal, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, markerPath);
}

function removeJournal(targetRoot: string, manifest: DistributionManifest): void {
  const markerPath = journalPath(targetRoot, manifest);
  if (fileExists(markerPath)) fs.rmSync(markerPath, { force: true });
}

function pruneCreatedEmptyDirectories(targetRoot: string, relativePaths: readonly string[], preexisting: ReadonlySet<string>): void {
  const candidates = [...relativePaths].sort((left, right) => right.split('/').length - left.split('/').length);
  for (const relativePath of candidates) {
    if (preexisting.has(relativePath)) continue;
    const directory = resolveRepoPath(targetRoot, relativePath, 'rollback directory');
    if (!fileExists(directory) || !fs.statSync(directory).isDirectory()) continue;
    if (fs.readdirSync(directory).length === 0) {
      try {
        fs.rmdirSync(directory);
      } catch {
        // The directory is known to be empty and was created by this plan;
        // tolerate a platform-specific second removal during rollback.
      }
    }
  }
}

function planFreshOrUpgrade(targetRoot: string, payload: LoadedPayload, operation: 'install' | 'upgrade', oldState: DistributionState | null): { writes: Array<{ path: string; content: string }>; deletes: string[]; directories: Array<{ path: string; sourcePath: string }>; stagingRoot?: string; state: DistributionState } {
  const writes = payload.manifest.artifacts.map(artifact => ({ path: artifact.target_path, content: fs.readFileSync(resolveRepoPath(payload.payloadRoot, artifact.source_path, 'Distribution payload artifact'), 'utf8') }));
  const prepared: ReturnType<typeof prepareRuntimeDistribution> = prepareRuntimeDistribution(payload.bundleDir, payload.bundle.artifacts);
  const state = parseDistributionState(JSON.parse(stateContent(payload.manifest)), 'planned Distribution State');
  writes.push({ path: payload.manifest.state.path, content: stateContent(payload.manifest) });
  const oldManaged = admittedOldManagedMap(targetRoot, oldState);
  const deletes = plannedDistributionDeletes(payload.manifest, oldState, oldManaged);
  return { writes, deletes, directories: prepared ? [{ path: payload.manifest.runtime_dependency_path, sourcePath: prepared.sourceNodeModulesPath }] : [], stagingRoot: prepared?.stagingRoot, state };
}

function runTransactionalPromotion(
  targetRoot: string,
  payload: LoadedPayload,
  operation: 'install' | 'upgrade',
  classification: DistributionClassification,
  oldState: DistributionState | null,
  testHooks?: DistributionOperationOptions['testHooks'],
): DistributionOperationResult {
  const result = resultBase(operation, targetRoot, payload.manifest, classification);
  const destinationIssues = validateDestinations(targetRoot, payload.manifest, operation, oldState);
  if (destinationIssues.length > 0) {
    result.blockers.push(...destinationIssues);
    return result;
  }
  if (operation === 'upgrade') {
    const drift = verifyOldManagedFiles(targetRoot, oldState);
    if (drift.length > 0) {
      result.blockers.push(...drift);
      return result;
    }
  }
  const plannedWrites = payload.manifest.artifacts.map(artifact => artifact.target_path).concat(payload.manifest.state.path).sort();
  const oldManaged = admittedOldManagedMap(targetRoot, oldState);
  const plannedDeletes = plannedDistributionDeletes(payload.manifest, oldState, oldManaged);
  result.planned_writes = [...plannedWrites, payload.manifest.runtime_dependency_path];
  result.planned_deletes = plannedDeletes;
  if (isFrozenPath(targetRoot, payload.manifest.state.path)
    || isFrozenPath(targetRoot, payload.manifest.state.in_progress_path)
    || isFrozenPath(targetRoot, payload.manifest.runtime_dependency_path)
    || payload.manifest.artifacts.some(artifact => isFrozenPath(targetRoot, artifact.target_path))) {
    result.blockers.push(distributionIssue('FROZEN_PATH', 'Distribution cannot replace or journal a frozen path.'));
    return result;
  }

  let plan: ReturnType<typeof planFreshOrUpgrade> | undefined;
  try {
    plan = planFreshOrUpgrade(targetRoot, payload, operation, oldState);
  } catch (error) {
    result.blockers.push(distributionIssue('PAYLOAD_STAGE_FAILED', error instanceof Error ? error.message : String(error)));
    return result;
  }
  if (!plan) return result;
  if (payload.manifest.artifacts.some(artifact => !plan!.writes.some(write => write.path === artifact.target_path))) {
    if (plan.stagingRoot) fs.rmSync(plan.stagingRoot, { recursive: true, force: true });
    result.blockers.push(distributionIssue('PLAN_INVALID', 'Distribution plan omitted a manifest-owned artifact.'));
    return result;
  }
  if (result.planned_writes.includes(payload.manifest.state.path) === false) result.planned_writes.push(payload.manifest.state.path);
  if (payload.manifest.state.in_progress_path && isFrozenPath(targetRoot, payload.manifest.state.in_progress_path)) {
    if (plan.stagingRoot) fs.rmSync(plan.stagingRoot, { recursive: true, force: true });
    result.blockers.push(distributionIssue('FROZEN_PATH', 'Distribution journal path is frozen.', payload.manifest.state.in_progress_path));
    return result;
  }
  // The plan is intentionally created before the journal so dependency
  // installation and all destination checks happen before target mutation.
  let preimageTreeHash: string;
  try {
    preimageTreeHash = computeDistributionPreimageHash(targetRoot, payload.manifest, result.planned_writes, result.planned_deletes);
  } catch (error) {
    if (plan.stagingRoot) fs.rmSync(plan.stagingRoot, { recursive: true, force: true });
    result.blockers.push(distributionIssue('PREIMAGE_FAILED', error instanceof Error ? error.message : String(error)));
    return result;
  }
  const rollbackDirectories = [
    ...payload.manifest.artifacts
      .filter(artifact => artifact.category === 'skill')
      .map(artifact => path.posix.dirname(artifact.target_path)),
    '.agents/skills',
    '.agents',
    payload.manifest.runtime_dependency_path,
    '.workflow-system/runtime/src',
    '.workflow-system/runtime/dist',
    '.workflow-system/runtime',
    '.workflow-system/vnext',
    '.workflow-system',
  ];
  const preexistingDirectories = new Set(rollbackDirectories.filter(relativePath => {
    const directory = path.join(targetRoot, ...relativePath.split('/'));
    return fileExists(directory) && fs.statSync(directory).isDirectory();
  }));
  const journal: DistributionJournal = {
    schema_version: 1,
    kind: 'vibe-governance-distribution-in-progress',
    operation,
    from_state: classification.state,
    to_state: 'vnext',
    distribution_version: payload.manifest.distribution_version,
    manifest_digest: payload.manifest.manifest_digest,
    preimage_tree_hash: preimageTreeHash,
    planned_writes: result.planned_writes,
    planned_deletes: result.planned_deletes,
    recovery: 'rollback-read-back-fail-closed',
  };
  try {
    writeJournal(targetRoot, journal, payload.manifest);
    applyAtomicFileTransaction(
      targetRoot,
      plan.writes,
      plan.deletes,
      () => {
        verifyDistributionInstallation(targetRoot, payload);
        testHooks?.afterPromotion?.();
      },
      plan.directories,
    );
    if (plan.stagingRoot) fs.rmSync(plan.stagingRoot, { recursive: true, force: true });
    removeJournal(targetRoot, payload.manifest);
    result.status = operation === 'install' ? 'installed' : 'upgraded';
    result.read_back_verified = true;
    if (operation === 'install') result.next = VIBE_GOVERNANCE_FRESH_INSTALL_NEXT_HINT;
    return result;
  } catch (error) {
    if (plan.stagingRoot) fs.rmSync(plan.stagingRoot, { recursive: true, force: true });
    let rollbackVerified = false;
    try {
      rollbackVerified = computeDistributionPreimageHash(targetRoot, payload.manifest, result.planned_writes, result.planned_deletes) === preimageTreeHash;
    } catch {
      rollbackVerified = false;
    }
    if (rollbackVerified) {
      pruneCreatedEmptyDirectories(targetRoot, rollbackDirectories, preexistingDirectories);
      try { removeJournal(targetRoot, payload.manifest); } catch { /* retain marker if cleanup is not safe */ }
    } else {
      result.warnings.push(distributionIssue('ROLLBACK_UNVERIFIED', 'Rollback read-back did not match the preimage; the Distribution journal was retained for explicit recovery.', payload.manifest.state.in_progress_path));
    }
    result.blockers.push(distributionIssue('PROMOTION_FAILED', error instanceof Error ? error.message : String(error)));
    return result;
  }
}

function runDryRunPromotion(
  targetRoot: string,
  payload: LoadedPayload,
  operation: 'install' | 'upgrade',
  classification: DistributionClassification,
  oldState: DistributionState | null,
): DistributionOperationResult {
  const result = resultBase(operation, targetRoot, payload.manifest, classification);
  const destinationIssues = validateDestinations(targetRoot, payload.manifest, operation, oldState);
  if (destinationIssues.length > 0) {
    result.blockers.push(...destinationIssues);
    return result;
  }
  if (operation === 'upgrade') {
    const drift = verifyOldManagedFiles(targetRoot, oldState);
    if (drift.length > 0) {
      result.blockers.push(...drift);
      return result;
    }
  }
  const oldManaged = admittedOldManagedMap(targetRoot, oldState);
  result.planned_writes = payload.manifest.artifacts.map(artifact => artifact.target_path)
    .concat(payload.manifest.state.path, payload.manifest.runtime_dependency_path)
    .sort();
  result.planned_deletes = plannedDistributionDeletes(payload.manifest, oldState, oldManaged);
  if (isFrozenPath(targetRoot, payload.manifest.state.path)
    || isFrozenPath(targetRoot, payload.manifest.state.in_progress_path)
    || isFrozenPath(targetRoot, payload.manifest.runtime_dependency_path)
    || payload.manifest.artifacts.some(artifact => isFrozenPath(targetRoot, artifact.target_path))) {
    result.blockers.push(distributionIssue('FROZEN_PATH', 'Distribution cannot replace or journal a frozen path.'));
    return result;
  }
  result.status = 'ready';
  return result;
}

function governanceIdleBoundary(targetRoot: string): DistributionIssue[] {
  const profilePath = path.join(targetRoot, '.workflow-system', 'PROJECT_PROFILE.yaml');
  const defaultCurrentTask = path.join(targetRoot, 'docs', 'workflow', 'CURRENT_TASK.md');
  if (!fileExists(profilePath) && !fileExists(defaultCurrentTask)) return [];
  if (!fileExists(profilePath)) return [distributionIssue('UPGRADE_GOVERNANCE_UNKNOWN', 'A project CURRENT_TASK exists without PROJECT_PROFILE.yaml; upgrade stops fail-closed.')];
  const runtimeEntrypoint = path.join(targetRoot, ...VNEXT_RUNTIME_ENTRYPOINT_RELATIVE_PATH.split('/'));
  if (!fileExists(runtimeEntrypoint)) return [distributionIssue('UPGRADE_GOVERNANCE_UNKNOWN', 'Project-local Runtime is missing; upgrade cannot establish an idle boundary.')];
  try {
    const output = execFileSync(NODE_COMMAND, [runtimeEntrypoint, 'validate', '--root', targetRoot], { cwd: targetRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_PATH: undefined, BUN_INSTALL: undefined } });
    const parsed = JSON.parse(output) as Record<string, unknown>;
    const runtimeState = parsed.runtime_state as Record<string, unknown> | undefined;
    if (runtimeState?.workflow_status === 'closed' && runtimeState.lifecycle_state === 'archived') return [];
    return [distributionIssue('UPGRADE_NON_IDLE', 'vNext upgrade requires a closed and archived CURRENT_TASK.')];
  } catch (error) {
    const detail = error && typeof error === 'object' && 'stderr' in error ? String((error as { stderr?: unknown }).stderr ?? '') : '';
    return [distributionIssue('UPGRADE_NON_IDLE', `Project-local Runtime did not prove an idle boundary: ${detail.trim() || (error instanceof Error ? error.message : String(error))}`)];
  }
}

function baseRejected(operation: DistributionOperation, targetRoot: string, payload: LoadedPayload, classification: DistributionClassification, code: string, message: string, pathValue?: string): DistributionOperationResult {
  const result = resultBase(operation, targetRoot, payload.manifest, classification);
  result.blockers.push(distributionIssue(code, message, pathValue));
  return result;
}

function runInstall(options: DistributionOperationOptions, payload: LoadedPayload, classification: DistributionClassification): DistributionOperationResult {
  const targetRoot = path.resolve(options.targetRoot);
  const result = resultBase('install', targetRoot, payload.manifest, classification);
  if (!classification.valid) {
    result.blockers.push(distributionIssue('DISTRIBUTION_STATE_INVALID', classification.reasons.join(' ')));
    return result;
  }
  if (classification.state === 'legacy') {
    result.status = 'migration-required';
    result.blockers.push(distributionIssue('MIGRATION_REQUIRED', 'Legacy project detected. Run `npx vibe-governance@latest migrate`; install never performs implicit legacy conversion.'));
    return result;
  }
  if (classification.state === 'vnext') {
    const comparison = classification.version ? compareVersions(classification.version, payload.manifest.distribution_version) : null;
    if (comparison === 0 && fileExists(statePath(targetRoot, payload.manifest))) {
      try {
        verifyDistributionInstallation(targetRoot, payload);
        result.status = 'no-op';
        result.read_back_verified = true;
        return result;
      } catch (error) {
        result.blockers.push(distributionIssue('MANAGED_TARGET_DRIFT', error instanceof Error ? error.message : String(error)));
        return result;
      }
    }
    if (comparison !== null && comparison < 0) {
      result.status = 'upgrade-required';
      result.blockers.push(distributionIssue('UPGRADE_REQUIRED', `vNext distribution ${classification.version} is older than ${payload.manifest.distribution_version}; run upgrade explicitly.`));
      return result;
    }
    if (comparison !== null && comparison > 0) {
      result.blockers.push(distributionIssue('DISTRIBUTION_VERSION_UNSUPPORTED', `Target distribution ${classification.version} is newer than this installer.`));
      return result;
    }
    result.blockers.push(distributionIssue('UPGRADE_REQUIRED', 'An older or unbound vNext distribution requires the explicit upgrade command.'));
    return result;
  }
  return options.dryRun
    ? runDryRunPromotion(targetRoot, payload, 'install', classification, null)
    : runTransactionalPromotion(targetRoot, payload, 'install', classification, null, options.testHooks);
}

function runUpgrade(options: DistributionOperationOptions, payload: LoadedPayload, classification: DistributionClassification): DistributionOperationResult {
  const targetRoot = path.resolve(options.targetRoot);
  const result = resultBase('upgrade', targetRoot, payload.manifest, classification);
  if (!classification.valid) {
    result.blockers.push(distributionIssue('DISTRIBUTION_STATE_INVALID', classification.reasons.join(' ')));
    return result;
  }
  if (classification.state === 'uninstalled') {
    result.blockers.push(distributionIssue('UPGRADE_NOT_APPLICABLE', 'No vNext distribution is installed; run install first.'));
    return result;
  }
  if (classification.state === 'legacy') {
    result.status = 'migration-required';
    result.blockers.push(distributionIssue('MIGRATION_REQUIRED', 'Legacy project detected; upgrade never performs implicit legacy conversion. Run migrate explicitly.'));
    return result;
  }
  const comparison = classification.version ? compareVersions(classification.version, payload.manifest.distribution_version) : null;
  if (comparison === null || comparison > 0) {
    result.blockers.push(distributionIssue('DISTRIBUTION_VERSION_UNSUPPORTED', `Cannot upgrade an unknown or newer vNext distribution: ${classification.version ?? 'unknown'}.`));
    return result;
  }
  if (comparison === 0 && fileExists(statePath(targetRoot, payload.manifest))) {
    try {
      verifyDistributionInstallation(targetRoot, payload);
      result.status = 'no-op';
      result.read_back_verified = true;
      return result;
    } catch (error) {
      result.blockers.push(distributionIssue('MANAGED_TARGET_DRIFT', error instanceof Error ? error.message : String(error)));
      return result;
    }
  }
  const oldState = (() => {
    try { return readDistributionState(targetRoot, payload.manifest); } catch { return null; }
  })();
  const idleIssues = governanceIdleBoundary(targetRoot);
  if (idleIssues.length > 0) {
    result.blockers.push(...idleIssues);
    return result;
  }
  if (options.dryRun) {
    return runDryRunPromotion(targetRoot, payload, 'upgrade', classification, oldState);
  }
  return runTransactionalPromotion(targetRoot, payload, 'upgrade', classification, oldState, options.testHooks);
}

function runMigrate(options: DistributionOperationOptions, payload: LoadedPayload, classification: DistributionClassification): DistributionOperationResult {
  const targetRoot = path.resolve(options.targetRoot);
  const result = resultBase('migrate', targetRoot, payload.manifest, classification);
  if (!classification.valid) {
    result.blockers.push(distributionIssue('DISTRIBUTION_STATE_INVALID', classification.reasons.join(' ')));
    return result;
  }
  if (classification.state !== 'legacy') {
    result.blockers.push(distributionIssue('MIGRATION_NOT_APPLICABLE', classification.state === 'uninstalled' ? 'No legacy project is present; run install for an uninstalled target.' : 'Target is already vNext; migrate only handles legacy projects. Run upgrade only when the vNext distribution is older.'));
    return result;
  }
  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-governance-migration-'));
  let preparedJournal = false;
  let migrationPreimageTreeHash: string | undefined;
  let migrationPreimageWrites: string[] = [];
  let migrationPreimageDeletes: string[] = [];
  try {
    const pack = createMigrationPack({ sourceRoot: payload.sourceRoot, targetRoot, outDir: packDir, overwrite: true });
    const runtimeIdentity = runtimeIdentityFromPayload(payload);
    // The Migration Pack remains the only converter. Distribution state is
    // opaque metadata appended to its same transaction, not a second parser.
    const state = JSON.parse(stateContent(payload.manifest)) as DistributionState;
    // Validate the Pack before journaling; the journal is excluded from the
    // Migration Pack partial-vNext scan and is created immediately before
    // the shared promotion path.
    const validatedPack = validateMigrationPack({ packDir, sourceRoot: payload.sourceRoot, targetRoot });
    const plannedWrites = [
      ...validatedPack.artifacts.map(artifact => artifact.target_path),
      ...payload.bundle.artifacts.map(artifact => artifact.target_path),
      '.workflow-system/vnext/INSTALL_STATE.json',
      '.workflow-system/vnext/MIGRATION_RECEIPT.json',
      payload.manifest.state.path,
      payload.manifest.runtime_dependency_path,
    ].sort();
    const plannedDeletes = validatedPack.legacy_surface.entries.filter(entry => entry.action === 'remove').map(entry => entry.path).sort();
    migrationPreimageWrites = plannedWrites;
    migrationPreimageDeletes = plannedDeletes;
    if (options.dryRun) {
      const migration = installMigrationPack({
        packDir,
        bundleDir: payload.bundleDir,
        targetRoot,
        sourceRoot: payload.sourceRoot,
        dryRun: true,
        portableBundle: true,
        additionalWrites: [{ path: payload.manifest.state.path, content: stateContent(payload.manifest) }],
      });
      result.migration = migration;
      result.status = migration.status === 'ready' ? 'ready' : 'rejected';
      result.planned_writes = migration.planned_writes;
      result.planned_deletes = migration.planned_deletes;
      result.blockers.push(...migration.blockers.map(issue => distributionIssue(issue.code, issue.message, issue.path)));
      return result;
    }
    const preimageTreeHash = computeDistributionPreimageHash(targetRoot, payload.manifest, plannedWrites, plannedDeletes);
    migrationPreimageTreeHash = preimageTreeHash;
    const journal: DistributionJournal = {
      schema_version: 1,
      kind: 'vibe-governance-distribution-in-progress',
      operation: 'migrate',
      from_state: 'legacy',
      to_state: 'vnext',
      distribution_version: payload.manifest.distribution_version,
      manifest_digest: payload.manifest.manifest_digest,
      preimage_tree_hash: preimageTreeHash,
      planned_writes: plannedWrites,
      planned_deletes: plannedDeletes,
      recovery: 'rollback-read-back-fail-closed',
    };
    if (isFrozenPath(targetRoot, payload.manifest.state.in_progress_path)) return baseRejected('migrate', targetRoot, payload, classification, 'FROZEN_PATH', 'Distribution journal path is frozen.', payload.manifest.state.in_progress_path);
    writeJournal(targetRoot, journal, payload.manifest);
    preparedJournal = true;
    const migration = installMigrationPack({
      packDir,
      bundleDir: payload.bundleDir,
      targetRoot,
      sourceRoot: payload.sourceRoot,
      dryRun: false,
      portableBundle: true,
      additionalWrites: [{ path: payload.manifest.state.path, content: stateContent(payload.manifest) }],
      postPromotionVerify: () => {
        // Keep an explicit use of the payload Runtime identity in the
        // migration read-back boundary; the Pack validates the actual staged
        // identity and this guards the distribution contract as well.
        if (runtimeIdentity.package_version !== payload.manifest.distribution_version) throw new Error('Distribution and Runtime versions differ during migration.');
        verifyDistributionInstallation(targetRoot, payload);
      },
    });
    result.migration = migration;
    result.planned_writes = migration.planned_writes;
    result.planned_deletes = migration.planned_deletes;
    if (migration.status !== 'installed' && migration.status !== 'replayed') {
      result.blockers.push(...migration.blockers.map(issue => distributionIssue(issue.code, issue.message, issue.path)));
      let rollbackVerified = false;
      try { rollbackVerified = computeDistributionPreimageHash(targetRoot, payload.manifest, plannedWrites, plannedDeletes) === preimageTreeHash; } catch { rollbackVerified = false; }
      if (rollbackVerified) {
        try { removeJournal(targetRoot, payload.manifest); preparedJournal = false; } catch { /* retain marker */ }
      } else result.warnings.push(distributionIssue('ROLLBACK_UNVERIFIED', 'Migration rollback could not be read-back verified; the Distribution journal was retained.', payload.manifest.state.in_progress_path));
      return result;
    }
    if (preparedJournal) removeJournal(targetRoot, payload.manifest);
    result.status = 'installed';
    result.read_back_verified = true;
    return result;
  } catch (error) {
    if (preparedJournal) {
      let rollbackVerified = false;
      if (migrationPreimageTreeHash) {
        try {
          // The journal is written only after the Pack has supplied the exact
          // migration write/delete plan, so recovery uses the same scoped
          // Distribution boundary as the normal install/upgrade path.
          rollbackVerified = computeDistributionPreimageHash(targetRoot, payload.manifest, migrationPreimageWrites, migrationPreimageDeletes) === migrationPreimageTreeHash;
        } catch { rollbackVerified = false; }
      }
      if (rollbackVerified) {
        try { removeJournal(targetRoot, payload.manifest); } catch { /* fail closed by retaining a marker */ }
      }
    }
    const migrationError = error as { issues?: MigrationIssue[]; code?: string };
    if (Array.isArray(migrationError.issues) && migrationError.issues.length > 0) result.blockers.push(...migrationError.issues.map(issue => distributionIssue(issue.code, issue.message, issue.path)));
    result.blockers.push(distributionIssue(migrationError.code ?? 'MIGRATION_FAILED', error instanceof Error ? error.message : String(error)));
    return result;
  } finally {
    fs.rmSync(packDir, { recursive: true, force: true });
  }
}

function executeDistribution(options: DistributionOperationOptions, operation: DistributionOperation): DistributionOperationResult {
  const targetRoot = path.resolve(options.targetRoot);
  let payload: LoadedPayload;
  try {
    payload = loadDistributionPayload(packageRootFor(options));
  } catch (error) {
    const fallbackManifest: DistributionManifest = {
      schema_version: 1,
      kind: VIBE_GOVERNANCE_DISTRIBUTION_MANIFEST_KIND,
      product: VIBE_GOVERNANCE_PRODUCT,
      package_name: VIBE_GOVERNANCE_PACKAGE_NAME,
      distribution_version: '0.0.0',
      minimum_node: VNEXT_RUNTIME_NODE_MIN_VERSION,
      runtime_dependency_path: VIBE_GOVERNANCE_RUNTIME_DEPENDENCY_RELATIVE_PATH,
      artifact_source: 'embedded-release',
      artifacts: [],
      state: { path: VIBE_GOVERNANCE_DISTRIBUTION_STATE_RELATIVE_PATH, in_progress_path: VIBE_GOVERNANCE_DISTRIBUTION_IN_PROGRESS_RELATIVE_PATH },
      support: { bundle_path: 'vnext-bundle', bundle_manifest_sha256: '', migration_source_path: 'migration-source' },
      manifest_digest: '',
    };
    const result = resultBase(operation, targetRoot, fallbackManifest, { state: 'uninstalled', version: null, valid: false, reasons: [] });
    result.blockers.push(distributionIssue('PAYLOAD_INVALID', error instanceof Error ? error.message : String(error)));
    return result;
  }
  const guard = checkTargetRoot(payload.sourceRoot, targetRoot);
  if (!guard.allowed) return baseRejected(operation, targetRoot, payload, classifyDistribution(targetRoot, payload.manifest), 'TARGET_ROOT_DENIED', guard.message, targetRoot);
  const classification = classifyDistribution(targetRoot, payload.manifest);
  if (fileExists(journalPath(targetRoot, payload.manifest))) {
    const result = resultBase(operation, targetRoot, payload.manifest, classification);
    result.blockers.push(distributionIssue('DISTRIBUTION_IN_PROGRESS', 'An interrupted Distribution transaction is present; inspect and recover explicitly before retrying.', payload.manifest.state.in_progress_path));
    return result;
  }
  if (options.dryRun) {
    if (operation === 'migrate') {
      return runMigrate(options, payload, classification);
    }
  }
  if (operation === 'install') return runInstall(options, payload, classification);
  if (operation === 'upgrade') return runUpgrade(options, payload, classification);
  return runMigrate(options, payload, classification);
}

export function installDistribution(options: DistributionOperationOptions): DistributionOperationResult {
  return executeDistribution(options, 'install');
}

export function migrateDistribution(options: DistributionOperationOptions): DistributionOperationResult {
  return executeDistribution(options, 'migrate');
}

export function upgradeDistribution(options: DistributionOperationOptions): DistributionOperationResult {
  return executeDistribution(options, 'upgrade');
}

export function distributionPackageRoot(): string {
  return packageRootFromModule();
}

export function runDistributionCli(argv: string[] = process.argv.slice(2)): number {
  const [command = 'help', ...rest] = argv;
  if (command === 'help' || command === '--help') {
    console.log([
      'Vibe Governance Distribution CLI',
      '',
      'Usage:',
      '  npx vibe-governance@latest install [--root <project>] [--json] [--dry-run]',
      '  npx vibe-governance@latest migrate [--root <project>] [--json] [--dry-run]',
      '  npx vibe-governance@latest upgrade [--root <project>] [--json] [--dry-run]',
      '',
      'Install owns software distribution only. After a successful fresh install, next: invoke the `bootstrap-project` Agent Skill.',
    ].join('\n'));
    return 0;
  }
  if (command !== 'install' && command !== 'migrate' && command !== 'upgrade') {
    console.error(`Unknown Distribution command: ${command}`);
    return 1;
  }
  let targetRoot = process.cwd();
  let json = false;
  let dryRun = false;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--root') {
      const value = rest[index + 1];
      if (!value || value.startsWith('--')) {
        console.error('--root requires a project path');
        return 1;
      }
      targetRoot = value;
      index += 1;
    } else if (arg === '--json') json = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--path' || arg === '--paths-file' || arg === '--bundle' || arg === '--source' || arg === '--workflow-system-root') {
      console.error(`${arg} is not part of the Distribution installation protocol.`);
      return 1;
    } else {
      console.error(`Unknown argument: ${arg}`);
      return 1;
    }
  }
  const result = command === 'install'
    ? installDistribution({ targetRoot, dryRun })
    : command === 'migrate'
      ? migrateDistribution({ targetRoot, dryRun })
      : upgradeDistribution({ targetRoot, dryRun });
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(JSON.stringify(result, null, 2));
    if (result.next) console.log(`Next:\n  ${result.next}`);
  }
  return ['installed', 'upgraded', 'no-op', 'ready'].includes(result.status) ? 0 : 1;
}
