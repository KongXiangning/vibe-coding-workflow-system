import { afterEach, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { stringify } from 'yaml';
import { run } from '../runtime/vnext/src/product-maintenance/cli';
import { newDocument } from '../runtime/vnext/src/product-maintenance/writer';
import { sha256 } from '../runtime/vnext/src/product-maintenance/parser';
import { functionalPointContract, pointFieldAliases, readAssessmentPoints, readRequirementPoints, standardPointHeaders } from '../runtime/vnext/src/product-maintenance/functional-points';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== fs.realpathSync(os.tmpdir()) || !path.basename(root).startsWith('product-points-')) throw new Error('Unexpected fixture root');
    fs.rmSync(root, { recursive: true, force: true });
  }
});
const points = readRequirementPoints('### 功能点\n- 第一项\n- 第二项\n');
function table(rows: string, headers: readonly string[] = ['功能点', '有据成果', '本对象边界']): string {
  return `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |\n${rows}\n`;
}
const codes = (value: ReturnType<typeof readAssessmentPoints>) => value.diagnostics.map(entry => entry.code);
function put(root: string, file: string, text: string): void {
  const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text);
}
function report(body: string, id = 'AS') {
  return { metadata: { id, type: 'assessment', target: 'REQ', target_basis: { kind: 'file', path: 'docs/product/REQ.md', item_id: 'REQ' }, target_definition_sha256: null,
    checked_at: '2026-10-21T00:00:00Z', subject: { kind: 'unknown', value: null }, implementation: 'unknown', verification: 'unknown' },
    body: `## [${id}] 范围报告\n### 覆盖范围\n只核对结构。\n### 交付与验证依据\n${body}\n### 剩余与待核对\n不构成业务验证。\n` };
}
function fixture(): string {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'product-points-')); roots.push(root);
  put(root, '.workflow-system/PRODUCT.yaml', stringify({ schema: 'vnext-product-manifest/v2', project_id: 'points', entry: 'docs/product/PROJECT.md',
    managed_paths: ['docs/product/*.md'], source_paths: ['docs/product/*.md'], capture_paths: [], exclude_paths: [], maintenance: 'enabled' }));
  put(root, 'docs/product/PROJECT.md', newDocument([{ metadata: { id: 'PROJECT', type: 'project', inventory: { state: 'partial', checked_sources: [], unreviewed_sources: [] } },
    body: '## [PROJECT] 结构夹具\n### 项目定位\n逐点契约。\n### 盘点范围与未核对项\n只验证结构。\n' }]));
  put(root, 'docs/product/REQ.md', newDocument([{ metadata: { id: 'REQ', type: 'requirement', scope: 'current' },
    body: '## [REQ] 两点\n### 需求内容\n两项义务。\n### 功能点\n- 第一项\n- 第二项\n### 范围边界\n仅结构。\n### 验收要求\n不从任务推导交付。\n' }]));
  return root;
}

test('requirements keep explicit IDs, implicit list order, nested detail and source lines', () => {
  const result = readRequirementPoints('### 功能点与输入输出\n\n- **F3 原功能**\n  - 细节不另编号\n- 隐式第二点\n\n### 验收要求\n- 不作为点\n', 20);
  expect(result).toEqual([{ id: 'F3', title: '原功能', line: 22 }, { id: 'F2', title: '隐式第二点', line: 24 }]);
  expect(readRequirementPoints('### 需求内容\n- 普通列表\n')).toEqual([]);
});

test('standard table maps fields without inventing implementation judgment and preserves GFM cells', () => {
  const input = table('| **REQ/F1 第一项** | | 已保存 `a\\|b` | 本轮未验证 | 仍有未知 |\n| F2 第二项 | | 本报告未覆盖 | 未验证 | 本报告未覆盖：对象不同 |', standardPointHeaders);
  const result = readAssessmentPoints(input.replaceAll('\n', '\r\n'), 'REQ', points, 40);
  expect(result.contract).toBe(functionalPointContract);
  expect(result.status).toBe('parsed'); expect(result.coverage).toBe('complete');
  expect(result.rows[0]!.line).toBe(42);
  expect(result.rows[0]!.fields).toEqual([
    { label: standardPointHeaders[2], text: '已保存 a|b', field: 'implementation' },
    { label: standardPointHeaders[3], text: '本轮未验证', field: 'verification' },
    { label: standardPointHeaders[4], text: '仍有未知', field: 'remaining' },
  ]);
});

