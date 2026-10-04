import { diagnostic, type Catalog, type Item, type ObjectValue } from './model';
import { allowed, relativePath } from './paths';

export function collectSources(value: any): ObjectValue[] {
  if (Array.isArray(value)) return value.flatMap(collectSources);
  if (!value || typeof value !== 'object') return [];
  if (['file', 'text', 'uri'].includes(value.kind) && ('path' in value || 'text' in value || 'uri' in value)) return [value];
  return Object.entries(value).filter(([key]) => key !== 'extensions').flatMap(([,v]) => collectSources(v));
}
export function taskIdentity(task: ObjectValue): string {
  return JSON.stringify([task.task_id ?? task.source, task.plan_ref ?? null, task.step_id ?? null]);
}
export function analyze(catalog: Catalog): void {
  const { byId, items, manifest, diagnostics } = catalog;
  if (!manifest) return;
  const report = (code: string, item: Item, message: string) => diagnostics.push(diagnostic(code, item.path, message, { item_id: item.id, line: item.line }));
  const expectTarget = (owner: Item, id: string, types: string[], label: string): Item | undefined => {
    const target = byId.get(id);
    if (!target) report('UNRESOLVED_TARGET', owner, `${label}: ${id} is missing, invalid or ambiguous`);
    else if (!types.includes(target.type)) report('TARGET_TYPE', owner, `${label}: ${id} has type ${target.type}; expected ${types.join('/')}`);
    return target;
  };
  for (const item of items.filter(i => i.usable)) {
    const m = item.metadata;
    for (const source of collectSources(m)) {
      if (source.kind === 'file') {
        try {
          relativePath(source.path);
          if (!allowed(manifest, source.path, 'source')) report('SOURCE_OUT_OF_RANGE', item, `Source ${source.path} is outside registered reading scope`);
          if (source.lines && source.lines.end < source.lines.start) report('SOURCE_LINES', item, 'Source end line is before its start');
        } catch (error: any) { report('UNSAFE_SOURCE', item, error.message); }
      } else if (source.kind === 'uri' && !/^(https?:|mailto:)/i.test(source.uri)) report('UNSAFE_URI', item, 'URI is retained as text; unsafe/unknown protocol must not be navigated');
    }
    const seenLinks = new Set<string>();
    for (const link of m.links ?? []) {
      if (seenLinks.has(link.id)) report('DUPLICATE_LINK_ID', item, `Link ID ${link.id} is duplicated`);
      seenLinks.add(link.id);
      if (link.state !== 'active') continue;
      const rules: Record<string, [string[], string[]]> = {
        part_of: [['requirement', 'module'], ['module']], supports: [['requirement', 'module'], ['goal']], addresses: [['design'], ['requirement']],
        depends_on: [['requirement', 'design'], ['requirement', 'design']], discusses: [['discussion'], ['goal', 'module', 'requirement', 'design']],
        replaces: [['goal', 'module', 'requirement', 'design', 'plan'], [item.type]], derived_from: [['goal', 'module', 'requirement', 'design', 'plan'], [item.type]],
        references: [Object.keys({ project: 1, goal: 1, module: 1, requirement: 1, design: 1, change: 1, assessment: 1, discussion: 1, plan: 1 }), Object.keys({ project: 1, goal: 1, module: 1, requirement: 1, design: 1, change: 1, assessment: 1, discussion: 1, plan: 1 })],
      };
      const rule = rules[link.relation];
      if (rule && !rule[0].includes(item.type)) report('LINK_DIRECTION', item, `${item.type} cannot originate ${link.relation}`);
      if (rule) expectTarget(item, link.target, rule[1], link.relation);
    }
    if (item.type === 'requirement' && m.assessment_id) {
      const assessment = expectTarget(item, m.assessment_id, ['assessment'], 'Selected assessment');
      if (assessment && assessment.metadata.target !== item.id) report('ASSESSMENT_TARGET', item, 'Selected assessment belongs to another requirement');
    }
    if (item.type === 'assessment') {
      const target = expectTarget(item, m.target, ['requirement'], 'Assessment');
      if (target && m.target_definition_sha256 && m.target_definition_sha256 !== target.definition_sha256) report('DEFINITION_CHANGED', item, 'Current requirement definition differs from the reported basis; semantic/current code applicability is not evaluated');
      if (!m.target_definition_sha256) report('DEFINITION_UNKNOWN', item, 'Requirement version alignment is unknown');
      if ((m.implementation !== 'unknown' || m.verification !== 'unknown') && !m.sources?.length) report('REPORT_SOURCE_MISSING', item, 'Reported implementation/verification requires actual sources and a coverage explanation');
      if (m.pending_sources?.length) report('PENDING_SOURCES', item, 'New material is pending reconciliation; existing PASS is not a current completeness claim');
    }
    if (item.type === 'change') for (const delta of m.deltas) if (!byId.has(delta.target)) report('CHANGE_TARGET', item, `Changed target ${delta.target} is unresolved; history is retained`);
    if (item.type === 'plan') {
      const ids = new Set<string>();
      const targets = new Set<string>(m.targets.map((t: any) => t.target));
      for (const t of m.targets) expectTarget(item, t.target, ['goal', 'requirement'], 'Plan target');
      for (const work of m.work_items) {
        if (ids.has(work.id)) report('DUPLICATE_WORK_ITEM', item, `Work item ${work.id} is duplicated`);
        ids.add(work.id);
        if (!work.targets.length) report('WORK_TARGET_UNKNOWN', item, `${work.id}: business ownership remains unspecified`);
        if (work.origin === 'added' && !work.sources?.length) report('WORK_BASIS_MISSING', item, `${work.id}: added work has no insertion source`);
        for (const t of work.targets) {
          expectTarget(item, t.target, ['goal', 'requirement'], `Work item ${work.id}`);
          if (!targets.has(t.target)) report('WORK_OUTSIDE_PLAN', item, `${work.id}: target ${t.target} is outside declared plan coverage`);
        }
        for (const dependency of work.depends_on ?? []) {
          const predecessor = m.work_items.find((w: any) => w.id === dependency.item_id);
          if (!predecessor) report('WORK_DEPENDENCY_MISSING', item, `${work.id}: missing predecessor ${dependency.item_id}`);
          else if (predecessor.state === 'withdrawn') report('WORK_DEPENDENCY_WITHDRAWN', item, `${work.id}: predecessor ${predecessor.id} is withdrawn; this is not a Runtime gate`);
        }
        for (const old of work.replaces ?? []) {
          const prior = m.work_items.find((w: any) => w.id === old);
          if (!prior) report('WORK_REPLACEMENT_MISSING', item, `${work.id}: replacement source ${old} is missing`);
          else if (prior.state !== 'withdrawn') report('WORK_REPLACEMENT_ACTIVE', item, `${work.id}: replaced work ${old} has not been withdrawn`);
        }
      }
      const stack = new Set<string>(), done = new Set<string>();
      const visit = (id: string): void => {
        if (stack.has(id)) { report('WORK_DEPENDENCY_CYCLE', item, `Dependency cycle includes ${id}; original arrangement remains visible`); return; }
        if (done.has(id)) return;
        stack.add(id);
        for (const d of m.work_items.find((w: any) => w.id === id)?.depends_on ?? []) visit(d.item_id);
        stack.delete(id); done.add(id);
      };
      for (const id of ids) visit(id);
    }
    const bindingIds = new Set<string>(), fingerprints = new Set<string>();
    for (const binding of m.task_bindings ?? []) {
      if (bindingIds.has(binding.id)) report('DUPLICATE_BINDING_ID', item, `Binding ID ${binding.id} is duplicated`);
      bindingIds.add(binding.id);
      if (binding.state !== 'active') continue;
      if (binding.task.task_id === null) report('TASK_ID_UNCONFIRMED', item, `${binding.id}: historical task identity is unconfirmed; use its exact source`);
      const fingerprint = JSON.stringify([taskIdentity(binding.task), binding.role, binding.coverage]);
      if (fingerprints.has(fingerprint)) report('DUPLICATE_BINDING_CANDIDATE', item, `${binding.id}: possibly equivalent binding; only the Agent can judge coverage equivalence`);
      fingerprints.add(fingerprint);
      for (const ref of binding.plan_items ?? []) {
        const plan = expectTarget(item, ref.plan_id, ['plan'], 'TaskBinding plan');
        if (plan?.type === 'plan' && !plan.metadata.work_items.some((w: any) => w.id === ref.work_item_id)) report('BINDING_WORK_ITEM', item, `${binding.id}: unresolved work item ${ref.plan_id}/${ref.work_item_id}`);
      }
    }
  }
}
export function reverseRelations(catalog: Catalog): ObjectValue[] {
  return catalog.items.filter(i => i.usable).flatMap(item => [
    ...(item.metadata.links ?? []).filter((l: any) => l.state === 'active').map((l: any) => ({ owner: item.id, ...l })),
    ...(item.type === 'plan' ? item.metadata.targets.map((t: any) => ({ owner: item.id, relation: 'plan-target', ...t })) : []),
    ...(item.type === 'assessment' ? [{ owner: item.id, relation: 'assessment-target', target: item.metadata.target }] : []),
  ]);
}
export function planTasks(catalog: Catalog): ObjectValue[] {
  return catalog.items.filter(i => i.usable && i.type === 'plan').map(plan => ({ plan_id: plan.id, work_items: plan.metadata.work_items.map((work: any) => ({ work_item_id: work.id, bindings: catalog.items.filter(i => i.usable).flatMap(owner => (owner.metadata.task_bindings ?? []).filter((b: any) => b.state === 'active' && b.plan_items?.some((p: any) => p.plan_id === plan.id && p.work_item_id === work.id)).map((b: any) => ({ owner: owner.id, binding_id: b.id, task: b.task, role: b.role, coverage: b.coverage }))) })) }));
}
export function impactCandidates(catalog: Catalog, ids: string[]): ObjectValue {
  const relations = reverseRelations(catalog);
  return { seeds: ids, scope: 'direct-candidates-only', candidates: catalog.items.filter(i => i.usable && (ids.includes(i.id) || relations.some(r => (ids.includes(r.owner) && r.target === i.id) || (ids.includes(r.target) && r.owner === i.id)) || (i.type === 'plan' && i.metadata.work_items.some((w: any) => w.targets.some((t: any) => ids.includes(t.target)))))).map(i => ({ id: i.id, type: i.type, path: i.path, title: i.title, relations: relations.filter(r => r.owner === i.id || r.target === i.id), task_bindings: i.metadata.task_bindings ?? [] })), judgment: 'Agent must read candidate content and decide actual impact; references/inferred links do not imply strong dependency or project-wide invalidation' };
}
export function recallDiscussions(catalog: Catalog, ids: string[]): ObjectValue[] {
  return catalog.items.filter(i => i.usable && i.type === 'discussion' && i.metadata.record_state === 'active' && i.metadata.links?.some((l: any) => l.relation === 'discusses' && l.state === 'active' && ids.includes(l.target))).map(i => ({ id: i.id, title: i.title, path: i.path, summary: i.sections['整理摘要']?.[0]?.text ?? '', raw_ref: i.metadata.raw_ref, links: i.metadata.links, adopted: false }));
}
