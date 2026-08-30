#!/usr/bin/env bun

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { findGitRoot, normalizeAbsoluteRootPath } from './guard-target-root';

export const PROJECT_CONTEXT_SCHEMA_VERSION = 1 as const;

export type ContextIntent =
  | 'prepare'
  | 'execute'
  | 'review'
  | 'debug'
  | 'lifecycle'
  | 'capture'
  | 'close'
  | 'validate'
  | 'bootstrap';

export type ContextAuthority =
  | 'structural'
  | 'contract'
  | 'profile'
  | 'decision'
  | 'task'
  | 'status'
  | 'lesson'
  | 'evidence';

export type TargetRootRelationship =
  | 'source'
  | 'isolated-target'
  | 'shared-git-conflict'
  | 'unknown';

export type TargetRootIdentity = {
  absoluteRoot: string;
  gitAnchor: string | null;
  relationship: TargetRootRelationship;
};

export type ContextBudget = {
  maxItems: number;
  maxSummaryBytes: number;
};

export type ProjectContextRequest = {
  requestId: string;
  targetRootIdentity: TargetRootIdentity;
  intent: ContextIntent;
  taskIdentity: string | null;
  lifecycleTuple: string | null;
  diffTarget: string | null;
  goalAndClaims: string[];
  scopePathsAndSymbols: string[];
  changedSurfaces: string[];
  riskTriggers: string[];
  contextBudget: ContextBudget;
};

export type ContextCandidate = {
  id?: string;
  source: string;
  locator: string;
  authority: ContextAuthority;
  statement: string;
  summary?: string;
  tags?: string[];
  semanticKey?: string;
  freshness?: 'current' | 'stale' | 'unknown';
  required?: boolean;
  active?: boolean;
  sourceRevision?: string;
};

export type ResolvedContextItem = {
  id: string;
  source: string;
  locator: string;
  authority: ContextAuthority;
  summary: string;
  freshness: 'current' | 'stale' | 'unknown';
  relevanceReasons: string[];
  score: number;
  semanticKey: string | null;
  semanticRevision: string;
  sourceRevision: string;
};

export type ContextConflict = {
  semanticKey: string;
  itemLocators: string[];
  winningLocator: string | null;
  resolution: 'authority-precedence' | 'unresolved-same-authority';
  reason: string;
};

export type ContextBundle = {
  schemaVersion: typeof PROJECT_CONTEXT_SCHEMA_VERSION;
  contextId: string;
  requestId: string;
  sourceRevision: string;
  targetRootIdentity: TargetRootIdentity;
  required: ResolvedContextItem[];
  optional: ResolvedContextItem[];
  conflicts: ContextConflict[];
  missingRequiredContext: string[];
  excludedSummary: {
    count: number;
    reasons: string[];
  };
  budgetResult: 'within-budget' | 'required-context-exceeds-budget';
};

export type KnowledgeKind = 'contract' | 'decision' | 'lesson';
export type KnowledgeAuthoritySource =
  | 'user'
  | 'existing-contract'
  | 'accepted-decision'
  | 'verified-evidence'
  | 'none';

export type KnowledgeSourceRef = {
  locator: string;
  revision: string;
};

export type KnowledgeCandidate = {
  candidateId: string;
  kind: KnowledgeKind;
  fingerprint: string;
  statement: string;
  sourceRefs: KnowledgeSourceRef[];
  applicability: {
    projectTypes: string[];
    pathsSymbolsOrSurfaces: string[];
    triggerConditions: string[];
  };
  authoritySource: KnowledgeAuthoritySource;
  stability: 'stable' | 'provisional' | 'exploratory';
  evidenceRefs: string[];
  noveltyAgainst: string[];
  conflictSet: string[];
  supersedes: string | null;
  reviewOrExpiryTrigger: string | null;
  expectedConsumers: string[];
  decisionContext?: {
    alternatives: string[];
    constraints: string[];
  };
  systemicSeverity?: 'ordinary' | 'high';
};

export type ExistingKnowledgeItem = {
  id: string;
  kind: KnowledgeKind;
  fingerprint: string;
  statement: string;
  sourceRefs: KnowledgeSourceRef[];
  applicability: KnowledgeCandidate['applicability'];
  authoritySource: KnowledgeAuthoritySource;
  stability: KnowledgeCandidate['stability'];
  active?: boolean;
};

export type KnowledgeAdmissionDisposition =
  | 'admit'
  | 'merge'
  | 'supersede'
  | 'defer'
  | 'reject'
  | 'no-op';

export type KnowledgeAdmissionDecision = {
  candidateId: string;
  disposition: KnowledgeAdmissionDisposition;
  comparedRevision: string;
  matchedKnowledgeId: string | null;
  permittedUses: Array<'investigation' | 'review-warning' | 'mutation-authority' | 'durable-write-proposal'>;
  blockers: string[];
  reasons: string[];
  governedMutationCount: 0;
};

