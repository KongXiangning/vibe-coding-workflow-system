const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../..'), snapshot = path.join(__dirname, 'pre-fix');
assert(!fs.existsSync(snapshot), 'Preserve the existing pre-fix snapshot'); fs.mkdirSync(snapshot);
const files = ['runtime/vnext/src/product-maintenance/catalog.ts', 'runtime/vnext/src/product-maintenance/paths.ts', 'runtime/vnext/dist/product-maintenance.js', 'runtime/vnext/support/product-maintenance/offline-reader.js'];
const fingerprints = {};
for (const file of files) { const bytes = fs.readFileSync(path.join(repo, file)); fingerprints[file] = crypto.createHash('sha256').update(bytes).digest('hex'); fs.writeFileSync(path.join(snapshot, path.basename(file)), bytes); }
assert.equal(fingerprints['runtime/vnext/dist/product-maintenance.js'], 'a6df4d52ce65efa9d6ed106f86696ded8ddb3f1df896a625d2cd095d1a84dce3');
const child = spawnSync(process.execPath, [path.join(repo, 'runtime/vnext/support/assistance.mjs'), 'task-status', '--root', repo], { input: JSON.stringify({ task_ref: 'task-05b880c9a4288ad327c5302992c6eb7c', detail: 'task' }), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
assert.equal(child.status, 0, child.stderr); const status = JSON.parse(child.stdout);
fs.writeFileSync(path.join(__dirname, 'before.json'), JSON.stringify({ fingerprints, task_id: status.task.task_id, lifecycle: status.task.lifecycle, adopted_plan_ref: status.task.adopted_plan_ref, current_task_id: status.current_task_id, executions: status.task.executions.map(record => record.ref), current_task_sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, 'docs/workflow/CURRENT_TASK.md'))).digest('hex'), source_revision: status.source_revision, view_revision: status.view_revision }, null, 2) + '\n');
console.log(JSON.stringify({ fingerprints, task_id: status.task.task_id, lifecycle: status.task.lifecycle, current_task_id: status.current_task_id }));
