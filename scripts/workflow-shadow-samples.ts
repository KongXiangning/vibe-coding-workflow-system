#!/usr/bin/env bun

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';
import {
  buildTargetRootIdentity,
  type TargetRootIdentity,
} from './project-context-resolver';
import {
  parseReviewShadowRequest,
  runReviewChangeShadow,
  type LegacyReviewResult,
  type ReviewDiffTarget,
  type ReviewEvidence,
  type ReviewObservation,
  type ReviewShadowRequest,
  type ReviewShadowResult,
  type ReviewVerdict,
} from './workflow-review-shadow';

export const WORKFLOW_SHADOW_SAMPLE_SCHEMA_VERSION = 1 as const;

const MAX_FIXTURE_COPY_ENTRIES = 150_000;
const MAX_FIXTURE_COPY_BYTES = 1024 * 1024 * 1024;

/**
 * These are the representative Phase 1 cells.  Keep the names stable: they
 * are the coverage contract for the executable sample suite, not prose labels.
 */
export const REQUIRED_SHADOW_SAMPLE_SCENARIOS = [
  'small-clean',
  'checkpoint-continuity',
  'mechanical-finding',
  'scope-blocker',
  'contract-product-decision',
  'api-dto-propagation',
  'ui-missing-design-evidence',
  'third-party-docs-gate',
  'report-only-pass',
  'report-only-failure',
  'convergence-budget',
  'verification-speculative-edge',
] as const;

export type ShadowSampleScenario = typeof REQUIRED_SHADOW_SAMPLE_SCENARIOS[number];
export type ShadowSampleCaptureKind = 'observed' | 'contract-fixture';
export type ShadowSampleStatus = 'passed' | 'failed' | 'blocked';
export type PromotionEvidenceStatus = 'eligible' | 'ineligible' | 'not-assessed';

export type ShadowSampleFindingOutcome = {
  observationId: string;
  fingerprint: string;
  admitted: boolean;
  ownerRoute: 'none' | 'repair' | 'debug' | 'user';
  budgetState: 'available' | 'exhausted' | 'verification-wave-exhausted';
};

/**
 * A baseline intentionally contains more than LegacyReviewResult.  The
 * legacy type remains useful to the old comparator, while these fields make
 * the Phase 1 sample comparison fail closed on actual paths, claims and
 * finding admission.
 */
export type ShadowSampleLegacyBaseline = LegacyReviewResult & {
  captureKind: ShadowSampleCaptureKind;
  model: string;
  harness: string;
  capturedAt: string;
  evidenceLocator: string;
  fixtureRevision: string;
  diffKind: ReviewDiffTarget['kind'];
  actualPathSet: string[];
  authorityOutcome: 'pass' | 'blocked';
  claimBoundEvidenceOutcome: 'sufficient' | 'insufficient' | 'failed';
  validationRequestKeys: string[];
  findingOutcomes: ShadowSampleFindingOutcome[];
  recommendedRoute: ReviewShadowResult['recommendedRoute'];
  unexpectedWorkspaceDiffs: string[];
};

export type ShadowSampleCase = {
  id: string;
  scenario: string;
  request: Record<string, unknown>;
  legacy: ShadowSampleLegacyBaseline;
  files: Record<string, string>;
  sourceTuple?: unknown;
};

export type ShadowSampleAxes = {
  models: string[];
  harnesses: string[];
};

export type ShadowSampleMatrix = {
  schemaVersion: typeof WORKFLOW_SHADOW_SAMPLE_SCHEMA_VERSION;
  fixtureRevision: string;
  sourceTuple?: unknown;
  requiredScenarios: string[];
  requiredAxes?: ShadowSampleAxes;
  defaults: { request: Record<string, unknown> };
  cases: ShadowSampleCase[];
};

export type ShadowSampleSemanticView = {
  diffKind: ReviewDiffTarget['kind'];
  diffTargetFingerprint: string;
  actualPathSet: string[];
  verdict: ReviewVerdict;
  scopeOutcome: 'pass' | 'fail';
  authorityOutcome: 'pass' | 'blocked';
  claimBoundEvidenceOutcome: 'sufficient' | 'insufficient' | 'failed';
  validationRequestKeys: string[];
  findingOutcomes: ShadowSampleFindingOutcome[];
  ownerRoute: ShadowSampleLegacyBaseline['ownerRoute'];
  terminalBehavior: ReviewShadowResult['terminalBehavior'];
  recommendedRoute: ReviewShadowResult['recommendedRoute'];
  governedMutationCount: number;
  unexpectedWorkspaceDiffs: string[];
};

export type ShadowSampleComparison = {
  hardMismatches: string[];
  softDifferences: string[];
  equivalent: boolean;
  legacy: ShadowSampleSemanticView;
  shadow: ShadowSampleSemanticView | null;
};

export type ShadowSampleExecutionAudit = {
  legacyRoot: string;
  shadowRoot: string;
  legacyPreDigest: string;
  legacyPostDigest: string;
  shadowPreDigest: string;
  shadowPostDigest: string;
  legacyWorkspaceDiffs: string[];
  shadowWorkspaceDiffs: string[];
  unexpectedWorkspaceDiffs: string[];
  createdEphemeralEffects: string[];
  cleanupStatus: 'not-required' | 'success' | 'failed';
};

export type ShadowSampleRun = {
  id: string;
  scenario: string;
  status: ShadowSampleStatus;
  captureKind: ShadowSampleCaptureKind | null;
  model: string | null;
  harness: string | null;
  legacyBaseline: ShadowSampleLegacyBaseline | null;
  legacyAuthoritative: true;
  legacyAuthoritativeVerdict: ReviewVerdict | null;
  comparison: ShadowSampleComparison | null;
  hardMismatches: string[];
  softDifferences: string[];
  executionAudit: ShadowSampleExecutionAudit | null;
  shadowResult: ReviewShadowResult | null;
  blockers: string[];
};

export type ShadowSampleIssue = {
  sampleId: string;
  scenario: string;
  fields: string[];
};

export type ShadowSampleCoverage = {
  requiredScenarioIds: string[];
  declaredScenarioIds: string[];
  coveredScenarioIds: string[];
  missingScenarioIds: string[];
  unknownScenarioIds: string[];
  duplicateScenarioIds: string[];
  totalCases: number;
  executedCases: number;
  blockedCases: number;
  full: boolean;
  missingScenarioAxisCells: string[];
};

export type ShadowSampleObservedAxes = {
  declared: boolean;
  requiredModels: string[];
  requiredHarnesses: string[];
  models: string[];
  harnesses: string[];
  pairs: string[];
  missingPairs: string[];
};

