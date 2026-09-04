#!/usr/bin/env bun

/**
 * vNext bootstrap-project facade.
 *
 * This is the source-side administrative orchestrator. It resolves the
 * target and mode, validates the already-installed Distribution as a
 * read-only prerequisite, renders governance inputs from the vNext source
 * namespace, creates one typed bootstrap proposal, and delegates
 * promotion/read-back to the shared Runtime transaction boundary.
 * It never edits product code, creates an active task, or invokes the legacy
 * generator/runtime.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { parse, stringify } from 'yaml';
import {
  getSourceIdentity,
  isFrozenPath,
  validateCompletedMigration,
  validateVNextCurrentTaskDocument,
} from './vnext-migration-pack';
import {
  isDistributionOwnedTarget,
  validateInstalledDistribution,
} from './vibe-governance-distribution';
import { checkTargetRoot } from './guard-target-root';
import { resolveRoot } from './workflow-core';
import { validateVNextSource } from './vnext-source-contract';
import {
  applyBootstrapProjectProposal,
  BOOTSTRAP_MODES,
  computeBootstrapTargetIdentity,
  validateBootstrapProjectProposal,
  type BootstrapAsset,
  type BootstrapAuthorityEvidence,
  type BootstrapMode,
  type BootstrapProjectProposal,
  type BootstrapSemanticOperation,
} from '../runtime/vnext/src/bootstrap';
import { readCanonicalCurrentTask, validateVNextRuntimeContract } from '../runtime/vnext/src/kernel';
import type { ConditionalScopeAuthorization } from '../runtime/vnext/src/mutation-scope';
import { computeBootstrapPreimageHash } from '../runtime/vnext/src/bootstrap-support';

export const VNEXT_BOOTSTRAP_RECEIPT_RELATIVE_PATH = '.workflow-system/vnext/BOOTSTRAP_RECEIPT.json';
export const VNEXT_BOOTSTRAP_IN_PROGRESS_RELATIVE_PATH = '.workflow-system/vnext/BOOTSTRAP_IN_PROGRESS.json';
export const BOOTSTRAP_HOSTS = ['codex', 'claude', 'factory'] as const;
export type BootstrapHost = (typeof BOOTSTRAP_HOSTS)[number];

export type BootstrapTargetState = 'empty' | 'existing' | 'valid' | 'stale' | 'incomplete' | 'conflicting' | 'legacy' | 'governed' | 'in-progress';
export type BootstrapPlanStatus = 'ready' | 'needs-confirmation' | 'blocked' | 'replayed' | 'rejected' | 'installed';

export type BootstrapFact = {
  key: string;
  value: string;
  source: string;
  certainty: 'confirmed' | 'inferred' | 'unknown';
};

export type BootstrapProjectOptions = {
  sourceRoot?: string;
  /** Source-side release package used only to validate the installed target Distribution. */
  distributionPackageRoot?: string;
  targetRoot: string;
  mode: BootstrapMode;
  write?: boolean;
  projectName?: string;
  projectSlug?: string;
  host?: BootstrapHost;
  designBaseline?: Record<string, string>;
  designConfirmed?: boolean;
  inventoryFacts?: BootstrapFact[];
  confirmedFacts?: BootstrapFact[];
  adoptionConfirmed?: boolean;
  changedPaths?: string[];
  conditionalAuthorizations?: ConditionalScopeAuthorization[];
};

export type BootstrapIssue = {
  code: string;
  message: string;
  path?: string;
};

export type BootstrapEvidence = {
  id: string;
  kind: string;
  status: 'passed' | 'preserved' | 'deferred' | 'blocked';
  detail: string;
};

export type BootstrapReceipt = {
  schema_version: 1;
  kind: 'vnext-bootstrap-receipt';
  mode: BootstrapMode;
  target_identity: string;
  project: { name: string; slug: string };
  host: BootstrapHost;
  source: { revision: string; tree_hash: string };
  input_fingerprint: string;
  completed_at: string;
  managed_files: Array<{ path: string; checksum: string }>;
  legacy_compatibility: 'absent';
  recovery_boundary: 'in-progress-marker';
};

export type BootstrapPlan = {
  status: BootstrapPlanStatus;
  mode: BootstrapMode;
  target_root: string;
  target_state: BootstrapTargetState;
  target_identity: string;
  project: { name: string; slug: string };
  host: BootstrapHost;
  source: { revision: string; tree_hash: string };
  planned_writes: string[];
  planned_directories: string[];
  planned_deletes: string[];
  changed_paths: string[];
  blockers: BootstrapIssue[];
  warnings: BootstrapIssue[];
  evidence: BootstrapEvidence[];
  scope?: ReturnType<typeof validateBootstrapProjectProposal>['scope'];
  read_back_verified: boolean;
  replay: boolean;
  caller_obligation: string;
  // The proposal is internal to the facade and is omitted from CLI output.
  proposal?: BootstrapProjectProposal;
};

const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const HASH64 = /^[a-f0-9]{64}$/u;
const RECEIPT_KEYS = [
  'schema_version', 'kind', 'mode', 'target_identity', 'project', 'host', 'source',
  'input_fingerprint', 'completed_at', 'managed_files', 'legacy_compatibility', 'recovery_boundary',
] as const;
const BOOTSTRAP_MARKER_KEYS = [
  'schema_version', 'kind', 'target_identity', 'mode', 'source_revision', 'source_tree_hash',
  'planned_writes', 'planned_directories', 'recovery',
] as const;
const DESIGN_PATHS = [
  'docs/designs/architecture.md',
  'docs/designs/database.md',
  'docs/designs/detailed-design.md',
  'docs/designs/api-contracts.md',
  'docs/designs/domain-model.md',
] as const;
const CURRENT_TASK_RELATIVE_PATH = 'docs/workflow/CURRENT_TASK.md';
const INVENTORY_PATHS = [
  'docs/adoption/architecture-inventory.md',
  'docs/adoption/database-inventory.md',
  'docs/adoption/API_INVENTORY.md',
  'docs/adoption/RISK_REGISTER.md',
] as const;
const FULL_WORKFLOW_DOCS = [
  'docs/workflow/CONTRACTS.md',
  'docs/workflow/DECISIONS.md',
  'docs/workflow/STATUS.md',
  'docs/workflow/LESSONS.md',
  'docs/workflow/ROADMAP.md',
  'docs/workflow/WORKFLOW_GUIDE.md',
] as const;

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

function digest(value: unknown): string {
  return sha256(JSON.stringify(stableValue(value)));
}

function normalizeRelative(value: string): string {
  const normalized = value.trim().replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/\/+/gu, '/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//u.test(normalized) || normalized.split('/').some(segment => segment === '..' || segment.length === 0) || normalized.includes('*')) {
    throw new Error(`unsafe repository-relative path: ${value}`);
  }
  return normalized;
}

function targetPath(root: string, relative: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...normalizeRelative(relative).split('/'));
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  if (resolved !== resolvedRoot && !resolved.startsWith(prefix)) throw new Error(`target path escapes root: ${relative}`);
  return resolved;
}

function fileHash(filePath: string): string {
  return sha256(fs.readFileSync(filePath));
}

function safeSlug(value: string): string {
  const normalized = value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '');
  return normalized || 'project';
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

