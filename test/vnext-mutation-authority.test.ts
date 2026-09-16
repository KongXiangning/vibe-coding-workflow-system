import { describe, expect, test } from 'bun:test';
import {
  blastRadiusAssessmentDigest,
  evaluateMutationAuthority,
  mutationAuthorityBlockerCode,
  normalizeBlastRadiusAssessments,
  parseTaskAuthorityEnvelope,
  resolvePathAuthorityDomain,
  type MutationBlastRadiusAssessment,
  type MutationExpansionAdmission,
  type TaskAuthorityEnvelope,
} from '../runtime/vnext/src/mutation-authority';

const DOMAIN_ROOTS = new Map<string, readonly string[]>([
  ['node-rollout', ['packages/node-rollout/**', 'packages/node-rollout-tests/**']],
  ['rust-rollout', ['native/codex-rollout-collector/**']],
  ['shared-protocol', ['packages/protocol/**']],
]);

function envelope(overrides: Partial<TaskAuthorityEnvelope> = {}): TaskAuthorityEnvelope {
  return {
    version: 2,
    domains: ['node-rollout'],
    exact_exceptions: [],
    forbidden: [],
    ...overrides,
  };
}

function assessment(path: string, overrides: Partial<MutationBlastRadiusAssessment> = {}): MutationBlastRadiusAssessment {
  return {
    path,
    symbol: null,
    reason: 'The task needs this target to fix the reported failure.',
    locality: 'local',
    visibility: 'private',
    cross_component_consumers: 'none',
    contract_impact: 'none',
    evidence_refs: ['grep:callers'],
    disposition: 'self-admit',
    ...overrides,
  };
}

function admission(path: string, overrides: Partial<MutationExpansionAdmission> = {}): MutationExpansionAdmission {
  const value = assessment(path);
  return {
    admission_id: `mutation-admission-${path.replace(/[^a-z0-9]+/giu, '-')}`,
    path,
    step_id: 'step-1',
    plan_revision: 'a'.repeat(64),
    assessment: value,
    assessment_digest: blastRadiusAssessmentDigest(value),
    admitted_at_source_revision: 'b'.repeat(64),
    ...overrides,
  };
}

const BODY_V2 = [
  '## 允许修改范围',
  '',
  '### Allowed Files',
  '',
  '- `packages/node-rollout/src/session.ts`',
  '- `packages/node-rollout/src/reconnect.ts`',
  '',
  '### Conditional Files',
  '',
  '- none',
  '',
  '## 禁止修改范围',
  '',
  '### Forbidden Files',
  '',
  '- none',
  '',
  '## 变更权限',
  '',
  '### Authority Domains',
  '',
  '- `node-rollout`',
  '',
  '### Exact Exceptions',
  '',
  '- none',
  '',
].join('\n');

