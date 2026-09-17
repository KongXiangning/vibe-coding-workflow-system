/**
 * Mutation Authority v2.
 *
 * This module deliberately owns only structural authority checks.  Whether a
 * broader change is the right engineering choice remains a Skill/model
 * judgement; the Runtime records the assessment and makes the path, domain,
 * forbidden-boundary, and first-touch checks auditable.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  getWorkflowProfilePath,
  loadProfile,
  type JsonObject,
} from './runtime-io';
import { isLikelyPersistentTestPath, mutationScopePatternMatchesPath } from './mutation-scope';

export const MUTATION_AUTHORITY_VERSION = 2 as const;

export type MutationAuthorityDomain = {
  id: string;
  roots: string[];
};

export type ProjectMutationAuthority = {
  domains: MutationAuthorityDomain[];
};

export type TaskMutationAuthority = {
  domains: string[];
  exact_exceptions: string[];
  forbidden: string[];
};

export type BlastRadiusAssessment = {
  target: { path: string; symbol?: string };
  reason: string;
  blast_radius: {
    locality: 'local' | 'elevated' | 'high';
    visibility: 'private' | 'shared' | 'public' | 'unknown';
    cross_component_consumers: 'none' | 'present' | 'unknown';
    contract_impact: 'none' | 'possible' | 'known';
  };
  evidence_refs: string[];
  disposition: 'self-admit' | 'escalate';
};

export type MutationAuthorityDecision = {
  path: string;
  status: 'planned' | 'self-admitted' | 'blocked';
  domain: string | null;
  reason: string;
  assessment?: BlastRadiusAssessment;
  first_touch_state?: 'file' | 'absent' | 'symlink';
};

export type MutationAuthorityEvaluation = {
  status: 'pass' | 'blocked';
  decisions: MutationAuthorityDecision[];
  dynamic_review_required: boolean;
  blockers: string[];
};

export class MutationAuthorityError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'MutationAuthorityError';
    this.code = code;
  }
}

const DOMAIN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAX_DOMAINS = 128;
const MAX_ROOTS_PER_DOMAIN = 128;
const MAX_EXCEPTIONS = 256;
const MAX_FORBIDDEN = 256;

/**
 * These paths are Runtime/governance surfaces, not product responsibility
 * domains.  A broad project domain must never turn them into ordinary
 * execute-step mutation targets; their typed owners remain the only write
 * boundary.  The list intentionally mirrors the existing amendment guard.
 */
export function isMutationAuthorityGovernanceBoundary(target: string): boolean {
  return target === '.git'
    || target.startsWith('.git/')
    || target === '.workflow-system'
    || target.startsWith('.workflow-system/')
    || target === '.agents'
    || target.startsWith('.agents/')
    || target === '.claude'
    || target.startsWith('.claude/')
    || target === '.codex'
    || target.startsWith('.codex/')
    || target === 'node_modules'
    || target.startsWith('node_modules/')
    || target === 'docs/workflow/CURRENT_TASK.md'
    || target.startsWith('runtime/vnext/dist/')
    || target.startsWith('packages/vibe-governance/')
    || target.includes('/task-history/')
    || target.includes('/task-candidates/')
    || target.includes('/task-data/');
}

function fail(code: string, message: string): never {
  throw new MutationAuthorityError(code, message);
}

function record(value: unknown, location: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('MUTATION_AUTHORITY_SCHEMA_INVALID', `${location} must be a mapping.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], location: string): void {
  const expectedSet = new Set(expected);
  const missing = expected.filter(key => !(key in value));
  const extra = Object.keys(value).filter(key => !expectedSet.has(key));
  if (missing.length > 0 || extra.length > 0) {
    fail('MUTATION_AUTHORITY_SCHEMA_INVALID', `${location} keys mismatch; missing=[${missing.join(', ')}], unexpected=[${extra.join(', ')}].`);
  }
}

function text(value: unknown, location: string, maxLength = 4096): string {
  if (typeof value !== 'string') fail('MUTATION_AUTHORITY_SCHEMA_INVALID', `${location} must be a string.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || /[\r\n\0]/u.test(normalized)) {
    fail('MUTATION_AUTHORITY_SCHEMA_INVALID', `${location} must be one non-empty line of at most ${maxLength} characters.`);
  }
  return normalized;
}

