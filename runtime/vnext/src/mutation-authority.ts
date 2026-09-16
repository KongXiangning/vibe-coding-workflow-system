/**
 * Mutation Authority v2 evaluator.
 *
 * v2 separates three concepts that v1 conflated:
 *
 * 1. the **task authority envelope** — a hard, positive write grant over a set
 *    of project authority domains. Anything outside it is a true authority
 *    change and can never be self-admitted;
 * 2. the **planned mutation footprint** — per-step `planned_targets`, which
 *    guide implementation and expose planned-vs-actual drift but are no longer
 *    an independent authority boundary;
 * 3. **in-envelope footprint expansion** — the Agent's bounded engineering
 *    judgment, recorded as a blast-radius assessment and auditable afterwards.
 *
 * This module is read-only: it parses the canonical task body, resolves
 * `path -> authority domain`, and returns a fail-closed per-path admission
 * result. It never writes a document and never executes a command.
 */

import * as crypto from 'crypto';
import {
  isLikelyPersistentTestPath,
  mutationScopePatternMatchesPath,
} from './mutation-scope';

export const MUTATION_AUTHORITY_VERSION_LEGACY = 1;
export const MUTATION_AUTHORITY_VERSION_V2 = 2;

export type MutationAuthorityVersion = 1 | 2;

export type MutationBlastRadiusLocality = 'local' | 'elevated' | 'high';
export type MutationBlastRadiusVisibility = 'private' | 'shared' | 'public' | 'unknown';
export type MutationBlastRadiusConsumers = 'none' | 'present' | 'unknown';
export type MutationBlastRadiusContract = 'none' | 'possible' | 'known';
export type MutationExpansionDisposition = 'self-admit' | 'escalate';

/** The Agent's bounded engineering judgment about one discovered target. */
export type MutationBlastRadiusAssessment = {
  path: string;
  symbol: string | null;
  reason: string;
  locality: MutationBlastRadiusLocality;
  visibility: MutationBlastRadiusVisibility;
  cross_component_consumers: MutationBlastRadiusConsumers;
  contract_impact: MutationBlastRadiusContract;
  evidence_refs: string[];
  disposition: MutationExpansionDisposition;
};

/** One durable, auditable in-envelope expansion that Runtime admitted. */
export type MutationExpansionAdmission = {
  admission_id: string;
  path: string;
  step_id: string;
  /** Binds the admission to the exact plan revision it was admitted under. */
  plan_revision: string;
  assessment: MutationBlastRadiusAssessment;
  assessment_digest: string;
  admitted_at_source_revision: string;
};

export type ExistingTestOracleChange = 'none' | 'assertion-updated' | 'new-assertion' | 'removed-assertion';

export type MutationAuthorityDomain = {
  id: string;
  /** Exact repository-relative path patterns owned by this domain. */
  roots: string[];
};

export type MutationAuthoritySource = 'task-envelope' | 'exact-exception';

/**
 * The union of every project authority domain the task may write, plus the
 * narrow exact-path exceptions the user authorized across domain boundaries.
 */
export type TaskAuthorityEnvelope = {
  version: MutationAuthorityVersion;
  domains: string[];
  exact_exceptions: string[];
  /** Task-specific explicit forbidden targets; precedence over every grant. */
  forbidden: string[];
};

export type MutationAuthorityAdmissionClassification =
  | 'planned-in-envelope'
  | 'self-admitted-in-envelope'
  | 'assessment-required'
  | 'authority-expansion-required'
  | 'unclassified'
  | 'ambiguous-authority'
  | 'forbidden'
  | 'escalated'
  | 'unavailable'
  | 'invalid';

export type MutationAuthorityAdmission = {
  path: string;
  classification: MutationAuthorityAdmissionClassification;
  admitted: boolean;
  /** Matched authority domain ids, in declaration order. */
  authority_domains: string[];
  authority_source: MutationAuthoritySource | null;
  /** True when the path is outside this step's planned footprint. */
  unplanned: boolean;
  persistent_test: { path: string; existing: boolean };
  reason: string;
  /** Present only when the path can become admitted by supplying an assessment. */
  required_assessment: {
    kind: 'mutation-blast-radius/v1';
    min_locality: MutationBlastRadiusLocality;
    advisory: string;
  } | null;
};

