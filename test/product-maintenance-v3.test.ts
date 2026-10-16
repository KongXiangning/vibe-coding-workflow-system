import { afterEach, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { stringify } from 'yaml';
import { run } from '../runtime/vnext/src/product-maintenance/cli';
import { parseProduct, requirementDigest, sha256 } from '../runtime/vnext/src/product-maintenance/parser';
import { newDocument } from '../runtime/vnext/src/product-maintenance/writer';
import { documentSchema, validate } from '../runtime/vnext/src/product-maintenance/schemas';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const sample = fs.readFileSync(path.join(import.meta.dir, '../docs/product/project-maintenance/examples/scoped-contract.md'), 'utf8').replace(/\r\n/g, '\n');
const blocks = [...sample.matchAll(/```(yaml|markdown)\n([\s\S]*?)\n```/g)];
const manifest = blocks.find(b => b[1] === 'yaml')![2]!;
const documents = blocks.filter(b => b[1] === 'markdown' && b[2]!.startsWith('---\n')).map(b => b[2]! + '\n');
const projectPath = 'docs/product/PROJECT.md', reportPath = 'docs/product/ASSESSMENTS.md';
const put = (root: string, file: string, text: string) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
const get = (root: string, file: string) => fs.readFileSync(path.join(root, file), 'utf8');
function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vn03-product-')); roots.push(root);
  put(root, '.workflow-system/PRODUCT.yaml', manifest); put(root, projectPath, documents[0]!); put(root, reportPath, documents[1]!); put(root, 'docs/evidence/import.md', '合成证据');
  return root;
}
const query = (goal_id = 'G-DEMO', scope_id = 'FULL', subject = { kind: 'working-copy', value: 'sample-copy-a', revision: 'sample-baseline' }) => ({ target: 'R-IMPORT', goal_id, scope_id, subject });
const read = (root: string, selection: any = query()) => run('read', root, { detail: 'items', assessment_query: selection });
const op = (root: string, file: string, rest: any) => ({ path: file, expected_sha256: sha256(get(root, file)), ...rest });
const report = (root: string, id = 'A-DEMO') => parseProduct(get(root, reportPath), reportPath).items.find(i => i.id === id)!;
const basisPath = 'docs/evidence/definitions-before.md';
function captureDefinitionBasis(root: string, id = 'A-DEMO'): void {
  const raw = get(root, projectPath), original = report(root, id);
  put(root, basisPath, raw);
  put(root, '.workflow-system/PRODUCT.yaml', get(root, '.workflow-system/PRODUCT.yaml').replace('source_paths:', `source_paths:\n  - ${basisPath}`));
  const metadata = Object.fromEntries(['target', 'goal'].map(role => [`${role}_basis`, { ...original.metadata[`${role}_basis`], path: basisPath, sha256: sha256(raw) }]));
  expect(run('apply', root, { files: [op(root, reportPath, { updates: [{ id, metadata }] })] }).status).toBe('saved');
}
function selectWith(root: string, bundled: boolean, selection: any = query()): any {
  if (!bundled) return read(root, selection).assessment_selection;
  const response = spawnSync('node', ['runtime/vnext/dist/product-maintenance.js', 'read', '--root', root], { input: JSON.stringify({ assessment_query: selection }), encoding: 'utf8' });
  expect(response.status).toBe(0);
  return JSON.parse(response.stdout).assessment_selection;
}
function updateGoal(root: string, change: (goal: ReturnType<typeof parseProduct>['items'][number]) => void, id = 'G-DEMO'): void {
  const goal = parseProduct(get(root, projectPath), projectPath).items.find(i => i.id === id)!;
  change(goal);
  expect(run('apply', root, { files: [op(root, projectPath, { updates: [{ id, metadata: goal.metadata, body: goal.body }] })] }).status).toBe('saved');
}

function applyWith(root: string, input: any, bundled: boolean): any {
  if (!bundled) return run('apply', root, input);
  const response = spawnSync('node', ['runtime/vnext/dist/product-maintenance.js', 'apply', '--root', root], { input: JSON.stringify(input), encoding: 'utf8' });
  expect(response.error).toBeUndefined();
  const result = JSON.parse(response.stdout);
  expect(response.status).toBe(result.status === 'failed' ? 1 : 0);
  return result;
}

