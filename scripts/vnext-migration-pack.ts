/**
 * One-time, idle-only Migration Pack for upgrading an old workflow project to
 * a pure vNext installation.
 *
 * This module is deliberately independent from workflow-runtime.ts.  The
 * legacy runtime remains the owner of the existing pack/install/sync surface;
 * this file is the only legacy-aware vNext migration boundary.
 */

import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parse, parseDocument } from 'yaml';
import { checkTargetRoot, normalizeAbsoluteRootPath } from './guard-target-root';
import {
  getWorkflowDocPath,
  getWorkflowProfilePath,
  getWorkflowHome,
  loadProfile,
  readText,
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
  extractCurrentTaskStateFromCurrentTask,
  validateCurrentTaskStatusTuple,
} from './task-identity';

export const MIGRATION_PACK_SCHEMA_VERSION = 1 as const;
export const MIGRATION_PACK_KIND = 'workflow-vnext-migration-pack' as const;
export const VNEXT_BUNDLE_SCHEMA_VERSION = 1 as const;
export const VNEXT_BUNDLE_KIND = 'workflow-vnext-bundle' as const;
export const MIGRATION_PACK_FILE = 'migration-pack.json';
export const MIGRATION_REPORT_FILE = 'migration-report.json';
export const VNEXT_BUNDLE_FILE = 'vnext-bundle.json';
export const VNEXT_INSTALL_STATE_RELATIVE_PATH = '.workflow-system/vnext/INSTALL_STATE.json';
export const VNEXT_MIGRATION_RECEIPT_RELATIVE_PATH = '.workflow-system/vnext/MIGRATION_RECEIPT.json';

