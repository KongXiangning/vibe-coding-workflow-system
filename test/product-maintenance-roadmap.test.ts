import { afterEach, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { stringify } from 'yaml';
import { run } from '../runtime/vnext/src/product-maintenance/cli';
import { newDocument } from '../runtime/vnext/src/product-maintenance/writer';
import { parseProduct, sha256 } from '../runtime/vnext/src/product-maintenance/parser';
import { documentSchema, validate } from '../runtime/vnext/src/product-maintenance/schemas';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
const definitionsPath = 'docs/product/PROJECT.md', roadmapPath = 'docs/product/IMPLEMENTATION_ROADMAP.md';
const source = { kind: 'text', label: '合成核对依据', text: '测试中的已核对决定，不是实际产品采用或验收。' };
const body = (id: string, type = 'requirement') => `## [${id}] ${id}\n` + (type === 'plan'
  ? '### 实施策略\n分阶段实施。\n### 阶段与工作项说明\n按已声明覆盖。\n### 调整与未决事项\n未知交付。\n'
  : type === 'project' ? '### 项目定位\n合成项目。\n### 盘点范围与未核对项\n仅测试范围。\n'
  : type === 'goal' ? '### 目标说明\n合成目标。\n### 范围边界\n声明范围。\n'
  : '### 需求内容\n完整当前定义。\n### 范围边界\n按当前定义。\n### 验收要求\n按实际对象核对。\n');
const req = (id: string, links: any[] = []) => ({ metadata: { id, type: 'requirement', scope: 'current', links }, body: body(id) });
const work = (id: string, target: string) => ({ id, title: id, outcome: '局部结果', scope: '部分范围', targets: [{ target, coverage: '部分范围' }], state: 'included', origin: 'initial' });
const put = (root: string, relative: string, content: string) => { fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true }); fs.writeFileSync(path.join(root, relative), content); };
const get = (root: string, relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');
function fixture(count = 24): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-v4-')); roots.push(root);
  put(root, '.workflow-system/PRODUCT.yaml', stringify({ schema: 'vnext-product-manifest/v2', project_id: 'roadmap-test', entry: definitionsPath,
    managed_paths: ['docs/product/*.md'], source_paths: [], exclude_paths: [], maintenance: 'enabled' }));
  put(root, definitionsPath, newDocument([{ metadata: { id: 'PROJECT', type: 'project', inventory: { state: 'partial', checked_sources: [source], unreviewed_sources: [] } }, body: body('PROJECT', 'project') },
    ...Array.from({ length: count }, (_, i) => req(`R${i + 1}`))], '合成定义', 3));
  return root;
}
function invoke(root: string, action: string, input: any, bundled = false): any {
  if (!bundled) return run(action, root, input);
  const out = spawnSync('node', ['runtime/vnext/dist/product-maintenance.js', action, '--root', root], { input: JSON.stringify(input), encoding: 'utf8' });
  expect(out.error).toBeUndefined();
  return JSON.parse(out.stdout);
}
const read = (root: string, selector?: any) => run('read', root, { roadmap_query: { plan_id: 'PLAN', ...(selector ? { selector } : {}) } }).roadmap_reconciliation;
function initialize(root: string, selector: any = { kind: 'project-current' }, bundled = false): any {
  const ids = selector.requirement_ids ?? Array.from({ length: 24 }, (_, i) => `R${i + 1}`);
  const metadata = { id: 'PLAN', type: 'plan', intent_state: 'adopted', targets: ids.map((target: string) => ({ target, coverage: '部分范围' })), work_items: ids.map((id: string) => work(`W-${id}`, id)) };
  const content = newDocument([{ metadata, body: body('PLAN', 'plan') }], '项目实施路线图', 4);
  expect(invoke(root, 'apply', { files: [{ path: roadmapPath, expected_sha256: null, content }] }, bundled).status).toBe('saved');
  const proposal = read(root, selector).snapshot_proposal;
  const baseline = { ...proposal, checked_at: '2026-10-14T00:00:00Z', working_copy: fs.realpathSync(root), sources: [source], unread_sources: [], exceptions: [] };
  expect(save(root, { planning_baseline: baseline }, bundled).status).toBe('saved');
  return baseline;
}
function save(root: string, metadata: any, bundled = false): any {
  return invoke(root, 'apply', { files: [{ path: roadmapPath, expected_sha256: sha256(get(root, roadmapPath)), updates: [{ id: 'PLAN', metadata }] }] }, bundled);
}
function edit(root: string, files: any[]): any { return run('apply', root, { files }); }
const op = (root: string, relative: string, rest: any) => ({ path: relative, expected_sha256: sha256(get(root, relative)), ...rest });

