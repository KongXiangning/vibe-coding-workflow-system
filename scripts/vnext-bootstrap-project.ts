#!/usr/bin/env bun

/**
 * Source-side Bootstrap facade.
 *
 * The target-local Runtime support owns Bootstrap preparation semantics. This
 * facade adds only source/release validation, the Migration Pack's legacy
 * surface audit, source identity evidence, and the Bun-facing recovery/CLI
 * adapter. It never provides a second classifier, renderer, or mode planner.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  getSourceIdentity,
  validateCompletedMigration,
} from './vnext-migration-pack';
import {
  isDistributionOwnedTarget,
  validateInstalledDistribution,
} from './vibe-governance-distribution';
import { checkTargetRoot } from './guard-target-root';
import { resolveRoot } from './workflow-core';
import { validateVNextSource } from './vnext-source-contract';
import {
  BOOTSTRAP_MODES,
  computeBootstrapTargetIdentity,
  validateBootstrapProjectProposal,
  type BootstrapMode,
  type BootstrapProjectProposal,
} from '../runtime/vnext/src/bootstrap';
import { readCanonicalCurrentTask, validateVNextRuntimeContract } from '../runtime/vnext/src/kernel';
import type { ConditionalScopeAuthorization } from '../runtime/vnext/src/mutation-scope';
import {
  bootstrapProjectTargetLocal,
  classifyBootstrapTargetLocal,
  type BootstrapMigrationAdmission,
  type BootstrapReceipt as TargetBootstrapReceipt,
  type BootstrapSupportOptions,
  type BootstrapSupportPlan,
} from '../runtime/vnext/src/bootstrap-support';

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

export type BootstrapIssue = { code: string; message: string; path?: string };

export type BootstrapEvidence = {
  id: string;
  kind: string;
  status: 'passed' | 'preserved' | 'deferred' | 'blocked';
  detail: string;
};

export type BootstrapReceipt = TargetBootstrapReceipt;

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
  proposal?: BootstrapProjectProposal;
};

const HASH64 = /^[a-f0-9]{64}$/u;
const RECEIPT_KEYS = [
  'schema_version', 'kind', 'mode', 'target_identity', 'project', 'host', 'source',
  'input_fingerprint', 'completed_at', 'managed_files', 'legacy_compatibility', 'recovery_boundary',
] as const;
const BOOTSTRAP_MARKER_KEYS = [
  'schema_version', 'kind', 'target_identity', 'mode', 'source_revision', 'source_tree_hash',
  'planned_writes', 'planned_directories', 'recovery',
] as const;

export class BootstrapFacadeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'BootstrapFacadeError';
    this.code = code;
  }
}

function normalizeRelative(value: string): string {
  const normalized = value.trim().replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/\/+/gu, '/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//u.test(normalized) || normalized.split('/').some(segment => segment === '..' || segment.length === 0) || /[\0-\x1F\x7F]/u.test(normalized) || normalized.includes('*')) {
    throw new BootstrapFacadeError('BOOTSTRAP_PATH_INVALID', `unsafe repository-relative path: ${value}`);
  }
  return normalized;
}

function targetPath(root: string, relative: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...normalizeRelative(relative).split('/'));
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  if (resolved !== resolvedRoot && !resolved.startsWith(prefix)) throw new BootstrapFacadeError('BOOTSTRAP_PATH_INVALID', `target path escapes root: ${relative}`);
  return resolved;
}

function fileHash(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

function readJsonObject(filePath: string, code: string): Record<string, unknown> {
  try {
    const value = readJson(filePath);
    if (!isRecord(value)) throw new Error('must be an object');
    return value;
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

function readReceipt(targetRoot: string): BootstrapReceipt | null {
  const filePath = targetPath(targetRoot, VNEXT_BOOTSTRAP_RECEIPT_RELATIVE_PATH);
  if (!fs.existsSync(filePath)) return null;
  const raw = readJsonObject(filePath, 'BOOTSTRAP_RECEIPT_INVALID');
  const actualKeys = Object.keys(raw).sort().join('|');
  if (actualKeys !== [...RECEIPT_KEYS].sort().join('|')) throw new BootstrapFacadeError('BOOTSTRAP_RECEIPT_INVALID', 'Bootstrap Receipt has an unsupported schema.');
  const project = raw.project;
  const source = raw.source;
  if (raw.schema_version !== 1 || raw.kind !== 'vnext-bootstrap-receipt' || !BOOTSTRAP_MODES.includes(raw.mode as BootstrapMode) || typeof raw.target_identity !== 'string' || !isRecord(project) || typeof project.name !== 'string' || typeof project.slug !== 'string' || !BOOTSTRAP_HOSTS.includes(raw.host as BootstrapHost) || !isRecord(source) || typeof source.revision !== 'string' || typeof source.tree_hash !== 'string' || !HASH64.test(source.tree_hash) || typeof raw.input_fingerprint !== 'string' || !HASH64.test(raw.input_fingerprint) || typeof raw.completed_at !== 'string' || raw.legacy_compatibility !== 'absent' || raw.recovery_boundary !== 'in-progress-marker') {
    throw new BootstrapFacadeError('BOOTSTRAP_RECEIPT_INVALID', 'Bootstrap Receipt identity or schema fields are invalid.');
  }
  if (!Array.isArray(raw.managed_files) || raw.managed_files.length === 0) throw new BootstrapFacadeError('BOOTSTRAP_RECEIPT_INVALID', 'Bootstrap Receipt managed_files must be non-empty.');
  const managedFiles = raw.managed_files.map((value, index) => {
    if (!isRecord(value) || typeof value.path !== 'string' || typeof value.checksum !== 'string' || !HASH64.test(value.checksum)) throw new BootstrapFacadeError('BOOTSTRAP_RECEIPT_INVALID', `managed_files[${index}] is invalid.`);
    const relative = normalizeRelative(value.path);
    if (isBootstrapForbiddenDistributionPath(relative)) throw new BootstrapFacadeError('BOOTSTRAP_RECEIPT_INVALID', `managed_files[${index}] declares Distribution-owned software: ${relative}`);
    if (!isBootstrapGovernancePath(relative)) throw new BootstrapFacadeError('BOOTSTRAP_RECEIPT_INVALID', `managed_files[${index}] is outside the Bootstrap-owned governance surface: ${relative}`);
    return { path: relative, checksum: value.checksum };
  });
  if (new Set(managedFiles.map(file => file.path)).size !== managedFiles.length) throw new BootstrapFacadeError('BOOTSTRAP_RECEIPT_INVALID', 'Bootstrap Receipt managed_files contains duplicates.');
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
      if (entry.name.startsWith('workflow-system-') || (entry.isDirectory() && entry.name.startsWith('workflow-system-'))) return true;
    }
  }
  return false;
}

/** Source-only legacy audit. The target-local Runtime never imports this. */
function verifyNoLegacySurface(targetRoot: string): void {
  if (hasLegacySurface(targetRoot)) throw new BootstrapFacadeError('POST_BOOTSTRAP_LEGACY_SURFACE', 'a legacy or compatibility surface remains after Bootstrap.');
  for (const host of ['.claude/skills', '.codex/skills', '.factory/skills']) {
    const directory = targetPath(targetRoot, host);
    if (!fs.existsSync(directory)) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('workflow-system-') || (entry.isDirectory() && entry.name.startsWith('workflow-system-'))) throw new BootstrapFacadeError('POST_BOOTSTRAP_LEGACY_SURFACE', `legacy host Skill remains: ${host}/${entry.name}`);
    }
  }
}

