/**
 * Target-local Bootstrap support.
 *
 * This module is part of the project-local Runtime distribution. It is not a
 * source-repository facade and it never imports source templates, Bun, or
 * WORKFLOW_SYSTEM_ROOT. It reads immutable Distribution support bytes, turns
 * caller-provided intent/evidence into one typed Bootstrap proposal, and
 * delegates the governance mutation to the Runtime transaction boundary.
 * Distribution software remains read-only throughout.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { parse, parseDocument, stringify } from 'yaml';
import {
  applyBootstrapProjectProposal,
  BOOTSTRAP_MODES,
  computeBootstrapTargetIdentity,
  validateBootstrapProjectProposal,
  type BootstrapAsset,
  type BootstrapAuthorityEvidence,
  type BootstrapMode,
  type BootstrapProjectProposal,
  type BootstrapRuntimeResult,
  type BootstrapSemanticOperation,
} from './bootstrap';
import { computeScopedTreeHash } from './scoped-tree-hash';
import { readCanonicalCurrentTask, validateVNextRuntimeContract } from './kernel';
import type { ConditionalScopeAuthorization } from './mutation-scope';
import { STATUS_SECTION_KEYS, STATUS_SECTIONS, type StatusSectionKey } from './status-schema';
import {
  validateCompletedMigrationProvenance,
  MigrationProvenanceError,
  type CompletedMigrationProvenance,
} from './migration-provenance';

export const BOOTSTRAP_SUPPORT_TEMPLATE_RELATIVE_PATH = '.workflow-system/runtime/support/bootstrap/CURRENT_TASK.md.tmpl' as const;
export const BOOTSTRAP_SUPPORT_MARKER_RELATIVE_PATH = '.workflow-system/vnext/BOOTSTRAP_IN_PROGRESS.json' as const;
export const BOOTSTRAP_SUPPORT_RECEIPT_RELATIVE_PATH = '.workflow-system/vnext/BOOTSTRAP_RECEIPT.json' as const;
export const DISTRIBUTION_STATE_RELATIVE_PATH = '.workflow-system/vnext/DISTRIBUTION_STATE.json' as const;
export const DISTRIBUTION_IN_PROGRESS_RELATIVE_PATH = '.workflow-system/vnext/DISTRIBUTION_IN_PROGRESS.json' as const;

const CURRENT_TASK_RELATIVE_PATH = 'docs/workflow/CURRENT_TASK.md';
const PROJECT_PROFILE_RELATIVE_PATH = '.workflow-system/PROJECT_PROFILE.yaml';
const FULL_WORKFLOW_DOCS = [
  'docs/workflow/CONTRACTS.md',
  'docs/workflow/DECISIONS.md',
  'docs/workflow/STATUS.md',
  'docs/workflow/LESSONS.md',
  'docs/workflow/ROADMAP.md',
  'docs/workflow/WORKFLOW_GUIDE.md',
] as const;
const DESIGN_PATHS = [
  'docs/designs/architecture.md',
  'docs/designs/database.md',
  'docs/designs/detailed-design.md',
  'docs/designs/api-contracts.md',
  'docs/designs/domain-model.md',
] as const;
const INVENTORY_PATHS = [
  'docs/adoption/architecture-inventory.md',
  'docs/adoption/database-inventory.md',
  'docs/adoption/API_INVENTORY.md',
  'docs/adoption/RISK_REGISTER.md',
] as const;
const REQUIRED_SKILL_ENTRIES = [
  'bootstrap-project',
  'prepare-task',
  'review-change',
  'execute-step',
  'debug-task',
  'task-lifecycle',
  'capture-work-item',
  'close-task',
  'validate-change',
] as const;
const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const HASH64 = /^[a-f0-9]{64}$/u;
const BOOTSTRAP_RECEIPT_KEYS = [
  'schema_version', 'kind', 'mode', 'target_identity', 'project', 'host', 'source',
  'input_fingerprint', 'completed_at', 'managed_files', 'legacy_compatibility', 'recovery_boundary',
] as const;
const DISTRIBUTION_STATE_KEYS = [
  'schema_version', 'kind', 'distribution_state', 'distribution_version', 'manifest_digest',
  'installed_at', 'managed_files', 'legacy_compatibility', 'recovery_boundary',
] as const;

export type BootstrapSupportHost = 'codex' | 'claude' | 'factory';

export type BootstrapSupportFact = {
  key: string;
  value: string;
  source: string;
  certainty: 'confirmed' | 'inferred' | 'unknown';
};

export type BootstrapSupportOptions = {
  targetRoot: string;
  mode: BootstrapMode;
  write?: boolean;
  projectName?: string;
  projectSlug?: string;
  host?: BootstrapSupportHost;
  designBaseline?: Record<string, string>;
  designConfirmed?: boolean;
  inventoryFacts?: BootstrapSupportFact[];
  confirmedFacts?: BootstrapSupportFact[];
  adoptionConfirmed?: boolean;
  changedPaths?: string[];
  conditionalAuthorizations?: ConditionalScopeAuthorization[];
  /** Source-side facade may supply its validated source identity. */
  source?: { revision: string; tree_hash: string };
  /** Legacy-aware adapters may report a detected legacy surface. */
  legacySurfacePresent?: boolean;
  /** Source-side Migration Pack admission; target-local uses the neutral verifier. */
  migrationAdmission?: BootstrapMigrationAdmission;
};

export type BootstrapSupportState = 'empty' | 'existing' | 'valid' | 'stale' | 'incomplete' | 'conflicting' | 'legacy' | 'governed' | 'in-progress';

export type BootstrapMigrationAdmission = {
  status: 'none' | 'valid' | 'invalid';
  provenance?: CompletedMigrationProvenance;
  reason?: string;
};

export type BootstrapSupportPlan = {
  status: 'ready' | 'needs-confirmation' | 'replayed' | 'installed' | 'blocked';
  target_root: string;
  target_state: BootstrapSupportState;
  target_identity: string;
  mode: BootstrapMode;
  project: { name: string; slug: string };
  host: BootstrapSupportHost;
  source: { revision: string; tree_hash: string };
  planned_writes: string[];
  planned_directories: string[];
  planned_deletes: string[];
  changed_paths: string[];
  blockers: Array<{ code: string; message: string; path?: string }>;
  warnings: Array<{ code: string; message: string; path?: string }>;
  read_back_verified: boolean;
  runtime_result?: BootstrapRuntimeResult;
  proposal?: BootstrapProjectProposal;
};

export type BootstrapReceipt = {
  schema_version: 1;
  kind: 'vnext-bootstrap-receipt';
  mode: BootstrapMode;
  target_identity: string;
  project: { name: string; slug: string };
  host: BootstrapSupportHost;
  source: { revision: string; tree_hash: string };
  input_fingerprint: string;
  completed_at: string;
  managed_files: Array<{ path: string; checksum: string }>;
  legacy_compatibility: 'absent';
  recovery_boundary: 'in-progress-marker';
};

export type DistributionReadback = {
  distribution_version: string;
  manifest_digest: string;
  state_content: string;
  managed_files: Array<{ path: string; checksum: string; category: string }>;
};

export class BootstrapSupportError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'BootstrapSupportError';
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new BootstrapSupportError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function expectRecord(value: unknown, location: string): Record<string, unknown> {
  if (!isRecord(value)) fail('BOOTSTRAP_SUPPORT_SCHEMA_INVALID', `${location} must be a mapping.`);
  return value;
}

function expectString(value: unknown, location: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) fail('BOOTSTRAP_SUPPORT_SCHEMA_INVALID', `${location} must be a non-empty string.`);
  return value.trim();
}

function expectExactKeys(value: Record<string, unknown>, keys: readonly string[], location: string): void {
  const expected = new Set(keys);
  const missing = keys.filter(key => !(key in value));
  const extra = Object.keys(value).filter(key => !expected.has(key));
  if (missing.length > 0 || extra.length > 0) fail('BOOTSTRAP_SUPPORT_SCHEMA_INVALID', `${location} keys mismatch; missing=[${missing.join(', ')}], unexpected=[${extra.join(', ')}].`);
}

function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map(key => [key, stableValue((value as Record<string, unknown>)[key])]));
  return value;
}

function digest(value: unknown): string {
  return sha256(JSON.stringify(stableValue(value)));
}

function normalizeRelative(value: string, location = 'path'): string {
  const normalized = value.trim().replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/\/+/gu, '/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//u.test(normalized) || normalized.split('/').some(segment => segment === '..' || segment.length === 0) || /[\0-\x1F\x7F]/u.test(normalized) || normalized.includes('*')) fail('BOOTSTRAP_SUPPORT_PATH_INVALID', `${location} must be a concrete repository-relative path.`);
  return normalized;
}

function targetPath(root: string, relative: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...normalizeRelative(relative).split('/'));
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  if (resolved !== resolvedRoot && !resolved.startsWith(prefix)) fail('BOOTSTRAP_SUPPORT_PATH_INVALID', `target path escapes root: ${relative}`);
  return resolved;
}