test.each([false, true])('first full and local Roadmaps reuse 24 requirement IDs without future Tasks (bundle=%s)', bundled => {
  for (const selector of [{ kind: 'project-current' }, { kind: 'explicit-requirements', requirement_ids: ['R1','R2','R3','R4','R5','R6'] }]) {
    const root = fixture();
    expect(read(root).status).toBe('unknown');
    const baseline = initialize(root, selector, bundled), before = get(root, roadmapPath);
    expect(read(root).status).toBe('current');
    expect(baseline.member_ids).toHaveLength(selector.kind === 'project-current' ? 24 : 6);
    expect(read(root).scope.outside_scope).toHaveLength(selector.kind === 'project-current' ? 0 : 18);
    for (let i = 0; i < 2; i++) invoke(root, 'check', { roadmap_query: { plan_id: 'PLAN' } }, bundled);
    expect(get(root, roadmapPath)).toBe(before);
    expect(fs.existsSync(path.join(root, '.workflow-system/records'))).toBe(false);
    expect(run('read', root).usable_items.filter((i: any) => i.type === 'requirement')).toHaveLength(24);
  }
});

test('manual changes, unreferenced new members, retired members and roadmap order remain visible', () => {
  const root = fixture(); initialize(root);
  put(root, definitionsPath, get(root, definitionsPath).replace('完整当前定义。', '用户手工修改，无 Change。'));
  expect(read(root).changes.some((c: any) => c.kind === 'definition-changed' && c.id === 'R1')).toBe(true);
  expect(read(root).status).toBe('changes-pending');
  expect(read(root).change_sources).toHaveLength(0);
  expect(edit(root, [op(root, definitionsPath, { append: [req('R25')], updates: [{ id: 'R2', metadata: { scope: 'retired' } }] })]).status).toBe('saved');
  const out = read(root);
  expect(out.changes).toContainEqual({ kind: 'member-added', id: 'R25' });
  expect(out.changes).toContainEqual({ kind: 'member-exited', id: 'R2' });
  expect(out.unarranged_requirements).toContain('R25');
  const plan = parseProduct(get(root, roadmapPath), roadmapPath).items[0]!;
  expect(save(root, { work_items: [...plan.metadata.work_items].reverse() }).status).toBe('saved');
  expect(read(root).changes.some((c: any) => c.kind === 'arrangement-changed')).toBe(true);
});

test('local selector ignores unrelated additions; partial enumeration and partial review stay unknown', () => {
  const root = fixture(); const baseline = initialize(root, { kind: 'explicit-requirements', requirement_ids: ['R1','R2'] });
  expect(edit(root, [op(root, definitionsPath, { append: [req('R25')] })]).status).toBe('saved');
  expect(read(root).status).toBe('current');
  expect(save(root, { planning_baseline: { ...baseline, definitions: baseline.definitions.slice(0, 1) } }).status).toBe('saved');
  expect(read(root).status).toBe('unknown');
  expect(read(root).reasons).toContain('definition-unreviewed:R2');
  const other = fixture(); initialize(other);
  const limited = run('read', other, { paths: [roadmapPath], roadmap_query: { plan_id: 'PLAN' } }).roadmap_reconciliation;
  expect(limited.status).toBe('unknown'); expect(limited.reasons).toContain('enumeration-incomplete');
});