export type MutationAuthorityEvaluation = {
  status: 'pass' | 'blocked';
  version: MutationAuthorityVersion;
  envelope: TaskAuthorityEnvelope;
  step_id: string;
  planned_targets: string[];
  changed_paths: string[];
  admissions: MutationAuthorityAdmission[];
  admitted_paths: string[];
  blocked_paths: string[];
  /** Paths that may be admitted by an in-envelope self-admitted expansion. */
  assessment_required_paths: string[];
  /** Paths that require a real task authority amendment. */
  authority_expansion_required_paths: string[];
  /** Admitted paths that were absent from the planned footprint. */
  dynamic_expansion_paths: string[];
  /** Admitted paths whose preflight before-state is absent (new persistent test). */
  new_persistent_test_paths: string[];
  dynamic_review_required: boolean;
  blockers: string[];
};

export type MutationAuthorityEvaluationInput = {
  changed_paths: string[];
  /**
   * The current step's planned footprint. A path outside it is an expansion
   * candidate, not a violation.
   */
  planned_targets?: string[];
  step_id?: string;
  /**
   * Durable admissions from `extend-preflight`, bound to the same step and
   * plan. An admission for another step never widens this step.
   */
  admissions?: readonly MutationExpansionAdmission[];
  /**
   * Assessments supplied with this call. Each admissible path requires its
   * own assessment with `disposition: self-admit`.
   */
  assessments?: readonly MutationBlastRadiusAssessment[];
  /**
   * Runtime-supplied first-touch before-state. A test-like path that already
   * exists is an ordinary in-envelope expansion; an absent one is a new
   * persistent test and keeps full persistent-test admission.
   */
  target_exists?: (path: string) => boolean;
  /** Roots of the project authority domains declared in PROJECT_PROFILE.yaml. */
  domain_roots?: ReadonlyMap<string, readonly string[]>;
};

export type MutationAuthorityErrorCode = 'MUTATION_AUTHORITY_INVALID';

export class MutationAuthorityError extends Error {
  readonly code: MutationAuthorityErrorCode;

  constructor(code: MutationAuthorityErrorCode, message: string) {
    super(message);
    this.name = 'MutationAuthorityError';
    this.code = code;
  }
}

export const MUTATION_AUTHORITY_HEADINGS: ReadonlySet<string> = new Set(['变更权限', '变更授权', 'mutation authority', 'authority envelope']);
export const AUTHORITY_DOMAINS_HEADINGS: ReadonlySet<string> = new Set(['authority domains', '授权域', '权限域']);
export const EXACT_EXCEPTIONS_HEADINGS: ReadonlySet<string> = new Set(['exact exceptions', '精确例外', '授权例外']);
export const PLANNED_TARGETS_HEADINGS: ReadonlySet<string> = new Set(['planned targets', 'planned mutation targets', '计划变更目标', '计划修改目标']);

const EMPTY_SCOPE_MARKER = /^(?:none|n\/a|na|nil|empty|no\s+(?:files?|targets?|domains?|scope)|无|暂无|不适用)[.!。]?$/iu;
const UNSUPPORTED_GLOB_SYNTAX = /[\[\]{}!]/u;
const PATH_PREFIX = /^(?:file|files|path|paths|target|targets|文件|路径|目标)\s*[:：]\s*/iu;
const DOMAIN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const ASSESSMENT_DISPOSITIONS = ['self-admit', 'escalate'] as const;
const ASSESSMENT_LOCALITIES = ['local', 'elevated', 'high'] as const;
const ASSESSMENT_VISIBILITIES = ['private', 'shared', 'public', 'unknown'] as const;
const ASSESSMENT_CONSUMERS = ['none', 'present', 'unknown'] as const;
const ASSESSMENT_CONTRACT_IMPACTS = ['none', 'possible', 'known'] as const;

