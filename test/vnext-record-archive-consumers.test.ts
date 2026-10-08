import { afterEach, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { parse, stringify } from 'yaml';
import { archiveCommand } from '../runtime/vnext/support/record-storage.mjs';
import { fileContext, sha256 } from '../runtime/vnext/src/file-context';
import { taskRead } from '../runtime/vnext/src/task-context';
import { run } from '../runtime/vnext/src/product-maintenance/cli';
import { newDocument } from '../runtime/vnext/src/product-maintenance/writer';
import { installDistribution, upgradeDistribution } from '../scripts/vibe-governance-distribution';

const ROOT = path.resolve(import.meta.dir, '..');
const packageRoot = path.join(ROOT, 'packages/vibe-governance');
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function put(root: string, ref: string, bytes: string | Buffer) {
  const file = path.join(root, ref); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes);
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-consumers-')); roots.push(root);
  put(root, 'package.json', '{"name":"archive-consumer-fixture","private":true,"type":"module"}\n');
  put(root, '.workflow-system/PRODUCT.yaml', stringify({ schema: 'vnext-product-manifest/v2', project_id: 'archive-consumers',
    entry: 'docs/product/PROJECT.md', managed_paths: ['docs/product/*.md'],
    source_paths: ['.workflow-system/records/**', 'docs/product/raw/**'], capture_paths: ['docs/product/raw/**'], exclude_paths: [], maintenance: 'enabled' }));
  put(root, 'docs/product/PROJECT.md', newDocument([{ metadata: { id: 'PROJECT-ARCHIVE', type: 'project', inventory: { state: 'partial', checked_sources: [], unreviewed_sources: [{ kind: 'text', text: 'Fixture only', label: 'Scope' }] } }, body: '## [PROJECT-ARCHIVE] Archive fixture\n### 项目定位\nConsumer checks.\n### 盘点范围与未核对项\nFixture only.\n' }]));
  const event = '.workflow-system/records/events/original.json';
  const bytes = Buffer.from('{\r\n  "message": "原始记录🙂 archive-consumer-needle",\r\n  "result": "failed"\r\n}\r\n');
  const markdown = Buffer.from('# Original\r\n## Selected\r\n正文🙂\r\n## Other\r\nDo not return.\r\n');
  const legacy = `.workflow-system/records/legacy/current-${sha256(markdown)}.md`;
  put(root, event, bytes); put(root, legacy, markdown);
  return { root, event, bytes, legacy, markdown, source: { kind: 'file', path: event, sha256: sha256(bytes) } };
}
function archive(root: string, refs: string[]) {
  archiveCommand(root, { action: 'create', refs });
  archiveCommand(root, { action: 'quarantine', refs });
  refs.forEach(ref => expect(fs.existsSync(path.join(root, ref))).toBe(false));
}
function tree(root: string, prefix = '.workflow-system/records'): Record<string, string> {
  const result: Record<string, string> = {};
  const visit = (relative: string) => {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const ref = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(ref); else result[ref] = sha256(fs.readFileSync(path.join(root, ref)));
    }
  };
  visit(prefix); return result;
}

