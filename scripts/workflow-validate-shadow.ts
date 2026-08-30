#!/usr/bin/env bun

import * as crypto from 'crypto';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildTargetRootIdentity,
  resolveProjectContext,
  type TargetRootIdentity,
} from './project-context-resolver';
import { normalizeAbsoluteRootPath } from './guard-target-root';
import { loadMatrixFromProfile } from './run-validation';
import {
  inspectReviewDiffTarget,
  type DiffTargetVerification,
  type ReviewDiffTarget,
  type ReviewDimensionId,
  type ReviewEvidence,
  type ReviewEvidenceKind,
  type ReviewValidationRequest,
} from './workflow-review-shadow';

export const VALIDATE_CHANGE_SHADOW_SCHEMA_VERSION = 1 as const;

const MAX_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const MAX_AUDIT_ENTRIES = 150_000;
const MAX_AUDIT_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_SANDBOX_COPY_BYTES = 1024 * 1024 * 1024;
const OUTPUT_PREVIEW_BYTES = 4096;
const SANDBOX_COPY_EXCLUDED_ROOTS = new Set(['.git', '.tmp', 'tmp', '.cache', 'coverage', 'target', '.next']);
const EPHEMERAL_ROOTS = new Set(['.tmp', 'tmp', '.cache', 'coverage', 'target', '.next']);

const REVIEW_DIMENSIONS: readonly ReviewDimensionId[] = [
  'diff-target',
  'scope',
  'goal-and-acceptance',
  'correctness-risk',
  'evidence',
  'contract-and-propagation',
  'lifecycle',
  'design-and-visual',
  'release',
  'external-documentation',
  'host-and-generated',
  'destructive-operation',
];

const EVIDENCE_KINDS: readonly ReviewEvidenceKind[] = [
  'test',
  'inspection',
  'contract',
  'external-doc',
  'design',
  'release',
  'lifecycle',
  'approval',
  'reproduction',
];

const EVIDENCE_OWNERS: readonly Exclude<ReviewEvidence['ownerSource'], 'none'>[] = [
  'acceptance',
  'contract',
  'reproduced-bug',
  'hard-invariant',
  'concrete-regression-risk',
];

const SUBPROCESS_EVIDENCE_KINDS = new Set<ReviewEvidenceKind>([
  'test',
  'inspection',
  'contract',
  'design',
  'release',
  'lifecycle',
  'reproduction',
]);

type SnapshotEntry = {
  kind: 'directory' | 'file' | 'symlink';
  digest: string;
  size: number;
};

type StrictWorkspaceSnapshot = {
  digest: string;
  entries: Map<string, SnapshotEntry>;
  totalBytes: number;
};

export type ResolvedValidationCommand = {
  commandId: string;
  executable: string;
  args: string[];
  layer: 'protocol' | 'project';
  owner: 'workflow-system' | 'target-project';
  blockerLevel: 'blocks-generator' | 'blocks-merge' | 'blocks-ship' | 'warning-only';
  sourceLocator: string;
  sourceRevision: string;
};

export type ValidateChangeShadowRequest = {
  schemaVersion: typeof VALIDATE_CHANGE_SHADOW_SCHEMA_VERSION;
  requestId: string;
  executionPolicy: 'report-only';
  targetRootIdentity: TargetRootIdentity;
  evidenceRequest: ReviewValidationRequest;
  diffTarget: ReviewDiffTarget;
  declaredChangedPaths: string[];
  ownerSource: Exclude<ReviewEvidence['ownerSource'], 'none'>;
  persistentEvidence: boolean;
  commandId: string;
  commandSourceRevision: string;
  timeoutMs: number;
  outputLimitBytes: number;
  declaredEphemeralPaths: string[];
  cleanupPolicy: 'always';
};

export type CapturedCommandOutput = {
  bytes: number;
  digest: string;
  preview: string;
  truncated: boolean;
};

