/**
 * Read-only Runtime guard for the task's mutation boundary.
 *
 * This module intentionally does not discover a diff or write any artifact;
 * callers provide the explicit changed paths and receive an auditable,
 * fail-closed admission result.
 */

import * as crypto from 'crypto';

export type MutationTransformationKind = 'localized' | 'inherently-broad';

export type MutationScopeErrorCode = 'MUTATION_SCOPE_INVALID' | 'MUTATION_SCOPE_BLOCKED';

export class MutationScopeError extends Error {
  readonly code: MutationScopeErrorCode;

  constructor(code: MutationScopeErrorCode, message: string) {
    super(message);
    this.name = 'MutationScopeError';
    this.code = code;
  }
}

export type MutationScopePattern = {
  pattern: string;
  broad: boolean;
  declaration: string;
};

export type MutationScope = {
  source_revision: string;
  allowed: MutationScopePattern[];
  conditional: MutationScopePattern[];
  forbidden: MutationScopePattern[];
  read_discovery: MutationScopePattern[];
};

export type ConditionalScopeAuthorization = {
  pattern: string;
  evidence_refs: string[];
  authority: string;
};

export type MutationScopeEvaluationInput = {
  changed_paths: string[];
  conditional_authorizations?: ConditionalScopeAuthorization[];
  transformation_kind?: MutationTransformationKind;
};

export type MutationScopeDecisionClassification =
  | 'allowed-exact'
  | 'allowed-broad'
  | 'conditional-admitted'
  | 'forbidden'
  | 'conditional-unapproved'
  | 'ambiguous-overlap'
  | 'broad-scope-unqualified'
  | 'read-context-only'
  | 'unowned'
  | 'invalid';

export type MutationScopeDecision = {
  path: string;
  classification: MutationScopeDecisionClassification;
  mutation_admitted: boolean;
  matched_scope: string[];
  read_discovery_matches: string[];
  reason: string;
};

export type MutationScopeCheckResult = {
  status: 'pass' | 'blocked';
  source_revision: string;
  transformation_kind: MutationTransformationKind;
  scope: {
    allowed: string[];
    conditional: string[];
    forbidden: string[];
    read_discovery: string[];
  };
  changed_paths: string[];
  decisions: MutationScopeDecision[];
  admitted_paths: string[];
  blocked_paths: string[];
  blockers: string[];
};

type MarkdownSection = {
  title: string;
  level: number;
  heading_start: number;
  content_start: number;
  content_end: number;
};

type ScopeBucket = 'allowed' | 'conditional' | 'forbidden' | 'read_discovery';

const ALLOWED_SCOPE_HEADINGS = new Set(['允许修改范围', 'mutation scope', 'scope']);
const ALLOWED_BUCKET_HEADINGS = new Set(['allowed files', 'allowed targets', '允许文件', '允许目标']);
const CONDITIONAL_BUCKET_HEADINGS = new Set(['条件修改范围', '条件允许修改范围', 'conditional files', 'conditional targets']);
const FORBIDDEN_SCOPE_HEADINGS = new Set(['禁止修改范围', 'forbidden files', 'forbidden targets']);
const READ_DISCOVERY_HEADINGS = new Set([
  'read / discovery context',
  'read/discovery context',
  'read context',
  'discovery context',
  '读取 / 发现上下文',
  '读取/发现上下文',
  '发现上下文',
]);

const EMPTY_SCOPE_MARKER = /^(?:none|n\/a|na|nil|empty|no\s+(?:files?|targets?|scope)|无|暂无|不适用)[.!。]?$/iu;
const CONDITIONAL_LANGUAGE = /(?:when|if|after|once|upon|provided|only|condition|evidence|authority|approval|authorized|confirmed|满足|条件|证据|依据|授权|审批|确认|批准)/iu;
const PATH_PREFIX = /^(?:file|files|path|paths|target|targets|文件|路径|目标)\s*[:：]\s*/iu;
const UNSUPPORTED_GLOB_SYNTAX = /[\[\]{}!]/u;

