import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildTargetRootIdentity, resolveProjectContext } from '../scripts/project-context-resolver';
import type { ReviewValidationRequest } from '../scripts/workflow-review-shadow';
import {
  resolveValidationCommand,
  runValidateChangeShadow,
  ValidateChangeShadowContractError,
  type ValidateChangeShadowRequest,
} from '../scripts/workflow-validate-shadow';

const TEMP_ROOTS: string[] = [];

function write(root: string, relativePath: string, content: string): void {
  const target = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

function writeProfile(root: string, matrixCommand: string): void {
  write(root, '.workflow-system/PROJECT_PROFILE.yaml', [
    'project:',
    '  name: fixture',
    'paths:',
    '  workflow_home: docs/workflow',
    'boundaries:',
    '  forbidden_paths: [".git/**"]',
    'architecture_rules:',
    '  - Validation is read-only.',
    'validation:',
    '  matrix:',
    '    - name: unit',
    '      layer: project',
    `      command: ${JSON.stringify(matrixCommand)}`,
    '      blocker_level: blocks-merge',
    '      description: Fixture validation command.',
    '      phase: A4',
    '      owner: target-project',
    '',
  ].join('\n'));
}

function createProject(scriptContent: string, matrixCommand = 'bun run scripts/validate-fixture.ts'): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-validate-shadow-test-'));
  TEMP_ROOTS.push(root);
  writeProfile(root, matrixCommand);
  write(root, '.workflow-system/WORKFLOW_PROTOCOL.md', '# Protocol\n\n## Validation\nValidation is read-only.\n');
  write(root, '.workflow-system/FILE_SCHEMAS.md', '# Schemas\n\n## Evidence\nEvidence binds to a claim.\n');
  write(root, 'scripts/validate-fixture.ts', scriptContent);
  write(root, 'src/example.ts', 'export const value = 1;\n');
  write(root, 'docs/workflow/CURRENT_TASK.md', '# CURRENT_TASK\n\noriginal\n');
  return root;
}

function evidenceRequest(root: string, overrides: Partial<ReviewValidationRequest> = {}): ReviewValidationRequest {
  const context = {
    taskIdentity: null,
    lifecycleTuple: null,
    diffTarget: 'Harness-supplied fixture patch',
    goalAndClaims: ['C1'],
    scopePathsAndSymbols: ['src/example.ts'],
    changedSurfaces: [],
    riskTriggers: [],
    contextBudget: { maxItems: 40, maxSummaryBytes: 40_000 },
  };
  const contextBundle = resolveProjectContext(root, {
    requestId: 'review-request-1',
    targetRootIdentity: buildTargetRootIdentity(root, 'isolated-target'),
    intent: 'review',
    ...context,
  });
  return {
    requestId: 'validation-request-1',
    reviewRequestId: 'review-request-1',
    reviewCyclePhase: 'discovery',
    dimension: 'evidence',
    requiredEvidenceKind: 'test',
    claimIds: ['C1'],
    diffTargetFingerprint: 'patch-fixture-1',
    contextSourceRevision: contextBundle.sourceRevision,
    context,
    reason: 'C1 requires focused test evidence.',
    ...overrides,
  };
}

function request(root: string, overrides: Partial<ValidateChangeShadowRequest> = {}): ValidateChangeShadowRequest {
  const command = resolveValidationCommand(root, 'unit');
  return {
    schemaVersion: 1,
    requestId: 'validate-change-1',
    executionPolicy: 'report-only',
    targetRootIdentity: buildTargetRootIdentity(root, 'isolated-target'),
    evidenceRequest: evidenceRequest(root),
    diffTarget: {
      kind: 'patch',
      description: 'Harness-supplied fixture patch',
      base: 'harness-patch',
      head: null,
      fingerprint: 'patch-fixture-1',
    },
    declaredChangedPaths: ['src/example.ts'],
    ownerSource: 'acceptance',
    persistentEvidence: true,
    commandId: command.commandId,
    commandSourceRevision: command.sourceRevision,
    timeoutMs: 5000,
    outputLimitBytes: 64 * 1024,
    declaredEphemeralPaths: ['coverage/**'],
    cleanupPolicy: 'always',
    ...overrides,
  };
}

afterEach(() => {
  while (TEMP_ROOTS.length > 0) {
    fs.rmSync(TEMP_ROOTS.pop()!, { recursive: true, force: true });
  }
});

