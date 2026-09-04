/**
 * One-time, idle-only Migration Pack for upgrading an old workflow project to
 * a pure vNext installation.
 *
 * This module is deliberately independent from workflow-runtime.ts.  The
 * legacy runtime remains the owner of the existing pack/install/sync surface;
 * this file is the only legacy-aware vNext migration boundary.
 */

import { execFileSync } from 'child_process';
import * as os from 'os';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { parseDocument, stringify as stringifyYaml } from 'yaml';
import { checkTargetRoot, normalizeAbsoluteRootPath } from './guard-target-root';
import {
  getWorkflowHome,
  resolveRoot,
  type JsonObject,
} from './workflow-core';
import {
  WORKFLOW_DOC_NAMES,
  validateWorkflowDocContract,
  type WorkflowDocName,
} from './workflow-doc-contracts';
import {
  classifyTaskIdentityFromCurrentTask,
  extractTaskIdentityFromCurrentTask,
  extractCurrentTaskStateFromCurrentTask,
  validateCurrentTaskStatusTuple,
} from './task-identity';
import { validateVNextSource } from './vnext-source-contract';
import {
  validateVNextRuntimeContract,
  validateVNextRuntimeState,
  VNEXT_RUNTIME_ENTRYPOINT_RELATIVE_PATH,
  VNEXT_RUNTIME_LOCKFILE_RELATIVE_PATH,
  VNEXT_RUNTIME_PACKAGE_MANIFEST_RELATIVE_PATH,
  VNEXT_RUNTIME_PACKAGE_NAME,
  VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH,
  VNEXT_RUNTIME_NODE_MIN_VERSION,
  VNEXT_RUNTIME_PACKAGE_VERSION,
  validateRuntimeEnvironment,
} from './vnext-runtime';

export const MIGRATION_PACK_SCHEMA_VERSION = 1 as const;
export const MIGRATION_PACK_KIND = 'workflow-vnext-migration-pack' as const;
export const VNEXT_CANONICAL_DOCUMENT_SCHEMA_VERSION = 1 as const;
export const VNEXT_CANONICAL_DOCUMENT_KIND = 'vnext-canonical-document' as const;
export const VNEXT_CANONICAL_CONVERSION_RULE = 'canonical-envelope-v1' as const;
export const VNEXT_BUNDLE_SCHEMA_VERSION = 1 as const;
export const VNEXT_BUNDLE_KIND = 'workflow-vnext-bundle' as const;
export const MIGRATION_PACK_FILE = 'migration-pack.json';
export const MIGRATION_REPORT_FILE = 'migration-report.json';
export const VNEXT_BUNDLE_FILE = 'vnext-bundle.json';
export const VNEXT_INSTALL_STATE_RELATIVE_PATH = '.workflow-system/vnext/INSTALL_STATE.json';
export const VNEXT_MIGRATION_RECEIPT_RELATIVE_PATH = '.workflow-system/vnext/MIGRATION_RECEIPT.json';
export const VNEXT_MIGRATION_IN_PROGRESS_RELATIVE_PATH = '.workflow-system/vnext/MIGRATION_IN_PROGRESS.json';
export const VNEXT_DISTRIBUTION_IN_PROGRESS_RELATIVE_PATH = '.workflow-system/vnext/DISTRIBUTION_IN_PROGRESS.json';

const LEGACY_PROTOCOL_VERSION_PATTERN = /^0\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/;
const VNEXT_SCHEMA_VERSION_PATTERN = /(?:^|\n)\s*(?:schema_version|vnext_schema_version)\s*:\s*1\b/i;
const SAFE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const STABLE_ID_PATTERN = /^artifact-[a-f0-9]{24}$/;
const DOCUMENT_ID_PATTERN = /^doc-[a-f0-9]{24}$/;
const CURRENT_TASK_FILE = 'CURRENT_TASK.md';
const REQUIRED_LEGACY_DOCUMENTS: readonly WorkflowDocName[] = [
  'CONTRACTS.md',
  'DECISIONS.md',
  'LESSONS.md',
  'STATUS.md',
  'BASELINES.md',
];
const VNEXT_REQUIRED_BUNDLE_CATEGORIES = new Set(['protocol', 'schema', 'skill']);
const VNEXT_REQUIRED_DAILY_ENTRIES = [
  'prepare-task',
  'review-change',
  'execute-step',
  'debug-task',
  'task-lifecycle',
  'capture-work-item',
  'close-task',
] as const;
const VNEXT_REQUIRED_ADMIN_ENTRIES = ['bootstrap-project'] as const;
const VNEXT_REQUIRED_EXPERT_ENTRIES = ['validate-change'] as const;
// The old public surface is deliberately kept as a closed list at the
// migration boundary.  Target projects normally provide the same names in
// `templates/skills`, but bundle validation must still reject legacy routes
// when a separately assembled vNext source tree no longer carries those
// templates.
const LEGACY_SKILL_IDS = [
  'adopt-existing-project',
  'archive-task',
  'capture-lessons',
  'capture-work-item',
  'classify-decisions',
  'close-current-task',
  'continue-current-step',
  'create-current-task',
  'debug-and-fix-current-task',
  'decompose-task',
  'design-baseline-init',
  'execute-current-task',
  'greenfield-init',
  'implement-current-step',
  'interrupt-current-task',
  'investigate-root-cause',
  'legacy-inventory',
  'lock-scope',
  'pause-current-task',
  'plan-implementation',
  'prepare-delivery-summary',
  'realign-workflow-assets',
  'resume-interrupted-task',
  'resume-paused-task',
  'review-current-diff',
  'review-current-task',
  'review-diff',
  'review-implementation',
  'run-regression',
  'supersede-current-task',
  'sync-contracts',
  'sync-current-task',
  'sync-decisions',
  'sync-host-guidance',
  'sync-review-findings',
  'sync-status',
  'verify-contracts',
] as const;
const VNEXT_FORBIDDEN_PATH_PARTS = new Set(['compat', 'compatibility', 'aliases', 'adapters', 'legacy']);
const VNEXT_FORBIDDEN_TARGET_PREFIXES = [
  'templates/skills/',
  'templates/docs/',
  'docs/workflow/generated/workflow-skills/',
  'dist/workflow-system/',
] as const;
const TERMINAL_FINDING_STATUSES = new Set([
  'closed',
  'done',
  'fixed',
  'resolved',
  'rejected',
  'deferred',
  'duplicate',
  'no-op',
  '已关闭',
  '已完成',
  '已修复',
  '已解决',
  '已拒绝',
  '已延期',
  '重复',
]);
const OPEN_FINDING_STATUSES = new Set([
  'open',
  'active',
  'admitted',
  'queued',
  'pending',
  'in-progress',
  'repair',
  'needs-evidence',
  '未解决',
  '待修复',
  '进行中',
]);
const KNOWN_HOST_SKILL_DIRS = [
  path.posix.join('.claude', 'skills'),
  path.posix.join('.codex', 'skills'),
  path.posix.join('.factory', 'skills'),
] as const;
const CANONICAL_VNEXT_SKILL_TARGET = /^\.agents\/skills\/([a-z][a-z0-9-]*)\/SKILL\.md$/u;

function canonicalVNextSkillEntry(targetPath: string): string | null {
  return CANONICAL_VNEXT_SKILL_TARGET.exec(targetPath)?.[1] ?? null;
}

function canonicalVNextSkillTarget(entry: string): string {
  return `.agents/skills/${entry}/SKILL.md`;
}

const KNOWN_LEGACY_SCRIPT_PATHS = [
  'scripts/vnext-runtime.ts',
  'scripts/workflow-core.ts',
  'scripts/workflow-doc-contracts.ts',
  'scripts/workflow-runtime.ts',
  'scripts/task-identity.ts',
  'scripts/gen-workflow-skills.ts',
  'scripts/gen-workflow-docs.ts',
  'scripts/gen-registry.ts',
  'scripts/run-validation.ts',
  'scripts/check-freshness.ts',
  'scripts/bootstrap-project-governance.ts',
  'scripts/validation-model.ts',
  'scripts/repo-path-patterns.ts',
  'scripts/propagation-governance.ts',
] as const;
const SKIP_TREE_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', '.tmp']);
const TRANSIENT_DIRECTORY_PREFIXES = [
  '.workflow-write-staging-',
  '.workflow-vnext-migration-',
] as const;

export type MigrationIssueSeverity = 'error' | 'warning';
export type MigrationIssueCode =
  | 'TARGET_ROOT_DENIED'
  | 'PROFILE_MISSING'
  | 'PROFILE_INVALID'
  | 'LEGACY_PROTOCOL_MISSING'
  | 'LEGACY_PROTOCOL_UNSUPPORTED'
  | 'LEGACY_SCHEMA_MISSING'
  | 'LEGACY_SCHEMA_UNSUPPORTED'
  | 'VNEXT_ALREADY_PRESENT'
  | 'VNEXT_INSTALL_IN_PROGRESS'
  | 'CURRENT_TASK_MISSING'
  | 'CURRENT_TASK_INVALID'
  | 'CURRENT_TASK_NON_IDLE'
  | 'CURRENT_TASK_FINDING_OPEN'
  | 'SUSPENDED_WORK_PRESENT'
  | 'LEGACY_INSTALL_STATE_INVALID'
  | 'LEGACY_SURFACE_AMBIGUOUS'
  | 'REQUIRED_DOCUMENT_MISSING'
  | 'DOCUMENT_INVALID'
  | 'UNSAFE_PATH'
  | 'FROZEN_PATH'
  | 'CONVERSION_ISSUE'
  | 'OUTPUT_DIR_NOT_EMPTY'
  | 'PACK_INVALID'
  | 'PACK_STALE'
  | 'BUNDLE_INVALID'
  | 'BUNDLE_STALE'
  | 'BUNDLE_TARGET_CONFLICT'
  | 'INSTALL_CONFLICT'
  | 'POST_INSTALL_LEGACY_SURFACE';

export type MigrationIssue = {
  severity: MigrationIssueSeverity;
  code: MigrationIssueCode;
  message: string;
  path?: string;
};

export type SourceIdentity = {
  root_path: string;
  root_identity: string;
  revision: string;
  tree_hash: string;
};

export type TargetIdentity = {
  root_path: string;
  root_identity: string;
  project_name: string;
  project_slug: string;
};

export type TargetSnapshot = {
  revision: string;
  tree_hash: string;
};

export type LegacyProtocolSnapshot = {
  protocol_path: string;
  protocol_version: string;
  protocol_sha256: string;
  schema_path: string;
  schema_sha256: string;
  schema_id: string;
};

export type CurrentTaskSnapshot = {
  path: string;
  sha256: string;
  workflow_status: string;
  lifecycle_state: string;
  resume_requires_review: boolean | null;
  resume_review_reasons: string | null;
  identity_status: string;
};

export type LegacySurfaceEntry = {
  path: string;
  sha256: string | null;
  source: 'install-state' | 'known-managed' | 'host-scan' | 'generated-scan';
  action: 'remove' | 'replace';
};

export type MigrationPreflight = {
  kind: 'migration-preflight';
  eligible: boolean;
  state: 'idle' | 'non-idle' | 'ambiguous' | 'unsupported' | 'already-vnext' | 'install-in-progress';
  source: SourceIdentity;
  target: TargetIdentity | null;
  target_snapshot: TargetSnapshot | null;
  profile_path: string;
  workflow_home: string | null;
  legacy_protocol: LegacyProtocolSnapshot | null;
  current_task: CurrentTaskSnapshot | null;
  legacy_surface: {
    entries: LegacySurfaceEntry[];
    legacy_skill_names: string[];
  };
  blockers: MigrationIssue[];
  warnings: MigrationIssue[];
  checked_at: string;
};

export type PathReference = {
  raw: string;
  normalized: string;
  kind: 'repo-relative' | 'external' | 'anchor' | 'unclassified';
  adjusted: boolean;
};

type CanonicalMarkdownHeader = {
  schema_version: typeof VNEXT_CANONICAL_DOCUMENT_SCHEMA_VERSION;
  kind: typeof VNEXT_CANONICAL_DOCUMENT_KIND;
  document_kind: 'governance-document' | 'task-archive' | 'target-owned-preserved';
  document_id: string;
  source_path: string;
  source_sha256: string;
  legacy_source_revision: string;
  legacy_source_tree_hash: string;
  legacy_protocol_version: string;
  conversion_rule: typeof VNEXT_CANONICAL_CONVERSION_RULE;
  original_text_preserved: true;
  heading_index: Array<{ id: string; level: number; text: string }>;
  path_references: PathReference[];
};

export type MigrationArtifactKind =
  | 'governance-document'
  | 'project-profile'
  | 'task-archive'
  | 'target-owned-preserved';

export type MigrationArtifact = {
  stable_id: string;
  kind: MigrationArtifactKind;
  source_path: string;
  target_path: string;
  content_path: string;
  original_content_path: string;
  canonical_schema_version: typeof VNEXT_CANONICAL_DOCUMENT_SCHEMA_VERSION;
  conversion_rule: typeof VNEXT_CANONICAL_CONVERSION_RULE;
  source_sha256: string;
  content_sha256: string;
  byte_length: number;
  path_references: PathReference[];
  provenance: {
    source_revision: string;
    source_tree_hash: string;
    legacy_source_revision: string;
    legacy_source_tree_hash: string;
    source_path: string;
    source_sha256: string;
    conversion_rule: typeof VNEXT_CANONICAL_CONVERSION_RULE;
  };
};

export type MigrationPackManifest = {
  schema_version: typeof MIGRATION_PACK_SCHEMA_VERSION;
  kind: typeof MIGRATION_PACK_KIND;
  pack_id: string;
  status: 'validated';
  created_at: string;
  source: SourceIdentity;
  target: TargetIdentity;
  legacy_source: TargetSnapshot;
  legacy_protocol: LegacyProtocolSnapshot;
  preflight: {
    state: 'idle';
    current_task: CurrentTaskSnapshot;
    current_task_excluded: true;
    checked_at: string;
  };
  conversion: {
    mode: 'offline-structural';
    preserves_original_text: true;
    semantic_reinterpretation: false;
    allowed_surfaces: string[];
    issues: MigrationIssue[];
  };
  artifacts: MigrationArtifact[];
  legacy_surface: {
    entries: LegacySurfaceEntry[];
    legacy_skill_names: string[];
  };
  installation: {
    requires_vnext_bundle: true;
    install_state_path: string;
    migration_receipt_path: string;
    in_progress_path: string;
    old_current_task_replaced_by_bundle: true;
    old_protocol_and_schema_replaced_by_bundle: true;
    old_compatibility_surface_removed: true;
  };
};

export type VNextBundleArtifact = {
  source_path: string;
  target_path: string;
  category: 'protocol' | 'schema' | 'skill' | 'registry' | 'runtime' | 'generated' | 'config';
  required: boolean;
  checksum: string;
};

export type VNextBundleManifest = {
  schema_version: typeof VNEXT_BUNDLE_SCHEMA_VERSION;
  kind: typeof VNEXT_BUNDLE_KIND;
  bundle_id: string;
  status: 'validated';
  legacy_compatibility: 'absent';
  source: SourceIdentity;
  artifacts: VNextBundleArtifact[];
};

export type RuntimeDistributionIdentity = {
  kind: 'project-local-node';
  package_path: string;
  entrypoint: string;
  package_version: string;
  node_min_version: string;
  package_lock_sha256: string;
  entrypoint_sha256: string;
};

export type VNextInstallState = {
  schema_version: 1;
  kind: 'vnext-install-state';
  distribution_state: 'vnext';
  distribution_version: string;
  migration_pack_id: string;
  bundle_id: string;
  source_revision: string;
  source_tree_hash: string;
  target_identity: string;
  runtime_distribution: RuntimeDistributionIdentity | null;
  installed_at: string;
  managed_files: Array<{ path: string; checksum: string; category: string }>;
  removed_legacy_files: string[];
  legacy_compatibility: 'absent';
  recovery_boundary: 'in-progress-marker';
};

type VNextMigrationInProgress = {
  schema_version: 1;
  kind: 'vnext-migration-in-progress';
  migration_pack_id: string;
  bundle_id: string;
  target_identity: string;
  started_at: string;
  planned_writes: string[];
  planned_deletes: string[];
  recovery: 'fail-closed-explicit-recovery';
};

export type MigrationOperationResult = {
  status: 'ready' | 'rejected' | 'installed' | 'replayed';
  pack_id?: string;
  bundle_id?: string;
  output_directory?: string;
  target_root: string;
  blockers: MigrationIssue[];
  warnings: MigrationIssue[];
  planned_writes: string[];
  planned_deletes: string[];
};

export type PreflightOptions = {
  sourceRoot?: string;
  targetRoot: string;
};

export type CreatePackOptions = PreflightOptions & {
  outDir: string;
  overwrite?: boolean;
};

export type ValidatePackOptions = {
  packDir: string;
  sourceRoot?: string;
  targetRoot?: string;
};

export type InstallPackOptions = {
  packDir: string;
  bundleDir: string;
  targetRoot: string;
  sourceRoot?: string;
  dryRun?: boolean;
  /** Extra, already-validated writes owned by the outer Distribution boundary. */
  additionalWrites?: Array<{ path: string; content: string }>;
  /** Release bundles are portable across package installation paths. */
  portableBundle?: boolean;
  /** Read-back hook for an outer Distribution transaction. */
  postPromotionVerify?: () => void;
};

export class MigrationPackError extends Error {
  readonly code: MigrationIssueCode;
  readonly issues: MigrationIssue[];

  constructor(code: MigrationIssueCode, message: string, issues: MigrationIssue[] = []) {
    super(`${code}: ${message}`);
    this.name = 'MigrationPackError';
    this.code = code;
    this.issues = issues;
  }
}

function now(): string {
  return new Date().toISOString();
}

function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readSha256(filePath: string): string {
  return sha256(fs.readFileSync(filePath));
}

function normalizeRepoPath(value: string, location: string): string {
  const normalized = value.replace(/\\/g, '/').trim().replace(/^\.\//, '');
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split('/').some(part => part === '..' || part.length === 0) ||
    /[\0-\x1F\x7F]/.test(normalized)
  ) {
    throw new MigrationPackError('UNSAFE_PATH', `${location} is not a safe repo-relative path: ${value}`);
  }
  return normalized;
}

function resolveRepoPath(root: string, relativePath: string, location: string): string {
  const normalized = normalizeRepoPath(relativePath, location);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...normalized.split('/'));
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  if (resolved !== resolvedRoot && !resolved.startsWith(prefix)) {
    throw new MigrationPackError('UNSAFE_PATH', `${location} escapes its root: ${relativePath}`);
  }
  return resolved;
}

