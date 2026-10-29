import { test, expect, spyOn } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { planLegacyCleanup, applyLegacyCleanup } from '../scripts/cleanup-legacy-task-data';
import { TaskStore, commitTaskStorageMigration } from '../runtime/vnext/src/task-store';
import { readCanonicalCurrentTask } from '../runtime/vnext/src/kernel';
import { task, queryStatus, gitCheckpoint } from '../runtime/vnext/support/assistance.mjs';
import { restoreMigration, verifyMigrationBackup } from '../runtime/vnext/dist/task-state-migration.js';

const source = path.resolve(import.meta.dir, '..');
const sha = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
function put(root: string, ref: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(root, ref)), { recursive: true }); fs.writeFileSync(path.join(root, ref), text);
}
function snapshot(root: string, prefix = ''): Record<string, string> {
  return Object.fromEntries(fs.readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    const ref = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return Object.entries(snapshot(root, ref));
    return [[ref, sha(entry.isSymbolicLink() ? fs.readlinkSync(path.join(root, ref)) : fs.readFileSync(path.join(root, ref)))]];
  }));
}
function dispose(base: string): void {
  if (path.dirname(base) !== fs.realpathSync(os.tmpdir()) || !path.basename(base).startsWith('legacy-cleanup-')) throw Error('Unsafe test cleanup');
  function remove(file: string): void {
    if (fs.lstatSync(file).isDirectory() && !fs.lstatSync(file).isSymbolicLink()) {
      for (const name of fs.readdirSync(file)) remove(path.join(file, name)); fs.rmdirSync(file);
    } else fs.unlinkSync(file);
  }
  remove(base);
}
function fixture(compact = true): { base: string; root: string; blob: string; document: string } {
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'legacy-cleanup-'));
  const root = path.join(base, 'project'), old = path.join(base, 'old');
  const profile = fs.readFileSync(path.join(source, '.workflow-system/PROJECT_PROFILE.yaml'), 'utf8');
  put(root, '.workflow-system/PROJECT_PROFILE.yaml', profile);
  const prepared = task(root, { action: 'prepare', idempotency_key: 'fixture', plan: { title: '当前任务', goal: '保留任务与需求关系', steps: [{ id: 'S1', title: '实际范围' }] } });
  expect(prepared.recorded).toBe(true);
  put(old, '.workflow-system/PROJECT_PROFILE.yaml', profile);
  const text = fs.readFileSync(path.join(source, 'templates/vnext/bootstrap/CURRENT_TASK.md'), 'utf8') + '\n## 原文约束\n不能丢失的任务正文；允许按需恢复旧材料。\n';
  put(old, 'docs/workflow/CURRENT_TASK.md', text);
  const current = readCanonicalCurrentTask(old);
  if (compact) commitTaskStorageMigration(old, current as any, current.sourceTuple.revision);
  else TaskStore.forCurrent(old, current as any).ensureInitialized(current as any);
  fs.cpSync(path.join(old, 'docs/workflow/task-data'), path.join(root, 'docs/workflow/task-data'), { recursive: true });
  const document = current.sourceTuple.document_id, body = 'export const oldSnapshot = "历史版本";\n';
  const blob = `docs/workflow/evidence-objects/${sha(body)}.blob`;
  put(root, blob, body);
  put(root, 'docs/workflow/evidence-objects/.gitattributes', '*.blob -text\n');
  put(root, `docs/workflow/task-history/${document}/artifact-checkpoints/${'a'.repeat(64)}.json`, JSON.stringify({ kind: 'artifact-checkpoint/v1', document_id: document, task_id: '000', phase: 'before', step_id: 'S1', images: [{ path: 'source.ts', object: { path: 'source.ts', sha256: sha(body), size: Buffer.byteLength(body) } }] }));
  put(root, 'TASKS/kept.md', '# 原有人工任务文本\n关联需求与实际交付。\n');
  return { base, root, blob, document };
}

