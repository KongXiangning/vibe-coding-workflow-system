import { diagnostic, type Catalog, type Diagnostic, type Item, type ObjectValue } from './model';
import { allowed, relativePath } from './paths';
import { assessmentEvidence } from './dispositions';

export function collectSources(value: any): ObjectValue[] {
  if (Array.isArray(value)) return value.flatMap(collectSources);
  if (!value || typeof value !== 'object') return [];
  if (['file', 'text', 'uri'].includes(value.kind) && ('path' in value || 'text' in value || 'uri' in value)) return [value];
  return Object.entries(value).filter(([key]) => key !== 'extensions').flatMap(([,v]) => collectSources(v));
}
export function taskIdentity(task: ObjectValue): string {
  return JSON.stringify([task.task_id ?? task.source, task.plan_ref ?? null, task.step_id ?? null]);
}
// Source identity excludes labels, notes and current byte hashes. Unknown Task
// identity remains unknown; these keys only locate possible duplicate relations.
export function bindingTaskIdentity(task: ObjectValue): unknown {
  if (task.task_id !== null) return task.task_id;
  const source = task.source;
  if (source.kind === 'file') return { kind: source.kind, path: source.path, ...(source.item_id ? { item_id: source.item_id } : {}), ...(source.section ? { section: source.section } : {}), ...(source.lines ? { lines: { start: source.lines.start, end: source.lines.end } } : {}) };
  if (source.kind === 'text') return { kind: source.kind, text: source.text.replace(/\r\n|\r/g, '\n').trim() };
  return { kind: source.kind, uri: source.uri };
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
    if (item.type === 'project' && (item.version ?? 0) >= 3) {
      if (!m.root_goal_id) report('ROOT_GOAL_UNSPECIFIED', item, 'No overall goal is selected; do not infer one from file or graph order');
      else {
        const goal = expectTarget(item, m.root_goal_id, ['goal'], 'Overall goal');
        if (goal && (goal.type !== 'goal' || goal.metadata.scope !== 'current')) report('ROOT_GOAL_INVALID', item, 'Overall goal must be a current goal');
      }
      const order = new Set<string>();
      for (const id of m.requirement_order ?? []) {
        if (order.has(id)) report('REQUIREMENT_ORDER_DUPLICATE', item, `Requirement ${id} occurs more than once in registered order`);
        order.add(id);
        expectTarget(item, id, ['requirement'], 'Registered requirement order');
      }
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
      if ((item.version ?? 0) >= 3) {
        rules.part_of = item.type === 'goal' ? [['goal'], ['goal']] : item.type === 'requirement' ? [['requirement'], ['module', 'requirement']] : rules.part_of!;
        rules.supports = [['goal', 'requirement', 'module'], ['goal']];
      }
      const rule = rules[link.relation];
      if (rule && !rule[0].includes(item.type)) report('LINK_DIRECTION', item, `${item.type} cannot originate ${link.relation}`);
      if (rule) expectTarget(item, link.target, rule[1], link.relation);
    }
    if (item.type === 'requirement' && m.assessment_id) {
      const assessment = expectTarget(item, m.assessment_id, ['assessment'], 'Selected assessment');
      if (assessment && assessment.metadata.target !== item.id) report('ASSESSMENT_TARGET', item, 'Selected assessment belongs to another requirement');
    }
    if (item.type === 'assessment') {
      const target = expectTarget(item, m.target, (item.version ?? 0) >= 3 ? ['requirement', 'goal'] : ['requirement'], 'Assessment');
      if (target && m.target_definition_sha256 && m.target_definition_sha256 !== target.definition_sha256) report('DEFINITION_CHANGED', item, 'Current requirement definition differs from the reported basis; semantic/current code applicability is not evaluated');
      if (!m.target_definition_sha256) report('DEFINITION_UNKNOWN', item, 'Requirement version alignment is unknown');
      if ((m.implementation !== 'unknown' || m.verification !== 'unknown') && !m.sources?.length) report('REPORT_SOURCE_MISSING', item, 'Reported implementation/verification requires actual sources and a coverage explanation');
      if (assessmentEvidence(catalog, item).pending_sources.length) report('PENDING_SOURCES', item, 'Unresolved material is pending reconciliation; existing PASS is not a current completeness claim');
      if ((item.version ?? 0) >= 3) {
        const goal = expectTarget(item, m.applicability.goal_id, ['goal'], 'Assessment goal');
        if (target?.type === 'goal' && target.id !== m.applicability.goal_id) report('ASSESSMENT_GOAL', item, 'A goal assessment must select that goal itself');
        if (goal && m.goal_definition_sha256 !== goal.definition_sha256) report('GOAL_DEFINITION_CHANGED', item, 'Whole goal definition digest differs; assessment_selection determines scoped applicability after source verification, not business validity');
      }
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
    const bindingIds = new Set<string>(), fingerprints = new Map<string, ObjectValue[]>();
    for (const binding of m.task_bindings ?? []) {
      if (bindingIds.has(binding.id)) report('DUPLICATE_BINDING_ID', item, `Binding ID ${binding.id} is duplicated`);
      bindingIds.add(binding.id);
      if (binding.state !== 'active') continue;
      if (binding.task.task_id === null) report('TASK_ID_UNCONFIRMED', item, `${binding.id}: historical task identity is unconfirmed; use its exact source`);
      if (!binding.contribution) report('BINDING_CONTRIBUTION_UNCLASSIFIED', item, `${binding.id}: legacy contribution is unclassified; do not infer direct work from role or task state`);
      if (binding.contribution && (!binding.reason?.trim() || !binding.sources?.length)) report('BINDING_BASIS_MISSING', item, `${binding.id}: recorded classification lacks a reason or sources; current applicability is not established`);
      if (binding.role === 'reference' && binding.contribution === 'direct') report('BINDING_ROLE_CONTRIBUTION', item, `${binding.id}: reference+direct requires clarification; historical value is retained`);
      // Contribution, plan revision and display ID are never ways to manufacture
      // a second equivalent owner/Task/activity/scope fact. Text equivalence beyond
      // whitespace still requires the Agent's explicit judgment.
      const fingerprint = JSON.stringify([bindingTaskIdentity(binding.task), binding.role, binding.coverage.replace(/\s+/g, ' ').trim()]);
      const prior = fingerprints.get(fingerprint) ?? [];
      if (prior.length) report('DUPLICATE_BINDING_CANDIDATE', item, `${binding.id}: possibly equivalent binding; only the Agent can judge coverage equivalence`);
      if (binding.contribution && prior.some(other => other.contribution && other.contribution !== binding.contribution))
        report('BINDING_CONTRIBUTION_CONFLICT', item, `${[...prior.map(other => other.id), binding.id].join(', ')}: equivalent owner/Task/role/coverage has conflicting classifications; no direct or newest winner is selected`);
      fingerprints.set(fingerprint, [...prior, binding]);
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
  return catalog.items.filter(i => i.usable && i.type === 'plan').map(plan => ({ plan_id: plan.id, work_items: plan.metadata.work_items.map((work: any) => ({ work_item_id: work.id, bindings: catalog.items.filter(i => i.usable).flatMap(owner => (owner.metadata.task_bindings ?? []).filter((b: any) => b.state === 'active' && b.plan_items?.some((p: any) => p.plan_id === plan.id && p.work_item_id === work.id)).map((b: any) => ({ owner: owner.id, binding_id: b.id, task: b.task, role: b.role, coverage: b.coverage, ...(b.contribution ? { contribution: b.contribution } : {}), origin: b.origin, state: b.state, ...(b.reason ? { reason: b.reason } : {}), sources: b.sources ?? [], locator: { kind: 'file', path: owner.path, item_id: owner.id }, line: owner.line }))) })) }));
}
export function impactCandidates(catalog: Catalog, ids: string[]): ObjectValue {
  const relations = reverseRelations(catalog);
  const seeds = ids.flatMap(id => {
    const item = catalog.byId.get(id);
    if (!item) return [];
    const target = item.type === 'assessment' ? catalog.byId.get(item.metadata.target) : undefined;
    return target ? [item, target] : [item];
  });
  const candidates = [];
  for (const item of catalog.items.filter(i => i.usable)) {
    const reasons: ObjectValue[] = [];
    if (ids.includes(item.id)) reasons.push({ kind: 'selected-item' });
    for (const relation of relations) {
      if ((ids.includes(relation.owner) && relation.target === item.id) || (ids.includes(relation.target) && relation.owner === item.id)) {
        reasons.push({ kind: 'relation', relation });
      }
    }
    if (item.type === 'plan' && item.metadata.work_items.some((w: any) => w.targets.some((t: any) => ids.includes(t.target)))) reasons.push({ kind: 'work-item-target' });
    if (item.type === 'requirement' || item.type === 'goal') {
      for (const seed of seeds) {
        if (seed.id === item.id) continue;
        const seedBindings = (seed.metadata.task_bindings ?? []).filter((b: any) => b.state === 'active');
        for (const binding of item.metadata.task_bindings ?? []) {
          if (binding.state !== 'active' || !binding.task.task_id) continue;
          const shared = seedBindings.filter((b: any) => b.task.task_id === binding.task.task_id);
          for (const original of shared) reasons.push({ kind: 'shared-task', seed_id: seed.id, task_id: binding.task.task_id, seed_binding_id: original.id, binding_id: binding.id });
        }
        const seedSources = implementationSources(seed);
        for (const source of implementationSources(item)) {
          if (seedSources.some(s => sourceKey(s) === sourceKey(source))) reasons.push({ kind: 'shared-source', seed_id: seed.id, source });
        }
      }
    }
    if (reasons.length) candidates.push({ id: item.id, type: item.type, path: item.path, title: item.title, locator: { kind: 'file', path: item.path, item_id: item.id },
      reasons: [...new Map(reasons.map(reason => [JSON.stringify(reason), reason])).values()],
      relations: relations.filter(r => r.owner === item.id || r.target === item.id), task_bindings: item.metadata.task_bindings ?? [] });
  }
  return { seeds: ids, scope: 'direct-candidates-only', coverage: { complete: catalog.coverage.complete, paths: catalog.coverage.paths, omitted: catalog.coverage.omitted },
    unresolved_seeds: ids.filter(id => !catalog.byId.has(id)), candidates,
    judgment: 'Read candidate obligations and actual evidence before judging impact. Shared tasks/sources are discovery hints, not dependencies, consent or invalidation. Unrecorded relationships may still require local semantic lookup.' };
}

function implementationSources(item: Item): ObjectValue[] {
  const bindings = (item.metadata.task_bindings ?? []).filter((b: any) => b.state === 'active');
  return collectSources([item.metadata.sources, item.metadata.pending_sources, bindings.map((b: any) => [b.task.source, b.sources])])
    .filter(source => source.kind === 'file' && (source.item_id || source.section || source.lines || !/\.md$/i.test(source.path)));
}

function sourceKey(source: ObjectValue): string {
  // Paths locate candidates across revisions; byte applicability is checked later.
  return JSON.stringify([source.path, source.item_id ?? null, source.section ?? null, source.lines ? [source.lines.start, source.lines.end] : null]);
}

export function assessmentCopyDiagnostics(items: Item[]): Diagnostic[] {
  const groups = new Map<string, Item[]>();
  for (const item of items.filter(i => i.usable && i.type === 'assessment')) {
    // The parser already identified the root heading. Ignore its ID/title only;
    // retain all substantive text, including scope, object and evidence limits.
    const body = item.body.replace(/\r\n|\r/g, '\n').replace(/^##[^\n]*\n/, '').trim();
    if (!body) continue;
    const key = JSON.stringify([item.metadata.target, body]);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  const diagnostics: Diagnostic[] = [];
  for (const group of groups.values()) {
    for (const item of group) {
      const identity = evaluationIdentity(item);
      const copies = group.filter(other => {
        const otherIdentity = evaluationIdentity(other);
        return other !== item && (!identity || !otherIdentity || identity === otherIdentity);
      });
      if (!copies.length) continue;
      diagnostics.push(diagnostic('ASSESSMENT_BODY_COPY', item.path,
        `Matching assessment body also occurs in ${copies.map(other => `${other.path}#${other.id}`).join(', ')}. Keep independent observations; use summary links for mirrors of one current report. No automatic merge or invalidation.`,
        { item_id: item.id, line: item.line }));
    }
  }
  return diagnostics;
}

function evaluationIdentity(item: Item): string | null {
  if ((item.version ?? 0) < 3) return null;
  const { applicability, subject } = item.metadata;
  return JSON.stringify([applicability.goal_id, applicability.scope_id, subject.kind, subject.value, subject.revision ?? null]);
}
export function recallDiscussions(catalog: Catalog, ids: string[]): ObjectValue[] {
  return catalog.items.filter(i => i.usable && i.type === 'discussion' && i.metadata.record_state === 'active' && i.metadata.links?.some((l: any) => l.relation === 'discusses' && l.state === 'active' && ids.includes(l.target))).map(i => ({ id: i.id, title: i.title, path: i.path, summary: i.sections['整理摘要']?.[0]?.text ?? '', raw_ref: i.metadata.raw_ref, links: i.metadata.links, adopted: false }));
}
