import { type Catalog, type Item, type ObjectValue } from './model';
import { definitionAlgorithm, requirementDigest, sha256 } from './parser';
import { productView } from './scoped';
import { readSource } from './references';

const ARRANGEMENT = 'vnext-roadmap-arrangement/v1';
const GRAPH = 'vnext-planning-context/v1';
export function canonicalPlanning(value: any): string {
  function ordered(v: any): any {
    if (Array.isArray(v)) return v.map(ordered);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, ordered(v[k])]));
    if (typeof v === 'string') return v.replace(/\r\n|\r/g, '\n');
    return v;
  }
  return JSON.stringify(ordered(value));
}
export function arrangementSnapshot(plan: Item): ObjectValue {
  // Array order is meaningful; baseline, source bookkeeping and task facts are not.
  const { id, intent_state, targets, work_items } = plan.metadata;
  const work = work_items.map(({ sources, ...arrangement }: ObjectValue) => arrangement);
  return { algorithm: ARRANGEMENT, sha256: sha256(`${ARRANGEMENT}\n${canonicalPlanning({ id, intent_state, targets, work_items: work,
    body: plan.body.replace(/\r\n|\r/g, '\n').replace(/\n+$/, '') })}`) };
}
const snapshot = (item: Item): ObjectValue => ({ id: item.id, algorithm: definitionAlgorithm(item), sha256: requirementDigest(item) });
const unique = (ids: string[]): string[] => [...new Set(ids)].sort();
const same = (a: any, b: any): boolean => canonicalPlanning(a) === canonicalPlanning(b);
function contextSnapshot(item: Item, relations: ObjectValue[]): ObjectValue {
  if (item.type === 'goal') return snapshot(item);
  return { id: item.id, algorithm: GRAPH, sha256: sha256(`${GRAPH}\n${canonicalPlanning({ id: item.id, scope: item.metadata.scope,
    relations: relations.filter(r => r.owner === item.id).map(r => [r.relation, r.target]).sort() })}`) };
}