export type ValidateChangeShadowResult = {
  schemaVersion: typeof VALIDATE_CHANGE_SHADOW_SCHEMA_VERSION;
  requestId: string;
  shadowOnly: true;
  routeIsAdvisory: true;
  status: 'passed' | 'failed' | 'blocked' | 'timed-out';
  evidence: ReviewEvidence;
  command: ResolvedValidationCommand | null;
  commandSourceRevision: string | null;
  contextSourceRevision: string;
  contextVerification: {
    status: 'verified' | 'mismatch' | 'blocked';
    expectedRevision: string;
    actualRevision: string | null;
    reasons: string[];
  };
  diffTargetVerification: DiffTargetVerification;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  stdout: CapturedCommandOutput;
  stderr: CapturedCommandOutput;
  sandbox: {
    strategy: 'clean-copy';
    created: boolean;
    cleanupStatus: 'not-created' | 'cleaned' | 'failed';
    baselineDigest: string | null;
    finalDigest: string | null;
  };
  workspaceAudit: {
    beforeDigest: string | null;
    afterDigest: string | null;
    beforeBytes: number | null;
    afterBytes: number | null;
    includesGitAndDependencies: true;
  };
  executionEnvironment: {
    strategy: 'clean-copy';
    shell: false;
    platform: NodeJS.Platform;
    runtime: string;
  };
  ephemeralEffects: string[];
  unexpectedSandboxDiffs: string[];
  unexpectedWorkspaceDiffs: string[];
  governedMutationCount: number;
  blockers: string[];
  internalHandoffs: [];
};

export class ValidateChangeShadowContractError extends Error {
  constructor(message: string) {
    super(`VALIDATE_CHANGE_SHADOW_SCHEMA_INVALID: ${message}`);
    this.name = 'ValidateChangeShadowContractError';
  }
}

class SnapshotLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotLimitError';
  }
}

function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

function compareSnapshots(before: StrictWorkspaceSnapshot, after: StrictWorkspaceSnapshot): string[] {
  if (before.digest === after.digest) {
    return [];
  }
  const paths = new Set([...before.entries.keys(), ...after.entries.keys()]);
  return [...paths]
    .filter(relativePath => {
      const left = before.entries.get(relativePath);
      const right = after.entries.get(relativePath);
      return !left || !right || left.kind !== right.kind || left.digest !== right.digest || left.size !== right.size;
    })
    .sort();
}

function captureStrictSnapshot(root: string): StrictWorkspaceSnapshot {
  const entries = new Map<string, SnapshotEntry>();
  let totalBytes = 0;

  function walk(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = normalizeRelativePath(path.relative(root, absolutePath));
      const stat = fs.lstatSync(absolutePath);
      if (entries.size >= MAX_AUDIT_ENTRIES) {
        throw new SnapshotLimitError(`workspace-audit-entry-limit-exceeded:${MAX_AUDIT_ENTRIES}`);
      }
      if (entry.isSymbolicLink()) {
        const target = fs.readlinkSync(absolutePath);
        entries.set(relativePath, { kind: 'symlink', digest: sha256(target), size: Buffer.byteLength(target) });
      } else if (entry.isDirectory()) {
        entries.set(relativePath, { kind: 'directory', digest: sha256(`directory\0${stat.mode}`), size: 0 });
        walk(absolutePath);
      } else if (entry.isFile()) {
        totalBytes += stat.size;
        if (totalBytes > MAX_AUDIT_BYTES) {
          throw new SnapshotLimitError(`workspace-audit-byte-limit-exceeded:${MAX_AUDIT_BYTES}`);
        }
        entries.set(relativePath, {
          kind: 'file',
          digest: sha256(fs.readFileSync(absolutePath)),
          size: stat.size,
        });
      }
    }
  }

  walk(root);
  return {
    digest: sha256([...entries].map(([relativePath, entry]) =>
      `${relativePath}\0${entry.kind}\0${entry.size}\0${entry.digest}`).join('\n')),
    entries,
    totalBytes,
  };
}

function ephemeralPatternMatches(relativePath: string, pattern: string): boolean {
  const normalizedPath = normalizeRelativePath(relativePath);
  const normalizedPattern = normalizeRelativePath(pattern);
  if (normalizedPattern.endsWith('/**')) {
    const root = normalizedPattern.slice(0, -3);
    return normalizedPath === root || normalizedPath.startsWith(`${root}/`);
  }
  return normalizedPath === normalizedPattern;
}

function validateEphemeralPaths(paths: string[]): string[] {
  const blockers: string[] = [];
  for (const entry of paths) {
    const normalized = normalizeRelativePath(entry);
    const wildcardIndex = normalized.indexOf('*');
    const wildcardIsTerminalTree = wildcardIndex < 0 || normalized.endsWith('/**') && wildcardIndex === normalized.length - 2;
    const rootSegment = normalized.split('/')[0];
    if (!normalized
      || path.win32.isAbsolute(entry)
      || path.posix.isAbsolute(entry)
      || normalized.split('/').includes('..')
      || !wildcardIsTerminalTree
      || ['*', '**', '**/*'].includes(normalized)
      || !EPHEMERAL_ROOTS.has(rootSegment)) {
      blockers.push(`invalid-declared-ephemeral-path:${entry}`);
    }
  }
  return blockers;
}

