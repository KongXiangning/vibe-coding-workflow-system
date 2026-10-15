import { afterEach, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { stringify } from 'yaml';
import { run } from '../runtime/vnext/src/product-maintenance/cli';
import { documentSchema, validate } from '../runtime/vnext/src/product-maintenance/schemas';
import { newDocument } from '../runtime/vnext/src/product-maintenance/writer';
import { definitionAlgorithm, parseProduct, requirementDigest, sha256 } from '../runtime/vnext/src/product-maintenance/parser';
import { sectionsByType } from '../runtime/vnext/src/product-maintenance/model';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
const relative = 'docs/product/REQUIREMENTS.md';
const source = { kind: 'text', label: '合成来源', text: '需求验收明确包含有效输入解析，已采用任务范围只实现这一义务；非真实业务验收。' };
const item = (id: string, type = 'requirement', extra: any = {}) => ({ metadata: { id, type, ...(['requirement', 'goal'].includes(type) ? { scope: 'current' } : {}), ...extra }, body: `## [${id}] ${id}\n${sectionsByType[type]!.map(section => `### ${section}\n已声明的具体义务及范围。`).join('\n')}\n` });
const binding = (extra: any = {}) => ({ id: 'B-A', task: { task_id: 'actual-task-a', source, plan_ref: 'adopted-plan-a', step_id: 'S1' }, role: 'implementation', coverage: '有效输入的解析义务；不包含错误反馈', origin: 'declared', state: 'active', contribution: 'direct', reason: '已采用范围直接实现这项子义务', sources: [source], ...extra });
const put = (root: string, relative: string, text: string) => { fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true }); fs.writeFileSync(path.join(root, relative), text); };
const get = (root: string, file = relative) => fs.readFileSync(path.join(root, file), 'utf8');
const op = (root: string, rest: any, file = relative) => ({ path: file, expected_sha256: sha256(get(root, file)), ...rest });
function fixture(bindings: any[] = [], version: 2 | 3 | 4 | 5 = 5): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'binding-v5-')); roots.push(root);
  put(root, '.workflow-system/PRODUCT.yaml', stringify({ schema: 'vnext-product-manifest/v2', project_id: 'binding-test', entry: 'docs/product/PROJECT.md', managed_paths: ['docs/product/*.md'], source_paths: ['docs/evidence/**', 'docs/product/history/**'], capture_paths: ['docs/product/history/**'], exclude_paths: [], maintenance: 'enabled' }));
  put(root, 'docs/product/PROJECT.md', newDocument([item('PROJECT', 'project', { inventory: { state: 'partial', checked_sources: [source], unreviewed_sources: [] }, root_goal_id: 'GOAL', requirement_order: ['REQ-A', 'REQ-B'] }), item('GOAL', 'goal')], '混合格式目标', 3));
  put(root, relative, newDocument([item('REQ-A', 'requirement', { task_bindings: bindings }), item('REQ-B')], '范围', version));
  return root;
}
const invoke = (root: string, action: string, input: any = {}, bundled = false): any => bundled
  ? JSON.parse(execFileSync('node', ['runtime/vnext/dist/product-maintenance.js', action, '--root', root], { input: JSON.stringify(input), encoding: 'utf8' }))
  : run(action, root, input);
const applyBindings = (root: string, rows: any[], extra: any = {}) => run('apply', root, { files: [op(root, { updates: [{ id: 'REQ-A', metadata: { task_bindings: rows } }], ...extra })] });

// Digest constants are the generated assets from fixed upstream dcf7b0a, not a
// second schema implementation that could silently expand the old versions.
test('v1-v4 schema assets remain byte-identical; v5 alone accepts contribution', () => {
  const hashes = ['1d341ee1782e9b4c7c24eaf1b2af344a73445e5ac1356d488ff0915307d5cf4b', 'a628cc443f5bdc1495e8d8ae3e9c5c40e7e31eab2278e6bd1442fa31d58e40ce', 'c08c9ffa781c2ffce8bf8889567aa8eff155b433376fd149454f8df5b15d405b', 'eca5e89455715bf25601c25d7599b75b743830ba1530d7e5a3027e283f582472'];
  for (const version of [1, 2, 3, 4] as const) {
    expect(sha256(`${JSON.stringify(documentSchema(version), null, 2)}\n`)).toBe(hashes[version - 1]);
    const asset = fs.readFileSync(`runtime/vnext/support/product-maintenance/schemas/product-doc-v${version}.json`);
    expect(sha256(asset)).toBe(hashes[version - 1]);
    expect(validate({ schema: `vnext-product-doc/v${version}`, items: [item('REQ-A', 'requirement', { task_bindings: [binding()] }).metadata] }, documentSchema(version)).length).toBeGreaterThan(0);
  }
  for (const contribution of ['direct', 'supporting', undefined]) {
    const row: any = binding({ contribution }); if (contribution === undefined) delete row.contribution;
    expect(validate({ schema: 'vnext-product-doc/v5', items: [item('GOAL', 'goal', { task_bindings: [row] }).metadata] }, documentSchema(5))).toEqual([]);
  }
  for (const contribution of [null, 'undetermined', 'unrelated', '', 1]) expect(parseProduct(newDocument([item('REQ-A', 'requirement', { task_bindings: [binding({ contribution })] })], '非法字段', 5), relative).items[0]!.usable).toBe(false);
  expect(parseProduct(newDocument([item('REQ-A')], '', 5).replace('doc/v5', 'doc/v7'), relative).diagnostics[0]!.code).toBe('UNSUPPORTED_VERSION');
});

