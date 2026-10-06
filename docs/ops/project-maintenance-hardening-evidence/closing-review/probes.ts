import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import { stringify } from 'yaml';
import { newDocument } from '../../runtime/vnext/src/product-maintenance/writer';
import { sha256 } from '../../runtime/vnext/src/product-maintenance/parser';
const repo = path.resolve(import.meta.dir, '../..');
const helper = path.join(repo, 'runtime/vnext/dist/product-maintenance.js');
const versions = { baseline: path.join(repo, '.tmp/maintain-hardening/baseline-source/runtime/vnext/dist/product-maintenance.js'), reviewed: path.join(repo, '.tmp/review-fix/pre-fix/product-maintenance.js'), current: helper };
const body = (id: string, type = 'requirement') => `## [${id}] ${id}\n${(type === 'project' ? ['项目定位', '盘点范围与未核对项'] : ['需求内容', '范围边界', '验收要求']).map(s => `### ${s}\n原业务要求与排除项。`).join('\n')}\n`;
const req = (id = 'REQ-A', extra = {}) => ({ metadata: { id, type: 'requirement', scope: 'current', ...extra }, body: body(id) });
const put = (root: string, p: string, text: string) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), text); };
function fixture(items = [req()]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maintain-closing-review-'));
  put(root, '.workflow-system/PRODUCT.yaml', stringify({ schema: 'vnext-product-manifest/v2', project_id: 'closing-review', entry: 'docs/product/PROJECT.md', managed_paths: ['docs/product/*.md'], source_paths: ['docs/evidence/**'], capture_paths: ['docs/evidence/history/**'], exclude_paths: [], maintenance: 'enabled' }));
  put(root, 'docs/product/PROJECT.md', newDocument([{ metadata: { id: 'PROJECT-A', type: 'project', inventory: { state: 'partial', checked_sources: [], unreviewed_sources: [] } }, body: body('PROJECT-A', 'project') }]));
  put(root, 'docs/product/REQ.md', newDocument(items)); return root;
}
function call(helper: string, action: string, root: string, input: any) {
  const result = spawnSync('node', [helper, action, '--root', root], { input: JSON.stringify(input), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return { exit: result.status, result: JSON.parse(result.stdout), stderr: result.stderr };
}
const observations: any[] = [];
function probe(name: string, setup: () => { root: string, operation: any }) {
  for (const [version, candidateHelper] of Object.entries(versions)) {
    const { root, operation } = setup();
    const file = path.join(root, 'docs/product/REQ.md'), before = fs.readFileSync(file);
    const request = { files: [{ path: 'docs/product/REQ.md', expected_sha256: sha256(before), ...operation }] };
    const response = call(candidateHelper, 'apply', root, request);
    const readback = call(candidateHelper, 'read', root, { detail: 'items' });
    observations.push({ name, version, root, request, before_base64: before.toString('base64'), after_base64: fs.readFileSync(file).toString('base64'), ...response, readback });
    console.log(JSON.stringify({ name, version, exit: response.exit, status: response.result.status, error: response.result.files?.[0]?.error, unchanged: fs.readFileSync(file).equals(before), links: readback.result.usable_items?.find((i: any) => i.id === 'REQ-A')?.metadata.links, usable: readback.result.usable_items?.map((i: any) => i.id) }));
  }
}
const source = { kind: 'text', text: '原来被否定的同一材料', label: '原来源' };
const dismissed = { id: 'L-OLD', relation: 'references', target: 'PROJECT-A', origin: 'inferred', state: 'dismissed', reason: '原用户否定，业务决定未改变', sources: [source] };
probe('format-only-source-repair-must-not-revive-dismissed', () => {
  const root = fixture([req('REQ-A', { links: [{ ...dismissed, sources: [{ ...source, unknown: true }] }] })]);
  return { root, operation: { updates: [{ id: 'REQ-A', metadata: { links: [{ ...dismissed, state: 'active', reason: '只删除来源未知字段，原材料和业务决定均未变化' }] } }] } };
});
probe('format-only-source-repair-keeps-dismissed-control', () => {
  const root = fixture([req('REQ-A', { links: [{ ...dismissed, sources: [{ ...source, unknown: true }] }] })]);
  return { root, operation: { updates: [{ id: 'REQ-A', metadata: { links: [dismissed] } }] } };
});
probe('unchanged-relations-must-not-block-scope-update', () => {
  const active = { ...dismissed, id: 'L-CURRENT', origin: 'declared', state: 'active', reason: '文件中已有的当前明确关联，非本次新建' };
  const root = fixture([req('REQ-A', { links: [dismissed, active] })]);
  return { root, operation: { updates: [{ id: 'REQ-A', metadata: { scope: 'planned' } }] } };
});
probe('dismissed-only-scope-update-control', () => {
  const root = fixture([req('REQ-A', { links: [dismissed] })]);
  return { root, operation: { updates: [{ id: 'REQ-A', metadata: { scope: 'planned' } }] } };
});
probe('unchanged-relations-must-not-block-assessment-deselection', () => {
  const active = { ...dismissed, id: 'L-CURRENT', origin: 'declared', state: 'active', reason: '文件中已有的当前明确关联，非本次新建' };
  const root = fixture([req('REQ-A', { assessment_id: 'AS-OLD', links: [dismissed, active] })]);
  put(root, 'docs/product/ASSESSMENTS.md', newDocument([{ metadata: { id: 'AS-OLD', type: 'assessment', target: 'REQ-A', target_basis: { kind: 'file', path: 'docs/product/REQ.md', item_id: 'REQ-A' }, target_definition_sha256: null, checked_at: '2026-10-05', subject: { kind: 'unknown', value: null }, implementation: 'unknown', verification: 'unknown' }, body: '## [AS-OLD] 原摘要\n### 覆盖范围\n原记录保留。\n### 交付与验证依据\n原材料，结论未知。\n### 剩余与待核对\n未知范围。\n' }]));
  return { root, operation: { updates: [{ id: 'REQ-A', metadata: { assessment_id: null } }] } };
});
probe('append-after-malformed-item-single-final-newline', () => {
  const root = fixture([req('REQ-KEEP', { unknown: true })]);
  const file = path.join(root, 'docs/product/REQ.md'); fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\n\n$/, '\n'));
  return { root, operation: { append: [req('REQ-NEW')] } };
});
probe('append-after-malformed-item-two-final-newlines-control', () => {
  const root = fixture([req('REQ-KEEP', { unknown: true })]);
  return { root, operation: { append: [req('REQ-NEW')] } };
});
probe('append-with-spaced-flow-yaml-malformed-neighbor', () => {
  const root = fixture();
  put(root, 'docs/product/REQ.md', `---\nschema: vnext-product-doc/v2\nitems: [ { "id" : "REQ-KEEP", "type" : "requirement", "scope" : "current", "unknown" : true } ]\n---\n# 业务资料\n\n${body('REQ-KEEP')}\n`);
  return { root, operation: { append: [req('REQ-NEW')] } };
});
probe('append-after-valid-item-single-final-newline-control', () => {
  const root = fixture(); const file = path.join(root, 'docs/product/REQ.md'); fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\n\n$/, '\n'));
  return { root, operation: { append: [req('REQ-NEW')] } };
});
fs.writeFileSync(path.join(import.meta.dir, 'results.json'), JSON.stringify({ artifacts: Object.fromEntries(Object.entries(versions).map(([name, file]) => [name, sha256(fs.readFileSync(file))])), observations }, null, 2));