test.each([false, true])('VN03 P2 report isolation rejects appended definitions and preserves existing malformed reports (bundle=%s)', bundled => {
  const root = fixture();
  const definitions = parseProduct(get(root, projectPath), projectPath);
  const before = get(root, reportPath), projectBefore = get(root, projectPath);
  for (const [sourceId, id] of [['R-NEW', 'R-ADDED'], ['G-DEMO', 'G-ADDED']]) {
    const source = definitions.items.find(i => i.id === sourceId)!;
    const saved = applyWith(root, { files: [op(root, reportPath, { append: [{
      metadata: { ...source.metadata, id }, body: source.body.replaceAll(sourceId!, id!),
    }] })] }, bundled);
    expect(saved.status).toBe('failed');
    expect(saved.files[0].saved).toBe(false);
    expect(saved.files[0].error).toContain('STRUCTURE_INVALID');
    expect(get(root, reportPath)).toBe(before);
    expect(get(root, projectPath)).toBe(projectBefore);
    expect(read(root).assessment_selection.assessment_id).toBe('A-DEMO');
    expect(read(root).unusable_items).toHaveLength(0);
  }

  // A pre-existing incomplete neighbor must not become a new write prerequisite.
  const old = report(root);
  const incomplete = { ...old.metadata }; delete incomplete.goal_definition_sha256;
  const other = report(root, 'A-LIVE');
  put(root, reportPath, newDocument([{ metadata: incomplete, body: old.body }, { metadata: other.metadata, body: other.body }], 'Existing incomplete report', 3));
  const malformedBefore = get(root, reportPath), oldItem = report(root);
  expect(oldItem.usable).toBe(false);
  const saved = applyWith(root, { files: [op(root, reportPath, { updates: [{ id: 'A-LIVE', metadata: { conclusion: 'undetermined' } }] })] }, bundled);
  expect(saved.status).toBe('saved');
  const malformedAfter = get(root, reportPath), retained = report(root);
  expect(retained.usable).toBe(false);
  expect(retained.body).toBe(oldItem.body);
  expect(malformedAfter.slice(retained.metadata_start, retained.metadata_end)).toBe(malformedBefore.slice(oldItem.metadata_start, oldItem.metadata_end));
});

test.each([false, true])('VN03 P2 appended project honors explicit order including empty order (bundle=%s)', bundled => {
  for (const order of [['R-SECOND', 'R-FIRST'], [], undefined]) {
    const root = fixture();
    put(root, projectPath, newDocument([], 'Empty project', 3));
    put(root, reportPath, newDocument([], 'Empty reports', 3));
    const project = {
      metadata: { id: 'PROJECT', type: 'project', inventory: { state: 'partial', checked_sources: [], unreviewed_sources: [] }, ...(order === undefined ? {} : { requirement_order: order }) },
      body: '## [PROJECT] Project\n### 项目定位\nSynthetic.\n### 盘点范围与未核对项\nSynthetic.\n',
    };
    const ids = ['R-FIRST', 'R-SECOND', 'R-UNORDERED'];
    const requirements = ids.map(id => ({ metadata: { id, type: 'requirement', scope: 'current' }, body: `## [${id}] Requirement\n### 需求内容\nExample.\n### 范围边界\nExample.\n### 验收要求\nExample.\n` }));
    const saved = applyWith(root, { files: [op(root, projectPath, { append: [project, ...requirements] })] }, bundled);
    expect(saved.status).toBe('saved');
    const view = read(root).product_view;
    expect(view.requirement_order).toEqual(order ?? ids);
    expect(view.unordered_requirements).toEqual(order === undefined ? [] : ids.filter(id => !order.includes(id)).sort());
    if (order !== undefined) expect(saved.requirement_order_update).toEqual({ status: 'unchanged', saved: true });
  }
});

test('VN03 authoritative sample parses and selects separate scopes, subjects and the overall goal', () => {
  const root = fixture(), out = read(root);
  expect(out.usable_items).toHaveLength(14);
  expect(out.unusable_items).toHaveLength(0);
  expect(out.product_view.root_goal).toEqual({ status: 'resolved', id: 'G-ALL' });
  expect(out.product_view.requirement_order).toEqual(['R-PIPELINE', 'R-IMPORT', 'R-OLD', 'R-DELTA', 'R-NEW']);
  expect(out.product_view.unordered_requirements).toEqual(['R-UNORDERED']);
  expect(out.assessment_selection.conclusion).toBe('satisfied');
  expect(read(root, query('G-LIVE', 'RECOVERABLE')).assessment_selection.conclusion).toBe('partially-satisfied');
  expect(read(root, query('G-DEMO', 'FULL', { kind: 'release', value: 'sample-release-0' } as any)).assessment_selection.conclusion).toBe('not-satisfied');
  expect(read(root, { target: 'G-ALL', goal_id: 'G-ALL', scope_id: 'OVERALL', subject: query().subject }).assessment_selection.conclusion).toBe('undetermined');
  for (const a of parseProduct(documents[1]!, reportPath).items) {
    const def = parseProduct(documents[0]!, projectPath);
    expect(requirementDigest(def.items.find(i => i.id === a.metadata.target)!)).toBe(a.metadata.target_definition_sha256);
    expect(requirementDigest(def.items.find(i => i.id === a.metadata.applicability.goal_id)!)).toBe(a.metadata.goal_definition_sha256);
  }
  const before = get(root, projectPath);
  read(root); expect(get(root, projectPath)).toBe(before); expect(fs.existsSync(path.join(root, '.workflow-system/records'))).toBe(false);
});