function isWithinRoot(root: string, candidate: string): boolean {
  const normalizedRoot = normalizeAbsoluteRootPath(root);
  const normalizedCandidate = normalizeAbsoluteRootPath(candidate);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`);
}

function assertExternalOutputDirectory(outputDir: string, sourceRoot: string, targetRoot: string, label: string): void {
  if (isWithinRoot(sourceRoot, outputDir) || isWithinRoot(targetRoot, outputDir)) {
    throw new MigrationPackError('UNSAFE_PATH', `${label} must be outside both source and target roots so identity snapshots cannot include generated output.`);
  }
}

function expectRecord(value: unknown, location: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MigrationPackError('PACK_INVALID', `${location} must be a mapping`);
  }
  return value as Record<string, unknown>;
}

function expectString(value: unknown, location: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new MigrationPackError('PACK_INVALID', `${location} must be a non-empty string`);
  }
  return value.trim();
}

function expectBoolean(value: unknown, location: string): boolean {
  if (typeof value !== 'boolean') {
    throw new MigrationPackError('PACK_INVALID', `${location} must be a boolean`);
  }
  return value;
}

function expectStringArray(value: unknown, location: string, allowEmpty = false): string[] {
  if (!Array.isArray(value)) {
    throw new MigrationPackError('PACK_INVALID', `${location} must be a list`);
  }
  const result = value.map((item, index) => expectString(item, `${location}[${index}]`));
  if (!allowEmpty && result.length === 0) {
    throw new MigrationPackError('PACK_INVALID', `${location} must not be empty`);
  }
  if (new Set(result).size !== result.length) {
    throw new MigrationPackError('PACK_INVALID', `${location} must not contain duplicates`);
  }
  return result;
}

function expectExactKeys(value: Record<string, unknown>, keys: readonly string[], location: string): void {
  const expected = new Set(keys);
  const actual = Object.keys(value);
  const missing = keys.filter(key => !(key in value));
  const extra = actual.filter(key => !expected.has(key));
  if (missing.length > 0 || extra.length > 0) {
    throw new MigrationPackError(
      'PACK_INVALID',
      `${location} keys mismatch; missing=[${missing.join(', ')}], unexpected=[${extra.join(', ')}]`,
    );
  }
}

function parseStrictYaml(filePath: string): Record<string, unknown> {
  const document = parseDocument(fs.readFileSync(filePath, 'utf8'), { uniqueKeys: true });
  const diagnostics = [...document.errors, ...document.warnings];
  if (diagnostics.length > 0) {
    throw new MigrationPackError(
      'PROFILE_INVALID',
      `${filePath} has invalid YAML: ${diagnostics.map(item => item.message).join('; ')}`,
    );
  }
  return expectRecord(document.toJS(), filePath);
}

function parseStrictJson(filePath: string): Record<string, unknown> {
  try {
    return expectRecord(JSON.parse(fs.readFileSync(filePath, 'utf8')), filePath);
  } catch (error) {
    if (error instanceof MigrationPackError) throw error;
    throw new MigrationPackError('PACK_INVALID', `${filePath} has invalid JSON: ${String(error)}`);
  }
}

function listFiles(root: string, options: { skipDirectories?: Set<string> } = {}): string[] {
  if (!fs.existsSync(root)) return [];
  const skipDirectories = options.skipDirectories ?? new Set<string>();
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) {
        throw new MigrationPackError('UNSAFE_PATH', `symbolic links are not migration-safe: ${path.join(directory, entry.name)}`);
      }
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        // Generator/transaction workspaces are deliberately ephemeral. They
        // may contain half-written files while a source or target snapshot is
        // being taken, so they must not become part of migration identity or
        // make a directory scan observe an impossible intermediate state.
        const transient = TRANSIENT_DIRECTORY_PREFIXES.some(prefix => entry.name.startsWith(prefix));
        if (!skipDirectories.has(entry.name) && !transient) walk(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  };
  walk(root);
  return files.sort((left, right) => left.localeCompare(right));
}

function getGitRevision(root: string): string | null {
  try {
    return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

export function computeTreeHash(root: string, ignoredRelativePaths: readonly string[] = []): string {
  const resolvedRoot = path.resolve(root);
  const files = listFiles(resolvedRoot, { skipDirectories: SKIP_TREE_DIRECTORIES });
  const ignored = new Set([
    ...ignoredRelativePaths,
    VNEXT_DISTRIBUTION_IN_PROGRESS_RELATIVE_PATH,
  ].map(relativePath => normalizeRepoPath(relativePath, 'tree hash ignored path')));
  const hash = crypto.createHash('sha256');
  for (const filePath of files) {
    const relative = path.relative(resolvedRoot, filePath).replace(/\\/g, '/');
    if (ignored.has(relative)) continue;
    const content = fs.readFileSync(filePath);
    hash.update(relative);
    hash.update('\0');
    hash.update(String(content.byteLength));
    hash.update('\0');
    hash.update(sha256(content));
    hash.update('\n');
  }
  return hash.digest('hex');
}

/**
 * Bootstrap rollback snapshots must include the promoted Runtime `dist/` and
 * locked dependency tree. The source/migration identity hash intentionally
 * excludes those generated directories, so keep this stricter snapshot
 * separate from computeTreeHash rather than changing existing migration
 * identity semantics.
 */
export function computeCompleteTreeHash(root: string, ignoredRelativePaths: readonly string[] = []): string {
  const resolvedRoot = path.resolve(root);
  const files = listFiles(resolvedRoot, { skipDirectories: new Set(['.git', '.tmp']) });
  const ignored = new Set(ignoredRelativePaths.map(relativePath => normalizeRepoPath(relativePath, 'complete tree hash ignored path')));
  const hash = crypto.createHash('sha256');
  for (const filePath of files) {
    const relative = path.relative(resolvedRoot, filePath).replace(/\\/g, '/');
    if (ignored.has(relative)) continue;
    const content = fs.readFileSync(filePath);
    hash.update(relative);
    hash.update('\0');
    hash.update(String(content.byteLength));
    hash.update('\0');
    hash.update(sha256(content));
    hash.update('\n');
  }
  return hash.digest('hex');
}

export function getSourceIdentity(sourceRoot = resolveRoot()): SourceIdentity {
  const rootPath = normalizeAbsoluteRootPath(sourceRoot);
  const treeHash = computeTreeHash(rootPath);
  const revision = getGitRevision(rootPath) ?? `tree-${treeHash}`;
  return {
    root_path: rootPath,
    root_identity: sha256(rootPath).slice(0, 32),
    revision,
    tree_hash: treeHash,
  };
}

export function getTargetSnapshot(targetRoot: string): TargetSnapshot {
  const resolvedRoot = path.resolve(targetRoot);
  const treeHash = computeTreeHash(resolvedRoot);
  const revision = getGitRevision(resolvedRoot) ?? `tree-${treeHash}`;
  return { revision, tree_hash: treeHash };
}

function getProjectIdentity(profile: JsonObject, targetRoot: string): TargetIdentity {
  const project = expectRecord(profile.project, 'PROJECT_PROFILE.yaml.project');
  const projectName = expectString(project.name, 'PROJECT_PROFILE.yaml.project.name');
  const projectSlug = expectString(project.slug, 'PROJECT_PROFILE.yaml.project.slug');
  if (!SAFE_ID_PATTERN.test(projectSlug)) {
    throw new MigrationPackError('PROFILE_INVALID', `PROJECT_PROFILE.yaml.project.slug is not a safe slug: ${projectSlug}`);
  }
  const rootPath = normalizeAbsoluteRootPath(targetRoot);
  return {
    root_path: rootPath,
    root_identity: sha256(`${rootPath}\0${projectSlug}`).slice(0, 32),
    project_name: projectName,
    project_slug: projectSlug,
  };
}

function getLegacyProtocol(targetRoot: string): { snapshot: LegacyProtocolSnapshot; issues: MigrationIssue[] } {
  const protocolPath = path.join(targetRoot, '.workflow-system', 'WORKFLOW_PROTOCOL.md');
  const schemaPath = path.join(targetRoot, '.workflow-system', 'FILE_SCHEMAS.md');
  const issues: MigrationIssue[] = [];
  if (!fs.existsSync(protocolPath)) {
    issues.push({ severity: 'error', code: 'LEGACY_PROTOCOL_MISSING', message: 'Legacy WORKFLOW_PROTOCOL.md is required.', path: '.workflow-system/WORKFLOW_PROTOCOL.md' });
  }
  if (!fs.existsSync(schemaPath)) {
    issues.push({ severity: 'error', code: 'LEGACY_SCHEMA_MISSING', message: 'Legacy FILE_SCHEMAS.md is required.', path: '.workflow-system/FILE_SCHEMAS.md' });
  }
  if (issues.length > 0) {
    return {
      snapshot: {
        protocol_path: '.workflow-system/WORKFLOW_PROTOCOL.md',
        protocol_version: '',
        protocol_sha256: '',
        schema_path: '.workflow-system/FILE_SCHEMAS.md',
        schema_sha256: '',
        schema_id: '',
      },
      issues,
    };
  }

  const protocolText = fs.readFileSync(protocolPath, 'utf8');
  const protocolMatch = /^\s*Protocol-Version:\s*([^\s]+)\s*$/mi.exec(protocolText);
  const protocolVersion = protocolMatch?.[1]?.trim() ?? '';
  if (!protocolVersion) {
    issues.push({ severity: 'error', code: 'LEGACY_PROTOCOL_UNSUPPORTED', message: 'Legacy protocol version marker is missing.', path: '.workflow-system/WORKFLOW_PROTOCOL.md' });
  } else if (!LEGACY_PROTOCOL_VERSION_PATTERN.test(protocolVersion)) {
    issues.push({ severity: 'error', code: 'LEGACY_PROTOCOL_UNSUPPORTED', message: `Unsupported legacy protocol version: ${protocolVersion}.`, path: '.workflow-system/WORKFLOW_PROTOCOL.md' });
  }

  const schemaText = fs.readFileSync(schemaPath, 'utf8');
  const requiredSchemaMarkers = ['CURRENT_TASK.md', 'CONTRACTS.md', 'DECISIONS.md', 'LESSONS.md'];
  const missingMarkers = requiredSchemaMarkers.filter(marker => !schemaText.includes(marker));
  if (missingMarkers.length > 0) {
    issues.push({ severity: 'error', code: 'LEGACY_SCHEMA_UNSUPPORTED', message: `Legacy schema is missing required markers: ${missingMarkers.join(', ')}.`, path: '.workflow-system/FILE_SCHEMAS.md' });
  }

  return {
    snapshot: {
      protocol_path: '.workflow-system/WORKFLOW_PROTOCOL.md',
      protocol_version: protocolVersion,
      protocol_sha256: readSha256(protocolPath),
      schema_path: '.workflow-system/FILE_SCHEMAS.md',
      schema_sha256: readSha256(schemaPath),
      schema_id: `legacy-schema-${readSha256(schemaPath).slice(0, 24)}`,
    },
    issues,
  };
}

function extractSection(content: string, heading: string): string {
  const start = content.indexOf(heading);
  if (start < 0) return '';
  const rest = content.slice(start + heading.length);
  const next = /\r?\n##\s/.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

function findingAdmissionBlockers(content: string): string[] {
  const section = extractSection(content, '## 审查问题队列');
  if (!section) return [];
  const lines = section.split(/\r?\n/);
  const findings: Array<{ id: string; status: string | null }> = [];
  let current: { id: string; status: string | null } | null = null;
  for (const line of lines) {
    const idMatch = /^\s*-\s*Finding ID\s*[：:]\s*(.*?)\s*$/.exec(line);
    if (idMatch) {
      if (current) findings.push(current);
      current = { id: idMatch[1].trim(), status: null };
      continue;
    }
    if (current) {
      const statusMatch = /^\s*-?\s*Status\s*[：:]\s*(.*?)\s*$/.exec(line);
      if (statusMatch) current.status = statusMatch[1].trim();
    }
  }
  if (current) findings.push(current);
  return findings.flatMap(finding => {
    const hasConcreteId = finding.id.length > 0 && !/^\{\{.*\}\}$/.test(finding.id);
    // The untouched template contains an empty Finding ID/status skeleton;
    // ignore that one placeholder, but fail closed if someone filled a
    // status without supplying a stable finding identity.
    if (!hasConcreteId && !finding.status) return [];
    if (!hasConcreteId) return ['a finding has a status but no stable Finding ID'];
    if (!finding.status) return [`finding ${finding.id} has no terminal admission status`];
    const status = finding.status.toLowerCase();
    if (OPEN_FINDING_STATUSES.has(status) || !TERMINAL_FINDING_STATUSES.has(status)) {
      return [`finding ${finding.id} is not terminal (${finding.status})`];
    }
    return [];
  });
}

function getCurrentTaskSnapshot(
  targetRoot: string,
  profile: JsonObject,
): { snapshot: CurrentTaskSnapshot | null; blockers: MigrationIssue[]; warnings: MigrationIssue[] } {
  const blockers: MigrationIssue[] = [];
  const warnings: MigrationIssue[] = [];
  let workflowHome: string;
  try {
    workflowHome = getWorkflowHome(profile);
  } catch (error) {
    blockers.push({ severity: 'error', code: 'PROFILE_INVALID', message: error instanceof Error ? error.message : String(error), path: '.workflow-system/PROJECT_PROFILE.yaml' });
    return { snapshot: null, blockers, warnings };
  }
  const relativePath = [workflowHome, CURRENT_TASK_FILE].filter(Boolean).join('/');
  const currentTaskPath = path.join(targetRoot, ...relativePath.split('/'));
  if (!fs.existsSync(currentTaskPath)) {
    blockers.push({ severity: 'error', code: 'CURRENT_TASK_MISSING', message: 'CURRENT_TASK.md is required and must already be closed/archived.', path: relativePath });
    return { snapshot: null, blockers, warnings };
  }

  const content = fs.readFileSync(currentTaskPath, 'utf8');
  const state = extractCurrentTaskStateFromCurrentTask(content);
  // The legacy task-identity helper intentionally accepts a broad Markdown
  // field shape.  For migration preflight an empty optional field must not
  // accidentally consume the following list item through `\\s*`.
  const normalizedResumeReasons = state.resumeReviewReasons && /^-\s/.test(state.resumeReviewReasons)
    ? null
    : state.resumeReviewReasons;
  const identity = classifyTaskIdentityFromCurrentTask(content);
  let identityStatus = identity.status;
  try {
    validateCurrentTaskStatusTuple(state.workflowStatus, state.lifecycleState);
  } catch (error) {
    blockers.push({ severity: 'error', code: 'CURRENT_TASK_INVALID', message: error instanceof Error ? error.message : String(error), path: relativePath });
  }
  if (state.workflowStatus !== 'archived' || state.lifecycleState !== 'archived') {
    blockers.push({ severity: 'error', code: 'CURRENT_TASK_NON_IDLE', message: 'CURRENT_TASK.md is not in the canonical archived/archived idle tuple.', path: relativePath });
  }
  if (state.resumeRequiresReview !== false || (normalizedResumeReasons ?? '').trim().length > 0) {
    blockers.push({ severity: 'error', code: 'CURRENT_TASK_NON_IDLE', message: 'CURRENT_TASK.md still carries a resume/recovery gate.', path: relativePath });
  }
  if (identity.status !== 'materialized') {
    blockers.push({ severity: 'error', code: 'CURRENT_TASK_INVALID', message: `CURRENT_TASK.md task identity is ${identity.status}; migration requires a concrete archived task identity.`, path: relativePath });
  }
  for (const reason of findingAdmissionBlockers(content)) {
    blockers.push({ severity: 'error', code: 'CURRENT_TASK_FINDING_OPEN', message: reason, path: relativePath });
  }
  if (!content.includes('归档') && !content.toLowerCase().includes('archive')) {
    warnings.push({ severity: 'warning', code: 'CONVERSION_ISSUE', message: 'CURRENT_TASK.md has an archived lifecycle tuple but no explicit archive wording; the tuple remains the authoritative preflight fact.', path: relativePath });
  }

  return {
    snapshot: {
      path: relativePath,
      sha256: sha256(content),
      workflow_status: state.workflowStatus ?? '',
      lifecycle_state: state.lifecycleState ?? '',
      resume_requires_review: state.resumeRequiresReview,
      resume_review_reasons: normalizedResumeReasons,
      identity_status: identityStatus,
    },
    blockers,
    warnings,
  };
}

function scanSuspendedWork(targetRoot: string): MigrationIssue[] {
  const issues: MigrationIssue[] = [];
  for (const kind of ['paused', 'interrupted'] as const) {
    const relative = `TASKS/${kind}`;
    const directory = path.join(targetRoot, 'TASKS', kind);
    for (const filePath of listFiles(directory)) {
      const relativePath = path.relative(targetRoot, filePath).replace(/\\/g, '/');
      if (path.basename(filePath) === '.gitkeep') continue;
      issues.push({ severity: 'error', code: 'SUSPENDED_WORK_PRESENT', message: `Recoverable ${kind} work is present; settle it through the old workflow before migration.`, path: relativePath || relative });
    }
  }
  return issues;
}

function readLegacySkillNames(targetRoot: string): string[] {
  const names = new Set<string>();
  const templateDir = path.join(targetRoot, 'templates', 'skills');
  if (fs.existsSync(templateDir)) {
    for (const file of fs.readdirSync(templateDir)) {
      const match = /^(.+)\.SKILL\.md\.tmpl$/.exec(file);
      if (match) names.add(match[1]);
    }
  }
  for (const relativeDir of KNOWN_HOST_SKILL_DIRS) {
    const directory = path.join(targetRoot, ...relativeDir.split('/'));
    if (!fs.existsSync(directory)) continue;
    for (const filePath of listFiles(directory)) {
      const basename = path.basename(filePath);
      const parentName = path.basename(path.dirname(filePath));
      const directMatch = /^workflow-system-(.+)\.SKILL\.md$/.exec(basename);
      const nestedMatch = basename === 'SKILL.md' ? /^workflow-system-(.+)$/.exec(parentName) : null;
      if (directMatch) names.add(directMatch[1]);
      if (nestedMatch) names.add(nestedMatch[1]);
    }
  }
  return [...names].sort();
}

function mergeLegacySkillNames(sourceRoot: string, packNames: readonly string[]): string[] {
  const names = new Set<string>([...LEGACY_SKILL_IDS, ...packNames]);
  const templateDir = path.join(sourceRoot, 'templates', 'skills');
  if (fs.existsSync(templateDir)) {
    for (const file of fs.readdirSync(templateDir)) {
      const match = /^(.+)\.SKILL\.md\.tmpl$/.exec(file);
      if (match) names.add(match[1]);
    }
  }
  return [...names].sort();
}

function addSurfaceEntry(
  entries: Map<string, LegacySurfaceEntry>,
  targetRoot: string,
  relativePath: string,
  source: LegacySurfaceEntry['source'],
  action: LegacySurfaceEntry['action'],
): void {
  const normalized = normalizeRepoPath(relativePath, 'legacy surface path');
  const fullPath = resolveRepoPath(targetRoot, normalized, 'legacy surface path');
  if (fs.existsSync(fullPath) && !fs.statSync(fullPath).isFile()) {
    throw new MigrationPackError('LEGACY_SURFACE_AMBIGUOUS', `Legacy surface entry is not a regular file: ${normalized}`);
  }
  const existing = entries.get(normalized);
  const checksum = fs.existsSync(fullPath) && fs.statSync(fullPath).isFile() ? readSha256(fullPath) : null;
  if (existing) {
    // A generated scan can discover CURRENT_TASK before the explicit
    // current-task pass.  Preserve the stronger replace intent in that case.
    if (action === 'replace' && existing.action !== 'replace') entries.set(normalized, { ...existing, action: 'replace' });
    return;
  }
  entries.set(normalized, { path: normalized, sha256: checksum, source, action });
}

function collectLegacySurface(
  targetRoot: string,
  profile: JsonObject,
  currentTaskPath: string | null,
): { entries: LegacySurfaceEntry[]; legacySkillNames: string[]; issues: MigrationIssue[] } {
  const entries = new Map<string, LegacySurfaceEntry>();
  const issues: MigrationIssue[] = [];
  const legacySkillNames = readLegacySkillNames(targetRoot);
  const installStatePath = path.join(targetRoot, '.workflow-system', 'install-state.json');
  if (fs.existsSync(installStatePath)) {
    try {
      const state = parseStrictJson(installStatePath);
      if (state.state_version !== 1 || !Array.isArray(state.managed_files)) {
        throw new Error('install-state.json must declare state_version 1 and managed_files.');
      }
      for (const [index, raw] of state.managed_files.entries()) {
        const entry = expectRecord(raw, `install-state.managed_files[${index}]`);
        const relativePath = normalizeRepoPath(expectString(entry.path, `install-state.managed_files[${index}].path`), 'install-state managed path');
        addSurfaceEntry(entries, targetRoot, relativePath, 'install-state', 'remove');
      }
      addSurfaceEntry(entries, targetRoot, '.workflow-system/install-state.json', 'install-state', 'remove');
    } catch (error) {
      issues.push({ severity: 'error', code: 'LEGACY_INSTALL_STATE_INVALID', message: error instanceof Error ? error.message : String(error), path: '.workflow-system/install-state.json' });
    }
  }

  const workflowHome = getWorkflowHome(profile);
  const generatedSkills = [workflowHome, 'generated', 'workflow-skills'].filter(Boolean).join('/');
  const generatedDocs = [workflowHome, 'generated', 'workflow-docs'].filter(Boolean).join('/');
  const registry = [workflowHome, 'SKILL_REGISTRY.md'].filter(Boolean).join('/');
  for (const candidate of [
    '.workflow-system/WORKFLOW_PROTOCOL.md',
    '.workflow-system/FILE_SCHEMAS.md',
    '.workflow-system/WORKFLOW_CAPABILITIES.yaml',
    '.workflow-system/install-state.json',
    '.workflow-system/vnext/MIGRATION_PACK_SCHEMA.yaml',
    registry,
  ]) {
    addSurfaceEntry(entries, targetRoot, candidate, 'known-managed', candidate === currentTaskPath ? 'replace' : 'remove');
  }
  for (const candidate of KNOWN_LEGACY_SCRIPT_PATHS) {
    if (fs.existsSync(path.join(targetRoot, ...candidate.split('/')))) {
      addSurfaceEntry(entries, targetRoot, candidate, 'known-managed', 'remove');
    }
  }
  if (currentTaskPath) addSurfaceEntry(entries, targetRoot, currentTaskPath, 'known-managed', 'replace');

  for (const relativeDir of [generatedSkills, generatedDocs]) {
    const directory = path.join(targetRoot, ...relativeDir.split('/'));
    for (const filePath of listFiles(directory)) {
      addSurfaceEntry(entries, targetRoot, path.relative(targetRoot, filePath), 'generated-scan', 'remove');
    }
  }
  for (const relativeDir of KNOWN_HOST_SKILL_DIRS) {
    const directory = path.join(targetRoot, ...relativeDir.split('/'));
    if (!fs.existsSync(directory)) continue;
    for (const filePath of listFiles(directory)) {
      const basename = path.basename(filePath);
      const parentName = path.basename(path.dirname(filePath));
      const isPrefixedLegacy = /^workflow-system-.+\.SKILL\.md$/.test(basename) || (basename === 'SKILL.md' && /^workflow-system-.+$/.test(parentName));
      const isFlatAlias = legacySkillNames.some(name => basename === `${name}.SKILL.md` || (basename === 'SKILL.md' && parentName === name));
      if (isPrefixedLegacy || isFlatAlias) {
        addSurfaceEntry(entries, targetRoot, path.relative(targetRoot, filePath), 'host-scan', 'remove');
      }
    }
  }

  const templatesSkills = path.join(targetRoot, 'templates', 'skills');
  if (fs.existsSync(templatesSkills)) {
    for (const filePath of listFiles(templatesSkills)) {
      if (/\.SKILL\.md\.tmpl$/.test(filePath)) {
        addSurfaceEntry(entries, targetRoot, path.relative(targetRoot, filePath), 'known-managed', 'remove');
      }
    }
  }
  const templatesDocs = path.join(targetRoot, 'templates', 'docs');
  if (fs.existsSync(templatesDocs)) {
    for (const filePath of listFiles(templatesDocs)) {
      if (/\.md\.tmpl$/.test(filePath)) {
        addSurfaceEntry(entries, targetRoot, path.relative(targetRoot, filePath), 'known-managed', 'remove');
      }
    }
  }
  const legacyBundleOutput = path.join(targetRoot, 'dist', 'workflow-system');
  for (const filePath of listFiles(legacyBundleOutput)) {
    addSurfaceEntry(entries, targetRoot, path.relative(targetRoot, filePath), 'generated-scan', 'remove');
  }

  if (legacySkillNames.length === 0) {
    issues.push({ severity: 'error', code: 'LEGACY_SURFACE_AMBIGUOUS', message: 'No legacy Skill names were discoverable; the old installation surface cannot be proven safe to replace.' });
  }
  return { entries: [...entries.values()].sort((a, b) => a.path.localeCompare(b.path)), legacySkillNames, issues };
}

function readFreezeFiles(targetRoot: string): string[] {
  return [
    path.join(targetRoot, 'FREEZE_REGISTRY.md'),
    path.join(targetRoot, '.workflow-system', 'FREEZE_REGISTRY.md'),
  ].filter(filePath => fs.existsSync(filePath)).flatMap(filePath => fs.readFileSync(filePath, 'utf8').split(/\r?\n/));
}

export function isFrozenPath(targetRoot: string, relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  const registryLines = readFreezeFiles(targetRoot);
  if (registryLines.some(line => line.includes(normalized) && !/^\s*[-#]*\s*(unfreeze|not frozen)/i.test(line))) return true;
  const fullPath = resolveRepoPath(targetRoot, normalized, 'freeze check');
  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
    const head = fs.readFileSync(fullPath, 'utf8').split(/\r?\n/).slice(0, 20).join('\n');
    if (/@frozen|DO NOT MODIFY/i.test(head)) return true;
  }
  return false;
}

function extractPathReferences(content: string): PathReference[] {
  const candidates = new Set<string>();
  const markdownLink = /\]\(([^)]+)\)/g;
  for (const match of content.matchAll(markdownLink)) candidates.add(match[1].trim().replace(/^<|>$/g, ''));
  const inlineCode = /`([^`\n]+)`/g;
  for (const match of content.matchAll(inlineCode)) {
    const value = match[1].trim();
    if (/[\\/]/.test(value) && !/\s/.test(value)) candidates.add(value);
  }
  return [...candidates].map(raw => normalizePathReference(raw)).sort((left, right) => left.raw.localeCompare(right.raw));
}

function normalizePathReference(raw: string): PathReference {
  if (/^(?:https?:|mailto:|ftp:)/i.test(raw)) return { raw, normalized: raw, kind: 'external', adjusted: false };
  if (raw.startsWith('#')) return { raw, normalized: raw, kind: 'anchor', adjusted: false };
  // Legacy workflow documents commonly link to slash-prefixed Skill
  // commands (for example `/review-current-diff`).  Those are executable
  // names, not filesystem paths, and must be preserved as opaque references.
  // Workflow documents also annotate command references inline (for
  // example `/run-regression(report-only terminal report)`).  These are
  // executable route names, not filesystem paths; preserve the whole token
  // as an opaque reference while still rejecting arbitrary slash paths.
  if (/^\/[a-z][a-z0-9-]*(?:\([^)\n]*\))?$/.test(raw)) return { raw, normalized: raw, kind: 'unclassified', adjusted: false };
  const normalized = raw.replace(/\\/g, '/').replace(/^\.\//, '');
  if (
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split('/').some(part => part === '..') ||
    /[\0-\x1F\x7F]/.test(normalized)
  ) {
    throw new MigrationPackError('UNSAFE_PATH', `unsafe path reference in migrated document: ${raw}`);
  }
  return { raw, normalized, kind: 'repo-relative', adjusted: normalized !== raw };
}

function rewritePathReferences(content: string): string {
  const rewrite = (rawValue: string): string => {
    const leading = rawValue.startsWith('<') ? '<' : '';
    const trailing = rawValue.endsWith('>') ? '>' : '';
    const raw = rawValue.slice(leading.length, rawValue.length - trailing.length || undefined);
    const reference = normalizePathReference(raw.trim());
    if (reference.kind !== 'repo-relative' || reference.normalized === raw.trim()) return rawValue;
    const leftWhitespace = raw.match(/^\s*/)?.[0] ?? '';
    const rightWhitespace = raw.match(/\s*$/)?.[0] ?? '';
    return `${leading}${leftWhitespace}${reference.normalized}${rightWhitespace}${trailing}`;
  };
  let rewritten = content.replace(/\]\(([^)]+)\)/g, (whole, raw: string) => `](${rewrite(raw)})`);
  rewritten = rewritten.replace(/`([^`\n]+)`/g, (whole, raw: string) => `\`${rewrite(raw)}\``);
  return rewritten;
}

function canonicalDocumentKind(kind: MigrationArtifactKind): CanonicalMarkdownHeader['document_kind'] | 'project-profile' {
  if (kind === 'project-profile') return 'project-profile';
  return kind;
}

function canonicalDocumentId(kind: MigrationArtifactKind, sourcePath: string, sourceSha: string): string {
  return `doc-${sha256(`${kind}\0${sourcePath}\0${sourceSha}`).slice(0, 24)}`;
}

function extractHeadingIndex(content: string, sourcePath: string): Array<{ id: string; level: number; text: string }> {
  const headings: Array<{ id: string; level: number; text: string }> = [];
  for (const line of content.split(/\r?\n/)) {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const text = match[2].trim();
    const ordinal = headings.length;
    headings.push({ id: `heading-${sha256(`${sourcePath}\0${ordinal}\0${text}`).slice(0, 16)}`, level: match[1].length, text });
  }
  return headings;
}

function canonicalMarkdownHeader(
  kind: Exclude<MigrationArtifactKind, 'project-profile'>,
  sourcePath: string,
  content: string,
  sourceSha: string,
  pathReferences: PathReference[],
  legacyProtocolVersion: string,
  legacySource: TargetSnapshot,
): CanonicalMarkdownHeader {
  return {
    schema_version: VNEXT_CANONICAL_DOCUMENT_SCHEMA_VERSION,
    kind: VNEXT_CANONICAL_DOCUMENT_KIND,
    document_kind: canonicalDocumentKind(kind) as CanonicalMarkdownHeader['document_kind'],
    document_id: canonicalDocumentId(kind, sourcePath, sourceSha),
    source_path: sourcePath,
    source_sha256: sourceSha,
    legacy_source_revision: legacySource.revision,
    legacy_source_tree_hash: legacySource.tree_hash,
    legacy_protocol_version: legacyProtocolVersion,
    conversion_rule: VNEXT_CANONICAL_CONVERSION_RULE,
    original_text_preserved: true,
    heading_index: extractHeadingIndex(content, sourcePath),
    path_references: pathReferences,
  };
}

function canonicalizeMarkdownDocument(
  kind: Exclude<MigrationArtifactKind, 'project-profile'>,
  sourcePath: string,
  content: string,
  sourceSha: string,
  legacyProtocolVersion: string,
  legacySource: TargetSnapshot,
): string {
  const header = canonicalMarkdownHeader(
    kind,
    sourcePath,
    content,
    sourceSha,
    extractPathReferences(content),
    legacyProtocolVersion,
    legacySource,
  );
  return `---\n${stringifyYaml(header).trimEnd()}\n---\n${rewritePathReferences(content)}`;
}