type MarkdownSection = {
  title: string;
  level: number;
  heading_start: number;
  content_start: number;
  content_end: number;
};

function failInvalid(message: string): never {
  throw new MutationAuthorityError('MUTATION_AUTHORITY_INVALID', message);
}

function normalizeHeading(title: string): string {
  return title.trim().replace(/[：:]/gu, '').replace(/\s+/gu, ' ').toLocaleLowerCase();
}

function scanMarkdownSections(body: string): MarkdownSection[] {
  const headings: Array<{ title: string; level: number; start: number; end: number }> = [];
  const headingPattern = /^(#{2,6})[ \t]+(.+?)[ \t]*$/gmu;
  for (const match of body.matchAll(headingPattern)) {
    const start = match.index ?? 0;
    headings.push({ title: match[2]!.trim(), level: match[1]!.length, start, end: start + match[0]!.length });
  }
  return headings.map((heading, index) => {
    const contentStart = body.startsWith('\r\n', heading.end)
      ? heading.end + 2
      : body.startsWith('\n', heading.end)
        ? heading.end + 1
        : heading.end;
    const next = headings.slice(index + 1).find(candidate => candidate.level <= heading.level);
    return {
      title: heading.title,
      level: heading.level,
      heading_start: heading.start,
      content_start: contentStart,
      content_end: next?.start ?? body.length,
    };
  });
}

function normalizeAuthorityPath(value: string, location: string): string {
  const normalized = value.trim().replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/\/+/gu, '/');
  if (!normalized || normalized === '.') failInvalid(`${location} must identify a non-empty repository-relative path pattern.`);
  if (/^[A-Za-z]:\//u.test(normalized) || normalized.startsWith('/')) failInvalid(`${location} must not be absolute.`);
  if (/[\0-\x1F\x7F]/u.test(normalized)) failInvalid(`${location} contains a control character.`);
  if (UNSUPPORTED_GLOB_SYNTAX.test(normalized)) failInvalid(`${location} uses unsupported glob syntax; only * and ** are supported.`);
  if (normalized.split('/').some(segment => segment === '..' || segment.length === 0)) failInvalid(`${location} must not contain parent traversal or empty path segments.`);
  if (normalized.includes('://') || normalized.includes('$')) failInvalid(`${location} is not a repository-relative path pattern.`);
  if (/\s/u.test(normalized)) failInvalid(`${location} must not contain unquoted whitespace.`);
  return normalized;
}

function extractDeclarationPath(text: string): { pattern: string; remainder: string } {
  const code = /`([^`\r\n]+)`/u.exec(text);
  if (code) {
    return {
      pattern: code[1]!.trim(),
      remainder: `${text.slice(0, code.index)} ${text.slice(code.index + code[0].length)}`.trim(),
    };
  }
  const prefixed = text.replace(PATH_PREFIX, '');
  const token = /^([^\s,;，；()]+)([\s\S]*)$/u.exec(prefixed.trim());
  if (!token) failInvalid(`Authority declaration does not identify a repository-relative path: ${text}`);
  return { pattern: token[1]!, remainder: token[2]!.trim() };
}

function sectionEntries(body: string, section: MarkdownSection, location: string): Array<{ token: string; remainder: string }> {
  const content = body.slice(section.content_start, section.content_end);
  const entries: Array<{ token: string; remainder: string }> = [];
  let sawMarker = false;
  let bulletCount = 0;
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || /^<!--.*-->$/u.test(line)) continue;
    const bullet = /^(?:[-*+]\s+|\d+[.)]\s+)(.*)$/u.exec(line);
    if (!bullet) failInvalid(`${location} contains a non-list declaration: ${line}`);
    bulletCount += 1;
    const declaration = bullet[1]!.replace(/^\[[ xX]\]\s*/u, '').trim();
    if (EMPTY_SCOPE_MARKER.test(declaration)) {
      if (entries.length > 0 || sawMarker) failInvalid(`${location} mixes an empty marker with declarations.`);
      sawMarker = true;
      continue;
    }
    if (sawMarker) failInvalid(`${location} mixes an empty marker with declarations.`);
    const extracted = extractDeclarationPath(declaration);
    entries.push({ token: extracted.pattern, remainder: extracted.remainder });
  }
  if (bulletCount === 0) failInvalid(`${location} must explicitly list entries or declare none.`);
  return entries;
}

function findAuthoritySection(body: string): { container: MarkdownSection; domains: MarkdownSection | null; exceptions: MarkdownSection | null } | null {
  const sections = scanMarkdownSections(body);
  const containers = sections.filter(section => section.level === 2 && MUTATION_AUTHORITY_HEADINGS.has(normalizeHeading(section.title)));
  if (containers.length > 1) failInvalid(`CURRENT_TASK contains duplicate mutation authority sections [${containers.map(c => JSON.stringify(body.slice(c.heading_start, c.heading_start + 40))).join(' | ')}].`);
  const container = containers[0];
  if (!container) return null;
  const nested = (aliases: ReadonlySet<string>): MarkdownSection | null => {
    const matches = sections.filter(section => section.level === 3
      && aliases.has(normalizeHeading(section.title))
      && section.heading_start >= container.content_start
      && section.heading_start < container.content_end);
    if (matches.length > 1) failInvalid(`CURRENT_TASK contains duplicate ${[...aliases].join(' / ')} sections.`);
    return matches[0] ?? null;
  };
  return { container, domains: nested(AUTHORITY_DOMAINS_HEADINGS), exceptions: nested(EXACT_EXCEPTIONS_HEADINGS) };
}

/**
 * Parse the task authority envelope from the canonical task body.
 *
 * The envelope section is optional so that a legacy v1 task keeps working
 * unchanged. It is never inferred from Allowed Files: v1 and v2 both fail
 * closed when the version marker and the declared envelope disagree.
 */
export function parseTaskAuthorityEnvelope(body: string, declaredVersion: number | undefined): TaskAuthorityEnvelope {
  const version: MutationAuthorityVersion = declaredVersion === MUTATION_AUTHORITY_VERSION_V2
    ? MUTATION_AUTHORITY_VERSION_V2
    : MUTATION_AUTHORITY_VERSION_LEGACY;
  const found = findAuthoritySection(body);
  if (version === MUTATION_AUTHORITY_VERSION_LEGACY) {
    if (found) {
      failInvalid('CURRENT_TASK declares a mutation authority envelope without mutation_authority_version: 2; declare the version or remove the section.');
    }
    return { version, domains: [], exact_exceptions: [], forbidden: [] };
  }
  if (!found) failInvalid('CURRENT_TASK declares mutation_authority_version: 2 without a Mutation Authority envelope section.');
  if (!found.domains) failInvalid('The Mutation Authority envelope must declare an Authority Domains section.');
  const rawDomains = sectionEntries(body, found.domains, 'Authority Domains').map(entry => ({
    id: entry.token.replace(/`/gu, '').trim(),
    remainder: entry.remainder,
  }));
  const domains: string[] = [];
  for (const [index, entry] of rawDomains.entries()) {
    if (!DOMAIN_ID_PATTERN.test(entry.id)) failInvalid(`Authority Domains[${index}] is not a valid authority domain id: ${entry.id}`);
    if (domains.includes(entry.id)) failInvalid(`Authority Domains contains duplicate authority domain ${entry.id}.`);
    domains.push(entry.id);
  }
  if (domains.length === 0) failInvalid('The Mutation Authority envelope must grant at least one authority domain.');
  const exactExceptions = found.exceptions
    ? [...new Set(sectionEntries(body, found.exceptions, 'Exact Exceptions').map(entry => normalizeAuthorityPath(entry.token, 'Exact Exceptions declaration')))]
    : [];
  if (exactExceptions.some(pattern => pattern.includes('*'))) {
    failInvalid('Exact Exceptions must contain exact repository-relative paths; declare a domain for a directory grant.');
  }
  return { version, domains, exact_exceptions: exactExceptions, forbidden: [] };
}

