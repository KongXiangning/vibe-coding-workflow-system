#!/usr/bin/env bun

import * as crypto from 'crypto';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildTargetRootIdentity,
  classifyKnowledgeCandidate,
  resolveProjectContext,
  type ContextBudget,
  type ContextBundle,
  type ExistingKnowledgeItem,
  type KnowledgeAdmissionDecision,
  type KnowledgeCandidate,
  type ProjectContextRequest,
  type TargetRootIdentity,
} from './project-context-resolver';
import { normalizeAbsoluteRootPath } from './guard-target-root';
import { repoPatternMatchesPath } from './repo-path-patterns';
import {
  classifyTaskIdentityFromCurrentTask,
  extractCurrentTaskStateFromCurrentTask,
  validateCurrentTaskResumeGate,
  validateCurrentTaskStatusTuple,
} from './task-identity';
import { validateSuspendedTaskPackage } from './workflow-doc-contracts';

export const REVIEW_SHADOW_SCHEMA_VERSION = 1 as const;
export const REVIEW_CONVERGENCE_LIMITS = {
  attemptsPerFingerprint: 2,
  repairRoundsPerCycle: 3,
  verificationNewFindingWaves: 1,
} as const;

export type ReviewShadowMode = 'default' | 'report-only';
export type ReviewCyclePhase = 'discovery' | 'verification';
export type ReviewVerdict =
  | 'clean'
  | 'findings'
  | 'needs-evidence'
  | 'needs-debug'
  | 'needs-user'
  | 'blocked';

export type ReviewDiffTarget = {
  kind: 'working-tree' | 'staged' | 'range' | 'commit' | 'patch';
  description: string;
  base: string;
  head: string | null;
  fingerprint: string;
};

export type ReviewScope = {
  allowed: string[];
  conditional: string[];
  forbidden: string[];
  conditionalAuthorizations: string[];
};

export type ReviewEvidenceKind =
  | 'test'
  | 'inspection'
  | 'contract'
  | 'external-doc'
  | 'design'
  | 'release'
  | 'lifecycle'
  | 'approval'
  | 'reproduction';

export type ReviewEvidence = {
  id: string;
  kind: ReviewEvidenceKind;
  claimIds: string[];
  status: 'passed' | 'failed' | 'not-run' | 'missing';
  locator: string;
  persistent: boolean;
  ownerSource:
    | 'acceptance'
    | 'contract'
    | 'reproduced-bug'
    | 'hard-invariant'
    | 'concrete-regression-risk'
    | 'none';
};

export type ReviewObservation = {
  id: string;
  category: string;
  severity: 'blocker' | 'major' | 'minor';
  location: string;
  scopePath: string;
  failureScenario: string;
  violatedInvariant: string;
  ownerSource: ReviewEvidence['ownerSource'];
  evidenceRefs: string[];
  speculative: boolean;
  mechanical: boolean;
  rootCause: 'confirmed' | 'unknown' | 'not-applicable';
  resolutionOwner: 'model-mechanical' | 'debug' | 'user';
};

export type ReviewConvergenceState = {
  repairRounds: number;
  verificationNewFindingWaves: number;
  attemptsByFingerprint: Record<string, number>;
  knownFingerprints: string[];
};

export type LegacyReviewResult = {
  diffTargetFingerprint: string;
  verdictClass: ReviewVerdict;
  scopeOutcome: 'pass' | 'fail';
  ownerRoute: 'none' | 'repair' | 'debug' | 'user';
  terminalBehavior: 'continue' | 'report-only';
  governedMutationCount: number;
  evidenceOutcome: 'sufficient' | 'insufficient' | 'failed';
  wording?: string;
  metrics?: Record<string, number>;
};

export type ReviewShadowRequest = {
  schemaVersion: typeof REVIEW_SHADOW_SCHEMA_VERSION;
  requestId: string;
  mode: ReviewShadowMode;
  reviewCyclePhase: ReviewCyclePhase;
  targetRootIdentity: TargetRootIdentity;
  taskIdentity: string | null;
  lifecycleTuple: string | null;
  diffTarget: ReviewDiffTarget;
  goalAndClaims: string[];
  scope: ReviewScope;
  changedPaths: string[];
  changedSymbols: string[];
  changedSurfaces: string[];
  riskTriggers: string[];
  evidence: ReviewEvidence[];
  observations: ReviewObservation[];
  convergence: ReviewConvergenceState;
  contextBudget: ContextBudget;
  declaredEphemeralPaths: string[];
  knowledgeCandidates?: KnowledgeCandidate[];
  existingKnowledge?: ExistingKnowledgeItem[];
  legacyResult?: LegacyReviewResult;
};

export type ReviewDimensionId =
  | 'diff-target'
  | 'scope'
  | 'goal-and-acceptance'
  | 'correctness-risk'
  | 'evidence'
  | 'contract-and-propagation'
  | 'lifecycle'
  | 'design-and-visual'
  | 'release'
  | 'external-documentation'
  | 'host-and-generated'
  | 'destructive-operation';

export type ReviewValidationRequest = {
  requestId: string;
  reviewRequestId: string;
  reviewCyclePhase: ReviewCyclePhase;
  dimension: ReviewDimensionId;
  requiredEvidenceKind: ReviewEvidenceKind;
  claimIds: string[];
  diffTargetFingerprint: string;
  contextSourceRevision: string;
  context: {
    taskIdentity: string | null;
    lifecycleTuple: string | null;
    diffTarget: string;
    goalAndClaims: string[];
    scopePathsAndSymbols: string[];
    changedSurfaces: string[];
    riskTriggers: string[];
    contextBudget: ContextBudget;
  };
  reason: string;
};

type ConditionalReviewDimensionId =
  | 'contract-and-propagation'
  | 'lifecycle'
  | 'design-and-visual'
  | 'release'
  | 'external-documentation'
  | 'host-and-generated'
  | 'destructive-operation';

export type ReviewDimension = {
  id: ReviewDimensionId;
  mandatory: boolean;
  triggeredBy: string[];
  status: 'pass' | 'finding' | 'needs-evidence' | 'blocked';
  evidenceRefs: string[];
  reasons: string[];
};

export type FindingClassification = {
  observationId: string;
  fingerprint: string;
  admitted: boolean;
  reasons: string[];
  attempts: number;
  budgetState: 'available' | 'exhausted' | 'verification-wave-exhausted';
  ownerRoute: 'none' | 'repair' | 'debug' | 'user';
};

export type InstallStateDiagnostic = {
  path: string;
  status:
    | 'not-installed'
    | 'metadata-missing'
    | 'readable-v1'
    | 'partial-v1'
    | 'malformed'
    | 'unsupported-version';
  stateVersion: number | null;
  workflowSystemVersion: string | null;
  migrationDisposition: 'not-applicable' | 'inventory-required' | 'in-place-plan-required' | 'blocked';
  legacyRuntimeAuthoritative: true;
  bootstrapOrAdoptRequired: false;
  blockers: string[];
};

export type LegacyFindingDiagnostic = {
  id: string;
  status: string;
  repairAttempts: number | 'legacy-attempts-unknown';
};

export type SuspendedPackageDiagnostic = {
  path: string;
  kind: 'paused' | 'interrupted';
  taskId: string | null;
  taskSlug: string | null;
  status: 'valid' | 'invalid';
  lifecycleState: string | null;
  errors: string[];
};

export type ProjectStateDiagnostic = {
  currentTask: {
    status: 'absent' | 'valid' | 'invalid';
    identityStatus: string | null;
    taskId: string | null;
    workflowStatus: string | null;
    lifecycleState: string | null;
    ownershipStatus: string | null;
    errors: string[];
  };
  findings: LegacyFindingDiagnostic[];
  suspendedPackages: SuspendedPackageDiagnostic[];
  taskAuthority: {
    sourceRevision: string | null;
    scope: Omit<ReviewScope, 'conditionalAuthorizations'> | null;
    acceptanceClaims: string[];
    diffTarget: string | null;
  };
  blockers: string[];
  autoSelectedSuspendedPackage: false;
};

export type LegacyShadowComparison = {
  hardMismatches: string[];
  softDifferences: string[];
  equivalent: boolean;
};

export type DiffTargetVerification = {
  status: 'verified' | 'harness-supplied' | 'mismatch' | 'unavailable';
  actualPaths: string[];
  actualFingerprint: string | null;
  reasons: string[];
};

