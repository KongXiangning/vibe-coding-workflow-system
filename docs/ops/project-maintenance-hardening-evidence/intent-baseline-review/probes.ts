import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import { stringify } from 'yaml';
import { parseProduct, sha256 } from '../../runtime/vnext/src/product-maintenance/parser';
import { newDocument } from '../../runtime/vnext/src/product-maintenance/writer';

// Deterministic synthetic probes, not host-agent or real-business acceptance.
const repo = path.resolve(import.meta.dir, '../..');
const helper = path.join(repo, 'runtime/vnext/dist/product-maintenance.js');
const assistance = path.join(repo, 'runtime/vnext/support/assistance.mjs');
const observations: any[] = [];
const output = path.join(import.meta.dir, 'results.json');
const protectedFiles = ['runtime/vnext/src/product-maintenance/writer.ts', 'runtime/vnext/src/product-maintenance/schemas.ts', 'runtime/vnext/dist/product-maintenance.js', 'templates/vnext/skills/maintain-project.SKILL.md.tmpl', 'runtime/vnext/support/assistance.mjs'];
const digests = () => Object.fromEntries(protectedFiles.map(p => [p, sha256(fs.readFileSync(path.join(repo, p)))]));
const sourceBefore = digests();
function checkpoint() { fs.writeFileSync(output, JSON.stringify({ artifact_sha256: sha256(fs.readFileSync(helper)), sourceBefore, observations, scope: 'deterministic isolated-fixture review probes; known defects intentionally remain' }, null, 2)); }
function ensure(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function put(root: string, file: string, bytes: string | Buffer) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), bytes); }
function body(id: string, type = 'requirement') {
  const sections: Record<string, string[]> = { requirement: ['需求内容', '范围边界', '验收要求'], project: ['项目定位', '盘点范围与未核对项'], goal: ['目标说明', '范围边界'], design: ['设计方案', '约束与取舍', '实际实现与差异'] };
  return `## [${id}] ${id}\n${sections[type]!.map(s => `### ${s}\n保留实际要求与未核对范围。`).join('\n')}\n`;
}
const req = (id = 'REQ-A', extra = {}) => ({ metadata: { id, type: 'requirement', scope: 'current', ...extra }, body: body(id) });
function fixture(items = [req()]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maintain-intent-review-'));
  put(root, '.workflow-system/PRODUCT.yaml', stringify({ schema: 'vnext-product-manifest/v2', project_id: 'intent-review-fixture', entry: 'docs/product/PROJECT.md', managed_paths: ['docs/product/*.md'], source_paths: ['docs/evidence/**'], capture_paths: ['docs/evidence/history/**'], exclude_paths: [], maintenance: 'enabled' }));
  put(root, 'docs/product/PROJECT.md', newDocument([{ metadata: { id: 'PROJECT-A', type: 'project', inventory: { state: 'partial', checked_sources: [], unreviewed_sources: [] } }, body: body('PROJECT-A', 'project') }]));
  put(root, 'docs/product/REQ.md', newDocument(items));
  return root;
}
function call(binary: string, action: string, root: string, request: any, label: string) {
  const run = spawnSync('node', [binary, action, '--root', root], { input: JSON.stringify(request), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  ensure(run.stdout, `${label}: no output ${run.stderr}`);
  const result = JSON.parse(run.stdout);
  observations.push({ label, root, action, request, exit: run.status, result, stderr: run.stderr });
  checkpoint();
  console.log(JSON.stringify({ label, exit: run.status, status: result.status, saved: result.saved ?? result.files?.map((f: any) => f.saved), error: result.error ?? result.files?.find((f: any) => f.error)?.error, development_gate: result.development_gate, recorded: result.recorded, association: result.association }));
  return result;
}
function apply(root: string, operation: any, label: string, file = 'docs/product/REQ.md') {
  const before = fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file)) : null;
  const result = call(helper, 'apply', root, { files: [{ path: file, expected_sha256: before ? sha256(before) : null, ...operation }] }, label);
  const after = fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file)) : null;
  Object.assign(observations.at(-1), { before_base64: before?.toString('base64'), after_base64: after?.toString('base64') });
  checkpoint();
  if (result.status === 'failed') ensure(before?.equals(after!), `${label}: failed apply changed bytes`);
  ensure(result.development_gate === false, `${label}: unexpected gate`);
  return result;
}
function read(root: string, label: string) { return call(helper, 'read', root, { detail: 'items' }, label); }
const source = { kind: 'text', text: '此前相同材料', label: '原材料' };
const dismissed = { id: 'L-OLD', relation: 'references', target: 'PROJECT-A', origin: 'inferred', state: 'dismissed', reason: '此前用户否定；当前没有改变该决定', sources: [source] };
const active = { ...dismissed, id: 'L-CURRENT', origin: 'declared', state: 'active', reason: '此前已有的明确当前关联；本次保持不变' };

