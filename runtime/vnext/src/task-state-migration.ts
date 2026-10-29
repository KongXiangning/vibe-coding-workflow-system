/** Explicit, offline journal migration. Never invoked by normal writes or installation. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';
import tar from 'tar-stream';
import { readCatalog } from './product-maintenance/catalog';

// Keep the paired native reader outside the admin bundle. Inlining a CLI module
// changes import.meta.url and would accidentally run its command-line entry point.
const native = (name: string) => import(new URL(`../support/${name}.mjs`, import.meta.url).href);
const { queryStatus, task: taskAction } = await native('assistance');
const { causalRelations, viewLock, readTaskDisplay } = await native('task-management');
const { validateProject, validateTask, taskGitPolicyDefinitions, gitPolicyEdits } = await native('task-state');
const { decodeObservation } = await native('task-event-codec');
const { storeList, storeReadFile, withStoreReadContext, withRecordStoreLock } = await native('record-storage');

type Value = Record<string, any>;
declare const __TASK_MIGRATION_READER_HASHES__: Record<string, string>;
const RECORDS = '.workflow-system/records', TASKS = '.workflow-system/tasks';
const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const sha = (v: any): string => createHash('sha256').update(Buffer.isBuffer(v) || typeof v === 'string' ? v : JSON.stringify(canonical(v))).digest('hex');
const json = (v: any) => Buffer.from(JSON.stringify(v, null, 2) + '\n');
const taskPath = (id: string) => `${TASKS}/${sha(id)}.json`;
const fail = (code: string, message: string) => { throw Object.assign(new Error(message), { code }); };

function local(root: string, ref: string) {
  if (typeof ref !== 'string' || !ref || ref.includes('\\') || ref.split('/').some(p => !p || p === '.' || p === '..') || path.isAbsolute(ref) || ref.includes(':'))
    fail('UNSAFE_PATH', `Expected a project-relative path: ${ref}`);
  let file = root;
  for (const part of ref.split('/')) {
    file = path.join(file, part);
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) fail('UNSAFE_PATH', `Symbolic path: ${ref}`);
  }
  return file;
}
function fileHash(file: string) {
  const h = createHash('sha256'), fd = fs.openSync(file, 'r'), buffer = Buffer.alloc(65536);
  try { let n; while ((n = fs.readSync(fd, buffer, 0, buffer.length, null))) h.update(buffer.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  return h.digest('hex');
}
function walk(root: string, ref: string): string[] {
  const file = local(root, ref);
  if (!fs.existsSync(file)) return [];
  return fs.lstatSync(file).isDirectory() ? fs.readdirSync(file).sort().flatMap(name => walk(root, `${ref}/${name}`)) : [ref];
}
function guard(root: string, refs: string[]) {
  for (const ref of ['FREEZE_REGISTRY.md', '.workflow-system/FREEZE_REGISTRY.md'])
    if (fs.existsSync(local(root, ref))) fail('FREEZE_REVIEW_REQUIRED', `Review the freeze registry before migration: ${ref}`);
  for (const ref of refs) if (fs.existsSync(local(root, ref)) && /@frozen|DO NOT MODIFY/i.test(fs.readFileSync(local(root, ref)).subarray(0, 2048).toString()))
    fail('FILE_FROZEN', `Migration would alter a frozen file: ${ref}`);
}
function descriptor(root: string, ref: string) {
  const file = local(root, ref);
  return { path: ref, size: fs.statSync(file).size, sha256: fileHash(file) };
}
const transient = (ref: string) => /\.(?:lock|tmp)$/.test(ref) || /\/(?:\.archive-staging|\.record-store-locks)(?:\/|$)/.test(ref);
const oldProcess = (ref: string) => /^\.workflow-system\/records\/(?:events\/|attachments\/|evidence-objects\/|task-labels\/|legacy\/|archives\/|archive-quarantine\/|task-views\/|task-view(?:-baseline\.json|-recovery\.md|\.json)$)/.test(ref);
const list = (value: any): any[] => Array.isArray(value) ? value : value == null ? [] : [value];
const knownResult = (value: any) => {
  const status = typeof value === 'string' ? value : value?.status ?? value?.result;
  return ['passed', 'failed', 'not-run', 'unknown'].includes(status) ? status : 'unknown';
};
function concise(row: any) {
  if (!row) return null;
  const out: Value = {};
  for (const key of ['ref', 'plan_ref', 'step_id', 'execution_ref', 'source_revision', 'summary', 'command', 'commands', 'selector',
    'stage', 'verdict', 'scope', 'decision_source', 'decision_text', 'reason', 'choice', 'review_ref', 'remaining_work', 'recorded_at', 'observed_at',
    'qualification', 'gaps', 'retained_gaps', 'evidence_limits', 'completion_disposition', 'delivered', 'original_goal', 'original_status', 'sections', 'pending_documents', 'lessons'])
    if (row[key] !== undefined) out[key] = structuredClone(row[key]);
  if (row.result !== undefined) {
    out.result = knownResult(row.result);
    out.original_result_label = typeof row.result === 'string' ? row.result : row.result?.status ?? row.result?.result ?? 'structured-report';
  }
  return out;
}

/** Retain scope text and current facts, not every execution/report body. */
export function convertLegacyTask(old: Value, maxima: (rows: Value[]) => Value[], bindings: Value[] = []) {
  const plans = old.plans.map((p: Value) => structuredClone(p));
  if (old.legacy_plan && !plans.some((p: Value) => p.ref === old.legacy_plan_ref)) plans.push({ ...old.legacy_plan, ref: old.legacy_plan_ref, steps: old.legacy_plan.steps ?? old.steps });
  const adopted = old.adopted_plan_ref ?? (old.plan_status === 'legacy-summary-only' ? old.legacy_plan_ref : null);
  const pending = maxima(old.plans.filter((p: Value) => p.ref !== adopted));
  const remaining: any[] = [], constraints: Value[] = [], decisions: Value[] = [];
  for (const plan of plans) {
    plan.steps = (plan.steps ?? []).map((definition: Value) => {
      const id = definition.id ?? definition.step_id;
      const current = plan.ref === adopted ? old.steps.find((s: Value) => s.id === id) : null;
      const execution = concise(current?.execution);
      const tests = current?.tests ?? old.tests.filter((r: Value) => r.plan_ref === plan.ref && r.step_id === id && r.historical !== true);
      const groups = new Map<string, Value[]>();
      for (const row of tests) {
        const check = row.check_id ?? `legacy-${sha([row.command ?? null, row.selector ?? null, row.work_package ?? null]).slice(0, 20)}`;
        const environment = row.environment_id ?? 'legacy-unspecified';
        const key = JSON.stringify([check, environment]);
        groups.set(key, [...(groups.get(key) ?? []), { ...row, check_id: check, environment_id: environment }]);
      }
      const checks = [...groups.values()].map(rows => {
        const heads = maxima(rows), one = heads.length === 1 ? heads[0] : null;
        return { ...(concise(one) ?? {}), check_id: rows[0].check_id, environment_id: rows[0].environment_id,
          result: one ? knownResult(one.result) : 'unknown', execution_ref: one?.execution_ref ?? null,
          migration: { source_refs: (heads.length ? heads : rows).map(r => r.ref),
            ...(one ? {} : { gap: 'Concurrent or cyclic old checks; no latest result inferred.' }),
            ...(!one?.execution_ref ? { association: 'Original report does not identify an execution; not certification of current work.' } : {}) } };
      });
      const review = current?.review_ref ? old.reviews.find((r: Value) => r.ref === current.review_ref) : null;
      const decision = current?.review_decision_ref ? old.review_decisions.find((r: Value) => r.ref === current.review_decision_ref) : null;
      const step = { ...definition, id, state: current?.state ?? 'not-started', execution,
        checks, review: concise(review), review_decision: concise(decision), findings: structuredClone(current?.findings ?? []),
        disposition: current?.disposition_ref ? { ref: current.disposition_ref, state: current.state,
          execution_ref: current.execution_ref ?? null } : null };
      for (const item of list(current?.execution?.remaining_work)) remaining.push(item);
      return step;
    });
  }
  const lifecycle = old.dispositions.find((d: Value) => d.ref === old.lifecycle_ref);
  // An explicit final list, including [], supersedes earlier step-level lists.
  // Those original statements still remain on their corresponding executions.
  if (lifecycle && Object.hasOwn(lifecycle, 'remaining_work')) remaining.length = 0;
  for (const row of [old.adoption, lifecycle]) if (row) {
    if (row === lifecycle || !lifecycle || !Object.hasOwn(lifecycle, 'remaining_work'))
      for (const item of list(row.remaining_work)) remaining.push(item);
    for (const key of ['constraints', 'decisions']) for (const item of list(row[key])) {
      const entry = typeof item === 'string' ? { text: item } : item;
      (key === 'constraints' ? constraints : decisions).push({ ...entry, id: entry.id ?? `legacy-${sha([key, entry]).slice(0, 20)}`, source_ref: row.ref });
    }
  }
  const task: Value = {
    kind: 'vnext-task-state', schema_version: 1, task_id: old.task_id, display_id: old.display_id, title: old.title,
    revision: 1, created_at: null, closed_at: null, lifecycle: old.lifecycle, creation_key: null,
    creation_request_sha256: null, creation_plan_ref: null, last_write: null,
    adopted_plan_ref: adopted, candidate_plan_ref: pending.length === 1 ? pending[0].ref : null,
    work_position: { plan_ref: adopted, step_id: old.current_step_id }, plans,
    product_refs: bindings, constraints, decisions, remaining_work: [...new Map(remaining.map(r => [sha(r), r])).values()],
    delivery: { summary: lifecycle?.summary ?? lifecycle?.decision_text ?? '', items: structuredClone(lifecycle?.delivery?.items ?? []) },
    relations: { origin: old.origin, dependency: old.dependency, return_entry: null, return_result: old.return_result, continuation: null },
    retained_artifacts: [], commits: old.commits.map((c: Value) => ({ ...c })),
    migration: { source_kind: 'task-view/v1', lifecycle_ref: old.lifecycle_ref, adopted_by: old.adopted_by,
      adoption: concise(old.adoption), legacy_source: old.legacy_source, plan_status: old.plan_status,
      candidate_plan_refs: old.candidate_plan_refs, latest_lifecycle: concise(lifecycle),
      ...(old.return_entry || old.continuation ? { prior_return_entry: old.return_entry, prior_continuation: old.continuation,
        return_gap: 'Legacy checkpoints retained as history; explicitly focus/return to establish a current-state checkpoint.' } : {}) },
  };
  // A legacy summary is actual imported scope, not a newly approved full plan.
  if (old.plan_status === 'legacy-summary-only') task.migration.scope_qualification = 'legacy-summary-only';
  validateTask(task, taskPath(task.task_id));
  return task;
}