export type ReviewShadowResult = {
  schemaVersion: typeof REVIEW_SHADOW_SCHEMA_VERSION;
  requestId: string;
  mode: ReviewShadowMode;
  shadowOnly: true;
  routeIsAdvisory: true;
  verdict: ReviewVerdict;
  terminalBehavior: 'continue' | 'report-only';
  diffTarget: ReviewDiffTarget;
  diffTargetVerification: DiffTargetVerification;
  contextBundle: ContextBundle;
  consumedContextLocators: string[];
  installState: InstallStateDiagnostic;
  projectState: ProjectStateDiagnostic;
  dimensions: ReviewDimension[];
  findings: FindingClassification[];
  knowledgeAdmission: KnowledgeAdmissionDecision[];
  validationRequests: ReviewValidationRequest[];
  recommendedRoute: 'none' | 'execute-step:repair' | 'debug-task:investigate' | 'ask-user';
  internalHandoffs: [];
  governedMutationCount: number;
  unexpectedWorkspaceDiffs: string[];
  declaredEphemeralEffects: string[];
  blockers: string[];
  comparison: LegacyShadowComparison | null;
};

type WorkspaceSnapshot = {
  digest: string;
  files: Map<string, string>;
};

export class ReviewShadowContractError extends Error {
  constructor(message: string) {
    super(`REVIEW_SHADOW_SCHEMA_INVALID: ${message}`);
    this.name = 'ReviewShadowContractError';
  }
}

const MANDATORY_DIMENSIONS: ReviewDimensionId[] = [
  'diff-target',
  'scope',
  'goal-and-acceptance',
  'correctness-risk',
  'evidence',
];

const CONDITIONAL_DIMENSION_TRIGGERS: Record<
  ConditionalReviewDimensionId,
  { terms: string[]; evidenceKind: ReviewEvidenceKind }
> = {
  'contract-and-propagation': {
    terms: ['api', 'dto', 'schema', 'contract', 'protocol', 'interface', 'ipc', 'event', 'compatibility'],
    evidenceKind: 'contract',
  },
  lifecycle: {
    terms: ['lifecycle', 'current_task', 'current-task', 'paused', 'interrupted', 'archive', 'resume', 'finding'],
    evidenceKind: 'lifecycle',
  },
  'design-and-visual': {
    terms: ['ui', 'ux', 'visual', 'layout', 'design-mode', 'screen', 'css'],
    evidenceKind: 'design',
  },
  release: {
    terms: ['release', 'deploy', 'production', 'canary', 'benchmark', 'publish'],
    evidenceKind: 'release',
  },
  'external-documentation': {
    terms: ['external-doc', 'third-party', 'library', 'framework', 'sdk', 'api-version', 'cli', 'cloud'],
    evidenceKind: 'external-doc',
  },
  'host-and-generated': {
    terms: ['host', 'generated', 'generator', 'registry', 'install', 'installation', 'sync', 'skill'],
    evidenceKind: 'inspection',
  },
  'destructive-operation': {
    terms: ['delete', 'destructive', 'migration', 'database', 'drop', 'overwrite', 'publish'],
    evidenceKind: 'approval',
  },
};

const STRONG_FINDING_OWNERS = new Set<ReviewEvidence['ownerSource']>([
  'acceptance',
  'contract',
  'reproduced-bug',
  'hard-invariant',
  'concrete-regression-risk',
]);

const SNAPSHOT_IGNORES = ['.git/**', 'node_modules/**'];
const EPHEMERAL_ROOTS = new Set(['.tmp', 'tmp', '.cache', 'coverage', 'target', '.next']);
const GOVERNED_EPHEMERAL_DENYLIST = [
  '.workflow-system/**',
  'docs/workflow/**',
  'TASKS/**',
  'AGENTS.md',
  'CLAUDE.md',
  '.codex/**',
  '.claude/**',
  'scripts/**',
  'test/**',
  'templates/**',
];

function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

function normalizeTerms(values: string[]): string {
  return values.join('\n').normalize('NFKC').toLowerCase().replace(/\\/g, '/');
}

function normalizeClaim(value: string): string {
  return normalizeTerms([value]).replace(/\s+/g, ' ').trim();
}

function extractStableClaimId(value: string): string | null {
  return /^([a-z][a-z0-9]*(?:[-_][a-z0-9]+)*\d+)(?=$|[^a-z0-9_-])/i.exec(normalizeClaim(value))?.[1] ?? null;
}

function canonicalClaimMatches(requested: string, canonical: string): boolean {
  const normalizedRequested = normalizeClaim(requested);
  const normalizedCanonical = normalizeClaim(canonical);
  if (normalizedRequested === normalizedCanonical) {
    return true;
  }
  const requestedId = extractStableClaimId(normalizedRequested);
  const canonicalId = extractStableClaimId(normalizedCanonical);
  return requestedId !== null && canonicalId !== null && requestedId === canonicalId;
}

function containsTrigger(haystack: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(haystack);
}

function patternMatches(file: string, pattern: string): boolean {
  const normalizedPattern = normalizeRelativePath(pattern);
  const normalizedFile = normalizeRelativePath(file);
  if (normalizedPattern.endsWith('/**') && normalizedFile === normalizedPattern.slice(0, -3)) {
    return true;
  }
  return repoPatternMatchesPath(normalizedFile, normalizedPattern)
    || (!normalizedPattern.includes('*')
      && (normalizedFile === normalizedPattern || normalizedFile.startsWith(`${normalizedPattern}/`)));
}

function matchesAny(file: string, patterns: string[]): boolean {
  return patterns.some(pattern => patternMatches(file, pattern));
}

function classifyScopePath(file: string, scope: ReviewScope): 'allowed' | 'conditional-unapproved' | 'forbidden' | 'unowned' {
  if (matchesAny(file, scope.forbidden)) {
    return 'forbidden';
  }
  if (matchesAny(file, scope.allowed)) {
    return 'allowed';
  }
  const conditionalPattern = scope.conditional.find(pattern => patternMatches(file, pattern));
  if (conditionalPattern) {
    const authorized = scope.conditionalAuthorizations.some(authorization =>
      authorization === conditionalPattern || patternMatches(file, authorization));
    return authorized ? 'allowed' : 'conditional-unapproved';
  }
  return 'unowned';
}

function buildCanonicalScope(projectState: ProjectStateDiagnostic, requestScope: ReviewScope): ReviewScope | null {
  const canonical = projectState.taskAuthority.scope;
  if (!canonical) {
    return null;
  }
  return {
    ...canonical,
    conditionalAuthorizations: requestScope.conditionalAuthorizations,
  };
}

function canonicalAuthorityBlockers(
  request: ReviewShadowRequest,
  projectState: ProjectStateDiagnostic,
): string[] {
  if (!request.taskIdentity || projectState.currentTask.status === 'absent') {
    return [];
  }
  const blockers: string[] = [];
  const actualLifecycleTuple = `${projectState.currentTask.workflowStatus}|${projectState.currentTask.lifecycleState}`;
  if (request.lifecycleTuple !== actualLifecycleTuple) {
    blockers.push(`lifecycle-tuple-mismatch:${request.lifecycleTuple ?? 'none'}!=${actualLifecycleTuple}`);
  }

  for (const claim of request.goalAndClaims) {
    if (!projectState.taskAuthority.acceptanceClaims.some(canonical => canonicalClaimMatches(claim, canonical))) {
      blockers.push(`claim-not-in-current-task:${claim}`);
    }
  }

  const canonicalDiffTarget = projectState.taskAuthority.diffTarget;
  if (!canonicalDiffTarget) {
    blockers.push('canonical-diff-target-missing');
  } else {
    const normalizedTarget = normalizeTerms([canonicalDiffTarget]);
    const kindMatches = request.diffTarget.kind === 'range'
      ? /range|\.\.|to-head|checkpoint|task-base/.test(normalizedTarget)
      : normalizedTarget.includes(request.diffTarget.kind);
    if (!kindMatches) {
      blockers.push(`diff-target-kind-mismatch:${request.diffTarget.kind}`);
    }
  }

  const canonicalScope = projectState.taskAuthority.scope;
  if (!canonicalScope || (canonicalScope.allowed.length === 0 && canonicalScope.conditional.length === 0)) {
    blockers.push('canonical-positive-scope-missing');
  }
  return blockers;
}

function parseLegacyFindings(content: string): LegacyFindingDiagnostic[] {
  const lines = content.replace(/\r/g, '').split('\n');
  const starts: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (/^-\s*Finding ID:\s*`?[^`\s]+`?\s*$/.test(lines[index])) {
      starts.push(index);
    }
  }

  return starts.map((start, position) => {
    const block = lines.slice(start, starts[position + 1] ?? lines.length).join('\n');
    const id = /^-\s*Finding ID:\s*`?([^`\s]+)`?\s*$/m.exec(block)?.[1] ?? `unknown-${start + 1}`;
    const status = /^\s*-\s*Status:\s*`?([^`\n]+?)`?\s*$/mi.exec(block)?.[1].trim() ?? 'unknown';
    const attemptsRaw = /^\s*-\s*(?:Repair attempts|修复尝试)[:：]\s*(\d+)\s*$/mi.exec(block)?.[1];
    return {
      id,
      status,
      repairAttempts: attemptsRaw ? Number(attemptsRaw) : 'legacy-attempts-unknown',
    };
  });
}

function extractMarkdownSection(content: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^##\\s+${escaped}\\s*$`, 'm').exec(content);
  if (!match || match.index === undefined) {
    return '';
  }
  const remainder = content.slice(match.index + match[0].length);
  const next = /^##\s+/m.exec(remainder);
  return remainder.slice(0, next?.index ?? remainder.length).trim();
}

