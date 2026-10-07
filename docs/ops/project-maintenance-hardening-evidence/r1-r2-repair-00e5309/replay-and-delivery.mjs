import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(directory, '../..');
const supplied = process.argv[2];
const hash = value => createHash('sha256').update(value).digest('hex');
const fileHash = file => hash(fs.readFileSync(file));
const save = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + '\n');
const put = (root, name, text) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
function run(cli, root, action, input) {
  const child = spawnSync(process.execPath, [cli, action, '--root', root, ...(action === 'install' || action === 'upgrade' ? ['--json'] : [])], { cwd: repo, input: input === undefined ? undefined : JSON.stringify(input), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (!child.stdout) throw new Error(child.stderr || `${action}: no result`);
  return { exit: child.status, stderr: child.stderr, result: JSON.parse(child.stdout) };
}
function copyBusiness(source, destination) {
  fs.mkdirSync(path.join(destination, '.workflow-system'), { recursive: true });
  fs.copyFileSync(path.join(source, '.workflow-system/PRODUCT.yaml'), path.join(destination, '.workflow-system/PRODUCT.yaml'));
  for (const leaf of ['product', 'evidence']) fs.cpSync(path.join(source, 'docs', leaf), path.join(destination, 'docs', leaf), { recursive: true, dereference: false });
  fs.cpSync(path.join(source, '.workflow-system/records'), path.join(destination, '.workflow-system/records'), { recursive: true, dereference: false });
}
const target = path.join(directory, 'upgraded-target-final-v2');
if (fs.existsSync(target) || fs.existsSync(path.join(directory, 'fixtures-v2'))) throw new Error('Use fresh isolated targets; preserve all earlier observations');
fs.mkdirSync(target, { recursive: true });
const initialized = spawnSync('git', ['init', '--initial-branch=codex/r1-r2-fixture', target], { encoding: 'utf8' });
assert.equal(initialized.status, 0, initialized.stderr);
put(target, 'package.json', '{"name":"synthetic-r1-r2-delivery","private":true,"type":"module"}\n');
const oldInstall = run(path.join(repo, '.tmp/maintain-hardening/baseline-source/packages/vibe-governance/dist/cli.js'), target, 'install');
save('old-install.json', oldInstall); assert.equal(oldInstall.exit, 0);
const oldState = JSON.parse(fs.readFileSync(path.join(target, '.workflow-system/vnext/DISTRIBUTION_STATE.json'), 'utf8'));
assert.equal(oldState.distribution_version, '0.24.0');
copyBusiness(path.join(repo, '.tmp/maintain-hardening/host-complete'), target);
const owned = ['.workflow-system/PRODUCT.yaml', 'docs/product/PROJECT.md', 'docs/product/REQUIREMENTS.md', 'docs/product/PLAN.md', 'docs/product/ASSESSMENTS.md', 'docs/product/DISCUSSIONS.md', 'docs/product/raw/interview.txt', 'docs/product/history/plan-before.md', 'docs/product/history/discussion-before.md', 'docs/product/history/legacy-before.md', 'docs/product/history/prior.txt'];
const assets = owned.map(name => ({ path: name, before: fileHash(path.join(target, name)) }));
const upgrade = run(path.join(repo, 'packages/vibe-governance/dist/cli.js'), target, 'upgrade'); save('upgrade.json', upgrade); assert.equal(upgrade.exit, 0);
for (const asset of assets) { asset.after = fileHash(path.join(target, asset.path)); asset.unchanged = asset.before === asset.after; assert(asset.unchanged); }
save('upgrade-assets.json', { target, synthetic_snapshot_only: true, assets });
const newState = JSON.parse(fs.readFileSync(path.join(target, '.workflow-system/vnext/DISTRIBUTION_STATE.json'), 'utf8')); assert.equal(newState.distribution_version, '0.24.1');
const helper = path.join(target, '.workflow-system/runtime/support/product-maintenance.js');
assert.equal(fileHash(helper), fileHash(path.join(repo, 'runtime/vnext/dist/product-maintenance.js')));

const packetPath = path.join(supplied, 'review-write-chain-results.json');
const packet = JSON.parse(fs.readFileSync(packetPath, 'utf8'));
const cases = packet.filter(row => row.label === 'fixed' && (row.name.startsWith('duplicate-dismissed-') || ['F05-introduce-same-value-duplicate-key', 'F05-introduce-unused-anchor', 'F05-duplicate-key-repair', 'F05-anchor-repair'].includes(row.name)));
assert.equal(cases.length, 8);
const summarizeRead = read => ({ exit: read.exit, complete: read.result.coverage.complete, usable: read.result.usable_items.map(item => ({ id: item.id, metadata: item.metadata, body: item.body })), unusable: read.result.unusable_items.map(item => ({ id: item.id, diagnostics: item.diagnostics })), diagnostics: read.result.diagnostics });
const observations = [];
const artifacts = { before: fileHash(path.join(directory, 'pre-fix/product-maintenance.js')), current: fileHash(helper), offline: fileHash(path.join(repo, 'runtime/vnext/support/product-maintenance/offline-reader.js')) };
assert.equal(artifacts.before, '42ca8baf451c48af30f68f5804a932684ea44740427d3b3cda017e87c8109bf5');
for (const row of cases) for (const [label, cli] of [['before', path.join(directory, 'pre-fix/product-maintenance.js')], ['current-installed', helper]]) {
  const root = path.join(directory, 'fixtures-v2', label, row.name);
  put(root, '.workflow-system/PRODUCT.yaml', JSON.stringify({ schema: 'vnext-product-manifest/v2', project_id: 'synthetic-r1-r2-replay', entry: 'docs/product/P.md', managed_paths: ['docs/product/*.md'], source_paths: ['docs/evidence/**'], exclude_paths: [], maintenance: 'enabled' }));
  put(root, 'docs/product/P.md', '---\nschema: vnext-product-doc/v2\nitems: [{"id":"PROJECT-A","type":"project","inventory":{"state":"partial","checked_sources":[],"unreviewed_sources":[]}}]\n---\n## [PROJECT-A] 合成项目\n### 项目定位\n合成复现。\n### 盘点范围与未核对项\n其他范围未验收。\n');
  put(root, 'docs/product/R.md', row.original);
  const before = run(cli, root, 'read', { detail: 'items' }), applied = run(cli, root, 'apply', row.input);
  const after = fs.readFileSync(path.join(root, 'docs/product/R.md'), 'utf8'), readAfter = run(cli, root, 'read', { detail: 'items' });
  const expected = label === 'before' ? row.result.status : row.expect;
  assert.equal(applied.result.status, expected, `${label} ${row.name}`);
  if (expected === 'failed') assert.equal(after, row.original);
  else assert.equal(applied.result.files[0].preimage.data_base64, Buffer.from(row.original).toString('base64'));
  observations.push({ defect: row.name.startsWith('duplicate-dismissed-') ? 'R2' : 'R1', name: row.name, label, expected, input: row.input, original: row.original, after, unchanged: row.original === after, readBefore: summarizeRead(before), applied, readAfter: summarizeRead(readAfter) });
}
save('node-replay.json', { baseline_head: '00e5309e872130f87fc1c33525bf944eb394b824', packet_sha256: fileHash(packetPath), artifacts, observations, expected_results_matched: true, scope: 'deterministic structural replay, not host-Agent business semantic validation' });

const doc = (items, bodies) => '---\nschema: vnext-product-doc/v2\nitems: ' + JSON.stringify(items) + '\n---\n' + bodies.join('\n') + '\n';
const body = id => `## [${id}] 合成明确需求\n### 需求内容\n当前明确维护。\n### 范围边界\n旧业务资产和未改约束保留。\n### 验收要求\n按本次范围核对。\n`;
const initialRead = run(helper, target, 'read', { detail: 'items' }); assert.equal(initialRead.exit, 0);
const projectId = initialRead.result.usable_items.find(item => item.type === 'project').id;
const syntaxPath = 'docs/product/R1-REPAIR.md';
const good = doc([{ id: 'REQ-R1', type: 'requirement', scope: 'current' }, { id: 'REQ-R1-KEEP', type: 'requirement', scope: 'current', unknown: true }], [body('REQ-R1'), body('REQ-R1-KEEP')]);
const malformed = good.replace('"scope":"current"', '"scope":"current","scope":"current"'); put(target, syntaxPath, malformed);
const repaired = run(helper, target, 'apply', { files: [{ path: syntaxPath, expected_sha256: hash(malformed), content: good }] }); save('installed-r1-repair.json', repaired);
assert.equal(repaired.result.status, 'saved'); assert.equal(repaired.result.files[0].preimage.data_base64, Buffer.from(malformed).toString('base64')); assert.equal(fs.readFileSync(path.join(target, syntaxPath), 'utf8'), good);
const historyPath = 'docs/product/R2-REPAIR.md';
const source = { kind: 'text', text: '合成原否定依据', label: '旧依据' }, decision = { kind: 'text', text: '当前用户明确恢复保留的关联。', label: '当前决定' };
const first = { id: 'L-SHARED', relation: 'references', target: projectId, origin: 'inferred', state: 'dismissed', reason: '原否定', sources: [source] }, second = { ...first, target: 'REQ-R1', sources: [source, decision] };
put(target, historyPath, doc([{ id: 'REQ-R2', type: 'requirement', scope: 'current', links: [first, second] }], [body('REQ-R2')]));
const historyInput = (relations, removal = false) => ({ files: [{ path: historyPath, expected_sha256: fileHash(path.join(target, historyPath)), updates: [{ id: 'REQ-R2', metadata: { links: relations } }], ...(removal ? { remove_relations: [{ item_id: 'REQ-R2', field: 'links', id: first.id }] } : {}) }] });
const rejected = run(helper, target, 'apply', historyInput([first])); save('installed-r2-implicit.json', rejected); assert.equal(rejected.exit, 1); assert.match(rejected.result.files[0].error, /DISMISSED_REMOVAL/);
const restored = { ...first, origin: 'declared', state: 'active', reason: decision.text, sources: [source, decision] };
const renewal = run(helper, target, 'apply', historyInput([second, restored])); save('installed-r2-reversal.json', renewal); assert.equal(renewal.result.status, 'saved');
const removed = run(helper, target, 'apply', historyInput([restored], true)); save('installed-r2-removal.json', removed); assert.equal(removed.result.status, 'saved');
const finalRead = run(helper, target, 'read', { detail: 'items' }); save('installed-readback.json', finalRead); assert.equal(finalRead.exit, 0);
assert.deepEqual(finalRead.result.usable_items.find(item => item.id === 'REQ-R2').metadata.links, [restored]);
for (const asset of assets) assert.equal(fileHash(path.join(target, asset.path)), asset.before);
const offlineRoot = path.join(directory, 'offline-consumer-v2'); copyBusiness(target, offlineRoot);
fs.copyFileSync(path.join(repo, 'runtime/vnext/support/product-maintenance/offline-reader.js'), path.join(offlineRoot, 'reader.mjs'));
const child = spawnSync(process.execPath, [path.join(offlineRoot, 'reader.mjs'), offlineRoot], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const consumer = JSON.parse(child.stdout); save('offline-readback.json', { exit: child.status, result: consumer }); assert.equal(child.status, 0);
assert.deepEqual(consumer.items.map(item => item.id).sort(), finalRead.result.usable_items.map(item => item.id).sort());
assert.deepEqual(consumer.items.find(item => item.id === 'REQ-R2').metadata.links, [restored]);
assert(consumer.diagnostics.some(d => d.item_id === 'REQ-R1-KEEP' && d.severity === 'error'));
assert(!fs.existsSync(path.join(offlineRoot, '.workflow-system/runtime'))); assert(!fs.existsSync(path.join(offlineRoot, 'node_modules')));
const summary = { versions: { from: oldState.distribution_version, to: newState.distribution_version }, assets_unchanged: assets.length, artifacts, node_cases: cases.length, node_observations: observations.length, expected_results_matched: true, installed_repair_saved: true, installed_reversal_saved: true, installed_partial_removal_saved: true, offline_ids_match: true, original_business_assets_still_unchanged: true, byte_coverage_complete: finalRead.result.coverage.complete, usable_count: finalRead.result.usable_items.length, unusable_count: finalRead.result.unusable_items.length, offline_has_runtime: false, offline_has_node_modules: false, host_agent_semantics_replayed: false, open_findings: ['R3', 'R4'] };
save('delivery-summary.json', summary); console.log(JSON.stringify(summary, null, 2));