function safeCommandTokens(command: string): { executable: string; args: string[] } | null {
  const normalized = command.trim();
  if (!normalized || /[\r\n\0&|;<>()`$'"\\*?\[\]]/.test(normalized)) {
    return null;
  }
  const tokens = normalized.split(/\s+/);
  if (tokens.some(token => !/^[A-Za-z0-9_./:@=,+-]+$/.test(token))) {
    return null;
  }
  const executable = tokens[0];
  if (!executable
    || executable.startsWith('-')
    || path.win32.isAbsolute(executable)
    || path.posix.isAbsolute(executable)
    || executable.split('/').includes('..')) {
    return null;
  }
  for (const token of tokens.slice(1)) {
    const candidate = token.includes('=') ? token.slice(token.indexOf('=') + 1) : token;
    if (path.win32.isAbsolute(candidate)
      || path.posix.isAbsolute(candidate)
      || normalizeRelativePath(candidate).split('/').includes('..')) {
      return null;
    }
  }
  return { executable, args: tokens.slice(1) };
}

function commandSourceInputs(
  root: string,
  parsed: { executable: string; args: string[] },
): Array<{ locator: string; digest: string }> {
  const inputs: Array<{ locator: string; digest: string }> = [];
  const executableName = path.basename(parsed.executable).toLowerCase().replace(/\.exe$/, '');
  if (['bun', 'npm', 'pnpm', 'yarn'].includes(executableName)) {
    const packagePath = path.join(root, 'package.json');
    if (fs.existsSync(packagePath) && fs.statSync(packagePath).isFile()) {
      inputs.push({ locator: 'package.json', digest: sha256(fs.readFileSync(packagePath)) });
    }
  }
  for (const argument of parsed.args) {
    if (argument.startsWith('-')) continue;
    const candidate = argument.includes('=') ? argument.slice(argument.indexOf('=') + 1) : argument;
    const normalized = normalizeRelativePath(candidate);
    if (!normalized || normalized === '.' || normalized.split('/').includes('..')) continue;
    const absolutePath = path.join(root, ...normalized.split('/'));
    if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
      inputs.push({ locator: normalized, digest: sha256(fs.readFileSync(absolutePath)) });
    }
  }
  return inputs.sort((left, right) => left.locator.localeCompare(right.locator));
}

export function resolveValidationCommand(root: string, commandId: string): ResolvedValidationCommand {
  const profilePath = path.join(root, '.workflow-system', 'PROJECT_PROFILE.yaml');
  const profileContent = fs.readFileSync(profilePath, 'utf8');
  const entrypoints = loadMatrixFromProfile(root);
  const matches = entrypoints.filter(entrypoint => entrypoint.name === commandId);
  if (matches.length !== 1) {
    throw new ValidateChangeShadowContractError(
      matches.length === 0 ? `unknown validation commandId: ${commandId}.` : `duplicate validation commandId: ${commandId}.`,
    );
  }
  const entrypoint = matches[0];
  const parsed = safeCommandTokens(entrypoint.command);
  if (!parsed) {
    throw new ValidateChangeShadowContractError(`validation command ${commandId} is unbound or uses unsafe shell grammar.`);
  }
  const sourceInputs = commandSourceInputs(root, parsed);
  const sourceRevision = sha256(`${profileContent}\0${JSON.stringify(entrypoint)}\0${JSON.stringify(sourceInputs)}`);
  return {
    commandId,
    executable: parsed.executable,
    args: parsed.args,
    layer: entrypoint.layer,
    owner: entrypoint.owner,
    blockerLevel: entrypoint.blocker_level,
    sourceLocator: `.workflow-system/PROJECT_PROFILE.yaml#validation.matrix.${commandId}`,
    sourceRevision,
  };
}

function parseReviewValidationRequest(value: unknown): ReviewValidationRequest {
  const context = isPlainObject(value) && isPlainObject(value.context) ? value.context : null;
  if (!isPlainObject(value)
    || typeof value.requestId !== 'string' || !value.requestId.trim()
    || typeof value.reviewRequestId !== 'string' || !value.reviewRequestId.trim()
    || !['discovery', 'verification'].includes(String(value.reviewCyclePhase))
    || !REVIEW_DIMENSIONS.includes(value.dimension as ReviewDimensionId)
    || !EVIDENCE_KINDS.includes(value.requiredEvidenceKind as ReviewEvidenceKind)
    || !Array.isArray(value.claimIds) || value.claimIds.length === 0
    || value.claimIds.some(claim => typeof claim !== 'string' || !claim.trim())
    || new Set(value.claimIds).size !== value.claimIds.length
    || typeof value.diffTargetFingerprint !== 'string' || !value.diffTargetFingerprint.trim()
    || typeof value.contextSourceRevision !== 'string' || !/^[0-9a-f]{64}$/i.test(value.contextSourceRevision)
    || !context
    || !(typeof context.taskIdentity === 'string' || context.taskIdentity === null)
    || !(typeof context.lifecycleTuple === 'string' || context.lifecycleTuple === null)
    || typeof context.diffTarget !== 'string' || !context.diffTarget.trim()
    || !Array.isArray(context.goalAndClaims) || context.goalAndClaims.length === 0
    || context.goalAndClaims.some(item => typeof item !== 'string' || !item.trim())
    || JSON.stringify(context.goalAndClaims) !== JSON.stringify(value.claimIds)
    || !Array.isArray(context.scopePathsAndSymbols)
    || context.scopePathsAndSymbols.some(item => typeof item !== 'string')
    || !Array.isArray(context.changedSurfaces) || context.changedSurfaces.some(item => typeof item !== 'string')
    || !Array.isArray(context.riskTriggers) || context.riskTriggers.some(item => typeof item !== 'string')
    || !isPlainObject(context.contextBudget)
    || !Number.isInteger(context.contextBudget.maxItems) || Number(context.contextBudget.maxItems) <= 0
    || !Number.isInteger(context.contextBudget.maxSummaryBytes) || Number(context.contextBudget.maxSummaryBytes) <= 0
    || typeof value.reason !== 'string' || !value.reason.trim()) {
    throw new ValidateChangeShadowContractError('evidenceRequest is invalid or incomplete.');
  }
  return value as unknown as ReviewValidationRequest;
}

function parseDiffTarget(value: unknown): ReviewDiffTarget {
  if (!isPlainObject(value)
    || !['working-tree', 'staged', 'range', 'commit', 'patch'].includes(String(value.kind))
    || typeof value.description !== 'string' || !value.description.trim()
    || typeof value.base !== 'string' || !value.base.trim()
    || !(typeof value.head === 'string' || value.head === null)
    || typeof value.fingerprint !== 'string' || !value.fingerprint.trim()) {
    throw new ValidateChangeShadowContractError('diffTarget is invalid.');
  }
  return value as unknown as ReviewDiffTarget;
}

export function parseValidateChangeShadowRequest(value: unknown): ValidateChangeShadowRequest {
  if (!isPlainObject(value)) {
    throw new ValidateChangeShadowContractError('request must be an object.');
  }
  if (value.schemaVersion !== VALIDATE_CHANGE_SHADOW_SCHEMA_VERSION) {
    throw new ValidateChangeShadowContractError(`schemaVersion must be ${VALIDATE_CHANGE_SHADOW_SCHEMA_VERSION}.`);
  }
  if (typeof value.requestId !== 'string' || !value.requestId.trim()) {
    throw new ValidateChangeShadowContractError('requestId must be a non-empty string.');
  }
  if (value.executionPolicy !== 'report-only' || value.cleanupPolicy !== 'always') {
    throw new ValidateChangeShadowContractError('executionPolicy must be report-only and cleanupPolicy must be always.');
  }
  if (!isPlainObject(value.targetRootIdentity)
    || typeof value.targetRootIdentity.absoluteRoot !== 'string'
    || !(typeof value.targetRootIdentity.gitAnchor === 'string' || value.targetRootIdentity.gitAnchor === null)
    || !['source', 'isolated-target'].includes(String(value.targetRootIdentity.relationship))) {
    throw new ValidateChangeShadowContractError('targetRootIdentity must be a known source or isolated target.');
  }
  const evidenceRequest = parseReviewValidationRequest(value.evidenceRequest);
  const diffTarget = parseDiffTarget(value.diffTarget);
  if (evidenceRequest.diffTargetFingerprint !== diffTarget.fingerprint) {
    throw new ValidateChangeShadowContractError('evidenceRequest and diffTarget fingerprints differ.');
  }
  if (!Array.isArray(value.declaredChangedPaths)
    || value.declaredChangedPaths.some(item => typeof item !== 'string'
      || path.win32.isAbsolute(item)
      || path.posix.isAbsolute(item)
      || normalizeRelativePath(item).split('/').includes('..'))) {
    throw new ValidateChangeShadowContractError('declaredChangedPaths must contain safe repository-relative paths.');
  }
  if (!EVIDENCE_OWNERS.includes(value.ownerSource as Exclude<ReviewEvidence['ownerSource'], 'none'>)) {
    throw new ValidateChangeShadowContractError('ownerSource must be a confirmed evidence owner.');
  }
  if (typeof value.persistentEvidence !== 'boolean') {
    throw new ValidateChangeShadowContractError('persistentEvidence must be boolean.');
  }
  if (typeof value.commandId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value.commandId)) {
    throw new ValidateChangeShadowContractError('commandId is invalid.');
  }
  if (typeof value.commandSourceRevision !== 'string' || !/^[0-9a-f]{64}$/i.test(value.commandSourceRevision)) {
    throw new ValidateChangeShadowContractError('commandSourceRevision must be a SHA-256 revision.');
  }
  if (!Number.isInteger(value.timeoutMs) || Number(value.timeoutMs) <= 0 || Number(value.timeoutMs) > MAX_TIMEOUT_MS) {
    throw new ValidateChangeShadowContractError(`timeoutMs must be within 1..${MAX_TIMEOUT_MS}.`);
  }
  if (!Number.isInteger(value.outputLimitBytes)
    || Number(value.outputLimitBytes) <= 0
    || Number(value.outputLimitBytes) > MAX_OUTPUT_BYTES) {
    throw new ValidateChangeShadowContractError(`outputLimitBytes must be within 1..${MAX_OUTPUT_BYTES}.`);
  }
  if (!Array.isArray(value.declaredEphemeralPaths)
    || value.declaredEphemeralPaths.some(item => typeof item !== 'string')) {
    throw new ValidateChangeShadowContractError('declaredEphemeralPaths must be an array of strings.');
  }
  const ephemeralBlockers = validateEphemeralPaths(value.declaredEphemeralPaths as string[]);
  if (ephemeralBlockers.length > 0) {
    throw new ValidateChangeShadowContractError(ephemeralBlockers.join(', '));
  }
  return {
    ...(value as unknown as ValidateChangeShadowRequest),
    evidenceRequest,
    diffTarget,
  };
}