export function planMigration(rootInput: string) {
  const root = fs.realpathSync(rootInput);
  if (fs.existsSync(local(root, TASKS))) fail('TASK_STATE_ALREADY_PRESENT', 'A Task directory already exists; verify or recover it explicitly.');
  return withStoreReadContext(root, () => {
    const view = queryStatus(root, { detail: 'full' });
    if (view.kind !== 'task-view/v1') fail('NOT_A_JOURNAL_PROJECT', 'Only an existing journal project can be migrated.');
    const catalog = readCatalog(root);
    if (!['available', 'not-enabled'].includes(catalog.status) || catalog.status === 'available' && !catalog.coverage.complete)
      fail('PRODUCT_SCOPE_UNREADABLE', JSON.stringify({ status: catalog.status, omitted: catalog.coverage.omitted,
        errors: catalog.diagnostics.filter(d => d.severity === 'error').slice(0, 5) }));
    const issues = [...view.issues], preserved = new Map<string, Value>(), externalSources = new Map<string, Value>();
    const retainedPlans = new Map<string, Set<string>>();
    const retainPlan = (id: string, ref: string) => {
      if (typeof id !== 'string' || typeof ref !== 'string') return;
      const refs = retainedPlans.get(id) ?? new Set<string>(); refs.add(ref); retainedPlans.set(id, refs);
    };
    const pin = (ref: string, from: string, expected?: string) => {
      if (!ref.startsWith(`${RECORDS}/`)) return;
      local(root, ref);
      try {
        let entry = preserved.get(ref);
        if (!entry) {
          const bytes = storeReadFile(root, ref);
          entry = { path: ref, size: bytes.length, sha256: sha(bytes) }; preserved.set(ref, entry);
        }
        if (expected && expected !== entry.sha256) issues.push({ code: 'MIGRATION_SOURCE_CHANGED', path: ref, from, expected_sha256: expected, actual_sha256: entry.sha256 });
      } catch (e: any) {
        if (e.code === 'READ_TOO_LARGE') fail('MIGRATION_REFERENCE_TOO_LARGE', `Keep the old store until this cited source can be preserved: ${ref}`);
        issues.push({ code: 'MIGRATION_SOURCE_UNAVAILABLE', path: ref, from, message: e.message });
      }
    };
    const visit = (v: any, from: string) => {
      if (!v || typeof v !== 'object') return;
      retainPlan(v.task_id, v.plan_ref);
      if (v.kind === 'file' && typeof v.path === 'string') {
        pin(v.path, from, v.sha256);
        if (!v.path.startsWith(`${RECORDS}/`) && fs.existsSync(local(root, v.path))) externalSources.set(v.path, descriptor(root, v.path));
      }
      for (const value of Object.values(v)) visit(value, from);
    };
    for (const item of catalog.items) visit(item.metadata, item.path);
    const home = view.workflow_home;
    const taskDocs = [...new Set(['TASKS', `${home}/task-data`, `${home}/task-history`, `${home}/task-archive`].flatMap(ref => walk(root, ref)))];
    const documents = [...new Set([...catalog.documents.map(d => d.path), ...taskDocs])];
    // Local Markdown record links are also explicit citations. Registrations/globs are not.
    for (const ref of documents) {
      if (!ref.endsWith('.md')) continue;
      const text = fs.readFileSync(local(root, ref), 'utf8');
      for (const match of text.matchAll(/\]\((?:<)?([^\s)>]+)(?:>)?(?:\s+"[^"]*")?\)/g)) {
        const target = match[1].split('#')[0];
        if (!target || /^(?:[a-z]+:|\/)/i.test(target)) continue;
        const resolved = path.posix.normalize(target.startsWith('.workflow-system/') ? target : path.posix.join(path.posix.dirname(ref), target));
        if (resolved.startsWith(`${RECORDS}/`)) pin(resolved, ref);
      }
    }
    // A cited pack/index needs its complete immutable envelope. Leaving a partial
    // archive directory would make the existing logical reader report corruption.
    const citedArchives = new Set([...preserved.keys()].map(ref => new RegExp(`^${RECORDS.replaceAll('.', '\\.')}/archives/([a-f0-9]{64})/`).exec(ref)?.[1]).filter(Boolean));
    for (const id of citedArchives) for (const ref of walk(root, `${RECORDS}/archives/${id}`)) pin(ref, 'cited-archive-envelope');
    const events = new Map<string, Value>();
    for (const ref of storeList(root, `${RECORDS}/events`)) {
      if (!ref.endsWith('.json')) continue;
      try {
        const wrapper = JSON.parse(storeReadFile(root, ref).toString('utf8')), payload = decodeObservation(wrapper).payload;
        events.set(ref, { parents: payload.task_event?.parents ?? (payload.links ?? []).filter((l: Value) => ['after', 'adopts', 'revises', 'supersedes', 'reviews'].includes(l.relation)).map((l: Value) => l.ref),
          recorded_at: wrapper.recorded_at, task_id: payload.task_event?.task_id, action: payload.task_event?.action,
          creates_task: payload.task_event?.action === 'prepare' && payload.task_event.data?.create === true });
      } catch { /* Existing reducer diagnostics remain in project.migration.issues. */ }
    }
    const graph = causalRelations(events);
    for (const old of view.tasks) if (old.origin) retainPlan(old.origin.parent_task_id, old.origin.parent_plan_ref);
    const tasks = view.tasks.map((old: Value) => {
      const bindings = catalog.items.flatMap(item => (item.metadata.task_bindings ?? []).filter((b: Value) => b.task?.task_id === old.task_id)
        .map((b: Value) => ({ owner_id: item.id, binding_id: b.id, path: item.path, plan_ref: b.task?.plan_ref ?? null })));
      const converted = convertLegacyTask(old, (rows: Value[]) => graph.maxima(rows), bindings);
      const times = old.plans.filter((p: Value) => events.get(p.ref)?.creates_task && events.get(p.ref)?.task_id === old.task_id)
        .map((p: Value) => events.get(p.ref)?.recorded_at).filter(Boolean).sort();
      converted.created_at = times[0] ?? null;
      const closure = events.get(old.lifecycle_ref);
      converted.closed_at = old.lifecycle === 'closed' && closure?.action === 'close' && closure.task_id === old.task_id ? closure.recorded_at ?? null : null;
      for (const plan of converted.plans) if (retainedPlans.get(old.task_id)?.has(plan.ref)) plan.retained = true;
      return converted;
    });
    const recordFiles = walk(root, RECORDS).filter(ref => !transient(ref));
    const policy = gitPolicyEdits(root, taskGitPolicyDefinitions(home, true), local);
    if (policy.issues.length) fail('GIT_POLICY_RECONCILIATION_REQUIRED', JSON.stringify(policy.issues));
    const inputs = [...new Set([...recordFiles, ...documents, ...externalSources.keys(), '.workflow-system/PROJECT_PROFILE.yaml', '.workflow-system/PRODUCT.yaml',
      `${home}/CURRENT_TASK.md`, ...policy.paths,
      ...walk(root, '.workflow-system/runtime/support').filter(ref => /\.(?:mjs|js|md)$/.test(ref) && !ref.includes('/.node-deps/'))])]
      .filter(ref => fs.existsSync(local(root, ref))).sort().map(ref => descriptor(root, ref));
    const pins = [...preserved.values()].sort((a, b) => a.path.localeCompare(b.path));
    for (const ref of [`${RECORDS}/task-view.json`, `${RECORDS}/task-view-baseline.json`, `${RECORDS}/task-view-recovery.md`])
      if (preserved.has(ref)) fail('MIGRATION_MUTABLE_SOURCE_CITED', `Preserve/rebind this fixed-byte citation explicitly before replacing the local cache: ${ref}`);
    const removals = recordFiles.filter(ref => oldProcess(ref) && !preserved.has(ref) && !['.gitignore', '.gitattributes'].includes(path.posix.basename(ref)));
    guard(root, [...removals, ...policy.edits.map((e: Value) => e.path), `${home}/CURRENT_TASK.md`]);
    const numbers = tasks.map((t: Value) => Number(/^TASK-(\d+)$/.exec(t.display_id ?? '')?.[1] ?? 0));
    const project = { kind: 'vnext-task-project-state', schema_version: 1, revision: 1, current_task_id: view.current_task_id ?? null,
      next_display_number: Math.max(0, ...numbers) + 1, focus_revision: 1,
      migration: { kind: 'journal-to-task-state/v1', previous_focus: view.focus ?? null, preserved_sources: pins, issues, history: 'external-verified-backup' } };
    validateProject(project);
    let displayVerified = false;
    if (fs.existsSync(local(root, `${home}/CURRENT_TASK.md`))) displayVerified = readTaskDisplay(root, `${home}/CURRENT_TASK.md`, { local, readFile: storeReadFile }).verified;
    const plan: Value = { kind: 'task-state-migration-plan/v1', root, workflow_home: home, inputs, tasks, project,
      preserved_sources: pins, remove: removals, policy_edits: policy.edits, display_verified: displayVerified,
      legacy_view_sha256: sha(view), issues, summary: { tasks: tasks.length, lifecycle: Object.fromEntries(['draft', 'active', 'paused', 'closed', 'ambiguous'].map(l => [l, tasks.filter((t: Value) => t.lifecycle === l).length])),
        records_before: { files: recordFiles.length, bytes: inputs.filter(i => i.path.startsWith(`${RECORDS}/`)).reduce((n, i) => n + i.size, 0) },
        preserved_sources: { files: pins.length, bytes: pins.reduce((n, i) => n + i.size, 0) }, removed_files: removals.length,
        task_bytes: tasks.reduce((n: number, t: Value) => n + json(t).length, 0), product_documents: catalog.documents.length, product_bindings: tasks.reduce((n: number, t: Value) => n + t.product_refs.length, 0) } };
    return { ...plan, fingerprint: sha(plan) };
  });
}