function extractScopePatterns(section: string): string[] {
  const patterns: string[] = [];
  for (const line of section.replace(/\r/g, '').split('\n')) {
    if (!/^\s*-\s+/.test(line)) {
      continue;
    }
    const codeSpans = [...line.matchAll(/`([^`]+)`/g)].map(match => match[1].trim());
    if (codeSpans.length > 0) {
      patterns.push(...codeSpans);
      continue;
    }
    const plain = line.replace(/^\s*-\s+/, '').trim().split(/\s+[—–-]\s+|[：:]\s+/)[0]?.trim();
    if (plain && (/[*\/]/.test(plain) || /^[A-Za-z0-9_.-]+$/.test(plain))) {
      patterns.push(plain);
    }
  }
  return [...new Set(patterns.map(normalizeRelativePath))];
}

function extractTaskAuthority(content: string): ProjectStateDiagnostic['taskAuthority'] {
  const acceptanceSection = extractMarkdownSection(content, '验收标准');
  const acceptanceClaims = acceptanceSection
    .replace(/\r/g, '')
    .split('\n')
    .map(line => /^\s*-\s*\[[ xX]\]\s*(.+?)\s*$/.exec(line)?.[1]?.trim() ?? '')
    .filter(Boolean);
  const diffTarget = /^-\s*Current diff review target：\s*(.+?)\s*$/mi.exec(content)?.[1].trim() ?? null;
  return {
    sourceRevision: sha256(content),
    scope: {
      allowed: extractScopePatterns(extractMarkdownSection(content, '允许修改范围')),
      conditional: extractScopePatterns(extractMarkdownSection(content, '条件修改范围')),
      forbidden: extractScopePatterns(extractMarkdownSection(content, '禁止修改范围')),
    },
    acceptanceClaims,
    diffTarget,
  };
}

function inspectSuspendedPackages(root: string): SuspendedPackageDiagnostic[] {
  const packages: SuspendedPackageDiagnostic[] = [];
  for (const kind of ['paused', 'interrupted'] as const) {
    const directory = path.join(root, 'TASKS', kind);
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
      continue;
    }
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) {
        continue;
      }
      const relativePath = `TASKS/${kind}/${entry.name}`;
      try {
        const parsed = validateSuspendedTaskPackage(
          relativePath,
          fs.readFileSync(path.join(directory, entry.name), 'utf8'),
        );
        packages.push({
          path: relativePath,
          kind,
          taskId: parsed.taskId,
          taskSlug: parsed.taskSlug,
          status: 'valid',
          lifecycleState: parsed.lifecycleState,
          errors: [],
        });
      } catch (error) {
        packages.push({
          path: relativePath,
          kind,
          taskId: null,
          taskSlug: null,
          status: 'invalid',
          lifecycleState: null,
          errors: [error instanceof Error ? error.message : String(error)],
        });
      }
    }
  }
  return packages.sort((left, right) => left.path.localeCompare(right.path));
}

export function inspectProjectState(root: string, expectedTaskIdentity: string | null): ProjectStateDiagnostic {
  const currentTaskPath = path.join(root, 'docs', 'workflow', 'CURRENT_TASK.md');
  const blockers: string[] = [];
  const suspendedPackages = inspectSuspendedPackages(root);
  const duplicateSuspendedIdentities = new Map<string, string[]>();

  for (const artifact of suspendedPackages) {
    if (artifact.status === 'invalid') {
      blockers.push(`invalid-suspended-package:${artifact.path}`);
      continue;
    }
    const key = `${artifact.taskId}:${artifact.taskSlug}`;
    const paths = duplicateSuspendedIdentities.get(key) ?? [];
    paths.push(artifact.path);
    duplicateSuspendedIdentities.set(key, paths);
  }
  for (const [identity, paths] of duplicateSuspendedIdentities) {
    if (paths.length > 1) {
      blockers.push(`ambiguous-suspended-identity:${identity}:${paths.join(',')}`);
    }
  }

  if (!fs.existsSync(currentTaskPath)) {
    if (expectedTaskIdentity) {
      blockers.push('expected-current-task-missing');
    }
    return {
      currentTask: {
        status: 'absent',
        identityStatus: null,
        taskId: null,
        workflowStatus: null,
        lifecycleState: null,
        ownershipStatus: null,
        errors: [],
      },
      findings: [],
      suspendedPackages,
      taskAuthority: {
        sourceRevision: null,
        scope: null,
        acceptanceClaims: [],
        diffTarget: null,
      },
      blockers,
      autoSelectedSuspendedPackage: false,
    };
  }

  const content = fs.readFileSync(currentTaskPath, 'utf8');
  const identity = classifyTaskIdentityFromCurrentTask(content);
  const errors = [...identity.reasons.filter(() => identity.status === 'incomplete')];
  let state: ReturnType<typeof extractCurrentTaskStateFromCurrentTask> = {
    workflowStatus: null,
    lifecycleState: null,
    resumeRequiresReview: null,
    resumeReviewReasons: null,
  };
  let ownershipStatus: string | null = null;

  try {
    state = extractCurrentTaskStateFromCurrentTask(content);
    const exactResumeReasons = /^-\s*恢复审查原因：([^\r\n]*)$/m.exec(content)?.[1].trim() ?? '';
    state.resumeReviewReasons = exactResumeReasons || null;
    const tuple = validateCurrentTaskStatusTuple(state.workflowStatus, state.lifecycleState);
    ownershipStatus = tuple.ownershipStatus;
    if (state.resumeRequiresReview !== null) {
      validateCurrentTaskResumeGate(
        tuple.lifecycleState,
        state.resumeRequiresReview,
        state.resumeReviewReasons,
      );
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  if (expectedTaskIdentity && identity.identity.id !== expectedTaskIdentity) {
    errors.push(`Expected task ${expectedTaskIdentity}, found ${identity.identity.id ?? 'none'}.`);
  }

  if (ownershipStatus === 'active_owner' && identity.identity.id) {
    for (const artifact of suspendedPackages) {
      if (artifact.status === 'valid' && artifact.taskId === identity.identity.id) {
        errors.push(`Active owner ${identity.identity.id} conflicts with suspended package ${artifact.path}.`);
      }
    }
  }

  if (errors.length > 0) {
    blockers.push('current-task-state-invalid');
  }

  return {
    currentTask: {
      status: errors.length > 0 ? 'invalid' : 'valid',
      identityStatus: identity.status,
      taskId: identity.identity.id,
      workflowStatus: state.workflowStatus,
      lifecycleState: state.lifecycleState,
      ownershipStatus,
      errors,
    },
    findings: parseLegacyFindings(content),
    suspendedPackages,
    taskAuthority: extractTaskAuthority(content),
    blockers,
    autoSelectedSuspendedPackage: false,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function inspectInstallState(root: string): InstallStateDiagnostic {
  const relativePath = '.workflow-system/install-state.json';
  const installStatePath = path.join(root, '.workflow-system', 'install-state.json');
  if (!fs.existsSync(installStatePath)) {
    const hasProfile = fs.existsSync(path.join(root, '.workflow-system', 'PROJECT_PROFILE.yaml'));
    const hasManagedMarkers = [
      '.workflow-system/WORKFLOW_PROTOCOL.md',
      '.workflow-system/FILE_SCHEMAS.md',
      'docs/workflow/CURRENT_TASK.md',
      'scripts/workflow-runtime.ts',
      '.codex/skills',
      '.claude/skills',
      '.agents/skills',
      '.factory/skills',
    ].some(relativePath => fs.existsSync(path.join(root, ...relativePath.split('/'))));
    const requiresInventory = hasProfile || hasManagedMarkers;
    return {
      path: relativePath,
      status: requiresInventory ? 'metadata-missing' : 'not-installed',
      stateVersion: null,
      workflowSystemVersion: null,
      migrationDisposition: requiresInventory ? 'inventory-required' : 'not-applicable',
      legacyRuntimeAuthoritative: true,
      bootstrapOrAdoptRequired: false,
      blockers: [],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(installStatePath, 'utf8'));
  } catch (error) {
    return {
      path: relativePath,
      status: 'malformed',
      stateVersion: null,
      workflowSystemVersion: null,
      migrationDisposition: 'blocked',
      legacyRuntimeAuthoritative: true,
      bootstrapOrAdoptRequired: false,
      blockers: [`install-state-json-invalid:${error instanceof Error ? error.message : String(error)}`],
    };
  }

  if (!isPlainObject(parsed) || !Number.isInteger(parsed.state_version)) {
    return {
      path: relativePath,
      status: 'malformed',
      stateVersion: null,
      workflowSystemVersion: null,
      migrationDisposition: 'blocked',
      legacyRuntimeAuthoritative: true,
      bootstrapOrAdoptRequired: false,
      blockers: ['install-state-schema-invalid'],
    };
  }

  const stateVersion = parsed.state_version as number;
  const workflowSystemVersion = typeof parsed.workflow_system_version === 'string'
    ? parsed.workflow_system_version
    : null;
  if (stateVersion !== 1) {
    return {
      path: relativePath,
      status: 'unsupported-version',
      stateVersion,
      workflowSystemVersion,
      migrationDisposition: 'blocked',
      legacyRuntimeAuthoritative: true,
      bootstrapOrAdoptRequired: false,
      blockers: [`unsupported-install-state-version:${stateVersion}`],
    };
  }

  const managedFiles = Array.isArray(parsed.managed_files) ? parsed.managed_files : [];
  const managedPaths = managedFiles
    .filter(isPlainObject)
    .map(entry => typeof entry.path === 'string' ? normalizeRelativePath(entry.path) : '');
  const managedFilesValid = Array.isArray(parsed.managed_files)
    && managedFiles.every(entry => isPlainObject(entry)
      && typeof entry.path === 'string'
      && entry.path.trim().length > 0
      && !path.isAbsolute(entry.path)
      && !normalizeRelativePath(entry.path).includes('..')
      && ['replace-managed', 'bootstrap-skill-install'].includes(String(entry.mode))
      && typeof entry.bundle_checksum === 'string'
      && /^[a-f0-9]{64}$/i.test(entry.bundle_checksum)
      && typeof entry.installed_checksum === 'string'
      && /^[a-f0-9]{64}$/i.test(entry.installed_checksum))
    && new Set(managedPaths).size === managedPaths.length;
  const hostSyncStateValid = isPlainObject(parsed.host_sync_state)
    && Object.values(parsed.host_sync_state).every(host => isPlainObject(host)
      && typeof host.namespace === 'string'
      && (typeof host.synced_at === 'string' || host.synced_at === null)
      && Array.isArray(host.synced_entries)
      && host.synced_entries.every(entry => isPlainObject(entry)
        && typeof entry.skill_name === 'string'
        && typeof entry.target_path === 'string'));
  const requiredV1Shape = typeof parsed.bundle_id === 'string'
    && parsed.bundle_id.trim().length > 0
    && typeof parsed.workflow_system_version === 'string'
    && parsed.workflow_system_version.trim().length > 0
    && typeof parsed.installed_at === 'string'
    && !Number.isNaN(Date.parse(parsed.installed_at))
    && managedFilesValid
    && isPlainObject(parsed.package_json_fragment)
    && isPlainObject(parsed.project_profile_fragment)
    && hostSyncStateValid;
  return {
    path: relativePath,
    status: requiredV1Shape ? 'readable-v1' : 'partial-v1',
    stateVersion,
    workflowSystemVersion,
    migrationDisposition: requiredV1Shape ? 'in-place-plan-required' : 'blocked',
    legacyRuntimeAuthoritative: true,
    bootstrapOrAdoptRequired: false,
    blockers: requiredV1Shape ? [] : ['install-state-v1-incomplete'],
  };
}

function walkWorkspaceFiles(root: string, declaredEphemeralPaths: string[]): string[] {
  const files: string[] = [];
  const ignores = [...SNAPSHOT_IGNORES, ...declaredEphemeralPaths];

  function walk(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = normalizeRelativePath(path.relative(root, absolutePath));
      if (matchesAny(relativePath, ignores)) {
        continue;
      }
      if (entry.isSymbolicLink()) {
        files.push(relativePath);
      } else if (entry.isDirectory()) {
        walk(absolutePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  }

  walk(root);
  return files.sort();
}

function captureWorkspaceSnapshot(root: string, declaredEphemeralPaths: string[]): WorkspaceSnapshot {
  const files = new Map<string, string>();
  for (const relativePath of walkWorkspaceFiles(root, declaredEphemeralPaths)) {
    const absolutePath = path.join(root, ...relativePath.split('/'));
    const stat = fs.lstatSync(absolutePath);
    const digest = stat.isSymbolicLink()
      ? sha256(`symlink:${fs.readlinkSync(absolutePath)}`)
      : sha256(fs.readFileSync(absolutePath));
    files.set(relativePath, digest);
  }
  const gitAnchorPath = path.join(root, '.git');
  if (fs.existsSync(gitAnchorPath)) {
    const stat = fs.lstatSync(gitAnchorPath);
    let gitDirectory = gitAnchorPath;
    if (stat.isFile()) {
      const gitFileContent = fs.readFileSync(gitAnchorPath, 'utf8');
      files.set('.git', sha256(gitFileContent));
      const gitDirMatch = /^gitdir:\s*(.+?)\s*$/mi.exec(gitFileContent)?.[1];
      if (gitDirMatch) {
        gitDirectory = path.resolve(root, gitDirMatch);
      }
    }
    if (fs.existsSync(gitDirectory) && fs.statSync(gitDirectory).isDirectory()) {
      const gitControlFiles = ['HEAD', 'index', 'config'];
      const headPath = path.join(gitDirectory, 'HEAD');
      if (fs.existsSync(headPath)) {
        const head = fs.readFileSync(headPath, 'utf8');
        const ref = /^ref:\s*(.+?)\s*$/m.exec(head)?.[1];
        if (ref && !ref.includes('..')) {
          gitControlFiles.push(ref.replace(/\\/g, '/'));
        }
      }
      for (const relativeGitPath of [...new Set(gitControlFiles)]) {
        const absoluteGitPath = path.join(gitDirectory, ...relativeGitPath.split('/'));
        if (fs.existsSync(absoluteGitPath) && fs.statSync(absoluteGitPath).isFile()) {
          files.set(`.git/${relativeGitPath}`, sha256(fs.readFileSync(absoluteGitPath)));
        }
      }
    }
  }
  return {
    digest: sha256([...files].map(([file, digest]) => `${file}\0${digest}`).join('\n')),
    files,
  };
}

function compareWorkspaceSnapshots(before: WorkspaceSnapshot, after: WorkspaceSnapshot): string[] {
  if (before.digest === after.digest) {
    return [];
  }
  const paths = new Set([...before.files.keys(), ...after.files.keys()]);
  return [...paths]
    .filter(file => before.files.get(file) !== after.files.get(file))
    .sort();
}

function runGit(root: string, args: string[]): { ok: boolean; output: string; error: string } {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    windowsHide: true,
  });
  return {
    ok: result.status === 0,
    output: String(result.stdout ?? '').trim(),
    error: String(result.stderr ?? '').trim(),
  };
}

function diffTargetRevisionInputs(target: ReviewDiffTarget): Array<{ field: 'base' | 'head'; value: string }> {
  if (target.kind === 'working-tree') {
    return [{ field: 'base', value: target.base }];
  }
  if (target.kind === 'commit') {
    return [{ field: target.head === null ? 'base' : 'head', value: target.head ?? target.base }];
  }
  if (target.kind === 'range') {
    return [
      { field: 'base', value: target.base },
      ...(target.head && !['WORKTREE', 'working-tree'].includes(target.head)
        ? [{ field: 'head' as const, value: target.head }]
        : []),
    ];
  }
  return [];
}

function validateGitRevisionInput(value: string): boolean {
  return value.length > 0
    && value.length <= 1024
    && value === value.trim()
    && !value.startsWith('-')
    && !path.win32.isAbsolute(value)
    && !path.posix.isAbsolute(value)
    && !/[\u0000-\u0020\u007f\\]/.test(value);
}

function unsafeDiffTargetRevisions(target: ReviewDiffTarget): string[] {
  return diffTargetRevisionInputs(target)
    .filter(({ value }) => !validateGitRevisionInput(value))
    .map(({ field }) => `unsafe-git-revision:${field}`);
}

function resolveGitCommit(root: string, revision: string): { ok: boolean; oid: string; error: string } {
  if (!validateGitRevisionInput(revision)) {
    return { ok: false, oid: '', error: 'unsafe-git-revision' };
  }
  const result = runGit(root, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`]);
  if (!result.ok || !/^[0-9a-f]{40,64}$/i.test(result.output)) {
    return { ok: false, oid: '', error: result.error || 'git-revision-did-not-resolve-to-one-commit' };
  }
  return { ok: true, oid: result.output, error: '' };
}