function sandboxCopyDisposition(root: string): { blockers: string[]; totalBytes: number } {
  const blockers: string[] = [];
  let totalBytes = 0;
  let limitExceeded = false;

  function walk(directory: string): void {
    if (limitExceeded) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = normalizeRelativePath(path.relative(root, absolutePath));
      if (SANDBOX_COPY_EXCLUDED_ROOTS.has(relativePath.split('/')[0])) {
        continue;
      }
      const stat = fs.lstatSync(absolutePath);
      if (entry.isSymbolicLink()) {
        blockers.push(`sandbox-copy-symlink-unsupported:${relativePath}`);
      } else if (entry.isDirectory()) {
        walk(absolutePath);
      } else if (entry.isFile()) {
        totalBytes += stat.size;
        if (totalBytes > MAX_SANDBOX_COPY_BYTES) {
          blockers.push(`sandbox-copy-byte-limit-exceeded:${MAX_SANDBOX_COPY_BYTES}`);
          limitExceeded = true;
          return;
        }
      }
    }
  }

  walk(root);
  return { blockers: [...new Set(blockers)], totalBytes };
}

function copyWorkspaceToSandbox(root: string, sandboxWorkspace: string): void {
  fs.cpSync(root, sandboxWorkspace, {
    recursive: true,
    force: false,
    errorOnExist: true,
    filter: source => {
      const relativePath = normalizeRelativePath(path.relative(root, source));
      return !relativePath || !SANDBOX_COPY_EXCLUDED_ROOTS.has(relativePath.split('/')[0]);
    },
  });
}