function outside(root: string, target: string) {
  const absolute = path.resolve(target), parent = fs.realpathSync(path.dirname(absolute));
  const actual = path.join(parent, path.basename(absolute));
  if (actual === root || actual.startsWith(root + path.sep)) fail('BACKUP_INSIDE_PROJECT', 'Use a backup file outside the project.');
  if (fs.existsSync(actual)) fail('BACKUP_ALREADY_EXISTS', 'Never replace an existing migration backup.');
  return actual;
}
async function backup(root: string, plan: Value, target: string) {
  const pack = tar.pack(), stage = `${target}.${randomUUID()}.tmp`;
  const output = pipeline(pack, createGzip(), fs.createWriteStream(stage, { flags: 'wx' }));
  // Attach immediately; a stream error must not become an unhandled rejection.
  output.catch(() => {});
  try {
    for (const entry of plan.inputs) await pipeline(fs.createReadStream(local(root, entry.path)), pack.entry({ name: `files/${entry.path}`, size: entry.size, mode: 0o600 }));
    const metadata = json({ kind: 'task-state-migration-backup/v1', fingerprint: plan.fingerprint, files: plan.inputs });
    await new Promise<void>((resolve, reject) => pack.entry({ name: '__migration__/manifest.json', size: metadata.length }, metadata, e => e ? reject(e) : resolve()));
    pack.finalize(); await output;
    await verifyMigrationBackup(stage, plan.inputs);
    fs.linkSync(stage, target); fs.unlinkSync(stage);
  } catch (e) {
    pack.destroy(e as Error); await output.catch(() => {});
    if (fs.existsSync(stage)) fs.unlinkSync(stage);
    throw e;
  }
  return { path: target, size: fs.statSync(target).size, sha256: fileHash(target), verified_files: plan.inputs.length };
}

