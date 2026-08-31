import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { stringify } from 'yaml';
import {
  buildVNextBundle,
  createMigrationPack,
  getSourceIdentity,
  installMigrationPack,
  preflightMigration,
  validateMigrationPack,
  VNEXT_MIGRATION_IN_PROGRESS_RELATIVE_PATH,
  VNEXT_INSTALL_STATE_RELATIVE_PATH,
} from '../scripts/vnext-migration-pack';

const ROOT = path.resolve(import.meta.dir, '..');
const temporaryRoots: string[] = [];

function tempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

function copyFixtureTarget(): string {
  const target = tempRoot('workflow-vnext-migration-target-');
  fs.cpSync(path.join(ROOT, '.workflow-system'), path.join(target, '.workflow-system'), { recursive: true });
  // The fixture represents an old project; the source repository's vNext
  // namespace is not an installed target surface.
  fs.rmSync(path.join(target, '.workflow-system', 'vnext'), { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'templates', 'skills'), path.join(target, 'templates', 'skills'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'templates', 'docs'), path.join(target, 'templates', 'docs'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'docs', 'workflow', 'generated', 'workflow-docs'), path.join(target, 'docs', 'workflow'), { recursive: true });
  const currentTaskPath = path.join(target, 'docs', 'workflow', 'CURRENT_TASK.md');
  const currentTask = fs.readFileSync(currentTaskPath, 'utf8')
    .replace('- 当前状态：draft', '- 当前状态：archived')
    .replace('- 生命周期状态：active', '- 生命周期状态：archived')
    .replace('- 任务 ID：{{TASK_ID}}', '- 任务 ID：010')
    .replace('- 任务标题：{{TASK_TITLE}}', '- 任务标题：Migration fixture')
    .replace('- 任务 slug：{{TASK_SLUG}}', '- 任务 slug：migration-fixture')
    .replace('- 当前 handoff：{{CURRENT_HANDOFF}}', '- 当前 handoff：not-applicable');
  fs.writeFileSync(currentTaskPath, currentTask, 'utf8');
  fs.mkdirSync(path.join(target, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(target, '.claude', 'skills', 'workflow-system-create-current-task.SKILL.md'), '# legacy skill\n', 'utf8');
  fs.writeFileSync(
    path.join(target, '.workflow-system', 'install-state.json'),
    JSON.stringify({ state_version: 1, managed_files: [{ path: '.claude/skills/workflow-system-create-current-task.SKILL.md' }] }, null, 2),
    'utf8',
  );
  return target;
}

type BundleFile = readonly [string, string, 'protocol' | 'schema' | 'generated' | 'skill' | 'config' | 'runtime'];

function writeBundle(sourceRoot: string, targetRoot: string, bundleDir: string, extraFiles: readonly BundleFile[] = [], phase2 = false, phase2WorkflowStatus: 'active' | 'draft' = 'active'): void {
  if (phase2) {
    fs.cpSync(path.join(ROOT, 'templates', 'skills'), path.join(sourceRoot, 'templates', 'skills'), { recursive: true });
    fs.cpSync(path.join(ROOT, 'templates', 'vnext'), path.join(sourceRoot, 'templates', 'vnext'), { recursive: true });
    fs.mkdirSync(path.join(sourceRoot, '.workflow-system', 'vnext'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.workflow-system', 'vnext', 'SOURCE_CONTRACT.yaml'), path.join(sourceRoot, '.workflow-system', 'vnext', 'SOURCE_CONTRACT.yaml'));
  }
  const files: BundleFile[] = [
    ['bundle/protocol.md', '.workflow-system/WORKFLOW_PROTOCOL.md', 'protocol'],
    ['bundle/schema.md', '.workflow-system/FILE_SCHEMAS.md', 'schema'],
    ['bundle/current-task.md', 'docs/workflow/CURRENT_TASK.md', 'generated'],
    ['bundle/prepare-task.SKILL.md', '.claude/skills/prepare-task.SKILL.md', 'skill'],
    ['bundle/review-change.SKILL.md', '.claude/skills/review-change.SKILL.md', 'skill'],
    ['bundle/execute-step.SKILL.md', '.claude/skills/execute-step.SKILL.md', 'skill'],
    ['bundle/debug-task.SKILL.md', '.claude/skills/debug-task.SKILL.md', 'skill'],
    ['bundle/task-lifecycle.SKILL.md', '.claude/skills/task-lifecycle.SKILL.md', 'skill'],
    ['bundle/capture-work-item.SKILL.md', '.claude/skills/capture-work-item.SKILL.md', 'skill'],
    ['bundle/close-task.SKILL.md', '.claude/skills/close-task.SKILL.md', 'skill'],
    ...(phase2 ? [
      ['bundle/runtime-cli.js', '.workflow-system/runtime/dist/cli.js', 'runtime'],
      ['bundle/runtime-package.json', '.workflow-system/runtime/package.json', 'runtime'],
      ['bundle/runtime-package-lock.json', '.workflow-system/runtime/package-lock.json', 'runtime'],
      ['bundle/runtime-cli.ts', '.workflow-system/runtime/src/cli.ts', 'runtime'],
      ['bundle/runtime-current-task.ts', '.workflow-system/runtime/src/current-task.ts', 'runtime'],
      ['bundle/runtime-task-state-transaction.ts', '.workflow-system/runtime/src/task-state-transaction.ts', 'runtime'],
      ['bundle/runtime-finding-queue-transaction.ts', '.workflow-system/runtime/src/finding-queue-transaction.ts', 'runtime'],
      ['bundle/runtime-kernel.ts', '.workflow-system/runtime/src/kernel.ts', 'runtime'],
      ['bundle/runtime-io.ts', '.workflow-system/runtime/src/runtime-io.ts', 'runtime'],
      ['bundle/runtime-task-identity.ts', '.workflow-system/runtime/src/task-identity.ts', 'runtime'],
      ['bundle/runtime-contract.yaml', '.workflow-system/vnext/RUNTIME_CONTRACT.yaml', 'protocol'],
    ] as BundleFile[] : []),
    ...extraFiles,
  ];
  for (const [relative, target, category] of files) {
    const file = path.join(sourceRoot, ...relative.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (category === 'runtime') {
      const runtimeRelative = target.slice('.workflow-system/runtime/'.length);
      fs.copyFileSync(path.join(ROOT, 'runtime', 'vnext', ...runtimeRelative.split('/')), file);
    } else if (category === 'protocol') {
      if (target === '.workflow-system/vnext/RUNTIME_CONTRACT.yaml') {
        fs.copyFileSync(path.join(ROOT, '.workflow-system', 'vnext', 'RUNTIME_CONTRACT.yaml'), file);
      } else {
        fs.writeFileSync(file, 'schema_version: 1\nkind: vnext-protocol\n\n# vNext Protocol\n', 'utf8');
      }
    } else if (category === 'schema') {
      fs.writeFileSync(file, 'schema_version: 1\nkind: vnext-file-schema\n\n# vNext File Schema\nCURRENT_TASK.md\n', 'utf8');
    } else if (target.endsWith('CURRENT_TASK.md')) {
      const currentTaskFrontmatter = phase2 ? {
        schema_version: 1,
        kind: 'vnext-current-task',
        document_id: 'doc-000000000000000000000000',
        runtime_state: {
          schema_version: 1,
          kind: 'vnext-current-task-runtime-state',
          task_id: '010',
          task_slug: 'migration-fixture',
          workflow_status: 'active',
          lifecycle_state: 'active',
          active_step_id: 'step-1',
          active_step_status: 'ready',
          finding_queue_revision: 0,
          review_cycle: {
            id: 'review-cycle-0',
            repair_round: 0,
            counted_repair_wave_ids: [],
          },
          findings: [],
          execution_log: [],
          applied_proposals: [],
        },
      } : null;
      const body = [
        '---',
        ...(currentTaskFrontmatter ? stringify(currentTaskFrontmatter).trimEnd().split(/\r?\n/) : [
          'schema_version: 1',
          'kind: vnext-current-task',
          'document_id: doc-000000000000000000000000',
        ]),
        '---',
        '',
        '# vNext CURRENT_TASK',
        '',
        '## 任务信息',
        `- 任务 ID：${phase2 ? '010' : 'none'}`,
        `- 任务 slug：${phase2 ? 'migration-fixture' : 'none'}`,
        `- 当前状态：${phase2 ? phase2WorkflowStatus : 'draft'}`,
        '- 生命周期状态：active',
        '- 恢复需审查：false',
        '## 验收标准',
        '## 允许修改范围',
        '## 实施步骤',
        '',
      ].join('\n');
      fs.writeFileSync(file, body, 'utf8');
    } else if (category === 'skill') {
      const entry = path.posix.basename(target).replace(/\.SKILL\.md$/, '');
      fs.copyFileSync(path.join(ROOT, 'templates', 'vnext', 'skills', `${entry}.SKILL.md.tmpl`), file);
    } else {
      fs.writeFileSync(file, `# ${target}\n`, 'utf8');
    }
  }
  buildVNextBundle({
    sourceRoot,
    bundleDir,
    artifacts: files.map(([source_path, target_path, category]) => ({ source_path, target_path, category })),
  });
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('one-time vNext Migration Pack', () => {
  test('preflight rejects an active CURRENT_TASK without mutation', () => {
    const target = copyFixtureTarget();
    const currentTaskPath = path.join(target, 'docs', 'workflow', 'CURRENT_TASK.md');
    const before = fs.readFileSync(currentTaskPath, 'utf8');
    fs.writeFileSync(currentTaskPath, before.replace('- 当前状态：archived', '- 当前状态：active').replace('- 生命周期状态：archived', '- 生命周期状态：active'), 'utf8');

    const result = preflightMigration({ sourceRoot: ROOT, targetRoot: target });

    expect(result.eligible).toBe(false);
    expect(result.state).toBe('non-idle');
    expect(result.blockers.some(issue => issue.code === 'CURRENT_TASK_NON_IDLE')).toBe(true);
    expect(fs.readFileSync(currentTaskPath, 'utf8')).toContain('- 当前状态：active');
  });

  test('converts an idle project into a deterministic, text-preserving pack', () => {
    const target = copyFixtureTarget();
    const packDir = tempRoot('workflow-vnext-migration-pack-');
    const manifest = createMigrationPack({ sourceRoot: ROOT, targetRoot: target, outDir: packDir });
    const replayPackDir = tempRoot('workflow-vnext-migration-pack-replay-');
    const replayManifest = createMigrationPack({ sourceRoot: ROOT, targetRoot: target, outDir: replayPackDir });

    expect(manifest.status).toBe('validated');
    expect(replayManifest.pack_id).toBe(manifest.pack_id);
    expect(manifest.preflight.current_task_excluded).toBe(true);
    expect(manifest.artifacts.some(artifact => artifact.kind === 'project-profile')).toBe(true);
    expect(manifest.artifacts.some(artifact => artifact.target_path.endsWith('/CURRENT_TASK.md'))).toBe(false);
    expect(manifest.artifacts.every(artifact => artifact.source_sha256 !== artifact.content_sha256)).toBe(true);
    expect(manifest.artifacts.every(artifact => artifact.original_content_path.startsWith('originals/'))).toBe(true);
    expect(manifest.artifacts.every(artifact => artifact.conversion_rule === 'canonical-envelope-v1')).toBe(true);
    const contracts = manifest.artifacts.find(artifact => artifact.target_path.endsWith('/CONTRACTS.md'))!;
    const canonical = fs.readFileSync(path.join(packDir, ...contracts.content_path.split('/')), 'utf8');
    const original = fs.readFileSync(path.join(packDir, ...contracts.original_content_path.split('/')), 'utf8');
    expect(canonical).toContain('kind: vnext-canonical-document');
    expect(canonical).toContain('## 使用规则');
    expect(original).toContain('## 使用规则');
    expect(canonical).not.toBe(original);
    const profileArtifact = manifest.artifacts.find(artifact => artifact.kind === 'project-profile')!;
    expect(fs.readFileSync(path.join(packDir, ...profileArtifact.content_path.split('/')), 'utf8')).toContain('vnext_migration:');
    expect(validateMigrationPack({ packDir, sourceRoot: ROOT, targetRoot: target }).pack_id).toBe(manifest.pack_id);
  });

  test('rejects a tampered canonical conversion before installation', () => {
    const target = copyFixtureTarget();
    const packDir = tempRoot('workflow-vnext-migration-pack-');
    const manifest = createMigrationPack({ sourceRoot: ROOT, targetRoot: target, outDir: packDir });
    const artifact = manifest.artifacts.find(item => item.kind === 'governance-document')!;
    fs.writeFileSync(path.join(packDir, ...artifact.content_path.split('/')), '# legacy copy\n', 'utf8');

    expect(() => validateMigrationPack({ packDir, sourceRoot: ROOT, targetRoot: target })).toThrow(/PACK_INVALID/);
  });

  test('rejects open findings and suspended packages before conversion', () => {
    const target = copyFixtureTarget();
    const currentTaskPath = path.join(target, 'docs', 'workflow', 'CURRENT_TASK.md');
    const current = fs.readFileSync(currentTaskPath, 'utf8')
      .replace('- Finding ID：', '- Finding ID：F-1')
      .replace('  - Status：\n', '  - Status：open\n');
    fs.writeFileSync(currentTaskPath, current, 'utf8');
    fs.mkdirSync(path.join(target, 'TASKS', 'paused'), { recursive: true });
    fs.writeFileSync(path.join(target, 'TASKS', 'paused', 'TASK-010-migration-fixture.md'), '# paused\n', 'utf8');

    const result = preflightMigration({ sourceRoot: ROOT, targetRoot: target });

    expect(result.eligible).toBe(false);
    expect(result.blockers.map(issue => issue.code)).toEqual(expect.arrayContaining(['CURRENT_TASK_FINDING_OPEN', 'SUSPENDED_WORK_PRESENT']));
  });

  test('rejects an ambiguous legacy surface without discoverable Skill identities', () => {
    const target = copyFixtureTarget();
    fs.rmSync(path.join(target, 'templates', 'skills'), { recursive: true, force: true });
    fs.rmSync(path.join(target, '.claude', 'skills'), { recursive: true, force: true });

    const result = preflightMigration({ sourceRoot: ROOT, targetRoot: target });

    expect(result.eligible).toBe(false);
    expect(result.state).toBe('ambiguous');
    expect(result.blockers.some(issue => issue.code === 'LEGACY_SURFACE_AMBIGUOUS')).toBe(true);
  });

  test('installs a validated pack atomically and replays as a no-op', () => {
    const source = tempRoot('workflow-vnext-migration-source-');
    const target = copyFixtureTarget();
    const packDir = tempRoot('workflow-vnext-migration-pack-');
    const bundleDir = tempRoot('workflow-vnext-bundle-');
    writeBundle(source, target, bundleDir);
    fs.mkdirSync(path.join(target, '.codex', 'skills', 'workflow-system-review-diff'), { recursive: true });
    fs.writeFileSync(path.join(target, '.codex', 'skills', 'workflow-system-review-diff', 'SKILL.md'), '# legacy nested skill\n', 'utf8');
    const manifest = createMigrationPack({ sourceRoot: source, targetRoot: target, outDir: packDir });

    const dryRun = installMigrationPack({ packDir, bundleDir, sourceRoot: source, targetRoot: target, dryRun: true });
    expect(dryRun.status).toBe('ready');
    expect(fs.existsSync(path.join(target, ...VNEXT_INSTALL_STATE_RELATIVE_PATH.split('/')))).toBe(false);

    const installed = installMigrationPack({ packDir, bundleDir, sourceRoot: source, targetRoot: target });
    expect(installed.status).toBe('installed');
    expect(fs.existsSync(path.join(target, '.claude', 'skills', 'workflow-system-create-current-task.SKILL.md'))).toBe(false);
    expect(fs.existsSync(path.join(target, '.codex', 'skills', 'workflow-system-review-diff', 'SKILL.md'))).toBe(false);
    expect(fs.existsSync(path.join(target, '.claude', 'skills', 'prepare-task.SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(target, ...VNEXT_INSTALL_STATE_RELATIVE_PATH.split('/')))).toBe(true);

    const replay = installMigrationPack({ packDir, bundleDir, sourceRoot: source, targetRoot: target });
    expect(replay.status).toBe('replayed');
    expect(replay.pack_id).toBe(manifest.pack_id);
  });

  test('leaves the target unchanged when the vNext bundle is invalid', () => {
    const source = tempRoot('workflow-vnext-migration-source-');
    const target = copyFixtureTarget();
    const packDir = tempRoot('workflow-vnext-migration-pack-');
    const bundleDir = tempRoot('workflow-vnext-bundle-');
    writeBundle(source, target, bundleDir);
    const manifest = createMigrationPack({ sourceRoot: source, targetRoot: target, outDir: packDir });
    const currentTaskPath = path.join(target, 'docs', 'workflow', 'CURRENT_TASK.md');
    const before = fs.readFileSync(currentTaskPath, 'utf8');
    fs.writeFileSync(path.join(bundleDir, 'vnext-bundle.json'), '{"schema_version":1,"kind":"wrong"}\n', 'utf8');

    const result = installMigrationPack({ packDir, bundleDir, sourceRoot: source, targetRoot: target });
    expect(result.status).toBe('rejected');
    expect(result.blockers[0]?.code).toBe('BUNDLE_INVALID');
    expect(fs.readFileSync(currentTaskPath, 'utf8')).toBe(before);
    expect(fs.existsSync(path.join(target, ...VNEXT_INSTALL_STATE_RELATIVE_PATH.split('/')))).toBe(false);
    expect(manifest.pack_id).toMatch(/^migration-/);
  });

  test('binds a pack to the exact target identity', () => {
    const target = copyFixtureTarget();
    const packDir = tempRoot('workflow-vnext-migration-pack-');
    createMigrationPack({ sourceRoot: ROOT, targetRoot: target, outDir: packDir });
    const otherTarget = copyFixtureTarget();
    const result = installMigrationPack({ packDir, bundleDir: tempRoot('workflow-vnext-empty-bundle-'), sourceRoot: ROOT, targetRoot: otherTarget });
    expect(result.status).toBe('rejected');
    expect(result.blockers[0]?.code).toBe('PACK_STALE');
  });

  test('exposes source identity as the binding input for independently built bundles', () => {
    const source = tempRoot('workflow-vnext-migration-source-');
    const identity = getSourceIdentity(source);
    expect(identity.root_identity).toMatch(/^[a-f0-9]{32}$/);
    expect(identity.tree_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test('treats the Phase 2 Runtime contract as a separate protocol artifact', () => {
    const source = tempRoot('workflow-vnext-migration-source-');
    const target = copyFixtureTarget();
    const bundleDir = tempRoot('workflow-vnext-bundle-');

    writeBundle(source, target, bundleDir, [
      ['bundle/runtime-contract.yaml', '.workflow-system/vnext/RUNTIME_CONTRACT.yaml', 'protocol'],
    ]);

    const manifest = JSON.parse(fs.readFileSync(path.join(bundleDir, 'vnext-bundle.json'), 'utf8')) as { artifacts: Array<{ target_path: string }> };
    expect(manifest.artifacts.some(artifact => artifact.target_path === '.workflow-system/vnext/RUNTIME_CONTRACT.yaml')).toBe(true);
  });

  test('validates a Phase 2 bundle and plans project-local Runtime dependencies without writing in dry-run', () => {
    const source = tempRoot('workflow-vnext-phase2-source-');
    const target = copyFixtureTarget();
    const packDir = tempRoot('workflow-vnext-migration-pack-');
    const bundleDir = tempRoot('workflow-vnext-phase2-bundle-');
    writeBundle(source, target, bundleDir, [], true);
    const manifest = createMigrationPack({ sourceRoot: source, targetRoot: target, outDir: packDir });

    const result = installMigrationPack({ packDir, bundleDir, sourceRoot: source, targetRoot: target, dryRun: true });

    expect(result.status).toBe('ready');
    expect(result.pack_id).toBe(manifest.pack_id);
    expect(result.planned_writes).toContain('.workflow-system/runtime/dist/cli.js');
    expect(result.planned_writes).toContain('.workflow-system/runtime/node_modules');
    expect(fs.existsSync(path.join(target, '.workflow-system', 'runtime'))).toBe(false);
    expect(fs.existsSync(path.join(target, ...VNEXT_INSTALL_STATE_RELATIVE_PATH.split('/')))).toBe(false);
  });

  test('rejects a Phase 2 bundle when CURRENT_TASK body diverges from runtime_state', () => {
    const source = tempRoot('workflow-vnext-phase2-source-');
    const target = copyFixtureTarget();
    const packDir = tempRoot('workflow-vnext-migration-pack-');
    const bundleDir = tempRoot('workflow-vnext-phase2-bundle-');
    writeBundle(source, target, bundleDir, [], true);
    createMigrationPack({ sourceRoot: source, targetRoot: target, outDir: packDir });
    const currentTaskPath = path.join(bundleDir, 'bundle', 'current-task.md');
    const currentTask = fs.readFileSync(currentTaskPath, 'utf8');
    fs.writeFileSync(currentTaskPath, currentTask.replace('- 当前状态：active', '- 当前状态：draft'), 'utf8');
    const bundleManifestPath = path.join(bundleDir, 'vnext-bundle.json');
    const bundleManifest = JSON.parse(fs.readFileSync(bundleManifestPath, 'utf8')) as {
      source: unknown;
      bundle_id: string;
      artifacts: Array<{ source_path: string; checksum: string }>;
    };
    const currentTaskArtifact = bundleManifest.artifacts.find(artifact => artifact.source_path === 'bundle/current-task.md');
    if (!currentTaskArtifact) throw new Error('test fixture is missing the CURRENT_TASK bundle artifact');
    currentTaskArtifact.checksum = createHash('sha256').update(fs.readFileSync(currentTaskPath)).digest('hex');
    bundleManifest.bundle_id = `bundle-${createHash('sha256').update(JSON.stringify({ source: bundleManifest.source, artifacts: bundleManifest.artifacts })).digest('hex').slice(0, 24)}`;
    fs.writeFileSync(bundleManifestPath, `${JSON.stringify(bundleManifest, null, 2)}\n`, 'utf8');

    const result = installMigrationPack({ packDir, bundleDir, sourceRoot: source, targetRoot: target, dryRun: true });

    expect(result.status).toBe('rejected');
    expect(result.blockers[0]?.code).toBe('BUNDLE_INVALID');
    expect(result.blockers[0]?.message).toContain('body/runtime_state consistency check failed');
    expect(fs.existsSync(path.join(target, '.workflow-system', 'runtime'))).toBe(false);
  });

  test('fails closed when an interrupted installation marker is present', () => {
    const source = tempRoot('workflow-vnext-migration-source-');
    const target = copyFixtureTarget();
    const packDir = tempRoot('workflow-vnext-migration-pack-');
    const bundleDir = tempRoot('workflow-vnext-bundle-');
    writeBundle(source, target, bundleDir);
    const manifest = createMigrationPack({ sourceRoot: source, targetRoot: target, outDir: packDir });
    const markerPath = path.join(target, ...VNEXT_MIGRATION_IN_PROGRESS_RELATIVE_PATH.split('/'));
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(markerPath, JSON.stringify({
      schema_version: 1,
      kind: 'vnext-migration-in-progress',
      migration_pack_id: manifest.pack_id,
      bundle_id: 'bundle-000000000000000000000000',
      target_identity: manifest.target.root_identity,
      started_at: new Date().toISOString(),
      planned_writes: ['docs/workflow/CURRENT_TASK.md'],
      planned_deletes: ['.workflow-system/install-state.json'],
      recovery: 'fail-closed-explicit-recovery',
    }, null, 2), 'utf8');

    const result = installMigrationPack({ packDir, bundleDir, sourceRoot: source, targetRoot: target });
    expect(result.status).toBe('rejected');
    expect(result.blockers[0]?.code).toBe('VNEXT_INSTALL_IN_PROGRESS');
    expect(preflightMigration({ sourceRoot: source, targetRoot: target }).state).toBe('install-in-progress');
  });

  test('clears the interruption marker after a successful rollback', () => {
    const source = tempRoot('workflow-vnext-migration-source-');
    const target = copyFixtureTarget();
    const packDir = tempRoot('workflow-vnext-migration-pack-');
    const bundleDir = tempRoot('workflow-vnext-bundle-');
    const blockedParent = path.join(target, 'migration-write-parent');
    fs.writeFileSync(blockedParent, 'a file where a directory is expected\n', 'utf8');
    writeBundle(source, target, bundleDir, [
      ['bundle/conflicting-target.txt', 'migration-write-parent/child.txt', 'config'],
    ]);
    const manifest = createMigrationPack({ sourceRoot: source, targetRoot: target, outDir: packDir });

    const result = installMigrationPack({ packDir, bundleDir, sourceRoot: source, targetRoot: target });

    expect(result.status).toBe('rejected');
    expect(result.blockers[0]?.code).toBe('INSTALL_CONFLICT');
    expect(fs.existsSync(path.join(target, ...VNEXT_MIGRATION_IN_PROGRESS_RELATIVE_PATH.split('/')))).toBe(false);
    const restored = preflightMigration({ sourceRoot: source, targetRoot: target });
    expect(restored.eligible).toBe(true);
    expect(restored.state).toBe('idle');
    expect(restored.target_snapshot?.tree_hash).toBe(manifest.legacy_source.tree_hash);
  });
});