function readBootstrapMarker(targetRoot: string): Record<string, unknown> {
  const marker = readJsonObject(targetPath(targetRoot, VNEXT_BOOTSTRAP_IN_PROGRESS_RELATIVE_PATH), 'BOOTSTRAP_IN_PROGRESS_INVALID');
  if (Object.keys(marker).sort().join('|') !== [...BOOTSTRAP_MARKER_KEYS].sort().join('|') || marker.schema_version !== 1 || marker.kind !== 'vnext-bootstrap-in-progress' || marker.recovery !== 'fail-closed-explicit-recovery' || !BOOTSTRAP_MODES.includes(marker.mode as BootstrapMode) || typeof marker.target_identity !== 'string' || marker.target_identity !== computeBootstrapTargetIdentity(targetRoot) || typeof marker.source_revision !== 'string' || !HASH64.test(String(marker.source_tree_hash))) {
    throw new BootstrapFacadeError('BOOTSTRAP_IN_PROGRESS_INVALID', 'Bootstrap interruption marker identity or schema is invalid; recovery is blocked.');
  }
  for (const field of ['planned_writes', 'planned_directories'] as const) {
    const values = marker[field];
    if (!Array.isArray(values) || values.some(value => typeof value !== 'string')) throw new BootstrapFacadeError('BOOTSTRAP_IN_PROGRESS_INVALID', `${field} must be an array of paths.`);
    const normalized = values.map(value => normalizeRelative(value));
    if (new Set(normalized).size !== normalized.length) throw new BootstrapFacadeError('BOOTSTRAP_IN_PROGRESS_INVALID', `${field} contains duplicate paths.`);
    marker[field] = normalized;
  }
  return marker;
}