export type ShadowSampleSuiteReport = {
  schemaVersion: typeof WORKFLOW_SHADOW_SAMPLE_SCHEMA_VERSION;
  generatedAt: string;
  fixtureRoot: string;
  fixtureRevision: string;
  sourceTuple?: unknown;
  fixtureSourceDigest: string | null;
  status: ShadowSampleStatus;
  legacyRemainsAuthoritative: true;
  hardMismatches: ShadowSampleIssue[];
  softDifferences: ShadowSampleIssue[];
  coverage: ShadowSampleCoverage;
  observedModelHarnessAxes: ShadowSampleObservedAxes;
  promotionEvidenceEligible: boolean;
  promotionEvidenceStatus: PromotionEvidenceStatus;
  blockers: string[];
  samples: ShadowSampleRun[];
};

export type ShadowSampleSuiteOptions = {
  fixtureRoot: string;
  matrixPath?: string;
  matrix?: ShadowSampleMatrix;
  now?: string | Date;
  /** Optional executor for an observed legacy capture. It receives a clone. */
  runLegacy?: (
    legacyRoot: string,
    sample: ShadowSampleCase,
    declaredBaseline: ShadowSampleLegacyBaseline,
  ) => ShadowSampleLegacyBaseline;
};

export class ShadowSampleContractError extends Error {
  readonly code = 'WORKFLOW_SHADOW_SAMPLE_SCHEMA_INVALID';

  constructor(message: string) {
    super(`${'WORKFLOW_SHADOW_SAMPLE_SCHEMA_INVALID'}: ${message}`);
    this.name = 'ShadowSampleContractError';
  }
}

type JsonRecord = Record<string, unknown>;
type Snapshot = { digest: string; files: Map<string, string> };

const VALID_DIFF_KINDS = new Set<ReviewDiffTarget['kind']>([
  'working-tree',
  'staged',
  'range',
  'commit',
  'patch',
]);
const VALID_VERDICTS = new Set<ReviewVerdict>([
  'clean',
  'findings',
  'needs-evidence',
  'needs-debug',
  'needs-user',
  'blocked',
]);
const VALID_OWNER_ROUTES = new Set<ShadowSampleLegacyBaseline['ownerRoute']>([
  'none',
  'repair',
  'debug',
  'user',
]);
const VALID_RECOMMENDED_ROUTES = new Set<ReviewShadowResult['recommendedRoute']>([
  'none',
  'execute-step:repair',
  'debug-task:investigate',
  'ask-user',
]);
const VALID_BUDGET_STATES = new Set<ShadowSampleFindingOutcome['budgetState']>([
  'available',
  'exhausted',
  'verification-wave-exhausted',
]);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

function normalizeStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new ShadowSampleContractError(`${field} must be an array of strings.`);
  }
  return [...new Set(value.map(item => item.trim()).filter(Boolean))];
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ShadowSampleContractError(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function requireNonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new ShadowSampleContractError(`${field} must be a non-negative integer.`);
  }
  return Number(value);
}

function asCaptureKind(value: unknown, field: string): ShadowSampleCaptureKind {
  if (value !== 'observed' && value !== 'contract-fixture') {
    throw new ShadowSampleContractError(`${field} must be observed or contract-fixture.`);
  }
  return value;
}

function stableJson(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as JsonRecord;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
}

function cloneRecord(value: JsonRecord): JsonRecord {
  return structuredClone(value) as JsonRecord;
}

function mergeRecords(...records: JsonRecord[]): JsonRecord {
  const output: JsonRecord = {};
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if (isRecord(value) && isRecord(output[key])) {
        output[key] = mergeRecords(output[key] as JsonRecord, value);
      } else {
        output[key] = structuredClone(value);
      }
    }
  }
  return output;
}

function parseFindingOutcomes(value: unknown, field: string): ShadowSampleFindingOutcome[] {
  if (!Array.isArray(value)) {
    throw new ShadowSampleContractError(`${field} must be an array.`);
  }
  const outcomes = value.map((item, index) => {
    if (!isRecord(item)) {
      throw new ShadowSampleContractError(`${field}[${index}] must be an object.`);
    }
    const ownerRoute = item.ownerRoute;
    const budgetState = item.budgetState;
    if (typeof item.admitted !== 'boolean' || typeof ownerRoute !== 'string' || !VALID_OWNER_ROUTES.has(ownerRoute as any)) {
      throw new ShadowSampleContractError(`${field}[${index}] has invalid admitted/ownerRoute.`);
    }
    if (typeof budgetState !== 'string' || !VALID_BUDGET_STATES.has(budgetState as any)) {
      throw new ShadowSampleContractError(`${field}[${index}] has invalid budgetState.`);
    }
    return {
      observationId: requireNonEmptyString(item.observationId, `${field}[${index}].observationId`),
      fingerprint: requireNonEmptyString(item.fingerprint, `${field}[${index}].fingerprint`),
      admitted: item.admitted,
      ownerRoute: ownerRoute as ShadowSampleFindingOutcome['ownerRoute'],
      budgetState: budgetState as ShadowSampleFindingOutcome['budgetState'],
    };
  });
  const ids = outcomes.map(item => item.observationId);
  if (new Set(ids).size !== ids.length) {
    throw new ShadowSampleContractError(`${field} observationId values must be unique.`);
  }
  return outcomes.sort((left, right) => left.observationId.localeCompare(right.observationId));
}

