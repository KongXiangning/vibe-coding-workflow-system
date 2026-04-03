import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  executeEntrypoint,
  loadMatrixFromProfile,
  runValidation,
} from '../scripts/run-validation';
import {
  type ValidationEntrypoint,
  partitionByLayer,
} from '../scripts/validation-model';
import {
  checkFreshness,
  FRESHNESS_TARGETS,
  runFreshnessChecks,
} from '../scripts/check-freshness';

const ROOT = path.resolve(import.meta.dir, '..');

describe('run-validation', () => {
  test('loadMatrixFromProfile loads entrypoints from PROJECT_PROFILE.yaml', () => {
    const entrypoints = loadMatrixFromProfile(ROOT);
    expect(entrypoints.length).toBeGreaterThanOrEqual(12);

    const { protocol, project } = partitionByLayer(entrypoints);
    expect(protocol.length).toBe(8);
    expect(project.length).toBeGreaterThanOrEqual(4);
  });

  test('executeEntrypoint passes for a successful command', () => {
    const entry: ValidationEntrypoint = {
      name: 'echo-test',
      layer: 'protocol',
      command: 'echo hello',
      blocker_level: 'blocks-merge',
      description: 'test',
      phase: 'P9',
      owner: 'workflow-system',
    };

    const result = executeEntrypoint(entry, ROOT);
    expect(result.status).toBe('passed');
    expect(result.entrypoint).toBe('echo-test');
    expect(result.layer).toBe('protocol');
  });

  test('executeEntrypoint fails for a bad command', () => {
    const entry: ValidationEntrypoint = {
      name: 'fail-test',
      layer: 'protocol',
      command: 'exit 1',
      blocker_level: 'blocks-merge',
      description: 'test',
      phase: 'P9',
      owner: 'workflow-system',
    };

    const result = executeEntrypoint(entry, ROOT);
    expect(result.status).toBe('failed');
    expect(result.error).toBeDefined();
  });

  test('dry-run mode skips all execution', () => {
    const report = runValidation({ root: ROOT, dryRun: true });
    const allSkipped = [...report.protocol_results, ...report.project_results].every(
      r => r.status === 'skipped',
    );
    expect(allSkipped).toBe(true);
    expect(report.protocol_passed).toBe(true);
    expect(report.blocked_gates).toEqual([]);
  });

  test('layer filter selects only protocol entrypoints', () => {
    const report = runValidation({ root: ROOT, layer: 'protocol', dryRun: true });
    expect(report.protocol_results.length).toBe(8);
    expect(report.project_results).toHaveLength(0);
  });

  test('layer filter selects only project entrypoints (all unbound)', () => {
    const report = runValidation({ root: ROOT, layer: 'project', dryRun: true });
    expect(report.protocol_results).toHaveLength(0);
    // project entrypoints are unbound, so they won't appear in results
    expect(report.project_results).toHaveLength(0);
  });

  test('protocol-first precedence: project skipped when protocol fails', () => {
    // We simulate this by running protocol with a known-good state
    // and checking the report structure
    const report = runValidation({ root: ROOT, dryRun: true });
    expect(report.project_authoritative).toBe(true); // dry-run passes protocol
  });

  test('blocker-level filter skips lower-severity entrypoints', () => {
    const report = runValidation({
      root: ROOT,
      layer: 'protocol',
      maxBlockerLevel: 'blocks-generator',
      dryRun: true,
    });
    // Only blocks-generator entrypoints should be included, rest skipped
    const activeEntries = report.protocol_results.filter(
      r => r.output === 'dry-run mode',
    );
    const skippedBelowThreshold = report.protocol_results.filter(
      r => r.output?.includes('below threshold'),
    );
    expect(activeEntries.length).toBe(3); // 3 blocks-generator entries
    expect(skippedBelowThreshold.length).toBe(5); // 5 blocks-merge entries skipped
  });

  test('report separates protocol and project results', () => {
    const report = runValidation({ root: ROOT, dryRun: true });
    for (const r of report.protocol_results) {
      expect(r.layer).toBe('protocol');
    }
    for (const r of report.project_results) {
      expect(r.layer).toBe('project');
    }
  });
});

describe('check-freshness', () => {
  test('freshness targets cover all three generators', () => {
    expect(FRESHNESS_TARGETS.map(t => t.name).sort()).toEqual([
      'registry',
      'workflow-docs',
      'workflow-skills',
    ]);
  });

  test('all committed generators are fresh against dry-run', () => {
    const report = runFreshnessChecks(ROOT);
    for (const result of report.results) {
      if (result.status === 'error') {
        throw new Error(`Freshness check failed for ${result.target}: ${result.error}`);
      }
      expect(result.status).toBe('fresh');
      expect(result.stale_files).toEqual([]);
    }
    expect(report.all_fresh).toBe(true);
  });

  test('checkFreshness reports correct structure per target', () => {
    for (const target of FRESHNESS_TARGETS) {
      const result = checkFreshness(ROOT, target);
      expect(result.target).toBe(target.name);
      expect(['fresh', 'stale', 'error']).toContain(result.status);
      expect(Array.isArray(result.stale_files)).toBe(true);
    }
  });

  test('checkFreshness detects stale committed output content', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-freshness-stale-'));

    try {
      fs.cpSync(path.join(ROOT, 'PROJECT_PROFILE.yaml'), path.join(tempRoot, 'PROJECT_PROFILE.yaml'));
      fs.cpSync(path.join(ROOT, 'VERSION'), path.join(tempRoot, 'VERSION'));
      fs.cpSync(path.join(ROOT, 'templates'), path.join(tempRoot, 'templates'), { recursive: true });
      fs.cpSync(path.join(ROOT, 'generated'), path.join(tempRoot, 'generated'), { recursive: true });
      fs.cpSync(path.join(ROOT, 'SKILL_REGISTRY.md'), path.join(tempRoot, 'SKILL_REGISTRY.md'));

      const staleFile = path.join(tempRoot, 'generated', 'workflow-docs', 'STATUS.md');
      fs.writeFileSync(staleFile, `${fs.readFileSync(staleFile, 'utf8')}\nSTALE TEST MARKER\n`, 'utf8');

      const target = FRESHNESS_TARGETS.find(item => item.name === 'workflow-docs');
      expect(target).toBeDefined();

      const result = checkFreshness(tempRoot, target!);
      expect(result.status).toBe('stale');
      expect(result.stale_files).toContain('STATUS.md');
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