test('both legacy text representations export original Markdown, remove old stores and restore exact backups', async () => {
  for (const compact of [false, true]) {
    const { base, root, blob, document } = fixture(compact);
    try {
      put(root, `docs/workflow/task-data/${document}/user-notes.txt`, '用户资料不得删除');
      const before = snapshot(root), plan = planLegacyCleanup(root), archive = path.join(base, 'history.tar.gz');
      expect(snapshot(root)).toEqual(before);
      expect(plan.exports[0].text).toContain('不能丢失的任务正文');
      expect(plan.kept.some(entry => entry.path.endsWith('user-notes.txt'))).toBe(true);
      const result = await applyLegacyCleanup(root, plan, archive);
      expect(result.status).toBe('cleaned');
      expect(fs.existsSync(path.join(root, blob))).toBe(false);
      for (const entry of plan.protected) expect(sha(fs.readFileSync(path.join(root, entry.path)))).toBe(entry.sha256);
      expect(queryStatus(root).task_count).toBe(1);
      const after = snapshot(root);
      expect((await applyLegacyCleanup(root, plan, archive)).status).toBe('already-cleaned');
      expect(snapshot(root)).toEqual(after);
      expect((await verifyMigrationBackup(archive, plan.inputs)).files).toBe(plan.inputs.length);
      const restored = path.join(base, 'restore');
      await restoreMigration(archive, restored);
      for (const entry of plan.inputs) expect(sha(fs.readFileSync(path.join(restored, entry.path)))).toBe(entry.sha256);
    } finally { dispose(base); }
  }
});

test('current references pin exact source bytes and checkpoint snapshots without retaining the old transaction graph', async () => {
  const { base, root, blob, document } = fixture();
  try {
    const checkpoint = `docs/workflow/task-history/${document}/artifact-checkpoints/${'a'.repeat(64)}.json`;
    const manifest = `docs/workflow/task-data/${document}/manifest.json`;
    put(root, '.workflow-system/PRODUCT.yaml', JSON.stringify({ schema: 'vnext-product-manifest/v1', project_id: 'fixture', maintenance: 'enabled', entry: 'docs/product/PROJECT.md', managed_paths: ['docs/product/PROJECT.md'], source_paths: ['docs/workflow/**'], exclude_paths: [] }));
    put(root, 'docs/product/PROJECT.md', `---\n${JSON.stringify({ schema: 'vnext-product-doc/v2', items: [{ id: 'GOAL-A', type: 'goal', scope: 'current', sources: [{ kind: 'file', path: manifest }, { kind: 'file', path: checkpoint }] }] })}\n---\n## [GOAL-A] 保留来源\n### 目标说明\n当前仍明确使用的历史原件。\n`);
    const plan = planLegacyCleanup(root);
    expect(plan.remove).not.toContain(blob);
    expect(plan.kept.find(entry => entry.path === blob)?.reason).toBe('retained-checkpoint');
    expect(plan.remove.filter(ref => ref.startsWith(`docs/workflow/task-data/${document}/`)).length).toBeGreaterThan(0);
    await applyLegacyCleanup(root, plan, path.join(base, 'pinned.tar.gz'));
    expect(fs.existsSync(path.join(root, manifest))).toBe(true);
    expect(fs.existsSync(path.join(root, checkpoint))).toBe(true);
    expect(fs.existsSync(path.join(root, blob))).toBe(true);
    const clean = planLegacyCleanup(root);
    expect(clean.remove).toHaveLength(0);
    expect(clean.exports).toHaveLength(0);
    expect((await applyLegacyCleanup(root, clean, path.join(base, 'unneeded.tar.gz'))).backup).toBeNull();
    expect(fs.existsSync(path.join(base, 'unneeded.tar.gz'))).toBe(false);
  } finally { dispose(base); }
});

test('stale current data or new legacy writes stop cleanup before deletion', async () => {
  for (const change of ['current', 'legacy']) {
    const { base, root, document } = fixture();
    try {
      const plan = planLegacyCleanup(root);
      if (change === 'current') fs.appendFileSync(path.join(root, '.workflow-system/tasks/state.json'), '\n');
      else put(root, `docs/workflow/task-data/${document}/new-note.txt`, '并发写入');
      const before = snapshot(root), archive = path.join(base, 'stale.tar.gz');
      await expect(applyLegacyCleanup(root, plan, archive)).rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
      expect(snapshot(root)).toEqual(before);
      expect(fs.existsSync(archive)).toBe(false);
    } finally { dispose(base); }
  }
});

