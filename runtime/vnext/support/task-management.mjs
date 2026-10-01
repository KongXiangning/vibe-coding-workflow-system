/** Rebuildable task management. No workflow admission, business execution or approval tokens. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { execFileSync } from 'node:child_process';

const STORE = '.workflow-system/records';
const CACHE = `${STORE}/task-view.json`;
const MARKER = '<!-- vnext-task-view/v1 -->';
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])])) : value;
const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(stable(value))).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const obj = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const list = value => Array.isArray(value) ? value : [];
const unique = values => [...new Set(list(values).filter(v => typeof v === 'string' && v))];
const errorInfo = e => ({ code: e?.code ?? 'MANAGEMENT_IO_FAILED', message: e instanceof Error ? e.message : String(e) });
const meta = () => ({ runtime_role: 'assistance', development_gate: false, qualification: 'not-evaluated' });
const ACTIONS = new Set(['prepare', 'adopt', 'execution', 'test', 'review', 'review-decision', 'step', 'git', 'close', 'pause', 'resume', 'focus', 'link', 'correct', 'resolve', 'defer']);
const META_ACTIONS = new Set(['link', 'correct', 'resolve', 'defer']);
const RECOVERY = ['rebuild', 'link', 'correct', 'resolve', 'defer', 'pause', 'close'];
const label = value => {
  if (typeof value !== 'string' || !/^(?:TASK[- _]?)?\d+$/i.test(value.trim())) return null;
  const n = Number(value.trim().replace(/^TASK[- _]?/i, ''));
  return Number.isSafeInteger(n) && n >= 0 ? `TASK-${String(n).padStart(3, '0')}` : null;
};
const diagnostic = (code, ref, message, details = {}) => ({ id: `issue-${digest([code, ref, details]).slice(0, 24)}`, code, ref, message, ...details });

function readFile(root, ref, io) { return fs.readFileSync(io.local(root, ref)); }
function files(root, directory, io, suffix) {
  try { return fs.readdirSync(io.local(root, directory)).filter(n => n.endsWith(suffix)).sort().map(n => `${directory}/${n}`); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
}
function scalar(block, key) {
  const found = [...block.matchAll(new RegExp(`^  ${key}:[ \\t]*(.*?)[ \\t]*$`, 'gm'))];
  if (found.length !== 1) return null;
  let text = found[0][1].replace(/\s+#.*$/, '').trim();
  if (text.startsWith('"')) { try { return String(JSON.parse(text)); } catch { return null; } }
  if (text.startsWith("'")) return text.endsWith("'") ? text.slice(1, -1).replaceAll("''", "'") : null;
  return /^[\w.-]+$/.test(text) ? text : null;
}
// Read only well-defined legacy hot fields. Unsupported YAML is reported, never guessed.
function legacyIdentity(bytes, ref) {
  const text = bytes.toString('utf8');
  const fm = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1]?.replaceAll('\r', '');
  if (!fm || !/^kind:\s*vnext-current-task\s*$/m.test(fm)) return null;
  const block = /^runtime_state:\s*\n((?:[ \t]+[^\n]*\n?)*)/m.exec(fm)?.[1] ?? '';
  const alias = label(scalar(block, 'task_id'));
  if (!alias) return null;
  const document = /^document_id:\s*([\w-]+)\s*$/m.exec(fm)?.[1];
  const workflow = scalar(block, 'workflow_status'), life = scalar(block, 'lifecycle_state');
  const stepId = scalar(block, 'active_step_id');
  const phase = workflow === 'closed' || life === 'archived' ? 'closed'
    : /suspended|paused|interrupted/.test(life ?? '') ? 'paused' : workflow === 'draft' ? 'draft' : 'active';
  return { task_id: document ? `legacy-${document}` : `legacy-${alias.toLowerCase()}`, display_id: alias,
    title: /^-\s*任务标题[：:]\s*(.+)$/m.exec(text)?.[1] ?? scalar(block, 'task_slug') ?? alias,
    lifecycle: phase, plan_ref: `legacy-plan-${digest(bytes)}`, current_step_id: stepId, step_status: scalar(block, 'active_step_status'), source_ref: ref,
    plan: { legacy_source: ref, detail_status: 'legacy-summary-only', steps: stepId ? [{ id: stepId, title: stepId }] : [] } };
}
function legacySource(root, io, requestedHome) {
  const { home, issues } = io.workflowHome(root, requestedHome);
  const current = `${home}/CURRENT_TASK.md`;
  try {
    const manifest = JSON.parse(readFile(root, `${STORE}/legacy/baseline.json`, io));
    const bytes = readFile(root, manifest.ref, io);
    if (digest(bytes) !== manifest.sha256) throw new Error('Preserved legacy baseline differs from its digest.');
    return { home, ref: manifest.ref, bytes, issues, persisted: true, identity: legacyIdentity(bytes, manifest.ref) };
  } catch (e) {
    if (e.code !== 'ENOENT') return { home, issues: [...issues, diagnostic('LEGACY_BASELINE_UNAVAILABLE', current, errorInfo(e).message)] };
  }
  try {
    const bytes = readFile(root, current, io);
    if (bytes.toString('utf8').includes(MARKER)) return { home, issues };
    return { home, ref: current, bytes, persisted: false, identity: legacyIdentity(bytes, current), issues };
  } catch (e) { return { home, issues: e.code === 'ENOENT' ? issues : [...issues, diagnostic('LEGACY_BASELINE_UNAVAILABLE', current, errorInfo(e).message)] }; }
}
function retainBaseline(root, io, home) {
  const source = legacySource(root, io, home);
  if (source.bytes && !source.persisted) {
    const sha256 = digest(source.bytes), ref = `${STORE}/legacy/current-${sha256}.md`;
    io.publish(root, ref, source.bytes);
    io.publish(root, `${STORE}/legacy/baseline.json`, json({ kind: 'task-legacy-baseline/v1', ref, sha256, original_path: source.ref }));
  }
}
function readInputs(root, io, input) {
  const legacy = legacySource(root, io, input.workflow_home), issues = [...legacy.issues], records = [], hashes = [];
  let paths = [];
  try { paths = files(root, `${STORE}/events`, io, '.json'); }
  catch (e) { issues.push(diagnostic('JOURNAL_UNREADABLE', STORE, errorInfo(e).message)); }
  for (const ref of paths) {
    try {
      const bytes = readFile(root, ref, io);
      hashes.push([ref, digest(bytes)]);
      const event = JSON.parse(bytes);
      if (!event.payload || digest(event.payload) !== event.payload_sha256) throw new Error('Observation payload digest does not match.');
      records.push({ ref, ...event });
    } catch (e) { issues.push(diagnostic('RECORD_UNREADABLE', ref, errorInfo(e).message)); }
  }
  let labels = [];
  try {
    for (const ref of files(root, `${STORE}/task-labels`, io, '.json')) {
      try {
        const bytes = readFile(root, ref, io); hashes.push([ref, digest(bytes)]);
        labels.push({ ...JSON.parse(bytes), ref });
      } catch (e) { issues.push(diagnostic('TASK_LABEL_UNREADABLE', ref, errorInfo(e).message)); }
    }
  } catch (e) { issues.push(diagnostic('TASK_LABELS_UNREADABLE', STORE, errorInfo(e).message)); }
  if (legacy.bytes) hashes.push(['legacy-baseline', digest(legacy.bytes)]);
  return { legacy, records, labels, issues, source_revision: digest(hashes.sort((a, b) => a[0].localeCompare(b[0]))) };
}
function rawEvent(record) {
  const p = obj(record.payload), b = obj(p.body), taskRef = p.task_id ?? p.task_ref ?? b.task_id ?? b.task_ref;
  const parents = unique(list(p.links).filter(x => ['after', 'adopts', 'revises', 'supersedes', 'implements-decision', 'reviews'].includes(x?.relation)).map(x => x?.ref));
  const data = { ...b, task_ref: taskRef, source_revision: p.source_revision ?? b.source_revision };
  const action = { plan: 'prepare', execution: 'execution', 'test-run': 'test', review: 'review', 'step-disposition': 'step', 'git-operation': 'git' }[p.kind];
  if (p.kind === 'task-disposition' && ['closed', 'paused', 'active'].includes(b.state)) {
    return { action: { closed: 'close', paused: 'pause', active: 'resume' }[b.state], task_id: taskRef, data, parents };
  }
  if (p.kind === 'decision' && b.action === 'adopt' && b.plan_ref) return { action: 'adopt', task_id: taskRef, data, parents };
  if (action) return { action, task_id: taskRef, data: action === 'prepare' ? { ...data, plan: b.plan ?? b } : data, parents };
  return null;
}
function gitObject(root, requested) {
  if (!/^[a-fA-F0-9]{40}(?:[a-fA-F0-9]{24})?$/.test(requested ?? '')) return { sha: requested ?? null, object_available: false, verification: 'unverified' };
  try {
    const sha = execFileSync('git', ['rev-parse', '--verify', `${requested}^{commit}`], { cwd: root, encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    return { sha, object_available: true, verification: 'local-git-object', pushed: 'not-inferred', deployed: 'not-inferred' };
  } catch { return { sha: requested, object_available: false, verification: 'unverified', pushed: 'not-inferred', deployed: 'not-inferred' }; }
}

/** Query-local direct-edge graph; never materializes a transitive closure per event. */
function causalRelations(events) {
  const direct = new Map([...events].map(([ref, e]) => [ref, e.parents]));
  for (const parents of direct.values()) for (const ref of parents) if (!direct.has(ref)) direct.set(ref, []);
  const removedAt = new Map(), observedAt = new Map();
  let revision = 0, cachedRevision = -1, cached;
  const parentsAt = (ref, at) => (removedAt.get(ref) ?? Infinity) <= at ? [] : direct.get(ref) ?? [];
  const observedRevision = ref => {
    if (!observedAt.has(ref)) observedAt.set(ref, revision);
    return observedAt.get(ref);
  };
  function components(at) {
    if (cachedRevision === at) return cached;
    // Iterative Kosaraju passes avoid recursion limits on a long causal chain.
    const children = new Map([...direct.keys()].map(ref => [ref, []]));
    for (const ref of direct.keys()) for (const parent of parentsAt(ref, at)) children.get(parent).push(ref);
    const seen = new Set(), order = [];
    for (const ref of direct.keys()) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      const stack = [{ ref, next: 0 }];
      while (stack.length) {
        const frame = stack[stack.length - 1], parents = parentsAt(frame.ref, at);
        if (frame.next === parents.length) { order.push(frame.ref); stack.pop(); continue; }
        const parent = parents[frame.next++];
        if (!seen.has(parent)) { seen.add(parent); stack.push({ ref: parent, next: 0 }); }
      }
    }
    const component = new Map();
    let count = 0;
    for (let index = order.length - 1; index >= 0; index--) {
      const ref = order[index];
      if (component.has(ref)) continue;
      const id = count++, pending = [ref];
      component.set(ref, id);
      while (pending.length) {
        for (const child of children.get(pending.pop())) {
          if (!component.has(child)) { component.set(child, id); pending.push(child); }
        }
      }
    }
    const parents = Array.from({ length: count }, () => new Set());
    for (const ref of direct.keys()) {
      const id = component.get(ref);
      for (const parent of parentsAt(ref, at)) {
        const target = component.get(parent);
        if (id !== target) parents[id].add(target);
      }
    }
    // Keep only one condensation graph, even when conflicting amendments remove nodes.
    cachedRevision = at; cached = { component, parents }; return cached;
  }
  return {
    remove(ref) {
      // Compatibility with the old lazy ancestry cache: a conflicting interpretation
      // removes a node without clearing already observed roots. Remember their graph
      // revision, not their ancestor sets. A successful correction resets this helper.
      if (direct.has(ref) && !removedAt.has(ref)) removedAt.set(ref, ++revision);
    },
    maxima(entries) {
      const refs = new Set(entries.map(e => e.ref)), byRevision = new Map(), superseded = new Set();
      for (const ref of refs) {
        const at = observedRevision(ref), roots = byRevision.get(at) ?? new Set();
        roots.add(ref); byRevision.set(at, roots);
      }
      for (const [at, roots] of byRevision) {
        const { component, parents } = components(at), counts = new Map(), visited = new Set(), pending = [];
        for (const ref of roots) {
          const id = component.get(ref);
          if (id !== undefined) counts.set(id, (counts.get(id) ?? 0) + 1);
        }
        const visit = id => { if (!visited.has(id)) { visited.add(id); pending.push(id); } };
        // All candidates share this walk over strict ancestor components.
        for (const id of counts.keys()) for (const parent of parents[id]) visit(parent);
        while (pending.length) for (const parent of parents[pending.pop()]) visit(parent);
        for (const ref of refs) {
          const id = component.get(ref), peers = counts.get(id) ?? 0;
          // A cycle alone does not let a candidate supersede itself. Two DISTINCT
          // candidates in one SCC supersede each other, matching the original walk.
          if (visited.has(id) || peers > 1 || (peers === 1 && !roots.has(ref))) superseded.add(ref);
        }
      }
      // Preserve caller order, duplicate refs and the original record objects.
      return entries.filter(e => !superseded.has(e.ref));
    },
    cyclic(ref, parents) {
      return parents.some(parent => {
        if (parent === ref) return true;
        const { component } = components(observedRevision(parent));
        // This is used only for a direct edge ref -> parent of a surviving node.
        // The reverse reachability exists exactly when both nodes share an SCC.
        return component.has(ref) && component.get(ref) === component.get(parent);
      });
    },
  };
}