type ScannedSource = {
  relativePath: string;
  authority: ContextAuthority;
  content: string;
  candidates: ContextCandidate[];
};

const AUTHORITY_WEIGHT: Record<ContextAuthority, number> = {
  structural: 800,
  contract: 700,
  profile: 600,
  decision: 500,
  task: 400,
  status: 300,
  lesson: 200,
  evidence: 100,
};

const CANONICAL_SOURCE_SPECS: Array<{ relativePath: string; authority: ContextAuthority }> = [
  { relativePath: '.workflow-system/WORKFLOW_PROTOCOL.md', authority: 'structural' },
  { relativePath: '.workflow-system/FILE_SCHEMAS.md', authority: 'structural' },
  { relativePath: '.workflow-system/PROJECT_PROFILE.yaml', authority: 'profile' },
  { relativePath: 'docs/workflow/CONTRACTS.md', authority: 'contract' },
  { relativePath: 'docs/workflow/DECISIONS.md', authority: 'decision' },
  { relativePath: 'docs/workflow/CURRENT_TASK.md', authority: 'task' },
  { relativePath: 'docs/workflow/STATUS.md', authority: 'status' },
  { relativePath: 'docs/workflow/LESSONS.md', authority: 'lesson' },
  { relativePath: 'AGENTS.md', authority: 'contract' },
  { relativePath: 'CLAUDE.md', authority: 'contract' },
];

const REQUIRED_STRUCTURAL_SOURCES = new Set([
  '.workflow-system/WORKFLOW_PROTOCOL.md',
  '.workflow-system/FILE_SCHEMAS.md',
  '.workflow-system/PROJECT_PROFILE.yaml',
]);

const REQUIRED_TASK_HEADINGS = [
  '任务信息',
  '验收标准',
  '允许修改范围',
  '条件修改范围',
  '禁止修改范围',
  '受影响的契约',
  '已确认决策',
  '回滚点',
];

const REQUIRED_PROFILE_KEYS = new Set(['project', 'paths', 'boundaries', 'architecture_rules', 'validation']);

const OPTIONAL_ITEMS_PER_SOURCE: Record<ContextAuthority, number> = {
  structural: 4,
  contract: 0,
  profile: 0,
  decision: 0,
  task: 4,
  status: 3,
  lesson: 5,
  evidence: 10,
};

const STOP_TOKENS = new Set([
  'and',
  'the',
  'for',
  'from',
  'with',
  'into',
  'task',
  'current',
  'review',
  'change',
  'workflow',
  'system',
  'project',
  'context',
  'document',
  'docs',
  'script',
  'scripts',
  'file',
  'files',
  'path',
  'paths',
  'state',
  'none',
  'null',
  'true',
  'false',
]);

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizeText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\\/g, '/').replace(/\s+/g, ' ').trim();
}

function compactSummary(value: string, maxBytes = 1200): string {
  const normalized = value.replace(/\r/g, '').trim();
  if (Buffer.byteLength(normalized, 'utf8') <= maxBytes) {
    return normalized;
  }

  let result = '';
  for (const character of normalized) {
    if (Buffer.byteLength(`${result}${character}…`, 'utf8') > maxBytes) {
      break;
    }
    result += character;
  }
  return `${result.trimEnd()}…`;
}

function tokenize(value: string): Set<string> {
  const normalized = normalizeText(value);
  const tokens = new Set<string>();

  for (const match of normalized.matchAll(/[a-z0-9][a-z0-9_.:/-]{1,}/g)) {
    for (const token of match[0].split(/[/:._-]+/)) {
      if (token.length >= 2 && !STOP_TOKENS.has(token)) {
        tokens.add(token);
      }
    }
    if (!STOP_TOKENS.has(match[0])) {
      tokens.add(match[0]);
    }
  }

  for (const match of normalized.matchAll(/[\p{Script=Han}]{2,}/gu)) {
    const sequence = match[0];
    tokens.add(sequence);
    for (let index = 0; index < sequence.length - 1; index += 1) {
      tokens.add(sequence.slice(index, index + 2));
    }
  }

  return tokens;
}

function setIntersectionCount(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const item of left) {
    if (right.has(item)) {
      count += 1;
    }
  }
  return count;
}

function makeCandidateId(source: string, locator: string): string {
  return `ctx-${sha256(`${source}\0${locator}`).slice(0, 16)}`;
}

function normalizeLocator(source: string, locator: string): string {
  const normalizedSource = source.replace(/\\/g, '/');
  const normalizedLocator = locator.replace(/\\/g, '/').trim();
  if (!normalizedLocator || normalizedLocator.includes('..') || path.isAbsolute(normalizedLocator)) {
    throw new Error(`Unsafe context locator for ${normalizedSource}: ${locator}`);
  }
  return normalizedLocator.startsWith(normalizedSource)
    ? normalizedLocator
    : `${normalizedSource}#${normalizedLocator}`;
}