const LEGACY_PROTOCOL_VERSION_PATTERN = /^0\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/;
const SAFE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const STABLE_ID_PATTERN = /^artifact-[a-f0-9]{24}$/;
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
const VNEXT_FORBIDDEN_PATH_PARTS = new Set(['compat', 'compatibility', 'aliases', 'adapters', 'legacy']);
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
const KNOWN_LEGACY_SCRIPT_PATHS = [
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
  state: 'idle' | 'non-idle' | 'ambiguous' | 'unsupported' | 'already-vnext';
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
    conversion_rule: 'copy-preserving-v1';
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
    mode: 'offline-copy';
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

export type VNextInstallState = {
  schema_version: 1;
  kind: 'vnext-install-state';
  mode: 'pure-vnext';
  migration_pack_id: string;
  bundle_id: string;
  source_revision: string;
  source_tree_hash: string;
  target_identity: string;
  installed_at: string;
  managed_files: Array<{ path: string; checksum: string; category: string }>;
  removed_legacy_files: string[];
  legacy_compatibility: 'absent';
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

export function computeTreeHash(root: string): string {
  const resolvedRoot = path.resolve(root);
  const files = listFiles(resolvedRoot, { skipDirectories: SKIP_TREE_DIRECTORIES });
  const hash = crypto.createHash('sha256');
  for (const filePath of files) {
    const relative = path.relative(resolvedRoot, filePath).replace(/\\/g, '/');
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
      const id = idMatch[1].trim();
      current = id && !/^\{\{.*\}\}$/.test(id) ? { id, status: null } : null;
      continue;
    }
    if (current) {
      const statusMatch = /^\s*-?\s*Status\s*[：:]\s*(.*?)\s*$/.exec(line);
      if (statusMatch) current.status = statusMatch[1].trim();
    }
  }
  if (current) findings.push(current);
  return findings.flatMap(finding => {
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
    for (const file of fs.readdirSync(directory)) {
      const match = /^workflow-system-(.+)\.SKILL\.md$/.exec(file);
      if (match) names.add(match[1]);
    }
  }
  return [...names].sort();
}

function mergeLegacySkillNames(sourceRoot: string, packNames: readonly string[]): string[] {
  const names = new Set(packNames);
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
  entries.set(normalized, existing ?? { path: normalized, sha256: checksum, source, action });
}

function collectLegacySurface(
  targetRoot: string,
  profile: JsonObject,
  currentTaskPath: string | null,
): { entries: LegacySurfaceEntry[]; legacySkillNames: string[]; issues: MigrationIssue[] } {
  const entries = new Map<string, LegacySurfaceEntry>();
  const issues: MigrationIssue[] = [];
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
      if (/^workflow-system-.+\.SKILL\.md$/.test(path.basename(filePath))) {
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

  const legacySkillNames = readLegacySkillNames(targetRoot);
  if (legacySkillNames.length === 0) {
    issues.push({ severity: 'warning', code: 'LEGACY_SURFACE_AMBIGUOUS', message: 'No legacy Skill names were discoverable; the vNext bundle must still prove that its executable surface contains no compatibility aliases.' });
  }
  return { entries: [...entries.values()].sort((a, b) => a.path.localeCompare(b.path)), legacySkillNames, issues };
}

function readFreezeFiles(targetRoot: string): string[] {
  return [
    path.join(targetRoot, 'FREEZE_REGISTRY.md'),
    path.join(targetRoot, '.workflow-system', 'FREEZE_REGISTRY.md'),
  ].filter(filePath => fs.existsSync(filePath)).flatMap(filePath => fs.readFileSync(filePath, 'utf8').split(/\r?\n/));
}

function isFrozenPath(targetRoot: string, relativePath: string): boolean {
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
  return [...candidates].map(raw => {
    if (/^(?:https?:|mailto:|ftp:)/i.test(raw)) return { raw, normalized: raw, kind: 'external', adjusted: false };
    if (raw.startsWith('#')) return { raw, normalized: raw, kind: 'anchor', adjusted: false };
    // Legacy workflow documents commonly link to slash-prefixed Skill
    // commands (for example `/review-current-diff`).  Those are executable
    // names, not filesystem paths, and must be preserved as opaque references.
    if (/^\/[a-z][a-z0-9-]*$/.test(raw)) return { raw, normalized: raw, kind: 'unclassified', adjusted: false };
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
  }).sort((left, right) => left.raw.localeCompare(right.raw));
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
): MigrationArtifact {
  const sourceSha = sha256(content);
  const stableId = `artifact-${sha256(`${kind}\0${sourcePath}\0${sourceSha}`).slice(0, 24)}`;
  return {
    stable_id: stableId,
    kind,
    source_path: normalizeRepoPath(sourcePath, 'artifact.source_path'),
    target_path: normalizeRepoPath(targetPath, 'artifact.target_path'),
    content_path: `artifacts/${stableId}.content`,
    source_sha256: sourceSha,
    content_sha256: sourceSha,
    byte_length: Buffer.byteLength(content, 'utf8'),
    path_references: extractPathReferences(content),
    provenance: {
      source_revision: source.revision,
      source_tree_hash: source.tree_hash,
      legacy_source_revision: legacySource.revision,
      legacy_source_tree_hash: legacySource.tree_hash,
      source_path: normalizeRepoPath(sourcePath, 'artifact.provenance.source_path'),
      source_sha256: sourceSha,
      conversion_rule: 'copy-preserving-v1',
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
      profile = loadProfile(targetProfilePath);
      target = getProjectIdentity(profile, targetRoot);
      workflowHome = getWorkflowHome(profile);
    } catch (error) {
      blockers.push({ severity: 'error', code: 'PROFILE_INVALID', message: error instanceof Error ? error.message : String(error), path: '.workflow-system/PROJECT_PROFILE.yaml' });
    }
  }

  const vnextStatePath = path.join(targetRoot, ...VNEXT_INSTALL_STATE_RELATIVE_PATH.split('/'));
  const vnextReceiptPath = path.join(targetRoot, ...VNEXT_MIGRATION_RECEIPT_RELATIVE_PATH.split('/'));
  if (fs.existsSync(vnextStatePath) || fs.existsSync(vnextReceiptPath)) {
    blockers.push({ severity: 'error', code: 'VNEXT_ALREADY_PRESENT', message: 'A vNext install marker is already present; do not run a second conversion.', path: VNEXT_INSTALL_STATE_RELATIVE_PATH });
  } else {
    const vnextDirectory = path.join(targetRoot, '.workflow-system', 'vnext');
    const partialFiles = listFiles(vnextDirectory).filter(filePath => path.basename(filePath) !== 'MIGRATION_PACK_SCHEMA.yaml');
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
  const state: MigrationPreflight['state'] = blockers.some(issue => issue.code === 'VNEXT_ALREADY_PRESENT')
    ? 'already-vnext'
    : blockers.some(issue => issue.code.includes('PROTOCOL') || issue.code.includes('SCHEMA'))
      ? 'unsupported'
      : !target || !currentTask
        ? 'ambiguous'
        : blockers.some(issue => issue.code === 'CURRENT_TASK_NON_IDLE' || issue.code === 'CURRENT_TASK_FINDING_OPEN' || issue.code === 'SUSPENDED_WORK_PRESENT')
          ? 'non-idle'
          : eligible
            ? 'idle'
            : 'ambiguous';

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
    artifacts.push(createArtifact('governance-document', relativePath, relativePath, content, source, legacySource));
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
  artifacts.push(createArtifact('project-profile', profileRelativePath, profileRelativePath, profileContent, source, legacySource));

  const tasksDir = path.join(targetRoot, 'TASKS');
  if (fs.existsSync(tasksDir)) {
    for (const filePath of listFiles(tasksDir)) {
      const relativePath = path.relative(targetRoot, filePath).replace(/\\/g, '/');
      if (relativePath.startsWith('TASKS/paused/') || relativePath.startsWith('TASKS/interrupted/') || relativePath.startsWith('TASKS/inbox/')) continue;
      const basename = path.basename(filePath);
      if (/^TASK-[0-9]{3,}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(basename)) {
        const content = fs.readFileSync(filePath, 'utf8');
        issues.push(...validateLegacyDocument(relativePath, content));
        artifacts.push(createArtifact('task-archive', relativePath, relativePath, content, source, legacySource));
      } else if (basename !== 'README.md' && basename !== '.gitkeep') {
        const content = fs.readFileSync(filePath, 'utf8');
        issues.push({ severity: 'warning', code: 'CONVERSION_ISSUE', message: 'Unclassified TASKS content is preserved as target-owned content.', path: relativePath });
        artifacts.push(createArtifact('target-owned-preserved', relativePath, relativePath, content, source, legacySource));
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
      artifacts.push(createArtifact('target-owned-preserved', relativePath, relativePath, content, source, legacySource));
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
    artifacts: manifest.artifacts.map(artifact => ({ stable_id: artifact.stable_id, source_sha256: artifact.source_sha256, target_path: artifact.target_path })),
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
  const profile = loadProfile(profilePath(targetRoot));
  const conversionIssues: MigrationIssue[] = [...preflight.warnings];
  const artifacts = collectConversionArtifacts(targetRoot, profile, preflight.source, preflight.target_snapshot, conversionIssues);
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
      mode: 'offline-copy',
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
    const content = fs.readFileSync(resolveRepoPath(targetRoot, artifact.source_path, 'artifact source path'), 'utf8');
    const outputPath = resolveRepoPath(outputDir, artifact.content_path, 'pack artifact content path');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, content, 'utf8');
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

function validateSourceIdentity(actual: SourceIdentity, expected: SourceIdentity, location: string): void {
  if (
    actual.root_identity !== expected.root_identity ||
    actual.revision !== expected.revision ||
    actual.tree_hash !== expected.tree_hash
  ) {
    throw new MigrationPackError('PACK_STALE', `${location} does not match the exact source identity/revision.`);
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
  expectExactKeys(record, ['stable_id', 'kind', 'source_path', 'target_path', 'content_path', 'source_sha256', 'content_sha256', 'byte_length', 'path_references', 'provenance'], location);
  const stableId = expectString(record.stable_id, `${location}.stable_id`);
  if (!STABLE_ID_PATTERN.test(stableId)) throw new MigrationPackError('PACK_INVALID', `${location}.stable_id is invalid.`);
  const kind = expectString(record.kind, `${location}.kind`);
  if (!['governance-document', 'project-profile', 'task-archive', 'target-owned-preserved'].includes(kind)) throw new MigrationPackError('PACK_INVALID', `${location}.kind is unsupported.`);
  const sourcePath = normalizeRepoPath(expectString(record.source_path, `${location}.source_path`), `${location}.source_path`);
  const targetPath = normalizeRepoPath(expectString(record.target_path, `${location}.target_path`), `${location}.target_path`);
  const contentPath = normalizeRepoPath(expectString(record.content_path, `${location}.content_path`), `${location}.content_path`);
  if (!contentPath.startsWith('artifacts/')) throw new MigrationPackError('PACK_INVALID', `${location}.content_path must stay under artifacts/.`);
  const sourceSha = expectString(record.source_sha256, `${location}.source_sha256`);
  const contentSha = expectString(record.content_sha256, `${location}.content_sha256`);
  if (!/^[a-f0-9]{64}$/.test(sourceSha) || !/^[a-f0-9]{64}$/.test(contentSha) || sourceSha !== contentSha) throw new MigrationPackError('PACK_INVALID', `${location} checksum fields are invalid or do not preserve original text.`);
  if (typeof record.byte_length !== 'number' || !Number.isInteger(record.byte_length) || record.byte_length < 0) throw new MigrationPackError('PACK_INVALID', `${location}.byte_length must be a non-negative integer.`);
  if (!Array.isArray(record.path_references)) throw new MigrationPackError('PACK_INVALID', `${location}.path_references must be a list.`);
  const pathReferences = record.path_references.map((raw, index) => {
    const ref = expectRecord(raw, `${location}.path_references[${index}]`);
    expectExactKeys(ref, ['raw', 'normalized', 'kind', 'adjusted'], `${location}.path_references[${index}]`);
    const rawValue = expectString(ref.raw, `${location}.path_references[${index}].raw`);
    const normalized = expectString(ref.normalized, `${location}.path_references[${index}].normalized`);
    const refKind = expectString(ref.kind, `${location}.path_references[${index}].kind`);
    if (!['repo-relative', 'external', 'anchor', 'unclassified'].includes(refKind)) throw new MigrationPackError('PACK_INVALID', `${location}.path_references[${index}].kind is unsupported.`);
    const adjusted = expectBoolean(ref.adjusted, `${location}.path_references[${index}].adjusted`);
    return { raw: rawValue, normalized, kind: refKind as PathReference['kind'], adjusted };
  });
  const provenance = expectRecord(record.provenance, `${location}.provenance`);
  expectExactKeys(provenance, ['source_revision', 'source_tree_hash', 'legacy_source_revision', 'legacy_source_tree_hash', 'source_path', 'source_sha256', 'conversion_rule'], `${location}.provenance`);
  const conversionRule = expectString(provenance.conversion_rule, `${location}.provenance.conversion_rule`);
  if (conversionRule !== 'copy-preserving-v1') throw new MigrationPackError('PACK_INVALID', `${location}.provenance.conversion_rule must be copy-preserving-v1.`);
  const provenanceSourceRevision = expectString(provenance.source_revision, `${location}.provenance.source_revision`);
  const provenanceSourceTreeHash = expectString(provenance.source_tree_hash, `${location}.provenance.source_tree_hash`);
  const legacySourceRevision = expectString(provenance.legacy_source_revision, `${location}.provenance.legacy_source_revision`);
  const legacySourceTreeHash = expectString(provenance.legacy_source_tree_hash, `${location}.provenance.legacy_source_tree_hash`);
  const provenanceSourceSha = expectString(provenance.source_sha256, `${location}.provenance.source_sha256`);
  if (!/^[a-f0-9]{64}$/.test(provenanceSourceTreeHash) || !/^[a-f0-9]{64}$/.test(legacySourceTreeHash) || provenanceSourceSha !== sourceSha) {
    throw new MigrationPackError('PACK_INVALID', `${location}.provenance hash binding is invalid.`);
  }
  return {
    stable_id: stableId,
    kind: kind as MigrationArtifactKind,
    source_path: sourcePath,
    target_path: targetPath,
    content_path: contentPath,
    source_sha256: sourceSha,
    content_sha256: contentSha,
    byte_length: record.byte_length,
    path_references: pathReferences,
    provenance: {
      source_revision: provenanceSourceRevision,
      source_tree_hash: provenanceSourceTreeHash,
      legacy_source_revision: legacySourceRevision,
      legacy_source_tree_hash: legacySourceTreeHash,
      source_path: normalizeRepoPath(expectString(provenance.source_path, `${location}.provenance.source_path`), `${location}.provenance.source_path`),
      source_sha256: provenanceSourceSha,
      conversion_rule: 'copy-preserving-v1',
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
  if (conversion.mode !== 'offline-copy' || conversion.preserves_original_text !== true || conversion.semantic_reinterpretation !== false) throw new MigrationPackError('PACK_INVALID', 'Migration Pack conversion must be copy-preserving and non-semantic.');
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
    if (!fs.existsSync(contentPath)) throw new MigrationPackError('PACK_INVALID', `artifact content is missing: ${artifact.content_path}`);
    const content = fs.readFileSync(contentPath);
    if (sha256(content) !== artifact.content_sha256 || content.byteLength !== artifact.byte_length) throw new MigrationPackError('PACK_INVALID', `artifact checksum/length mismatch: ${artifact.target_path}`);
    if (artifact.target_path === currentTask.path || artifact.target_path === legacyProtocol.protocol_path || artifact.target_path === legacyProtocol.schema_path) throw new MigrationPackError('PACK_INVALID', `Migration Pack must not convert CURRENT_TASK/protocol/schema directly: ${artifact.target_path}`);
    if (artifact.provenance.source_revision !== source.revision || artifact.provenance.source_tree_hash !== source.tree_hash || artifact.provenance.legacy_source_revision !== legacySource.revision || artifact.provenance.legacy_source_tree_hash !== legacySource.tree_hash) {
      throw new MigrationPackError('PACK_INVALID', `artifact provenance does not bind to the pack source/legacy snapshot: ${artifact.target_path}`);
    }
    return artifact;
  });
  const legacySurfaceRaw = expectRecord(raw.legacy_surface, 'migration pack.legacy_surface');
  expectExactKeys(legacySurfaceRaw, ['entries', 'legacy_skill_names'], 'migration pack.legacy_surface');
  const legacySurfaceEntries = validateSurfaceEntries(legacySurfaceRaw.entries, 'migration pack.legacy_surface.entries');
  const legacySkillNames = expectStringArray(legacySurfaceRaw.legacy_skill_names, 'migration pack.legacy_surface.legacy_skill_names', true);
  const installation = expectRecord(raw.installation, 'migration pack.installation');
  expectExactKeys(installation, ['requires_vnext_bundle', 'install_state_path', 'migration_receipt_path', 'old_current_task_replaced_by_bundle', 'old_protocol_and_schema_replaced_by_bundle', 'old_compatibility_surface_removed'], 'migration pack.installation');
  if (installation.requires_vnext_bundle !== true || installation.old_current_task_replaced_by_bundle !== true || installation.old_protocol_and_schema_replaced_by_bundle !== true || installation.old_compatibility_surface_removed !== true) throw new MigrationPackError('PACK_INVALID', 'Migration Pack installation boundary is incomplete.');
  if (normalizeRepoPath(expectString(installation.install_state_path, 'migration pack.installation.install_state_path'), 'install_state_path') !== VNEXT_INSTALL_STATE_RELATIVE_PATH) throw new MigrationPackError('PACK_INVALID', 'Migration Pack install_state_path is not canonical.');
  if (normalizeRepoPath(expectString(installation.migration_receipt_path, 'migration pack.installation.migration_receipt_path'), 'migration_receipt_path') !== VNEXT_MIGRATION_RECEIPT_RELATIVE_PATH) throw new MigrationPackError('PACK_INVALID', 'Migration Pack migration_receipt_path is not canonical.');
  const base = {
    schema_version: MIGRATION_PACK_SCHEMA_VERSION,
    kind: MIGRATION_PACK_KIND,
    source,
    target,
    legacy_source: legacySource,
    legacy_protocol: legacyProtocol,
    preflight: { state: 'idle' as const, current_task: currentTask, current_task_excluded: true as const, checked_at: expectString(preflight.checked_at, 'migration pack.preflight.checked_at') },
    conversion: { mode: 'offline-copy' as const, preserves_original_text: true as const, semantic_reinterpretation: false as const, allowed_surfaces: expectStringArray(conversion.allowed_surfaces, 'migration pack.conversion.allowed_surfaces'), issues: conversionIssues },
    artifacts,
    legacy_surface: { entries: legacySurfaceEntries, legacy_skill_names: legacySkillNames },
    installation: {
      requires_vnext_bundle: true as const,
      install_state_path: VNEXT_INSTALL_STATE_RELATIVE_PATH,
      migration_receipt_path: VNEXT_MIGRATION_RECEIPT_RELATIVE_PATH,
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
  if (targetIdentity.root_identity !== getProjectIdentity(loadProfile(profilePath(targetRoot)), targetRoot).root_identity) throw new MigrationPackError('PACK_STALE', 'Migration Pack target identity does not match target PROJECT_PROFILE.yaml.');
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

function loadAndValidateBundle(bundleDir: string, sourceRoot: string, legacySkillNames: readonly string[]): VNextBundleManifest {
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
  validateSourceIdentity(source, getSourceIdentity(sourceRoot), 'vNext bundle source');
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
    const lowerPath = artifact.target_path.toLowerCase();
    if ([...VNEXT_FORBIDDEN_PATH_PARTS].some(part => lowerPath.split('/').includes(part))) throw new MigrationPackError('BUNDLE_INVALID', `vNext bundle target path contains a compatibility surface: ${artifact.target_path}`);
    if (artifact.target_path === VNEXT_INSTALL_STATE_RELATIVE_PATH || artifact.target_path === VNEXT_MIGRATION_RECEIPT_RELATIVE_PATH) {
      throw new MigrationPackError('BUNDLE_INVALID', `vNext bundle must not own Migration Pack state: ${artifact.target_path}`);
    }
    for (const legacyName of legacySkillNames) {
      // `capture-work-item` is intentionally retained as a vNext public
      // intent, so its canonical vNext Skill/registry occurrence is not a
      // legacy compatibility route.  All other legacy IDs remain forbidden.
      const canonicalCaptureEntry = legacyName === 'capture-work-item' &&
        ((artifact.category === 'skill' && path.posix.basename(artifact.target_path) === 'capture-work-item.SKILL.md') || artifact.category === 'registry');
      if (canonicalCaptureEntry) continue;
      if (artifact.target_path.includes(legacyName) || (artifact.category === 'skill' || artifact.category === 'registry') && content.includes(legacyName)) throw new MigrationPackError('BUNDLE_INVALID', `vNext bundle contains legacy Skill ID ${legacyName}.`);
    }
    artifacts.push(artifact);
  }
  for (const category of VNEXT_REQUIRED_BUNDLE_CATEGORIES) {
    if (!categories.has(category)) throw new MigrationPackError('BUNDLE_INVALID', `vNext bundle is missing required category ${category}.`);
  }
  const skillNames = new Set(
    artifacts
      .filter(artifact => artifact.category === 'skill')
      .map(artifact => path.posix.basename(artifact.target_path).replace(/\.SKILL\.md$/, '')),
  );
  for (const entry of VNEXT_REQUIRED_DAILY_ENTRIES) {
    if (!skillNames.has(entry)) throw new MigrationPackError('BUNDLE_INVALID', `vNext bundle is missing daily entry Skill ${entry}.SKILL.md.`);
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
  const bundleId = `bundle-${sha256(JSON.stringify({ source, artifacts })).slice(0, 24)}`;
  const manifest: VNextBundleManifest = { schema_version: 1, kind: VNEXT_BUNDLE_KIND, bundle_id: bundleId, status: 'validated', legacy_compatibility: 'absent', source, artifacts };
  fs.writeFileSync(path.join(bundleDir, VNEXT_BUNDLE_FILE), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return loadAndValidateBundle(bundleDir, sourceRoot, mergeLegacySkillNames(sourceRoot, []));
}

function readBundleContent(bundleDir: string, artifact: VNextBundleArtifact): string {
  return fs.readFileSync(resolveRepoPath(bundleDir, artifact.source_path, 'vNext bundle source path'), 'utf8');
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
      if (/^workflow-system-.+\.SKILL\.md$/.test(path.basename(filePath))) throw new MigrationPackError('POST_INSTALL_LEGACY_SURFACE', `Legacy host Skill remains: ${path.relative(targetRoot, filePath)}`);
    }
  }
  const generatedSkillDir = path.join(targetRoot, ...[workflowHome, 'generated', 'workflow-skills'].filter(Boolean).join('/').split('/'));
  for (const filePath of listFiles(generatedSkillDir)) {
    if (legacySkillNames.some(name => path.basename(filePath).includes(name))) throw new MigrationPackError('POST_INSTALL_LEGACY_SURFACE', `Legacy generated Skill remains: ${path.relative(targetRoot, filePath)}`);
  }
}

type AtomicWrite = { path: string; content: string };

function applyAtomicFileTransaction(
  targetRoot: string,
  writes: AtomicWrite[],
  deletes: string[],
  verify: () => void,
): void {
  const resolvedTargetRoot = path.resolve(targetRoot);
  const normalizedWrites = new Map<string, AtomicWrite>();
  for (const write of writes) {
    const relative = normalizeRepoPath(write.path, 'transaction write path');
    const fullPath = resolveRepoPath(resolvedTargetRoot, relative, 'transaction write path');
    if (normalizedWrites.has(relative)) throw new MigrationPackError('INSTALL_CONFLICT', `duplicate transaction write path: ${relative}`);
    normalizedWrites.set(relative, { path: relative, content: write.content });
    void fullPath;
  }
  const deleteSet = new Set<string>();
  for (const relativeValue of deletes) {
    const relative = normalizeRepoPath(relativeValue, 'transaction delete path');
    if (!normalizedWrites.has(relative)) deleteSet.add(relative);
  }
  const stagingRoot = fs.mkdtempSync(path.join(path.dirname(resolvedTargetRoot), '.workflow-vnext-migration-'));
  const staged = new Map<string, string>();
  const backups: Array<{ target: string; backup: string }> = [];
  const newlyWritten: string[] = [];
  try {
    for (const [relative, write] of normalizedWrites.entries()) {
      const tempPath = path.join(stagingRoot, 'staged', `${staged.size}.tmp`);
      fs.mkdirSync(path.dirname(tempPath), { recursive: true });
      fs.writeFileSync(tempPath, write.content, 'utf8');
      staged.set(relative, tempPath);
    }
    const touched = [...new Set([...normalizedWrites.keys(), ...deleteSet])];
    for (const relative of touched) {
      const targetPath = resolveRepoPath(resolvedTargetRoot, relative, 'transaction target');
      if (!fs.existsSync(targetPath)) continue;
      const backupPath = path.join(stagingRoot, 'backup', `${backups.length}.bak`);
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
    verify();
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  } catch (error) {
    for (const targetPath of newlyWritten.reverse()) {
      if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { force: true });
    }
    for (const entry of backups.reverse()) {
      if (fs.existsSync(entry.target)) fs.rmSync(entry.target, { force: true });
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
  if (fs.existsSync(existingStatePath)) {
    try {
      // A completed installation is deliberately no longer an old project,
      // so the normal stale-source preflight cannot be used for replay.  Read
      // and validate the pack/bundle identity first, then verify the existing
      // vNext marker as an exact no-op.
      const candidatePack = loadAndValidatePack(options.packDir);
      validateSourceIdentity(candidatePack.source, getSourceIdentity(sourceRoot), 'Migration Pack source');
      const candidateTarget = validateTargetIdentityShape(candidatePack.target, 'Migration Pack target');
      const actualTarget = getProjectIdentity(loadProfile(profilePath(targetRoot)), targetRoot);
      const existing = parseStrictJson(existingStatePath) as Partial<VNextInstallState>;
      const bundleId = typeof existing.bundle_id === 'string' ? existing.bundle_id : '';
      const samePack = existing.migration_pack_id === candidatePack.pack_id && existing.target_identity === candidatePack.target.root_identity && actualTarget.root_identity === candidateTarget.root_identity;
      if (samePack && bundleId) {
        const knownLegacyNames = mergeLegacySkillNames(sourceRoot, candidatePack.legacy_surface.legacy_skill_names);
        const bundle = loadAndValidateBundle(options.bundleDir, sourceRoot, knownLegacyNames);
        if (bundle.bundle_id === bundleId) {
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
          const replayProfile = loadProfile(profilePath(targetRoot));
          validateNoLegacySurface(targetRoot, knownLegacyNames, candidatePack.legacy_surface.entries.filter(entry => entry.action === 'remove').map(entry => entry.path), bundle.artifacts.map(artifact => artifact.target_path), getWorkflowHome(replayProfile));
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
    bundle = loadAndValidateBundle(options.bundleDir, sourceRoot, knownLegacyNames);
  } catch (error) {
    const bundleError = asBundleError(error);
    const issue = bundleError ? { severity: 'error' as const, code: bundleError.code, message: bundleError.message } : { severity: 'error' as const, code: 'BUNDLE_INVALID' as const, message: String(error) };
    return { status: 'rejected', target_root: targetRoot, pack_id: pack.pack_id, blockers: [issue], warnings, planned_writes: [], planned_deletes: [] };
  }
  const profile = loadProfile(profilePath(targetRoot));
  const currentTaskPath = [getWorkflowHome(profile), CURRENT_TASK_FILE].filter(Boolean).join('/');
  const bundleCurrentTask = bundle.artifacts.find(artifact => artifact.target_path === currentTaskPath);
  if (!bundleCurrentTask) {
    return { status: 'rejected', target_root: targetRoot, pack_id: pack.pack_id, bundle_id: bundle.bundle_id, blockers: [{ severity: 'error', code: 'BUNDLE_INVALID', message: `vNext bundle must provide the pure-vNext ${currentTaskPath} document.` }], warnings, planned_writes: [], planned_deletes: [] };
  }
  const bundleTargetPaths = new Set(bundle.artifacts.map(artifact => artifact.target_path));
  for (const artifact of pack.artifacts) {
    if (bundleTargetPaths.has(artifact.target_path)) {
      return { status: 'rejected', target_root: targetRoot, pack_id: pack.pack_id, bundle_id: bundle.bundle_id, blockers: [{ severity: 'error', code: 'BUNDLE_TARGET_CONFLICT', message: `Pack and vNext bundle both target ${artifact.target_path}.`, path: artifact.target_path }], warnings, planned_writes: [], planned_deletes: [] };
    }
  }
  const writes: AtomicWrite[] = [];
  for (const artifact of pack.artifacts) {
    const contentPath = resolveRepoPath(options.packDir, artifact.content_path, `pack artifact ${artifact.content_path}`);
    writes.push({ path: artifact.target_path, content: fs.readFileSync(contentPath, 'utf8') });
  }
  for (const artifact of bundle.artifacts) writes.push({ path: artifact.target_path, content: readBundleContent(options.bundleDir, artifact) });
  for (const write of writes) {
    if (isFrozenPath(targetRoot, write.path)) {
      return { status: 'rejected', target_root: targetRoot, pack_id: pack.pack_id, bundle_id: bundle.bundle_id, blockers: [{ severity: 'error', code: 'FROZEN_PATH', message: 'Migration cannot replace a frozen vNext target path.', path: write.path }], warnings, planned_writes: [], planned_deletes: [] };
    }
  }
  const removedLegacyPaths = pack.legacy_surface.entries.filter(entry => entry.action === 'remove').map(entry => entry.path);
  const replacedLegacyPaths = pack.legacy_surface.entries.filter(entry => entry.action === 'replace').map(entry => entry.path);
  const installState: VNextInstallState = {
    schema_version: 1,
    kind: 'vnext-install-state',
    mode: 'pure-vnext',
    migration_pack_id: pack.pack_id,
    bundle_id: bundle.bundle_id,
    source_revision: pack.source.revision,
    source_tree_hash: pack.source.tree_hash,
    target_identity: pack.target.root_identity,
    installed_at: now(),
    managed_files: [...writes.map(write => ({ path: write.path, checksum: sha256(write.content), category: bundle.artifacts.find(artifact => artifact.target_path === write.path)?.category ?? 'migrated-document' })), { path: VNEXT_INSTALL_STATE_RELATIVE_PATH, checksum: '', category: 'vnext-install-state' }],
    removed_legacy_files: removedLegacyPaths,
    legacy_compatibility: 'absent',
  };
  const receipt = {
    schema_version: 1,
    kind: 'vnext-migration-receipt',
    migration_pack_id: pack.pack_id,
    bundle_id: bundle.bundle_id,
    source_revision: pack.source.revision,
    source_tree_hash: pack.source.tree_hash,
    target_identity: pack.target.root_identity,
    installed_at: installState.installed_at,
    converted_artifact_ids: pack.artifacts.map(artifact => artifact.stable_id),
    legacy_compatibility: 'absent',
  };
  writes.push({ path: VNEXT_INSTALL_STATE_RELATIVE_PATH, content: `${JSON.stringify(installState, null, 2)}\n` });
  writes.push({ path: VNEXT_MIGRATION_RECEIPT_RELATIVE_PATH, content: `${JSON.stringify(receipt, null, 2)}\n` });
  const plannedWrites = writes.map(write => write.path);
  const plannedDeletes = removedLegacyPaths.filter(relative => !bundleTargetPaths.has(relative) && !writes.some(write => write.path === relative));
  if (options.dryRun) return { status: 'ready', pack_id: pack.pack_id, bundle_id: bundle.bundle_id, target_root: targetRoot, blockers, warnings, planned_writes: plannedWrites, planned_deletes: plannedDeletes };

  try {
    applyAtomicFileTransaction(targetRoot, writes, plannedDeletes, () => {
      validateNoLegacySurface(targetRoot, knownLegacyNames, plannedDeletes, [...bundleTargetPaths], getWorkflowHome(profile));
      const statePath = path.join(targetRoot, ...VNEXT_INSTALL_STATE_RELATIVE_PATH.split('/'));
      if (!fs.existsSync(statePath)) throw new MigrationPackError('INSTALL_CONFLICT', 'vNext install state was not promoted.');
      const installedState = parseStrictJson(statePath);
      if (installedState.migration_pack_id !== pack.pack_id || installedState.bundle_id !== bundle.bundle_id || installedState.target_identity !== pack.target.root_identity) throw new MigrationPackError('INSTALL_CONFLICT', 'vNext install state read-back identity mismatch.');
    });
  } catch (error) {
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
