/** One-time cleanup of the pre-assistance Task Store in an already migrated v2 project. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import tar from 'tar-stream';
import { parse } from 'yaml';
import { TaskStore } from '../runtime/vnext/src/task-store';
import { readCatalog } from '../runtime/vnext/src/product-maintenance/catalog';
import { queryStatus } from '../runtime/vnext/support/assistance.mjs';
import { viewLock } from '../runtime/vnext/support/task-management.mjs';
import { restoreMigration, verifyMigrationBackup } from '../runtime/vnext/dist/task-state-migration.js';

type Value = Record<string, any>;
type FileInfo = { path: string; size: number; sha256: string };
type TextExport = { path: string; text: string; task_id: string; document_id: string };
export type CleanupPlan = {
  kind: 'legacy-task-data-cleanup/v1'; root: string; workflow_home: string;
  inputs: FileInfo[]; protected: FileInfo[]; remove: string[];
  kept: Array<{ path: string; reason: string }>; exports: TextExport[];
  task_count: number; current_task_id: string | null; fingerprint: string;
};

function fail(code: string, message: string): never { throw Object.assign(new Error(message), { code }); }
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function sha(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(canonical(value))).digest('hex');
}
function json(value: unknown): string { return JSON.stringify(value, null, 2) + '\n'; }
function local(root: string, ref: string): string {
  if (!ref || path.isAbsolute(ref) || ref.includes('\\') || ref.includes(':') || ref.split('/').some(part => !part || part === '.' || part === '..'))
    fail('UNSAFE_PATH', `Expected a project-relative path: ${ref}`);
  let file = root;
  for (const part of ref.split('/')) {
    file = path.join(file, part);
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) fail('UNSAFE_PATH', `Symlink/junction is outside cleanup scope: ${ref}`);
  }
  return file;
}
function files(root: string, ref: string): string[] {
  const file = local(root, ref);
  if (!fs.existsSync(file)) return [];
  const stat = fs.lstatSync(file);
  if (stat.isFile()) return [ref];
  if (!stat.isDirectory()) fail('UNSAFE_PATH', `Not a regular file or directory: ${ref}`);
  return fs.readdirSync(file).sort().flatMap(name => files(root, `${ref}/${name}`));
}
function read(root: string, ref: string): Value { return JSON.parse(fs.readFileSync(local(root, ref), 'utf8')); }
function descriptor(root: string, ref: string): FileInfo {
  const file = local(root, ref), hash = createHash('sha256'), fd = fs.openSync(file, 'r'), buffer = Buffer.alloc(65536);
  try { let size; while ((size = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, size)); }
  finally { fs.closeSync(fd); }
  return { path: ref, size: fs.statSync(file).size, sha256: hash.digest('hex') };
}
function externalFile(root: string, target: string): string {
  const absolute = path.resolve(target), actual = path.join(fs.realpathSync(path.dirname(absolute)), path.basename(absolute));
  const relative = path.relative(root, actual);
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)))
    fail('EXTERNAL_FILE_REQUIRED', 'Plans and backups must be outside the project.');
  if (fs.existsSync(actual) && fs.lstatSync(actual).isSymbolicLink()) fail('UNSAFE_PATH', 'External files cannot be symlinks.');
  return actual;
}
function guard(root: string, refs: string[]): void {
  for (const ref of ['FREEZE_REGISTRY.md', '.workflow-system/FREEZE_REGISTRY.md'])
    if (fs.existsSync(local(root, ref))) fail('FREEZE_REVIEW_REQUIRED', `Review the freeze registry before cleanup: ${ref}`);
  for (const ref of refs) if (fs.existsSync(local(root, ref))) {
    const fd = fs.openSync(local(root, ref), 'r'), buffer = Buffer.alloc(2048);
    try { const size = fs.readSync(fd, buffer); if (/@frozen|DO NOT MODIFY/i.test(buffer.subarray(0, size).toString())) fail('FILE_FROZEN', `Kept frozen file: ${ref}`); }
    finally { fs.closeSync(fd); }
  }
}
function legacyRoots(home: string): string[] { return ['task-data', 'task-history', 'evidence-objects'].map(name => `${home}/${name}`); }

/** Copy final Markdown sections, not a model-written summary or a replay of old events. */
function taskText(root: string, documentId: string): TextExport {
  const store = new TaskStore(root, documentId), manifest = store.manifest;
  if (!manifest || store.hasPendingCommit) fail('LEGACY_STORE_PENDING', `Missing or unfinished legacy store: ${documentId}`);
  const definition = store.readObject(manifest.object_refs.definition).payload as Value;
  const state = store.readObject(manifest.object_refs.state).payload as Value;
  let sections: string[], runtime: Value;
  if (definition.kind === 'vnext-active-definition/v1' && state.kind === 'vnext-active-state/v1') {
    if (sha(state.definition) !== sha(manifest.object_refs.definition)) fail('LEGACY_FORMAT_UNSUPPORTED', 'Definition and state select different text.');
    const value = (slot: Value): any => {
      if (slot && Object.keys(slot).length === 1 && Object.hasOwn(slot, 'value')) return slot.value;
      if (!slot?.ref) fail('LEGACY_FORMAT_UNSUPPORTED', 'Invalid stored text reference.');
      const object = store.readObject(slot.ref);
      const payload = object.payload as Value;
      return object.object_type === 'other' && payload.kind === 'vnext-task-material/v1' ? payload.value : payload;
    };
    sections = definition.sections.map((section: Value) => value(Object.hasOwn(section, 'dynamic') ? state.dynamic_body[section.dynamic] : section.text));
    runtime = Object.fromEntries(Object.entries(state.runtime).map(([key, slot]) => [key, value(slot as Value)]));
  } else if (['task-definition/v1', 'task-definition/v2'].includes(definition.kind) && state.runtime_state) {
    sections = definition.sections.map((section: Value) => section.text);
    runtime = state.runtime_state;
  } else fail('LEGACY_FORMAT_UNSUPPORTED', `Keep unknown legacy representation: ${documentId}`);
  if (!sections.length || sections.some(text => typeof text !== 'string')) fail('LEGACY_FORMAT_UNSUPPORTED', 'Task body could not be read completely.');
  const status = ['workflow_status', 'lifecycle_state', 'active_step_id', 'active_step_status']
    .filter(key => runtime[key] !== undefined).map(key => `- ${key}: ${String(runtime[key])}`).join('\n');
  return {
    path: `TASKS/legacy/${documentId}-text.md`, task_id: manifest.task_id, document_id: documentId,
    text: `# 历史任务正文：${manifest.task_id} ${manifest.task_slug}\n\n` +
      '> 从旧 Task Store 最终保留的定义和状态导出。正文按原文复制；本文件不创建任务、不改变当前状态或验收结论。\n\n' +
      `- 原 document_id: ${documentId}\n${status}\n\n---\n\n${sections.join('')}\n`,
  };
}