test('VN03 writes and rereads v3 files; appends order by batch while explicit order is preserved', () => {
  const root = fixture(); fs.unlinkSync(path.join(root, projectPath)); fs.unlinkSync(path.join(root, reportPath));
  const saved = run('apply', root, { files: [{ path: projectPath, expected_sha256: null, content: documents[0] }, { path: reportPath, expected_sha256: null, content: documents[1] }] });
  expect(saved.status).toBe('saved'); expect(read(root).product_view.unordered_requirements).toEqual(['R-UNORDERED']);
  const source = parseProduct(get(root, projectPath), projectPath).items.find(i => i.id === 'R-NEW')!;
  const appended = ['R-X', 'R-Y'].map(id => ({ metadata: { id, type: 'requirement', scope: 'current', links: [{ id: id+'-dep', relation: 'depends_on', target: 'R-IMPORT', origin: 'declared', state: 'active' }] }, body: source.body.replaceAll('R-NEW', id) }));
  expect(run('apply', root, { files: [op(root, projectPath, { append: appended })] }).status).toBe('saved');
  expect(read(root).product_view.requirement_order.slice(-2)).toEqual(['R-X', 'R-Y']);
  const before = read(root).product_view.requirement_order;
  expect(run('apply', root, { files: [op(root, projectPath, { updates: [{ id: 'R-X', metadata: { task_bindings: [{ id: 'B-X', task: { task_id: 'actual-id', source: { kind: 'text', label: '本次关联', text: '合成身份与范围' } }, role: 'repair', coverage: '局部', origin: 'declared', state: 'active' }] } }] })] }).status).toBe('saved');
  expect(read(root).product_view.requirement_order).toEqual(before);
  expect(run('apply', root, { files: [op(root, projectPath, { updates: [{ id: 'PROJECT', metadata: { requirement_order: [...before].reverse() } }] })] }).status).toBe('saved');
  expect(read(root).product_view.requirement_order).toEqual([...before].reverse());
});

test('VN03 mixed-format batches register v2 and v3 requirements in a v3 project without migration', () => {
  for (const bundled of [false, true]) {
    const root = fixture(), mixedPath = 'docs/product/MIXED_V2.md';
    put(root, '.workflow-system/PRODUCT.yaml', manifest.replace('  - docs/product/ASSESSMENTS.md', '  - docs/product/ASSESSMENTS.md\n  - '+mixedPath));
    const invoke = (input: any) => {
      if (!bundled) return run('apply', root, input);
      const response = spawnSync('node', ['runtime/vnext/dist/product-maintenance.js', 'apply', '--root', root], { input: JSON.stringify(input), encoding: 'utf8' });
      expect(response.status).toBe(0);
      return JSON.parse(response.stdout);
    };
    const before = read(root).product_view.requirement_order;
    const source = parseProduct(get(root, projectPath), projectPath).items.find(i => i.id === 'R-NEW')!;
    const saved = invoke({ files: [
      { path: mixedPath, expected_sha256: null, content: documents[4] },
      op(root, projectPath, { append: [{ metadata: { id: 'R-V3-NEW', type: 'requirement', scope: 'current' }, body: source.body.replaceAll('R-NEW', 'R-V3-NEW') }] }),
    ] });
    expect(saved.status).toBe('saved'); expect(saved.requirement_order_update.saved).toBe(true);
    const ordered = [...before, 'R-V2-NEW', 'R-V2-NEXT', 'R-V3-NEW'];
    expect(read(root).product_view.requirement_order).toEqual(ordered);
    expect(read(root).product_view.unordered_requirements).toEqual(['R-UNORDERED']);
    expect(get(root, mixedPath)).toBe(documents[4]!);
    expect(parseProduct(get(root, mixedPath), mixedPath).version).toBe(2);
    expect(invoke({ files: [op(root, mixedPath, { content: documents[4] })] }).status).toBe('saved');
    expect(read(root).product_view.requirement_order).toEqual(ordered);
    expect(invoke({ files: [
      op(root, mixedPath, { append: [{ metadata: { id: 'R-V2-EXPLICIT', type: 'requirement', scope: 'current' }, body: source.body.replaceAll('R-NEW', 'R-V2-EXPLICIT') }] }),
      op(root, projectPath, { updates: [{ id: 'PROJECT', metadata: { requirement_order: ordered } }] }),
    ] }).status).toBe('saved');
    expect(read(root).product_view.requirement_order).toEqual(ordered);
    expect(read(root).product_view.unordered_requirements).toEqual(['R-UNORDERED', 'R-V2-EXPLICIT']);
  }
});

test('VN03 v2-only writes keep legacy save behavior; v3 additions still report a missing v3 project', () => {
  const root = fixture(), mixedPath = 'docs/product/MIXED_V2.md';
  const project = parseProduct(documents[0]!, projectPath).items.find(i => i.type === 'project')!;
  const metadata = { ...project.metadata }; delete metadata.root_goal_id; delete metadata.requirement_order;
  put(root, projectPath, newDocument([{ metadata, body: project.body }]));
  put(root, '.workflow-system/PRODUCT.yaml', manifest.replace('  - docs/product/ASSESSMENTS.md', '  - docs/product/ASSESSMENTS.md\n  - '+mixedPath));
  const before = get(root, projectPath);
  const saved = run('apply', root, { files: [{ path: mixedPath, expected_sha256: null, content: documents[4] }] });
  expect(saved.status).toBe('saved'); expect(saved.requirement_order_update).toEqual({ status: 'unchanged', saved: true });
  expect(get(root, projectPath)).toBe(before);
  const source = parseProduct(documents[4]!, mixedPath).items[0]!;
  const pending = run('apply', root, { files: [op(root, reportPath, { content: newDocument([{ metadata: { id: 'R-V3-PENDING', type: 'requirement', scope: 'current' }, body: source.body.replaceAll('R-V2-NEW', 'R-V3-PENDING') }], '新增需求', 3), remove_items: ['A-DEMO', 'A-LIVE', 'A-RELEASE', 'A-ALL'] })] });
  expect(pending.status).toBe('partial'); expect(pending.files[0].saved).toBe(true);
  expect(pending.requirement_order_update.status).toBe('pending');
  expect(pending.requirement_order_update.requirement_ids).toEqual(['R-V3-PENDING']);
  expect(get(root, projectPath)).toBe(before);
});

