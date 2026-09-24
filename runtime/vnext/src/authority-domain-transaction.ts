/** Project-owned mutation domains. A task instruction alone never grants a
 * permanent project domain; the exact proposed map carries an owner decision. */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { parseDocument } from 'yaml';
import { safeRepositoryFile } from './evidence-lineage';
import { executeWrites, getWorkflowProfilePath, loadProfile, withGovernanceWriteLock } from './runtime-io';
import {
  normalizeProjectMutationAuthority,
  projectMutationAuthorityRevision,
  readProjectMutationAuthority,
  type ProjectMutationAuthority,
} from './mutation-authority';

const RECEIPT_DIRECTORY = '.workflow-system/vnext/authority-domain-receipts';
const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export type AuthorityDomainReceipt = {
  kind: 'authority-domain-update/v1';
  idempotency_key: string;
  before_revision: string | null;
  after_revision: string;
  before_domains: ProjectMutationAuthority['domains'] | null;
  after_domains: ProjectMutationAuthority['domains'];
  profile_before_sha256: string;
  profile_after_sha256: string;
  decision_source: string;
  decision_text: string;
  evidence_refs: string[];
};

export type AuthorityDomainUpdateInput = {
  expected_profile_sha256: string;
  expected_domain_revision: string | null;
  domains: ProjectMutationAuthority['domains'];
  decision_source: string;
  decision_text: string;
  evidence_refs: string[];
  idempotency_key: string;
};

export class AuthorityDomainTransactionError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'AuthorityDomainTransactionError';
  }
}

function reject(code: string, message: string): never {
  throw new AuthorityDomainTransactionError(code, message);
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function receiptPath(root: string, revision: string): string {
  if (!SHA256.test(revision)) reject('AUTHORITY_DOMAIN_RECEIPT_INVALID', 'Domain-map revision must be SHA-256.');
  return path.join(path.resolve(root), RECEIPT_DIRECTORY, `${revision}.json`);
}

export function assertAuthorityDomainWritable(root: string, relative: string): void {
  safeRepositoryFile(root, relative);
  const parts = relative.split('/');
  let current = path.resolve(root);
  for (const part of parts) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      reject('AUTHORITY_DOMAIN_PATH_INVALID', `${relative} traverses a symbolic link.`);
    }
  }
  for (const registry of ['FREEZE_REGISTRY.md', '.workflow-system/FREEZE_REGISTRY.md']) {
    const file = path.join(root, ...registry.split('/'));
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').split(/\r?\n/u).some(line => line.includes(relative) && !/^\s*[-#]*\s*(unfreeze|not frozen)/iu.test(line))) {
      reject('AUTHORITY_DOMAIN_FROZEN', `${relative} is listed as frozen in ${registry}.`);
    }
  }
  if (fs.existsSync(current)) {
    if (!fs.lstatSync(current).isFile()) reject('AUTHORITY_DOMAIN_PATH_INVALID', `${relative} is not a regular file.`);
    const header = fs.readFileSync(current, 'utf8').split(/\r?\n/u).slice(0, 20).join('\n');
    if (/@frozen|DO NOT MODIFY/iu.test(header)) reject('AUTHORITY_DOMAIN_FROZEN', `${relative} has a freeze marker.`);
  }
}

function inputRecord(raw: unknown): AuthorityDomainUpdateInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) reject('AUTHORITY_DOMAIN_INPUT_INVALID', 'Input must be a mapping.');
  const value = raw as Record<string, unknown>;
  const keys = ['expected_profile_sha256', 'expected_domain_revision', 'domains', 'decision_source', 'decision_text', 'evidence_refs', 'idempotency_key'];
  if (Object.keys(value).length !== keys.length || keys.some(key => !(key in value))) reject('AUTHORITY_DOMAIN_INPUT_INVALID', `Input requires exactly ${keys.join(', ')}.`);
  if (typeof value.expected_profile_sha256 !== 'string' || !SHA256.test(value.expected_profile_sha256)) reject('AUTHORITY_DOMAIN_INPUT_INVALID', 'expected_profile_sha256 must be SHA-256.');
  if (value.expected_domain_revision !== null && (typeof value.expected_domain_revision !== 'string' || !SHA256.test(value.expected_domain_revision))) reject('AUTHORITY_DOMAIN_INPUT_INVALID', 'expected_domain_revision must be SHA-256 or null.');
  if (typeof value.decision_source !== 'string' || !value.decision_source.trim() || typeof value.decision_text !== 'string' || !value.decision_text.trim()) reject('AUTHORITY_DOMAIN_OWNER_DECISION_REQUIRED', 'An exact project-owner decision source and verbatim text are required.');
  if (typeof value.idempotency_key !== 'string' || !SAFE_KEY.test(value.idempotency_key)) reject('AUTHORITY_DOMAIN_INPUT_INVALID', 'idempotency_key is invalid.');
  if (!Array.isArray(value.evidence_refs) || value.evidence_refs.length > 32 || value.evidence_refs.some(item => typeof item !== 'string' || !item.trim())) reject('AUTHORITY_DOMAIN_INPUT_INVALID', 'evidence_refs must be a bounded list of references.');
  const authority = normalizeProjectMutationAuthority({ domains: value.domains });
  return { ...value, domains: authority.domains } as AuthorityDomainUpdateInput;
}

