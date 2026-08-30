import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildTargetRootIdentity } from '../scripts/project-context-resolver';
import {
  compareLegacyAndShadow,
  fingerprintReviewObservation,
  inspectInstallState,
  inspectProjectState,
  inspectReviewDiffTarget,
  ReviewShadowContractError,
  runReviewChangeShadow,
  type LegacyReviewResult,
  type ReviewObservation,
  type ReviewShadowRequest,
} from '../scripts/workflow-review-shadow';

const TEMP_ROOTS: string[] = [];

function write(root: string, relativePath: string, content: string): void {
  const target = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

function currentTaskContent(extra = ''): string {
  return [
    '# CURRENT_TASK.md',
    '',
    '## 任务信息',
    '',
    '- 任务 ID：001',
    '- 任务标题：Review shadow',
    '- 任务 slug：review-shadow',
    '- 当前状态：active',
    '- 生命周期状态：active',
    '- 恢复需审查：false',
    '- 恢复审查原因：',
    '',
    '## 验收标准',
    '',
    '- [ ] C1',
    '',
    '## 允许修改范围',
    '',
    '- scripts/**',
    '',
    '## 条件修改范围',
    '',
    '- docs/**',
    '',
    '## 禁止修改范围',
    '',
    '- .git/**',
    '',
    '## 受影响的契约',
    '',
    '- review remains read-only',
    '',
    '## 已确认决策',
    '',
    '- unified review',
    '',
    '## 回滚点',
    '',
    '- Current diff review target：working-tree',
    '',
    '## 审查问题队列',
    '',
    extra,
    '',
  ].join('\n');
}

function makeProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-review-shadow-'));
  TEMP_ROOTS.push(root);
  write(root, '.workflow-system/WORKFLOW_PROTOCOL.md', [
    '# Workflow Protocol',
    '## Review contract',
    'Review requires one explicit diff target and is read-only.',
  ].join('\n'));
  write(root, '.workflow-system/FILE_SCHEMAS.md', [
    '# File schemas',
    '## Review result',
    'A review result records verdict, evidence, and mutation count.',
  ].join('\n'));
  write(root, '.workflow-system/PROJECT_PROFILE.yaml', [
    'project:',
    '  name: fixture',
    'paths:',
    '  workflow_home: docs/workflow',
    'boundaries:',
    '  forbidden_paths: [.git/**]',
    'architecture_rules:',
    '  - Keep review read-only.',
    'validation:',
    '  preferred_checks: [bun test]',
  ].join('\n'));
  write(root, 'docs/workflow/CONTRACTS.md', '# CONTRACTS\n## Review\nReview remains read-only.\n');
  write(root, 'docs/workflow/DECISIONS.md', '# DECISIONS\n## Unified review\nUse one verdict.\n');
  write(root, 'docs/workflow/CURRENT_TASK.md', currentTaskContent());
  write(root, 'docs/workflow/STATUS.md', '# STATUS\n## Current\nTask 001 is active.\n');
  write(root, 'docs/workflow/LESSONS.md', '# LESSONS\n## Review\nDo not reset retry counters.\n');
  write(root, 'scripts/example.ts', 'export const value = 1;\n');
  return root;
}

function baseRequest(root: string, overrides: Partial<ReviewShadowRequest> = {}): ReviewShadowRequest {
  return {
    schemaVersion: 1,
    requestId: 'phase-1-review',
    mode: 'default',
    reviewCyclePhase: 'discovery',
    targetRootIdentity: buildTargetRootIdentity(root, 'isolated-target'),
    taskIdentity: '001',
    lifecycleTuple: 'active|active',
    diffTarget: {
      kind: 'working-tree',
      description: 'working-tree relative to task base',
      base: 'task-base',
      head: null,
      fingerprint: 'diff-001',
    },
    goalAndClaims: ['C1'],
    scope: {
      allowed: ['scripts/**'],
      conditional: ['docs/**'],
      forbidden: ['.git/**'],
      conditionalAuthorizations: [],
    },
    changedPaths: ['scripts/example.ts'],
    changedSymbols: ['value'],
    changedSurfaces: ['typescript-module'],
    riskTriggers: [],
    evidence: [{
      id: 'E1',
      kind: 'test',
      claimIds: ['C1'],
      status: 'passed',
      locator: 'test/example.test.ts',
      persistent: true,
      ownerSource: 'acceptance',
    }],
    observations: [],
    convergence: {
      repairRounds: 0,
      verificationNewFindingWaves: 0,
      attemptsByFingerprint: {},
      knownFingerprints: [],
    },
    contextBudget: { maxItems: 60, maxSummaryBytes: 80_000 },
    declaredEphemeralPaths: [],
    ...overrides,
  };
}