/**
 * Resolve one `path -> authority domain` decision without a dependency graph.
 *
 * Overlap between domains fails closed, and a path owned by no domain is
 * `unclassified` and can never be self-admitted.
 */
export function resolvePathAuthorityDomain(
  path: string,
  envelope: TaskAuthorityEnvelope,
  domainRoots: ReadonlyMap<string, readonly string[]> | undefined,
): { classification: 'granted' | 'unclassified' | 'ambiguous' | 'unknown-domain'; domains: string[]; source: MutationAuthoritySource | null; reason: string } {
  if (envelope.exact_exceptions.includes(path)) {
    return { classification: 'granted', domains: [], source: 'exact-exception', reason: 'the path is an explicit exact exception of the task authority envelope.' };
  }
  const matches: string[] = [];
  for (const domain of envelope.domains) {
    const roots = domainRoots?.get(domain);
    if (roots === undefined) {
      return { classification: 'unknown-domain', domains: [domain], source: null, reason: `authority domain ${domain} is not declared in PROJECT_PROFILE.yaml mutation_authority.domains.` };
    }
    if (roots.some(root => mutationScopePatternMatchesPath(path, root))) matches.push(domain);
  }
  if (matches.length === 0) {
    return {
      classification: 'unclassified',
      domains: [],
      source: null,
      reason: domainRoots === undefined || domainRoots.size === 0
        ? 'the project declares no authority domain map, so this path is unclassified and cannot be self-admitted.'
        : 'the path is not owned by any granted authority domain.',
    };
  }
  if (matches.length > 1) {
    return { classification: 'ambiguous', domains: matches, source: null, reason: `the path is owned by multiple authority domains (${matches.join(', ')}); overlapping authority is denied.` };
  }
  return { classification: 'granted', domains: matches, source: 'task-envelope', reason: `the path is owned by granted authority domain ${matches[0]}.` };
}