async function readBackup(archive: string, destination?: string) {
  const extract = tar.extract(), seen = new Map<string, Value>();
  let manifest: Value | null = null;
  extract.on('entry', (header, stream, next) => {
    (async () => {
      if (header.type !== 'file' || seen.has(header.name)) fail('BACKUP_INVALID', 'Duplicate or non-file archive entry.');
      const metadata = header.name === '__migration__/manifest.json';
      if (!metadata && !header.name.startsWith('files/')) fail('BACKUP_INVALID', 'Unexpected archive entry.');
      const ref = metadata ? header.name : header.name.slice(6);
      local(destination ?? path.dirname(path.resolve(archive)), ref);
      const h = createHash('sha256'), parts: Buffer[] = [];
      let bytes = 0, output: number | undefined;
      if (destination && !metadata) { const file = local(destination, ref); fs.mkdirSync(path.dirname(file), { recursive: true }); output = fs.openSync(file, 'wx'); }
      try {
        for await (const chunk of stream) {
          bytes += chunk.length; h.update(chunk);
          if (metadata) { if (bytes > 16 * 1024 * 1024) fail('BACKUP_INVALID', 'Oversized manifest.'); parts.push(chunk); }
          else if (output !== undefined) fs.writeFileSync(output, chunk);
        }
      } finally { if (output !== undefined) fs.closeSync(output); }
      seen.set(header.name, { path: ref, size: bytes, sha256: h.digest('hex') });
      if (metadata) manifest = JSON.parse(Buffer.concat(parts).toString('utf8'));
      next();
    })().catch(e => extract.destroy(e));
  });
  await pipeline(fs.createReadStream(archive), createGunzip(), extract);
  if (!manifest || manifest.kind !== 'task-state-migration-backup/v1' || !Array.isArray(manifest.files) || seen.size !== manifest.files.length + 1)
    fail('BACKUP_INVALID', 'Incomplete backup manifest.');
  for (const entry of manifest.files) if (sha(seen.get(`files/${entry.path}`)) !== sha(entry)) fail('BACKUP_INVALID', `Backup digest/size differs: ${entry.path}`);
  return manifest;
}
export async function verifyMigrationBackup(archive: string, expected?: Value[]) {
  const manifest = await readBackup(archive);
  if (expected && sha(manifest.files) !== sha(expected)) fail('BACKUP_INVALID', 'Backup does not match the reviewed input files.');
  return { fingerprint: manifest.fingerprint, files: manifest.files.length, bytes: manifest.files.reduce((n: number, i: Value) => n + i.size, 0) };
}
export async function restoreMigration(archive: string, destination: string) {
  const verified = await verifyMigrationBackup(archive), root = path.resolve(destination);
  if (fs.existsSync(root)) fail('RESTORE_TARGET_EXISTS', 'Restore only into a new separate inspection directory.');
  fs.mkdirSync(root, { recursive: true });
  await readBackup(archive, root);
  return { status: 'restored', root, ...verified, note: 'Old inspection copy only; no overwrite of an active project or replay of business actions.' };
}