/** Pure reconstruction except read-only Git object lookup. Never trusts the cache or replays business actions. */
export function taskView(root, input, io) {
  const loaded = readInputs(root, io, input), issues = [...loaded.issues], unassociated = [], all = new Map();
  for (const r of loaded.records) {
    const e = obj(r.payload.task_event);
    const parsed = e.version === 1 ? e : rawEvent(r);
    if (parsed) all.set(r.ref, { ...parsed, ref: r.ref, data: obj(parsed.data), parents: unique(list(parsed.parents)), original: r });
    else if (['plan', 'decision', 'task-disposition', 'step-disposition', 'unassociated-task-request', 'task-event'].includes(r.payload.kind)) unassociated.push({ ref: r.ref, reason: 'No explicit machine-readable task action; use link with the actual meaning, not a new approval.' });
  }
  // Reachability, not filename or wall-clock time, determines supersession.
  let causal = causalRelations(all);
  const maxima = entries => causal.maxima(entries);
  const effective = new Set();
  function choose(field, entries) {
    const heads = maxima(entries);
    if (!heads.length) return null;
    if (heads.length === 1 || heads.every(e => digest(e.semantic ?? e.value) === digest(heads[0].semantic ?? heads[0].value))) return heads[0];
    const candidates = heads.map(e => e.ref).sort();
    const id = `conflict-${digest([field, candidates]).slice(0, 24)}`;
    const decisions = maxima([...all.values()].filter(e => e.action === 'resolve' && !e.data.association_error
      && e.data.conflict_id === id && candidates.includes(e.data.selected_ref)));
    if (decisions.length === 1) {
      effective.add(decisions[0].ref);
      if (decisions[0].interpretation_ref) effective.add(decisions[0].interpretation_ref);
      return heads.find(e => e.ref === decisions[0].data.selected_ref);
    }
    issues.push({ id, code: 'RECORD_CONFLICT', field, candidates, message: 'Concurrent alternatives require a specific selection; no last-write-wins.', options: ['resolve', 'defer'] });
    return { ref: null, value: null, conflict: id };
  }
  const amendments = new Map();
  for (const e of all.values()) if (['link', 'correct'].includes(e.action)) {
    const ref = e.data.record_ref;
    if (!loaded.records.some(r => r.ref === ref)) { unassociated.push({ ref: e.ref, reason: 'The record to supplement/correct was not found.' }); continue; }
    const group = amendments.get(ref) ?? []; group.push({ ...e, value: e.data }); amendments.set(ref, group);
  }
  for (const [ref, group] of amendments) {
    const selected = choose(`interpretation:${ref}`, group);
    if (selected?.conflict) { if (all.delete(ref)) causal.remove(ref); continue; }
    const original = loaded.records.find(r => r.ref === ref), old = all.get(ref) ?? rawEvent(original) ?? { data: obj(original.payload.body), parents: [] };
    const patch = obj(selected.data.event);
    all.set(ref, { ...old, ...patch, ref, data: { ...old.data, ...obj(patch.data) },
      parents: unique(patch.parents ?? old.parents), original, interpretation_ref: selected.ref });
    causal = causalRelations(all);
    const at = unassociated.findIndex(x => x.ref === ref); if (at >= 0) unassociated.splice(at, 1);
  }
  // Reject only the interpretation of malformed/cyclic associations, never their saved observations.
  const invalid = new Set();
  for (const e of all.values()) {
    if (causal.cyclic(e.ref, e.parents)) {
      invalid.add(e.ref); issues.push(diagnostic('ASSOCIATION_CYCLE', e.ref, 'Cyclic causal links; correct only this association.'));
    }
    if (!ACTIONS.has(e.action) || e.data.association_error) { invalid.add(e.ref); unassociated.push({ ref: e.ref, reason: e.data.association_error ?? 'Unknown task action; observation retained.' }); }
  }
  for (const ref of invalid) all.delete(ref);
  causal = causalRelations(all);
  const tasks = new Map(), aliases = new Map();
  const add = (id, display, title, baseline = null) => {
    if (!tasks.has(id)) tasks.set(id, { task_id: id, display_id: display ?? null, title: title ?? id, baseline, events: [] });
    for (const alias of unique([id, display, label(display)])) { const ids = aliases.get(alias) ?? new Set(); ids.add(id); aliases.set(alias, ids); }
    return tasks.get(id);
  };
  if (loaded.legacy.identity) {
    const old = loaded.legacy.identity; add(old.task_id, old.display_id, old.title, old);
  } else if (loaded.legacy.bytes) issues.push(diagnostic('LEGACY_ASSOCIATION_REQUIRED', loaded.legacy.ref, 'Old content preserved but no unambiguous hot-field identity could be read. Use link/import; do not assume no prior task exists.'));
  for (const e of all.values()) if (e.action === 'prepare' && e.data.create && typeof e.task_id === 'string') {
    add(e.task_id, e.data.display_id, e.data.plan?.title ?? e.data.title);
  }
  // Explicit old numeric task references can be grouped without inventing a plan or approval.
  for (const e of all.values()) if (!META_ACTIONS.has(e.action) && !e.original?.payload?.task_event && label(e.task_id) && !aliases.has(label(e.task_id))) {
    const display = label(e.task_id); add(`legacy-${display.toLowerCase()}`, display, display);
  }
  for (const assignment of loaded.labels) {
    const task = tasks.get(assignment.task_id);
    if (task && !task.display_id && label(assignment.display_id)) {
      task.display_id = assignment.display_id;
      const ids = aliases.get(assignment.display_id) ?? new Set(); ids.add(task.task_id); aliases.set(assignment.display_id, ids);
    }
  }
  function identity(ref) {
    if (tasks.has(ref)) return ref;
    const matches = aliases.get(label(ref) ?? ref);
    return matches?.size === 1 ? [...matches][0] : null;
  }
  for (const [alias, ids] of aliases) if (ids.size > 1) issues.push(diagnostic('TASK_ALIAS_CONFLICT', alias, 'Use the stable task ID; this display alias names multiple tasks.', { task_ids: [...ids] }));
  for (const e of all.values()) {
    if (META_ACTIONS.has(e.action)) continue;
    const id = identity(e.task_id);
    if (!id) { unassociated.push({ ref: e.ref, reason: 'Task identity is missing or ambiguous.', task_ref: e.task_id ?? null }); continue; }
    e.task_id = id; tasks.get(id).events.push(e);
  }
  function belongs(ref, task, action) { const target = all.get(ref); return !!target && target.task_id === task.task_id && (!action || action.includes(target.action)); }
  const result = [];
  const focus = [], gitCache = new Map();
  for (const task of tasks.values()) {
    const events = task.events;
    const plans = events.filter(e => e.action === 'prepare' && e.data.plan && typeof e.data.plan === 'object').map(e => ({ ...e.data.plan, ref: e.ref, parent_plan_ref: e.data.base_plan_ref ?? null }));
    const adopted = choose(`${task.task_id}:plan`, events.filter(e => e.action === 'adopt' && belongs(e.data.plan_ref, task, ['prepare'])).map(e => ({ ...e, value: e.data.plan_ref, semantic: { plan_ref: e.data.plan_ref, conditions: e.data.conditions ?? e.data.adoption_conditions ?? null } })));
    for (const e of events.filter(e => e.action === 'adopt' && !belongs(e.data.plan_ref, task, ['prepare']))) unassociated.push({ ref: e.ref, reason: 'Plan is missing or belongs to another task.' });
    const lifeEvents = events.filter(e => ['close', 'pause', 'resume'].includes(e.action)
      || (e.action === 'adopt' && e.data.activate && belongs(e.data.plan_ref, task, ['prepare'])));
    const life = choose(`${task.task_id}:lifecycle`, lifeEvents.map(e => ({ ...e, value: { close: 'closed', pause: 'paused', resume: 'active', adopt: 'active' }[e.action] })));
    const lifecycle = life?.conflict ? 'ambiguous' : life?.value ?? task.baseline?.lifecycle ?? 'draft';
    const plan = adopted?.conflict ? null : adopted?.value ? plans.find(p => p.ref === adopted.value) : task.baseline?.plan ?? null;
    const planRef = adopted?.conflict ? null : adopted?.value ?? task.baseline?.plan_ref ?? null;
    const reviews = [], executions = [], tests = [], decisions = [], commits = [], dispositions = [];
    for (const e of events) {
      const data = e.data, shared = { ...data, ref: e.ref, interpretation_ref: e.interpretation_ref ?? null };
      if (['execution', 'test', 'step'].includes(e.action)) {
        if (data.plan_ref && data.plan_ref !== task.baseline?.plan_ref && !belongs(data.plan_ref, task, ['prepare'])) { unassociated.push({ ref: e.ref, reason: 'Unknown/cross-task plan reference.' }); continue; }
        const targetPlan = data.plan_ref === task.baseline?.plan_ref ? task.baseline?.plan : plans.find(p => p.ref === data.plan_ref);
        const ids = list(targetPlan?.steps).map((s, i) => typeof s === 'string' ? `S${i + 1}` : obj(s).id ?? `S${i + 1}`);
        if (!data.plan_ref || !data.step_id || !ids.includes(data.step_id)) { unassociated.push({ ref: e.ref, reason: 'Exact plan/step association is missing or unknown.' }); continue; }
      }
      if (e.action === 'step' && !['finished', 'skipped', 'closed', 'in-progress', 'not-started'].includes(data.state)) { unassociated.push({ ref: e.ref, reason: 'Unknown work disposition; observation retained without advancing a step.' }); continue; }
      if (e.action === 'execution') executions.push(shared);
      if (e.action === 'test') tests.push(shared);
      if (e.action === 'step') dispositions.push(shared);
      if (e.action === 'git') {
        const gitRef = data.sha ?? data.commit_sha;
        if (!gitCache.has(gitRef)) gitCache.set(gitRef, gitObject(root, gitRef));
        const actual = gitCache.get(gitRef);
        commits.push({ ...shared, ...actual });
        if (!actual.object_available) issues.push(diagnostic('COMMIT_NOT_VERIFIED', e.ref, 'Recorded commit reference is not a locally available Git commit; no commit/push/deploy was replayed.', { task_id: task.task_id }));
      }
      if (e.action === 'focus' || ((e.action === 'adopt' || e.action === 'resume') && data.focus === true)) {
        if (e.action !== 'adopt' || belongs(data.plan_ref, task, ['prepare'])) focus.push({ ...e, value: task.task_id });
      }
    }
    // Validate dependent observations after collecting their targets; journal filenames have no causal order.
    for (const e of events.filter(e => e.action === 'review')) {
      const planValid = !e.data.plan_ref || e.data.plan_ref === task.baseline?.plan_ref || belongs(e.data.plan_ref, task, ['prepare']);
      const valid = planValid && (e.data.stage === 'draft' ? belongs(e.data.plan_ref, task, ['prepare'])
        : e.data.stage === 'change' && executions.some(x => x.ref === e.data.execution_ref));
      if (valid) reviews.push({ ...e.data, ref: e.ref, interpretation_ref: e.interpretation_ref ?? null });
      else unassociated.push({ ref: e.ref, reason: 'Review must identify its real draft or effective execution target, without inventing a clean receipt.' });
    }
    for (const e of events.filter(e => e.action === 'review-decision')) {
      if (reviews.some(r => r.ref === e.data.review_ref)) decisions.push({ ...e.data, ref: e.ref, interpretation_ref: e.interpretation_ref ?? null });
      else unassociated.push({ ref: e.ref, reason: 'Review disposition target has no effective review association.' });
    }
    const steps = list(plan?.steps).map((s, index) => {
      const definition = typeof s === 'string' ? { id: `S${index + 1}`, title: s } : obj(s);
      const id = definition.id ?? `S${index + 1}`;
      const eligible = row => row.step_id === id && row.plan_ref === planRef && row.historical !== true;
      const run = choose(`${task.task_id}:${planRef}:${id}:execution`, executions.filter(eligible).map(e => ({ ...e, value: e.ref })));
      const review = choose(`${task.task_id}:${planRef}:${id}:review`, reviews.filter(r => r.stage === 'change' && r.execution_ref === run?.value).map(e => ({ ...e, value: { verdict: e.verdict, findings: e.findings, coverage: e.coverage, provenance: e.provenance, source_revision: e.source_revision } })));
      const reviewDecision = choose(`${task.task_id}:${planRef}:${id}:review-decision`, decisions.filter(d => d.review_ref === review?.ref).map(e => ({ ...e, value: e.choice ?? 'unspecified' })));
      const disposition = choose(`${task.task_id}:${planRef}:${id}:disposition`, dispositions.filter(eligible).map(e => ({ ...e, value: e.state ?? 'unknown' })));
      const legacyStep = planRef === task.baseline?.plan_ref && id === task.baseline?.current_step_id;
      return { ...definition, id, state: disposition?.conflict || run?.conflict ? 'ambiguous' : disposition?.value ?? (run ? 'executed' : legacyStep ? 'legacy-state' : 'not-started'),
        legacy_step_status: legacyStep ? task.baseline?.step_status ?? 'unknown' : null,
        execution_ref: run?.value ?? null, execution: run && !run.conflict ? executions.find(e => e.ref === run.value) : null,
        review_ref: review?.ref ?? null, review_status: review?.conflict ? 'ambiguous' : review?.value?.verdict ?? 'not-reviewed',
        findings: review?.value?.findings ?? [], review_choice: reviewDecision?.conflict ? 'ambiguous' : reviewDecision?.value ?? null, review_decision_ref: reviewDecision?.ref ?? null, review_decisions: decisions.filter(d => d.review_ref === review?.ref),
        tests: tests.filter(eligible), disposition_ref: disposition?.ref ?? null,
        historical_execution_refs: executions.filter(e => e.step_id === id && !eligible(e)).map(e => e.ref) };
    });
    const currentStep = steps.find(s => !['finished', 'skipped', 'closed'].includes(s.state));
    let route = null, mode = null, nextAction = null;
    if (lifecycle !== 'closed' && lifecycle !== 'paused') {
      if (adopted?.conflict) route = 'task-lifecycle';
      else if (!adopted?.value && !task.baseline) route = reviews.some(r => r.stage === 'draft') ? 'prepare-task' : 'review-draft';
      else if (plan && !list(plan.steps).length) route = 'prepare-task';
      else if (currentStep) {
        if (currentStep.state === 'ambiguous' || currentStep.state === 'legacy-state' || currentStep.review_status === 'ambiguous') route = 'task-lifecycle';
        else if (!currentStep.execution_ref) { route = 'execute-step'; nextAction = 'implement-step'; }
        else if (!currentStep.review_ref) { route = 'review-change'; nextAction = 'review-step'; }
        else {
          route = 'execute-step';
          mode = currentStep.review_status === 'clean' || ['accept', 'continue', 'finish', 'defer'].includes(currentStep.review_choice) ? 'finish' : 'repair';
          nextAction = mode === 'repair' ? 'repair-step' : 'finish-step';
        }
      } else route = 'close-task'; // Missing optional Git associations do not imply uncommitted work.
    }
    result.push({ task_id: task.task_id, display_id: task.display_id, title: plan?.title ?? task.title,
      lifecycle, lifecycle_ref: life?.ref ?? task.baseline?.source_ref ?? null, adopted_plan_ref: adopted?.value ?? null,
      plan_status: adopted?.conflict ? 'ambiguous' : adopted ? 'adopted' : task.baseline ? 'legacy-summary-only' : 'candidate',
      plan, plans, adopted_by: adopted?.ref ?? null, adoption: adopted?.ref ? { ...adopted.data, ref: adopted.ref } : null, candidate_plan_refs: plans.filter(p => p.ref !== adopted?.value).map(p => p.ref),
      current_step_id: lifecycle === 'closed' || adopted?.conflict ? null : (steps.length ? currentStep?.id ?? null : task.baseline?.current_step_id ?? null),
      steps, reviews, executions, tests, review_decisions: decisions, commits,
      dispositions: events.filter(e => ['close', 'pause', 'resume'].includes(e.action)).map(e => ({ ...e.data, ref: e.ref, action: e.action })),
      next_route: route, next_mode: mode, next_action: nextAction, recommendation_only: true,
      legacy_source: task.baseline?.source_ref ?? null, legacy_plan_ref: task.baseline?.plan_ref ?? null, heads: maxima(events).map(e => e.ref) });
    const applied = [
      ...events.filter(e => e.action === 'prepare' && e.data.plan && typeof e.data.plan === 'object'),
      // Valid lifecycle history remains associated after a later decision takes over.
      ...events.filter(e => ['close', 'pause', 'resume'].includes(e.action)),
      ...executions, ...tests, ...reviews, ...decisions, ...commits, ...dispositions,
      ...(adopted?.ref ? [adopted] : []), ...(life?.ref ? [life] : []),
    ];
    for (const item of applied) {
      effective.add(item.ref);
      if (item.interpretation_ref) effective.add(item.interpretation_ref);
    }
  }
  const selected = choose('project:focus', focus);
  if (selected?.ref) {
    effective.add(selected.ref);
    if (selected.interpretation_ref) effective.add(selected.interpretation_ref);
  }
  const active = result.filter(t => t.lifecycle === 'active');
  const current = selected?.conflict ? null : selected?.value ? active.find(t => t.task_id === selected.value) ?? null : active.length === 1 ? active[0] : null;
  if (!selected && active.length > 1) issues.push(diagnostic('FOCUS_CHOICE_REQUIRED', null, 'Multiple active tasks; select a work focus without silently closing another task.', { task_ids: active.map(t => t.task_id) }));
  const dedup = [...new Map(unassociated.map(x => [x.ref, x])).values()];
  for (const item of dedup) issues.push(diagnostic('UNASSOCIATED_RECORD', item.ref, item.reason));
  const deferred = [...all.values()].filter(e => e.action === 'defer');
  for (const item of issues) {
    const refs = deferred.filter(e => list(e.data.issue_ids).includes(item.id)).map(e => e.ref);
    if (refs.length) { item.deferred_by = refs; refs.forEach(ref => effective.add(ref)); }
  }
  const output = { ...meta(), kind: 'task-view/v1', source_revision: loaded.source_revision, workflow_home: loaded.legacy.home,
    current_task_id: current?.task_id ?? null, current_task: current, tasks: result,
    issues, unassociated_records: dedup, health: issues.length || dedup.length ? 'needs-attention' : 'consistent',
    recovery_options: RECOVERY, heads: maxima([...all.values()]).map(e => e.ref), records_scanned: loaded.records.length,
    state_completeness: dedup.length ? 'partial-associations' : issues.length ? 'partial' : 'complete' };
  const view = { ...output, view_revision: digest(output) };
  Object.defineProperty(view, 'effective_refs', { value: effective });
  return view;
}

