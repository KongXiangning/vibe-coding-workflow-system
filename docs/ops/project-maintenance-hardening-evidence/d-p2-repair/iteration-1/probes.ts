import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import { stringify } from 'yaml';
import { newDocument } from '../../runtime/vnext/src/product-maintenance/writer';
import { sha256 } from '../../runtime/vnext/src/product-maintenance/parser';

const repo = path.resolve(import.meta.dir, '../..');
const versions = {
  baseline: path.join(repo, '.tmp/maintain-hardening/baseline-source/runtime/vnext/dist/product-maintenance.js'),
  before_d_fix: path.join(repo, '.tmp/d-p2/pre-fix/product-maintenance.js'),
  current: path.join(repo, 'runtime/vnext/dist/product-maintenance.js'),
};
const protectedFiles = ['runtime/vnext/src/product-maintenance/writer.ts', 'runtime/vnext/src/product-maintenance/schemas.ts', 'runtime/vnext/dist/product-maintenance.js', 'runtime/vnext/support/product-maintenance/contract.md', 'runtime/vnext/support/assistance.mjs'];
const hashes = () => Object.fromEntries(protectedFiles.map(p => [p, sha256(fs.readFileSync(path.join(repo,p)))]));
const beforeHashes = hashes();
const body = (id: string) => `## [${id}] ${id}\n### 需求内容\n保留原功能和明确限制。\n### 范围边界\n只处理当前需求，其他排除项保留。\n### 验收要求\n按实际条件核对。\n`;
const req = (id = 'REQ-A', extra = {}, content = body(id)) => ({ metadata: { id, type: 'requirement', scope: 'current', ...extra }, body: content });
function fixture(items = [req()]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maintain-d-p2-repair-'));
  fs.mkdirSync(path.join(root, '.workflow-system')); fs.mkdirSync(path.join(root, 'docs/product'), { recursive: true });
  fs.writeFileSync(path.join(root, '.workflow-system/PRODUCT.yaml'), stringify({ schema: 'vnext-product-manifest/v2', project_id: 'post-c-review-fixture', entry: 'docs/product/PROJECT.md', managed_paths: ['docs/product/*.md'], source_paths: ['docs/evidence/**'], capture_paths: ['docs/evidence/history/**'], exclude_paths: [], maintenance: 'enabled' }));
  fs.writeFileSync(path.join(root, 'docs/product/PROJECT.md'), newDocument([{ metadata: { id: 'PROJECT-A', type: 'project', inventory: { state: 'partial', checked_sources: [], unreviewed_sources: [] } }, body: '## [PROJECT-A] 项目\n### 项目定位\n本次合成资料。\n### 盘点范围与未核对项\n其他范围未核对。\n' }]));
  fs.writeFileSync(path.join(root, 'docs/product/REQ.md'), newDocument(items));
  return root;
}
function node(binary: string, action: string, root: string, request: any) {
  const response = spawnSync('node', [binary, action, '--root', root], { input: JSON.stringify(request), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (!response.stdout) throw new Error(response.stderr || 'No Node output');
  return { exit: response.status, result: JSON.parse(response.stdout), stderr: response.stderr };
}
const observations: any[] = [];
function probe(name: string, setup: () => { root: string, operation: any }) {
  for (const [version, binary] of Object.entries(versions)) {
    const { root, operation } = setup(), file = path.join(root, 'docs/product/REQ.md');
    const before = fs.readFileSync(file), beforeRead = node(binary, 'read', root, { detail: 'items' });
    const request = { files: [{ path: 'docs/product/REQ.md', expected_sha256: sha256(before), ...operation }] };
    const response = node(binary, 'apply', root, request), after = fs.readFileSync(file), afterRead = node(binary, 'read', root, { detail: 'items' });
    observations.push({ name, version, root, request, before_base64: before.toString('base64'), after_base64: after.toString('base64'), beforeRead, ...response, afterRead });
    console.log(JSON.stringify({ name, version, exit: response.exit, status: response.result.status, error: response.result.files?.[0]?.error, unchanged: before.equals(after), before_usable: beforeRead.result.usable_items?.map((i: any) => i.id), before_diagnostics: beforeRead.result.diagnostics?.map((d: any) => ({ code: d.code, severity: d.severity })), after_usable: afterRead.result.usable_items?.map((i: any) => i.id) }));
  }
}
const html = body('REQ-A') + '<table>\n<tr><td>有效输入：保留约定结果</td></tr>\n</table>\n';
probe('append-after-valid-closed-html-block-one-final-newline', () => {
  const root = fixture([req('REQ-A', {}, html)]), file = path.join(root, 'docs/product/REQ.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\n\n$/, '\n'));
  return { root, operation: { append: [req('REQ-NEW')] } };
});
probe('append-after-valid-closed-html-block-blank-line-control', () => {
  const root = fixture([req('REQ-A', {}, html)]);
  return { root, operation: { append: [req('REQ-NEW')] } };
});
probe('append-after-plain-body-one-final-newline-control', () => {
  const root = fixture(), file = path.join(root, 'docs/product/REQ.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\n\n$/, '\n'));
  return { root, operation: { append: [req('REQ-NEW')] } };
});
probe('authorized-whole-candidate-adds-html-separator-fallback', () => {
  const original = req('REQ-A', {}, html), root = fixture([original]), file = path.join(root, 'docs/product/REQ.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\n\n$/, '\n'));
  return { root, operation: { content: newDocument([original, req('REQ-NEW')]) } };
});
const source = { kind: 'text', text: '此前同一材料', label: '原依据' };
const dismissed = { id: 'L-OLD', relation: 'references', target: 'PROJECT-A', origin: 'inferred', state: 'dismissed', reason: '历史否定保留，本次不改变关联', sources: [source] };
const active = { ...dismissed, id: 'L-CURRENT', origin: 'declared', state: 'active', reason: '文件中已经存在的当前关联' };
for (const whole of [false, true]) probe(`unchanged-duplicate-active-links-scope-edit-${whole ? 'whole' : 'local'}`, () => {
  const links = [dismissed, active, { ...active }], root = fixture([req('REQ-A', { links })]);
  return { root, operation: whole ? { content: newDocument([req('REQ-A', { links, scope: 'planned' })]) } : { updates: [{ id: 'REQ-A', metadata: { scope: 'planned' } }] } };
});
probe('unchanged-active-links-distinct-ids-control', () => {
  const root = fixture([req('REQ-A', { links: [dismissed, active, { ...active, id: 'L-CURRENT-2' }] })]);
  return { root, operation: { updates: [{ id: 'REQ-A', metadata: { scope: 'planned' } }] } };
});
probe('unchanged-duplicate-active-bindings-scope-edit', () => {
  const binding = { id: 'B-OLD', task: { task_id: 'actual-existing-task', source }, role: 'repair', coverage: '同一原范围', origin: 'inferred', state: 'dismissed', reason: '历史否定保留，本次不改变关联', sources: [source] };
  const current = { ...binding, id: 'B-CURRENT', origin: 'declared', state: 'active', reason: '文件中原有的当前关联' };
  const root = fixture([req('REQ-A', { task_bindings: [binding,current,{ ...current }] })]);
  return { root, operation: { updates: [{ id: 'REQ-A', metadata: { scope: 'planned' } }] } };
});
probe('append-after-malformed-neighbor-with-closed-html-one-newline', () => {
  const root = fixture([req('REQ-A', { unknown: true }, html)]), file = path.join(root, 'docs/product/REQ.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\n\n$/, '\n'));
  return { root, operation: { append: [req('REQ-NEW')] } };
});
probe('local-html-body-replacement-keeps-malformed-next-item', () => {
  const root = fixture([req(), req('REQ-KEEP', { unknown: true })]);
  return { root, operation: { updates: [{ id: 'REQ-A', body: html.replace(/\n$/, '') }] } };
});
probe('body-escape-remains-a-failed-candidate-not-a-development-gate', () => ({ root: fixture(), operation: { append: [req('REQ-NEW', {}, body('REQ-NEW') + '\n## 越界\n约束不能落到需求外。\n')] } }));
probe('duplicate-active-extra-row-cannot-hide-reactivation', () => ({ root: fixture([req('REQ-A', { links: [dismissed, active, { ...active }] })]), operation: { updates: [{ id: 'REQ-A', metadata: { links: [active, dismissed, active, { ...active }] } }] } }));
probe('duplicate-active-current-user-reversal-needs-no-external-material', () => {
  const decision = { kind: 'text', text: '当前用户明确改变原决定，重新关联此范围。', label: '当前明确操作' };
  return { root: fixture([req('REQ-A', { links: [dismissed, active, { ...active }] })]), operation: { updates: [{ id: 'REQ-A', metadata: { links: [{ ...active, reason: decision.text, sources: [source, decision] }, dismissed, active, { ...active }] } }] } };
});
const afterHashes = hashes();
if (JSON.stringify(beforeHashes) !== JSON.stringify(afterHashes)) throw new Error('Read-only review changed product/source bytes');
const failures = new Map([['body-escape-remains-a-failed-candidate-not-a-development-gate', 'BODY_BOUNDARY'], ['duplicate-active-extra-row-cannot-hide-reactivation', 'DISMISSED_RELATION']]);
for (const observation of observations.filter(o => o.version === 'current')) {
  const error = failures.get(observation.name), saved = observation.result.files[0].saved;
  if (error ? saved || !observation.result.files[0].error?.includes(error) || observation.before_base64 !== observation.after_base64 : !saved) throw new Error(`Unexpected current result: ${observation.name}`);
  if (observation.result.development_gate !== false) throw new Error('Maintenance became a development gate');
}
fs.writeFileSync(path.join(import.meta.dir, 'results.json'), JSON.stringify({ artifacts: Object.fromEntries(Object.entries(versions).map(([name,file]) => [name,sha256(fs.readFileSync(file))])), beforeHashes, afterHashes, product_source_unchanged: true, observations, current_expected_results_matched: true, scope: '13 deterministic scenarios x 3 actual Node binaries; synthetic evidence, not host-agent or production proof' }, null, 2));