test('partial deletion can resume from its verified backup without changing tasks or duplicating exports', async () => {
  const { base, root } = fixture();
  let intercept: ReturnType<typeof spyOn> | undefined;
  try {
    const plan = planLegacyCleanup(root), archive = path.join(base, 'retry.tar.gz');
    const target = path.join(root, plan.remove[Math.floor(plan.remove.length / 2)]), unlink = fs.unlinkSync;
    intercept = spyOn(fs, 'unlinkSync').mockImplementation(file => {
      if (String(file) === target) throw Object.assign(Error('simulated locked legacy file'), { code: 'EACCES' });
      return unlink(file);
    });
    await expect(applyLegacyCleanup(root, plan, archive)).rejects.toMatchObject({ code: 'EACCES' });
    intercept.mockRestore(); intercept = undefined;
    expect((await verifyMigrationBackup(archive)).files).toBe(plan.inputs.length);
    expect((await applyLegacyCleanup(root, plan, archive)).status).toBe('cleaned');
    expect(queryStatus(root).task_count).toBe(1);
    expect(fs.readdirSync(path.join(root, 'TASKS/legacy'))).toHaveLength(1);
  } finally { intercept?.mockRestore(); dispose(base); }
});

test('symlinks, freezes and in-project backups cannot enter the deletion flow', async () => {
  const { base, root, document } = fixture();
  try {
    const plan = planLegacyCleanup(root);
    await expect(applyLegacyCleanup(root, plan, path.join(root, 'unsafe.tar.gz'))).rejects.toMatchObject({ code: 'EXTERNAL_FILE_REQUIRED' });
    put(root, '.workflow-system/FREEZE_REGISTRY.md', 'frozen');
    expect(() => planLegacyCleanup(root)).toThrow('freeze registry');
    fs.unlinkSync(path.join(root, '.workflow-system/FREEZE_REGISTRY.md'));
    const link = path.join(root, `docs/workflow/task-data/${document}/external`);
    fs.symlinkSync(path.join(base, 'old'), link, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => planLegacyCleanup(root)).toThrow('Symlink/junction');
  } finally { dispose(base); }
});

test('v1 projects, edited text exports and corrupt backups are reported without silently accepting cleanup', async () => {
  const { base, root } = fixture();
  try {
    fs.mkdirSync(path.join(base, 'unmigrated'));
    expect(() => planLegacyCleanup(path.join(base, 'unmigrated'))).toThrow('Migrate Task data to v2');
    const plan = planLegacyCleanup(root), archive = path.join(base, 'verified.tar.gz');
    put(root, plan.exports[0].path, '用户编辑的已有正文');
    const before = snapshot(root);
    expect(() => planLegacyCleanup(root)).toThrow('Existing task text was preserved');
    await expect(applyLegacyCleanup(root, plan, archive)).rejects.toThrow('Existing task text was preserved');
    expect(snapshot(root)).toEqual(before);
    fs.unlinkSync(path.join(root, plan.exports[0].path));
    await applyLegacyCleanup(root, plan, archive);
    const clean = snapshot(root), bytes = fs.readFileSync(archive);
    bytes[Math.floor(bytes.length / 2)] ^= 0xff; fs.writeFileSync(archive, bytes);
    await expect(applyLegacyCleanup(root, plan, archive)).rejects.toThrow();
    expect(snapshot(root)).toEqual(clean);
  } finally { dispose(base); }
});

test('a separate scoped deletion commit removes the old HEAD/index missing-file warnings without Runtime changes', () => {
  const { base, root } = fixture();
  try {
    const git = (args: string[]): string => execFileSync('git', ['-c', 'user.name=Cleanup fixture', '-c', 'user.email=cleanup@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd: root, encoding: 'utf8', windowsHide: true });
    put(root, '.workflow-system/records/events/old.json', '{}\n');
    git(['init', '-q']); git(['add', '--all']); git(['commit', '-qm', 'fixture before cleanup']);
    fs.unlinkSync(path.join(root, '.workflow-system/records/events/old.json'));
    expect(gitCheckpoint(root, { mode: 'checkpoint' }).issues.filter((issue: any) => issue.code === 'PERSISTENT_FILE_MISSING')).toHaveLength(1);
    git(['add', '-u', '--', '.workflow-system/records/events/old.json']); git(['commit', '-qm', 'explicit old-file deletion']);
    expect(gitCheckpoint(root, { mode: 'checkpoint' }).issues.filter((issue: any) => issue.code === 'PERSISTENT_FILE_MISSING')).toHaveLength(0);
  } finally { dispose(base); }
});