function normalizeAssessment(value: unknown, index: number): MutationBlastRadiusAssessment {
  const location = `assessments[${index}]`;
  if (!value || typeof value !== 'object' || Array.isArray(value)) failInvalid(`${location} must be a mapping.`);
  const record = value as Record<string, unknown>;
  const expected = ['path', 'symbol', 'reason', 'locality', 'visibility', 'cross_component_consumers', 'contract_impact', 'evidence_refs', 'disposition'];
  const keys = Object.keys(record).sort();
  if (keys.join('|') !== [...expected].sort().join('|')) {
    failInvalid(`${location} must contain exactly ${expected.join(', ')}.`);
  }
  const path = normalizeAuthorityPath(String(record.path ?? ''), `${location}.path`);
  if (path.includes('*')) failInvalid(`${location}.path must be one exact repository-relative path.`);
  const symbol = record.symbol === null
    ? null
    : typeof record.symbol === 'string' && record.symbol.trim()
      ? record.symbol.trim()
      : failInvalid(`${location}.symbol must be null or a non-empty symbol name.`);
  const reason = typeof record.reason === 'string' ? record.reason.trim() : '';
  if (!reason) failInvalid(`${location}.reason must explain why this task needs the target.`);
  if (!(ASSESSMENT_LOCALITIES as readonly unknown[]).includes(record.locality)) failInvalid(`${location}.locality must be one of ${ASSESSMENT_LOCALITIES.join(', ')}.`);
  if (!(ASSESSMENT_VISIBILITIES as readonly unknown[]).includes(record.visibility)) failInvalid(`${location}.visibility must be one of ${ASSESSMENT_VISIBILITIES.join(', ')}.`);
  if (!(ASSESSMENT_CONSUMERS as readonly unknown[]).includes(record.cross_component_consumers)) failInvalid(`${location}.cross_component_consumers must be one of ${ASSESSMENT_CONSUMERS.join(', ')}.`);
  if (!(ASSESSMENT_CONTRACT_IMPACTS as readonly unknown[]).includes(record.contract_impact)) failInvalid(`${location}.contract_impact must be one of ${ASSESSMENT_CONTRACT_IMPACTS.join(', ')}.`);
  const rawEvidence = record.evidence_refs;
  if (!Array.isArray(rawEvidence) || rawEvidence.length === 0 || rawEvidence.some(item => typeof item !== 'string' || !item.trim())) {
    failInvalid(`${location}.evidence_refs must be a non-empty list of references.`);
  }
  const evidenceRefs = [...new Set((rawEvidence as string[]).map(item => item.trim()))];
  if (!(ASSESSMENT_DISPOSITIONS as readonly unknown[]).includes(record.disposition)) failInvalid(`${location}.disposition must be one of ${ASSESSMENT_DISPOSITIONS.join(', ')}.`);
  return {
    path,
    symbol,
    reason,
    locality: record.locality as MutationBlastRadiusLocality,
    visibility: record.visibility as MutationBlastRadiusVisibility,
    cross_component_consumers: record.cross_component_consumers as MutationBlastRadiusConsumers,
    contract_impact: record.contract_impact as MutationBlastRadiusContract,
    evidence_refs: evidenceRefs,
    disposition: record.disposition as MutationExpansionDisposition,
  };
}