/** Enumerate only declared, effective composition/support; no inferred business ownership. */
export function planningScope(catalog: Catalog, selector: ObjectValue, plan?: Item): ObjectValue {
  const reasons: string[] = [], exclude = new Set(selector.exclude_ids ?? []);
  const all = catalog.items.filter(i => i.usable && i.type === 'requirement' && i.metadata.scope === 'current');
  const view = productView(catalog);
  const relations = view.current_relations.filter((r: any) => ['part_of', 'supports'].includes(r.relation)
    && catalog.byId.get(r.owner)?.metadata.scope === 'current' && catalog.byId.get(r.target)?.metadata.scope === 'current');
  let selected: string[] = [], context: ObjectValue[] = [], reachable = new Set<string>();
  // Every selector needs registered identity coverage: an unread document can
  // contain another definition of even an explicitly selected ID.
  if (!catalog.coverage.complete || !same(unique(catalog.coverage.paths ?? []), unique(catalog.manifest?.managed_paths ?? []))) reasons.push('enumeration-incomplete');
  if (catalog.diagnostics.some(d => d.severity === 'error' && !d.item_id)) reasons.push('identity-coverage-incomplete');
  if (selector.kind === 'explicit-requirements') {
    selected = selector.requirement_ids.filter((id: string) => !exclude.has(id));
    for (const id of selected) {
      const item = catalog.byId.get(id);
      if (!item || item.type !== 'requirement') reasons.push(`requirement-unavailable:${id}`);
    }
    selected = selected.filter((id: string) => catalog.byId.get(id)?.type === 'requirement' && catalog.byId.get(id)?.metadata.scope === 'current');
  } else {
    if (catalog.diagnostics.some(d => d.severity === 'error')) reasons.push('structure-incomplete');
    if (selector.kind === 'project-current') selected = all.map(i => i.id);
    else if (selector.kind === 'target-subgraph') {
      reachable = new Set<string>(selector.target_ids.filter((id: string) => !exclude.has(id)));
      for (const id of reachable) {
        const item = catalog.byId.get(id);
        if (!item || !['goal', 'requirement'].includes(item.type) || item.metadata.scope !== 'current') reasons.push(`target-unavailable:${id}`);
      }
      let changed = true;
      while (changed) {
        changed = false;
        for (const r of relations) if (reachable.has(r.target) && !reachable.has(r.owner) && !exclude.has(r.owner)) { reachable.add(r.owner); changed = true; }
      }
      if (view.diagnostics.some((d: any) => reachable.has(d.owner ?? d.goal_id))) reasons.push('scope-relations-invalid');
      selected = all.filter(i => reachable.has(i.id)).map(i => i.id);
      context = catalog.items.filter(i => i.usable && reachable.has(i.id) && ['goal', 'module'].includes(i.type)).map(i => contextSnapshot(i, relations));
    } else reasons.push('selector-unsupported');
    selected = selected.filter(id => !exclude.has(id));
  }
  if (catalog.status !== 'available') reasons.push('catalog-unavailable');
  selected = unique(selected);
  if (selector.kind !== 'target-subgraph') {
    const ancestry = new Set<string>([...selected, ...(plan?.metadata.targets ?? []).map((t: any) => t.target)]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const r of relations) if (ancestry.has(r.owner) && !ancestry.has(r.target)) { ancestry.add(r.target); changed = true; }
    }
    context = catalog.items.filter(i => i.usable && ancestry.has(i.id) && i.metadata.scope === 'current' && ['goal', 'module'].includes(i.type)).map(i => contextSnapshot(i, relations));
    if (view.diagnostics.some((d: any) => ancestry.has(d.owner ?? d.goal_id))) reasons.push('scope-relations-invalid');
  }
  for (const d of context) if (d.algorithm === 'vnext-requirement-definition/v1') reasons.push(`goal-format-uncomparable:${d.id}`);
  if ((selector.requirement_ids && unique(selector.requirement_ids).length !== selector.requirement_ids.length)
    || (selector.target_ids && unique(selector.target_ids).length !== selector.target_ids.length)) reasons.push('selector-duplicate');
  return { selector, member_ids: selected, definitions: selected.map(id => snapshot(catalog.byId.get(id)!)), context: context.sort((a,b) => a.id.localeCompare(b.id)),
    definition_locators: selected.map(id => ({ id, locator: { kind: 'file', path: catalog.byId.get(id)!.path, item_id: id } })),
    outside_scope: all.filter(i => !selected.includes(i.id)).map(i => i.id).sort(),
    unassigned: selector.kind === 'target-subgraph' ? all.filter(i => !reachable.has(i.id) && !relations.some((r: any) => r.owner === i.id)).map(i => i.id).sort() : [],
    reasons: unique(reasons), complete: !reasons.length };
}