function strongObservation(overrides: Partial<ReviewObservation> = {}): ReviewObservation {
  return {
    id: 'O1',
    category: 'correctness',
    severity: 'major',
    location: 'scripts/example.ts:value',
    scopePath: 'scripts/example.ts',
    failureScenario: 'The exported value is wrong for the accepted case.',
    violatedInvariant: 'C1 requires the accepted value.',
    ownerSource: 'acceptance',
    evidenceRefs: ['E1'],
    speculative: false,
    mechanical: true,
    rootCause: 'confirmed',
    resolutionOwner: 'model-mechanical',
    ...overrides,
  };
}

function suspendedPackage(overrides: Record<string, string> = {}): string {
  const fields: Record<string, string> = {
    task_id: '007',
    task_title: 'Paused task',
    task_slug: 'paused-task',
    artifact_kind: 'paused',
    lifecycle_state: 'paused_pending_closure',
    suspension_reason: 'Waiting for validation',
    task_start_base: 'base-1',
    last_reviewed_checkpoint: 'checkpoint-1',
    current_diff_review_target: 'working-tree',
    resume_requires_review: 'true',
    resume_review_reasons: 'validation_pending',
    rehydration_status: 'ready_for_resume',
    ownership_state: 'recovery_only',
  };
  return Object.entries({ ...fields, ...overrides }).map(([key, value]) => `- ${key}: ${value}`).join('\n');
}

afterEach(() => {
  while (TEMP_ROOTS.length > 0) {
    fs.rmSync(TEMP_ROOTS.pop()!, { recursive: true, force: true });
  }
});