export function normalizeAuthorityPath(value: unknown, location: string, allowBoundedGlob = false): string {
  const original = text(value, location, 1024);
  const normalized = original.replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/\/+$/u, '');
  const boundedGlob = normalized.endsWith('/**') && !normalized.slice(0, -3).includes('*');
  if (
    !normalized
    || normalized === '.'
    || normalized.startsWith('/')
    || /^[A-Za-z]:\//u.test(original)
    || normalized.split('/').some(segment => segment === '.' || segment === '..' || segment.length === 0)
    || /[\0-\x1F\x7F]/u.test(normalized)
    || normalized.includes('**/')
    || (normalized.includes('*') && (!allowBoundedGlob || !boundedGlob))
  ) {
    fail('MUTATION_AUTHORITY_PATH_INVALID', `${location} must be a repository-relative exact path or literal /** prefix.`);
  }
  return normalized;
}

function stringList(value: unknown, location: string, options: { allowEmpty: boolean; max: number; allowBoundedGlob?: boolean }): string[] {
  if (!Array.isArray(value) || value.length > options.max || (!options.allowEmpty && value.length === 0)) {
    fail('MUTATION_AUTHORITY_SCHEMA_INVALID', `${location} must be a bounded${options.allowEmpty ? '' : ' non-empty'} array.`);
  }
  const values = value.map((item, index) => normalizeAuthorityPath(item, `${location}[${index}]`, options.allowBoundedGlob === true));
  if (new Set(values).size !== values.length) fail('MUTATION_AUTHORITY_SCHEMA_INVALID', `${location} contains duplicates.`);
  return values;
}

function boundaryOverlap(left: string, right: string): boolean {
  const a = canonicalAuthorityRoot(left);
  const b = canonicalAuthorityRoot(right);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function canonicalAuthorityRoot(value: string): string {
  return value.endsWith('/**') ? value.slice(0, -3) : value;
}

function profileAuthorityValue(profile: JsonObject): unknown {
  return profile.mutation_authority;
}

/** Validate the optional project-level map. Missing means legacy/v1 mode. */
export function readProjectMutationAuthority(root: string): ProjectMutationAuthority | null {
  const profilePath = getWorkflowProfilePath(root);
  if (!fs.existsSync(profilePath)) return null;
  let profile: JsonObject;
  try {
    profile = loadProfile(profilePath);
  } catch (error) {
    fail('MUTATION_AUTHORITY_PROJECT_INVALID', error instanceof Error ? error.message : String(error));
  }
  const raw = profileAuthorityValue(profile);
  if (raw === undefined) return null;
  const authority = record(raw, 'PROJECT_PROFILE.yaml.mutation_authority');
  exactKeys(authority, ['domains'], 'PROJECT_PROFILE.yaml.mutation_authority');
  if (!Array.isArray(authority.domains) || authority.domains.length === 0 || authority.domains.length > MAX_DOMAINS) {
    fail('MUTATION_AUTHORITY_PROJECT_INVALID', 'PROJECT_PROFILE.yaml.mutation_authority.domains must be a bounded non-empty array.');
  }
  const domains = authority.domains.map((rawDomain, index) => {
    const domain = record(rawDomain, `PROJECT_PROFILE.yaml.mutation_authority.domains[${index}]`);
    exactKeys(domain, ['id', 'roots'], `PROJECT_PROFILE.yaml.mutation_authority.domains[${index}]`);
    const id = text(domain.id, `PROJECT_PROFILE.yaml.mutation_authority.domains[${index}].id`, 128);
    if (!DOMAIN_ID_PATTERN.test(id)) fail('MUTATION_AUTHORITY_PROJECT_INVALID', `authority domain id ${id} is invalid.`);
    const roots = stringList(domain.roots, `PROJECT_PROFILE.yaml.mutation_authority.domains[${index}].roots`, {
      allowEmpty: false,
      max: MAX_ROOTS_PER_DOMAIN,
      allowBoundedGlob: true,
    });
    return { id, roots };
  });
  if (new Set(domains.map(domain => domain.id)).size !== domains.length) {
    fail('MUTATION_AUTHORITY_PROJECT_INVALID', 'authority domain ids must be unique.');
  }
  for (let leftIndex = 0; leftIndex < domains.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < domains.length; rightIndex += 1) {
      for (const leftRoot of domains[leftIndex]!.roots) {
        for (const rightRoot of domains[rightIndex]!.roots) {
          if (boundaryOverlap(leftRoot, rightRoot)) {
            fail('MUTATION_AUTHORITY_DOMAIN_AMBIGUOUS', `authority roots overlap: ${domains[leftIndex]!.id}:${leftRoot} <-> ${domains[rightIndex]!.id}:${rightRoot}.`);
          }
        }
      }
    }
  }
  return { domains };
}

