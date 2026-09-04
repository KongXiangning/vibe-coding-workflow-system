/**
 * Read-only admission for a completed vNext Migration Pack conversion.
 *
 * This module deliberately knows only the paired vNext install state,
 * migration receipt, and the canonical conversion envelopes that the Pack
 * produced.  It does not parse legacy protocol, schema, Skill, or document
 * surfaces.  It checks only Pack-declared removed paths; the full
 * legacy-aware surface audit remains in the Migration Pack facade.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { parseDocument } from 'yaml';
import {
  readCanonicalCurrentTask,
  VNEXT_RUNTIME_ENTRYPOINT_RELATIVE_PATH,
  VNEXT_RUNTIME_NODE_MIN_VERSION,
  VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH,
} from './kernel';

export const COMPLETED_MIGRATION_INSTALL_STATE_RELATIVE_PATH = '.workflow-system/vnext/INSTALL_STATE.json' as const;
export const COMPLETED_MIGRATION_RECEIPT_RELATIVE_PATH = '.workflow-system/vnext/MIGRATION_RECEIPT.json' as const;

const SAFE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const TARGET_IDENTITY_PATTERN = /^[a-f0-9]{32}$/u;
const STABLE_ID_PATTERN = /^artifact-[a-f0-9]{24}$/u;
const CANONICAL_DOCUMENT_ID_PATTERN = /^doc-[a-f0-9]{24}$/u;
const CANONICAL_SCHEMA_VERSION = 1;
const CANONICAL_DOCUMENT_KIND = 'vnext-canonical-document';
const CANONICAL_CONVERSION_RULE = 'canonical-envelope-v1';
const CURRENT_TASK_FILE = 'CURRENT_TASK.md';

export type HistoricalRuntimeDistribution = {
  kind: 'project-local-node';
  package_path: string;
  entrypoint: string;
  package_version: string;
  node_min_version: string;
  package_lock_sha256: string;
  entrypoint_sha256: string;
};

export type CompletedMigrationProvenance = {
  migration_pack_id: string;
  bundle_id: string;
  source_revision: string;
  source_tree_hash: string;
  target_identity: string;
  runtime_distribution: HistoricalRuntimeDistribution | null;
  installed_at: string;
  converted_artifact_ids: string[];
  converted_artifact_paths: string[];
};

export class MigrationProvenanceError extends Error {
  readonly code: string;

  constructor(message: string) {
    super(`COMPLETED_MIGRATION_INVALID: ${message}`);
    this.code = 'COMPLETED_MIGRATION_INVALID';
    this.name = 'MigrationProvenanceError';
  }
}

function fail(message: string): never {
  throw new MigrationProvenanceError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function expectRecord(value: unknown, location: string): Record<string, unknown> {
  if (!isRecord(value)) fail(`${location} must be a mapping.`);
  return value;
}

function expectString(value: unknown, location: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) fail(`${location} must be a non-empty string.`);
  return value.trim();
}

function expectStringArray(value: unknown, location: string, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) fail(`${location} must be ${allowEmpty ? 'an array' : 'a non-empty array'}.`);
  const values = value.map((item, index) => expectString(item, `${location}[${index}]`));
  if (new Set(values).size !== values.length) fail(`${location} must not contain duplicates.`);
  return values;
}

function expectExactKeys(value: Record<string, unknown>, expected: readonly string[], location: string): void {
  const expectedSet = new Set(expected);
  const missing = expected.filter(key => !(key in value));
  const extra = Object.keys(value).filter(key => !expectedSet.has(key));
  if (missing.length > 0 || extra.length > 0) fail(`${location} keys mismatch; missing=[${missing.join(', ')}], unexpected=[${extra.join(', ')}].`);
}

function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeRoot(root: string): string {
  const resolved = path.resolve(root);
  const normalized = resolved.replace(/\\/gu, '/');
  const parsedRoot = path.parse(resolved).root.replace(/\\/gu, '/');
  const rootValue = process.platform === 'win32' ? parsedRoot.toLowerCase() : parsedRoot;
  const normalizedValue = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  return normalizedValue === rootValue ? rootValue : normalizedValue.replace(/\/+$/u, '');
}

function normalizeRepoPath(value: string, location: string): string {
  const normalized = value.replace(/\\/gu, '/').trim().replace(/^\.\//u, '');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//u.test(normalized) || normalized.split('/').some(segment => segment === '..' || segment.length === 0) || /[\0-\x1F\x7F]/u.test(normalized)) {
    fail(`${location} is not a safe repository-relative path: ${value}`);
  }
  return normalized;
}

function resolveRepoPath(root: string, relative: string, location: string): string {
  const normalized = normalizeRepoPath(relative, location);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...normalized.split('/'));
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  if (resolved !== resolvedRoot && !resolved.startsWith(prefix)) fail(`${location} escapes the target root: ${relative}`);
  return resolved;
}

function readJson(filePath: string, location: string): Record<string, unknown> {
  try {
    return expectRecord(JSON.parse(fs.readFileSync(filePath, 'utf8')), location);
  } catch (error) {
    if (error instanceof MigrationProvenanceError) throw error;
    fail(`${location} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readYaml(filePath: string, location: string): Record<string, unknown> {
  try {
    const document = parseDocument(fs.readFileSync(filePath, 'utf8'), { uniqueKeys: true });
    const diagnostics = [...document.errors, ...document.warnings];
    if (diagnostics.length > 0) fail(`${location} is invalid YAML: ${diagnostics.map(item => item.message).join('; ')}`);
    return expectRecord(document.toJS(), location);
  } catch (error) {
    if (error instanceof MigrationProvenanceError) throw error;
    fail(`${location} is invalid YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function runtimeIdentity(value: unknown, location: string): HistoricalRuntimeDistribution | null {
  if (value === null) return null;
  const record = expectRecord(value, location);
  expectExactKeys(record, ['kind', 'package_path', 'entrypoint', 'package_version', 'node_min_version', 'package_lock_sha256', 'entrypoint_sha256'], location);
  const packageVersion = expectString(record.package_version, `${location}.package_version`);
  const nodeMinVersion = expectString(record.node_min_version, `${location}.node_min_version`);
  const packageLock = expectString(record.package_lock_sha256, `${location}.package_lock_sha256`);
  const entrypoint = expectString(record.entrypoint_sha256, `${location}.entrypoint_sha256`);
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(packageVersion) || !/^>=\d+\.\d+\.\d+$/u.test(nodeMinVersion) || !SHA256_PATTERN.test(packageLock) || !SHA256_PATTERN.test(entrypoint)) {
    fail(`${location} has invalid Runtime identity fields.`);
  }
  if (record.kind !== 'project-local-node' || record.package_path !== VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH || record.entrypoint !== VNEXT_RUNTIME_ENTRYPOINT_RELATIVE_PATH) {
    fail(`${location} does not declare the canonical project-local Runtime shape.`);
  }
  return {
    kind: 'project-local-node',
    package_path: VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH,
    entrypoint: VNEXT_RUNTIME_ENTRYPOINT_RELATIVE_PATH,
    package_version: packageVersion,
    node_min_version: nodeMinVersion,
    package_lock_sha256: packageLock,
    entrypoint_sha256: entrypoint,
  };
}

function sameRuntime(left: HistoricalRuntimeDistribution | null, right: HistoricalRuntimeDistribution | null): boolean {
  if (left === null || right === null) return left === right;
  return left.kind === right.kind
    && left.package_path === right.package_path
    && left.entrypoint === right.entrypoint
    && left.package_version === right.package_version
    && left.node_min_version === right.node_min_version
    && left.package_lock_sha256 === right.package_lock_sha256
    && left.entrypoint_sha256 === right.entrypoint_sha256;
}

type InstallState = {
  migration_pack_id: string;
  bundle_id: string;
  source_revision: string;
  source_tree_hash: string;
  target_identity: string;
  runtime_distribution: HistoricalRuntimeDistribution | null;
  installed_at: string;
  managed_files: Array<{ path: string; checksum: string; category: string }>;
  removed_legacy_files: string[];
};

function validateInstallState(value: Record<string, unknown>): InstallState {
  const legacyShape = 'mode' in value && !('distribution_state' in value);
  expectExactKeys(value, legacyShape
    ? ['schema_version', 'kind', 'mode', 'migration_pack_id', 'bundle_id', 'source_revision', 'source_tree_hash', 'target_identity', 'runtime_distribution', 'installed_at', 'managed_files', 'removed_legacy_files', 'legacy_compatibility', 'recovery_boundary']
    : ['schema_version', 'kind', 'distribution_state', 'distribution_version', 'migration_pack_id', 'bundle_id', 'source_revision', 'source_tree_hash', 'target_identity', 'runtime_distribution', 'installed_at', 'managed_files', 'removed_legacy_files', 'legacy_compatibility', 'recovery_boundary'], 'INSTALL_STATE.json');
  if (value.schema_version !== 1 || value.kind !== 'vnext-install-state' || (legacyShape ? value.mode !== 'pure-vnext' : value.distribution_state !== 'vnext') || value.legacy_compatibility !== 'absent' || value.recovery_boundary !== 'in-progress-marker') fail('INSTALL_STATE.json is not a valid vNext install state.');
  const migrationPackId = expectString(value.migration_pack_id, 'INSTALL_STATE.json.migration_pack_id');
  const bundleId = expectString(value.bundle_id, 'INSTALL_STATE.json.bundle_id');
  if (!/^migration-[a-f0-9]{24}$/u.test(migrationPackId) || !/^bundle-[a-f0-9]{24}$/u.test(bundleId)) fail('INSTALL_STATE.json has invalid migration or bundle identity.');
  const sourceRevision = expectString(value.source_revision, 'INSTALL_STATE.json.source_revision');
  const sourceTreeHash = expectString(value.source_tree_hash, 'INSTALL_STATE.json.source_tree_hash');
  const targetIdentity = expectString(value.target_identity, 'INSTALL_STATE.json.target_identity');
  if (!SHA256_PATTERN.test(sourceTreeHash) || !TARGET_IDENTITY_PATTERN.test(targetIdentity)) fail('INSTALL_STATE.json has invalid source/target identity fields.');
  const installedAt = expectString(value.installed_at, 'INSTALL_STATE.json.installed_at');
  const runtime = runtimeIdentity(value.runtime_distribution, 'INSTALL_STATE.json.runtime_distribution');
  if (!Array.isArray(value.managed_files) || value.managed_files.length === 0) fail('INSTALL_STATE.json.managed_files must be non-empty.');
  const seen = new Set<string>();
  const managedFiles = value.managed_files.map((raw, index) => {
    const item = expectRecord(raw, `INSTALL_STATE.json.managed_files[${index}]`);
    expectExactKeys(item, ['path', 'checksum', 'category'], `INSTALL_STATE.json.managed_files[${index}]`);
    const relative = normalizeRepoPath(expectString(item.path, `INSTALL_STATE.json.managed_files[${index}].path`), `INSTALL_STATE.json.managed_files[${index}].path`);
    if (seen.has(relative)) fail(`INSTALL_STATE.json.managed_files contains duplicate path ${relative}.`);
    seen.add(relative);
    const checksum = item.checksum === '' ? '' : expectString(item.checksum, `INSTALL_STATE.json.managed_files[${index}].checksum`);
    if (!SHA256_PATTERN.test(checksum) && !(relative === COMPLETED_MIGRATION_INSTALL_STATE_RELATIVE_PATH && checksum === '')) fail(`INSTALL_STATE.json.managed_files[${index}].checksum is invalid.`);
    return { path: relative, checksum, category: expectString(item.category, `INSTALL_STATE.json.managed_files[${index}].category`) };
  });
  const removed = expectStringArray(value.removed_legacy_files, 'INSTALL_STATE.json.removed_legacy_files', true).map((item, index) => normalizeRepoPath(item, `INSTALL_STATE.json.removed_legacy_files[${index}]`));
  return { migration_pack_id: migrationPackId, bundle_id: bundleId, source_revision: sourceRevision, source_tree_hash: sourceTreeHash, target_identity: targetIdentity, runtime_distribution: runtime, installed_at: installedAt, managed_files: managedFiles, removed_legacy_files: removed };
}

type MigrationReceipt = {
  migration_pack_id: string;
  bundle_id: string;
  source_revision: string;
  source_tree_hash: string;
  target_identity: string;
  runtime_distribution: HistoricalRuntimeDistribution | null;
  installed_at: string;
  converted_artifact_ids: string[];
};

function validateReceipt(value: Record<string, unknown>): MigrationReceipt {
  expectExactKeys(value, ['schema_version', 'kind', 'migration_pack_id', 'bundle_id', 'source_revision', 'source_tree_hash', 'target_identity', 'runtime_distribution', 'installed_at', 'converted_artifact_ids', 'legacy_compatibility'], 'MIGRATION_RECEIPT.json');
  if (value.schema_version !== 1 || value.kind !== 'vnext-migration-receipt' || value.legacy_compatibility !== 'absent') fail('MIGRATION_RECEIPT.json is not a pure vNext migration receipt.');
  const migrationPackId = expectString(value.migration_pack_id, 'MIGRATION_RECEIPT.json.migration_pack_id');
  const bundleId = expectString(value.bundle_id, 'MIGRATION_RECEIPT.json.bundle_id');
  const sourceRevision = expectString(value.source_revision, 'MIGRATION_RECEIPT.json.source_revision');
  const sourceTreeHash = expectString(value.source_tree_hash, 'MIGRATION_RECEIPT.json.source_tree_hash');
  const targetIdentity = expectString(value.target_identity, 'MIGRATION_RECEIPT.json.target_identity');
  if (!/^migration-[a-f0-9]{24}$/u.test(migrationPackId) || !/^bundle-[a-f0-9]{24}$/u.test(bundleId) || !SHA256_PATTERN.test(sourceTreeHash) || !TARGET_IDENTITY_PATTERN.test(targetIdentity)) fail('MIGRATION_RECEIPT.json has invalid identity fields.');
  const ids = expectStringArray(value.converted_artifact_ids, 'MIGRATION_RECEIPT.json.converted_artifact_ids', true);
  if (ids.some(item => !STABLE_ID_PATTERN.test(item))) fail('MIGRATION_RECEIPT.json.converted_artifact_ids contains an invalid artifact ID.');
  return { migration_pack_id: migrationPackId, bundle_id: bundleId, source_revision: sourceRevision, source_tree_hash: sourceTreeHash, target_identity: targetIdentity, runtime_distribution: runtimeIdentity(value.runtime_distribution, 'MIGRATION_RECEIPT.json.runtime_distribution'), installed_at: expectString(value.installed_at, 'MIGRATION_RECEIPT.json.installed_at'), converted_artifact_ids: ids };
}

function canonicalDocumentId(kind: string, sourcePath: string, sourceSha: string): string {
  return `doc-${sha256(`${kind}\0${sourcePath}\0${sourceSha}`).slice(0, 24)}`;
}

function canonicalArtifactIdentity(relativePath: string, content: string): { stableId: string; sourceRevision: string; sourceTreeHash: string } {
  let kind: string;
  let sourcePath: string;
  let sourceSha: string;
  let sourceRevision: string;
  let sourceTreeHash: string;
  if (relativePath === '.workflow-system/PROJECT_PROFILE.yaml') {
    let document: Record<string, unknown>;
    try {
      const parsed = parseDocument(content, { uniqueKeys: true });
      const diagnostics = [...parsed.errors, ...parsed.warnings];
      if (diagnostics.length > 0) fail(`migrated project profile has invalid YAML: ${diagnostics.map(item => item.message).join('; ')}`);
      document = expectRecord(parsed.toJS(), 'migrated project profile');
    } catch (error) {
      if (error instanceof MigrationProvenanceError) throw error;
      fail(`migrated project profile is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
    const metadata = expectRecord(document.vnext_migration, 'migrated project profile.vnext_migration');
    expectExactKeys(metadata, ['schema_version', 'kind', 'document_id', 'source_path', 'source_sha256', 'legacy_source_revision', 'legacy_source_tree_hash', 'legacy_protocol_version', 'conversion_rule', 'original_text_preserved', 'path_references'], 'migrated project profile.vnext_migration');
    if (metadata.schema_version !== CANONICAL_SCHEMA_VERSION || metadata.kind !== 'vnext-canonical-profile' || metadata.conversion_rule !== CANONICAL_CONVERSION_RULE || metadata.original_text_preserved !== true) fail('migrated project profile does not carry the canonical Migration Pack provenance envelope.');
    kind = 'project-profile';
    sourcePath = normalizeRepoPath(expectString(metadata.source_path, 'migrated project profile source_path'), 'migrated project profile source_path');
    sourceSha = expectString(metadata.source_sha256, 'migrated project profile source_sha256');
    sourceRevision = expectString(metadata.legacy_source_revision, 'migrated project profile legacy_source_revision');
    sourceTreeHash = expectString(metadata.legacy_source_tree_hash, 'migrated project profile legacy_source_tree_hash');
    if (metadata.document_id !== canonicalDocumentId(kind, sourcePath, sourceSha)) fail('migrated project profile document_id is not bound to its source identity.');
  } else {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/u.exec(content);
    if (!match) fail(`migrated artifact ${relativePath} is missing the canonical frontmatter envelope.`);
    const parsed = parseDocument(match[1]!, { uniqueKeys: true });
    const diagnostics = [...parsed.errors, ...parsed.warnings];
    if (diagnostics.length > 0) fail(`migrated artifact ${relativePath} has invalid canonical frontmatter: ${diagnostics.map(item => item.message).join('; ')}`);
    const header = expectRecord(parsed.toJS(), `migrated artifact ${relativePath} frontmatter`);
    expectExactKeys(header, ['schema_version', 'kind', 'document_kind', 'document_id', 'source_path', 'source_sha256', 'legacy_source_revision', 'legacy_source_tree_hash', 'legacy_protocol_version', 'conversion_rule', 'original_text_preserved', 'heading_index', 'path_references'], `migrated artifact ${relativePath} frontmatter`);
    if (header.schema_version !== CANONICAL_SCHEMA_VERSION || header.kind !== CANONICAL_DOCUMENT_KIND || header.conversion_rule !== CANONICAL_CONVERSION_RULE || header.original_text_preserved !== true) fail(`migrated artifact ${relativePath} does not carry the canonical Migration Pack provenance envelope.`);
    const documentKind = expectString(header.document_kind, `migrated artifact ${relativePath}.document_kind`);
    if (!['governance-document', 'task-archive', 'target-owned-preserved'].includes(documentKind)) fail(`migrated artifact ${relativePath} has an unsupported document kind.`);
    kind = documentKind;
    sourcePath = normalizeRepoPath(expectString(header.source_path, `migrated artifact ${relativePath}.source_path`), `migrated artifact ${relativePath}.source_path`);
    sourceSha = expectString(header.source_sha256, `migrated artifact ${relativePath}.source_sha256`);
    sourceRevision = expectString(header.legacy_source_revision, `migrated artifact ${relativePath}.legacy_source_revision`);
    sourceTreeHash = expectString(header.legacy_source_tree_hash, `migrated artifact ${relativePath}.legacy_source_tree_hash`);
    if (header.document_id !== canonicalDocumentId(kind, sourcePath, sourceSha)) fail(`migrated artifact ${relativePath} document_id is not bound to its source identity.`);
  }
  if (!SHA256_PATTERN.test(sourceSha) || !SHA256_PATTERN.test(sourceTreeHash) || sourcePath !== relativePath) fail(`migrated artifact ${relativePath} has an invalid or unbound source identity.`);
  return { stableId: `artifact-${sha256(`${kind}\0${sourcePath}\0${sourceSha}`).slice(0, 24)}`, sourceRevision, sourceTreeHash };
}

function validateCurrentTaskShape(root: string, currentTaskPath: string, runtimeInstalled: boolean): void {
  const content = fs.readFileSync(currentTaskPath, 'utf8');
  if (runtimeInstalled) {
    try {
      // When a project-local Runtime is part of the admitted conversion, use
      // its canonical reader rather than maintaining a second Runtime parser.
      readCanonicalCurrentTask(root);
      return;
    } catch (error) {
      fail(`current canonical CURRENT_TASK.md is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/u.exec(content);
  if (!match) fail('current canonical CURRENT_TASK.md is missing vNext frontmatter.');
  const parsed = parseDocument(match[1]!, { uniqueKeys: true });
  const diagnostics = [...parsed.errors, ...parsed.warnings];
  if (diagnostics.length > 0) fail(`current canonical CURRENT_TASK.md frontmatter is invalid: ${diagnostics.map(item => item.message).join('; ')}`);
  const frontmatter = expectRecord(parsed.toJS(), 'current canonical CURRENT_TASK.md frontmatter');
  if (frontmatter.schema_version !== 1 || frontmatter.kind !== 'vnext-current-task' || typeof frontmatter.document_id !== 'string' || !CANONICAL_DOCUMENT_ID_PATTERN.test(frontmatter.document_id)) fail('current canonical CURRENT_TASK.md has an invalid vNext identity.');
  for (const heading of ['## 任务信息', '## 验收标准', '## 允许修改范围', '## 实施步骤']) if (!match[2]!.includes(heading)) fail(`current canonical CURRENT_TASK.md is missing required heading ${heading}.`);
}

function profileTargetIdentity(root: string, profile: Record<string, unknown>): string {
  const project = expectRecord(profile.project, 'PROJECT_PROFILE.yaml.project');
  const slug = expectString(project.slug, 'PROJECT_PROFILE.yaml.project.slug');
  if (!SAFE_ID_PATTERN.test(slug)) fail(`PROJECT_PROFILE.yaml.project.slug is not a safe slug: ${slug}`);
  return sha256(`${normalizeRoot(root)}\0${slug}`).slice(0, 32);
}

/**
 * Validate the completed migration evidence without scanning or interpreting
 * any legacy surface.  Mutable governance bytes are deliberately checked for
 * current canonical readability and preserved conversion identity, not for
 * equality with migration-time checksums.
 */
