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
const wholeOp = (root: string, content: string, extra: ObjectValue = {}) => ({ path: 'docs/product/REQUIREMENTS.md', expected_sha256: sha256(get(root)), content, ...extra });

test('F01 whole candidates protect identity and v1 migration while explicit deletion and ordinary edits work', () => {
  const root = fixture(), original = get(root);
  for (const content of [newDocument([{ metadata: { id: 'REQ-A', type: 'goal', scope: 'current' }, body: body('REQ-A', 'goal') }]), newDocument([req('REQ-RENAMED')])]) {
    expect(run('apply', root, { files: [wholeOp(root, content)] }).status).toBe('failed'); expect(get(root)).toEqual(original);
  }
  expect(run('apply', root, { files: [{ path: 'docs/product/COPY.md', expected_sha256: null, content: newDocument([req()]) }] }).files[0].error).toContain('DUPLICATE_ID');
  expect(fs.existsSync(path.join(root, 'docs/product/COPY.md'))).toBe(false);
  const content = newDocument([{ ...req(), body: body('REQ-A', 'requirement', '明确更新业务正文，保留排除项。') }]);
  expect(run('apply', root, { files: [wholeOp(root, content)] }).status).toBe('saved');
  put(root, 'docs/product/REQUIREMENTS.md', content.replace('vnext-product-doc/v2', 'vnext-product-doc/v1'));
  const legacy = get(root);
  expect(run('apply', root, { files: [wholeOp(root, content)] }).files[0].error).toContain('V1_READ_ONLY'); expect(get(root)).toEqual(legacy);
  expect(run('apply', root, { files: [wholeOp(root, content, { migrate: 'v2' })] }).status).toBe('saved');
  expect(run('apply', root, { files: [wholeOp(root, newDocument([req('REQ-NEW')]), { remove_items: ['REQ-A'] })] }).status).toBe('saved');
  const manifest = get(root, '.workflow-system/PRODUCT.yaml').toString().replace('manifest/v2', 'manifest/v1').replace(/capture_paths:[\s\S]*?(?=exclude_paths:)/, '');
  put(root, '.workflow-system/PRODUCT.yaml', manifest);
  const manifestOp = { path: '.workflow-system/PRODUCT.yaml', expected_sha256: sha256(manifest), content: manifest.replace('manifest/v1', 'manifest/v2') };
  expect(run('apply', root, { files: [manifestOp] }).files[0].error).toContain('V1_READ_ONLY');
  expect(run('apply', root, { files: [{ ...manifestOp, migrate: 'v2' }] }).status).toBe('saved');
});
test('F01 F02 dismissed links and bindings resist content, reordered/repeated sources and equivalent IDs', () => {
  const sources = [{ kind: 'text', text: '原材料 A', label: 'A' }, { kind: 'file', path: 'docs/evidence/b.md', section: '依据' }];
  const link = { id: 'L-A', relation: 'references', target: 'PROJECT-A', origin: 'inferred', state: 'dismissed', reason: '用户否定此关系', sources };
  const binding = { id: 'B-A', task: { task_id: 'opaque-task', source: sources[0] }, role: 'repair', coverage: '同一范围', origin: 'inferred', state: 'dismissed', reason: '用户否定此关系', sources };
  for (const [field, relation] of [['links', link], ['task_bindings', binding]] as const) {
    const root = fixture([req('REQ-A', { [field]: [relation] })]), original = get(root);
    for (const whole of [false, true]) for (const candidateSources of [[...sources].reverse(), [...sources, sources[0]], [{ label: 'A', text: '原材料 A', kind: 'text' }, { section: '依据', path: 'docs/evidence/b.md', kind: 'file' }], [sources[0]]]) {
      const metadata = { [field]: [{ ...relation, state: 'active', reason: '改写理由不足以成为新依据', sources: candidateSources }] };
      const op = whole ? wholeOp(root, newDocument([req('REQ-A', metadata)])) : fileOp(root, [{ id: 'REQ-A', metadata }]);
      expect(run('apply', root, { files: [op] }).status).toBe('failed'); expect(get(root)).toEqual(original);
    }
    const bypass = { ...relation, id: 'ANOTHER-ID', state: 'active' };
    expect(run('apply', root, { files: [fileOp(root, [{ id: 'REQ-A', metadata: { [field]: [bypass] } }])] }).status).toBe('failed'); expect(get(root)).toEqual(original);
    expect(run('apply', root, { files: [fileOp(root, [{ id: 'REQ-A', metadata: { [field]: [] } }])] }).status).toBe('failed'); expect(get(root)).toEqual(original);
    const decision = { kind: 'text', text: '当前用户明确改变原决定，同意重新关联此范围。', label: '本次决定' };
    const metadata = { [field]: [{ ...relation, state: 'active', reason: '本次明确改变决定；旧否定保存在 preimage', sources: [...sources, decision] }] };
    const saved = run('apply', root, { files: [wholeOp(root, newDocument([req('REQ-A', metadata)]))] });
    expect(saved.status).toBe('saved'); expect(saved.files[0].preimage.data_base64).toBe(original.toString('base64'));
    put(root, 'docs/product/REQUIREMENTS.md', original);
    const removal = { ...fileOp(root, [{ id: 'REQ-A', metadata: { [field]: [] } }]), remove_relations: [{ item_id: 'REQ-A', field, id: relation.id }] };
    expect(run('apply', root, { files: [removal] }).status).toBe('saved');
  }
  const legacy = { ...binding, id: 'LEGACY-OLD', task: { task_id: null, source: { kind: 'file', path: 'docs/evidence/legacy.md', section: '导入', note: '原显示备注' } } };
  const legacyRoot = fixture([req('REQ-A', { task_bindings: [legacy] })]), legacyBytes = get(legacyRoot);
  const revived = { ...legacy, id: 'LEGACY-NEW', state: 'active', reason: '仅改显示备注或引用摘要不是新决定', task: { ...legacy.task, source: { ...legacy.task.source, note: '新显示备注', sha256: 'a'.repeat(64) } } };
  expect(run('apply', legacyRoot, { files: [fileOp(legacyRoot, [{ id: 'REQ-A', metadata: { task_bindings: [legacy, revived] } }])] }).status).toBe('failed');
  expect(get(legacyRoot)).toEqual(legacyBytes);
  const current = { ...revived, reason: '当前明确改变原决定，保留旧否定', sources: [...sources, { kind: 'text', text: '本轮当前明确同意重新关联这项历史范围', label: '当前决定' }] };
  expect(run('apply', legacyRoot, { files: [fileOp(legacyRoot, [{ id: 'REQ-A', metadata: { task_bindings: [legacy, current] } }])] }).status).toBe('saved');
});
test('F03 remove_fields alone removes optional selection, is idempotent, and cannot remove required identity', () => {
  const root = fixture([req('REQ-A', { assessment_id: 'AS-A' })]); put(root, 'docs/evidence/old-assessment.txt', '历史 assessment 原文');
  const operation = () => fileOp(root, [{ id: 'REQ-A', remove_fields: ['assessment_id'] }]);
  expect(run('apply', root, { files: [operation()] }).files[0].status).toBe('saved');
  expect(parseProduct(get(root).toString(), 'r.md').items[0]!.metadata.assessment_id).toBeUndefined();
  expect(run('apply', root, { files: [operation()] }).files[0].status).toBe('unchanged');
  expect(get(root, 'docs/evidence/old-assessment.txt').toString()).toBe('历史 assessment 原文');
  for (const field of ['id', 'type', 'scope']) {
    const before = get(root); expect(run('apply', root, { files: [fileOp(root, [{ id: 'REQ-A', remove_fields: [field] }])] }).status).toBe('failed'); expect(get(root)).toEqual(before);
  }
  expect(run('apply', root, { files: [fileOp(root, [{ id: 'REQ-A', metadata: { assessment_id: 'AS-X' }, remove_fields: ['assessment_id'] }])] }).files[0].status).toBe('unchanged');
});
test('F04 missing registered/selected paths and Windows junctions retain omissions without stopping independent reads', () => {
  const root = fixture();
  const missing = 'docs/product/MISSING.md';
  let read = run('read', root, { paths: [missing, 'docs/product/REQUIREMENTS.md'] });
  expect(read.coverage.complete).toBe(false); expect(read.coverage.omitted).toContain(missing); expect(read.usable_items.map((i: any) => i.id)).toContain('REQ-A');
  const manifest = get(root, '.workflow-system/PRODUCT.yaml').toString().replace('docs/product/*.md', 'docs/product/*.md\n  - docs/product/MISSING.md'); put(root, '.workflow-system/PRODUCT.yaml', manifest);
  read = run('check', root); expect(read.coverage.complete).toBe(false); expect(read.status).toBe('partial');
  put(root, missing, newDocument([req('REQ-M')]));
  expect(run('read', root, { paths: ['docs/product/NO-MATCH-*.md'] }).coverage.complete).toBe(true);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'product-junction-')); roots.push(outside); put(outside, 'HIDDEN.md', newDocument([req('REQ-HIDDEN')]));
  fs.symlinkSync(outside, path.join(root, 'docs/product/linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const recursive = get(root, '.workflow-system/PRODUCT.yaml').toString().replace('docs/product/*.md', 'docs/product/**/*.md'); put(root, '.workflow-system/PRODUCT.yaml', recursive);
  read = run('read', root); expect(read.coverage.complete).toBe(false); expect(read.coverage.omitted).toContain('docs/product/linked'); expect(read.diagnostics.some((d: any) => d.code === 'SYMLINK_SKIPPED')).toBe(true); expect(read.usable_items.map((i: any) => i.id)).toContain('REQ-A'); expect(read.usable_items.map((i: any) => i.id)).not.toContain('REQ-HIDDEN');
  put(root, '.workflow-system/PRODUCT.yaml', recursive.replace('exclude_paths: []', 'exclude_paths: [docs/product/linked]'));
  expect(run('read', root).coverage.complete).toBe(true);
  fs.unlinkSync(path.join(root, 'docs/product/PROJECT.md'));
  read = run('read', root); expect(read.coverage.complete).toBe(false); expect(read.coverage.omitted).toContain('docs/product/PROJECT.md');
});
test('F05 whole candidate repairs only changed malformed item and keeps another malformed item exact', () => {
  const badRelations = [{ id: 'L-B', relation: 'references', target: 'PROJECT-A', origin: 'declared', state: 'dismissed', reason: '原否定保留' }, null];
  const root = fixture([req('REQ-A', { unknown: true }), req('REQ-B', { another_unknown: true, links: badRelations }), req('REQ-C')]);
  const original = get(root).toString(), prior = parseProduct(original, 'r.md');
  const content = original.replace('    unknown: true\n', '');
  const result = run('apply', root, { files: [wholeOp(root, content)] }); expect(result.status).toBe('saved');
  const next = parseProduct(get(root).toString(), 'r.md'); expect(next.items[0]!.usable).toBe(true); expect(next.items[1]!.usable).toBe(false);
  expect(next.items[1]!.body).toBe(prior.items[1]!.body); expect(next.text.slice(next.items[1]!.metadata_start, next.items[1]!.metadata_end)).toBe(original.slice(prior.items[1]!.metadata_start, prior.items[1]!.metadata_end));
  const before = get(root); const corrupt = before.toString().replace('another_unknown: true', 'another_unknown: false');
  expect(run('apply', root, { files: [wholeOp(root, corrupt)] }).status).toBe('failed'); expect(get(root)).toEqual(before);
  expect(run('apply', root, { files: [wholeOp(root, before.toString().replace('id: REQ-A\n    type: requirement', 'id: REQ-A\n    type: goal'))] }).status).toBe('failed'); expect(get(root)).toEqual(before);
});
test('F06 localized bodies reject root boundaries and swallowed neighbors while AST pseudo headings and file appendices work', () => {
  const root = fixture([req(), req('REQ-B')]), original = get(root);
  for (const text of [body('REQ-A', 'requirement') + '\n## 普通约束\n不得上传原始数据。\n', body('REQ-A', 'requirement') + '\n```md\n未闭合代码块\n', body('REQ-OTHER', 'requirement')]) {
    expect(run('apply', root, { files: [fileOp(root, [{ id: 'REQ-A', body: text }])] }).status).toBe('failed'); expect(get(root)).toEqual(original);
  }
  const legal = body('REQ-A', 'requirement') + '\n### 诊断约束\n不得上传设备原始数据，诊断同样遵守。\n\n```md\n## 代码示例\n```\n\n> ## 引用\n\n- nested:\n\n  ## 列表伪标题\n';
  expect(run('apply', root, { files: [fileOp(root, [{ id: 'REQ-A', body: legal }])] }).status).toBe('saved');
  const next = parseProduct(get(root).toString(), 'r.md'); expect(next.items[0]!.body).toContain('诊断同样遵守'); expect(next.items[1]!.body).toBe(parseProduct(original.toString(), 'r.md').items[1]!.body);
  expect(run('apply', root, { files: [wholeOp(root, get(root).toString() + '\n## 附录\n合法文件附录。\n')] }).status).toBe('saved');
});