const formatRoot = fixture([req('REQ-A', { links: [{ ...dismissed, sources: [{ ...source, unknown: true }] }] })]);
const wrongRevival = apply(formatRoot, { updates: [{ id: 'REQ-A', metadata: { links: [{ ...dismissed, state: 'active', reason: '只清理未知字段；原业务否定不变' }] } }] }, 'C01-defect-format-only-wrongly-revives');
ensure(wrongRevival.status === 'saved', 'C01 defect not reproduced');

const explicitRoot = fixture([req('REQ-A', { links: [{ ...dismissed, sources: [{ ...source, unknown: true }] }] })]);
ensure(apply(explicitRoot, { updates: [{ id: 'REQ-A', metadata: { links: [dismissed] } }] }, 'C01-format-repair-retains-dismissed').status === 'saved', 'format repair failed');
const oldBasisAttempt = apply(explicitRoot, { updates: [{ id: 'REQ-A', metadata: { links: [{ ...dismissed, state: 'active', reason: '仅重试同一材料；无当前改变决定' }] } }] }, 'C01-same-basis-candidate-is-protected');
ensure(oldBasisAttempt.files[0].error.startsWith('DISMISSED_RELATION:'), 'same-basis guard missing');
const reversal = { kind: 'text', text: '合成当前指令：我改变此前否定，现在重新关联到 PROJECT-A。', label: 'synthetic-current-explicit-user-decision' };
ensure(apply(explicitRoot, { updates: [{ id: 'REQ-A', metadata: { links: [{ ...dismissed, origin: 'declared', state: 'active', reason: reversal.text, sources: [source, reversal] }] } }] }, 'C01-explicit-user-reversal-no-external-material').status === 'saved', 'explicit reversal blocked');
ensure(read(explicitRoot, 'C01-readback-explicit-reversal').usable_items.find((i: any) => i.id === 'REQ-A').metadata.links[0].state === 'active', 'reversal missing');

const scopeRoot = fixture([req('REQ-A', { links: [dismissed, active] })]);
const scopeBefore = fs.readFileSync(path.join(scopeRoot, 'docs/product/REQ.md'));
const scopeFailure = apply(scopeRoot, { updates: [{ id: 'REQ-A', metadata: { scope: 'planned' } }] }, 'C02-defect-unrelated-scope-change-rejected');
ensure(scopeFailure.files[0].error.startsWith('DISMISSED_RELATION:'), 'C02 defect not reproduced');
ensure(call(helper, 'capture', scopeRoot, { path: 'docs/evidence/history/REQ.pre-scope.md', base64: scopeBefore.toString('base64') }, 'C02-save-original-after-helper-failure').saved, 'history capture failed');
const parsedScope = parseProduct(scopeBefore.toString(), 'docs/product/REQ.md');
const selected = parsedScope.items.find(i => i.id === 'REQ-A')!;
const priorMap = parsedScope.text.slice(selected.metadata_start, selected.metadata_end);
const nextMap = JSON.stringify({ ...selected.metadata, scope: 'planned' }) + (priorMap.endsWith('\n') ? '\n' : '');
const rawCandidate = parsedScope.text.slice(0, selected.metadata_start) + nextMap + parsedScope.text.slice(selected.metadata_end);
ensure(call(helper, 'check', scopeRoot, { path: 'docs/product/REQ.md', content: rawCandidate }, 'C02-authorized-editor-candidate-structure').status === 'valid', 'raw scope candidate invalid');
ensure(fs.readFileSync(path.join(scopeRoot, 'docs/product/REQ.md')).equals(scopeBefore), 'scope version changed before editor write');
put(scopeRoot, 'docs/product/REQ.md', rawCandidate);
observations.push({ label: 'C02-synthetic-ordinary-editor-exact-selected-map-only', root: scopeRoot, before_base64: scopeBefore.toString('base64'), after_base64: Buffer.from(rawCandidate).toString('base64'), helper_saved: false, method: 'ordinary authorized editor in isolated fixture; original captured; read version rechecked' });
const scopeRead = read(scopeRoot, 'C02-readback-editor-result');
const scopeItem = scopeRead.usable_items.find((i: any) => i.id === 'REQ-A');
ensure(scopeItem.metadata.scope === 'planned' && JSON.stringify(scopeItem.metadata.links) === JSON.stringify([dismissed, active]), 'scope editor result lost relations');