export function normalizeBlastRadiusAssessments(value: unknown): MutationBlastRadiusAssessment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length === 0 || value.length > 256) {
    failInvalid('assessments must be a bounded non-empty array when supplied.');
  }
  const assessments = value.map((item, index) => normalizeAssessment(item, index));
  if (new Set(assessments.map(item => item.path)).size !== assessments.length) {
    failInvalid('assessments must not contain duplicate target paths.');
  }
  return assessments;
}

export function blastRadiusAssessmentDigest(assessment: MutationBlastRadiusAssessment): string {
  return crypto.createHash('sha256').update(JSON.stringify(assessment)).digest('hex');
}

function normalizeChangedPath(value: unknown, index: number): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const normalized = normalizeAuthorityPath(value, `changed_paths[${index}]`);
    return normalized.includes('*') ? null : normalized;
  } catch {
    return null;
  }
}

function defaultIsPersistentTest(path: string): boolean {
  return isLikelyPersistentTestPath(path);
}

function plannedTargetMatches(path: string, plannedTargets: readonly string[]): boolean {
  return plannedTargets.some(pattern => pattern === path || mutationScopePatternMatchesPath(path, pattern));
}

/**
 * Minimum blast-radius locality the Skill must claim before Runtime admits an
 * in-envelope expansion. This is an evidence floor for the Agent's judgment,
 * never a mechanical block on shared code.
 */
export function requiredLocalityFor(persistentTest: { existing: boolean }): MutationBlastRadiusLocality {
  return persistentTest.existing ? 'local' : 'elevated';
}

/**
 * Evaluate a candidate diff against the task authority envelope.
 *
 * A planned path inside the envelope is admitted normally. A path inside the
 * envelope but outside the planned footprint is admitted only with a supplied
 * `self-admit` assessment, or through a durable `extend-preflight` admission.
 * A path outside the envelope is a hard authority-expansion requirement.
 */