function deriveSemanticKey(content: string, heading: string): string | undefined {
  const stableId = /^`?((?:AD|DECISION|LESSON|CONTRACT|INV|TA|GR|MR|SUPERSEDED|DEFER)-[A-Z0-9-]+)\b/i
    .exec(heading.trim())?.[1];
  if (stableId) {
    return normalizeText(stableId);
  }

  const explicitKey = /^\s*-\s*(?:Fingerprint|语义键)[:：]\s*(.+?)\s*$/im.exec(
    content.split(/\r?\n/).slice(0, 8).join('\n'),
  )?.[1];
  return explicitKey ? normalizeText(explicitKey) : undefined;
}

function splitMarkdownSource(relativePath: string, authority: ContextAuthority, content: string): ContextCandidate[] {
  const lines = content.replace(/\r/g, '').split('\n');
  const headingIndexes: Array<{ index: number; heading: string }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(#{1,3})\s+(.+?)\s*$/.exec(lines[index]);
    if (match) {
      headingIndexes.push({ index, heading: match[2] });
    }
  }

  if (headingIndexes.length === 0) {
    return [{
      source: relativePath,
      locator: `${relativePath}:L1-L${Math.max(lines.length, 1)}`,
      authority,
      statement: content,
      freshness: 'current',
      sourceRevision: sha256(content),
    }];
  }

  return headingIndexes.map((current, position) => {
    const nextIndex = headingIndexes[position + 1]?.index ?? lines.length;
    const statement = lines.slice(current.index, nextIndex).join('\n').trim();
    const startLine = current.index + 1;
    const endLine = Math.max(nextIndex, startLine);
    return {
      source: relativePath,
      locator: `${relativePath}:L${startLine}-L${endLine} (${current.heading})`,
      authority,
      statement,
      tags: [current.heading],
      semanticKey: deriveSemanticKey(statement, current.heading),
      freshness: 'current',
      sourceRevision: sha256(content),
    };
  });
}

function splitProfileSource(relativePath: string, content: string): ContextCandidate[] {
  const lines = content.replace(/\r/g, '').split('\n');
  const indexes: Array<{ index: number; key: string }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^([a-zA-Z][a-zA-Z0-9_-]*):(?:\s|$)/.exec(lines[index]);
    if (match) {
      indexes.push({ index, key: match[1] });
    }
  }

  return indexes.map((current, position) => {
    const nextIndex = indexes[position + 1]?.index ?? lines.length;
    const statement = lines.slice(current.index, nextIndex).join('\n').trim();
    return {
      source: relativePath,
      locator: `${relativePath}:L${current.index + 1}-L${Math.max(nextIndex, current.index + 1)} (${current.key})`,
      authority: 'profile',
      statement,
      tags: [current.key],
      semanticKey: `profile:${normalizeText(current.key)}`,
      freshness: 'current',
      sourceRevision: sha256(content),
    };
  });
}

function scanCanonicalSources(root: string): { sources: ScannedSource[]; missing: string[] } {
  const sources: ScannedSource[] = [];
  const missing: string[] = [];

  for (const spec of CANONICAL_SOURCE_SPECS) {
    const absolutePath = path.join(root, ...spec.relativePath.split('/'));
    if (!fs.existsSync(absolutePath)) {
      if (REQUIRED_STRUCTURAL_SOURCES.has(spec.relativePath)) {
        missing.push(`missing-canonical-source:${spec.relativePath}`);
      }
      continue;
    }

    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) {
      missing.push(`canonical-source-not-file:${spec.relativePath}`);
      continue;
    }

    const content = fs.readFileSync(absolutePath, 'utf8');
    const candidates = spec.relativePath.endsWith('.yaml')
      ? splitProfileSource(spec.relativePath, content)
      : splitMarkdownSource(spec.relativePath, spec.authority, content);
    sources.push({ relativePath: spec.relativePath, authority: spec.authority, content, candidates });
  }

  return { sources, missing };
}

function requestHasAnyTrigger(request: ProjectContextRequest, triggers: string[]): boolean {
  const haystack = normalizeText([
    ...request.changedSurfaces,
    ...request.riskTriggers,
    ...request.scopePathsAndSymbols,
  ].join('\n'));
  return triggers.some(trigger => haystack.includes(normalizeText(trigger)));
}

function scanAuxiliaryCandidates(root: string, request: ProjectContextRequest): ContextCandidate[] {
  const candidates: ContextCandidate[] = [];
  const installStateRelativePath = '.workflow-system/install-state.json';
  const installStatePath = path.join(root, '.workflow-system', 'install-state.json');
  const installTriggered = requestHasAnyTrigger(request, ['install', 'installation', 'migration', 'host-sync']);
  if (fs.existsSync(installStatePath) && fs.statSync(installStatePath).isFile()) {
    const content = fs.readFileSync(installStatePath, 'utf8');
    candidates.push({
      source: installStateRelativePath,
      locator: `${installStateRelativePath}:L1 (installation metadata)`,
      authority: 'evidence',
      statement: content,
      tags: ['installation', 'state-schema', 'managed-files'],
      freshness: 'current',
      required: installTriggered,
      sourceRevision: sha256(content),
    });
  }

  const lifecycleTriggered = request.intent === 'lifecycle'
    || requestHasAnyTrigger(request, ['lifecycle', 'paused', 'interrupted', 'resume', 'recovery']);
  const taskArtifactSpecs: Array<{ directory: string; include: boolean }> = [
    { directory: 'TASKS/paused', include: lifecycleTriggered },
    { directory: 'TASKS/interrupted', include: lifecycleTriggered },
    { directory: 'TASKS/inbox', include: request.intent === 'capture' },
    { directory: 'TASKS', include: request.intent === 'close' },
  ];
  for (const spec of taskArtifactSpecs) {
    if (!spec.include) {
      continue;
    }
    const directoryPath = path.join(root, ...spec.directory.split('/'));
    if (!fs.existsSync(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
      continue;
    }
    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) {
        continue;
      }
      if (spec.directory === 'TASKS' && !/^TASK-[0-9]+-/.test(entry.name)) {
        continue;
      }
      const relativePath = `${spec.directory}/${entry.name}`;
      const content = fs.readFileSync(path.join(directoryPath, entry.name), 'utf8');
      const matchesTask = request.taskIdentity ? entry.name.includes(`TASK-${request.taskIdentity}-`) : false;
      candidates.push({
        source: relativePath,
        locator: `${relativePath}:L1 (task recovery artifact)`,
        authority: 'evidence',
        statement: content,
        tags: [spec.directory, request.taskIdentity ?? 'no-current-task'],
        freshness: 'current',
        required: matchesTask,
        sourceRevision: sha256(content),
      });
    }
  }
  return candidates;
}

function requestSearchGroups(request: ProjectContextRequest): Array<{ label: string; weight: number; values: string[] }> {
  return [
    { label: 'scope-match', weight: 30, values: request.scopePathsAndSymbols },
    { label: 'surface-match', weight: 24, values: request.changedSurfaces },
    { label: 'risk-trigger-match', weight: 20, values: request.riskTriggers },
    { label: 'goal-or-claim-match', weight: 14, values: request.goalAndClaims },
  ];
}

function scoreCandidate(
  request: ProjectContextRequest,
  candidate: ContextCandidate,
): { score: number; reasons: string[] } {
  const haystack = normalizeText(`${candidate.locator}\n${candidate.tags?.join('\n') ?? ''}\n${candidate.semanticKey ?? ''}\n${candidate.statement}`);
  const haystackTokens = tokenize(haystack);
  let score = 0;
  const reasons: string[] = [];

  for (const group of requestSearchGroups(request)) {
    let groupScore = 0;
    for (const rawValue of group.values) {
      const value = normalizeText(rawValue);
      if (!value) {
        continue;
      }
      if (value.length >= 3 && haystack.includes(value)) {
        groupScore = Math.max(groupScore, group.weight);
        continue;
      }
      const queryTokens = tokenize(value);
      const matchedTokens = [...queryTokens].filter(token => haystackTokens.has(token));
      const hasDistinctiveSingleMatch = matchedTokens.some(token => token.length >= 8);
      const overlap = matchedTokens.length;
      if (overlap >= 2 || hasDistinctiveSingleMatch) {
        groupScore = Math.max(groupScore, Math.min(group.weight, overlap * 3));
      }
    }
    if (groupScore > 0) {
      score += groupScore;
      reasons.push(group.label);
    }
  }

  if (candidate.required) {
    score += 1000;
    reasons.push('caller-required');
  }

  return { score, reasons: [...new Set(reasons)] };
}

function headingMatches(candidate: ContextCandidate, names: string[]): boolean {
  const headingText = normalizeText(candidate.tags?.join('\n') ?? '');
  return names.some(name => headingText.includes(normalizeText(name)));
}

function markPolicyRequired(
  request: ProjectContextRequest,
  candidates: ContextCandidate[],
  scored: Map<ContextCandidate, { score: number; reasons: string[] }>,
): Set<ContextCandidate> {
  const required = new Set<ContextCandidate>(candidates.filter(candidate => candidate.required));

  for (const structuralPath of [
    '.workflow-system/WORKFLOW_PROTOCOL.md',
    '.workflow-system/FILE_SCHEMAS.md',
  ]) {
    const sourceCandidates = candidates.filter(candidate => candidate.source === structuralPath);
    const selected = [...sourceCandidates].sort((left, right) =>
      (scored.get(right)?.score ?? 0) - (scored.get(left)?.score ?? 0))[0];
    if (selected) {
      required.add(selected);
      scored.get(selected)?.reasons.push('structural-authority');
    }
  }

  for (const candidate of candidates.filter(item => item.source === '.workflow-system/PROJECT_PROFILE.yaml')) {
    if ([...REQUIRED_PROFILE_KEYS].some(key => headingMatches(candidate, [key]))) {
      required.add(candidate);
      scored.get(candidate)?.reasons.push('project-profile-authority');
    }
  }

  if (request.taskIdentity) {
    for (const candidate of candidates.filter(item => item.source === 'docs/workflow/CURRENT_TASK.md')) {
      if (headingMatches(candidate, REQUIRED_TASK_HEADINGS)) {
        required.add(candidate);
        scored.get(candidate)?.reasons.push('active-task-authority');
      }
    }
  }

  for (const candidate of candidates) {
    const score = scored.get(candidate)?.score ?? 0;
    if (score > 0 && (candidate.authority === 'contract' || candidate.authority === 'decision')) {
      required.add(candidate);
      scored.get(candidate)?.reasons.push('relevant-project-authority');
    }
  }

  const selectedSemanticKeys = new Set(
    candidates
      .filter(candidate => required.has(candidate) || (scored.get(candidate)?.score ?? 0) > 0)
      .map(candidate => candidate.semanticKey ? normalizeText(candidate.semanticKey) : null)
      .filter((key): key is string => Boolean(key)),
  );
  for (const key of selectedSemanticKeys) {
    const peers = candidates.filter(candidate =>
      candidate.semanticKey && normalizeText(candidate.semanticKey) === key);
    if (peers.length <= 1) {
      continue;
    }
    for (const candidate of peers) {
      required.add(candidate);
      scored.get(candidate)?.reasons.push('semantic-conflict-peer');
    }
  }

  return required;
}

function resolveConflicts(items: ResolvedContextItem[]): ContextConflict[] {
  const byKey = new Map<string, ResolvedContextItem[]>();
  for (const item of items) {
    if (!item.semanticKey) {
      continue;
    }
    const group = byKey.get(item.semanticKey) ?? [];
    group.push(item);
    byKey.set(item.semanticKey, group);
  }

  const conflicts: ContextConflict[] = [];
  for (const [semanticKey, group] of byKey) {
    const distinctStatements = new Set(group.map(item => item.semanticRevision));
    if (distinctStatements.size <= 1) {
      continue;
    }

    const sorted = [...group].sort((left, right) => AUTHORITY_WEIGHT[right.authority] - AUTHORITY_WEIGHT[left.authority]);
    const topWeight = AUTHORITY_WEIGHT[sorted[0].authority];
    const topItems = sorted.filter(item => AUTHORITY_WEIGHT[item.authority] === topWeight);
    const unresolved = new Set(topItems.map(item => item.semanticRevision)).size > 1;
    conflicts.push({
      semanticKey,
      itemLocators: sorted.map(item => item.locator),
      winningLocator: unresolved ? null : sorted[0].locator,
      resolution: unresolved ? 'unresolved-same-authority' : 'authority-precedence',
      reason: unresolved
        ? `Conflicting ${sorted[0].authority} items have equal authority.`
        : `${sorted[0].authority} outranks ${sorted.slice(1).map(item => item.authority).join(', ')}; lower authority cannot authorize a conflicting action.`,
    });
  }
  return conflicts;
}

function toResolvedItem(
  candidate: ContextCandidate,
  score: { score: number; reasons: string[] },
): ResolvedContextItem {
  const locator = normalizeLocator(candidate.source, candidate.locator);
  return {
    id: candidate.id ?? makeCandidateId(candidate.source, locator),
    source: candidate.source.replace(/\\/g, '/'),
    locator,
    authority: candidate.authority,
    summary: compactSummary(candidate.summary ?? candidate.statement),
    freshness: candidate.freshness ?? 'unknown',
    relevanceReasons: [...new Set(score.reasons)],
    score: score.score,
    semanticKey: candidate.semanticKey ? normalizeText(candidate.semanticKey) : null,
    semanticRevision: sha256(normalizeText(candidate.statement)),
    sourceRevision: candidate.sourceRevision ?? sha256(candidate.statement),
  };
}

function compareResolvedItems(left: ResolvedContextItem, right: ResolvedContextItem): number {
  return right.score - left.score
    || AUTHORITY_WEIGHT[right.authority] - AUTHORITY_WEIGHT[left.authority]
    || left.locator.localeCompare(right.locator);
}

function validateContextRequest(request: ProjectContextRequest): string[] {
  const failures: string[] = [];
  if (!request.requestId.trim()) {
    failures.push('missing-request-id');
  }
  if (!path.isAbsolute(request.targetRootIdentity.absoluteRoot)) {
    failures.push('target-root-not-absolute');
  }
  if (request.targetRootIdentity.relationship === 'unknown') {
    failures.push('target-root-relationship-unknown');
  }
  if (request.targetRootIdentity.relationship === 'shared-git-conflict') {
    failures.push('target-root-shared-git-conflict');
  }
  if ((request.intent === 'review' || request.intent === 'validate') && !request.diffTarget?.trim()) {
    failures.push('missing-explicit-diff-target');
  }
  if (!Number.isInteger(request.contextBudget.maxItems) || request.contextBudget.maxItems <= 0) {
    failures.push('invalid-context-budget-max-items');
  }
  if (!Number.isInteger(request.contextBudget.maxSummaryBytes) || request.contextBudget.maxSummaryBytes <= 0) {
    failures.push('invalid-context-budget-max-summary-bytes');
  }
  return failures;
}

export function buildTargetRootIdentity(
  root: string,
  relationship: TargetRootRelationship,
): TargetRootIdentity {
  return {
    absoluteRoot: normalizeAbsoluteRootPath(root),
    gitAnchor: findGitRoot(root),
    relationship,
  };
}

export function resolveProjectContextFromCandidates(
  request: ProjectContextRequest,
  candidates: ContextCandidate[],
  options: { sourceRevision?: string; missingRequiredContext?: string[] } = {},
): ContextBundle {
  const missingRequiredContext = [
    ...validateContextRequest(request),
    ...(options.missingRequiredContext ?? []),
  ];
  for (const candidate of candidates) {
    if (candidate.required && candidate.active === false) {
      missingRequiredContext.push(`required-context-inactive:${candidate.source}#${candidate.locator}`);
    }
  }
  const activeCandidates = candidates.filter(candidate => candidate.active !== false);
  const scored = new Map<ContextCandidate, { score: number; reasons: string[] }>();

  for (const candidate of activeCandidates) {
    try {
      normalizeLocator(candidate.source, candidate.locator);
    } catch (error) {
      missingRequiredContext.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    scored.set(candidate, scoreCandidate(request, candidate));
  }

  const safeCandidates = activeCandidates.filter(candidate => scored.has(candidate));
  const requiredSet = markPolicyRequired(request, safeCandidates, scored);
  const required = safeCandidates
    .filter(candidate => requiredSet.has(candidate))
    .map(candidate => toResolvedItem(candidate, scored.get(candidate)!))
    .sort(compareResolvedItems);
  for (const item of required) {
    if (item.freshness !== 'current') {
      missingRequiredContext.push(`required-context-${item.freshness}:${item.locator}`);
    }
  }

  const rankedOptionalPool = safeCandidates
    .filter(candidate => !requiredSet.has(candidate) && (scored.get(candidate)?.score ?? 0) > 0)
    .map(candidate => toResolvedItem(candidate, scored.get(candidate)!))
    .sort(compareResolvedItems);
  const optionalSourceCounts = new Map<string, number>();
  const optionalPool = rankedOptionalPool.filter(item => {
    const sourceKey = `${item.authority}:${item.source}`;
    const count = optionalSourceCounts.get(sourceKey) ?? 0;
    const limit = OPTIONAL_ITEMS_PER_SOURCE[item.authority];
    if (count >= limit) {
      return false;
    }
    optionalSourceCounts.set(sourceKey, count + 1);
    return true;
  });

  const requiredBytes = required.reduce((sum, item) => sum + Buffer.byteLength(item.summary, 'utf8'), 0);
  const requiredExceedsBudget = required.length > request.contextBudget.maxItems
    || requiredBytes > request.contextBudget.maxSummaryBytes;
  const optional: ResolvedContextItem[] = [];
  const excludedReasons: string[] = [];
  if (rankedOptionalPool.length > optionalPool.length) {
    excludedReasons.push(`per-source-relevance-cap:${rankedOptionalPool.length - optionalPool.length}`);
  }

  if (!requiredExceedsBudget) {
    let itemCount = required.length;
    let byteCount = requiredBytes;
    for (const item of optionalPool) {
      const itemBytes = Buffer.byteLength(item.summary, 'utf8');
      if (itemCount + 1 > request.contextBudget.maxItems || byteCount + itemBytes > request.contextBudget.maxSummaryBytes) {
        excludedReasons.push(`budget:${item.locator}`);
        continue;
      }
      optional.push(item);
      itemCount += 1;
      byteCount += itemBytes;
    }
  } else {
    excludedReasons.push('required-context-preserved-despite-budget');
  }

  const irrelevantCount = safeCandidates.length - required.length - rankedOptionalPool.length;
  if (irrelevantCount > 0) {
    excludedReasons.push(`irrelevant:${irrelevantCount}`);
  }

  const conflicts = resolveConflicts([...required, ...optional]);
  for (const conflict of conflicts) {
    if (conflict.resolution === 'unresolved-same-authority') {
      missingRequiredContext.push(`unresolved-authority-conflict:${conflict.semanticKey}`);
    }
  }

  const sourceRevision = options.sourceRevision
    ?? sha256(safeCandidates
      .map(candidate => `${candidate.source}:${candidate.sourceRevision ?? sha256(candidate.statement)}`)
      .sort()
      .join('\n'));
  const contextId = `context-${sha256(JSON.stringify({
    requestId: request.requestId,
    sourceRevision,
    required: required.map(item => item.id),
    optional: optional.map(item => item.id),
    conflicts,
  })).slice(0, 20)}`;

  return {
    schemaVersion: PROJECT_CONTEXT_SCHEMA_VERSION,
    contextId,
    requestId: request.requestId,
    sourceRevision,
    targetRootIdentity: request.targetRootIdentity,
    required,
    optional,
    conflicts,
    missingRequiredContext: [...new Set(missingRequiredContext)],
    excludedSummary: {
      count: irrelevantCount + rankedOptionalPool.length - optional.length,
      reasons: [...new Set(excludedReasons)],
    },
    budgetResult: requiredExceedsBudget ? 'required-context-exceeds-budget' : 'within-budget',
  };
}

