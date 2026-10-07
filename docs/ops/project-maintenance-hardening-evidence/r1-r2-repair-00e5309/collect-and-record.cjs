const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../..');
const destination = path.join(repo, 'docs/ops/project-maintenance-hardening-evidence/r1-r2-repair-00e5309');
fs.mkdirSync(destination, { recursive: true });
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const save = (name, value) => fs.writeFileSync(path.join(destination, name), JSON.stringify(value, null, 2) + '\n');
const files = ['red.txt', 'diagnostic-position-red.txt', 'id-repurpose-red.txt', 'green-targeted.txt', 'product-tests.txt', 'install-tests.txt', 'source-tests.txt', 'build-runtime.txt', 'build-distribution.txt', 'protocol.txt', 'freshness.txt', 'node-replay.json', 'node-delivery.txt', 'replay-and-delivery.mjs', 'old-install.json', 'upgrade.json', 'upgrade-assets.json', 'installed-r1-repair.json', 'installed-r2-implicit.json', 'installed-r2-reversal.json', 'installed-r2-removal.json', 'installed-readback.json', 'offline-readback.json', 'delivery-summary.json', 'fixture-initial-install-rejected.json', 'fixture-initial-red.txt'];
for (const file of files) fs.copyFileSync(path.join(__dirname, file), path.join(destination, file));
fs.copyFileSync(__filename, path.join(destination, 'collect-and-record.cjs'));
const supplied = process.argv[2];
fs.copyFileSync(supplied, path.join(destination, 'external-review-00e5309.md'));
assert.equal(hash(supplied), 'a10bd228e8bda0f82a1235439e37fbf0d6b7b74c5f0c7721584d70f0e1176254');
const manifestPath = path.join(repo, 'packages/vibe-governance/payload/distribution-manifest.json');
fs.copyFileSync(manifestPath, path.join(destination, 'distribution-manifest.json'));
function counts(name) {
  const log = fs.readFileSync(path.join(__dirname, name + '-tests.txt'), 'utf8');
  const result = { pass: Number(log.match(/(\d+) pass/)[1]), fail: Number(log.match(/(\d+) fail/)[1]), assertions: Number(log.match(/(\d+) expect\(\) calls/)[1]) };
  assert.equal(result.fail, 0); return result;
}
const tests = { product: counts('product'), install: counts('install'), source: counts('source') };
tests.distinct_total = tests.product.pass + tests.install.pass + tests.source.pass;
tests.assertion_total = tests.product.assertions + tests.install.assertions + tests.source.assertions;
const git = args => { const child = spawnSync('git', args, { cwd: repo, encoding: 'utf8' }); assert.equal(child.status, 0, child.stderr); return child.stdout.trim(); };
const delivery = JSON.parse(fs.readFileSync(path.join(__dirname, 'delivery-summary.json'), 'utf8'));
const fingerprintFiles = ['runtime/vnext/src/product-maintenance/writer.ts', 'runtime/vnext/src/product-maintenance/parser.ts', 'test/product-maintenance.test.ts', 'test/product-maintenance-install.test.ts', 'docs/product/project-maintenance/document-contract.md', 'runtime/vnext/support/product-maintenance/API.md', 'runtime/vnext/support/product-maintenance/contract.md', 'runtime/vnext/support/product-maintenance/references/recovery.md', 'runtime/vnext/dist/product-maintenance.js', 'runtime/vnext/support/product-maintenance/offline-reader.js'];
const fingerprints = Object.fromEntries(fingerprintFiles.map(file => [file, hash(path.join(repo, file))]));
assert.equal(fingerprints['docs/product/project-maintenance/document-contract.md'], fingerprints['runtime/vnext/support/product-maintenance/contract.md']);
assert.equal(fingerprints['runtime/vnext/dist/product-maintenance.js'], delivery.artifacts.current);
assert.equal(fingerprints['runtime/vnext/support/product-maintenance/offline-reader.js'], delivery.artifacts.offline);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const summary = { date: '2026-10-07', head: git(['rev-parse', 'HEAD']), branch: git(['branch', '--show-current']), versions: { node: process.version, bun: spawnSync('bun', ['--version'], { encoding: 'utf8' }).stdout.trim(), candidate: manifest.distribution_version }, external_report_sha256: hash(supplied), scope: ['R1', 'R2'], open_findings: ['R3', 'R4'], tests, artifacts: delivery.artifacts, fingerprints, source_contract_equals_generated: true, distribution: { manifest_digest: manifest.manifest_digest, bundle_id: manifest.bundle_id }, delivery, semantic_scenarios_replayed: false, formal_review_created: false };
save('summary.json', summary);

