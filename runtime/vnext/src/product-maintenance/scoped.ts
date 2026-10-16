import { type Catalog, type Item, type ObjectValue } from './model';
import { definitionAlgorithm, requirementDigest } from './parser';
import { readSourceDefinition } from './references';
import { assessmentEvidence } from './dispositions';

const normalize = (text: string): string => text.replace(/\r\n|\r/g, '\n');
const subjectKey = (s: any): string => JSON.stringify([s?.kind, s?.value, s?.revision ?? null]);
const located = (m: ObjectValue): boolean => typeof m.target === 'string' && typeof m.applicability?.goal_id === 'string' && typeof m.applicability?.scope_id === 'string'
  && ['working-copy', 'commit', 'release'].includes(m.subject?.kind) && typeof m.subject.value === 'string' && !!m.subject.value;
const tuple = (m: ObjectValue): string => JSON.stringify([m.target, m.applicability?.goal_id, m.applicability?.scope_id, subjectKey(m.subject)]);

function rootGoal(catalog: Catalog, project?: Item): ObjectValue {
  if (!project) return { status: 'conflict', id: null };
  const id = project.metadata.root_goal_id;
  if (!id) return { status: 'unspecified', id: null };
  const goal = catalog.byId.get(id);
  if (!goal) return { status: 'unresolved', id };
  if (goal.type !== 'goal' || goal.metadata.scope !== 'current') return { status: 'invalid', id };
  return { status: 'resolved', id };
}

function scopes(catalog: Catalog, goal: Item): { declarations: ObjectValue[]; conflict: boolean } {
  const declarations = goal.metadata.assessment_scopes ?? [];
  const seen = new Set<string>();
  let conflict = false;
  for (const s of declarations) {
    const target = catalog.byId.get(s.target), key = JSON.stringify([s.target, s.scope_id]);
    if (seen.has(key) || !target || target.type !== 'requirement' && target.id !== goal.id) conflict = true;
    seen.add(key);
  }
  return { declarations, conflict };
}

/** Additive read model, never a persisted global completion state or schedule. */
export function productView(catalog: Catalog): ObjectValue {
  const projects = catalog.items.filter(i => i.type === 'project');
  const project = projects.length === 1 && projects[0]!.usable && projects[0]!.path === catalog.manifest?.entry ? projects[0] : undefined;
  const registered: string[] = [], seen = new Set<string>(), diagnostics: ObjectValue[] = [];
  for (const id of project?.metadata.requirement_order ?? []) {
    if (seen.has(id)) diagnostics.push({ code: 'REQUIREMENT_ORDER_DUPLICATE', id });
    seen.add(id);
    const requirement = catalog.byId.get(id);
    if (requirement?.type !== 'requirement') diagnostics.push({ code: 'REQUIREMENT_ORDER_UNRESOLVED', id });
    else if (!registered.includes(id)) registered.push(id);
  }
  const unordered = catalog.items.filter(i => i.usable && i.type === 'requirement' && !registered.includes(i.id)).map(i => i.id).sort();
  const relations = catalog.items.filter(i => i.usable).flatMap(owner => (owner.metadata.links ?? []).filter((l: any) => l.origin === 'declared' && l.state === 'active' && ['part_of', 'supports', 'depends_on'].includes(l.relation)).map((l: any) => ({ owner: owner.id, ...l })));
  const legal = relations.filter(r => {
    const owner = catalog.byId.get(r.owner)!, target = catalog.byId.get(r.target);
    if (!target || r.owner === r.target) return false;
    if (r.relation === 'supports') return ['requirement', 'module', ...((owner.version ?? 0) >= 3 ? ['goal'] : [])].includes(owner.type) && target.type === 'goal';
    if (r.relation === 'depends_on') return ['requirement', 'design'].includes(owner.type) && ['requirement', 'design'].includes(target.type);
    return owner.type === 'module' && target.type === 'module' || owner.type === 'requirement' && (target.type === 'module' || (owner.version ?? 0) >= 3 && target.type === 'requirement') || (owner.version ?? 0) >= 3 && owner.type === 'goal' && target.type === 'goal';
  });
  const reaches = (from: string, to: string, relation: string, visited = new Set<string>()): boolean => {
    if (from === to) return true;
    if (visited.has(from)) return false;
    visited.add(from);
    return legal.some(r => r.relation === relation && r.owner === from && reaches(r.target, to, relation, visited));
  };
  const current = legal.filter(r => !reaches(r.target, r.owner, r.relation));
  for (const r of relations.filter(r => !current.includes(r))) diagnostics.push({ code: 'CURRENT_RELATION_INVALID', owner: r.owner, id: r.id });
  for (const g of catalog.items.filter(i => i.usable && i.type === 'goal' && (i.version ?? 0) >= 3)) if (scopes(catalog, g).conflict) diagnostics.push({ code: 'ASSESSMENT_SCOPE_CONFLICT', goal_id: g.id });
  return { project_id: project?.id ?? null, root_goal: rootGoal(catalog, project), requirement_order: registered, unordered_requirements: unordered, current_relations: current, diagnostics };
}