function canonicalizeProjectProfile(
  sourcePath: string,
  content: string,
  sourceSha: string,
  legacyProtocolVersion: string,
  legacySource: TargetSnapshot,
): string {
  const parsed = parseDocument(content, { uniqueKeys: true });
  const diagnostics = [...parsed.errors, ...parsed.warnings];
  if (diagnostics.length > 0) {
    throw new MigrationPackError('DOCUMENT_INVALID', `PROJECT_PROFILE.yaml has invalid YAML: ${diagnostics.map(item => item.message).join('; ')}`);
  }
  const value = expectRecord(parsed.toJS(), sourcePath);
  if ('vnext_migration' in value) {
    throw new MigrationPackError('DOCUMENT_INVALID', `${sourcePath} already contains vnext_migration metadata.`);
  }
  const metadata = {
    schema_version: VNEXT_CANONICAL_DOCUMENT_SCHEMA_VERSION,
    kind: 'vnext-canonical-profile',
    document_id: canonicalDocumentId('project-profile', sourcePath, sourceSha),
    source_path: sourcePath,
    source_sha256: sourceSha,
    legacy_source_revision: legacySource.revision,
    legacy_source_tree_hash: legacySource.tree_hash,
    legacy_protocol_version: legacyProtocolVersion,
    conversion_rule: VNEXT_CANONICAL_CONVERSION_RULE,
    original_text_preserved: true,
    path_references: extractPathReferences(content),
  };
  const suffix = stringifyYaml({ vnext_migration: metadata }).trimEnd();
  return `${content.endsWith('\n') ? content : `${content}\n`}\n${suffix}\n`;
}

function canonicalizeArtifactContent(
  kind: MigrationArtifactKind,
  sourcePath: string,
  content: string,
  sourceSha: string,
  legacyProtocolVersion: string,
  legacySource: TargetSnapshot,
): string {
  if (kind === 'project-profile') {
    return canonicalizeProjectProfile(sourcePath, content, sourceSha, legacyProtocolVersion, legacySource);
  }
  return canonicalizeMarkdownDocument(kind, sourcePath, content, sourceSha, legacyProtocolVersion, legacySource);
}

function parseCanonicalFrontmatter(content: string, location: string): { header: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(content);
  if (!match) throw new MigrationPackError('PACK_INVALID', `${location} is missing the vNext canonical frontmatter envelope.`);
  const document = parseDocument(match[1], { uniqueKeys: true });
  const diagnostics = [...document.errors, ...document.warnings];
  if (diagnostics.length > 0) throw new MigrationPackError('PACK_INVALID', `${location} has invalid canonical frontmatter: ${diagnostics.map(item => item.message).join('; ')}`);
  return { header: expectRecord(document.toJS(), `${location} frontmatter`), body: match[2] };
}

function validatePathReferenceList(value: unknown, location: string): PathReference[] {
  if (!Array.isArray(value)) throw new MigrationPackError('PACK_INVALID', `${location} must be a list.`);
  return value.map((raw, index) => {
    const ref = expectRecord(raw, `${location}[${index}]`);
    expectExactKeys(ref, ['raw', 'normalized', 'kind', 'adjusted'], `${location}[${index}]`);
    const rawValue = expectString(ref.raw, `${location}[${index}].raw`);
    const normalized = expectString(ref.normalized, `${location}[${index}].normalized`);
    const refKind = expectString(ref.kind, `${location}[${index}].kind`);
    if (!['repo-relative', 'external', 'anchor', 'unclassified'].includes(refKind)) throw new MigrationPackError('PACK_INVALID', `${location}[${index}].kind is unsupported.`);
    const adjusted = expectBoolean(ref.adjusted, `${location}[${index}].adjusted`);
    return { raw: rawValue, normalized, kind: refKind as PathReference['kind'], adjusted };
  });
}

function validateCanonicalArtifactContent(
  artifact: MigrationArtifact,
  canonicalContent: string,
  originalContent: string,
  legacyProtocolVersion: string,
  legacySource: TargetSnapshot,
  location: string,
): void {
  const expectedCanonicalContent = canonicalizeArtifactContent(
    artifact.kind,
    artifact.source_path,
    originalContent,
    artifact.source_sha256,
    legacyProtocolVersion,
    legacySource,
  );
  if (canonicalContent !== expectedCanonicalContent) {
    throw new MigrationPackError('PACK_INVALID', `${location} does not match the deterministic canonical conversion.`);
  }
  if (artifact.kind === 'project-profile') {
    if (!canonicalContent.startsWith(originalContent)) throw new MigrationPackError('PACK_INVALID', `${location} does not preserve the original profile text as its prefix.`);
    const parsed = parseDocument(canonicalContent, { uniqueKeys: true });
    const diagnostics = [...parsed.errors, ...parsed.warnings];
    if (diagnostics.length > 0) throw new MigrationPackError('PACK_INVALID', `${location} has invalid canonical profile YAML: ${diagnostics.map(item => item.message).join('; ')}`);
    const root = expectRecord(parsed.toJS(), location);
    const metadata = expectRecord(root.vnext_migration, `${location}.vnext_migration`);
    expectExactKeys(metadata, ['schema_version', 'kind', 'document_id', 'source_path', 'source_sha256', 'legacy_source_revision', 'legacy_source_tree_hash', 'legacy_protocol_version', 'conversion_rule', 'original_text_preserved', 'path_references'], `${location}.vnext_migration`);
    if (metadata.schema_version !== VNEXT_CANONICAL_DOCUMENT_SCHEMA_VERSION || metadata.kind !== 'vnext-canonical-profile' || metadata.document_id !== canonicalDocumentId(artifact.kind, artifact.source_path, artifact.source_sha256) || metadata.source_path !== artifact.source_path || metadata.source_sha256 !== artifact.source_sha256 || metadata.legacy_source_revision !== legacySource.revision || metadata.legacy_source_tree_hash !== legacySource.tree_hash || metadata.legacy_protocol_version !== legacyProtocolVersion || metadata.conversion_rule !== VNEXT_CANONICAL_CONVERSION_RULE || metadata.original_text_preserved !== true) {
      throw new MigrationPackError('PACK_INVALID', `${location}.vnext_migration does not bind to the artifact/legacy snapshot.`);
    }
    const references = validatePathReferenceList(metadata.path_references, `${location}.vnext_migration.path_references`);
    if (JSON.stringify(references) !== JSON.stringify(artifact.path_references)) throw new MigrationPackError('PACK_INVALID', `${location}.vnext_migration.path_references do not match the artifact inventory.`);
    return;
  }

  const parsed = parseCanonicalFrontmatter(canonicalContent, location);
  const header = parsed.header;
  expectExactKeys(header, ['schema_version', 'kind', 'document_kind', 'document_id', 'source_path', 'source_sha256', 'legacy_source_revision', 'legacy_source_tree_hash', 'legacy_protocol_version', 'conversion_rule', 'original_text_preserved', 'heading_index', 'path_references'], `${location} frontmatter`);
  if (header.schema_version !== VNEXT_CANONICAL_DOCUMENT_SCHEMA_VERSION || header.kind !== VNEXT_CANONICAL_DOCUMENT_KIND || header.document_kind !== artifact.kind || header.document_id !== canonicalDocumentId(artifact.kind, artifact.source_path, artifact.source_sha256) || header.source_path !== artifact.source_path || header.source_sha256 !== artifact.source_sha256 || header.legacy_source_revision !== legacySource.revision || header.legacy_source_tree_hash !== legacySource.tree_hash || header.legacy_protocol_version !== legacyProtocolVersion || header.conversion_rule !== VNEXT_CANONICAL_CONVERSION_RULE || header.original_text_preserved !== true) {
    throw new MigrationPackError('PACK_INVALID', `${location} canonical frontmatter does not bind to the artifact/legacy snapshot.`);
  }
  if (!Array.isArray(header.heading_index)) throw new MigrationPackError('PACK_INVALID', `${location}.heading_index must be a list.`);
  const headingIndex = header.heading_index.map((raw, index) => {
    const heading = expectRecord(raw, `${location}.heading_index[${index}]`);
    expectExactKeys(heading, ['id', 'level', 'text'], `${location}.heading_index[${index}]`);
    const id = expectString(heading.id, `${location}.heading_index[${index}].id`);
    const level = heading.level;
    const text = expectString(heading.text, `${location}.heading_index[${index}].text`);
    if (!/^heading-[a-f0-9]{16}$/.test(id) || typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > 6) throw new MigrationPackError('PACK_INVALID', `${location}.heading_index[${index}] is invalid.`);
    return { id, level, text };
  });
  const references = validatePathReferenceList(header.path_references, `${location}.path_references`);
  if (JSON.stringify(references) !== JSON.stringify(artifact.path_references)) throw new MigrationPackError('PACK_INVALID', `${location}.path_references do not match the artifact inventory.`);
  if (parsed.body !== rewritePathReferences(originalContent)) throw new MigrationPackError('PACK_INVALID', `${location} does not preserve the original Markdown body apart from deterministic path normalization.`);
  if (JSON.stringify(headingIndex) !== JSON.stringify(extractHeadingIndex(originalContent, artifact.source_path))) throw new MigrationPackError('PACK_INVALID', `${location}.heading_index does not match the preserved Markdown headings.`);
}

function validateLegacyDocument(file: string, content: string): MigrationIssue[] {
  const issues: MigrationIssue[] = [];
  const basename = path.basename(file) as WorkflowDocName;
  if ((WORKFLOW_DOC_NAMES as readonly string[]).includes(basename) && basename !== CURRENT_TASK_FILE) {
    try {
      validateWorkflowDocContract(basename, content);
    } catch (error) {
      issues.push({ severity: 'error', code: 'DOCUMENT_INVALID', message: error instanceof Error ? error.message : String(error), path: file });
    }
  }
  if (file.endsWith('.yaml') || file.endsWith('.yml')) {
    try {
      const document = parseDocument(content, { uniqueKeys: true });
      const diagnostics = [...document.errors, ...document.warnings];
      if (diagnostics.length > 0) throw new Error(diagnostics.map(item => item.message).join('; '));
    } catch (error) {
      issues.push({ severity: 'error', code: 'DOCUMENT_INVALID', message: error instanceof Error ? error.message : String(error), path: file });
    }
  }
  return issues;
}

function createArtifact(
  kind: MigrationArtifactKind,
  sourcePath: string,
  targetPath: string,
  content: string,
  source: SourceIdentity,
  legacySource: TargetSnapshot,
  legacyProtocolVersion: string,
): MigrationArtifact {
  const normalizedSourcePath = normalizeRepoPath(sourcePath, 'artifact.source_path');
  const normalizedTargetPath = normalizeRepoPath(targetPath, 'artifact.target_path');
  const sourceSha = sha256(content);
  const stableId = `artifact-${sha256(`${kind}\0${normalizedSourcePath}\0${sourceSha}`).slice(0, 24)}`;
  const canonicalContent = canonicalizeArtifactContent(kind, normalizedSourcePath, content, sourceSha, legacyProtocolVersion, legacySource);
  return {
    stable_id: stableId,
    kind,
    source_path: normalizedSourcePath,
    target_path: normalizedTargetPath,
    content_path: `artifacts/${stableId}.content`,
    original_content_path: `originals/${stableId}.source`,
    canonical_schema_version: VNEXT_CANONICAL_DOCUMENT_SCHEMA_VERSION,
    conversion_rule: VNEXT_CANONICAL_CONVERSION_RULE,
    source_sha256: sourceSha,
    content_sha256: sha256(canonicalContent),
    byte_length: Buffer.byteLength(canonicalContent, 'utf8'),
    path_references: extractPathReferences(content),
    provenance: {
      source_revision: source.revision,
      source_tree_hash: source.tree_hash,
      legacy_source_revision: legacySource.revision,
      legacy_source_tree_hash: legacySource.tree_hash,
      source_path: normalizedSourcePath,
      source_sha256: sourceSha,
      conversion_rule: VNEXT_CANONICAL_CONVERSION_RULE,
    },
  };
}

function profilePath(targetRoot: string): string {
  return path.join(targetRoot, '.workflow-system', 'PROJECT_PROFILE.yaml');
}

export function preflightMigration(options: PreflightOptions): MigrationPreflight {
  const sourceRoot = path.resolve(options.sourceRoot ?? resolveRoot());
  const targetRoot = path.resolve(options.targetRoot);
  const source = getSourceIdentity(sourceRoot);
  const blockers: MigrationIssue[] = [];
  const warnings: MigrationIssue[] = [];
  let targetSnapshot: TargetSnapshot | null = null;
  if (fs.existsSync(targetRoot) && fs.statSync(targetRoot).isDirectory()) {
    try {
      targetSnapshot = getTargetSnapshot(targetRoot);
    } catch (error) {
      blockers.push({ severity: 'error', code: 'LEGACY_SURFACE_AMBIGUOUS', message: error instanceof Error ? error.message : String(error), path: targetRoot });
    }
  } else {
    blockers.push({ severity: 'error', code: 'LEGACY_SURFACE_AMBIGUOUS', message: 'Target root must be an existing directory.', path: targetRoot });
  }
  const targetGuard = checkTargetRoot(sourceRoot, targetRoot);
  if (!targetGuard.allowed) {
    blockers.push({ severity: 'error', code: 'TARGET_ROOT_DENIED', message: targetGuard.message, path: targetRoot });
  }

  const targetProfilePath = profilePath(targetRoot);
  let profile: JsonObject | null = null;
  let target: TargetIdentity | null = null;
  let workflowHome: string | null = null;
  if (!fs.existsSync(targetProfilePath)) {
    blockers.push({ severity: 'error', code: 'PROFILE_MISSING', message: 'Target PROJECT_PROFILE.yaml is required.', path: '.workflow-system/PROJECT_PROFILE.yaml' });
  } else {
    try {
      profile = parseStrictYaml(targetProfilePath) as JsonObject;
      target = getProjectIdentity(profile, targetRoot);
      workflowHome = getWorkflowHome(profile);
    } catch (error) {
      blockers.push({ severity: 'error', code: 'PROFILE_INVALID', message: error instanceof Error ? error.message : String(error), path: '.workflow-system/PROJECT_PROFILE.yaml' });
    }
  }

  const vnextStatePath = path.join(targetRoot, ...VNEXT_INSTALL_STATE_RELATIVE_PATH.split('/'));
  const vnextReceiptPath = path.join(targetRoot, ...VNEXT_MIGRATION_RECEIPT_RELATIVE_PATH.split('/'));
  const vnextInProgressPath = path.join(targetRoot, ...VNEXT_MIGRATION_IN_PROGRESS_RELATIVE_PATH.split('/'));
  if (fs.existsSync(vnextStatePath) || fs.existsSync(vnextReceiptPath)) {
    blockers.push({ severity: 'error', code: 'VNEXT_ALREADY_PRESENT', message: 'A vNext install marker is already present; do not run a second conversion.', path: VNEXT_INSTALL_STATE_RELATIVE_PATH });
  } else if (fs.existsSync(vnextInProgressPath)) {
    blockers.push({ severity: 'error', code: 'VNEXT_INSTALL_IN_PROGRESS', message: 'An interrupted vNext installation marker is present; inspect or explicitly recover it before retrying migration.', path: VNEXT_MIGRATION_IN_PROGRESS_RELATIVE_PATH });
  } else {
    const vnextDirectory = path.join(targetRoot, '.workflow-system', 'vnext');
    const partialFiles = listFiles(vnextDirectory).filter(filePath => {
      const basename = path.basename(filePath);
      return basename !== 'MIGRATION_PACK_SCHEMA.yaml' && basename !== path.basename(VNEXT_DISTRIBUTION_IN_PROGRESS_RELATIVE_PATH);
    });
    if (partialFiles.length > 0) {
      blockers.push({ severity: 'error', code: 'VNEXT_ALREADY_PRESENT', message: 'A partial vNext surface is present without a completed install marker; repair it explicitly before migration.', path: path.relative(targetRoot, partialFiles[0]).replace(/\\/g, '/') });
    }
  }

  const legacyProtocol = getLegacyProtocol(targetRoot);
  blockers.push(...legacyProtocol.issues);
  let currentTask: CurrentTaskSnapshot | null = null;
  let currentTaskPath: string | null = null;
  if (profile) {
    try {
      const current = getCurrentTaskSnapshot(targetRoot, profile);
      currentTask = current.snapshot;
      blockers.push(...current.blockers);
      warnings.push(...current.warnings);
      currentTaskPath = current.snapshot?.path ?? [getWorkflowHome(profile), CURRENT_TASK_FILE].filter(Boolean).join('/');
    } catch (error) {
      blockers.push({ severity: 'error', code: 'CURRENT_TASK_INVALID', message: error instanceof Error ? error.message : String(error), path: 'CURRENT_TASK.md' });
    }
    try {
      blockers.push(...scanSuspendedWork(targetRoot));
    } catch (error) {
      blockers.push({ severity: 'error', code: 'SUSPENDED_WORK_PRESENT', message: error instanceof Error ? error.message : String(error), path: 'TASKS' });
    }
  }

  let legacySurface = { entries: [] as LegacySurfaceEntry[], legacySkillNames: [] as string[] };
  if (profile) {
    try {
      const surface = collectLegacySurface(targetRoot, profile, currentTaskPath);
      legacySurface = { entries: surface.entries, legacySkillNames: surface.legacySkillNames };
      blockers.push(...surface.issues.filter(issue => issue.severity === 'error'));
      warnings.push(...surface.issues.filter(issue => issue.severity === 'warning'));
    } catch (error) {
      blockers.push({ severity: 'error', code: 'LEGACY_SURFACE_AMBIGUOUS', message: error instanceof Error ? error.message : String(error) });
    }
  }

  for (const entry of legacySurface.entries) {
    if (entry.action === 'remove' || entry.action === 'replace') {
      if (isFrozenPath(targetRoot, entry.path)) {
        blockers.push({ severity: 'error', code: 'FROZEN_PATH', message: 'Migration cannot replace or remove a frozen path.', path: entry.path });
      }
    }
  }

  const eligible = blockers.length === 0;
  let state: MigrationPreflight['state'];
  if (blockers.some(issue => issue.code === 'VNEXT_ALREADY_PRESENT')) {
    state = 'already-vnext';
  } else if (blockers.some(issue => issue.code === 'VNEXT_INSTALL_IN_PROGRESS')) {
    state = 'install-in-progress';
  } else if (blockers.some(issue => issue.code.includes('PROTOCOL') || issue.code.includes('SCHEMA'))) {
    state = 'unsupported';
  } else if (!target || !currentTask) {
    state = 'ambiguous';
  } else if (blockers.some(issue => issue.code === 'CURRENT_TASK_NON_IDLE' || issue.code === 'CURRENT_TASK_FINDING_OPEN' || issue.code === 'SUSPENDED_WORK_PRESENT')) {
    state = 'non-idle';
  } else if (eligible) {
    state = 'idle';
  } else {
    state = 'ambiguous';
  }

  return {
    kind: 'migration-preflight',
    eligible,
    state,
    source,
    target,
    target_snapshot: targetSnapshot,
    profile_path: '.workflow-system/PROJECT_PROFILE.yaml',
    workflow_home: workflowHome,
    legacy_protocol: legacyProtocol.snapshot,
    current_task: currentTask,
    legacy_surface: legacySurface,
    blockers,
    warnings,
    checked_at: now(),
  };
}

function requiredDocumentPaths(targetRoot: string, profile: JsonObject): string[] {
  const home = getWorkflowHome(profile);
  return REQUIRED_LEGACY_DOCUMENTS.map(file => [home, file].filter(Boolean).join('/')).map(relative => path.join(targetRoot, ...relative.split('/')));
}

function collectConversionArtifacts(
  targetRoot: string,
  profile: JsonObject,
  source: SourceIdentity,
  legacySource: TargetSnapshot,
  legacyProtocolVersion: string,
  issues: MigrationIssue[],
): MigrationArtifact[] {
  const artifacts: MigrationArtifact[] = [];
  const home = getWorkflowHome(profile);
  for (const relativeName of WORKFLOW_DOC_NAMES) {
    if (relativeName === CURRENT_TASK_FILE) continue;
    const relativePath = [home, relativeName].filter(Boolean).join('/');
    const filePath = path.join(targetRoot, ...relativePath.split('/'));
    if (!fs.existsSync(filePath)) {
      if (REQUIRED_LEGACY_DOCUMENTS.includes(relativeName)) {
        issues.push({ severity: 'error', code: 'REQUIRED_DOCUMENT_MISSING', message: `Required governance document is missing: ${relativePath}`, path: relativePath });
      }
      continue;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    issues.push(...validateLegacyDocument(relativeName, content));
    artifacts.push(createArtifact('governance-document', relativePath, relativePath, content, source, legacySource, legacyProtocolVersion));
  }

  const profileRelativePath = '.workflow-system/PROJECT_PROFILE.yaml';
  const profileFilePath = path.join(targetRoot, ...profileRelativePath.split('/'));
  const profileContent = fs.readFileSync(profileFilePath, 'utf8');
  try {
    const document = parseDocument(profileContent, { uniqueKeys: true });
    const diagnostics = [...document.errors, ...document.warnings];
    if (diagnostics.length > 0) throw new Error(diagnostics.map(item => item.message).join('; '));
  } catch (error) {
    issues.push({ severity: 'error', code: 'DOCUMENT_INVALID', message: error instanceof Error ? error.message : String(error), path: profileRelativePath });
  }
  artifacts.push(createArtifact('project-profile', profileRelativePath, profileRelativePath, profileContent, source, legacySource, legacyProtocolVersion));

  const tasksDir = path.join(targetRoot, 'TASKS');
  if (fs.existsSync(tasksDir)) {
    for (const filePath of listFiles(tasksDir)) {
      const relativePath = path.relative(targetRoot, filePath).replace(/\\/g, '/');
      if (relativePath.startsWith('TASKS/paused/') || relativePath.startsWith('TASKS/interrupted/') || relativePath.startsWith('TASKS/inbox/')) continue;
      const basename = path.basename(filePath);
      if (/^TASK-[0-9]{3,}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(basename)) {
        const content = fs.readFileSync(filePath, 'utf8');
        issues.push(...validateLegacyDocument(relativePath, content));
        artifacts.push(createArtifact('task-archive', relativePath, relativePath, content, source, legacySource, legacyProtocolVersion));
      } else if (basename !== 'README.md' && basename !== '.gitkeep') {
        const content = fs.readFileSync(filePath, 'utf8');
        issues.push({ severity: 'warning', code: 'CONVERSION_ISSUE', message: 'Unclassified TASKS content is preserved as target-owned content.', path: relativePath });
        artifacts.push(createArtifact('target-owned-preserved', relativePath, relativePath, content, source, legacySource, legacyProtocolVersion));
      }
    }
  }

  // Preserve unlisted, non-generated workflow documents without trying to
  // infer their historical semantics.  Their presence is explicit evidence.
  const workflowDir = path.join(targetRoot, ...home.split('/').filter(Boolean));
  for (const filePath of listFiles(workflowDir)) {
    const relativePath = path.relative(targetRoot, filePath).replace(/\\/g, '/');
    if (
      relativePath === [home, CURRENT_TASK_FILE].filter(Boolean).join('/') ||
      relativePath === '.workflow-system/PROJECT_PROFILE.yaml' ||
      relativePath.includes('/generated/') ||
      relativePath.endsWith('/SKILL_REGISTRY.md') ||
      artifacts.some(artifact => artifact.source_path === relativePath)
    ) continue;
    if (path.basename(filePath).endsWith('.md')) {
      const content = fs.readFileSync(filePath, 'utf8');
      issues.push({ severity: 'warning', code: 'CONVERSION_ISSUE', message: 'Unclassified workflow document is preserved verbatim; no semantic rewrite was attempted.', path: relativePath });
      artifacts.push(createArtifact('target-owned-preserved', relativePath, relativePath, content, source, legacySource, legacyProtocolVersion));
    }
  }
  return artifacts.sort((left, right) => left.target_path.localeCompare(right.target_path));
}

function packIdFor(manifest: Omit<MigrationPackManifest, 'pack_id' | 'created_at' | 'status'>): string {
  const identity = {
    source: manifest.source,
    target: manifest.target,
    legacy_source: manifest.legacy_source,
    legacy_protocol: manifest.legacy_protocol,
    // Timestamps are audit metadata, not replay identity.  The same source
    // revision and target snapshot must yield the same pack ID on a later
    // offline conversion.
    preflight: {
      state: manifest.preflight.state,
      current_task: manifest.preflight.current_task,
      current_task_excluded: manifest.preflight.current_task_excluded,
    },
    artifacts: manifest.artifacts.map(artifact => ({
      stable_id: artifact.stable_id,
      source_sha256: artifact.source_sha256,
      content_sha256: artifact.content_sha256,
      target_path: artifact.target_path,
      conversion_rule: artifact.conversion_rule,
    })),
    legacy_surface: manifest.legacy_surface.entries.map(entry => ({ path: entry.path, sha256: entry.sha256, action: entry.action })),
  };
  return `migration-${sha256(JSON.stringify(identity)).slice(0, 24)}`;
}

function ensureOutputDirectory(outDir: string, overwrite: boolean): void {
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
    return;
  }
  const files = listFiles(outDir);
  if (files.length === 0) return;
  const manifestPath = path.join(outDir, MIGRATION_PACK_FILE);
  if (!overwrite && fs.existsSync(manifestPath)) {
    throw new MigrationPackError('OUTPUT_DIR_NOT_EMPTY', `Output directory already contains a Migration Pack: ${outDir}`);
  }
  if (!overwrite) {
    throw new MigrationPackError('OUTPUT_DIR_NOT_EMPTY', `Output directory is not empty: ${outDir}`);
  }
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
}