test('VN03 same-location incomplete reports remain pending; valid correction supersedes old bad edges', () => {
  const root = fixture(), old = report(root);
  const missing = { ...old.metadata, id: 'A-NEW', conclusion: 'not-satisfied' }; delete missing.goal_definition_sha256;
  // Simulate an incomplete existing file; new writes themselves must be valid.
  put(root, reportPath, newDocument([{ metadata: old.metadata, body: old.body }, { metadata: missing, body: old.body.replaceAll('A-DEMO', 'A-NEW') }], '历史缺项', 3));
  expect(read(root).assessment_selection.reasons).toContain('metadata-incomplete');
  expect(read(root).assessment_selection.reasons).toContain('multiple-reports');
  put(root, reportPath, documents[1]!);
  const bad = { ...old.metadata, id: 'A-BAD', supersedes: ['A-DEMO', 'A-LIVE'] };
  const fix = { ...old.metadata, id: 'A-FIX', supersedes: ['A-DEMO', 'A-BAD'] };
  expect(run('apply', root, { files: [op(root, reportPath, { append: [bad, fix].map(metadata => ({ metadata, body: old.body.replaceAll('A-DEMO', metadata.id) })) })] }).status).toBe('saved');
  expect(read(root).assessment_selection.assessment_id).toBe('A-FIX');
  expect(read(root, query('G-LIVE', 'RECOVERABLE')).assessment_selection.assessment_id).toBe('A-LIVE');
  expect(read(root).assessment_selection.historical_reports).toEqual(['A-DEMO', 'A-BAD']);
});

test('VN03 explicit replacement is scoped; multiple reports, invalid cross-scope replacement and cycles degrade only selected view', () => {
  const root = fixture(), old = report(root), live = report(root, 'A-LIVE');
  expect(run('apply', root, { files: [op(root, reportPath, { updates: [{ id: 'A-LIVE', metadata: { supersedes: ['A-DEMO'] } }] })] }).status).toBe('saved');
  expect(read(root, query('G-LIVE', 'RECOVERABLE')).assessment_selection.reasons).toContain('conflict');
  expect(read(root).assessment_selection.assessment_id).toBe('A-DEMO');
  put(root, reportPath, documents[1]!);
  const other = { ...old.metadata, id: 'A-SECOND', supersedes: ['A-DEMO'] };
  expect(run('apply', root, { files: [op(root, reportPath, { updates: [{ id: 'A-DEMO', metadata: { supersedes: ['A-SECOND'] } }], append: [{ metadata: other, body: old.body.replaceAll('A-DEMO', 'A-SECOND') }] })] }).status).toBe('saved');
  expect(read(root).assessment_selection.reasons).toContain('conflict');
  expect(read(root, query('G-LIVE', 'RECOVERABLE')).assessment_selection.conclusion).toBe(live.metadata.conclusion);
});

test('VN03 goal-only changes preserve requirements and old achievements, without blocking save or Tasks', () => {
  const root = fixture(), original = read(root), goal = parseProduct(get(root, projectPath), projectPath).items.find(i => i.id === 'G-DEMO')!;
  expect(run('apply', root, { files: [op(root, projectPath, { updates: [{ id: goal.id, body: goal.body + '\n### 本次目标澄清\n保留旧成果，新增恢复要求。\n' }] })] }).status).toBe('saved');
  const result = read(root);
  expect(result.assessment_selection.reasons).toContain('goal-definition-changed');
  expect(result.usable_items.find((i: any) => i.id === 'R-IMPORT').definition_sha256).toBe(original.usable_items.find((i: any) => i.id === 'R-IMPORT').definition_sha256);
  expect(result.assessment_selection.reports[0].conclusion).toBe('satisfied'); expect(result.development_gate).toBe(false);
  expect(fs.existsSync(path.join(root, '.workflow-system/records'))).toBe(false);
});