export function normalizeTaskMutationAuthority(value: unknown): TaskMutationAuthority {
  const authority = record(value, 'mutation_authority');
  exactKeys(authority, ['domains', 'exact_exceptions', 'forbidden'], 'mutation_authority');
  const domains = authority.domains;
  if (!Array.isArray(domains) || domains.length === 0 || domains.length > MAX_DOMAINS) {
    fail('MUTATION_AUTHORITY_SCHEMA_INVALID', 'mutation_authority.domains must be a bounded non-empty array.');
  }
  const domainIds = domains.map((item, index) => text(item, `mutation_authority.domains[${index}]`, 128));
  if (domainIds.some(id => !DOMAIN_ID_PATTERN.test(id)) || new Set(domainIds).size !== domainIds.length) {
    fail('MUTATION_AUTHORITY_SCHEMA_INVALID', 'mutation_authority.domains must contain unique valid domain ids.');
  }
  return {
    domains: domainIds,
    exact_exceptions: stringList(authority.exact_exceptions, 'mutation_authority.exact_exceptions', { allowEmpty: true, max: MAX_EXCEPTIONS }),
    forbidden: stringList(authority.forbidden, 'mutation_authority.forbidden', { allowEmpty: true, max: MAX_FORBIDDEN, allowBoundedGlob: true }),
  };
}

export function validateTaskMutationAuthority(root: string, value: unknown): TaskMutationAuthority {
  const authority = normalizeTaskMutationAuthority(value);
  const project = readProjectMutationAuthority(root);
  if (!project) fail('MUTATION_AUTHORITY_PROJECT_REQUIRED', 'v2 tasks require PROJECT_PROFILE.yaml.mutation_authority.domains.');
  const known = new Set(project.domains.map(domain => domain.id));
  const missing = authority.domains.filter(domain => !known.has(domain));
  if (missing.length > 0) fail('MUTATION_AUTHORITY_DOMAIN_UNKNOWN', `task authority references unknown domains: ${missing.join(', ')}.`);
  return authority;
}

export function authorityDomainForPath(project: ProjectMutationAuthority, target: string): string | null {
  const matches = project.domains.filter(domain => domain.roots.some(root => {
    if (root.endsWith('/**')) return target === root.slice(0, -3) || target.startsWith(`${root.slice(0, -3)}/`);
    return target === root;
  }));
  if (matches.length > 1) fail('MUTATION_AUTHORITY_DOMAIN_AMBIGUOUS', `path ${target} maps to multiple authority domains: ${matches.map(domain => domain.id).join(', ')}.`);
  return matches[0]?.id ?? null;
}

function firstTouchState(root: string | undefined, target: string): MutationAuthorityDecision['first_touch_state'] {
  if (!root) return undefined;
  const absolute = path.resolve(root, ...target.split('/'));
  if (!fs.existsSync(absolute)) return 'absent';
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) return 'symlink';
  return stat.isFile() ? 'file' : undefined;
}

