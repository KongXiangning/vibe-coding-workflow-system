import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadProfile } from '../scripts/workflow-core';
import {
  buildHostSyncPlan,
  buildWorkflowHealthReport,
  detectRuntimeHost,
  getExportManifest,
  syncWorkflowHost,
} from '../scripts/workflow-runtime';

const ROOT = path.resolve(import.meta.dir, '..');

function withTempRoot(run: (root: string) => void): void {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-runtime-'));
  try {
    run(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function writeGeneratedSkill(root: string, name: string, content = '# Skill\n'): void {
  const skillDir = path.join(root, 'generated', 'workflow-skills');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, `${name}.SKILL.md`), content, 'utf8');
}

function writeProfile(root: string, primaryHost: string): void {
  fs.writeFileSync(
    path.join(root, 'PROJECT_PROFILE.yaml'),
    [
      'schema_version: 1',
      '',
      'project:',
      '  name: temp-project',
      '  type: sample',
      '  primary_hosts:',
      `    - ${primaryHost}`,
      '',
    ].join('\n'),
    'utf8',
  );
}

function buildManifestPackageJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: '1.0.0',
    type: 'module',
    engines: { bun: '>=1.0.0' },
    scripts: {
      'gen:workflow-docs': 'bun run scripts/gen-workflow-docs.ts',
      'gen:workflow-skills': 'bun run scripts/gen-workflow-skills.ts',
      'gen:registry': 'bun run scripts/gen-registry.ts',
      'gen:all': 'bun run gen:workflow-skills && bun run gen:workflow-docs && bun run gen:registry',
      'bootstrap:project-governance': 'bun run scripts/bootstrap-project-governance.ts --dry-run',
      'validate:protocol': 'bun run scripts/run-validation.ts --layer=protocol',
      'validate:all': 'bun run scripts/run-validation.ts',
      'validate:freshness': 'bun run scripts/check-freshness.ts',
      'workflow:health': 'bun run scripts/workflow-runtime.ts health',
      'workflow:manifest': 'bun run scripts/workflow-runtime.ts manifest',
      'workflow:sync': 'bun run scripts/workflow-runtime.ts sync',
    },
    dependencies: { yaml: '^2.8.3' },
    ...overrides,
  }, null, 2);
}

describe('workflow-runtime manifest', () => {
  test('export manifest includes runtime contract artifacts and host notes', () => {
    const manifest = getExportManifest(ROOT);
    expect(manifest.contract_version).toBe(1);
    expect(manifest.artifacts.some(artifact => artifact.path === 'scripts/workflow-runtime.ts' && artifact.required)).toBe(true);
    expect(manifest.artifacts.some(artifact => artifact.path === 'WORKFLOW_PROTOCOL.md' && artifact.category === 'protocol')).toBe(true);
    expect(manifest.artifacts.some(artifact =>
      artifact.path === 'package.json' &&
      artifact.category === 'config' &&
      artifact.description.includes('workflow:* / gen:* / validate:* script contract'),
    )).toBe(true);
    expect(manifest.package_json_contract.type).toBe('module');
    expect(manifest.package_json_contract.engines.bun).toBe('>=1.0.0');
    expect(manifest.package_json_contract.dependencies.yaml).toBe('^2.8.3');
    expect(manifest.package_json_contract.scripts['gen:all']).toBe('bun run gen:workflow-skills && bun run gen:workflow-docs && bun run gen:registry');
    expect(manifest.package_json_contract.scripts['workflow:health']).toBe('bun run scripts/workflow-runtime.ts health');
    expect(manifest.import_contract.install.adoption_stage).toBe('A1');
    expect(manifest.import_contract.install.steps.map(step => step.name)).toContain('package-json-integration');
    expect(manifest.import_contract.install.steps.map(step => step.name)).not.toContain('generate-outputs');
    expect(manifest.import_contract.install.steps.map(step => step.name)).not.toContain('sync-host-runtime');
    expect(manifest.import_contract.adopt.adoption_stage).toBe('A3');
    expect(manifest.import_contract.adopt.steps.map(step => step.name)).toContain('generate-outputs');
    expect(manifest.import_contract.adopt.steps.map(step => step.name)).toContain('sync-host-runtime');
    expect(manifest.host_compatibility.codex.runtime_root).toBe(path.join('.agents', 'skills'));
    expect(manifest.host_compatibility.codex.isolated_prefix).toBe('workflow-system-');
    expect(manifest.verification).toContain('bun run workflow:health');
  });

  test('export manifest fails when package.json type is not module', () => {
    withTempRoot(root => {
      fs.writeFileSync(
        path.join(root, 'package.json'),
        buildManifestPackageJson({ type: 'commonjs' }),
        'utf8',
      );

      expect(() => getExportManifest(root)).toThrow(
        'package.json is missing required workflow module contract: "type": "module"',
      );
    });
  });

  test('export manifest fails when a required workflow script contract entry is missing', () => {
    withTempRoot(root => {
      fs.writeFileSync(
        path.join(root, 'package.json'),
        buildManifestPackageJson({
          scripts: {
            'gen:workflow-docs': 'bun run scripts/gen-workflow-docs.ts',
            'gen:workflow-skills': 'bun run scripts/gen-workflow-skills.ts',
            'gen:registry': 'bun run scripts/gen-registry.ts',
            'bootstrap:project-governance': 'bun run scripts/bootstrap-project-governance.ts --dry-run',
            'validate:protocol': 'bun run scripts/run-validation.ts --layer=protocol',
            'validate:all': 'bun run scripts/run-validation.ts',
            'validate:freshness': 'bun run scripts/check-freshness.ts',
            'workflow:health': 'bun run scripts/workflow-runtime.ts health',
            'workflow:manifest': 'bun run scripts/workflow-runtime.ts manifest',
            'workflow:sync': 'bun run scripts/workflow-runtime.ts sync',
          },
        }),
        'utf8',
      );

      expect(() => getExportManifest(root)).toThrow(
        'package.json is missing required workflow script contract entry: gen:all',
      );
    });
  });

  test('export manifest fails when yaml runtime dependency is missing', () => {
    withTempRoot(root => {
      fs.writeFileSync(
        path.join(root, 'package.json'),
        buildManifestPackageJson({ dependencies: {} }),
        'utf8',
      );

      expect(() => getExportManifest(root)).toThrow(
        'package.json is missing required workflow runtime dependency: yaml',
      );
    });
  });

  test('export manifest fails when bun engine contract is missing', () => {
    withTempRoot(root => {
      fs.writeFileSync(
        path.join(root, 'package.json'),
        buildManifestPackageJson({ engines: {} }),
        'utf8',
      );

      expect(() => getExportManifest(root)).toThrow(
        'package.json is missing required workflow engine contract: engines.bun',
      );
    });
  });
});