test('VN03 mixed v3 report and v2/v1 requirement retains original digest algorithm', () => {
  const root = fixture();
  put(root, 'docs/product/LEGACY.md', documents[2]!);
  put(root, '.workflow-system/PRODUCT.yaml', manifest.replace('  - docs/product/ASSESSMENTS.md', '  - docs/product/ASSESSMENTS.md\n  - docs/product/LEGACY.md\n  - docs/product/SCOPED_LEGACY_REPORT.md').replace('source_paths:', 'source_paths:\n  - docs/product/LEGACY.md'));
  const goal = parseProduct(get(root, projectPath), projectPath).items.find(i => i.id === 'G-DEMO')!;
  expect(run('apply', root, { files: [op(root, projectPath, { updates: [{ id: goal.id, metadata: { assessment_scopes: [...goal.metadata.assessment_scopes, { target: 'R-LEGACY', scope_id: 'LEGACY', coverage: '历史导入要求' }] } }] }), { path: 'docs/product/SCOPED_LEGACY_REPORT.md', expected_sha256: null, content: documents[3] }] }).status).toBe('saved');
  const selection = { ...query(), target: 'R-LEGACY', scope_id: 'LEGACY' };
  expect(read(root, selection).assessment_selection.conclusion).toBe('satisfied');
  put(root, 'docs/product/LEGACY.md', documents[2]!.replace('product-doc/v2', 'product-doc/v1'));
  expect(read(root, selection).assessment_selection.conclusion).toBe('satisfied');
  const upgrade = run('apply', root, { files: [op(root, 'docs/product/LEGACY.md', { migrate: 'v3' })] });
  // Untouched legacy report metadata remains exact and degrades as incomplete;
  // migrating the definition does not fabricate an upgraded report.
  expect(upgrade.files[0].saved).toBe(true);
  expect(parseProduct(get(root, 'docs/product/LEGACY.md'), 'legacy.md').items.find(i => i.id === 'A-LEGACY')!.usable).toBe(false);
  expect(read(root, selection).assessment_selection.reasons).toContain('definition-algorithm-changed');
});

test('VN03 write checks structural v3 constraints and stale bytes, but not semantic completion', () => {
  const root = fixture(), old = report(root);
  const wrong = { ...old.metadata, goal_basis: { ...old.metadata.goal_basis, item_id: 'G-LIVE' } };
  const rejected = run('apply', root, { files: [op(root, reportPath, { updates: [{ id: old.id, metadata: wrong }] })] });
  expect(rejected.status).toBe('failed');
  const conflict = op(root, reportPath, { updates: [{ id: old.id, metadata: { conclusion: 'undetermined' } }] });
  put(root, reportPath, get(root, reportPath) + '\n');
  expect(run('apply', root, { files: [conflict] }).files[0].error).toContain('WRITE_CONFLICT');
  expect(run('apply', root, { files: [op(root, projectPath, { append: [{ metadata: { ...old.metadata, id: 'A-INLINE' }, body: old.body.replaceAll('A-DEMO', 'A-INLINE') }] })] }).status).toBe('failed');
  const schema = documentSchema(3);
  expect(validate({ schema: 'vnext-product-doc/v3', items: [{ ...old.metadata, conclusion: 'satisfied', sources: [] }] }, schema).length).toBeGreaterThan(0);
});

test('VN03 declaration choice, scope changes and goal digest conservation follow the shared sample', () => {
  const root = fixture(), goal = parseProduct(get(root, projectPath), projectPath).items.find(i => i.id === 'G-DEMO')!;
  const added = { target: 'R-NEW', scope_id: 'BATCH-CHECK', coverage: '批量输入的追加检查' };
  expect(run('apply', root, { files: [op(root, projectPath, { updates: [{ id: goal.id, metadata: { assessment_scopes: [...goal.metadata.assessment_scopes, added] } }] })] }).status).toBe('saved');
  expect(read(root).assessment_selection.reasons).toContain('goal-definition-changed');
  const second = { target: 'R-IMPORT', scope_id: 'RECOVERY', coverage: '入库及恢复' };
  expect(run('apply', root, { files: [op(root, projectPath, { updates: [{ id: goal.id, metadata: { assessment_scopes: [...goal.metadata.assessment_scopes, second] } }] })] }).status).toBe('saved');
  const noScope: any = query(); delete noScope.scope_id;
  expect(read(root, noScope).assessment_selection.reasons).toEqual(['scope-selection-required']);
  expect(read(root, query('G-DEMO', 'RECOVERY')).assessment_selection.reasons).toEqual(['no-applicable-report']);
  expect(run('apply', root, { files: [op(root, projectPath, { updates: [{ id: goal.id, metadata: { assessment_scopes: [second] } }] })] }).status).toBe('saved');
  expect(read(root).assessment_selection.reasons).toEqual(['scope-not-current']);
  expect(run('apply', root, { files: [op(root, projectPath, { updates: [{ id: goal.id, metadata: { assessment_scopes: [{ ...goal.metadata.assessment_scopes[0], coverage: '入库及恢复' }] } }] })] }).status).toBe('saved');
  expect(read(root).assessment_selection.reasons).toContain('scope-definition-changed');
});