test('v3/v4/v5 definitions use identical algorithms and exclude binding classifications', () => {
  for (const type of ['goal', 'requirement']) {
    const digests = [3, 4, 5].map(version => {
      const i = parseProduct(newDocument([item('ID', type)], '', version as 3 | 4 | 5), relative).items[0]!;
      expect(definitionAlgorithm(i)).toBe('vnext-product-definition/v1'); return requirementDigest(i);
    });
    expect(new Set(digests).size).toBe(1);
    for (const contribution of ['direct', 'supporting']) {
      const i = parseProduct(newDocument([item('ID', type, { task_bindings: [binding({ contribution })] })], '', 5), relative).items[0]!;
      expect(requirementDigest(i)).toBe(digests[0]);
    }
  }
});

test.each([false, true])('v5 writes retain per-owner contribution and actual plan_tasks provenance (bundle=%s)', bundled => {
  const root = fixture();
  const work = { id: 'W1', title: '解析', outcome: '有效输入被解析', scope: '局部', targets: [{ target: 'REQ-A', coverage: '解析' }], state: 'included', origin: 'initial' };
  put(root, 'docs/product/ROADMAP.md', newDocument([item('PLAN', 'plan', { intent_state: 'adopted', targets: [{ target: 'REQ-A', coverage: '解析' }], work_items: [work] })], '安排', 4));
  const a = binding({ plan_items: [{ plan_id: 'PLAN', work_item_id: 'W1' }] });
  const b = binding({ id: 'B-SUPPORT', contribution: 'supporting', coverage: '有效输入解析为批处理提供基础；未实现重试', reason: '批处理复用解析能力，但重试义务尚未由此任务履行' });
  expect(invoke(root, 'apply', { files: [op(root, { updates: [{ id: 'REQ-A', metadata: { task_bindings: [a] } }, { id: 'REQ-B', metadata: { task_bindings: [b] } }] })] }, bundled).status).toBe('saved');
  const read = invoke(root, 'read', { detail: 'items' }, bundled);
  expect(read.usable_items.find((i: any) => i.id === 'REQ-A').metadata.task_bindings[0].contribution).toBe('direct');
  expect(read.usable_items.find((i: any) => i.id === 'REQ-B').metadata.task_bindings[0].contribution).toBe('supporting');
  expect(read.plan_tasks[0].work_items[0].bindings[0]).toMatchObject({ owner: 'REQ-A', binding_id: 'B-A', contribution: 'direct', role: 'implementation', coverage: a.coverage, sources: [source], locator: { kind: 'file', path: relative, item_id: 'REQ-A' } });
  expect(read.development_gate).toBe(false); expect(fs.existsSync(path.join(root, '.workflow-system/records'))).toBe(false);
});