test('all declared legacy point headers map through one exported vocabulary', () => {
  for (const header of pointFieldAliases.point) {
    const result = readAssessmentPoints(table('| F1 | 成果 | 边界 |\n| F2 | 未覆盖 | 未覆盖原因 |', [header, '有据成果', '本对象边界']), 'REQ', points);
    expect(result.status).toBe('parsed'); expect(result.coverage).toBe('complete');
  }
});

test('absent records, unsupported headers, malformed Markdown and partial mapping stay distinct', () => {
  const absent = readAssessmentPoints('普通说明\n\n| 验收项 | 结果 |\n|---|---|\n| M1 | PASS |\n| F4-M1 | PASS |\n', 'REQ', points);
  expect(absent.status).toBe('absent'); expect(codes(absent)).toContain('POINT_RECORDS_ABSENT');
  const unknown = readAssessmentPoints(table('| F1 | 成果 | 边界 |', ['自拟列名', '有据成果', '本对象边界']), 'REQ', points);
  expect(unknown.status).toBe('unrecognized'); expect(codes(unknown)).toContain('POINT_TABLE_UNRECOGNIZED');
  const malformed = readAssessmentPoints('| 功能点 | 有据成果 |\n|--broken--|--|\n| F1 | 内容 |\n', 'REQ', points);
  expect(malformed.status).toBe('unrecognized');
  const partial = readAssessmentPoints(table('| F1 | 成果 | 原文保留 |\n| F2 | 成果 | 原文保留 |', ['功能点', '有据成果', '自拟字段']), 'REQ', points);
  expect(partial.status).toBe('partial'); expect(partial.coverage).toBe('incomplete');
  expect(partial.rows[0]!.fields[1]).toEqual({ label: '自拟字段', text: '原文保留', field: null });
  expect(codes(partial)).toContain('POINT_FIELD_UNMAPPED');
});

test('missing, duplicate and unknown IDs are reported without selecting a winning row', () => {
  const result = readAssessmentPoints(table('| F1 | 旧事实 | 旧边界 |\n| F1 | 新事实 | 新边界 |\n| F9 | 其他点 | 范围外 |'), 'REQ', points);
  expect(result.missing_points).toEqual(['F2']); expect(result.duplicate_points).toEqual(['F1']); expect(result.unknown_points).toEqual(['F9']);
  expect(result.rows).toHaveLength(3); expect(codes(result)).toEqual(expect.arrayContaining(['POINT_ID_MISSING', 'POINT_ID_DUPLICATE', 'POINT_ID_UNKNOWN']));
});

test('duplicate field mappings and rows without any evidence remain explicit', () => {
  const duplicate = readAssessmentPoints(table('| F1 | 成果甲 | 成果乙 |', ['功能点', '有据成果', '已确认成果']), 'REQ', points);
  expect(codes(duplicate)).toContain('POINT_FIELD_DUPLICATE');
  expect(duplicate.rows[0]!.fields.map(field => field.text)).toEqual(['成果甲', '成果乙']);
  const empty = readAssessmentPoints(table('| F1 | | |'), 'REQ', points);
  expect(codes(empty)).toContain('POINT_ROW_EMPTY'); expect(empty.coverage).toBe('incomplete');
});

for (const id of ['F1/F2', 'F1–F2', 'F1-2', 'F1 第一项；F2 第二项', 'OTHER/F1']) {
  test(`ambiguous or foreign identity ${id} never receives an inferred point`, () => {
    const result = readAssessmentPoints(table(`| ${id} | 保留成果 | 保留边界 |`), 'REQ', points);
    expect(result.rows[0]!.point_id).toBeNull(); expect(result.missing_points).toEqual(['F1', 'F2']);
    expect(codes(result)).toContain(id.startsWith('OTHER') ? 'POINT_TARGET_MISMATCH' : 'POINT_GROUPED_ID');
  });
}