describe('review-change Phase 1 shadow', () => {
  test('TA-03 returns one unified clean verdict with no internal handoffs or writes', () => {
    const root = makeProject();
    const result = runReviewChangeShadow(root, baseRequest(root));

    expect(result.verdict).toBe('clean');
    expect(result.dimensions.filter(dimension => dimension.mandatory).map(dimension => dimension.id))
      .toEqual(['diff-target', 'scope', 'goal-and-acceptance', 'correctness-risk', 'evidence']);
    expect(result.internalHandoffs).toEqual([]);
    expect(result.shadowOnly).toBe(true);
    expect(result.routeIsAdvisory).toBe(true);
    expect(result.diffTargetVerification.status).toBe('harness-supplied');
    expect(result.governedMutationCount).toBe(0);
    expect(result.unexpectedWorkspaceDiffs).toEqual([]);
    expect(result.consumedContextLocators.length).toBeGreaterThan(0);
  });

  test('TA-04 report-only failure is terminal and never routes to repair or sync', () => {
    const root = makeProject();
    const request = baseRequest(root, {
      mode: 'report-only',
      evidence: [{
        id: 'E1',
        kind: 'test',
        claimIds: ['C1'],
        status: 'failed',
        locator: 'test/example.test.ts',
        persistent: true,
        ownerSource: 'acceptance',
      }],
      observations: [strongObservation()],
    });
    const result = runReviewChangeShadow(root, request);

    expect(result.verdict).toBe('findings');
    expect(result.terminalBehavior).toBe('report-only');
    expect(result.recommendedRoute).toBe('none');
    expect(result.governedMutationCount).toBe(0);
  });

  test('TA-05 sends an admitted recurring fingerprint to debug after two attempts', () => {
    const root = makeProject();
    const observation = strongObservation();
    const fingerprint = fingerprintReviewObservation(observation);
    const request = baseRequest(root, {
      observations: [observation],
      convergence: {
        repairRounds: 2,
        verificationNewFindingWaves: 0,
        attemptsByFingerprint: { [fingerprint]: 2 },
        knownFingerprints: [fingerprint],
      },
    });
    const result = runReviewChangeShadow(root, request);

    expect(result.findings[0].budgetState).toBe('exhausted');
    expect(result.verdict).toBe('needs-debug');
    expect(result.recommendedRoute).toBe('debug-task:investigate');
  });

  test('finding fingerprint stays stable when only the display location moves', () => {
    const first = strongObservation({ location: 'scripts/example.ts:10' });
    const moved = strongObservation({ location: 'scripts/example.ts:80' });

    expect(fingerprintReviewObservation(first)).toBe(fingerprintReviewObservation(moved));
  });

  test('TA-06 reports but does not admit a speculative verification edge', () => {
    const root = makeProject();
    const result = runReviewChangeShadow(root, baseRequest(root, {
      reviewCyclePhase: 'verification',
      observations: [strongObservation({ speculative: true })],
    }));

    expect(result.findings[0].admitted).toBe(false);
    expect(result.findings[0].reasons).toContain('speculative-observation');
    expect(result.verdict).toBe('clean');
    expect(result.recommendedRoute).toBe('none');
  });

  test('TA-02 triggers contract/propagation evidence for API and DTO surfaces', () => {
    const root = makeProject();
    const result = runReviewChangeShadow(root, baseRequest(root, {
      changedSurfaces: ['public-api', 'dto-schema'],
      evidence: [
        ...baseRequest(root).evidence,
        {
          id: 'E-contract',
          kind: 'contract',
          claimIds: ['C1'],
          status: 'passed',
          locator: 'docs/workflow/CONTRACTS.md#API',
          persistent: true,
          ownerSource: 'contract',
        },
      ],
    }));

    expect(result.dimensions.find(dimension => dimension.id === 'contract-and-propagation')?.status).toBe('pass');
  });

  test('requests expert validation evidence instead of inventing missing external docs', () => {
    const root = makeProject();
    const result = runReviewChangeShadow(root, baseRequest(root, {
      riskTriggers: ['third-party sdk'],
    }));

    expect(result.verdict).toBe('needs-evidence');
    expect(result.validationRequests).toHaveLength(1);
    expect(result.validationRequests[0]).toMatchObject({
      reviewRequestId: 'phase-1-review',
      reviewCyclePhase: 'discovery',
      dimension: 'external-documentation',
      requiredEvidenceKind: 'external-doc',
      claimIds: ['C1'],
      diffTargetFingerprint: 'diff-001',
      context: {
        taskIdentity: '001',
        lifecycleTuple: 'active|active',
        diffTarget: 'working-tree relative to task base',
        goalAndClaims: ['C1'],
        scopePathsAndSymbols: ['scripts/example.ts', 'value'],
        changedSurfaces: ['typescript-module'],
        riskTriggers: ['third-party sdk'],
        contextBudget: { maxItems: 60, maxSummaryBytes: 80_000 },
      },
      reason: 'The third-party, sdk trigger requires explicit external-doc evidence.',
    });
    expect(result.validationRequests[0].requestId).toMatch(/^validation-[0-9a-f]{24}$/);
    expect(result.validationRequests[0].contextSourceRevision).toMatch(/^[0-9a-f]{64}$/);
    expect(result.recommendedRoute).toBe('none');
  });

  test('a persistent test without an owner cannot prove acceptance', () => {
    const root = makeProject();
    const request = baseRequest(root);
    request.evidence[0].ownerSource = 'none';
    const result = runReviewChangeShadow(root, request);

    expect(result.verdict).toBe('needs-evidence');
    expect(result.dimensions.find(dimension => dimension.id === 'evidence')?.reasons)
      .toEqual(['Persistent evidence lacks an owner: E1']);
  });

  test('conditional evidence must be bound to a current claim', () => {
    const root = makeProject();
    const request = baseRequest(root, { riskTriggers: ['third-party sdk'] });
    request.evidence.push({
      id: 'E-external-unbound',
      kind: 'external-doc',
      claimIds: ['OTHER'],
      status: 'passed',
      locator: 'official-docs',
      persistent: true,
      ownerSource: 'contract',
    });
    const result = runReviewChangeShadow(root, request);

    expect(result.verdict).toBe('needs-evidence');
    expect(result.validationRequests[0].dimension).toBe('external-documentation');
  });

  test('failed evidence without an admitted root cause routes to investigation', () => {
    const root = makeProject();
    const request = baseRequest(root);
    request.evidence[0].status = 'failed';
    const result = runReviewChangeShadow(root, request);

    expect(result.verdict).toBe('needs-debug');
    expect(result.recommendedRoute).toBe('debug-task:investigate');
  });

  test('blocks forbidden and unowned changed paths', () => {
    const root = makeProject();
    const result = runReviewChangeShadow(root, baseRequest(root, {
      changedPaths: ['.git/config', 'README.md'],
    }));

    expect(result.verdict).toBe('blocked');
    expect(result.dimensions.find(dimension => dimension.id === 'scope')?.reasons)
      .toEqual([
        'forbidden:.git/config',
        'canonical-forbidden:.git/config',
        'unowned:README.md',
        'canonical-unowned:README.md',
      ]);
  });

  test('canonical task scope prevents a caller from broadening allowed paths', () => {
    const root = makeProject();
    const request = baseRequest(root, {
      scope: {
        allowed: ['**'],
        conditional: [],
        forbidden: [],
        conditionalAuthorizations: [],
      },
      changedPaths: ['README.md'],
    });
    const result = runReviewChangeShadow(root, request);

    expect(result.verdict).toBe('blocked');
    expect(result.dimensions.find(dimension => dimension.id === 'scope')?.reasons)
      .toContain('canonical-unowned:README.md');
  });

  test('canonical claim, lifecycle tuple, and diff kind mismatches fail closed', () => {
    const root = makeProject();
    const request = baseRequest(root, {
      goalAndClaims: ['invented-claim'],
      lifecycleTuple: 'suspended|interrupted',
      diffTarget: {
        kind: 'staged',
        description: 'staged',
        base: 'task-base',
        head: null,
        fingerprint: 'diff-staged',
      },
      evidence: [{
        id: 'E-invented',
        kind: 'test',
        claimIds: ['invented-claim'],
        status: 'passed',
        locator: 'test/example.test.ts',
        persistent: true,
        ownerSource: 'acceptance',
      }],
    });
    const result = runReviewChangeShadow(root, request);

    expect(result.blockers).toContain('claim-not-in-current-task:invented-claim');
    expect(result.blockers.some(item => item.startsWith('lifecycle-tuple-mismatch:'))).toBe(true);
    expect(result.blockers).toContain('diff-target-kind-mismatch:staged');
    expect(result.verdict).toBe('blocked');
  });

  test('canonical claim matching does not confuse stable ID prefixes', () => {
    const root = makeProject();
    write(root, 'docs/workflow/CURRENT_TASK.md', currentTaskContent().replace('- [ ] C1', '- [ ] C10'));
    const result = runReviewChangeShadow(root, baseRequest(root));

    expect(result.blockers).toContain('claim-not-in-current-task:C1');
    expect(result.verdict).toBe('blocked');
  });

  test('missing explicit diff target fails closed', () => {
    const root = makeProject();
    const request = baseRequest(root);
    request.diffTarget.description = '';
    request.diffTarget.fingerprint = '';
    const result = runReviewChangeShadow(root, request);

    expect(result.verdict).toBe('blocked');
    expect(result.blockers).toContain('missing-explicit-diff-target');
  });

  test('rejects malformed runtime input before reading the workspace', () => {
    const root = makeProject();
    const request: any = baseRequest(root);
    request.reviewCyclePhase = 'initial';

    expect(() => runReviewChangeShadow(root, request))
      .toThrow(ReviewShadowContractError);
  });

  test('rejects option-shaped Git revisions before diff inspection can write output', () => {
    const root = makeProject();
    const request = baseRequest(root, {
      diffTarget: {
        kind: 'commit',
        description: 'malicious commit target',
        base: '--output=owned-by-git',
        head: null,
        fingerprint: 'untrusted',
      },
    });

    expect(() => runReviewChangeShadow(root, request)).toThrow(ReviewShadowContractError);
    expect(inspectReviewDiffTarget(root, request.diffTarget, request.changedPaths)).toEqual({
      status: 'unavailable',
      actualPaths: [],
      actualFingerprint: null,
      reasons: ['unsafe-git-revision:base'],
    });
    expect(fs.existsSync(path.join(root, 'owned-by-git'))).toBe(false);
  });

  test('a broad declared ephemeral path cannot bypass the workspace guard', () => {
    const root = makeProject();
    const result = runReviewChangeShadow(root, baseRequest(root, {
      declaredEphemeralPaths: ['**'],
    }));

    expect(result.verdict).toBe('blocked');
    expect(result.blockers).toContain('invalid-declared-ephemeral-path:**');
    expect(result.governedMutationCount).toBe(0);
  });

  test('legacy findings with unknown attempts cannot receive a fresh repair budget', () => {
    const root = makeProject();
    write(root, 'docs/workflow/CURRENT_TASK.md', currentTaskContent([
      '- Finding ID: `F-001`',
      '  - Status: open',
      '  - Failure scenario: example',
    ].join('\n')));
    const result = runReviewChangeShadow(root, baseRequest(root, {
      observations: [strongObservation()],
    }));

    expect(result.findings[0].reasons).toContain('legacy-attempts-unknown');
    expect(result.findings[0].budgetState).toBe('exhausted');
    expect(result.verdict).toBe('needs-debug');
  });

  test('TA-12 compares hard legacy invariants while ignoring wording and cost', () => {
    const root = makeProject();
    const legacy: LegacyReviewResult = {
      diffTargetFingerprint: 'diff-001',
      verdictClass: 'clean',
      scopeOutcome: 'pass',
      ownerRoute: 'none',
      terminalBehavior: 'continue',
      governedMutationCount: 0,
      evidenceOutcome: 'sufficient',
      wording: 'Legacy wording differs.',
      metrics: { tokens: 9000 },
    };
    const result = runReviewChangeShadow(root, baseRequest(root, { legacyResult: legacy }));

    expect(result.comparison?.equivalent).toBe(true);
    expect(result.comparison?.hardMismatches).toEqual([]);
    expect(result.comparison?.softDifferences).toEqual([
      'wording-not-compared-as-hard-invariant',
      'cost-metrics-not-compared-as-hard-invariant',
    ]);

    const mismatch = compareLegacyAndShadow({ ...legacy, scopeOutcome: 'fail' }, result);
    expect(mismatch.equivalent).toBe(false);
    expect(mismatch.hardMismatches).toContain('scope-outcome');
  });
});