describe('Mutation Authority v2 envelope parsing', () => {
  test('parses a positive authority grant and keeps legacy tasks unchanged', () => {
    const parsed = parseTaskAuthorityEnvelope(BODY_V2, 2);
    expect(parsed.version).toBe(2);
    expect(parsed.domains).toEqual(['node-rollout']);
    expect(parsed.exact_exceptions).toEqual([]);

    const legacy = parseTaskAuthorityEnvelope('## 允许修改范围\n\n### Allowed Files\n\n- `src/a.ts`\n', undefined);
    expect(legacy.version).toBe(1);
    expect(legacy.domains).toEqual([]);
    expect(legacy.exact_exceptions).toEqual([]);
  });

  test('fails closed when the version marker and the declared envelope disagree', () => {
    expect(() => parseTaskAuthorityEnvelope(BODY_V2, undefined)).toThrow(/without mutation_authority_version/iu);
    expect(() => parseTaskAuthorityEnvelope('## 允许修改范围\n\n### Allowed Files\n\n- `src/a.ts`\n', 2)).toThrow(/without a Mutation Authority envelope/iu);
  });

  test('keeps exact exceptions narrow and rejects a wildcard cross-domain exception', () => {
    const body = BODY_V2.replace('- none\n\n## 变更权限', '- none\n\n## 变更权限').replace(
      '### Exact Exceptions\n\n- none',
      '### Exact Exceptions\n\n- `native/codex-rollout-collector/tests/stage4_target_protocol.rs`',
    );
    const parsed = parseTaskAuthorityEnvelope(body, 2);
    expect(parsed.exact_exceptions).toEqual(['native/codex-rollout-collector/tests/stage4_target_protocol.rs']);
    expect(() => parseTaskAuthorityEnvelope(body.replace('stage4_target_protocol.rs`', 'tests/**`'), 2)).toThrow(/exact repository-relative paths/iu);
  });

  test('resolves path to authority domain without a dependency graph', () => {
    const parsed = envelope();
    expect(resolvePathAuthorityDomain('packages/node-rollout/src/internal/state.ts', parsed, DOMAIN_ROOTS)).toMatchObject({ classification: 'granted', domains: ['node-rollout'], source: 'task-envelope' });
    expect(resolvePathAuthorityDomain('native/codex-rollout-collector/src/main.rs', parsed, DOMAIN_ROOTS)).toMatchObject({ classification: 'unclassified', domains: [] });
    expect(resolvePathAuthorityDomain('scripts/gen.ts', parsed, DOMAIN_ROOTS)).toMatchObject({ classification: 'unclassified' });
    const overlapping = envelope({ domains: ['node-rollout', 'node-rollout-tests'] });
    const withOverlap = new Map<string, readonly string[]>([
      ['node-rollout', ['packages/node-rollout/**']],
      ['node-rollout-tests', ['packages/node-rollout/**', 'packages/node-rollout-tests/**']],
    ]);
    expect(resolvePathAuthorityDomain('packages/node-rollout/src/a.ts', overlapping, withOverlap)).toMatchObject({ classification: 'ambiguous' });
    expect(resolvePathAuthorityDomain('native/x.rs', envelope({ domains: ['missing-domain'] }), DOMAIN_ROOTS)).toMatchObject({ classification: 'unknown-domain' });
  });
});