/** Pure comparison. The snapshot proposal is material for Agent review, never attestation. */
export function reconcileRoadmap(catalog: Catalog, query: ObjectValue): ObjectValue {
  const plan = catalog.byId.get(query.plan_id), baseline = plan?.metadata.planning_baseline;
  const reasons: string[] = [], changes: ObjectValue[] = [];
  const selector = query.selector ?? baseline?.selector;
  const result: ObjectValue = { plan_id: query.plan_id, status: 'unknown', reasons, changes, development_gate: false,
    business_validity: 'not-evaluated', delivery: 'not-evaluated', task_operations: 'not-performed' };
  if (!plan || plan.type !== 'plan') { reasons.push('roadmap-unavailable'); return result; }
  result.locator = { kind: 'file', path: plan.path, item_id: plan.id };
  result.intent_state = plan.metadata.intent_state;
  result.work_items = plan.metadata.work_items;
  result.diagnostics = catalog.diagnostics.filter(d => d.item_id === plan.id);
  if (result.diagnostics.some((d: any) => ['DUPLICATE_WORK_ITEM', 'UNRESOLVED_TARGET', 'TARGET_TYPE', 'WORK_DEPENDENCY_MISSING', 'WORK_DEPENDENCY_CYCLE'].includes(d.code))) reasons.push('roadmap-references-unresolved');
  if (!selector) { reasons.push('baseline-missing', 'selector-required'); return result; }
  const current = planningScope(catalog, selector, plan), arrangement = arrangementSnapshot(plan);
  result.scope = current;
  result.arrangement = arrangement;
  reasons.push(...current.reasons);
  result.unarranged_requirements = current.member_ids.filter((id: string) => !plan.metadata.work_items.some((w: any) => w.state !== 'withdrawn' && w.targets.some((t: any) => t.target === id)));
  result.snapshot_proposal = { project_id: catalog.manifest?.project_id, selector, member_ids: current.member_ids, definitions: current.definitions, context: current.context, arrangement };
  result.proposal_assurance = 'not-reviewed; supply actual checked_at, working_copy, sources, unread_sources and exceptions only after semantic review';
  if (plan.version !== 4) reasons.push('format-without-baseline');
  if (!baseline) reasons.push('baseline-missing');
  else {
    if (!same(selector, baseline.selector)) reasons.push('selector-differs');
    if (baseline.project_id !== catalog.manifest?.project_id) reasons.push('project-identity-differs');
    if (baseline.working_copy !== catalog.root) reasons.push('working-copy-differs');
    if (!validTime(baseline.checked_at)) reasons.push('baseline-time-invalid');
    if (baseline.unread_sources.length) reasons.push('unread-sources');
    if (unique(baseline.member_ids).length !== baseline.member_ids.length) reasons.push('baseline-members-duplicate');
    for (const id of current.member_ids.filter((id: string) => !baseline.member_ids.includes(id))) changes.push({ kind: 'member-added', id });
    for (const id of baseline.member_ids.filter((id: string) => !current.member_ids.includes(id))) changes.push({ kind: 'member-exited', id });
    for (const field of ['definitions', 'context']) {
      if (unique(baseline[field].map((d: any) => d.id)).length !== baseline[field].length) reasons.push(`${field}-duplicate`);
      for (const d of current[field]) {
        const old = baseline[field].find((o: any) => o.id === d.id);
        if (!old) {
          if (field === 'definitions' && !baseline.member_ids.includes(d.id)) continue;
          reasons.push(`definition-unreviewed:${d.id}`); continue;
        }
        if (old.algorithm !== d.algorithm) reasons.push(`algorithm-incomparable:${d.id}`);
        else if (old.sha256 !== d.sha256) changes.push({ kind: 'definition-changed', id: d.id, before: old, after: d });
      }
      for (const old of baseline[field]) if (!current[field].some((d: any) => d.id === old.id)) {
        if (field === 'context') changes.push({ kind: 'context-exited', id: old.id });
        else if (!baseline.member_ids.includes(old.id)) reasons.push(`snapshot-outside-members:${old.id}`);
      }
    }
    if (baseline.arrangement.algorithm !== arrangement.algorithm) reasons.push('arrangement-algorithm-incomparable');
    else if (baseline.arrangement.sha256 !== arrangement.sha256) changes.push({ kind: 'arrangement-changed', before: baseline.arrangement, after: arrangement });
    result.exceptions = baseline.exceptions.filter((e: any) => current.definitions.some((d: any) => d.id === e.target && d.algorithm === e.algorithm && d.sha256 === e.sha256)
      && (e.work_item_ids ?? []).every((id: string) => plan.metadata.work_items.some((w: any) => w.id === id)));
    result.stale_exceptions = baseline.exceptions.filter((e: any) => !result.exceptions.includes(e));
    if (!baselineSourcesAvailable(catalog, baseline)) reasons.push('baseline-source-unavailable');
  }
  const affected = unique(changes.filter(c => c.id).map(c => c.id));
  result.affected_work_items = plan.metadata.work_items.filter((w: any) => w.targets.some((t: any) => affected.includes(t.target))).map((w: any) => w.id);
  result.change_sources = catalog.items.filter(i => i.usable && i.type === 'change' && i.metadata.deltas.some((d: any) => affected.includes(d.target) || d.target === plan.id))
    .map(i => ({ id: i.id, locator: { kind: 'file', path: i.path, item_id: i.id }, basis: i.metadata.basis }));
  if (reasons.length) result.status = 'unknown';
  else if (changes.length) result.status = 'changes-pending';
  else if (result.exceptions?.some((e: any) => e.disposition === 'deferred')) result.status = 'reviewed-deferred';
  else result.status = 'current';
  return result;
}
const validTime = (time: string): boolean => /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(time) && Number.isFinite(Date.parse(time));
function baselineSources(baseline: ObjectValue): ObjectValue[] {
  return [...baseline.sources, ...baseline.exceptions.flatMap((e: any) => e.sources)];
}
function baselineSourcesAvailable(catalog: Catalog, baseline: ObjectValue): boolean {
  return baselineSources(baseline).filter(s => s.kind === 'file').every(source => {
    const read = readSource(catalog, source, { max_bytes: 1 });
    return read.status === 'available' && (!source.sha256 || read.byte_status === 'same-bytes');
  });
}