export function createMigrationPack(options: CreatePackOptions): MigrationPackManifest {
  const sourceRoot = path.resolve(options.sourceRoot ?? resolveRoot());
  const targetRoot = path.resolve(options.targetRoot);
  assertExternalOutputDirectory(path.resolve(options.outDir), sourceRoot, targetRoot, 'Migration Pack output directory');
  const preflight = preflightMigration({ sourceRoot, targetRoot });
  if (!preflight.eligible || !preflight.target || !preflight.target_snapshot || !preflight.current_task || !preflight.legacy_protocol) {
    const firstBlocker = preflight.blockers.find(issue => issue.severity === 'error');
    throw new MigrationPackError(
      firstBlocker?.code ?? 'CURRENT_TASK_NON_IDLE',
      'Migration Pack requires an eligible idle old project.',
      preflight.blockers,
    );
  }
  const profile = parseStrictYaml(profilePath(targetRoot)) as JsonObject;
  const conversionIssues: MigrationIssue[] = [...preflight.warnings];
  const artifacts = collectConversionArtifacts(
    targetRoot,
    profile,
    preflight.source,
    preflight.target_snapshot,
    preflight.legacy_protocol.protocol_version,
    conversionIssues,
  );
  const requiredPaths = requiredDocumentPaths(targetRoot, profile);
  for (const requiredPath of requiredPaths) {
    if (!fs.existsSync(requiredPath)) {
      const relative = path.relative(targetRoot, requiredPath).replace(/\\/g, '/');
      if (!conversionIssues.some(issue => issue.code === 'REQUIRED_DOCUMENT_MISSING' && issue.path === relative)) {
        conversionIssues.push({ severity: 'error', code: 'REQUIRED_DOCUMENT_MISSING', message: `Required governance document is missing: ${relative}`, path: relative });
      }
    }
  }
  if (conversionIssues.some(issue => issue.severity === 'error')) {
    throw new MigrationPackError('DOCUMENT_INVALID', 'Offline conversion did not produce a complete valid document set.', conversionIssues.filter(issue => issue.severity === 'error'));
  }

  const manifestBase: Omit<MigrationPackManifest, 'pack_id' | 'created_at' | 'status'> = {
    schema_version: MIGRATION_PACK_SCHEMA_VERSION,
    kind: MIGRATION_PACK_KIND,
    source: preflight.source,
    target: preflight.target,
    legacy_source: preflight.target_snapshot,
    legacy_protocol: preflight.legacy_protocol,
    preflight: {
      state: 'idle',
      current_task: preflight.current_task,
      current_task_excluded: true,
      checked_at: preflight.checked_at,
    },
    conversion: {
      mode: 'offline-structural',
      preserves_original_text: true,
      semantic_reinterpretation: false,
      allowed_surfaces: ['CONTRACTS', 'DECISIONS', 'LESSONS', 'STATUS', 'BASELINES', 'other long-term governance documents', 'TASK archives', 'PROJECT_PROFILE metadata'],
      issues: conversionIssues,
    },
    artifacts,
    legacy_surface: {
      entries: preflight.legacy_surface.entries,
      legacy_skill_names: preflight.legacy_surface.legacySkillNames,
    },
    installation: {
      requires_vnext_bundle: true,
      install_state_path: VNEXT_INSTALL_STATE_RELATIVE_PATH,
      migration_receipt_path: VNEXT_MIGRATION_RECEIPT_RELATIVE_PATH,
      in_progress_path: VNEXT_MIGRATION_IN_PROGRESS_RELATIVE_PATH,
      old_current_task_replaced_by_bundle: true,
      old_protocol_and_schema_replaced_by_bundle: true,
      old_compatibility_surface_removed: true,
    },
  };
  const manifest: MigrationPackManifest = {
    ...manifestBase,
    pack_id: packIdFor(manifestBase),
    status: 'validated',
    created_at: now(),
  };

  ensureOutputDirectory(path.resolve(options.outDir), options.overwrite ?? false);
  const outputDir = path.resolve(options.outDir);
  for (const artifact of artifacts) {
    const sourceContent = fs.readFileSync(resolveRepoPath(targetRoot, artifact.source_path, 'artifact source path'), 'utf8');
    const canonicalContent = canonicalizeArtifactContent(
      artifact.kind,
      artifact.source_path,
      sourceContent,
      artifact.source_sha256,
      preflight.legacy_protocol.protocol_version,
      preflight.target_snapshot,
    );
    if (sha256(sourceContent) !== artifact.source_sha256 || sha256(canonicalContent) !== artifact.content_sha256) {
      throw new MigrationPackError('PACK_STALE', `Source changed while writing converted artifact: ${artifact.source_path}`);
    }
    const outputPath = resolveRepoPath(outputDir, artifact.content_path, 'pack artifact content path');
    const originalPath = resolveRepoPath(outputDir, artifact.original_content_path, 'pack original content path');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.mkdirSync(path.dirname(originalPath), { recursive: true });
    fs.writeFileSync(outputPath, canonicalContent, 'utf8');
    fs.writeFileSync(originalPath, sourceContent, 'utf8');
  }
  fs.writeFileSync(path.join(outputDir, MIGRATION_PACK_FILE), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const report: MigrationOperationResult = {
    status: 'ready',
    pack_id: manifest.pack_id,
    output_directory: outputDir,
    target_root: targetRoot,
    blockers: [],
    warnings: conversionIssues.filter(issue => issue.severity === 'warning'),
    planned_writes: artifacts.map(artifact => artifact.target_path),
    planned_deletes: preflight.legacy_surface.entries.filter(entry => entry.action === 'remove').map(entry => entry.path),
  };
  fs.writeFileSync(path.join(outputDir, MIGRATION_REPORT_FILE), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  validateMigrationPack({ packDir: outputDir, sourceRoot, targetRoot });
  return manifest;
}

function validateSourceIdentity(actual: SourceIdentity, expected: SourceIdentity, location: string, portable = false): void {
  if (
    actual.revision !== expected.revision ||
    actual.tree_hash !== expected.tree_hash
    || (!portable && actual.root_identity !== expected.root_identity)
  ) {
    throw new MigrationPackError('PACK_STALE', `${location} does not match the exact source identity/revision${portable ? ' and content hash' : ''}.`);
  }
}

function validateSourceIdentityShape(value: unknown, location: string): SourceIdentity {
  const record = expectRecord(value, location);
  expectExactKeys(record, ['root_path', 'root_identity', 'revision', 'tree_hash'], location);
  const rootPath = expectString(record.root_path, `${location}.root_path`);
  const rootIdentity = expectString(record.root_identity, `${location}.root_identity`);
  const revision = expectString(record.revision, `${location}.revision`);
  const treeHash = expectString(record.tree_hash, `${location}.tree_hash`);
  if (!/^[a-f0-9]{32}$/.test(rootIdentity) || !/^[a-f0-9]{64}$/.test(treeHash)) {
    throw new MigrationPackError('PACK_INVALID', `${location} identity/hash has invalid format.`);
  }
  return { root_path: normalizeAbsoluteRootPath(rootPath), root_identity: rootIdentity, revision, tree_hash: treeHash };
}

function validateTargetIdentityShape(value: unknown, location: string): TargetIdentity {
  const record = expectRecord(value, location);
  expectExactKeys(record, ['root_path', 'root_identity', 'project_name', 'project_slug'], location);
  const rootPath = expectString(record.root_path, `${location}.root_path`);
  const rootIdentity = expectString(record.root_identity, `${location}.root_identity`);
  const projectName = expectString(record.project_name, `${location}.project_name`);
  const projectSlug = expectString(record.project_slug, `${location}.project_slug`);
  if (!/^[a-f0-9]{32}$/.test(rootIdentity) || !SAFE_ID_PATTERN.test(projectSlug)) {
    throw new MigrationPackError('PACK_INVALID', `${location} identity/slug has invalid format.`);
  }
  return { root_path: normalizeAbsoluteRootPath(rootPath), root_identity: rootIdentity, project_name: projectName, project_slug: projectSlug };
}

function validateTargetSnapshotShape(value: unknown, location: string): TargetSnapshot {
  const record = expectRecord(value, location);
  expectExactKeys(record, ['revision', 'tree_hash'], location);
  const revision = expectString(record.revision, `${location}.revision`);
  const treeHash = expectString(record.tree_hash, `${location}.tree_hash`);
  if (!/^[a-f0-9]{64}$/.test(treeHash)) throw new MigrationPackError('PACK_INVALID', `${location}.tree_hash has invalid format.`);
  if (!/^tree-[a-f0-9]{64}$/.test(revision) && !/^[a-f0-9]{40,64}$/.test(revision)) {
    // A Git revision is normally a 40-character SHA, while tree-only
    // snapshots use the explicit tree-<sha> fallback.
    if (!/^[a-f0-9]{40,64}$/.test(revision)) throw new MigrationPackError('PACK_INVALID', `${location}.revision has invalid format.`);
  }
  return { revision, tree_hash: treeHash };
}

function validateCurrentTaskSnapshot(value: unknown, location: string): CurrentTaskSnapshot {
  const record = expectRecord(value, location);
  expectExactKeys(record, ['path', 'sha256', 'workflow_status', 'lifecycle_state', 'resume_requires_review', 'resume_review_reasons', 'identity_status'], location);
  const result = {
    path: normalizeRepoPath(expectString(record.path, `${location}.path`), `${location}.path`),
    sha256: expectString(record.sha256, `${location}.sha256`),
    workflow_status: expectString(record.workflow_status, `${location}.workflow_status`),
    lifecycle_state: expectString(record.lifecycle_state, `${location}.lifecycle_state`),
    resume_requires_review: record.resume_requires_review === null ? null : expectBoolean(record.resume_requires_review, `${location}.resume_requires_review`),
    resume_review_reasons: record.resume_review_reasons === null ? null : expectString(record.resume_review_reasons, `${location}.resume_review_reasons`),
    identity_status: expectString(record.identity_status, `${location}.identity_status`),
  } as CurrentTaskSnapshot;
  if (!/^[a-f0-9]{64}$/.test(result.sha256)) throw new MigrationPackError('PACK_INVALID', `${location}.sha256 has invalid format.`);
  if (result.workflow_status !== 'archived' || result.lifecycle_state !== 'archived' || result.resume_requires_review !== false || (result.resume_review_reasons ?? '').trim()) {
    throw new MigrationPackError('PACK_INVALID', `${location} does not describe the required idle archived state.`);
  }
  return result;
}

function validateLegacyProtocolShape(value: unknown, location: string): LegacyProtocolSnapshot {
  const record = expectRecord(value, location);
  expectExactKeys(record, ['protocol_path', 'protocol_version', 'protocol_sha256', 'schema_path', 'schema_sha256', 'schema_id'], location);
  const result = {
    protocol_path: normalizeRepoPath(expectString(record.protocol_path, `${location}.protocol_path`), `${location}.protocol_path`),
    protocol_version: expectString(record.protocol_version, `${location}.protocol_version`),
    protocol_sha256: expectString(record.protocol_sha256, `${location}.protocol_sha256`),
    schema_path: normalizeRepoPath(expectString(record.schema_path, `${location}.schema_path`), `${location}.schema_path`),
    schema_sha256: expectString(record.schema_sha256, `${location}.schema_sha256`),
    schema_id: expectString(record.schema_id, `${location}.schema_id`),
  };
  if (!LEGACY_PROTOCOL_VERSION_PATTERN.test(result.protocol_version) || !/^[a-f0-9]{64}$/.test(result.protocol_sha256) || !/^[a-f0-9]{64}$/.test(result.schema_sha256)) {
    throw new MigrationPackError('PACK_INVALID', `${location} does not describe a supported legacy protocol/schema.`);
  }
  return result;
}

function validateSurfaceEntries(value: unknown, location: string): LegacySurfaceEntry[] {
  if (!Array.isArray(value)) throw new MigrationPackError('PACK_INVALID', `${location} must be a list`);
  const paths = new Set<string>();
  return value.map((raw, index) => {
    const record = expectRecord(raw, `${location}[${index}]`);
    expectExactKeys(record, ['path', 'sha256', 'source', 'action'], `${location}[${index}]`);
    const relativePath = normalizeRepoPath(expectString(record.path, `${location}[${index}].path`), `${location}[${index}].path`);
    if (paths.has(relativePath)) throw new MigrationPackError('PACK_INVALID', `${location} contains duplicate path ${relativePath}`);
    paths.add(relativePath);
    const checksum = record.sha256 === null ? null : expectString(record.sha256, `${location}[${index}].sha256`);
    if (checksum !== null && !/^[a-f0-9]{64}$/.test(checksum)) throw new MigrationPackError('PACK_INVALID', `${location}[${index}].sha256 has invalid format.`);
    const source = expectString(record.source, `${location}[${index}].source`);
    if (!['install-state', 'known-managed', 'host-scan', 'generated-scan'].includes(source)) throw new MigrationPackError('PACK_INVALID', `${location}[${index}].source is unsupported.`);
    const action = expectString(record.action, `${location}[${index}].action`);
    if (!['remove', 'replace'].includes(action)) throw new MigrationPackError('PACK_INVALID', `${location}[${index}].action is unsupported.`);
    return { path: relativePath, sha256: checksum, source: source as LegacySurfaceEntry['source'], action: action as LegacySurfaceEntry['action'] };
  });
}

function validateArtifactShape(value: unknown, location: string): MigrationArtifact {
  const record = expectRecord(value, location);
  expectExactKeys(record, ['stable_id', 'kind', 'source_path', 'target_path', 'content_path', 'original_content_path', 'canonical_schema_version', 'conversion_rule', 'source_sha256', 'content_sha256', 'byte_length', 'path_references', 'provenance'], location);
  const stableId = expectString(record.stable_id, `${location}.stable_id`);
  if (!STABLE_ID_PATTERN.test(stableId)) throw new MigrationPackError('PACK_INVALID', `${location}.stable_id is invalid.`);
  const kind = expectString(record.kind, `${location}.kind`);
  if (!['governance-document', 'project-profile', 'task-archive', 'target-owned-preserved'].includes(kind)) throw new MigrationPackError('PACK_INVALID', `${location}.kind is unsupported.`);
  const sourcePath = normalizeRepoPath(expectString(record.source_path, `${location}.source_path`), `${location}.source_path`);
  const targetPath = normalizeRepoPath(expectString(record.target_path, `${location}.target_path`), `${location}.target_path`);
  const contentPath = normalizeRepoPath(expectString(record.content_path, `${location}.content_path`), `${location}.content_path`);
  const originalContentPath = normalizeRepoPath(expectString(record.original_content_path, `${location}.original_content_path`), `${location}.original_content_path`);
  if ([VNEXT_INSTALL_STATE_RELATIVE_PATH, VNEXT_MIGRATION_RECEIPT_RELATIVE_PATH, VNEXT_MIGRATION_IN_PROGRESS_RELATIVE_PATH].includes(targetPath)) {
    throw new MigrationPackError('PACK_INVALID', `${location}.target_path cannot own Migration Pack state: ${targetPath}`);
  }
  if (
    KNOWN_HOST_SKILL_DIRS.some(prefix => targetPath === prefix || targetPath.startsWith(`${prefix}/`)) ||
    targetPath.endsWith('/SKILL_REGISTRY.md') ||
    targetPath === 'SKILL_REGISTRY.md'
  ) {
    throw new MigrationPackError('PACK_INVALID', `${location}.target_path cannot preserve a legacy host or registry surface: ${targetPath}`);
  }
  const expectedStableId = `artifact-${sha256(`${kind}\0${sourcePath}\0${expectString(record.source_sha256, `${location}.source_sha256`)}`).slice(0, 24)}`;
  if (stableId !== expectedStableId) throw new MigrationPackError('PACK_INVALID', `${location}.stable_id is not derived from kind/source_path/source_sha256.`);
  if (contentPath !== `artifacts/${stableId}.content`) throw new MigrationPackError('PACK_INVALID', `${location}.content_path must match its stable_id.`);
  if (originalContentPath !== `originals/${stableId}.source`) throw new MigrationPackError('PACK_INVALID', `${location}.original_content_path must match its stable_id.`);
  if (!contentPath.startsWith('artifacts/')) throw new MigrationPackError('PACK_INVALID', `${location}.content_path must stay under artifacts/.`);
  if (!originalContentPath.startsWith('originals/')) throw new MigrationPackError('PACK_INVALID', `${location}.original_content_path must stay under originals/.`);
  if (record.canonical_schema_version !== VNEXT_CANONICAL_DOCUMENT_SCHEMA_VERSION) throw new MigrationPackError('PACK_INVALID', `${location}.canonical_schema_version is unsupported.`);
  const conversionRule = expectString(record.conversion_rule, `${location}.conversion_rule`);
  if (conversionRule !== VNEXT_CANONICAL_CONVERSION_RULE) throw new MigrationPackError('PACK_INVALID', `${location}.conversion_rule must be ${VNEXT_CANONICAL_CONVERSION_RULE}.`);
  const sourceSha = expectString(record.source_sha256, `${location}.source_sha256`);
  const contentSha = expectString(record.content_sha256, `${location}.content_sha256`);
  if (!/^[a-f0-9]{64}$/.test(sourceSha) || !/^[a-f0-9]{64}$/.test(contentSha)) throw new MigrationPackError('PACK_INVALID', `${location} checksum fields are invalid.`);
  if (typeof record.byte_length !== 'number' || !Number.isInteger(record.byte_length) || record.byte_length < 0) throw new MigrationPackError('PACK_INVALID', `${location}.byte_length must be a non-negative integer.`);
  const pathReferences = validatePathReferenceList(record.path_references, `${location}.path_references`);
  const provenance = expectRecord(record.provenance, `${location}.provenance`);
  expectExactKeys(provenance, ['source_revision', 'source_tree_hash', 'legacy_source_revision', 'legacy_source_tree_hash', 'source_path', 'source_sha256', 'conversion_rule'], `${location}.provenance`);
  const provenanceConversionRule = expectString(provenance.conversion_rule, `${location}.provenance.conversion_rule`);
  if (provenanceConversionRule !== VNEXT_CANONICAL_CONVERSION_RULE) throw new MigrationPackError('PACK_INVALID', `${location}.provenance.conversion_rule must be ${VNEXT_CANONICAL_CONVERSION_RULE}.`);
  const provenanceSourceRevision = expectString(provenance.source_revision, `${location}.provenance.source_revision`);
  const provenanceSourceTreeHash = expectString(provenance.source_tree_hash, `${location}.provenance.source_tree_hash`);
  const legacySourceRevision = expectString(provenance.legacy_source_revision, `${location}.provenance.legacy_source_revision`);
  const legacySourceTreeHash = expectString(provenance.legacy_source_tree_hash, `${location}.provenance.legacy_source_tree_hash`);
  const provenanceSourceSha = expectString(provenance.source_sha256, `${location}.provenance.source_sha256`);
  if (!/^[a-f0-9]{64}$/.test(provenanceSourceTreeHash) || !/^[a-f0-9]{64}$/.test(legacySourceTreeHash) || provenanceSourceSha !== sourceSha) {
    throw new MigrationPackError('PACK_INVALID', `${location}.provenance hash binding is invalid.`);
  }
  if (normalizeRepoPath(expectString(provenance.source_path, `${location}.provenance.source_path`), `${location}.provenance.source_path`) !== sourcePath) {
    throw new MigrationPackError('PACK_INVALID', `${location}.provenance.source_path must match source_path.`);
  }
  return {
    stable_id: stableId,
    kind: kind as MigrationArtifactKind,
    source_path: sourcePath,
    target_path: targetPath,
    content_path: contentPath,
    original_content_path: originalContentPath,
    canonical_schema_version: VNEXT_CANONICAL_DOCUMENT_SCHEMA_VERSION,
    conversion_rule: VNEXT_CANONICAL_CONVERSION_RULE,
    source_sha256: sourceSha,
    content_sha256: contentSha,
    byte_length: record.byte_length,
    path_references: pathReferences,
    provenance: {
      source_revision: provenanceSourceRevision,
      source_tree_hash: provenanceSourceTreeHash,
      legacy_source_revision: legacySourceRevision,
      legacy_source_tree_hash: legacySourceTreeHash,
      source_path: sourcePath,
      source_sha256: provenanceSourceSha,
      conversion_rule: VNEXT_CANONICAL_CONVERSION_RULE,
    },
  };
}

function loadAndValidatePack(packDir: string): MigrationPackManifest {
  const manifestPath = path.join(path.resolve(packDir), MIGRATION_PACK_FILE);
  if (!fs.existsSync(manifestPath)) throw new MigrationPackError('PACK_INVALID', `Migration Pack manifest is missing: ${manifestPath}`);
  const raw = parseStrictJson(manifestPath);
  expectExactKeys(raw, ['schema_version', 'kind', 'pack_id', 'status', 'created_at', 'source', 'target', 'legacy_source', 'legacy_protocol', 'preflight', 'conversion', 'artifacts', 'legacy_surface', 'installation'], 'migration pack');
  if (raw.schema_version !== MIGRATION_PACK_SCHEMA_VERSION || raw.kind !== MIGRATION_PACK_KIND || raw.status !== 'validated') throw new MigrationPackError('PACK_INVALID', 'Migration Pack schema/kind/status is unsupported.');
  const packId = expectString(raw.pack_id, 'migration pack.pack_id');
  if (!/^migration-[a-f0-9]{24}$/.test(packId)) throw new MigrationPackError('PACK_INVALID', 'Migration Pack pack_id is invalid.');
  const source = validateSourceIdentityShape(raw.source, 'migration pack.source');
  const target = validateTargetIdentityShape(raw.target, 'migration pack.target');
  const legacySource = validateTargetSnapshotShape(raw.legacy_source, 'migration pack.legacy_source');
  const legacyProtocol = validateLegacyProtocolShape(raw.legacy_protocol, 'migration pack.legacy_protocol');
  const preflight = expectRecord(raw.preflight, 'migration pack.preflight');
  expectExactKeys(preflight, ['state', 'current_task', 'current_task_excluded', 'checked_at'], 'migration pack.preflight');
  if (preflight.state !== 'idle' || preflight.current_task_excluded !== true) throw new MigrationPackError('PACK_INVALID', 'Migration Pack preflight must be idle and exclude CURRENT_TASK from conversion.');
  const currentTask = validateCurrentTaskSnapshot(preflight.current_task, 'migration pack.preflight.current_task');
  const conversion = expectRecord(raw.conversion, 'migration pack.conversion');
  expectExactKeys(conversion, ['mode', 'preserves_original_text', 'semantic_reinterpretation', 'allowed_surfaces', 'issues'], 'migration pack.conversion');
  if (conversion.mode !== 'offline-structural' || conversion.preserves_original_text !== true || conversion.semantic_reinterpretation !== false) throw new MigrationPackError('PACK_INVALID', 'Migration Pack conversion must be structural, preserve original text, and avoid semantic reinterpretation.');
  expectStringArray(conversion.allowed_surfaces, 'migration pack.conversion.allowed_surfaces');
  if (!Array.isArray(conversion.issues)) throw new MigrationPackError('PACK_INVALID', 'migration pack.conversion.issues must be a list.');
  const conversionIssues = conversion.issues.map((rawIssue, index) => {
    const issue = expectRecord(rawIssue, `migration pack.conversion.issues[${index}]`);
    const keys = Object.keys(issue);
    const unexpected = keys.filter(key => !['severity', 'code', 'message', 'path'].includes(key));
    const missing = ['severity', 'code', 'message'].filter(key => !(key in issue));
    if (unexpected.length > 0 || missing.length > 0) throw new MigrationPackError('PACK_INVALID', `migration pack.conversion.issues[${index}] keys mismatch.`);
    const severity = expectString(issue.severity, `migration pack.conversion.issues[${index}].severity`);
    if (!['error', 'warning'].includes(severity)) throw new MigrationPackError('PACK_INVALID', `migration pack.conversion.issues[${index}].severity is unsupported.`);
    const code = expectString(issue.code, `migration pack.conversion.issues[${index}].code`);
    const message = expectString(issue.message, `migration pack.conversion.issues[${index}].message`);
    const issuePath = issue.path === undefined ? undefined : expectString(issue.path, `migration pack.conversion.issues[${index}].path`);
    return { severity: severity as MigrationIssueSeverity, code: code as MigrationIssueCode, message, ...(issuePath ? { path: issuePath } : {}) };
  });
  if (conversionIssues.some(issue => issue.severity === 'error')) {
    throw new MigrationPackError('PACK_INVALID', 'Migration Pack contains unresolved conversion errors.');
  }
  const artifactsRaw = raw.artifacts;
  if (!Array.isArray(artifactsRaw) || artifactsRaw.length === 0) throw new MigrationPackError('PACK_INVALID', 'migration pack.artifacts must be a non-empty list.');
  const artifactIds = new Set<string>();
  const artifactTargets = new Set<string>();
  const artifacts = artifactsRaw.map((item, index) => {
    const artifact = validateArtifactShape(item, `migration pack.artifacts[${index}]`);
    if (artifactIds.has(artifact.stable_id)) throw new MigrationPackError('PACK_INVALID', `duplicate artifact stable_id ${artifact.stable_id}`);
    if (artifactTargets.has(artifact.target_path)) throw new MigrationPackError('PACK_INVALID', `duplicate artifact target_path ${artifact.target_path}`);
    artifactIds.add(artifact.stable_id);
    artifactTargets.add(artifact.target_path);
    const contentPath = resolveRepoPath(packDir, artifact.content_path, `migration pack.artifacts[${index}].content_path`);
    const originalContentPath = resolveRepoPath(packDir, artifact.original_content_path, `migration pack.artifacts[${index}].original_content_path`);
    if (!fs.existsSync(contentPath)) throw new MigrationPackError('PACK_INVALID', `artifact content is missing: ${artifact.content_path}`);
    if (!fs.existsSync(originalContentPath)) throw new MigrationPackError('PACK_INVALID', `original artifact content is missing: ${artifact.original_content_path}`);
    const content = fs.readFileSync(contentPath);
    const originalContent = fs.readFileSync(originalContentPath);
    if (sha256(content) !== artifact.content_sha256 || content.byteLength !== artifact.byte_length) throw new MigrationPackError('PACK_INVALID', `canonical artifact checksum/length mismatch: ${artifact.target_path}`);
    if (sha256(originalContent) !== artifact.source_sha256) throw new MigrationPackError('PACK_INVALID', `original artifact checksum mismatch: ${artifact.target_path}`);
    if (artifact.target_path === currentTask.path || artifact.target_path === legacyProtocol.protocol_path || artifact.target_path === legacyProtocol.schema_path) throw new MigrationPackError('PACK_INVALID', `Migration Pack must not convert CURRENT_TASK/protocol/schema directly: ${artifact.target_path}`);
    if (artifact.provenance.source_revision !== source.revision || artifact.provenance.source_tree_hash !== source.tree_hash || artifact.provenance.legacy_source_revision !== legacySource.revision || artifact.provenance.legacy_source_tree_hash !== legacySource.tree_hash) {
      throw new MigrationPackError('PACK_INVALID', `artifact provenance does not bind to the pack source/legacy snapshot: ${artifact.target_path}`);
    }
    validateCanonicalArtifactContent(artifact, content.toString('utf8'), originalContent.toString('utf8'), legacyProtocol.protocol_version, legacySource, `migration pack.artifacts[${index}]`);
    return artifact;
  });
  const legacySurfaceRaw = expectRecord(raw.legacy_surface, 'migration pack.legacy_surface');
  expectExactKeys(legacySurfaceRaw, ['entries', 'legacy_skill_names'], 'migration pack.legacy_surface');
  const legacySurfaceEntries = validateSurfaceEntries(legacySurfaceRaw.entries, 'migration pack.legacy_surface.entries');
  const legacySkillNames = expectStringArray(legacySurfaceRaw.legacy_skill_names, 'migration pack.legacy_surface.legacy_skill_names', true);
  const installation = expectRecord(raw.installation, 'migration pack.installation');
  expectExactKeys(installation, ['requires_vnext_bundle', 'install_state_path', 'migration_receipt_path', 'in_progress_path', 'old_current_task_replaced_by_bundle', 'old_protocol_and_schema_replaced_by_bundle', 'old_compatibility_surface_removed'], 'migration pack.installation');
  if (installation.requires_vnext_bundle !== true || installation.old_current_task_replaced_by_bundle !== true || installation.old_protocol_and_schema_replaced_by_bundle !== true || installation.old_compatibility_surface_removed !== true) throw new MigrationPackError('PACK_INVALID', 'Migration Pack installation boundary is incomplete.');
  if (normalizeRepoPath(expectString(installation.install_state_path, 'migration pack.installation.install_state_path'), 'install_state_path') !== VNEXT_INSTALL_STATE_RELATIVE_PATH) throw new MigrationPackError('PACK_INVALID', 'Migration Pack install_state_path is not canonical.');
  if (normalizeRepoPath(expectString(installation.migration_receipt_path, 'migration pack.installation.migration_receipt_path'), 'migration_receipt_path') !== VNEXT_MIGRATION_RECEIPT_RELATIVE_PATH) throw new MigrationPackError('PACK_INVALID', 'Migration Pack migration_receipt_path is not canonical.');
  if (normalizeRepoPath(expectString(installation.in_progress_path, 'migration pack.installation.in_progress_path'), 'in_progress_path') !== VNEXT_MIGRATION_IN_PROGRESS_RELATIVE_PATH) throw new MigrationPackError('PACK_INVALID', 'Migration Pack in_progress_path is not canonical.');
  const base = {
    schema_version: MIGRATION_PACK_SCHEMA_VERSION,
    kind: MIGRATION_PACK_KIND,
    source,
    target,
    legacy_source: legacySource,
    legacy_protocol: legacyProtocol,
    preflight: { state: 'idle' as const, current_task: currentTask, current_task_excluded: true as const, checked_at: expectString(preflight.checked_at, 'migration pack.preflight.checked_at') },
    conversion: { mode: 'offline-structural' as const, preserves_original_text: true as const, semantic_reinterpretation: false as const, allowed_surfaces: expectStringArray(conversion.allowed_surfaces, 'migration pack.conversion.allowed_surfaces'), issues: conversionIssues },
    artifacts,
    legacy_surface: { entries: legacySurfaceEntries, legacy_skill_names: legacySkillNames },
    installation: {
      requires_vnext_bundle: true as const,
      install_state_path: VNEXT_INSTALL_STATE_RELATIVE_PATH,
      migration_receipt_path: VNEXT_MIGRATION_RECEIPT_RELATIVE_PATH,
      in_progress_path: VNEXT_MIGRATION_IN_PROGRESS_RELATIVE_PATH,
      old_current_task_replaced_by_bundle: true as const,
      old_protocol_and_schema_replaced_by_bundle: true as const,
      old_compatibility_surface_removed: true as const,
    },
  };
  const expectedId = packIdFor(base);
  if (packId !== expectedId) throw new MigrationPackError('PACK_INVALID', 'Migration Pack pack_id does not match its deterministic identity.');
  return { ...base, pack_id: packId, status: 'validated', created_at: expectString(raw.created_at, 'migration pack.created_at') };
}

export function validateMigrationPack(options: ValidatePackOptions): MigrationPackManifest {
  const pack = loadAndValidatePack(options.packDir);
  const sourceRoot = path.resolve(options.sourceRoot ?? pack.source.root_path);
  validateSourceIdentity(pack.source, getSourceIdentity(sourceRoot), 'Migration Pack source');
  const targetRoot = path.resolve(options.targetRoot ?? pack.target.root_path);
  const targetIdentity = validateTargetIdentityShape(pack.target, 'Migration Pack target');
  const actualProfilePath = profilePath(targetRoot);
  if (!fs.existsSync(actualProfilePath)) {
    throw new MigrationPackError('PACK_STALE', 'Target PROJECT_PROFILE.yaml is missing after conversion.');
  }
  let actualProfile: JsonObject;
  try {
    actualProfile = parseStrictYaml(actualProfilePath) as JsonObject;
  } catch (error) {
    throw new MigrationPackError('PACK_STALE', `Target PROJECT_PROFILE.yaml is no longer valid: ${error instanceof Error ? error.message : String(error)}`);
  }
  let actualTargetIdentity: TargetIdentity;
  try {
    actualTargetIdentity = getProjectIdentity(actualProfile, targetRoot);
  } catch (error) {
    throw new MigrationPackError('PACK_STALE', `Target PROJECT_PROFILE.yaml no longer contains a valid project identity: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (targetIdentity.root_identity !== actualTargetIdentity.root_identity) throw new MigrationPackError('PACK_STALE', 'Migration Pack target identity does not match target PROJECT_PROFILE.yaml.');
  const artifactTargets = new Set(pack.artifacts.map(artifact => artifact.target_path));
  const requiredTargets = [
    '.workflow-system/PROJECT_PROFILE.yaml',
    ...requiredDocumentPaths(targetRoot, actualProfile).map(filePath => path.relative(targetRoot, filePath).replace(/\\/g, '/')),
  ];
  for (const requiredTarget of requiredTargets) {
    if (!artifactTargets.has(requiredTarget)) throw new MigrationPackError('PACK_INVALID', `Migration Pack is missing required converted artifact: ${requiredTarget}`);
  }
  const preflight = preflightMigration({ sourceRoot, targetRoot });
  if (!preflight.eligible || !preflight.current_task || !preflight.target || !preflight.target_snapshot) throw new MigrationPackError('PACK_STALE', 'Target is no longer an eligible idle old project.', preflight.blockers);
  if (preflight.current_task.sha256 !== pack.preflight.current_task.sha256) throw new MigrationPackError('PACK_STALE', 'CURRENT_TASK.md changed after conversion.');
  if (preflight.source.revision !== pack.source.revision || preflight.source.tree_hash !== pack.source.tree_hash) throw new MigrationPackError('PACK_STALE', 'Source revision/tree changed after conversion.');
  if (preflight.target_snapshot.revision !== pack.legacy_source.revision || preflight.target_snapshot.tree_hash !== pack.legacy_source.tree_hash) throw new MigrationPackError('PACK_STALE', 'Legacy target source revision/tree changed after conversion.');
  for (const artifact of pack.artifacts) {
    const sourcePath = resolveRepoPath(targetRoot, artifact.source_path, `artifact ${artifact.stable_id}.source_path`);
    if (!fs.existsSync(sourcePath) || readSha256(sourcePath) !== artifact.source_sha256) throw new MigrationPackError('PACK_STALE', `Converted source changed: ${artifact.source_path}`);
  }
  for (const entry of pack.legacy_surface.entries) {
    const fullPath = resolveRepoPath(targetRoot, entry.path, `legacy surface ${entry.path}`);
    if (entry.sha256 === null ? fs.existsSync(fullPath) : !fs.existsSync(fullPath) || readSha256(fullPath) !== entry.sha256) throw new MigrationPackError('PACK_STALE', `Legacy installation surface changed: ${entry.path}`);
  }
  return pack;
}

function validateBundleArtifactShape(value: unknown, location: string): VNextBundleArtifact {
  const record = expectRecord(value, location);
  expectExactKeys(record, ['source_path', 'target_path', 'category', 'required', 'checksum'], location);
  const sourcePath = normalizeRepoPath(expectString(record.source_path, `${location}.source_path`), `${location}.source_path`);
  const targetPath = normalizeRepoPath(expectString(record.target_path, `${location}.target_path`), `${location}.target_path`);
  const category = expectString(record.category, `${location}.category`);
  if (!['protocol', 'schema', 'skill', 'registry', 'runtime', 'generated', 'config'].includes(category)) throw new MigrationPackError('BUNDLE_INVALID', `${location}.category is unsupported.`);
  const checksum = expectString(record.checksum, `${location}.checksum`);
  if (!/^[a-f0-9]{64}$/.test(checksum)) throw new MigrationPackError('BUNDLE_INVALID', `${location}.checksum is invalid.`);
  return { source_path: sourcePath, target_path: targetPath, category: category as VNextBundleArtifact['category'], required: expectBoolean(record.required, `${location}.required`), checksum };
}

const BUNDLE_ENTRY_MODES: Record<string, readonly string[]> = {
  'prepare-task': ['default', 'confirm', 'replan'],
  'review-change': ['default', 'report-only'],
  'execute-step': ['default', 'repair'],
  'debug-task': ['investigate-only', 'resolve'],
  'task-lifecycle': ['pause', 'interrupt', 'resume-paused', 'resume-interrupted', 'supersede'],
  'capture-work-item': [],
  'close-task': ['preview'],
  'bootstrap-project': ['design', 'greenfield', 'inventory', 'adopt', 'realign'],
  'validate-change': [],
};
const BUNDLE_ENTRY_OUTPUT_KINDS: Record<string, string> = {
  'prepare-task': 'prepared-task',
  'review-change': 'report',
  'execute-step': 'change-result',
  'debug-task': 'debug-result',
  'task-lifecycle': 'lifecycle-result',
  'capture-work-item': 'capture-result',
  'close-task': 'closure-result',
  'bootstrap-project': 'bootstrap-result',
  'validate-change': 'validation-result',
};
const BUNDLE_ENTRY_AUTHORITY_OWNERS: Record<string, string> = {
  'prepare-task': 'user',
  'review-change': 'none',
  'execute-step': 'task',
  'debug-task': 'task',
  'task-lifecycle': 'task',
  'capture-work-item': 'none',
  'close-task': 'task',
  'bootstrap-project': 'user',
  'validate-change': 'none',
};
const BUNDLE_ENTRY_RUNTIME_OPERATIONS: Record<string, readonly string[]> = {
  'prepare-task': ['task-state-transaction'],
  'review-change': [],
  'execute-step': ['task-state-transaction', 'finding-queue-transaction'],
  'debug-task': ['task-state-transaction'],
  'task-lifecycle': ['lifecycle-transaction'],
  'capture-work-item': ['inbox-record-transaction'],
  'close-task': ['project-status-transaction', 'archive-transaction', 'lesson-record-transaction', 'contract-candidate-commit', 'decision-record-transaction'],
  'bootstrap-project': ['contract-candidate-commit', 'decision-record-transaction', 'project-status-transaction', 'paired-host-guidance-transaction'],
  'validate-change': [],
};
const BUNDLE_REQUIRED_ENTRY_CAPABILITIES: Record<string, readonly string[]> = {
  'execute-step': ['source-authority-policy', 'task-identity-guard', 'adaptive-depth-policy'],
  'validate-change': ['project-context-resolver', 'evidence-admission-policy', 'adaptive-depth-policy', 'diff-target-resolver', 'read-only-review-guard', 'owner-route-resolver'],
};

const BUNDLE_CURRENT_TASK_HEADINGS = ['## 任务信息', '## 验收标准', '## 允许修改范围', '## 实施步骤'];
const BUNDLE_CURRENT_TASK_FIELDS = ['任务 ID', '任务 slug', '当前状态', '生命周期状态', '恢复需审查', '恢复审查原因'];

function readBundleFrontmatter(content: string, location: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
  if (!match) throw new MigrationPackError('BUNDLE_INVALID', `${location} is missing a YAML frontmatter block.`);
  const document = parseDocument(match[1], { uniqueKeys: true });
  const diagnostics = [...document.errors, ...document.warnings];
  if (diagnostics.length > 0) throw new MigrationPackError('BUNDLE_INVALID', `${location} has invalid frontmatter YAML: ${diagnostics.map(item => item.message).join('; ')}`);
  return { frontmatter: expectRecord(document.toJS(), `${location} frontmatter`), body: match[2] };
}

function validateVNextSkillBundleContent(entry: string, content: string, location: string): void {
  const { frontmatter } = readBundleFrontmatter(content, location);
  if (entry === 'validate-change' && content.includes('validate-change:regression')) {
    throw new MigrationPackError('BUNDLE_INVALID', `${location} restores the legacy validate-change:regression mode.`);
  }
  expectExactKeys(frontmatter, ['entry_contract'], `${location} frontmatter`);
  const contract = expectRecord(frontmatter.entry_contract, `${location}.entry_contract`);
  expectExactKeys(contract, ['entry', 'mode', 'intent', 'input_contract', 'authority_owner', 'mutation_boundary', 'internal_capabilities', 'runtime_operations', 'stop_conditions', 'output_kind'], `${location}.entry_contract`);
  if (contract.entry !== entry) throw new MigrationPackError('BUNDLE_INVALID', `${location}.entry_contract.entry must be ${entry}.`);
  const modes = expectStringArray(contract.mode, `${location}.entry_contract.mode`, true);
  const expectedModes = BUNDLE_ENTRY_MODES[entry];
  if (!expectedModes || JSON.stringify([...modes].sort()) !== JSON.stringify([...expectedModes].sort())) throw new MigrationPackError('BUNDLE_INVALID', `${location}.entry_contract.mode is not the canonical closed set for ${entry}.`);
  if (modes.includes('discovery') || modes.includes('verification')) throw new MigrationPackError('BUNDLE_INVALID', `${location} promotes review cycle phases into modes.`);
  expectString(contract.intent, `${location}.entry_contract.intent`);
  const input = expectRecord(contract.input_contract, `${location}.entry_contract.input_contract`);
  const inputKeys = entry === 'review-change' ? ['required', 'optional', 'cycle_phase'] : ['required', 'optional'];
  expectExactKeys(input, inputKeys, `${location}.entry_contract.input_contract`);
  const requiredInputs = expectStringArray(input.required, `${location}.entry_contract.input_contract.required`);
  const optionalInputs = expectStringArray(input.optional, `${location}.entry_contract.input_contract.optional`, true);
  if (entry === 'validate-change') {
    if (JSON.stringify([...requiredInputs].sort()) !== JSON.stringify(['validation_target'])) {
      throw new MigrationPackError('BUNDLE_INVALID', `${location}.entry_contract.input_contract.required is not the canonical validate-change set.`);
    }
    const expectedOptionalInputs = [
      'changed_paths',
      'diff_target',
      'expected_behavior',
      'existing_evidence',
      'requested_evidence',
      'environment_context',
      'caller_context',
    ];
    if (JSON.stringify([...optionalInputs].sort()) !== JSON.stringify([...expectedOptionalInputs].sort())) {
      throw new MigrationPackError('BUNDLE_INVALID', `${location}.entry_contract.input_contract.optional is not the canonical validate-change set.`);
    }
  }
  if (entry === 'review-change') {
    expectStringArray(input.cycle_phase, `${location}.entry_contract.input_contract.cycle_phase`);
    if (JSON.stringify([...input.cycle_phase as string[]].sort()) !== JSON.stringify(['discovery', 'verification'])) throw new MigrationPackError('BUNDLE_INVALID', `${location} has an invalid review cycle phase set.`);
  }
  if (contract.authority_owner !== BUNDLE_ENTRY_AUTHORITY_OWNERS[entry]) {
    throw new MigrationPackError('BUNDLE_INVALID', `${location}.entry_contract.authority_owner must be ${BUNDLE_ENTRY_AUTHORITY_OWNERS[entry]}.`);
  }
  const boundary = expectRecord(contract.mutation_boundary, `${location}.entry_contract.mutation_boundary`);
  expectExactKeys(boundary, ['product_files', 'governance_sources', 'forbidden_targets'], `${location}.mutation_boundary`);
  expectStringArray(boundary.product_files, `${location}.mutation_boundary.product_files`, true);
  expectStringArray(boundary.governance_sources, `${location}.mutation_boundary.governance_sources`, true);
  expectStringArray(boundary.forbidden_targets, `${location}.mutation_boundary.forbidden_targets`);
  const productFiles = boundary.product_files as string[];
  const governanceSources = boundary.governance_sources as string[];
  const expectedProductFiles = entry === 'execute-step' ? ['admitted_scope'] : [];
  if (JSON.stringify([...productFiles].sort()) !== JSON.stringify(expectedProductFiles)) {
    throw new MigrationPackError('BUNDLE_INVALID', `${location}.mutation_boundary.product_files is not valid for ${entry}.`);
  }
  if (governanceSources.length > 0) {
    throw new MigrationPackError('BUNDLE_INVALID', `${location}.mutation_boundary.governance_sources must be empty.`);
  }
  const capabilityRefs = expectStringArray(contract.internal_capabilities, `${location}.entry_contract.internal_capabilities`);
  for (const requiredCapability of BUNDLE_REQUIRED_ENTRY_CAPABILITIES[entry] ?? []) {
    if (!capabilityRefs.includes(requiredCapability)) {
      throw new MigrationPackError('BUNDLE_INVALID', `${location}.entry_contract must declare mandatory capability ${requiredCapability}.`);
    }
  }
  const runtimeOperations = expectStringArray(contract.runtime_operations, `${location}.entry_contract.runtime_operations`, true);
  const expectedRuntimeOperations = BUNDLE_ENTRY_RUNTIME_OPERATIONS[entry] ?? [];
  if (JSON.stringify([...runtimeOperations].sort()) !== JSON.stringify([...expectedRuntimeOperations].sort())) {
    throw new MigrationPackError('BUNDLE_INVALID', `${location}.entry_contract.runtime_operations is not valid for ${entry}.`);
  }
  if (entry === 'review-change' && runtimeOperations.length !== 0) {
    throw new MigrationPackError('BUNDLE_INVALID', `${location}.review-change must not declare Runtime operations.`);
  }
  expectStringArray(contract.stop_conditions, `${location}.entry_contract.stop_conditions`);
  if (contract.output_kind !== BUNDLE_ENTRY_OUTPUT_KINDS[entry]) {
    throw new MigrationPackError('BUNDLE_INVALID', `${location}.entry_contract.output_kind must be ${BUNDLE_ENTRY_OUTPUT_KINDS[entry]}.`);
  }
  for (const forbidden of ['stage', 'handoff', 'conditional_handoff', 'benefits-from']) {
    if (forbidden in frontmatter || new RegExp(`^\\s*${forbidden}\\s*:`, 'im').test(content)) {
      throw new MigrationPackError('BUNDLE_INVALID', `${location} contains forbidden legacy field ${forbidden}.`);
    }
  }
}

function validateVNextProtocolBundleContent(content: string, location: string): void {
  if (/Protocol-Version\s*:\s*0\./i.test(content) || !VNEXT_SCHEMA_VERSION_PATTERN.test(content) || !/^\s*kind\s*:\s*vnext-protocol\s*$/im.test(content)) {
    throw new MigrationPackError('BUNDLE_INVALID', `${location} is not an explicit vNext protocol document.`);
  }
}

function validateVNextSchemaBundleContent(content: string, location: string): void {
  if (/Protocol-Version\s*:\s*0\./i.test(content) || !VNEXT_SCHEMA_VERSION_PATTERN.test(content) || !/^\s*kind\s*:\s*vnext-file-schema\s*$/im.test(content) || !/CURRENT_TASK\.md/i.test(content)) {
    throw new MigrationPackError('BUNDLE_INVALID', `${location} is not an explicit vNext File Schema document.`);
  }
}

function validateVNextCurrentTaskBundleContent(content: string, location: string): void {
  const { frontmatter, body } = readBundleFrontmatter(content, location);
  const frontmatterKeys = Object.keys(frontmatter);
  const unexpectedFrontmatterKeys = frontmatterKeys.filter(key => !['schema_version', 'kind', 'document_id', 'runtime_state'].includes(key));
  if (unexpectedFrontmatterKeys.length > 0) throw new MigrationPackError('BUNDLE_INVALID', `${location} frontmatter contains unsupported keys: ${unexpectedFrontmatterKeys.join(', ')}.`);
  for (const requiredKey of ['schema_version', 'kind', 'document_id']) {
    if (!(requiredKey in frontmatter)) throw new MigrationPackError('BUNDLE_INVALID', `${location} frontmatter is missing ${requiredKey}.`);
  }
  if (frontmatter.schema_version !== VNEXT_CANONICAL_DOCUMENT_SCHEMA_VERSION || frontmatter.kind !== 'vnext-current-task' || typeof frontmatter.document_id !== 'string' || !DOCUMENT_ID_PATTERN.test(frontmatter.document_id)) {
    throw new MigrationPackError('BUNDLE_INVALID', `${location} does not declare the vNext current-task schema.`);
  }
  let runtimeState: ReturnType<typeof validateVNextRuntimeState> | undefined;
  if ('runtime_state' in frontmatter) {
    try {
      runtimeState = validateVNextRuntimeState(frontmatter.runtime_state);
    } catch (error) {
      throw new MigrationPackError('BUNDLE_INVALID', `${location}.runtime_state is invalid: ${error instanceof Error ? error.message : String(error)}.`);
    }
  }
  for (const heading of BUNDLE_CURRENT_TASK_HEADINGS) {
    if (!body.includes(heading)) throw new MigrationPackError('BUNDLE_INVALID', `${location} is missing required heading ${heading}.`);
  }
  for (const field of BUNDLE_CURRENT_TASK_FIELDS) {
    if (!new RegExp(`^\\s*-\\s*${field}\\s*[：:]`, 'm').test(body)) throw new MigrationPackError('BUNDLE_INVALID', `${location} is missing required task field ${field}.`);
  }
  if (runtimeState) {
    try {
      const identity = extractTaskIdentityFromCurrentTask(body);
      const bodyState = extractCurrentTaskStateFromCurrentTask(body);
      if (identity.id !== runtimeState.task_id || identity.slug !== runtimeState.task_slug) {
        throw new Error('body task identity conflicts with runtime_state.');
      }
      if (bodyState.workflowStatus !== runtimeState.workflow_status || bodyState.lifecycleState !== runtimeState.lifecycle_state) {
        throw new Error('body lifecycle tuple conflicts with runtime_state.');
      }
      const bodyResumeReviewReasons = bodyState.resumeReviewReasons
        ? bodyState.resumeReviewReasons.split(',').map(reason => reason.trim()).filter(Boolean)
        : [];
      if (bodyState.resumeRequiresReview !== runtimeState.resume_requires_review
        || JSON.stringify(bodyResumeReviewReasons) !== JSON.stringify(runtimeState.resume_review_reasons)) {
        throw new Error('body resume-review gate conflicts with runtime_state.');
      }
    } catch (error) {
      throw new MigrationPackError('BUNDLE_INVALID', `${location} body/runtime_state consistency check failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (/Protocol-Version\s*:\s*0\./i.test(body)) throw new MigrationPackError('BUNDLE_INVALID', `${location} still embeds legacy protocol metadata.`);
}


const REQUIRED_RUNTIME_BUNDLE_TARGETS = [
  VNEXT_RUNTIME_ENTRYPOINT_RELATIVE_PATH,
  VNEXT_RUNTIME_PACKAGE_MANIFEST_RELATIVE_PATH,
  VNEXT_RUNTIME_LOCKFILE_RELATIVE_PATH,
  '.workflow-system/runtime/src/cli.ts',
  '.workflow-system/runtime/src/current-task.ts',
  '.workflow-system/runtime/src/task-state-transaction.ts',
  '.workflow-system/runtime/src/finding-queue-transaction.ts',
  '.workflow-system/runtime/src/kernel.ts',
  '.workflow-system/runtime/src/runtime-io.ts',
  '.workflow-system/runtime/src/task-identity.ts',
  '.workflow-system/runtime/src/bootstrap.ts',
] as const;

function parseRuntimeBundleJson(content: string, location: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new MigrationPackError('BUNDLE_INVALID', location + ' is not valid JSON: ' + (error instanceof Error ? error.message : String(error)));
  }
  return expectRecord(parsed, location);
}

function validateRuntimePackageBundleContent(content: string, location: string): void {
  const packageManifest = parseRuntimeBundleJson(content, location);
  if (packageManifest.name !== VNEXT_RUNTIME_PACKAGE_NAME || packageManifest.version !== VNEXT_RUNTIME_PACKAGE_VERSION || packageManifest.private !== true || packageManifest.type !== 'module') {
    throw new MigrationPackError('BUNDLE_INVALID', location + ' must declare the canonical private Node Runtime package identity.');
  }
  const engines = expectRecord(packageManifest.engines, location + '.engines');
  if (engines.node !== VNEXT_RUNTIME_NODE_MIN_VERSION) throw new MigrationPackError('BUNDLE_INVALID', location + '.engines.node does not match the Runtime contract.');
  const dependencies = expectRecord(packageManifest.dependencies, location + '.dependencies');
  if (dependencies.yaml !== '2.8.3') throw new MigrationPackError('BUNDLE_INVALID', location + '.dependencies.yaml must pin 2.8.3.');
}

function validateRuntimeLockfileBundleContent(content: string, location: string): void {
  const lockfile = parseRuntimeBundleJson(content, location);
  if (lockfile.name !== VNEXT_RUNTIME_PACKAGE_NAME || lockfile.version !== VNEXT_RUNTIME_PACKAGE_VERSION || lockfile.lockfileVersion !== 3) {
    throw new MigrationPackError('BUNDLE_INVALID', location + ' has an invalid Runtime lockfile identity.');
  }
  const packages = expectRecord(lockfile.packages, location + '.packages');
  const rootPackage = expectRecord(packages[''], location + '.packages[""]');
  if (rootPackage.version !== VNEXT_RUNTIME_PACKAGE_VERSION) throw new MigrationPackError('BUNDLE_INVALID', location + ' root package version does not match the Runtime package.');
  const yamlPackage = expectRecord(packages['node_modules/yaml'], location + '.packages[node_modules/yaml]');
  if (yamlPackage.version !== '2.8.3') throw new MigrationPackError('BUNDLE_INVALID', location + ' must lock yaml to 2.8.3.');
}

function validateRuntimeEntrypointBundleContent(content: string, location: string): void {
  if (!content.includes('vnext-runtime-proposal') || !content.includes('runCli')) {
    throw new MigrationPackError('BUNDLE_INVALID', location + ' is not the generated vNext Runtime Node entrypoint.');
  }
}

function validateVNextBundleArtifactContent(artifact: VNextBundleArtifact, content: string, location: string): void {
  const isRuntimeContract = artifact.target_path === '.workflow-system/vnext/RUNTIME_CONTRACT.yaml';
  if (artifact.category === 'protocol' && !isRuntimeContract) validateVNextProtocolBundleContent(content, location);
  if (artifact.category === 'schema') validateVNextSchemaBundleContent(content, location);
  if (artifact.category === 'skill') {
    const entry = canonicalVNextSkillEntry(artifact.target_path);
    if (!entry || !(entry in BUNDLE_ENTRY_MODES)) throw new MigrationPackError('BUNDLE_INVALID', `${location} targets an unknown vNext Skill entry.`);
    validateVNextSkillBundleContent(entry, content, location);
  }
  if (artifact.category === 'runtime' && artifact.target_path === VNEXT_RUNTIME_ENTRYPOINT_RELATIVE_PATH) validateRuntimeEntrypointBundleContent(content, location);
  if (artifact.category === 'runtime' && artifact.target_path === VNEXT_RUNTIME_PACKAGE_MANIFEST_RELATIVE_PATH) validateRuntimePackageBundleContent(content, location);
  if (artifact.category === 'runtime' && artifact.target_path === VNEXT_RUNTIME_LOCKFILE_RELATIVE_PATH) validateRuntimeLockfileBundleContent(content, location);
  if (artifact.target_path === '.workflow-system/vnext/RUNTIME_CONTRACT.yaml') {
    if (artifact.category !== 'protocol') throw new MigrationPackError('BUNDLE_INVALID', `${location} Runtime contract must be a protocol artifact.`);
    const parsed = parseDocument(content, { uniqueKeys: true });
    const diagnostics = [...parsed.errors, ...parsed.warnings];
    if (diagnostics.length > 0 || !expectRecord(parsed.toJS(), location).operations) throw new MigrationPackError('BUNDLE_INVALID', `${location} is not a valid Phase 2 Runtime contract.`);
  }
  if (artifact.target_path.endsWith('/CURRENT_TASK.md') && artifact.category !== 'protocol' && artifact.category !== 'schema') validateVNextCurrentTaskBundleContent(content, location);
  if (artifact.target_path === '.workflow-system/PROJECT_PROFILE.yaml') {
    const parsed = parseDocument(content, { uniqueKeys: true });
    const diagnostics = [...parsed.errors, ...parsed.warnings];
    if (diagnostics.length > 0 || !expectRecord(parsed.toJS(), location).project) throw new MigrationPackError('BUNDLE_INVALID', `${location} is not a valid vNext project profile.`);
  }
}

function validateSourceContractIfPresent(sourceRoot: string): void {
  const contractPath = path.join(sourceRoot, '.workflow-system', 'vnext', 'SOURCE_CONTRACT.yaml');
  if (!fs.existsSync(contractPath)) return;
  try {
    validateVNextSource(sourceRoot);
  } catch (error) {
    throw new MigrationPackError('BUNDLE_INVALID', `vNext source contract is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function sourceDeclaresPhase2Runtime(sourceRoot: string): boolean {
  const contractPath = path.join(sourceRoot, '.workflow-system', 'vnext', 'SOURCE_CONTRACT.yaml');
  if (!fs.existsSync(contractPath)) return false;
  const parsed = parseDocument(fs.readFileSync(contractPath, 'utf8'), { uniqueKeys: true });
  return parsed.errors.length === 0 && parsed.toJS()?.phase === 'Phase 2';
}

function loadAndValidateBundle(
  bundleDir: string,
  sourceRoot: string,
  legacySkillNames: readonly string[],
  portable = false,
): VNextBundleManifest {
  validateSourceContractIfPresent(sourceRoot);
  const manifestPath = path.join(path.resolve(bundleDir), VNEXT_BUNDLE_FILE);
  if (!fs.existsSync(manifestPath)) throw new MigrationPackError('BUNDLE_INVALID', `vNext bundle manifest is missing: ${manifestPath}`);
  let raw: Record<string, unknown>;
  try {
    raw = parseStrictJson(manifestPath);
  } catch (error) {
    if (error instanceof MigrationPackError) throw new MigrationPackError('BUNDLE_INVALID', error.message);
    throw error;
  }
  expectExactKeys(raw, ['schema_version', 'kind', 'bundle_id', 'status', 'legacy_compatibility', 'source', 'artifacts'], 'vNext bundle');
  if (raw.schema_version !== VNEXT_BUNDLE_SCHEMA_VERSION || raw.kind !== VNEXT_BUNDLE_KIND || raw.status !== 'validated' || raw.legacy_compatibility !== 'absent') throw new MigrationPackError('BUNDLE_INVALID', 'vNext bundle must be a validated pure-vNext bundle with no compatibility surface.');
  const bundleId = expectString(raw.bundle_id, 'vNext bundle.bundle_id');
  if (!/^bundle-[a-f0-9]{24}$/.test(bundleId)) throw new MigrationPackError('BUNDLE_INVALID', 'vNext bundle.bundle_id is invalid.');
  const source = validateSourceIdentityShape(raw.source, 'vNext bundle.source');
  validateSourceIdentity(source, getSourceIdentity(sourceRoot), 'vNext bundle source', portable);
  if (!Array.isArray(raw.artifacts) || raw.artifacts.length === 0) throw new MigrationPackError('BUNDLE_INVALID', 'vNext bundle.artifacts must be non-empty.');
  const artifacts: VNextBundleArtifact[] = [];
  const paths = new Set<string>();
  const categories = new Set<string>();
  for (const [index, item] of raw.artifacts.entries()) {
    const artifact = validateBundleArtifactShape(item, `vNext bundle.artifacts[${index}]`);
    if (paths.has(artifact.target_path)) throw new MigrationPackError('BUNDLE_INVALID', `duplicate vNext bundle target path ${artifact.target_path}`);
    paths.add(artifact.target_path);
    categories.add(artifact.category);
    const fullPath = resolveRepoPath(bundleDir, artifact.source_path, `vNext bundle artifact ${artifact.source_path}`);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) throw new MigrationPackError('BUNDLE_INVALID', `vNext bundle artifact is missing: ${artifact.source_path}`);
    if (readSha256(fullPath) !== artifact.checksum) throw new MigrationPackError('BUNDLE_INVALID', `vNext bundle artifact checksum mismatch: ${artifact.source_path}`);
    const content = fs.readFileSync(fullPath, 'utf8');
    validateVNextBundleArtifactContent(artifact, content, `vNext bundle.artifacts[${index}]`);
    const lowerPath = artifact.target_path.toLowerCase();
    const pathParts = lowerPath.split('/');
    if ([...VNEXT_FORBIDDEN_PATH_PARTS].some(part => pathParts.some(pathPart => pathPart === part || pathPart.startsWith(`${part}-`) || pathPart.startsWith(`${part}_`)))) throw new MigrationPackError('BUNDLE_INVALID', `vNext bundle target path contains a compatibility surface: ${artifact.target_path}`);
    if (VNEXT_FORBIDDEN_TARGET_PREFIXES.some(prefix => lowerPath.startsWith(prefix))) throw new MigrationPackError('BUNDLE_INVALID', `vNext bundle target path is an old source/generated surface: ${artifact.target_path}`);
    const runtimeNodeModulesPrefix = `${VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH}/node_modules/`;
    if (lowerPath === VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH + '/node_modules' || lowerPath.startsWith(runtimeNodeModulesPrefix)) throw new MigrationPackError('BUNDLE_INVALID', 'Runtime node_modules is generated by npm ci and must not be included in the vNext source bundle.');
    if (artifact.category === 'runtime' && artifact.target_path === 'scripts/vnext-runtime.ts') throw new MigrationPackError('BUNDLE_INVALID', 'vNext bundle must not install the source-repository Runtime wrapper.');
    if (artifact.target_path === VNEXT_INSTALL_STATE_RELATIVE_PATH || artifact.target_path === VNEXT_MIGRATION_RECEIPT_RELATIVE_PATH || artifact.target_path === VNEXT_MIGRATION_IN_PROGRESS_RELATIVE_PATH) {
      throw new MigrationPackError('BUNDLE_INVALID', `vNext bundle must not own Migration Pack state: ${artifact.target_path}`);
    }
    if (artifact.category === 'skill') {
      const skillEntry = canonicalVNextSkillEntry(artifact.target_path);
      if (!skillEntry) {
        throw new MigrationPackError('BUNDLE_INVALID', `vNext Skill target must use the canonical .agents/skills/<skill-name>/SKILL.md surface: ${artifact.target_path}`);
      }
      if (skillEntry.startsWith('workflow-system-')) throw new MigrationPackError('BUNDLE_INVALID', `vNext Skill target must use a canonical unprefixed entry directory: ${artifact.target_path}`);
    }
    for (const legacyName of legacySkillNames) {
      // These two names are canonical vNext entries. Their unprefixed Skill
      // artifact and declaration are not legacy compatibility routes; every
      // other legacy ID remains forbidden.
      const canonicalVNextEntry = (legacyName === 'capture-work-item' || legacyName === 'validate-change') &&
        ((artifact.category === 'skill' && canonicalVNextSkillEntry(artifact.target_path) === legacyName) ||
          (legacyName === 'capture-work-item' && artifact.category === 'registry'));
      if (artifact.target_path.includes(legacyName) && !canonicalVNextEntry) throw new MigrationPackError('BUNDLE_INVALID', `vNext bundle contains legacy Skill ID ${legacyName}.`);
      if ((artifact.category === 'skill' || artifact.category === 'registry') && content.includes(legacyName)) {
        if (!canonicalVNextEntry || (artifact.category === 'registry' && legacyName !== 'capture-work-item')) {
          if (!canonicalVNextEntry) throw new MigrationPackError('BUNDLE_INVALID', `vNext bundle contains legacy Skill ID ${legacyName}.`);
        } else {
          const executableCanonicalLines = content.split(/\r?\n/).filter(line => line.includes(legacyName));
          if (executableCanonicalLines.some(line =>
            !new RegExp(`^\\s*entry:\\s*${legacyName}\\s*$`).test(line) &&
            !new RegExp(`^# vNext Skill:\\s*${legacyName}\\s*$`).test(line) &&
            !(legacyName === 'capture-work-item' && line.includes('capture-work-item:record'))
          )) {
            throw new MigrationPackError('BUNDLE_INVALID', `vNext bundle contains legacy Skill ID ${legacyName} outside its canonical entry declaration.`);
          }
        }
      }
    }
    artifacts.push(artifact);
  }
  const sortedArtifacts = [...artifacts].sort((left, right) => left.target_path.localeCompare(right.target_path));
  if (JSON.stringify(artifacts) !== JSON.stringify(sortedArtifacts)) throw new MigrationPackError('BUNDLE_INVALID', 'vNext bundle artifacts must be sorted by target_path for deterministic replay.');
  const expectedBundleId = `bundle-${sha256(JSON.stringify({ source, artifacts })).slice(0, 24)}`;
  if (bundleId !== expectedBundleId) throw new MigrationPackError('BUNDLE_INVALID', 'vNext bundle.bundle_id does not match its deterministic source/artifact identity.');
  for (const category of VNEXT_REQUIRED_BUNDLE_CATEGORIES) {
    if (!categories.has(category)) throw new MigrationPackError('BUNDLE_INVALID', `vNext bundle is missing required category ${category}.`);
  }
  const protocolArtifacts = artifacts.filter(
    artifact => artifact.category === 'protocol' && artifact.target_path !== '.workflow-system/vnext/RUNTIME_CONTRACT.yaml',
  );
  const schemaArtifacts = artifacts.filter(artifact => artifact.category === 'schema');
  if (protocolArtifacts.length !== 1 || protocolArtifacts[0]?.target_path !== '.workflow-system/WORKFLOW_PROTOCOL.md' || protocolArtifacts[0]?.required !== true) {
    throw new MigrationPackError('BUNDLE_INVALID', 'vNext bundle must contain exactly one protocol artifact at .workflow-system/WORKFLOW_PROTOCOL.md.');
  }
  if (schemaArtifacts.length !== 1 || schemaArtifacts[0]?.target_path !== '.workflow-system/FILE_SCHEMAS.md' || schemaArtifacts[0]?.required !== true) {
    throw new MigrationPackError('BUNDLE_INVALID', 'vNext bundle must contain exactly one schema artifact at .workflow-system/FILE_SCHEMAS.md.');
  }
  const currentTaskArtifacts = artifacts.filter(artifact => artifact.target_path === 'CURRENT_TASK.md' || artifact.target_path.endsWith('/CURRENT_TASK.md'));
  if (currentTaskArtifacts.length !== 1 || currentTaskArtifacts[0]?.required !== true) {
    throw new MigrationPackError('BUNDLE_INVALID', 'vNext bundle must contain exactly one required canonical CURRENT_TASK.md artifact.');
  }
  if (['protocol', 'schema', 'skill', 'registry'].includes(currentTaskArtifacts[0].category)) {
    throw new MigrationPackError('BUNDLE_INVALID', 'CURRENT_TASK.md must be a document artifact, not a protocol, schema, Skill, or registry artifact.');
  }
  if (sourceDeclaresPhase2Runtime(sourceRoot)) {
    const runtimeArtifacts = artifacts.filter(artifact => artifact.category === 'runtime');
    for (const requiredTarget of REQUIRED_RUNTIME_BUNDLE_TARGETS) {
      const runtimeArtifact = runtimeArtifacts.find(artifact => artifact.target_path === requiredTarget);
      if (!runtimeArtifact || runtimeArtifact.required !== true) throw new MigrationPackError('BUNDLE_INVALID', 'Phase 2 vNext bundles must include required Runtime artifact ' + requiredTarget + '.');
    }
    const runtimeContractArtifacts = artifacts.filter(artifact => artifact.category === 'protocol' && artifact.target_path === '.workflow-system/vnext/RUNTIME_CONTRACT.yaml');
    const runtimeContract = runtimeContractArtifacts[0];
    if (runtimeContractArtifacts.length !== 1 || !runtimeContract || runtimeContract.required !== true) {
      throw new MigrationPackError('BUNDLE_INVALID', 'Phase 2 vNext bundles must include exactly one RUNTIME_CONTRACT.yaml.');
    }
    const currentTaskContent = readBundleContent(bundleDir, currentTaskArtifacts[0]);
    const { frontmatter: currentTaskFrontmatter } = readBundleFrontmatter(currentTaskContent, currentTaskArtifacts[0].source_path);
    if (!('runtime_state' in currentTaskFrontmatter)) {
      throw new MigrationPackError('BUNDLE_INVALID', 'Phase 2 vNext bundles must include runtime_state in the canonical CURRENT_TASK frontmatter.');
    }
    const runtimeValidationRoot = fs.mkdtempSync(path.join(os.tmpdir(), '.workflow-vnext-runtime-bundle-'));
    try {
      const writeRuntimeArtifact = (targetPath: string): void => {
        const artifact = artifacts.find(item => item.target_path === targetPath);
        if (!artifact) throw new MigrationPackError('BUNDLE_INVALID', 'Missing Runtime artifact ' + targetPath + '.');
        const sourcePath = resolveRepoPath(bundleDir, artifact.source_path, 'Runtime artifact ' + targetPath);
        const destination = resolveRepoPath(runtimeValidationRoot, targetPath, 'Runtime validation artifact ' + targetPath);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(sourcePath, destination);
      };
      writeRuntimeArtifact('.workflow-system/vnext/RUNTIME_CONTRACT.yaml');
      writeRuntimeArtifact(VNEXT_RUNTIME_ENTRYPOINT_RELATIVE_PATH);
      writeRuntimeArtifact(VNEXT_RUNTIME_PACKAGE_MANIFEST_RELATIVE_PATH);
      writeRuntimeArtifact(VNEXT_RUNTIME_LOCKFILE_RELATIVE_PATH);
      try {
        validateVNextRuntimeContract(runtimeValidationRoot);
      } catch (error) {
        throw new MigrationPackError('BUNDLE_INVALID', 'Phase 2 Runtime contract is invalid: ' + (error instanceof Error ? error.message : String(error)) + '.');
      }
    } finally {
      fs.rmSync(runtimeValidationRoot, { recursive: true, force: true });
    }
  }
  const skillNames = new Set(
    artifacts
      .filter(artifact => artifact.category === 'skill')
      .map(artifact => canonicalVNextSkillEntry(artifact.target_path)),
  );
  if (skillNames.size !== artifacts.filter(artifact => artifact.category === 'skill').length) throw new MigrationPackError('BUNDLE_INVALID', 'vNext bundle must not expose duplicate Skill entry IDs in the canonical surface.');
  for (const entry of VNEXT_REQUIRED_DAILY_ENTRIES) {
    const skill = artifacts.find(artifact => artifact.category === 'skill' && artifact.target_path === canonicalVNextSkillTarget(entry));
    if (!skill || !skillNames.has(entry) || skill.required !== true) throw new MigrationPackError('BUNDLE_INVALID', `vNext bundle is missing required daily entry Skill ${entry}/SKILL.md.`);
  }
  for (const entry of VNEXT_REQUIRED_EXPERT_ENTRIES) {
    const skill = artifacts.find(artifact => artifact.category === 'skill' && artifact.target_path === canonicalVNextSkillTarget(entry));
    if (!skill || !skillNames.has(entry) || skill.required !== true) throw new MigrationPackError('BUNDLE_INVALID', `vNext bundle is missing required expert entry Skill ${entry}/SKILL.md.`);
  }
  if (sourceDeclaresPhase2Runtime(sourceRoot)) {
    for (const entry of VNEXT_REQUIRED_ADMIN_ENTRIES) {
      const skill = artifacts.find(artifact => artifact.category === 'skill' && artifact.target_path === canonicalVNextSkillTarget(entry));
      if (!skill || !skillNames.has(entry) || skill.required !== true) throw new MigrationPackError('BUNDLE_INVALID', `Phase 2 vNext bundle is missing required administrative Skill ${entry}/SKILL.md.`);
    }
  }
  return { schema_version: VNEXT_BUNDLE_SCHEMA_VERSION, kind: VNEXT_BUNDLE_KIND, bundle_id: bundleId, status: 'validated', legacy_compatibility: 'absent', source, artifacts };
}