for (const flow of [false, true]) {
  const root = fixture([req('REQ-KEEP', { unknown: true })]);
  const original = flow ? `---\nschema: vnext-product-doc/v2\nitems: [ { "id" : "REQ-KEEP", "type" : "requirement", "scope" : "current", "unknown" : true } ]\n---\n# 业务资料\n\n${body('REQ-KEEP')}\n` : fs.readFileSync(path.join(root, 'docs/product/REQ.md'), 'utf8').replace(/\n\n$/, '\n');
  put(root, 'docs/product/REQ.md', original);
  const label = flow ? 'flow-map' : 'single-final-newline';
  const failure = apply(root, { append: [req('REQ-NEW')] }, `C03-defect-append-${label}`);
  ensure(failure.files[0].error.startsWith('INVALID_ITEM_CHANGED:'), `C03 ${label} defect missing`);
  let candidate: string;
  if (flow) {
    const closing = original.indexOf(' ]\n---');
    ensure(closing >= 0, 'flow fixture location unavailable');
    candidate = original.slice(0, closing) + ', ' + JSON.stringify(req('REQ-NEW').metadata) + original.slice(closing);
  } else {
    const frontmatterEnd = original.indexOf('\n---\n', 4);
    candidate = original.slice(0, frontmatterEnd) + '\n  - ' + JSON.stringify(req('REQ-NEW').metadata) + original.slice(frontmatterEnd);
  }
  candidate += body('REQ-NEW');
  ensure(apply(root, { content: candidate }, `C03-exact-whole-candidate-add-${label}`).status === 'saved', `C03 exact candidate blocked ${label}`);
  const old = parseProduct(original, 'docs/product/REQ.md').items[0]!;
  const next = parseProduct(candidate, 'docs/product/REQ.md').items.find(i => i.id === 'REQ-KEEP')!;
  ensure(old.body === next.body && original.slice(old.metadata_start, old.metadata_end) === candidate.slice(next.metadata_start, next.metadata_end), 'unrelated malformed neighbor changed');
  ensure(read(root, `C03-readback-new-item-${label}`).usable_items.some((i: any) => i.id === 'REQ-NEW'), 'new item missing');
}