test('exact reviewed version supports no-adjustment and deferral without hiding a later change', () => {
  const root = fixture(), baseline = initialize(root);
  const d = baseline.definitions.find((d: any) => d.id === 'R20');
  const exceptions = [{ target: 'R20', algorithm: d.algorithm, sha256: d.sha256, disposition: 'deferred', reason: '已选择延期，保留风险', sources: [source], work_item_ids: ['W-R20'] }];
  expect(save(root, { planning_baseline: { ...baseline, exceptions } }).status).toBe('saved');
  expect(read(root).status).toBe('reviewed-deferred');
  expect(read(root).exceptions).toHaveLength(1);
  expect(edit(root, [op(root, definitionsPath, { updates: [{ id: 'R20', body: body('R20').replace('完整当前定义。', '版本变化。') }] })]).status).toBe('saved');
  expect(read(root).status).toBe('changes-pending'); expect(read(root).exceptions).toHaveLength(0);
  const next = { ...baseline, ...read(root).snapshot_proposal, exceptions: [] };
  const updated = next.definitions.find((d: any) => d.id === 'R20');
  next.exceptions = [{ ...exceptions[0], disposition: 'no-adjustment', sha256: updated.sha256 }];
  expect(save(root, { planning_baseline: next }).status).toBe('saved');
  expect(read(root).status).toBe('current');
});

test('stale baseline writes fail locally while successful requirements persist and ordinary plan writes remain available', () => {
  const root = fixture(), baseline = initialize(root), roadmapBefore = get(root, roadmapPath);
  // Capture a genuinely advanced version, then change it again before saving.
  // Keeping the original baseline byte-for-byte is now legitimate partial retention.
  expect(edit(root, [op(root, definitionsPath, { updates: [{ id: 'R1', body: body('R1').replace('完整当前定义。', '已核对的中间版本。') }] })]).status).toBe('saved');
  const advanced = { ...baseline, ...read(root).snapshot_proposal };
  const changed = body('R1').replace('完整当前定义。', '并发新定义。');
  const out = edit(root, [op(root, definitionsPath, { updates: [{ id: 'R1', body: changed }] }), op(root, roadmapPath, {
    updates: [{ id: 'PLAN', metadata: { planning_baseline: { ...advanced, checked_at: '2026-10-14T01:00:00Z' } } }],
  })]);
  expect(out.status).toBe('partial'); expect(out.files[0].saved).toBe(true);
  expect(out.files[1].error).toContain('PLANNING_BASELINE_CONFLICT');
  expect(get(root, roadmapPath)).toBe(roadmapBefore);
  expect(get(root, definitionsPath)).toContain('并发新定义。');
  expect(save(root, { intent_state: 'proposed' }).status).toBe('saved');
  const stale = op(root, roadmapPath, { updates: [{ id: 'PLAN', metadata: { intent_state: 'retired' } }] });
  put(root, roadmapPath, get(root, roadmapPath) + '\n用户修改。\n');
  expect(edit(root, [stale]).files[0].error).toContain('WRITE_CONFLICT');
});

test('old v3 Plan stays unknown and migrates only its selected file to v4', () => {
  const root = fixture(); const baseline = initialize(root);
  const parsed = parseProduct(get(root, roadmapPath), roadmapPath), item = parsed.items[0]!;
  const metadata = { ...item.metadata }; delete metadata.planning_baseline;
  put(root, roadmapPath, newDocument([{ metadata, body: item.body }], '旧文件', 3));
  expect(read(root, baseline.selector).status).toBe('unknown');
  expect(save(root, { planning_baseline: baseline }).status).toBe('failed');
  const definitionsBefore = get(root, definitionsPath);
  expect(edit(root, [op(root, roadmapPath, { migrate: 'v4' })]).status).toBe('saved');
  const next = { ...baseline, ...read(root, baseline.selector).snapshot_proposal };
  expect(save(root, { planning_baseline: next }).status).toBe('saved');
  expect(read(root).status).toBe('current'); expect(get(root, definitionsPath)).toBe(definitionsBefore);
  expect(edit(root, [op(root, roadmapPath, { content: newDocument([{ metadata, body: item.body }], '降级', 3) })]).files[0].error).toContain('VERSION_DOWNGRADE');
});