function parseGitPaths(output: string): string[] {
  return [...new Set(output.split(/\r?\n/).map(normalizeRelativePath).filter(Boolean))].sort();
}

export function inspectReviewDiffTarget(
  root: string,
  target: ReviewDiffTarget,
  declaredChangedPaths: string[],
): DiffTargetVerification {
  const unsafeRevisions = unsafeDiffTargetRevisions(target);
  if (unsafeRevisions.length > 0) {
    return { status: 'unavailable', actualPaths: [], actualFingerprint: null, reasons: unsafeRevisions };
  }
  const gitAnchor = buildTargetRootIdentity(root, 'isolated-target').gitAnchor;
  if (!gitAnchor || target.kind === 'patch') {
    return {
      status: 'harness-supplied',
      actualPaths: [...new Set(declaredChangedPaths.map(normalizeRelativePath))].sort(),
      actualFingerprint: null,
      reasons: [target.kind === 'patch' ? 'Patch content is supplied by the harness.' : 'No Git anchor is available.'],
    };
  }

  let pathResult: { ok: boolean; output: string; error: string };
  const preflightReasons: string[] = [];
  if (target.kind === 'working-tree') {
    const resolvedBase = resolveGitCommit(root, target.base);
    const head = resolveGitCommit(root, 'HEAD');
    if (!resolvedBase.ok || !head.ok || resolvedBase.oid !== head.oid) {
      preflightReasons.push('working-tree-base-is-not-current-head');
    }
    const tracked = runGit(root, ['diff', '--name-only', '--no-renames', '--']);
    const untracked = runGit(root, ['ls-files', '--others', '--exclude-standard']);
    if (!tracked.ok || !untracked.ok) {
      return { status: 'unavailable', actualPaths: [], actualFingerprint: null, reasons: [tracked.error, untracked.error].filter(Boolean) };
    }
    pathResult = { ok: true, output: `${tracked.output}\n${untracked.output}`, error: '' };
  } else if (target.kind === 'staged') {
    pathResult = runGit(root, ['diff', '--cached', '--name-only', '--no-renames', '--']);
  } else if (target.kind === 'commit') {
    const revision = resolveGitCommit(root, target.head ?? target.base);
    if (!revision.ok) {
      return { status: 'unavailable', actualPaths: [], actualFingerprint: null, reasons: [revision.error] };
    }
    pathResult = runGit(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', revision.oid, '--']);
  } else {
    const rangeEnd = target.head && !['WORKTREE', 'working-tree'].includes(target.head) ? target.head : undefined;
    const resolvedBase = resolveGitCommit(root, target.base);
    const resolvedEnd = rangeEnd ? resolveGitCommit(root, rangeEnd) : null;
    if (!resolvedBase.ok || (resolvedEnd && !resolvedEnd.ok)) {
      return {
        status: 'unavailable',
        actualPaths: [],
        actualFingerprint: null,
        reasons: [resolvedBase.error, resolvedEnd?.error ?? ''].filter(Boolean),
      };
    }
    pathResult = runGit(root, [
      'diff',
      '--name-only',
      '--no-renames',
      resolvedBase.oid,
      ...(resolvedEnd ? [resolvedEnd.oid] : []),
      '--',
    ]);
  }

  if (!pathResult.ok) {
    return { status: 'unavailable', actualPaths: [], actualFingerprint: null, reasons: [pathResult.error || 'Git diff inspection failed.'] };
  }
  const actualPaths = parseGitPaths(pathResult.output);
  const contentTuples = actualPaths.map(relativePath => {
    const absolutePath = path.join(root, ...relativePath.split('/'));
    return fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()
      ? `${relativePath}\0${sha256(fs.readFileSync(absolutePath))}`
      : `${relativePath}\0deleted`;
  });
  const actualFingerprint = `git-${sha256(JSON.stringify({
    kind: target.kind,
    base: target.base,
    head: target.head,
    contentTuples,
  })).slice(0, 24)}`;
  const declaredPaths = [...new Set(declaredChangedPaths.map(normalizeRelativePath))].sort();
  const reasons: string[] = [...preflightReasons];
  if (JSON.stringify(actualPaths) !== JSON.stringify(declaredPaths)) reasons.push('declared-changed-paths-do-not-match-git');
  if (target.fingerprint !== actualFingerprint) reasons.push('diff-target-fingerprint-does-not-match-git');
  return {
    status: reasons.length > 0 ? 'mismatch' : 'verified',
    actualPaths,
    actualFingerprint,
    reasons,
  };
}

function expectStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new ReviewShadowContractError(`${field} must be an array of strings.`);
  }
  return value;
}