export function resolveProjectContext(root: string, request: ProjectContextRequest): ContextBundle {
  const normalizedRoot = normalizeAbsoluteRootPath(root);
  const actualGitAnchor = findGitRoot(root);
  const rootFailures: string[] = [];

  if (normalizedRoot !== normalizeAbsoluteRootPath(request.targetRootIdentity.absoluteRoot)) {
    rootFailures.push('target-root-identity-mismatch');
  }
  if (actualGitAnchor !== request.targetRootIdentity.gitAnchor) {
    rootFailures.push('target-git-anchor-mismatch');
  }

  const { sources, missing } = scanCanonicalSources(root);
  if (request.taskIdentity && !sources.some(source => source.relativePath === 'docs/workflow/CURRENT_TASK.md')) {
    missing.push('missing-canonical-source:docs/workflow/CURRENT_TASK.md');
  }
  if (request.taskIdentity) {
    const taskCandidates = sources.find(source => source.relativePath === 'docs/workflow/CURRENT_TASK.md')?.candidates ?? [];
    for (const heading of REQUIRED_TASK_HEADINGS) {
      if (!taskCandidates.some(candidate => headingMatches(candidate, [heading]))) {
        missing.push(`missing-current-task-section:${heading}`);
      }
    }
  }
  const profileCandidates = sources.find(source => source.relativePath === '.workflow-system/PROJECT_PROFILE.yaml')?.candidates ?? [];
  for (const key of REQUIRED_PROFILE_KEYS) {
    if (!profileCandidates.some(candidate => headingMatches(candidate, [key]))) {
      missing.push(`missing-project-profile-key:${key}`);
    }
  }

  const auxiliaryCandidates = scanAuxiliaryCandidates(root, request);
  const sourceRevision = sha256([
    ...sources.map(source => `${source.relativePath}\0${sha256(source.content)}`),
    ...auxiliaryCandidates.map(candidate => `${candidate.source}\0${candidate.sourceRevision ?? sha256(candidate.statement)}`),
  ].sort().join('\n'));
  return resolveProjectContextFromCandidates(
    request,
    [...sources.flatMap(source => source.candidates), ...auxiliaryCandidates],
    { sourceRevision, missingRequiredContext: [...rootFailures, ...missing] },
  );
}