function render(view) {
  const current = view.current_task;
  const clean = value => String(value ?? '').replace(/[\r\n|]/g, ' ');
  return ['---', 'schema_version: 1', 'kind: vnext-task-view', `source_revision: ${view.source_revision}`, `view_revision: ${view.view_revision}`, '---', MARKER,
    '# CURRENT_TASK', '', '> Generated management view, not execution permission or verification.',
    '> Query assistance.mjs task-status/context for the current journal state; do not parse this with the legacy task kernel.', '',
    '## Current work', current ? `- Task: ${clean(current.display_id)} (${clean(current.task_id)}) — ${clean(current.title)}` : '- No unambiguous active work focus.',
    `- Adopted plan: ${clean(current?.adopted_plan_ref ?? 'none')}`, `- Step: ${clean(current?.current_step_id ?? 'none')}`,
    `- Suggested next route: ${clean(current?.next_route ?? 'none')} (advice only)`,
    `- Suggested next action: ${clean(current?.next_action ?? 'none')} (advice only)`, '', '## Tasks',
    '| Task | Lifecycle | Plan | Step |', '| --- | --- | --- | --- |',
    ...view.tasks.map(t => `| ${clean(t.display_id ?? t.task_id)} | ${clean(t.lifecycle)} | ${clean(t.plan_status)} | ${clean(t.current_step_id ?? 'none')} |`), '',
    '## Review, execution and remaining work',
    ...(current?.steps ?? []).map(s => `- ${clean(s.id)}: work=${clean(s.state)}; review=${clean(s.review_status)}; findings=${list(s.findings).length}; tests=${s.tests.length}; source=${clean(s.execution_ref ?? 'none')}`),
    ...view.tasks.flatMap(t => t.dispositions.filter(d => d.action === 'close').map(d => `- ${clean(t.display_id ?? t.task_id)} closed: ${clean(JSON.stringify(d.remaining_work ?? d.gaps ?? d))}`)), '',
    '## Management status', `- Source: ${view.source_revision}`, `- Health: ${view.health}`,
    `- Unassociated observations: ${view.unassociated_records.length}`,
    ...view.issues.map(i => `- ${clean(i.id)}: ${clean(i.message)}${i.deferred_by ? ' (deferred, not resolved)' : ''}`),
    '- Recover with task rebuild/link/correct/resolve/defer. Rebuilding never reruns business commands.', '',
  ].join('\n');
}
function atomicReplace(root, ref, bytes, io) {
  const file = io.local(root, ref); fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, file);
  } finally { fs.rmSync(temp, { force: true }); }
}
function publishDisplay(root, ref, text, previous, io) {
  const file = io.local(root, ref), next = Buffer.from(text);
  if (previous?.equals(next)) return { status: 'updated' };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const candidate = `${file}.${randomUUID()}.tmp`;
  const preservedRef = `${STORE}/legacy/display-capture-${randomUUID()}.md`;
  const preserved = io.local(root, preservedRef);
  let captured = false;
  const drift = () => ({ status: 'drift', preserved_display_ref: captured ? preservedRef : undefined });
  try {
    const fd = fs.openSync(candidate, 'wx', 0o600);
    try { fs.writeFileSync(fd, next); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if (previous !== null) {
      io.publish(root, `${STORE}/legacy/display-${digest(previous)}.md`, previous);
      fs.mkdirSync(path.dirname(preserved), { recursive: true });
      // Move the actual inode into history, including edits made since validation.
      try { fs.renameSync(file, preserved); captured = true; }
      catch (e) { if (e.code === 'ENOENT') return drift(); throw e; }
      if (!fs.readFileSync(preserved).equals(previous)) return drift();
    }
    // Never replace an existing path. An editor that saves during publication wins.
    try { fs.linkSync(candidate, file); }
    catch (e) { if (e.code === 'EEXIST') return drift(); throw e; }
    if (captured && !fs.readFileSync(preserved).equals(previous)) return drift();
    return { status: 'updated', preserved_display_ref: captured ? preservedRef : undefined };
  } finally {
    if (captured) {
      // Restore only an absent path. Keep the captured inode even on success so delayed
      // writes through an editor's already-open descriptor cannot disappear on cleanup.
      try { fs.linkSync(preserved, file); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
    fs.rmSync(candidate, { force: true });
  }
}
function viewLock(root, io, fn) {
  const ref = `${STORE}/task-view.lock`;
  let file = io.local(root, ref);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const owner = { pid: process.pid, host: hostname(), id: randomUUID() };
  const busy = () => Object.assign(new Error('Task view is being published; facts are saved and live queries remain available.'), { code: 'VIEW_BUSY' });
  // Link a completely written inode into place. A crash cannot leave a new empty lock.
  const temp = `${file}.${owner.id}.tmp`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try {
    try { fs.writeFileSync(fd, json(owner)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    for (;;) {
      try { fs.linkSync(temp, file); break; }
      catch (e) {
        if (e.code !== 'EEXIST') throw e;
        let stat, raw;
        try { stat = fs.statSync(file); raw = fs.readFileSync(file, 'utf8'); }
        catch (readError) { if (readError.code === 'ENOENT') continue; throw readError; }
        let old = null;
        try { old = JSON.parse(raw); } catch { /* Legacy interrupted writer. */ }
        let abandoned = false;
        const validOwner = typeof old?.host === 'string' && Number.isSafeInteger(old?.pid) && old.pid > 0;
        if (validOwner && old.host === hostname()) {
          try { process.kill(old.pid, 0); } catch (p) { abandoned = p.code === 'ESRCH'; }
        } else if (!validOwner && Date.now() - stat.mtimeMs > 30_000) abandoned = true;
        if (!abandoned) {
          const error = busy();
          if (!validOwner) error.message = 'Incomplete legacy lock metadata; retry rebuild after 30 seconds. Facts and live queries remain available.';
          throw error;
        }
        // Reclaimers compete for the same successor without deleting or renaming the
        // old lock: one reclaimer can never remove a new owner's lock in a check/delete race.
        file = io.local(root, `${STORE}/task-view-recovery-${digest([path.basename(file), raw])}.lock`);
      }
    }
    return fn();
  } finally {
    try { if (JSON.parse(fs.readFileSync(file, 'utf8')).id === owner.id) fs.unlinkSync(file); } catch { /* Do not remove another writer's lock. */ }
    fs.rmSync(temp, { force: true });
  }
}
/** View publication is secondary; every failure is returned separately from fact persistence. */
export function synchronizeTasks(root, input, io) {
  try {
    return viewLock(root, io, () => {
      retainBaseline(root, io, input.workflow_home);
      let view = taskView(root, input, io);
      for (const pending of view.tasks.filter(t => !t.display_id)) allocateLabel(root, pending.task_id, {}, view, io);
      if (view.tasks.some(t => !t.display_id)) view = taskView(root, input, io);
      const text = render(view);
      const snapshotRef = `${STORE}/task-views/${view.view_revision}.md`;
      io.publish(root, snapshotRef, text);
      atomicReplace(root, CACHE, json(view), io);
      const target = `${view.workflow_home}/CURRENT_TASK.md`;
      let previous = null;
      try { previous = readFile(root, target, io); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      let replaceable = previous === null;
      if (previous?.toString().includes(MARKER)) {
        const revision = /^view_revision: ([a-f0-9]{64})$/m.exec(previous.toString())?.[1];
        try { replaceable = readFile(root, `${STORE}/task-views/${revision}.md`, io).equals(previous); } catch { replaceable = false; }
      } else if (previous) {
        const baseline = legacySource(root, io, view.workflow_home);
        replaceable = !!legacyIdentity(previous, target) && !!baseline.bytes?.equals(previous);
      }
      if (!view.tasks.length) return { status: 'updated', cache_ref: CACHE, display: 'retained-no-managed-task', view };
      if (!replaceable && input.overwrite_display !== true) return { status: 'partial', cache_ref: CACHE, display: 'drift', view,
        issues: [diagnostic('CURRENT_TASK_DRIFT', target, 'Current display has unrecognized/user-modified content. Live task-status is current; choose rebuild with overwrite_display to preserve and replace it.')] };
      const publication = publishDisplay(root, target, text, previous, io);
      if (publication.status === 'drift' || !readFile(root, target, io).equals(Buffer.from(text))) return { status: 'partial', cache_ref: CACHE, display: 'drift', view,
        preserved_display_ref: publication.preserved_display_ref,
        issues: [diagnostic('CURRENT_TASK_DRIFT', target, 'Current display changed during publication. Live task-status is current; inspect the current file and preserved display before retrying.', { preserved_display_ref: publication.preserved_display_ref })] };
      return { status: 'updated', cache_ref: CACHE, display: 'updated', display_ref: target, view };
    });
  } catch (e) { return { status: 'failed', ...errorInfo(e), recovery_options: ['rebuild', 'defer'], development_gate: false }; }
}
export function taskStatus(root, input, io) {
  const view = taskView(root, input, io);
  let cache = 'missing';
  try { const saved = JSON.parse(readFile(root, CACHE, io)); cache = saved.source_revision === view.source_revision && saved.view_revision === view.view_revision ? 'current' : 'stale'; }
  catch (e) { if (e.code !== 'ENOENT') cache = 'unreadable'; }
  let display = 'missing';
  try { const text = readFile(root, `${view.workflow_home}/CURRENT_TASK.md`, io).toString(); display = text === render(view) ? 'current' : text.includes(MARKER) ? 'stale-or-edited' : 'legacy'; }
  catch (e) { if (e.code !== 'ENOENT') display = 'unreadable'; }
  if (input.task_ref) {
    const matches = view.tasks.filter(t => t.task_id === input.task_ref || (label(input.task_ref) && t.display_id === label(input.task_ref)));
    view.selected_task = matches.length === 1 ? matches[0] : null;
    if (matches.length !== 1) view.issues.push(diagnostic('TASK_SELECTION_UNRESOLVED', input.task_ref, 'No unique task matches this reference; inspect candidates or link the saved plan.'));
  }
  return { ...view, status: 'available', projection: { cache, display, read_only_rebuilt: true },
    note: 'Computed from retained facts, not a stale CURRENT_TASK or a first page of search hits. A partial association is reported, never interpreted as approval or absence of work.' };
}
function allocateLabel(root, taskId, input, view, io) {
  const existing = files(root, `${STORE}/task-labels`, io, '.json');
  let max = 0;
  for (const t of view.tasks) if (label(t.display_id)) max = Math.max(max, Number(t.display_id.slice(5)));
  for (const file of existing) {
    const name = label(path.posix.basename(file, '.json'));
    if (name) max = Math.max(max, Number(name.slice(5)));
    let row; try { row = JSON.parse(readFile(root, file, io)); } catch { continue; }
    if (row.task_id === taskId && label(row.display_id)) return row.display_id;
    if (label(row.display_id)) max = Math.max(max, Number(row.display_id.slice(5)));
  }
  // Reserve visible historical TASK numbers even when old task state cannot be decoded.
  for (const start of ['TASKS', `${view.workflow_home}/task-history`, `${view.workflow_home}/task-archive`]) {
    const pending = [start];
    while (pending.length) {
      const dir = pending.pop();
      let entries; try { entries = fs.readdirSync(io.local(root, dir), { withFileTypes: true }); } catch { continue; }
      for (const item of entries) {
        const match = /TASK[- _]?(\d+)/i.exec(item.name); if (match) max = Math.max(max, Number(match[1]));
        if (item.isDirectory() && !item.isSymbolicLink()) pending.push(`${dir}/${item.name}`);
      }
    }
  }
  let next = input.display_id ? Number((label(input.display_id) ?? '').slice(5)) : max + 1;
  if (!Number.isSafeInteger(next) || next < 1) next = max + 1;
  for (;;) {
    const display_id = `TASK-${String(next).padStart(3, '0')}`, ref = `${STORE}/task-labels/${display_id}.json`;
    if (view.tasks.some(t => t.display_id === display_id && t.task_id !== taskId)) { next++; continue; }
    const row = { kind: 'task-label/v1', display_id, task_id: taskId };
    if (io.publish(root, ref, json(row))) return display_id;
    let old; try { old = JSON.parse(readFile(root, ref, io)); } catch { next++; continue; }
    if (old.task_id === taskId) return old.display_id;
    next++;
  }
}

/** Semantic convenience, not admission. Raw invalid/unlinked requests are still retained. */
export function taskCommand(root, input, io) {
  const action = input.action ?? 'status';
  if (action === 'status') return taskStatus(root, input, io);
  if (action === 'rebuild') {
    const projection = synchronizeTasks(root, input, io);
    return { ...taskStatus(root, input, io), status: projection.status === 'updated' ? 'rebuilt' : 'needs-attention', recorded: false,
      rebuild: { ...projection, view: undefined } };
  }
  const original = structuredClone(input), view = taskView(root, input, io), data = { ...input };
  delete data.action; delete data.idempotency_key; delete data.task_ref; delete data.task_id; delete data.parents;
  let target = input.task_id ?? input.task_ref;
  const matches = target ? view.tasks.filter(t => t.task_id === target || (label(target) && t.display_id === label(target))) : [];
  let task = target ? matches.length === 1 ? matches[0] : null : view.current_task;
  if (!target && input.plan_ref) task = view.tasks.find(t => t.plans.some(p => p.ref === input.plan_ref)) ?? task;
  let taskId = task?.task_id ?? target ?? null;
  const preparingNew = action === 'prepare' && !target;
  const issues = [];
  if (preparingNew) {
    taskId = input.idempotency_key ? `task-${digest(['task', input.idempotency_key]).slice(0, 32)}` : `task-${randomUUID()}`;
    data.create = true;
    try { data.display_id = allocateLabel(root, taskId, input, view, io); }
    catch (e) { issues.push(errorInfo(e)); data.display_id = null; }
  }
  if (['link', 'correct'].includes(action)) {
    data.event = structuredClone(obj(input.event));
    if (data.event.action === 'prepare' && data.event.data?.create && !data.event.task_id) {
      taskId = `task-${digest(['import-plan', data.record_ref]).slice(0, 32)}`;
      data.event.task_id = taskId;
      try { data.event.data.display_id = allocateLabel(root, taskId, input, view, io); }
      catch (e) { issues.push(errorInfo(e)); }
    } else if (data.event.task_id) taskId = data.event.task_id;
  }
  if (action === 'prepare') {
    data.plan = input.plan ?? { title: input.title ?? 'Untitled task', steps: input.steps ?? [] };
    if (!preparingNew) data.base_plan_ref ??= task?.adopted_plan_ref;
  }
  if (['execution', 'test'].includes(action) && task?.lifecycle === 'closed') data.historical ??= true;
  if (['execution', 'test', 'step'].includes(action)) {
    data.plan_ref ??= task?.adopted_plan_ref ?? task?.legacy_plan_ref;
    data.step_id ??= task?.current_step_id;
  }
  if (action === 'adopt') {
    if (!data.plan_ref && task?.candidate_plan_refs.length === 1) data.plan_ref = task.candidate_plan_refs[0];
    data.activate = input.activate ?? (!task || task.lifecycle === 'draft');
    data.focus = input.focus ?? (!view.current_task || view.current_task_id === taskId || view.current_task.lifecycle === 'closed');
  }
  if (action === 'resume') data.focus = input.focus ?? !view.current_task;
  if (action === 'review' && data.stage === 'change' && !data.execution_ref) {
    data.execution_ref = task?.steps.find(s => s.id === (data.step_id ?? task?.current_step_id))?.execution_ref;
  }
  if (action === 'review' && data.stage === 'draft' && !data.plan_ref && task?.candidate_plan_refs.length === 1) data.plan_ref = task.candidate_plan_refs[0];
  // Canonical input-key replay: derived heads/defaults must not turn a retry into a new decision.
  const requestKey = input.idempotency_key;
  if (requestKey) {
    for (const ref of files(root, `${STORE}/events`, io, '.json')) {
      let p; try { const row = JSON.parse(readFile(root, ref, io)); if (digest(row.payload) !== row.payload_sha256) continue; p = row.payload; } catch { continue; }
      if (p?.kind === 'task-event' && p.request?.idempotency_key === requestKey && digest(p.request) === digest(original)) {
        const saved = io.record(root, p), projection = synchronizeTasks(root, input, io);
        return operationResult(saved, projection, p.task_event.task_id, issues, p.task_event);
      }
    }
  }
  if (action === 'resolve' && !view.issues.some(i => i.code === 'RECORD_CONFLICT' && i.id === data.conflict_id && i.candidates.includes(data.selected_ref))) {
    data.association_error = 'The conflict/selection is not present in the current view; inspect the actual alternatives.';
  }
  const payload = { kind: 'task-event', idempotency_key: requestKey ? `task:${requestKey}` : undefined, request: original, files: input.files, workflow_home: input.workflow_home,
    task_event: { version: 1, action, task_id: taskId, parents: input.parents ?? view.heads, data } };
  // Unknown action or incomplete association does not lose the original request.
  const saved = io.record(root, payload), projection = synchronizeTasks(root, input, io);
  return operationResult(saved, projection, taskId, issues, payload.task_event);
}
function operationResult(saved, projection, taskId, issues, event) {
  const view = projection.view;
  const affected = new Set([saved.ref, ...(['link', 'correct'].includes(event?.action) ? [event.data.record_ref] : [])]);
  const pending = view?.unassociated_records.filter(r => affected.has(r.ref)) ?? [];
  const related = view?.issues.filter(i => (i.code === 'RECORD_CONFLICT' && i.candidates.some(ref => affected.has(ref)))
    || (i.code === 'ASSOCIATION_CYCLE' && affected.has(i.ref))) ?? [];
  const applied = view ? view.effective_refs.has(saved.ref) : false;
  const unresolved = !!view && (!applied || pending.length || related.length);
  const notApplied = view && !applied && !pending.length && !related.length
    ? [diagnostic('ASSOCIATION_NOT_APPLIED', saved.ref, 'Saved observation did not enter the effective task view; inspect its target and current alternatives.')]
    : [];
  return { ...meta(), status: unresolved ? 'recorded-unassociated' : projection.status === 'updated' ? 'applied' : 'recorded-pending-view',
    recorded: saved.recorded, ref: saved.ref, task_id: taskId, task: view?.tasks.find(t => t.task_id === taskId) ?? null,
    association: view ? unresolved ? 'unresolved' : 'applied' : 'not-evaluated',
    projection: { ...projection, view: undefined }, current_task_id: view?.current_task_id ?? null,
    issues: [...issues, ...list(saved.issues), ...pending, ...notApplied, ...list(view?.issues)], recovery_options: RECOVERY };
}