export function parseReviewShadowRequest(value: unknown): ReviewShadowRequest {
  if (!isPlainObject(value)) {
    throw new ReviewShadowContractError('request must be an object.');
  }
  if (value.schemaVersion !== REVIEW_SHADOW_SCHEMA_VERSION) {
    throw new ReviewShadowContractError(`schemaVersion must be ${REVIEW_SHADOW_SCHEMA_VERSION}.`);
  }
  if (typeof value.requestId !== 'string' || !value.requestId.trim()) {
    throw new ReviewShadowContractError('requestId must be a non-empty string.');
  }
  if (!['default', 'report-only'].includes(String(value.mode))) {
    throw new ReviewShadowContractError('mode must be default or report-only.');
  }
  if (!['discovery', 'verification'].includes(String(value.reviewCyclePhase))) {
    throw new ReviewShadowContractError('reviewCyclePhase must be discovery or verification.');
  }
  if (!isPlainObject(value.targetRootIdentity)
    || typeof value.targetRootIdentity.absoluteRoot !== 'string'
    || !(typeof value.targetRootIdentity.gitAnchor === 'string' || value.targetRootIdentity.gitAnchor === null)
    || !['source', 'isolated-target', 'shared-git-conflict', 'unknown'].includes(String(value.targetRootIdentity.relationship))) {
    throw new ReviewShadowContractError('targetRootIdentity is invalid.');
  }
  if (!isPlainObject(value.diffTarget)
    || !['working-tree', 'staged', 'range', 'commit', 'patch'].includes(String(value.diffTarget.kind))
    || typeof value.diffTarget.description !== 'string'
    || typeof value.diffTarget.base !== 'string'
    || !(typeof value.diffTarget.head === 'string' || value.diffTarget.head === null)
    || typeof value.diffTarget.fingerprint !== 'string') {
    throw new ReviewShadowContractError('diffTarget is invalid.');
  }
  const unsafeRevisions = unsafeDiffTargetRevisions(value.diffTarget as unknown as ReviewDiffTarget);
  if (unsafeRevisions.length > 0) {
    throw new ReviewShadowContractError(`diffTarget contains ${unsafeRevisions.join(', ')}.`);
  }
  if (!isPlainObject(value.scope)) {
    throw new ReviewShadowContractError('scope must be an object.');
  }
  for (const field of ['allowed', 'conditional', 'forbidden', 'conditionalAuthorizations']) {
    expectStringArray(value.scope[field], `scope.${field}`);
  }
  for (const field of [
    'goalAndClaims',
    'changedPaths',
    'changedSymbols',
    'changedSurfaces',
    'riskTriggers',
    'declaredEphemeralPaths',
  ]) {
    expectStringArray(value[field], field);
  }
  if ((value.changedPaths as string[]).some(item => path.isAbsolute(item) || normalizeRelativePath(item).includes('..'))) {
    throw new ReviewShadowContractError('changedPaths must contain safe repository-relative paths.');
  }
  if (!Array.isArray(value.evidence) || !Array.isArray(value.observations)) {
    throw new ReviewShadowContractError('evidence and observations must be arrays.');
  }
  if (!isPlainObject(value.convergence)
    || !Number.isInteger(value.convergence.repairRounds)
    || Number(value.convergence.repairRounds) < 0
    || !Number.isInteger(value.convergence.verificationNewFindingWaves)
    || Number(value.convergence.verificationNewFindingWaves) < 0
    || !isPlainObject(value.convergence.attemptsByFingerprint)
    || Object.values(value.convergence.attemptsByFingerprint).some(item => !Number.isInteger(item) || Number(item) < 0)
    || !Array.isArray(value.convergence.knownFingerprints)
    || value.convergence.knownFingerprints.some(item => typeof item !== 'string')) {
    throw new ReviewShadowContractError('convergence counters and fingerprints are invalid.');
  }
  if (!isPlainObject(value.contextBudget)
    || !Number.isInteger(value.contextBudget.maxItems)
    || Number(value.contextBudget.maxItems) <= 0
    || !Number.isInteger(value.contextBudget.maxSummaryBytes)
    || Number(value.contextBudget.maxSummaryBytes) <= 0) {
    throw new ReviewShadowContractError('contextBudget must contain positive integer limits.');
  }
  for (const [index, evidence] of value.evidence.entries()) {
    if (!isPlainObject(evidence)
      || typeof evidence.id !== 'string' || !evidence.id.trim()
      || typeof evidence.locator !== 'string' || !evidence.locator.trim()
      || !['test', 'inspection', 'contract', 'external-doc', 'design', 'release', 'lifecycle', 'approval', 'reproduction'].includes(String(evidence.kind))
      || !['passed', 'failed', 'not-run', 'missing'].includes(String(evidence.status))
      || !['acceptance', 'contract', 'reproduced-bug', 'hard-invariant', 'concrete-regression-risk', 'none'].includes(String(evidence.ownerSource))
      || typeof evidence.persistent !== 'boolean') {
      throw new ReviewShadowContractError(`evidence[${index}] is invalid.`);
    }
    expectStringArray(evidence.claimIds, `evidence[${index}].claimIds`);
  }
  const evidenceIds = value.evidence.map(item => (item as Record<string, unknown>).id);
  if (new Set(evidenceIds).size !== evidenceIds.length) {
    throw new ReviewShadowContractError('evidence IDs must be unique.');
  }
  for (const [index, observation] of value.observations.entries()) {
    if (!isPlainObject(observation)
      || typeof observation.id !== 'string' || !observation.id.trim()
      || typeof observation.category !== 'string'
      || typeof observation.location !== 'string'
      || typeof observation.scopePath !== 'string'
      || typeof observation.failureScenario !== 'string'
      || typeof observation.violatedInvariant !== 'string'
      || !['blocker', 'major', 'minor'].includes(String(observation.severity))
      || !['acceptance', 'contract', 'reproduced-bug', 'hard-invariant', 'concrete-regression-risk', 'none'].includes(String(observation.ownerSource))
      || !['confirmed', 'unknown', 'not-applicable'].includes(String(observation.rootCause))
      || !['model-mechanical', 'debug', 'user'].includes(String(observation.resolutionOwner))
      || typeof observation.speculative !== 'boolean'
      || typeof observation.mechanical !== 'boolean') {
      throw new ReviewShadowContractError(`observations[${index}] is invalid.`);
    }
    expectStringArray(observation.evidenceRefs, `observations[${index}].evidenceRefs`);
  }
  const observationIds = value.observations.map(item => (item as Record<string, unknown>).id);
  if (new Set(observationIds).size !== observationIds.length) {
    throw new ReviewShadowContractError('observation IDs must be unique.');
  }
  if (value.knowledgeCandidates !== undefined && !Array.isArray(value.knowledgeCandidates)) {
    throw new ReviewShadowContractError('knowledgeCandidates must be an array when provided.');
  }
  if (value.existingKnowledge !== undefined && !Array.isArray(value.existingKnowledge)) {
    throw new ReviewShadowContractError('existingKnowledge must be an array when provided.');
  }
  return value as unknown as ReviewShadowRequest;
}