function validateAssessment(value: unknown, index: number): BlastRadiusAssessment {
  const assessment = record(value, `blast_radius_assessments[${index}]`);
  exactKeys(assessment, ['target', 'reason', 'blast_radius', 'evidence_refs', 'disposition'], `blast_radius_assessments[${index}]`);
  const target = record(assessment.target, `blast_radius_assessments[${index}].target`);
  exactKeys(target, ['path', ...(target.symbol === undefined ? [] : ['symbol'])], `blast_radius_assessments[${index}].target`);
  const blast = record(assessment.blast_radius, `blast_radius_assessments[${index}].blast_radius`);
  exactKeys(blast, ['locality', 'visibility', 'cross_component_consumers', 'contract_impact'], `blast_radius_assessments[${index}].blast_radius`);
  const locality = blast.locality;
  const visibility = blast.visibility;
  const consumers = blast.cross_component_consumers;
  const contractImpact = blast.contract_impact;
  if (!['local', 'elevated', 'high'].includes(String(locality))
    || !['private', 'shared', 'public', 'unknown'].includes(String(visibility))
    || !['none', 'present', 'unknown'].includes(String(consumers))
    || !['none', 'possible', 'known'].includes(String(contractImpact))) {
    fail('MUTATION_AUTHORITY_ASSESSMENT_INVALID', `blast_radius_assessments[${index}].blast_radius contains an unsupported classification.`);
  }
  if (!Array.isArray(assessment.evidence_refs) || assessment.evidence_refs.length === 0 || assessment.evidence_refs.length > 64
    || assessment.evidence_refs.some(value => typeof value !== 'string' || !value.trim())) {
    fail('MUTATION_AUTHORITY_ASSESSMENT_INVALID', `blast_radius_assessments[${index}].evidence_refs must be non-empty.`);
  }
  const normalizedPath = normalizeAuthorityPath(target.path, `blast_radius_assessments[${index}].target.path`);
  return {
    target: {
      path: normalizedPath,
      ...(target.symbol === undefined ? {} : { symbol: text(target.symbol, `blast_radius_assessments[${index}].target.symbol`, 256) }),
    },
    reason: text(assessment.reason, `blast_radius_assessments[${index}].reason`, 4096),
    blast_radius: {
      locality: locality as BlastRadiusAssessment['blast_radius']['locality'],
      visibility: visibility as BlastRadiusAssessment['blast_radius']['visibility'],
      cross_component_consumers: consumers as BlastRadiusAssessment['blast_radius']['cross_component_consumers'],
      contract_impact: contractImpact as BlastRadiusAssessment['blast_radius']['contract_impact'],
    },
    evidence_refs: [...new Set((assessment.evidence_refs as string[]).map(value => value.trim()))],
    disposition: assessmentDisposition(assessment.disposition, index),
  };
}

function assessmentDisposition(value: unknown, index: number): BlastRadiusAssessment['disposition'] {
  if (value === 'self-admit' || value === 'escalate') return value;
  fail('MUTATION_AUTHORITY_ASSESSMENT_INVALID', `blast_radius_assessments[${index}].disposition must be self-admit or escalate.`);
}

export function normalizeBlastRadiusAssessments(value: unknown): BlastRadiusAssessment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 256) fail('MUTATION_AUTHORITY_ASSESSMENT_INVALID', 'blast_radius_assessments must be a bounded array.');
  const result = value.map((item, index) => validateAssessment(item, index));
  if (new Set(result.map(item => item.target.path)).size !== result.length) fail('MUTATION_AUTHORITY_ASSESSMENT_INVALID', 'blast_radius_assessments must contain one assessment per target path.');
  return result;
}