test('R01 inline double-star globs preserve recursive matching without visiting unrelated junctions', () => {
  const root = fixture();
  put(root, '.workflow-system/PRODUCT.yaml', get(root, '.workflow-system/PRODUCT.yaml').toString().replace('docs/product/*.md', 'docs/product/**.md'));
  put(root, 'docs/product/nested/DEEP.md', newDocument([req('REQ-DEEP')]));
  put(root, 'docs/product/nested/deeper/LEAF.md', newDocument([req('REQ-LEAF')]));
  put(root, 'docs/product/nestX/OTHER.md', newDocument([req('REQ-OTHER')]));
  for (const pattern of ['docs/product/**.md', 'docs/product/nest**/*.md', 'docs/product/**/*.md']) {
    const read = run('read', root, { paths: [pattern] });
    expect(read.coverage.complete).toBe(true); expect(read.coverage.omitted).toEqual([]);
    expect(read.usable_items.map((i: any) => i.id)).toEqual(expect.arrayContaining(['REQ-DEEP', 'REQ-LEAF', 'REQ-OTHER']));
  }
  const shallow = run('read', root, { paths: ['docs/product/*.md'] });
  expect(shallow.coverage.complete).toBe(true); expect(shallow.usable_items.map((i: any) => i.id)).toEqual(['PROJECT-A', 'REQ-A']);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'product-unrelated-junction-')); roots.push(outside);
  fs.symlinkSync(outside, path.join(root, 'docs/product/unrelated'), process.platform === 'win32' ? 'junction' : 'dir');
  const selected = run('read', root, { paths: ['docs/product/nest**/*.md'] });
  expect(selected.coverage.complete).toBe(true); expect(selected.coverage.omitted).toEqual([]);
  expect(selected.diagnostics.some((d: any) => d.code === 'SYMLINK_SKIPPED')).toBe(false);
});
test('R02 malformed old sources allow explicit reassociation but cannot supply a new basis themselves', () => {
  const source = { kind: 'text', text: '原否定材料', label: '旧来源' };
  const decision = { kind: 'text', text: '当前用户明确改变原决定，同意此范围重新关联', label: '当前决定' };
  const link = { id: 'L-A', relation: 'references', target: 'PROJECT-A', origin: 'inferred', state: 'dismissed', reason: '原用户否定', sources: [null, source] };
  const binding = { id: 'B-A', task: { task_id: 'opaque-task', source }, role: 'repair', coverage: '原范围', origin: 'inferred', state: 'dismissed', reason: '原用户否定', sources: [null, source] };
  for (const [field, relation] of [['links', link], ['task_bindings', binding]] as const) for (const whole of [false, true]) {
    const badNeighbor = req('REQ-KEEP', { unknown: true });
    const root = fixture([req('REQ-A', { [field]: [relation] }), badNeighbor]), original = get(root), before = parseProduct(original.toString(), 'r.md');
    const operation = (updated: ObjectValue) => whole ? wholeOp(root, newDocument([req('REQ-A', { [field]: [updated] }), badNeighbor])) : fileOp(root, [{ id: 'REQ-A', metadata: { [field]: [updated] } }]);
    for (const sources of [[source], [null, source]]) {
      expect(run('apply', root, { files: [operation({ ...relation, state: 'active', sources })] }).status).toBe('failed'); expect(get(root)).toEqual(original);
    }
    const nextRelation = { ...relation, state: 'active', reason: '采用当前明确反转决定，保留旧原文', sources: [source, decision] };
    const saved = run('apply', root, { files: [operation(nextRelation)] });
    expect(saved.status).toBe('saved'); expect(saved.files[0].preimage.data_base64).toBe(original.toString('base64'));
    const after = parseProduct(get(root).toString(), 'r.md'); expect(after.items[0]!.usable).toBe(true);
    expect(after.items[1]!.body).toBe(before.items[1]!.body);
    expect(after.text.slice(after.items[1]!.metadata_start, after.items[1]!.metadata_end)).toBe(before.text.slice(before.items[1]!.metadata_start, before.items[1]!.metadata_end));
    expect(run('apply', root, { files: [operation(nextRelation)] }).files[0].status).toBe('unchanged');
  }
  const root = fixture([req('REQ-A', { links: [{ ...link, sources: 'invalid-array' }] })]);
  expect(run('apply', root, { files: [fileOp(root, [{ id: 'REQ-A', metadata: { links: [{ ...link, state: 'active', reason: '当前明确反转决定', sources: [decision] }] } }])] }).status).toBe('saved');
});
test('R03 explicit relation removal repairs null members while preserving valid relations and raw history', () => {
  const source = { kind: 'text', text: '用户决定与历史来源', label: '来源' };
  const link = { id: 'L-OLD', relation: 'references', target: 'PROJECT-A', origin: 'inferred', state: 'dismissed', reason: '原否定', sources: [source] };
  const binding = { id: 'B-OLD', task: { task_id: 'old-task', source }, role: 'repair', coverage: '旧范围', origin: 'inferred', state: 'dismissed', reason: '原否定', sources: [source] };
  for (const [field, relation] of [['links', link], ['task_bindings', binding]] as const) for (const whole of [false, true]) {
    const kept = field === 'links' ? { ...link, id: 'L-KEEP', target: 'REQ-A', state: 'active' } : { ...binding, id: 'B-KEEP', task: { task_id: 'kept-task', source }, state: 'active' };
    const root = fixture([req('REQ-A', { [field]: [null, relation, kept] }), req('REQ-KEEP', { unknown: true })]), original = get(root);
    const operation = (relations: any[], removals: any[] = []) => ({ ...(whole ? wholeOp(root, newDocument([req('REQ-A', { [field]: relations }), req('REQ-KEEP', { unknown: true })])) : fileOp(root, [{ id: 'REQ-A', metadata: { [field]: relations } }])), remove_relations: removals });
    const removal = { item_id: 'REQ-A', field, id: relation.id };
    for (const op of [operation([kept]), operation([kept], [{ ...removal, id: kept.id }]), operation([kept], [{ ...removal, id: 'UNKNOWN' }]), operation([null, kept], [removal])]) {
      expect(run('apply', root, { files: [op] }).status).toBe('failed'); expect(get(root)).toEqual(original);
    }
    const saved = run('apply', root, { files: [operation([kept], [removal])] });
    expect(saved.status).toBe('saved'); expect(saved.files[0].preimage.data_base64).toBe(original.toString('base64'));
    const after = parseProduct(get(root).toString(), 'r.md'); expect(after.items[0]!.usable).toBe(true); expect(after.items[0]!.metadata[field]).toEqual([kept]);
    const before = parseProduct(original.toString(), 'r.md'); expect(after.items[1]!.body).toBe(before.items[1]!.body);
    expect(after.text.slice(after.items[1]!.metadata_start, after.items[1]!.metadata_end)).toBe(before.text.slice(before.items[1]!.metadata_start, before.items[1]!.metadata_end));
  }
});
test('R04 directories at explicit file paths are omitted while glob directory prefixes remain readable', () => {
  const root = fixture(), entry = 'docs/product/PROJECT.md';
  put(root, 'docs/evidence/project-before.txt', get(root, entry)); fs.unlinkSync(path.join(root, entry)); fs.mkdirSync(path.join(root, entry));
  const read = run('read', root, { paths: [entry, 'docs/product/REQUIREMENTS.md'] });
  expect(read.coverage.complete).toBe(false); expect(read.coverage.omitted).toContain(entry); expect(read.usable_items.map((i: any) => i.id)).toContain('REQ-A');
  expect(run('check', root).status).toBe('partial');
  const regular = fixture();
  put(regular, '.workflow-system/PRODUCT.yaml', get(regular, '.workflow-system/PRODUCT.yaml').toString().replace('docs/product/*.md', 'docs/product/**/*.md'));
  put(regular, 'docs/product/section.md/CHILD.md', newDocument([req('REQ-CHILD')]));
  const glob = run('read', regular); expect(glob.coverage.complete).toBe(true); expect(glob.coverage.omitted).toEqual([]); expect(glob.usable_items.map((i: any) => i.id)).toContain('REQ-CHILD');
  const concrete = run('read', regular, { paths: ['docs/product/section.md', 'docs/product/REQUIREMENTS.md'] });
  expect(concrete.coverage.complete).toBe(false); expect(concrete.coverage.omitted).toContain('docs/product/section.md'); expect(concrete.usable_items.map((i: any) => i.id)).toEqual(['REQ-A']);
});