function verifyReceiptManagedFiles(targetRoot: string, receipt: BootstrapReceipt): void {
  if (receipt.target_identity !== computeBootstrapTargetIdentity(targetRoot)) throw new BootstrapFacadeError('BOOTSTRAP_RECEIPT_READ_BACK_FAILED', 'Bootstrap Receipt target identity does not match the target root.');
  for (const file of receipt.managed_files) {
    const filePath = targetPath(targetRoot, file.path);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile() || fileHash(filePath) !== file.checksum) throw new BootstrapFacadeError('BOOTSTRAP_RECEIPT_READ_BACK_FAILED', `managed Bootstrap asset is missing or drifted: ${file.path}`);
  }
}

export function classifyBootstrapTarget(targetRoot: string): { state: BootstrapTargetState; receipt: BootstrapReceipt | null; reasons: string[] } {
  const resolved = path.resolve(targetRoot);
  let migrationAdmission: BootstrapMigrationAdmission;
  try {
    const provenance = validateCompletedMigration(resolved);
    migrationAdmission = provenance ? { status: 'valid', provenance } : { status: 'none' };
  } catch (error) {
    migrationAdmission = { status: 'invalid', reason: error instanceof Error ? error.message : String(error) };
  }
  const classification = classifyBootstrapTargetLocal(resolved, { legacySurfacePresent: hasLegacySurface(resolved), migrationAdmission });
  return { state: classification.state, receipt: classification.receipt, reasons: classification.reasons };
}

function normalizeChangedPaths(paths: readonly string[] | undefined): string[] {
  return (paths ?? []).map(normalizeRelative).sort();
}

function sourceMigrationAdmission(targetRoot: string): BootstrapMigrationAdmission {
  try {
    const provenance = validateCompletedMigration(targetRoot);
    return provenance ? { status: 'valid', provenance } : { status: 'none' };
  } catch (error) {
    return { status: 'invalid', reason: error instanceof Error ? error.message : String(error) };
  }
}

function sourceSupportOptions(options: BootstrapProjectOptions, source: { revision: string; tree_hash: string }, write: boolean, changedPaths = options.changedPaths): BootstrapSupportOptions {
  const targetRoot = path.resolve(options.targetRoot);
  return {
    targetRoot,
    mode: options.mode,
    write,
    projectName: options.projectName,
    projectSlug: options.projectSlug,
    host: options.host,
    designBaseline: options.designBaseline,
    designConfirmed: options.designConfirmed,
    inventoryFacts: options.inventoryFacts,
    confirmedFacts: options.confirmedFacts,
    adoptionConfirmed: options.adoptionConfirmed,
    changedPaths,
    conditionalAuthorizations: options.conditionalAuthorizations,
    source,
    legacySurfacePresent: hasLegacySurface(targetRoot),
    migrationAdmission: sourceMigrationAdmission(targetRoot),
  };
}

function sourceEvidence(mode: BootstrapMode, state: BootstrapTargetState, source: { revision: string; tree_hash: string }, facts: BootstrapFact[]): BootstrapEvidence[] {
  return [
    { id: 'source-contract', kind: 'source-contract-validation', status: 'passed', detail: 'vNext source contract and source-side Bootstrap inputs validate.' },
    { id: 'source-identity', kind: 'source-identity', status: 'passed', detail: `source revision ${source.revision}; tree ${source.tree_hash}.` },
    { id: 'mode-precondition', kind: 'mode-precondition', status: 'passed', detail: `${mode} accepted target state ${state}.` },
    ...(facts.length > 0 ? [{ id: 'fact-provenance', kind: 'confirmed-inferred-unknown-classification', status: 'passed' as const, detail: `${facts.filter(fact => fact.certainty === 'confirmed').length} confirmed, ${facts.filter(fact => fact.certainty !== 'confirmed').length} retained as non-authoritative.` }] : []),
  ];
}

