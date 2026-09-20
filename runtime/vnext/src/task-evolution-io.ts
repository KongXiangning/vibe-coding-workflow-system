import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

type EvolutionLock = {
  schema_version: 1;
  phase: 'prepared' | 'history-written' | 'current-published';
  pid: number;
  current_path: string;
  previous_revision: string;
  next_revision: string;
  history_path: string;
  history_revision: string;
  basis_path?: string;
  previous_basis_revision?: string;
  next_basis_revision?: string;
};

export type TaskEvolutionInput = {
  currentPath: string;
  previousContent: string;
  nextContent: string;
  documentId: string;
  taskId: string;
  basisPath?: string;
  basisContent?: string;
  nextBasisContent?: string;
  operation?: 'supersede' | 'confirm-replan' | 'commit-scope-amendment' | 'confirm-scope-amendment' | 'initialize-preservation' | 'replace-validation';
  evidencePlanRevision?: string | null;
  referencedEvidence?: string[];
};

export type TaskHistoryLocation = { path: string; relativePath: string; content: string };

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function lockPathFor(currentPath: string): string {
  return path.join(path.dirname(currentPath), '.vnext-task-evolution.lock');
}

function assertSafeHistoryDirectory(currentPath: string, directory: string): void {
  const workflowDirectory = path.dirname(currentPath);
  const relative = path.relative(workflowDirectory, directory);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('TASK_HISTORY_PATH_INVALID: history must stay below the canonical workflow directory.');
  }
  let cursor = workflowDirectory;
  for (const part of relative.split(path.sep)) {
    cursor = path.join(cursor, part);
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) {
      throw new Error('TASK_HISTORY_PATH_INVALID: history path cannot traverse a symbolic link.');
    }
  }
}

export function taskHistoryLocation(input: TaskEvolutionInput): TaskHistoryLocation {
  if (!/^doc-[a-f0-9]+$/u.test(input.documentId)) throw new Error('TASK_HISTORY_IDENTITY_INVALID: document ID is invalid.');
  const revision = sha256(input.previousContent);
  if ((input.basisPath === undefined) !== (input.basisContent === undefined)) {
    throw new Error('TASK_HISTORY_BASIS_INVALID: Task Basis path and bytes must be provided together.');
  }
  const basisRelativePath = input.basisPath === undefined ? null : path.relative(path.dirname(input.currentPath), input.basisPath);
  if (basisRelativePath !== null && (!basisRelativePath || basisRelativePath.startsWith('..') || path.isAbsolute(basisRelativePath))) {
    throw new Error('TASK_HISTORY_BASIS_INVALID: linked Task Basis must stay inside the canonical workflow directory.');
  }
  const basisRevision = input.basisContent === undefined ? null : sha256(input.basisContent);
  const directory = path.join(path.dirname(input.currentPath), 'task-history', input.documentId);
  assertSafeHistoryDirectory(input.currentPath, directory);
  const historyPath = path.join(directory, `${revision}.json`);
  const packageContent = JSON.stringify({
    schema_version: 1,
    kind: 'vnext-task-definition-history',
    operation: input.operation ?? 'supersede',
    task_id: input.taskId,
    document_id: input.documentId,
    source_path: path.basename(input.currentPath),
    source_revision: revision,
    task_basis_path: basisRelativePath?.replace(/\\/gu, '/') ?? null,
    task_basis_revision: basisRevision,
    evidence_plan_revision: input.evidencePlanRevision ?? null,
    referenced_evidence: [...new Set(input.referencedEvidence ?? [])].sort().map(locator => ({ locator, preservation: 'reference-only; content not snapshotted' })),
    current_task_base64: Buffer.from(input.previousContent, 'utf8').toString('base64'),
    task_basis_base64: input.basisContent === undefined ? null : Buffer.from(input.basisContent, 'utf8').toString('base64'),
  }, null, 2) + '\n';
  return {
    path: historyPath,
    relativePath: path.relative(path.dirname(input.currentPath), historyPath).replace(/\\/gu, '/'),
    content: packageContent,
  };
}