function buildSanitizedEnvironment(sandboxRoot: string, sandboxWorkspace: string): NodeJS.ProcessEnv {
  const allowedKeys = [
    'PATH',
    'Path',
    'PATHEXT',
    'SystemRoot',
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
    'NUMBER_OF_PROCESSORS',
    'PROCESSOR_ARCHITECTURE',
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const key of allowedKeys) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  env.CI = '1';
  env.NO_COLOR = '1';
  env.GIT_CEILING_DIRECTORIES = sandboxRoot;
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.WORKFLOW_VALIDATE_SANDBOX = '1';
  const runtimeRoot = path.join(sandboxWorkspace, '.tmp', 'validate-runtime');
  const runtimeHome = path.join(runtimeRoot, 'home');
  const runtimeCache = path.join(runtimeRoot, 'cache');
  fs.mkdirSync(runtimeHome, { recursive: true });
  fs.mkdirSync(runtimeCache, { recursive: true });
  env.TEMP = runtimeRoot;
  env.TMP = runtimeRoot;
  env.HOME = runtimeHome;
  env.USERPROFILE = runtimeHome;
  env.APPDATA = runtimeCache;
  env.LOCALAPPDATA = runtimeCache;
  env.XDG_CACHE_HOME = runtimeCache;
  env.BUN_INSTALL_CACHE_DIR = path.join(runtimeCache, 'bun');
  env.npm_config_cache = path.join(runtimeCache, 'npm');
  return env;
}

