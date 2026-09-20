/** Typed migration evidence only: no legacy document parser or resume route. */
export type MigrationDecisions = {
  schema_version: 1;
  target_root: string;
  target_identity: string;
  current_task: { path: string; sha256: string; original_task_id: string };
  current_task_disposition: 'completed-by-user-confirmation';
  preserved_paused: Array<{ path: string; sha256: string }>;
  user_decision: { source: string; verbatim: string };
};

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MIGRATION_DECISIONS_INVALID: expected object');
  const result = value as Record<string, unknown>;
  if (Object.keys(result).sort().join('|') !== keys.sort().join('|')) throw new Error('MIGRATION_DECISIONS_INVALID: unexpected or missing fields');
  return result;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || /[\r\n\0]/.test(value)) throw new Error('MIGRATION_DECISIONS_INVALID: expected non-empty single-line text');
  return value;
}

function file(value: unknown, current: boolean): { path: string; sha256: string; original_task_id?: string } {
  const data = object(value, current ? ['path', 'sha256', 'original_task_id'] : ['path', 'sha256']);
  const p = text(data.path);
  if (p.includes('\\') || p.startsWith('/') || p.includes(':') || p.split('/').some(s => !s || s === '.' || s === '..')) throw new Error('MIGRATION_DECISIONS_INVALID: unsafe path');
  if (current ? p !== 'docs/workflow/CURRENT_TASK.md' : !p.startsWith('TASKS/paused/')) throw new Error('MIGRATION_DECISIONS_INVALID: path outside preservation scope');
  const hash = text(data.sha256);
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('MIGRATION_DECISIONS_INVALID: invalid SHA-256');
  return { path: p, sha256: hash, ...(current ? { original_task_id: text(data.original_task_id) } : {}) };
}

export function validateMigrationDecisions(value: unknown): MigrationDecisions {
  const data = object(value, ['schema_version', 'target_root', 'target_identity', 'current_task', 'current_task_disposition', 'preserved_paused', 'user_decision']);
  if (data.schema_version !== 1 || data.current_task_disposition !== 'completed-by-user-confirmation') throw new Error('MIGRATION_DECISIONS_INVALID: unsupported decision');
  const targetIdentity = text(data.target_identity);
  if (!/^[a-f0-9]{32}$/.test(targetIdentity)) throw new Error('MIGRATION_DECISIONS_INVALID: invalid target identity');
  if (!Array.isArray(data.preserved_paused)) throw new Error('MIGRATION_DECISIONS_INVALID: paused files must be a list');
  const paused = data.preserved_paused.map(item => file(item, false));
  if (new Set(paused.map(item => item.path)).size !== paused.length) throw new Error('MIGRATION_DECISIONS_INVALID: duplicate paused path');
  const decision = object(data.user_decision, ['source', 'verbatim']);
  if (typeof decision.verbatim !== 'string' || !decision.verbatim.trim()) throw new Error('MIGRATION_DECISIONS_INVALID: missing user decision');
  return { schema_version: 1, target_root: text(data.target_root), target_identity: targetIdentity,
    current_task: file(data.current_task, true) as MigrationDecisions['current_task'],
    current_task_disposition: 'completed-by-user-confirmation', preserved_paused: paused,
    user_decision: { source: text(decision.source), verbatim: decision.verbatim } };
}

export function legacyCurrentTaskBackup(decisions: MigrationDecisions): string {
  return `TASKS/legacy/CURRENT_TASK-${decisions.current_task.sha256}.md`;
}

export function validateMigrationPreservation(value: unknown, targetIdentity: unknown): MigrationDecisions {
  const data = object(value, ['decisions', 'current_task_backup', 'paused_disposition', 'assurance']);
  const decisions = validateMigrationDecisions(data.decisions);
  if (decisions.target_identity !== targetIdentity || data.current_task_backup !== legacyCurrentTaskBackup(decisions)
    || data.paused_disposition !== 'verbatim-unconverted-not-resumable' || data.assurance !== 'caller-reported') {
    throw new Error('MIGRATION_DECISIONS_INVALID: preservation receipt mismatch');
  }
  return decisions;
}

export function validateMigrationAlignment(value: unknown): Array<{ path: string; sha256: string; backup_path: string }> {
  if (!Array.isArray(value)) throw new Error('MIGRATION_ALIGNMENT_INVALID: expected original backup list');
  const allowed = ['AGENTS.md', 'package.json', '.workflow-system/PROJECT_PROFILE.yaml', 'docs/workflow/WORKFLOW_GUIDE.md', 'docs/workflow/DOCUMENT_CATALOG.md', 'docs/workflow/STATUS.md'];
  const result = value.map(item => {
    const data = object(item, ['path', 'sha256', 'backup_path']);
    const p = text(data.path), hash = text(data.sha256), backup = text(data.backup_path);
    if (!allowed.includes(p) || !/^[a-f0-9]{64}$/.test(hash) || backup !== `.workflow-system/legacy/${hash}/${p}`) throw new Error('MIGRATION_ALIGNMENT_INVALID: backup binding mismatch');
    return { path: p, sha256: hash, backup_path: backup };
  });
  if (new Set(result.map(x => x.path)).size !== result.length) throw new Error('MIGRATION_ALIGNMENT_INVALID: duplicate original');
  return result;
}