function asBundleError(error: unknown): MigrationPackError | null {
  if (!(error instanceof MigrationPackError)) return null;
  if (error.code === 'BUNDLE_INVALID') return error;
  return new MigrationPackError('BUNDLE_INVALID', error.message, error.issues);
}

export function buildVNextBundle(options: {
  sourceRoot?: string;
  bundleDir: string;
  artifacts: Array<{ source_path: string; target_path: string; category: VNextBundleArtifact['category']; required?: boolean }>;
}): VNextBundleManifest {
  const sourceRoot = path.resolve(options.sourceRoot ?? resolveRoot());
  const bundleDir = path.resolve(options.bundleDir);
  if (isWithinRoot(sourceRoot, bundleDir)) {
    throw new MigrationPackError('UNSAFE_PATH', 'vNext bundle output directory must be outside the source root so its identity snapshot remains stable.');
  }
  if (fs.existsSync(bundleDir) && listFiles(bundleDir).length > 0) throw new MigrationPackError('OUTPUT_DIR_NOT_EMPTY', `vNext bundle output directory is not empty: ${bundleDir}`);
  fs.mkdirSync(bundleDir, { recursive: true });
  const source = getSourceIdentity(sourceRoot);
  const artifacts: VNextBundleArtifact[] = [];
  for (const spec of options.artifacts) {
    const sourcePath = normalizeRepoPath(spec.source_path, 'vNext bundle source_path');
    const targetPath = normalizeRepoPath(spec.target_path, 'vNext bundle target_path');
    const inputPath = resolveRepoPath(sourceRoot, sourcePath, 'vNext bundle source_path');
    if (!fs.existsSync(inputPath) || !fs.statSync(inputPath).isFile()) throw new MigrationPackError('BUNDLE_INVALID', `vNext bundle source does not exist: ${sourcePath}`);
    const outputPath = resolveRepoPath(bundleDir, sourcePath, 'vNext bundle source_path');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.copyFileSync(inputPath, outputPath);
    artifacts.push({ source_path: sourcePath, target_path: targetPath, category: spec.category, required: spec.required ?? true, checksum: readSha256(outputPath) });
  }
  artifacts.sort((left, right) => left.target_path.localeCompare(right.target_path));
  const bundleId = `bundle-${sha256(JSON.stringify({ source, artifacts })).slice(0, 24)}`;
  const manifest: VNextBundleManifest = { schema_version: 1, kind: VNEXT_BUNDLE_KIND, bundle_id: bundleId, status: 'validated', legacy_compatibility: 'absent', source, artifacts };
  fs.writeFileSync(path.join(bundleDir, VNEXT_BUNDLE_FILE), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return loadAndValidateBundle(bundleDir, sourceRoot, mergeLegacySkillNames(sourceRoot, []));
}

/**
 * Validate a prebuilt vNext bundle without exposing the private evaluator to
 * the Distribution layer.  `portable` is reserved for release payloads: the
 * content/revision identity stays bound, while the package cache path is
 * allowed to differ between build and install machines.
 */
export function validateVNextBundle(options: {
  bundleDir: string;
  sourceRoot?: string;
  legacySkillNames?: readonly string[];
  portable?: boolean;
}): VNextBundleManifest {
  const sourceRoot = path.resolve(options.sourceRoot ?? resolveRoot());
  const legacySkillNames = options.legacySkillNames ?? mergeLegacySkillNames(sourceRoot, []);
  return loadAndValidateBundle(path.resolve(options.bundleDir), sourceRoot, legacySkillNames, options.portable === true);
}

function readBundleContent(bundleDir: string, artifact: VNextBundleArtifact): string {
  return fs.readFileSync(resolveRepoPath(bundleDir, artifact.source_path, 'vNext bundle source path'), 'utf8');
}


export type PreparedRuntimeDistribution = {
  sourceNodeModulesPath: string;
  targetNodeModulesPath: string;
  identity: RuntimeDistributionIdentity;
  stagingRoot: string;
};

export function prepareRuntimeDistribution(bundleDir: string, artifacts: readonly VNextBundleArtifact[]): PreparedRuntimeDistribution {
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), '.workflow-vnext-runtime-stage-'));
  try {
    const stageRoot = path.join(stagingRoot, 'project');
    const runtimeDirectory = path.join(stageRoot, ...VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH.split('/'));
    const requiredTargets = [
      VNEXT_RUNTIME_ENTRYPOINT_RELATIVE_PATH,
      VNEXT_RUNTIME_PACKAGE_MANIFEST_RELATIVE_PATH,
      VNEXT_RUNTIME_LOCKFILE_RELATIVE_PATH,
      '.workflow-system/runtime/src/cli.ts',
      '.workflow-system/runtime/src/current-task.ts',
      '.workflow-system/runtime/src/task-state-transaction.ts',
      '.workflow-system/runtime/src/finding-queue-transaction.ts',
      '.workflow-system/runtime/src/kernel.ts',
      '.workflow-system/runtime/src/runtime-io.ts',
      '.workflow-system/runtime/src/task-identity.ts',
      '.workflow-system/runtime/src/bootstrap.ts',
      '.workflow-system/vnext/RUNTIME_CONTRACT.yaml',
    ];
    for (const targetPath of requiredTargets) {
      const artifact = artifacts.find(item => item.target_path === targetPath);
      if (!artifact) throw new MigrationPackError('BUNDLE_INVALID', 'Missing Runtime staging artifact: ' + targetPath);
      const sourcePath = resolveRepoPath(bundleDir, artifact.source_path, 'Runtime staging source');
      const destination = resolveRepoPath(stageRoot, targetPath, 'Runtime staging target');
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(sourcePath, destination);
    }
    const nodeCommand = process.platform === 'win32' ? 'node.exe' : 'node';
    let nodeVersion: string;
    try {
      nodeVersion = execFileSync(nodeCommand, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().replace(/^v/, '');
    } catch (error) {
      throw new MigrationPackError('INSTALL_CONFLICT', 'Node.js is required for the project-local Runtime: ' + (error instanceof Error ? error.message : String(error)));
    }
    try {
      validateRuntimeEnvironment(nodeVersion, VNEXT_RUNTIME_NODE_MIN_VERSION);
    } catch (error) {
      throw new MigrationPackError('INSTALL_CONFLICT', error instanceof Error ? error.message : String(error));
    }
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    try {
      const npmArgs = ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'];
      const npmInvocation = process.platform === 'win32'
        ? [process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `${npmCommand} ${npmArgs.join(' ')}`]] as const
        : [npmCommand, npmArgs] as const;
      execFileSync(npmInvocation[0], npmInvocation[1], {
        cwd: runtimeDirectory,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NODE_PATH: undefined, npm_config_update_notifier: 'false' },
      });
    } catch (error) {
      const detail = error && typeof error === 'object' && 'stderr' in error ? String((error as { stderr?: unknown }).stderr ?? '') : '';
      throw new MigrationPackError('INSTALL_CONFLICT', 'Runtime dependency installation failed in staging: ' + (detail.trim() || (error instanceof Error ? error.message : String(error))));
    }
    const identity = validateVNextRuntimeContract(stageRoot, true).runtime_distribution;
    const entrypointPath = path.join(runtimeDirectory, 'dist', 'cli.js');
    try {
      execFileSync(nodeCommand, [entrypointPath, 'validate-contract', '--root', stageRoot], {
        cwd: stageRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NODE_PATH: undefined },
      });
    } catch (error) {
      const detail = error && typeof error === 'object' && 'stderr' in error ? String((error as { stderr?: unknown }).stderr ?? '') : '';
      throw new MigrationPackError('INSTALL_CONFLICT', 'Runtime self-check failed in staging: ' + (detail.trim() || (error instanceof Error ? error.message : String(error))));
    }
    return {
      sourceNodeModulesPath: path.join(runtimeDirectory, 'node_modules'),
      targetNodeModulesPath: VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH + '/node_modules',
      identity,
      stagingRoot,
    };
  } catch (error) {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

function validateNoLegacySurface(
  targetRoot: string,
  legacySkillNames: readonly string[],
  removedPaths: readonly string[],
  replacedPaths: readonly string[],
  workflowHome = 'docs/workflow',
): void {
  const replaced = new Set(replacedPaths);
  for (const relativePath of removedPaths) {
    if (replaced.has(relativePath)) continue;
    const fullPath = resolveRepoPath(targetRoot, relativePath, 'post-install legacy path');
    if (fs.existsSync(fullPath)) throw new MigrationPackError('POST_INSTALL_LEGACY_SURFACE', `Legacy path remains after pure vNext installation: ${relativePath}`);
  }
  for (const relativeDir of KNOWN_HOST_SKILL_DIRS) {
    const directory = path.join(targetRoot, ...relativeDir.split('/'));
    for (const filePath of listFiles(directory)) {
      const basename = path.basename(filePath);
      const parentName = path.basename(path.dirname(filePath));
      const isPrefixedLegacy = /^workflow-system-.+\.SKILL\.md$/.test(basename) || (basename === 'SKILL.md' && /^workflow-system-.+$/.test(parentName));
      const isFlatAlias = legacySkillNames.some(name => basename === `${name}.SKILL.md` || (basename === 'SKILL.md' && parentName === name));
      const relativePath = path.relative(targetRoot, filePath).replace(/\\/g, '/');
      if (!replaced.has(relativePath) && (isPrefixedLegacy || isFlatAlias)) throw new MigrationPackError('POST_INSTALL_LEGACY_SURFACE', `Legacy host Skill remains: ${relativePath}`);
    }
  }
  const generatedSkillDir = path.join(targetRoot, ...[workflowHome, 'generated', 'workflow-skills'].filter(Boolean).join('/').split('/'));
  for (const filePath of listFiles(generatedSkillDir)) {
    if (legacySkillNames.some(name => path.basename(filePath).includes(name))) throw new MigrationPackError('POST_INSTALL_LEGACY_SURFACE', `Legacy generated Skill remains: ${path.relative(targetRoot, filePath)}`);
  }
}

type AtomicWrite = { path: string; content: string };

function writeInProgressMarker(targetRoot: string, marker: VNextMigrationInProgress): void {
  const markerPath = resolveRepoPath(targetRoot, VNEXT_MIGRATION_IN_PROGRESS_RELATIVE_PATH, 'migration in-progress marker');
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  const tempPath = `${markerPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, markerPath);
}

function removeInProgressMarker(targetRoot: string): void {
  const markerPath = resolveRepoPath(targetRoot, VNEXT_MIGRATION_IN_PROGRESS_RELATIVE_PATH, 'migration in-progress marker');
  if (fs.existsSync(markerPath)) fs.rmSync(markerPath, { force: true });
}

function validateInProgressMarker(targetRoot: string): VNextMigrationInProgress {
  const markerPath = resolveRepoPath(targetRoot, VNEXT_MIGRATION_IN_PROGRESS_RELATIVE_PATH, 'migration in-progress marker');
  if (!fs.existsSync(markerPath)) throw new MigrationPackError('VNEXT_INSTALL_IN_PROGRESS', 'No vNext migration interruption marker is present.');
  const marker = parseStrictJson(markerPath);
  expectExactKeys(marker, ['schema_version', 'kind', 'migration_pack_id', 'bundle_id', 'target_identity', 'started_at', 'planned_writes', 'planned_deletes', 'recovery'], 'migration in-progress marker');
  if (marker.schema_version !== 1 || marker.kind !== 'vnext-migration-in-progress' || marker.recovery !== 'fail-closed-explicit-recovery') throw new MigrationPackError('VNEXT_INSTALL_IN_PROGRESS', 'Migration interruption marker is invalid; do not retry automatically.');
  const result: VNextMigrationInProgress = {
    schema_version: 1,
    kind: 'vnext-migration-in-progress',
    migration_pack_id: expectString(marker.migration_pack_id, 'migration in-progress marker.migration_pack_id'),
    bundle_id: expectString(marker.bundle_id, 'migration in-progress marker.bundle_id'),
    target_identity: expectString(marker.target_identity, 'migration in-progress marker.target_identity'),
    started_at: expectString(marker.started_at, 'migration in-progress marker.started_at'),
    planned_writes: expectStringArray(marker.planned_writes, 'migration in-progress marker.planned_writes', true),
    planned_deletes: expectStringArray(marker.planned_deletes, 'migration in-progress marker.planned_deletes', true),
    recovery: 'fail-closed-explicit-recovery',
  };
  return result;
}

function validateRuntimeDistributionIdentity(value: unknown, location: string): RuntimeDistributionIdentity | null {
  if (value === null) return null;
  const distribution = expectRecord(value, location);
  expectExactKeys(distribution, ['kind', 'package_path', 'entrypoint', 'package_version', 'node_min_version', 'package_lock_sha256', 'entrypoint_sha256'], location);
  const packageLockSha = expectString(distribution.package_lock_sha256, location + '.package_lock_sha256');
  const entrypointSha = expectString(distribution.entrypoint_sha256, location + '.entrypoint_sha256');
  if (!/^[a-f0-9]{64}$/.test(packageLockSha) || !/^[a-f0-9]{64}$/.test(entrypointSha)) {
    throw new MigrationPackError('INSTALL_CONFLICT', location + ' checksum fields are invalid.');
  }
  if (distribution.kind !== 'project-local-node' || distribution.package_path !== VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH || distribution.entrypoint !== VNEXT_RUNTIME_ENTRYPOINT_RELATIVE_PATH || distribution.package_version !== VNEXT_RUNTIME_PACKAGE_VERSION || distribution.node_min_version !== VNEXT_RUNTIME_NODE_MIN_VERSION) {
    throw new MigrationPackError('INSTALL_CONFLICT', location + ' does not declare the canonical Runtime distribution identity.');
  }
  return {
    kind: 'project-local-node',
    package_path: VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH,
    entrypoint: VNEXT_RUNTIME_ENTRYPOINT_RELATIVE_PATH,
    package_version: VNEXT_RUNTIME_PACKAGE_VERSION,
    node_min_version: VNEXT_RUNTIME_NODE_MIN_VERSION,
    package_lock_sha256: packageLockSha,
    entrypoint_sha256: entrypointSha,
  };
}

function validateVNextInstallState(value: unknown, location: string): VNextInstallState {
  const state = expectRecord(value, location);
  const legacyStateShape = 'mode' in state && !('distribution_state' in state);
  expectExactKeys(
    state,
    legacyStateShape
      ? ['schema_version', 'kind', 'mode', 'migration_pack_id', 'bundle_id', 'source_revision', 'source_tree_hash', 'target_identity', 'runtime_distribution', 'installed_at', 'managed_files', 'removed_legacy_files', 'legacy_compatibility', 'recovery_boundary']
      : ['schema_version', 'kind', 'distribution_state', 'distribution_version', 'migration_pack_id', 'bundle_id', 'source_revision', 'source_tree_hash', 'target_identity', 'runtime_distribution', 'installed_at', 'managed_files', 'removed_legacy_files', 'legacy_compatibility', 'recovery_boundary'],
    location,
  );
  if (
    state.schema_version !== 1
    || state.kind !== 'vnext-install-state'
    || (legacyStateShape ? state.mode !== 'pure-vnext' : state.distribution_state !== 'vnext')
    || state.legacy_compatibility !== 'absent'
    || state.recovery_boundary !== 'in-progress-marker'
  ) {
    throw new MigrationPackError('INSTALL_CONFLICT', `${location} is not a valid vNext install state.`);
  }
  const migrationPackId = expectString(state.migration_pack_id, `${location}.migration_pack_id`);
  const bundleId = expectString(state.bundle_id, `${location}.bundle_id`);
  if (!/^migration-[a-f0-9]{24}$/.test(migrationPackId) || !/^bundle-[a-f0-9]{24}$/.test(bundleId)) {
    throw new MigrationPackError('INSTALL_CONFLICT', `${location} has invalid migration or bundle identity.`);
  }
  const sourceRevision = expectString(state.source_revision, `${location}.source_revision`);
  const sourceTreeHash = expectString(state.source_tree_hash, `${location}.source_tree_hash`);
  const targetIdentity = expectString(state.target_identity, `${location}.target_identity`);
  const runtimeDistribution = validateRuntimeDistributionIdentity(state.runtime_distribution, `${location}.runtime_distribution`);
  if (!/^[a-f0-9]{64}$/.test(sourceTreeHash) || !/^[a-f0-9]{32}$/.test(targetIdentity)) {
    throw new MigrationPackError('INSTALL_CONFLICT', `${location} has invalid source/target identity fields.`);
  }
  const installedAt = expectString(state.installed_at, `${location}.installed_at`);
  if (!Array.isArray(state.managed_files)) throw new MigrationPackError('INSTALL_CONFLICT', `${location}.managed_files must be a list.`);
  const managedPaths = new Set<string>();
  const managedFiles = state.managed_files.map((raw, index) => {
    const item = expectRecord(raw, `${location}.managed_files[${index}]`);
    expectExactKeys(item, ['path', 'checksum', 'category'], `${location}.managed_files[${index}]`);
    const relativePath = normalizeRepoPath(expectString(item.path, `${location}.managed_files[${index}].path`), `${location}.managed_files[${index}].path`);
    if (managedPaths.has(relativePath)) throw new MigrationPackError('INSTALL_CONFLICT', `${location}.managed_files contains duplicate path ${relativePath}.`);
    managedPaths.add(relativePath);
    const checksum = item.checksum === '' ? '' : expectString(item.checksum, `${location}.managed_files[${index}].checksum`);
    if (!/^[a-f0-9]{64}$/.test(checksum) && !(relativePath === VNEXT_INSTALL_STATE_RELATIVE_PATH && checksum === '')) {
      throw new MigrationPackError('INSTALL_CONFLICT', `${location}.managed_files[${index}].checksum is invalid.`);
    }
    return { path: relativePath, checksum, category: expectString(item.category, `${location}.managed_files[${index}].category`) };
  });
  const removedLegacyFiles = expectStringArray(state.removed_legacy_files, `${location}.removed_legacy_files`, true).map((item, index) => normalizeRepoPath(item, `${location}.removed_legacy_files[${index}]`));
  if (new Set(removedLegacyFiles).size !== removedLegacyFiles.length) throw new MigrationPackError('INSTALL_CONFLICT', `${location}.removed_legacy_files contains duplicates.`);
  return {
    schema_version: 1,
    kind: 'vnext-install-state',
    distribution_state: 'vnext',
    distribution_version: legacyStateShape
      ? (state.runtime_distribution && typeof state.runtime_distribution === 'object' && !Array.isArray(state.runtime_distribution) && typeof (state.runtime_distribution as Record<string, unknown>).package_version === 'string'
        ? (state.runtime_distribution as Record<string, unknown>).package_version as string
        : 'unknown')
      : expectString(state.distribution_version, `${location}.distribution_version`),
    migration_pack_id: migrationPackId,
    bundle_id: bundleId,
    source_revision: sourceRevision,
    source_tree_hash: sourceTreeHash,
    target_identity: targetIdentity,
    runtime_distribution: runtimeDistribution,
    installed_at: installedAt,
    managed_files: managedFiles,
    removed_legacy_files: removedLegacyFiles,
    legacy_compatibility: 'absent',
    recovery_boundary: 'in-progress-marker',
  };
}

function validateVNextMigrationReceipt(value: unknown, location: string): { migration_pack_id: string; bundle_id: string; source_revision: string; source_tree_hash: string; target_identity: string; runtime_distribution: RuntimeDistributionIdentity | null; installed_at: string; converted_artifact_ids: string[] } {
  const receipt = expectRecord(value, location);
  expectExactKeys(receipt, ['schema_version', 'kind', 'migration_pack_id', 'bundle_id', 'source_revision', 'source_tree_hash', 'target_identity', 'runtime_distribution', 'installed_at', 'converted_artifact_ids', 'legacy_compatibility'], location);
  if (receipt.schema_version !== 1 || receipt.kind !== 'vnext-migration-receipt' || receipt.legacy_compatibility !== 'absent') {
    throw new MigrationPackError('INSTALL_CONFLICT', `${location} is not a pure-vNext migration receipt.`);
  }
  const migrationPackId = expectString(receipt.migration_pack_id, `${location}.migration_pack_id`);
  const bundleId = expectString(receipt.bundle_id, `${location}.bundle_id`);
  const sourceTreeHash = expectString(receipt.source_tree_hash, `${location}.source_tree_hash`);
  const targetIdentity = expectString(receipt.target_identity, `${location}.target_identity`);
  const runtimeDistribution = validateRuntimeDistributionIdentity(receipt.runtime_distribution, `${location}.runtime_distribution`);
  if (!/^migration-[a-f0-9]{24}$/.test(migrationPackId) || !/^bundle-[a-f0-9]{24}$/.test(bundleId) || !/^[a-f0-9]{64}$/.test(sourceTreeHash) || !/^[a-f0-9]{32}$/.test(targetIdentity)) {
    throw new MigrationPackError('INSTALL_CONFLICT', `${location} has invalid identity fields.`);
  }
  const convertedArtifactIds = expectStringArray(receipt.converted_artifact_ids, `${location}.converted_artifact_ids`, true);
  if (convertedArtifactIds.some(item => !STABLE_ID_PATTERN.test(item))) throw new MigrationPackError('INSTALL_CONFLICT', `${location}.converted_artifact_ids contains an invalid artifact ID.`);
  return {
    migration_pack_id: migrationPackId,
    bundle_id: bundleId,
    source_revision: expectString(receipt.source_revision, `${location}.source_revision`),
    source_tree_hash: sourceTreeHash,
    target_identity: targetIdentity,
    runtime_distribution: runtimeDistribution,
    installed_at: expectString(receipt.installed_at, `${location}.installed_at`),
    converted_artifact_ids: convertedArtifactIds,
  };
}

type AtomicDirectoryWrite = { path: string; sourcePath: string };

export function applyAtomicFileTransaction(
  targetRoot: string,
  writes: AtomicWrite[],
  deletes: string[],
  verify: () => void,
  directories: AtomicDirectoryWrite[] = [],
): void {
  const resolvedTargetRoot = path.resolve(targetRoot);
  const normalizedWrites = new Map<string, AtomicWrite>();
  for (const write of writes) {
    const relative = normalizeRepoPath(write.path, 'transaction write path');
    resolveRepoPath(resolvedTargetRoot, relative, 'transaction write path');
    if (normalizedWrites.has(relative)) throw new MigrationPackError('INSTALL_CONFLICT', 'duplicate transaction write path: ' + relative);
    normalizedWrites.set(relative, { path: relative, content: write.content });
  }
  const normalizedDirectories = new Map<string, AtomicDirectoryWrite>();
  for (const directory of directories) {
    const relative = normalizeRepoPath(directory.path, 'transaction directory path');
    resolveRepoPath(resolvedTargetRoot, relative, 'transaction directory path');
    if (!fs.existsSync(directory.sourcePath) || !fs.statSync(directory.sourcePath).isDirectory()) throw new MigrationPackError('INSTALL_CONFLICT', 'transaction directory source is missing: ' + directory.sourcePath);
    if (normalizedDirectories.has(relative) || normalizedWrites.has(relative)) throw new MigrationPackError('INSTALL_CONFLICT', 'duplicate transaction directory path: ' + relative);
    normalizedDirectories.set(relative, { path: relative, sourcePath: directory.sourcePath });
  }
  for (const directoryPath of normalizedDirectories.keys()) {
    for (const writePath of normalizedWrites.keys()) {
      if (writePath.startsWith(directoryPath + '/') || directoryPath.startsWith(writePath + '/')) throw new MigrationPackError('INSTALL_CONFLICT', 'transaction file and directory paths overlap: ' + directoryPath + ' / ' + writePath);
    }
  }
  const deleteSet = new Set<string>();
  for (const relativeValue of deletes) {
    const relative = normalizeRepoPath(relativeValue, 'transaction delete path');
    if (!normalizedWrites.has(relative) && !normalizedDirectories.has(relative)) deleteSet.add(relative);
  }
  const stagingRoot = fs.mkdtempSync(path.join(path.dirname(resolvedTargetRoot), '.workflow-vnext-migration-'));
  const staged = new Map<string, string>();
  const stagedDirectories = new Map<string, string>();
  const backups: Array<{ target: string; backup: string }> = [];
  const newlyWritten: string[] = [];
  try {
    for (const [relative, write] of normalizedWrites.entries()) {
      const tempPath = path.join(stagingRoot, 'staged', 'files', staged.size + '.tmp');
      fs.mkdirSync(path.dirname(tempPath), { recursive: true });
      fs.writeFileSync(tempPath, write.content, 'utf8');
      staged.set(relative, tempPath);
    }
    for (const [relative, directory] of normalizedDirectories.entries()) {
      const stagedPath = path.join(stagingRoot, 'staged', 'directories', stagedDirectories.size.toString());
      fs.mkdirSync(path.dirname(stagedPath), { recursive: true });
      fs.cpSync(directory.sourcePath, stagedPath, { recursive: true });
      stagedDirectories.set(relative, stagedPath);
    }
    const touched = [...new Set([...normalizedWrites.keys(), ...stagedDirectories.keys(), ...deleteSet])];
    for (const relative of touched) {
      const targetPath = resolveRepoPath(resolvedTargetRoot, relative, 'transaction target');
      if (!fs.existsSync(targetPath)) continue;
      const backupPath = path.join(stagingRoot, 'backup', backups.length + '.bak');
      fs.mkdirSync(path.dirname(backupPath), { recursive: true });
      fs.renameSync(targetPath, backupPath);
      backups.push({ target: targetPath, backup: backupPath });
    }
    for (const [relative, tempPath] of staged.entries()) {
      const targetPath = resolveRepoPath(resolvedTargetRoot, relative, 'transaction target');
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.renameSync(tempPath, targetPath);
      newlyWritten.push(targetPath);
    }
    for (const [relative, stagedPath] of stagedDirectories.entries()) {
      const targetPath = resolveRepoPath(resolvedTargetRoot, relative, 'transaction target');
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.renameSync(stagedPath, targetPath);
      newlyWritten.push(targetPath);
    }
    verify();
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  } catch (error) {
    for (const targetPath of newlyWritten.reverse()) {
      if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { recursive: true, force: true });
    }
    for (const entry of backups.reverse()) {
      if (fs.existsSync(entry.target)) fs.rmSync(entry.target, { recursive: true, force: true });
      if (fs.existsSync(entry.backup)) {
        fs.mkdirSync(path.dirname(entry.target), { recursive: true });
        fs.renameSync(entry.backup, entry.target);
      }
    }
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

export function installMigrationPack(options: InstallPackOptions): MigrationOperationResult {
  const sourceRoot = path.resolve(options.sourceRoot ?? resolveRoot());
  const targetRoot = path.resolve(options.targetRoot);
  const blockers: MigrationIssue[] = [];
  const warnings: MigrationIssue[] = [];
  const guard = checkTargetRoot(sourceRoot, targetRoot);
  if (!guard.allowed) {
    return { status: 'rejected', target_root: targetRoot, blockers: [{ severity: 'error', code: 'TARGET_ROOT_DENIED', message: guard.message, path: targetRoot }], warnings, planned_writes: [], planned_deletes: [] };
  }

  const existingStatePath = path.join(targetRoot, ...VNEXT_INSTALL_STATE_RELATIVE_PATH.split('/'));
  const existingInProgressPath = path.join(targetRoot, ...VNEXT_MIGRATION_IN_PROGRESS_RELATIVE_PATH.split('/'));
  if (!fs.existsSync(existingStatePath) && fs.existsSync(existingInProgressPath)) {
    try {
      const marker = validateInProgressMarker(targetRoot);
      return {
        status: 'rejected',
        target_root: targetRoot,
        pack_id: marker.migration_pack_id,
        bundle_id: marker.bundle_id,
        blockers: [{ severity: 'error', code: 'VNEXT_INSTALL_IN_PROGRESS', message: 'An interrupted vNext installation is recorded; inspect the marker and recover explicitly before retrying.', path: VNEXT_MIGRATION_IN_PROGRESS_RELATIVE_PATH }],
        warnings,
        planned_writes: marker.planned_writes,
        planned_deletes: marker.planned_deletes,
      };
    } catch (error) {
      const issue = error instanceof MigrationPackError ? { severity: 'error' as const, code: 'VNEXT_INSTALL_IN_PROGRESS' as const, message: error.message, path: VNEXT_MIGRATION_IN_PROGRESS_RELATIVE_PATH } : { severity: 'error' as const, code: 'VNEXT_INSTALL_IN_PROGRESS' as const, message: String(error), path: VNEXT_MIGRATION_IN_PROGRESS_RELATIVE_PATH };
      return { status: 'rejected', target_root: targetRoot, blockers: [issue], warnings, planned_writes: [], planned_deletes: [] };
    }
  }
  if (fs.existsSync(existingStatePath)) {
    try {
      // A completed installation is deliberately no longer an old project,
      // so the normal stale-source preflight cannot be used for replay.  Read
      // and validate the pack/bundle identity first, then verify the existing
      // vNext marker as an exact no-op.
      const candidatePack = loadAndValidatePack(options.packDir);
      validateSourceIdentity(candidatePack.source, getSourceIdentity(sourceRoot), 'Migration Pack source');
      const candidateTarget = validateTargetIdentityShape(candidatePack.target, 'Migration Pack target');
      const actualTarget = getProjectIdentity(parseStrictYaml(profilePath(targetRoot)) as JsonObject, targetRoot);
      const existing = validateVNextInstallState(parseStrictJson(existingStatePath), 'vNext install state');
      const receiptPath = path.join(targetRoot, ...VNEXT_MIGRATION_RECEIPT_RELATIVE_PATH.split('/'));
      if (!fs.existsSync(receiptPath)) throw new MigrationPackError('INSTALL_CONFLICT', 'Completed vNext installation is missing its migration receipt.');
      const receipt = validateVNextMigrationReceipt(parseStrictJson(receiptPath), 'vNext migration receipt');
      const samePack = existing.migration_pack_id === candidatePack.pack_id && existing.target_identity === candidatePack.target.root_identity && actualTarget.root_identity === candidateTarget.root_identity;
      const bundleId = existing.bundle_id;
      if (samePack && receipt.migration_pack_id === candidatePack.pack_id && receipt.bundle_id === bundleId && receipt.source_revision === candidatePack.source.revision && receipt.source_tree_hash === candidatePack.source.tree_hash && receipt.target_identity === candidatePack.target.root_identity) {
        const knownLegacyNames = mergeLegacySkillNames(sourceRoot, candidatePack.legacy_surface.legacy_skill_names);
        const bundle = loadAndValidateBundle(options.bundleDir, sourceRoot, knownLegacyNames, options.portableBundle === true);
        if (bundle.bundle_id === bundleId) {
          if (sourceDeclaresPhase2Runtime(sourceRoot)) {
            if (!existing.runtime_distribution) throw new MigrationPackError('INSTALL_CONFLICT', 'Completed vNext installation is missing Runtime distribution identity.');
            const replayRuntime = validateVNextRuntimeContract(targetRoot, true).runtime_distribution;
            if (JSON.stringify(replayRuntime) !== JSON.stringify(existing.runtime_distribution)) throw new MigrationPackError('INSTALL_CONFLICT', 'Project-local Runtime distribution drifted from install state.');
          }
          const expectedArtifactIds = candidatePack.artifacts.map(artifact => artifact.stable_id);
          if (JSON.stringify(receipt.converted_artifact_ids) !== JSON.stringify(expectedArtifactIds)) {
            throw new MigrationPackError('INSTALL_CONFLICT', 'vNext migration receipt does not match the candidate Pack artifacts.');
          }
          for (const artifact of candidatePack.artifacts) {
            const targetPath = resolveRepoPath(targetRoot, artifact.target_path, 'replay artifact target');
            if (!fs.existsSync(targetPath) || readSha256(targetPath) !== artifact.content_sha256) {
              throw new MigrationPackError('INSTALL_CONFLICT', `Replay target artifact drifted: ${artifact.target_path}`);
            }
          }
          for (const artifact of bundle.artifacts) {
            const targetPath = resolveRepoPath(targetRoot, artifact.target_path, 'replay bundle target');
            if (!fs.existsSync(targetPath) || readSha256(targetPath) !== artifact.checksum) {
              throw new MigrationPackError('INSTALL_CONFLICT', `Replay vNext bundle artifact drifted: ${artifact.target_path}`);
            }
          }
          const replayProfile = parseStrictYaml(profilePath(targetRoot)) as JsonObject;
          validateNoLegacySurface(targetRoot, knownLegacyNames, candidatePack.legacy_surface.entries.filter(entry => entry.action === 'remove').map(entry => entry.path), bundle.artifacts.map(artifact => artifact.target_path), getWorkflowHome(replayProfile));
          if (fs.existsSync(existingInProgressPath)) {
            if (isFrozenPath(targetRoot, VNEXT_MIGRATION_IN_PROGRESS_RELATIVE_PATH)) throw new MigrationPackError('INSTALL_CONFLICT', 'The completed install marker is frozen and cannot be cleared.');
            removeInProgressMarker(targetRoot);
          }
          return { status: 'replayed', pack_id: candidatePack.pack_id, bundle_id: bundle.bundle_id, target_root: targetRoot, blockers: [], warnings, planned_writes: [], planned_deletes: [] };
        }
      }
      throw new MigrationPackError('INSTALL_CONFLICT', 'Target already has a different vNext installation marker.');
    } catch (error) {
      const issue = error instanceof MigrationPackError ? { severity: 'error' as const, code: error.code, message: error.message } : { severity: 'error' as const, code: 'INSTALL_CONFLICT' as const, message: String(error) };
      return { status: 'rejected', target_root: targetRoot, blockers: [issue], warnings, planned_writes: [], planned_deletes: [] };
    }
  }

  let pack: MigrationPackManifest;
  try {
    pack = validateMigrationPack({ packDir: options.packDir, sourceRoot, targetRoot });
  } catch (error) {
    const issue = error instanceof MigrationPackError ? { severity: 'error' as const, code: error.code, message: error.message } : { severity: 'error' as const, code: 'PACK_INVALID' as const, message: String(error) };
    return { status: 'rejected', target_root: targetRoot, blockers: [issue], warnings, planned_writes: [], planned_deletes: [] };
  }

  let bundle: VNextBundleManifest;
  const knownLegacyNames = mergeLegacySkillNames(sourceRoot, pack.legacy_surface.legacy_skill_names);
  try {
    bundle = loadAndValidateBundle(options.bundleDir, sourceRoot, knownLegacyNames, options.portableBundle === true);
  } catch (error) {
    const bundleError = asBundleError(error);
    const issue = bundleError ? { severity: 'error' as const, code: bundleError.code, message: bundleError.message } : { severity: 'error' as const, code: 'BUNDLE_INVALID' as const, message: String(error) };
    return { status: 'rejected', target_root: targetRoot, pack_id: pack.pack_id, blockers: [issue], warnings, planned_writes: [], planned_deletes: [] };
  }
  const phase2Runtime = sourceDeclaresPhase2Runtime(sourceRoot);
  let preparedRuntime: PreparedRuntimeDistribution | undefined;
  if (!options.dryRun && phase2Runtime) {
    try {
      preparedRuntime = prepareRuntimeDistribution(options.bundleDir, bundle.artifacts);
    } catch (error) {
      const issue = error instanceof MigrationPackError
        ? { severity: 'error' as const, code: error.code, message: error.message }
        : { severity: 'error' as const, code: 'INSTALL_CONFLICT' as const, message: String(error) };
      return { status: 'rejected', target_root: targetRoot, pack_id: pack.pack_id, bundle_id: bundle.bundle_id, blockers: [issue], warnings, planned_writes: [], planned_deletes: [] };
    }
  }
  const profile = parseStrictYaml(profilePath(targetRoot)) as JsonObject;
  const currentTaskPath = [getWorkflowHome(profile), CURRENT_TASK_FILE].filter(Boolean).join('/');
  const bundleCurrentTask = bundle.artifacts.find(artifact => artifact.target_path === currentTaskPath);
  if (!bundleCurrentTask || bundleCurrentTask.required !== true) {
    if (preparedRuntime) fs.rmSync(preparedRuntime.stagingRoot, { recursive: true, force: true });
    return { status: 'rejected', target_root: targetRoot, pack_id: pack.pack_id, bundle_id: bundle.bundle_id, blockers: [{ severity: 'error', code: 'BUNDLE_INVALID', message: 'vNext bundle must provide the pure-vNext ' + currentTaskPath + ' document.' }], warnings, planned_writes: [], planned_deletes: [] };
  }
  const bundleTargetPaths = new Set(bundle.artifacts.map(artifact => artifact.target_path));
  for (const artifact of pack.artifacts) {
    if (bundleTargetPaths.has(artifact.target_path)) {
      if (preparedRuntime) fs.rmSync(preparedRuntime.stagingRoot, { recursive: true, force: true });
      return { status: 'rejected', target_root: targetRoot, pack_id: pack.pack_id, bundle_id: bundle.bundle_id, blockers: [{ severity: 'error', code: 'BUNDLE_TARGET_CONFLICT', message: 'Pack and vNext bundle both target ' + artifact.target_path + '.', path: artifact.target_path }], warnings, planned_writes: [], planned_deletes: [] };
    }
  }
  const writes: AtomicWrite[] = [];
  for (const artifact of pack.artifacts) {
    const contentPath = resolveRepoPath(options.packDir, artifact.content_path, 'pack artifact ' + artifact.content_path);
    writes.push({ path: artifact.target_path, content: fs.readFileSync(contentPath, 'utf8') });
  }
  for (const artifact of bundle.artifacts) writes.push({ path: artifact.target_path, content: readBundleContent(options.bundleDir, artifact) });
  for (const write of writes) {
    if (isFrozenPath(targetRoot, write.path)) {
      if (preparedRuntime) fs.rmSync(preparedRuntime.stagingRoot, { recursive: true, force: true });
      return { status: 'rejected', target_root: targetRoot, pack_id: pack.pack_id, bundle_id: bundle.bundle_id, blockers: [{ severity: 'error', code: 'FROZEN_PATH', message: 'Migration cannot replace a frozen vNext target path.', path: write.path }], warnings, planned_writes: [], planned_deletes: [] };
    }
  }
  const runtimeTargetNodeModulesPath = preparedRuntime?.targetNodeModulesPath ?? (phase2Runtime ? VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH + '/node_modules' : undefined);
  if (runtimeTargetNodeModulesPath) {
    const runtimeDependencyPath = resolveRepoPath(targetRoot, runtimeTargetNodeModulesPath, 'Runtime dependency target');
    if (fs.existsSync(runtimeDependencyPath)) {
      if (!fs.statSync(runtimeDependencyPath).isDirectory()) {
        if (preparedRuntime) fs.rmSync(preparedRuntime.stagingRoot, { recursive: true, force: true });
        return { status: 'rejected', target_root: targetRoot, pack_id: pack.pack_id, bundle_id: bundle.bundle_id, blockers: [{ severity: 'error', code: 'INSTALL_CONFLICT', message: 'Runtime dependency target is not a directory.', path: runtimeTargetNodeModulesPath }], warnings, planned_writes: [], planned_deletes: [] };
      }
      if (!fs.existsSync(existingStatePath)) {
        if (preparedRuntime) fs.rmSync(preparedRuntime.stagingRoot, { recursive: true, force: true });
        return { status: 'rejected', target_root: targetRoot, pack_id: pack.pack_id, bundle_id: bundle.bundle_id, blockers: [{ severity: 'error', code: 'INSTALL_CONFLICT', message: 'Runtime dependency directory exists without an admitted prior vNext owner.', path: runtimeTargetNodeModulesPath }], warnings, planned_writes: [], planned_deletes: [] };
      }
    }
  }
  if (runtimeTargetNodeModulesPath && isFrozenPath(targetRoot, runtimeTargetNodeModulesPath)) {
    if (preparedRuntime) fs.rmSync(preparedRuntime.stagingRoot, { recursive: true, force: true });
    return { status: 'rejected', target_root: targetRoot, pack_id: pack.pack_id, bundle_id: bundle.bundle_id, blockers: [{ severity: 'error', code: 'FROZEN_PATH', message: 'Migration cannot replace a frozen Runtime dependency directory.', path: runtimeTargetNodeModulesPath }], warnings, planned_writes: [], planned_deletes: [] };
  }
  const removedLegacyPaths = pack.legacy_surface.entries.filter(entry => entry.action === 'remove').map(entry => entry.path);
  const runtimeDistribution = preparedRuntime?.identity ?? null;
  const installState: VNextInstallState = {
    schema_version: 1,
    kind: 'vnext-install-state',
    distribution_state: 'vnext',
    distribution_version: runtimeDistribution?.package_version ?? 'unknown',
    migration_pack_id: pack.pack_id,
    bundle_id: bundle.bundle_id,
    source_revision: pack.source.revision,
    source_tree_hash: pack.source.tree_hash,
    target_identity: pack.target.root_identity,
    runtime_distribution: runtimeDistribution,
    installed_at: now(),
    managed_files: [...writes.map(write => ({ path: write.path, checksum: sha256(write.content), category: bundle.artifacts.find(artifact => artifact.target_path === write.path)?.category ?? 'migrated-document' })), { path: VNEXT_INSTALL_STATE_RELATIVE_PATH, checksum: '', category: 'vnext-install-state' }],
    removed_legacy_files: removedLegacyPaths,
    legacy_compatibility: 'absent',
    recovery_boundary: 'in-progress-marker',
  };
  const receipt = {
    schema_version: 1,
    kind: 'vnext-migration-receipt',
    migration_pack_id: pack.pack_id,
    bundle_id: bundle.bundle_id,
    source_revision: pack.source.revision,
    source_tree_hash: pack.source.tree_hash,
    target_identity: pack.target.root_identity,
    runtime_distribution: runtimeDistribution,
    installed_at: installState.installed_at,
    converted_artifact_ids: pack.artifacts.map(artifact => artifact.stable_id),
    legacy_compatibility: 'absent',
  };
  writes.push({ path: VNEXT_INSTALL_STATE_RELATIVE_PATH, content: JSON.stringify(installState, null, 2) + '\n' });
  writes.push({ path: VNEXT_MIGRATION_RECEIPT_RELATIVE_PATH, content: JSON.stringify(receipt, null, 2) + '\n' });
  const additionalWrites = options.additionalWrites ?? [];
  const existingWritePaths = new Set(writes.map(write => write.path));
  for (const extra of additionalWrites) {
    const normalizedPath = normalizeRepoPath(extra.path, 'additional transaction write path');
    if (isFrozenPath(targetRoot, normalizedPath)) {
      if (preparedRuntime) fs.rmSync(preparedRuntime.stagingRoot, { recursive: true, force: true });
      return { status: 'rejected', target_root: targetRoot, pack_id: pack.pack_id, bundle_id: bundle.bundle_id, blockers: [{ severity: 'error', code: 'FROZEN_PATH', message: 'Additional distribution state cannot replace a frozen path.', path: normalizedPath }], warnings, planned_writes: [], planned_deletes: [] };
    }
    if (existingWritePaths.has(normalizedPath)) {
      if (preparedRuntime) fs.rmSync(preparedRuntime.stagingRoot, { recursive: true, force: true });
      return { status: 'rejected', target_root: targetRoot, pack_id: pack.pack_id, bundle_id: bundle.bundle_id, blockers: [{ severity: 'error', code: 'INSTALL_CONFLICT', message: 'Additional transaction write duplicates an existing migration target.', path: normalizedPath }], warnings, planned_writes: [], planned_deletes: [] };
    }
    existingWritePaths.add(normalizedPath);
    writes.push({ path: normalizedPath, content: extra.content });
  }
  const plannedWrites = [...writes.map(write => write.path), ...(runtimeTargetNodeModulesPath ? [runtimeTargetNodeModulesPath] : [])];
  const plannedDeletes = removedLegacyPaths.filter(relative => !bundleTargetPaths.has(relative) && !writes.some(write => write.path === relative));
  if (options.dryRun) return { status: 'ready', pack_id: pack.pack_id, bundle_id: bundle.bundle_id, target_root: targetRoot, blockers, warnings, planned_writes: plannedWrites, planned_deletes: plannedDeletes };

  if (isFrozenPath(targetRoot, VNEXT_MIGRATION_IN_PROGRESS_RELATIVE_PATH)) {
    if (preparedRuntime) fs.rmSync(preparedRuntime.stagingRoot, { recursive: true, force: true });
    return { status: 'rejected', target_root: targetRoot, pack_id: pack.pack_id, bundle_id: bundle.bundle_id, blockers: [{ severity: 'error', code: 'FROZEN_PATH', message: 'Migration cannot create or clear a frozen interruption marker.', path: VNEXT_MIGRATION_IN_PROGRESS_RELATIVE_PATH }], warnings, planned_writes: [], planned_deletes: [] };
  }
  const inProgressMarker: VNextMigrationInProgress = {
    schema_version: 1,
    kind: 'vnext-migration-in-progress',
    migration_pack_id: pack.pack_id,
    bundle_id: bundle.bundle_id,
    target_identity: pack.target.root_identity,
    started_at: installState.installed_at,
    planned_writes: plannedWrites,
    planned_deletes: plannedDeletes,
    recovery: 'fail-closed-explicit-recovery',
  };
  try {
    writeInProgressMarker(targetRoot, inProgressMarker);
    applyAtomicFileTransaction(
      targetRoot,
      writes,
      plannedDeletes,
      () => {
        validateNoLegacySurface(targetRoot, knownLegacyNames, plannedDeletes, [...bundleTargetPaths], getWorkflowHome(profile));
        const statePath = path.join(targetRoot, ...VNEXT_INSTALL_STATE_RELATIVE_PATH.split('/'));
        if (!fs.existsSync(statePath)) throw new MigrationPackError('INSTALL_CONFLICT', 'vNext install state was not promoted.');
        const installedState = validateVNextInstallState(parseStrictJson(statePath), 'vNext install state');
        if (installedState.migration_pack_id !== pack.pack_id || installedState.bundle_id !== bundle.bundle_id || installedState.target_identity !== pack.target.root_identity || JSON.stringify(installedState.runtime_distribution) !== JSON.stringify(runtimeDistribution)) throw new MigrationPackError('INSTALL_CONFLICT', 'vNext install state read-back identity mismatch.');
        const receiptPath = path.join(targetRoot, ...VNEXT_MIGRATION_RECEIPT_RELATIVE_PATH.split('/'));
        if (!fs.existsSync(receiptPath)) throw new MigrationPackError('INSTALL_CONFLICT', 'vNext migration receipt was not promoted.');
        const installedReceipt = validateVNextMigrationReceipt(parseStrictJson(receiptPath), 'vNext migration receipt');
        if (installedReceipt.migration_pack_id !== pack.pack_id || installedReceipt.bundle_id !== bundle.bundle_id || installedReceipt.target_identity !== pack.target.root_identity || JSON.stringify(installedReceipt.runtime_distribution) !== JSON.stringify(runtimeDistribution) || JSON.stringify(installedReceipt.converted_artifact_ids) !== JSON.stringify(pack.artifacts.map(artifact => artifact.stable_id))) {
          throw new MigrationPackError('INSTALL_CONFLICT', 'vNext migration receipt read-back identity mismatch.');
        }
        if (phase2Runtime) {
          const installedRuntime = validateVNextRuntimeContract(targetRoot, true).runtime_distribution;
          if (JSON.stringify(installedRuntime) !== JSON.stringify(runtimeDistribution)) throw new MigrationPackError('INSTALL_CONFLICT', 'Project-local Runtime distribution read-back identity mismatch.');
        }
        options.postPromotionVerify?.();
      },
      preparedRuntime ? [{ path: preparedRuntime.targetNodeModulesPath, sourcePath: preparedRuntime.sourceNodeModulesPath }] : [],
    );
    if (preparedRuntime) fs.rmSync(preparedRuntime.stagingRoot, { recursive: true, force: true });
    try {
      removeInProgressMarker(targetRoot);
    } catch (error) {
      warnings.push({ severity: 'warning', code: 'CONVERSION_ISSUE', message: 'Completed install left its interruption marker for replay cleanup: ' + (error instanceof Error ? error.message : String(error)), path: VNEXT_MIGRATION_IN_PROGRESS_RELATIVE_PATH });
    }
  } catch (error) {
    if (preparedRuntime) fs.rmSync(preparedRuntime.stagingRoot, { recursive: true, force: true });
    let rollbackVerified = false;
    try {
      rollbackVerified = computeTreeHash(targetRoot, [VNEXT_MIGRATION_IN_PROGRESS_RELATIVE_PATH]) === pack.legacy_source.tree_hash;
    } catch {
      // If the target cannot be re-snapshotted, its rollback state is unknown.
    }
    if (rollbackVerified) {
      try {
        removeInProgressMarker(targetRoot);
      } catch {
        // Preserve a marker when cleanup itself fails; the next invocation
        // will fail closed instead of assuming the target is safe to retry.
      }
    } else {
      warnings.push({ severity: 'warning', code: 'CONVERSION_ISSUE', message: 'Rollback could not be verified against the pre-install target snapshot; the interruption marker was retained for explicit recovery.', path: VNEXT_MIGRATION_IN_PROGRESS_RELATIVE_PATH });
    }
    const issue = error instanceof MigrationPackError ? { severity: 'error' as const, code: error.code, message: error.message } : { severity: 'error' as const, code: 'INSTALL_CONFLICT' as const, message: String(error) };
    return { status: 'rejected', pack_id: pack.pack_id, bundle_id: bundle.bundle_id, target_root: targetRoot, blockers: [issue], warnings, planned_writes: [], planned_deletes: [] };
  }
  return { status: 'installed', pack_id: pack.pack_id, bundle_id: bundle.bundle_id, target_root: targetRoot, blockers: [], warnings, planned_writes: plannedWrites, planned_deletes: plannedDeletes };
}

function parseCli(argv: string[]): { command: string; flags: Record<string, string | boolean> } {
  const [command = 'help', ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = rest[index + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      index += 1;
    } else flags[key] = true;
  }
  return { command, flags };
}

function flagString(flags: Record<string, string | boolean>, key: string, required = true): string {
  const value = flags[key];
  if (typeof value === 'string' && value.trim()) return value;
  if (required) throw new MigrationPackError('PACK_INVALID', `Missing required CLI flag --${key}.`);
  return '';
}

function printCli(value: unknown, json: boolean): void {
  if (json) console.log(JSON.stringify(value, null, 2));
  else if (typeof value === 'string') console.log(value);
  else console.log(JSON.stringify(value, null, 2));
}

function cliUsage(): string {
  return [
    'Usage:',
    '  bun run scripts/vnext-migration-pack.ts preflight --target <old-project> [--source <workflow-system>] [--json]',
    '  bun run scripts/vnext-migration-pack.ts convert --target <old-project> --out <pack-dir> [--source <workflow-system>] [--overwrite] [--json]',
    '  bun run scripts/vnext-migration-pack.ts validate --pack <pack-dir> [--target <old-project>] [--source <workflow-system>] [--json]',
    '  bun run scripts/vnext-migration-pack.ts install --pack <pack-dir> --bundle <vnext-bundle-dir> --target <old-project> [--source <workflow-system>] [--write] [--json]',
    '  bun run scripts/vnext-migration-pack.ts migrate --target <old-project> --out <pack-dir> --bundle <vnext-bundle-dir> [--source <workflow-system>] [--write] [--json]',
  ].join('\n');
}

if (import.meta.main) {
  try {
    const { command, flags } = parseCli(process.argv.slice(2));
    const sourceRoot = typeof flags.source === 'string' ? flags.source : resolveRoot();
    const json = flags.json === true;
    if (command === 'help' || command === '--help') {
      printCli(cliUsage(), false);
      process.exit(0);
    }
    if (command === 'preflight') {
      const result = preflightMigration({ sourceRoot, targetRoot: flagString(flags, 'target') });
      printCli(result, json);
      process.exit(result.eligible ? 0 : 1);
    }
    if (command === 'convert') {
      const manifest = createMigrationPack({ sourceRoot, targetRoot: flagString(flags, 'target'), outDir: flagString(flags, 'out'), overwrite: flags.overwrite === true });
      printCli(manifest, json);
      process.exit(0);
    }
    if (command === 'validate') {
      const manifest = validateMigrationPack({ packDir: flagString(flags, 'pack'), sourceRoot, targetRoot: typeof flags.target === 'string' ? flags.target : undefined });
      printCli(manifest, json);
      process.exit(0);
    }
    if (command === 'install') {
      const result = installMigrationPack({ packDir: flagString(flags, 'pack'), bundleDir: flagString(flags, 'bundle'), targetRoot: flagString(flags, 'target'), sourceRoot, dryRun: flags.write !== true });
      printCli(result, json);
      process.exit(result.status === 'installed' || result.status === 'replayed' || result.status === 'ready' ? 0 : 1);
    }
    if (command === 'migrate') {
      const manifest = createMigrationPack({ sourceRoot, targetRoot: flagString(flags, 'target'), outDir: flagString(flags, 'out'), overwrite: flags.overwrite === true });
      const result = installMigrationPack({ packDir: flagString(flags, 'out'), bundleDir: flagString(flags, 'bundle'), targetRoot: flagString(flags, 'target'), sourceRoot, dryRun: flags.write !== true });
      printCli({ pack: manifest, install: result }, json);
      process.exit(result.status === 'installed' || result.status === 'replayed' || result.status === 'ready' ? 0 : 1);
    }
    printCli(cliUsage(), false);
    process.exit(1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
