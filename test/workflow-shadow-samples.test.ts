import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  REQUIRED_SHADOW_SAMPLE_SCENARIOS,
  parseShadowSampleMatrix,
  runShadowSampleSuite,
  type ShadowSampleMatrix,
} from '../scripts/workflow-shadow-samples';

const ROOT = path.resolve(import.meta.dir, '..');
const MATRIX_PATH = path.join(ROOT, 'test', 'fixtures', 'workflow-vnext-shadow-sample-matrix.yaml');
const TEMP_ROOTS: string[] = [];

function write(root: string, relativePath: string, content: string): void {
  const target = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

function makeFixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-shadow-samples-test-'));
  TEMP_ROOTS.push(root);
  write(root, '.workflow-system/WORKFLOW_PROTOCOL.md', '# Protocol\nReview is read-only.\n');
  write(root, '.workflow-system/FILE_SCHEMAS.md', '# Schemas\nReview records evidence.\n');
  write(root, '.workflow-system/PROJECT_PROFILE.yaml', [
    'project: fixture',
    'paths:',
    '  workflow_home: docs/workflow',
    'boundaries:',
    '  forbidden_paths: [.git/**, node_modules/**]',
    'architecture_rules:',
    '  - Keep review read-only.',
    'validation:',
    '  preferred_checks: [bun test]',
  ].join('\n'));
  write(root, 'docs/workflow/CONTRACTS.md', '# Contracts\n');
  write(root, 'docs/workflow/DECISIONS.md', '# Decisions\n');
  write(root, 'docs/workflow/STATUS.md', '# Status\n');
  write(root, 'docs/workflow/LESSONS.md', '# Lessons\n');
  write(root, 'src/example.ts', 'export const value = 1;\n');
  return root;
}

function cloneMatrix(): ShadowSampleMatrix {
  return structuredClone(parseShadowSampleMatrix(fs.readFileSync(MATRIX_PATH, 'utf8')));
}

afterEach(() => {
  while (TEMP_ROOTS.length > 0) {
    fs.rmSync(TEMP_ROOTS.pop()!, { recursive: true, force: true });
  }
});

