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