function mapSupportPlan(support: BootstrapSupportPlan, options: BootstrapProjectOptions, source: { revision: string; tree_hash: string }, distributionDetail: string, finalWrite = false): BootstrapPlan {
  const facts = (options.mode === 'inventory' ? options.inventoryFacts ?? options.confirmedFacts : options.confirmedFacts) ?? [];
  const evidence = sourceEvidence(options.mode, support.target_state, source, facts);
  if (support.status !== 'blocked') evidence.push({ id: 'distribution-read-back', kind: 'installed-distribution-read-back', status: 'passed', detail: distributionDetail });
  if (finalWrite && support.status === 'installed') {
    evidence.push({ id: 'runtime-read-back', kind: 'runtime-contract-and-dependency-read-back', status: 'passed', detail: 'project-local Runtime proposal commit and dependency read-back passed.' });
    evidence.push({ id: 'canonical-task-read-back', kind: 'canonical-CURRENT_TASK-read-back', status: 'passed', detail: options.mode === 'realign' ? 'canonical CURRENT_TASK remained governed; realign did not create or replace task state.' : 'Bootstrap baseline is closed + archived; no active task was created.' });
    evidence.push({ id: 'host-isolation', kind: 'host-isolation-check', status: 'passed', detail: 'Bootstrap promoted governance assets only; Distribution and migration provenance remained read-only.' });
    evidence.push({ id: 'asset-checksum-read-back', kind: 'generated-asset-checksum-read-back', status: 'passed', detail: 'promoted governance assets match the typed proposal.' });
    evidence.push({ id: 'receipt-read-back', kind: 'bootstrap-receipt-read-back', status: 'passed', detail: 'Bootstrap Receipt records governance transaction provenance only.' });
  }
  let scope: BootstrapPlan['scope'];
  if (support.proposal) {
    try {
      const proposalForScope = support.proposal.changed_paths.length > 0 ? support.proposal : { ...support.proposal, changed_paths: support.proposal.requested_write_targets };
      scope = validateBootstrapProjectProposal(proposalForScope).scope;
    } catch (error) {
      support.status = 'blocked';
      support.blockers = [{ code: 'BOOTSTRAP_SCOPE_BLOCKED', message: error instanceof Error ? error.message : String(error) }];
    }
  }
  if (scope && support.status !== 'blocked') evidence.push({ id: 'scope-admission', kind: 'mutation-scope', status: 'passed', detail: 'exact changed_paths admitted by the shared Runtime scope evaluator.' });
  const mappedStatus: BootstrapPlanStatus = support.status === 'blocked'
    ? (finalWrite ? 'rejected' : 'blocked')
    : support.status === 'needs-confirmation' ? (finalWrite ? 'needs-confirmation' : 'ready') : support.status;
  const mappedBlockers = support.blockers.map(issue => issue.code === 'BOOTSTRAP_SUPPORT_READ_BACK_FAILED' || issue.code === 'BOOTSTRAP_SUPPORT_REPLAY_READ_BACK_FAILED'
    ? { ...issue, code: 'BOOTSTRAP_RECEIPT_READ_BACK_FAILED' }
    : issue);
  return {
    status: mappedStatus,
    mode: options.mode,
    target_root: support.target_root,
    target_state: support.target_state,
    target_identity: support.target_identity,
    project: support.project,
    host: support.host as BootstrapHost,
    source: support.source,
    planned_writes: support.planned_writes,
    planned_directories: support.planned_directories,
    planned_deletes: support.planned_deletes,
    changed_paths: support.changed_paths,
    blockers: mappedBlockers,
    warnings: support.warnings,
    evidence,
    scope,
    read_back_verified: support.read_back_verified,
    replay: support.status === 'replayed',
    caller_obligation: support.status === 'needs-confirmation' ? `Provide changed_paths exactly equal to ${support.planned_writes.join(', ')}.` : 'Promotion is authorized by the shared Bootstrap preparation core; Runtime read-back is mandatory.',
    proposal: support.proposal,
  };
}

function admitSourceChangedPaths(support: BootstrapSupportPlan, options: BootstrapProjectOptions): void {
  if (!support.proposal || !options.changedPaths || options.changedPaths.length === 0) return;
  try {
    const validation = validateBootstrapProjectProposal({ ...support.proposal, changed_paths: normalizeChangedPaths(options.changedPaths) });
    support.proposal = validation.proposal;
    support.changed_paths = normalizeChangedPaths(options.changedPaths);
    support.status = 'ready';
    support.blockers = [];
  } catch (error) {
    support.status = 'blocked';
    support.blockers = [{ code: 'BOOTSTRAP_SCOPE_BLOCKED', message: error instanceof Error ? error.message : String(error) }];
  }
}