test('target subgraph includes new declared descendants and excludes inferred and unassigned members', () => {
  const root = fixture();
  expect(edit(root, [op(root, definitionsPath, { append: [{ metadata: { id: 'G', type: 'goal', scope: 'current' }, body: body('G', 'goal') }],
    updates: [{ id: 'R1', metadata: { links: [{ id: 'L1', relation: 'supports', target: 'G', origin: 'declared', state: 'active' }] } }] })]).status).toBe('saved');
  const baseline = initialize(root, { kind: 'target-subgraph', target_ids: ['G'] });
  expect(baseline.member_ids).toEqual(['R1']); expect(baseline.context.map((d: any) => d.id)).toEqual(['G']);
  const link = { id: 'L25', relation: 'part_of', target: 'R1', origin: 'declared', state: 'active' };
  expect(edit(root, [op(root, definitionsPath, { append: [req('R25', [link]), req('R26', [{ ...link, id: 'L26', origin: 'inferred', reason: '候选归属', sources: [source] }]), req('R27')] })]).status).toBe('saved');
  expect(read(root).scope.member_ids).toEqual(['R1','R25']);
  expect(read(root).scope.unassigned).toContain('R27');
  expect(read(root).status).toBe('changes-pending');
});

test('incomparable algorithms, unread sources and working-copy identity do not certify alignment', () => {
  const root = fixture(), baseline = initialize(root);
  expect(save(root, { planning_baseline: { ...baseline, unread_sources: [source] } }).status).toBe('saved');
  expect(read(root).status).toBe('unknown');
  const plan = parseProduct(get(root, roadmapPath), roadmapPath).items[0]!;
  const foreign = { ...baseline, working_copy: 'other-copy', definitions: baseline.definitions.map((d: any) => ({ ...d, algorithm: 'future/v2' })) };
  put(root, roadmapPath, newDocument([{ metadata: { ...plan.metadata, planning_baseline: foreign }, body: plan.body }], '直接编辑', 4));
  expect(read(root).status).toBe('unknown');
  expect(read(root).reasons).toContain('working-copy-differs');
  expect(read(root).reasons).toContain('algorithm-incomparable:R1');
  expect(validate({ schema: 'vnext-product-doc/v4', items: [{ ...plan.metadata, planning_baseline: baseline }] }, documentSchema(4))).toHaveLength(0);
});

test('same requirement spans two stable work items without task completion inference', () => {
  const root = fixture(); initialize(root);
  const plan = parseProduct(get(root, roadmapPath), roadmapPath).items[0]!;
  const first = { ...work('W20-A', 'R20'), stage: 'before-01' };
  const second = { ...work('W20-B', 'R20'), stage: 'after-06', depends_on: [{ item_id: 'W20-A', kind: 'order', reason: '用户采用顺序' }] };
  expect(save(root, { work_items: [first, ...plan.metadata.work_items.filter((w: any) => w.id !== 'W-R20'), second] }).status).toBe('saved');
  expect(read(root).delivery).toBe('not-evaluated');
  expect(run('read', root).plan_tasks[0].work_items.find((w: any) => w.work_item_id === 'W20-B').bindings).toEqual([]);
  expect(read(root).work_items.at(-1).id).toBe('W20-B');
});

test('Goal context, source availability and project identity remain independently checkable', () => {
  const root = fixture();
  expect(edit(root, [op(root, definitionsPath, { append: [{ metadata: { id: 'G', type: 'goal', scope: 'current' }, body: body('G', 'goal') }],
    updates: [{ id: 'R1', metadata: { links: [{ id: 'LG', relation: 'supports', target: 'G', origin: 'declared', state: 'active' }] } }] })]).status).toBe('saved');
  const baseline = initialize(root, { kind: 'explicit-requirements', requirement_ids: ['R1'] });
  expect(baseline.context.map((d: any) => d.id)).toEqual(['G']);
  expect(edit(root, [op(root, definitionsPath, { updates: [{ id: 'G', body: body('G', 'goal').replace('合成目标。', '新目标约束。') }] })]).status).toBe('saved');
  expect(read(root).changes.some((c: any) => c.id === 'G' && c.kind === 'definition-changed')).toBe(true);
  const missing = { ...baseline, ...read(root).snapshot_proposal, sources: [{ kind: 'file', path: 'docs/product/MISSING.md' }] };
  expect(save(root, { planning_baseline: missing }).files[0].error).toContain('review source unavailable');
  const plan = parseProduct(get(root, roadmapPath), roadmapPath).items[0]!;
  put(root, roadmapPath, newDocument([{ metadata: { ...plan.metadata, planning_baseline: missing }, body: plan.body }], '手工来源编辑', 4));
  expect(read(root).status).toBe('unknown'); expect(read(root).reasons).toContain('baseline-source-unavailable');
  put(root, '.workflow-system/PRODUCT.yaml', get(root, '.workflow-system/PRODUCT.yaml').replace('roadmap-test', 'different-project'));
  expect(read(root).reasons).toContain('project-identity-differs');
});