function readJsonObject(filePath: string, location: string): Record<string, unknown> {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) fail('BOOTSTRAP_SUPPORT_INPUT_INVALID', `${location} is missing.`);
  try {
    return expectRecord(JSON.parse(fs.readFileSync(filePath, 'utf8')), location);
  } catch (error) {
    if (error instanceof BootstrapSupportError) throw error;
    fail('BOOTSTRAP_SUPPORT_INPUT_INVALID', `${location} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readYamlObject(filePath: string, location: string): Record<string, unknown> {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return {};
  try {
    const value = parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    return value === null ? {} : expectRecord(value, location);
  } catch (error) {
    fail('BOOTSTRAP_SUPPORT_PROFILE_INVALID', `${location} is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function fileHash(filePath: string): string {
  return sha256(fs.readFileSync(filePath));
}

function existingProfile(root: string): Record<string, unknown> | null {
  const filePath = targetPath(root, PROJECT_PROFILE_RELATIVE_PATH);
  if (!fs.existsSync(filePath)) return null;
  return readYamlObject(filePath, PROJECT_PROFILE_RELATIVE_PATH);
}

function profileProject(profile: Record<string, unknown> | null): { name: string; slug: string } | null {
  const project = profile?.project;
  if (!isRecord(project) || typeof project.name !== 'string' || typeof project.slug !== 'string') return null;
  return { name: project.name.trim(), slug: project.slug.trim() };
}

function safeSlug(value: string): string {
  const normalized = value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '');
  return normalized || 'project';
}

function resolveProject(root: string, options: BootstrapSupportOptions, receipt: BootstrapReceipt | null): { name: string; slug: string } {
  const profile = existingProfile(root);
  const profileIdentity = profileProject(profile);
  let packageName: string | null = null;
  const packagePath = targetPath(root, 'package.json');
  if (fs.existsSync(packagePath)) {
    try {
      const packageJson = readJsonObject(packagePath, 'package.json');
      packageName = typeof packageJson.name === 'string' && packageJson.name.trim() ? packageJson.name.trim() : null;
    } catch {
      packageName = null;
    }
  }
  const name = options.projectName?.trim() || profileIdentity?.name || receipt?.project.name || packageName || path.basename(path.resolve(root));
  const slug = options.projectSlug?.trim() || profileIdentity?.slug || receipt?.project.slug || safeSlug(name);
  if (!SAFE_SLUG.test(slug)) fail('BOOTSTRAP_SUPPORT_PROFILE_INVALID', `project slug must be lowercase kebab-case: ${slug}`);
  if (profileIdentity && options.projectName && profileIdentity.name !== options.projectName.trim()) fail('BOOTSTRAP_SUPPORT_IDENTITY_CONFLICT', 'caller project name conflicts with the existing project profile.');
  if (profileIdentity && options.projectSlug && profileIdentity.slug !== options.projectSlug.trim()) fail('BOOTSTRAP_SUPPORT_IDENTITY_CONFLICT', 'caller project slug conflicts with the existing project profile.');
  if (profile?.paths && isRecord(profile.paths) && profile.paths.workflow_home !== undefined && profile.paths.workflow_home !== 'docs/workflow') fail('BOOTSTRAP_SUPPORT_IDENTITY_CONFLICT', 'existing paths.workflow_home is not the canonical vNext workflow home.');
  return { name, slug };
}

function listTopLevelNames(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).map(entry => entry.name).sort();
}

function hasMeaningfulImplementation(root: string): boolean {
  const names = listTopLevelNames(root);
  if (names.some(name => ['src', 'app', 'lib', 'packages', 'server', 'client'].includes(name))) return true;
  return names.some(name => /\.(?:ts|tsx|js|jsx|py|go|rs|java|cs|php|rb|swift)$/iu.test(name));
}

function isVNextMarkerFile(root: string, relative: string): boolean {
  const filePath = targetPath(root, relative);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  return /vnext|vNext/iu.test(fs.readFileSync(filePath, 'utf8').slice(0, 1600));
}