export function verifyMigration(rootInput: string, plan: Value) {
  const root = fs.realpathSync(rootInput), project = JSON.parse(fs.readFileSync(local(root, `${TASKS}/state.json`), 'utf8'));
  if (project.migration?.fingerprint !== plan.fingerprint) fail('MIGRATION_IDENTITY_MISMATCH', 'This state belongs to a different migration.');
  const changedTasks = plan.tasks.filter((t: Value) => fileHash(local(root, taskPath(t.task_id))) !== sha(json(t))).map((t: Value) => t.task_id);
  const changedSources = plan.preserved_sources.filter((e: Value) => !fs.existsSync(local(root, e.path)) || fileHash(local(root, e.path)) !== e.sha256).map((e: Value) => e.path);
  const view = queryStatus(root, { detail: 'summary', limit: 100 });
  if (changedTasks.length || changedSources.length || view.current_task_id !== plan.project.current_task_id || view.task_count !== plan.tasks.length)
    fail('MIGRATION_VERIFICATION_FAILED', JSON.stringify({ changedTasks, changedSources, kind: view.kind, tasks: view.task_count, focus: view.current_task_id }));
  return { status: 'verified', tasks: plan.tasks.length, preserved_sources: plan.preserved_sources.length, kind: view.kind, current_task_id: view.current_task_id };
}