export function validateCompletedMigrationProvenance(targetRoot: string): CompletedMigrationProvenance | null {
  const root = path.resolve(targetRoot);
  const statePath = resolveRepoPath(root, COMPLETED_MIGRATION_INSTALL_STATE_RELATIVE_PATH, 'completed migration install state');
  const receiptPath = resolveRepoPath(root, COMPLETED_MIGRATION_RECEIPT_RELATIVE_PATH, 'completed migration receipt');
  const hasState = fs.existsSync(statePath);
  const hasReceipt = fs.existsSync(receiptPath);
  if (!hasState && !hasReceipt) return null;
  if (!hasState || !hasReceipt) fail('completed migration provenance requires both INSTALL_STATE.json and MIGRATION_RECEIPT.json.');

  const state = validateInstallState(readJson(statePath, 'INSTALL_STATE.json'));
  const receipt = validateReceipt(readJson(receiptPath, 'MIGRATION_RECEIPT.json'));
  if (state.migration_pack_id !== receipt.migration_pack_id || state.bundle_id !== receipt.bundle_id || state.source_revision !== receipt.source_revision || state.source_tree_hash !== receipt.source_tree_hash || state.target_identity !== receipt.target_identity || state.installed_at !== receipt.installed_at || !sameRuntime(state.runtime_distribution, receipt.runtime_distribution)) {
    fail('INSTALL_STATE.json and MIGRATION_RECEIPT.json do not describe the same conversion.');
  }
  const admittedCurrentPaths = new Set(state.managed_files.map(entry => entry.path));
  for (const removedPath of state.removed_legacy_files) {
    // A migration may replace a legacy protocol/schema/host file at the same
    // path. The new managed artifact is evidence of replacement, not a
    // residual legacy surface.
    if (admittedCurrentPaths.has(removedPath)) continue;
    if (fs.existsSync(resolveRepoPath(root, removedPath, `removed legacy path ${removedPath}`))) fail(`completed migration still has a Pack-declared removed legacy path: ${removedPath}`);
  }

  const profilePath = resolveRepoPath(root, '.workflow-system/PROJECT_PROFILE.yaml', 'completed migration PROJECT_PROFILE');
  if (!fs.existsSync(profilePath) || !fs.statSync(profilePath).isFile()) fail('completed migration provenance is missing PROJECT_PROFILE.yaml.');
  const profile = readYaml(profilePath, 'PROJECT_PROFILE.yaml');
  if (profileTargetIdentity(root, profile) !== state.target_identity) fail('completed migration target identity does not match the current project profile/root.');
  const workflowHomeValue = isRecord(profile.paths) ? profile.paths.workflow_home : undefined;
  const workflowHome = workflowHomeValue === undefined ? 'docs/workflow' : expectString(workflowHomeValue, 'PROJECT_PROFILE.yaml.paths.workflow_home');
  if (workflowHome !== 'docs/workflow') fail('completed migration workflow_home is not canonical.');

  const currentTaskRelative = `${workflowHome}/${CURRENT_TASK_FILE}`;
  const currentTaskPath = resolveRepoPath(root, currentTaskRelative, 'completed migration CURRENT_TASK');
  if (!fs.existsSync(currentTaskPath) || !fs.statSync(currentTaskPath).isFile()) fail('completed migration provenance is missing the canonical CURRENT_TASK.md.');
  const currentTaskRecord = state.managed_files.find(entry => entry.path === currentTaskRelative);
  if (!currentTaskRecord || !SHA256_PATTERN.test(currentTaskRecord.checksum)) fail('completed migration install state does not record the canonical CURRENT_TASK.md baseline.');
  validateCurrentTaskShape(root, currentTaskPath, state.runtime_distribution !== null);

  const migratedFiles = state.managed_files.filter(entry => entry.category === 'migrated-document').sort((left, right) => left.path.localeCompare(right.path));
  if (migratedFiles.length === 0) fail('completed migration install state contains no converted artifact records.');
  if (!migratedFiles.some(entry => entry.path === '.workflow-system/PROJECT_PROFILE.yaml')) fail('completed migration install state does not record the converted PROJECT_PROFILE.yaml artifact.');
  const derived = migratedFiles.map(entry => {
    const fullPath = resolveRepoPath(root, entry.path, `completed migration artifact ${entry.path}`);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) fail(`converted migration artifact is missing: ${entry.path}`);
    // Do not compare this current checksum to INSTALL_STATE: normal vNext
    // governance operations are allowed to change the artifact body.
    return { path: entry.path, ...canonicalArtifactIdentity(entry.path, fs.readFileSync(fullPath, 'utf8')) };
  });
  const derivedIds = derived.map(item => item.stableId);
  if (JSON.stringify(derivedIds) !== JSON.stringify(receipt.converted_artifact_ids)) fail('MIGRATION_RECEIPT.json converted_artifact_ids do not match current converted artifact identities.');
  const revision = derived[0]!.sourceRevision;
  const treeHash = derived[0]!.sourceTreeHash;
  if (derived.some(item => item.sourceRevision !== revision || item.sourceTreeHash !== treeHash)) fail('converted artifacts do not share one migration provenance identity.');

  return {
    migration_pack_id: state.migration_pack_id,
    bundle_id: state.bundle_id,
    source_revision: state.source_revision,
    source_tree_hash: state.source_tree_hash,
    target_identity: state.target_identity,
    runtime_distribution: state.runtime_distribution,
    installed_at: state.installed_at,
    converted_artifact_ids: [...receipt.converted_artifact_ids],
    converted_artifact_paths: migratedFiles.map(entry => entry.path),
  };
}
