import { describe, expect, test } from 'bun:test';
import {
  assertMutationScope,
  evaluateMutationScope,
  MutationScopeError,
  parseMutationScope,
} from '../runtime/vnext/src/mutation-scope';
import { parseCli } from '../runtime/vnext/src/kernel';

// P-12 admission for this persistent mutation-scope guard:
// the shadow evaluator is non-authoritative, while the current Runtime tests
// do not compare explicit changed paths with the canonical task scope.
const P12_MUTATION_SCOPE_TEST_ADMISSION = {
  decision: 'admitted',
  owner: 'workflow-system maintainers',
  basis: 'critical-invariant',
  proves: 'read/discovery context cannot authorize an unadmitted mutation and scope evaluation is default-deny',
  existingEvidenceInsufficiency: 'the shadow evaluator does not enforce the authoritative Runtime boundary',
  assertionBoundary: 'vNext Runtime mutation-scope parser and per-path checker',
  failureDisposition: 'block the Runtime quality gate until the frozen Mutation-oriented Scope boundary is restored',
} as const;

function nestedScopeBody(options: {
  allowed?: string;
  conditional?: string;
  forbidden?: string;
  readDiscovery?: string;
} = {}): string {
  return [
    '## 允许修改范围',
    '',
    '### Allowed Files',
    '',
    `- ${options.allowed ?? 'src/app.ts'}`,
    '',
    '### Conditional Files',
    '',
    `- ${options.conditional ?? 'src/generated/** when propagation evidence and owner approval are recorded'}`,
    ...(options.readDiscovery === undefined ? [] : ['', '### Read / discovery context', '', `- ${options.readDiscovery}`]),
    '',
    '## 禁止修改范围',
    '',
    '### Forbidden Files',
    '',
    `- ${options.forbidden ?? '.git/**'}`,
    '',
  ].join('\n');
}

function directScopeBody(): string {
  return [
    '## 允许修改范围',
    '',
    '- src/app.ts',
    '',
    '## 条件修改范围',
    '',
    '- docs/** when propagation evidence and owner approval are recorded',
    '',
    '## 禁止修改范围',
    '',
    '- .git/**',
  ].join('\n');
}