describe('Mutation Authority v2 admission', () => {
  test('A01/A02 admits an unplanned private target inside the envelope through assessment and rejects it without one', () => {
    const planned = ['packages/node-rollout/src/session.ts', 'packages/node-rollout/src/reconnect.ts'];
    const discovered = 'packages/node-rollout/src/internal/state.ts';
    const withoutAssessment = evaluateMutationAuthority(envelope(), {
      changed_paths: [...planned, discovered],
      planned_targets: planned,
      step_id: 'step-1',
      domain_roots: DOMAIN_ROOTS,
    });
    expect(withoutAssessment.status).toBe('blocked');
    expect(withoutAssessment.assessment_required_paths).toEqual([discovered]);
    expect(mutationAuthorityBlockerCode(withoutAssessment)).toBe('MUTATION_BLAST_RADIUS_ASSESSMENT_REQUIRED');

    const admitted = evaluateMutationAuthority(envelope(), {
      changed_paths: [...planned, discovered],
      planned_targets: planned,
      step_id: 'step-1',
      domain_roots: DOMAIN_ROOTS,
      assessments: [assessment(discovered)],
    });
    expect(admitted.status).toBe('pass');
    expect(admitted.admissions[0]).toMatchObject({ classification: 'planned-in-envelope', unplanned: false });
    expect(admitted.admissions[2]).toMatchObject({ classification: 'self-admitted-in-envelope', unplanned: true });
    expect(admitted.dynamic_expansion_paths).toEqual([discovered]);
    expect(admitted.dynamic_review_required).toBe(true);
    expect(admitted.new_persistent_test_paths).toEqual([]);
  });

  test('A05/A06/A07 keep blast radius as evidence, not a mechanical fan-in threshold', () => {
    const shared = 'packages/node-rollout/src/shared/normalize.ts';
    const highFanIn = evaluateMutationAuthority(envelope(), {
      changed_paths: [shared],
      planned_targets: [],
      step_id: 'step-1',
      domain_roots: DOMAIN_ROOTS,
      assessments: [assessment(shared, { locality: 'high', visibility: 'public', cross_component_consumers: 'present', contract_impact: 'possible' })],
    });
    expect(highFanIn.status).toBe('pass');
    expect(highFanIn.dynamic_review_required).toBe(true);

    const escalated = evaluateMutationAuthority(envelope(), {
      changed_paths: [shared],
      planned_targets: [],
      step_id: 'step-1',
      domain_roots: DOMAIN_ROOTS,
      assessments: [assessment(shared, { locality: 'high', visibility: 'shared', cross_component_consumers: 'unknown', disposition: 'escalate', reason: 'Consumer impact cannot be bounded from the evidence.' })],
    });
    expect(escalated.status).toBe('blocked');
    expect(escalated.admissions[0]!.classification).toBe('escalated');
    expect(mutationAuthorityBlockerCode(escalated)).toBe('MUTATION_TARGET_ESCALATED');
  });

  test('A08/A09 block a write in another component while reads stay unrestricted', () => {
    const crossDomain = evaluateMutationAuthority(envelope(), {
      changed_paths: ['native/codex-rollout-collector/src/protocol.rs'],
      planned_targets: ['packages/node-rollout/src/session.ts'],
      step_id: 'step-1',
      domain_roots: DOMAIN_ROOTS,
      assessments: [assessment('native/codex-rollout-collector/src/protocol.rs', { locality: 'high' })],
    });
    expect(crossDomain.status).toBe('blocked');
    expect(crossDomain.authority_expansion_required_paths).toEqual(['native/codex-rollout-collector/src/protocol.rs']);
    expect(mutationAuthorityBlockerCode(crossDomain)).toBe('MUTATION_AUTHORITY_EXPANSION_REQUIRED');
    // An assessment can never turn an out-of-envelope write into an admission.
    expect(crossDomain.admissions[0]!.admitted).toBe(false);
  });

  test('A10 admits a user-authorized exact cross-domain exception without granting the whole component', () => {
    const exception = 'native/codex-rollout-collector/tests/stage4_target_protocol.rs';
    const granted = envelope({ exact_exceptions: [exception] });
    const result = evaluateMutationAuthority(granted, {
      changed_paths: [exception],
      planned_targets: [exception],
      step_id: 'step-1',
      domain_roots: DOMAIN_ROOTS,
    });
    expect(result.status).toBe('pass');
    expect(result.admissions[0]).toMatchObject({ authority_source: 'exact-exception', admitted: true });
    const stillBlocked = evaluateMutationAuthority(granted, {
      changed_paths: ['native/codex-rollout-collector/src/protocol.rs'],
      planned_targets: [],
      step_id: 'step-1',
      domain_roots: DOMAIN_ROOTS,
    });
    expect(stillBlocked.status).toBe('blocked');
    expect(mutationAuthorityBlockerCode(stillBlocked)).toBe('MUTATION_AUTHORITY_EXPANSION_REQUIRED');
  });

  test('A12/A13 separate an existing test oracle change from a new persistent test', () => {
    const existingTest = 'packages/node-rollout/test/reconnect-regression.test.ts';
    const absentTest = 'packages/node-rollout/test/new-regression.test.ts';
    const exists = (value: string): boolean => value === existingTest;
    const expanded = evaluateMutationAuthority(envelope(), {
      changed_paths: [existingTest],
      planned_targets: ['packages/node-rollout/src/reconnect.ts'],
      step_id: 'step-1',
      domain_roots: DOMAIN_ROOTS,
      target_exists: exists,
      assessments: [assessment(existingTest, { reason: 'The existing regression assertion encodes the old contract.' })],
    });
    expect(expanded.status).toBe('pass');
    expect(expanded.admissions[0]!.persistent_test).toEqual({ path: existingTest, existing: true });
    expect(expanded.dynamic_review_required).toBe(true);

    const created = evaluateMutationAuthority(envelope(), {
      changed_paths: [absentTest],
      planned_targets: ['packages/node-rollout/src/reconnect.ts'],
      step_id: 'step-1',
      domain_roots: DOMAIN_ROOTS,
      target_exists: exists,
      assessments: [assessment(absentTest, { locality: 'elevated' })],
    });
    expect(created.status).toBe('blocked');
    expect(created.admissions[0]).toMatchObject({ classification: 'assessment-required', persistent_test: { path: absentTest, existing: false } });
    expect(created.new_persistent_test_paths).toEqual([]);
  });

  test('A03/A04/A14 treat a durable extend-preflight admission as the same attempt and never widen another step', () => {
    const discovered = 'packages/node-rollout/src/internal/state.ts';
    const sameStep = evaluateMutationAuthority(envelope(), {
      changed_paths: [discovered],
      planned_targets: [],
      step_id: 'step-1',
      domain_roots: DOMAIN_ROOTS,
      admissions: [admission(discovered)],
    });
    expect(sameStep.status).toBe('pass');
    expect(sameStep.admissions[0]!.classification).toBe('self-admitted-in-envelope');
    expect(sameStep.dynamic_review_required).toBe(true);

    const otherStep = evaluateMutationAuthority(envelope(), {
      changed_paths: [discovered],
      planned_targets: [],
      step_id: 'step-2',
      domain_roots: DOMAIN_ROOTS,
      admissions: [admission(discovered)],
    });
    expect(otherStep.status).toBe('blocked');
    expect(otherStep.assessment_required_paths).toEqual([discovered]);
  });

  test('A16 keeps v1 legacy semantics available for a task without an envelope', () => {
    const legacyEnvelope = parseTaskAuthorityEnvelope('## 允许修改范围\n\n### Allowed Files\n\n- `src/a.ts`\n', undefined);
    expect(legacyEnvelope.version).toBe(1);
    const result = evaluateMutationAuthority(legacyEnvelope, {
      changed_paths: ['src/a.ts'],
      planned_targets: ['src/a.ts'],
      step_id: 'step-1',
      domain_roots: DOMAIN_ROOTS,
    });
    // Legacy callers never route through the v2 evaluator; the legacy
    // evaluator keeps exact-path semantics and is asserted in
    // test/vnext-mutation-scope.test.ts.
    expect(result.envelope.domains).toEqual([]);
  });

  test('rejects a malformed or duplicate assessment instead of guessing', () => {
    expect(() => normalizeBlastRadiusAssessments([{ path: 'src/a.ts' }])).toThrow(/must contain exactly/iu);
    expect(() => normalizeBlastRadiusAssessments([assessment('src/a.ts'), assessment('src/a.ts')])).toThrow(/duplicate target paths/iu);
    expect(() => normalizeBlastRadiusAssessments([assessment('src/a.ts', { evidence_refs: [] })])).toThrow(/evidence_refs/iu);
    expect(() => normalizeBlastRadiusAssessments([assessment('src/**')])).toThrow(/exact repository-relative path/iu);
  });

  test('blocks an explicit task forbidden target before any authority grant', () => {
    const forbidden = envelope({ forbidden: ['packages/node-rollout/src/legacy/**'] });
    const result = evaluateMutationAuthority(forbidden, {
      changed_paths: ['packages/node-rollout/src/legacy/compat.ts'],
      planned_targets: ['packages/node-rollout/src/legacy/compat.ts'],
      step_id: 'step-1',
      domain_roots: DOMAIN_ROOTS,
    });
    expect(result.status).toBe('blocked');
    expect(result.admissions[0]!.classification).toBe('forbidden');
  });
});