function readJsonObject(filePath: string, code: string): Record<string, unknown> {
  try {
    const value = readJson(filePath);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('must be an object');
    return value as Record<string, unknown>;
  } catch (error) {
    throw new BootstrapFacadeError(code, `${filePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isBootstrapForbiddenDistributionPath(relative: string): boolean {
  return isDistributionOwnedTarget(relative)
    || relative.startsWith('.workflow-system/runtime/')
    || relative.startsWith('.agents/skills/')
    || relative === '.workflow-system/vnext/DISTRIBUTION_STATE.json'
    || relative === '.workflow-system/vnext/DISTRIBUTION_IN_PROGRESS.json';
}

function isBootstrapGovernancePath(relative: string): boolean {
  return relative === 'AGENTS.md'
    || relative === 'CLAUDE.md'
    || relative === '.workflow-system/PROJECT_PROFILE.yaml'
    || relative.startsWith('docs/workflow/')
    || relative.startsWith('docs/designs/')
    || relative.startsWith('docs/adoption/');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function existingProfile(targetRoot: string): Record<string, unknown> | null {
  const filePath = targetPath(targetRoot, '.workflow-system/PROJECT_PROFILE.yaml');
  if (!fs.existsSync(filePath)) return null;
  try {
    const value = parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    if (!isRecord(value)) throw new Error('profile must be a mapping');
    return value;
  } catch (error) {
    throw new BootstrapFacadeError('PROFILE_INVALID', `PROJECT_PROFILE.yaml is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function profileProject(profile: Record<string, unknown> | null): { name: string; slug: string } | null {
  const project = profile?.project;
  if (!isRecord(project) || typeof project.name !== 'string' || typeof project.slug !== 'string') return null;
  return { name: project.name.trim(), slug: project.slug.trim() };
}

function packageProjectName(targetRoot: string): string | null {
  const packagePath = targetPath(targetRoot, 'package.json');
  if (!fs.existsSync(packagePath)) return null;
  try {
    const packageJson = readJsonObject(packagePath, 'PROFILE_INVALID');
    return typeof packageJson.name === 'string' && packageJson.name.trim() ? packageJson.name.trim() : null;
  } catch {
    return null;
  }
}

function resolveProject(targetRoot: string, options: BootstrapProjectOptions, receipt: BootstrapReceipt | null): { name: string; slug: string } {
  const profile = existingProfile(targetRoot);
  const profileIdentity = profileProject(profile);
  const name = options.projectName?.trim() || profileIdentity?.name || receipt?.project.name || packageProjectName(targetRoot) || path.basename(path.resolve(targetRoot));
  const slug = options.projectSlug?.trim() || profileIdentity?.slug || receipt?.project.slug || safeSlug(name);
  if (!SAFE_SLUG.test(slug)) throw new BootstrapFacadeError('PROFILE_INVALID', `project slug must be lowercase kebab-case: ${slug}`);
  if (profileIdentity && options.projectName && profileIdentity.name !== options.projectName.trim()) throw new BootstrapFacadeError('PROJECT_IDENTITY_CONFLICT', 'caller project name conflicts with the existing project profile.');
  if (profileIdentity && options.projectSlug && profileIdentity.slug !== options.projectSlug.trim()) throw new BootstrapFacadeError('PROJECT_IDENTITY_CONFLICT', 'caller project slug conflicts with the existing project profile.');
  const workflowHome = profile?.paths && isRecord(profile.paths) ? profile.paths.workflow_home : undefined;
  if (workflowHome !== undefined && workflowHome !== 'docs/workflow') throw new BootstrapFacadeError('PROJECT_IDENTITY_CONFLICT', 'existing paths.workflow_home is not the canonical vNext workflow home.');
  return { name, slug };
}

function listTopLevelNames(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).map(entry => entry.name).sort();
}

function hasMeaningfulImplementation(targetRoot: string): boolean {
  const names = listTopLevelNames(targetRoot);
  if (names.some(name => ['src', 'app', 'lib', 'packages', 'server', 'client'].includes(name))) return true;
  const meaningfulExtensions = /\.(?:ts|tsx|js|jsx|py|go|rs|java|cs|php|rb|swift)$/iu;
  return names.some(name => meaningfulExtensions.test(name));
}

function hasLegacySurface(targetRoot: string): boolean {
  const hasEntries = (relative: string): boolean => {
    const directory = targetPath(targetRoot, relative);
    return fs.existsSync(directory) && fs.statSync(directory).isDirectory() && fs.readdirSync(directory).length > 0;
  };
  const protocolPath = targetPath(targetRoot, '.workflow-system/WORKFLOW_PROTOCOL.md');
  if (fs.existsSync(protocolPath)) {
    const protocol = fs.readFileSync(protocolPath, 'utf8');
    if (/Protocol-Version\s*:\s*0\./iu.test(protocol) && !/^kind:\s*vnext-protocol\s*$/imu.test(protocol)) return true;
  }
  if (fs.existsSync(targetPath(targetRoot, '.workflow-system/WORKFLOW_CAPABILITIES.yaml'))) return true;
  if (fs.existsSync(targetPath(targetRoot, '.workflow-system/install-state.json'))) return true;
  if (hasEntries('templates/skills') || hasEntries('templates/docs')) return true;
  if (hasEntries('docs/workflow/generated')) return true;
  for (const host of ['.claude/skills', '.codex/skills', '.factory/skills']) {
    const directory = targetPath(targetRoot, host);
    if (!fs.existsSync(directory)) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('workflow-system-')) return true;
      if (entry.isDirectory() && entry.name.startsWith('workflow-system-')) return true;
    }
  }
  return false;
}

function isVNextMarkerFile(relative: string, targetRoot: string): boolean {
  const filePath = targetPath(targetRoot, relative);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  const head = fs.readFileSync(filePath, 'utf8').slice(0, 1200);
  return /vnext|vNext/iu.test(head) || relative.startsWith('.workflow-system/vnext/');
}

function readReceipt(targetRoot: string): BootstrapReceipt | null {
  const filePath = targetPath(targetRoot, VNEXT_BOOTSTRAP_RECEIPT_RELATIVE_PATH);
  if (!fs.existsSync(filePath)) return null;
  const raw = readJsonObject(filePath, 'BOOTSTRAP_RECEIPT_INVALID');
  if (Object.keys(raw).sort().join('|') !== [...RECEIPT_KEYS].sort().join('|')) throw new BootstrapFacadeError('BOOTSTRAP_RECEIPT_INVALID', 'bootstrap receipt has an unsupported schema.');
  const project = raw.project;
  const source = raw.source;
  if (raw.schema_version !== 1 || raw.kind !== 'vnext-bootstrap-receipt' || !BOOTSTRAP_MODES.includes(raw.mode as BootstrapMode) || typeof raw.target_identity !== 'string' || !isRecord(project) || typeof project.name !== 'string' || typeof project.slug !== 'string' || !BOOTSTRAP_HOSTS.includes(raw.host as BootstrapHost) || !isRecord(source) || typeof source.revision !== 'string' || typeof source.tree_hash !== 'string' || !HASH64.test(source.tree_hash) || typeof raw.input_fingerprint !== 'string' || !HASH64.test(raw.input_fingerprint) || typeof raw.completed_at !== 'string' || raw.legacy_compatibility !== 'absent' || raw.recovery_boundary !== 'in-progress-marker') {
    throw new BootstrapFacadeError('BOOTSTRAP_RECEIPT_INVALID', 'bootstrap receipt identity or schema fields are invalid.');
  }
  if (!Array.isArray(raw.managed_files) || raw.managed_files.length === 0) throw new BootstrapFacadeError('BOOTSTRAP_RECEIPT_INVALID', 'bootstrap receipt managed_files must be non-empty.');
  const managedFiles = raw.managed_files.map((value, index) => {
    if (!isRecord(value) || typeof value.path !== 'string' || typeof value.checksum !== 'string' || !HASH64.test(value.checksum)) throw new BootstrapFacadeError('BOOTSTRAP_RECEIPT_INVALID', `managed_files[${index}] is invalid.`);
    const relative = normalizeRelative(value.path);
    if (isBootstrapForbiddenDistributionPath(relative)) throw new BootstrapFacadeError('BOOTSTRAP_RECEIPT_INVALID', `managed_files[${index}] declares Distribution-owned software: ${relative}`);
    if (!isBootstrapGovernancePath(relative)) throw new BootstrapFacadeError('BOOTSTRAP_RECEIPT_INVALID', `managed_files[${index}] is outside the Bootstrap-owned governance surface: ${relative}`);
    return { path: relative, checksum: value.checksum };
  });
  return {
    schema_version: 1,
    kind: 'vnext-bootstrap-receipt',
    mode: raw.mode as BootstrapMode,
    target_identity: raw.target_identity,
    project: { name: project.name, slug: project.slug },
    host: raw.host as BootstrapHost,
    source: { revision: source.revision, tree_hash: source.tree_hash },
    input_fingerprint: raw.input_fingerprint,
    completed_at: raw.completed_at,
    managed_files: managedFiles,
    legacy_compatibility: 'absent',
    recovery_boundary: 'in-progress-marker',
  };
}

function readBootstrapMarker(targetRoot: string): Record<string, unknown> {
  const markerPath = targetPath(targetRoot, VNEXT_BOOTSTRAP_IN_PROGRESS_RELATIVE_PATH);
  const marker = readJsonObject(markerPath, 'BOOTSTRAP_IN_PROGRESS_INVALID');
  if (
    Object.keys(marker).sort().join('|') !== [...BOOTSTRAP_MARKER_KEYS].sort().join('|')
    || marker.schema_version !== 1
    || marker.kind !== 'vnext-bootstrap-in-progress'
    || marker.recovery !== 'fail-closed-explicit-recovery'
    || !BOOTSTRAP_MODES.includes(marker.mode as BootstrapMode)
    || typeof marker.target_identity !== 'string'
    || marker.target_identity !== computeBootstrapTargetIdentity(targetRoot)
    || typeof marker.source_revision !== 'string'
    || !HASH64.test(String(marker.source_tree_hash))
  ) {
    throw new BootstrapFacadeError('BOOTSTRAP_IN_PROGRESS_INVALID', 'interruption marker identity or schema is invalid; recovery is blocked.');
  }
  for (const field of ['planned_writes', 'planned_directories'] as const) {
    const values = marker[field];
    if (!Array.isArray(values) || values.some(value => typeof value !== 'string')) throw new BootstrapFacadeError('BOOTSTRAP_IN_PROGRESS_INVALID', field + ' must be an array of paths.');
    const normalized = values.map(value => normalizeRelative(value));
    if (new Set(normalized).size !== normalized.length) throw new BootstrapFacadeError('BOOTSTRAP_IN_PROGRESS_INVALID', field + ' contains duplicate paths.');
    marker[field] = normalized;
  }
  return marker;
}

function verifyReceiptManagedFiles(targetRoot: string, receipt: BootstrapReceipt): void {
  if (receipt.target_identity !== computeBootstrapTargetIdentity(targetRoot)) throw new BootstrapFacadeError('BOOTSTRAP_RECEIPT_READ_BACK_FAILED', 'bootstrap receipt target identity does not match the target root.');
  for (const file of receipt.managed_files) {
    const filePath = targetPath(targetRoot, file.path);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile() || fileHash(filePath) !== file.checksum) {
      throw new BootstrapFacadeError('BOOTSTRAP_RECEIPT_READ_BACK_FAILED', 'managed bootstrap asset is missing or drifted: ' + file.path);
    }
  }
}