function isFrozenPath(root: string, relative: string): boolean {
  const normalized = normalizeRelative(relative, 'freeze check');
  const registries = ['FREEZE_REGISTRY.md', '.workflow-system/FREEZE_REGISTRY.md']
    .map(file => targetPath(root, file))
    .filter(file => fs.existsSync(file) && fs.statSync(file).isFile());
  for (const registry of registries) {
    if (fs.readFileSync(registry, 'utf8').split(/\r?\n/u).some(line => line.includes(normalized) && !/^\s*[-#]*\s*(unfreeze|not frozen)/iu.test(line))) return true;
  }
  const filePath = targetPath(root, normalized);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const head = fs.readFileSync(filePath, 'utf8').split(/\r?\n/u).slice(0, 20).join('\n');
    if (/@frozen|DO NOT MODIFY/iu.test(head)) return true;
  }
  return false;
}

function readBootstrapReceipt(root: string): BootstrapReceipt | null {
  const filePath = targetPath(root, BOOTSTRAP_SUPPORT_RECEIPT_RELATIVE_PATH);
  if (!fs.existsSync(filePath)) return null;
  const raw = readJsonObject(filePath, 'BOOTSTRAP_RECEIPT.json');
  expectExactKeys(raw, BOOTSTRAP_RECEIPT_KEYS, 'BOOTSTRAP_RECEIPT.json');
  const project = expectRecord(raw.project, 'BOOTSTRAP_RECEIPT.json.project');
  const source = expectRecord(raw.source, 'BOOTSTRAP_RECEIPT.json.source');
  if (raw.schema_version !== 1 || raw.kind !== 'vnext-bootstrap-receipt' || !BOOTSTRAP_MODES.includes(raw.mode as BootstrapMode) || typeof raw.target_identity !== 'string' || typeof project.name !== 'string' || typeof project.slug !== 'string' || !['codex', 'claude', 'factory'].includes(raw.host as string) || typeof source.revision !== 'string' || typeof source.tree_hash !== 'string' || !HASH64.test(source.tree_hash) || typeof raw.input_fingerprint !== 'string' || !HASH64.test(raw.input_fingerprint) || typeof raw.completed_at !== 'string' || raw.legacy_compatibility !== 'absent' || raw.recovery_boundary !== 'in-progress-marker') {
    fail('BOOTSTRAP_SUPPORT_RECEIPT_INVALID', 'BOOTSTRAP_RECEIPT.json identity or schema fields are invalid.');
  }
  if (!Array.isArray(raw.managed_files) || raw.managed_files.length === 0) fail('BOOTSTRAP_SUPPORT_RECEIPT_INVALID', 'BOOTSTRAP_RECEIPT.json.managed_files must be non-empty.');
  const managed = raw.managed_files.map((item, index) => {
    const record = expectRecord(item, `BOOTSTRAP_RECEIPT.json.managed_files[${index}]`);
    expectExactKeys(record, ['path', 'checksum'], `BOOTSTRAP_RECEIPT.json.managed_files[${index}]`);
    const relative = normalizeRelative(expectString(record.path, `BOOTSTRAP_RECEIPT.json.managed_files[${index}].path`));
    const checksum = expectString(record.checksum, `BOOTSTRAP_RECEIPT.json.managed_files[${index}].checksum`);
    if (!HASH64.test(checksum)) fail('BOOTSTRAP_SUPPORT_RECEIPT_INVALID', `BOOTSTRAP_RECEIPT.json.managed_files[${index}].checksum is invalid.`);
    if (relative.startsWith('.workflow-system/runtime/') || relative.startsWith('.agents/skills/') || relative === '.workflow-system/WORKFLOW_PROTOCOL.md' || relative === '.workflow-system/FILE_SCHEMAS.md' || relative === '.workflow-system/vnext/SOURCE_CONTRACT.yaml' || relative === '.workflow-system/vnext/RUNTIME_CONTRACT.yaml') fail('BOOTSTRAP_SUPPORT_RECEIPT_INVALID', `BOOTSTRAP receipt cannot own Distribution software: ${relative}`);
    return { path: relative, checksum };
  });
  if (new Set(managed.map(item => item.path)).size !== managed.length) fail('BOOTSTRAP_SUPPORT_RECEIPT_INVALID', 'BOOTSTRAP_RECEIPT.json.managed_files contains duplicates.');
  return {
    schema_version: 1,
    kind: 'vnext-bootstrap-receipt',
    mode: raw.mode as BootstrapMode,
    target_identity: raw.target_identity as string,
    project: { name: project.name as string, slug: project.slug as string },
    host: raw.host as BootstrapSupportHost,
    source: { revision: source.revision as string, tree_hash: source.tree_hash as string },
    input_fingerprint: raw.input_fingerprint as string,
    completed_at: raw.completed_at as string,
    managed_files: managed,
    legacy_compatibility: 'absent',
    recovery_boundary: 'in-progress-marker',
  };
}

function isDistributionManagedPath(relative: string): boolean {
  return relative === '.workflow-system/WORKFLOW_PROTOCOL.md'
    || relative === '.workflow-system/FILE_SCHEMAS.md'
    || relative === '.workflow-system/vnext/SOURCE_CONTRACT.yaml'
    || relative === '.workflow-system/vnext/RUNTIME_CONTRACT.yaml'
    || relative.startsWith('.workflow-system/runtime/')
    || /^\.agents\/skills\/[a-z][a-z0-9-]*\/SKILL\.md$/u.test(relative);
}

function validateSkillFile(root: string, entry: string): void {
  const relative = `.agents/skills/${entry}/SKILL.md`;
  const filePath = targetPath(root, relative);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) fail('BOOTSTRAP_SUPPORT_DISTRIBUTION_INVALID', `required Distribution Skill is missing: ${relative}`);
  const content = fs.readFileSync(filePath, 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u.exec(content);
  if (!match) fail('BOOTSTRAP_SUPPORT_DISTRIBUTION_INVALID', `${relative} is missing Agent Skill frontmatter.`);
  const document = parseDocument(match[1], { uniqueKeys: true });
  const diagnostics = [...document.errors, ...document.warnings];
  if (diagnostics.length > 0) fail('BOOTSTRAP_SUPPORT_DISTRIBUTION_INVALID', `${relative} frontmatter is invalid: ${diagnostics.map(item => item.message).join('; ')}`);
  const frontmatter = expectRecord(document.toJS(), `${relative} frontmatter`);
  if (frontmatter.name !== entry || typeof frontmatter.description !== 'string' || !frontmatter.description.trim()) fail('BOOTSTRAP_SUPPORT_DISTRIBUTION_INVALID', `${relative} must declare name=${entry} and a non-empty description.`);
  const contract = expectRecord(frontmatter.entry_contract, `${relative}.entry_contract`);
  if (contract.entry !== entry) fail('BOOTSTRAP_SUPPORT_DISTRIBUTION_INVALID', `${relative}.entry_contract.entry is not canonical.`);
}

/**
 * Read-only Distribution prerequisite check for the installed target. This
 * checks the already-admitted State and exact managed checksums; it does not
 * classify, install, upgrade, or migrate Distribution state.
 */
export function validateInstalledDistributionReadback(root: string): DistributionReadback {
  const statePath = targetPath(root, DISTRIBUTION_STATE_RELATIVE_PATH);
  const journalPath = targetPath(root, DISTRIBUTION_IN_PROGRESS_RELATIVE_PATH);
  if (fs.existsSync(journalPath)) fail('BOOTSTRAP_SUPPORT_DISTRIBUTION_INVALID', 'Distribution has an interrupted transaction marker; recover through Distribution before Bootstrap.');
  const raw = readJsonObject(statePath, 'DISTRIBUTION_STATE.json');
  expectExactKeys(raw, DISTRIBUTION_STATE_KEYS, 'DISTRIBUTION_STATE.json');
  if (raw.schema_version !== 1 || raw.kind !== 'vibe-governance-distribution-state' || raw.distribution_state !== 'vnext' || raw.legacy_compatibility !== 'absent' || raw.recovery_boundary !== 'distribution-journal') fail('BOOTSTRAP_SUPPORT_DISTRIBUTION_INVALID', 'DISTRIBUTION_STATE.json is not a completed vNext Distribution state.');
  const version = expectString(raw.distribution_version, 'DISTRIBUTION_STATE.json.distribution_version');
  const manifestDigest = expectString(raw.manifest_digest, 'DISTRIBUTION_STATE.json.manifest_digest');
  if (!HASH64.test(manifestDigest) || !/^\d+\.\d+\.\d+$/u.test(version)) fail('BOOTSTRAP_SUPPORT_DISTRIBUTION_INVALID', 'Distribution State version or manifest digest is invalid.');
  if (!Array.isArray(raw.managed_files) || raw.managed_files.length === 0) fail('BOOTSTRAP_SUPPORT_DISTRIBUTION_INVALID', 'DISTRIBUTION_STATE.json.managed_files must be non-empty.');
  const managed = raw.managed_files.map((item, index) => {
    const record = expectRecord(item, `DISTRIBUTION_STATE.json.managed_files[${index}]`);
    expectExactKeys(record, ['path', 'checksum', 'category'], `DISTRIBUTION_STATE.json.managed_files[${index}]`);
    const relative = normalizeRelative(expectString(record.path, `DISTRIBUTION_STATE.json.managed_files[${index}].path`));
    const checksum = expectString(record.checksum, `DISTRIBUTION_STATE.json.managed_files[${index}].checksum`);
    if (!isDistributionManagedPath(relative) || !HASH64.test(checksum)) fail('BOOTSTRAP_SUPPORT_DISTRIBUTION_INVALID', `Distribution State contains an invalid managed path/checksum: ${relative}`);
    const category = expectString(record.category, `DISTRIBUTION_STATE.json.managed_files[${index}].category`);
    if (!['protocol', 'schema', 'skill', 'runtime', 'config'].includes(category)) fail('BOOTSTRAP_SUPPORT_DISTRIBUTION_INVALID', `Distribution State contains an unsupported managed category: ${relative}`);
    return { path: relative, checksum, category };
  }).sort((left, right) => left.path.localeCompare(right.path));
  if (new Set(managed.map(item => item.path)).size !== managed.length) fail('BOOTSTRAP_SUPPORT_DISTRIBUTION_INVALID', 'DISTRIBUTION_STATE.json.managed_files contains duplicates.');
  const managedMap = new Map(managed.map(item => [item.path, item]));
  for (const entry of managed) {
    const filePath = targetPath(root, entry.path);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile() || fileHash(filePath) !== entry.checksum) fail('BOOTSTRAP_SUPPORT_DISTRIBUTION_INVALID', `Distribution managed artifact read-back failed: ${entry.path}`);
  }
  const required = [
    '.workflow-system/WORKFLOW_PROTOCOL.md',
    '.workflow-system/FILE_SCHEMAS.md',
    '.workflow-system/vnext/SOURCE_CONTRACT.yaml',
    '.workflow-system/vnext/RUNTIME_CONTRACT.yaml',
    '.workflow-system/runtime/dist/cli.js',
    '.workflow-system/runtime/package.json',
    '.workflow-system/runtime/package-lock.json',
    BOOTSTRAP_SUPPORT_TEMPLATE_RELATIVE_PATH,
    ...REQUIRED_SKILL_ENTRIES.map(entry => `.agents/skills/${entry}/SKILL.md`),
  ];
  for (const relative of required) {
    const entry = managedMap.get(relative);
    if (!entry) fail('BOOTSTRAP_SUPPORT_DISTRIBUTION_INVALID', `Distribution State does not admit required artifact: ${relative}`);
  }
  const runtime = validateVNextRuntimeContract(root, true).runtime_distribution;
  if (runtime.package_version !== version) fail('BOOTSTRAP_SUPPORT_DISTRIBUTION_INVALID', 'Distribution State and project-local Runtime versions differ.');
  const protocol = fs.readFileSync(targetPath(root, '.workflow-system/WORKFLOW_PROTOCOL.md'), 'utf8');
  const schema = fs.readFileSync(targetPath(root, '.workflow-system/FILE_SCHEMAS.md'), 'utf8');
  if (!/^kind:\s*vnext-protocol\s*$/imu.test(protocol) || !/schema_version\s*:\s*1/iu.test(protocol)) fail('BOOTSTRAP_SUPPORT_DISTRIBUTION_INVALID', 'installed vNext Protocol is invalid.');
  if (!/^kind:\s*vnext-file-schema\s*$/imu.test(schema) || !/CURRENT_TASK\.md/iu.test(schema)) fail('BOOTSTRAP_SUPPORT_DISTRIBUTION_INVALID', 'installed vNext Schema is invalid.');
  const supportTemplate = fs.readFileSync(targetPath(root, BOOTSTRAP_SUPPORT_TEMPLATE_RELATIVE_PATH), 'utf8');
  if (!/^kind:\s*vnext-current-task\s*$/imu.test(supportTemplate) || !supportTemplate.includes('# vNext CURRENT_TASK')) fail('BOOTSTRAP_SUPPORT_DISTRIBUTION_INVALID', 'installed Bootstrap support template is invalid.');
  for (const entry of REQUIRED_SKILL_ENTRIES) validateSkillFile(root, entry);
  return { distribution_version: version, manifest_digest: manifestDigest, state_content: fs.readFileSync(statePath, 'utf8'), managed_files: managed };
}

function renderProfile(project: { name: string; slug: string }, targetIdentity: string, mode: BootstrapMode, host: BootstrapSupportHost, existing: Record<string, unknown> | null): string {
  const existingProject = existing?.project && isRecord(existing.project) ? existing.project : {};
  const existingPaths = existing?.paths && isRecord(existing.paths) ? existing.paths : {};
  const existingVNext = existing?.vnext && isRecord(existing.vnext) ? existing.vnext : {};
  const existingHosts = Array.isArray(existingProject.primary_hosts) ? existingProject.primary_hosts.filter((value): value is string => typeof value === 'string' && value.trim()) : [];
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
    paths: { ...existingPaths, workflow_home: 'docs/workflow' },
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
    '# vNext Workflow Guide', '', `Project: ${project.name} (${project.slug})`, '',
    '## Administrative entry', '', '- `bootstrap-project`: design, greenfield, inventory, adopt, or realign.', '',
    '## Daily entries', '', '- `prepare-task` → `execute-step` → optional `review-change` / `debug-task` → `close-task`.', '- `task-lifecycle` owns pause, interrupt, resume, and supersede transitions.', '- `capture-work-item` remains record-only.', '',
    '## Authoritative state', '', '- Runtime state is read from canonical `CURRENT_TASK.md`.', '- Contracts, Decisions, Status, and host guidance are changed through typed Runtime proposals.', '- Bootstrap completion requires Distribution prerequisite validation, scope admission, governance-only promotion, and read-back.', '',
  ].join('\n');
}