describe('validate-change Phase 1 side-effect-audited shadow', () => {
  test('runs an approved matrix command in a clean copy and cleans declared ephemeral effects', () => {
    const root = createProject([
      "import * as fs from 'fs';",
      "fs.mkdirSync('coverage', { recursive: true });",
      "fs.writeFileSync('coverage/result.txt', 'passed', 'utf8');",
      "process.stdout.write('fixture passed\\n');",
    ].join('\n'));
    const result = runValidateChangeShadow(root, request(root));

    expect(result.status).toBe('passed');
    expect(result.evidence).toMatchObject({
      kind: 'test',
      claimIds: ['C1'],
      status: 'passed',
      persistent: true,
      ownerSource: 'acceptance',
    });
    expect(result.command?.commandId).toBe('unit');
    expect(result.executionEnvironment).toMatchObject({ strategy: 'clean-copy', shell: false });
    expect(result.diffTargetVerification.status).toBe('harness-supplied');
    expect(result.ephemeralEffects).toContain('coverage/result.txt');
    expect(result.unexpectedSandboxDiffs).toEqual([]);
    expect(result.unexpectedWorkspaceDiffs).toEqual([]);
    expect(result.governedMutationCount).toBe(0);
    expect(result.sandbox.cleanupStatus).toBe('cleaned');
    expect(result.workspaceAudit.beforeDigest).toBe(result.workspaceAudit.afterDigest);
    expect(result.workspaceAudit.includesGitAndDependencies).toBe(true);
    expect(fs.existsSync(path.join(root, 'coverage'))).toBe(false);
  });

  test('blocks a validation command that mutates a governed path inside the sandbox', () => {
    const root = createProject([
      "import * as fs from 'fs';",
      "fs.writeFileSync('docs/workflow/CURRENT_TASK.md', 'mutated', 'utf8');",
    ].join('\n'));
    const result = runValidateChangeShadow(root, request(root));

    expect(result.status).toBe('blocked');
    expect(result.evidence.status).toBe('failed');
    expect(result.blockers).toContain('unexpected-sandbox-diff');
    expect(result.unexpectedSandboxDiffs).toContain('docs/workflow/CURRENT_TASK.md');
    expect(result.governedMutationCount).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(root, 'docs/workflow/CURRENT_TASK.md'), 'utf8')).toContain('original');
    expect(result.sandbox.cleanupStatus).toBe('cleaned');
  });

  test('reports a normal non-zero validation result as failed rather than as a schema blocker', () => {
    const root = createProject('process.exit(3);\n');
    const result = runValidateChangeShadow(root, request(root));

    expect(result.status).toBe('failed');
    expect(result.exitCode).toBe(3);
    expect(result.evidence.status).toBe('failed');
    expect(result.blockers).toEqual([]);
    expect(result.sandbox.cleanupStatus).toBe('cleaned');
  });

  test('does not execute when the canonical command or its referenced script changed', () => {
    const root = createProject("process.stdout.write('original');\n");
    const raw = request(root);
    write(root, 'scripts/validate-fixture.ts', "throw new Error('changed command source must not run');\n");
    const result = runValidateChangeShadow(root, raw);

    expect(result.status).toBe('blocked');
    expect(result.evidence.status).toBe('not-run');
    expect(result.blockers).toContain('validation-command-source-revision-mismatch');
    expect(result.sandbox.created).toBe(false);
  });

  test('does not execute when canonical project context changed after the review evidence request', () => {
    const root = createProject("throw new Error('must not run');\n");
    const raw = request(root);
    write(root, 'docs/workflow/CONTRACTS.md', '# CONTRACTS\n\n## New authority\nA new contract now applies.\n');
    const result = runValidateChangeShadow(root, raw);

    expect(result.status).toBe('blocked');
    expect(result.evidence.status).toBe('not-run');
    expect(result.contextVerification.status).toBe('mismatch');
    expect(result.contextVerification.reasons).toContain('context-source-revision-mismatch');
    expect(result.sandbox.created).toBe(false);
  });

  test('rejects shell grammar from a profile command instead of using shell execution', () => {
    const root = createProject("await Bun.write('owned.txt', 'owned');\n");
    const raw = request(root);
    writeProfile(root, 'bun run scripts/validate-fixture.ts && bun run scripts/validate-fixture.ts');

    const result = runValidateChangeShadow(root, raw);
    expect(result.status).toBe('blocked');
    expect(result.blockers.some(blocker => blocker.includes('unsafe shell grammar'))).toBe(true);
    expect(result.sandbox.created).toBe(false);
    expect(fs.existsSync(path.join(root, 'owned.txt'))).toBe(false);
  });

  test('does not turn external-documentation or approval authority into a subprocess result', () => {
    const root = createProject("throw new Error('must not run');\n");
    const base = request(root);
    const result = runValidateChangeShadow(root, {
      ...base,
      evidenceRequest: evidenceRequest(root, { requiredEvidenceKind: 'external-doc' }),
    });

    expect(result.status).toBe('blocked');
    expect(result.evidence.status).toBe('not-run');
    expect(result.blockers).toContain('evidence-kind-requires-non-subprocess-authority:external-doc');
    expect(result.sandbox.created).toBe(false);
  });

  test('detects an attempted escape that mutates the live fixture root', () => {
    const root = createProject('');
    write(root, 'scripts/validate-fixture.ts', `await Bun.write(${JSON.stringify(path.join(root, 'escaped.txt'))}, 'escaped');\n`);
    const result = runValidateChangeShadow(root, request(root));

    expect(result.status).toBe('blocked');
    expect(result.blockers).toContain('unexpected-live-workspace-diff');
    expect(result.unexpectedWorkspaceDiffs).toContain('escaped.txt');
    expect(result.governedMutationCount).toBeGreaterThan(0);
    expect(result.evidence.status).toBe('failed');
  });

  test('fails closed on broad or non-ephemeral cleanup declarations', () => {
    const root = createProject("process.stdout.write('ok');\n");

    expect(() => runValidateChangeShadow(root, request(root, { declaredEphemeralPaths: ['**'] })))
      .toThrow(ValidateChangeShadowContractError);
    expect(() => runValidateChangeShadow(root, request(root, { declaredEphemeralPaths: ['docs/**'] })))
      .toThrow(ValidateChangeShadowContractError);
  });
});