test('SourceRef, capture, file-context and task-read keep exact original paths after archival', async () => {
  const { root, event, bytes, legacy, markdown, source } = fixture();
  const before = run('read', root, { source });
  const selected = run('read', root, { source: { kind: 'file', path: legacy, sha256: sha256(markdown), section: 'Selected' } });
  expect(before.status).toBe('available'); expect(selected.text_preview).toContain('正文🙂');
  archive(root, [event, legacy]);
  const after = run('read', root, { source, offset: 3, max_bytes: 19 });
  expect(after).toMatchObject({ status: 'available', byte_status: 'same-bytes', storage: 'archive', verification: 'indexed-selected-chunks', content_is_referenced_bytes: true });
  expect(Buffer.from(after.data_base64, 'base64')).toEqual(bytes.subarray(3, 22));
  expect(run('read', root, { source: { kind: 'file', path: legacy, sha256: sha256(markdown), section: 'Selected' } }).data_base64).toBe(selected.data_base64);
  expect(run('read', root, { source: { ...source, sha256: '0'.repeat(64) } })).toMatchObject({ status: 'available', byte_status: 'changed', content_is_referenced_bytes: false });
  expect(await fileContext(root, { operation: 'read', path: event, start_line: 2, end_line: 2, sha256: source.sha256 })).toMatchObject({ status: 'pass', text: '  "message": "原始记录🙂 archive-consumer-needle",\r\n' });
  await expect(fileContext(root, { operation: 'read', path: event, sha256: '0'.repeat(64) })).rejects.toThrow('CONTEXT_STALE');
  expect(run('capture', root, { source_path: event, path: 'docs/product/raw/recovered.json' })).toMatchObject({ status: 'saved', raw_capture: true });
  expect(fs.readFileSync(path.join(root, 'docs/product/raw/recovered.json'))).toEqual(bytes);
  put(root, '.workflow-system/PROJECT_PROFILE.yaml', fs.readFileSync(path.join(ROOT, '.workflow-system/PROJECT_PROFILE.yaml')));
  put(root, 'docs/workflow/CURRENT_TASK.md', fs.readFileSync(path.join(ROOT, 'templates/vnext/bootstrap/CURRENT_TASK.md')));
  const currentBefore = fs.readFileSync(path.join(root, 'docs/workflow/CURRENT_TASK.md'));
  const task = taskRead(root, { path: event, max_bytes: 65536 });
  expect(task).toMatchObject({ status: 'success', committed: false, selection: { kind: 'file', reference: event }, value: { text: bytes.toString(), sha256: source.sha256 } });
  expect(fs.readFileSync(path.join(root, 'docs/workflow/CURRENT_TASK.md'))).toEqual(currentBefore);
  expect(fs.existsSync(path.join(root, 'docs/workflow/task-data'))).toBe(false);
});

test('ripgrep reports its archived-record gap without changing ordinary source search', async () => {
  const { root, event, legacy } = fixture();
  archive(root, [event, legacy]);
  const search = await fileContext(root, { operation: 'search', roots: ['.workflow-system/records/events'], query: 'archive-consumer-needle' });
  expect(search).toMatchObject({ status: 'partial', complete_within_scope: false, search_scope: 'physical-files', reason: 'archives-not-searched', hits: [] });
  expect(search.diagnostics?.[0]).toMatchObject({ code: 'CONTEXT_ARCHIVES_NOT_SEARCHED' });
  expect(search.diagnostics?.[0]?.message).toContain('restore');
  expect(await fileContext(root, { operation: 'search', roots: ['./.workflow-system//records/events/.'], query: 'archive-consumer-needle' })).toMatchObject({ status: 'partial', complete_within_scope: false });
  expect(await fileContext(root, { operation: 'search', roots: ['docs/product'], query: 'Consumer checks.' })).toMatchObject({ status: 'pass', complete_within_scope: true, diagnostics: [] });
  expect(await fileContext(root, { operation: 'search', roots: ['.'], query: 'Consumer checks.' })).toMatchObject({ status: 'pass', complete_within_scope: true, diagnostics: [] });
  expect(await fileContext(root, { operation: 'search', roots: ['.'], include_hidden: true, query: 'archive-consumer-needle' })).toMatchObject({ status: 'partial', complete_within_scope: false });
});

test('product capture and apply cannot write Runtime records even when a manifest registers those targets', () => {
  const { root, event, source, bytes } = fixture();
  archive(root, [event]);
  const manifestPath = '.workflow-system/PRODUCT.yaml';
  const manifest = parse(fs.readFileSync(path.join(root, manifestPath), 'utf8'));
  manifest.capture_paths.push('.workflow-system/records/**');
  manifest.managed_paths.push('.workflow-system/records/product.md');
  put(root, manifestPath, stringify(manifest));
  const before = tree(root);
  for (const target of [event, '.workflow-system/records/events/new.json', '.workflow-system/records/archives/new.json']) {
    const result = run('capture', root, { path: target, base64: bytes.toString('base64') });
    expect(result).toMatchObject({ status: 'failed', saved: false });
    expect(result.error).toContain('RECORD_STORE_READ_ONLY');
  }
  const applied = run('apply', root, { files: [{ path: '.workflow-system/records/product.md', expected_sha256: null,
    content: newDocument([{ metadata: { id: 'GOAL-RECORD', type: 'goal', scope: 'current' }, body: '## [GOAL-RECORD] Forbidden target\n### 目标说明\nFixture\n### 范围边界\nFixture\n' }]) }] });
  expect(applied.status).toBe('failed'); expect(applied.files[0].error).toContain('RECORD_STORE_READ_ONLY');
  expect(tree(root)).toEqual(before);
  expect(run('read', root, { source })).toMatchObject({ status: 'available', data_base64: bytes.toString('base64') });
});