function renderContracts(project: { name: string; slug: string }, facts: BootstrapSupportFact[] = []): string {
  const confirmed = facts.filter(fact => fact.certainty === 'confirmed');
  return [
    '# vNext Contracts', '', `Project: ${project.name} (${project.slug})`, '', '## Confirmed boundaries', '',
    '- Bootstrap writes only the admitted workflow asset set.', '- Task state remains in canonical `CURRENT_TASK.md`.',
    ...confirmed.map(fact => `- ${fact.key}: ${fact.value} (source: ${fact.source})`), '',
    '## Candidate status', '', '- These entries are the confirmed bootstrap baseline; unconfirmed facts remain outside the locked Contract.', '',
    '## vNext Contract Records', '', '- Normal close-task Contract admissions are appended here through the typed Runtime operation; this section is not edited directly by a Skill.', '',
  ].join('\n');
}

function renderDecisions(project: { name: string; slug: string }, mode: BootstrapMode, facts: BootstrapSupportFact[] = [], draft = false): string {
  const confirmed = facts.filter(fact => fact.certainty === 'confirmed');
  const unresolved = facts.filter(fact => fact.certainty !== 'confirmed');
  return [
    '# vNext Decisions', '', `Project: ${project.name} (${project.slug})`, '', '## Bootstrap decision', '',
    `- mode: ${mode}`, `- status: ${draft ? 'draft' : 'confirmed'}`, '- authority: project owner', '',
    '## Confirmed facts', '', ...(confirmed.length > 0 ? confirmed.map(fact => `- ${fact.key}: ${fact.value} (source: ${fact.source})`) : ['- none']), '',
    '## Inferred or unknown facts', '', ...(unresolved.length > 0 ? unresolved.map(fact => `- ${fact.key}: ${fact.value} [${fact.certainty}; source: ${fact.source}]`) : ['- none']), '',
    '## vNext Decision Records', '', '- Normal close-task Decision admissions are appended here through the typed Runtime operation; this section is not edited directly by a Skill.', '',
  ].join('\n');
}

function renderStatus(project: { name: string; slug: string }, mode: BootstrapMode): string {
  const sectionBodies: Record<StatusSectionKey, readonly string[]> = {
    overview: [`- 项目：${project.name}`, `- slug：${project.slug}`, `- bootstrap mode：${mode}`],
    completed: [
      '- Governance assets generated after the installed Distribution was validated read-only.',
      '- Project profile and canonical task baseline read back successfully.',
    ],
    inProgress: ['- none'],
    pending: ['- none'],
    risks: ['- none'],
    removedOrDeferred: ['- none'],
    nextCheckpoint: ['- Prepare the next task through the daily Runtime path.'],
    recentUpdates: ['- Bootstrap generated this canonical STATUS baseline.'],
  };
  return [
    '# STATUS.md',
    '',
    ...STATUS_SECTION_KEYS.flatMap((key) => [
      `## ${STATUS_SECTIONS[key].title}`,
      '',
      ...sectionBodies[key],
      '',
    ]),
  ].join('\n');
}

function renderLessons(): string {
  return ['# LESSONS.md', '', '## Reusable lessons', '', '- Bootstrap evidence is recorded as a receipt and must not be inferred from file existence alone.', '- Unknown adoption facts remain visible until a source and authority promote them.', ''].join('\n');
}

function renderRoadmap(project: { name: string; slug: string }, mode: BootstrapMode, baseline?: Record<string, string>): string {
  return ['# ROADMAP.md', '', `Project: ${project.name} (${project.slug})`, '', '## Current boundary', '', `- ${mode} bootstrap completed as an administrative workflow operation.`, '', '## Next boundary', '', '- Prepare a concrete task with confirmed acceptance, exact mutation scope, and minimum-sufficient evidence.', ...(baseline ? ['', '## Design baseline consumed', '', ...Object.keys(baseline).sort().map(key => `- ${key}`)] : []), ''].join('\n');
}

function renderDesignDocument(filePath: string, baseline: Record<string, string>): string {
  const key = path.basename(filePath, '.md');
  const value = baseline[key] ?? baseline[filePath] ?? 'No confirmed content was supplied for this design section.';
  return [`# Design baseline: ${key}`, '', '## Authority', '', '- source: caller-provided confirmed design baseline', '- certainty: confirmed or explicitly awaiting confirmation', '', '## Content', '', value, ''].join('\n');
}

function renderBaselineDoc(baseline: Record<string, string>): string {
  return ['# vNext Design Baselines', '', 'The following design inputs are caller-provided proposals. They do not authorize feature implementation.', '', ...Object.keys(baseline).sort().map(key => `- ${key}: ${baseline[key]}`), ''].join('\n');
}

function renderInventoryFile(title: string, root: string, facts: BootstrapSupportFact[] = []): string {
  const names = listTopLevelNames(root);
  return [`# ${title}`, '', '## Observed project surface', '', ...(names.length > 0 ? names.map(name => `- ${name}`) : ['- empty target root']), '', '## Evidence and certainty', '', ...(facts.length > 0 ? facts.map(fact => `- ${fact.key}: ${fact.value} [${fact.certainty}; source: ${fact.source}]`) : ['- observed from target-root directory listing']), ''].join('\n');
}

function renderRiskRegister(facts: BootstrapSupportFact[] = []): string {
  const unknown = facts.filter(fact => fact.certainty !== 'confirmed');
  return ['# Adoption Risk Register', '', '## Open evidence gaps', '', ...(unknown.length > 0 ? unknown.map(fact => `- ${fact.key}: ${fact.value}; source=${fact.source}; disposition=confirm before promotion`) : ['- none recorded']), ''].join('\n');
}