describe('migration-aware but non-migrating state readers', () => {
  test('TA-21 reads complete v1 install state and requires an in-place plan, never bootstrap/adopt', () => {
    const root = makeProject();
    write(root, '.workflow-system/install-state.json', JSON.stringify({
      state_version: 1,
      bundle_id: 'bundle-1',
      workflow_system_version: '0.14.5',
      installed_at: '2026-08-30T00:00:00Z',
      managed_files: [],
      package_json_fragment: {},
      project_profile_fragment: {},
      host_sync_state: {},
    }));

    const before = fs.readFileSync(path.join(root, '.workflow-system', 'install-state.json'));
    const result = inspectInstallState(root);
    const after = fs.readFileSync(path.join(root, '.workflow-system', 'install-state.json'));
    expect(result.status).toBe('readable-v1');
    expect(result.migrationDisposition).toBe('in-place-plan-required');
    expect(result.bootstrapOrAdoptRequired).toBe(false);
    expect(result.legacyRuntimeAuthoritative).toBe(true);
    expect(after.equals(before)).toBe(true);
  });

  test('TA-28 missing install metadata produces inventory-required without recreating project facts', () => {
    const root = makeProject();
    const result = inspectInstallState(root);

    expect(result.status).toBe('metadata-missing');
    expect(result.migrationDisposition).toBe('inventory-required');
    expect(result.bootstrapOrAdoptRequired).toBe(false);
  });

  test('malformed or unsupported install state blocks instead of being rewritten', () => {
    const root = makeProject();
    write(root, '.workflow-system/install-state.json', '{bad json');
    expect(inspectInstallState(root).status).toBe('malformed');

    write(root, '.workflow-system/install-state.json', JSON.stringify({ state_version: 99 }));
    const unsupported = inspectInstallState(root);
    expect(unsupported.status).toBe('unsupported-version');
    expect(unsupported.migrationDisposition).toBe('blocked');
    expect(unsupported.legacyRuntimeAuthoritative).toBe(true);
  });

  test('a partial managed target without install metadata requires inventory instead of fresh bootstrap', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-review-partial-install-'));
    TEMP_ROOTS.push(root);
    write(root, '.workflow-system/WORKFLOW_PROTOCOL.md', '# Existing protocol\n');

    const result = inspectInstallState(root);
    expect(result.status).toBe('metadata-missing');
    expect(result.migrationDisposition).toBe('inventory-required');
    expect(result.bootstrapOrAdoptRequired).toBe(false);
  });

  test('invalid managed-file checksum shape makes v1 state partial and blocked', () => {
    const root = makeProject();
    write(root, '.workflow-system/install-state.json', JSON.stringify({
      state_version: 1,
      bundle_id: 'bundle-1',
      workflow_system_version: '0.14.5',
      installed_at: '2026-08-30T00:00:00Z',
      managed_files: [{
        path: 'scripts/workflow-runtime.ts',
        mode: 'replace-managed',
        bundle_checksum: 'bad',
        installed_checksum: 'bad',
      }],
      package_json_fragment: {},
      project_profile_fragment: {},
      host_sync_state: {},
    }));

    const result = inspectInstallState(root);
    expect(result.status).toBe('partial-v1');
    expect(result.migrationDisposition).toBe('blocked');
  });

  test('TA-25 read-only diagnosis preserves unknown target-owned install metadata byte-for-byte', () => {
    const root = makeProject();
    const state = JSON.stringify({
      state_version: 1,
      bundle_id: 'bundle-1',
      workflow_system_version: '0.14.5',
      installed_at: '2026-08-30T00:00:00Z',
      managed_files: [],
      package_json_fragment: { scripts: { target_owned: 'keep-me' } },
      project_profile_fragment: { target_extension: { keep: true } },
      host_sync_state: {},
      unknown_target_field: { preserve: true },
    });
    write(root, '.workflow-system/install-state.json', state);
    const statePath = path.join(root, '.workflow-system', 'install-state.json');

    expect(inspectInstallState(root).status).toBe('readable-v1');
    expect(fs.readFileSync(statePath, 'utf8')).toBe(state);
  });

  test('TA-22 marks active legacy findings without attempt evidence as unknown', () => {
    const root = makeProject();
    write(root, 'docs/workflow/CURRENT_TASK.md', currentTaskContent([
      '- Finding ID: `F-001`',
      '  - Status: open',
      '  - Failure scenario: example',
    ].join('\n')));

    const result = inspectProjectState(root, '001');
    expect(result.findings).toEqual([{
      id: 'F-001',
      status: 'open',
      repairAttempts: 'legacy-attempts-unknown',
    }]);
  });

  test('TA-23 inventories valid paused and interrupted packages independently and selects neither', () => {
    const root = makeProject();
    write(root, 'TASKS/paused/TASK-007-paused-task.md', suspendedPackage());
    write(root, 'TASKS/interrupted/TASK-008-interrupted-task.md', suspendedPackage({
      task_id: '008',
      task_title: 'Interrupted task',
      task_slug: 'interrupted-task',
      artifact_kind: 'interrupted',
      lifecycle_state: 'interrupted',
      suspension_reason: 'Environment stopped',
      resume_review_reasons: 'environment_recovery_pending',
      checkpoint_evidence: 'checkpoint recorded',
      dirty_attribution: 'task-owned',
      environment_state: 'offline',
      recovery_strategy: 'restore environment then review',
    }));

    const pausedPath = path.join(root, 'TASKS', 'paused', 'TASK-007-paused-task.md');
    const interruptedPath = path.join(root, 'TASKS', 'interrupted', 'TASK-008-interrupted-task.md');
    const before = [fs.readFileSync(pausedPath), fs.readFileSync(interruptedPath)];
    const result = inspectProjectState(root, '001');
    const after = [fs.readFileSync(pausedPath), fs.readFileSync(interruptedPath)];
    expect(result.suspendedPackages.map(item => [item.kind, item.status])).toEqual([
      ['interrupted', 'valid'],
      ['paused', 'valid'],
    ]);
    expect(result.autoSelectedSuspendedPackage).toBe(false);
    expect(result.blockers).toEqual([]);
    expect(after[0].equals(before[0])).toBe(true);
    expect(after[1].equals(before[1])).toBe(true);
  });

  test('TA-24 leaves an invalid suspended package non-resumable and reports a blocker', () => {
    const root = makeProject();
    write(root, 'TASKS/interrupted/TASK-008-interrupted-task.md', suspendedPackage({
      task_id: '008',
      task_title: 'Interrupted task',
      task_slug: 'interrupted-task',
      artifact_kind: 'interrupted',
      lifecycle_state: 'interrupted',
      resume_review_reasons: 'environment_recovery_pending',
    }));

    const result = inspectProjectState(root, '001');
    expect(result.suspendedPackages[0].status).toBe('invalid');
    expect(result.blockers).toContain('invalid-suspended-package:TASKS/interrupted/TASK-008-interrupted-task.md');
    expect(result.autoSelectedSuspendedPackage).toBe(false);
  });
});