test.each([false, true])('VN03 shared definition file edits preserve unaffected reports without refreshing evidence (bundle=%s)', bundled => {
  for (const change of ['binding', 'neighbor', 'order', 'line-endings']) {
    const root = fixture(), originalFile = get(root, projectPath);
    const originalReports = parseProduct(get(root, reportPath), reportPath).items;
    expect(run('apply', root, { files: [op(root, reportPath, { updates: originalReports.map(item => ({ id: item.id, metadata: {
      target_basis: { ...item.metadata.target_basis, sha256: sha256(originalFile) },
      goal_basis: { ...item.metadata.goal_basis, sha256: sha256(originalFile) },
    } })) })] }).status).toBe('saved');
    const savedReports = get(root, reportPath), basis = report(root).metadata.target_basis;
    if (change === 'binding') updateGoal(root, item => { item.metadata.task_bindings = [{
      id: 'B-REPAIR', task: { task_id: 'actual-repair-task', source: { kind: 'text', label: 'Task association', text: 'Local repair only' } },
      role: 'repair', coverage: 'Existing import obligation', origin: 'declared', state: 'active',
    }]; }, 'R-IMPORT');
    if (change === 'neighbor') updateGoal(root, item => { item.body += '\nAdditional unrelated acceptance.\n'; }, 'R-NEW');
    if (change === 'order') updateGoal(root, item => { item.metadata.requirement_order.reverse(); }, 'PROJECT');
    if (change === 'line-endings') put(root, projectPath, originalFile.replace(/\n/g, '\r\n'));

    for (const [selection, conclusion, id] of [
      [query(), 'satisfied', 'A-DEMO'],
      [query('G-LIVE', 'RECOVERABLE'), 'partially-satisfied', 'A-LIVE'],
      [query('G-DEMO', 'FULL', { kind: 'release', value: 'sample-release-0' } as any), 'not-satisfied', 'A-RELEASE'],
      [{ ...query('G-ALL', 'OVERALL'), target: 'G-ALL' }, 'undetermined', 'A-ALL'],
    ] as const) expect(selectWith(root, bundled, selection)).toMatchObject({ conclusion, assessment_id: id, reasons: [] });
    const source = run('read', root, { source: basis, max_bytes: 1 });
    expect(source).toMatchObject({ status: 'available', byte_status: 'changed', content_is_referenced_bytes: false,
      definition_sha256: report(root).metadata.target_definition_sha256 });
    expect(source.diagnostics.some((d: any) => d.code === 'SOURCE_CHANGED')).toBe(true);
    const resolved = run('read', root, { item_ids: ['A-DEMO'], resolve_sources: true });
    const checks = resolved.sources.flatMap((s: any) => s.basis_checks ?? []).filter((b: any) => b.assessment_id === 'A-DEMO');
    expect(checks).toHaveLength(2);
    expect(checks.every((b: any) => b.definition_alignment === 'same-definition')).toBe(true);
    expect(get(root, reportPath)).toBe(savedReports);
    expect(fs.existsSync(path.join(root, '.workflow-system/records'))).toBe(false);

    // A real change to this requirement still affects only its existing report coverage.
    updateGoal(root, item => { item.body += '\nNew import acceptance obligation.\n'; }, 'R-IMPORT');
    const changed = selectWith(root, bundled);
    expect(changed.conclusion).toBe('undetermined');
    expect(changed.reasons).toContain('definition-changed');
    expect(changed.reports[0].conclusion).toBe('satisfied');
    expect(get(root, reportPath)).toBe(savedReports);
  }
});

test.each([false, true])('VN03 verified other-scope changes preserve the selected requirement report (bundle=%s)', bundled => {
  const root = fixture(); captureDefinitionBasis(root);
  const savedReport = get(root, reportPath);
  const originalDigest = report(root).metadata.goal_definition_sha256;
  const changes = [
    (goal: any) => goal.metadata.assessment_scopes.push({ target: 'R-NEW', scope_id: 'EXTRA', coverage: 'Independent batch' }),
    (goal: any) => { goal.metadata.assessment_scopes.find((s: any) => s.scope_id === 'EXTRA').coverage = 'Changed independent batch'; },
    (goal: any) => { goal.metadata.assessment_scopes = goal.metadata.assessment_scopes.filter((s: any) => s.target !== 'R-NEW'); },
    (goal: any) => goal.metadata.assessment_scopes.push({ target: 'R-IMPORT', scope_id: 'OTHER', coverage: 'Another explicit scope for this requirement' }),
  ];
  for (const change of changes) {
    updateGoal(root, change);
    expect(read(root).usable_items.find((i: any) => i.id === 'G-DEMO').definition_sha256).not.toBe(originalDigest);
    expect(selectWith(root, bundled)).toMatchObject({ conclusion: 'satisfied', assessment_id: 'A-DEMO', reasons: [] });
    expect(get(root, reportPath)).toBe(savedReport);
  }
  const ambiguous: any = query(); delete ambiguous.scope_id;
  expect(selectWith(root, bundled, ambiguous).reasons).toEqual(['scope-selection-required']);
});

test.each([false, true])('VN03 unrelated captured file edits retain verified goal scope comparison (bundle=%s)', bundled => {
  const root = fixture(); captureDefinitionBasis(root);
  const savedReports = get(root, reportPath), basis = report(root).metadata.goal_basis;
  updateGoal(root, goal => { goal.metadata.assessment_scopes.push({ target: 'R-NEW', scope_id: 'EXTRA', coverage: 'Independent batch' }); });
  put(root, basisPath, get(root, basisPath) + '\n<!-- unrelated file annotation -->\n');
  expect(selectWith(root, bundled)).toMatchObject({ conclusion: 'satisfied', assessment_id: 'A-DEMO', reasons: [] });
  expect(run('read', root, { source: basis, max_bytes: 1 })).toMatchObject({ byte_status: 'changed',
    definition_sha256: report(root).metadata.goal_definition_sha256, content_is_referenced_bytes: false });
  // Changing the captured goal itself loses the original comparison, even though the current scope is unchanged.
  const original = parseProduct(get(root, basisPath), basisPath);
  original.items.find(i => i.id === 'G-DEMO')!.body += '\nDifferent historical goal.\n';
  put(root, basisPath, newDocument(original.items, 'Changed captured goal', 3));
  expect(selectWith(root, bundled).reasons).toContain('goal-definition-changed');
  expect(selectWith(root, bundled).reasons).toContain('goal-definition-unverified');
  expect(get(root, reportPath)).toBe(savedReports);
});