function validateDeclaredEphemeralPaths(paths: string[]): string[] {
  const blockers: string[] = [];
  for (const entry of paths) {
    const normalized = normalizeRelativePath(entry);
    const rootSegment = normalized.split('/')[0];
    if (!normalized
      || path.isAbsolute(entry)
      || normalized.includes('..')
      || ['*', '**', '**/*'].includes(normalized)
      || !EPHEMERAL_ROOTS.has(rootSegment)
      || matchesAny(normalized.replace(/\/\*\*$/, ''), GOVERNED_EPHEMERAL_DENYLIST)) {
      blockers.push(`invalid-declared-ephemeral-path:${entry}`);
    }
  }
  return blockers;
}

function validateRequest(request: ReviewShadowRequest, root: string): string[] {
  const blockers: string[] = [];
  if (request.schemaVersion !== REVIEW_SHADOW_SCHEMA_VERSION) blockers.push('unsupported-review-shadow-schema');
  if (!request.requestId.trim()) blockers.push('missing-request-id');
  if (!request.diffTarget?.description?.trim() || !request.diffTarget?.fingerprint?.trim()) {
    blockers.push('missing-explicit-diff-target');
  }
  if (!request.diffTarget?.base?.trim()) blockers.push('missing-diff-target-base');
  if (request.changedPaths.length === 0) blockers.push('empty-diff-target-path-set');
  if (request.goalAndClaims.length === 0) blockers.push('missing-goal-or-acceptance-claims');
  if (request.scope.allowed.length === 0 && request.scope.conditional.length === 0) blockers.push('missing-positive-scope');
  if (request.convergence.repairRounds < 0 || request.convergence.verificationNewFindingWaves < 0) {
    blockers.push('invalid-convergence-counters');
  }
  if (buildTargetRootIdentity(root, request.targetRootIdentity.relationship).absoluteRoot
    !== normalizeAbsoluteRootPath(request.targetRootIdentity.absoluteRoot)) {
    blockers.push('target-root-identity-mismatch');
  }
  return blockers;
}

function hasEvidence(request: ReviewShadowRequest, kind: ReviewEvidenceKind): ReviewEvidence[] {
  return request.evidence.filter(item => item.kind === kind);
}

function buildMandatoryDimensions(
  request: ReviewShadowRequest,
  scopeFailures: string[],
  findingClassifications: FindingClassification[],
): ReviewDimension[] {
  const failedEvidence = request.evidence.filter(item => item.status === 'failed');
  const inadmissiblePersistentEvidence = request.evidence.filter(item => item.persistent && item.ownerSource === 'none');
  const absentClaimEvidence = request.goalAndClaims.filter(claim =>
    !request.evidence.some(item =>
      item.claimIds.includes(claim)
      && ['passed', 'failed'].includes(item.status)
      && (!item.persistent || item.ownerSource !== 'none')));
  let evidenceStatus: ReviewDimension['status'] = 'pass';
  let evidenceReasons = ['Every named claim has completed evidence.'];
  if (absentClaimEvidence.length > 0 || inadmissiblePersistentEvidence.length > 0) {
    evidenceStatus = 'needs-evidence';
    evidenceReasons = inadmissiblePersistentEvidence.length > 0
      ? [`Persistent evidence lacks an owner: ${inadmissiblePersistentEvidence.map(item => item.id).join(', ')}`]
      : [`Claims without completed evidence: ${absentClaimEvidence.join(', ')}`];
  } else if (failedEvidence.length > 0) {
    evidenceStatus = 'finding';
    evidenceReasons = [`Failed evidence: ${failedEvidence.map(item => item.id).join(', ')}`];
  }

  return [
    {
      id: 'diff-target',
      mandatory: true,
      triggeredBy: ['review-change'],
      status: request.diffTarget.description.trim() && request.diffTarget.fingerprint.trim() ? 'pass' : 'blocked',
      evidenceRefs: [request.diffTarget.fingerprint].filter(Boolean),
      reasons: request.diffTarget.description.trim()
        ? [`Explicit ${request.diffTarget.kind} target: ${request.diffTarget.description}`]
        : ['One explicit logical diff target is required.'],
    },
    {
      id: 'scope',
      mandatory: true,
      triggeredBy: ['review-change'],
      status: scopeFailures.length > 0 ? 'blocked' : 'pass',
      evidenceRefs: request.changedPaths,
      reasons: scopeFailures.length > 0 ? scopeFailures : ['All changed paths are owned by allowed or authorized conditional scope.'],
    },
    {
      id: 'goal-and-acceptance',
      mandatory: true,
      triggeredBy: ['review-change'],
      status: request.goalAndClaims.length > 0 ? 'pass' : 'blocked',
      evidenceRefs: request.goalAndClaims,
      reasons: request.goalAndClaims.length > 0 ? ['Goal and acceptance claims are explicit.'] : ['Goal/acceptance is missing.'],
    },
    {
      id: 'correctness-risk',
      mandatory: true,
      triggeredBy: ['review-change'],
      status: findingClassifications.some(item => item.admitted) || failedEvidence.length > 0 ? 'finding' : 'pass',
      evidenceRefs: [...findingClassifications.map(item => item.fingerprint), ...failedEvidence.map(item => item.id)],
      reasons: findingClassifications.some(item => item.admitted) || failedEvidence.length > 0
        ? ['Strong findings or failed evidence require disposition.']
        : ['No admitted correctness finding is present in the supplied review evidence.'],
    },
    {
      id: 'evidence',
      mandatory: true,
      triggeredBy: ['review-change'],
      status: evidenceStatus,
      evidenceRefs: request.evidence.map(item => item.id),
      reasons: evidenceReasons,
    },
  ];
}

