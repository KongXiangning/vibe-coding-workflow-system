import { afterEach, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { stringify } from 'yaml';
import { run } from '../runtime/vnext/src/product-maintenance/cli';
import { newDocument } from '../runtime/vnext/src/product-maintenance/writer';
import { parseProduct, requirementDigest, sha256 } from '../runtime/vnext/src/product-maintenance/parser';
import { documentSchema } from '../runtime/vnext/src/product-maintenance/schemas';
import { sectionsByType } from '../runtime/vnext/src/product-maintenance/model';
import { readCatalog } from '../runtime/vnext/src/product-maintenance/catalog';
import { assessmentEvidence } from '../runtime/vnext/src/product-maintenance/dispositions';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
const definitions = 'docs/product/PROJECT.md', reports = 'docs/product/ASSESSMENTS.md', snapshot = 'docs/evidence/baseline.md';
const textSource = { kind: 'text', label: '本次职责决定', text: '通用导入职责已移至 REQ-A；领域身份约束保持。' };
const subject = { kind: 'working-copy', value: 'fixture', revision: 'synthetic-r1' };
const query = { target: 'REQ-A', goal_id: 'GOAL', scope_id: 'IMPORT', subject };
const put = (root: string, relative: string, text: string) => { fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true }); fs.writeFileSync(path.join(root, relative), text); };
const get = (root: string, relative = reports) => fs.readFileSync(path.join(root, relative), 'utf8');
const item = (id: string, type: string, metadata: any = {}) => ({ metadata: { id, type, ...metadata }, body: `## [${id}] ${id}\n${sectionsByType[type]!.map(s => `### ${s}\n合成固定范围和依据。`).join('\n')}\n` });
const read = (root: string, selected = query): any => run('read', root, { detail: 'items', assessment_query: selected });
const row = (root: string): any => read(root).usable_items.find((i: any) => i.id === 'REPORT');
const update = (root: string, metadata: any, body?: string): any => run('apply', root, { files: [{ path: reports, expected_sha256: sha256(get(root)), updates: [{ id: 'REPORT', metadata, ...(body === undefined ? {} : { body }) }] }] });
function fixture(version: 3 | 5 | 6 = 6, pending?: any[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'disposition-')); roots.push(root);
  put(root, '.workflow-system/PRODUCT.yaml', stringify({ schema: 'vnext-product-manifest/v2', project_id: 'disposition-test', entry: definitions, managed_paths: ['docs/product/*.md'], source_paths: ['docs/evidence/**'], capture_paths: ['docs/evidence/history/**'], exclude_paths: [], maintenance: 'enabled' }));
  const body = newDocument([item('PROJECT', 'project', { inventory: { state: 'partial', checked_sources: [], unreviewed_sources: [] }, root_goal_id: 'GOAL', requirement_order: ['REQ-A'] }), item('GOAL', 'goal', { scope: 'current', assessment_scopes: [{ target: 'REQ-A', scope_id: 'IMPORT', coverage: '通用导入范围' }] }), item('REQ-A', 'requirement', { scope: 'current' }), item('REQ-B', 'requirement', { scope: 'current' }), item('PARENT', 'goal', { scope: 'current' })], '合成定义', 3);
  put(root, definitions, body); put(root, snapshot, body); put(root, 'docs/evidence/change.md', '合成职责变化\n');
  const parsed = parseProduct(body, definitions), target = parsed.items.find(i => i.id === 'REQ-A')!, goal = parsed.items.find(i => i.id === 'GOAL')!;
  const basis = { kind: 'file', path: snapshot, sha256: sha256(body) };
  put(root, reports, newDocument([item('REPORT', 'assessment', { target: 'REQ-A', target_basis: { ...basis, item_id: 'REQ-A' }, target_definition_algorithm: 'vnext-product-definition/v1', target_definition_sha256: requirementDigest(target), goal_basis: { ...basis, item_id: 'GOAL' }, goal_definition_algorithm: 'vnext-product-definition/v1', goal_definition_sha256: requirementDigest(goal), applicability: { goal_id: 'GOAL', scope_id: 'IMPORT', coverage: '通用导入范围' }, checked_at: '2026-10-15T00:00:00Z', subject, implementation: 'delivered-reported', verification: 'pass-reported', conclusion: 'satisfied', sources: [{ kind: 'text', text: '合成验收依据', label: '仅测试' }], pending_sources: pending ?? [textSource] })], '合成报告', version));
  return root;
}
const disposition = (root: string, extra: any = {}) => ({ change_id: 'CHANGE-BOUNDARY', kind: 'scope-change', source: textSource, disposition: 'no-impact', reason: '本范围已独立覆盖导入职责，领域报告继续适用；合成判断。', checked_at: '2026-10-15T01:00:00Z', basis: row(root).disposition_basis, ...extra });
const saveDisposition = (root: string, extra: any = {}) => { const entry = disposition(root, extra); expect(update(root, { evidence_dispositions: [entry] }).status).toBe('saved'); return entry; };
const changeDefinition = (root: string, id: string, change: any): void => {
  expect(run('apply', root, { files: [{ path: definitions, expected_sha256: sha256(get(root, definitions)), updates: [{ id, ...change }] }] }).status).toBe('saved');
};
const goal = (root: string): any => parseProduct(get(root, definitions), definitions).items.find(i => i.id === 'GOAL')!;

test('v6 adds optional core dispositions without changing v1-v5 schemas or opening legacy metadata', () => {
  for (const v of [1, 2, 3, 4, 5] as const) expect(`${JSON.stringify(documentSchema(v), null, 2)}\n`).toBe(fs.readFileSync(`runtime/vnext/support/product-maintenance/schemas/product-doc-v${v}.json`, 'utf8'));
  const root = fixture(5), original = get(root);
  expect(update(root, { evidence_dispositions: [{ fake: 'not an extension' }] }).status).toBe('failed');
  expect(get(root)).toBe(original); expect(row(root).disposition_basis).toBeNull();
  const migration = run('apply', root, { files: [{ path: reports, expected_sha256: sha256(get(root)), migrate: 'v6', preimage_path: 'docs/evidence/history/report-v5.md' }] });
  expect(migration.status).toBe('saved'); expect(get(root, 'docs/evidence/history/report-v5.md')).toBe(original);
  expect(row(root).disposition_basis.report_algorithm).toBe('vnext-assessment-disposition/v1');
});

test('real apply persists reusable decisions; reads clear only exact pending and never rewrite reports', () => {
  const other = { ...textSource, label: '另一个独立来源' }, root = fixture(6, [textSource, other]);
  const entry = saveDisposition(root), bytes = get(root);
  for (let n = 0; n < 2; n++) {
    const result = read(root), report = result.assessment_selection.reports[0];
    expect(report.evidence_dispositions[0].reuse_status).toBe('reused');
    expect(report.handled_sources).toEqual([textSource]); expect(report.pending_sources).toEqual([other]);
    expect(result.assessment_selection.reasons).toEqual(['pending-evidence']); expect(get(root)).toBe(bytes);
  }
  expect(parseProduct(get(root), reports).items[0]!.metadata.pending_sources).toEqual([textSource, other]);
  expect(parseProduct(get(root), reports).items[0]!.metadata.evidence_dispositions).toEqual([entry]);
  expect(fs.existsSync(path.join(root, '.workflow-system/records'))).toBe(false);
});

test('positive step sources accumulate without pending; same decision survives positive evidence additions', () => {
  const root = fixture(); saveDisposition(root);
  const report = row(root), source = { kind: 'text', text: 'P1 局部实现与测试证据，未改变职责', label: 'P1' };
  expect(update(root, { sources: [...report.metadata.sources, source] }).status).toBe('saved');
  const result = read(root); expect(result.assessment_selection.conclusion).toBe('satisfied');
  expect(row(root).evidence_dispositions[0].reuse_status).toBe('reused');
  expect(result.diagnostics.some((d: any) => d.code === 'PENDING_SOURCES')).toBe(false);
  expect(row(root).metadata.pending_sources).toEqual([textSource]);
});

test.each(['added', 'changed', 'removed'])('another requirement scope being %s retains the local decision', mode => {
  const root = fixture(), other = { target: 'REQ-B', scope_id: 'OTHER', coverage: '其他需求的独立范围' };
  if (mode !== 'added') changeDefinition(root, 'GOAL', { metadata: { assessment_scopes: [...goal(root).metadata.assessment_scopes, other] } });
  const entry = saveDisposition(root), original = goal(root).metadata.assessment_scopes;
  const next = mode === 'added' ? [...original, other] : mode === 'changed' ? original.map((s: any) => s.target === 'REQ-B' ? { ...s, coverage: '其他需求的新范围' } : s) : original.filter((s: any) => s.target !== 'REQ-B');
  changeDefinition(root, 'GOAL', { metadata: { assessment_scopes: next } });
  const report = row(root);
  expect(report.disposition_basis.goal_definition_sha256).not.toBe(entry.basis.goal_definition_sha256);
  expect(report.disposition_basis.goal_scope_definition_sha256).toBe(entry.basis.goal_scope_definition_sha256);
  expect(report.evidence_dispositions[0].reuse_status).toBe('reused'); expect(report.pending_sources).toEqual([]);
  expect(read(root).assessment_selection.conclusion).toBe('satisfied');
});

test.each(['body', 'relation', 'own-scope'])('shared goal %s change reopens the decision', mode => {
  const root = fixture(); saveDisposition(root);
  const current = goal(root);
  const change = mode === 'body' ? { body: current.body.replace('合成固定范围和依据。', '共同目标义务已经改变。') }
    : mode === 'relation' ? { metadata: { links: [{ id: 'GOAL-PARENT', relation: 'derived_from', target: 'PARENT', origin: 'declared', state: 'active' }] } }
    : { metadata: { assessment_scopes: [{ target: 'REQ-A', scope_id: 'IMPORT', coverage: '本范围已改变' }] } };
  changeDefinition(root, 'GOAL', change);
  expect(row(root).pending_sources).toEqual([textSource]); expect(row(root).evidence_dispositions[0].reuse_status).toBe('not-reusable');
});

test.each(['removed', 'replaced'])('reported baseline source being %s reopens the decision', mode => {
  const root = fixture(), additional = { kind: 'text', label: '额外原始验收', text: '判断前已经存在的第二份报告依据。' }, initial = row(root).metadata.sources;
  expect(update(root, { sources: [...initial, additional] }).status).toBe('saved'); saveDisposition(root);
  const next = mode === 'removed' ? initial : [...initial, { ...additional, text: '取代原始依据的新观察。' }];
  expect(update(root, { sources: next }).status).toBe('saved');
  expect(row(root).pending_sources).toEqual([textSource]); expect(row(root).evidence_dispositions[0].reuse_reasons).toContain('basis-changed');
});

test('goal self-assessment keeps the complete goal definition in its disposition basis', () => {
  const root = fixture(); changeDefinition(root, 'GOAL', { metadata: { assessment_scopes: [...goal(root).metadata.assessment_scopes, { target: 'GOAL', scope_id: 'SELF', coverage: '整个目标范围' }] } });
  const current = goal(root), digest = requirementDigest(current), raw = get(root, definitions);
  put(root, snapshot, raw);
  const basis = { kind: 'file', path: snapshot, item_id: 'GOAL', sha256: sha256(raw) };
  expect(update(root, { target: 'GOAL', target_basis: basis, target_definition_sha256: digest, goal_basis: basis, goal_definition_sha256: digest, applicability: { goal_id: 'GOAL', scope_id: 'SELF', coverage: '整个目标范围' } }).status).toBe('saved');
  const entry = saveDisposition(root);
  expect(entry.basis.goal_scope_definition_sha256).toBe(entry.basis.goal_definition_sha256);
  expect(read(root, { ...query, target: 'GOAL', scope_id: 'SELF' }).assessment_selection.conclusion).toBe('satisfied');
  changeDefinition(root, 'GOAL', { metadata: { assessment_scopes: [...goal(root).metadata.assessment_scopes, { target: 'REQ-B', scope_id: 'OTHER', coverage: '新增加的目标一部分' }] } });
  expect(row(root).pending_sources).toEqual([textSource]); expect(row(root).evidence_dispositions[0].reuse_reasons).toContain('basis-changed');
});

test.each(['deferred', 'conflict'])('%s disposition retains the exact pending', mode => {
  const root = fixture(), first = disposition(root), rows = mode === 'deferred' ? [{ ...first, disposition: 'deferred' }] : [first, { ...first, disposition: 'deferred', checked_at: '2026-10-15T02:00:00Z' }];
  expect(update(root, { evidence_dispositions: rows }).status).toBe('saved');
  expect(row(root).pending_sources).toEqual([textSource]);
  expect(row(root).evidence_dispositions.map((d: any) => d.reuse_status)).toEqual(rows.map(() => mode));
  expect(read(root).assessment_selection.reasons).toContain('pending-evidence');
});

test.each(['scope', 'subject', 'definition', 'report'])('%s changes reopen pending and cannot borrow an old decision', mode => {
  const root = fixture(); saveDisposition(root);
  if (mode === 'subject') expect(update(root, { subject: { ...subject, limitations: '对象边界已经变更' } }).status).toBe('saved');
  else if (mode === 'report') expect(update(root, {}, row(root).body.replace('合成固定范围和依据。', '本次交付结论的依据已经变化。')).status).toBe('saved');
  else {
    const document = parseProduct(get(root, definitions), definitions), id = mode === 'scope' ? 'GOAL' : 'REQ-A', i = document.items.find(i => i.id === id)!;
    const change = mode === 'scope' ? { metadata: { assessment_scopes: [{ target: 'REQ-A', scope_id: 'IMPORT', coverage: '新的范围' }] } } : { body: i.body.replace('合成固定范围和依据。', '新的验收义务。') };
    expect(run('apply', root, { files: [{ path: definitions, expected_sha256: sha256(get(root, definitions)), updates: [{ id, ...change }] }] }).status).toBe('saved');
  }
  const report = row(root); expect(report.pending_sources).toEqual([textSource]); expect(report.evidence_dispositions[0].reuse_reasons).toContain('basis-changed');
});

test('file source bytes, digests, locators, availability and additional judgment evidence are verified', () => {
  const root = fixture(), source = { kind: 'file', path: 'docs/evidence/change.md', sha256: sha256(get(root, 'docs/evidence/change.md')), lines: { start: 1, end: 1 } };
  expect(update(root, { pending_sources: [source] }).status).toBe('saved');
  saveDisposition(root, { source: { ...source, note: '说明不参与身份' } });
  expect(row(root).pending_sources).toEqual([]);
  const otherLocator = { ...source, lines: { start: 1, end: 2 } };
  expect(update(root, { pending_sources: [source, otherLocator] }).status).toBe('saved');
  expect(row(root).pending_sources).toEqual([otherLocator]);
  put(root, source.path, '文件新字节\n'); expect(row(root).pending_sources).toEqual([source, otherLocator]);
  expect(row(root).evidence_dispositions[0].reuse_reasons).toContain('source-unverified');
  fs.unlinkSync(path.join(root, source.path)); expect(row(root).pending_sources).toHaveLength(2);
  const extra = { kind: 'file', path: snapshot, sha256: '0'.repeat(64) };
  saveDisposition(root, { sources: [extra] }); expect(row(root).evidence_dispositions[0].reuse_reasons).toContain('source-unverified');
});

test.each([{ kind: 'uri', uri: 'https://example.invalid/evidence' }, { kind: 'file', path: 'docs/evidence/change.md' }])('unarchived or undigested source cannot clear pending: %j', source => {
  const root = fixture(6, [source]); saveDisposition(root, { source });
  expect(row(root).pending_sources).toEqual([source]); expect(row(root).evidence_dispositions[0].reuse_status).toBe('not-reusable');
});

test('incorporation needs matching reported evidence; no-impact never overrides independent definition failures', () => {
  const root = fixture(); saveDisposition(root, { disposition: 'evidence-incorporated' });
  expect(row(root).evidence_dispositions[0].reuse_reasons).toContain('evidence-not-incorporated');
  expect(update(root, { sources: [...row(root).metadata.sources, textSource] }).status).toBe('saved');
  expect(read(root).assessment_selection.conclusion).toBe('satisfied');
  const before = row(root); expect(update(root, { target_definition_sha256: 'a'.repeat(64) }).status).toBe('saved');
  saveDisposition(root); const selected = read(root).assessment_selection;
  expect(selected.reasons).toContain('definition-changed'); expect(selected.conclusion).toBe('undetermined');
  expect(row(root).pending_sources).toEqual([]); expect(before.metadata.verification).toBe('pass-reported');
});

test('new counterevidence is independent; malformed dispositions cannot become reusable', () => {
  const root = fixture(); saveDisposition(root);
  const failure = { kind: 'text', label: 'P2 反例', text: '新的输入产生错误终态，需要局部核对。' };
  expect(update(root, { pending_sources: [textSource, failure] }).status).toBe('saved'); expect(row(root).pending_sources).toEqual([failure]);
  for (const invalid of [disposition(root, { reason: ' ' }), disposition(root, { checked_at: 'tomorrow' }), disposition(root, { basis: { ...row(root).disposition_basis, report_algorithm: 'custom' } })]) {
    const before = get(root); expect(update(root, { evidence_dispositions: [invalid] }).status).toBe('failed'); expect(get(root)).toBe(before);
  }
});

test.each([
  { bytes: 20 * 1024, allowedBytes: 24 * 1024, deniedBytes: 15 * 1024 },
  { bytes: 4 * 1024 * 1024 + 1024, allowedBytes: 5 * 1024 * 1024, deniedBytes: 4 * 1024 * 1024 },
])('read, check, details and selection share the explicit locator budget for $bytes byte evidence', ({ bytes, allowedBytes, deniedBytes }) => {
  const root = fixture(), relative = 'docs/evidence/bounded.md', content = `证据首行\n${'x'.repeat(bytes)}`;
  put(root, relative, content);
  const source = { kind: 'file', path: relative, sha256: sha256(content), lines: { start: 1, end: 1 } };
  expect(update(root, { pending_sources: [source] }).status).toBe('saved');
  saveDisposition(root, { source });
  for (const [max_file_bytes, reusable] of [[deniedBytes, false], [allowedBytes, true], [deniedBytes, false], [allowedBytes, true]] as const) {
    const input = { detail: 'items', assessment_query: query, max_file_bytes, resolve_sources: true };
    const result = run('read', root, input), report = result.usable_items.find((i: any) => i.id === 'REPORT');
    const checked = run('check', root, input), direct = run('read', root, { source, max_file_bytes });
    expect(report.evidence_dispositions[0].reuse_status).toBe(reusable ? 'reused' : 'not-reusable');
    expect(report.pending_sources).toEqual(reusable ? [] : [source]);
    expect(report.handled_sources).toEqual(reusable ? [source] : []);
    expect(result.assessment_selection.reports[0].pending_sources).toEqual(report.pending_sources);
    expect(result.assessment_selection.reasons.includes('pending-evidence')).toBe(!reusable);
    for (const response of [result, checked]) {
      expect(response.diagnostics.some((d: any) => d.code === 'PENDING_SOURCES')).toBe(!reusable);
      const resolved = response.sources.find((s: any) => s.source.path === relative);
      expect(resolved.status).toBe(reusable ? 'available' : 'unavailable');
      expect(resolved.diagnostics.some((d: any) => d.code === 'LOCATOR_BYTE_LIMIT')).toBe(!reusable);
    }
    expect(direct.status).toBe(reusable ? 'available' : 'unavailable');
  }
  const defaultRead = run('read', root, { assessment_query: query, resolve_sources: true }), defaultCheck = run('check', root), defaultReusable = bytes < 4 * 1024 * 1024;
  expect(defaultRead.assessment_selection.reasons.includes('pending-evidence')).toBe(!defaultReusable);
  expect(defaultCheck.diagnostics.some((d: any) => d.code === 'PENDING_SOURCES')).toBe(!defaultReusable);
  expect(defaultRead.sources.find((s: any) => s.source.path === relative).status).toBe(defaultReusable ? 'available' : 'unavailable');
  put(root, relative, `${content}\n新反例字节`);
  const changed = run('read', root, { max_file_bytes: allowedBytes, assessment_query: query });
  expect(changed.diagnostics.some((d: any) => d.code === 'PENDING_SOURCES')).toBe(true);
  expect(changed.assessment_selection.reasons).toContain('pending-evidence');
});

test('one catalog reuses its evidence observation while changed budgets and new requests are re-evaluated', () => {
  const root = fixture(), source = { kind: 'file', path: 'docs/evidence/change.md', sha256: sha256(get(root, 'docs/evidence/change.md')), lines: { start: 1, end: 1 } };
  expect(update(root, { pending_sources: [source] }).status).toBe('saved'); saveDisposition(root, { source });
  const catalog = readCatalog(root), report = catalog.byId.get('REPORT')!, observed = assessmentEvidence(catalog, report);
  put(root, source.path, '本次读取之后改变的文件\n');
  expect(assessmentEvidence(catalog, report)).toEqual(observed);
  expect(assessmentEvidence(catalog, report, { max_file_bytes: 1 }).pending_sources).toEqual([source]);
  expect(row(root).pending_sources).toEqual([source]);
});

test.each(['judgment', 'pending', 'body'])('an in-memory %s candidate cannot reuse the previous report observation', change => {
  const root = fixture(); saveDisposition(root);
  const catalog = readCatalog(root), report = catalog.byId.get('REPORT')!;
  expect(assessmentEvidence(catalog, report).pending_sources).toEqual([]);
  const additional = { kind: 'text', text: '候选中新出现的反例', label: '候选来源' };
  if (change === 'judgment') report.metadata.evidence_dispositions[0].disposition = 'deferred';
  else if (change === 'pending') report.metadata.pending_sources.push(additional);
  else report.body = report.body.replace('合成固定范围和依据。', '候选中的交付义务改变。');
  expect(assessmentEvidence(catalog, report).pending_sources).toEqual([change === 'pending' ? additional : textSource]);
});