function finishMigration(root: string, plan: Value, archive: Value) {
  const removed = viewLock(root, { local }, () => withRecordStoreLock(root, () => {
    verifyMigration(root, plan);
    // All removals were backed up and verified; no general repository scan/delete.
    let removed = 0;
    for (const ref of plan.remove) {
      if (!fs.existsSync(local(root, ref))) continue;
      const original = plan.inputs.find((e: Value) => e.path === ref);
      if (fileHash(local(root, ref)) !== original.sha256) fail('MIGRATION_CLEANUP_CHANGED', `Kept changed old file: ${ref}`);
      fs.unlinkSync(local(root, ref)); removed++;
    }
    const oldDirectories = new Set<string>();
    for (const ref of plan.remove) for (let dir = path.posix.dirname(ref); dir.startsWith(`${RECORDS}/`); dir = path.posix.dirname(dir)) oldDirectories.add(dir);
    for (const ref of [...oldDirectories].sort((a, b) => b.length - a.length))
      if (fs.existsSync(local(root, ref)) && fs.readdirSync(local(root, ref)).length === 0) fs.rmdirSync(local(root, ref));
    for (const edit of plan.policy_edits) {
      const file = local(root, edit.path), current = fs.existsSync(file) ? fs.readFileSync(file) : null;
      if (current?.equals(Buffer.from(edit.content))) continue;
      if ((current === null ? null : sha(current)) !== edit.before_sha256) fail('MIGRATION_POLICY_CHANGED', `Kept edited Git policy: ${edit.path}`);
      fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, edit.content);
    }
    if (plan.display_verified) {
      const display = local(root, `${plan.workflow_home}/CURRENT_TASK.md`);
      const original = plan.inputs.find((e: Value) => e.path === `${plan.workflow_home}/CURRENT_TASK.md`);
      if (fs.existsSync(display) && fileHash(display) === original.sha256)
        fs.writeFileSync(local(root, `${RECORDS}/task-view-baseline.json`), json({ current_sha256: original.sha256, recovery_sha256: null }));
    }
    const stateFile = local(root, `${TASKS}/state.json`), state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    state.migration.cleanup_complete = true; state.revision++;
    const stateStage = `${stateFile}.${randomUUID()}.tmp`;
    try { fs.writeFileSync(stateStage, json(state), { flag: 'wx' }); fs.renameSync(stateStage, stateFile); }
    finally { if (fs.existsSync(stateStage)) fs.unlinkSync(stateStage); }
    return removed;
  }));
  const projection = taskAction(root, { action: 'rebuild' });
  return { ...verifyMigration(root, plan), status: projection.projection?.display === 'failed' ? 'migrated-pending-display' : 'migrated', backup: archive,
    removed_files: removed, projection: projection.projection, issues: projection.issues, summary: plan.summary,
    git: 'Working files only; no index changes, commit, history rewrite or push.' };
}