export function planLegacyCleanup(rootInput: string): CleanupPlan {
  const root = fs.realpathSync(rootInput);
  if (!fs.existsSync(local(root, '.workflow-system/tasks/state.json'))) fail('V2_REQUIRED', 'Migrate Task data to v2 before removing a legacy store.');
  const project = read(root, '.workflow-system/tasks/state.json');
  if (project.kind !== 'vnext-task-project-state' || project.schema_version !== 1) fail('V2_REQUIRED', 'Migrate Task data to v2 before removing a legacy store.');
  const profilePath = '.workflow-system/PROJECT_PROFILE.yaml';
  const profile = fs.existsSync(local(root, profilePath)) ? parse(fs.readFileSync(local(root, profilePath), 'utf8')) : {};
  const home = profile?.paths?.workflow_home ?? 'docs/workflow';
  local(root, home);
  const catalog = readCatalog(root);
  if (catalog.status !== 'not-enabled' && (catalog.status !== 'available' || !catalog.coverage.complete))
    fail('PRODUCT_READ_INCOMPLETE', 'Current product documents must be fully readable before cleanup.');
  const candidates = legacyRoots(home).flatMap(ref => files(root, ref));
  const pins = new Set<string>();
  function pin(ref: string): void {
    // Migrated source citations pin original file bytes, not a live old transaction graph.
    if (typeof ref === 'string' && candidates.includes(ref)) pins.add(ref);
  }
  function references(value: any): void {
    if (!value || typeof value !== 'object') return;
    if (value.kind === 'file') pin(value.path);
    for (const child of Object.values(value)) references(child);
  }
  for (const item of catalog.items) references(item.metadata);
  const taskFiles = files(root, '.workflow-system/tasks');
  for (const ref of taskFiles.filter(ref => ref.endsWith('.json'))) {
    const task = read(root, ref); references(task);
    for (const artifact of task.retained_artifacts ?? []) pin(artifact.path);
  }
  for (const document of catalog.documents) {
    const text = fs.readFileSync(local(root, document.path), 'utf8');
    for (const match of text.matchAll(/\]\((?:<)?([^\s)>]+)(?:>)?(?:\s+"[^"]*")?\)/g)) {
      const target = match[1].split('#')[0];
      if (target && !/^(?:[a-z]+:|\/)/i.test(target)) pin(path.posix.normalize(path.posix.join(path.posix.dirname(document.path), target)));
    }
  }
  const knownStores = new Map<string, string>();
  for (const ref of candidates.filter(ref => /^doc-[a-f0-9]+$/.test(path.posix.basename(path.posix.dirname(ref))) && ref.endsWith('/manifest.json'))) {
    const manifest = read(root, ref);
    if (manifest.kind !== 'vnext-task-store-manifest') continue;
    knownStores.set(path.posix.dirname(ref), manifest.document_id);
  }
  const remove: string[] = [], kept: CleanupPlan['kept'] = [];
  for (const ref of candidates) {
    let known = false;
    if (ref.startsWith(`${home}/evidence-objects/`)) known = /\/[a-f0-9]{64}\.blob$/.test(ref) && descriptor(root, ref).sha256 === path.posix.basename(ref, '.blob');
    else if (ref.endsWith('.json')) {
      let value: Value | null = null;
      try { value = read(root, ref); } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
      if (ref.startsWith(`${home}/task-history/`)) known = ['artifact-checkpoint/v1', 'vnext-task-definition-history'].includes(value?.kind);
      else known = [...knownStores.keys()].some(dir => ref.startsWith(dir + '/')) && ['vnext-task-store-manifest', 'vnext-task-event', 'vnext-task-object'].includes(value?.kind);
    } else known = [...knownStores.keys()].some(dir => ref.startsWith(dir + '/indexes/')) && /\/(?:events|idempotency)\.jsonl$/.test(ref);
    if (pins.has(ref) || !known) kept.push({ path: ref, reason: pins.has(ref) ? 'current-reference' : 'unrecognized-or-policy-file' });
    else remove.push(ref);
  }
  // A retained checkpoint still needs the actual historical file bytes it names.
  for (const entry of kept.filter(entry => entry.path.startsWith(`${home}/task-history/`) && entry.path.endsWith('.json'))) {
    const checkpoint = read(root, entry.path);
    for (const image of checkpoint.images ?? []) {
      const ref = `${home}/evidence-objects/${image.object?.sha256}.blob`, index = remove.indexOf(ref);
      if (index >= 0) { remove.splice(index, 1); kept.push({ path: ref, reason: 'retained-checkpoint' }); }
    }
  }
  const exports = [...knownStores].filter(([dir]) => remove.some(ref => ref.startsWith(dir + '/')))
    .map(([, documentId]) => taskText(root, documentId));
  for (const output of exports) {
    const file = local(root, output.path);
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') !== output.text) fail('EXPORT_CONFLICT', `Existing task text was preserved: ${output.path}`);
  }
  guard(root, [...remove, ...exports.map(output => output.path)]);
  const protectedPaths = [...new Set([...taskFiles, ...catalog.documents.map(document => document.path), ...files(root, 'TASKS'),
    profilePath, '.workflow-system/PRODUCT.yaml', `${home}/CURRENT_TASK.md`])].filter(ref => fs.existsSync(local(root, ref)));
  const protectedFiles = protectedPaths.sort().map(ref => descriptor(root, ref));
  const inputs = [...new Set([...candidates, ...protectedPaths])].sort().map(ref => descriptor(root, ref));
  const query = queryStatus(root, { limit: 100 });
  if (query.kind !== 'task-query/v2' || query.status !== 'available') fail('V2_REQUIRED', 'Current v2 task query failed.');
  const plan = { kind: 'legacy-task-data-cleanup/v1' as const, root, workflow_home: home, inputs, protected: protectedFiles,
    remove: remove.sort(), kept: kept.sort((a, b) => a.path.localeCompare(b.path)), exports, task_count: query.task_count, current_task_id: query.current_task_id };
  return { ...plan, fingerprint: sha(plan) };
}