test('C01 repairing unknown source fields preserves dismissal while current explicit reversal remains legal', () => {
  const sources: ObjectValue[] = [
    { kind: 'text', text: '同一材料\r\n原决定', label: '旧显示' },
    { kind: 'uri', uri: 'https://example.test/original', note: '旧显示' },
    { kind: 'file', path: 'docs/evidence/original.md', lines: { start: 1, end: 3 }, sha256: 'a'.repeat(64) },
  ];
  for (const source of sources) for (const field of ['links', 'task_bindings']) for (const whole of [false, true]) {
    const oldSource = { ...source, unknown: true, ...(source.lines ? { lines: { ...source.lines, unknown: 'format-only' } } : {}) };
    const identity = field === 'links' ? { relation: 'references', target: 'PROJECT-A' }
      : { task: { task_id: 'real-task-id', source: { kind: 'text', text: '既有 task 来源', label: 'task' } }, role: 'repair', coverage: '原范围' };
    const dismissed = { id: 'REL-OLD', ...identity, origin: 'inferred', state: 'dismissed', reason: '原用户否定，格式修复不改变决定', sources: [oldSource] };
    const root = fixture([req('REQ-A', { [field]: [dismissed] })]), original = get(root);
    const operation = (relation: ObjectValue) => whole ? wholeOp(root, newDocument([req('REQ-A', { [field]: [relation] })]))
      : fileOp(root, [{ id: 'REQ-A', metadata: { [field]: [relation] } }]);
    const cleaned = { ...dismissed, sources: [source] };
    const wrongRevival = run('apply', root, { files: [operation({ ...cleaned, state: 'active', reason: '仅清理未知字段，原用户决定不变' })] });
    expect(wrongRevival.files[0].error).toContain('DISMISSED_RELATION'); expect(get(root)).toEqual(original);
    const repaired = run('apply', root, { files: [operation(cleaned)] });
    expect(repaired.status).toBe('saved'); expect(repaired.files[0].preimage.data_base64).toBe(original.toString('base64'));
    const beforeReversal = get(root);
    const decision = { kind: 'text', text: '当前用户明确改变原否定，现在重新关联该范围。', label: '当前明确操作' };
    const reassociated = run('apply', root, { files: [operation({ ...cleaned, state: 'active', origin: 'declared', reason: decision.text, sources: [source, decision] })] });
    expect(reassociated.status).toBe('saved'); expect(reassociated.files[0].preimage.data_base64).toBe(beforeReversal.toString('base64'));
    expect(run('read', root).usable_items.find((i: any) => i.id === 'REQ-A').metadata[field][0].state).toBe('active');
  }
});