describe('workflow-runtime host detection', () => {
  test('directory marker wins over profile fallback, and explicit host wins over both', () => {
    withTempRoot(root => {
      writeProfile(root, 'claude');
      fs.mkdirSync(path.join(root, '.agents', 'skills'), { recursive: true });
      const profile = loadProfile(path.join(root, 'PROJECT_PROFILE.yaml'));

      expect(detectRuntimeHost(root, profile).host).toBe('codex');
      expect(detectRuntimeHost(root, profile, 'factory').host).toBe('factory');
    });
  });

  test('profile fallback works when no host directory is present', () => {
    withTempRoot(root => {
      writeProfile(root, 'codex');
      const profile = loadProfile(path.join(root, 'PROJECT_PROFILE.yaml'));
      const detected = detectRuntimeHost(root, profile);
      expect(detected.host).toBe('codex');
      expect(detected.source).toBe('profile');
    });
  });
});

describe('workflow-runtime sync', () => {
  test('host sync plan uses isolated workflow-system targets and reports orphaned workflow-system dirs only', () => {
    withTempRoot(root => {
      writeGeneratedSkill(root, 'archive-task');
      fs.mkdirSync(path.join(root, '.agents', 'skills', 'workflow-system-stale-skill'), { recursive: true });
      fs.writeFileSync(path.join(root, '.agents', 'skills', 'workflow-system-stale-skill', 'SKILL.md'), '# stale\n', 'utf8');
      fs.mkdirSync(path.join(root, '.agents', 'skills', 'gstack-existing-skill'), { recursive: true });
      fs.writeFileSync(path.join(root, '.agents', 'skills', 'gstack-existing-skill', 'SKILL.md'), '# native\n', 'utf8');
      const plan = buildHostSyncPlan(root, 'codex');
      expect(plan.isolated).toBe(true);
      expect(plan.entries).toHaveLength(1);
      expect(path.relative(root, plan.entries[0].target)).toBe(
        path.join('.agents', 'skills', 'workflow-system-archive-task', 'SKILL.md'),
      );
      expect(plan.planned_prune_targets.map(target => path.relative(root, target))).toEqual([
        path.join('.agents', 'skills', 'workflow-system-stale-skill'),
      ]);
    });
  });

  test('syncWorkflowHost copies generated skills into host namespace', () => {
    withTempRoot(root => {
      writeGeneratedSkill(root, 'archive-task', '# Archive Task\n');
      writeGeneratedSkill(root, 'review-diff', '# Review Diff\n');

      const result = syncWorkflowHost({ root, host: 'claude', write: true });
      expect(result.synced).toBe(2);
      expect(result.pruned).toBe(0);
      expect(result.planned_prune_targets).toEqual([]);
      expect(result.applied_prune_targets).toEqual([]);

      const archivePath = path.join(root, '.claude', 'skills', 'workflow-system-archive-task', 'SKILL.md');
      const reviewPath = path.join(root, '.claude', 'skills', 'workflow-system-review-diff', 'SKILL.md');
      expect(fs.readFileSync(archivePath, 'utf8')).toBe('# Archive Task\n');
      expect(fs.readFileSync(reviewPath, 'utf8')).toBe('# Review Diff\n');
    });
  });

  test('syncWorkflowHost prunes orphaned workflow-system dirs while preserving non-workflow namespaces', () => {
    withTempRoot(root => {
      writeGeneratedSkill(root, 'review-diff', '# Review Diff\n');
      fs.mkdirSync(path.join(root, '.agents', 'skills', 'workflow-system-archive-task'), { recursive: true });
      fs.writeFileSync(path.join(root, '.agents', 'skills', 'workflow-system-archive-task', 'SKILL.md'), '# stale\n', 'utf8');
      fs.mkdirSync(path.join(root, '.agents', 'skills', 'gstack-existing-skill'), { recursive: true });
      fs.writeFileSync(path.join(root, '.agents', 'skills', 'gstack-existing-skill', 'SKILL.md'), '# native\n', 'utf8');

      const result = syncWorkflowHost({ root, host: 'codex', write: true });
      expect(result.synced).toBe(1);
      expect(result.pruned).toBe(1);
      expect(result.planned_prune_targets.map(target => path.relative(root, target))).toEqual([
        path.join('.agents', 'skills', 'workflow-system-archive-task'),
      ]);
      expect(result.applied_prune_targets.map(target => path.relative(root, target))).toEqual([
        path.join('.agents', 'skills', 'workflow-system-archive-task'),
      ]);
      expect(fs.existsSync(path.join(root, '.agents', 'skills', 'workflow-system-archive-task'))).toBe(false);
      expect(fs.existsSync(path.join(root, '.agents', 'skills', 'workflow-system-review-diff', 'SKILL.md'))).toBe(true);
      expect(fs.existsSync(path.join(root, '.agents', 'skills', 'gstack-existing-skill', 'SKILL.md'))).toBe(true);
    });
  });

  test('dry-run sync reports orphaned workflow-system dirs without deleting them', () => {
    withTempRoot(root => {
      writeGeneratedSkill(root, 'review-diff', '# Review Diff\n');
      fs.mkdirSync(path.join(root, '.factory', 'skills', 'workflow-system-archive-task'), { recursive: true });
      fs.writeFileSync(path.join(root, '.factory', 'skills', 'workflow-system-archive-task', 'SKILL.md'), '# stale\n', 'utf8');

      const result = syncWorkflowHost({ root, host: 'factory', write: false });
      expect(result.write).toBe(false);
      expect(result.pruned).toBe(0);
      expect(result.planned_prune_targets.map(target => path.relative(root, target))).toEqual([
        path.join('.factory', 'skills', 'workflow-system-archive-task'),
      ]);
      expect(result.applied_prune_targets).toEqual([]);
      expect(fs.existsSync(path.join(root, '.factory', 'skills', 'workflow-system-archive-task', 'SKILL.md'))).toBe(true);
      expect(fs.existsSync(path.join(root, '.factory', 'skills', 'workflow-system-review-diff', 'SKILL.md'))).toBe(false);
    });
  });
});

describe('workflow-runtime health', () => {
  test('health check passes for the current repository', () => {
    const report = buildWorkflowHealthReport({ root: ROOT });
    expect(report.ok).toBe(true);
    expect(report.components.find(component => component.name === 'profile')?.status).toBe('passed');
    expect(report.components.find(component => component.name === 'generators')?.status).toBe('passed');
    expect(report.components.find(component => component.name === 'protocol')?.status).toBe('passed');
  });

  test('health check fails cleanly when PROJECT_PROFILE.yaml is invalid', () => {
    withTempRoot(root => {
      fs.writeFileSync(path.join(root, 'PROJECT_PROFILE.yaml'), '[]\n', 'utf8');
      const report = buildWorkflowHealthReport({ root });
      expect(report.ok).toBe(false);
      expect(report.blocked_by).toContain('profile');
      expect(report.blocked_by).toContain('generators');
      expect(report.blocked_by).toContain('protocol');
    });
  });
});