export function assertTaskHistoryForRevision(currentPath: string, documentId: string, taskId: string, sourceRevision: string, operation: 'supersede' | 'confirm-replan' | 'commit-scope-amendment' | 'confirm-scope-amendment' | 'initialize-preservation' | 'replace-validation' = 'supersede'): void {
  if (!/^doc-[a-f0-9]+$/u.test(documentId) || !/^[a-f0-9]{64}$/u.test(sourceRevision)) {
    throw new Error('TASK_HISTORY_INVALID: replay identity or revision is invalid.');
  }
  const directory = path.join(path.dirname(currentPath), 'task-history', documentId);
  assertSafeHistoryDirectory(currentPath, directory);
  const historyPath = path.join(directory, `${sourceRevision}.json`);
  if (!fs.existsSync(historyPath) || !fs.lstatSync(historyPath).isFile()) {
    throw new Error('TASK_HISTORY_MISSING: task evolution requires the immutable preimage.');
  }
  let history: Record<string, unknown>;
  try {
    history = JSON.parse(fs.readFileSync(historyPath, 'utf8')) as Record<string, unknown>;
  } catch {
    throw new Error('TASK_HISTORY_INVALID: preimage package is unreadable.');
  }
  if (history.schema_version !== 1 || history.kind !== 'vnext-task-definition-history'
    || history.operation !== operation || history.document_id !== documentId
    || history.task_id !== taskId || history.source_path !== path.basename(currentPath)
    || history.source_revision !== sourceRevision
    || typeof history.current_task_base64 !== 'string'
    || sha256(Buffer.from(history.current_task_base64, 'base64').toString('utf8')) !== sourceRevision
    || (history.task_basis_revision === null && (history.task_basis_base64 !== null || history.task_basis_path !== null))
    || (history.task_basis_revision !== null && (typeof history.task_basis_revision !== 'string'
      || typeof history.task_basis_base64 !== 'string'
      || typeof history.task_basis_path !== 'string'
      || sha256(Buffer.from(history.task_basis_base64, 'base64').toString('utf8')) !== history.task_basis_revision))) {
    throw new Error('TASK_HISTORY_INVALID: preimage identity or content digest changed.');
  }
}