function verifyReceiptAssetSet(receipt: BootstrapReceipt, assets: readonly BootstrapAsset[]): void {
  const expected = assets
    .filter(asset => asset.path !== VNEXT_BOOTSTRAP_RECEIPT_RELATIVE_PATH)
    .map(asset => ({ path: asset.path, checksum: sha256(Buffer.from(asset.content, 'utf8')) }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const actual = receipt.managed_files.slice().sort((left, right) => left.path.localeCompare(right.path));
  if (actual.length !== expected.length || actual.some((file, index) => file.path !== expected[index].path || file.checksum !== expected[index].checksum)) {
    throw new BootstrapFacadeError('BOOTSTRAP_RECEIPT_READ_BACK_FAILED', 'bootstrap receipt managed_files does not match the generated asset set.');
  }
}

export function classifyBootstrapTarget(targetRoot: string): { state: BootstrapTargetState; receipt: BootstrapReceipt | null; reasons: string[] } {
  const resolved = path.resolve(targetRoot);
  const markerPath = targetPath(resolved, VNEXT_BOOTSTRAP_IN_PROGRESS_RELATIVE_PATH);
  if (fs.existsSync(markerPath)) return { state: 'in-progress', receipt: null, reasons: ['an explicit bootstrap interruption marker is present'] };
  let receipt: BootstrapReceipt | null = null;
  try {
    receipt = readReceipt(resolved);
  } catch (error) {
    return { state: 'conflicting', receipt: null, reasons: [error instanceof Error ? error.message : String(error)] };
  }
  if (hasLegacySurface(resolved)) return { state: 'legacy', receipt, reasons: ['a compatibility or legacy workflow surface is present; use the offline migration boundary'] };
  const targetIdentity = computeBootstrapTargetIdentity(resolved);
  if (receipt && receipt.target_identity !== targetIdentity) {
    return { state: 'conflicting', receipt, reasons: ['bootstrap receipt target identity does not match the current target root'] };
  }
  let profile: Record<string, unknown> | null = null;
  try {
    profile = existingProfile(resolved);
    const profileVNext = profile?.vnext;
    if (isRecord(profileVNext) && profileVNext.target_identity !== undefined && profileVNext.target_identity !== targetIdentity) {
      return { state: 'conflicting', receipt, reasons: ['project profile target identity does not match the current target root'] };
    }
  } catch (error) {
    return { state: 'conflicting', receipt, reasons: [error instanceof Error ? error.message : String(error)] };
  }
  const migrationStatePath = targetPath(resolved, '.workflow-system/vnext/INSTALL_STATE.json');
  const migrationReceiptPath = targetPath(resolved, '.workflow-system/vnext/MIGRATION_RECEIPT.json');
  if ((fs.existsSync(migrationStatePath) || fs.existsSync(migrationReceiptPath)) && receipt) {
    return { state: 'conflicting', receipt, reasons: ['Bootstrap Receipt cannot coexist with Migration Pack completed-state markers.'] };
  }
  if (receipt) {
    const missing = receipt.managed_files.filter(file => !fs.existsSync(targetPath(resolved, file.path)) || !fs.statSync(targetPath(resolved, file.path)).isFile() || fileHash(targetPath(resolved, file.path)) !== file.checksum);
    return missing.length === 0 ? { state: 'valid', receipt, reasons: [] } : { state: 'stale', receipt, reasons: missing.map(file => `managed asset drifted: ${file.path}`) };
  }
  try {
    const migrationProvenance = validateCompletedMigration(resolved);
    if (migrationProvenance) {
      return { state: 'governed', receipt: null, reasons: ['the project was governed through the Migration Pack completed-state verifier; a Bootstrap Receipt is not required'] };
    }
  } catch (error) {
    return { state: 'conflicting', receipt: null, reasons: [`Migration Pack completed-state admission failed: ${error instanceof Error ? error.message : String(error)}`] };
  }
  const governanceSignals = [
    '.workflow-system/PROJECT_PROFILE.yaml',
    'docs/workflow/CURRENT_TASK.md',
    'docs/workflow/CONTRACTS.md',
    'docs/workflow/DECISIONS.md',
    'docs/workflow/STATUS.md',
    'docs/workflow/LESSONS.md',
    'docs/workflow/ROADMAP.md',
    'docs/workflow/WORKFLOW_GUIDE.md',
  ];
  if (governanceSignals.some(signal => fs.existsSync(targetPath(resolved, signal)))) return { state: 'incomplete', receipt: null, reasons: ['vNext governance assets exist without a valid bootstrap or Migration Pack provenance'] };
  return { state: hasMeaningfulImplementation(resolved) ? 'existing' : 'empty', receipt: null, reasons: [] };
}

function renderProfile(
  project: { name: string; slug: string },
  targetIdentity: string,
  mode: BootstrapMode,
  host: BootstrapHost,
  existing: Record<string, unknown> | null,
): string {
  const existingProject = existing?.project && isRecord(existing.project) ? existing.project : {};
  const existingPaths = existing?.paths && isRecord(existing.paths) ? existing.paths : {};
  const existingVNext = existing?.vnext && isRecord(existing.vnext) ? existing.vnext : {};
  const existingHosts = Array.isArray(existingProject.primary_hosts)
    ? existingProject.primary_hosts.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  return stringify({
    ...(existing ?? {}),
    schema_version: 1,
    kind: 'vnext-project-profile',
    project: {
      ...existingProject,
      name: project.name,
      slug: project.slug,
      type: typeof existingProject.type === 'string' && existingProject.type.trim() ? existingProject.type : 'application',
      primary_hosts: existingHosts.length > 0 ? existingHosts : [host],
    },
    paths: {
      ...existingPaths,
      workflow_home: 'docs/workflow',
    },
    vnext: {
      ...existingVNext,
      bootstrap_mode: mode,
      target_identity: targetIdentity,
      source_contract: '.workflow-system/vnext/SOURCE_CONTRACT.yaml',
      runtime_contract: '.workflow-system/vnext/RUNTIME_CONTRACT.yaml',
      runtime_entrypoint: '.workflow-system/runtime/dist/cli.js',
      legacy_compatibility: 'absent',
    },
  });
}

function renderGuidance(project: { name: string; slug: string }): string {
  return [
    '<!-- vNext bootstrap managed guidance; preserve target-owned additions outside this block. -->',
    `# ${project.name} workflow guidance`,
    '',
    'This project uses the pure vNext workflow surface.',
    '',
    '- Use `bootstrap-project` only for project setup or explicit realignment.',
    '- Use `prepare-task` before executing a new task.',
    '- Use `execute-step` only for the admitted current step.',
    '- Use `review-change`, `debug-task`, `task-lifecycle`, `capture-work-item`, and `close-task` according to their contracts.',
    '- The project-local Runtime and canonical `docs/workflow/CURRENT_TASK.md` are authoritative for task state.',
    '- Do not edit governance state directly or treat discovery context as write authority.',
    '',
    `Project slug: ${project.slug}`,
    '',
  ].join('\n');
}

function renderWorkflowGuide(project: { name: string; slug: string }): string {
  return [
    '# vNext Workflow Guide',
    '',
    `Project: ${project.name} (${project.slug})`,
    '',
    '## Administrative entry',
    '',
    '- `bootstrap-project`: design, greenfield, inventory, adopt, or realign.',
    '',
    '## Daily entries',
    '',
    '- `prepare-task` → `execute-step` → optional `review-change` / `debug-task` → `close-task`.',
    '- `task-lifecycle` owns pause, interrupt, resume, and supersede transitions.',
    '- `capture-work-item` remains record-only.',
    '',
    '## Authoritative state',
    '',
    '- Runtime state is read from canonical `CURRENT_TASK.md`.',
    '- Contracts, Decisions, Status, and host guidance are changed through typed Runtime proposals.',
    '- Bootstrap completion requires Distribution prerequisite validation, scope admission, governance-only promotion, and read-back.',
    '',
  ].join('\n');
}

function renderContracts(project: { name: string; slug: string }, facts: BootstrapFact[] = []): string {
  const confirmed = facts.filter(fact => fact.certainty === 'confirmed');
  return [
    '# vNext Contracts',
    '',
    `Project: ${project.name} (${project.slug})`,
    '',
    '## Confirmed boundaries',
    '',
    '- Bootstrap writes only the admitted workflow asset set.',
    '- Task state remains in canonical `CURRENT_TASK.md`.',
    ...confirmed.map(fact => `- ${fact.key}: ${fact.value} (source: ${fact.source})`),
    '',
    '## Candidate status',
    '',
    '- These entries are the confirmed bootstrap baseline; unconfirmed facts remain outside the locked Contract.',
    '',
    '## vNext Contract Records',
    '',
    '- Normal close-task Contract admissions are appended here through the typed Runtime operation; this section is not edited directly by a Skill.',
    '',
  ].join('\n');
}

function renderDecisions(project: { name: string; slug: string }, mode: BootstrapMode, facts: BootstrapFact[] = [], draft = false): string {
  const confirmed = facts.filter(fact => fact.certainty === 'confirmed');
  const unresolved = facts.filter(fact => fact.certainty !== 'confirmed');
  return [
    '# vNext Decisions',
    '',
    `Project: ${project.name} (${project.slug})`,
    '',
    '## Bootstrap decision',
    '',
    `- mode: ${mode}`,
    `- status: ${draft ? 'draft' : 'confirmed'}`,
    '- authority: project owner',
    '',
    '## Confirmed facts',
    '',
    ...(confirmed.length > 0 ? confirmed.map(fact => `- ${fact.key}: ${fact.value} (source: ${fact.source})`) : ['- none']),
    '',
    '## Inferred or unknown facts',
    '',
    ...(unresolved.length > 0 ? unresolved.map(fact => `- ${fact.key}: ${fact.value} [${fact.certainty}; source: ${fact.source}]`) : ['- none']),
    '',
    '## vNext Decision Records',
    '',
    '- Normal close-task Decision admissions are appended here through the typed Runtime operation; this section is not edited directly by a Skill.',
    '',
  ].join('\n');
}

function renderStatus(project: { name: string; slug: string }, mode: BootstrapMode): string {
  return [
    '# STATUS.md',
    '',
    '## 项目概览',
    '',
    `- 项目：${project.name}`,
    `- slug：${project.slug}`,
    `- bootstrap mode：${mode}`,
    '',
    '## ✅ 已完成且稳定',
    '',
    '- Governance assets generated after the installed Distribution was validated read-only.',
    '- Project profile and canonical task baseline read back successfully.',
    '',
    '## 🔨 正在开发',
    '',
    '- No active task exists. The next task must be prepared through the daily Runtime path.',
    '',
    '## ⚠️ 当前阻塞',
    '',
    '- None recorded by bootstrap.',
    '',
  ].join('\n');
}

function renderLessons(): string {
  return [
    '# LESSONS.md',
    '',
    '## Reusable lessons',
    '',
    '- Bootstrap evidence is recorded as a receipt and must not be inferred from file existence alone.',
    '- Unknown adoption facts remain visible until a source and authority promote them.',
    '',
  ].join('\n');
}

function renderRoadmap(project: { name: string; slug: string }, mode: BootstrapMode, designBaseline?: Record<string, string>): string {
  return [
    '# ROADMAP.md',
    '',
    `Project: ${project.name} (${project.slug})`,
    '',
    '## Current boundary',
    '',
    `- ${mode} bootstrap completed as an administrative workflow operation.`,
    '',
    '## Next boundary',
    '',
    '- Prepare a concrete task with confirmed acceptance, exact mutation scope, and minimum-sufficient evidence.',
    ...(designBaseline ? ['', '## Design baseline consumed', '', ...Object.keys(designBaseline).sort().map(key => `- ${key}`)] : []),
    '',
  ].join('\n');
}

function renderDesignDocument(filePath: string, baseline: Record<string, string>): string {
  const key = path.basename(filePath, '.md');
  const value = baseline[key] ?? baseline[filePath] ?? 'No confirmed content was supplied for this design section.';
  return [`# Design baseline: ${key}`, '', '## Authority', '', '- source: caller-provided confirmed design baseline', '- certainty: confirmed or explicitly awaiting confirmation', '', '## Content', '', value, ''].join('\n');
}

function renderBaselineDoc(baseline: Record<string, string>): string {
  return [
    '# vNext Design Baselines',
    '',
    'The following design inputs are caller-provided proposals. They do not authorize feature implementation.',
    '',
    ...Object.keys(baseline).sort().map(key => `- ${key}: ${baseline[key]}`),
    '',
  ].join('\n');
}

function renderInventoryFile(title: string, targetRoot: string, facts: BootstrapFact[] = []): string {
  const names = listTopLevelNames(targetRoot);
  return [
    `# ${title}`,
    '',
    '## Observed project surface',
    '',
    ...(names.length > 0 ? names.map(name => `- ${name}`) : ['- empty target root']),
    '',
    '## Evidence and certainty',
    '',
    ...(facts.length > 0 ? facts.map(fact => `- ${fact.key}: ${fact.value} [${fact.certainty}; source: ${fact.source}]`) : ['- observed from target-root directory listing']),
    '',
  ].join('\n');
}

function renderRiskRegister(facts: BootstrapFact[] = []): string {
  const unknown = facts.filter(fact => fact.certainty !== 'confirmed');
  return [
    '# Adoption Risk Register',
    '',
    '## Open evidence gaps',
    '',
    ...(unknown.length > 0 ? unknown.map(fact => `- ${fact.key}: ${fact.value}; source=${fact.source}; disposition=confirm before promotion`) : ['- none recorded']),
    '',
  ].join('\n');
}

function readBootstrapCurrentTask(sourceRoot: string): string {
  const relativePath = 'templates/vnext/bootstrap/CURRENT_TASK.md';
  const filePath = targetPath(sourceRoot, relativePath);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new BootstrapFacadeError('SOURCE_CONTRACT_INVALID', `Bootstrap governance template is missing: ${relativePath}`);
  const content = fs.readFileSync(filePath, 'utf8');
  try {
    validateVNextCurrentTaskDocument(content, relativePath);
  } catch (error) {
    throw new BootstrapFacadeError('SOURCE_CONTRACT_INVALID', error instanceof Error ? error.message : String(error));
  }
  return content;
}

function mergeAssets(...groups: BootstrapAsset[][]): BootstrapAsset[] {
  const map = new Map<string, BootstrapAsset>();
  for (const asset of groups.flat()) {
    if (map.has(asset.path)) throw new BootstrapFacadeError('BOOTSTRAP_TARGET_CONFLICT', `generated asset path is duplicated: ${asset.path}`);
    map.set(asset.path, asset);
  }
  return [...map.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function semanticOperations(assets: readonly BootstrapAsset[], mode: BootstrapMode): BootstrapSemanticOperation[] {
  const paths = new Set(assets.map(asset => asset.path));
  const operations: BootstrapSemanticOperation[] = [];
  const add = (operation_kind: BootstrapSemanticOperation['operation_kind'], target_paths: string[]): void => {
    const existing = target_paths.filter(target => paths.has(target));
    if (existing.length > 0) operations.push({ operation_kind, target_paths: existing, evidence_refs: [`evidence:bootstrap:${mode}:${operation_kind}`] });
  };
  add('decision-record-transaction', ['docs/workflow/DECISIONS.md']);
  add('contract-candidate-commit', ['docs/workflow/CONTRACTS.md']);
  add('project-status-transaction', ['docs/workflow/STATUS.md']);
  add('paired-host-guidance-transaction', ['AGENTS.md', 'CLAUDE.md']);
  return operations;
}

function renderScopeDocument(allowed: readonly string[], conditional: readonly string[]): string {
  const conditionalSet = new Set(conditional);
  const allowedOnly = allowed.filter(file => !conditionalSet.has(file));
  return [
    '## 允许修改范围',
    '',
    '### Allowed Files',
    '',
    ...allowedOnly.map(file => `- \`${file}\``),
    '',
    '### Conditional Files',
    '',
    ...(conditional.length > 0 ? conditional.map(file => `- \`${file}\` when the caller provides exact evidence and authority`) : ['- none']),
    '',
    '## 禁止修改范围',
    '',
    '### Forbidden Files',
    '',
    '- `.git/**`',
    '- `src/**`',
    '- `app/**`',
    '- `lib/**`',
    '- `packages/**`',
    '- `package.json`',
    '- `package-lock.json`',
    '- `node_modules/**`',
    '',
  ].join('\n');
}

function normalizeChangedPaths(paths: readonly string[] | undefined): string[] {
  // Preserve duplicates until the shared Runtime proposal validator sees
  // them. Silently deduplicating caller input would turn a contract
  // violation into an admitted diff and weaken the exact changed_paths duty.
  return (paths ?? []).map(normalizeRelative).sort();
}

function renderReceipt(
  mode: BootstrapMode,
  targetIdentity: string,
  project: { name: string; slug: string },
  host: BootstrapHost,
  source: { revision: string; tree_hash: string },
  inputFingerprint: string,
  assets: readonly BootstrapAsset[],
): string {
  const receipt: BootstrapReceipt = {
    schema_version: 1,
    kind: 'vnext-bootstrap-receipt',
    mode,
    target_identity: targetIdentity,
    project,
    host,
    source,
    input_fingerprint: inputFingerprint,
    completed_at: new Date().toISOString(),
    managed_files: assets.map(asset => ({ path: asset.path, checksum: sha256(Buffer.from(asset.content, 'utf8')) })).sort((left, right) => left.path.localeCompare(right.path)),
    legacy_compatibility: 'absent',
    recovery_boundary: 'in-progress-marker',
  };
  return `${JSON.stringify(receipt, null, 2)}\n`;
}

function receiptMatches(receipt: BootstrapReceipt, expected: { mode: BootstrapMode; targetIdentity: string; project: { name: string; slug: string }; host: BootstrapHost; inputFingerprint: string }): boolean {
  return receipt.mode === expected.mode
    && receipt.target_identity === expected.targetIdentity
    && digest(receipt.project) === digest(expected.project)
    && receipt.host === expected.host
    && receipt.input_fingerprint === expected.inputFingerprint;
}

function existingIsWorkflowOwned(targetRoot: string, relative: string, receipt: BootstrapReceipt | null = null): boolean {
  const filePath = targetPath(targetRoot, relative);
  if (!fs.existsSync(filePath)) return true;
  if (isFrozenPath(targetRoot, relative)) return false;
  if (receipt?.managed_files.some(file => file.path === relative)) return true;
  if (relative.startsWith('.workflow-system/')) return true;
  if (relative === 'AGENTS.md' || relative === 'CLAUDE.md') return isVNextMarkerFile(relative, targetRoot);
  if (relative.startsWith('.agents/skills/')) return isVNextMarkerFile(relative, targetRoot);
  if (relative.startsWith('.codex/skills/') || relative.startsWith('.claude/skills/') || relative.startsWith('.factory/skills/')) return isVNextMarkerFile(relative, targetRoot);
  if (relative.startsWith('docs/workflow/') || relative.startsWith('docs/designs/') || relative.startsWith('docs/adoption/')) return isVNextMarkerFile(relative, targetRoot);
  return false;
}

function verifyExistingBootstrapReadBack(
  targetRoot: string,
  mode: BootstrapMode,
  targetIdentity: string,
  project: { name: string; slug: string },
  receipt: BootstrapReceipt,
  assets: readonly BootstrapAsset[],
): BootstrapEvidence[] {
  verifyReceiptManagedFiles(targetRoot, receipt);
  verifyReceiptAssetSet(receipt, assets);
  const profile = existingProfile(targetRoot);
  if (['greenfield', 'adopt', 'realign'].includes(mode)) {
    const profileIdentity = profile?.vnext && isRecord(profile.vnext) ? profile.vnext.target_identity : undefined;
    if (profileIdentity !== targetIdentity) throw new BootstrapFacadeError('BOOTSTRAP_IDENTITY_CONFLICT', 'project profile target_identity does not match the replay target.');
    const current = readCanonicalCurrentTask(targetRoot);
    if (current.runtimeState.workflow_status !== 'closed' || current.runtimeState.lifecycle_state !== 'archived' || current.runtimeState.active_step_status !== 'completed' || (mode !== 'realign' && current.runtimeState.task_id !== '000')) {
      throw new BootstrapFacadeError('BOOTSTRAP_TASK_STATE_INVALID', 'replay target does not retain a closed + archived canonical task state.');
    }
    verifyNoLegacySurface(targetRoot);
  }
  return [{
    id: 'replay-read-back',
    kind: 'receipt-and-authoritative-state-read-back',
    status: 'passed',
    detail: 'matching ' + mode + ' receipt, project identity ' + project.slug + ', and Bootstrap-managed governance assets verified; Distribution remains lifecycle-owned.',
  }];
}

function makeProfileAsset(targetRoot: string, project: { name: string; slug: string }, targetIdentity: string, mode: BootstrapMode, host: BootstrapHost): BootstrapAsset {
  return { path: '.workflow-system/PROJECT_PROFILE.yaml', category: 'config', content: renderProfile(project, targetIdentity, mode, host, existingProfile(targetRoot)) };
}

function renderGovernanceDocument(file: string, project: { name: string; slug: string }, mode: BootstrapMode, facts: BootstrapFact[], designBaseline?: Record<string, string>): string {
  if (file.endsWith('/CONTRACTS.md')) return renderContracts(project, facts);
  if (file.endsWith('/DECISIONS.md')) return renderDecisions(project, mode, facts);
  if (file.endsWith('/STATUS.md')) return renderStatus(project, mode);
  if (file.endsWith('/LESSONS.md')) return renderLessons();
  if (file.endsWith('/ROADMAP.md')) return renderRoadmap(project, mode, designBaseline);
  return renderWorkflowGuide(project);
}

function makeGovernanceAssets(sourceRoot: string, targetRoot: string, project: { name: string; slug: string }, targetIdentity: string, mode: BootstrapMode, host: BootstrapHost, facts: BootstrapFact[], designBaseline?: Record<string, string>): BootstrapAsset[] {
  const generated: BootstrapAsset[] = [
    makeProfileAsset(targetRoot, project, targetIdentity, mode, host),
    { path: CURRENT_TASK_RELATIVE_PATH, category: 'generated', content: readBootstrapCurrentTask(sourceRoot) },
    ...FULL_WORKFLOW_DOCS.map(file => ({ path: file, category: 'governance' as const, content: renderGovernanceDocument(file, project, mode, facts, designBaseline) })),
    { path: 'AGENTS.md', category: 'governance', content: renderGuidance(project) },
    { path: 'CLAUDE.md', category: 'governance', content: renderGuidance(project) },
  ];
  return generated;
}

function modeFacts(options: BootstrapProjectOptions): BootstrapFact[] {
  const facts = options.mode === 'inventory'
    ? (options.inventoryFacts ?? options.confirmedFacts ?? [])
    : (options.confirmedFacts ?? []);
  return facts.map((fact, index) => {
    if (!fact || typeof fact.key !== 'string' || typeof fact.value !== 'string' || typeof fact.source !== 'string' || !['confirmed', 'inferred', 'unknown'].includes(fact.certainty)) throw new BootstrapFacadeError('BOOTSTRAP_INPUT_INVALID', `${options.mode === 'inventory' ? 'inventoryFacts' : 'confirmedFacts'}[${index}] is invalid.`);
    return { key: fact.key.trim(), value: fact.value.trim(), source: fact.source.trim(), certainty: fact.certainty };
  });
}

function designFacts(options: BootstrapProjectOptions): Record<string, string> {
  const baseline = options.designBaseline ?? {};
  const entries = Object.entries(baseline).filter(([key, value]) => key.trim() && typeof value === 'string' && value.trim());
  return Object.fromEntries(entries.map(([key, value]) => [key.trim(), value.trim()]));
}

function modePrecondition(targetRoot: string, mode: BootstrapMode, state: BootstrapTargetState, options: BootstrapProjectOptions, baseline: Record<string, string>, facts: BootstrapFact[]): BootstrapIssue[] {
  const blockers: BootstrapIssue[] = [];
  if (['greenfield', 'adopt', 'realign'].includes(mode) && fs.existsSync(targetPath(targetRoot, CURRENT_TASK_RELATIVE_PATH))) {
    try {
      const current = readCanonicalCurrentTask(targetRoot);
      if (current.runtimeState.workflow_status !== 'closed'
        || current.runtimeState.lifecycle_state !== 'archived'
        || current.runtimeState.active_step_status !== 'completed'
        || (mode !== 'realign' && current.runtimeState.task_id !== '000')) {
        blockers.push({ code: 'BOOTSTRAP_TASK_STATE_INVALID', message: mode === 'realign'
          ? 'realign cannot run over an active or invalid canonical CURRENT_TASK; close or recover the task through the daily Runtime first.'
          : 'bootstrap cannot replace an existing active or non-baseline canonical CURRENT_TASK; continue through the daily Runtime or close/recover it first.' });
      }
    } catch (error) {
      blockers.push({ code: 'BOOTSTRAP_TASK_STATE_INVALID', message: `existing canonical CURRENT_TASK is not a readable pure vNext bootstrap baseline: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  if (state === 'in-progress') blockers.push({ code: 'BOOTSTRAP_IN_PROGRESS', message: 'an interrupted bootstrap marker requires explicit recovery before retry.' });
  if (state === 'legacy') blockers.push({ code: 'MIGRATION_REQUIRED', message: 'legacy/compatibility assets are outside bootstrap; run the offline migration boundary.' });
  if (state === 'conflicting') blockers.push({ code: 'BOOTSTRAP_CONFLICT', message: 'existing bootstrap receipt or asset identity is conflicting.' });
  if (state === 'governed' && mode !== 'realign') blockers.push({ code: 'BOOTSTRAP_NOT_REQUIRED', message: 'Migration Pack provenance and canonical governance assets already establish a governed vNext project; Bootstrap is not required.' });
  if (state === 'governed' && mode !== 'realign') return blockers;
  if (mode === 'design') {
    if (state !== 'empty' && state !== 'existing' && state !== 'valid') blockers.push({ code: 'BOOTSTRAP_STATE_INVALID', message: 'design mode only accepts an uninitialized target or a valid replay.' });
    if (Object.keys(baseline).length === 0) blockers.push({ code: 'DESIGN_EVIDENCE_MISSING', message: 'design mode requires a caller-provided design baseline.' });
  }
  if (mode === 'greenfield') {
    if (state !== 'valid' && state !== 'empty' && !(state === 'existing' && !hasMeaningfulImplementation(targetRoot))) blockers.push({ code: 'GREENFIELD_PRECONDITION', message: 'greenfield mode requires an empty target, design-only preparation, or a valid replay.' });
    if (Object.keys(baseline).length === 0 || options.designConfirmed !== true) blockers.push({ code: 'DESIGN_CONFIRMATION_REQUIRED', message: 'greenfield mode requires a confirmed design baseline.' });
  }
  if (mode === 'inventory') {
    if (state !== 'valid' && (state !== 'existing' || !hasMeaningfulImplementation(targetRoot))) blockers.push({ code: 'INVENTORY_PRECONDITION', message: 'inventory mode requires an existing project implementation or a valid replay.' });
  }
  if (mode === 'adopt') {
    if (state !== 'valid' && (!['existing', 'incomplete'].includes(state) || !hasMeaningfulImplementation(targetRoot))) blockers.push({ code: 'ADOPT_PRECONDITION', message: 'adopt mode requires an existing project implementation or a valid replay.' });
    if (state !== 'valid' && !fs.existsSync(targetPath(targetRoot, 'docs/adoption/architecture-inventory.md'))) blockers.push({ code: 'INVENTORY_REQUIRED', message: 'adopt mode requires the inventory evidence produced by inventory mode.' });
    if (options.adoptionConfirmed !== true) blockers.push({ code: 'ADOPTION_CONFIRMATION_REQUIRED', message: 'adopt mode requires explicit project-owner confirmation.' });
    if (facts.length === 0) blockers.push({ code: 'ADOPTION_FACTS_MISSING', message: 'adopt mode requires a confirmed/inferred/unknown fact set with provenance.' });
  }
  if (mode === 'realign') {
    if (!['valid', 'stale', 'incomplete', 'governed'].includes(state)) blockers.push({ code: 'REALIGN_PRECONDITION', message: 'realign mode requires an existing governed vNext workflow asset surface.' });
  }
  return blockers;
}

function isValidReceiptModeTransition(receiptMode: BootstrapMode, requestedMode: BootstrapMode): boolean {
  if (requestedMode === 'realign') return true;
  if (receiptMode === requestedMode) return false;
  return (receiptMode === 'design' && requestedMode === 'greenfield')
    || (receiptMode === 'inventory' && requestedMode === 'adopt');
}

function makeModeAssets(targetRoot: string, project: { name: string; slug: string }, mode: BootstrapMode, baseline: Record<string, string>, facts: BootstrapFact[]): BootstrapAsset[] {
  if (mode === 'design') {
    return mergeAssets(
      DESIGN_PATHS.map(file => ({ path: file, category: 'governance' as const, content: renderDesignDocument(file, baseline) })),
      [{ path: 'docs/workflow/BASELINES.md', category: 'governance' as const, content: renderBaselineDoc(baseline) }, { path: 'docs/workflow/ROADMAP.md', category: 'governance' as const, content: renderRoadmap(project, mode, baseline) }, { path: 'docs/workflow/DECISIONS.md', category: 'governance' as const, content: renderDecisions(project, mode, [], true) }],
    );
  }
  if (mode === 'inventory') {
    return [
      { path: INVENTORY_PATHS[0], category: 'governance', content: renderInventoryFile('Architecture Inventory', targetRoot, facts) },
      { path: INVENTORY_PATHS[1], category: 'governance', content: renderInventoryFile('Database Inventory', targetRoot, facts) },
      { path: INVENTORY_PATHS[2], category: 'governance', content: renderInventoryFile('API Inventory', targetRoot, facts) },
      { path: INVENTORY_PATHS[3], category: 'governance', content: renderRiskRegister(facts) },
    ];
  }
  return [];
}

function modeEvidence(mode: BootstrapMode, state: BootstrapTargetState, source: { revision: string; tree_hash: string }, facts: BootstrapFact[]): BootstrapEvidence[] {
  return [
    { id: 'source-contract', kind: 'source-contract-validation', status: 'passed', detail: 'vNext source catalog, administrative template, and expert template validate.' },
    { id: 'source-identity', kind: 'source-identity', status: 'passed', detail: `source revision ${source.revision}; tree ${source.tree_hash}.` },
    { id: 'mode-precondition', kind: 'mode-precondition', status: 'passed', detail: `${mode} accepted target state ${state}.` },
    ...(facts.length > 0 ? [{ id: 'fact-provenance', kind: 'confirmed-inferred-unknown-classification', status: 'passed' as const, detail: `${facts.filter(fact => fact.certainty === 'confirmed').length} confirmed, ${facts.filter(fact => fact.certainty !== 'confirmed').length} retained as non-authoritative.` }] : []),
  ];
}

function publicPlan(plan: BootstrapPlan): Omit<BootstrapPlan, 'proposal'> {
  const { proposal: _proposal, ...publicValue } = plan;
  return publicValue;
}

export class BootstrapFacadeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'BootstrapFacadeError';
    this.code = code;
  }
}

export function buildBootstrapPlan(options: BootstrapProjectOptions): BootstrapPlan {
  const sourceRoot = path.resolve(options.sourceRoot ?? resolveRoot());
  const targetRoot = path.resolve(options.targetRoot);
  const mode = options.mode;
  if (!BOOTSTRAP_MODES.includes(mode)) throw new BootstrapFacadeError('BOOTSTRAP_MODE_INVALID', `mode must be one of ${BOOTSTRAP_MODES.join(', ')}.`);
  const guard = checkTargetRoot(sourceRoot, targetRoot);
  const targetIdentity = computeBootstrapTargetIdentity(targetRoot);
  const emptySource = { revision: 'unavailable', tree_hash: '0'.repeat(64) };
  if (!guard.allowed) return { status: 'blocked', mode, target_root: targetRoot, target_state: 'conflicting', target_identity: targetIdentity, project: { name: 'unknown', slug: 'unknown' }, host: options.host ?? 'codex', source: emptySource, planned_writes: [], planned_directories: [], planned_deletes: [], changed_paths: normalizeChangedPaths(options.changedPaths), blockers: [{ code: 'TARGET_ROOT_DENIED', message: guard.message, path: targetRoot }], warnings: [], evidence: [], read_back_verified: false, replay: false, caller_obligation: 'Use a disposable target root outside the source repository and provide exact changed_paths.' };

  let source: { revision: string; tree_hash: string };
  try {
    validateVNextSource(sourceRoot);
    validateVNextRuntimeContract(sourceRoot, false);
    const identity = getSourceIdentity(sourceRoot);
    source = { revision: identity.revision, tree_hash: identity.tree_hash };
  } catch (error) {
    return { status: 'rejected', mode, target_root: targetRoot, target_state: 'conflicting', target_identity: targetIdentity, project: { name: 'unknown', slug: 'unknown' }, host: options.host ?? 'codex', source: emptySource, planned_writes: [], planned_directories: [], planned_deletes: [], changed_paths: normalizeChangedPaths(options.changedPaths), blockers: [{ code: 'SOURCE_CONTRACT_INVALID', message: error instanceof Error ? error.message : String(error) }], warnings: [], evidence: [], read_back_verified: false, replay: false, caller_obligation: 'Repair the source contract/runtime validation before bootstrap.' };
  }

  const classification = classifyBootstrapTarget(targetRoot);
  let project: { name: string; slug: string };
  try {
    project = resolveProject(targetRoot, options, classification.receipt);
  } catch (error) {
    return { status: 'blocked', mode, target_root: targetRoot, target_state: classification.state, target_identity: targetIdentity, project: { name: 'unknown', slug: 'unknown' }, host: options.host ?? 'codex', source, planned_writes: [], planned_directories: [], planned_deletes: [], changed_paths: normalizeChangedPaths(options.changedPaths), blockers: [{ code: error instanceof BootstrapFacadeError ? error.code : 'PROFILE_INVALID', message: error instanceof Error ? error.message : String(error) }], warnings: [], evidence: modeEvidence(mode, classification.state, source, []), read_back_verified: false, replay: false, caller_obligation: 'Resolve project identity conflict without overwriting target-owned profile facts.' };
  }
  const host = options.host ?? 'codex';
  const baseline = designFacts(options);
  const facts = modeFacts(options);
  const preconditionBlockers = modePrecondition(targetRoot, mode, classification.state, options, baseline, facts);
  let evidence = modeEvidence(mode, classification.state, source, facts);
  if (preconditionBlockers.length > 0) return { status: preconditionBlockers.some(issue => issue.code.endsWith('CONFIRMATION_REQUIRED') || issue.code === 'DESIGN_EVIDENCE_MISSING' || issue.code === 'INVENTORY_REQUIRED' || issue.code === 'ADOPTION_FACTS_MISSING') ? 'needs-confirmation' : 'blocked', mode, target_root: targetRoot, target_state: classification.state, target_identity: targetIdentity, project, host, source, planned_writes: [], planned_directories: [], planned_deletes: [], changed_paths: normalizeChangedPaths(options.changedPaths), blockers: preconditionBlockers, warnings: classification.reasons.map(message => ({ code: 'TARGET_STATE', message })), evidence, read_back_verified: false, replay: false, caller_obligation: 'Satisfy the mode-specific precondition and rerun with the same target identity.' };

  const distributionPackageRoot = path.resolve(options.distributionPackageRoot ?? path.join(sourceRoot, 'packages', 'vibe-governance'));
  let distribution: ReturnType<typeof validateInstalledDistribution>;
  try {
    distribution = validateInstalledDistribution(targetRoot, distributionPackageRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'blocked', mode, target_root: targetRoot, target_state: classification.state, target_identity: targetIdentity, project, host, source, planned_writes: [], planned_directories: [], planned_deletes: [], changed_paths: normalizeChangedPaths(options.changedPaths), blockers: [{ code: 'DISTRIBUTION_PREREQUISITE_FAILED', message: `Bootstrap requires a valid installed Vibe Governance Distribution: ${message}` }], warnings: classification.reasons.map(messageValue => ({ code: 'TARGET_STATE', message: messageValue })), evidence: [...evidence, { id: 'distribution-read-back', kind: 'installed-distribution-read-back', status: 'blocked', detail: message }], read_back_verified: false, replay: false, caller_obligation: 'Run or repair the Distribution install/migrate/upgrade boundary, then rerun Bootstrap.' };
  }
  evidence = [...evidence, { id: 'distribution-read-back', kind: 'installed-distribution-read-back', status: 'passed', detail: `Distribution ${distribution.state.distribution_version} and ${distribution.manifest.artifacts.length} managed software artifacts passed payload, state, checksum, Skill-layout, and project-local Runtime read-back.` }];

  let assets: BootstrapAsset[];
  if (['greenfield', 'adopt', 'realign'].includes(mode)) {
    assets = makeGovernanceAssets(sourceRoot, targetRoot, project, targetIdentity, mode, host, facts, baseline);
    const extra = mode === 'adopt' ? [{ path: 'docs/adoption/ADOPTION_DECISION.md', category: 'governance' as const, content: renderDecisions(project, mode, facts) }] : [];
    assets = mergeAssets(assets, extra);
    if (mode === 'realign' && fs.existsSync(targetPath(targetRoot, CURRENT_TASK_RELATIVE_PATH))) {
      assets = assets.filter(asset => asset.path !== CURRENT_TASK_RELATIVE_PATH);
    }
  } else {
    assets = makeModeAssets(targetRoot, project, mode, baseline, facts);
  }
  const inputFingerprint = digest({ mode, project, host, baseline, facts, targetIdentity });
  const receiptAsset: BootstrapAsset = { path: VNEXT_BOOTSTRAP_RECEIPT_RELATIVE_PATH, category: 'config', content: renderReceipt(mode, targetIdentity, project, host, source, inputFingerprint, assets) };
  assets = mergeAssets(assets, [receiptAsset]);
  const expected = { mode, targetIdentity, project, host, inputFingerprint };
  const plannedWrites = assets.map(asset => asset.path).sort();
  const plannedDirectories: string[] = [];
  if (classification.state === 'valid' && classification.receipt && receiptMatches(classification.receipt, expected)) {
    try {
      const replayEvidence = verifyExistingBootstrapReadBack(targetRoot, mode, targetIdentity, project, classification.receipt, assets);
      return { status: 'replayed', mode, target_root: targetRoot, target_state: classification.state, target_identity: targetIdentity, project, host, source, planned_writes: [], planned_directories: [], planned_deletes: [], changed_paths: [], blockers: [], warnings: [], evidence: [...evidence, ...replayEvidence], read_back_verified: true, replay: true, caller_obligation: 'No mutation is required; continue through the existing daily task preparation path.' };
    } catch (error) {
      return { status: 'blocked', mode, target_root: targetRoot, target_state: classification.state, target_identity: targetIdentity, project, host, source, planned_writes: plannedWrites, planned_directories: plannedDirectories, planned_deletes: [], changed_paths: [], blockers: [{ code: error instanceof BootstrapFacadeError ? error.code : 'BOOTSTRAP_REPLAY_READ_BACK_FAILED', message: error instanceof Error ? error.message : String(error) }], warnings: [], evidence, read_back_verified: false, replay: false, caller_obligation: 'Repair the authoritative target governance drift before retrying bootstrap replay.' };
    }
  }
  const conditionalPaths = classification.state === 'stale' || classification.state === 'incomplete' || mode === 'realign'
    ? plannedWrites.filter(relative => fs.existsSync(targetPath(targetRoot, relative)) && existingIsWorkflowOwned(targetRoot, relative, classification.receipt))
    : [];
  const changedPaths = normalizeChangedPaths(options.changedPaths);
  const allChangedPaths = [...plannedWrites, ...plannedDirectories].sort();
  const proposal: BootstrapProjectProposal = {
    schema_version: 1,
    kind: 'vnext-bootstrap-proposal',
    caller: 'bootstrap-project',
    mode,
    target_identity: targetIdentity,
    source_revision: source.revision,
    source_tree_hash: source.tree_hash,
    scope_document: renderScopeDocument([...plannedWrites, ...plannedDirectories], conditionalPaths),
    changed_paths: changedPaths,
    conditional_authorizations: options.conditionalAuthorizations ?? [],
    transformation_kind: 'localized',
    authority_evidence: [
      { kind: 'project-owner', source: 'bootstrap input', subject: `${project.slug}:${mode}` },
      { kind: 'scope-admission', source: 'bootstrap proposal.scope_document', subject: targetIdentity },
      { kind: 'evidence-admission', source: 'bootstrap evidence plan', subject: `source:${source.tree_hash}` },
    ],
    semantic_operations: semanticOperations(assets, mode),
    preconditions: [`target state admitted: ${classification.state}`, 'source/runtime contract validation passed', 'installed Distribution payload/state/runtime/Skill read-back validation passed', 'Bootstrap promotes governance assets only', 'no legacy compatibility surface is promoted'],
    evidence_refs: ['evidence:source-contract', 'evidence:runtime-contract', 'evidence:distribution-read-back', 'evidence:read-back'],
    idempotency_key: `bootstrap-${mode}-${targetIdentity}-${inputFingerprint.slice(0, 16)}`,
    requested_write_targets: plannedWrites,
    requested_directory_targets: plannedDirectories,
    delete_targets: [],
    assets,
  };
  let scope: BootstrapPlan['scope'];
  const blockers: BootstrapIssue[] = [];
  try {
    // A dry run is the admission preview: validate the exact planned set even
    // before the caller echoes it back as changed_paths. The write path still
    // validates the caller-provided list through the same proposal boundary.
    const scopeProposal = changedPaths.length > 0
      ? proposal
      : { ...proposal, changed_paths: allChangedPaths };
    scope = validateBootstrapProjectProposal(scopeProposal).scope;
  } catch (error) {
    blockers.push({ code: error instanceof BootstrapFacadeError ? error.code : 'BOOTSTRAP_SCOPE_BLOCKED', message: error instanceof Error ? error.message : String(error) });
  }
  if (blockers.length > 0) return { status: changedPaths.length === 0 ? 'needs-confirmation' : 'blocked', mode, target_root: targetRoot, target_state: classification.state, target_identity: targetIdentity, project, host, source, planned_writes: plannedWrites, planned_directories: plannedDirectories, planned_deletes: [], changed_paths: changedPaths, blockers, warnings: classification.reasons.map(message => ({ code: 'TARGET_STATE', message })), evidence, read_back_verified: false, replay: false, caller_obligation: `Caller must provide changed_paths exactly equal to ${allChangedPaths.join(', ')} and authorize Conditional targets with evidence and authority.`, proposal };

  if (classification.state === 'valid' && classification.receipt && !isValidReceiptModeTransition(classification.receipt.mode, mode)) {
    return { status: 'blocked', mode, target_root: targetRoot, target_state: classification.state, target_identity: targetIdentity, project, host, source, planned_writes: plannedWrites, planned_directories: plannedDirectories, planned_deletes: [], changed_paths: changedPaths, blockers: [{ code: 'BOOTSTRAP_IDENTITY_CONFLICT', message: 'a valid bootstrap receipt exists but its mode, host, or input identity differs.' }], warnings: [], evidence, scope, read_back_verified: false, replay: false, caller_obligation: 'Use realign with explicit Conditional authorization or preserve the existing valid bootstrap.', proposal };
  }
  const markerPath = targetPath(targetRoot, VNEXT_BOOTSTRAP_IN_PROGRESS_RELATIVE_PATH);
  if (options.write && changedPaths.length === 0) {
    return { status: 'needs-confirmation', mode, target_root: targetRoot, target_state: classification.state, target_identity: targetIdentity, project, host, source, planned_writes: plannedWrites, planned_directories: plannedDirectories, planned_deletes: [], changed_paths: [], blockers: [{ code: 'CHANGED_PATHS_REQUIRED', message: `caller must provide exact changed_paths: ${allChangedPaths.join(', ')}` }], warnings: [], evidence, scope, read_back_verified: false, replay: false, caller_obligation: `Provide changed_paths exactly equal to ${allChangedPaths.join(', ')}.`, proposal };
  }
  if (!options.write) {
    return { status: 'ready', mode, target_root: targetRoot, target_state: classification.state, target_identity: targetIdentity, project, host, source, planned_writes: plannedWrites, planned_directories: plannedDirectories, planned_deletes: [], changed_paths: changedPaths, blockers: [], warnings: classification.reasons.map(message => ({ code: 'TARGET_STATE', message })), evidence: [...evidence, { id: 'scope-admission', kind: 'mutation-scope', status: 'passed', detail: 'exact changed_paths admitted by the shared evaluator.' }], scope, read_back_verified: false, replay: false, caller_obligation: 'Dry-run only. Reinvoke with --write and the exact planned changed_paths to promote governance assets only.', proposal };
  }
  for (const relative of plannedWrites) {
    if (isFrozenPath(targetRoot, relative)) {
      return { status: 'blocked', mode, target_root: targetRoot, target_state: classification.state, target_identity: targetIdentity, project, host, source, planned_writes: plannedWrites, planned_directories: plannedDirectories, planned_deletes: [], changed_paths: changedPaths, blockers: [{ code: 'FROZEN_PATH', message: 'bootstrap cannot replace a frozen target.', path: relative }], warnings: [], evidence, scope, read_back_verified: false, replay: false, caller_obligation: 'Unfreeze only through the target owner and rerun with explicit authority.', proposal };
    }
    const existing = targetPath(targetRoot, relative);
    if (fs.existsSync(existing) && !existingIsWorkflowOwned(targetRoot, relative, classification.receipt)) {
      return { status: 'blocked', mode, target_root: targetRoot, target_state: classification.state, target_identity: targetIdentity, project, host, source, planned_writes: plannedWrites, planned_directories: plannedDirectories, planned_deletes: [], changed_paths: changedPaths, blockers: [{ code: 'HOST_OR_ASSET_CONFLICT', message: 'target-owned/native asset would be overwritten.', path: relative }], warnings: [], evidence, scope, read_back_verified: false, replay: false, caller_obligation: 'Classify the asset as workflow-owned or provide a conflict resolution; bootstrap will not overwrite it.', proposal };
    }
  }
  return { status: 'ready', mode, target_root: targetRoot, target_state: classification.state, target_identity: targetIdentity, project, host, source, planned_writes: plannedWrites, planned_directories: plannedDirectories, planned_deletes: [], changed_paths: changedPaths, blockers: [], warnings: classification.reasons.map(message => ({ code: 'TARGET_STATE', message })), evidence: [...evidence, { id: 'scope-admission', kind: 'mutation-scope', status: 'passed', detail: 'exact changed_paths admitted by the shared evaluator.' }], scope, read_back_verified: false, replay: false, caller_obligation: 'Promotion is authorized by the validated proposal; post-promotion governance health/read-back is mandatory.', proposal };
}

function verifyNoLegacySurface(targetRoot: string): void {
  if (hasLegacySurface(targetRoot)) throw new BootstrapFacadeError('POST_BOOTSTRAP_LEGACY_SURFACE', 'a legacy or compatibility surface remains after bootstrap.');
  for (const host of ['.claude/skills', '.codex/skills', '.factory/skills']) {
    const directory = targetPath(targetRoot, host);
    if (!fs.existsSync(directory)) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('workflow-system-') || (entry.isDirectory() && entry.name.startsWith('workflow-system-'))) throw new BootstrapFacadeError('POST_BOOTSTRAP_LEGACY_SURFACE', `legacy host Skill remains: ${host}/${entry.name}`);
    }
  }
}

function verifyBootstrapHealth(targetRoot: string, proposal: BootstrapProjectProposal, distributionPackageRoot: string): BootstrapEvidence[] {
  const distribution = validateInstalledDistribution(targetRoot, distributionPackageRoot);
  const evidence: BootstrapEvidence[] = [{
    id: 'distribution-read-back',
    kind: 'installed-distribution-read-back',
    status: 'passed',
    detail: `Distribution ${distribution.state.distribution_version} remained valid while Bootstrap read back governance assets only.`,
  }];
  if (['greenfield', 'adopt', 'realign'].includes(proposal.mode)) {
    const runtime = validateVNextRuntimeContract(targetRoot, true);
    evidence.push({ id: 'runtime-read-back', kind: 'runtime-contract-and-dependency-read-back', status: 'passed', detail: `Runtime ${runtime.runtime_distribution.package_version} and locked dependency tree verified.` });
    const current = readCanonicalCurrentTask(targetRoot);
    if (current.runtimeState.workflow_status !== 'closed' || current.runtimeState.lifecycle_state !== 'archived' || current.runtimeState.active_step_status !== 'completed' || (proposal.mode !== 'realign' && current.runtimeState.task_id !== '000')) throw new BootstrapFacadeError('BOOTSTRAP_TASK_STATE_INVALID', 'canonical CURRENT_TASK is not closed + archived with no active step.');
    evidence.push({ id: 'canonical-task-read-back', kind: 'canonical-CURRENT_TASK-read-back', status: 'passed', detail: proposal.mode === 'realign'
      ? 'canonical CURRENT_TASK remains closed + archived; realign did not create or replace task state.'
      : 'bootstrap baseline is closed + archived; no active task was created.' });
  }
  verifyNoLegacySurface(targetRoot);
  evidence.push({ id: 'host-isolation', kind: 'host-isolation-check', status: 'passed', detail: 'only admitted bootstrap host assets are present and native legacy routes are absent.' });
  for (const asset of proposal.assets) {
    const filePath = targetPath(targetRoot, asset.path);
    if (!fs.existsSync(filePath) || fileHash(filePath) !== sha256(Buffer.from(asset.content, 'utf8'))) throw new BootstrapFacadeError('BOOTSTRAP_READ_BACK_FAILED', `asset checksum mismatch after promotion: ${asset.path}`);
  }
  evidence.push({ id: 'asset-checksum-read-back', kind: 'generated-asset-checksum-read-back', status: 'passed', detail: `${proposal.assets.length} promoted assets match their proposal bytes.` });
  const receipt = readReceipt(targetRoot);
  if (!receipt || receipt.target_identity !== proposal.target_identity || receipt.mode !== proposal.mode) throw new BootstrapFacadeError('BOOTSTRAP_RECEIPT_READ_BACK_FAILED', 'bootstrap receipt identity did not read back correctly.');
  verifyReceiptManagedFiles(targetRoot, receipt);
  verifyReceiptAssetSet(receipt, proposal.assets);
  evidence.push({ id: 'receipt-read-back', kind: 'bootstrap-receipt-read-back', status: 'passed', detail: 'receipt records source/target identity, managed checksums, and recovery boundary.' });
  return evidence;
}

function markerValue(plan: BootstrapPlan): string {
  return `${JSON.stringify({ schema_version: 1, kind: 'vnext-bootstrap-in-progress', target_identity: plan.target_identity, mode: plan.mode, source_revision: plan.source.revision, source_tree_hash: plan.source.tree_hash, planned_writes: plan.planned_writes, planned_directories: plan.planned_directories, recovery: 'fail-closed-explicit-recovery' }, null, 2)}\n`;
}

export function bootstrapProject(options: BootstrapProjectOptions): BootstrapPlan {
  const plan = buildBootstrapPlan({ ...options, write: options.write === true });
  if (plan.status !== 'ready' || options.write !== true || !plan.proposal) return plan;
  const beforeHash = computeBootstrapPreimageHash(plan.target_root, plan.proposal);
  const markerPath = targetPath(plan.target_root, VNEXT_BOOTSTRAP_IN_PROGRESS_RELATIVE_PATH);
  const distributionPackageRoot = path.resolve(options.distributionPackageRoot ?? path.join(path.resolve(options.sourceRoot ?? resolveRoot()), 'packages', 'vibe-governance'));
  try {
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(markerPath, markerValue(plan), 'utf8');
    applyBootstrapProjectProposal(plan.target_root, plan.proposal, {
      verify: () => {
        verifyBootstrapHealth(plan.target_root, plan.proposal!, distributionPackageRoot);
      },
    });
    if (fs.existsSync(markerPath)) fs.rmSync(markerPath, { force: true });
    return { ...plan, status: 'installed', read_back_verified: true, evidence: [...plan.evidence, ...verifyBootstrapHealth(plan.target_root, plan.proposal, distributionPackageRoot)], caller_obligation: 'Bootstrap complete. Prepare the first real task through the daily Runtime path.' };
  } catch (error) {
    let rollbackVerified = false;
    try {
      rollbackVerified = computeBootstrapPreimageHash(plan.target_root, plan.proposal) === beforeHash;
    } catch {
      rollbackVerified = false;
    }
    if (rollbackVerified && fs.existsSync(markerPath)) fs.rmSync(markerPath, { force: true });
    return { ...plan, status: 'rejected', planned_writes: rollbackVerified ? [] : plan.planned_writes, planned_directories: rollbackVerified ? [] : plan.planned_directories, blockers: [{ code: error instanceof BootstrapFacadeError ? error.code : 'BOOTSTRAP_TRANSACTION_FAILED', message: error instanceof Error ? error.message : String(error) }], warnings: rollbackVerified ? [...plan.warnings, { code: 'ROLLBACK_VERIFIED', message: 'scoped Bootstrap governance preimage restored and interruption marker cleared.' }] : [...plan.warnings, { code: 'RECOVERY_REQUIRED', message: 'scoped Bootstrap rollback could not be verified; interruption marker retained for explicit recovery.' }], read_back_verified: false, caller_obligation: rollbackVerified ? 'Retry only after re-evaluating the fresh source/target identity.' : 'Inspect BOOTSTRAP_IN_PROGRESS.json and recover explicitly; do not retry automatically.' };
  }
}

export function recoverBootstrapProject(targetRoot: string): { status: 'recovered' | 'blocked'; message: string; read_back_verified: boolean } {
  const markerPath = targetPath(targetRoot, VNEXT_BOOTSTRAP_IN_PROGRESS_RELATIVE_PATH);
  if (!fs.existsSync(markerPath)) return { status: 'blocked', message: 'no bootstrap interruption marker is present.', read_back_verified: false };
  const marker = readBootstrapMarker(targetRoot);
  let receipt: BootstrapReceipt | null = null;
  try {
    receipt = readReceipt(targetRoot);
  } catch (error) {
    return { status: 'blocked', message: `bootstrap receipt is invalid while an interruption marker is present: ${error instanceof Error ? error.message : String(error)}`, read_back_verified: false };
  }
  if (receipt) {
    try {
      verifyReceiptManagedFiles(targetRoot, receipt);
      verifyNoLegacySurface(targetRoot);
      if (['greenfield', 'adopt', 'realign'].includes(receipt.mode)) {
        const current = readCanonicalCurrentTask(targetRoot);
        if (current.runtimeState.workflow_status !== 'closed' || current.runtimeState.lifecycle_state !== 'archived' || current.runtimeState.active_step_status !== 'completed' || (receipt.mode !== 'realign' && current.runtimeState.task_id !== '000')) {
          throw new BootstrapFacadeError('BOOTSTRAP_TASK_STATE_INVALID', 'completed bootstrap receipt does not retain a closed + archived canonical task state.');
        }
      }
      fs.rmSync(markerPath, { force: true });
      return { status: 'recovered', message: 'completed bootstrap was read back; interruption marker cleared.', read_back_verified: true };
    } catch (error) {
      return { status: 'blocked', message: `completed receipt exists but health/read-back failed: ${error instanceof Error ? error.message : String(error)}`, read_back_verified: false };
    }
  }
  const planned = Array.isArray(marker.planned_writes) ? marker.planned_writes.filter(value => typeof value === 'string') as string[] : [];
  const directories = Array.isArray(marker.planned_directories) ? marker.planned_directories.filter(value => typeof value === 'string') as string[] : [];
  const residual = [...planned, ...directories].some(relative => fs.existsSync(targetPath(targetRoot, relative)));
  if (residual) return { status: 'blocked', message: 'partial bootstrap assets remain without a completion receipt; preserve the marker and perform explicit owner-led recovery.', read_back_verified: false };
  fs.rmSync(markerPath, { force: true });
  return { status: 'recovered', message: 'no promoted bootstrap asset was found; marker cleared for a safe retry.', read_back_verified: true };
}

function parseListFile(filePath: string): string[] {
  const content = fs.readFileSync(path.resolve(filePath), 'utf8');
  if (content.trimStart().startsWith('[')) {
    const value = JSON.parse(content) as unknown;
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new BootstrapFacadeError('BOOTSTRAP_INPUT_INVALID', 'paths file JSON form must be an array of strings.');
    return value as string[];
  }
  return content.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
}

function parseFlagList(argv: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) if (argv[index] === flag) values.push(argv[index + 1] ?? '');
  return values;
}

function cliValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

function cliUsage(): string {
  return [
    'Usage:',
    '  bun run scripts/vnext-bootstrap-project.ts bootstrap --target <project> --mode <design|greenfield|inventory|adopt|realign> [--write] [--path <repo-relative>] [--paths-file <file>] [--json]',
    '  bun run scripts/vnext-bootstrap-project.ts recover --target <project> [--json]',
    '',
    'Write mode requires the exact changed_paths returned by a dry run. Conditional realign/adoption targets additionally require --conditional-authorizations-file <json>.',
  ].join('\n');
}

if (import.meta.main) {
  try {
    const argv = process.argv.slice(2);
    const command = argv[0] ?? 'help';
    const json = argv.includes('--json');
    if (command === 'help' || command === '--help') {
      console.log(cliUsage());
      process.exit(0);
    }
    const targetRoot = cliValue(argv, '--target');
    if (!targetRoot) throw new BootstrapFacadeError('BOOTSTRAP_INPUT_INVALID', '--target is required.');
    if (command === 'recover') {
      const result = recoverBootstrapProject(targetRoot);
      console.log(json ? JSON.stringify(result, null, 2) : result.message);
      process.exit(result.status === 'recovered' ? 0 : 1);
    }
    if (command !== 'bootstrap') throw new BootstrapFacadeError('BOOTSTRAP_INPUT_INVALID', `unknown command ${command}`);
    const mode = cliValue(argv, '--mode') as BootstrapMode | undefined;
    if (!mode || !BOOTSTRAP_MODES.includes(mode)) throw new BootstrapFacadeError('BOOTSTRAP_INPUT_INVALID', '--mode must be one of the closed bootstrap modes.');
    const paths = [...parseFlagList(argv, '--path'), ...(cliValue(argv, '--paths-file') ? parseListFile(cliValue(argv, '--paths-file')!) : [])];
    let conditionalAuthorizations: ConditionalScopeAuthorization[] = [];
    const authFile = cliValue(argv, '--conditional-authorizations-file');
    if (authFile) conditionalAuthorizations = readJson(authFile) as ConditionalScopeAuthorization[];
    const designFile = cliValue(argv, '--design-baseline-file');
    const factsFile = cliValue(argv, '--facts-file');
    const designBaseline = designFile ? readJsonObject(designFile, 'BOOTSTRAP_INPUT_INVALID') as Record<string, string> : undefined;
    const facts = factsFile ? readJson(factsFile, 'BOOTSTRAP_INPUT_INVALID') as unknown as BootstrapFact[] : undefined;
    const result = bootstrapProject({
      targetRoot,
      sourceRoot: cliValue(argv, '--source'),
      mode,
      write: argv.includes('--write'),
      projectName: cliValue(argv, '--project-name'),
      projectSlug: cliValue(argv, '--project-slug'),
      host: (cliValue(argv, '--host') as BootstrapHost | undefined) ?? 'codex',
      designBaseline,
      designConfirmed: argv.includes('--confirm-design') || argv.includes('--confirm'),
      confirmedFacts: facts,
      adoptionConfirmed: argv.includes('--confirm-adoption') || argv.includes('--confirm'),
      changedPaths: paths,
      conditionalAuthorizations,
    });
    console.log(json ? JSON.stringify(publicPlan(result), null, 2) : JSON.stringify(publicPlan(result), null, 2));
    process.exit(['ready', 'installed', 'replayed'].includes(result.status) ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