test('original-number and exact-title aliases require a unique actual definition', () => {
  const result = readAssessmentPoints(table('| 原功能1 | 成果 | 边界 |\n| 第二项 | 未覆盖 | 原因 |'), 'REQ', points);
  expect(result.rows.map(row => row.point_id)).toEqual(['F1', 'F2']); expect(result.coverage).toBe('complete');
  const uncertain = readAssessmentPoints(table('| 第一项 | 成果 | 边界 |'), 'REQ');
  expect(uncertain.rows[0]!.point_id).toBeNull(); expect(uncertain.coverage).toBe('unavailable');
});

test('supplementary rows attach only to a unique primary record and code examples are ignored', () => {
  const main = table('| F1 | 成果 | 边界 |\n| F2 | 成果 | 边界 |');
  const input = `${main}\n#### 剩余分类\n${table('| F1 | 补充成果 | 补充边界 |')}\n#### 正文恢复\n\n\`\`\`markdown\n${main}\`\`\`\n`;
  const result = readAssessmentPoints(input, 'REQ', points);
  expect(result.status).toBe('parsed'); expect(result.rows).toHaveLength(3); expect(result.duplicate_points).toEqual([]);
  expect(result.rows[2]!.supplementary).toBe(true);
  const orphan = readAssessmentPoints(`#### 补充说明\n${main}`, 'REQ', points);
  expect(orphan.missing_points).toEqual(['F1','F2']); expect(codes(orphan)).toContain('POINT_SUPPLEMENT_UNRESOLVED');
  expect(readAssessmentPoints(`\`\`\`md\n${main}\`\`\``, 'REQ').status).toBe('absent');
});

test('unread and conflicting definitions cannot claim complete coverage', () => {
  const input = table('| F1 | 成果 | 边界 |\n| F2 | 成果 | 边界 |');
  const unread = readAssessmentPoints(input, 'REQ');
  expect(unread.status).toBe('parsed'); expect(unread.coverage).toBe('unavailable'); expect(unread.expected_points).toBeNull();
  expect(codes(unread)).toContain('POINT_COVERAGE_UNAVAILABLE');
  const conflict = readAssessmentPoints(input, 'REQ', [points[0]!, points[0]!]);
  expect(conflict.coverage).toBe('unavailable'); expect(codes(conflict)).toContain('POINT_DEFINITION_CONFLICT');
});

test('empty point tables and unsupported HTML cannot masquerade as absent records', () => {
  const empty = readAssessmentPoints(table('', ['功能点', '有据成果']), 'REQ');
  expect(empty.status).toBe('partial'); expect(codes(empty)).toContain('POINT_TABLE_EMPTY');
  const html = readAssessmentPoints('<table><tr><th>功能点</th></tr><tr><td>F1</td></tr></table>', 'REQ', points);
  expect(html.status).toBe('unrecognized'); expect(codes(html)).toContain('POINT_TABLE_UNRECOGNIZED');
});

for (const task of ['task824', 'task825']) {
  test(`${task} verbatim historical counterexample maps old headers and retains structural gaps`, () => {
    const fixturePath = path.join(import.meta.dir, 'fixtures/product-points', `${task}-original.json`);
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    expect(fixture.source_sha256).toMatch(/^[a-f0-9]{64}$/);
    for (const entry of fixture.reports) {
      const expected = entry.expected_points.map((id: string) => ({ id, title: id, line: 1 }));
      const result = readAssessmentPoints(entry.body, entry.target, expected);
      expect(codes(result)).not.toContain('POINT_TABLE_UNRECOGNIZED'); expect(codes(result)).not.toContain('POINT_FIELD_UNMAPPED');
      if (task === 'task824') {
        expect(result.duplicate_points).toEqual(['F4']); expect(result.missing_points).toEqual(['F1','F2','F3','F5']); expect(result.rows).toHaveLength(3);
        expect(entry.body).toContain('F4-M1');
      } else if (entry.target === 'REQ-JUDICIAL') {
        expect(result.status).toBe('parsed'); expect(result.coverage).toBe('complete'); expect(result.rows).toHaveLength(6);
      } else {
        expect(result.status).toBe('partial'); expect(codes(result)).toContain('POINT_GROUPED_ID');
        expect(result.rows.filter(row => row.point_id).map(row => row.point_id)).toEqual(['F10']);
        expect(result.missing_points).toHaveLength(9);
      }
    }
  });
}