test('C02 existing active relations do not block unrelated maintenance but new equivalent activation still needs its basis', () => {
  const source = { kind: 'text', text: '原依据', label: '原来源' };
  for (const field of ['links', 'task_bindings']) for (const whole of [false, true]) {
    const identity = field === 'links' ? { relation: 'references', target: 'PROJECT-A' }
      : { task: { task_id: 'existing-task', source }, role: 'repair', coverage: '既有范围' };
    const dismissed = { id: 'REL-OLD', ...identity, origin: 'inferred', state: 'dismissed', reason: '原否定', sources: [source] };
    const active = { ...dismissed, id: 'REL-CURRENT', origin: 'declared', state: 'active', reason: '文件中原有的当前关联，本次不改变' };
    const relations = [dismissed, active];
    const root = fixture([req('REQ-A', { [field]: relations, assessment_id: 'AS-OLD' })]);
    const assessmentPath = 'docs/product/ASSESSMENTS.md';
    put(root, assessmentPath, newDocument([{ metadata: { id: 'AS-OLD', type: 'assessment', target: 'REQ-A', target_basis: { kind: 'file', path: 'docs/product/REQUIREMENTS.md', item_id: 'REQ-A' }, target_definition_sha256: null, checked_at: '2026-10-06', subject: { kind: 'unknown', value: null }, implementation: 'unknown', verification: 'unknown' }, body: body('AS-OLD', 'assessment') }]));
    const oldAssessment = get(root, assessmentPath);
    const update = (metadata: ObjectValue, remove_fields: string[] = []) => {
      if (!whole) return fileOp(root, [{ id: 'REQ-A', metadata, remove_fields }]);
      const previous = parseProduct(get(root).toString(), 'r.md').items[0]!.metadata;
      const next = { ...previous, ...metadata }; for (const key of remove_fields) delete next[key];
      return wholeOp(root, newDocument([req('REQ-A', next)]));
    };
    for (const [metadata, removed] of [[{ scope: 'planned' }, []], [{ assessment_id: null }, []], [{}, ['assessment_id']]] as [ObjectValue, string[]][]) {
      expect(run('apply', root, { files: [update(metadata, removed)] }).status).toBe('saved');
      const saved = run('read', root).usable_items.find((i: any) => i.id === 'REQ-A').metadata;
      expect(saved[field]).toEqual(relations); expect(saved.scope).toBe('planned'); expect(get(root, assessmentPath)).toEqual(oldAssessment);
    }
    expect(parseProduct(get(root).toString(), 'r.md').items[0]!.metadata.assessment_id).toBeUndefined();
    const changedActive = { ...active, reason: '只修当前 active 关系说明，不重新激活任何关系' };
    expect(run('apply', root, { files: [update({ [field]: [dismissed, changedActive] })] }).status).toBe('saved');
    const before = get(root), newActivation = { ...active, id: 'REL-RETRY' };
    expect(run('apply', root, { files: [update({ [field]: [dismissed, changedActive, newActivation] })] }).files[0].error).toContain('DISMISSED_RELATION');
    expect(get(root)).toEqual(before);
    const decision = { kind: 'text', text: '当前用户明确要求新增这项关联，保留原否定历史。', label: '当前决定' };
    expect(run('apply', root, { files: [update({ [field]: [dismissed, changedActive, { ...newActivation, reason: decision.text, sources: [source, decision] }] })] }).status).toBe('saved');
  }
  const dismissed = { id: 'L-OLD', relation: 'references', target: 'PROJECT-A', origin: 'inferred', state: 'dismissed', reason: '原否定', sources: [source] };
  const active = { ...dismissed, id: 'L-OTHER', target: 'REQ-OTHER', state: 'active' };
  const root = fixture([req('REQ-A', { links: [dismissed, active] }), req('REQ-OTHER')]), before = get(root);
  expect(run('apply', root, { files: [fileOp(root, [{ id: 'REQ-A', metadata: { links: [dismissed, { ...active, target: 'PROJECT-A' }] } }])] }).files[0].error).toContain('DISMISSED_RELATION');
  expect(get(root)).toEqual(before);
});