async function backup(root: string, plan: CleanupPlan, target: string): Promise<Value> {
  if (fs.existsSync(target)) {
    const checked = await verifyMigrationBackup(target, plan.inputs);
    if (checked.fingerprint !== plan.fingerprint) fail('BACKUP_MISMATCH', 'Backup belongs to a different cleanup plan.');
  } else {
    const stage = `${target}.${randomUUID()}.tmp`, pack = tar.pack();
    const output = pipeline(pack, createGzip(), fs.createWriteStream(stage, { flags: 'wx' }));
    output.catch(() => {});
    try {
      for (const input of plan.inputs) await pipeline(fs.createReadStream(local(root, input.path)), pack.entry({ name: `files/${input.path}`, size: input.size, mode: 0o600 }));
      const manifest = json({ kind: 'task-state-migration-backup/v1', fingerprint: plan.fingerprint, files: plan.inputs });
      await new Promise<void>((resolve, reject) => pack.entry({ name: '__migration__/manifest.json', size: Buffer.byteLength(manifest) }, manifest, error => error ? reject(error) : resolve()));
      pack.finalize(); await output;
      await verifyMigrationBackup(stage, plan.inputs);
      fs.linkSync(stage, target);
    } catch (error) {
      pack.destroy(error as Error); await output.catch(() => {}); throw error;
    } finally { if (fs.existsSync(stage)) fs.unlinkSync(stage); }
  }
  return { path: target, size: fs.statSync(target).size, sha256: sha(fs.readFileSync(target)), verified_files: plan.inputs.length };
}
function checkSources(root: string, plan: CleanupPlan, retry: boolean): void {
  for (const input of plan.inputs) {
    if (!fs.existsSync(local(root, input.path))) {
      if (retry && plan.remove.includes(input.path)) continue;
      fail('SOURCE_CHANGED', `Source disappeared after planning: ${input.path}`);
    }
    if (descriptor(root, input.path).sha256 !== input.sha256) fail('SOURCE_CHANGED', `Source changed after planning: ${input.path}`);
  }
  const planned = new Set(plan.inputs.map(input => input.path));
  for (const ref of legacyRoots(plan.workflow_home).flatMap(ref => files(root, ref)))
    if (!planned.has(ref)) fail('SOURCE_CHANGED', `New legacy data arrived after planning: ${ref}`);
}
function verifyCurrent(root: string, plan: CleanupPlan): void {
  for (const original of plan.protected)
    if (!fs.existsSync(local(root, original.path)) || descriptor(root, original.path).sha256 !== original.sha256)
      fail('CURRENT_DATA_CHANGED', `Current task or document changed: ${original.path}`);
  const query = queryStatus(root, { limit: 100 });
  if (query.kind !== 'task-query/v2' || query.task_count !== plan.task_count || query.current_task_id !== plan.current_task_id)
    fail('CURRENT_DATA_CHANGED', 'Current task identities or focus changed.');
}
export async function applyLegacyCleanup(rootInput: string, plan: CleanupPlan, backupPath: string): Promise<Value> {
  const root = fs.realpathSync(rootInput), { fingerprint, ...body } = plan;
  if (plan.kind !== 'legacy-task-data-cleanup/v1' || root !== plan.root || sha(body) !== fingerprint) fail('PLAN_INVALID', 'Use the reviewed plan for this exact project.');
  // Recheck the fixed deletion boundary even for an externally edited plan.
  for (const ref of plan.remove) if (!legacyRoots(plan.workflow_home).some(dir => ref.startsWith(dir + '/')))
    fail('UNSAFE_PATH', `Outside legacy cleanup scope: ${ref}`);
  for (const output of plan.exports) if (output.path !== `TASKS/legacy/${output.document_id}-text.md` || !/^doc-[a-f0-9]+$/.test(output.document_id))
    fail('UNSAFE_PATH', 'Export is outside the fixed historical-text location.');
  const target = externalFile(root, backupPath), retry = fs.existsSync(target);
  guard(root, [...plan.remove, ...plan.exports.map(output => output.path)]);
  checkSources(root, plan, retry); verifyCurrent(root, plan);
  if (!plan.remove.length && !plan.exports.length) return { status: 'already-cleaned', removed_files: 0, task_texts: 0, retained_files: plan.kept.length, current_tasks: plan.task_count, backup: null };
  const archive = await backup(root, plan, target);
  const removed = viewLock(root, { local }, () => {
    checkSources(root, plan, true); verifyCurrent(root, plan);
    for (const output of plan.exports) {
      const file = local(root, output.path);
      if (fs.existsSync(file)) {
        if (fs.readFileSync(file, 'utf8') !== output.text) fail('EXPORT_CONFLICT', `Existing task text was preserved: ${output.path}`);
      } else { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, output.text, { flag: 'wx' }); }
      if (sha(fs.readFileSync(file)) !== sha(output.text)) fail('EXPORT_FAILED', output.path);
    }
    let count = 0, bytes = 0;
    for (const ref of plan.remove) if (fs.existsSync(local(root, ref))) {
      const original = plan.inputs.find(input => input.path === ref);
      if (!original || descriptor(root, ref).sha256 !== original.sha256) fail('SOURCE_CHANGED', `Kept changed legacy file: ${ref}`);
      fs.unlinkSync(local(root, ref)); count++; bytes += original.size;
    }
    const directories = new Set<string>();
    for (const ref of plan.remove) for (let dir = path.posix.dirname(ref); legacyRoots(plan.workflow_home).some(base => dir === base || dir.startsWith(base + '/')); dir = path.posix.dirname(dir)) directories.add(dir);
    for (const ref of [...directories].sort((a, b) => b.length - a.length))
      if (fs.existsSync(local(root, ref)) && fs.readdirSync(local(root, ref)).length === 0) fs.rmdirSync(local(root, ref));
    verifyCurrent(root, plan);
    return { files: count, bytes };
  });
  return { status: removed.files ? 'cleaned' : 'already-cleaned', removed_files: removed.files, removed_bytes: removed.bytes,
    task_texts: plan.exports.length, retained_files: plan.kept.length, current_tasks: plan.task_count, backup: archive,
    git: 'No staging, commit, push, history rewrite or Runtime upgrade.' };
}
export function cleanupSummary(plan: CleanupPlan): Value {
  return { status: 'planned', root: plan.root, workflow_home: plan.workflow_home, fingerprint: plan.fingerprint,
    remove_files: plan.remove.length, remove_bytes: plan.inputs.filter(input => plan.remove.includes(input.path)).reduce((sum, input) => sum + input.size, 0),
    task_texts: plan.exports.length, retained_files: plan.kept.length, current_tasks: plan.task_count,
    absolute_cleanup_roots: legacyRoots(plan.workflow_home).map(ref => local(plan.root, ref)),
    kept_reasons: plan.kept.reduce((counts: Value, entry) => ({ ...counts, [entry.reason]: (counts[entry.reason] ?? 0) + 1 }), {}) };
}
async function main(): Promise<void> {
  const [action, ...args] = process.argv.slice(2), options: Value = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!args[index].startsWith('--') || !args[index + 1]) fail('ARGUMENT_REQUIRED', 'Options require values.');
    options[args[index].slice(2)] = args[index + 1];
  }
  if (action === 'plan' && options.root && options.out) {
    const plan = planLegacyCleanup(options.root), target = externalFile(plan.root, options.out);
    fs.writeFileSync(target, json(plan), { flag: 'wx' });
    console.log(JSON.stringify({ ...cleanupSummary(plan), plan: target }));
  } else if (action === 'apply' && options.root && options.plan && options.backup) {
    const plan = JSON.parse(fs.readFileSync(options.plan, 'utf8'));
    console.log(JSON.stringify(await applyLegacyCleanup(options.root, plan, options.backup)));
  } else if (action === 'restore' && options.backup && options.out) console.log(JSON.stringify(await restoreMigration(options.backup, options.out)));
  else fail('ARGUMENT_REQUIRED', 'Use plan --root <project> --out <external.json>; apply --root <project> --plan <json> --backup <external.tar.gz>; restore --backup <tar.gz> --out <new-directory>. Run with bun.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(JSON.stringify({ status: 'failed', code: error.code ?? 'CLEANUP_FAILED', message: error.message })); process.exitCode = 1;
});