describe('Phase 1 legacy-vs-shadow sample runner', () => {
  test('runs every required representative scenario on disposable copies', () => {
    const fixtureRoot = makeFixtureRoot();
    const before = fs.readFileSync(path.join(fixtureRoot, '.workflow-system', 'PROJECT_PROFILE.yaml'));
    const report = runShadowSampleSuite({
      fixtureRoot,
      matrixPath: MATRIX_PATH,
      now: '2026-08-30T00:00:00Z',
    });

    expect(report.status).toBe('passed');
    expect(report.hardMismatches).toEqual([]);
    expect(report.coverage.full).toBe(true);
    expect(report.coverage.missingScenarioIds).toEqual([]);
    expect(report.samples).toHaveLength(REQUIRED_SHADOW_SAMPLE_SCENARIOS.length);
    expect(report.samples.every(sample => sample.status === 'passed')).toBe(true);
    expect(report.samples.every(sample => sample.executionAudit?.legacyRoot !== fixtureRoot)).toBe(true);
    expect(report.samples.every(sample => sample.executionAudit?.shadowRoot !== fixtureRoot)).toBe(true);
    expect(report.promotionEvidenceEligible).toBe(false);
    expect(report.promotionEvidenceStatus).toBe('not-assessed');
    expect(fs.readFileSync(path.join(fixtureRoot, '.workflow-system', 'PROJECT_PROFILE.yaml'))).toEqual(before);
  });

  test('re-executes an observed legacy callback in a separate clean copy', () => {
    const fixtureRoot = makeFixtureRoot();
    const legacyRoots: string[] = [];
    const report = runShadowSampleSuite({
      fixtureRoot,
      matrixPath: MATRIX_PATH,
      runLegacy: (legacyRoot, _sample, baseline) => {
        legacyRoots.push(legacyRoot);
        expect(path.resolve(legacyRoot)).not.toBe(path.resolve(fixtureRoot));
        return baseline;
      },
    });

    expect(report.status).toBe('passed');
    expect(new Set(legacyRoots).size).toBe(REQUIRED_SHADOW_SAMPLE_SCENARIOS.length);
  });

  test('hard-blocks a missing or unparseable legacy baseline', () => {
    const fixtureRoot = makeFixtureRoot();
    const invalid = fs.readFileSync(MATRIX_PATH, 'utf8').replace(
      '      capturedAt: 2026-08-30T00:00:00Z',
      '      capturedAt: not-a-date',
    );
    const invalidPath = path.join(fixtureRoot, 'invalid-matrix.yaml');
    fs.writeFileSync(invalidPath, invalid, 'utf8');

    const report = runShadowSampleSuite({ fixtureRoot, matrixPath: invalidPath });

    expect(report.status).toBe('blocked');
    expect(report.promotionEvidenceEligible).toBe(false);
    expect(report.hardMismatches[0]?.fields[0]).toContain('matrix-invalid');
    expect(report.legacyRemainsAuthoritative).toBe(true);

    const directMatrix = cloneMatrix() as any;
    delete directMatrix.cases[0].legacy.captureKind;
    const directReport = runShadowSampleSuite({ fixtureRoot, matrix: directMatrix });
    expect(directReport.status).toBe('blocked');
    expect(directReport.hardMismatches[0]?.fields[0]).toContain('matrix-invalid');
  });

  test('compares actual path sets as a hard invariant', () => {
    const fixtureRoot = makeFixtureRoot();
    const matrix = cloneMatrix();
    matrix.cases[0].legacy.actualPathSet = ['wrong/path.ts'];

    const report = runShadowSampleSuite({ fixtureRoot, matrix });

    expect(report.status).toBe('failed');
    expect(report.hardMismatches.find(item => item.sampleId === matrix.cases[0].id)?.fields)
      .toContain('actual-path-set');
  });

  test('blocks when a representative scenario is absent', () => {
    const fixtureRoot = makeFixtureRoot();
    const matrix = cloneMatrix();
    matrix.cases = matrix.cases.filter(item => item.scenario !== 'scope-blocker');

    const report = runShadowSampleSuite({ fixtureRoot, matrix });

    expect(report.status).toBe('blocked');
    expect(report.coverage.missingScenarioIds).toContain('scope-blocker');
    expect(report.blockers.some(item => item.startsWith('missing-scenarios:'))).toBe(true);
    expect(report.promotionEvidenceEligible).toBe(false);
  });

  test('allows one declared observed model/harness axis without inventing a multi-model threshold', () => {
    const fixtureRoot = makeFixtureRoot();
    const matrix = cloneMatrix();
    matrix.requiredAxes = { models: ['observed-model'], harnesses: ['observed-harness'] };

    const report = runShadowSampleSuite({
      fixtureRoot,
      matrix,
      runLegacy: (_legacyRoot, _sample, baseline) => ({
        ...baseline,
        captureKind: 'observed',
        model: 'observed-model',
        harness: 'observed-harness',
        capturedAt: '2026-08-30T01:00:00Z',
        evidenceLocator: `observed://${_sample.id}`,
      }),
    });

    expect(report.status).toBe('passed');
    expect(report.observedModelHarnessAxes.missingPairs).toEqual([]);
    expect(report.promotionEvidenceEligible).toBe(true);
    expect(report.promotionEvidenceStatus).toBe('eligible');
  });

  test('requires every declared scenario/model/harness cell, not only each axis pair somewhere', () => {
    const fixtureRoot = makeFixtureRoot();
    const matrix = cloneMatrix();
    matrix.requiredAxes = { models: ['model-a', 'model-b'], harnesses: ['harness-a'] };

    const report = runShadowSampleSuite({
      fixtureRoot,
      matrix,
      runLegacy: (_legacyRoot, sample, baseline) => ({
        ...baseline,
        captureKind: 'observed',
        model: sample.scenario === 'small-clean' ? 'model-b' : 'model-a',
        harness: 'harness-a',
        capturedAt: '2026-08-30T01:00:00Z',
        evidenceLocator: `observed://${sample.id}`,
      }),
    });

    expect(report.observedModelHarnessAxes.missingPairs).toEqual([]);
    expect(report.coverage.missingScenarioAxisCells).toContain('small-clean::model-a::harness-a');
    expect(report.coverage.missingScenarioAxisCells).toContain('checkpoint-continuity::model-b::harness-a');
    expect(report.status).toBe('blocked');
    expect(report.promotionEvidenceEligible).toBe(false);
  });

  test('does not promote a contract fixture by relabeling it as observed', () => {
    const fixtureRoot = makeFixtureRoot();
    const matrix = cloneMatrix();
    matrix.requiredAxes = { models: ['observed-model'], harnesses: ['observed-harness'] };

    const report = runShadowSampleSuite({
      fixtureRoot,
      matrix,
      runLegacy: (_legacyRoot, _sample, baseline) => ({
        ...baseline,
        captureKind: 'observed',
        model: 'observed-model',
        harness: 'observed-harness',
      }),
    });

    expect(report.status).toBe('blocked');
    expect(report.blockers.some(item => item.includes('fresh evidenceLocator'))).toBe(true);
    expect(report.promotionEvidenceEligible).toBe(false);
  });

  test('blocks source fixture symlinks before making or overlaying a copy', () => {
    const fixtureRoot = makeFixtureRoot();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-shadow-outside-'));
    TEMP_ROOTS.push(outside);
    const link = path.join(fixtureRoot, 'linked');
    try {
      fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      return;
    }

    const report = runShadowSampleSuite({ fixtureRoot, matrixPath: MATRIX_PATH });

    expect(report.status).toBe('blocked');
    expect(report.blockers.some(item => item.includes('fixture-copy-symlink-unsupported:linked'))).toBe(true);
  });
});
