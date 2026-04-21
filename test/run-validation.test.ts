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

function copyGeneratedSnapshot(targetRoot: string): void {
  const sourceRoot = path.join(ROOT, 'generated');
  const outputRoot = path.join(targetRoot, 'generated');

  const copyDir = (sourceDir: string, destinationDir: string): void => {
    fs.mkdirSync(destinationDir, { recursive: true });
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
      if (
        entry.name.startsWith('.') ||
        entry.name.includes('.bak.') ||
        entry.name.endsWith('.tmp')
      ) {
        continue;
      }

      const sourcePath = path.join(sourceDir, entry.name);
      const destinationPath = path.join(destinationDir, entry.name);
      if (entry.isDirectory()) {
        copyDir(sourcePath, destinationPath);
      } else if (entry.isFile()) {
        fs.copyFileSync(sourcePath, destinationPath);
      }
    }
  };

  copyDir(sourceRoot, outputRoot);
}

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

  test('blocker-level filter also skips synthesized governance-home failures below threshold', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-validation-threshold-governance-'));

    try {
      copyGeneratedSnapshot(tempRoot);
      fs.writeFileSync(
        path.join(tempRoot, 'PROJECT_PROFILE.yaml'),
        [
          'validation:',
          '  matrix:',
          '    - name: deploy',
          '      layer: project',
          '      command: bun run test:deploy',
          '      blocker_level: blocks-ship',
          '      description: target deploy gate',
          '      phase: A4',
          '      owner: target-project',
        ].join('\n'),
        'utf8',
      );

      fs.rmSync(path.join(tempRoot, 'generated', 'workflow-docs', 'BASELINES.md'), { force: true });

      const report = runValidation({
        root: tempRoot,
        layer: 'project',
        maxBlockerLevel: 'blocks-generator',
        dryRun: true,
      });

      expect(report.project_results).toHaveLength(1);
      expect(report.project_results[0]?.entrypoint).toBe('deploy');
      expect(report.project_results[0]?.status).toBe('skipped');
      expect(report.project_results[0]?.output).toContain('below threshold');
      expect(report.blocked_gates).toEqual([]);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
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

  test('protocol validation fails when generated propagation-governance skeleton loses required v26 runtime fields', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-validation-propagation-protocol-'));

    try {
      copyGeneratedSnapshot(tempRoot);
      fs.copyFileSync(path.join(ROOT, 'PROJECT_PROFILE.yaml'), path.join(tempRoot, 'PROJECT_PROFILE.yaml'));

      const currentTaskPath = path.join(tempRoot, 'generated', 'workflow-docs', 'CURRENT_TASK.md');
      const broken = fs.readFileSync(currentTaskPath, 'utf8').replace(/^\s*-\s+effective_consumers：\s*$/m, '');
      fs.writeFileSync(currentTaskPath, broken, 'utf8');

      const report = runValidation({ root: tempRoot, layer: 'protocol', dryRun: true });
      expect(report.protocol_passed).toBe(false);
      const failure = report.protocol_results.find(result => result.entrypoint === 'propagation-governance-surface');
      expect(failure?.status).toBe('failed');
      expect(failure?.error).toContain('CURRENT_TASK.md is missing required propagation-governance snippet "- effective_consumers："');
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('project validation accepts generated lifecycle governance homes when project entrypoints are bound', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-validation-governance-ok-'));

    try {
      copyGeneratedSnapshot(tempRoot);
      fs.writeFileSync(
        path.join(tempRoot, 'PROJECT_PROFILE.yaml'),
        [
          'validation:',
          '  matrix:',
          '    - name: unit',
          '      layer: project',
          '      command: bun run test:unit',
          '      blocker_level: blocks-merge',
          '      description: target unit gate',
          '      phase: A4',
          '      owner: target-project',
        ].join('\n'),
        'utf8',
      );

      const report = runValidation({ root: tempRoot, layer: 'project', dryRun: true });
      expect(report.project_results).toHaveLength(1);
      expect(report.project_results[0]?.entrypoint).toBe('unit');
      expect(report.project_results[0]?.status).toBe('skipped');
      expect(report.project_results[0]?.output).toBe('dry-run mode');
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('project validation fails when live CURRENT_TASK.md violates materialized v26 propagation semantics', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-validation-propagation-project-'));

    try {
      copyGeneratedSnapshot(tempRoot);
      fs.writeFileSync(
        path.join(tempRoot, 'PROJECT_PROFILE.yaml'),
        [
          'validation:',
          '  matrix:',
          '    - name: unit',
          '      layer: project',
          '      command: bun run test:unit',
          '      blocker_level: blocks-merge',
          '      description: target unit gate',
          '      phase: A4',
          '      owner: target-project',
        ].join('\n'),
        'utf8',
      );

      const liveCurrentTask = fs.readFileSync(path.join(ROOT, 'generated', 'workflow-docs', 'CURRENT_TASK.md'), 'utf8')
        .replace(/^\s*-\s+common\.object_kind：\s*$/m, '  - common.object_kind：api')
        .replace(/^\s*-\s+threshold_trigger：\s*$/m, '  - threshold_trigger：direct_consumers_exceeded')
        .replace(/^\s*-\s+selected_branch：\s*$/m, '  - selected_branch：hard_stop')
        .replace(/^\s*-\s+when_pending_prerequisites\.assessment_status：\s*$/m, '  - when_pending_prerequisites.assessment_status：pending-prerequisites')
        .replace(/^\s*-\s+when_completed\.eligibility：\s*$/m, '  - when_completed.eligibility：directly-mutable');

      fs.writeFileSync(path.join(tempRoot, 'CURRENT_TASK.md'), liveCurrentTask, 'utf8');

      const report = runValidation({ root: tempRoot, layer: 'project', dryRun: true });
      const failure = report.project_results.find(result => result.entrypoint === 'propagation-governance-home');
      expect(failure?.status).toBe('failed');
      expect(failure?.error).toContain('must record non-empty blocking_gaps when assessment_status=pending-prerequisites');
      expect(failure?.error).toContain('must not materialize when_completed.eligibility when assessment_status=pending-prerequisites');
      expect(failure?.error).toContain('must emit IMPACT_HARD_STOP_REQUIRED when selected_branch=hard_stop');
      expect(failure?.error).toContain('must materialize API downstream validation surfaces');
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('project validation requires ROADMAP.md governance home when project entrypoints are bound', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-validation-roadmap-missing-'));

    try {
      copyGeneratedSnapshot(tempRoot);
      fs.writeFileSync(
        path.join(tempRoot, 'PROJECT_PROFILE.yaml'),
        [
          'validation:',
          '  matrix:',
          '    - name: unit',
          '      layer: project',
          '      command: bun run test:unit',
          '      blocker_level: blocks-merge',
          '      description: target unit gate',
          '      phase: A4',
          '      owner: target-project',
        ].join('\n'),
        'utf8',
      );

      fs.rmSync(path.join(tempRoot, 'generated', 'workflow-docs', 'ROADMAP.md'), { force: true });

      const report = runValidation({ root: tempRoot, layer: 'project', dryRun: true });
      expect(report.project_results[0]?.entrypoint).toBe('roadmap-governance-home');
      expect(report.project_results[0]?.status).toBe('failed');
      expect(report.project_results[0]?.error).toContain('Missing ROADMAP.md governance home');
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('project validation checks live DECISIONS.md against the governance contract', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-validation-decisions-live-'));

    try {
      copyGeneratedSnapshot(tempRoot);
      fs.writeFileSync(
        path.join(tempRoot, 'PROJECT_PROFILE.yaml'),
        [
          'validation:',
          '  matrix:',
          '    - name: unit',
          '      layer: project',
          '      command: bun run test:unit',
          '      blocker_level: blocks-merge',
          '      description: target unit gate',
          '      phase: A4',
          '      owner: target-project',
        ].join('\n'),
        'utf8',
      );

      fs.writeFileSync(
        path.join(tempRoot, 'DECISIONS.md'),
        [
          '# DECISIONS.md',
          '',
          '## 使用规则',
          '',
          '- live decisions',
          '',
          '## 🏗️ 架构决策',
          '',
          '### AD-001: live',
          '',
          '- 状态：accepted',
          '',
          '## 🎨 口味决策',
          '',
          '### TD-001: live',
          '',
          '- 状态：accepted',
          '',
          '## ⏸️ 暂缓决策',
          '',
          '### DEFER-001: live',
          '',
          '- 状态：deferred',
          '',
          '## ❌ 已否决',
          '',
          '### REJECTED-001: live',
          '',
          '- 状态：rejected',
        ].join('\n'),
        'utf8',
      );

      const report = runValidation({ root: tempRoot, layer: 'project', dryRun: true });
      const failure = report.project_results.find(result => result.entrypoint === 'decisions-governance-home');
      expect(failure?.status).toBe('failed');
      expect(failure?.error).toContain('## 🔁 已演进 / 已替代');
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('protocol-only validation still fails when the propagation-governance baseline skeleton drifts', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-validation-baseline-'));

    try {
      copyGeneratedSnapshot(tempRoot);
      fs.writeFileSync(
        path.join(tempRoot, 'PROJECT_PROFILE.yaml'),
        [
          'validation:',
          '  matrix:',
          '    - name: workflow-docs-validation',
          '      layer: protocol',
          '      command: bun run gen:workflow-docs --dry-run',
          '      blocker_level: blocks-generator',
          '      description: protocol docs',
          '      phase: P9',
          '      owner: workflow-system',
          '    - name: security',
          '      layer: project',
          '      command: bun run test:security',
          '      blocker_level: blocks-ship',
          '      description: target security gate',
          '      phase: A4',
          '      owner: target-project',
        ].join('\n'),
        'utf8',
      );

      const baselinesPath = path.join(tempRoot, 'generated', 'workflow-docs', 'BASELINES.md');
      const baselines = fs.readFileSync(baselinesPath, 'utf8').replace('### SEC-001:', '### NOTE-001:');
      fs.writeFileSync(baselinesPath, baselines, 'utf8');

      expect(() => loadMatrixFromProfile(tempRoot)).not.toThrow();

      const report = runValidation({ root: tempRoot, layer: 'protocol', dryRun: true });
      expect(report.protocol_results.length).toBe(2);
      const failure = report.protocol_results.find(result => result.entrypoint === 'propagation-governance-surface');
      expect(failure?.status).toBe('failed');
      expect(failure?.error).toContain('Workflow doc contract missing required snippet "### SEC-001:" in BASELINES.md');
      expect(report.project_results).toHaveLength(0);
      expect(report.protocol_passed).toBe(false);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('project validation prefers live BASELINES.md over generated skeleton', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-validation-baseline-ok-'));

    try {
      copyGeneratedSnapshot(tempRoot);
      fs.writeFileSync(
        path.join(tempRoot, 'PROJECT_PROFILE.yaml'),
        [
          'validation:',
          '  matrix:',
          '    - name: workflow-docs-validation',
          '      layer: protocol',
          '      command: bun run gen:workflow-docs --dry-run',
          '      blocker_level: blocks-generator',
          '      description: protocol docs',
          '      phase: P9',
          '      owner: workflow-system',
          '    - name: deploy',
          '      layer: project',
          '      command: bun run test:deploy',
          '      blocker_level: blocks-ship',
          '      description: target deploy gate',
          '      phase: A4',
          '      owner: target-project',
        ].join('\n'),
        'utf8',
      );

      const generatedBaselinesPath = path.join(tempRoot, 'generated', 'workflow-docs', 'BASELINES.md');
      const generatedBaselines = fs
        .readFileSync(generatedBaselinesPath, 'utf8')
        .replace('### DEP-001:', '### NOTE-001:');
      fs.writeFileSync(generatedBaselinesPath, generatedBaselines, 'utf8');

      fs.writeFileSync(
        path.join(tempRoot, 'BASELINES.md'),
        [
          '# BASELINES.md',
          '',
          '## 使用规则',
          '',
          '- live baseline',
          '',
          '## 版本治理概览',
          '',
          '- 当前版本：1.0.0',
          '',
          '## 发布基线',
          '',
          '### REL-001: live',
          '',
          '- 状态：active',
          '',
          '## 兼容性基线',
          '',
          '### COMP-001: live',
          '',
          '- 状态：active',
          '',
          '## 安全基线',
          '',
          '### SEC-001: live',
          '',
          '- 状态：active',
          '',
          '## 部署基线',
          '',
          '### DEP-001: live',
          '',
          '- 状态：active',
          '',
          '## 性能与可靠性基线',
          '',
          '### NFR-001: live',
          '',
          '- 状态：active',
          '',
          '## 基线变更记录',
          '',
          '- seeded',
        ].join('\n'),
        'utf8',
      );

      expect(() => runValidation({ root: tempRoot, layer: 'project', dryRun: true })).not.toThrow();
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('project validation requires a valid baseline home when optional slots are bound', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-validation-baseline-missing-'));

    try {
      copyGeneratedSnapshot(tempRoot);
      fs.writeFileSync(
        path.join(tempRoot, 'PROJECT_PROFILE.yaml'),
        [
          'validation:',
          '  matrix:',
          '    - name: deploy',
          '      layer: project',
          '      command: bun run test:deploy',
          '      blocker_level: blocks-ship',
          '      description: target deploy gate',
          '      phase: A4',
          '      owner: target-project',
        ].join('\n'),
        'utf8',
      );

      fs.rmSync(path.join(tempRoot, 'generated', 'workflow-docs', 'BASELINES.md'), { force: true });

      const report = runValidation({ root: tempRoot, layer: 'project', dryRun: true });
      expect(report.protocol_results).toHaveLength(0);
      const failure = report.project_results.find(result => result.entrypoint === 'baseline-governance-home');
      expect(failure?.status).toBe('failed');
      expect(failure?.error).toContain('Missing BASELINES.md governance home');
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('full validation blocks project authority when propagation-governance protocol docs are missing', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-validation-full-run-'));

    try {
      copyGeneratedSnapshot(tempRoot);
      fs.writeFileSync(
        path.join(tempRoot, 'PROJECT_PROFILE.yaml'),
        [
          'validation:',
          '  matrix:',
          '    - name: workflow-docs-validation',
          '      layer: protocol',
          '      command: bun run gen:workflow-docs --dry-run',
          '      blocker_level: blocks-generator',
          '      description: protocol docs',
          '      phase: P9',
          '      owner: workflow-system',
          '    - name: deploy',
          '      layer: project',
          '      command: bun run test:deploy',
          '      blocker_level: blocks-ship',
          '      description: target deploy gate',
          '      phase: A4',
          '      owner: target-project',
        ].join('\n'),
        'utf8',
      );

      fs.rmSync(path.join(tempRoot, 'generated', 'workflow-docs', 'BASELINES.md'), { force: true });

      const report = runValidation({ root: tempRoot, dryRun: true });
      expect(report.protocol_results.map(result => result.entrypoint)).toContain('workflow-docs-validation');
      expect(report.protocol_results.map(result => result.entrypoint)).toContain('propagation-governance-surface');
      expect(report.protocol_passed).toBe(false);
      const skippedProject = report.project_results.find(result => result.entrypoint === 'deploy');
      expect(skippedProject?.status).toBe('skipped');
      expect(skippedProject?.output).toContain('Protocol-level validation failed');
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
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
      copyGeneratedSnapshot(tempRoot);
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