export function readAuthorityDomainReceipt(root: string, revision: string): AuthorityDomainReceipt | null {
  const file = receiptPath(root, revision);
  if (!fs.existsSync(file)) return null;
  let receipt: AuthorityDomainReceipt;
  try { receipt = JSON.parse(fs.readFileSync(file, 'utf8')) as AuthorityDomainReceipt; }
  catch { return reject('AUTHORITY_DOMAIN_RECEIPT_INVALID', `Unreadable authority-domain receipt for ${revision}.`); }
  if (receipt.kind !== 'authority-domain-update/v1' || receipt.after_revision !== revision
    || projectMutationAuthorityRevision(normalizeProjectMutationAuthority({ domains: receipt.after_domains })) !== revision
    || (receipt.before_domains === null ? receipt.before_revision !== null
      : projectMutationAuthorityRevision(normalizeProjectMutationAuthority({ domains: receipt.before_domains })) !== receipt.before_revision)) {
    reject('AUTHORITY_DOMAIN_RECEIPT_INVALID', `Authority-domain receipt for ${revision} does not match its map revisions.`);
  }
  return receipt;
}

/** Follow the update chain; a changed grant cannot be silently inherited. */
export function authorityDomainChangesSince(root: string, boundRevision: string, currentRevision: string): Set<string> {
  const changed = new Set<string>();
  let revision = currentRevision;
  for (let depth = 0; depth < 128 && revision !== boundRevision; depth += 1) {
    const receipt = readAuthorityDomainReceipt(root, revision);
    if (!receipt || !receipt.before_revision || !receipt.before_domains) reject('AUTHORITY_DOMAIN_HISTORY_MISSING', 'The current map has no complete project-owner update chain from the task-bound revision.');
    const before = new Map(receipt.before_domains.map(domain => [domain.id, domain.roots]));
    for (const domain of receipt.after_domains) {
      const oldRoots = before.get(domain.id);
      if (JSON.stringify(oldRoots ? [...oldRoots].sort() : null) !== JSON.stringify([...domain.roots].sort())) changed.add(domain.id);
    }
    revision = receipt.before_revision;
  }
  if (revision !== boundRevision) reject('AUTHORITY_DOMAIN_HISTORY_MISSING', 'Authority-domain update chain exceeds the supported depth.');
  return changed;
}

export function authorityDomainContext(root: string): { profile_sha256: string; domain_revision: string | null; domains: ProjectMutationAuthority['domains'] | null } {
  const profilePath = getWorkflowProfilePath(root);
  const bytes = fs.readFileSync(profilePath, 'utf8');
  const domains = readProjectMutationAuthority(root);
  return { profile_sha256: sha256(bytes), domain_revision: domains ? projectMutationAuthorityRevision(domains) : null, domains: domains?.domains ?? null };
}

