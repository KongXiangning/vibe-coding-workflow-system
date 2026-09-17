import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parse, stringify } from 'yaml';
import { originalBackupPath } from '../scripts/migration-alignment';
import { legacyCurrentTaskBackup, type MigrationDecisions } from '../runtime/vnext/src/migration-preservation';
import {
  buildVNextBundle,
  createMigrationPack,
  getSourceIdentity,
  installMigrationPack,
  preflightMigration,
  isFrozenPath,
  validateMigrationPack,
  validateCompletedMigration,
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
    ['bundle/prepare-task.SKILL.md', '.agents/skills/prepare-task/SKILL.md', 'skill'],
    ['bundle/review-draft.SKILL.md', '.agents/skills/review-draft/SKILL.md', 'skill'],
    ['bundle/review-change.SKILL.md', '.agents/skills/review-change/SKILL.md', 'skill'],
    ['bundle/execute-step.SKILL.md', '.agents/skills/execute-step/SKILL.md', 'skill'],
    ['bundle/debug-task.SKILL.md', '.agents/skills/debug-task/SKILL.md', 'skill'],
    ['bundle/task-lifecycle.SKILL.md', '.agents/skills/task-lifecycle/SKILL.md', 'skill'],
    ['bundle/capture-work-item.SKILL.md', '.agents/skills/capture-work-item/SKILL.md', 'skill'],
    ['bundle/close-task.SKILL.md', '.agents/skills/close-task/SKILL.md', 'skill'],
    ['bundle/validate-change.SKILL.md', '.agents/skills/validate-change/SKILL.md', 'skill'],
    ['bundle/git-commit.SKILL.md', '.agents/skills/git-commit/SKILL.md', 'skill'],
    ...(phase2 ? [
      ['bundle/bootstrap-project.SKILL.md', '.agents/skills/bootstrap-project/SKILL.md', 'skill'],
      ['bundle/runtime-cli.js', '.workflow-system/runtime/dist/cli.js', 'runtime'],
      ['bundle/runtime-install-tools.js', '.workflow-system/runtime/dist/install-tools.js', 'runtime'],
      ['bundle/runtime-context-api.md', '.workflow-system/runtime/support/CONTEXT_API.md', 'runtime'],
      ['bundle/runtime-context-notices.md', '.workflow-system/runtime/support/CONTEXT_THIRD_PARTY_NOTICES.md', 'runtime'],
      ['bundle/runtime-package.json', '.workflow-system/runtime/package.json', 'runtime'],
      ['bundle/runtime-package-lock.json', '.workflow-system/runtime/package-lock.json', 'runtime'],
      ['bundle/runtime-cli.ts', '.workflow-system/runtime/src/cli.ts', 'runtime'],
      ['bundle/runtime-current-task.ts', '.workflow-system/runtime/src/current-task.ts', 'runtime'],
      ['bundle/runtime-task-context.ts', '.workflow-system/runtime/src/task-context.ts', 'runtime'],
      ['bundle/runtime-task-store.ts', '.workflow-system/runtime/src/task-store.ts', 'runtime'],
      ['bundle/runtime-task-state-transaction.ts', '.workflow-system/runtime/src/task-state-transaction.ts', 'runtime'],
      ['bundle/runtime-finding-queue-transaction.ts', '.workflow-system/runtime/src/finding-queue-transaction.ts', 'runtime'],
      ['bundle/runtime-kernel.ts', '.workflow-system/runtime/src/kernel.ts', 'runtime'],
      ['bundle/runtime-io.ts', '.workflow-system/runtime/src/runtime-io.ts', 'runtime'],
      ['bundle/runtime-task-identity.ts', '.workflow-system/runtime/src/task-identity.ts', 'runtime'],
      ['bundle/runtime-bootstrap.ts', '.workflow-system/runtime/src/bootstrap.ts', 'runtime'],
      ['bundle/runtime-bootstrap-support.ts', '.workflow-system/runtime/src/bootstrap-support.ts', 'runtime'],
      ['bundle/runtime-migration-provenance.ts', '.workflow-system/runtime/src/migration-provenance.ts', 'runtime'],
      ['bundle/runtime-migration-preservation.ts', '.workflow-system/runtime/src/migration-preservation.ts', 'runtime'],
      ['bundle/runtime-scoped-tree-hash.ts', '.workflow-system/runtime/src/scoped-tree-hash.ts', 'runtime'],
      ['bundle/runtime-bootstrap-support-template.md', '.workflow-system/runtime/support/bootstrap/CURRENT_TASK.md.tmpl', 'runtime'],
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
          resume_requires_review: false,
          resume_review_reasons: [],
          active_step_id: 'step-1',
          active_step_status: 'ready',
          finding_queue_revision: 0,
          review_cycle: {
            id: 'review-cycle-0',
            cycle_phase: 'discovery',
            repair_round: 0,
            counted_repair_wave_ids: [],
            active_repair_wave_id: null,
            verification_new_finding_wave_used: false,
            verification_new_finding_wave_id: null,
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
        '- 恢复审查原因：',
        '## 验收标准',
        '## 允许修改范围',
        '## 实施步骤',
        '',
      ].join('\n');
      fs.writeFileSync(file, body, 'utf8');
    } else if (category === 'skill') {
      const entry = target.startsWith('.agents/skills/')
        ? path.posix.basename(path.posix.dirname(target))
        : path.posix.basename(target).replace(/\.SKILL\.md$/, '');
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
  test('freeze markers distinguish explicit banners from ordinary skill instructions', () => {
    const root = tempRoot('freeze-markers-');
    const file = path.join(root, 'skill.md');
    for (const text of ['- Do not modify business code in this skill.', 'do not modify business code', '@frozenish']) {
      fs.writeFileSync(file, text);
      expect(isFrozenPath(root, 'skill.md')).toBe(false);
    }
    for (const text of ['<!-- @frozen -->', '@FROZEN', '<!-- DO NOT MODIFY -->', '# DO NOT MODIFY: generated']) {
      fs.writeFileSync(file, text);
      expect(isFrozenPath(root, 'skill.md')).toBe(true);
    }
    fs.writeFileSync(file, 'ordinary instructions');
    fs.writeFileSync(path.join(root, 'FREEZE_REGISTRY.md'), '- skill.md');
    expect(isFrozenPath(root, 'skill.md')).toBe(true);
  });

  test('v3 aligns workflow-only host/config surfaces and preserves historical bytes atomically', () => {
    const source = tempRoot('migration-alignment-source-'), target = copyFixtureTarget();
    const bundleDir = tempRoot('migration-alignment-bundle-'), packDir = tempRoot('migration-alignment-pack-');
    writeBundle(source, target, bundleDir);
    const windowsLinks = String.raw`[private](E:\\coding\\TermLink\\.codex\\skills\\local-dev-server-control\\SKILL.md) [spaced](<D:\My Project\SKILL.md>) [forward](E:/coding/TermLink/SKILL.md)`;
    const business = '## Business contract\r\n' + windowsLinks + '\r\n- Keep IPC single authority and JDK 21.\r\n';
    const host = '# Agents\r\n\r\n## workflow-system baseline\r\n- Run `/sync-host-guidance` and bun run gen:all.\r\n\r\n' + business +
      '\r\n## Available local skills\r\n1. `old`\r\n- 文件：`.codex/skills/workflow-system-create-current-task/SKILL.md`\r\n\r\n2. `private`\r\n- 文件：`.agents/skills/private/SKILL.md`\r\n';
    fs.writeFileSync(path.join(target, 'AGENTS.md'), host);
    const pkg = { name: 'business', scripts: { 'workflow:health': 'bun run scripts/workflow-runtime.ts health', test: 'node --test' }, dependencies: { business: '1.2.3' } };
    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify(pkg));
    for (const name of ['workflow-system-create-current-task', 'private', 'capture-work-item']) {
      fs.mkdirSync(path.join(target, '.agents/skills', name), { recursive: true });
      fs.writeFileSync(path.join(target, '.agents/skills', name, 'SKILL.md'), name);
    }
    const hiddenSupport = path.join(target, '.agents/skills/workflow-system-create-current-task/.workflow-vnext-migration-probe/old.txt');
    fs.mkdirSync(path.dirname(hiddenSupport), { recursive: true });
    fs.writeFileSync(hiddenSupport, 'original support');
    const historyPath = 'docs/workflow/TECHNICAL_DETAILS-local.md';
    const history = '# Historical\r\n`JAVA_HOME=D:\\jdk` `{localappdata}\\Programs` `tests\\unit.js` `./old`\r\n';
    fs.writeFileSync(path.join(target, historyPath), history + windowsLinks);
    const beforeProfile = parse(fs.readFileSync(path.join(target, '.workflow-system/PROJECT_PROFILE.yaml'), 'utf8'));
    const pack = createMigrationPack({ sourceRoot: source, targetRoot: target, outDir: packDir });
    const hostArtifact = pack.artifacts.find(a => a.source_path === 'AGENTS.md')!;
    const historyArtifact = pack.artifacts.find(a => a.source_path === historyPath)!;
    expect(fs.readFileSync(path.join(packDir, historyArtifact.content_path), 'utf8').split('\n---\n')[1]).toBe(history + windowsLinks);
    expect(historyArtifact.path_references.find(r => r.raw.startsWith('JAVA_HOME='))?.kind).toBe('unclassified');
    const external = historyArtifact.path_references.filter(r => r.kind === 'external');
    expect(external).toHaveLength(3);
    expect(external.every(r => r.raw === r.normalized && !r.adjusted)).toBe(true);
    fs.appendFileSync(hiddenSupport, 'drift');
    expect(() => validateMigrationPack({ sourceRoot: source, targetRoot: target, packDir })).toThrow();
    fs.writeFileSync(hiddenSupport, 'original support');
    hostArtifact.target_path = 'README.md';
    fs.writeFileSync(path.join(packDir, 'migration-pack.json'), JSON.stringify(pack));
    expect(() => validateMigrationPack({ sourceRoot: source, targetRoot: target, packDir })).toThrow('exact source path');
    hostArtifact.target_path = 'AGENTS.md';
    fs.writeFileSync(path.join(packDir, 'migration-pack.json'), JSON.stringify(pack));
    const options = { sourceRoot: source, targetRoot: target, packDir, bundleDir };
    const dry = installMigrationPack({ ...options, dryRun: true });
    expect(dry.status).toBe('ready');
    expect(dry.planned_deletes).toContain('.agents/skills/workflow-system-create-current-task/SKILL.md');
    expect(dry.planned_deletes).not.toContain('.agents/skills/capture-work-item/SKILL.md');
    expect(dry.planned_writes).not.toContain('CLAUDE.md');
    expect(installMigrationPack({ ...options, postPromotionVerify: () => { throw new Error('rollback probe'); } }).status).toBe('rejected');
    expect(fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8')).toBe(host);
    expect(fs.existsSync(path.join(target, '.agents/skills/workflow-system-create-current-task/SKILL.md'))).toBe(true);
    expect(installMigrationPack(options).status).toBe('installed');
    const afterHost = fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8');
    expect(afterHost).toContain(business);
    expect(afterHost).toContain('.agents/skills/private/SKILL.md');
    expect(afterHost).not.toContain('/sync-host-guidance');
    expect(afterHost).not.toContain('workflow-system-create-current-task');
    expect(fs.readFileSync(path.join(target, originalBackupPath('AGENTS.md', hostArtifact.source_sha256)), 'utf8')).toBe(host);
    const afterPackage = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'));
    expect(afterPackage.scripts).toEqual({ test: 'node --test' });
    expect(afterPackage.dependencies).toEqual(pkg.dependencies);
    const afterProfile = parse(fs.readFileSync(path.join(target, '.workflow-system/PROJECT_PROFILE.yaml'), 'utf8'));
    expect(afterProfile.runtime).toEqual(beforeProfile.runtime);
    expect(afterProfile.validation.matrix.filter((x: any) => x.owner === 'target-project')).toEqual(beforeProfile.validation.matrix.filter((x: any) => x.owner === 'target-project'));
    expect(afterProfile.governance.current_documents).not.toContain('CLAUDE.md');
    expect(fs.readFileSync(path.join(target, 'docs/workflow/DOCUMENT_CATALOG.md'), 'utf8')).toContain(historyPath);
    const guide = fs.readFileSync(path.join(target, 'docs/workflow/WORKFLOW_GUIDE.md'), 'utf8');
    const guideHeader = parse(guide.match(/^---\n([\s\S]*?)\n---\n/)![1]!);
    expect(guideHeader.heading_index.some((h: any) => h.text === 'vNext workflow 使用指南')).toBe(true);
    expect(guideHeader.path_references.some((r: any) => r.raw.includes('/generated/'))).toBe(false);
    expect(guideHeader.original_text_preserved).toBe(false);
    expect(validateCompletedMigration(target).migration_pack_id).toBe(pack.pack_id);
    expect(fs.existsSync(path.join(target, '.agents/skills/workflow-system-create-current-task'))).toBe(false);
    const backup = path.join(target, originalBackupPath('AGENTS.md', hostArtifact.source_sha256));
    fs.appendFileSync(backup, 'tampered');
    expect(() => validateCompletedMigration(target)).toThrow();
  }, 30000);

  function historicalCompletion(target: string, sourceRoot: string): MigrationDecisions {
    const currentPath = 'docs/workflow/CURRENT_TASK.md';
    let content = fs.readFileSync(path.join(target, currentPath), 'utf8');
    content = content.replace('任务 ID：010', '任务 ID：TASK-20260827-002')
      .replace('当前状态：archived', '当前状态：completed_verified_archived（已归档）')
      .replace(/^- 生命周期状态：.*\r?\n/m, '');
    fs.writeFileSync(path.join(target, currentPath), content);
    const paused = 'TASKS/paused/TASK-20260727-002-old.md';
    fs.mkdirSync(path.dirname(path.join(target, paused)), { recursive: true });
    fs.writeFileSync(path.join(target, paused), '# Unfinished original\r\nremaining_acceptance: manual verification\r\n');
    const preflight = preflightMigration({ sourceRoot, targetRoot: target });
    const digest = (p: string) => createHash('sha256').update(fs.readFileSync(path.join(target, p))).digest('hex');
    return { schema_version: 1, target_root: preflight.target!.root_path, target_identity: preflight.target!.root_identity,
      current_task: { path: currentPath, sha256: digest(currentPath), original_task_id: 'TASK-20260827-002' },
      current_task_disposition: 'completed-by-user-confirmation', preserved_paused: [{ path: paused, sha256: digest(paused) }],
      user_decision: { source: 'user:regression', verbatim: 'Current task is complete; preserve paused work without conversion.' } };
  }

  test('historical completion decisions bind identity and preserve unresolved paused work through installation', () => {
    const source = tempRoot('migration-decisions-source-');
    const target = copyFixtureTarget();
    const packDir = tempRoot('migration-decisions-pack-');
    const bundleDir = tempRoot('migration-decisions-bundle-');
    writeBundle(source, target, bundleDir);
    const decisions = historicalCompletion(target, source);
    const options = { sourceRoot: source, targetRoot: target, decisions };
    expect(preflightMigration({ ...options, decisions: undefined }).eligible).toBe(false);
    expect(preflightMigration(options).eligible).toBe(true);
    for (const changed of [
      { ...decisions, target_identity: '0'.repeat(32) },
      { ...decisions, current_task: { ...decisions.current_task, sha256: '0'.repeat(64) } },
      { ...decisions, current_task: { ...decisions.current_task, original_task_id: 'another' } },
      { ...decisions, preserved_paused: [] },
    ]) expect(preflightMigration({ ...options, decisions: changed }).eligible).toBe(false);
    const original = fs.readFileSync(path.join(target, decisions.current_task.path));
    const paused = fs.readFileSync(path.join(target, decisions.preserved_paused[0]!.path));
    let manifest = createMigrationPack({ ...options, outDir: packDir });
    expect(manifest.schema_version).toBe(3);
    expect(manifest.artifacts.some(item => item.source_path.startsWith('TASKS/paused/'))).toBe(false);
    fs.appendFileSync(path.join(target, decisions.preserved_paused[0]!.path), 'drift');
    expect(() => validateMigrationPack({ packDir, ...options })).toThrow();
    fs.writeFileSync(path.join(target, decisions.preserved_paused[0]!.path), paused);
    const install = { packDir, bundleDir, sourceRoot: source, targetRoot: target };
    const dryRun = installMigrationPack({ ...install, dryRun: true });
    expect(dryRun.planned_writes).toContain(legacyCurrentTaskBackup(decisions));
    expect(dryRun.warnings.some(issue => issue.path === decisions.preserved_paused[0]!.path && issue.message.includes('not directly resumable'))).toBe(true);
    expect(installMigrationPack({ ...install, postPromotionVerify: () => { throw new Error('injected read-back failure'); } }).status).toBe('rejected');
    expect(fs.readFileSync(path.join(target, decisions.current_task.path))).toEqual(original);
    expect(fs.existsSync(path.join(target, legacyCurrentTaskBackup(decisions)))).toBe(false);
    expect(fs.readFileSync(path.join(target, decisions.preserved_paused[0]!.path))).toEqual(paused);
    // An existing exact backup is reused, never converted as an archive.
    fs.mkdirSync(path.dirname(path.join(target, legacyCurrentTaskBackup(decisions))), { recursive: true });
    fs.writeFileSync(path.join(target, legacyCurrentTaskBackup(decisions)), original);
    install.packDir = tempRoot('migration-reused-backup-pack-');
    const reusedPack = createMigrationPack({ ...options, outDir: install.packDir });
    expect(reusedPack.artifacts.some(item => item.target_path === legacyCurrentTaskBackup(decisions))).toBe(false);
    manifest = reusedPack;
    expect(installMigrationPack(install).status).toBe('installed');
    expect(fs.readFileSync(path.join(target, legacyCurrentTaskBackup(decisions)))).toEqual(original);
    expect(fs.readFileSync(path.join(target, decisions.preserved_paused[0]!.path))).toEqual(paused);
    expect(validateCompletedMigration(target).migration_pack_id).toBe(manifest.pack_id);
    expect(installMigrationPack(install).status).toBe('replayed');
    const receipt = JSON.parse(fs.readFileSync(path.join(target, '.workflow-system/vnext/MIGRATION_RECEIPT.json'), 'utf8'));
    expect(receipt.preservation).toMatchObject({ assurance: 'caller-reported', paused_disposition: 'verbatim-unconverted-not-resumable' });
  }, 30000);

  test('completion decisions do not waive active tasks, interrupted work or conflicting backups', () => {
    const target = copyFixtureTarget();
    const decisions = historicalCompletion(target, ROOT);
    const options = { sourceRoot: ROOT, targetRoot: target, decisions };
    const original = fs.readFileSync(path.join(target, decisions.current_task.path), 'utf8');
    const active = original.replace('completed_verified_archived（已归档）', 'active');
    fs.writeFileSync(path.join(target, decisions.current_task.path), active);
    expect(preflightMigration({ ...options, decisions: { ...decisions, current_task: { ...decisions.current_task, sha256: createHash('sha256').update(active).digest('hex') } } }).eligible).toBe(false);
    const openFinding = original.replace('## 审查问题队列', '## 审查问题队列\n\n- Finding ID：F-legacy-open\n  - Status：open\n');
    fs.writeFileSync(path.join(target, decisions.current_task.path), openFinding);
    const findingCheck = preflightMigration({ ...options, decisions: { ...decisions, current_task: { ...decisions.current_task, sha256: createHash('sha256').update(openFinding).digest('hex') } } });
    expect(findingCheck.blockers.some(issue => issue.code === 'CURRENT_TASK_FINDING_OPEN')).toBe(true);
    fs.writeFileSync(path.join(target, decisions.current_task.path), original);
    fs.mkdirSync(path.join(target, 'TASKS/interrupted'), { recursive: true });
    fs.writeFileSync(path.join(target, 'TASKS/interrupted/work.md'), 'Unfinished');
    expect(preflightMigration(options).eligible).toBe(false);
    fs.unlinkSync(path.join(target, 'TASKS/interrupted/work.md'));
    fs.mkdirSync(path.join(target, 'TASKS/legacy'), { recursive: true });
    fs.writeFileSync(path.join(target, legacyCurrentTaskBackup(decisions)), 'different');
    expect(preflightMigration(options).eligible).toBe(false);
  });

  test('version one packs retain their historical deterministic identity', () => {
    const target = copyFixtureTarget();
    const oldCommand = '`node --test tests\\old.test.js`';
    fs.appendFileSync(path.join(target, 'docs/workflow/BASELINES.md'), '\n' + oldCommand + '\n');
    const packDir = tempRoot('migration-v1-pack-');
    const pack = createMigrationPack({ sourceRoot: ROOT, targetRoot: target, outDir: packDir });
    // Reproduce the old fixture bytes, including v1's command normalization.
    for (const artifact of pack.artifacts) {
      const original = fs.readFileSync(path.join(packDir, artifact.original_content_path), 'utf8');
      const current = fs.readFileSync(path.join(packDir, artifact.content_path), 'utf8');
      const metadata = artifact.kind === 'project-profile' ? parse(current).vnext_migration : parse(current.match(/^---\n([\s\S]*?)\n---\n/)![1]!);
      metadata.conversion_rule = 'canonical-envelope-v1';
      metadata.original_text_preserved = true;
      delete metadata.original_backup_path;
      metadata.path_references = artifact.path_references;
      if (artifact.kind !== 'project-profile') {
        metadata.heading_index = [];
        for (const line of original.split(/\r?\n/)) {
          const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
          if (!heading) continue;
          const text = heading[2]!.trim(), ordinal = metadata.heading_index.length;
          metadata.heading_index.push({ id: `heading-${createHash('sha256').update(`${artifact.source_path}\0${ordinal}\0${text}`).digest('hex').slice(0, 16)}`, level: heading[1]!.length, text });
        }
      }
      const legacy = artifact.kind === 'project-profile'
        ? `${original.endsWith('\n') ? original : original + '\n'}\n${stringify({ vnext_migration: metadata }).trimEnd()}\n`
        : `---\n${stringify(metadata).trimEnd()}\n---\n${original.replace(oldCommand, oldCommand.replaceAll('\\', '/'))}`;
      fs.writeFileSync(path.join(packDir, artifact.content_path), legacy);
      artifact.content_sha256 = createHash('sha256').update(legacy).digest('hex');
      artifact.byte_length = Buffer.byteLength(legacy);
      artifact.conversion_rule = artifact.provenance.conversion_rule = 'canonical-envelope-v1';
    }
    delete pack.alignment_context;
    const identity = { source: pack.source, target: pack.target, legacy_source: pack.legacy_source, legacy_protocol: pack.legacy_protocol,
      preflight: { state: pack.preflight.state, current_task: pack.preflight.current_task, current_task_excluded: true },
      artifacts: pack.artifacts.map(a => ({ stable_id: a.stable_id, source_sha256: a.source_sha256, content_sha256: a.content_sha256, target_path: a.target_path, conversion_rule: a.conversion_rule })),
      legacy_surface: pack.legacy_surface.entries.map(e => ({ path: e.path, sha256: e.sha256, action: e.action })) };
    pack.schema_version = 1;
    pack.pack_id = `migration-${createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 24)}`;
    fs.writeFileSync(path.join(packDir, 'migration-pack.json'), JSON.stringify(pack));
    expect(validateMigrationPack({ packDir, sourceRoot: ROOT, targetRoot: target }).pack_id).toBe(pack.pack_id);
    // v2 kept command text but still normalized actual inline path references.
    const baseline = pack.artifacts.find(a => a.source_path === 'docs/workflow/BASELINES.md')!;
    const baselinePath = path.join(packDir, baseline.content_path);
    const v2 = fs.readFileSync(baselinePath, 'utf8').replace(oldCommand.replaceAll('\\', '/'), oldCommand);
    fs.writeFileSync(baselinePath, v2);
    baseline.content_sha256 = createHash('sha256').update(v2).digest('hex');
    baseline.byte_length = Buffer.byteLength(v2);
    identity.artifacts = pack.artifacts.map(a => ({ stable_id: a.stable_id, source_sha256: a.source_sha256, content_sha256: a.content_sha256, target_path: a.target_path, conversion_rule: a.conversion_rule }));
    const { source: legacySource, ...rest } = identity;
    pack.schema_version = 2;
    pack.pack_id = `migration-${createHash('sha256').update(JSON.stringify({ source: legacySource, schema_version: 2, decisions: null, ...rest })).digest('hex').slice(0, 24)}`;
    fs.writeFileSync(path.join(packDir, 'migration-pack.json'), JSON.stringify(pack));
    expect(validateMigrationPack({ packDir, sourceRoot: ROOT, targetRoot: target }).pack_id).toBe(pack.pack_id);
  });

  test('preserves inline API/local examples and sibling guide references without allowing unsafe links', () => {
    const target = copyFixtureTarget();
    const guide = path.join(target, 'docs/workflow/WORKFLOW_GUIDE.md');
    fs.writeFileSync(guide, fs.readFileSync(guide, 'utf8').replaceAll('`docs/workflow/', '`'));
    const baseline = path.join(target, 'docs/workflow/BASELINES.md');
    const examples = '\nExamples: `/api/sessions*`, `E:\\project\\TermLink`, `node --test tests\\old.test.js`, `PLEASE IMPLEMENT THIS PLAN:\\n...`.\n';
    const siblingReference = '\n[Sibling guide](../workflow/WORKFLOW_GUIDE.md)\n';
    const original = fs.readFileSync(baseline, 'utf8') + examples + siblingReference;
    fs.writeFileSync(baseline, original);
    const packDir = tempRoot('migration-reference-pack-');
    const pack = createMigrationPack({ sourceRoot: ROOT, targetRoot: target, outDir: packDir });
    const artifact = pack.artifacts.find(a => a.source_path === 'docs/workflow/BASELINES.md')!;
    expect(fs.readFileSync(path.join(packDir, artifact.original_content_path), 'utf8')).toBe(original);
    expect(fs.readFileSync(path.join(packDir, artifact.content_path), 'utf8')).toContain(examples);
    expect(artifact.path_references.find(ref => ref.raw === '/api/sessions*')?.kind).toBe('unclassified');
    expect(artifact.path_references.find(ref => ref.raw === '../workflow/WORKFLOW_GUIDE.md')?.kind).toBe('repo-relative');
    fs.appendFileSync(baseline, '\n[unsafe](../../../outside.md)\n');
    expect(() => createMigrationPack({ sourceRoot: ROOT, targetRoot: target, outDir: tempRoot('migration-unsafe-pack-') })).toThrow('UNSAFE_PATH');
  });

  test('accepts a legacy DECISIONS.md with concrete superseded records', () => {
    const target = copyFixtureTarget();
    const decisionsPath = path.join(target, 'docs/workflow/DECISIONS.md');
    const decisions = fs.readFileSync(decisionsPath, 'utf8').replace(
      /### SUPERSEDED-001:[\s\S]*?(?=## ❌ 已否决)/,
      '- AD-001 已被后续架构决策替代，但其兼容约束继续有效。\n\n',
    );
    fs.writeFileSync(decisionsPath, decisions, 'utf8');

    const pack = createMigrationPack({ sourceRoot: ROOT, targetRoot: target, outDir: tempRoot('migration-legacy-decisions-pack-') });
    expect(pack.status).toBe('validated');
  });

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
    expect(manifest.artifacts.every(artifact => artifact.conversion_rule === 'canonical-verbatim-v2')).toBe(true);
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
    const bundle = JSON.parse(fs.readFileSync(path.join(bundleDir, 'vnext-bundle.json'), 'utf8')) as { artifacts: Array<{ target_path: string; source_path: string }> };
    const expertArtifact = bundle.artifacts.find(artifact => artifact.target_path === '.agents/skills/validate-change/SKILL.md');
    expect(expertArtifact).toBeDefined();
    expect(fs.readFileSync(path.join(bundleDir, ...expertArtifact!.source_path.split('/')), 'utf8')).not.toContain('validate-change:regression');
    expect(bundle.artifacts.some(artifact => artifact.target_path === '.agents/skills/git-commit/SKILL.md')).toBe(true);
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
    expect(fs.existsSync(path.join(target, '.agents', 'skills', 'prepare-task', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(target, ...VNEXT_INSTALL_STATE_RELATIVE_PATH.split('/')))).toBe(true);
    const completedMigration = validateCompletedMigration(target);
    expect(completedMigration).toMatchObject({ migration_pack_id: manifest.pack_id, bundle_id: expect.any(String), target_identity: expect.any(String) });
    const currentTaskPath = path.join(target, 'docs', 'workflow', 'CURRENT_TASK.md');
    const currentTaskBeforeDrift = fs.readFileSync(currentTaskPath, 'utf8');
    fs.appendFileSync(currentTaskPath, '\nprovenance drift\n', 'utf8');
    expect(validateCompletedMigration(target)).toMatchObject({ migration_pack_id: manifest.pack_id });
    fs.writeFileSync(currentTaskPath, currentTaskBeforeDrift, 'utf8');

    const replay = installMigrationPack({ packDir, bundleDir, sourceRoot: source, targetRoot: target });
    expect(replay.status).toBe('replayed');
    expect(replay.pack_id).toBe(manifest.pack_id);

    const receiptPath = path.join(target, '.workflow-system', 'vnext', 'MIGRATION_RECEIPT.json');
    const receiptBeforeTamper = fs.readFileSync(receiptPath, 'utf8');
    const tamperedReceipt = JSON.parse(receiptBeforeTamper) as { bundle_id: string };
    tamperedReceipt.bundle_id = 'bundle-000000000000000000000000';
    fs.writeFileSync(receiptPath, JSON.stringify(tamperedReceipt, null, 2) + '\n', 'utf8');
    expect(() => validateCompletedMigration(target)).toThrow('same conversion');
    fs.writeFileSync(receiptPath, receiptBeforeTamper, 'utf8');
    expect(validateCompletedMigration(target)).toMatchObject({ migration_pack_id: manifest.pack_id });
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