function captureOutput(value: string, limit: number): CapturedCommandOutput {
  const bytes = Buffer.byteLength(value, 'utf8');
  const previewLimit = Math.min(limit, OUTPUT_PREVIEW_BYTES);
  let preview = '';
  for (const character of value) {
    if (Buffer.byteLength(`${preview}${character}`, 'utf8') > previewLimit) break;
    preview += character;
  }
  return {
    bytes,
    digest: sha256(value),
    preview,
    truncated: bytes > Buffer.byteLength(preview, 'utf8'),
  };
}

function emptyOutput(): CapturedCommandOutput {
  return captureOutput('', OUTPUT_PREVIEW_BYTES);
}

function evidenceStatusFor(resultStatus: ValidateChangeShadowResult['status'], commandRan: boolean): ReviewEvidence['status'] {
  if (resultStatus === 'passed') return 'passed';
  if (!commandRan) return 'not-run';
  return 'failed';
}

function validationResultStatus(
  timedOut: boolean,
  blockerCount: number,
  exitCode: number | null,
): ValidateChangeShadowResult['status'] {
  if (timedOut) return 'timed-out';
  if (blockerCount > 0) return 'blocked';
  return exitCode === 0 ? 'passed' : 'failed';
}

function contextVerificationStatus(
  reasons: string[],
  actualRevision: string | null,
): ValidateChangeShadowResult['contextVerification']['status'] {
  if (reasons.length === 0) return 'verified';
  return actualRevision === null ? 'blocked' : 'mismatch';
}