function mergeAssets(...groups: BootstrapAsset[][]): BootstrapAsset[] {
  const map = new Map<string, BootstrapAsset>();
  for (const asset of groups.flat()) {
    if (map.has(asset.path)) fail('BOOTSTRAP_SUPPORT_TARGET_CONFLICT', `generated asset path is duplicated: ${asset.path}`);
    map.set(asset.path, asset);
  }
  return [...map.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function renderGovernanceDocument(file: string, project: { name: string; slug: string }, mode: BootstrapMode, facts: BootstrapSupportFact[], baseline: Record<string, string>): string {
  if (file.endsWith('/CONTRACTS.md')) return renderContracts(project, facts);
  if (file.endsWith('/DECISIONS.md')) return renderDecisions(project, mode, facts);
  if (file.endsWith('/STATUS.md')) return renderStatus(project, mode);
  if (file.endsWith('/LESSONS.md')) return renderLessons();
  if (file.endsWith('/ROADMAP.md')) return renderRoadmap(project, mode, baseline);
  return renderWorkflowGuide(project);
}

function makeGovernanceAssets(root: string, project: { name: string; slug: string }, targetIdentity: string, mode: BootstrapMode, host: BootstrapSupportHost, facts: BootstrapSupportFact[], baseline: Record<string, string>): BootstrapAsset[] {
  const templatePath = targetPath(root, BOOTSTRAP_SUPPORT_TEMPLATE_RELATIVE_PATH);
  if (!fs.existsSync(templatePath) || !fs.statSync(templatePath).isFile()) fail('BOOTSTRAP_SUPPORT_DISTRIBUTION_INVALID', `Bootstrap support template is missing: ${BOOTSTRAP_SUPPORT_TEMPLATE_RELATIVE_PATH}`);
  return [
    { path: PROJECT_PROFILE_RELATIVE_PATH, category: 'config', content: renderProfile(project, targetIdentity, mode, host, existingProfile(root)) },
    { path: CURRENT_TASK_RELATIVE_PATH, category: 'generated', content: fs.readFileSync(templatePath, 'utf8') },
    ...FULL_WORKFLOW_DOCS.map(file => ({ path: file, category: 'governance' as const, content: renderGovernanceDocument(file, project, mode, facts, baseline) })),
    { path: 'AGENTS.md', category: 'governance', content: renderGuidance(project) },
    { path: 'CLAUDE.md', category: 'governance', content: renderGuidance(project) },
  ];
}

function makeModeAssets(root: string, project: { name: string; slug: string }, mode: BootstrapMode, baseline: Record<string, string>, facts: BootstrapSupportFact[]): BootstrapAsset[] {
  if (mode === 'design') {
    return mergeAssets(
      DESIGN_PATHS.map(file => ({ path: file, category: 'governance' as const, content: renderDesignDocument(file, baseline) })),
      [
        { path: 'docs/workflow/BASELINES.md', category: 'governance', content: renderBaselineDoc(baseline) },
        { path: 'docs/workflow/ROADMAP.md', category: 'governance', content: renderRoadmap(project, mode, baseline) },
        { path: 'docs/workflow/DECISIONS.md', category: 'governance', content: renderDecisions(project, mode, [], true) },
      ],
    );
  }
  if (mode === 'inventory') {
    return [
      { path: INVENTORY_PATHS[0], category: 'governance', content: renderInventoryFile('Architecture Inventory', root, facts) },
      { path: INVENTORY_PATHS[1], category: 'governance', content: renderInventoryFile('Database Inventory', root, facts) },
      { path: INVENTORY_PATHS[2], category: 'governance', content: renderInventoryFile('API Inventory', root, facts) },
      { path: INVENTORY_PATHS[3], category: 'governance', content: renderRiskRegister(facts) },
    ];
  }
  return [];
}

function renderScopeDocument(allowed: readonly string[]): string {
  return [
    '## 允许修改范围', '', '### Allowed Files', '', ...allowed.map(file => `- \`${file}\``), '',
    '### Conditional Files', '', '- none', '', '## 禁止修改范围', '', '### Forbidden Files', '',
    '- `.git/**`', '- `src/**`', '- `app/**`', '- `lib/**`', '- `packages/**`', '- `package.json`', '- `package-lock.json`', '- `node_modules/**`',
    '',
  ].join('\n');
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

function normalizeFacts(value: BootstrapSupportFact[] | undefined, location: string): BootstrapSupportFact[] {
  return (value ?? []).map((fact, index) => {
    if (!fact || typeof fact.key !== 'string' || typeof fact.value !== 'string' || typeof fact.source !== 'string' || !['confirmed', 'inferred', 'unknown'].includes(fact.certainty)) fail('BOOTSTRAP_SUPPORT_INPUT_INVALID', `${location}[${index}] is invalid.`);
    return { key: fact.key.trim(), value: fact.value.trim(), source: fact.source.trim(), certainty: fact.certainty };
  });
}

function normalizeBaseline(value: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(value ?? {}).filter(([key, entry]) => key.trim() && typeof entry === 'string' && entry.trim()).map(([key, entry]) => [key.trim(), entry.trim()]));
}

function existingIsWorkflowOwned(root: string, relative: string, receipt: BootstrapReceipt | null = null): boolean {
  const filePath = targetPath(root, relative);
  if (!fs.existsSync(filePath)) return true;
  if (isFrozenPath(root, relative)) return false;
  if (relative === BOOTSTRAP_SUPPORT_RECEIPT_RELATIVE_PATH && receipt) return true;
  if (receipt?.managed_files.some(file => file.path === relative)) return true;
  if (relative.startsWith('.workflow-system/')) return relative === PROJECT_PROFILE_RELATIVE_PATH;
  if (relative === 'AGENTS.md' || relative === 'CLAUDE.md') return isVNextMarkerFile(root, relative);
  if (relative.startsWith('docs/workflow/') || relative.startsWith('docs/designs/') || relative.startsWith('docs/adoption/')) return isVNextMarkerFile(root, relative);
  return false;
}

function renderReceipt(mode: BootstrapMode, targetIdentity: string, project: { name: string; slug: string }, host: BootstrapSupportHost, source: { revision: string; tree_hash: string }, inputFingerprint: string, assets: readonly BootstrapAsset[]): string {
  return `${JSON.stringify({
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
  }, null, 2)}\n`;
}

function migrationAdmission(root: string, supplied?: BootstrapMigrationAdmission): BootstrapMigrationAdmission {
  if (supplied) return supplied;
  try {
    const provenance = validateCompletedMigrationProvenance(root);
    return provenance ? { status: 'valid', provenance } : { status: 'none' };
  } catch (error) {
    return { status: 'invalid', reason: error instanceof MigrationProvenanceError ? error.message : String(error) };
  }
}

export type BootstrapTargetClassification = { state: BootstrapSupportState; receipt: BootstrapReceipt | null; migration: BootstrapMigrationAdmission; reasons: string[] };

export function classifyBootstrapTargetLocal(root: string, options: { legacySurfacePresent?: boolean; migrationAdmission?: BootstrapMigrationAdmission } = {}): BootstrapTargetClassification {
  if (fs.existsSync(targetPath(root, BOOTSTRAP_SUPPORT_MARKER_RELATIVE_PATH))) return { state: 'in-progress', receipt: null, migration: { status: 'none' }, reasons: ['an explicit Bootstrap interruption marker is present'] };
  let receipt: BootstrapReceipt | null = null;
  try {
    receipt = readBootstrapReceipt(root);
  } catch (error) {
    return { state: 'conflicting', receipt: null, migration: { status: 'none' }, reasons: [error instanceof Error ? error.message : String(error)] };
  }
  const migration = migrationAdmission(root, options.migrationAdmission);
  if (migration.status === 'invalid') return { state: 'conflicting', receipt, migration, reasons: [migration.reason ?? 'completed Migration Pack provenance is invalid'] };
  if (options.legacySurfacePresent) return { state: 'legacy', receipt, migration, reasons: ['a compatibility or legacy workflow surface is present; use the offline Migration Pack boundary'] };
  const targetIdentity = computeBootstrapTargetIdentity(root);
  if (receipt && receipt.target_identity !== targetIdentity) return { state: 'conflicting', receipt, migration, reasons: ['Bootstrap receipt target identity does not match the current target root'] };
  try {
    const profile = existingProfile(root);
    const profileVNext = profile?.vnext;
    if (isRecord(profileVNext) && profileVNext.target_identity !== undefined && profileVNext.target_identity !== targetIdentity) return { state: 'conflicting', receipt, migration, reasons: ['project profile target identity does not match the current target root'] };
  } catch (error) {
    return { state: 'conflicting', receipt, migration, reasons: [error instanceof Error ? error.message : String(error)] };
  }
  if (receipt) {
    const drift = receipt.managed_files.filter(file => {
      const filePath = targetPath(root, file.path);
      return !fs.existsSync(filePath) || !fs.statSync(filePath).isFile() || fileHash(filePath) !== file.checksum;
    });
    return drift.length === 0 ? { state: 'valid', receipt, migration, reasons: [] } : { state: 'stale', receipt, migration, reasons: drift.map(file => `managed governance asset drifted: ${file.path}`) };
  }
  if (migration.status === 'valid') return { state: 'governed', receipt: null, migration, reasons: ['the project was admitted by the completed Migration Pack provenance verifier; a Bootstrap Receipt is not required'] };
  const governanceSignals = [PROJECT_PROFILE_RELATIVE_PATH, CURRENT_TASK_RELATIVE_PATH, ...FULL_WORKFLOW_DOCS];
  if (governanceSignals.some(relative => fs.existsSync(targetPath(root, relative)))) return { state: 'incomplete', receipt: null, migration, reasons: ['governance assets exist without Bootstrap transaction provenance'] };
  return { state: hasMeaningfulImplementation(root) ? 'existing' : 'empty', receipt: null, migration, reasons: [] };
}

function isValidReceiptModeTransition(receiptMode: BootstrapMode, requestedMode: BootstrapMode): boolean {
  if (requestedMode === 'realign') return true;
  if (receiptMode === requestedMode) return false;
  return (receiptMode === 'design' && requestedMode === 'greenfield')
    || (receiptMode === 'inventory' && requestedMode === 'adopt');
}

function modeBlockers(root: string, state: BootstrapSupportState, mode: BootstrapMode, options: BootstrapSupportOptions, baseline: Record<string, string>, facts: BootstrapSupportFact[], receipt: BootstrapReceipt | null, migration: BootstrapMigrationAdmission): Array<{ code: string; message: string }> {
  const blockers: Array<{ code: string; message: string }> = [];
  if (state === 'in-progress') blockers.push({ code: 'BOOTSTRAP_IN_PROGRESS', message: 'an interrupted Bootstrap marker requires explicit recovery before retry.' });
  if (state === 'legacy') blockers.push({ code: 'MIGRATION_REQUIRED', message: 'legacy/compatibility assets are outside Bootstrap; run the offline Migration Pack boundary.' });
  if (state === 'conflicting') blockers.push({ code: 'BOOTSTRAP_CONFLICT', message: 'existing Bootstrap receipt or target identity is conflicting.' });
  if (migration.status === 'valid' && mode !== 'realign' && !['in-progress', 'legacy', 'conflicting'].includes(state)) {
    blockers.push({ code: 'BOOTSTRAP_NOT_REQUIRED', message: 'Migration Pack provenance already establishes a governed vNext project; ordinary Bootstrap is not required.' });
    return blockers;
  }
  if (['greenfield', 'adopt', 'realign'].includes(mode) && fs.existsSync(targetPath(root, CURRENT_TASK_RELATIVE_PATH))) {
    try {
      const current = readCanonicalCurrentTask(root);
      if (current.runtimeState.workflow_status !== 'closed'
        || current.runtimeState.lifecycle_state !== 'archived'
        || current.runtimeState.active_step_status !== 'completed'
        || (mode !== 'realign' && current.runtimeState.task_id !== '000')) {
        blockers.push({ code: 'BOOTSTRAP_TASK_STATE_INVALID', message: mode === 'realign'
          ? 'realign cannot run over an active or invalid canonical CURRENT_TASK; close or recover the task through the daily Runtime first.'
          : 'bootstrap cannot replace an existing active or non-baseline canonical CURRENT_TASK; continue through the daily Runtime or close/recover it first.' });
      }
    } catch (error) {
      blockers.push({ code: 'BOOTSTRAP_TASK_STATE_INVALID', message: `existing canonical CURRENT_TASK is not a readable vNext baseline: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  if (state === 'valid' && receipt && receipt.mode !== mode && !isValidReceiptModeTransition(receipt.mode, mode)) blockers.push({ code: 'BOOTSTRAP_IDENTITY_CONFLICT', message: 'an existing Bootstrap receipt does not admit this mode transition; replay the same mode or use realign.' });
  if (mode === 'design') {
    if (!['empty', 'existing', 'valid'].includes(state)) blockers.push({ code: 'BOOTSTRAP_STATE_INVALID', message: 'design mode only accepts an uninitialized target or valid Bootstrap replay.' });
    if (Object.keys(baseline).length === 0) blockers.push({ code: 'DESIGN_EVIDENCE_MISSING', message: 'design mode requires a caller-provided design baseline.' });
  }
  if (mode === 'greenfield') {
    if (state !== 'empty' && state !== 'valid' && !(state === 'existing' && !hasMeaningfulImplementation(root))) blockers.push({ code: 'GREENFIELD_PRECONDITION', message: 'greenfield mode requires an empty target, design-only preparation, or a valid Bootstrap replay.' });
    if (Object.keys(baseline).length === 0 || options.designConfirmed !== true) blockers.push({ code: 'DESIGN_CONFIRMATION_REQUIRED', message: 'greenfield mode requires a confirmed design baseline.' });
  }
  if (mode === 'inventory' && state !== 'valid' && (state !== 'existing' || !hasMeaningfulImplementation(root))) blockers.push({ code: 'INVENTORY_PRECONDITION', message: 'inventory mode requires an existing project implementation or valid Bootstrap replay.' });
  if (mode === 'adopt') {
    if (state !== 'valid' && (!['existing', 'incomplete'].includes(state) || !hasMeaningfulImplementation(root))) blockers.push({ code: 'ADOPT_PRECONDITION', message: 'adopt mode requires an existing project implementation or valid replay.' });
    if (state !== 'valid' && !fs.existsSync(targetPath(root, 'docs/adoption/architecture-inventory.md'))) blockers.push({ code: 'INVENTORY_REQUIRED', message: 'adopt mode requires inventory evidence from inventory mode.' });
    if (options.adoptionConfirmed !== true) blockers.push({ code: 'ADOPTION_CONFIRMATION_REQUIRED', message: 'adopt mode requires explicit project-owner confirmation.' });
    if (facts.length === 0) blockers.push({ code: 'ADOPTION_FACTS_MISSING', message: 'adopt mode requires facts with provenance.' });
  }
  if (mode === 'realign' && !['valid', 'stale', 'incomplete', 'governed'].includes(state)) blockers.push({ code: 'REALIGN_PRECONDITION', message: 'realign mode requires an existing governed vNext workflow asset surface.' });
  return blockers;
}

function verifyReceiptReadBack(root: string, receipt: BootstrapReceipt, assets: readonly BootstrapAsset[]): void {
  const expectedPaths = assets.filter(asset => asset.path !== BOOTSTRAP_SUPPORT_RECEIPT_RELATIVE_PATH).map(asset => asset.path).sort((left, right) => left.localeCompare(right));
  const actualPaths = receipt.managed_files.map(file => file.path).sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(expectedPaths) !== JSON.stringify(actualPaths)) fail('BOOTSTRAP_SUPPORT_READ_BACK_FAILED', 'Bootstrap receipt managed-file paths do not match the governance proposal.');
  for (const file of receipt.managed_files) {
    const filePath = targetPath(root, file.path);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile() || fileHash(filePath) !== file.checksum) fail('BOOTSTRAP_SUPPORT_READ_BACK_FAILED', `Bootstrap governance asset read-back failed: ${file.path}`);
  }
}

function verifyReceipt(root: string, receipt: BootstrapReceipt, assets: readonly BootstrapAsset[]): void {
  verifyReceiptReadBack(root, receipt, assets);
  const expected = assets.filter(asset => asset.path !== BOOTSTRAP_SUPPORT_RECEIPT_RELATIVE_PATH).map(asset => ({ path: asset.path, checksum: sha256(Buffer.from(asset.content, 'utf8')) })).sort((left, right) => left.path.localeCompare(right.path));
  const actual = receipt.managed_files.slice().sort((left, right) => left.path.localeCompare(right.path));
  if (JSON.stringify(expected) !== JSON.stringify(actual)) fail('BOOTSTRAP_SUPPORT_READ_BACK_FAILED', 'Bootstrap receipt managed_files does not match the governance proposal.');
}

function verifyBootstrapHealth(root: string, proposal: BootstrapProjectProposal, distributionBefore: DistributionReadback): void {
  const distributionAfter = validateInstalledDistributionReadback(root);
  if (distributionAfter.state_content !== distributionBefore.state_content) fail('BOOTSTRAP_SUPPORT_DISTRIBUTION_MUTATED', 'Bootstrap changed Distribution State bytes.');
  for (const asset of proposal.assets) {
    const filePath = targetPath(root, asset.path);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile() || fileHash(filePath) !== sha256(Buffer.from(asset.content, 'utf8'))) fail('BOOTSTRAP_SUPPORT_READ_BACK_FAILED', `promoted governance asset did not read back identically: ${asset.path}`);
  }
  const receipt = readBootstrapReceipt(root);
  if (!receipt || receipt.target_identity !== proposal.target_identity || receipt.mode !== proposal.mode) fail('BOOTSTRAP_SUPPORT_READ_BACK_FAILED', 'Bootstrap receipt identity did not read back correctly.');
  verifyReceipt(root, receipt, proposal.assets);
  if (['greenfield', 'adopt', 'realign'].includes(proposal.mode)) {
    const current = readCanonicalCurrentTask(root);
    if (current.runtimeState.workflow_status !== 'closed' || current.runtimeState.lifecycle_state !== 'archived' || current.runtimeState.active_step_status !== 'completed' || (proposal.mode !== 'realign' && current.runtimeState.task_id !== '000')) fail('BOOTSTRAP_SUPPORT_READ_BACK_FAILED', 'canonical CURRENT_TASK is not a closed + archived Bootstrap baseline.');
  }
}

export function bootstrapRollbackScope(proposal: Pick<BootstrapProjectProposal, 'requested_write_targets' | 'delete_targets'>): string[] {
  return [...new Set([...proposal.requested_write_targets, ...proposal.delete_targets, BOOTSTRAP_SUPPORT_MARKER_RELATIVE_PATH])].sort((left, right) => left.localeCompare(right));
}

export function computeBootstrapPreimageHash(root: string, proposal: Pick<BootstrapProjectProposal, 'requested_write_targets' | 'delete_targets'>): string {
  return computeScopedTreeHash(root, bootstrapRollbackScope(proposal), [BOOTSTRAP_SUPPORT_MARKER_RELATIVE_PATH]);
}

function markerValue(proposal: BootstrapProjectProposal): string {
  return `${JSON.stringify({ schema_version: 1, kind: 'vnext-bootstrap-in-progress', target_identity: proposal.target_identity, mode: proposal.mode, source_revision: proposal.source_revision, source_tree_hash: proposal.source_tree_hash, planned_writes: proposal.requested_write_targets, planned_directories: proposal.requested_directory_targets, recovery: 'fail-closed-explicit-recovery' }, null, 2)}\n`;
}

function prepareProposal(options: BootstrapSupportOptions, distribution: DistributionReadback, classification: BootstrapTargetClassification): { proposal: BootstrapProjectProposal; project: { name: string; slug: string }; host: BootstrapSupportHost; baseline: Record<string, string>; facts: BootstrapSupportFact[]; plannedWrites: string[]; inputFingerprint: string } {
  const root = path.resolve(options.targetRoot);
  const project = resolveProject(root, options, classification.receipt);
  const host = options.host ?? 'codex';
  const baseline = normalizeBaseline(options.designBaseline);
  const facts = normalizeFacts(options.mode === 'inventory' ? (options.inventoryFacts ?? options.confirmedFacts) : options.confirmedFacts, options.mode === 'inventory' ? 'inventoryFacts' : 'confirmedFacts');
  const modeIssues = modeBlockers(root, classification.state, options.mode, options, baseline, facts, classification.receipt, classification.migration);
  if (modeIssues.length > 0) fail(modeIssues[0]!.code, modeIssues.map(issue => issue.message).join(' '));
  let assets = ['greenfield', 'adopt', 'realign'].includes(options.mode)
    ? makeGovernanceAssets(root, project, computeBootstrapTargetIdentity(root), options.mode, host, facts, baseline)
    : makeModeAssets(root, project, options.mode, baseline, facts);
  if (options.mode === 'adopt') assets = mergeAssets(assets, [{ path: 'docs/adoption/ADOPTION_DECISION.md', category: 'governance', content: renderDecisions(project, options.mode, facts) }]);
  if (options.mode === 'realign') {
    const preservedMigrationPaths = new Set(classification.migration.provenance?.converted_artifact_paths ?? []);
    assets = assets.filter(asset => asset.path !== CURRENT_TASK_RELATIVE_PATH && !(preservedMigrationPaths.has(asset.path) && fs.existsSync(targetPath(root, asset.path))));
  }
  const targetIdentity = computeBootstrapTargetIdentity(root);
  const source = options.source ?? { revision: `distribution-${distribution.manifest_digest.slice(0, 16)}`, tree_hash: distribution.manifest_digest };
  const inputFingerprint = digest({ mode: options.mode, project, host, baseline, facts, targetIdentity });
  assets = mergeAssets(assets, [{ path: BOOTSTRAP_SUPPORT_RECEIPT_RELATIVE_PATH, category: 'config', content: renderReceipt(options.mode, targetIdentity, project, host, source, inputFingerprint, assets) }]);
  const plannedWrites = assets.map(asset => asset.path).sort((left, right) => left.localeCompare(right));
  for (const relative of plannedWrites) {
    if (isFrozenPath(root, relative)) fail('BOOTSTRAP_SUPPORT_FROZEN_PATH', `Bootstrap cannot replace a frozen target: ${relative}`);
    if (!existingIsWorkflowOwned(root, relative, classification.receipt)) fail('BOOTSTRAP_SUPPORT_TARGET_CONFLICT', `target-owned/native asset would be overwritten: ${relative}`);
  }
  const changedPaths = (options.changedPaths ?? []).map(value => normalizeRelative(value, 'changed_paths')).sort((left, right) => left.localeCompare(right));
  const proposal: BootstrapProjectProposal = {
    schema_version: 1,
    kind: 'vnext-bootstrap-proposal',
    caller: 'bootstrap-project',
    mode: options.mode,
    target_identity: targetIdentity,
    source_revision: source.revision,
    source_tree_hash: source.tree_hash,
    scope_document: renderScopeDocument(plannedWrites),
    changed_paths: changedPaths.length > 0 ? changedPaths : plannedWrites,
    conditional_authorizations: options.conditionalAuthorizations ?? [],
    transformation_kind: 'localized',
    authority_evidence: [
      { kind: 'project-owner', source: 'target-local bootstrap input', subject: `${project.slug}:${options.mode}` },
      { kind: 'scope-admission', source: 'target-local bootstrap proposal.scope_document', subject: targetIdentity },
      { kind: 'evidence-admission', source: 'target-local Distribution support', subject: distribution.manifest_digest },
    ] satisfies BootstrapAuthorityEvidence[],
    semantic_operations: semanticOperations(assets, options.mode),
    preconditions: ['project-local Distribution read-back passed', 'target-local immutable Bootstrap support is present', 'Bootstrap writes governance assets only', 'project-local Runtime owns the typed commit'],
    evidence_refs: ['evidence:distribution-read-back', 'evidence:bootstrap-support', 'evidence:runtime-read-back'],
    idempotency_key: `bootstrap-${options.mode}-${targetIdentity}-${inputFingerprint.slice(0, 16)}`,
    requested_write_targets: plannedWrites,
    requested_directory_targets: [],
    delete_targets: [],
    assets,
  };
  try {
    validateBootstrapProjectProposal(proposal);
  } catch (error) {
    fail(error instanceof Error && 'code' in error ? String((error as { code?: unknown }).code) : 'BOOTSTRAP_SUPPORT_PROPOSAL_INVALID', error instanceof Error ? error.message : String(error));
  }
  return { proposal, project, host, baseline, facts, plannedWrites, inputFingerprint };
}

function publicPlan(plan: BootstrapSupportPlan): Omit<BootstrapSupportPlan, 'proposal'> {
  const { proposal: _proposal, ...publicValue } = plan;
  return publicValue;
}

/**
 * Prepare and, when requested, commit a target-local Bootstrap transaction.
 * The write path is intentionally one operation: support prepares a typed
 * proposal in memory and Runtime commits it; no governance Markdown editor is
 * exposed to the Agent Skill.
 */
export function bootstrapProjectTargetLocal(options: BootstrapSupportOptions): BootstrapSupportPlan {
  const root = path.resolve(options.targetRoot);
  if (!BOOTSTRAP_MODES.includes(options.mode)) return {
    status: 'blocked', target_root: root, target_state: 'conflicting', target_identity: computeBootstrapTargetIdentity(root), mode: options.mode, project: { name: 'unknown', slug: 'unknown' }, host: options.host ?? 'codex', source: { revision: 'unavailable', tree_hash: '0'.repeat(64) }, planned_writes: [], planned_directories: [], planned_deletes: [], changed_paths: options.changedPaths ?? [], blockers: [{ code: 'BOOTSTRAP_SUPPORT_MODE_INVALID', message: 'mode is outside the closed Bootstrap mode set.' }], warnings: [], read_back_verified: false,
  };
  let distribution: DistributionReadback;
  try {
    distribution = validateInstalledDistributionReadback(root);
  } catch (error) {
    return { status: 'blocked', target_root: root, target_state: 'conflicting', target_identity: computeBootstrapTargetIdentity(root), mode: options.mode, project: { name: 'unknown', slug: 'unknown' }, host: options.host ?? 'codex', source: { revision: 'unavailable', tree_hash: '0'.repeat(64) }, planned_writes: [], planned_directories: [], planned_deletes: [], changed_paths: options.changedPaths ?? [], blockers: [{ code: error instanceof BootstrapSupportError ? error.code : 'BOOTSTRAP_SUPPORT_DISTRIBUTION_INVALID', message: error instanceof Error ? error.message : String(error) }], warnings: [], read_back_verified: false,
    };
  }
  const classification = classifyBootstrapTargetLocal(root, {
    legacySurfacePresent: options.legacySurfacePresent,
    migrationAdmission: options.migrationAdmission,
  });
  try {
    const prepared = prepareProposal(options, distribution, classification);
    const proposal = prepared.proposal;
    if (classification.state === 'valid' && classification.receipt && classification.receipt.mode === options.mode) {
      if (classification.receipt.input_fingerprint !== prepared.inputFingerprint) return {
        status: 'blocked', target_root: root, target_state: 'valid', target_identity: proposal.target_identity, mode: proposal.mode, project: prepared.project, host: prepared.host, source: classification.receipt.source, planned_writes: prepared.plannedWrites, planned_directories: [], planned_deletes: [], changed_paths: options.changedPaths ?? [], blockers: [{ code: 'BOOTSTRAP_IDENTITY_CONFLICT', message: 'a valid Bootstrap receipt exists but its mode inputs or project identity differ.' }], warnings: [], read_back_verified: false, proposal,
      };
      try {
        verifyReceiptReadBack(root, classification.receipt, proposal.assets);
        return { status: 'replayed', target_root: root, target_state: 'valid', target_identity: proposal.target_identity, mode: proposal.mode, project: prepared.project, host: classification.receipt.host, source: classification.receipt.source, planned_writes: [], planned_directories: [], planned_deletes: [], changed_paths: [], blockers: [], warnings: [], read_back_verified: true };
      } catch (error) {
        return { status: 'blocked', target_root: root, target_state: 'valid', target_identity: proposal.target_identity, mode: proposal.mode, project: prepared.project, host: classification.receipt.host, source: classification.receipt.source, planned_writes: prepared.plannedWrites, planned_directories: [], planned_deletes: [], changed_paths: [], blockers: [{ code: error instanceof BootstrapSupportError ? error.code : 'BOOTSTRAP_SUPPORT_REPLAY_READ_BACK_FAILED', message: error instanceof Error ? error.message : String(error) }], warnings: [], read_back_verified: false, proposal };
      }
    }
    if (!options.write) {
      return { status: options.changedPaths && options.changedPaths.length > 0 ? 'ready' : 'needs-confirmation', target_root: root, target_state: classification.state, target_identity: proposal.target_identity, mode: proposal.mode, project: prepared.project, host: prepared.host, source: { revision: proposal.source_revision, tree_hash: proposal.source_tree_hash }, planned_writes: prepared.plannedWrites, planned_directories: [], planned_deletes: [], changed_paths: options.changedPaths ?? [], blockers: [], warnings: classification.reasons.map(message => ({ code: 'TARGET_STATE', message })), read_back_verified: false, proposal };
    }
    if (!options.changedPaths || options.changedPaths.length === 0) return { status: 'needs-confirmation', target_root: root, target_state: classification.state, target_identity: proposal.target_identity, mode: proposal.mode, project: prepared.project, host: prepared.host, source: { revision: proposal.source_revision, tree_hash: proposal.source_tree_hash }, planned_writes: prepared.plannedWrites, planned_directories: [], planned_deletes: [], changed_paths: [], blockers: [{ code: 'CHANGED_PATHS_REQUIRED', message: `caller must provide exact changed_paths: ${prepared.plannedWrites.join(', ')}` }], warnings: [], read_back_verified: false, proposal };
    const beforeHash = computeBootstrapPreimageHash(root, proposal);
    const markerPath = targetPath(root, BOOTSTRAP_SUPPORT_MARKER_RELATIVE_PATH);
    try {
      fs.mkdirSync(path.dirname(markerPath), { recursive: true });
      fs.writeFileSync(markerPath, markerValue(proposal), 'utf8');
      const runtimeResult = applyBootstrapProjectProposal(root, proposal, { verify: () => verifyBootstrapHealth(root, proposal, distribution) });
      if (fs.existsSync(markerPath)) fs.rmSync(markerPath, { force: true });
      return { status: 'installed', target_root: root, target_state: classification.state, target_identity: proposal.target_identity, mode: proposal.mode, project: prepared.project, host: prepared.host, source: { revision: proposal.source_revision, tree_hash: proposal.source_tree_hash }, planned_writes: prepared.plannedWrites, planned_directories: [], planned_deletes: [], changed_paths: options.changedPaths, blockers: [], warnings: classification.reasons, read_back_verified: runtimeResult.read_back_verified, runtime_result: runtimeResult, proposal };
    } catch (error) {
      let rollbackVerified = false;
      try { rollbackVerified = computeBootstrapPreimageHash(root, proposal) === beforeHash; } catch { rollbackVerified = false; }
      if (rollbackVerified && fs.existsSync(markerPath)) fs.rmSync(markerPath, { force: true });
      return { status: 'blocked', target_root: root, target_state: classification.state, target_identity: proposal.target_identity, mode: proposal.mode, project: prepared.project, host: prepared.host, source: { revision: proposal.source_revision, tree_hash: proposal.source_tree_hash }, planned_writes: rollbackVerified ? [] : prepared.plannedWrites, planned_directories: [], planned_deletes: [], changed_paths: options.changedPaths, blockers: [{ code: error instanceof BootstrapSupportError ? error.code : 'BOOTSTRAP_SUPPORT_TRANSACTION_FAILED', message: error instanceof Error ? error.message : String(error) }], warnings: [{ code: rollbackVerified ? 'ROLLBACK_VERIFIED' : 'RECOVERY_REQUIRED', message: rollbackVerified ? 'Bootstrap-owned governance scope was restored and its interruption marker was cleared.' : 'Bootstrap rollback could not be verified; interruption marker retained for explicit recovery.' }], read_back_verified: false, proposal };
    }
  } catch (error) {
    return { status: 'blocked', target_root: root, target_state: classification.state, target_identity: computeBootstrapTargetIdentity(root), mode: options.mode, project: { name: 'unknown', slug: 'unknown' }, host: options.host ?? 'codex', source: { revision: `distribution-${distribution.manifest_digest.slice(0, 16)}`, tree_hash: distribution.manifest_digest }, planned_writes: [], planned_directories: [], planned_deletes: [], changed_paths: options.changedPaths ?? [], blockers: [{ code: error instanceof BootstrapSupportError ? error.code : 'BOOTSTRAP_SUPPORT_PREPARATION_FAILED', message: error instanceof Error ? error.message : String(error) }], warnings: classification.reasons.map(message => ({ code: 'TARGET_STATE', message })), read_back_verified: false };
  }
}

function parseCliFlags(argv: string[]): { command: string; flags: Map<string, string | boolean> } {
  const [command = 'prepare', ...rest] = argv;
  const flags = new Map<string, string | boolean>();
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg?.startsWith('--')) fail('BOOTSTRAP_SUPPORT_INPUT_INVALID', `unexpected argument: ${arg ?? ''}`);
    const key = arg.slice(2);
    const value = rest[index + 1];
    if (value && !value.startsWith('--')) { flags.set(key, value); index += 1; } else flags.set(key, true);
  }
  return { command, flags };
}

function flagString(flags: Map<string, string | boolean>, key: string, required = false): string | undefined {
  const value = flags.get(key);
  if (typeof value === 'string' && value.trim()) return value;
  if (value === true) fail('BOOTSTRAP_SUPPORT_INPUT_INVALID', `--${key} requires a value.`);
  if (required) fail('BOOTSTRAP_SUPPORT_INPUT_INVALID', `--${key} requires a value.`);
  return undefined;
}

function readStringListFile(filePath: string): string[] {
  const content = fs.readFileSync(path.resolve(filePath), 'utf8');
  if (content.trimStart().startsWith('[')) {
    const parsed = JSON.parse(content) as unknown;
    if (!Array.isArray(parsed) || parsed.some(value => typeof value !== 'string')) fail('BOOTSTRAP_SUPPORT_INPUT_INVALID', 'changed paths file JSON form must be an array of strings.');
    return parsed as string[];
  }
  return content.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
}

function readFactsFile(filePath: string): BootstrapSupportFact[] {
  const value = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8')) as unknown;
  if (!Array.isArray(value)) fail('BOOTSTRAP_SUPPORT_INPUT_INVALID', 'facts file must contain an array.');
  return value as BootstrapSupportFact[];
}

function readBaselineFile(filePath: string): Record<string, string> {
  const value = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8')) as unknown;
  return expectRecord(value, 'design baseline file') as Record<string, string>;
}

function readAuthorizationsFile(filePath: string): ConditionalScopeAuthorization[] {
  const value = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8')) as unknown;
  if (!Array.isArray(value)) fail('BOOTSTRAP_SUPPORT_INPUT_INVALID', 'conditional authorizations file must contain an array.');
  return value as ConditionalScopeAuthorization[];
}

export async function runBootstrapSupportCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    const { command, flags } = parseCliFlags(argv);
    if (command === 'help' || flags.has('help')) {
      console.log([
        'Target-local Vibe Governance Bootstrap support', '',
        'Usage:',
        '  node .workflow-system/runtime/dist/cli.js bootstrap-support prepare --root <project> --mode <design|greenfield|inventory|adopt|realign> [--write] [--changed-paths-file <file>] [--json]',
        '',
        'The support layer prepares a typed proposal from installed immutable bytes; the project-local Runtime commits governance assets.',
      ].join('\n'));
      return 0;
    }
    if (command !== 'prepare') fail('BOOTSTRAP_SUPPORT_INPUT_INVALID', `unknown bootstrap-support command: ${command}`);
    const mode = flagString(flags, 'mode', true) as BootstrapMode;
    if (!BOOTSTRAP_MODES.includes(mode)) fail('BOOTSTRAP_SUPPORT_MODE_INVALID', 'mode must be one of the closed Bootstrap modes.');
    const targetRoot = flagString(flags, 'root') ?? process.cwd();
    const changedPathsFile = flagString(flags, 'changed-paths-file');
    const factsFile = flagString(flags, 'facts-file');
    const baselineFile = flagString(flags, 'design-baseline-file');
    const authorizationsFile = flagString(flags, 'conditional-authorizations-file');
    const result = bootstrapProjectTargetLocal({
      targetRoot,
      mode,
      write: flags.get('write') === true,
      projectName: flagString(flags, 'project-name'),
      projectSlug: flagString(flags, 'project-slug'),
      host: (flagString(flags, 'host') as BootstrapSupportHost | undefined) ?? 'codex',
      designBaseline: baselineFile ? readBaselineFile(baselineFile) : undefined,
      designConfirmed: flags.get('confirm-design') === true || flags.get('confirm') === true,
      confirmedFacts: factsFile ? readFactsFile(factsFile) : undefined,
      inventoryFacts: factsFile ? readFactsFile(factsFile) : undefined,
      adoptionConfirmed: flags.get('confirm-adoption') === true || flags.get('confirm') === true,
      changedPaths: changedPathsFile ? readStringListFile(changedPathsFile) : undefined,
      conditionalAuthorizations: authorizationsFile ? readAuthorizationsFile(authorizationsFile) : undefined,
    });
    console.log(JSON.stringify(publicPlan(result), null, 2));
    return ['needs-confirmation', 'ready', 'installed', 'replayed'].includes(result.status) ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