export function evaluateMutationAuthority(
  envelope: TaskAuthorityEnvelope,
  input: MutationAuthorityEvaluationInput,
): MutationAuthorityEvaluation {
  const stepId = typeof input.step_id === 'string' && input.step_id.trim() ? input.step_id.trim() : 'unknown-step';
  if (!Array.isArray(input.changed_paths) || input.changed_paths.length === 0) {
    failInvalid('an explicit non-empty changed_paths diff target is required; an empty diff cannot be admitted.');
  }
  const plannedTargets = (input.planned_targets ?? []).map((pattern, index) => normalizeAuthorityPath(pattern, `planned_targets[${index}]`));
  const assessments = normalizeBlastRadiusAssessments(input.assessments);
  const admissions = [...(input.admissions ?? [])];
  const isPersistentTest = input.is_persistent_test ?? defaultIsPersistentTest;
  const seen = new Set<string>();
  const decisions: MutationAuthorityAdmission[] = [];

  for (const [index, rawPath] of input.changed_paths.entries()) {
    const path = normalizeChangedPath(rawPath, index);
    if (!path) {
      decisions.push(invalidAdmission(typeof rawPath === 'string' ? rawPath.trim() : String(rawPath), 'changed path must be a unique repository-relative file path without glob syntax or traversal.'));
      continue;
    }
    if (seen.has(path)) {
      decisions.push(invalidAdmission(path, 'changed path is duplicated; the diff target must be explicit and unambiguous.'));
      continue;
    }
    seen.add(path);
    decisions.push(admitPath(path));
  }

  function invalidAdmission(path: string, reason: string): MutationAuthorityAdmission {
    return {
      path,
      classification: 'invalid',
      admitted: false,
      authority_domains: [],
      authority_source: null,
      unplanned: false,
      persistent_test: { path, existing: false },
      reason,
      required_assessment: null,
    };
  }

  function admitPath(path: string): MutationAuthorityAdmission {
    // A test-like path that already existed at first touch is an ordinary
    // in-envelope expansion. An absent test path is a new persistent test and
    // keeps its own admission route, so self-admission can never create one.
    const testLike = isPersistentTest(path);
    const exists = input.target_exists ? input.target_exists(path) : true;
    const persistentTest = { path, existing: !testLike || exists };
    const unplanned = !plannedTargetMatches(path, plannedTargets);
    const base = {
      path,
      authority_domains: [] as string[],
      authority_source: null as MutationAuthoritySource | null,
      unplanned,
      persistent_test: persistentTest,
    };

    if (envelope.forbidden.some(pattern => mutationScopePatternMatchesPath(path, pattern))) {
      return { ...base, classification: 'forbidden', admitted: false, reason: 'the target matches a task-specific explicit forbidden target; explicit prohibition outranks every authority grant.', required_assessment: null };
    }

    const granted = resolvePathAuthorityDomain(path, envelope, input.domain_roots);
    if (granted.classification === 'unclassified') {
      return { ...base, classification: 'unclassified', admitted: false, reason: `the target is unclassified inside the task authority envelope: ${granted.reason}`, required_assessment: null };
    }
    if (granted.classification === 'ambiguous') {
      return { ...base, classification: 'ambiguous-authority', admitted: false, authority_domains: granted.domains, reason: granted.reason, required_assessment: null };
    }
    if (granted.classification === 'unknown-domain') {
      return { ...base, classification: 'unavailable', admitted: false, authority_domains: granted.domains, reason: granted.reason, required_assessment: null };
    }
    if (!unplanned) {
      return { ...base, classification: 'planned-in-envelope', admitted: true, authority_domains: granted.domains, authority_source: granted.source, reason: `${granted.reason} The target is inside this step's planned mutation footprint.`, required_assessment: null };
    }

    const minLocality = requiredLocalityFor(persistentTest);
    const requiredAssessment = {
      kind: 'mutation-blast-radius/v1' as const,
      min_locality: minLocality,
      advisory: persistentTest.existing
        ? 'Assess blast radius and state whether the persistent-test oracle changes; a self-admitted expansion always requires review.'
        : 'A new persistent test still needs full persistent-test admission; assessment alone never authorizes creating it.',
    };
    const durable = admissions.find(item => item.path === path && item.step_id === stepId);
    if (durable) {
      return { ...base, classification: 'self-admitted-in-envelope', admitted: true, authority_domains: granted.domains, authority_source: granted.source, reason: `${granted.reason} The target is admitted by extend-preflight admission ${durable.admission_id}.`, required_assessment: null };
    }
    const assessment = assessments.find(item => item.path === path);
    if (assessment && assessment.disposition === 'escalate') {
      return { ...base, classification: 'escalated', admitted: false, authority_domains: granted.domains, authority_source: granted.source, reason: `the Agent escalated target ${path}: ${assessment.reason}`, required_assessment: requiredAssessment };
    }
    if (assessment && assessment.disposition === 'self-admit') {
      if (!persistentTest.existing && isPersistentTest(path)) {
        return { ...base, classification: 'assessment-required', admitted: false, authority_domains: granted.domains, authority_source: granted.source, reason: 'a newly created persistent test requires persistent-test admission and cannot be self-admitted by blast-radius assessment.', required_assessment: requiredAssessment };
      }
      return { ...base, classification: 'self-admitted-in-envelope', admitted: true, authority_domains: granted.domains, authority_source: granted.source, reason: `${granted.reason} The Agent self-admitted the expansion with a blast-radius assessment.`, required_assessment: null };
    }
    return { ...base, classification: 'assessment-required', admitted: false, authority_domains: granted.domains, authority_source: granted.source, reason: `${granted.reason} The target is outside this step's planned mutation footprint and requires a blast-radius assessment.`, required_assessment: requiredAssessment };
  }

  const invalid = decisions.filter(item => item.classification === 'invalid');
  if (invalid.length > 0) {
    return {
      status: 'blocked',
      version: envelope.version,
      envelope,
      step_id: stepId,
      planned_targets: plannedTargets,
      changed_paths: decisions.map(item => item.path),
      admissions: decisions,
      admitted_paths: [],
      blocked_paths: decisions.map(item => item.path),
      assessment_required_paths: [],
      authority_expansion_required_paths: [],
      dynamic_expansion_paths: [],
      new_persistent_test_paths: [],
      dynamic_review_required: false,
      blockers: invalid.map(item => `${item.path}: ${item.reason}`),
    };
  }

  const admittedPaths = decisions.filter(item => item.admitted).map(item => item.path);
  const blockedPaths = decisions.filter(item => !item.admitted).map(item => item.path);
  const dynamicExpansionPaths = decisions
    .filter(item => item.admitted && item.unplanned)
    .map(item => item.path);
  const newPersistentTestPaths = decisions
    .filter(item => item.admitted && item.unplanned && !item.persistent_test.existing)
    .map(item => item.path);
  return {
    status: blockedPaths.length === 0 ? 'pass' : 'blocked',
    version: envelope.version,
    envelope,
    step_id: stepId,
    planned_targets: plannedTargets,
    changed_paths: decisions.map(item => item.path),
    admissions: decisions,
    admitted_paths: admittedPaths,
    blocked_paths: blockedPaths,
    assessment_required_paths: decisions.filter(item => item.classification === 'assessment-required').map(item => item.path),
    authority_expansion_required_paths: decisions
      .filter(item => ['unclassified', 'ambiguous-authority', 'unavailable'].includes(item.classification))
      .map(item => item.path),
    dynamic_expansion_paths: dynamicExpansionPaths,
    new_persistent_test_paths: newPersistentTestPaths,
    dynamic_review_required: dynamicExpansionPaths.length > 0,
    blockers: decisions.filter(item => !item.admitted).map(item => `${item.path}: ${item.reason}`),
  };
}

/**
 * Translate an authority evaluation into the transport error a caller sees.
 *
 * `unclassified`, `ambiguous-authority`, `unavailable`, and `forbidden` are
 * real authority boundaries and report
 * `MUTATION_AUTHORITY_EXPANSION_REQUIRED`. A path that is merely outside the
 * planned footprint but inside the envelope is never reported as an authority
 * expansion.
 */
export function mutationAuthorityBlockerCode(evaluation: MutationAuthorityEvaluation): 'MUTATION_AUTHORITY_EXPANSION_REQUIRED' | 'MUTATION_BLAST_RADIUS_ASSESSMENT_REQUIRED' | 'MUTATION_TARGET_ESCALATED' | null {
  if (evaluation.status === 'pass') return null;
  if (evaluation.authority_expansion_required_paths.length > 0) return 'MUTATION_AUTHORITY_EXPANSION_REQUIRED';
  if (evaluation.admissions.some(item => item.classification === 'escalated')) return 'MUTATION_TARGET_ESCALATED';
  if (evaluation.assessment_required_paths.length > 0) return 'MUTATION_BLAST_RADIUS_ASSESSMENT_REQUIRED';
  return null;
}