export async function applyMigration(rootInput: string, plan: Value, backupFile: string) {
  const root = fs.realpathSync(rootInput);
  if (fs.existsSync(local(root, `${TASKS}/state.json`))) {
    try {
      const result = verifyMigration(root, plan);
      const project = JSON.parse(fs.readFileSync(local(root, `${TASKS}/state.json`), 'utf8'));
      if (project.migration.cleanup_complete) return { ...result, status: 'already-migrated' };
      const archive = project.migration.backup;
      await verifyMigrationBackup(archive.path, plan.inputs);
      if (fileHash(archive.path) !== archive.sha256) fail('BACKUP_INVALID', 'The original backup bytes changed.');
      return finishMigration(root, plan, archive);
    } catch (e: any) { e.migration_published = true; throw e; }
  }
  if (sha(planMigration(root)) !== sha(plan)) fail('MIGRATION_SOURCE_CHANGED', 'Sources or migration rules changed after planning; create a new plan.');
  // The installed reader must understand state.json before it becomes authoritative.
  const support = local(root, '.workflow-system/runtime/support');
  for (const module of ['assistance.mjs', 'task-management.mjs', 'task-state.mjs', 'task-event-codec.mjs', 'record-storage.mjs']) {
    const installed = path.join(support, module);
    if (!fs.existsSync(installed) || fileHash(installed) !== __TASK_MIGRATION_READER_HASHES__[module])
      fail('RUNTIME_UPGRADE_REQUIRED', `Install the matching current-state reader before migrating: ${module}`);
  }
  const archive = await backup(root, plan, outside(root, backupFile));
  const stageRef = `.workflow-system/tmp/task-state-migration-${randomUUID()}`, stage = local(root, stageRef);
  let published = false;
  try {
    viewLock(root, { local }, () => withRecordStoreLock(root, () => {
      if (sha(planMigration(root)) !== sha(plan)) fail('MIGRATION_SOURCE_CHANGED', 'Sources changed while the verified backup was written; old journal remains authoritative.');
      fs.mkdirSync(stage, { recursive: true });
      for (const task of plan.tasks) fs.writeFileSync(path.join(stage, path.posix.basename(taskPath(task.task_id))), json(task), { flag: 'wx' });
      const project = { ...plan.project, migration: { ...plan.project.migration, fingerprint: plan.fingerprint, backup: archive } };
      fs.writeFileSync(path.join(stage, 'state.json'), json(project), { flag: 'wx' });
      // Rehydrate only explicitly cited old bytes before removing their containing packs.
      for (const pin of plan.preserved_sources) if (!fs.existsSync(local(root, pin.path))) {
        const bytes = storeReadFile(root, pin.path);
        if (sha(bytes) !== pin.sha256) fail('MIGRATION_SOURCE_CHANGED', `Pinned source changed: ${pin.path}`);
        fs.mkdirSync(path.dirname(local(root, pin.path)), { recursive: true }); fs.writeFileSync(local(root, pin.path), bytes, { flag: 'wx' });
      }
      fs.renameSync(stage, local(root, TASKS)); published = true;
    }));
    return finishMigration(root, plan, archive);
  } catch (e: any) {
    e.migration_published = published; e.backup = archive; throw e;
  } finally {
    if (!published && fs.existsSync(stage)) { for (const name of fs.readdirSync(stage)) fs.unlinkSync(path.join(stage, name)); fs.rmdirSync(stage); }
  }
}