export function evaluateMutationAuthority(input: {
  root?: string;
  project: ProjectMutationAuthority;
  task: TaskMutationAuthority;
  candidate_paths: readonly string[];
  planned_targets: readonly string[];
  assessments?: readonly BlastRadiusAssessment[];
  persistent_test_paths?: readonly string[];
}): MutationAuthorityEvaluation {
  const assessments = input.assessments ?? [];
  const byPath = new Map(assessments.map(item => [item.target.path, item]));
  const decisions: MutationAuthorityDecision[] = [];
  const blockers: string[] = [];
  let dynamicReviewRequired = false;
  for (const rawPath of input.candidate_paths) {
    const target = normalizeAuthorityPath(rawPath, 'candidate_paths');
    const forbidden = input.task.forbidden.some(pattern => mutationScopePatternMatchesPath(target, pattern));
    const touch = firstTouchState(input.root, target);
    if (forbidden) {
      // Explicit forbidden boundaries are authoritative even if a malformed
      // caller-supplied project map would otherwise make domain resolution
      // ambiguous. Keep the most restrictive decision fail-closed.
      decisions.push({ path: target, status: 'blocked', domain: null, reason: 'target is explicitly forbidden', first_touch_state: touch });
      blockers.push(`MUTATION_AUTHORITY_FORBIDDEN: ${target}`);
      continue;
    }
    if (isMutationAuthorityGovernanceBoundary(target)) {
      decisions.push({ path: target, status: 'blocked', domain: null, reason: 'target is a Runtime/governance boundary', first_touch_state: touch });
      blockers.push(`MUTATION_AUTHORITY_GOVERNANCE_BOUNDARY: ${target}`);
      continue;
    }
    const domain = authorityDomainForPath(input.project, target);
    const exception = input.task.exact_exceptions.includes(target);
    const inEnvelope = exception || (domain !== null && input.task.domains.includes(domain));
    if (!inEnvelope) {
      decisions.push({ path: target, status: 'blocked', domain, reason: domain === null ? 'target is unclassified' : `target belongs to unauthorized domain ${domain}`, first_touch_state: touch });
      blockers.push(`MUTATION_AUTHORITY_EXPANSION_REQUIRED: ${target}${domain ? ` (${domain})` : ''}`);
      continue;
    }
    if (touch === 'symlink' || touch === undefined) {
      decisions.push({ path: target, status: 'blocked', domain, reason: 'target is not a regular file or absent path', first_touch_state: touch });
      blockers.push(`MUTATION_AUTHORITY_TARGET_INVALID: ${target} is not a regular file or absent path`);
      continue;
    }
    const planned = input.planned_targets.some(pattern => mutationScopePatternMatchesPath(target, pattern));
    const assessment = byPath.get(target);
    const persistentTest = isLikelyPersistentTestPath(target);
    const persistentAllowed = (input.persistent_test_paths ?? []).includes(target);
    if (persistentTest && touch === 'absent' && !persistentAllowed) {
      decisions.push({ path: target, status: 'blocked', domain, reason: 'new persistent test lacks P-12 admission', first_touch_state: touch });
      blockers.push(`PERSISTENT_TEST_UNADMITTED: ${target}`);
      continue;
    }
    if (planned) {
      decisions.push({ path: target, status: 'planned', domain, reason: exception ? 'exact exception is planned' : 'target is in planned mutation footprint', first_touch_state: touch });
      continue;
    }
    if (!assessment) {
      decisions.push({ path: target, status: 'blocked', domain, reason: 'in-envelope footprint expansion has no blast-radius assessment', first_touch_state: touch });
      blockers.push(`MUTATION_AUTHORITY_EXPANSION_REQUIRED: ${target} requires blast-radius assessment`);
      continue;
    }
    if (assessment.disposition !== 'self-admit') {
      decisions.push({ path: target, status: 'blocked', domain, reason: 'blast-radius assessment escalates the target', assessment, first_touch_state: touch });
      blockers.push(`MUTATION_AUTHORITY_EXPANSION_REQUIRED: ${target} was escalated by its blast-radius assessment`);
      continue;
    }
    dynamicReviewRequired = true;
    decisions.push({ path: target, status: 'self-admitted', domain, reason: 'in-envelope expansion self-admitted with assessment', assessment, first_touch_state: touch });
  }
  return { status: blockers.length === 0 ? 'pass' : 'blocked', decisions, dynamic_review_required: dynamicReviewRequired, blockers };
}
