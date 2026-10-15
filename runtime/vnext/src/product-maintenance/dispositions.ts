import { type Catalog, type Item, type ObjectValue } from './model';
import { requirementDigest, sha256 } from './parser';
import { readSource } from './references';

export const DISPOSITION_REPORT_ALGORITHM = 'vnext-assessment-disposition/v1';
const normalize = (text: string): string => text.replace(/\r\n|\r/g, '\n');
const evidenceReads = new WeakMap<Catalog, WeakMap<Item, { signature: string; result: ObjectValue }>>();

/** Stable JSON; object ordering is immaterial, array ordering remains meaningful. */
export function canonicalDisposition(value: any): string {
  function ordered(input: any): any {
    if (Array.isArray(input)) return input.map(ordered);
    if (input && typeof input === 'object') return Object.fromEntries(Object.keys(input).sort().map(key => [key, ordered(input[key])]));
    return input;
  }
  return JSON.stringify(ordered(value));
}

/** Evidence identity retains byte digests and every locator; display notes are not evidence. */
export function dispositionSourceKey(source: ObjectValue): string {
  const { note, ...identity } = source;
  return canonicalDisposition(identity);
}

export function dispositionReportDigest(report: Item): string {
  const { evidence_dispositions, pending_sources, sources, ...metadata } = report.metadata;
  return sha256(`${DISPOSITION_REPORT_ALGORITHM}\n${canonicalDisposition({ metadata, body: normalize(report.body).replace(/\n+$/, '') })}`);
}

/** A read helper, never an approval token or a persisted completion state. */
export function dispositionBasis(catalog: Catalog, report: Item): ObjectValue | null {
  if (!report.usable || report.type !== 'assessment' || (report.version ?? 0) < 6) return null;
  const m = report.metadata, goal = catalog.byId.get(m.applicability?.goal_id), target = catalog.byId.get(m.target);
  if (!goal?.usable || goal.type !== 'goal' || !target?.usable || !['goal', 'requirement'].includes(target.type)
    || target.type === 'goal' && target.id !== goal.id || !['working-copy', 'commit', 'release'].includes(m.subject?.kind) || !m.subject.value) return null;
  const declarations = goal.metadata.assessment_scopes ?? [];
  const keys = declarations.map((s: any) => canonicalDisposition([s.target, s.scope_id]));
  if (new Set(keys).size !== keys.length || declarations.some((s: any) => {
    const item = catalog.byId.get(s.target); return !item || item.type !== 'requirement' && item.id !== goal.id;
  })) return null;
  const scope = declarations.find((s: any) => s.target === m.target && s.scope_id === m.applicability.scope_id);
  if (!scope || normalize(scope.coverage) !== normalize(m.applicability.coverage)
    || !target.definition_sha256 || !target.definition_algorithm || !goal.definition_sha256 || !goal.definition_algorithm) return null;
  return { target: target.id, goal_id: goal.id, scope_id: scope.scope_id, coverage: normalize(scope.coverage), subject: m.subject,
    target_definition_algorithm: target.definition_algorithm, target_definition_sha256: target.definition_sha256,
    goal_definition_algorithm: goal.definition_algorithm, goal_definition_sha256: goal.definition_sha256,
    goal_scope_definition_sha256: target.id === goal.id ? goal.definition_sha256 : requirementDigest({ ...goal, metadata: { ...goal.metadata, assessment_scopes: [scope] } }),
    report_sources: report.metadata.sources ?? [],
    report_algorithm: DISPOSITION_REPORT_ALGORITHM, report_sha256: dispositionReportDigest(report) };
}