/** Verify the original goal definition before comparing this scope, independently of file bytes. */
function unchangedGoalScope(report: Item, goal: Item, source: ObjectValue, previous?: Item): boolean {
  const m = report.metadata, basis = m.goal_basis, digest = m.goal_definition_sha256;
  if (!report.usable || !goal.usable || m.target === goal.id || !previous?.usable || previous.type !== 'goal' || previous.id !== goal.id) return false;
  if (basis?.kind !== 'file' || basis.item_id !== goal.id || !basis.sha256
    || source.status !== 'available') return false;
  if (goal.definition_algorithm !== 'vnext-product-definition/v1' || m.goal_definition_algorithm !== goal.definition_algorithm
    || definitionAlgorithm(previous) !== goal.definition_algorithm || !goal.definition_sha256 || !digest
    || source.definition_algorithm !== goal.definition_algorithm || source.definition_sha256 !== digest
    || requirementDigest(previous) !== digest || requirementDigest(goal) !== goal.definition_sha256) return false;

  const scopedDigest = (item: Item): string | null => {
    const declarations = (item.metadata.assessment_scopes ?? []).filter((s: any) => s.target === m.target && s.scope_id === m.applicability.scope_id);
    if (declarations.length !== 1) return null;
    return requirementDigest({ ...item, metadata: { ...item.metadata, assessment_scopes: declarations } });
  };
  const before = scopedDigest(previous), after = scopedDigest(goal);
  return before !== null && before === after;
}

