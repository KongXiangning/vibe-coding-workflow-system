/** Durable compact-v3 presentation protocol.
 * This version-specific layout is retained for historical files. Changing
 * headings, escaping, excerpts or hot fields requires a new format reader,
 * not an edit to v3. YAML spelling/order is deliberately not the protocol:
 * readers compare parsed values and this versioned navigation body to roots.
 * Keep the checked-in afeec7b fixture independent of the current writer.
 */
type RecordValue = Record<string, any>;
const V3_HOT_FIELDS = ['schema_version', 'task_id', 'task_slug', 'workflow_status', 'lifecycle_state', 'active_step_id', 'active_step_status', 'finding_queue_revision', 'resume_requires_review', 'resume_review_reasons'];
function bodyParts(body: string): Array<{ title: string; text: string }> {
  const headings = [...body.matchAll(/^##[ \t]+(.+?)[ \t]*\r?$/gmu)];
  const parts = [{ title: '', text: body.slice(0, headings[0]?.index ?? body.length) }];
  headings.forEach((h, i) => parts.push({ title: h[1]!.trim(), text: body.slice(h.index!, headings[i + 1]?.index ?? body.length) }));
  return parts;
}
function excerpt(value: unknown, max = 180): string {
  return typeof value === 'string' ? value.replace(/[\r\n|`]/gu, ' ').slice(0, max) : '';
}
export function projectionV3Body(body: string, runtime: RecordValue): string {
  const active = String(runtime.active_step_id ?? '');
  const parts = bodyParts(body);
  const steps = parts.find(p => ['实施步骤', 'Implementation Steps'].includes(p.title))?.text ?? '';
  const step = steps.split(/(?=^###\s)/mu).find(s => new RegExp(`^###\\s+${active.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?:[\\s:：.、—-]|$)`, 'mu').test(s));
  const basis = parts.find(p => ['任务输入依据', 'Task Basis'].includes(p.title));
  const due = (Array.isArray(runtime.claim_evidence) ? runtime.claim_evidence : []).flatMap((claim: RecordValue) =>
    (Array.isArray(claim.slots) ? claim.slots : []).filter((slot: RecordValue) => slot.due_step_id === active).map((slot: RecordValue) =>
      `- ${excerpt(claim.claim_id, 64)} / ${excerpt(slot.slot_id, 64)} / ${excerpt(slot.check?.check_id, 64)}: ${excerpt(slot.report?.status ?? slot.disposition ?? 'missing', 64)}${slot.user_decision ? `; decision=${excerpt(slot.user_decision.kind ?? slot.user_decision.decision_id, 64)}` : ''}`));
  return [
    '# CURRENT_TASK', '',
    '> Runtime-generated active projection. References select the complete immutable definition and state.',
    '> This summary is not an execution grant. Use task-context/task-read for exact obligations, authority and evidence.', '',
    '## 当前步骤', `- ${excerpt(active)}${step ? ` — ${excerpt(step.split(/\r?\n/u)[0]!.replace(/^###\s*/u, ''))}` : ''}`,
    `- workflow: ${excerpt(runtime.workflow_status)}; lifecycle: ${excerpt(runtime.lifecycle_state)}; step: ${excerpt(runtime.active_step_status)}`, '',
    '## 当前到期证据', ...(due.length ? due : ['- none; inspect task-context for prerequisites and remaining obligations']), '',
    ...(basis ? [basis.text.trimEnd(), ''] : []),
    '## 精确读取', '- `task-context`: current definition, step, gates and dependencies (paged).',
    '- `task-read`: exact definition, state, report, review and historical material.',
    '- `task-export`: complete retained aggregate; no audit history is discarded.', '',
  ].join('\n');
}

export function projectionV3Frontmatter(frontmatter: RecordValue, runtime: RecordValue, binding: RecordValue): RecordValue {
  return {
    schema_version: frontmatter.schema_version, kind: frontmatter.kind, document_id: frontmatter.document_id,
    task_store: binding,
    runtime_state: Object.fromEntries(V3_HOT_FIELDS.filter(k => runtime[k] !== undefined).map(k => [k, runtime[k]])),
  };
}