function parseLegacyBaseline(
  value: unknown,
  field: string,
  fixtureRevision: string,
): ShadowSampleLegacyBaseline {
  if (!isRecord(value)) {
    throw new ShadowSampleContractError(`${field} must be an object.`);
  }
  // Accept { metadata..., result: {...} } as well as the flat fixture form.
  const result = isRecord(value.result) ? value.result : {};
  const raw = { ...result, ...value };
  delete raw.result;

  const captureKind = asCaptureKind(raw.captureKind, `${field}.captureKind`);
  const model = requireNonEmptyString(raw.model, `${field}.model`);
  const harness = requireNonEmptyString(raw.harness, `${field}.harness`);
  const capturedAt = requireNonEmptyString(raw.capturedAt, `${field}.capturedAt`);
  if (Number.isNaN(Date.parse(capturedAt))) {
    throw new ShadowSampleContractError(`${field}.capturedAt is not parseable.`);
  }
  const evidenceLocator = requireNonEmptyString(raw.evidenceLocator, `${field}.evidenceLocator`);
  const baselineRevision = requireNonEmptyString(raw.fixtureRevision, `${field}.fixtureRevision`);
  if (baselineRevision !== fixtureRevision) {
    throw new ShadowSampleContractError(
      `${field}.fixtureRevision must equal matrix fixtureRevision (${fixtureRevision}).`,
    );
  }

  const nestedDiffTarget = isRecord(raw.diffTarget) ? raw.diffTarget : undefined;
  const diffKind = raw.diffKind ?? raw.diffTargetKind ?? nestedDiffTarget?.kind;
  if (typeof diffKind !== 'string' || !VALID_DIFF_KINDS.has(diffKind as ReviewDiffTarget['kind'])) {
    throw new ShadowSampleContractError(`${field}.diffKind is invalid.`);
  }
  const verdictClass = raw.verdictClass;
  if (typeof verdictClass !== 'string' || !VALID_VERDICTS.has(verdictClass as ReviewVerdict)) {
    throw new ShadowSampleContractError(`${field}.verdictClass is invalid.`);
  }
  const scopeOutcome = raw.scopeOutcome;
  if (scopeOutcome !== 'pass' && scopeOutcome !== 'fail') {
    throw new ShadowSampleContractError(`${field}.scopeOutcome is invalid.`);
  }
  const authorityOutcome = raw.authorityOutcome === 'fail' ? 'blocked' : raw.authorityOutcome;
  if (authorityOutcome !== 'pass' && authorityOutcome !== 'blocked') {
    throw new ShadowSampleContractError(`${field}.authorityOutcome is invalid.`);
  }
  const ownerRoute = raw.ownerRoute;
  if (typeof ownerRoute !== 'string' || !VALID_OWNER_ROUTES.has(ownerRoute as any)) {
    throw new ShadowSampleContractError(`${field}.ownerRoute is invalid.`);
  }
  const terminalBehavior = raw.terminalBehavior;
  if (terminalBehavior !== 'continue' && terminalBehavior !== 'report-only') {
    throw new ShadowSampleContractError(`${field}.terminalBehavior is invalid.`);
  }
  const recommendedRoute = raw.recommendedRoute;
  if (typeof recommendedRoute !== 'string' || !VALID_RECOMMENDED_ROUTES.has(recommendedRoute as any)) {
    throw new ShadowSampleContractError(`${field}.recommendedRoute is invalid.`);
  }
  const claimBoundEvidenceOutcome = raw.claimBoundEvidenceOutcome ?? raw.claimEvidenceOutcome;
  if (!['sufficient', 'insufficient', 'failed'].includes(String(claimBoundEvidenceOutcome))) {
    throw new ShadowSampleContractError(`${field}.claimBoundEvidenceOutcome is invalid.`);
  }
  const evidenceOutcome = raw.evidenceOutcome ?? claimBoundEvidenceOutcome;
  if (!['sufficient', 'insufficient', 'failed'].includes(String(evidenceOutcome))) {
    throw new ShadowSampleContractError(`${field}.evidenceOutcome is invalid.`);
  }
  if (evidenceOutcome !== claimBoundEvidenceOutcome) {
    throw new ShadowSampleContractError(`${field}.evidenceOutcome must equal claimBoundEvidenceOutcome.`);
  }

  const actualPathSetRaw = raw.actualPathSet ?? raw.actualPaths;
  const actualPathSet = normalizeStringArray(actualPathSetRaw, `${field}.actualPathSet`)
    .map(normalizeRelativePath)
    .sort();
  const validationRequestKeys = normalizeStringArray(
    raw.validationRequestKeys,
    `${field}.validationRequestKeys`,
  ).sort();
  const unexpectedWorkspaceDiffs = normalizeStringArray(
    raw.unexpectedWorkspaceDiffs,
    `${field}.unexpectedWorkspaceDiffs`,
  ).map(normalizeRelativePath).sort();
  const findingOutcomes = parseFindingOutcomes(
    raw.findingOutcomes ?? raw.findings,
    `${field}.findingOutcomes`,
  );
  const governedMutationCount = requireNonNegativeInteger(
    raw.governedMutationCount,
    `${field}.governedMutationCount`,
  );

  const metrics = raw.metrics === undefined
    ? undefined
    : isRecord(raw.metrics)
      && Object.values(raw.metrics).every(item => typeof item === 'number' && Number.isFinite(item))
      ? Object.fromEntries(Object.entries(raw.metrics).map(([key, item]) => [key, Number(item)]))
      : (() => { throw new ShadowSampleContractError(`${field}.metrics is invalid.`); })();

  return {
    captureKind,
    model,
    harness,
    capturedAt,
    evidenceLocator,
    fixtureRevision: baselineRevision,
    diffKind: diffKind as ReviewDiffTarget['kind'],
    diffTargetFingerprint: requireNonEmptyString(
      raw.diffTargetFingerprint ?? nestedDiffTarget?.fingerprint,
      `${field}.diffTargetFingerprint`,
    ),
    actualPathSet,
    verdictClass: verdictClass as ReviewVerdict,
    scopeOutcome,
    authorityOutcome,
    ownerRoute: ownerRoute as ShadowSampleLegacyBaseline['ownerRoute'],
    terminalBehavior,
    governedMutationCount,
    evidenceOutcome: evidenceOutcome as ShadowSampleLegacyBaseline['evidenceOutcome'],
    claimBoundEvidenceOutcome: claimBoundEvidenceOutcome as ShadowSampleLegacyBaseline['claimBoundEvidenceOutcome'],
    validationRequestKeys,
    findingOutcomes,
    recommendedRoute: recommendedRoute as ReviewShadowResult['recommendedRoute'],
    unexpectedWorkspaceDiffs,
    ...(typeof raw.wording === 'string' ? { wording: raw.wording } : {}),
    ...(metrics ? { metrics } : {}),
  };
}

function parseCase(value: unknown, index: number, fixtureRevision: string): ShadowSampleCase {
  if (!isRecord(value)) {
    throw new ShadowSampleContractError(`cases[${index}] must be an object.`);
  }
  const id = requireNonEmptyString(value.id, `cases[${index}].id`);
  const scenario = requireNonEmptyString(value.scenario, `cases[${index}].scenario`);
  const request = value.request === undefined
    ? {}
    : isRecord(value.request)
      ? cloneRecord(value.request)
      : (() => { throw new ShadowSampleContractError(`cases[${index}].request must be an object.`); })();
  const files: Record<string, string> = {};
  if (value.files !== undefined) {
    if (!isRecord(value.files)) {
      throw new ShadowSampleContractError(`cases[${index}].files must be an object.`);
    }
    for (const [relativePath, content] of Object.entries(value.files)) {
      const normalized = normalizeRelativePath(relativePath);
      if (!normalized || path.isAbsolute(relativePath) || normalized.includes('..')) {
        throw new ShadowSampleContractError(`cases[${index}].files contains unsafe path ${relativePath}.`);
      }
      if (typeof content !== 'string') {
        throw new ShadowSampleContractError(`cases[${index}].files.${relativePath} must be a string.`);
      }
      files[normalized] = content;
    }
  }
  const legacy = parseLegacyBaseline(
    value.legacy ?? value.legacyResult,
    `cases[${index}].legacy`,
    fixtureRevision,
  );
  return {
    id,
    scenario,
    request,
    legacy,
    files,
    ...(value.sourceTuple === undefined ? {} : { sourceTuple: structuredClone(value.sourceTuple) }),
  };
}