function comparableKnowledgeRevision(candidate: KnowledgeCandidate, existing: ExistingKnowledgeItem[]): string {
  return sha256(JSON.stringify({
    candidate: {
      id: candidate.candidateId,
      fingerprint: candidate.fingerprint,
      statement: normalizeText(candidate.statement),
      sourceRefs: candidate.sourceRefs,
    },
    existing: existing
      .filter(item => item.active !== false)
      .map(item => ({ id: item.id, fingerprint: item.fingerprint, statement: normalizeText(item.statement) }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  }));
}

function sameApplicability(
  left: KnowledgeCandidate['applicability'],
  right: KnowledgeCandidate['applicability'],
): boolean {
  const normalize = (values: string[]) => [...new Set(values.map(normalizeText))].sort();
  return JSON.stringify({
    projectTypes: normalize(left.projectTypes),
    pathsSymbolsOrSurfaces: normalize(left.pathsSymbolsOrSurfaces),
    triggerConditions: normalize(left.triggerConditions),
  }) === JSON.stringify({
    projectTypes: normalize(right.projectTypes),
    pathsSymbolsOrSurfaces: normalize(right.pathsSymbolsOrSurfaces),
    triggerConditions: normalize(right.triggerConditions),
  });
}

function semanticSimilarity(left: string, right: string): number {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return normalizeText(left) === normalizeText(right) ? 1 : 0;
  }
  const intersection = setIntersectionCount(leftTokens, rightTokens);
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return intersection / union;
}

export function fingerprintKnowledgeStatement(
  kind: KnowledgeKind,
  statement: string,
  applicability: KnowledgeCandidate['applicability'],
): string {
  return `knowledge-${sha256(JSON.stringify({ kind, statement: normalizeText(statement), applicability })).slice(0, 24)}`;
}

export function classifyKnowledgeCandidate(
  candidate: KnowledgeCandidate,
  existing: ExistingKnowledgeItem[],
): KnowledgeAdmissionDecision {
  const activeExisting = existing.filter(item => item.active !== false && item.kind === candidate.kind);
  const exact = activeExisting.find(item => item.fingerprint === candidate.fingerprint);
  const overlapping = exact ?? activeExisting.find(item =>
    sameApplicability(candidate.applicability, item.applicability)
      && semanticSimilarity(candidate.statement, item.statement) >= 0.8);
  const comparedRevision = comparableKnowledgeRevision(candidate, existing);
  const result = (
    disposition: KnowledgeAdmissionDisposition,
    reasons: string[],
    blockers: string[] = [],
    matchedKnowledgeId: string | null = overlapping?.id ?? null,
    durable = false,
  ): KnowledgeAdmissionDecision => ({
    candidateId: candidate.candidateId,
    disposition,
    comparedRevision,
    matchedKnowledgeId,
    permittedUses: durable
      ? ['investigation', 'review-warning', 'durable-write-proposal']
      : ['investigation', 'review-warning'],
    blockers,
    reasons,
    governedMutationCount: 0,
  });

  if (!candidate.candidateId.trim() || !candidate.fingerprint.trim() || !candidate.statement.trim()) {
    return result('reject', ['Candidate identity, fingerprint, and statement are mandatory.'], ['invalid-candidate-schema']);
  }
  if (candidate.sourceRefs.length === 0 || candidate.sourceRefs.some(ref => !ref.locator.trim() || !ref.revision.trim())) {
    return result('reject', ['Durable knowledge requires exact source locators and revisions.'], ['missing-source-provenance']);
  }

  if (candidate.conflictSet.length > 0) {
    return result('defer', ['Unresolved knowledge conflicts must remain visible.'], ['unresolved-knowledge-conflict']);
  }
  if (exact && normalizeText(exact.statement) === normalizeText(candidate.statement)
    && sameApplicability(candidate.applicability, exact.applicability)) {
    return result('no-op', ['Equivalent knowledge already exists; no durable proposal is required.'], [], exact.id);
  }
  if (candidate.stability !== 'stable') {
    return result('defer', ['Provisional or exploratory observations are not durable project knowledge.'], ['knowledge-not-stable']);
  }
  if (candidate.authoritySource === 'none') {
    return result('reject', ['A model observation without authority cannot become durable knowledge.'], ['knowledge-authority-missing']);
  }
  if (candidate.expectedConsumers.length === 0
    || (candidate.applicability.pathsSymbolsOrSurfaces.length === 0
      && candidate.applicability.triggerConditions.length === 0
      && candidate.applicability.projectTypes.length === 0)) {
    return result('reject', ['Durable knowledge needs applicability tags and expected consumers.'], ['knowledge-retrieval-scope-missing']);
  }

  if (candidate.kind === 'contract') {
    if (candidate.evidenceRefs.length === 0) {
      return result('defer', ['A Contract requires verified stable boundary evidence.'], ['contract-evidence-missing']);
    }
  } else if (candidate.kind === 'decision') {
    if (!['user', 'accepted-decision'].includes(candidate.authoritySource)) {
      return result('defer', ['A Decision requires explicit user or already-accepted decision authority.'], ['decision-authority-insufficient']);
    }
    if (!candidate.decisionContext
      || candidate.decisionContext.alternatives.length === 0
      || candidate.decisionContext.constraints.length === 0) {
      return result('defer', ['A Decision requires alternatives and constraints, not only a recommendation.'], ['decision-context-incomplete']);
    }
  } else {
    if (candidate.applicability.triggerConditions.length === 0) {
      return result('reject', ['A Lesson requires a reusable trigger.'], ['lesson-trigger-missing']);
    }
    const minimumEvidence = overlapping ? 1 : 2;
    if (candidate.evidenceRefs.length < minimumEvidence && candidate.systemicSeverity !== 'high') {
      return result('defer', ['A one-off ordinary workaround is not yet a reusable Lesson.'], ['lesson-recurrence-not-proven']);
    }
  }

  if (candidate.supersedes) {
    const superseded = activeExisting.find(item => item.id === candidate.supersedes);
    if (!superseded) {
      return result('reject', ['The declared superseded item does not exist or is inactive.'], ['supersedes-target-missing'], null);
    }
    if (overlapping && overlapping.id !== superseded.id) {
      return result('defer', ['The semantic overlap and declared supersession target disagree.'], ['supersession-target-conflict'], superseded.id);
    }
    return result('supersede', ['Kind-specific authority and evidence gates passed; preserve history with an explicit successor.'], [], superseded.id, true);
  }
  if (overlapping) {
    return result('merge', ['Kind-specific authority and evidence gates passed; merge provenance into the existing semantic item.'], [], overlapping.id, true);
  }

  const admissionReason = candidate.kind === 'contract'
    ? 'Stable boundary evidence and retrieval scope satisfy Contract admission.'
    : candidate.kind === 'decision'
      ? 'Explicit authority, alternatives, constraints, and provenance satisfy Decision admission.'
      : 'Reusable trigger, evidence, provenance, and consumers satisfy Lesson admission.';
  return result('admit', [admissionReason], [], null, true);
}