/** Source/release adapter over the target-local authoritative preparation core. */
export function buildBootstrapPlan(options: BootstrapProjectOptions): BootstrapPlan {
  const sourceRoot = path.resolve(options.sourceRoot ?? resolveRoot());
  const targetRoot = path.resolve(options.targetRoot);
  if (!BOOTSTRAP_MODES.includes(options.mode)) throw new BootstrapFacadeError('BOOTSTRAP_MODE_INVALID', `mode must be one of ${BOOTSTRAP_MODES.join(', ')}.`);
  const guard = checkTargetRoot(sourceRoot, targetRoot);
  const targetIdentity = computeBootstrapTargetIdentity(targetRoot);
  const emptySource = { revision: 'unavailable', tree_hash: '0'.repeat(64) };
  if (!guard.allowed) return { status: 'blocked', mode: options.mode, target_root: targetRoot, target_state: 'conflicting', target_identity: targetIdentity, project: { name: 'unknown', slug: 'unknown' }, host: options.host ?? 'codex', source: emptySource, planned_writes: [], planned_directories: [], planned_deletes: [], changed_paths: normalizeChangedPaths(options.changedPaths), blockers: [{ code: 'TARGET_ROOT_DENIED', message: guard.message, path: targetRoot }], warnings: [], evidence: [], read_back_verified: false, replay: false, caller_obligation: 'Use a disposable target root outside the source repository.' };

  let source: { revision: string; tree_hash: string };
  try {
    validateVNextSource(sourceRoot);
    validateVNextRuntimeContract(sourceRoot, false);
    const identity = getSourceIdentity(sourceRoot);
    source = { revision: identity.revision, tree_hash: identity.tree_hash };
  } catch (error) {
    return { status: 'rejected', mode: options.mode, target_root: targetRoot, target_state: 'conflicting', target_identity: targetIdentity, project: { name: 'unknown', slug: 'unknown' }, host: options.host ?? 'codex', source: emptySource, planned_writes: [], planned_directories: [], planned_deletes: [], changed_paths: normalizeChangedPaths(options.changedPaths), blockers: [{ code: 'SOURCE_CONTRACT_INVALID', message: error instanceof Error ? error.message : String(error) }], warnings: [], evidence: [], read_back_verified: false, replay: false, caller_obligation: 'Repair the source contract/runtime validation before Bootstrap.' };
  }

  const classification = classifyBootstrapTarget(targetRoot);
  let distribution: ReturnType<typeof validateInstalledDistribution>;
  try {
    const packageRoot = path.resolve(options.distributionPackageRoot ?? path.join(sourceRoot, 'packages', 'vibe-governance'));
    distribution = validateInstalledDistribution(targetRoot, packageRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'blocked', mode: options.mode, target_root: targetRoot, target_state: classification.state, target_identity: targetIdentity, project: { name: 'unknown', slug: 'unknown' }, host: options.host ?? 'codex', source, planned_writes: [], planned_directories: [], planned_deletes: [], changed_paths: normalizeChangedPaths(options.changedPaths), blockers: [{ code: 'DISTRIBUTION_PREREQUISITE_FAILED', message: `Bootstrap requires a valid installed Vibe Governance Distribution: ${message}` }], warnings: classification.reasons.map(reason => ({ code: 'TARGET_STATE', message: reason })), evidence: [...sourceEvidence(options.mode, classification.state, source, []), { id: 'distribution-read-back', kind: 'installed-distribution-read-back', status: 'blocked', detail: message }], read_back_verified: false, replay: false, caller_obligation: 'Run or repair the Distribution boundary, then rerun Bootstrap.' };
  }
  const support = bootstrapProjectTargetLocal(sourceSupportOptions({ ...options, changedPaths: undefined }, source, false, undefined));
  admitSourceChangedPaths(support, options);
  return mapSupportPlan(support, options, source, `Distribution ${distribution.state.distribution_version} passed source package and target read-back validation.`);
}

