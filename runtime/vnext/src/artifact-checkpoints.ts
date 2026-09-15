import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { describeEvidenceObjects, preserveEvidenceObjects, readEvidenceObject, safeRepositoryFile, type EvidenceObject } from './evidence-lineage';

export type ArtifactImage = { path: string; object: EvidenceObject | null };
export type ArtifactCheckpoint = {
  kind: 'artifact-checkpoint/v1'; task_id: string; document_id: string; step_id: string;
  definition_revision: string; execution_id: string; phase: 'before' | 'after'; images: ArtifactImage[];
};
export type ArtifactRestorePlan = { checkpoint_id: string; checkpoint: ArtifactCheckpoint; expected: ArtifactImage[]; targets: ArtifactImage[] };

function digest(value: unknown): string {
  function canonical(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => [key, canonical(value)]));
    return item;
  }
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function assertProductPath(root: string, currentPath: string, relative: string): string {
  const absolute = safeRepositoryFile(root, relative);
  const home = path.dirname(currentPath);
  const local = path.relative(home, absolute).replace(/\\/g, '/');
  if (relative.includes('#') || relative.toLowerCase() === '.gitmodules' || /^(TASKS|\.agents\/skills|\.claude\/skills|\.codex\/skills)(\/|$)/i.test(relative)
    || /^\.workflow-system(\/|$)/i.test(relative)
    || (path.resolve(home) !== path.resolve(root) && local !== '..' && !local.startsWith('../'))
    || (!local.startsWith('../') && (/^(CURRENT_TASK|TASK_BASIS|STATUS|CONTRACTS|DECISIONS|LESSONS|PROJECT_PROFILE)([._/]|$)/i.test(local)
      || /^(task-history|task-candidates|evidence-objects|archive|archives|\.vnext)/i.test(local)))) {
    throw new Error('ARTIFACT_RESTORE_FORBIDDEN: governance and Runtime installation files cannot be restored.');
  }
  let parent = path.dirname(absolute);
  while (parent !== path.resolve(root)) {
    if (fs.existsSync(path.join(parent, '.git'))) throw new Error('ARTIFACT_UNSUPPORTED: submodule files cannot be restored.');
    parent = path.dirname(parent);
  }
  for (const registry of ['FREEZE_REGISTRY.md', '.workflow-system/FREEZE_REGISTRY.md']) {
    const file = path.join(root, registry);
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').split(/\r?\n/).some(line => line.includes(relative) && !/^\s*[-#]*\s*(unfreeze|not frozen)/i.test(line))) throw new Error('ARTIFACT_FROZEN: path is in the freeze registry.');
  }
  if (fs.existsSync(absolute)) {
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile() || stat.size > 1048576) throw new Error('ARTIFACT_UNSUPPORTED: only bounded regular files can be snapshotted.');
    const content = fs.readFileSync(absolute);
    if (content.includes(0) || !Buffer.from(content.toString('utf8')).equals(content)) throw new Error('ARTIFACT_UNSUPPORTED: binary baseline cannot be verified.');
    if (/@frozen|DO NOT MODIFY/i.test(content.subarray(0, 8192).toString('utf8'))) throw new Error('ARTIFACT_FROZEN: file has a freeze marker.');
  }
  return absolute;
}

export function captureArtifactImages(root: string, currentPath: string, paths: string[]): ArtifactImage[] {
  const unique = [...new Set(paths)].sort();
  if (unique.length > 128) throw new Error('ARTIFACT_BUDGET_EXHAUSTED: at most 128 paths.');
  const present = unique.filter(p => fs.existsSync(assertProductPath(root, currentPath, p)));
  const objects = describeEvidenceObjects(root, present);
  return unique.map(p => ({ path: p, object: objects.find(object => object.path === p) ?? null }));
}

function checkpointFile(root: string, currentPath: string, documentId: string, id: string): string {
  if (!/^doc-[a-f0-9]+$/.test(documentId) || !/^[a-f0-9]{64}$/.test(id)) throw new Error('ARTIFACT_CHECKPOINT_INVALID: invalid identity.');
  return safeRepositoryFile(root, path.relative(root, path.join(path.dirname(currentPath), 'task-history', documentId, 'artifact-checkpoints', `${id}.json`)).replace(/\\/g, '/'));
}