test('D01 append supplies Markdown boundaries while preserving original body bytes and malformed neighbors', () => {
  for (const eol of ['\n', '\r\n']) for (const ending of ['', eol, eol + ' \t']) for (const malformed of [false, true]) {
    const item = req('REQ-KEEP', malformed ? { unknown: true } : {});
    const html = item.body + '<table>\n<tr><td>旧范围及排除项保留。</td></tr>\n</table>';
    const original = newDocument([{ ...item, body: html }]).replace(/\n+$/, '').replace(/\n/g, eol) + ending;
    const root = fixture([item]); put(root, 'docs/product/REQUIREMENTS.md', original);
    const old = parseProduct(original, 'r.md').items[0]!;
    expect(old.usable).toBe(!malformed);
    const appended = req('REQ-NEW'); appended.body += '<div>新需求说明。</div>';
    const result = run('apply', root, { files: [{ path: 'docs/product/REQUIREMENTS.md', expected_sha256: sha256(get(root)), append: [appended, req('REQ-NEXT')] }] });
    expect(result.status).toBe('saved'); expect(result.files[0].preimage.data_base64).toBe(Buffer.from(original).toString('base64'));
    const text = get(root).toString(), parsed = parseProduct(text, 'r.md'), kept = parsed.items.find(i => i.id === old.id)!;
    expect(kept.body.slice(0, old.body.length)).toBe(old.body);
    expect(kept.body.slice(old.body.length)).toMatch(/^(?:\r\n|\n|\r)*$/);
    expect(text.slice(kept.metadata_start, kept.metadata_end)).toBe(original.slice(old.metadata_start, old.metadata_end));
    expect(kept.usable).toBe(!malformed);
    expect(parsed.items.find(i => i.id === 'REQ-NEW')!.usable).toBe(true); expect(parsed.items.find(i => i.id === 'REQ-NEXT')!.usable).toBe(true);
    if (!malformed) expect(requirementDigest(kept)).toBe(requirementDigest(old));
    const saved = get(root);
    expect(run('apply', root, { files: [{ path: 'docs/product/REQUIREMENTS.md', expected_sha256: sha256(saved), append: [{ ...req('REQ-ESCAPE'), body: body('REQ-ESCAPE', 'requirement') + '\n## 越界约束\n必须留在需求内。\n' }] }] }).files[0].error).toContain('BODY_BOUNDARY');
    expect(get(root)).toEqual(saved);
  }
  // The same separator policy applies to replacement bodies before a neighbor.
  const root = fixture([req(), req('REQ-KEEP', { unknown: true })]), before = get(root).toString();
  const old = parseProduct(before, 'r.md').items[1]!;
  expect(run('apply', root, { files: [fileOp(root, [{ id: 'REQ-A', body: body('REQ-A', 'requirement') + '<div>更新的业务说明。</div>' }])] }).status).toBe('saved');
  const next = parseProduct(get(root).toString(), 'r.md');
  expect(next.items[1]!.body).toBe(old.body); expect(next.items[0]!.usable).toBe(true);
  const blankLine = body('REQ-A', 'requirement') + '<div>原说明。</div>\n \t\n';
  put(root, 'docs/product/REQUIREMENTS.md', newDocument([{ ...req(), body: blankLine }]).replace(/\n+$/, '\n').replace(/\n/g, '\r\n'));
  const prior = parseProduct(get(root).toString(), 'r.md').items[0]!;
  expect(prior.usable).toBe(true);
  const blankResult = run('apply', root, { files: [{ path: 'docs/product/REQUIREMENTS.md', expected_sha256: sha256(get(root)), append: [req('REQ-BLANK')] }] });
  expect(blankResult.files[0].error).toBeUndefined(); expect(blankResult.status).toBe('saved');
  expect(parseProduct(get(root).toString(), 'r.md').items[0]!.body).toBe(prior.body);
});

