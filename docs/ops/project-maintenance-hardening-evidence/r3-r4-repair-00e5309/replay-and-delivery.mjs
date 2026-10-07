import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const directory = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(directory, '../..'), supplied = process.argv[2];
const hash = bytes => createHash('sha256').update(bytes).digest('hex'), fileHash = file => hash(fs.readFileSync(file));
const save = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + '\n');
const put = (root, relative, bytes) => { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); };
function run(cli, root, action, input) {
  const child = spawnSync(process.execPath, [cli, action, '--root', root, ...(['install', 'upgrade'].includes(action) ? ['--json'] : [])], { cwd: repo, input: input === undefined ? undefined : JSON.stringify(input), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  assert(child.stdout, child.stderr); return { exit: child.status, stderr: child.stderr, result: JSON.parse(child.stdout) };
}
function copyBusiness(source, destination) {
  fs.mkdirSync(path.join(destination, '.workflow-system'), { recursive: true }); fs.copyFileSync(path.join(source, '.workflow-system/PRODUCT.yaml'), path.join(destination, '.workflow-system/PRODUCT.yaml'));
  for (const leaf of ['product', 'evidence']) fs.cpSync(path.join(source, 'docs', leaf), path.join(destination, 'docs', leaf), { recursive: true, dereference: false });
  fs.cpSync(path.join(source, '.workflow-system/records'), path.join(destination, '.workflow-system/records'), { recursive: true, dereference: false });
}
const target = path.join(directory, 'upgraded-target'), fixtures = path.join(directory, 'fixtures');
assert(!fs.existsSync(target) && !fs.existsSync(fixtures), 'Use fresh isolated targets and retain earlier results'); fs.mkdirSync(target);
const initialized = spawnSync('git', ['init', '--initial-branch=codex/r3-r4-fixture', target], { encoding: 'utf8' }); assert.equal(initialized.status, 0, initialized.stderr);
put(target, 'package.json', '{"name":"synthetic-r3-r4-delivery","private":true,"type":"module"}\n');
const oldInstall = run(path.join(repo, '.tmp/maintain-hardening/baseline-source/packages/vibe-governance/dist/cli.js'), target, 'install'); save('old-install.json', oldInstall); assert.equal(oldInstall.exit, 0);
const stateFile = path.join(target, '.workflow-system/vnext/DISTRIBUTION_STATE.json'); assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).distribution_version, '0.24.0');
copyBusiness(path.join(repo, '.tmp/maintain-hardening/host-complete'), target);
const owned = ['.workflow-system/PRODUCT.yaml', 'docs/product/PROJECT.md', 'docs/product/REQUIREMENTS.md', 'docs/product/PLAN.md', 'docs/product/ASSESSMENTS.md', 'docs/product/DISCUSSIONS.md', 'docs/product/raw/interview.txt', 'docs/product/history/plan-before.md', 'docs/product/history/discussion-before.md', 'docs/product/history/legacy-before.md', 'docs/product/history/prior.txt'];
const assets = owned.map(relative => ({ path: relative, before: fileHash(path.join(target, relative)) }));
const upgrade = run(path.join(repo, 'packages/vibe-governance/dist/cli.js'), target, 'upgrade'); save('upgrade.json', upgrade); assert.equal(upgrade.exit, 0);
assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).distribution_version, '0.24.1');
for (const asset of assets) { asset.after = fileHash(path.join(target, asset.path)); asset.unchanged = asset.before === asset.after; assert(asset.unchanged); } save('upgrade-assets.json', { synthetic_snapshot_only: true, target, assets });
const helper = path.join(target, '.workflow-system/runtime/support/product-maintenance.js');
const reader = path.join(target, '.workflow-system/runtime/support/product-maintenance/offline-reader.js');
assert.equal(fileHash(helper), fileHash(path.join(repo, 'runtime/vnext/dist/product-maintenance.js'))); assert.equal(fileHash(reader), fileHash(path.join(repo, 'runtime/vnext/support/product-maintenance/offline-reader.js')));
const readerCopies = {};
for (const [label, source] of [['before', path.join(directory, 'pre-fix/offline-reader.js')], ['current-installed', reader]]) { readerCopies[label] = path.join(directory, label + '-reader.mjs'); fs.copyFileSync(source, readerCopies[label]); }
function offline(label, root) { const child = spawnSync(process.execPath, [readerCopies[label], root], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }); assert(child.stdout, child.stderr); return { exit: child.status, stderr: child.stderr, result: JSON.parse(child.stdout) }; }
const artifacts = { before: fileHash(path.join(directory, 'pre-fix/product-maintenance.js')), before_offline: fileHash(path.join(directory, 'pre-fix/offline-reader.js')), current: fileHash(helper), offline: fileHash(reader) };
assert.equal(artifacts.before, 'a6df4d52ce65efa9d6ed106f86696ded8ddb3f1df896a625d2cd095d1a84dce3');
const P = 'docs/product/PROJECT.md', M = 'docs/product/MISSING.md', prefix = 'docs/product/section', glob = prefix + '/*.md';
const project = fs.readFileSync(path.join(repo, 'runtime/vnext/support/product-maintenance/templates/PROJECT.md'), 'utf8');
const requirement = id => '---\nschema: vnext-product-doc/v2\nitems: ' + JSON.stringify([{ id, type: 'requirement', scope: 'current' }]) + `\n---\n## [${id}] 合成需求\n### 需求内容\n当前明确范围。\n### 范围边界\n原排除项保留。\n### 验收要求\n按本次证据核对。\n`;
const packetPath = path.join(supplied, 'review-read-probes.json'), packet = JSON.parse(fs.readFileSync(packetPath, 'utf8'));
const original = packet.results.filter(row => ['default detects missing explicit registered file', 'broad selection hides missing explicit registration', 'file glob prefix', 'file glob prefix check'].includes(row.name)); assert.equal(original.length, 4);
const cases = original.map((row, index) => ({ name: row.name, source: 'original-review', key: 'original-' + index, managed: row.name.startsWith('file glob') ? [P, glob] : [P, M], files: row.name.startsWith('file glob') ? { [prefix]: 'replaced directory' } : {}, input: row.input, action: row.action, before: row.coverage.complete, after: false }));
cases.push(
  { key: 'unselected-registration', name: 'unselected registration stays outside scope', managed: [P, M], input: { paths: [P] }, before: true, after: true },
  { key: 'empty-glob', name: 'successful zero match in readable directory', managed: [P, M], input: { paths: ['docs/product/NOT-*.md'] }, before: true, after: true },
  { key: 'excluded-registration', name: 'excluded concrete registration is not omitted', managed: [P, M], excludes: [M], input: { paths: ['docs/product/*.md'] }, before: true, after: true },
  { key: 'empty-directory', name: 'empty real glob directory is complete', managed: [P, glob], directories: [prefix], before: true, after: true },
  { key: 'unselected-prefix', name: 'unselected file prefix is not expanded', managed: [P, glob], files: { [prefix]: 'ordinary file' }, input: { paths: [P] }, before: true, after: true },
  { key: 'excluded-prefix', name: 'excluded required directory prefix remains excluded', managed: [P, glob], files: { [prefix]: 'ordinary file' }, excludes: [prefix], before: true, after: true },
  { key: 'ordinary-files', name: 'wildcard nonmatching files and source tree remain unread', managed: ['docs/product/**/*.md'], files: { 'docs/product/ordinary-file': 'not a document match', 'docs/evidence/SHOULD-NOT-SCAN.md': requirement('REQ-HIDDEN') }, sourceJunction: true, before: true, after: true },
  { key: 'relevant-junction', name: 'relevant real Windows junction is skipped', managed: ['docs/product/**/*.md'], junction: true, before: false, after: false },
  { key: 'excluded-junction', name: 'excluded real Windows junction is not followed', managed: ['docs/product/**/*.md'], junction: true, excludes: ['docs/product/linked'], before: true, after: true },
  { key: 'file-budget', name: 'file budget retains omitted ranges', managed: ['docs/product/*.md'], files: { 'docs/product/R.md': requirement('REQ-BUDGET') }, input: { max_files: 1 }, before: false, after: false }
);
const outside = path.join(directory, 'junction-target'); put(outside, 'HIDDEN.md', requirement('REQ-HIDDEN'));
const observations = [];
for (const recipe of cases) for (const [label, cli] of [['before', path.join(directory, 'pre-fix/product-maintenance.js')], ['current-installed', helper]]) {
  const root = path.join(fixtures, label, recipe.key), input = recipe.input ?? {}, action = recipe.action ?? 'read';
  const manifest = { schema: 'vnext-product-manifest/v2', project_id: 'synthetic-r3-r4-read', entry: P, managed_paths: recipe.managed, source_paths: ['docs/evidence/**'], capture_paths: [], exclude_paths: recipe.excludes ?? [], maintenance: 'enabled' };
  const files = { '.workflow-system/PRODUCT.yaml': JSON.stringify(manifest), [P]: project, ...(recipe.files ?? {}) };
  for (const [relative, bytes] of Object.entries(files)) put(root, relative, bytes);
  for (const relative of recipe.directories ?? []) fs.mkdirSync(path.join(root, relative), { recursive: true });
  if (recipe.junction) fs.symlinkSync(outside, path.join(root, 'docs/product/linked'), process.platform === 'win32' ? 'junction' : 'dir');
  if (recipe.sourceJunction) fs.symlinkSync(outside, path.join(root, 'docs/evidence/linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const expected = label === 'before' ? recipe.before : recipe.after, result = run(cli, root, action, input);
  assert.equal(result.result.coverage.complete, expected, `${label} ${recipe.name}`); assert.equal(result.exit, expected ? 0 : 1);
  assert.equal(result.result.development_gate, false); assert(!result.result.coverage.omitted.some(relative => relative.startsWith('docs/evidence/')));
  if (action === 'read') assert(!result.result.usable_items.some(item => item.id === 'REQ-HIDDEN'));
  for (const [relative, bytes] of Object.entries(files)) assert.equal(fs.readFileSync(path.join(root, relative), 'utf8'), bytes);
  observations.push({ name: recipe.name, source: recipe.source ?? 'filesystem-control', label, expected_complete: expected, fixture: { manifest, files, directories: recipe.directories ?? [], real_junction: !!recipe.junction, source_junction: !!recipe.sourceJunction }, input, action, response: result, fixture_bytes_unchanged: true });
  // The offline CLI has no paths/budget selection: compare only its real default interface.
  if (action === 'read' && !Object.keys(input).length) {
    const consumer = offline(label, root); assert.equal(consumer.result.coverage.complete, expected); assert.equal(consumer.exit, expected ? 0 : 1);
    observations.push({ name: recipe.name, source: recipe.source ?? 'filesystem-control', label: 'offline-' + label, input: 'default only; no paths option', expected_complete: expected, response: consumer });
  }
}
save('node-replay.json', { packet_sha256: fileHash(packetPath), artifacts, original_case_count: original.length, control_case_count: cases.length - original.length, observations, expected_results_matched: true, scope: 'deterministic helper/offline I/O evidence; no host-Agent business semantic replay' });

const manifestFile = path.join(target, '.workflow-system/PRODUCT.yaml'), manifestBytes = fs.readFileSync(manifestFile);
const initial = run(helper, target, 'read', { detail: 'items' }); assert.equal(initial.exit, 0);
const gapManifest = { ...initial.result.manifest, managed_paths: [...initial.result.manifest.managed_paths, M, 'docs/outside/UNSELECTED.md'] };
fs.writeFileSync(manifestFile, JSON.stringify(gapManifest));
const gap = run(helper, target, 'read', { paths: ['docs/product/*.md'] }); save('installed-r3-selected-gap.json', gap); assert.equal(gap.exit, 1); assert.deepEqual(gap.result.coverage.omitted, [M]);
const newPath = 'docs/product/R34-INDEPENDENT.md', text = requirement('REQ-R34-INDEPENDENT');
const saved = run(helper, target, 'apply', { files: [{ path: newPath, expected_sha256: null, content: text }] }); save('installed-independent-save.json', saved); assert.equal(saved.result.status, 'saved');
const scopedRead = run(helper, target, 'read', { paths: [newPath], detail: 'items' }); save('installed-scoped-read.json', scopedRead); assert.equal(scopedRead.exit, 0); assert.equal(scopedRead.result.usable_items[0].id, 'REQ-R34-INDEPENDENT');
const prefixBytes = '合成目录被手工替换成普通文件，保留这些原始字节。'; put(target, prefix, prefixBytes);
const prefixManifest = { ...initial.result.manifest, managed_paths: [...initial.result.manifest.managed_paths, glob] }; fs.writeFileSync(manifestFile, JSON.stringify(prefixManifest));
for (const action of ['read', 'check']) { const result = run(helper, target, action, {}); save('installed-r4-' + action + '.json', result); assert.equal(result.exit, 1); assert.deepEqual(result.result.coverage.omitted, [prefix]); }
assert.equal(fs.readFileSync(path.join(target, prefix), 'utf8'), prefixBytes);
fs.writeFileSync(manifestFile, manifestBytes);
const final = run(helper, target, 'read', { detail: 'items' }); save('installed-final-read.json', final); assert.equal(final.exit, 0);
for (const asset of assets) assert.equal(fileHash(path.join(target, asset.path)), asset.before);
const offlineRoot = path.join(directory, 'offline-consumer'); copyBusiness(target, offlineRoot);
const consumer = offline('current-installed', offlineRoot); save('offline-final-read.json', consumer); assert.equal(consumer.exit, 0);
assert.deepEqual(consumer.result.items.map(item => item.id).sort(), final.result.usable_items.map(item => item.id).sort());
assert(!fs.existsSync(path.join(offlineRoot, '.workflow-system/runtime')) && !fs.existsSync(path.join(offlineRoot, 'node_modules')));
fs.writeFileSync(path.join(offlineRoot, '.workflow-system/PRODUCT.yaml'), JSON.stringify(prefixManifest));
const badOffline = offline('current-installed', offlineRoot); save('offline-r4-gap.json', badOffline); assert.equal(badOffline.exit, 1); assert.deepEqual(badOffline.result.coverage.omitted, [prefix]);
const summary = { versions: { from: '0.24.0', to: '0.24.1' }, assets_unchanged_during_upgrade: assets.length, original_business_assets_restored_exactly: true, artifacts, original_read_cases: original.length, control_cases: cases.length - original.length, helper_observations: observations.filter(row => !row.label.startsWith('offline-')).length, offline_observations: observations.filter(row => row.label.startsWith('offline-')).length, expected_results_matched: true, installed_r3_incomplete: !gap.result.coverage.complete, independent_save_and_scoped_read_succeeded: true, installed_r4_incomplete: true, offline_r4_incomplete: !badOffline.result.coverage.complete, final_helper_offline_ids_match: true, final_byte_coverage_complete: final.result.coverage.complete, usable_count: final.result.usable_items.length, unusable_count: final.result.unusable_items.length, offline_has_runtime: false, offline_has_node_modules: false, real_windows_junctions_exercised: process.platform === 'win32', host_agent_semantics_replayed: false, scoped_findings_addressed: ['R3', 'R4'] };
save('delivery-summary.json', summary); console.log(JSON.stringify(summary, null, 2));