/** Check only a newly advanced baseline. Keeping stale baselines is legitimate. */
export function assertBaseline(catalog: Catalog, plan: Item, previousBaseline?: ObjectValue): ObjectValue[] {
  const b = plan.metadata.planning_baseline;
  if (!b) return [];
  const current = planningScope(catalog, b.selector, plan);
  const retained: ObjectValue[] = [];
  const sameBasis = previousBaseline && previousBaseline.project_id === b.project_id
    && previousBaseline.working_copy === b.working_copy && same(previousBaseline.selector, b.selector);
  const fail = (reason: string): never => { throw new Error(`PLANNING_BASELINE_CONFLICT: ${plan.id}: ${reason}`); };
  if (!current.complete) fail(current.reasons.join(', '));
  if (b.project_id !== catalog.manifest?.project_id) fail('project identity changed');
  if (!validTime(b.checked_at) || b.working_copy !== catalog.root) fail('time or working-copy identity invalid');
  if (!same(unique(b.member_ids), current.member_ids) || unique(b.member_ids).length !== b.member_ids.length) fail('current membership differs from reviewed scope');
  for (const field of ['definitions', 'context']) {
    if (unique(b[field].map((d: any) => d.id)).length !== b[field].length) fail(`${field} duplicate`);
    const previousSnapshots = sameBasis ? previousBaseline?.[field] ?? [] : [];
    for (const d of b[field]) {
      if (current[field].some((now: any) => same(now, d))) continue;
      // Retaining a prior reviewed version does not claim review of today's
      // version. Consumption continues to compare it and expose the difference.
      if (!previousSnapshots.some((old: any) => same(old, d))) fail(`unread or changed definition ${d.id}`);
      retained.push({ field, id: d.id });
    }
    // Partial reviewed definitions are permitted but stay unknown during consumption.
  }
  if (!same(b.arrangement, arrangementSnapshot(plan))) fail('arrangement differs from reviewed version');
  if (!baselineSourcesAvailable(catalog, b)) fail('review source unavailable');
  for (const e of b.exceptions) {
    if (!b.definitions.some((d: any) => d.id === e.target && d.algorithm === e.algorithm && d.sha256 === e.sha256)) fail(`exception has no reviewed version: ${e.target}`);
    if ((e.work_item_ids ?? []).some((id: string) => !plan.metadata.work_items.some((w: any) => w.id === id))) fail('exception work item unresolved');
  }
  return retained;
}