export function runValidateChangeShadow(
  root: string,
  rawRequest: ValidateChangeShadowRequest,
): ValidateChangeShadowResult {
  const request = parseValidateChangeShadowRequest(rawRequest);
  const normalizedRoot = normalizeAbsoluteRootPath(root);
  const actualIdentity = buildTargetRootIdentity(normalizedRoot, request.targetRootIdentity.relationship);
  const blockers: string[] = [];
  if (actualIdentity.absoluteRoot !== normalizeAbsoluteRootPath(request.targetRootIdentity.absoluteRoot)
    || actualIdentity.gitAnchor !== request.targetRootIdentity.gitAnchor) {
    blockers.push('target-root-identity-mismatch');
  }
  if (!SUBPROCESS_EVIDENCE_KINDS.has(request.evidenceRequest.requiredEvidenceKind)) {
    blockers.push(`evidence-kind-requires-non-subprocess-authority:${request.evidenceRequest.requiredEvidenceKind}`);
  }

  let actualContextRevision: string | null = null;
  const contextVerificationReasons: string[] = [];
  try {
    const currentContext = resolveProjectContext(normalizedRoot, {
      requestId: request.evidenceRequest.reviewRequestId,
      targetRootIdentity: request.targetRootIdentity,
      intent: 'review',
      taskIdentity: request.evidenceRequest.context.taskIdentity,
      lifecycleTuple: request.evidenceRequest.context.lifecycleTuple,
      diffTarget: request.evidenceRequest.context.diffTarget,
      goalAndClaims: request.evidenceRequest.context.goalAndClaims,
      scopePathsAndSymbols: request.evidenceRequest.context.scopePathsAndSymbols,
      changedSurfaces: request.evidenceRequest.context.changedSurfaces,
      riskTriggers: request.evidenceRequest.context.riskTriggers,
      contextBudget: request.evidenceRequest.context.contextBudget,
    });
    actualContextRevision = currentContext.sourceRevision;
    if (currentContext.sourceRevision !== request.evidenceRequest.contextSourceRevision) {
      contextVerificationReasons.push('context-source-revision-mismatch');
    }
    if (currentContext.missingRequiredContext.length > 0) {
      contextVerificationReasons.push(...currentContext.missingRequiredContext.map(reason => `context-required:${reason}`));
    }
    if (currentContext.budgetResult === 'required-context-exceeds-budget') {
      contextVerificationReasons.push('context-required-context-exceeds-budget');
    }
  } catch (error) {
    contextVerificationReasons.push(`context-verification-error:${error instanceof Error ? error.message : String(error)}`);
  }
  blockers.push(...contextVerificationReasons);

  let command: ResolvedValidationCommand | null = null;
  try {
    command = resolveValidationCommand(normalizedRoot, request.commandId);
    if (command.sourceRevision !== request.commandSourceRevision) {
      blockers.push('validation-command-source-revision-mismatch');
    }
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error));
  }

  const diffTargetVerification = inspectReviewDiffTarget(
    normalizedRoot,
    request.diffTarget,
    request.declaredChangedPaths,
  );
  if (diffTargetVerification.status === 'mismatch' || diffTargetVerification.status === 'unavailable') {
    blockers.push(...diffTargetVerification.reasons.map(reason => `diff-target-verification:${reason}`));
  }

  let originalBefore: StrictWorkspaceSnapshot | null = null;
  try {
    originalBefore = captureStrictSnapshot(normalizedRoot);
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error));
  }

  const copyDisposition = sandboxCopyDisposition(normalizedRoot);
  blockers.push(...copyDisposition.blockers);

  let sandboxParent: string | null = null;
  let sandboxWorkspace: string | null = null;
  let sandboxBefore: StrictWorkspaceSnapshot | null = null;
  let sandboxAfter: StrictWorkspaceSnapshot | null = null;
  let cleanupStatus: ValidateChangeShadowResult['sandbox']['cleanupStatus'] = 'not-created';
  let exitCode: number | null = null;
  let signal: string | null = null;
  let stdout = emptyOutput();
  let stderr = emptyOutput();
  let commandRan = false;
  let timedOut = false;
  let outputOverflow = false;
  const startedAt = Date.now();

  if (blockers.length === 0 && command && originalBefore) {
    try {
      sandboxParent = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-validate-shadow-'));
      sandboxWorkspace = path.join(sandboxParent, 'workspace');
      copyWorkspaceToSandbox(normalizedRoot, sandboxWorkspace);
      cleanupStatus = 'failed';
      const executionEnvironment = buildSanitizedEnvironment(sandboxParent, sandboxWorkspace);
      sandboxBefore = captureStrictSnapshot(sandboxWorkspace);
      commandRan = true;
      const execution = spawnSync(command.executable, command.args, {
        cwd: sandboxWorkspace,
        env: executionEnvironment,
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        timeout: request.timeoutMs,
        maxBuffer: request.outputLimitBytes,
      });
      exitCode = execution.status;
      signal = execution.signal;
      const rawStdout = String(execution.stdout ?? '');
      const rawStderr = String(execution.stderr ?? '');
      stdout = captureOutput(rawStdout, request.outputLimitBytes);
      stderr = captureOutput(rawStderr, request.outputLimitBytes);
      timedOut = (execution.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
      outputOverflow = (execution.error as NodeJS.ErrnoException | undefined)?.code === 'ENOBUFS'
        || stdout.bytes > request.outputLimitBytes
        || stderr.bytes > request.outputLimitBytes;
      if (execution.error && !timedOut && !outputOverflow) {
        blockers.push(`validation-process-error:${execution.error.message}`);
      }
      sandboxAfter = captureStrictSnapshot(sandboxWorkspace);
    } catch (error) {
      blockers.push(`validation-sandbox-error:${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (sandboxParent) {
        try {
          fs.rmSync(sandboxParent, { recursive: true, force: true });
          cleanupStatus = 'cleaned';
        } catch (error) {
          blockers.push(`validation-sandbox-cleanup-failed:${error instanceof Error ? error.message : String(error)}`);
          cleanupStatus = 'failed';
        }
      }
    }
  }

  const sandboxDiffs = sandboxBefore && sandboxAfter ? compareSnapshots(sandboxBefore, sandboxAfter) : [];
  const ephemeralEffects = sandboxDiffs.filter(relativePath =>
    ephemeralPatternMatches(relativePath, '.tmp/validate-runtime/**')
    || request.declaredEphemeralPaths.some(pattern => ephemeralPatternMatches(relativePath, pattern)));
  const unexpectedSandboxDiffs = sandboxDiffs.filter(relativePath => !ephemeralEffects.includes(relativePath));
  if (unexpectedSandboxDiffs.length > 0) blockers.push('unexpected-sandbox-diff');
  if (timedOut) blockers.push('validation-timeout');
  if (outputOverflow) blockers.push('validation-output-limit-exceeded');
  if (commandRan && cleanupStatus !== 'cleaned') blockers.push('validation-cleanup-incomplete');

  let originalAfter: StrictWorkspaceSnapshot | null = null;
  if (originalBefore) {
    try {
      originalAfter = captureStrictSnapshot(normalizedRoot);
    } catch (error) {
      blockers.push(`workspace-post-audit-failed:${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const unexpectedWorkspaceDiffs = originalBefore && originalAfter
    ? compareSnapshots(originalBefore, originalAfter)
    : [];
  if (unexpectedWorkspaceDiffs.length > 0) blockers.push('unexpected-live-workspace-diff');

  const deduplicatedBlockers = [...new Set(blockers)];
  const status = validationResultStatus(timedOut, deduplicatedBlockers.length, exitCode);
  const evidence: ReviewEvidence = {
    id: `evidence-${sha256([
      request.requestId,
      request.evidenceRequest.requestId,
      request.commandSourceRevision,
      stdout.digest,
      stderr.digest,
      String(exitCode),
      status,
    ].join('\0')).slice(0, 24)}`,
    kind: request.evidenceRequest.requiredEvidenceKind,
    claimIds: [...request.evidenceRequest.claimIds],
    status: evidenceStatusFor(status, commandRan),
    locator: command
      ? `${command.sourceLocator}@${command.sourceRevision.slice(0, 12)}`
      : `.workflow-system/PROJECT_PROFILE.yaml#validation.matrix.${request.commandId}`,
    persistent: request.persistentEvidence,
    ownerSource: request.ownerSource,
  };

  return {
    schemaVersion: VALIDATE_CHANGE_SHADOW_SCHEMA_VERSION,
    requestId: request.requestId,
    shadowOnly: true,
    routeIsAdvisory: true,
    status,
    evidence,
    command,
    commandSourceRevision: command?.sourceRevision ?? null,
    contextSourceRevision: request.evidenceRequest.contextSourceRevision,
    contextVerification: {
      status: contextVerificationStatus(contextVerificationReasons, actualContextRevision),
      expectedRevision: request.evidenceRequest.contextSourceRevision,
      actualRevision: actualContextRevision,
      reasons: contextVerificationReasons,
    },
    diffTargetVerification,
    exitCode,
    signal,
    durationMs: Date.now() - startedAt,
    stdout,
    stderr,
    sandbox: {
      strategy: 'clean-copy',
      created: sandboxParent !== null,
      cleanupStatus,
      baselineDigest: sandboxBefore?.digest ?? null,
      finalDigest: sandboxAfter?.digest ?? null,
    },
    workspaceAudit: {
      beforeDigest: originalBefore?.digest ?? null,
      afterDigest: originalAfter?.digest ?? null,
      beforeBytes: originalBefore?.totalBytes ?? null,
      afterBytes: originalAfter?.totalBytes ?? null,
      includesGitAndDependencies: true,
    },
    executionEnvironment: {
      strategy: 'clean-copy',
      shell: false,
      platform: process.platform,
      runtime: `bun-${Bun.version}`,
    },
    ephemeralEffects,
    unexpectedSandboxDiffs,
    unexpectedWorkspaceDiffs,
    governedMutationCount: unexpectedSandboxDiffs.length + unexpectedWorkspaceDiffs.length,
    blockers: deduplicatedBlockers,
    internalHandoffs: [],
  };
}

type ParsedCliArgs = { root: string; requestPath: string };

function parseCliArgs(argv: string[]): ParsedCliArgs {
  let root = process.cwd();
  let requestPath = '';
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--root') root = path.resolve(argv[++index] ?? '');
    else if (argument === '--request') requestPath = path.resolve(argv[++index] ?? '');
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!requestPath) {
    throw new Error('Usage: bun run scripts/workflow-validate-shadow.ts --request <request.json> [--root <target-root>]');
  }
  return { root, requestPath };
}

function main(): void {
  const args = parseCliArgs(process.argv.slice(2));
  const request = parseValidateChangeShadowRequest(JSON.parse(fs.readFileSync(args.requestPath, 'utf8')));
  process.stdout.write(`${JSON.stringify(runValidateChangeShadow(args.root, request), null, 2)}\n`);
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