/** Select only explicitly reported scope/object; no model or Task operations. */
export function selectAssessment(catalog: Catalog, query: ObjectValue, budget: ObjectValue = {}): ObjectValue {
  const reasons: string[] = [], candidates: Item[] = [], historical: string[] = [];
  const evidence = new Map<Item, ObjectValue>();
  const evidenceFor = (report: Item): ObjectValue => {
    if (!evidence.has(report)) evidence.set(report, assessmentEvidence(catalog, report, budget));
    return evidence.get(report)!;
  };
  const pending = catalog.items.filter(i => i.type === 'assessment' && !located(i.metadata)).map(i => i.id);
  const result = (): ObjectValue => ({ selection: query, conclusion: reasons.length ? 'undetermined' : candidates[0]?.metadata.conclusion ?? 'undetermined',
    assessment_id: reasons.length ? null : candidates[0]?.id ?? null, reasons: [...new Set(reasons)], reports: candidates.map(i => ({ id: i.id, conclusion: i.metadata.conclusion ?? null, usable: i.usable, locator: { kind: 'file', path: i.path, item_id: i.id }, ...evidenceFor(i) })), historical_reports: historical, pending_reports: pending, business_validity: 'not-evaluated' });
  const fail = (reason: string): ObjectValue => { reasons.push(reason); return result(); };
  const goal = catalog.byId.get(query.goal_id), target = catalog.byId.get(query.target);
  if (!goal || goal.type !== 'goal' || (goal.version ?? 0) < 3) return fail('scope-unavailable');
  if (!target || !['requirement', 'goal'].includes(target.type) || target.type === 'goal' && target.id !== goal.id) return fail('conflict');
  const declared = scopes(catalog, goal);
  if (declared.conflict) return fail('conflict');
  const available = declared.declarations.filter(s => s.target === query.target);
  if (!available.length) return fail('scope-unavailable');
  if (!query.scope_id && available.length > 1) return { ...fail('scope-selection-required'), available_scopes: available };
  const scope = available.find(s => s.scope_id === (query.scope_id ?? available[0]!.scope_id));
  if (!scope) return fail('scope-not-current');
  query = { ...query, scope_id: scope.scope_id };
  if (!['working-copy', 'commit', 'release'].includes(query.subject.kind) || !query.subject.value) return fail('no-applicable-report');
  const key = tuple({ ...query, applicability: { goal_id: query.goal_id, scope_id: query.scope_id } });
  const all = catalog.items.filter(i => i.type === 'assessment' && located(i.metadata) && tuple(i.metadata) === key);
  const edges = new Map<string, string[]>(), invalid = new Set<string>();
  for (const report of all) {
    const valid: string[] = [];
    for (const id of Array.isArray(report.metadata.supersedes) ? report.metadata.supersedes : []) {
      const matches = catalog.items.filter(i => i.id === id);
      if (matches.length !== 1 || matches[0]!.type !== 'assessment' || !all.includes(matches[0]!)) invalid.add(report.id);
      else valid.push(id);
    }
    edges.set(report.id, valid);
  }
  const reaches = (from: string, to: string, seen = new Set<string>()): boolean => {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return (edges.get(from) ?? []).some(id => reaches(id, to, seen));
  };
  const removed = new Set<string>();
  for (const report of all) for (const id of edges.get(report.id) ?? []) {
    if (reaches(id, report.id)) invalid.add(report.id);
    else removed.add(id);
  }
  for (const report of all) {
    if (removed.has(report.id)) historical.push(report.id);
    else candidates.push(report);
  }
  if (!candidates.length) return fail('no-applicable-report');
  if (candidates.some(i => invalid.has(i.id) || catalog.items.filter(x => x.id === i.id).length !== 1)) reasons.push('conflict');
  if (candidates.some(i => !i.usable || (i.version ?? 0) < 3)) reasons.push('metadata-incomplete');
  if (candidates.length > 1) reasons.push('multiple-reports');
  for (const report of candidates) {
    const m = report.metadata;
    if (typeof m.applicability.coverage !== 'string' || normalize(m.applicability.coverage) !== normalize(scope.coverage)) reasons.push('scope-definition-changed');
    for (const [prefix, definition] of [['target', target], ['goal', goal]] as const) {
      const label = prefix === 'target' ? 'definition' : 'goal-definition';
      const algorithm = m[`${prefix}_definition_algorithm`], digest = m[`${prefix}_definition_sha256`];
      if (['vnext-product-definition/v1', 'vnext-requirement-definition/v1'].includes(algorithm) && algorithm !== definition.definition_algorithm) reasons.push('definition-algorithm-changed');
      const basis = m[`${prefix}_basis`];
      const read = digest && basis && algorithm === definition.definition_algorithm
        ? readSourceDefinition(catalog, basis, { max_file_bytes: budget.max_file_bytes, max_bytes: 1 }) : undefined;
      if (algorithm === definition.definition_algorithm && digest && digest !== definition.definition_sha256) {
        const sameGoalScope = prefix === 'goal' && read && unchangedGoalScope(report, definition, read.result, read.definition);
        if (!sameGoalScope) reasons.push(`${label}-changed`);
      }
      if (!read) { reasons.push(`${label}-unverified`); continue; }
      const source = read.result;
      // A shared file can change through bindings, ordering or another item. The
      // resolved item's definition verifies this basis; byte history stays in readSource diagnostics.
      if (source.status !== 'available' || source.definition_algorithm !== algorithm || source.definition_sha256 !== digest) reasons.push(`${label}-unverified`);
    }
    if (evidenceFor(report).pending_sources.length) reasons.push('pending-evidence');
  }
  return result();
}