test('v4 definitions retain v3 algorithm and assessment source alignment', () => {
  const root = fixture();
  const before = run('read', root).usable_items.find((i: any) => i.id === 'R1');
  expect(edit(root, [op(root, definitionsPath, { migrate: 'v4' })]).status).toBe('saved');
  const after = run('read', root).usable_items.find((i: any) => i.id === 'R1');
  expect(after.definition_sha256).toBe(before.definition_sha256);
  expect(after.definition_algorithm).toBe(before.definition_algorithm);
});

test.each([false, true])('RM4-R1 restricted explicit reads cannot certify identity uniqueness (bundle=%s)', bundled => {
  const root = fixture(); initialize(root, { kind: 'explicit-requirements', requirement_ids: ['R1','R2'] }, bundled);
  const query = { plan_id: 'PLAN' };
  // Even with no visible duplicate, identity outside the read is unknown.
  const partial = () => invoke(root, 'read', { paths: [definitionsPath, roadmapPath], roadmap_query: query }, bundled).roadmap_reconciliation;
  expect(partial().status).toBe('unknown');
  expect(partial().reasons).toContain('enumeration-incomplete');
  put(root, 'docs/product/DUPLICATE.md', newDocument([req('R1')], '重复身份', 3));
  expect(partial().status).toBe('unknown');
  expect(invoke(root, 'read', { roadmap_query: query }, bundled).roadmap_reconciliation.reasons).toContain('requirement-unavailable:R1');
  // Omitted bytes and unreadable structure can also hide a selected identity.
  put(root, 'docs/product/DUPLICATE.md', 'x'.repeat(30000));
  const bounded = invoke(root, 'read', { max_file_bytes: 20000, roadmap_query: query }, bundled).roadmap_reconciliation;
  expect(bounded.status).toBe('unknown'); expect(bounded.reasons).toContain('enumeration-incomplete');
  put(root, 'docs/product/DUPLICATE.md', '# Unparseable managed document\n');
  const malformed = invoke(root, 'read', { roadmap_query: query }, bundled).roadmap_reconciliation;
  expect(malformed.status).toBe('unknown'); expect(malformed.reasons).toContain('identity-coverage-incomplete');
  // None of these advisory limits turn into a task/development gate.
  expect(malformed.development_gate).toBe(false);
});