/** Commit through the same target-local Runtime transaction used by a release target. */
export function bootstrapProject(options: BootstrapProjectOptions): BootstrapPlan {
  const preview = buildBootstrapPlan({ ...options, write: false });
  if (preview.status !== 'ready' || options.write !== true || !preview.proposal) return preview;
  const support = bootstrapProjectTargetLocal(sourceSupportOptions(options, preview.source, true));
  return mapSupportPlan(support, options, preview.source, 'Distribution prerequisite and Runtime read-back remained valid during Bootstrap commit.', true);
}

export function recoverBootstrapProject(targetRoot: string): { status: 'recovered' | 'blocked'; message: string; read_back_verified: boolean } {
  const markerPath = targetPath(targetRoot, VNEXT_BOOTSTRAP_IN_PROGRESS_RELATIVE_PATH);
  if (!fs.existsSync(markerPath)) return { status: 'blocked', message: 'no Bootstrap interruption marker is present.', read_back_verified: false };
  const marker = readBootstrapMarker(targetRoot);
  let receipt: BootstrapReceipt | null = null;
  try {
    receipt = readReceipt(targetRoot);
  } catch (error) {
    return { status: 'blocked', message: `Bootstrap Receipt is invalid while an interruption marker is present: ${error instanceof Error ? error.message : String(error)}`, read_back_verified: false };
  }
  if (receipt) {
    try {
      verifyReceiptManagedFiles(targetRoot, receipt);
      verifyNoLegacySurface(targetRoot);
      if (['greenfield', 'adopt', 'realign'].includes(receipt.mode)) {
        const current = readCanonicalCurrentTask(targetRoot);
        if (current.runtimeState.workflow_status !== 'closed' || current.runtimeState.lifecycle_state !== 'archived' || current.runtimeState.active_step_status !== 'completed' || (receipt.mode !== 'realign' && current.runtimeState.task_id !== '000')) throw new BootstrapFacadeError('BOOTSTRAP_TASK_STATE_INVALID', 'completed Bootstrap Receipt does not retain a closed + archived canonical task state.');
      }
      fs.rmSync(markerPath, { force: true });
      return { status: 'recovered', message: 'completed Bootstrap was read back; interruption marker cleared.', read_back_verified: true };
    } catch (error) {
      return { status: 'blocked', message: `completed Bootstrap Receipt exists but health/read-back failed: ${error instanceof Error ? error.message : String(error)}`, read_back_verified: false };
    }
  }
  const planned = Array.isArray(marker.planned_writes) ? marker.planned_writes as string[] : [];
  const directories = Array.isArray(marker.planned_directories) ? marker.planned_directories as string[] : [];
  if ([...planned, ...directories].some(relative => fs.existsSync(targetPath(targetRoot, relative)))) return { status: 'blocked', message: 'partial Bootstrap assets remain without a completion Receipt; preserve the marker and perform explicit owner-led recovery.', read_back_verified: false };
  fs.rmSync(markerPath, { force: true });
  return { status: 'recovered', message: 'no promoted Bootstrap asset was found; marker cleared for a safe retry.', read_back_verified: true };
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
    'Write mode requires the exact changed_paths returned by a dry run. Target projects use the installed Node Runtime support boundary.',
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
    if (!mode || !BOOTSTRAP_MODES.includes(mode)) throw new BootstrapFacadeError('BOOTSTRAP_INPUT_INVALID', '--mode must be one of the closed Bootstrap modes.');
    const paths = [...argv.flatMap((arg, index) => arg === '--path' ? [argv[index + 1] ?? ''] : []), ...(cliValue(argv, '--paths-file') ? parseListFile(cliValue(argv, '--paths-file')!) : [])];
    const authFile = cliValue(argv, '--conditional-authorizations-file');
    const designFile = cliValue(argv, '--design-baseline-file');
    const factsFile = cliValue(argv, '--facts-file');
    const conditionalAuthorizations = authFile ? readJson(authFile) as ConditionalScopeAuthorization[] : undefined;
    const designBaseline = designFile ? readJsonObject(designFile, 'BOOTSTRAP_INPUT_INVALID') as Record<string, string> : undefined;
    const facts = factsFile ? readJson(factsFile) as BootstrapFact[] : undefined;
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
    console.log(JSON.stringify(((value: BootstrapPlan) => { const { proposal: _proposal, ...publicValue } = value; return publicValue; })(result), null, 2));
    process.exit(['ready', 'installed', 'replayed'].includes(result.status) ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