function failInvalid(message: string): never {
  throw new MutationScopeError('MUTATION_SCOPE_INVALID', message);
}

function normalizeHeading(title: string): string {
  return title.trim().replace(/[：:]/gu, '').replace(/\s+/gu, ' ').toLocaleLowerCase();
}

function scanMarkdownSections(body: string): MarkdownSection[] {
  const headings: Array<{ title: string; level: number; start: number; end: number }> = [];
  const headingPattern = /^(#{2,6})[ \t]+(.+?)[ \t]*$/gmu;
  for (const match of body.matchAll(headingPattern)) {
    const start = match.index ?? 0;
    headings.push({
      title: match[2]!.trim(),
      level: match[1]!.length,
      start,
      end: start + match[0]!.length,
    });
  }
  return headings.map((heading, index) => {
    const contentStart = body.startsWith('\r\n', heading.end)
      ? heading.end + 2
      : getLineContentStart(body, heading.end);
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

function getLineContentStart(body: string, headingEnd: number): number {
  return body.startsWith('\n', headingEnd) ? headingEnd + 1 : headingEnd;
}

function findOneSection(
  sections: readonly MarkdownSection[],
  aliases: ReadonlySet<string>,
  level: number,
  range?: { start: number; end: number },
): MarkdownSection | null {
  const matches = sections.filter(section => {
    if (section.level !== level || !aliases.has(normalizeHeading(section.title))) return false;
    if (!range) return true;
    return section.heading_start >= range.start && section.heading_start < range.end;
  });
  if (matches.length > 1) failInvalid(`CURRENT_TASK contains duplicate ${[...aliases].join(' / ')} scope sections.`);
  return matches[0] ?? null;
}

function sectionRange(section: MarkdownSection): { start: number; end: number } {
  return { start: section.content_start, end: section.content_end };
}

function resolveBucketSection(
  sections: readonly MarkdownSection[],
  bucket: ScopeBucket,
): MarkdownSection | null {
  const bucketAliases = aliasesForBucket(bucket);
  const containerAliases = containerAliasesForBucket(bucket);
  const container = containerAliases ? findOneSection(sections, containerAliases, 2) : null;
  const direct = findOneSection(sections, bucketAliases, 2);
  if (container && direct && direct.heading_start !== container.heading_start) {
    failInvalid(`CURRENT_TASK declares both a scope container and a direct ${bucket} section.`);
  }

  if (container) {
    const range = sectionRange(container);
    const nested = findOneSection(sections, bucketAliases, 3, range);
    if (bucket === 'allowed') {
      const nestedConditional = findOneSection(sections, CONDITIONAL_BUCKET_HEADINGS, 3, range);
      const nestedRead = findOneSection(sections, READ_DISCOVERY_HEADINGS, 3, range);
      if ((nestedConditional || nestedRead) && !nested) {
        failInvalid('Nested Conditional Files or Read / discovery context requires a distinct nested Allowed Files section.');
      }
    }
    const nestedHeadings = sections.filter(section => section.level === 3 && section.heading_start >= range.start && section.heading_start < range.end);
    if (nestedHeadings.length > 0 && !nested) {
      failInvalid(`${bucket} scope container has nested headings but no matching ${[...bucketAliases].join(' / ')} bucket.`);
    }
    if (nested) return nested;
    return container;
  }

  if (bucket === 'conditional' || bucket === 'read_discovery') {
    const allowedContainer = findOneSection(sections, ALLOWED_SCOPE_HEADINGS, 2);
    const nested = allowedContainer
      ? findOneSection(sections, bucketAliases, 3, sectionRange(allowedContainer))
      : null;
    if (nested && direct) failInvalid(`CURRENT_TASK declares both nested and direct ${bucket} scope sections.`);
    if (nested) return nested;
  }

  if (direct) return direct;
  if (bucket === 'read_discovery') return null;
  return null;
}

function aliasesForBucket(bucket: ScopeBucket): ReadonlySet<string> {
  if (bucket === 'allowed') return ALLOWED_BUCKET_HEADINGS;
  if (bucket === 'conditional') return CONDITIONAL_BUCKET_HEADINGS;
  if (bucket === 'forbidden') return FORBIDDEN_SCOPE_HEADINGS;
  return READ_DISCOVERY_HEADINGS;
}

function containerAliasesForBucket(bucket: ScopeBucket): ReadonlySet<string> | null {
  if (bucket === 'allowed') return ALLOWED_SCOPE_HEADINGS;
  if (bucket === 'forbidden') return FORBIDDEN_SCOPE_HEADINGS;
  return null;
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
  if (!token) failInvalid(`Scope declaration does not identify a repository-relative path: ${text}`);
  return { pattern: token[1]!, remainder: token[2]!.trim() };
}

function normalizeScopePattern(value: string, location: string): string {
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

function isEmptyMarker(text: string): boolean {
  return EMPTY_SCOPE_MARKER.test(text.trim());
}

function parseScopeBucket(body: string, section: MarkdownSection, bucket: ScopeBucket): MutationScopePattern[] {
  const content = body.slice(section.content_start, section.content_end);
  const entries: MutationScopePattern[] = [];
  let sawMarker = false;
  let bulletCount = 0;
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || /^<!--.*-->$/u.test(line)) continue;
    const bullet = /^(?:[-*+]\s+|\d+[.)]\s+)(.*)$/u.exec(line);
    if (!bullet) failInvalid(`${section.title} contains a non-list scope declaration: ${line}`);
    bulletCount += 1;
    const declaration = bullet[1]!.replace(/^\[[ xX]\]\s*/u, '').trim();
    if (isEmptyMarker(declaration)) {
      if (entries.length > 0 || sawMarker) failInvalid(`${section.title} mixes an empty marker with path declarations.`);
      sawMarker = true;
      continue;
    }
    if (sawMarker) failInvalid(`${section.title} mixes an empty marker with path declarations.`);
    const extracted = extractDeclarationPath(declaration);
    const pattern = normalizeScopePattern(extracted.pattern, `${section.title} declaration`);
    if (bucket === 'conditional' && !CONDITIONAL_LANGUAGE.test(extracted.remainder)) {
      failInvalid(`Conditional Files declaration ${pattern} must state its condition, evidence, or authority.`);
    }
    entries.push({ pattern, broad: pattern.includes('*'), declaration });
  }
  if (bulletCount === 0) failInvalid(`${section.title} must explicitly list paths or declare none.`);
  if (new Set(entries.map(entry => entry.pattern)).size !== entries.length) failInvalid(`${section.title} contains duplicate path patterns.`);
  return entries;
}

function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function scopeSummary(scope: MutationScope): MutationScopeCheckResult['scope'] {
  return {
    allowed: scope.allowed.map(entry => entry.pattern),
    conditional: scope.conditional.map(entry => entry.pattern),
    forbidden: scope.forbidden.map(entry => entry.pattern),
    read_discovery: scope.read_discovery.map(entry => entry.pattern),
  };
}

export function parseMutationScope(body: string, sourceRevision = hash(body)): MutationScope {
  if (typeof body !== 'string' || body.length === 0) failInvalid('CURRENT_TASK body is empty; mutation scope cannot be established.');
  const sections = scanMarkdownSections(body);
  const allowedSection = resolveBucketSection(sections, 'allowed');
  const conditionalSection = resolveBucketSection(sections, 'conditional');
  const forbiddenSection = resolveBucketSection(sections, 'forbidden');
  const readSection = resolveBucketSection(sections, 'read_discovery');
  if (!allowedSection) failInvalid('CURRENT_TASK is missing the required Allowed Files scope bucket.');
  if (!conditionalSection) failInvalid('CURRENT_TASK is missing the required Conditional Files scope bucket.');
  if (!forbiddenSection) failInvalid('CURRENT_TASK is missing the required Forbidden Files scope bucket.');
  if (!/^[a-f0-9]{64}$/u.test(sourceRevision)) failInvalid('Mutation scope source_revision must be a SHA-256 digest.');
  return {
    source_revision: sourceRevision,
    allowed: parseScopeBucket(body, allowedSection, 'allowed'),
    conditional: parseScopeBucket(body, conditionalSection, 'conditional'),
    forbidden: parseScopeBucket(body, forbiddenSection, 'forbidden'),
    read_discovery: readSection ? parseScopeBucket(body, readSection, 'read_discovery') : [],
  };
}

function escapeRegex(text: string): string {
  return text.replace(/[|\\{}()[\]^$+?.]/gu, '\\$&');
}

export function mutationScopePatternMatchesPath(file: string, pattern: string): boolean {
  const normalizedFile = normalizeScopePattern(file, 'changed path');
  const normalizedPattern = normalizeScopePattern(pattern, 'scope pattern');
  const regex = escapeRegex(normalizedPattern)
    .replace(/\*\*\//gu, '(?:.*/)?')
    .replace(/\*\*/gu, '.*')
    .replace(/\*/gu, '[^/]*');
  return new RegExp(`^${regex}$`, 'u').test(normalizedFile);
}

function normalizeChangedPath(value: unknown, index: number): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  try {
    const normalized = normalizeScopePattern(value, `changed_paths[${index}]`);
    if (normalized.includes('*')) return null;
    return normalized;
  } catch {
    return null;
  }
}

function validateConditionalAuthorizations(value: unknown): { authorizations: ConditionalScopeAuthorization[]; blockers: string[] } {
  if (value === undefined) return { authorizations: [], blockers: [] };
  if (!Array.isArray(value)) return { authorizations: [], blockers: ['conditional_authorizations must be an array.'] };
  const authorizations: ConditionalScopeAuthorization[] = [];
  const blockers: string[] = [];
  for (const [index, raw] of value.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      blockers.push(`conditional_authorizations[${index}] must be a mapping.`);
      continue;
    }
    const record = raw as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (keys.join('|') !== ['authority', 'evidence_refs', 'pattern'].join('|')) {
      blockers.push(`conditional_authorizations[${index}] must contain exactly pattern, evidence_refs, and authority.`);
      continue;
    }
    let pattern: string;
    try {
      pattern = normalizeScopePattern(String(record.pattern ?? ''), `conditional_authorizations[${index}].pattern`);
    } catch (error) {
      blockers.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    if (pattern.includes('*')) {
      blockers.push(`conditional_authorizations[${index}].pattern must narrow to an exact target.`);
      continue;
    }
    const evidenceRefs = record.evidence_refs;
    if (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0 || evidenceRefs.some(item => typeof item !== 'string' || item.trim().length === 0)) {
      blockers.push(`conditional_authorizations[${index}].evidence_refs must be a non-empty list of references.`);
      continue;
    }
    const authority = record.authority;
    if (typeof authority !== 'string' || authority.trim().length === 0) {
      blockers.push(`conditional_authorizations[${index}].authority must be non-empty.`);
      continue;
    }
    authorizations.push({
      pattern,
      evidence_refs: [...new Set(evidenceRefs.map(item => item.trim()))],
      authority: authority.trim(),
    });
  }
  return { authorizations, blockers };
}

function blockedResult(
  scope: MutationScope,
  inputPaths: string[],
  transformationKind: MutationTransformationKind,
  blockers: string[],
): MutationScopeCheckResult {
  const normalizedPaths = inputPaths.filter(path => typeof path === 'string').map(path => path.trim()).filter(Boolean);
  return {
    status: 'blocked',
    source_revision: scope.source_revision,
    transformation_kind: transformationKind,
    scope: scopeSummary(scope),
    changed_paths: normalizedPaths,
    decisions: normalizedPaths.map(path => ({
      path,
      classification: 'invalid' as const,
      mutation_admitted: false,
      matched_scope: [],
      read_discovery_matches: [],
      reason: 'mutation scope input is invalid or incomplete',
    })),
    admitted_paths: [],
    blocked_paths: normalizedPaths,
    blockers: [...new Set(blockers)],
  };
}

export function evaluateMutationScope(scope: MutationScope, input: MutationScopeEvaluationInput): MutationScopeCheckResult {
  const transformationKind = input.transformation_kind ?? 'localized';
  if (transformationKind !== 'localized' && transformationKind !== 'inherently-broad') {
    return blockedResult(scope, Array.isArray(input.changed_paths) ? input.changed_paths : [], 'localized', ['transformation_kind must be localized or inherently-broad.']);
  }
  if (!Array.isArray(input.changed_paths) || input.changed_paths.length === 0) {
    return blockedResult(scope, [], transformationKind, ['an explicit non-empty changed_paths diff target is required; an empty diff cannot be admitted.']);
  }
  const authorizationResult = validateConditionalAuthorizations(input.conditional_authorizations);
  if (authorizationResult.blockers.length > 0) {
    return blockedResult(scope, input.changed_paths, transformationKind, authorizationResult.blockers);
  }

  const decisions: MutationScopeDecision[] = [];
  const seen = new Set<string>();
  const inputBlockers: string[] = [];
  for (const [index, rawPath] of input.changed_paths.entries()) {
    const pathValue = normalizeChangedPath(rawPath, index);
    if (!pathValue) {
      decisions.push({
        path: typeof rawPath === 'string' ? rawPath.trim() : String(rawPath),
        classification: 'invalid',
        mutation_admitted: false,
        matched_scope: [],
        read_discovery_matches: [],
        reason: 'changed path must be a unique repository-relative file path without glob syntax or traversal.',
      });
      inputBlockers.push(`changed_paths[${index}] is invalid.`);
      continue;
    }
    if (seen.has(pathValue)) {
      decisions.push({
        path: pathValue,
        classification: 'invalid',
        mutation_admitted: false,
        matched_scope: [],
        read_discovery_matches: [],
        reason: 'changed path is duplicated; the diff target must be explicit and unambiguous.',
      });
      inputBlockers.push(`changed path ${pathValue} is duplicated.`);
      continue;
    }
    seen.add(pathValue);

    const forbidden = scope.forbidden.filter(entry => mutationScopePatternMatchesPath(pathValue, entry.pattern));
    const allowed = scope.allowed.filter(entry => mutationScopePatternMatchesPath(pathValue, entry.pattern));
    const conditional = scope.conditional.filter(entry => mutationScopePatternMatchesPath(pathValue, entry.pattern));
    const readMatches = scope.read_discovery.filter(entry => mutationScopePatternMatchesPath(pathValue, entry.pattern));
    const matchedScope = [
      ...forbidden.map(entry => `Forbidden:${entry.pattern}`),
      ...allowed.map(entry => `Allowed:${entry.pattern}`),
      ...conditional.map(entry => `Conditional:${entry.pattern}`),
    ];
    const readDiscoveryMatches = readMatches.map(entry => entry.pattern);

    if (forbidden.length > 0) {
      decisions.push({ path: pathValue, classification: 'forbidden', mutation_admitted: false, matched_scope: matchedScope, read_discovery_matches: readDiscoveryMatches, reason: 'Forbidden Files takes precedence over every other bucket.' });
      continue;
    }
    if (allowed.length > 0 && conditional.length > 0) {
      decisions.push({ path: pathValue, classification: 'ambiguous-overlap', mutation_admitted: false, matched_scope: matchedScope, read_discovery_matches: readDiscoveryMatches, reason: 'the path matches both Allowed Files and Conditional Files; ambiguous authority is denied.' });
      continue;
    }
    if (allowed.length > 0) {
      const exactAllowed = allowed.filter(entry => !entry.broad);
      if (exactAllowed.length > 0) {
        decisions.push({ path: pathValue, classification: 'allowed-exact', mutation_admitted: true, matched_scope: matchedScope, read_discovery_matches: readDiscoveryMatches, reason: 'exact Allowed Files entry admits this localized mutation.' });
        continue;
      }
      if (transformationKind === 'inherently-broad') {
        decisions.push({ path: pathValue, classification: 'allowed-broad', mutation_admitted: true, matched_scope: matchedScope, read_discovery_matches: readDiscoveryMatches, reason: 'the declared broad Allowed Files pattern is admitted for an explicitly inherently-broad transformation.' });
      } else {
        decisions.push({ path: pathValue, classification: 'broad-scope-unqualified', mutation_admitted: false, matched_scope: matchedScope, read_discovery_matches: readDiscoveryMatches, reason: 'a broad Allowed Files pattern requires transformation_kind: inherently-broad.' });
      }
      continue;
    }
    if (conditional.length > 0) {
      const authorization = authorizationResult.authorizations.find(candidate =>
        candidate.pattern === pathValue && conditional.some(entry => mutationScopePatternMatchesPath(pathValue, entry.pattern)),
      );
      if (authorization) {
        decisions.push({ path: pathValue, classification: 'conditional-admitted', mutation_admitted: true, matched_scope: matchedScope, read_discovery_matches: readDiscoveryMatches, reason: `Conditional Files admitted by exact target authorization with ${authorization.evidence_refs.length} evidence reference(s) and explicit authority.` });
      } else {
        decisions.push({ path: pathValue, classification: 'conditional-unapproved', mutation_admitted: false, matched_scope: matchedScope, read_discovery_matches: readDiscoveryMatches, reason: 'Conditional Files is not pre-authorized; an exact target authorization with evidence_refs and authority is required.' });
      }
      continue;
    }
    if (readMatches.length > 0) {
      decisions.push({ path: pathValue, classification: 'read-context-only', mutation_admitted: false, matched_scope: [], read_discovery_matches: readDiscoveryMatches, reason: 'Read / discovery context is intentionally broader but never grants write authority.' });
      continue;
    }
    decisions.push({ path: pathValue, classification: 'unowned', mutation_admitted: false, matched_scope: [], read_discovery_matches: [], reason: 'the path is not listed in Allowed Files or an authorized Conditional Files entry.' });
  }

  const admittedPaths = decisions.filter(decision => decision.mutation_admitted).map(decision => decision.path);
  const blockedPaths = decisions.filter(decision => !decision.mutation_admitted).map(decision => decision.path);
  const decisionBlockers = decisions.filter(decision => !decision.mutation_admitted).map(decision => `${decision.path}: ${decision.reason}`);
  const blockers = [...new Set([...inputBlockers, ...decisionBlockers])];
  return {
    status: blockers.length === 0 && admittedPaths.length === decisions.length ? 'pass' : 'blocked',
    source_revision: scope.source_revision,
    transformation_kind: transformationKind,
    scope: scopeSummary(scope),
    changed_paths: decisions.map(decision => decision.path),
    decisions,
    admitted_paths: admittedPaths,
    blocked_paths: blockedPaths,
    blockers,
  };
}

export const validateMutationScope = evaluateMutationScope;

export function assertMutationScope(scope: MutationScope, input: MutationScopeEvaluationInput): MutationScopeCheckResult {
  const result = evaluateMutationScope(scope, input);
  if (result.status === 'blocked') {
    throw new MutationScopeError('MUTATION_SCOPE_BLOCKED', result.blockers.join(' '));
  }
  return result;
}
