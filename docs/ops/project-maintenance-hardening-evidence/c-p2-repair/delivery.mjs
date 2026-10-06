import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const directory = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(directory, '../..');
const target = path.join(directory, 'host-final');
const dataset = path.join(repo, '.tmp/maintain-hardening/host-complete');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const save = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2));
function execute(name, executable, args, input) {
  const result = spawnSync(executable, args, { cwd: repo, input: input ? JSON.stringify(input) : undefined, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const value = JSON.parse(result.stdout); save(name, { exit: result.status, stderr: result.stderr, result: value });
  if (result.status !== 0) throw new Error(`${name}: ${value.status}`);
  return value;
}
function copyData(destination) {
  fs.mkdirSync(path.join(destination, '.workflow-system'), { recursive: true });
  fs.copyFileSync(path.join(dataset, '.workflow-system/PRODUCT.yaml'), path.join(destination, '.workflow-system/PRODUCT.yaml'));
  for (const leaf of ['product', 'evidence']) fs.cpSync(path.join(dataset, 'docs', leaf), path.join(destination, 'docs', leaf), { recursive: true, dereference: false });
}
if (fs.existsSync(target)) throw new Error('Use a fresh isolated delivery target; no existing candidate is overwritten');
fs.mkdirSync(target, { recursive: true });
const initialized = spawnSync('git', ['init', '--initial-branch=codex/p2-fixture', target], { encoding: 'utf8' });
if (initialized.status !== 0) throw new Error(initialized.stderr);
fs.writeFileSync(path.join(target, 'package.json'), '{"name":"synthetic-p2-delivery","private":true,"type":"module"}\n');
execute('delivery-old-install.json', 'node', [path.join(repo, '.tmp/maintain-hardening/baseline-source/packages/vibe-governance/dist/cli.js'), 'install', '--root', target, '--json']);
copyData(target);
fs.cpSync(path.join(dataset, '.workflow-system/records'), path.join(target, '.workflow-system/records'), { recursive: true, dereference: false });
const assets = ['.workflow-system/PRODUCT.yaml', 'docs/product/PROJECT.md', 'docs/product/REQUIREMENTS.md', 'docs/product/PLAN.md', 'docs/product/ASSESSMENTS.md', 'docs/product/DISCUSSIONS.md', 'docs/product/raw/interview.txt', 'docs/product/history/plan-before.md', 'docs/product/history/discussion-before.md', 'docs/product/history/legacy-before.md', 'docs/product/history/prior.txt'].map(p => ({ path: p, before: hash(path.join(target, p)) }));
execute('delivery-upgrade.json', 'node', [path.join(repo, 'packages/vibe-governance/dist/cli.js'), 'upgrade', '--root', target, '--json']);
for (const asset of assets) { asset.after = hash(path.join(target, asset.path)); asset.unchanged = asset.before === asset.after; }
save('upgrade-assets.json', { dataset, target, fixture_snapshot_only: true, assets });
if (assets.some(a => !a.unchanged)) throw new Error('Business asset changed during upgrade');
const helper = path.join(target, '.workflow-system/runtime/support/product-maintenance.js');
const read = execute('delivery-read.json', 'node', [helper, 'read', '--root', target], { detail: 'items' });
const tasks = execute('delivery-task-status.json', 'node', [path.join(target, '.workflow-system/runtime/support/assistance.mjs'), 'task-status', '--root', target], {});
const offline = path.join(directory, 'offline-final');
if (fs.existsSync(offline)) throw new Error('Offline target must be new');
copyData(offline); fs.copyFileSync(path.join(repo, 'runtime/vnext/support/product-maintenance/offline-reader.js'), path.join(offline, 'reader.mjs'));
const consumer = execute('offline-read.json', 'node', [path.join(offline, 'reader.mjs'), offline]);
const result = { helper_sha256: hash(helper), source_helper_sha256: hash(path.join(repo, 'runtime/vnext/dist/product-maintenance.js')), offline_sha256: hash(path.join(offline, 'reader.mjs')), upgrade_assets_unchanged: assets.filter(a => a.unchanged).length, asset_count: assets.length, managed_files: read.coverage.files_read, usable: read.coverage.usable_count, invalid: read.coverage.invalid_count, byte_coverage_complete: read.coverage.complete, offline_matches_ids: JSON.stringify(read.usable_items.map(i => i.id).sort()) === JSON.stringify(consumer.items.map(i => i.id).sort()), task_lifecycle_counts: tasks.lifecycle_counts, offline_has_runtime: fs.existsSync(path.join(offline, '.workflow-system/runtime')), offline_has_node_modules: fs.existsSync(path.join(offline, 'node_modules')), business_semantics_replayed: false };
save('delivery-summary.json', result); console.log(JSON.stringify(result, null, 2));
if (result.helper_sha256 !== result.source_helper_sha256 || !result.offline_matches_ids) throw new Error('Artifact mismatch');