export function updateAuthorityDomains(root: string, raw: unknown, dryRun = false): {
  status: 'success' | 'no-op' | 'blocked'; committed: boolean; profile_sha256: string; domain_revision: string; receipt_path: string;
  code?: string; message?: string;
} {
  const input = inputRecord(raw);
  return withGovernanceWriteLock(root, () => {
    const profilePath = getWorkflowProfilePath(root);
    const profileBytes = fs.readFileSync(profilePath, 'utf8');
    const before = readProjectMutationAuthority(root);
    const beforeRevision = before ? projectMutationAuthorityRevision(before) : null;
    const after = normalizeProjectMutationAuthority({ domains: input.domains });
    const afterRevision = projectMutationAuthorityRevision(after);
    const receiptRelative = `${RECEIPT_DIRECTORY}/${afterRevision}.json`;
    const file = receiptPath(root, afterRevision);
    assertAuthorityDomainWritable(root, '.workflow-system/PROJECT_PROFILE.yaml');
    assertAuthorityDomainWritable(root, receiptRelative);
    const existing = readAuthorityDomainReceipt(root, afterRevision);
    const receiptDirectory = path.join(path.resolve(root), RECEIPT_DIRECTORY);
    if (fs.existsSync(receiptDirectory)) for (const name of fs.readdirSync(receiptDirectory)) {
      if (!/^[a-f0-9]{64}\.json$/u.test(name)) continue;
      const prior = readAuthorityDomainReceipt(root, name.slice(0, -5));
      if (prior?.idempotency_key === input.idempotency_key && prior.after_revision !== afterRevision) {
        reject('IDEMPOTENCY_CONFLICT', 'This project-domain update key already committed a different map.');
      }
    }
    if (existing && existing.idempotency_key === input.idempotency_key
      && existing.profile_before_sha256 === input.expected_profile_sha256
      && existing.before_revision === input.expected_domain_revision
      && existing.decision_source === input.decision_source && existing.decision_text === input.decision_text
      && JSON.stringify(existing.evidence_refs) === JSON.stringify(input.evidence_refs)
      && beforeRevision === afterRevision && sha256(profileBytes) === existing.profile_after_sha256) {
      return { status: 'no-op', committed: false, profile_sha256: existing.profile_after_sha256, domain_revision: afterRevision, receipt_path: receiptRelative };
    }
    if (sha256(profileBytes) !== input.expected_profile_sha256 || beforeRevision !== input.expected_domain_revision) reject('AUTHORITY_DOMAIN_SOURCE_STALE', 'Refresh the project profile and domain map before updating it.');
    if (existing) reject('AUTHORITY_DOMAIN_RECEIPT_CONFLICT', 'This domain-map revision has a different retained owner decision.');
    if (before) {
      const next = new Map(after.domains.map(domain => [domain.id, domain.roots]));
      for (const domain of before.domains) {
        const roots = next.get(domain.id);
        if (!roots || domain.roots.some(root => !roots.includes(root))) reject('AUTHORITY_DOMAIN_REMOVAL_UNSUPPORTED', 'This update route only adds domains or roots; removing grants needs a separate governance decision.');
      }
    }
    if (beforeRevision === afterRevision) reject('AUTHORITY_DOMAIN_UNCHANGED', 'The proposed map is unchanged; no new owner grant can be inferred from a task instruction.');
    loadProfile(profilePath);
    const profileDocument = parseDocument(profileBytes, { uniqueKeys: true });
    if (profileDocument.errors.length) reject('AUTHORITY_DOMAIN_PROFILE_INVALID', 'Project profile YAML cannot be updated without losing its structure.');
    profileDocument.setIn(['mutation_authority'], after);
    const nextBytes = profileDocument.toString();
    const receipt: AuthorityDomainReceipt = {
      kind: 'authority-domain-update/v1', idempotency_key: input.idempotency_key,
      before_revision: beforeRevision, after_revision: afterRevision,
      before_domains: before?.domains ?? null, after_domains: after.domains,
      profile_before_sha256: sha256(profileBytes), profile_after_sha256: sha256(nextBytes),
      decision_source: input.decision_source, decision_text: input.decision_text,
      evidence_refs: [...input.evidence_refs],
    };
    if (!dryRun) {
      executeWrites([{ path: profilePath, content: nextBytes }, { path: file, content: `${JSON.stringify(receipt, null, 2)}\n` }], false, 'vNext authority-domain project update');
      try {
        if (sha256(fs.readFileSync(profilePath, 'utf8')) !== receipt.profile_after_sha256 || !readAuthorityDomainReceipt(root, afterRevision)) {
          reject('AUTHORITY_DOMAIN_READ_BACK_FAILED', 'Project map or owner receipt read-back failed.');
        }
      } catch (error) {
        return { status: 'blocked', committed: true, profile_sha256: receipt.profile_after_sha256,
          domain_revision: afterRevision, receipt_path: receiptRelative, code: 'AUTHORITY_DOMAIN_READ_BACK_FAILED',
          message: `Project map was written; inspect the profile and receipt before retrying: ${error instanceof Error ? error.message : String(error)}` };
      }
    }
    return { status: 'success', committed: !dryRun, profile_sha256: receipt.profile_after_sha256, domain_revision: afterRevision, receipt_path: receiptRelative };
  });
}