test('D02 duplicate active history permits unrelated edits without exempting actual reactivation', () => {
  const source = { kind: 'text', text: '原材料', label: '原来源' };
  for (const field of ['links', 'task_bindings']) for (const whole of [false, true]) {
    const identity = field === 'links' ? { relation: 'references', target: 'PROJECT-A' }
      : { task: { task_id: 'existing-task', source }, role: 'repair', coverage: '原范围' };
    const dismissed = { id: 'REL-OLD', ...identity, origin: 'inferred', state: 'dismissed', reason: '旧决定保留', sources: [source] };
    const active = { ...dismissed, id: 'REL-CURRENT', origin: 'declared', state: 'active', reason: '已存在的当前关联' };
    const root = fixture([req('REQ-A', { [field]: [dismissed, active, { ...active }] })]);
    const update = (metadata: ObjectValue) => whole ? wholeOp(root, newDocument([req('REQ-A', { ...parseProduct(get(root).toString(), 'r.md').items[0]!.metadata, ...metadata })])) : fileOp(root, [{ id: 'REQ-A', metadata }]);
    const original = parseProduct(get(root).toString(), 'r.md').items[0]!;
    expect(original.usable).toBe(true);
    expect(run('apply', root, { files: [update({ scope: 'planned' })] }).status).toBe('saved');
    expect(parseProduct(get(root).toString(), 'r.md').items[0]!.metadata[field]).toEqual(original.metadata[field]);
    expect(run('read', root).diagnostics.some((d: any) => d.code === (field === 'links' ? 'DUPLICATE_LINK_ID' : 'DUPLICATE_BINDING_ID'))).toBe(true);
    const edited = { ...active, reason: '仅修已有 active 说明' }, relations = [dismissed, edited, { ...active }];
    expect(run('apply', root, { files: [update({ [field]: relations })] }).status).toBe('saved');
    const before = get(root);
    for (const additions of [[{ ...active, id: 'REL-RETRY' }], [{ ...active }]]) {
      expect(run('apply', root, { files: [update({ [field]: [...additions, ...relations] })] }).files[0].error).toContain('DISMISSED_RELATION');
      expect(get(root)).toEqual(before);
    }
    const decision = { kind: 'text', text: '当前用户明确改变原决定并要求重新关联。', label: '当前决定' };
    const renewed = { ...active, reason: decision.text, sources: [source, decision] };
    expect(run('apply', root, { files: [update({ [field]: [renewed, ...relations] })] }).status).toBe('saved');
    expect(parseProduct(get(root).toString(), 'r.md').items[0]!.metadata[field]).toEqual([renewed, ...relations]);
    const mixed = [dismissed, { ...active, id: dismissed.id }];
    put(root, 'docs/product/REQUIREMENTS.md', newDocument([req('REQ-A', { [field]: mixed })]));
    const mixedBefore = get(root);
    expect(run('apply', root, { files: [update({ [field]: mixed.map(r => ({ ...r, state: 'active' })) })] }).files[0].error).toContain('DISMISSED_RELATION');
    expect(get(root)).toEqual(mixedBefore);
    expect(run('apply', root, { files: [update({ [field]: [mixed[1]] })] }).files[0].error).toContain('DISMISSED_REMOVAL');
    expect(get(root)).toEqual(mixedBefore);
  }
});