test.each(['body', 'relation', 'goal-kind', 'goal-scope', 'coverage', 'scope-removed', 'requirement', 'overall', 'pending'])(
  'VN03 other-scope exemption retains %s changes and gaps', condition => {
    const root = fixture(), overall = condition === 'overall';
    captureDefinitionBasis(root, overall ? 'A-ALL' : 'A-DEMO');
    const selection = overall ? { ...query('G-ALL', 'OVERALL'), target: 'G-ALL' } : query();
    updateGoal(root, goal => {
      goal.metadata.assessment_scopes.push({ target: 'R-NEW', scope_id: 'EXTRA', coverage: 'Independent batch' });
      if (condition === 'body') goal.body += '\n### 新要求\n改变共同目标。\n';
      if (condition === 'relation') goal.metadata.links = [];
      if (condition === 'goal-kind') goal.metadata.goal_kind = 'outcome';
      if (condition === 'goal-scope') goal.metadata.scope = 'planned';
      if (condition === 'coverage') goal.metadata.assessment_scopes[0].coverage = 'Changed selected coverage';
      if (condition === 'scope-removed') goal.metadata.assessment_scopes.shift();
    }, overall ? 'G-ALL' : 'G-DEMO');
    if (condition === 'requirement') updateGoal(root, item => { item.body += '\nAdditional acceptance obligation.\n'; }, 'R-IMPORT');
    if (condition === 'pending') expect(run('apply', root, { files: [op(root, reportPath, { updates: [{ id: 'A-DEMO', metadata: { pending_sources: [{ kind: 'file', path: 'docs/evidence/import.md' }] } }] })] }).status).toBe('saved');
    const specificReasons: Record<string, string> = { pending: 'pending-evidence', requirement: 'definition-changed', 'scope-removed': 'scope-unavailable' };
    const reason = specificReasons[condition] ?? 'goal-definition-changed';
    for (const bundled of [false, true]) {
      const result = selectWith(root, bundled, selection);
      expect(result.conclusion).toBe('undetermined');
      expect(result.reasons).toContain(reason);
      if (condition !== 'scope-removed') expect(result.reports[0].conclusion).toBe(overall ? 'undetermined' : 'satisfied');
    }
  },
);

test.each(['v4', 'v5'])('VN03 scoped comparison survives compatible %s definition migration', version => {
  const root = fixture(); captureDefinitionBasis(root);
  expect(run('apply', root, { files: [op(root, projectPath, { migrate: version })] }).status).toBe('saved');
  updateGoal(root, goal => { goal.metadata.assessment_scopes.push({ target: 'R-NEW', scope_id: 'EXTRA', coverage: 'Independent batch' }); });
  for (const bundled of [false, true]) expect(selectWith(root, bundled)).toMatchObject({ conclusion: 'satisfied', reasons: [] });
});

test.each(['missing', 'digest-missing', 'wrong-definition', 'algorithm', 'item-missing', 'duplicate-item'])(
  'VN03 scope exemption requires an intact original basis: %s', condition => {
    const root = fixture(); captureDefinitionBasis(root);
    updateGoal(root, goal => { goal.metadata.assessment_scopes.push({ target: 'R-NEW', scope_id: 'EXTRA', coverage: 'Independent batch' }); });
    const old = report(root), metadata: any = {};
    if (condition === 'missing') metadata.goal_basis = { ...old.metadata.goal_basis, path: 'docs/evidence/missing.md' };
    if (condition === 'digest-missing') { metadata.goal_basis = { ...old.metadata.goal_basis }; delete metadata.goal_basis.sha256; }
    if (condition === 'wrong-definition') metadata.goal_definition_sha256 = '0'.repeat(64);
    if (condition === 'algorithm') metadata.goal_definition_algorithm = 'unknown-algorithm';
    if (condition === 'item-missing' || condition === 'duplicate-item') {
      const document = parseProduct(get(root, basisPath), basisPath);
      const items = document.items.filter(i => condition !== 'item-missing' || i.id !== 'G-DEMO');
      if (condition === 'duplicate-item') items.push(items.find(i => i.id === 'G-DEMO')!);
      put(root, basisPath, newDocument(items, 'Invalid historical identity', 3));
      metadata.goal_basis = { ...old.metadata.goal_basis, sha256: sha256(get(root, basisPath)) };
    }
    if (Object.keys(metadata).length) expect(run('apply', root, { files: [op(root, reportPath, { updates: [{ id: 'A-DEMO', metadata }] })] }).status).toBe('saved');
    for (const bundled of [false, true]) {
      const result = selectWith(root, bundled);
      expect(result.conclusion).toBe('undetermined');
      expect(result.reasons).toContain(condition === 'algorithm' ? 'goal-definition-unverified' : 'goal-definition-changed');
    }
  },
);

