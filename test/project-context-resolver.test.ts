import { describe, expect, test } from 'bun:test';
import * as path from 'path';
import {
  buildTargetRootIdentity,
  classifyKnowledgeCandidate,
  fingerprintKnowledgeStatement,
  resolveImplementationAnchors,
  resolveProjectContextFromCandidates,
  type ContextCandidate,
  type ExistingKnowledgeItem,
  type KnowledgeCandidate,
  type ProjectContextRequest,
} from '../scripts/project-context-resolver';

const ROOT = path.resolve(import.meta.dir, '..');

function baseRequest(overrides: Partial<ProjectContextRequest> = {}): ProjectContextRequest {
  return {
    requestId: 'TA-15',
    targetRootIdentity: buildTargetRootIdentity(ROOT, 'source'),
    intent: 'review',
    taskIdentity: null,
    lifecycleTuple: null,
    diffTarget: 'working-tree:phase-1',
    goalAndClaims: ['retry budget remains bounded'],
    scopePathsAndSymbols: ['scripts/retry-policy.ts'],
    changedSurfaces: ['review-convergence'],
    riskTriggers: ['retry budget'],
    contextBudget: { maxItems: 10, maxSummaryBytes: 20_000 },
    ...overrides,
  };
}

function candidate(overrides: Partial<ContextCandidate>): ContextCandidate {
  return {
    source: 'docs/workflow/LESSONS.md',
    locator: 'retry lesson',
    authority: 'lesson',
    statement: 'When retry budget is exhausted, stop and investigate.',
    freshness: 'current',
    ...overrides,
  };
}

function lessonCandidate(overrides: Partial<KnowledgeCandidate> = {}): KnowledgeCandidate {
  const applicability = {
    projectTypes: ['ai-engineering-workflow'],
    pathsSymbolsOrSurfaces: ['review-convergence'],
    triggerConditions: ['same finding recurs'],
  };
  const statement = 'Stop bounded repair and investigate when the same finding recurs.';
  return {
    candidateId: 'lesson-candidate-1',
    kind: 'lesson',
    fingerprint: fingerprintKnowledgeStatement('lesson', statement, applicability),
    statement,
    sourceRefs: [{ locator: 'test/result#failure', revision: 'rev-1' }],
    applicability,
    authoritySource: 'verified-evidence',
    stability: 'stable',
    evidenceRefs: ['failure-1'],
    noveltyAgainst: [],
    conflictSet: [],
    supersedes: null,
    reviewOrExpiryTrigger: null,
    expectedConsumers: ['review-change'],
    systemicSeverity: 'ordinary',
    ...overrides,
  };
}