test('C03 append preserves malformed neighbors in block and flow YAML including comments and original bytes', () => {
  const bad = req('REQ-KEEP', { unknown: true });
  const map = '{ "id" : "REQ-KEEP", "type" : "requirement", "scope" : "current", "unknown" : true }';
  const flow = (tail: string) => `---\nschema: vnext-product-doc/v2\nitems: [ ${map}${tail}] # sequence comment stays\n---\n# 业务资料\n\n${bad.body}`;
  const block = newDocument([bad]);
  const originals = [block.replace(/\n\n$/, '\n'), block,
    block.replace(/^  - /m, '- ').replace(/^    /gm, '  '),
    block.replace(/^    /gm, '        ').replace(/^  - /m, '      - '),
    '\uFEFF' + newDocument([bad]).replace(/\n\n$/, '\n').replace(/\n/g, '\r\n'),
    flow(' '), flow(' # comma only in comment,\n  '), flow(', # real trailing comma,\n  ')];
  for (const original of originals) {
    const root = fixture([bad]); put(root, 'docs/product/REQUIREMENTS.md', original);
    const old = parseProduct(original, 'r.md').items[0]!;
    const operation = { path: 'docs/product/REQUIREMENTS.md', expected_sha256: sha256(get(root)), append: [req('REQ-NEW'), req('REQ-NEXT')] };
    const appended = run('apply', root, { files: [operation] });
    expect(appended.status).toBe('saved'); expect(appended.files[0].preimage.data_base64).toBe(Buffer.from(original).toString('base64'));
    const nextText = get(root).toString(), next = parseProduct(nextText, 'r.md').items.find(i => i.id === 'REQ-KEEP')!;
    expect(next.body.slice(0, old.body.length)).toBe(old.body); expect(next.body.slice(old.body.length)).toMatch(/^(?:\r\n|\n|\r)*$/);
    expect(nextText.slice(next.metadata_start, next.metadata_end)).toBe(original.slice(old.metadata_start, old.metadata_end));
    const read = run('read', root); expect(read.usable_items.map((i: any) => i.id)).toContain('REQ-NEW'); expect(read.usable_items.map((i: any) => i.id)).toContain('REQ-NEXT'); expect(read.unusable_items.map((i: any) => i.id)).toEqual(['REQ-KEEP']);
    const saved = get(root);
    expect(run('apply', root, { files: [{ ...operation, expected_sha256: sha256(saved), append: [req('REQ-ESCAPE')].map(i => ({ ...i, body: i.body + '\n## 越界约束\n用户限制必须留在条目内。\n' })) }] }).files[0].error).toContain('BODY_BOUNDARY');
    expect(get(root)).toEqual(saved);
  }
  const root = fixture([req(), bad]); put(root, 'docs/product/REQUIREMENTS.md', get(root).toString().replace(/\n\n$/, '\n'));
  const before = get(root), children = ['REQ-CHILD-A', 'REQ-CHILD-B'].map(id => req(id, { links: [{ id: `FROM-${id}`, relation: 'derived_from', target: 'REQ-A', origin: 'declared', state: 'active' }] }));
  const result = run('apply', root, { files: [{ ...fileOp(root, [{ id: 'REQ-A', metadata: { scope: 'retired', links: children.map(i => ({ id: `TO-${i.metadata.id}`, relation: 'replaces', target: i.metadata.id, origin: 'declared', state: 'active' })) } }]), append: children }] });
  expect(result.status).toBe('saved'); expect(result.files[0].preimage.data_base64).toBe(before.toString('base64'));
  const read = run('read', root); expect(read.usable_items.find((i: any) => i.id === 'REQ-A').metadata.scope).toBe('retired'); expect(read.usable_items.map((i: any) => i.id)).toContain('REQ-CHILD-A'); expect(read.usable_items.map((i: any) => i.id)).toContain('REQ-CHILD-B');
  const empty = fixture(); put(empty, 'docs/product/EMPTY.md', '---\nschema: vnext-product-doc/v2\nitems: [] # empty list comment\n---\n# 当前资料\n');
  expect(run('apply', empty, { files: [{ path: 'docs/product/EMPTY.md', expected_sha256: sha256(get(empty, 'docs/product/EMPTY.md')), append: [req('REQ-FIRST')] }] }).status).toBe('saved');
});

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