const splitRoot = fixture([req('REQ-A'), req('REQ-KEEP', { unknown: true })]);
const splitFile = path.join(splitRoot, 'docs/product/REQ.md');
put(splitRoot, 'docs/product/REQ.md', fs.readFileSync(splitFile, 'utf8').replace(/\n\n$/, '\n'));
const splitOriginal = fs.readFileSync(splitFile, 'utf8');
const children = ['REQ-CHILD-A', 'REQ-CHILD-B'].map(id => req(id, { links: [{ id: `FROM-${id}`, relation: 'derived_from', target: 'REQ-A', origin: 'declared', state: 'active' }] }));
ensure(apply(splitRoot, { updates: [{ id: 'REQ-A', metadata: { scope: 'retired' } }], append: children }, 'C03-defect-split-same-file-with-malformed-neighbor').status === 'failed', 'split defect missing');
const splitRequest = { files: [
  { path: 'docs/product/SPLIT.md', expected_sha256: null, content: newDocument(children) },
  { path: 'docs/product/REQ.md', expected_sha256: sha256(splitOriginal), updates: [{ id: 'REQ-A', metadata: { scope: 'retired', links: children.map(child => ({ id: `TO-${child.metadata.id}`, relation: 'replaces', target: child.metadata.id, origin: 'declared', state: 'active' })) } }] },
] };
ensure(call(helper, 'apply', splitRoot, splitRequest, 'C03-split-existing-authorized-file-paths').files.every((f: any) => f.saved), 'split alternate path failed');
const splitRead = read(splitRoot, 'C03-readback-split-identities-and-history');
ensure(splitRead.usable_items.find((i: any) => i.id === 'REQ-A').metadata.scope === 'retired', 'old split identity missing');
ensure(children.every(child => splitRead.usable_items.some((i: any) => i.id === child.metadata.id)), 'children missing');
const oldBad = parseProduct(splitOriginal, 'docs/product/REQ.md').items.find(i => i.id === 'REQ-KEEP')!;
const splitSaved = fs.readFileSync(splitFile, 'utf8');
const newBad = parseProduct(splitSaved, 'docs/product/REQ.md').items.find(i => i.id === 'REQ-KEEP')!;
ensure(oldBad.body === newBad.body && splitOriginal.slice(oldBad.metadata_start, oldBad.metadata_end) === splitSaved.slice(newBad.metadata_start, newBad.metadata_end), 'split changed malformed neighbor');

const additional = [
  { metadata: { id: 'GOAL-NEW', type: 'goal', scope: 'current' }, body: body('GOAL-NEW', 'goal') },
  { metadata: { id: 'DESIGN-NEW', type: 'design', intent_state: 'proposed' }, body: body('DESIGN-NEW', 'design') },
];
ensure(apply(splitRoot, { content: newDocument(additional) }, 'independent-goal-and-design-after-maintenance-failure', 'docs/product/NEW.md').status === 'saved', 'independent goal/design blocked');
const savedObservation = call(assistance, 'record', splitRoot, { kind: 'observation', body: { test_fixture: true, original_failure: 'INVALID_ITEM_CHANGED', user_intent: 'synthetic split/new goal/new design', alternative_saved: true }, idempotency_key: 'intent-review-observation-1' }, 'assistance-record-after-maintenance-failure');
ensure(savedObservation.recorded === true && savedObservation.development_gate === false, 'observation blocked');
const prepared = call(assistance, 'task', splitRoot, { action: 'prepare', plan: { title: '合成任务准备检查', goal: '验证 PRODUCT 坏条目和维护失败不构成任务门槛', steps: [{ id: 'S1', title: '后续明确工作' }] }, idempotency_key: 'intent-review-prepare-1' }, 'assistance-prepare-after-maintenance-failure');
ensure(prepared.recorded === true && prepared.task_id && prepared.association === 'applied', 'prepare unavailable or unassociated');
const taskRead = call(assistance, 'task-status', splitRoot, { task_ref: prepared.task_id, detail: 'task' }, 'assistance-readback-no-product-gate');
ensure(taskRead.task?.task_id === prepared.task_id && taskRead.task.lifecycle === 'draft', 'fixture task missing');
ensure(read(splitRoot, 'final-readback-goal-design-split').usable_items.some((i: any) => i.id === 'DESIGN-NEW'), 'design missing');
const sourceAfter = digests();
ensure(JSON.stringify(sourceBefore) === JSON.stringify(sourceAfter), 'source/artifact changed during read-only audit');
fs.writeFileSync(output, JSON.stringify({ artifact_sha256: sha256(fs.readFileSync(helper)), sourceBefore, sourceAfter, no_product_code_edit: true, observations, limits: ['deterministic synthetic probes; no host-agent compliance proof', 'ordinary-editor fallback is demonstrated, not automated by helper', 'no independent review, real-project or cross-model acceptance', 'known defects intentionally remain; probe script success is not overall product PASS'] }, null, 2));
console.log(JSON.stringify({ observed_calls: observations.length, known_defects_reproduced: ['C01', 'C02', 'C03'], verified_routes: ['explicit-current-user-reversal', 'ordinary-editor-scope-repair-with-history', 'exact-whole-candidate-append', 'authorized-split-separate-file', 'new-goal-design', 'assistance-record-and-prepare'], no_product_code_edit: true, result: 'review-evidence-collected; known defects remain' }));