test('helper check, apply, read, compact projection and Node bundles expose identical warnings without changing evidence', async () => {
  const root = fixture(), relative = 'docs/product/AS.md';
  const content = newDocument([report(table('| F1 | 成果 | 边界 |\n| F1 | 重复成果 | 旧边界 |'))]);
  const check = run('check', root, { path: relative, content });
  expect(check.status).toBe('valid'); expect(check.development_gate).toBe(false);
  expect(check.functional_points[0].functional_points.duplicate_points).toEqual(['F1']);
  expect(check.diagnostics).toContainEqual(expect.objectContaining({ code: 'POINT_ID_MISSING', item_id: 'AS', severity: 'warning' }));
  const saved = run('apply', root, { files: [{ path: relative, expected_sha256: null, content }] });
  expect(saved.status).toBe('saved');
  expect(saved.files[0].functional_points).toEqual(check.functional_points);
  const before = fs.readFileSync(path.join(root, relative));
  const read = run('read', root, { item_ids: ['AS'], detail: 'items' });
  expect(read.usable_items[0].functional_points).toEqual(check.functional_points[0].functional_points);
  expect(run('check', root).diagnostics).toContainEqual(expect.objectContaining({ code: 'POINT_ID_DUPLICATE', item_id: 'AS', severity: 'warning' }));
  const compact = run('read', root, { item_ids: ['AS'], presentation: 'compact', query: { kind: 'collection', name: 'result', path: ['usable_items', '0', 'functional_points'] } });
  expect(compact.value.coverage).toBe('incomplete');
  const restricted = run('check', root, { path: relative, content, paths: [relative] });
  expect(restricted.functional_points[0].functional_points.coverage).toBe('unavailable');
  const bundle = path.resolve(import.meta.dir, '../runtime/vnext/dist/product-maintenance.js');
  const nodeCheck = JSON.parse(execFileSync('node', [bundle, 'check', '--root', root], { input: JSON.stringify({ path: relative, content }), encoding: 'utf8' }));
  expect(nodeCheck.functional_points).toEqual(check.functional_points);
  const support = path.resolve(import.meta.dir, '../runtime/vnext/support/product-maintenance');
  const offline = JSON.parse(execFileSync('node', [path.join(support, 'offline-reader.js'), root], { encoding: 'utf8' }));
  expect(offline.items.find((item: any) => item.id === 'AS').functional_points).toEqual(check.functional_points[0].functional_points);
  const consumer = await import(path.join(support, 'functional-points.js'));
  expect(consumer.readAssessmentPoints(table('| F1 | 成果 | 边界 |'), 'REQ', points)).toEqual(readAssessmentPoints(table('| F1 | 成果 | 边界 |'), 'REQ', points));
  expect(fs.readFileSync(path.join(root, relative))).toEqual(before);
  expect(sha256(before)).toBe(sha256(content)); expect(fs.existsSync(path.join(root, '.workflow-system/records'))).toBe(false);
});

test('generated standard template consumes the shared column definition', () => {
  const text = fs.readFileSync(path.resolve(import.meta.dir, '../runtime/vnext/support/product-maintenance/templates/ASSESSMENT.md'), 'utf8');
  expect(readAssessmentPoints(text, 'REQ-ID').rows[0]!.fields.map(field => field.field)).toEqual(['implementation', 'verification', 'remaining']);
  expect(text).toContain(`| ${standardPointHeaders.join(' | ')} |`);
});