async function main() {
  const [action, ...args] = process.argv.slice(2), options: Value = {};
  for (let n = 0; n < args.length; n += 2) { if (!args[n].startsWith('--') || !args[n + 1]) fail('INVALID_ARGUMENT', 'Options require values.'); options[args[n].slice(2)] = args[n + 1]; }
  if (action === 'plan') {
    const plan = planMigration(options.root ?? '.');
    if (!options.out) fail('INVALID_ARGUMENT', 'plan requires --out outside the project.');
    fs.writeFileSync(outside(plan.root, options.out), json(plan), { flag: 'wx' });
    console.log(JSON.stringify({ status: 'planned', path: path.resolve(options.out), fingerprint: plan.fingerprint, ...plan.summary, issues: plan.issues.length }));
  } else if (action === 'apply' || action === 'verify') {
    const plan = JSON.parse(fs.readFileSync(options.plan, 'utf8'));
    console.log(JSON.stringify(action === 'apply' ? await applyMigration(options.root ?? '.', plan, options.backup) : verifyMigration(options.root ?? '.', plan)));
  } else if (action === 'restore') console.log(JSON.stringify(await restoreMigration(options.backup, options.out)));
  else fail('INVALID_ARGUMENT', 'Use plan --root <project> --out <external-plan.json>; apply --root <project> --plan <file> --backup <external.tar.gz>; verify --root <project> --plan <file>; restore --backup <file> --out <new-directory>.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e: any) => {
  console.error(JSON.stringify({ status: 'failed', code: e.code ?? 'MIGRATION_FAILED', message: e.message, migration_published: e.migration_published, backup: e.backup })); process.exitCode = 1;
});