function buildConditionalDimensions(
  request: ReviewShadowRequest,
  contextSourceRevision: string,
): { dimensions: ReviewDimension[]; validationRequests: ReviewShadowResult['validationRequests'] } {
  const haystack = normalizeTerms([
    ...request.changedPaths,
    ...request.changedSymbols,
    ...request.changedSurfaces,
    ...request.riskTriggers,
  ]);
  const dimensions: ReviewDimension[] = [];
  const validationRequests: ReviewShadowResult['validationRequests'] = [];

  for (const [id, config] of Object.entries(CONDITIONAL_DIMENSION_TRIGGERS) as Array<[
    keyof typeof CONDITIONAL_DIMENSION_TRIGGERS,
    { terms: string[]; evidenceKind: ReviewEvidenceKind },
  ]>) {
    const triggeredBy = config.terms.filter(term => containsTrigger(haystack, term));
    if (triggeredBy.length === 0) {
      continue;
    }
    const evidence = hasEvidence(request, config.evidenceKind);
    const completed = evidence.some(item =>
      (item.status === 'passed' || item.status === 'failed')
      && (!item.persistent || item.ownerSource !== 'none')
      && item.claimIds.some(claim => request.goalAndClaims.includes(claim)));
    const failed = evidence.some(item => item.status === 'failed');
    let status: ReviewDimension['status'] = 'pass';
    let reasons = [`Triggered ${id} evidence is present.`];
    if (!completed) {
      status = 'needs-evidence';
      reasons = [`Triggered ${id} requires ${config.evidenceKind} evidence.`];
    } else if (failed) {
      status = 'finding';
      reasons = [`${config.evidenceKind} evidence failed.`];
    }
    dimensions.push({
      id,
      mandatory: false,
      triggeredBy,
      status,
      evidenceRefs: evidence.map(item => item.id),
      reasons,
    });
    if (!completed) {
      const validationRequestIdentity = [
        request.requestId,
        request.reviewCyclePhase,
        id,
        config.evidenceKind,
        request.diffTarget.fingerprint,
        contextSourceRevision,
        ...request.goalAndClaims,
      ].join('\0');
      validationRequests.push({
        requestId: `validation-${sha256(validationRequestIdentity).slice(0, 24)}`,
        reviewRequestId: request.requestId,
        reviewCyclePhase: request.reviewCyclePhase,
        dimension: id,
        requiredEvidenceKind: config.evidenceKind,
        claimIds: [...request.goalAndClaims],
        diffTargetFingerprint: request.diffTarget.fingerprint,
        contextSourceRevision,
        context: {
          taskIdentity: request.taskIdentity,
          lifecycleTuple: request.lifecycleTuple,
          diffTarget: request.diffTarget.description,
          goalAndClaims: [...request.goalAndClaims],
          scopePathsAndSymbols: [...request.changedPaths, ...request.changedSymbols],
          changedSurfaces: [...request.changedSurfaces],
          riskTriggers: [...request.riskTriggers],
          contextBudget: { ...request.contextBudget },
        },
        reason: `The ${triggeredBy.join(', ')} trigger requires explicit ${config.evidenceKind} evidence.`,
      });
    }
  }

  return { dimensions, validationRequests };
}

export function fingerprintReviewObservation(observation: ReviewObservation): string {
  const normalized = [
    observation.category,
    observation.ownerSource,
    normalizeRelativePath(observation.scopePath),
    observation.failureScenario,
    observation.violatedInvariant,
  ].map(value => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim());
  return `finding-${sha256(normalized.join('\0')).slice(0, 24)}`;
}

function classifyFindings(
  request: ReviewShadowRequest,
  canonicalScope: ReviewScope | null,
  legacyAttemptsUnknown: boolean,
): FindingClassification[] {
  const admissibleEvidence = request.evidence
    .filter(item => ['passed', 'failed'].includes(item.status) && (!item.persistent || item.ownerSource !== 'none'))
  const evidenceIds = new Set(admissibleEvidence.map(item => item.id));
  const evidenceById = new Map(admissibleEvidence.map(item => [item.id, item]));
  return request.observations.map(observation => {
    const fingerprint = fingerprintReviewObservation(observation);
    const attempts = request.convergence.attemptsByFingerprint[fingerprint] ?? 0;
    const reasons: string[] = [];
    const requestScopeStatus = classifyScopePath(observation.scopePath, request.scope);
    const canonicalScopeStatus = canonicalScope ? classifyScopePath(observation.scopePath, canonicalScope) : 'allowed';
    const scopeStatus = requestScopeStatus === 'allowed' ? canonicalScopeStatus : requestScopeStatus;
    let admitted = true;

    if (!STRONG_FINDING_OWNERS.has(observation.ownerSource)) {
      admitted = false;
      reasons.push('missing-strong-owner');
    }
    if (scopeStatus !== 'allowed') {
      admitted = false;
      reasons.push(`finding-scope-${scopeStatus}`);
    }
    if (!observation.failureScenario.trim() || !observation.violatedInvariant.trim()) {
      admitted = false;
      reasons.push('failure-or-invariant-missing');
    }
    if (observation.speculative) {
      admitted = false;
      reasons.push('speculative-observation');
    }
    if (observation.evidenceRefs.length === 0
      || observation.evidenceRefs.some(reference => !evidenceIds.has(reference))) {
      admitted = false;
      reasons.push('finding-evidence-missing');
    }
    if (!observation.evidenceRefs.some(reference =>
      evidenceById.get(reference)?.claimIds.some(claim => request.goalAndClaims.includes(claim)))) {
      admitted = false;
      reasons.push('finding-evidence-claim-unbound');
    }

    const isNewFingerprint = !request.convergence.knownFingerprints.includes(fingerprint);
    let budgetState: FindingClassification['budgetState'] = 'available';
    if (admitted && legacyAttemptsUnknown) {
      budgetState = 'exhausted';
      reasons.push('legacy-attempts-unknown');
    } else if (admitted && (attempts >= REVIEW_CONVERGENCE_LIMITS.attemptsPerFingerprint
      || request.convergence.repairRounds >= REVIEW_CONVERGENCE_LIMITS.repairRoundsPerCycle)) {
      budgetState = 'exhausted';
    } else if (admitted && request.reviewCyclePhase === 'verification'
      && isNewFingerprint
      && request.convergence.verificationNewFindingWaves >= REVIEW_CONVERGENCE_LIMITS.verificationNewFindingWaves) {
      budgetState = 'verification-wave-exhausted';
      admitted = false;
      reasons.push('verification-new-finding-wave-exhausted');
    }

    let ownerRoute: FindingClassification['ownerRoute'] = 'none';
    if (admitted) {
      if (observation.resolutionOwner === 'user') {
        ownerRoute = 'user';
      } else if (budgetState !== 'available'
        || observation.resolutionOwner === 'debug'
        || observation.rootCause === 'unknown'
        || !observation.mechanical) {
        ownerRoute = 'debug';
      } else {
        ownerRoute = 'repair';
      }
      reasons.push('strong-finding-admitted');
    }

    return { observationId: observation.id, fingerprint, admitted, reasons, attempts, budgetState, ownerRoute };
  });
}

function getEvidenceOutcome(dimensions: ReviewDimension[]): LegacyReviewResult['evidenceOutcome'] {
  if (dimensions.some(dimension => dimension.id === 'evidence' && dimension.status === 'finding')) return 'failed';
  if (dimensions.some(dimension => dimension.status === 'needs-evidence')) return 'insufficient';
  return 'sufficient';
}

function getScopeOutcome(dimensions: ReviewDimension[]): LegacyReviewResult['scopeOutcome'] {
  return dimensions.find(dimension => dimension.id === 'scope')?.status === 'pass' ? 'pass' : 'fail';
}

function getOwnerRoute(findings: FindingClassification[]): LegacyReviewResult['ownerRoute'] {
  if (findings.some(finding => finding.ownerRoute === 'user')) return 'user';
  if (findings.some(finding => finding.ownerRoute === 'debug' || finding.budgetState !== 'available')) return 'debug';
  if (findings.some(finding => finding.ownerRoute === 'repair')) return 'repair';
  return 'none';
}

export function compareLegacyAndShadow(
  legacy: LegacyReviewResult,
  shadow: Pick<
    ReviewShadowResult,
    'diffTarget' | 'verdict' | 'terminalBehavior' | 'governedMutationCount' | 'dimensions' | 'findings'
  >,
): LegacyShadowComparison {
  const hardMismatches: string[] = [];
  const shadowScope = getScopeOutcome(shadow.dimensions);
  const shadowOwner = getOwnerRoute(shadow.findings);
  const shadowEvidence = getEvidenceOutcome(shadow.dimensions);

  if (legacy.diffTargetFingerprint !== shadow.diffTarget.fingerprint) hardMismatches.push('diff-target');
  if (legacy.verdictClass !== shadow.verdict) hardMismatches.push('verdict-class');
  if (legacy.scopeOutcome !== shadowScope) hardMismatches.push('scope-outcome');
  if (legacy.ownerRoute !== shadowOwner) hardMismatches.push('owner-route');
  if (legacy.terminalBehavior !== shadow.terminalBehavior) hardMismatches.push('terminal-behavior');
  if (legacy.governedMutationCount !== shadow.governedMutationCount) hardMismatches.push('governed-mutation-count');
  if (legacy.evidenceOutcome !== shadowEvidence) hardMismatches.push('evidence-outcome');

  const softDifferences: string[] = [];
  if (legacy.wording) softDifferences.push('wording-not-compared-as-hard-invariant');
  if (legacy.metrics) softDifferences.push('cost-metrics-not-compared-as-hard-invariant');
  return { hardMismatches, softDifferences, equivalent: hardMismatches.length === 0 };
}

