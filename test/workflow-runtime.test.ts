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

describe('workflow-runtime manifest', () => {
  test('export manifest includes runtime contract artifacts and host notes', () => {
    const manifest = getExportManifest(ROOT);
    expect(manifest.contract_version).toBe(1);
    expect(manifest.artifacts.some(artifact => artifact.path === 'scripts/workflow-runtime.ts' && artifact.required)).toBe(true);
    expect(manifest.artifacts.some(artifact => artifact.path === 'WORKFLOW_PROTOCOL.md' && artifact.category === 'protocol')).toBe(true);
    expect(manifest.import_contract.adoption_stage).toBe('A1');
    expect(manifest.import_contract.steps.map(step => step.name)).toContain('sync-host-runtime');
    expect(manifest.host_compatibility.codex.runtime_root).toBe(path.join('.agents', 'skills'));
    expect(manifest.host_compatibility.codex.isolated_prefix).toBe('workflow-system-');
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
  test('host sync plan uses isolated workflow-system targets', () => {
    withTempRoot(root => {
      writeGeneratedSkill(root, 'archive-task');
      const plan = buildHostSyncPlan(root, 'codex');
      expect(plan.isolated).toBe(true);
      expect(plan.entries).toHaveLength(1);
      expect(path.relative(root, plan.entries[0].target)).toBe(
        path.join('.agents', 'skills', 'workflow-system-archive-task', 'SKILL.md'),
      );
    });
  });

  test('syncWorkflowHost copies generated skills into host namespace', () => {
    withTempRoot(root => {
      writeGeneratedSkill(root, 'archive-task', '# Archive Task\n');
      writeGeneratedSkill(root, 'review-diff', '# Review Diff\n');

      const result = syncWorkflowHost({ root, host: 'claude', write: true });
      expect(result.synced).toBe(2);

      const archivePath = path.join(root, '.claude', 'skills', 'workflow-system-archive-task', 'SKILL.md');
      const reviewPath = path.join(root, '.claude', 'skills', 'workflow-system-review-diff', 'SKILL.md');
      expect(fs.readFileSync(archivePath, 'utf8')).toBe('# Archive Task\n');
      expect(fs.readFileSync(reviewPath, 'utf8')).toBe('# Review Diff\n');
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