test('v5 local migration preserves unknown neighbors and body; reclassification retains same ID/history and is idempotent', () => {
  const old: any = binding(); delete old.contribution; delete old.reason; delete old.sources;
  const root = fixture([old, { ...old, id: 'B-UNKNOWN', task: { task_id: null, source }, coverage: '旧资料不完整' }], 4);
  const before = get(root), original = parseProduct(before, relative).items[0]!;
  const rows = [binding({ contribution: 'supporting', reason: '复核实际范围仅为支撑，不履行当前完整义务' }), { ...old, id: 'B-UNKNOWN', task: { task_id: null, source }, coverage: '旧资料不完整' }];
  const saved = applyBindings(root, rows, { migrate: 'v5', preimage_path: 'docs/product/history/before-v5.md' });
  expect(saved.status).toBe('saved'); expect(get(root, 'docs/product/history/before-v5.md')).toBe(before);
  const after = parseProduct(get(root), relative); expect(after.version).toBe(5); expect(after.items[0]!.body).toBe(original.body);
  expect(after.items[0]!.metadata.task_bindings[0].id).toBe('B-A'); expect(after.items[0]!.metadata.task_bindings[1].contribution).toBeUndefined();
  expect(requirementDigest(after.items[0]!)).toBe(requirementDigest(original));
  const stable = get(root); expect(applyBindings(root, rows).files[0].status).toBe('unchanged'); expect(get(root)).toBe(stable);
  expect(fs.readdirSync(path.join(root, 'docs/product/history'))).toEqual(['before-v5.md']);
  expect(run('apply', root, { files: [op(root, { content: newDocument([item('REQ-A'), item('REQ-B')], '', 4), migrate: 'v4' })] }).files[0].error).toContain('VERSION_DOWNGRADE');
});

test('new/reclassified v5 bindings need concrete basis, while unchanged old ambiguity stays usable', () => {
  const root = fixture(); const original = get(root);
  for (const extra of [{ contribution: undefined }, { reason: '' }, { sources: [] }, { coverage: '' }, { role: 'reference' }]) {
    const result = applyBindings(root, [binding(extra)]); expect(result.status).toBe('failed'); expect(get(root)).toBe(original);
  }
  const legacy: any = binding({ role: 'reference', contribution: 'direct' }); delete legacy.reason; delete legacy.sources;
  put(root, relative, newDocument([item('REQ-A', 'requirement', { task_bindings: [legacy] }), item('REQ-B')], '', 5));
  const read = run('read', root); expect(read.usable_items.find((i: any) => i.id === 'REQ-A')).toBeDefined();
  expect(read.diagnostics.some((d: any) => d.code === 'BINDING_ROLE_CONTRIBUTION')).toBe(true);
  expect(run('apply', root, { files: [op(root, { updates: [{ id: 'REQ-B', body: item('REQ-B').body.replace('具体义务', '更新后的具体义务') }] })] }).status).toBe('saved');
  expect(applyBindings(root, [{ ...legacy, contribution: 'supporting' }]).files[0].error).toContain('BINDING_BASIS_REQUIRED');
});

test('conflicting equivalent classifications stay separate and diagnosed, never a latest/direct winner', () => {
  const root = fixture([binding(), binding({ id: 'B-DUP', contribution: 'supporting', coverage: '  有效输入的解析义务；不包含错误反馈  ', task: { ...binding().task, plan_ref: 'later-plan' } })]);
  const read = run('read', root);
  expect(read.diagnostics.some((d: any) => d.code === 'DUPLICATE_BINDING_CANDIDATE')).toBe(true);
  expect(read.diagnostics.some((d: any) => d.code === 'BINDING_CONTRIBUTION_CONFLICT')).toBe(true);
  expect(read.usable_items.find((i: any) => i.id === 'REQ-A').metadata.task_bindings).toHaveLength(2);
});

test.each([false, true])('v5 retained duplicate IDs allow display edits without requiring classification (bundle=%s)', bundled => {
  const unknown: any = binding({ task: { task_id: null, source, label: '旧解析任务' } });
  delete unknown.contribution; delete unknown.reason; delete unknown.sources;
  const second = { ...unknown, coverage: '记录操作时间；历史任务范围待核对' };
  const root = fixture([unknown, second]);
  const before = get(root);
  const rows = [second, { ...unknown, task: { ...unknown.task, label: 'CSV 解析任务' } }];
  const result = invoke(root, 'apply', { files: [op(root, { updates: [{ id: 'REQ-A', metadata: { task_bindings: rows } }] })] }, bundled);
  expect(result.status).toBe('saved');
  const after = parseProduct(get(root), relative);
  expect(after.items[0]!.metadata.task_bindings).toEqual(rows);
  expect(after.items[0]!.body).toBe(parseProduct(before, relative).items[0]!.body);
  expect(invoke(root, 'read', {}, bundled).diagnostics.some((d: any) => d.code === 'DUPLICATE_BINDING_ID')).toBe(true);
  expect(invoke(root, 'apply', { files: [op(root, { updates: [{ id: 'REQ-A', metadata: { task_bindings: rows } }] })] }, bundled).files[0].status).toBe('unchanged');
});