const taskId = 'task-05b880c9a4288ad327c5302992c6eb7c';
const planRef = '.workflow-system/records/events/key-11fd39e91a7f5c633a29b70cb1727a45f15d74659f9133c3d2602f4a9d8c11d4.json';
const display = path.join(repo, 'docs/workflow/CURRENT_TASK.md'), displayBefore = hash(display);
function native(name, command, request) {
  save(name + '-request.json', request);
  const child = spawnSync(process.execPath, [path.join(repo, 'runtime/vnext/support/assistance.mjs'), command, '--root', repo], { input: JSON.stringify(request), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (!child.stdout) throw new Error(child.stderr || 'No native result');
  const result = JSON.parse(child.stdout);
  save(name + '-receipt.json', { exit: child.status, recorded: result.recorded, ref: result.ref, association: result.association, projection: result.projection, issues: result.issues, source_revision: result.source_revision, view_revision: result.view_revision });
  if (command === 'task') { assert.equal(result.recorded, true); assert.equal(result.association, 'applied'); }
  return result;
}
const before = native('status-before', 'task-status', { task_ref: taskId, detail: 'task' });
const oldReviews = before.task.reviews.map(review => ({ ref: review.ref, sha256: hash(path.join(repo, review.ref)), verdict: review.verdict }));
const reportRef = 'docs/ops/project-maintenance-hardening-evidence/r1-r2-repair-00e5309/README.md';
const sourceRevision = summary.head + ' + uncommitted R1/R2 repair; helper ' + delivery.artifacts.current;
const execution = native('execution', 'task', {
  action: 'execution', task_id: taskId, plan_ref: planRef, step_id: 'A', source_revision: sourceRevision,
  decision_source: 'current human user instruction', decision_text: '用户明确要求先修复外部 00e5309 审查报告中的 R1、R2。',
  external_review_ref: reportRef.replace('README.md', 'external-review-00e5309.md'), external_review_sha256: summary.external_report_sha256,
  result: 'R1/R2 repaired and self-checked within listed scope; R3/R4 remain open; no formal clean review or release',
  summary: '共同写入链纳入 YAML 原文及稳定结构诊断，允许选中坏语法的合法修复；逐份匹配 dismissed 历史，支持同 ID 保留另一行的明确删除及当前明确决定下重新关联；保留原跨 ID 身份保护，无新状态或维护 gate。',
  commands: ['bun test test/product-maintenance.test.ts: 35 pass / 873 assertions', 'bun test test/product-maintenance-install.test.ts: 1 pass / 163 assertions', 'bun test test/workflow-vnext-source.test.ts: 19 pass / 115 assertions', 'build:vnext-runtime and build:vibe-governance-distribution: passed', 'validate:protocol and validate:freshness: passed', '8 original review inputs x pre-fix/current installed Node: 16 matched observations', 'actual isolated 0.24.0 -> current 0.24.1 upgrade: 11 original business assets unchanged; installed repair/reversal/removal and runtime-free offline readback matched'],
  report_ref: reportRef, evidence: { tests, artifacts: delivery.artifacts, distribution: summary.distribution, node_observations: 16, upgrade_assets_unchanged: 11, offline_ids_match: true },
  previous_execution_ref: before.task.executions.at(-1)?.ref,
  gaps: ['R3/R4 are known unmodified reading gaps; no full hardening PASS', 'self-check and synthetic deterministic evidence; no independent clean review, S01-S13 host-Agent/cross-model semantic replay or real-project verification', 'no full workflow/task suite, Linux, minimum Node20, npm/tgz, push, publication or deployment; source task lifecycle/plan/focus unchanged'],
  idempotency_key: 'maintain-hardening-review-00e5309-r1-r2-execution-1'
});
const testReceipts = [];
for (const [name, target] of [['product', 'test/product-maintenance.test.ts'], ['install', 'test/product-maintenance-install.test.ts'], ['source', 'test/workflow-vnext-source.test.ts']]) {
  testReceipts.push(native('test-' + name, 'task', { action: 'test', task_id: taskId, plan_ref: planRef, step_id: 'A', execution_ref: execution.ref, command: 'bun test ' + target, selector: name, result: 'passed', counts: tests[name], source_revision: sourceRevision, report_ref: reportRef.replace('README.md', name + '-tests.txt'), idempotency_key: 'maintain-hardening-review-00e5309-r1-r2-test-' + name + '-1' }));
}
const after = native('status-after', 'task-status', { task_ref: taskId, detail: 'task' });
const management = { task_id: taskId, plan_ref: planRef, execution_ref: execution.ref, test_refs: testReceipts.map(receipt => receipt.ref), recorded: [execution, ...testReceipts].every(receipt => receipt.recorded), associations: [execution, ...testReceipts].map(receipt => receipt.association), projection: execution.projection, execution_present: after.task.executions.some(record => record.ref === execution.ref), old_reviews_unchanged: oldReviews.every(review => hash(path.join(repo, review.ref)) === review.sha256), old_verdicts: oldReviews.map(review => ({ ref: review.ref, verdict: review.verdict })), current_task_bytes_unchanged: hash(display) === displayBefore, lifecycle_before: before.task.lifecycle, lifecycle_after: after.task.lifecycle, plan_before: before.task.adopted_plan_ref, plan_after: after.task.adopted_plan_ref, focus_before: before.current_task_id, focus_after: after.current_task_id, new_formal_review_created: false, latest_known_open_findings: ['R3', 'R4'] };
assert(management.execution_present && management.old_reviews_unchanged && management.current_task_bytes_unchanged);
assert.equal(management.lifecycle_before, management.lifecycle_after); assert.equal(management.plan_before, management.plan_after); assert.equal(management.focus_before, management.focus_after);
save('management-summary.json', management); console.log(JSON.stringify({ summary, management }, null, 2));