describe('project-context-resolver Phase 1', () => {
  test('TA-15 selects relevant Contract, Decision, and Lesson while excluding unrelated knowledge', () => {
    const candidates: ContextCandidate[] = [
      candidate({
        source: 'docs/workflow/CONTRACTS.md',
        locator: 'bounded retry contract',
        authority: 'contract',
        statement: 'The retry budget for review findings is two attempts per fingerprint.',
      }),
      candidate({
        source: 'docs/workflow/DECISIONS.md',
        locator: 'accepted convergence decision',
        authority: 'decision',
        statement: 'The accepted retry budget uses bounded repair followed by debug.',
      }),
      candidate({
        source: 'docs/workflow/LESSONS.md',
        locator: 'prior retry pitfall',
        authority: 'lesson',
        statement: 'A previous retry budget reset caused the same repair to repeat.',
      }),
      candidate({
        locator: 'unrelated android lesson',
        statement: 'ADB device selection must use an explicit serial number.',
      }),
    ];

    const result = resolveProjectContextFromCandidates(baseRequest(), candidates);
    const locators = [...result.required, ...result.optional].map(item => item.locator);

    expect(locators.some(locator => locator.includes('bounded retry contract'))).toBe(true);
    expect(locators.some(locator => locator.includes('accepted convergence decision'))).toBe(true);
    expect(locators.some(locator => locator.includes('prior retry pitfall'))).toBe(true);
    expect(locators.some(locator => locator.includes('unrelated android lesson'))).toBe(false);
    expect(result.excludedSummary.count).toBe(1);
  });

  test('TA-16 keeps a Contract authoritative over conflicting task and Lesson text', () => {
    const semanticKey = 'finding-retry-limit';
    const candidates: ContextCandidate[] = [
      candidate({
        source: 'docs/workflow/CONTRACTS.md',
        locator: 'retry contract',
        authority: 'contract',
        statement: 'Retry budget is two attempts.',
        semanticKey,
      }),
      candidate({
        source: 'docs/workflow/CURRENT_TASK.md',
        locator: 'task retry note',
        authority: 'task',
        statement: 'Retry budget is unlimited.',
        semanticKey,
        required: true,
      }),
      candidate({
        locator: 'newer retry lesson',
        statement: 'Retry budget is five attempts.',
        semanticKey,
      }),
    ];

    const result = resolveProjectContextFromCandidates(baseRequest(), candidates);

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].resolution).toBe('authority-precedence');
    expect(result.conflicts[0].winningLocator).toContain('retry contract');
    expect(result.missingRequiredContext).toEqual([]);
  });

  test('TA-20 preserves required authority and reports budget exhaustion', () => {
    const result = resolveProjectContextFromCandidates(
      baseRequest({ contextBudget: { maxItems: 1, maxSummaryBytes: 10 } }),
      [
        candidate({ locator: 'required one', statement: 'A'.repeat(200), required: true }),
        candidate({ locator: 'required two', statement: 'B'.repeat(200), required: true }),
      ],
    );

    expect(result.budgetResult).toBe('required-context-exceeds-budget');
    expect(result.required).toHaveLength(2);
    expect(result.optional).toHaveLength(0);
    expect(result.excludedSummary.reasons).toContain('required-context-preserved-despite-budget');
  });

  test('TA-17 retrieves a matching prior pitfall as advisory context', () => {
    const result = resolveProjectContextFromCandidates(baseRequest({
      riskTriggers: ['repair retry reset'],
    }), [candidate({
      locator: 'LESSON-017 retry reset pitfall',
      statement: 'A prior repair retry reset repeated the same failed approach; preserve the fingerprint budget.',
      semanticKey: 'LESSON-017',
    })]);

    expect(result.optional).toHaveLength(1);
    expect(result.optional[0].authority).toBe('lesson');
    expect(result.optional[0].relevanceReasons).toContain('risk-trigger-match');
    expect(result.optional[0].sourceRevision).not.toBe('');
  });

  test('stale or inactive required authority fails closed', () => {
    const result = resolveProjectContextFromCandidates(baseRequest(), [
      candidate({ locator: 'stale required', required: true, freshness: 'stale' }),
      candidate({ locator: 'inactive required', required: true, active: false, freshness: 'current' }),
    ]);

    expect(result.missingRequiredContext.some(item => item.startsWith('required-context-stale:'))).toBe(true);
    expect(result.missingRequiredContext.some(item => item.startsWith('required-context-inactive:'))).toBe(true);
  });

  test('an equal-authority semantic conflict fails closed', () => {
    const result = resolveProjectContextFromCandidates(baseRequest(), [
      candidate({
        source: 'docs/workflow/CONTRACTS.md',
        locator: 'contract A',
        authority: 'contract',
        statement: 'Retry budget is two.',
        semanticKey: 'retry',
      }),
      candidate({
        source: 'docs/workflow/CONTRACTS.md',
        locator: 'contract B',
        authority: 'contract',
        statement: 'Retry budget is three.',
        semanticKey: 'retry',
      }),
    ]);

    expect(result.conflicts[0].resolution).toBe('unresolved-same-authority');
    expect(result.missingRequiredContext).toContain('unresolved-authority-conflict:retry');
  });

  test('a conflict beyond the compact summary boundary cannot be summarized away', () => {
    const sharedPrefix = `Retry policy preface ${'same '.repeat(300)}`;
    const result = resolveProjectContextFromCandidates(baseRequest(), [
      candidate({
        source: 'docs/workflow/CONTRACTS.md',
        locator: 'long contract A',
        authority: 'contract',
        statement: `${sharedPrefix}The retry budget is two.`,
        semanticKey: 'long-retry-policy',
      }),
      candidate({
        source: 'docs/workflow/CONTRACTS.md',
        locator: 'long contract B',
        authority: 'contract',
        statement: `${sharedPrefix}The retry budget is three.`,
        semanticKey: 'long-retry-policy',
      }),
    ]);

    expect(result.required[0].summary.endsWith('…')).toBe(true);
    expect(result.conflicts[0].resolution).toBe('unresolved-same-authority');
    expect(result.missingRequiredContext).toContain('unresolved-authority-conflict:long-retry-policy');
  });
});

