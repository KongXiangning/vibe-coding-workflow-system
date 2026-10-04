import { afterEach, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { stringify } from 'yaml';
import { run } from '../runtime/vnext/src/product-maintenance/cli';
import { parseProduct, requirementDigest, sha256 } from '../runtime/vnext/src/product-maintenance/parser';
import { newDocument } from '../runtime/vnext/src/product-maintenance/writer';
import { type ObjectValue } from '../runtime/vnext/src/product-maintenance/model';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const body = (id: string, type: string, text = '约定业务范围与排除项保持。') => {
  const sections: Record<string, string[]> = { project: ['项目定位', '盘点范围与未核对项'], goal: ['目标说明', '范围边界'], requirement: ['需求内容', '范围边界', '验收要求'], plan: ['实施策略', '阶段与工作项说明', '调整与未决事项'], assessment: ['覆盖范围', '交付与验证依据', '剩余与待核对'], discussion: ['整理摘要', '议题与未决问题'] };
  return `## [${id}] ${id}\n${sections[type]!.map(s => `### ${s}\n${text}`).join('\n')}\n`;
};
const req = (id = 'REQ-A', extras: ObjectValue = {}) => ({ metadata: { id, type: 'requirement', scope: 'current', ...extras }, body: body(id, 'requirement') });
function fixture(items = [req()]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-product-test-')); roots.push(root);
  put(root, '.workflow-system/PRODUCT.yaml', stringify({ schema: 'vnext-product-manifest/v2', project_id: 'sample', entry: 'docs/product/PROJECT.md', managed_paths: ['docs/product/*.md'], source_paths: ['docs/evidence/**', 'docs/product/raw/**'], capture_paths: ['docs/product/raw/**'], exclude_paths: [], maintenance: 'enabled' }));
  put(root, 'docs/product/PROJECT.md', newDocument([{ metadata: { id: 'PROJECT-A', type: 'project', inventory: { state: 'partial', checked_sources: [], unreviewed_sources: [{ kind: 'text', text: '其他模块未核对', label: '未读范围' }] } }, body: body('PROJECT-A', 'project') }]));
  put(root, 'docs/product/REQUIREMENTS.md', newDocument(items)); return root;
}
function put(root: string, relative: string, text: string | Buffer): void { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
const get = (root: string, relative = 'docs/product/REQUIREMENTS.md') => fs.readFileSync(path.join(root, relative));
const fileOp = (root: string, updates: any[], relative = 'docs/product/REQUIREMENTS.md') => ({ path: relative, expected_sha256: sha256(get(root, relative)), updates });

test('inventory is partial, all scopes and delivered current requirements survive without tasks', () => {
  const root = fixture([req('REQ-A'), req('REQ-P', { scope: 'planned' }), req('REQ-C', { scope: 'candidate' }), req('REQ-R', { scope: 'retired' })]);
  const read = run('read', root, { detail: 'items' });
  expect(read.usable_items).toHaveLength(5); expect(read.coverage.complete).toBe(true);
  expect(read.usable_items.find((i: any) => i.type === 'project').metadata.inventory.unreviewed_sources).toHaveLength(1);
  expect(read.plan_tasks).toEqual([]); expect(fs.existsSync(path.join(root, '.workflow-system/records'))).toBe(false);
});
test('AST ignores code, quotes and lists; a bad item does not hide its neighbors', () => {
  const valid = req(); valid.body += '\n```md\n## [FAKE] fake\n```\n\n> ## [ALSO-FAKE] quoted\n\n- nested:\n\n  ## [LIST-FAKE] nested\n';
  const bad = req('REQ-B', { nonsense: true });
  const root = fixture([valid, bad, req('REQ-C')]);
  const read = run('read', root);
  expect(read.usable_items.map((i: any) => i.id)).toEqual(['PROJECT-A', 'REQ-A', 'REQ-C']);
  expect(read.unusable_items[0].id).toBe('REQ-B');
  expect(read.diagnostics.some((d: any) => d.code === 'UNREGISTERED_HEADING')).toBe(false);
});
test('unsafe YAML is locally rejected, including duplicates, aliases, custom tags and non-finite values', () => {
  for (const unsafe of ['scope: current\n    scope: planned', 'scope: &anchor current', 'scope: *anchor', 'scope: !custom current', 'scope: .inf', '<<: {scope: current}']) {
    const text = `---\nschema: vnext-product-doc/v2\nitems:\n  - id: REQ-B\n    type: requirement\n    ${unsafe}\n  - id: REQ-A\n    type: requirement\n    scope: current\n---\n${body('REQ-B', 'requirement')}\n${body('REQ-A', 'requirement')}`;
    const parsed = parseProduct(text, 'test.md');
    expect(parsed.items.find(i => i.id === 'REQ-B')?.usable).toBe(false);
    expect(parsed.items.find(i => i.id === 'REQ-A')?.usable).toBe(true);
  }
});
test('duplicate global identity is ambiguous and byte limits reveal incomplete coverage', () => {
  const root = fixture(); put(root, 'docs/product/DUP.md', newDocument([req()]));
  expect(run('read', root).usable_items.some((i: any) => i.id === 'REQ-A')).toBe(false);
  expect(run('read', root, { max_files: 1 }).coverage.complete).toBe(false);
  put(root, 'docs/product/LARGE.md', newDocument([{ ...req('REQ-L'), body: body('REQ-L', 'requirement', '完整长业务要求。'.repeat(100)) }]));
  expect(run('read', root, { max_file_bytes: 1000 }).coverage.complete).toBe(false);
});
test('definition hash normalizes line endings and excludes task, plan, discussion and assessment metadata', () => {
  const links = [{ id: 'L1', relation: 'supports', target: 'G2', origin: 'declared', state: 'active' }, { id: 'L2', relation: 'part_of', target: 'M1', origin: 'declared', state: 'active' }];
  const original = parseProduct(newDocument([req('REQ-A', { links })]), 'a.md').items[0]!;
  const modified = parseProduct(newDocument([req('REQ-A', { links: [...links].reverse().concat(links[0]!), assessment_id: 'AS-A', task_bindings: [], sources: [{ kind: 'text', text: '增加关联', label: '关联' }] })]).replace(/\n/g, '\r\n'), 'a.md').items[0]!;
  expect(requirementDigest(modified)).toBe(requirementDigest(original));
  modified.body += '\n增加明确需求。'; expect(requirementDigest(modified)).not.toBe(requirementDigest(original));
});
test('localized update retains malformed neighbor bytes and untouched business exceptions', () => {
  const root = fixture([req('REQ-A'), req('REQ-B', { nonsense: true })]);
  const original = get(root).toString(), parsed = parseProduct(original, 'docs/product/REQUIREMENTS.md'), bad = parsed.items[1]!;
  const result = run('apply', root, { files: [fileOp(root, [{ id: 'REQ-A', metadata: { scope: 'planned' } }])] });
  expect(result.status).toBe('saved');
  const after = parseProduct(get(root).toString(), 'docs/product/REQUIREMENTS.md');
  expect(after.items[0]!.metadata.scope).toBe('planned'); expect(after.items[0]!.body).toBe(parsed.items[0]!.body);
  expect(after.items[1]!.body).toBe(bad.body);
  expect(after.text.slice(after.items[1]!.metadata_start, after.items[1]!.metadata_end)).toBe(original.slice(bad.metadata_start, bad.metadata_end));
  expect(result.files[0].preimage.data_base64).toBe(Buffer.from(original).toString('base64'));
});
test('append and v1 explicit migration preserve existing content and IDs', () => {
  const root = fixture(), before = get(root).toString();
  const appended = run('apply', root, { files: [{ path: 'docs/product/REQUIREMENTS.md', expected_sha256: sha256(before), append: [req('REQ-N')] }] });
  expect(appended.status).toBe('saved');
  expect(run('read', root).usable_items.map((i: any) => i.id)).toContain('REQ-N');
  const old = get(root).toString().replace('vnext-product-doc/v2', 'vnext-product-doc/v1'); put(root, 'docs/product/REQUIREMENTS.md', old);
  expect(run('apply', root, { files: [fileOp(root, [{ id: 'REQ-A', metadata: { scope: 'planned' } }])] }).status).toBe('failed');
  expect(run('apply', root, { files: [{ ...fileOp(root, [{ id: 'REQ-A', metadata: { scope: 'planned' } }]), migrate: 'v2' }] }).status).toBe('saved');
  expect(parseProduct(get(root).toString(), 'a.md').items[0]!.body).toBe(parseProduct(before, 'a.md').items[0]!.body);
});
test('conflict and partial file failure never overwrite newer user bytes', () => {
  const root = fixture(), operation = fileOp(root, [{ id: 'REQ-A', metadata: { scope: 'retired' } }]);
  const changed = get(root).toString().replace('约定业务范围', '用户刚刚更新的范围'); put(root, 'docs/product/REQUIREMENTS.md', changed);
  const result = run('apply', root, { files: [operation, { path: 'docs/product/NEW.md', expected_sha256: null, content: newDocument([req('REQ-N')]) }] });
  expect(result.status).toBe('partial'); expect(result.files[0].error).toContain('WRITE_CONFLICT'); expect(get(root).toString()).toBe(changed);
  expect(run('apply', root, { files: [{ path: 'docs/product/NEW.md', expected_sha256: null, content: newDocument([req('REQ-X')]) }] }).status).toBe('failed');
});
test('capture retains original bytes once, conflict does not overwrite, URI remains unarchived', () => {
  const root = fixture(), bytes = Buffer.from([0xef, 0xbb, 0xbf, 13, 10, 0xff, 0, 1]);
  const captured = run('capture', root, { path: 'docs/product/raw/selected.bin', base64: bytes.toString('base64') });
  expect(captured.saved).toBe(true); expect(captured.source.sha256).toBe(sha256(bytes));
  expect(run('capture', root, { path: 'docs/product/raw/selected.bin', base64: bytes.toString('base64') }).reused).toBe(true);
  expect(run('capture', root, { path: 'docs/product/raw/selected.bin', text: '其他原文' }).saved).toBe(false);
  expect(get(root, 'docs/product/raw/selected.bin')).toEqual(bytes);
  expect(run('read', root, { source: { kind: 'uri', uri: 'https://example.com/unobtained' } }).status).toBe('reference-only');
});
test('paged source bytes, changed historical digest and exact item/section locators are reported', () => {
  const root = fixture(), old = '旧失败\n'.repeat(40000); put(root, 'docs/evidence/report.txt', old);
  const source = { kind: 'file', path: 'docs/evidence/report.txt', sha256: sha256(old) };
  const read = run('read', root, { source, offset: 65531, max_bytes: 17 });
  expect(Buffer.from(read.data_base64, 'base64')).toEqual(Buffer.from(old).subarray(65531, 65548)); expect(read.next_offset).toBe(65548);
  put(root, 'docs/evidence/report.txt', '新报告'); expect(run('read', root, { source }).byte_status).toBe('changed');
  const section = run('read', root, { source: { kind: 'file', path: 'docs/product/REQUIREMENTS.md', item_id: 'REQ-A', section: '范围边界' } });
  expect(section.status).toBe('available'); expect(section.text_preview).toContain('排除项');
  expect(run('read', root, { source: { kind: 'file', path: 'docs/evidence/missing.md' } }).byte_status).toBe('unavailable');
});
test('path traversal, excluded files, symlinks and frozen targets stop only the specific I/O', () => {
  const root = fixture();
  expect(run('capture', root, { path: '../outside.md', text: 'unsafe' }).saved).toBe(false);
  put(root, 'docs/product/FROZEN.md', '@frozen\n');
  expect(run('apply', root, { files: [{ path: 'docs/product/FROZEN.md', expected_sha256: sha256('@frozen\n'), content: newDocument([req('REQ-N')]) }] }).files[0].error).toContain('FROZEN');
  const link = path.join(root, 'docs/product/raw/link'); fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(path.join(root, 'docs/evidence'), link, process.platform === 'win32' ? 'junction' : 'dir');
  expect(run('capture', root, { path: 'docs/product/raw/link/unsafe.txt', text: 'unsafe' }).saved).toBe(false);
  expect(run('read', root).usable_items.some((i: any) => i.id === 'REQ-A')).toBe(true);
});
test('E6 keeps one requirement and stable work items; task binding retry has no task operations', () => {
  const task = { task_id: 'historical-opaque-id', step_id: 'S-A', plan_ref: 'runtime-old-ref', source: { kind: 'text', text: '合成任务来源', label: '隔离测试' } };
  const bindings = [{ id: 'B-A', task, role: 'implementation', coverage: '导入基础', origin: 'declared', state: 'active', plan_items: [{ plan_id: 'PLAN-A', work_item_id: 'E6A' }] }, { id: 'B-R', task: { ...task, task_id: 'repair-opaque-id' }, role: 'repair', coverage: '失败输入', origin: 'declared', state: 'active', plan_items: [{ plan_id: 'PLAN-A', work_item_id: 'E6R' }], repairs: [{ task, coverage: '原脚本相关范围，未知引入者', sources: [{ kind: 'text', text: '用户外部失败报告', label: '观察' }] }] }];
  const root = fixture([req('REQ-A', { task_bindings: bindings })]);
  const work = (id: string, added = false) => ({ id, title: id, outcome: '预期导入结果', scope: '局部范围', targets: [{ target: 'REQ-A', coverage: '导入范围' }], state: 'included', origin: added ? 'added' : 'initial', ...(added ? { sources: [{ kind: 'text', text: '外部失败后先修复', label: '决定' }] } : {}) });
  put(root, 'docs/product/PLAN.md', newDocument([{ metadata: { id: 'PLAN-A', type: 'plan', intent_state: 'adopted', targets: [{ target: 'REQ-A', coverage: '导入范围' }], work_items: [work('E6A'), work('E6B'), work('E6R', true), { ...work('E6C'), depends_on: [{ item_id: 'E6R', kind: 'prerequisite', reason: '需要实际可靠导入数据；关闭 task 不代表满足' }] }] }, body: body('PLAN-A', 'plan') }]));
  const read = run('read', root);
  expect(read.usable_items.filter((i: any) => i.type === 'requirement')).toHaveLength(1);
  expect(read.plan_tasks[0].work_items.find((w: any) => w.work_item_id === 'E6C').bindings).toEqual([]);
  const operation = fileOp(root, [{ id: 'REQ-A', metadata: { task_bindings: bindings } }]);
  expect(run('apply', root, { files: [operation] }).files[0].status).toBe('unchanged');
  expect(run('apply', root, { files: [operation] }).task_operations).toBe('not-performed');
  expect(fs.existsSync(path.join(root, '.workflow-system/records'))).toBe(false);
});
test('cyclic/withdrawn predecessors are visible diagnostics; retired targets stay retired', () => {
  const root = fixture([req('REQ-A', { scope: 'retired' })]);
  const work = (id: string, predecessor: string, state = 'included') => ({ id, title: id, outcome: '预期结果', scope: '局部范围', targets: [], state, origin: 'unknown', depends_on: [{ item_id: predecessor, kind: 'order', reason: '原安排未核对' }] });
  put(root, 'docs/product/PLAN.md', newDocument([{ metadata: { id: 'PLAN-A', type: 'plan', intent_state: 'retired', targets: [{ target: 'REQ-A', coverage: '历史范围' }], work_items: [work('A', 'B'), work('B', 'A', 'withdrawn')] }, body: body('PLAN-A', 'plan') }]));
  const read = run('read', root); expect(read.diagnostics.some((d: any) => d.code === 'WORK_DEPENDENCY_CYCLE')).toBe(true); expect(read.development_gate).toBe(false);
  expect(read.usable_items.find((i: any) => i.id === 'REQ-A').metadata.scope).toBe('retired');
});
test('new failure is visible with unchanged definition and original PASS; recall never adopts discussion', () => {
  const root = fixture([req('REQ-A', { assessment_id: 'AS-A' })]); const definition = run('read', root).usable_items.find((i: any) => i.id === 'REQ-A').definition_sha256;
  put(root, 'docs/product/ASSESSMENTS.md', newDocument([{ metadata: { id: 'AS-A', type: 'assessment', target: 'REQ-A', target_basis: { kind: 'file', path: 'docs/product/REQUIREMENTS.md', item_id: 'REQ-A' }, target_definition_sha256: definition, checked_at: '2026-10-04', subject: { kind: 'unknown', value: null }, implementation: 'delivered-reported', verification: 'pass-reported', sources: [{ kind: 'text', text: '历史范围 PASS，代码对象未知', label: '历史报告' }], pending_sources: [{ kind: 'text', text: '用户新增失败，未复现', label: '用户报告' }] }, body: body('AS-A', 'assessment') }]));
  const raw = run('capture', root, { path: 'docs/product/raw/discussion.txt', text: '也许应支持三设备；尚未决定。' });
  put(root, 'docs/product/DISCUSSIONS.md', newDocument([{ metadata: { id: 'DISC-A', type: 'discussion', raw_ref: raw.source, submitted_at: '2026-10-04', origin: { channel: 'unknown', occurred_at: null }, record_state: 'active', links: [{ id: 'L1', relation: 'discusses', target: 'REQ-A', origin: 'inferred', state: 'active', reason: '同一导入范围的候选想法', sources: [{ ...raw.source, lines: { start: 1, end: 1 } }] }] }, body: body('DISC-A', 'discussion', '三设备只是备选，未采纳。') }]));
  const read = run('read', root, { discussion_targets: ['REQ-A'], impact_ids: ['REQ-A'] });
  expect(read.diagnostics.some((d: any) => d.code === 'PENDING_SOURCES')).toBe(true);
  expect(read.usable_items.find((i: any) => i.id === 'REQ-A').definition_sha256).toBe(definition);
  expect(read.discussions[0].adopted).toBe(false); expect(read.discussions[0].summary).toContain('未采纳');
  const referenced = run('check', root, { resolve_sources: true }).sources.find((s: any) => s.basis_checks?.length);
  expect(referenced.basis_checks[0].definition_alignment).toBe('same-definition');
  expect(referenced.basis_checks[0].referenced_byte_availability).toBe('unknown');
  const discussionOp = fileOp(root, [{ id: 'DISC-A', metadata: { links: [{ id: 'L1', relation: 'discusses', target: 'REQ-A', origin: 'inferred', state: 'dismissed', reason: '实际是另一议题，撤销候选', sources: [raw.source] }] } }], 'docs/product/DISCUSSIONS.md');
  expect(run('apply', root, { files: [discussionOp] }).status).toBe('saved'); expect(run('read', root, { discussion_targets: ['REQ-A'] }).discussions).toEqual([]);
});
test('same project ID in distinct worktrees never merges bytes; paused and missing entry do not create gates', () => {
  const first = fixture(), second = fixture([req('REQ-OTHER')]);
  expect(run('read', first).working_copy.identity).not.toBe(run('read', second).working_copy.identity);
  put(first, '.workflow-system/PRODUCT.yaml', get(first, '.workflow-system/PRODUCT.yaml').toString().replace('maintenance: enabled', 'maintenance: paused'));
  expect(run('read', first).usable_items.some((i: any) => i.id === 'REQ-A')).toBe(true);
  fs.unlinkSync(path.join(second, '.workflow-system/PRODUCT.yaml')); expect(run('read', second).status).toBe('not-enabled'); expect(run('read', second).development_gate).toBe(false);
});
test('dismissed retry cannot reactivate without a new basis; newly introduced root heading is rejected', () => {
  const source = { kind: 'text', text: '原始推断', label: '旧依据' };
  const link = { id: 'L-A', relation: 'references', target: 'PROJECT-A', origin: 'inferred', state: 'dismissed', reason: '关联不成立', sources: [source] };
  const root = fixture([req('REQ-A', { links: [link] })]);
  expect(run('apply', root, { files: [fileOp(root, [{ id: 'REQ-A', metadata: { links: [{ ...link, state: 'active' }] } }])] }).status).toBe('failed');
  expect(run('apply', root, { files: [fileOp(root, [{ id: 'REQ-A', metadata: { links: [{ ...link, state: 'active', reason: '当前新材料明确关联', sources: [{ kind: 'text', text: '新依据', label: '实际纠正' }] }] } }])] }).status).toBe('saved');
  const bytes = get(root);
  expect(run('apply', root, { files: [fileOp(root, [{ id: 'REQ-A', body: body('REQ-A', 'requirement') + '\n## [UNREGISTERED] inserted\n' }])] }).status).toBe('failed');
  expect(get(root)).toEqual(bytes);
  const unsafe = run('read', root, { source: { kind: 'file', path: '../outside.md' } }); expect(unsafe.status).toBe('unavailable'); expect(unsafe.development_gate).toBe(false);
});
test('unknown prototype-looking fields, nonfinite request values and write size bounds are real diagnostics', () => {
  const root = fixture();
  const malicious = req('REQ-X', { constructor: 'unknown-core-field' });
  const result = run('apply', root, { files: [{ path: 'docs/product/UNKNOWN.md', expected_sha256: null, content: newDocument([malicious]) }] });
  expect(result.status).toBe('failed'); expect(result.files[0].error).toContain('Unknown core field');
  const bytes = get(root);
  expect(run('apply', root, { max_file_bytes: 100, files: [fileOp(root, [{ id: 'REQ-A', metadata: { scope: 'retired' } }])] }).status).toBe('failed');
  expect(get(root)).toEqual(bytes);
  expect(run('apply', root, { files: [fileOp(root, [{ id: 'REQ-A', metadata: { extensions: { overflow: Infinity } } }])] }).diagnostics[0].code).toBe('REQUEST_INVALID');
});
test('bundled Node helper coordinates racing writers and runs without source dependencies', async () => {
  const root = fixture(), helper = path.join(root, 'helper/product-maintenance.js');
  put(root, 'helper/package.json', '{"type":"module"}');
  put(root, 'helper/product-maintenance.js', fs.readFileSync(path.resolve(import.meta.dir, '../runtime/vnext/dist/product-maintenance.js')));
  const operation = fileOp(root, [{ id: 'REQ-A', metadata: { scope: 'planned' } }]);
  const request = (scope: string) => new Promise<ObjectValue>((resolve, reject) => {
    const child = spawn(process.execPath.includes('bun') ? 'node' : process.execPath, [helper, 'apply', '--root', root], { stdio: ['pipe', 'pipe', 'pipe'] });
    let text = ''; child.stdout.on('data', d => text += d); child.on('error', reject); child.on('exit', () => { try { resolve(JSON.parse(text)); } catch (e) { reject(e); } });
    child.stdin.end(JSON.stringify({ files: [{ ...operation, updates: [{ id: 'REQ-A', metadata: { scope } }] }] }));
  });
  const results = await Promise.all([request('planned'), request('retired')]); expect(results.filter(r => r.status === 'saved')).toHaveLength(1);
  const read = JSON.parse(execFileSync('node', [helper, 'read', '--root', root], { input: '{}', encoding: 'utf8' })); expect(read.usable_items).toHaveLength(2);
});