function matchingBasis(saved: ObjectValue, current: ObjectValue | null): boolean {
  if (!current || !saved || !Array.isArray(saved.report_sources)) return false;
  const { report_sources: originalSources, ...original } = saved;
  const { report_sources: currentSources, ...now } = current;
  // Other requirement scopes may evolve without reopening a judgment about this scope.
  // Preserve the full goal digest as provenance; shared definition changes remain in the scoped digest.
  if (current.target !== current.goal_id) { delete original.goal_definition_sha256; delete now.goal_definition_sha256; }
  if (canonicalDisposition(original) !== canonicalDisposition(now)) return false;
  const retained = new Set(currentSources.map(dispositionSourceKey));
  return originalSources.every((source: ObjectValue) => retained.has(dispositionSourceKey(source)));
}

/** Reuse only an exact, still-readable judgment. Other currentness checks stay independent. */
export function assessmentEvidence(catalog: Catalog, report: Item, budget: ObjectValue = {}): ObjectValue {
  const basis = dispositionBasis(catalog, report), pending: ObjectValue[] = Array.isArray(report.metadata.pending_sources) ? report.metadata.pending_sources : [];
  if (!report.usable || (report.version ?? 0) < 6) return { disposition_basis: null, evidence_dispositions: [], pending_sources: pending, handled_sources: [] };
  const maxFileBytes = budget.max_file_bytes ?? catalog.coverage.max_file_bytes ?? 4 * 1024 * 1024;
  // One catalog is one read request. Reuse its observation across diagnostics,
  // details and selection; candidate metadata or budget changes require a new one.
  const signature = canonicalDisposition([maxFileBytes, catalog.manifest, basis, report.metadata, report.body]);
  let cache = evidenceReads.get(catalog);
  if (!cache) { cache = new WeakMap(); evidenceReads.set(catalog, cache); }
  const cached = cache.get(report);
  if (cached?.signature === signature) return cached.result;
  const fresh = new Map<string, boolean>();
  const sourceFresh = (source: ObjectValue): boolean => {
    const key = dispositionSourceKey(source);
    if (!fresh.has(key)) {
      let available = source.kind === 'text';
      if (source.kind === 'file' && source.sha256) {
        const result = readSource(catalog, source, { max_file_bytes: maxFileBytes, max_bytes: 1 });
        available = result.status === 'available' && result.byte_status === 'same-bytes';
      }
      fresh.set(key, available);
    }
    return fresh.get(key)!;
  };
  const rows = (report.metadata.evidence_dispositions ?? []).map((entry: ObjectValue) => {
    const reasons: string[] = [];
    if (!matchingBasis(entry.basis, basis)) reasons.push('basis-changed');
    if (!sourceFresh(entry.source) || (entry.sources ?? []).some((s: ObjectValue) => !sourceFresh(s))) reasons.push('source-unverified');
    if (entry.disposition === 'evidence-incorporated' && !(report.metadata.sources ?? []).some((s: ObjectValue) => dispositionSourceKey(s) === dispositionSourceKey(entry.source))) reasons.push('evidence-not-incorporated');
    let status = entry.disposition === 'deferred' ? 'deferred' : 'reused';
    if (reasons.length) status = 'not-reusable';
    return { ...entry, reuse_status: status, reuse_reasons: reasons };
  });
  // Conflicting recorded judgments never become a newest-wins or some(valid) shortcut.
  for (const row of rows) {
    if (row.reuse_status === 'not-reusable') continue;
    const related = rows.filter((other: ObjectValue) => other.reuse_status !== 'not-reusable' && dispositionSourceKey(other.source) === dispositionSourceKey(row.source));
    if (new Set(related.map((other: ObjectValue) => other.disposition)).size > 1) {
      for (const other of related) { other.reuse_status = 'conflict'; other.reuse_reasons = ['conflicting-dispositions']; }
    }
  }
  const handled = pending.filter(source => rows.some((entry: ObjectValue) => entry.reuse_status === 'reused' && dispositionSourceKey(entry.source) === dispositionSourceKey(source)));
  const handledKeys = new Set(handled.map(dispositionSourceKey));
  const result = { disposition_basis: basis, evidence_dispositions: rows, pending_sources: pending.filter(source => !handledKeys.has(dispositionSourceKey(source))), handled_sources: handled };
  cache.set(report, { signature, result });
  return result;
}