test.each([false, true])('v5 retained bindings cannot exempt additional rows or reclassifications (bundle=%s)', bundled => {
  const unknown: any = binding(); delete unknown.contribution; delete unknown.reason; delete unknown.sources;
  const classified: any = binding({ contribution: 'supporting' }); delete classified.reason; delete classified.sources;
  const reference = binding({ role: 'reference' });
  const cases = [
    { old: [unknown], rows: [unknown, { ...unknown, task: { ...unknown.task, label: '新增副本' } }], error: 'BINDING_CONTRIBUTION_REQUIRED' },
    { old: [unknown], rows: [{ ...unknown, task: { ...unknown.task, label: '新增副本' } }, unknown], error: 'BINDING_CONTRIBUTION_REQUIRED' },
    { old: [classified], rows: [classified, { ...classified, task: { ...classified.task, label: '新增副本' } }], error: 'BINDING_BASIS_REQUIRED' },
    { old: [reference], rows: [reference, { ...reference, task: { ...reference.task, label: '新增副本' } }], error: 'BINDING_ROLE_CONTRIBUTION' },
    // Reserve the unchanged row even when the edited row precedes it.
    { old: [unknown, classified], rows: [{ ...unknown, contribution: 'supporting' }, classified], error: 'BINDING_BASIS_REQUIRED' },
  ];
  for (const scenario of cases) {
    const root = fixture(scenario.old), before = get(root);
    const request = { files: [op(root, { updates: [{ id: 'REQ-A', metadata: { task_bindings: scenario.rows } }] })] };
    const processResult = bundled ? spawnSync('node', ['runtime/vnext/dist/product-maintenance.js', 'apply', '--root', root], { input: JSON.stringify(request), encoding: 'utf8' }) : null;
    if (processResult) { expect(processResult.error).toBeUndefined(); expect(processResult.status).toBe(1); }
    const result = processResult ? JSON.parse(processResult.stdout) : run('apply', root, request);
    expect(result.status).toBe('failed'); expect(result.files[0].error).toContain(scenario.error);
    expect(get(root)).toBe(before);
  }
});

test.each([false, true])('v5 same-identity legacy rows retain their own classification after display edits and reorder (bundle=%s)', bundled => {
  const direct: any = binding(); delete direct.reason; delete direct.sources;
  const supporting = { ...direct, contribution: 'supporting' };
  const root = fixture([direct, supporting]);
  const rows = [supporting, direct].map(row => ({ ...row, task: { ...row.task, label: `CSV 解析任务：${row.contribution}` } }));
  expect(invoke(root, 'apply', { files: [op(root, { updates: [{ id: 'REQ-A', metadata: { task_bindings: rows } }] })] }, bundled).status).toBe('saved');
  const read = invoke(root, 'read', {}, bundled);
  expect(read.usable_items.find((i: any) => i.id === 'REQ-A').metadata.task_bindings).toEqual(rows);
  expect(read.diagnostics.some((d: any) => d.code === 'BINDING_CONTRIBUTION_CONFLICT')).toBe(true);
});

test('unknown Task source identity ignores display labels, byte hashes and map key order for conflict diagnostics', () => {
  for (const [first, second] of [
    [{ kind: 'file', path: 'docs/evidence/task.md', item_id: 'T', section: '范围', lines: { start: 1, end: 3 }, sha256: '0'.repeat(64), note: '旧' }, { note: '新', sha256: '1'.repeat(64), lines: { end: 3, start: 1 }, section: '范围', item_id: 'T', path: 'docs/evidence/task.md', kind: 'file' }],
    [{ kind: 'text', text: '  旧任务\r\n范围  ', label: '原标签' }, { label: '新标签', text: '旧任务\n范围', kind: 'text' }],
    [{ kind: 'uri', uri: 'https://example.com/task/1', note: '原显示' }, { note: '新显示', uri: 'https://example.com/task/1', kind: 'uri' }],
  ]) {
    const root = fixture([binding({ task: { task_id: null, source: first } }), binding({ id: 'B-DUP', contribution: 'supporting', task: { task_id: null, source: second } })]);
    expect(run('read', root).diagnostics.some((d: any) => d.code === 'BINDING_CONTRIBUTION_CONFLICT')).toBe(true);
  }
});

