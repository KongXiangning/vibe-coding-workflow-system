import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stringify } from 'yaml';
import { run } from '../runtime/vnext/src/product-maintenance/cli';
import { newDocument } from '../runtime/vnext/src/product-maintenance/writer';
import { parseProduct, requirementDigest, sha256 } from '../runtime/vnext/src/product-maintenance/parser';
import { sectionsByType } from '../runtime/vnext/src/product-maintenance/model';

if (!process.argv[2]) throw new Error('Usage: bun run scripts/check-evidence-dispositions-consumers.ts <TraceLens-root>');
const traceRoot = path.resolve(process.argv[2]);
const { buildSnapshot } = await import(pathToFileURL(path.join(traceRoot, 'src/server/snapshot.ts')).href);
const { selectAssessment } = await import(pathToFileURL(path.join(traceRoot, 'src/shared/product-view.ts')).href);
const traceEvidence = await import(pathToFileURL(path.join(traceRoot, 'src/shared/evidence-dispositions.ts')).href);
const defs = 'docs/product/PROJECT.md', reports = 'docs/product/ASSESSMENTS.md', original = 'docs/evidence/definitions.md';
const subject = { kind: 'working-copy', value: 'synthetic', revision: 'r1' };
const query = { target: 'REQ-A', goal_id: 'GOAL', scope_id: 'FULL', subject };
const roots: string[] = [];
const get = (root: string, file = reports) => fs.readFileSync(path.join(root, file), 'utf8');
const put = (root: string, file: string, text: string) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
const item = (id: string, type: string, metadata: any = {}) => ({ metadata: { id, type, ...metadata }, body: `## [${id}] ${id}\n${sectionsByType[type]!.map(s => `### ${s}\n合成范围。`).join('\n')}\n` });
function read(root: string): any { return run('read', root, { detail: 'items', assessment_query: query }); }
function report(root: string): any { return read(root).usable_items.find((i: any) => i.id === 'REPORT'); }
function update(root: string, metadata: any, body?: string): void {
  const saved = run('apply', root, { files: [{ path: reports, expected_sha256: sha256(get(root)), updates: [{ id: 'REPORT', metadata, ...(body ? { body } : {}) }] }] });
  assert.equal(saved.status, 'saved', JSON.stringify(saved));
}
function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'disposition-cross-')); roots.push(root);
  put(root, '.workflow-system/PRODUCT.yaml', stringify({ schema: 'vnext-product-manifest/v2', project_id: 'cross-fixture', entry: defs, managed_paths: ['docs/product/*.md'], source_paths: ['docs/evidence/**'], capture_paths: [], exclude_paths: [], maintenance: 'enabled' }));
  const raw = newDocument([item('PROJECT', 'project', { inventory: { state: 'partial', checked_sources: [], unreviewed_sources: [] }, root_goal_id: 'GOAL', requirement_order: ['REQ-A', 'REQ-B'] }), item('GOAL', 'goal', { scope: 'current', assessment_scopes: [{ target: 'REQ-A', scope_id: 'FULL', coverage: 'A范围' }] }), item('REQ-A', 'requirement', { scope: 'current' }), item('REQ-B', 'requirement', { scope: 'current' })], '合成定义', 3);
  put(root, defs, raw); put(root, original, raw); put(root, 'docs/evidence/change.md', '合成变化\n');
  const parsed = parseProduct(raw, defs), target = parsed.items.find(i => i.id === 'REQ-A')!, goal = parsed.items.find(i => i.id === 'GOAL')!;
  const basis = { kind: 'file', path: original, sha256: sha256(raw) };
  const source = { kind: 'file', path: 'docs/evidence/change.md', sha256: sha256(get(root, 'docs/evidence/change.md')) };
  put(root, reports, newDocument([item('REPORT', 'assessment', { target: 'REQ-A', target_basis: { ...basis, item_id: 'REQ-A' }, target_definition_algorithm: 'vnext-product-definition/v1', target_definition_sha256: requirementDigest(target), goal_basis: { ...basis, item_id: 'GOAL' }, goal_definition_algorithm: 'vnext-product-definition/v1', goal_definition_sha256: requirementDigest(goal), applicability: { goal_id: 'GOAL', scope_id: 'FULL', coverage: 'A范围' }, checked_at: '2026-10-15T00:00:00Z', subject, implementation: 'delivered-reported', verification: 'pass-reported', conclusion: 'satisfied', sources: [{ kind: 'text', text: '合成既有验收依据', label: '仅测试' }], pending_sources: [source] })], '合成报告', 6));
  return root;
}
function save(root: string, extra: any = {}): void {
  const r = report(root);
  update(root, { evidence_dispositions: [{ change_id: 'CHANGE-A', kind: 'scope-change', source: r.metadata.pending_sources[0], disposition: 'no-impact', reason: '合成局部判断，实际义务保持。', checked_at: '2026-10-15T01:00:00Z', basis: r.disposition_basis, ...extra }] });
}
function changeGoal(root: string, change: (goal: any) => void): void {
  const goal = parseProduct(get(root, defs), defs).items.find(i => i.id === 'GOAL')!;
  change(goal);
  assert.equal(run('apply', root, { files: [{ path: defs, expected_sha256: sha256(get(root, defs)), updates: [{ id: 'GOAL', metadata: goal.metadata, body: goal.body }] }] }).status, 'saved');
}
function common(selected: any, evidence: any, trace = false): any {
  return { conclusion: selected.conclusion, id: trace ? selected.assessment?.id ?? null : selected.assessment_id,
    reasons: [...selected.reasons].sort(), basis: evidence.disposition_basis,
    pending: evidence.pending_sources, handled: evidence.handled_sources,
    reviews: evidence.evidence_dispositions.map((r: any) => [r.reuse_status, r.reuse_reasons]) };
}
const cases: [string, (root: string) => void][] = [
  ['unhandled', () => {}],
  ['reuse', save],
  ['positive-source-append', r => { save(r); update(r, { sources: [...report(r).metadata.sources, { kind: 'text', text: 'P1正向进展', label: 'P1' }] }); }],
  ['other-scope-add', r => { save(r); changeGoal(r, g => g.metadata.assessment_scopes.push({ target: 'REQ-B', scope_id: 'OTHER', coverage: 'B范围' })); }],
  ['other-scope-change', r => { changeGoal(r, g => g.metadata.assessment_scopes.push({ target: 'REQ-B', scope_id: 'OTHER', coverage: 'B范围' })); save(r); changeGoal(r, g => g.metadata.assessment_scopes[1].coverage = 'B新范围'); }],
  ['other-scope-remove', r => { changeGoal(r, g => g.metadata.assessment_scopes.push({ target: 'REQ-B', scope_id: 'OTHER', coverage: 'B范围' })); save(r); changeGoal(r, g => g.metadata.assessment_scopes.pop()); }],
  ['own-scope-change', r => { save(r); changeGoal(r, g => g.metadata.assessment_scopes[0].coverage = 'A新范围'); }],
  ['shared-goal-body', r => { save(r); changeGoal(r, g => g.body += '\n共同要求改变。\n'); }],
  ['new-counterevidence', r => { save(r); update(r, { pending_sources: [...report(r).metadata.pending_sources, { kind: 'text', text: '新的失败', label: 'P2' }] }); }],
  ['source-bytes-change', r => { save(r); put(r, 'docs/evidence/change.md', '新的字节\n'); }],
  ['source-missing', r => { save(r); fs.unlinkSync(path.join(r, 'docs/evidence/change.md')); }],
  ['source-note', r => { save(r); update(r, { pending_sources: report(r).metadata.pending_sources.map((s: any) => ({ ...s, note: '展示说明变化' })) }); }],
  ['source-locator', r => { save(r); update(r, { pending_sources: report(r).metadata.pending_sources.map((s: any) => ({ ...s, lines: { start: 1, end: 1 } })) }); }],
  ['subject-change', r => { save(r); update(r, { subject: { ...subject, limitations: '新增对象限制' } }); }],
  ['report-body', r => { save(r); update(r, {}, report(r).body + '\n新增报告判断。\n'); }],
  ['original-evidence-replaced', r => { save(r); update(r, { sources: [{ kind: 'text', text: '不同证据', label: '变化' }] }); }],
  ['deferred', r => save(r, { disposition: 'deferred' })],
  ['conflict', r => { save(r); const entry = report(r).metadata.evidence_dispositions[0]; update(r, { evidence_dispositions: [entry, { ...entry, disposition: 'deferred' }] }); }],
  ['incorporation-absent', r => save(r, { disposition: 'evidence-incorporated' })],
  ['incorporation-present', r => { save(r, { disposition: 'evidence-incorporated' }); update(r, { sources: [...report(r).metadata.sources, report(r).metadata.pending_sources[0]] }); }],
  ['extra-proof-missing', r => save(r, { sources: [{ kind: 'file', path: 'docs/evidence/missing.md', sha256: '0'.repeat(64) }] })],
  ['legacy-v5', r => put(r, reports, get(r).replace('vnext-product-doc/v6', 'vnext-product-doc/v5'))],
];
const completed: string[] = [];
try {
  for (const [name, mutate] of cases) {
    const root = fixture(); mutate(root);
    const before = get(root);
    const source = read(root), sourceReport = source.usable_items.find((i: any) => i.id === 'REPORT');
    const bundled = spawnSync('node', ['runtime/vnext/dist/product-maintenance.js', 'read', '--root', root], { encoding: 'utf8', input: JSON.stringify({ detail: 'items', assessment_query: query }) });
    assert.equal(bundled.status, 0, bundled.stderr);
    const bundle = JSON.parse(bundled.stdout), bundleReport = bundle.usable_items.find((i: any) => i.id === 'REPORT');
    const snapshot = await buildSnapshot({ id: 'cross-fixture', name: '合成fixture', root, configVersion: 1, config: { rules: { management: [], requirements: [], design: [], planning: [] }, excludes: [], product: { enabled: true, manifestPath: '.workflow-system/PRODUCT.yaml' } } }, '2026-10-15T00:00:00Z');
    const product = snapshot.product, traceReport = product.items.find((i: any) => i.id === 'REPORT');
    assert.equal(traceReport?.usable, true, JSON.stringify(product.diagnostics));
    const selected = selectAssessment(product, query.target, query.goal_id, subject, query.scope_id);
    const compared = common(source.assessment_selection, sourceReport);
    assert.deepEqual(common(bundle.assessment_selection, bundleReport), compared, `${name}: bundle`);
    assert.deepEqual(common(selected, traceEvidence.assessmentEvidence(product, traceReport), true), compared, `${name}: TraceLens`);
    assert.equal(get(root), before, `${name}: read-only bytes`);
    completed.push(name);
  }
  console.log(JSON.stringify({ cases: completed.length, consumers: ['vNext source', 'vNext Node bundle', 'TraceLens snapshot/selection'], compared: ['basis', 'conclusion', 'selected report', 'reason codes', 'effective pending', 'handled sources', 'reuse status'], read_only_bytes_unchanged: true, completed }));
} finally {
  for (const root of roots) {
    const absolute = path.resolve(root), prefix = path.join(path.resolve(os.tmpdir()), 'disposition-cross-');
    assert(absolute.startsWith(prefix), 'unexpected cleanup target');
    fs.rmSync(absolute, { recursive: true, force: true });
  }
}