test.each([2, 3] as const)('VN03 cross-file v%s batch order reports a partial save without undoing the successful requirement', version => {
  const root = fixture(), addedPath = 'docs/product/ADDED.md';
  put(root, '.workflow-system/PRODUCT.yaml', manifest.replace('  - docs/product/ASSESSMENTS.md', '  - docs/product/ASSESSMENTS.md\n  - '+addedPath));
  const r = parseProduct(get(root, projectPath), projectPath).items.find(i => i.id === 'R-NEW')!;
  const content = newDocument([{ metadata: { id: 'R-BATCH', type: 'requirement', scope: 'current' }, body: r.body.replaceAll('R-NEW', 'R-BATCH') }], '新增批次', version);
  put(root, projectPath, get(root, projectPath) + '\n<!-- @frozen -->\n');
  const saved = run('apply', root, { files: [{ path: addedPath, expected_sha256: null, content }] });
  expect(saved.status).toBe('partial'); expect(saved.files[0].saved).toBe(true);
  expect(saved.requirement_order_update.saved).toBe(false); expect(saved.requirement_order_update.error).toContain('FROZEN');
  expect(read(root).product_view.unordered_requirements).toContain('R-BATCH');
  put(root, projectPath, documents[0]!);
  const retry = run('apply', root, { files: [op(root, projectPath, { updates: [{ id: 'PROJECT', metadata: { requirement_order: [...read(root).product_view.requirement_order, 'R-BATCH'] } }] })] });
  expect(retry.status).toBe('saved'); expect(read(root).product_view.requirement_order.at(-1)).toBe('R-BATCH');
  expect(fs.existsSync(path.join(root, '.workflow-system/records'))).toBe(false);
});

test('VN03 explicit v2 goal migration retains bytes and accepts only v3 fields in the selected document', () => {
  const root = fixture(), file = 'docs/product/GOAL.md';
  put(root, '.workflow-system/PRODUCT.yaml', manifest.replace('  - docs/product/ASSESSMENTS.md', '  - docs/product/ASSESSMENTS.md\n  - '+file));
  const body = '## [G-MIGRATE] 局部目标\n### 目标说明\n保留要求。\n### 范围边界\n保留边界。\n';
  put(root, file, newDocument([{ metadata: { id: 'G-MIGRATE', type: 'goal', scope: 'current' }, body }]));
  const before = get(root, file), update = { updates: [{ id: 'G-MIGRATE', metadata: { goal_kind: 'stage', assessment_scopes: [] } }] };
  expect(run('apply', root, { files: [op(root, file, update)] }).status).toBe('failed');
  expect(run('apply', root, { files: [op(root, file, { ...update, migrate: 'v3' })] }).status).toBe('saved');
  const parsed = parseProduct(get(root, file), file);
  expect(parsed.version).toBe(3); expect(parsed.items[0]!.body).toBe(parseProduct(before, file).items[0]!.body);
  expect(get(root, reportPath)).toBe(documents[1]!);
});

test('VN03 missing overall goal and duplicate declarations are diagnosed without hiding requirements or blocking writes', () => {
  const root = fixture(), goal = parseProduct(get(root, projectPath), projectPath).items.find(i => i.id === 'G-DEMO')!;
  const changed = run('apply', root, { files: [op(root, projectPath, { updates: [{ id: 'PROJECT', remove_fields: ['root_goal_id'] }, { id: goal.id, metadata: { assessment_scopes: [goal.metadata.assessment_scopes[0], goal.metadata.assessment_scopes[0]] } }] })] });
  expect(changed.status).toBe('saved');
  const result = read(root);
  expect(result.product_view.root_goal.status).toBe('unspecified');
  expect(result.diagnostics.some((d: any) => d.code === 'ROOT_GOAL_UNSPECIFIED')).toBe(true);
  expect(result.usable_items.find((i: any) => i.id === goal.id).definition_sha256).toBe(null);
  expect(result.assessment_selection.reasons).toEqual(['conflict']);
  expect(result.usable_items.some((i: any) => i.id === 'R-IMPORT')).toBe(true);
  expect(result.development_gate).toBe(false);
});

test('VN03 local Node artifacts and v3 Schema match the source handoff fixture', () => {
  const root = fixture();
  const response = spawnSync('node', ['runtime/vnext/dist/product-maintenance.js', 'read', '--root', root], { input: JSON.stringify({ assessment_query: query() }), encoding: 'utf8' });
  expect(response.status).toBe(0); expect(JSON.parse(response.stdout).assessment_selection.assessment_id).toBe('A-DEMO');
  const offline = spawnSync('node', ['runtime/vnext/support/product-maintenance/offline-reader.js', root], { encoding: 'utf8' });
  expect(offline.status).toBe(0); expect(JSON.parse(offline.stdout).product_view.root_goal.id).toBe('G-ALL');
  const schema = JSON.parse(fs.readFileSync('runtime/vnext/support/product-maintenance/schemas/product-doc-v3.json', 'utf8'));
  expect(schema).toEqual(documentSchema(3));
  const assetRoot = path.resolve('runtime/vnext/support/product-maintenance/examples/scoped');
  expect(run('read', assetRoot, { assessment_query: query() }).assessment_selection.assessment_id).toBe('A-DEMO');
});