function selectVerdict(
  blockers: string[],
  dimensions: ReviewDimension[],
  findings: FindingClassification[],
): ReviewVerdict {
  if (blockers.length > 0 || dimensions.some(dimension => dimension.status === 'blocked')) return 'blocked';
  if (findings.some(finding => finding.admitted && finding.ownerRoute === 'user')) return 'needs-user';
  if (findings.some(finding => finding.admitted && finding.ownerRoute === 'debug')
    || findings.some(finding => finding.budgetState !== 'available')) return 'needs-debug';
  if (dimensions.some(dimension => dimension.status === 'needs-evidence')) return 'needs-evidence';
  if (dimensions.some(dimension => dimension.status === 'finding')
    && !findings.some(finding => finding.admitted)) return 'needs-debug';
  if (findings.some(finding => finding.admitted) || dimensions.some(dimension => dimension.status === 'finding')) {
    return 'findings';
  }
  return 'clean';
}

function selectRecommendedRoute(
  mode: ReviewShadowMode,
  verdict: ReviewVerdict,
  findings: FindingClassification[],
): ReviewShadowResult['recommendedRoute'] {
  if (mode === 'report-only' || verdict === 'clean' || verdict === 'needs-evidence' || verdict === 'blocked') return 'none';
  if (verdict === 'needs-user' || findings.some(finding => finding.ownerRoute === 'user')) return 'ask-user';
  if (verdict === 'needs-debug' || findings.some(finding => finding.ownerRoute === 'debug')) return 'debug-task:investigate';
  return findings.some(finding => finding.ownerRoute === 'repair') ? 'execute-step:repair' : 'none';
}

export function runReviewChangeShadow(root: string, request: ReviewShadowRequest): ReviewShadowResult {
  parseReviewShadowRequest(request);
  const ephemeralPathBlockers = validateDeclaredEphemeralPaths(request.declaredEphemeralPaths);
  const auditedEphemeralPaths = ephemeralPathBlockers.length === 0 ? request.declaredEphemeralPaths : [];
  const before = captureWorkspaceSnapshot(root, auditedEphemeralPaths);
  const requestBlockers = [...validateRequest(request, root), ...ephemeralPathBlockers];
  const installState = inspectInstallState(root);
  const projectState = inspectProjectState(root, request.taskIdentity);
  const diffTargetVerification = inspectReviewDiffTarget(root, request.diffTarget, request.changedPaths);
  const contextRequest: ProjectContextRequest = {
    requestId: request.requestId,
    targetRootIdentity: request.targetRootIdentity,
    intent: 'review',
    taskIdentity: request.taskIdentity,
    lifecycleTuple: request.lifecycleTuple,
    diffTarget: request.diffTarget?.description ?? null,
    goalAndClaims: request.goalAndClaims,
    scopePathsAndSymbols: [...request.changedPaths, ...request.changedSymbols],
    changedSurfaces: request.changedSurfaces,
    riskTriggers: request.riskTriggers,
    contextBudget: request.contextBudget,
  };
  const contextBundle = resolveProjectContext(root, contextRequest);

  const canonicalScope = request.taskIdentity ? buildCanonicalScope(projectState, request.scope) : null;
  const scopeFailures = request.changedPaths.flatMap(file => {
    const failures: string[] = [];
    const requestStatus = classifyScopePath(file, request.scope);
    if (requestStatus !== 'allowed') failures.push(`${requestStatus}:${file}`);
    if (canonicalScope) {
      const canonicalStatus = classifyScopePath(file, canonicalScope);
      if (canonicalStatus !== 'allowed') failures.push(`canonical-${canonicalStatus}:${file}`);
    }
    return failures;
  });
  const legacyAttemptsUnknown = projectState.findings.some(finding =>
    !['resolved', 'closed', 'rejected'].includes(finding.status.toLowerCase())
    && finding.repairAttempts === 'legacy-attempts-unknown');
  const findings = classifyFindings(request, canonicalScope, legacyAttemptsUnknown);
  const mandatoryDimensions = buildMandatoryDimensions(request, scopeFailures, findings);
  const conditional = buildConditionalDimensions(request, contextBundle.sourceRevision);
  const dimensions = [...mandatoryDimensions, ...conditional.dimensions];
  const knowledgeAdmission = (request.knowledgeCandidates ?? []).map(candidate =>
    classifyKnowledgeCandidate(candidate, request.existingKnowledge ?? []));
  const blockers = [
    ...requestBlockers,
    ...(diffTargetVerification.status === 'mismatch' || diffTargetVerification.status === 'unavailable'
      ? diffTargetVerification.reasons.map(reason => `diff-target-verification:${reason}`)
      : []),
    ...canonicalAuthorityBlockers(request, projectState),
    ...installState.blockers,
    ...projectState.blockers,
    ...contextBundle.missingRequiredContext,
    ...(contextBundle.budgetResult === 'required-context-exceeds-budget'
      ? ['required-context-exceeds-budget']
      : []),
  ];

  const preliminaryVerdict = selectVerdict([...new Set(blockers)], dimensions, findings);
  const terminalBehavior = request.mode === 'report-only' ? 'report-only' : 'continue';
  const preliminary: ReviewShadowResult = {
    schemaVersion: REVIEW_SHADOW_SCHEMA_VERSION,
    requestId: request.requestId,
    mode: request.mode,
    shadowOnly: true,
    routeIsAdvisory: true,
    verdict: preliminaryVerdict,
    terminalBehavior,
    diffTarget: request.diffTarget,
    diffTargetVerification,
    contextBundle,
    consumedContextLocators: [...contextBundle.required, ...contextBundle.optional].map(item => item.locator),
    installState,
    projectState,
    dimensions,
    findings,
    knowledgeAdmission,
    validationRequests: conditional.validationRequests,
    recommendedRoute: selectRecommendedRoute(request.mode, preliminaryVerdict, findings),
    internalHandoffs: [],
    governedMutationCount: 0,
    unexpectedWorkspaceDiffs: [],
    declaredEphemeralEffects: [],
    blockers: [...new Set(blockers)],
    comparison: null,
  };

  const after = captureWorkspaceSnapshot(root, auditedEphemeralPaths);
  const unexpectedWorkspaceDiffs = compareWorkspaceSnapshots(before, after);
  if (unexpectedWorkspaceDiffs.length > 0) {
    preliminary.unexpectedWorkspaceDiffs = unexpectedWorkspaceDiffs;
    preliminary.governedMutationCount = unexpectedWorkspaceDiffs.length;
    preliminary.blockers.push('unexpected-workspace-diff');
    preliminary.verdict = 'blocked';
    preliminary.recommendedRoute = 'none';
  }

  if (request.legacyResult) {
    preliminary.comparison = compareLegacyAndShadow(request.legacyResult, preliminary);
    if (!preliminary.comparison.equivalent) {
      preliminary.blockers.push('legacy-hard-invariant-mismatch');
      preliminary.verdict = 'blocked';
      preliminary.recommendedRoute = 'none';
    }
  }
  preliminary.blockers = [...new Set(preliminary.blockers)];
  return preliminary;
}

type ParsedCliArgs = {
  root: string;
  requestPath: string;
  legacyPath: string | null;
};

function parseCliArgs(argv: string[]): ParsedCliArgs {
  let root = process.cwd();
  let requestPath = '';
  let legacyPath: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--root') root = path.resolve(argv[++index] ?? '');
    else if (argument === '--request') requestPath = path.resolve(argv[++index] ?? '');
    else if (argument === '--legacy') legacyPath = path.resolve(argv[++index] ?? '');
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!requestPath) {
    throw new Error('Usage: bun run scripts/workflow-review-shadow.ts --request <request.json> [--legacy <legacy.json>] [--root <target-root>]');
  }
  return { root, requestPath, legacyPath };
}

function main(): void {
  const args = parseCliArgs(process.argv.slice(2));
  const request = parseReviewShadowRequest(JSON.parse(fs.readFileSync(args.requestPath, 'utf8')));
  if (args.legacyPath) {
    request.legacyResult = JSON.parse(fs.readFileSync(args.legacyPath, 'utf8')) as LegacyReviewResult;
  }
  process.stdout.write(`${JSON.stringify(runReviewChangeShadow(args.root, request), null, 2)}\n`);
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