describe('vNext Mutation-oriented Scope', () => {
  test('records an explicit P-12 admission for the authoritative boundary', () => {
    expect(P12_MUTATION_SCOPE_TEST_ADMISSION).toMatchObject({
      decision: 'admitted',
      basis: 'critical-invariant',
      assertionBoundary: 'vNext Runtime mutation-scope parser and per-path checker',
    });
  });

  test('parses nested vNext buckets and keeps read/discovery context separate', () => {
    const scope = parseMutationScope(nestedScopeBody({ readDiscovery: 'src/consumer.ts' }), 'a'.repeat(64));
    const result = evaluateMutationScope(scope, { changed_paths: ['src/consumer.ts'] });

    expect(scope.allowed.map(entry => entry.pattern)).toEqual(['src/app.ts']);
    expect(scope.conditional.map(entry => entry.pattern)).toEqual(['src/generated/**']);
    expect(scope.forbidden.map(entry => entry.pattern)).toEqual(['.git/**']);
    expect(scope.read_discovery.map(entry => entry.pattern)).toEqual(['src/consumer.ts']);
    expect(result.status).toBe('blocked');
    expect(result.decisions[0]).toMatchObject({
      classification: 'read-context-only',
      mutation_admitted: false,
      read_discovery_matches: ['src/consumer.ts'],
    });
  });

  test('accepts the older direct Chinese scope form without changing the bucket semantics', () => {
    const scope = parseMutationScope(directScopeBody(), 'b'.repeat(64));
    expect(evaluateMutationScope(scope, { changed_paths: ['src/app.ts'] }).status).toBe('pass');
  });

  test('gives Forbidden Files precedence over an overlapping Allowed Files glob', () => {
    const scope = parseMutationScope(nestedScopeBody({ allowed: 'src/**', forbidden: 'src/secret.ts' }), 'c'.repeat(64));
    const result = evaluateMutationScope(scope, {
      changed_paths: ['src/secret.ts'],
      transformation_kind: 'inherently-broad',
    });

    expect(result.status).toBe('blocked');
    expect(result.decisions[0]?.classification).toBe('forbidden');
  });

  test('defaults unowned paths to blocked even when a broad read context matches', () => {
    const scope = parseMutationScope(nestedScopeBody({ readDiscovery: 'src/**' }), 'd'.repeat(64));
    const result = evaluateMutationScope(scope, { changed_paths: ['src/other.ts'] });

    expect(result.status).toBe('blocked');
    expect(result.decisions[0]?.classification).toBe('read-context-only');
    expect(result.admitted_paths).toEqual([]);
  });

  test('requires exact evidence-backed authorization for Conditional Files', () => {
    const scope = parseMutationScope(nestedScopeBody(), 'e'.repeat(64));
    const blocked = evaluateMutationScope(scope, { changed_paths: ['src/generated/schema.ts'] });
    const admitted = evaluateMutationScope(scope, {
      changed_paths: ['src/generated/schema.ts'],
      conditional_authorizations: [{
        pattern: 'src/generated/schema.ts',
        evidence_refs: ['evidence:propagation:1'],
        authority: 'accepted-task:bounded-propagation',
      }],
    });

    expect(blocked.status).toBe('blocked');
    expect(blocked.decisions[0]?.classification).toBe('conditional-unapproved');
    expect(admitted.status).toBe('pass');
    expect(admitted.decisions[0]?.classification).toBe('conditional-admitted');
  });

  test('rejects malformed or widening conditional authorization', () => {
    const scope = parseMutationScope(nestedScopeBody(), 'f'.repeat(64));
    const malformed = evaluateMutationScope(scope, {
      changed_paths: ['src/generated/schema.ts'],
      conditional_authorizations: [{
        pattern: 'src/generated/**',
        evidence_refs: [],
        authority: '',
      }],
    });

    expect(malformed.status).toBe('blocked');
    expect(malformed.blockers.join(' ')).toMatch(/conditional_authorizations/);
  });

  test('requires an explicit inherently-broad transformation for broad Allowed Files', () => {
    const scope = parseMutationScope(nestedScopeBody({ allowed: 'src/**' }), '1'.repeat(64));
    const localized = evaluateMutationScope(scope, { changed_paths: ['src/app.ts'] });
    const broad = evaluateMutationScope(scope, {
      changed_paths: ['src/app.ts'],
      transformation_kind: 'inherently-broad',
    });

    expect(localized.status).toBe('blocked');
    expect(localized.decisions[0]?.classification).toBe('broad-scope-unqualified');
    expect(broad.status).toBe('pass');
    expect(broad.decisions[0]?.classification).toBe('allowed-broad');
  });

  test('fails closed when a required bucket or conditional condition is malformed', () => {
    expect(() => parseMutationScope(nestedScopeBody().replace('### Forbidden Files', '### Other Files'), '2'.repeat(64)))
      .toThrow(/Forbidden Files/i);
    expect(() => parseMutationScope(nestedScopeBody({ conditional: 'src/generated/**' }), '3'.repeat(64)))
      .toThrow(/condition, evidence, or authority/);
  });

  test('assertMutationScope raises a terminal blocked result for an unauthorized diff', () => {
    const scope = parseMutationScope(nestedScopeBody(), '4'.repeat(64));
    expect(() => assertMutationScope(scope, { changed_paths: ['README.md'] }))
      .toThrow(MutationScopeError);
    try {
      assertMutationScope(scope, { changed_paths: ['README.md'] });
    } catch (error) {
      expect(error).toBeInstanceOf(MutationScopeError);
      expect((error as MutationScopeError).code).toBe('MUTATION_SCOPE_BLOCKED');
    }
  });

  test('exposes scope-check as a read-only Runtime command with an explicit diff target', () => {
    expect(parseCli([
      'scope-check',
      '--root',
      '.',
      '--path',
      'src/app.ts',
      '--transformation-kind',
      'localized',
    ])).toMatchObject({
      command: 'scope-check',
      root: '.',
      changedPaths: ['src/app.ts'],
      transformationKind: 'localized',
    });
  });
});