function atomicReplace(filePath: string, content: string): void {
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporaryPath, 'wx');
    fs.writeFileSync(descriptor, content, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function parseLock(content: string, currentPath: string): EvolutionLock {
  let value: Partial<EvolutionLock>;
  try {
    value = JSON.parse(content) as Partial<EvolutionLock>;
  } catch {
    throw new Error('TASK_EVOLUTION_RECOVERY_REQUIRED: evolution lock is unreadable.');
  }
  if (value.schema_version !== 1 || !['prepared', 'history-written', 'current-published'].includes(value.phase ?? '')
    || !Number.isSafeInteger(value.pid) || !value.pid
    || value.current_path !== currentPath
    || ![value.previous_revision, value.next_revision, value.history_revision].every(item => typeof item === 'string' && /^[a-f0-9]{64}$/u.test(item))
    || typeof value.history_path !== 'string'
    || path.basename(value.history_path) !== `${value.previous_revision}.json`) {
    throw new Error('TASK_EVOLUTION_RECOVERY_REQUIRED: evolution lock is invalid.');
  }
  if (value.basis_path !== undefined) {
    if (typeof value.basis_path !== 'string' || !value.basis_path
      || ![value.previous_basis_revision, value.next_basis_revision].every(item => typeof item === 'string' && /^[a-f0-9]{64}$/u.test(item))) {
      throw new Error('TASK_EVOLUTION_RECOVERY_REQUIRED: evolution lock basis binding is invalid.');
    }
    const relative = path.relative(path.dirname(currentPath), value.basis_path);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('TASK_EVOLUTION_RECOVERY_REQUIRED: Task Basis path escapes workflow directory.');
    assertSafeHistoryDirectory(currentPath, path.dirname(value.basis_path));
  } else if (value.previous_basis_revision !== undefined || value.next_basis_revision !== undefined) {
    throw new Error('TASK_EVOLUTION_RECOVERY_REQUIRED: evolution lock has incomplete Task Basis binding.');
  }
  const historyDirectory = path.dirname(value.history_path);
  assertSafeHistoryDirectory(currentPath, historyDirectory);
  if (path.dirname(historyDirectory) !== path.join(path.dirname(currentPath), 'task-history')) {
    throw new Error('TASK_EVOLUTION_RECOVERY_REQUIRED: evolution lock history path is not canonical.');
  }
  return value as EvolutionLock;
}

export function recoverTaskEvolution(currentPath: string): void {
  const lockPath = lockPathFor(currentPath);
  if (!fs.existsSync(lockPath)) return;
  const lock = parseLock(fs.readFileSync(lockPath, 'utf8'), currentPath);
  if (processIsAlive(lock.pid)) {
    throw new Error('TASK_EVOLUTION_IN_PROGRESS: another process owns the task evolution lock.');
  }
  if (!fs.existsSync(currentPath)) {
    throw new Error('TASK_EVOLUTION_RECOVERY_REQUIRED: CURRENT_TASK is missing after an interrupted evolution.');
  }
  const currentRevision = sha256(fs.readFileSync(currentPath, 'utf8'));
  if (currentRevision !== lock.previous_revision && currentRevision !== lock.next_revision) {
    throw new Error('TASK_EVOLUTION_RECOVERY_REQUIRED: CURRENT_TASK is neither the old nor the new recorded revision.');
  }
  if (fs.existsSync(lock.history_path)) {
    if (sha256(fs.readFileSync(lock.history_path, 'utf8')) !== lock.history_revision) {
      throw new Error('TASK_EVOLUTION_RECOVERY_REQUIRED: history bytes changed after interruption.');
    }
  } else if (currentRevision === lock.next_revision) {
    throw new Error('TASK_EVOLUTION_RECOVERY_REQUIRED: new CURRENT_TASK is visible without its required history.');
  }
  if (lock.basis_path) {
    if (!fs.existsSync(lock.basis_path)) throw new Error('TASK_EVOLUTION_RECOVERY_REQUIRED: linked Task Basis is missing.');
    const basisRevision = sha256(fs.readFileSync(lock.basis_path, 'utf8'));
    if (basisRevision !== lock.previous_basis_revision && basisRevision !== lock.next_basis_revision) {
      throw new Error('TASK_EVOLUTION_RECOVERY_REQUIRED: linked Task Basis is neither old nor new revision.');
    }
    if (currentRevision !== lock.next_revision || basisRevision !== lock.next_basis_revision) {
      if (basisRevision === lock.next_basis_revision) {
        if (!fs.existsSync(lock.history_path)) throw new Error('TASK_EVOLUTION_RECOVERY_REQUIRED: cannot restore Task Basis without history.');
        const history = JSON.parse(fs.readFileSync(lock.history_path, 'utf8')) as { task_basis_base64?: string | null; task_basis_revision?: string | null };
        if (!history.task_basis_base64) throw new Error('TASK_EVOLUTION_RECOVERY_REQUIRED: history lacks old Task Basis bytes.');
        const oldBasis = Buffer.from(history.task_basis_base64, 'base64').toString('utf8');
        if (sha256(oldBasis) !== lock.previous_basis_revision || history.task_basis_revision !== lock.previous_basis_revision) {
          throw new Error('TASK_EVOLUTION_RECOVERY_REQUIRED: history Task Basis preimage is invalid.');
        }
        atomicReplace(lock.basis_path, oldBasis);
      }
      if (currentRevision === lock.next_revision) {
        const history = JSON.parse(fs.readFileSync(lock.history_path, 'utf8')) as { current_task_base64?: string };
        if (!history.current_task_base64) throw new Error('TASK_EVOLUTION_RECOVERY_REQUIRED: history lacks old CURRENT_TASK bytes.');
        const oldCurrent = Buffer.from(history.current_task_base64, 'base64').toString('utf8');
        if (sha256(oldCurrent) !== lock.previous_revision) throw new Error('TASK_EVOLUTION_RECOVERY_REQUIRED: history CURRENT_TASK preimage is invalid.');
        atomicReplace(currentPath, oldCurrent);
      }
    }
  }
  fs.rmSync(lockPath);
}

export function commitTaskEvolutionWithHistory(input: TaskEvolutionInput, verifyNext: (content: string) => void, afterBasisPublished?: () => void): TaskHistoryLocation {
  recoverTaskEvolution(input.currentPath);
  const history = taskHistoryLocation(input);
  const previousRevision = sha256(input.previousContent);
  const nextRevision = sha256(input.nextContent);
  const lock: EvolutionLock = {
    schema_version: 1,
    phase: 'prepared',
    pid: process.pid,
    current_path: input.currentPath,
    previous_revision: previousRevision,
    next_revision: nextRevision,
    history_path: history.path,
    history_revision: sha256(history.content),
    ...(input.nextBasisContent === undefined ? {} : {
      basis_path: input.basisPath,
      previous_basis_revision: sha256(input.basisContent!),
      next_basis_revision: sha256(input.nextBasisContent),
    }),
  };
  const lockPath = lockPathFor(input.currentPath);
  let descriptor: number | undefined;
  let ownsLock = false;
  try {
    descriptor = fs.openSync(lockPath, 'wx');
    ownsLock = true;
    fs.writeFileSync(descriptor, JSON.stringify(lock) + '\n', 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    if (!fs.existsSync(input.currentPath) || sha256(fs.readFileSync(input.currentPath, 'utf8')) !== previousRevision) {
      throw new Error('TASK_EVOLUTION_SOURCE_STALE: CURRENT_TASK changed before the evolution lock was acquired.');
    }
    if (input.basisPath !== undefined && input.basisContent !== undefined
      && (!fs.existsSync(input.basisPath) || sha256(fs.readFileSync(input.basisPath, 'utf8')) !== sha256(input.basisContent))) {
      throw new Error('TASK_EVOLUTION_BASIS_STALE: Task Basis changed before the evolution lock was acquired.');
    }
    fs.mkdirSync(path.dirname(history.path), { recursive: true });
    assertSafeHistoryDirectory(input.currentPath, path.dirname(history.path));
    if (fs.existsSync(history.path)) {
      if (fs.readFileSync(history.path, 'utf8') !== history.content) {
        throw new Error('TASK_HISTORY_CONFLICT: existing source revision has different bytes.');
      }
    } else {
      atomicReplace(history.path, history.content);
    }
    if (fs.readFileSync(history.path, 'utf8') !== history.content) {
      throw new Error('TASK_HISTORY_READ_BACK_FAILED: history bytes differ after write.');
    }
    atomicReplace(lockPath, JSON.stringify({ ...lock, phase: 'history-written' }) + '\n');
    if (input.nextBasisContent !== undefined) {
      if (!input.basisPath || input.basisContent === undefined) throw new Error('TASK_EVOLUTION_BASIS_INVALID: new Task Basis requires its exact old binding.');
      atomicReplace(input.basisPath, input.nextBasisContent);
      if (fs.readFileSync(input.basisPath, 'utf8') !== input.nextBasisContent) throw new Error('TASK_EVOLUTION_BASIS_READ_BACK_FAILED: Task Basis bytes differ after write.');
      afterBasisPublished?.();
    }
    atomicReplace(input.currentPath, input.nextContent);
    const readBack = fs.readFileSync(input.currentPath, 'utf8');
    if (sha256(readBack) !== nextRevision) {
      throw new Error('TASK_EVOLUTION_READ_BACK_FAILED: CURRENT_TASK bytes differ after write.');
    }
    atomicReplace(lockPath, JSON.stringify({ ...lock, phase: 'current-published' }) + '\n');
    verifyNext(readBack);
    fs.rmSync(lockPath);
    return history;
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (ownsLock && fs.existsSync(input.currentPath) && sha256(fs.readFileSync(input.currentPath, 'utf8')) === nextRevision) {
      try {
        atomicReplace(input.currentPath, input.previousContent);
      } catch {
        // Keep the lock so the next reader fails closed on an uncertain state.
      }
    }
    if (ownsLock && input.basisPath && input.basisContent !== undefined && input.nextBasisContent !== undefined
      && fs.existsSync(input.basisPath) && sha256(fs.readFileSync(input.basisPath, 'utf8')) === sha256(input.nextBasisContent)) {
      try {
        atomicReplace(input.basisPath, input.basisContent);
      } catch {
        // Retain the lock so the next reader restores or fails closed.
      }
    }
    if (ownsLock && fs.existsSync(input.currentPath) && sha256(fs.readFileSync(input.currentPath, 'utf8')) === previousRevision
      && (input.nextBasisContent === undefined || (input.basisPath && fs.existsSync(input.basisPath) && sha256(fs.readFileSync(input.basisPath, 'utf8')) === sha256(input.basisContent!)))
      && fs.existsSync(lockPath)) {
      fs.rmSync(lockPath);
    }
    throw error;
  }
}

export function commitSupersedeWithHistory(input: TaskEvolutionInput, verifyNext: (content: string) => void): TaskHistoryLocation {
  return commitTaskEvolutionWithHistory({ ...input, operation: 'supersede' }, verifyNext);
}

/** Publish a different task identity only after all immutable prerequisites
 * exist. A crash before the final atomic rename leaves the old task canonical;
 * a crash after it leaves a complete new draft. Prepared orphan objects confer
 * no task authority and never overwrite the predecessor or its Task Basis. */
export function publishPreparedSuccessor(
  currentPath: string, previousContent: string, nextContent: string,
  artifacts: readonly { path: string; content: string }[],
  prepareAggregate: () => void,
): void {
  if (fs.readFileSync(currentPath, 'utf8') !== previousContent) {
    throw new Error('SUCCESSOR_SOURCE_STALE: predecessor changed before publication.');
  }
  for (const artifact of artifacts) {
    if (fs.existsSync(artifact.path)) {
      if (!fs.lstatSync(artifact.path).isFile() || fs.readFileSync(artifact.path, 'utf8') !== artifact.content) {
        throw new Error('SUCCESSOR_HISTORY_CONFLICT: immutable prerequisite has different bytes.');
      }
      continue;
    }
    fs.mkdirSync(path.dirname(artifact.path), { recursive: true });
    atomicReplace(artifact.path, artifact.content);
    if (fs.readFileSync(artifact.path, 'utf8') !== artifact.content) throw new Error('SUCCESSOR_READ_BACK_FAILED: prerequisite differs.');
  }
  prepareAggregate();
  if (fs.readFileSync(currentPath, 'utf8') !== previousContent) throw new Error('SUCCESSOR_SOURCE_STALE: predecessor changed while preparing dependencies.');
  atomicReplace(currentPath, nextContent);
  if (fs.readFileSync(currentPath, 'utf8') !== nextContent) throw new Error('SUCCESSOR_READ_BACK_FAILED: published draft differs.');
}