test('installed Node consumers read indexed records and install/upgrade preserve archive, quarantine and loose bytes', { timeout: 45000 }, () => {
  const { root, event, legacy, bytes, source } = fixture();
  archive(root, [event, legacy]);
  put(root, '.workflow-system/records/events/new-loose.json', '{"after_archive":true}\n');
  const before = tree(root);
  expect(Object.keys(before).some(ref => /\/archives\/[^/]+\/pack-.*\.bin$/.test(ref))).toBe(true);
  expect(Object.keys(before).some(ref => /\/archives\/[^/]+\/index-.*\.json$/.test(ref))).toBe(true);
  expect(Object.keys(before).some(ref => ref.includes('/archive-quarantine/'))).toBe(true);
  const installed = installDistribution({ targetRoot: root, packageRoot });
  expect(installed.status, JSON.stringify(installed.blockers)).toBe('installed');
  expect(tree(root)).toEqual(before);
  const storage = '.workflow-system/runtime/support/record-storage.mjs';
  expect(sha256(fs.readFileSync(path.join(root, storage))), 'Rebuild the distribution after changing record-storage.mjs').toBe(sha256(fs.readFileSync(path.join(ROOT, 'runtime/vnext/support/record-storage.mjs'))));
  expect(sha256(fs.readFileSync(path.join(packageRoot, 'payload/migration-source/runtime/vnext/support/record-storage.mjs')))).toBe(sha256(fs.readFileSync(path.join(root, storage))));
  const helper = path.join(root, '.workflow-system/runtime/support/product-maintenance.js');
  const read = () => JSON.parse(execFileSync('node', [helper, 'read', '--root', root], { encoding: 'utf8', input: JSON.stringify({ source }) }));
  expect(read()).toMatchObject({ status: 'available', storage: 'archive', byte_status: 'same-bytes', data_base64: bytes.toString('base64') });
  const manifest = parse(fs.readFileSync(path.join(root, '.workflow-system/PRODUCT.yaml'), 'utf8'));
  manifest.capture_paths.push('.workflow-system/records/**'); put(root, '.workflow-system/PRODUCT.yaml', stringify(manifest));
  const blocked = spawnSync('node', [helper, 'capture', '--root', root], { encoding: 'utf8', input: JSON.stringify({ path: event, base64: bytes.toString('base64') }) });
  expect(blocked.status).toBe(1); expect(JSON.parse(blocked.stdout).error).toContain('RECORD_STORE_READ_ONLY');
  expect(tree(root)).toEqual(before);
  const cli = path.join(root, '.workflow-system/runtime/dist/cli.js');
  const context = JSON.parse(execFileSync('node', [cli, 'file-context', '--root', root], { encoding: 'utf8', input: JSON.stringify({ operation: 'read', path: event }) }));
  expect(context).toMatchObject({ status: 'pass', text: bytes.toString(), sha256: source.sha256 });
  const gap = spawnSync('node', [cli, 'file-context', '--root', root], { encoding: 'utf8', input: JSON.stringify({ operation: 'search', roots: ['.workflow-system/records/events'], query: 'archive-consumer-needle' }) });
  expect(gap.status).toBe(2); expect(JSON.parse(gap.stdout)).toMatchObject({ status: 'partial', complete_within_scope: false, reason: 'archives-not-searched' });
  const statePath = path.join(root, '.workflow-system/vnext/DISTRIBUTION_STATE.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  expect(state.managed_files.some((file: any) => file.path === storage)).toBe(true);
  expect(state.managed_files.some((file: any) => file.path.startsWith('.workflow-system/records/'))).toBe(false);
  state.distribution_version = '0.0.1'; fs.writeFileSync(statePath, JSON.stringify(state));
  expect(upgradeDistribution({ targetRoot: root, packageRoot }).status).toBe('upgraded');
  expect(tree(root)).toEqual(before);
  expect(read()).toMatchObject({ status: 'available', storage: 'archive', data_base64: bytes.toString('base64') });
  const restored = JSON.parse(execFileSync('node', [path.join(root, '.workflow-system/runtime/support/assistance.mjs'), 'archive', '--root', root], { encoding: 'utf8', input: JSON.stringify({ action: 'restore', refs: [event] }) }));
  expect(restored.development_gate).toBe(false);
  expect(fs.readFileSync(path.join(root, event))).toEqual(bytes);
});
