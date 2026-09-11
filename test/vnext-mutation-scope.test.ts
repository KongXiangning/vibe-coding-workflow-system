import { describe, expect, test } from 'bun:test';
import {
  auditCommandMutation,
  assertMutationScope,
  evaluateCommandWriteFootprint,
  evaluateMutationScope,
  MutationScopeError,
  mutationScopePatternIsSubset,
  nonExecutableChangePatternIsBounded,
  parseMutationScope,
  type CommandWriteFootprint,
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
  persistentTests?: string;
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
    ...(options.persistentTests === undefined ? [] : [
      '## 回归检查项',
      '',
      '### Persistent Tests',
      '',
      `- ${options.persistentTests}`,
      '',
    ]),
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

function commandFootprint(targets: string[], overrides: Partial<CommandWriteFootprint> = {}): CommandWriteFootprint {
  return {
    kind: 'bounded',
    targets,
    evidence_refs: ['config:known-command-output'],
    ...overrides,
  };
}

describe('vNext Mutation-oriented Scope', () => {
  test('accepts only exact or literal-directory non-executable classifications', () => {
    expect(nonExecutableChangePatternIsBounded('README.md')).toBe(true);
    expect(nonExecutableChangePatternIsBounded('docs/product/**')).toBe(true);
    expect(nonExecutableChangePatternIsBounded('**')).toBe(false);
    expect(nonExecutableChangePatternIsBounded('*/**')).toBe(false);
    expect(nonExecutableChangePatternIsBounded('*/*/**')).toBe(false);
    expect(nonExecutableChangePatternIsBounded('docs*/**')).toBe(false);
    expect(nonExecutableChangePatternIsBounded('docs/*.md')).toBe(false);
    expect(nonExecutableChangePatternIsBounded('docs/**/guide.md')).toBe(false);
  });

  test('proves only exact or conservatively contained non-executable scope patterns', () => {
    expect(mutationScopePatternIsSubset('README.md', 'README.md')).toBe(true);
    expect(mutationScopePatternIsSubset('docs/product/guide.md', 'docs/product/**')).toBe(true);
    expect(mutationScopePatternIsSubset('docs/product/*.md', 'docs/product/**')).toBe(true);
    expect(mutationScopePatternIsSubset('docs/product/**', 'docs/**')).toBe(true);
    expect(mutationScopePatternIsSubset('docs/**', 'docs/product/**')).toBe(false);
    expect(mutationScopePatternIsSubset('docs/product/*.md', 'docs/product/*')).toBe(false);
    expect(mutationScopePatternIsSubset('src/app.ts', 'docs/**')).toBe(false);
  });

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

  test('admits only the exact persistent-test path frozen into Allowed Files', () => {
    const scope = parseMutationScope(nestedScopeBody({
      allowed: 'test/tickets.test.ts',
      readDiscovery: 'test/**',
    }), '5'.repeat(64));
    const result = evaluateMutationScope(scope, {
      changed_paths: ['test/tickets.test.ts', 'test/persistence.test.ts'],
    });

    expect(result.status).toBe('blocked');
    expect(result.admitted_paths).toEqual(['test/tickets.test.ts']);
    expect(result.decisions).toEqual([
      expect.objectContaining({
        path: 'test/tickets.test.ts',
        classification: 'allowed-exact',
        mutation_admitted: true,
      }),
      expect.objectContaining({
        path: 'test/persistence.test.ts',
        classification: 'read-context-only',
        mutation_admitted: false,
      }),
    ]);
  });

  test('blocks an unlisted persistent test even when a broad Allowed pattern matches', () => {
    const scope = parseMutationScope(nestedScopeBody({
      allowed: 'test/**',
      persistentTests: '`test/tickets.test.ts`',
    }), '6'.repeat(64));
    const result = evaluateMutationScope(scope, {
      changed_paths: ['test/tickets.test.ts', 'test/unlisted.test.ts'],
      transformation_kind: 'inherently-broad',
    });

    expect(scope.persistent_tests).toEqual(['test/tickets.test.ts']);
    expect(result.status).toBe('blocked');
    expect(result.admitted_paths).toEqual(['test/tickets.test.ts']);
    expect(result.decisions[1]).toMatchObject({
      path: 'test/unlisted.test.ts',
      classification: 'persistent-test-unadmitted',
      mutation_admitted: false,
    });
  });

  test('uses an explicit persistent-test disposition for unconventional test paths', () => {
    const scope = parseMutationScope(nestedScopeBody({
      allowed: 'qa/check.ts',
      persistentTests: 'none',
    }), '7'.repeat(64));
    const result = evaluateMutationScope(scope, {
      changed_paths: ['qa/check.ts'],
      persistent_test_paths: ['qa/check.ts'],
    });

    expect(result.status).toBe('blocked');
    expect(result.decisions[0]?.classification).toBe('persistent-test-unadmitted');
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

  test('blocks a Forbidden ignored build output before the command can run', () => {
    const scope = parseMutationScope(nestedScopeBody({
      allowed: 'src/app.ts',
      forbidden: 'dist/**',
    }), '5'.repeat(64));
    const result = auditCommandMutation(scope, {
      command: 'npm run build',
      expected_write_footprint: commandFootprint(['dist/**'], {
        evidence_refs: ['tsconfig.json#compilerOptions.outDir'],
      }),
      observed_write_paths: [],
    });

    expect(result.status).toBe('blocked');
    expect(result.command_may_run).toBe(false);
    expect(result.observed_status).toBe('not-run');
    expect(result.expected.blocked_targets).toEqual(['dist/**']);
    expect(result.blockers.join(' ')).toMatch(/Forbidden Files takes precedence/);
  });

  test('admits an explicitly bounded generated output and audits the observed path through the same scope judgment', () => {
    const scope = parseMutationScope(nestedScopeBody({
      allowed: 'dist/generated.js',
      forbidden: '.git/**',
    }), '6'.repeat(64));
    const result = auditCommandMutation(scope, {
      command: 'node scripts/generate.ts',
      expected_write_footprint: commandFootprint(['dist/generated.js'], {
        evidence_refs: ['generator-config:dist/generated.js'],
      }),
      observed_write_paths: ['dist/generated.js'],
    });

    expect(result.status).toBe('pass');
    expect(result.command_may_run).toBe(true);
    expect(result.expected.status).toBe('pass');
    expect(result.observed_status).toBe('pass');
    expect(result.observed?.admitted_paths).toEqual(['dist/generated.js']);
  });

  test('admits a bounded output tree only when the existing broad-scope rule also admits it', () => {
    const scope = parseMutationScope(nestedScopeBody({
      allowed: 'build/**',
      forbidden: '.git/**',
    }), '7'.repeat(64));
    const result = auditCommandMutation(scope, {
      command: 'npm run generated-build',
      expected_write_footprint: commandFootprint(['build/**'], {
        evidence_refs: ['build-config:outDir'],
      }),
      transformation_kind: 'inherently-broad',
      observed_write_paths: ['build/output.js'],
    });

    expect(result.status).toBe('pass');
    expect(result.expected.target_evaluations[0]?.representative_paths.length).toBe(2);
    expect(result.observed?.decisions[0]?.classification).toBe('allowed-broad');
  });

  test('blocks unknown untracked and unknown ignored outputs by default deny', () => {
    const scope = parseMutationScope(nestedScopeBody({
      allowed: 'src/app.ts',
      forbidden: '.git/**',
    }), '8'.repeat(64));
    const untracked = auditCommandMutation(scope, {
      command: 'node scripts/generate.ts',
      expected_write_footprint: commandFootprint(['tmp/generated.txt']),
      observed_write_paths: [],
    });
    const ignored = auditCommandMutation(scope, {
      command: 'node scripts/generate-cache.ts',
      expected_write_footprint: commandFootprint(['.cache/generated.json']),
      observed_write_paths: [],
    });
    const install = auditCommandMutation(scope, {
      command: 'npm install',
      expected_write_footprint: commandFootprint(['node_modules/**'], {
        evidence_refs: ['package.json#dependencies', 'package-lock.json'],
      }),
      observed_write_paths: [],
    });

    expect(untracked.status).toBe('blocked');
    expect(untracked.command_may_run).toBe(false);
    expect(untracked.blockers.join(' ')).toMatch(/not listed in Allowed Files/);
    expect(ignored.status).toBe('blocked');
    expect(ignored.command_may_run).toBe(false);
    expect(ignored.blockers.join(' ')).toMatch(/not listed in Allowed Files/);
    expect(install.status).toBe('blocked');
    expect(install.command_may_run).toBe(false);
  });

  test('keeps an observed unauthorized mutation blocked after cleanup', () => {
    const scope = parseMutationScope(nestedScopeBody({
      allowed: 'src/app.ts',
      forbidden: 'dist/**',
    }), '9'.repeat(64));
    const result = auditCommandMutation(scope, {
      command: 'node scripts/side-effectful-check.ts',
      expected_write_footprint: commandFootprint(['src/app.ts']),
      observed_write_paths: ['src/app.ts', 'dist/output.js'],
      cleanup: { performed: true, paths: ['dist/output.js'] },
    });

    expect(result.status).toBe('blocked');
    expect(result.command_may_run).toBe(true);
    expect(result.observed_status).toBe('blocked');
    expect(result.unauthorized_observed_paths).toEqual(['dist/output.js']);
    expect(result.cleanup_performed).toBe(true);
    expect(result.cleanup_paths).toEqual(['dist/output.js']);
    expect(result.audited_write_paths).toEqual(['src/app.ts', 'dist/output.js']);
  });

  test('blocks a repo-writing command when its expected footprint is unbounded before execution', () => {
    const scope = parseMutationScope(nestedScopeBody(), 'a'.repeat(64));
    const result = evaluateCommandWriteFootprint(scope, {
      command: 'custom-tool --write-anywhere',
      expected_write_footprint: {
        kind: 'unbounded',
        targets: [],
        evidence_refs: [],
        reason: 'the tool can write arbitrary repository paths',
      },
    });

    expect(result.status).toBe('blocked');
    expect(result.blockers.join(' ')).toMatch(/unbounded|bounded expected_write_footprint/i);
    expect(auditCommandMutation(scope, {
      command: 'custom-tool --write-anywhere',
      expected_write_footprint: {
        kind: 'unbounded',
        targets: [],
        evidence_refs: [],
        reason: 'the tool can write arbitrary repository paths',
      },
      observed_write_paths: ['src/app.ts'],
    }).observed_status).toBe('not-run');
  });

  test('exposes scope-check as a read-only Runtime command with an explicit diff target', () => {
    expect(parseCli([
      'scope-check',
      '--root',
      '.',
      '--path',
      'src/app.ts',
      '--persistent-test-path',
      'qa/check.ts',
      '--transformation-kind',
      'localized',
    ])).toMatchObject({
      command: 'scope-check',
      root: '.',
      changedPaths: ['src/app.ts'],
      persistentTestPaths: ['qa/check.ts'],
      transformationKind: 'localized',
    });
  });

  test('exposes command-footprint audit through the existing read-only scope-check boundary', () => {
    expect(parseCli([
      'scope-check',
      '--root',
      '.',
      '--command-audit-stdin',
    ])).toMatchObject({
      command: 'scope-check',
      commandAuditStdin: true,
    });
  });
});