test.each([false, true])('RM4-R2 scoped baseline updates retain old differences without accepting forged snapshots (bundle=%s)', bundled => {
  const root = fixture(); const baseline = initialize(root, { kind: 'explicit-requirements', requirement_ids: ['R1','R2'] }, bundled);
  const oldR2 = baseline.definitions.find((d: any) => d.id === 'R2');
  expect(edit(root, [op(root, definitionsPath, { updates: ['R1','R2'].map(id => ({ id, body: body(id).replace('完整当前定义。', '已改变定义。') })) })]).status).toBe('saved');
  const proposal = read(root).snapshot_proposal;
  const partial = { ...baseline, checked_at: '2026-10-14T01:00:00Z', definitions: [proposal.definitions.find((d: any) => d.id === 'R1'), oldR2] };
  const saved = save(root, { planning_baseline: partial }, bundled);
  expect(saved.status).toBe('saved');
  expect(saved.files[0].baseline_readback).toEqual([{ plan_id: 'PLAN', status: 'matched', retained_snapshots: [{ field: 'definitions', id: 'R2' }] }]);
  const pending = invoke(root, 'read', { roadmap_query: { plan_id: 'PLAN' } }, bundled).roadmap_reconciliation;
  expect(pending.status).toBe('changes-pending');
  expect(pending.changes.filter((c: any) => c.kind === 'definition-changed').map((c: any) => c.id)).toEqual(['R2']);
  expect(pending.changes[0].before).toEqual(oldR2);
  const before = get(root, roadmapPath);
  const forged = { ...partial, definitions: partial.definitions.map((d: any) => d.id === 'R2' ? { ...d, sha256: 'a'.repeat(64) } : d) };
  expect(save(root, { planning_baseline: forged }, bundled).files[0].error).toContain('PLANNING_BASELINE_CONFLICT');
  expect(get(root, roadmapPath)).toBe(before);
  const otherScope = { ...partial, selector: { kind: 'explicit-requirements', requirement_ids: ['R2'] }, member_ids: ['R2'], definitions: [oldR2] };
  expect(save(root, { planning_baseline: otherScope }, bundled).files[0].error).toContain('PLANNING_BASELINE_CONFLICT');
  // Advanced snapshots must still match both pre-publication and readback versions.
  expect(save(root, { planning_baseline: { ...partial, definitions: proposal.definitions } }, bundled).status).toBe('saved');
  expect(invoke(root, 'read', { roadmap_query: { plan_id: 'PLAN' } }, bundled).roadmap_reconciliation.status).toBe('current');
});

test('RM4-R2 unchanged Goal context and its old deferral survive partial review', () => {
  const root = fixture();
  expect(edit(root, [op(root, definitionsPath, { append: [{ metadata: { id: 'G', type: 'goal', scope: 'current' }, body: body('G', 'goal') }],
    updates: [{ id: 'R1', metadata: { links: [{ id: 'LG', relation: 'supports', target: 'G', origin: 'declared', state: 'active' }] } }] })]).status).toBe('saved');
  const baseline = initialize(root, { kind: 'explicit-requirements', requirement_ids: ['R1','R2'] });
  const oldR2 = baseline.definitions.find((d: any) => d.id === 'R2');
  const deferred = { target: 'R2', algorithm: oldR2.algorithm, sha256: oldR2.sha256, disposition: 'deferred', reason: '原版本延期', sources: [source] };
  const previous = { ...baseline, exceptions: [deferred] };
  expect(save(root, { planning_baseline: previous }).status).toBe('saved');
  expect(edit(root, [op(root, definitionsPath, { updates: [
    { id: 'R1', body: body('R1').replace('完整当前定义。', '新版本。') },
    { id: 'R2', body: body('R2').replace('完整当前定义。', '新版本。') },
    { id: 'G', body: body('G', 'goal').replace('合成目标。', '新目标。') },
  ] })]).status).toBe('saved');
  const fresh = read(root).snapshot_proposal;
  const partial = { ...previous, definitions: [fresh.definitions.find((d: any) => d.id === 'R1'), oldR2] };
  const saved = save(root, { planning_baseline: partial });
  expect(saved.status).toBe('saved');
  expect(saved.files[0].baseline_readback[0].retained_snapshots).toEqual([{ field: 'definitions', id: 'R2' }, { field: 'context', id: 'G' }]);
  const pending = read(root);
  expect(pending.status).toBe('changes-pending');
  expect(pending.exceptions).toEqual([]); expect(pending.stale_exceptions).toEqual([deferred]);
  expect(pending.changes.map((c: any) => c.id)).toEqual(['R2','G']);
  // On first initialization, arbitrary stale values have no prior basis to retain.
  expect(run('apply', root, { files: [op(root, roadmapPath, { updates: [{ id: 'PLAN', remove_fields: ['planning_baseline'] }] })] }).status).toBe('saved');
  expect(save(root, { planning_baseline: partial }).files[0].error).toContain('PLANNING_BASELINE_CONFLICT');
});