describe('knowledge-admission-policy Phase 1 classification', () => {
  test('TA-18 defers a one-off ordinary workaround instead of admitting a Lesson', () => {
    const result = classifyKnowledgeCandidate(lessonCandidate(), []);

    expect(result.disposition).toBe('defer');
    expect(result.blockers).toContain('lesson-recurrence-not-proven');
    expect(result.governedMutationCount).toBe(0);
  });

  test('TA-19 returns no-op for equivalent existing knowledge without appending', () => {
    const proposed = lessonCandidate();
    const existing: ExistingKnowledgeItem = {
      id: 'LESSON-004',
      kind: proposed.kind,
      fingerprint: proposed.fingerprint,
      statement: proposed.statement,
      sourceRefs: [{ locator: 'docs/workflow/LESSONS.md#LESSON-004', revision: 'rev-0' }],
      applicability: proposed.applicability,
      authoritySource: 'verified-evidence',
      stability: 'stable',
    };

    const result = classifyKnowledgeCandidate(proposed, [existing]);

    expect(result.disposition).toBe('no-op');
    expect(result.matchedKnowledgeId).toBe('LESSON-004');
    expect(result.permittedUses).not.toContain('durable-write-proposal');
    expect(result.governedMutationCount).toBe(0);
  });

  test('Decision overlap cannot merge without user or accepted-decision authority', () => {
    const applicability = {
      projectTypes: ['ai-engineering-workflow'],
      pathsSymbolsOrSurfaces: ['review-change'],
      triggerConditions: ['promotion decision'],
    };
    const existing: ExistingKnowledgeItem = {
      id: 'AD-100',
      kind: 'decision',
      fingerprint: 'knowledge-existing',
      statement: 'Keep review-change shadow-only until equivalence passes.',
      sourceRefs: [{ locator: 'docs/workflow/DECISIONS.md#AD-100', revision: 'r1' }],
      applicability,
      authoritySource: 'user',
      stability: 'stable',
    };
    const result = classifyKnowledgeCandidate({
      candidateId: 'decision-overlap',
      kind: 'decision',
      fingerprint: 'knowledge-overlap',
      statement: 'Keep review-change shadow-only until semantic equivalence passes.',
      sourceRefs: [{ locator: 'review/result', revision: 'r2' }],
      applicability,
      authoritySource: 'verified-evidence',
      stability: 'stable',
      evidenceRefs: ['E1'],
      noveltyAgainst: ['AD-100'],
      conflictSet: [],
      supersedes: null,
      reviewOrExpiryTrigger: null,
      expectedConsumers: ['review-change'],
      decisionContext: { alternatives: ['promote now'], constraints: ['zero hard mismatch'] },
    }, [existing]);

    expect(result.disposition).toBe('defer');
    expect(result.blockers).toContain('decision-authority-insufficient');
  });

  test('an unresolved conflict blocks supersession before the merge branch', () => {
    const proposed = lessonCandidate({
      candidateId: 'lesson-supersede-conflict',
      conflictSet: ['LESSON-099'],
      supersedes: 'LESSON-004',
      evidenceRefs: ['failure-1', 'failure-2'],
    });
    const existing: ExistingKnowledgeItem = {
      id: 'LESSON-004',
      kind: 'lesson',
      fingerprint: 'different-fingerprint',
      statement: 'Use bounded repair for recurring findings.',
      sourceRefs: [{ locator: 'docs/workflow/LESSONS.md#LESSON-004', revision: 'r1' }],
      applicability: proposed.applicability,
      authoritySource: 'verified-evidence',
      stability: 'stable',
    };
    const result = classifyKnowledgeCandidate(proposed, [existing]);

    expect(result.disposition).toBe('defer');
    expect(result.blockers).toContain('unresolved-knowledge-conflict');
  });

  test('admits a stable Contract candidate but still produces only a read-only proposal', () => {
    const applicability = {
      projectTypes: ['ai-engineering-workflow'],
      pathsSymbolsOrSurfaces: ['review-change'],
      triggerConditions: ['diff target supplied'],
    };
    const statement = 'Review-change requires one explicit diff target.';
    const result = classifyKnowledgeCandidate({
      candidateId: 'contract-candidate-1',
      kind: 'contract',
      fingerprint: fingerprintKnowledgeStatement('contract', statement, applicability),
      statement,
      sourceRefs: [{ locator: 'test/review-shadow#TA-03', revision: 'rev-2' }],
      applicability,
      authoritySource: 'verified-evidence',
      stability: 'stable',
      evidenceRefs: ['TA-03'],
      noveltyAgainst: [],
      conflictSet: [],
      supersedes: null,
      reviewOrExpiryTrigger: null,
      expectedConsumers: ['review-change'],
    }, []);

    expect(result.disposition).toBe('admit');
    expect(result.permittedUses).toContain('durable-write-proposal');
    expect(result.governedMutationCount).toBe(0);
  });
});

describe('implementation anchor live resolution', () => {
  test('validates current path/symbol and returns bounded search seeds without claiming completeness', () => {
    const result = resolveImplementationAnchors(ROOT, {
      coverage: 'observed',
      source_revision: 'a'.repeat(64),
      anchors: [{
        path: 'scripts/project-context-resolver.ts',
        symbol: 'resolveImplementationAnchors',
        role: 'resolver entrypoint',
        evidence_refs: ['anchor-test'],
      }],
    });

    expect(result).toEqual([{
      path: 'scripts/project-context-resolver.ts',
      symbol: 'resolveImplementationAnchors',
      role: 'resolver entrypoint',
      status: 'current',
      reason: 'anchor path and optional symbol are present',
      search_seed: 'scripts/project-context-resolver.ts#resolveImplementationAnchors',
    }]);
  });

  test('marks stale anchors for live-search fallback instead of treating history as authority', () => {
    const result = resolveImplementationAnchors(ROOT, {
      coverage: 'verified-scope',
      source_revision: 'b'.repeat(64),
      anchors: [{
        path: 'src/no-longer-present.ts',
        symbol: 'RemovedOwner',
        role: 'historical implementation',
        evidence_refs: ['anchor-stale-test'],
      }],
    });

    expect(result[0]).toMatchObject({
      status: 'stale',
      search_seed: 'src/no-longer-present.ts#RemovedOwner',
    });
    expect(result[0]?.reason).toContain('missing');
  });
});