test('dismissed v5 relationships need new basis to revive; partial saves retain successful changes and Task bytes', () => {
  const row = binding({ state: 'dismissed', reason: '历史依据证明关联不成立' }); const root = fixture([row]);
  put(root, '.workflow-system/records/events/old-task.json', '{"fact":"failed execution; closed"}\n');
  const task = get(root, '.workflow-system/records/events/old-task.json');
  expect(applyBindings(root, [{ ...row, state: 'active', reason: '只有改写理由' }]).files[0].error).toContain('DISMISSED_RELATION');
  const revived = { ...row, state: 'active', reason: '新增来源证明当前确切义务对应', sources: [...row.sources, { kind: 'text', label: '新增真实材料', text: '新复核明确证明该Task包含此项验收，不是重复原依据。' }] };
  const result = run('apply', root, { files: [op(root, { updates: [{ id: 'REQ-A', metadata: { task_bindings: [revived] } }] }), { path: 'docs/product/OTHER.md', expected_sha256: '0'.repeat(64), content: newDocument([item('OTHER')], '', 5) }] });
  expect(result.status).toBe('partial'); expect(result.files.map((f: any) => f.saved)).toEqual([true, false]);
  expect(parseProduct(get(root), relative).items[0]!.metadata.task_bindings[0].state).toBe('active');
  expect(get(root, '.workflow-system/records/events/old-task.json')).toBe(task); expect(result.development_gate).toBe(false);
});

test.each([false, true])('v5 Roadmap inherits v4 baseline and mixed v3/v5 definitions without format drift (bundle=%s)', bundled => {
  const root = fixture(); const roadmap = 'docs/product/ROADMAP.md';
  const plan = item('PLAN', 'plan', { intent_state: 'adopted', targets: [{ target: 'REQ-A', coverage: '解析' }], work_items: [] });
  expect(invoke(root, 'apply', { files: [{ path: roadmap, expected_sha256: null, content: newDocument([plan], '安排', 5) }] }, bundled).status).toBe('saved');
  const query = { plan_id: 'PLAN', selector: { kind: 'explicit-requirements', requirement_ids: ['REQ-A'] } };
  const proposal = invoke(root, 'read', { roadmap_query: query }, bundled).roadmap_reconciliation.snapshot_proposal;
  const baseline = { ...proposal, checked_at: '2026-10-14T00:00:00Z', working_copy: fs.realpathSync(root), sources: [source], unread_sources: [], exceptions: [] };
  expect(invoke(root, 'apply', { files: [op(root, { updates: [{ id: 'PLAN', metadata: { planning_baseline: baseline } }] }, roadmap)] }, bundled).files[0].baseline_readback).toEqual([{ plan_id: 'PLAN', status: 'matched' }]);
  expect(applyBindings(root, [binding()]).status).toBe('saved');
  const read = invoke(root, 'read', { roadmap_query: { plan_id: 'PLAN' } }, bundled); expect(read.roadmap_reconciliation.status).toBe('current');
  expect(read.roadmap_reconciliation.reasons).not.toContain('format-without-baseline');
  const before = get(root); const offline = JSON.parse(execFileSync('node', ['runtime/vnext/support/product-maintenance/offline-reader.js', root, 'PLAN'], { encoding: 'utf8' }));
  expect(offline.supported_formats).toContain('vnext-product-doc/v5'); expect(offline.roadmap_reconciliation.status).toBe('current'); expect(get(root)).toBe(before);
  // File bytes and obligation definitions are independent checks. A legacy
  // exact-file baseline must honestly become unavailable after classification.
  const exact = { ...baseline, sources: [{ kind: 'file', path: relative, sha256: sha256(before) }] };
  expect(invoke(root, 'apply', { files: [op(root, { updates: [{ id: 'PLAN', metadata: { planning_baseline: exact } }] }, roadmap)] }, bundled).status).toBe('saved');
  expect(applyBindings(root, [binding({ contribution: 'supporting', reason: '新复核确认仅支撑该义务' })]).status).toBe('saved');
  const drift = invoke(root, 'read', { roadmap_query: { plan_id: 'PLAN' } }, bundled).roadmap_reconciliation;
  expect(drift.status).toBe('unknown'); expect(drift.reasons).toContain('baseline-source-unavailable');
  expect(drift.changes.some((change: any) => change.kind === 'definition-changed')).toBe(false);

});


test('distributed C0 synthetic fixture is readable without losing direct/supporting/unknown distinctions', () => {
  const root = path.resolve('runtime/vnext/support/product-maintenance/examples/binding-contribution');
  const read = run('read', root, { detail: 'items' });
  expect(read.coverage.complete).toBe(true); expect(read.unusable_items).toEqual([]);
  const rows = read.usable_items.flatMap((i: any) => i.metadata.task_bindings ?? []);
  expect(rows.map((b: any) => b.contribution)).toContain('direct');
  expect(rows.map((b: any) => b.contribution)).toContain('supporting');
  expect(rows.some((b: any) => b.contribution === undefined && b.task.task_id === null)).toBe(true);
  expect(read.task_operations).toBe('not-performed');
});