export function saveArtifactCheckpoint(root: string, currentPath: string, checkpoint: Omit<ArtifactCheckpoint, 'kind' | 'images'>, paths: string[], dryRun = false): string {
  const images = captureArtifactImages(root, currentPath, paths);
  const payload: ArtifactCheckpoint = { kind: 'artifact-checkpoint/v1', ...checkpoint, images };
  const id = digest(payload);
  if (dryRun) return id;
  preserveEvidenceObjects(root, currentPath, images.flatMap(image => image.object ? [image.object] : []));
  const file = checkpointFile(root, currentPath, checkpoint.document_id, id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bytes = JSON.stringify(payload) + '\n';
  if (!fs.existsSync(file)) {
    const fd = fs.openSync(file, 'wx');
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  if (fs.readFileSync(file, 'utf8') !== bytes) throw new Error('ARTIFACT_CHECKPOINT_CORRUPT: immutable checkpoint changed.');
  return id;
}

export function prepareArtifactRestore(root: string, currentPath: string, taskId: string, documentId: string, checkpointId: string, paths: string[]): ArtifactRestorePlan {
  const file = checkpointFile(root, currentPath, documentId, checkpointId);
  const checkpoint = JSON.parse(fs.readFileSync(file, 'utf8')) as ArtifactCheckpoint;
  if (digest(checkpoint) !== checkpointId || checkpoint.kind !== 'artifact-checkpoint/v1' || checkpoint.task_id !== taskId
    || checkpoint.document_id !== documentId || !['before', 'after'].includes(checkpoint.phase)) throw new Error('ARTIFACT_CHECKPOINT_INVALID: checkpoint identity or bytes differ.');
  if (!paths.length || new Set(paths).size !== paths.length) throw new Error('ARTIFACT_RESTORE_INVALID: exact nonempty unique paths required.');
  const targets = [...paths].sort().map(p => {
    const target = checkpoint.images.find(image => image.path === p);
    if (!target) throw new Error('ARTIFACT_BASELINE_MISSING: path was not captured at this checkpoint.');
    assertProductPath(root, currentPath, p);
    if (target.object) readEvidenceObject(root, currentPath, target.object);
    return target;
  });
  return { checkpoint_id: checkpointId, checkpoint, expected: captureArtifactImages(root, currentPath, paths), targets };
}

export function assertNoArtifactPublication(currentPath: string): void {
  if (fs.existsSync(path.join(path.dirname(currentPath), '.vnext-artifact-restore.lock'))) throw new Error('ARTIFACT_RECOVERY_REQUIRED: interrupted restore is retained; ordinary execution is blocked.');
}

function publish(root: string, currentPath: string, image: ArtifactImage): void {
  const file = assertProductPath(root, currentPath, image.path);
  if (!image.object) { if (fs.existsSync(file)) fs.unlinkSync(file); return; }
  const bytes = readEvidenceObject(root, currentPath, image.object);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const stage = `${file}.vnext-${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(stage, 'wx');
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.renameSync(stage, file); } finally { if (fs.existsSync(stage)) fs.unlinkSync(stage); }
}

export function applyArtifactRestore(root: string, currentPath: string, plan: ArtifactRestorePlan, afterPublish?: () => void, recordCompletion?: () => void): void {
  assertNoArtifactPublication(currentPath);
  if (digest(captureArtifactImages(root, currentPath, plan.expected.map(image => image.path))) !== digest(plan.expected)) throw new Error('ARTIFACT_RESTORE_STALE: current files differ; user changes were preserved.');
  preserveEvidenceObjects(root, currentPath, plan.expected.flatMap(image => image.object ? [image.object] : []));
  const lock = path.join(path.dirname(currentPath), '.vnext-artifact-restore.lock');
  const fd = fs.openSync(lock, 'wx');
  try { fs.writeFileSync(fd, JSON.stringify({ kind: 'artifact-restore-journal/v1', pid: process.pid, plan }) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const applied: ArtifactImage[] = [];
  try {
    for (const target of plan.targets) {
      const before = plan.expected.find(image => image.path === target.path)!;
      if (digest(captureArtifactImages(root, currentPath, [target.path])[0]) !== digest(before)) throw new Error('ARTIFACT_RESTORE_STALE: path changed during publication.');
      publish(root, currentPath, target);
      applied.push(target);
      afterPublish?.();
    }
    if (digest(captureArtifactImages(root, currentPath, plan.targets.map(image => image.path))) !== digest(plan.targets)) throw new Error('ARTIFACT_RESTORE_VERIFY_FAILED: restored files differ.');
    // Publish the completion fact while the interruption journal still blocks
    // ordinary execution. A process exit before journal removal fails closed.
    recordCompletion?.();
    fs.unlinkSync(lock);
  } catch (error) {
    for (const target of applied.reverse()) {
      if (digest(captureArtifactImages(root, currentPath, [target.path])[0]) !== digest(target)) throw new Error('ARTIFACT_RECOVERY_REQUIRED: drift during rollback; journal retained.');
      publish(root, currentPath, plan.expected.find(image => image.path === target.path)!);
    }
    if (digest(captureArtifactImages(root, currentPath, plan.expected.map(image => image.path))) === digest(plan.expected)) fs.unlinkSync(lock);
    throw error;
  }
}
