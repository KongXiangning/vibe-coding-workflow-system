/**
 * Typed Runtime boundary for the vNext administrative bootstrap transaction.
 *
 * Bootstrap does not own an active task. It validates a closed proposal,
 * reuses the shared mutation-scope evaluator, and atomically writes the
 * caller-provided generated asset set. Project identity, mode admission,
 * source generation, and evidence selection remain in the bootstrap facade;
 * this module owns the write boundary and read-back behavior.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  evaluateMutationScope,
  parseMutationScope,
  type ConditionalScopeAuthorization,
  type MutationScopeCheckResult,
  type MutationTransformationKind,
} from './mutation-scope';

export const VNEXT_BOOTSTRAP_PROPOSAL_SCHEMA_VERSION = 1 as const;
export const VNEXT_BOOTSTRAP_PROPOSAL_KIND = 'vnext-bootstrap-proposal' as const;
export const BOOTSTRAP_MODES = ['design', 'greenfield', 'inventory', 'adopt', 'realign'] as const;
export type BootstrapMode = (typeof BOOTSTRAP_MODES)[number];

export const BOOTSTRAP_OPERATION_KINDS = [
  'contract-candidate-commit',
  'decision-record-transaction',
  'project-status-transaction',
  'paired-host-guidance-transaction',
] as const;
export type BootstrapOperationKind = (typeof BOOTSTRAP_OPERATION_KINDS)[number];

export const BOOTSTRAP_ASSET_CATEGORIES = ['protocol', 'schema', 'skill', 'runtime', 'config', 'generated', 'governance'] as const;
export type BootstrapAssetCategory = (typeof BOOTSTRAP_ASSET_CATEGORIES)[number];

export type BootstrapAuthorityEvidence = {
  kind: 'project-owner' | 'scope-admission' | 'evidence-admission' | 'dangerous-operation';
  source: string;
  subject: string;
};

export type BootstrapAsset = {
  path: string;
  category: BootstrapAssetCategory;
  content: string;
};

export type BootstrapSemanticOperation = {
  operation_kind: BootstrapOperationKind;
  target_paths: string[];
  evidence_refs: string[];
};

export type BootstrapProjectProposal = {
  schema_version: typeof VNEXT_BOOTSTRAP_PROPOSAL_SCHEMA_VERSION;
  kind: typeof VNEXT_BOOTSTRAP_PROPOSAL_KIND;
  caller: 'bootstrap-project';
  mode: BootstrapMode;
  target_identity: string;
  source_revision: string;
  source_tree_hash: string;
  scope_document: string;
  changed_paths: string[];
  conditional_authorizations: ConditionalScopeAuthorization[];
  transformation_kind: MutationTransformationKind;
  authority_evidence: BootstrapAuthorityEvidence[];
  semantic_operations: BootstrapSemanticOperation[];
  preconditions: string[];
  evidence_refs: string[];
  idempotency_key: string;
  requested_write_targets: string[];
  requested_directory_targets: string[];
  delete_targets: string[];
  assets: BootstrapAsset[];
};

export type BootstrapRuntimeValidation = {
  proposal: BootstrapProjectProposal;
  scope: MutationScopeCheckResult;
};

export type BootstrapDirectorySource = {
  path: string;
  sourcePath: string;
};

export type BootstrapRuntimeResult = {
  status: 'ready' | 'success' | 'no-op' | 'conflict' | 'blocked';
  operation_kind: 'bootstrap-project';
  mode: BootstrapMode;
  idempotency_key: string;
  target_identity: string;
  dry_run: boolean;
  committed: boolean;
  read_back_verified: boolean;
  planned_writes: string[];
  planned_directories: string[];
  message: string;
  scope: MutationScopeCheckResult;
};

const SAFE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/u;
const TARGET_IDENTITY_PATTERN = /^[a-f0-9]{32}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const HOST_GUIDANCE_PATHS = new Set(['AGENTS.md', 'CLAUDE.md']);

export class BootstrapRuntimeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'BootstrapRuntimeError';
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new BootstrapRuntimeError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function expectRecord(value: unknown, location: string): Record<string, unknown> {
  if (!isRecord(value)) fail('BOOTSTRAP_SCHEMA_INVALID', `${location} must be a mapping.`);
  return value;
}

function expectString(value: unknown, location: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) fail('BOOTSTRAP_SCHEMA_INVALID', `${location} must be a non-empty string.`);
  return value.trim();
}

function expectStringArray(value: unknown, location: string, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) fail('BOOTSTRAP_SCHEMA_INVALID', `${location} must be ${allowEmpty ? 'an array' : 'a non-empty array'}.`);
  const values = value.map((item, index) => expectString(item, `${location}[${index}]`));
  if (new Set(values).size !== values.length) fail('BOOTSTRAP_SCHEMA_INVALID', `${location} must not contain duplicates.`);
  return values;
}

function expectExactKeys(value: Record<string, unknown>, expected: readonly string[], location: string): void {
  const expectedSet = new Set(expected);
  const missing = expected.filter(key => !(key in value));
  const extra = Object.keys(value).filter(key => !expectedSet.has(key));
  if (missing.length > 0 || extra.length > 0) fail('BOOTSTRAP_SCHEMA_INVALID', `${location} keys mismatch; missing=[${missing.join(', ')}], unexpected=[${extra.join(', ')}].`);
}

function normalizeRepoPath(value: string, location: string): string {
  const normalized = value.trim().replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/\/+/gu, '/');
  if (
    !normalized
    || normalized.startsWith('/')
    || /^[A-Za-z]:\//u.test(normalized)
    || normalized.split('/').some(segment => segment === '..' || segment.length === 0)
    || /[\0-\x1F\x7F]/u.test(normalized)
    || normalized.includes('*')
  ) {
    fail('BOOTSTRAP_PATH_INVALID', `${location} must be a repository-relative concrete path.`);
  }
  return normalized;
}

function normalizePathArray(value: unknown, location: string, allowEmpty = false): string[] {
  return expectStringArray(value, location, allowEmpty).map((item, index) => normalizeRepoPath(item, `${location}[${index}]`));
}

function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function computeBootstrapTargetIdentity(root: string): string {
  const resolved = path.resolve(root).replace(/\\/gu, '/').replace(/\/+$/u, '').toLocaleLowerCase();
  return sha256(resolved).slice(0, 32);
}

function isCanonicalSkillPath(value: string): boolean {
  return /^\.agents\/skills\/[a-z][a-z0-9-]*\/SKILL\.md$/u.test(value);
}

function isAllowedAssetPath(value: string): boolean {
  if (value === 'AGENTS.md' || value === 'CLAUDE.md' || isCanonicalSkillPath(value)) return true;
  return value === '.workflow-system/PROJECT_PROFILE.yaml'
    || value === '.workflow-system/WORKFLOW_PROTOCOL.md'
    || value === '.workflow-system/FILE_SCHEMAS.md'
    || value.startsWith('.workflow-system/vnext/')
    || value.startsWith('.workflow-system/runtime/')
    || value.startsWith('docs/workflow/')
    || value.startsWith('docs/designs/')
    || value.startsWith('docs/adoption/');
}

function isForbiddenAssetPath(value: string): boolean {
  // The project-local Runtime distribution is an explicitly admitted
  // bootstrap boundary; its `src/` and package metadata are not product
  // mutations. Keep the broader product/source guard below for every other
  // path.
  if (value.startsWith('.workflow-system/runtime/')) return false;
  const segments = value.split('/');
  if (segments.includes('.git')) return true;
  if (segments.includes('node_modules') && !value.startsWith('.workflow-system/runtime/')) return true;
  if (['src', 'app', 'lib', 'packages'].some(segment => segments.includes(segment))) return true;
  if (['package.json', 'package-lock.json', 'bun.lockb', 'pnpm-lock.yaml', 'yarn.lock'].includes(value)) return true;
  return false;
}

function validateAuthorityEvidence(value: unknown): BootstrapAuthorityEvidence[] {
  if (!Array.isArray(value) || value.length === 0) fail('BOOTSTRAP_AUTHORITY_MISSING', 'authority_evidence must be non-empty.');
  return value.map((item, index) => {
    const record = expectRecord(item, `authority_evidence[${index}]`);
    expectExactKeys(record, ['kind', 'source', 'subject'], `authority_evidence[${index}]`);
    const kind = expectString(record.kind, `authority_evidence[${index}].kind`);
    if (!['project-owner', 'scope-admission', 'evidence-admission', 'dangerous-operation'].includes(kind)) fail('BOOTSTRAP_AUTHORITY_INVALID', `authority_evidence[${index}].kind is unsupported.`);
    return { kind: kind as BootstrapAuthorityEvidence['kind'], source: expectString(record.source, `authority_evidence[${index}].source`), subject: expectString(record.subject, `authority_evidence[${index}].subject`) };
  });
}

function validateSemanticOperations(value: unknown, assets: readonly BootstrapAsset[]): BootstrapSemanticOperation[] {
  if (!Array.isArray(value)) fail('BOOTSTRAP_SCHEMA_INVALID', 'semantic_operations must be an array.');
  const assetPaths = new Set(assets.map(asset => asset.path));
  const operations: BootstrapSemanticOperation[] = [];
  for (const [index, item] of value.entries()) {
    const record = expectRecord(item, `semantic_operations[${index}]`);
    expectExactKeys(record, ['operation_kind', 'target_paths', 'evidence_refs'], `semantic_operations[${index}]`);
    const operationKind = expectString(record.operation_kind, `semantic_operations[${index}].operation_kind`);
    if (!(BOOTSTRAP_OPERATION_KINDS as readonly string[]).includes(operationKind)) fail('BOOTSTRAP_SCHEMA_INVALID', `semantic_operations[${index}].operation_kind is unsupported.`);
    const targetPaths = normalizePathArray(record.target_paths, `semantic_operations[${index}].target_paths`);
    for (const target of targetPaths) {
      if (!assetPaths.has(target)) fail('BOOTSTRAP_TARGET_CONFLICT', `semantic operation ${operationKind} targets an asset that is not in the generated set: ${target}`);
    }
    const evidenceRefs = expectStringArray(record.evidence_refs, `semantic_operations[${index}].evidence_refs`);
    operations.push({ operation_kind: operationKind as BootstrapOperationKind, target_paths: targetPaths, evidence_refs: evidenceRefs });
  }
  if (new Set(operations.map(operation => operation.operation_kind)).size !== operations.length) fail('BOOTSTRAP_SCHEMA_INVALID', 'semantic_operations must contain at most one record for each operation kind.');
  const expected = new Map<BootstrapOperationKind, string[]>([
    ['decision-record-transaction', ['docs/workflow/DECISIONS.md']],
    ['contract-candidate-commit', ['docs/workflow/CONTRACTS.md']],
    ['project-status-transaction', ['docs/workflow/STATUS.md']],
  ]);
  const hasAgents = assetPaths.has('AGENTS.md');
  const hasClaude = assetPaths.has('CLAUDE.md');
  if (hasAgents !== hasClaude) fail('BOOTSTRAP_BOUNDARY_VIOLATION', 'paired host guidance must include both AGENTS.md and CLAUDE.md.');
  if (hasAgents) expected.set('paired-host-guidance-transaction', ['AGENTS.md', 'CLAUDE.md']);
  for (const [operationKind, targetPaths] of expected) {
    if (!targetPaths.every(target => assetPaths.has(target))) continue;
    const operation = operations.find(candidate => candidate.operation_kind === operationKind);
    if (!operation || operation.target_paths.slice().sort().join('|') !== targetPaths.slice().sort().join('|')) {
      fail('BOOTSTRAP_BOUNDARY_VIOLATION', `${operationKind} must declare the exact generated target set: ${targetPaths.join(', ')}.`);
    }
  }
  return operations;
}

function validateAsset(value: unknown, location: string): BootstrapAsset {
  const record = expectRecord(value, location);
  expectExactKeys(record, ['path', 'category', 'content'], location);
  const assetPath = normalizeRepoPath(expectString(record.path, `${location}.path`), `${location}.path`);
  if (!isAllowedAssetPath(assetPath) || isForbiddenAssetPath(assetPath)) fail('BOOTSTRAP_TARGET_FORBIDDEN', `asset target is outside the bootstrap boundary: ${assetPath}`);
  const category = expectString(record.category, `${location}.category`);
  if (!(BOOTSTRAP_ASSET_CATEGORIES as readonly string[]).includes(category)) fail('BOOTSTRAP_SCHEMA_INVALID', `${location}.category is unsupported.`);
  if (typeof record.content !== 'string') fail('BOOTSTRAP_SCHEMA_INVALID', `${location}.content must be text.`);
  return { path: assetPath, category: category as BootstrapAssetCategory, content: record.content };
}

function validateTargetSet(
  proposal: BootstrapProjectProposal,
  assets: readonly BootstrapAsset[],
): void {
  const assetPaths = assets.map(asset => asset.path);
  const requested = new Set(proposal.requested_write_targets);
  const actual = new Set(assetPaths);
  if (requested.size !== actual.size || [...requested].some(value => !actual.has(value))) fail('BOOTSTRAP_TARGET_CONFLICT', 'requested_write_targets must equal the generated asset target set.');
  for (const directory of proposal.requested_directory_targets) {
    if (!directory.endsWith('/node_modules') || !directory.startsWith('.workflow-system/runtime/')) fail('BOOTSTRAP_TARGET_FORBIDDEN', `directory target is outside the Runtime dependency boundary: ${directory}`);
  }
  const expectedChanged = new Set([...assetPaths, ...proposal.requested_directory_targets]);
  if (expectedChanged.size !== proposal.changed_paths.length || proposal.changed_paths.some(value => !expectedChanged.has(value))) fail('BOOTSTRAP_SCOPE_INVALID', 'changed_paths must enumerate every generated file and staged Runtime directory exactly once.');
  if (proposal.delete_targets.length > 0) fail('BOOTSTRAP_SCOPE_INVALID', 'bootstrap does not support untyped deletion; use realign with an explicit implementation change.');
}

function validateModeOperationBoundary(proposal: BootstrapProjectProposal): void {
  const kinds = new Set(proposal.semantic_operations.map(operation => operation.operation_kind));
  if (proposal.mode === 'design' && kinds.has('contract-candidate-commit')) fail('BOOTSTRAP_BOUNDARY_VIOLATION', 'design mode must not commit a locked Contract candidate.');
  if (proposal.mode === 'inventory' && kinds.has('contract-candidate-commit')) fail('BOOTSTRAP_BOUNDARY_VIOLATION', 'inventory mode must not commit a locked Contract candidate.');
  if (proposal.mode === 'design' && kinds.has('paired-host-guidance-transaction')) fail('BOOTSTRAP_BOUNDARY_VIOLATION', 'design mode must not install host guidance.');
  if (proposal.mode === 'inventory' && kinds.has('paired-host-guidance-transaction')) fail('BOOTSTRAP_BOUNDARY_VIOLATION', 'inventory mode must not install host guidance.');
}

export function validateBootstrapProjectProposal(value: unknown): BootstrapRuntimeValidation {
  const record = expectRecord(value, 'bootstrap proposal');
  expectExactKeys(record, [
    'schema_version', 'kind', 'caller', 'mode', 'target_identity', 'source_revision', 'source_tree_hash',
    'scope_document', 'changed_paths', 'conditional_authorizations', 'transformation_kind',
    'authority_evidence', 'semantic_operations', 'preconditions', 'evidence_refs', 'idempotency_key',
    'requested_write_targets', 'requested_directory_targets', 'delete_targets', 'assets',
  ], 'bootstrap proposal');
  if (record.schema_version !== VNEXT_BOOTSTRAP_PROPOSAL_SCHEMA_VERSION || record.kind !== VNEXT_BOOTSTRAP_PROPOSAL_KIND || record.caller !== 'bootstrap-project') fail('BOOTSTRAP_SCHEMA_INVALID', 'bootstrap proposal envelope marker is invalid.');
  const mode = expectString(record.mode, 'bootstrap proposal.mode');
  if (!(BOOTSTRAP_MODES as readonly string[]).includes(mode)) fail('BOOTSTRAP_MODE_INVALID', `bootstrap mode must be one of ${BOOTSTRAP_MODES.join(', ')}.`);
  const targetIdentity = expectString(record.target_identity, 'bootstrap proposal.target_identity');
  if (!TARGET_IDENTITY_PATTERN.test(targetIdentity)) fail('BOOTSTRAP_IDENTITY_INVALID', 'target_identity must be a 32-character lowercase SHA-256 prefix.');
  const sourceRevision = expectString(record.source_revision, 'bootstrap proposal.source_revision');
  const sourceTreeHash = expectString(record.source_tree_hash, 'bootstrap proposal.source_tree_hash');
  if (!SHA256_PATTERN.test(sourceTreeHash)) fail('BOOTSTRAP_SCHEMA_INVALID', 'source_tree_hash must be SHA-256.');
  const scopeDocument = expectString(record.scope_document, 'bootstrap proposal.scope_document');
  const changedPaths = normalizePathArray(record.changed_paths, 'bootstrap proposal.changed_paths');
  const conditionalAuthorizations = record.conditional_authorizations === undefined
    ? []
    : record.conditional_authorizations as ConditionalScopeAuthorization[];
  const transformationKind = expectString(record.transformation_kind, 'bootstrap proposal.transformation_kind');
  if (transformationKind !== 'localized' && transformationKind !== 'inherently-broad') fail('BOOTSTRAP_SCOPE_INVALID', 'transformation_kind is unsupported.');
  const authorityEvidence = validateAuthorityEvidence(record.authority_evidence);
  const preconditions = expectStringArray(record.preconditions, 'bootstrap proposal.preconditions');
  const evidenceRefs = expectStringArray(record.evidence_refs, 'bootstrap proposal.evidence_refs');
  const idempotencyKey = expectString(record.idempotency_key, 'bootstrap proposal.idempotency_key');
  if (!SAFE_KEY_PATTERN.test(idempotencyKey)) fail('BOOTSTRAP_SCHEMA_INVALID', 'idempotency_key is invalid.');
  const requestedWriteTargets = normalizePathArray(record.requested_write_targets, 'bootstrap proposal.requested_write_targets');
  const requestedDirectoryTargets = normalizePathArray(record.requested_directory_targets, 'bootstrap proposal.requested_directory_targets', true);
  const deleteTargets = normalizePathArray(record.delete_targets, 'bootstrap proposal.delete_targets', true);
  if (!Array.isArray(record.assets) || record.assets.length === 0) fail('BOOTSTRAP_SCHEMA_INVALID', 'bootstrap proposal.assets must be non-empty.');
  const assets = record.assets.map((item, index) => validateAsset(item, `bootstrap proposal.assets[${index}]`));
  if (new Set(assets.map(asset => asset.path)).size !== assets.length) fail('BOOTSTRAP_TARGET_CONFLICT', 'bootstrap proposal.assets must not contain duplicate paths.');
  const proposal: BootstrapProjectProposal = {
    schema_version: 1,
    kind: VNEXT_BOOTSTRAP_PROPOSAL_KIND,
    caller: 'bootstrap-project',
    mode: mode as BootstrapMode,
    target_identity: targetIdentity,
    source_revision: sourceRevision,
    source_tree_hash: sourceTreeHash,
    scope_document: scopeDocument,
    changed_paths: changedPaths,
    conditional_authorizations: conditionalAuthorizations,
    transformation_kind: transformationKind as MutationTransformationKind,
    authority_evidence: authorityEvidence,
    semantic_operations: validateSemanticOperations(record.semantic_operations, assets),
    preconditions,
    evidence_refs: evidenceRefs,
    idempotency_key: idempotencyKey,
    requested_write_targets: requestedWriteTargets,
    requested_directory_targets: requestedDirectoryTargets,
    delete_targets: deleteTargets,
    assets,
  };
  validateTargetSet(proposal, assets);
  validateModeOperationBoundary(proposal);
  const scope = parseMutationScope(scopeDocument, sha256(scopeDocument));
  const scopeResult = evaluateMutationScope(scope, {
    changed_paths: changedPaths,
    conditional_authorizations: conditionalAuthorizations,
    transformation_kind: transformationKind as MutationTransformationKind,
  });
  if (scopeResult.status !== 'pass') fail('BOOTSTRAP_SCOPE_BLOCKED', scopeResult.blockers.join(' '));
  return { proposal, scope: scopeResult };
}

function absoluteTarget(root: string, relativePath: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...relativePath.split('/'));
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  if (resolved !== resolvedRoot && !resolved.startsWith(prefix)) fail('BOOTSTRAP_PATH_INVALID', `target escapes project root: ${relativePath}`);
  return resolved;
}

function contentHash(content: string): string {
  return sha256(Buffer.from(content, 'utf8'));
}

function validateDirectorySources(
  proposal: BootstrapProjectProposal,
  sources: readonly BootstrapDirectorySource[],
): BootstrapDirectorySource[] {
  const requested = new Set(proposal.requested_directory_targets);
  const normalized = sources.map((source, index) => {
    const relative = normalizeRepoPath(source.path, `directory_sources[${index}].path`);
    if (typeof source.sourcePath !== 'string' || source.sourcePath.trim().length === 0) {
      fail('BOOTSTRAP_SCHEMA_INVALID', `directory_sources[${index}].sourcePath must be non-empty.`);
    }
    if (!requested.has(relative)) fail('BOOTSTRAP_TARGET_CONFLICT', `directory source is not requested by the proposal: ${relative}`);
    if (!fs.existsSync(source.sourcePath) || !fs.statSync(source.sourcePath).isDirectory()) fail('BOOTSTRAP_TARGET_CONFLICT', `directory source is missing: ${source.sourcePath}`);
    return { path: relative, sourcePath: path.resolve(source.sourcePath) };
  });
  if (new Set(normalized.map(source => source.path)).size !== normalized.length) fail('BOOTSTRAP_TARGET_CONFLICT', 'directory_sources must not contain duplicate paths.');
  if (requested.size !== normalized.length || [...requested].some(relative => !normalized.some(source => source.path === relative))) {
    fail('BOOTSTRAP_TARGET_CONFLICT', 'directory_sources must exactly cover requested_directory_targets.');
  }
  return normalized;
}

function applyAtomicBootstrapTransaction(
  root: string,
  proposal: BootstrapProjectProposal,
  directorySources: readonly BootstrapDirectorySource[],
  verify: (() => void) | undefined,
): void {
  const resolvedRoot = path.resolve(root);
  const stagingRoot = fs.mkdtempSync(path.join(path.dirname(resolvedRoot), '.workflow-vnext-bootstrap-'));
  const backups: Array<{ targetPath: string; backupPath: string }> = [];
  const newlyPromoted: string[] = [];
  try {
    const stagedFiles: Array<{ relative: string; path: string }> = [];
    for (const [index, asset] of proposal.assets.entries()) {
      const stagedPath = path.join(stagingRoot, 'files', `${index}.tmp`);
      fs.mkdirSync(path.dirname(stagedPath), { recursive: true });
      fs.writeFileSync(stagedPath, asset.content, 'utf8');
      stagedFiles.push({ relative: asset.path, path: stagedPath });
    }
    const stagedDirectories: Array<{ relative: string; path: string }> = [];
    for (const [index, source] of directorySources.entries()) {
      const stagedPath = path.join(stagingRoot, 'directories', String(index));
      fs.mkdirSync(path.dirname(stagedPath), { recursive: true });
      fs.cpSync(source.sourcePath, stagedPath, { recursive: true });
      stagedDirectories.push({ relative: source.path, path: stagedPath });
    }
    const touched = [...stagedFiles.map(item => item.relative), ...stagedDirectories.map(item => item.relative)];
    for (const [index, relative] of touched.entries()) {
      const targetPath = absoluteTarget(resolvedRoot, relative);
      if (!fs.existsSync(targetPath)) continue;
      const backupPath = path.join(stagingRoot, 'backups', `${index}.bak`);
      fs.mkdirSync(path.dirname(backupPath), { recursive: true });
      fs.renameSync(targetPath, backupPath);
      backups.push({ targetPath, backupPath });
    }
    for (const staged of stagedFiles) {
      const targetPath = absoluteTarget(resolvedRoot, staged.relative);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.renameSync(staged.path, targetPath);
      newlyPromoted.push(targetPath);
    }
    for (const staged of stagedDirectories) {
      const targetPath = absoluteTarget(resolvedRoot, staged.relative);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.renameSync(staged.path, targetPath);
      newlyPromoted.push(targetPath);
    }
    for (const asset of proposal.assets) {
      const targetPath = absoluteTarget(resolvedRoot, asset.path);
      if (!fs.existsSync(targetPath) || contentHash(fs.readFileSync(targetPath, 'utf8')) !== contentHash(asset.content)) {
        fail('BOOTSTRAP_READ_BACK_FAILED', `promoted asset did not read back identically: ${asset.path}`);
      }
    }
    for (const source of directorySources) {
      const targetPath = absoluteTarget(resolvedRoot, source.path);
      if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isDirectory()) fail('BOOTSTRAP_READ_BACK_FAILED', `promoted Runtime directory did not read back: ${source.path}`);
    }
    verify?.();
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  } catch (error) {
    for (const targetPath of newlyPromoted.reverse()) {
      if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { recursive: true, force: true });
    }
    for (const entry of backups.reverse()) {
      if (fs.existsSync(entry.targetPath)) fs.rmSync(entry.targetPath, { recursive: true, force: true });
      if (fs.existsSync(entry.backupPath)) {
        fs.mkdirSync(path.dirname(entry.targetPath), { recursive: true });
        fs.renameSync(entry.backupPath, entry.targetPath);
      }
    }
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

export function applyBootstrapProjectProposal(
  root: string,
  value: unknown,
  options: { dryRun?: boolean; directory_sources?: readonly BootstrapDirectorySource[]; verify?: () => void } = {},
): BootstrapRuntimeResult {
  const validation = validateBootstrapProjectProposal(value);
  const { proposal, scope } = validation;
  if (computeBootstrapTargetIdentity(root) !== proposal.target_identity) fail('BOOTSTRAP_IDENTITY_CONFLICT', 'proposal target_identity does not match the target root.');
  const suppliedDirectorySources = options.directory_sources ?? [];
  const directorySources = options.dryRun && suppliedDirectorySources.length === 0 && proposal.requested_directory_targets.length > 0
    ? []
    : validateDirectorySources(proposal, suppliedDirectorySources);
  const plannedWrites = proposal.assets.map(asset => asset.path);
  const base = {
    operation_kind: 'bootstrap-project' as const,
    mode: proposal.mode,
    idempotency_key: proposal.idempotency_key,
    target_identity: proposal.target_identity,
    dry_run: options.dryRun === true,
    planned_writes: plannedWrites,
    planned_directories: [...proposal.requested_directory_targets],
    scope,
  };
  if (options.dryRun) return { ...base, status: 'ready', committed: false, read_back_verified: false, message: 'bootstrap proposal validated; no files were written.' };

  applyAtomicBootstrapTransaction(root, proposal, directorySources, options.verify);
  return { ...base, status: 'success', committed: true, read_back_verified: true, message: 'bootstrap proposal committed and read-back verified.' };
}

function parseJsonFile(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
  } catch (error) {
    throw new BootstrapRuntimeError('BOOTSTRAP_SCHEMA_INVALID', `proposal file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readFlag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function readDirectorySources(argv: string[]): BootstrapDirectorySource[] {
  const sources: BootstrapDirectorySource[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--directory-source') continue;
    const value = argv[index + 1] ?? '';
    const separator = value.indexOf('=');
    if (separator <= 0 || separator === value.length - 1) throw new BootstrapRuntimeError('BOOTSTRAP_SCHEMA_INVALID', '--directory-source must use <repo-relative-target>=<staged-absolute-directory>.');
    sources.push({ path: value.slice(0, separator), sourcePath: value.slice(separator + 1) });
    index += 1;
  }
  return sources;
}

export async function runBootstrapCli(argv: string[] = process.argv.slice(1)): Promise<number> {
  try {
    const root = readFlag(argv, '--root') ?? process.cwd();
    const proposalFile = readFlag(argv, '--proposal-file') ?? readFlag(argv, '--proposal');
    if (!proposalFile) throw new BootstrapRuntimeError('BOOTSTRAP_SCHEMA_INVALID', 'bootstrap-project requires --proposal-file <json>.');
    const dryRun = argv.includes('--dry-run');
    const result = applyBootstrapProjectProposal(root, parseJsonFile(proposalFile), { dryRun, directory_sources: readDirectorySources(argv) });
    console.log(JSON.stringify(result, null, 2));
    return result.status === 'ready' || result.status === 'success' || result.status === 'no-op' ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