function parseRequiredAxes(value: unknown): ShadowSampleAxes | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    throw new ShadowSampleContractError('requiredAxes must be an object.');
  }
  const models = normalizeStringArray(value.models, 'requiredAxes.models').sort();
  const harnesses = normalizeStringArray(value.harnesses, 'requiredAxes.harnesses').sort();
  if (models.length === 0 || harnesses.length === 0) {
    throw new ShadowSampleContractError('requiredAxes.models and requiredAxes.harnesses must be non-empty.');
  }
  return { models, harnesses };
}

export function parseShadowSampleMatrix(content: string): ShadowSampleMatrix {
  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch (error) {
    throw new ShadowSampleContractError(`matrix YAML is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) {
    throw new ShadowSampleContractError('matrix must be an object.');
  }
  if (parsed.schemaVersion !== WORKFLOW_SHADOW_SAMPLE_SCHEMA_VERSION) {
    throw new ShadowSampleContractError(`schemaVersion must be ${WORKFLOW_SHADOW_SAMPLE_SCHEMA_VERSION}.`);
  }
  const fixtureRevision = requireNonEmptyString(parsed.fixtureRevision, 'fixtureRevision');
  const rawRequired = parsed.requiredScenarios === undefined
    ? [...REQUIRED_SHADOW_SAMPLE_SCENARIOS]
    : normalizeStringArray(parsed.requiredScenarios, 'requiredScenarios');
  const requiredScenarios = [...new Set([...REQUIRED_SHADOW_SAMPLE_SCENARIOS, ...rawRequired])];
  const defaultsRaw = parsed.defaults;
  const defaults = defaultsRaw === undefined
    ? { request: {} }
    : isRecord(defaultsRaw)
      ? {
          request: defaultsRaw.request === undefined
            ? {}
            : isRecord(defaultsRaw.request)
              ? cloneRecord(defaultsRaw.request)
              : (() => { throw new ShadowSampleContractError('defaults.request must be an object.'); })(),
        }
      : (() => { throw new ShadowSampleContractError('defaults must be an object.'); })();
  const rawCases = parsed.cases ?? parsed.samples;
  if (!Array.isArray(rawCases)) {
    throw new ShadowSampleContractError('cases must be an array.');
  }
  const cases = rawCases.map((item, index) => parseCase(item, index, fixtureRevision));
  const caseIds = cases.map(item => item.id);
  if (new Set(caseIds).size !== caseIds.length) {
    throw new ShadowSampleContractError('case ids must be unique.');
  }
  return {
    schemaVersion: WORKFLOW_SHADOW_SAMPLE_SCHEMA_VERSION,
    fixtureRevision,
    ...(parsed.sourceTuple === undefined ? {} : { sourceTuple: structuredClone(parsed.sourceTuple) }),
    requiredScenarios,
    requiredAxes: parseRequiredAxes(parsed.requiredAxes ?? parsed.axes),
    defaults,
    cases,
  };
}

export const parseWorkflowShadowSampleMatrix = parseShadowSampleMatrix;

function walkFiles(root: string): string[] {
  const files: string[] = [];
  function walk(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = normalizeRelativePath(path.relative(root, absolute));
      if (entry.isSymbolicLink()) {
        files.push(relative);
      } else if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile()) {
        files.push(relative);
      }
    }
  }
  walk(root);
  return files.sort();
}

function captureSnapshot(root: string): Snapshot {
  const files = new Map<string, string>();
  for (const relative of walkFiles(root)) {
    const absolute = path.join(root, ...relative.split('/'));
    const stat = fs.lstatSync(absolute);
    const digest = stat.isSymbolicLink()
      ? sha256(`symlink:${fs.readlinkSync(absolute)}`)
      : sha256(fs.readFileSync(absolute));
    files.set(relative, digest);
  }
  return {
    digest: sha256([...files].map(([relative, digest]) => `${relative}\0${digest}`).join('\n')),
    files,
  };
}

function inspectFixtureCopy(root: string): string[] {
  const blockers: string[] = [];
  let entries = 0;
  let totalBytes = 0;
  let limitExceeded = false;

  function walk(directory: string): void {
    if (limitExceeded) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = normalizeRelativePath(path.relative(root, absolute));
      const stat = fs.lstatSync(absolute);
      entries += 1;
      if (entries > MAX_FIXTURE_COPY_ENTRIES) {
        blockers.push(`fixture-copy-entry-limit-exceeded:${MAX_FIXTURE_COPY_ENTRIES}`);
        limitExceeded = true;
        return;
      }
      if (entry.isSymbolicLink()) {
        blockers.push(`fixture-copy-symlink-unsupported:${relative}`);
      } else if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile()) {
        totalBytes += stat.size;
        if (totalBytes > MAX_FIXTURE_COPY_BYTES) {
          blockers.push(`fixture-copy-byte-limit-exceeded:${MAX_FIXTURE_COPY_BYTES}`);
          limitExceeded = true;
          return;
        }
      }
    }
  }

  walk(root);
  return [...new Set(blockers)];
}

function snapshotDiff(before: Snapshot, after: Snapshot): string[] {
  const paths = new Set([...before.files.keys(), ...after.files.keys()]);
  return [...paths].filter(relative => before.files.get(relative) !== after.files.get(relative)).sort();
}

function pathMatchesPattern(relative: string, pattern: string): boolean {
  const file = normalizeRelativePath(relative);
  const candidate = normalizeRelativePath(pattern);
  if (candidate.endsWith('/**')) {
    const prefix = candidate.slice(0, -3).replace(/\/$/, '');
    return file === prefix || file.startsWith(`${prefix}/`);
  }
  if (!candidate.includes('*')) return file === candidate || file.startsWith(`${candidate}/`);
  const expression = `^${candidate.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`;
  return new RegExp(expression).test(file);
}

function declaredEphemeral(relative: string, patterns: string[]): boolean {
  return patterns.some(pattern => pathMatchesPattern(relative, pattern));
}

function cleanupEphemeralEffects(root: string, effects: string[], patterns: string[]): 'not-required' | 'success' | 'failed' {
  const ephemeralEffects = effects.filter(relative => declaredEphemeral(relative, patterns));
  if (ephemeralEffects.length === 0) return 'not-required';
  try {
    for (const relative of ephemeralEffects) {
      const absolute = path.join(root, ...relative.split('/'));
      if (fs.existsSync(absolute) || fs.lstatSync(absolute, { throwIfNoEntry: false })) {
        fs.rmSync(absolute, { recursive: true, force: true });
      }
    }
    return 'success';
  } catch {
    return 'failed';
  }
}

function copyFixtureRoot(source: string): string {
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-shadow-sample-'));
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(source, destination, {
    recursive: true,
    force: true,
    errorOnExist: false,
    dereference: false,
  });
  return destination;
}

function writeOverlay(root: string, files: Record<string, string>): void {
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, ...relative.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
  }
}

function defaultRequest(sample: ShadowSampleCase, root: string): ReviewShadowRequest {
  const observation: ReviewObservation = {
    id: 'O1',
    category: 'correctness',
    severity: 'major',
    location: 'src/example.ts:value',
    scopePath: 'src/example.ts',
    failureScenario: 'The accepted behavior is not preserved.',
    violatedInvariant: 'The acceptance claim must remain true.',
    ownerSource: 'acceptance',
    evidenceRefs: ['E1'],
    speculative: false,
    mechanical: true,
    rootCause: 'confirmed',
    resolutionOwner: 'model-mechanical',
  };
  const evidence: ReviewEvidence = {
    id: 'E1',
    kind: 'test',
    claimIds: ['C1'],
    status: 'passed',
    locator: 'test/example.test.ts',
    persistent: true,
    ownerSource: 'acceptance',
  };
  return {
    schemaVersion: 1,
    requestId: `${sample.id}-shadow`,
    mode: 'default',
    reviewCyclePhase: 'discovery',
    targetRootIdentity: buildTargetRootIdentity(root, 'isolated-target'),
    taskIdentity: null,
    lifecycleTuple: null,
    diffTarget: {
      kind: 'patch',
      description: `${sample.id} fixture patch`,
      base: 'fixture-base',
      head: null,
      fingerprint: `diff-${sample.id}`,
    },
    goalAndClaims: ['C1'],
    scope: {
      allowed: ['src/**'],
      conditional: [],
      forbidden: ['.git/**', 'node_modules/**'],
      conditionalAuthorizations: [],
    },
    changedPaths: ['src/example.ts'],
    changedSymbols: ['value'],
    changedSurfaces: ['typescript-module'],
    riskTriggers: [],
    evidence: [evidence],
    observations: [observation],
    convergence: {
      repairRounds: 0,
      verificationNewFindingWaves: 0,
      attemptsByFingerprint: {},
      knownFingerprints: [],
    },
    contextBudget: { maxItems: 60, maxSummaryBytes: 80_000 },
    declaredEphemeralPaths: [],
  };
}

function buildRequest(matrix: ShadowSampleMatrix, sample: ShadowSampleCase, root: string): ReviewShadowRequest {
  const merged = mergeRecords(defaultRequest(sample, root) as unknown as JsonRecord, matrix.defaults.request, sample.request);
  const identity = isRecord(merged.targetRootIdentity) ? merged.targetRootIdentity : {};
  const relationship = identity.relationship === 'source'
    || identity.relationship === 'shared-git-conflict'
    || identity.relationship === 'unknown'
    ? identity.relationship
    : 'isolated-target';
  merged.targetRootIdentity = buildTargetRootIdentity(root, relationship as TargetRootIdentity['relationship']);
  merged.requestId = typeof merged.requestId === 'string' && merged.requestId.trim()
    ? merged.requestId
    : `${sample.id}-shadow`;
  return merged as unknown as ReviewShadowRequest;
}

function scopeOutcome(result: ReviewShadowResult): 'pass' | 'fail' {
  return result.dimensions.find(dimension => dimension.id === 'scope')?.status === 'pass' ? 'pass' : 'fail';
}

function authorityOutcome(result: ReviewShadowResult): 'pass' | 'blocked' {
  const authorityMarkers = [
    'target-root-identity-mismatch',
    'target-root-shared-git-conflict',
    'expected-current-task-missing',
    'current-task-state-invalid',
    'canonical-',
    'claim-not-in-current-task:',
    'lifecycle-tuple-mismatch:',
  ];
  return result.blockers.some(blocker => authorityMarkers.some(marker =>
    marker.endsWith('-') ? blocker.startsWith(marker) : blocker === marker || blocker.startsWith(marker)))
    ? 'blocked'
    : 'pass';
}

function claimBoundEvidenceOutcome(result: ReviewShadowResult): ShadowSampleSemanticView['claimBoundEvidenceOutcome'] {
  const evidenceDimension = result.dimensions.find(dimension => dimension.id === 'evidence');
  if (evidenceDimension?.status === 'finding') return 'failed';
  if (result.dimensions.some(dimension => dimension.status === 'needs-evidence')) return 'insufficient';
  return 'sufficient';
}

function ownerRoute(result: ReviewShadowResult): ShadowSampleLegacyBaseline['ownerRoute'] {
  if (result.findings.some(finding => finding.ownerRoute === 'user')) return 'user';
  if (result.findings.some(finding => finding.ownerRoute === 'debug' || finding.budgetState !== 'available')) return 'debug';
  if (result.findings.some(finding => finding.ownerRoute === 'repair')) return 'repair';
  return 'none';
}

function semanticView(result: ReviewShadowResult, executionUnexpected: string[] = []): ShadowSampleSemanticView {
  return {
    diffKind: result.diffTarget.kind,
    diffTargetFingerprint: result.diffTarget.fingerprint,
    actualPathSet: [...new Set(result.diffTargetVerification.actualPaths.map(normalizeRelativePath))].sort(),
    verdict: result.verdict,
    scopeOutcome: scopeOutcome(result),
    authorityOutcome: authorityOutcome(result),
    claimBoundEvidenceOutcome: claimBoundEvidenceOutcome(result),
    validationRequestKeys: result.validationRequests
      .map(request => `${request.dimension}:${request.requiredEvidenceKind}`)
      .sort(),
    findingOutcomes: result.findings.map(finding => ({
      observationId: finding.observationId,
      fingerprint: finding.fingerprint,
      admitted: finding.admitted,
      ownerRoute: finding.ownerRoute,
      budgetState: finding.budgetState,
    })).sort((left, right) => left.observationId.localeCompare(right.observationId)),
    ownerRoute: ownerRoute(result),
    terminalBehavior: result.terminalBehavior,
    recommendedRoute: result.recommendedRoute,
    // The outer audit is authoritative for ignored control paths too.  A
    // mutation missed by the inner shadow snapshot cannot be reported as zero.
    governedMutationCount: result.governedMutationCount + executionUnexpected.length,
    unexpectedWorkspaceDiffs: [...new Set([
      ...result.unexpectedWorkspaceDiffs,
      ...executionUnexpected,
    ].map(normalizeRelativePath))].sort(),
  };
}

function baselineView(baseline: ShadowSampleLegacyBaseline): ShadowSampleSemanticView {
  return {
    diffKind: baseline.diffKind,
    diffTargetFingerprint: baseline.diffTargetFingerprint,
    actualPathSet: [...baseline.actualPathSet].sort(),
    verdict: baseline.verdictClass,
    scopeOutcome: baseline.scopeOutcome,
    authorityOutcome: baseline.authorityOutcome,
    claimBoundEvidenceOutcome: baseline.claimBoundEvidenceOutcome,
    validationRequestKeys: [...baseline.validationRequestKeys].sort(),
    findingOutcomes: baseline.findingOutcomes.map(item => ({ ...item })).sort((left, right) => left.observationId.localeCompare(right.observationId)),
    ownerRoute: baseline.ownerRoute,
    terminalBehavior: baseline.terminalBehavior,
    recommendedRoute: baseline.recommendedRoute,
    governedMutationCount: baseline.governedMutationCount,
    unexpectedWorkspaceDiffs: [...baseline.unexpectedWorkspaceDiffs].sort(),
  };
}

function compareSemanticViews(
  baseline: ShadowSampleLegacyBaseline,
  result: ReviewShadowResult | null,
  executionUnexpected: string[] = [],
): ShadowSampleComparison {
  const legacy = baselineView(baseline);
  const shadow = result ? semanticView(result, executionUnexpected) : null;
  const hardMismatches: string[] = [];
  if (!shadow) {
    hardMismatches.push('shadow-result-unavailable');
  } else {
    const compare = (field: keyof ShadowSampleSemanticView, label: string): void => {
      if (stableJson(legacy[field]) !== stableJson(shadow[field])) hardMismatches.push(label);
    };
    compare('diffKind', 'diff-kind');
    compare('diffTargetFingerprint', 'diff-target-fingerprint');
    compare('actualPathSet', 'actual-path-set');
    compare('verdict', 'verdict');
    compare('scopeOutcome', 'scope-outcome');
    compare('authorityOutcome', 'authority-outcome');
    compare('claimBoundEvidenceOutcome', 'claim-bound-evidence-outcome');
    compare('validationRequestKeys', 'validation-request-key-set');
    compare('findingOutcomes', 'finding-outcomes');
    compare('ownerRoute', 'owner-route');
    compare('terminalBehavior', 'terminal-behavior');
    compare('recommendedRoute', 'recommended-route');
    compare('governedMutationCount', 'governed-mutation-count');
    compare('unexpectedWorkspaceDiffs', 'unexpected-workspace-diffs');
  }
  const softDifferences: string[] = [];
  if (baseline.wording !== undefined) softDifferences.push('wording');
  if (baseline.metrics) {
    for (const key of ['tokens', 'latency', 'latencyMs', 'turns', 'toolCount', 'tool-count']) {
      if (Object.prototype.hasOwnProperty.call(baseline.metrics, key)) softDifferences.push(key);
    }
    if (softDifferences.every(item => !['tokens', 'latency', 'latencyMs', 'turns', 'toolCount', 'tool-count'].includes(item))) {
      softDifferences.push('cost-metrics');
    }
  }
  return {
    hardMismatches: [...new Set(hardMismatches)],
    softDifferences: [...new Set(softDifferences)],
    equivalent: hardMismatches.length === 0,
    legacy,
    shadow,
  };
}

export function compareShadowSample(
  baseline: ShadowSampleLegacyBaseline,
  result: ReviewShadowResult,
  executionUnexpected: string[] = [],
): ShadowSampleComparison {
  return compareSemanticViews(baseline, result, executionUnexpected);
}

export const compareLegacyAndShadowSample = compareShadowSample;

function makeBlockedReport(
  fixtureRoot: string,
  fixtureRevision: string,
  blocker: string,
  generatedAt: string,
): ShadowSampleSuiteReport {
  return {
    schemaVersion: WORKFLOW_SHADOW_SAMPLE_SCHEMA_VERSION,
    generatedAt,
    fixtureRoot,
    fixtureRevision,
    fixtureSourceDigest: null,
    status: 'blocked',
    legacyRemainsAuthoritative: true,
    hardMismatches: [{ sampleId: 'matrix', scenario: 'matrix', fields: [blocker] }],
    softDifferences: [],
    coverage: {
      requiredScenarioIds: [...REQUIRED_SHADOW_SAMPLE_SCENARIOS],
      declaredScenarioIds: [],
      coveredScenarioIds: [],
      missingScenarioIds: [...REQUIRED_SHADOW_SAMPLE_SCENARIOS],
      unknownScenarioIds: [],
      duplicateScenarioIds: [],
      totalCases: 0,
      executedCases: 0,
      blockedCases: 0,
      full: false,
      missingScenarioAxisCells: [],
    },
    observedModelHarnessAxes: {
      declared: false,
      requiredModels: [],
      requiredHarnesses: [],
      models: [],
      harnesses: [],
      pairs: [],
      missingPairs: [],
    },
    promotionEvidenceEligible: false,
    promotionEvidenceStatus: 'not-assessed',
    blockers: [blocker],
    samples: [],
  };
}

function generatedAt(options: ShadowSampleSuiteOptions): string {
  const value = options.now instanceof Date ? options.now.toISOString() : options.now;
  return value ?? new Date().toISOString();
}

function sampleStatus(blockerCount: number, hardMismatchCount: number): ShadowSampleStatus {
  if (blockerCount > 0) return 'blocked';
  if (hardMismatchCount > 0) return 'failed';
  return 'passed';
}

function sampleTupleMatches(matrix: ShadowSampleMatrix, sample: ShadowSampleCase): boolean {
  return stableJson(matrix.sourceTuple) === stableJson(sample.sourceTuple ?? matrix.sourceTuple);
}

function applyObservedBaseline(
  baseline: ShadowSampleLegacyBaseline,
  returned: ShadowSampleLegacyBaseline,
): ShadowSampleLegacyBaseline {
  // Re-parse a callback result through the same structural contract. This
  // prevents a caller from smuggling a plain LegacyReviewResult into an
  // observed evidence cell.
  const parsed = parseLegacyBaseline(returned, 'legacy callback result', baseline.fixtureRevision);
  if (parsed.captureKind === 'observed') {
    if (parsed.evidenceLocator === baseline.evidenceLocator) {
      throw new ShadowSampleContractError(
        'legacy callback observed capture requires a fresh evidenceLocator.',
      );
    }
    if (parsed.capturedAt === baseline.capturedAt) {
      throw new ShadowSampleContractError(
        'legacy callback observed capture requires a fresh capturedAt.',
      );
    }
  }
  return parsed;
}

function runOneSample(
  matrix: ShadowSampleMatrix,
  sample: ShadowSampleCase,
  fixtureRoot: string,
  options: ShadowSampleSuiteOptions,
): ShadowSampleRun {
  let legacyRoot = '';
  let shadowRoot = '';
  let baseline = sample.legacy;
  const blockers: string[] = [];
  try {
    legacyRoot = copyFixtureRoot(fixtureRoot);
    shadowRoot = copyFixtureRoot(fixtureRoot);
    // Overlays are applied only to clones; the live fixture is never used as
    // an execution root.
    writeOverlay(legacyRoot, sample.files);
    writeOverlay(shadowRoot, sample.files);
    if (!sampleTupleMatches(matrix, sample)) blockers.push('source-tuple-mismatch');

    const legacyBefore = captureSnapshot(legacyRoot);
    if (options.runLegacy) {
      baseline = applyObservedBaseline(baseline, options.runLegacy(legacyRoot, sample, baseline));
    }
    const legacyAfter = captureSnapshot(legacyRoot);
    const legacyWorkspaceDiffs = snapshotDiff(legacyBefore, legacyAfter);
    if (legacyWorkspaceDiffs.length > 0) blockers.push('legacy-workspace-diff');

    const shadowBefore = captureSnapshot(shadowRoot);
    let shadowResult: ReviewShadowResult | null = null;
    try {
      const request = buildRequest(matrix, sample, shadowRoot);
      parseReviewShadowRequest(request);
      shadowResult = runReviewChangeShadow(shadowRoot, request);
    } catch (error) {
      blockers.push(`shadow-execution:${error instanceof Error ? error.message : String(error)}`);
    }
    const shadowAfter = captureSnapshot(shadowRoot);
    const shadowWorkspaceDiffs = snapshotDiff(shadowBefore, shadowAfter);
    const declaredEphemeralPaths = (() => {
      const merged = mergeRecords(defaultRequest(sample, shadowRoot) as unknown as JsonRecord, matrix.defaults.request, sample.request);
      return Array.isArray(merged.declaredEphemeralPaths)
        ? merged.declaredEphemeralPaths.filter(item => typeof item === 'string') as string[]
        : [];
    })();
    const createdEphemeralEffects = shadowWorkspaceDiffs.filter(relative =>
      declaredEphemeral(relative, declaredEphemeralPaths));
    const unexpectedWorkspaceDiffs = shadowWorkspaceDiffs.filter(relative =>
      !declaredEphemeral(relative, declaredEphemeralPaths));
    if (unexpectedWorkspaceDiffs.length > 0) blockers.push('shadow-workspace-diff');
    const cleanupStatus = cleanupEphemeralEffects(shadowRoot, createdEphemeralEffects, declaredEphemeralPaths);
    if (cleanupStatus === 'failed') blockers.push('ephemeral-cleanup-failed');

    const comparison = compareSemanticViews(baseline, shadowResult, unexpectedWorkspaceDiffs);
    const hardMismatches = [...comparison.hardMismatches];
    if (legacyWorkspaceDiffs.length > 0) hardMismatches.push('legacy-workspace-diff');
    if (cleanupStatus === 'failed') hardMismatches.push('cleanup-failed');
    if (baseline.captureKind === 'observed' && !options.runLegacy) {
      // An observed capture is still valid historical evidence, but the suite
      // records that this invocation did not re-execute it.
      blockers.push('observed-baseline-not-reexecuted');
    }
    const uniqueHard = [...new Set(hardMismatches)];
    const status = sampleStatus(blockers.length, uniqueHard.length);
    const audit: ShadowSampleExecutionAudit = {
      legacyRoot,
      shadowRoot,
      legacyPreDigest: legacyBefore.digest,
      legacyPostDigest: legacyAfter.digest,
      shadowPreDigest: shadowBefore.digest,
      shadowPostDigest: shadowAfter.digest,
      legacyWorkspaceDiffs,
      shadowWorkspaceDiffs,
      unexpectedWorkspaceDiffs,
      createdEphemeralEffects,
      cleanupStatus,
    };
    return {
      id: sample.id,
      scenario: sample.scenario,
      status,
      captureKind: baseline.captureKind,
      model: baseline.model,
      harness: baseline.harness,
      legacyBaseline: baseline,
      legacyAuthoritative: true,
      legacyAuthoritativeVerdict: baseline.verdictClass,
      comparison: {
        ...comparison,
        hardMismatches: uniqueHard,
      },
      hardMismatches: uniqueHard,
      softDifferences: comparison.softDifferences,
      executionAudit: audit,
      shadowResult,
      blockers: [...new Set(blockers)],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      id: sample.id,
      scenario: sample.scenario,
      status: 'blocked',
      captureKind: null,
      model: null,
      harness: null,
      legacyBaseline: null,
      legacyAuthoritative: true,
      legacyAuthoritativeVerdict: null,
      comparison: null,
      hardMismatches: ['sample-execution'],
      softDifferences: [],
      executionAudit: null,
      shadowResult: null,
      blockers: [message],
    };
  } finally {
    for (const root of [legacyRoot, shadowRoot]) {
      if (root) {
        try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* report is already blocked below */ }
      }
    }
  }
}

function buildCoverage(matrix: ShadowSampleMatrix, runs: ShadowSampleRun[]): ShadowSampleCoverage {
  const requiredScenarioIds = [...new Set(matrix.requiredScenarios.length > 0
    ? matrix.requiredScenarios
    : [...REQUIRED_SHADOW_SAMPLE_SCENARIOS])];
  const declaredScenarioIds = [...new Set(matrix.cases.map(item => item.scenario))].sort();
  const coveredScenarioIds = [...new Set(runs.map(item => item.scenario))].sort();
  const missingScenarioIds = requiredScenarioIds.filter(id => !coveredScenarioIds.includes(id));
  const unknownScenarioIds = declaredScenarioIds.filter(id => !requiredScenarioIds.includes(id));
  const counts = new Map<string, number>();
  for (const sample of matrix.cases) counts.set(sample.scenario, (counts.get(sample.scenario) ?? 0) + 1);
  const duplicateScenarioIds = [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id).sort();
  return {
    requiredScenarioIds,
    declaredScenarioIds,
    coveredScenarioIds,
    missingScenarioIds,
    unknownScenarioIds,
    duplicateScenarioIds,
    totalCases: matrix.cases.length,
    executedCases: runs.filter(item => item.status !== 'blocked').length,
    blockedCases: runs.filter(item => item.status === 'blocked').length,
    full: missingScenarioIds.length === 0 && unknownScenarioIds.length === 0,
    missingScenarioAxisCells: [],
  };
}

function buildObservedAxes(matrix: ShadowSampleMatrix, runs: ShadowSampleRun[]): ShadowSampleObservedAxes {
  const axes = matrix.requiredAxes;
  const observedRuns = runs.filter(item => item.captureKind === 'observed');
  const pairs = [...new Set(observedRuns
    .filter(item => item.model && item.harness)
    .map(item => `${item.model}::${item.harness}`))].sort();
  const models = [...new Set(observedRuns.map(item => item.model).filter((item): item is string => Boolean(item)))].sort();
  const harnesses = [...new Set(observedRuns.map(item => item.harness).filter((item): item is string => Boolean(item)))].sort();
  const requiredPairs = axes
    ? axes.models.flatMap(model => axes.harnesses.map(harness => `${model}::${harness}`))
    : [];
  return {
    declared: Boolean(axes),
    requiredModels: axes?.models ?? [],
    requiredHarnesses: axes?.harnesses ?? [],
    models,
    harnesses,
    pairs,
    missingPairs: requiredPairs.filter(pair => !pairs.includes(pair)),
  };
}

function missingObservedScenarioAxisCells(
  matrix: ShadowSampleMatrix,
  runs: ShadowSampleRun[],
): string[] {
  const axes = matrix.requiredAxes;
  if (!axes) return [];
  const observedCells = new Set(runs
    .filter(run => run.captureKind === 'observed' && run.model && run.harness)
    .map(run => `${run.scenario}::${run.model}::${run.harness}`));
  return matrix.requiredScenarios.flatMap(scenario =>
    axes.models.flatMap(model =>
      axes.harnesses
        .map(harness => `${scenario}::${model}::${harness}`)
        .filter(cell => !observedCells.has(cell))));
}

export function runShadowSampleSuite(options: ShadowSampleSuiteOptions): ShadowSampleSuiteReport {
  const fixtureRoot = path.resolve(options.fixtureRoot);
  const timestamp = generatedAt(options);
  let matrix: ShadowSampleMatrix;
  try {
    // Re-parse object inputs as JSON/YAML too.  Otherwise a caller could
    // bypass the baseline metadata contract by passing a type-cast object.
    matrix = options.matrix
      ? parseShadowSampleMatrix(JSON.stringify(options.matrix))
      : parseShadowSampleMatrix(
        fs.readFileSync(path.resolve(options.matrixPath ?? path.join(import.meta.dir, '..', 'test', 'fixtures', 'workflow-vnext-shadow-sample-matrix.yaml')), 'utf8'),
      );
  } catch (error) {
    return makeBlockedReport(
      fixtureRoot,
      'unknown',
      `matrix-invalid:${error instanceof Error ? error.message : String(error)}`,
      timestamp,
    );
  }
  if (!fs.existsSync(fixtureRoot) || !fs.statSync(fixtureRoot).isDirectory()) {
    return makeBlockedReport(fixtureRoot, matrix.fixtureRevision, 'fixture-root-missing', timestamp);
  }
  const copyBlockers = inspectFixtureCopy(fixtureRoot);
  if (copyBlockers.length > 0) {
    return makeBlockedReport(
      fixtureRoot,
      matrix.fixtureRevision,
      copyBlockers.join(','),
      timestamp,
    );
  }

  let fixtureBefore: Snapshot;
  try {
    fixtureBefore = captureSnapshot(fixtureRoot);
  } catch (error) {
    return makeBlockedReport(
      fixtureRoot,
      matrix.fixtureRevision,
      `fixture-snapshot-failed:${error instanceof Error ? error.message : String(error)}`,
      timestamp,
    );
  }

  const runs = matrix.cases.map(sample => runOneSample(matrix, sample, fixtureRoot, options));
  const fixtureAfter = captureSnapshot(fixtureRoot);
  const fixtureSourceDigest = fixtureBefore.digest;
  const blockers: string[] = [];
  if (fixtureBefore.digest !== fixtureAfter.digest) blockers.push('fixture-live-workspace-mutated');
  const coverage = buildCoverage(matrix, runs);
  if (coverage.missingScenarioIds.length > 0) blockers.push(`missing-scenarios:${coverage.missingScenarioIds.join(',')}`);
  if (coverage.unknownScenarioIds.length > 0) blockers.push(`unknown-scenarios:${coverage.unknownScenarioIds.join(',')}`);
  const axes = buildObservedAxes(matrix, runs);
  if (axes.declared && axes.missingPairs.length > 0) blockers.push(`missing-declared-axis-pairs:${axes.missingPairs.join(',')}`);
  coverage.missingScenarioAxisCells = missingObservedScenarioAxisCells(matrix, runs);
  if (coverage.missingScenarioAxisCells.length > 0) blockers.push(`missing-scenario-axis-cells:${coverage.missingScenarioAxisCells.join(',')}`);

  const hardMismatches: ShadowSampleIssue[] = [];
  const softDifferences: ShadowSampleIssue[] = [];
  for (const run of runs) {
    if (run.hardMismatches.length > 0) {
      hardMismatches.push({ sampleId: run.id, scenario: run.scenario, fields: run.hardMismatches });
    }
    if (run.softDifferences.length > 0) {
      softDifferences.push({ sampleId: run.id, scenario: run.scenario, fields: run.softDifferences });
    }
    blockers.push(...run.blockers.map(blocker => `${run.id}:${blocker}`));
  }

  const fullCoverage = coverage.full
    && coverage.missingScenarioAxisCells.length === 0
    && runs.length === matrix.cases.length
    && runs.every(run => run.status === 'passed');
  const allObserved = runs.length > 0 && runs.every(run => run.captureKind === 'observed');
  const noHardMismatch = hardMismatches.length === 0;
  const noUnexpectedDiff = runs.every(run =>
    run.executionAudit?.unexpectedWorkspaceDiffs.length === 0
    && run.shadowResult?.unexpectedWorkspaceDiffs.length === 0);
  const promotionEvidenceEligible = Boolean(
    matrix.requiredAxes
    && fullCoverage
    && allObserved
    && noHardMismatch
    && noUnexpectedDiff
    && blockers.length === 0,
  );
  let promotionEvidenceStatus: PromotionEvidenceStatus = 'not-assessed';
  if (matrix.requiredAxes) {
    promotionEvidenceStatus = promotionEvidenceEligible ? 'eligible' : 'ineligible';
  }
  const uniqueBlockers = [...new Set(blockers)];
  const status = sampleStatus(uniqueBlockers.length, hardMismatches.length);
  return {
    schemaVersion: WORKFLOW_SHADOW_SAMPLE_SCHEMA_VERSION,
    generatedAt: timestamp,
    fixtureRoot,
    fixtureRevision: matrix.fixtureRevision,
    ...(matrix.sourceTuple === undefined ? {} : { sourceTuple: matrix.sourceTuple }),
    fixtureSourceDigest,
    status,
    legacyRemainsAuthoritative: true,
    hardMismatches,
    softDifferences,
    coverage,
    observedModelHarnessAxes: axes,
    promotionEvidenceEligible,
    promotionEvidenceStatus,
    blockers: uniqueBlockers,
    samples: runs,
  };
}

// Descriptive aliases keep callers decoupled from the implementation name.
export const runWorkflowShadowSamples = runShadowSampleSuite;
export const runLegacyVsShadowSamples = runShadowSampleSuite;
export const runWorkflowShadowSampleSuite = runShadowSampleSuite;

type CliArgs = { fixtureRoot: string; matrixPath?: string };

function parseCliArgs(argv: string[]): CliArgs {
  let fixtureRoot = process.cwd();
  let matrixPath: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--root') fixtureRoot = path.resolve(argv[++index] ?? '');
    else if (argument === '--matrix') matrixPath = path.resolve(argv[++index] ?? '');
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return { fixtureRoot, matrixPath };
}

if (import.meta.main) {
  try {
    const report = runShadowSampleSuite(parseCliArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.status === 'passed' ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
