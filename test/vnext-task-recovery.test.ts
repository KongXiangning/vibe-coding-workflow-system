import { afterEach, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyArtifactRestore, assertNoArtifactPublication, prepareArtifactRestore, saveArtifactCheckpoint } from '../runtime/vnext/src/artifact-checkpoints';
import { describeEvidenceObjects, preserveEvidenceObjects, readEvidenceObject } from '../runtime/vnext/src/evidence-lineage';
import { assertGovernanceReadable, withGovernanceWriteLock } from '../runtime/vnext/src/runtime-io';

// P-12: implementation plan G11/G13/G14/G16/G17/G19. Real filesystem and
// process boundaries are necessary to verify exact restoration and fail-closed locks.
const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-recovery-components-'));
  roots.push(root);
  const current = path.join(root, 'governance/CURRENT_TASK.md');
  fs.mkdirSync(path.dirname(current));
  fs.mkdirSync(path.join(root, '.workflow-system'));
  fs.writeFileSync(path.join(root, '.workflow-system/PROJECT_PROFILE.yaml'), 'paths:\n  workflow_home: governance\n');
  fs.writeFileSync(current, 'retained task history\n');
  fs.writeFileSync(path.join(root, 'a.txt'), 'first A\n');
  fs.writeFileSync(path.join(root, 'b.txt'), 'first B\n');
  const identity = { task_id: '001', document_id: 'doc-0123456789abcdef', step_id: 'S1', definition_revision: '1'.repeat(64), execution_id: 'execution-1', phase: 'before' as const };
  return { root, current, identity };
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

test('G11/G13/G19 exact custom-home checkpoint restores selected changed/deleted/added files and retains unrelated edits', () => {
  const { root, current, identity } = fixture();
  const checkpoint = saveArtifactCheckpoint(root, current, identity, ['a.txt', 'b.txt', 'new.txt']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'second A\n'); fs.unlinkSync(path.join(root, 'b.txt')); fs.writeFileSync(path.join(root, 'new.txt'), 'new\n');
  fs.writeFileSync(path.join(root, 'unrelated.txt'), 'user change\n');
  const plan = prepareArtifactRestore(root, current, identity.task_id, identity.document_id, checkpoint, ['a.txt', 'b.txt', 'new.txt']);
  const governance = fs.readFileSync(current);
  applyArtifactRestore(root, current, plan);
  expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('first A\n');
  expect(fs.readFileSync(path.join(root, 'b.txt'), 'utf8')).toBe('first B\n');
  expect(fs.existsSync(path.join(root, 'new.txt'))).toBe(false);
  expect(fs.readFileSync(path.join(root, 'unrelated.txt'), 'utf8')).toBe('user change\n');
  expect(fs.readFileSync(current)).toEqual(governance);
  expect(() => prepareArtifactRestore(root, current, '002', identity.document_id, checkpoint, ['a.txt'])).toThrow('ARTIFACT_CHECKPOINT_INVALID');
});

test('G14 changed user bytes and absent checkpoint never produce a guessed restore', () => {
  const { root, current, identity } = fixture();
  const checkpoint = saveArtifactCheckpoint(root, current, identity, ['a.txt']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'second A\n');
  const plan = prepareArtifactRestore(root, current, identity.task_id, identity.document_id, checkpoint, ['a.txt']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'user edit after confirmation\n');
  expect(() => applyArtifactRestore(root, current, plan)).toThrow('ARTIFACT_RESTORE_STALE');
  expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('user edit after confirmation\n');
  expect(() => prepareArtifactRestore(root, current, identity.task_id, identity.document_id, checkpoint, ['b.txt'])).toThrow('ARTIFACT_BASELINE_MISSING');
});

test('G11 immutable old bodies are recoverable and corruption is rejected', () => {
  const { root, current } = fixture();
  const objects = describeEvidenceObjects(root, ['a.txt', 'b.txt']);
  preserveEvidenceObjects(root, current, objects);
  fs.writeFileSync(path.join(root, 'a.txt'), 'new A\n');
  expect(readEvidenceObject(root, current, objects[0]).toString()).toBe('first A\n');
  expect(readEvidenceObject(root, current, objects[1]).toString()).toBe('first B\n');
  fs.writeFileSync(path.join(path.dirname(current), 'evidence-objects', `${objects[0].sha256}.blob`), 'tampered');
  expect(() => readEvidenceObject(root, current, objects[0])).toThrow('EVIDENCE_OBJECT_CORRUPT');
});

test('G17 governance, freeze markers and unverified binaries cannot be artifact restoration targets', () => {
  const { root, current, identity } = fixture();
  expect(() => saveArtifactCheckpoint(root, current, identity, ['governance/CURRENT_TASK.md'])).toThrow('ARTIFACT_RESTORE_FORBIDDEN');
  fs.writeFileSync(path.join(root, 'a.txt'), '@frozen\n');
  expect(() => saveArtifactCheckpoint(root, current, identity, ['a.txt'])).toThrow('ARTIFACT_FROZEN');
  fs.writeFileSync(path.join(root, 'b.txt'), Buffer.from([0, 255, 12]));
  expect(() => saveArtifactCheckpoint(root, current, identity, ['b.txt'])).toThrow('ARTIFACT_UNSUPPORTED');
  expect(() => describeEvidenceObjects(root, ['../escape'])).toThrow('EVIDENCE_OBJECT_PATH_INVALID');
  expect(() => saveArtifactCheckpoint(root, current, identity, ['.GIT/config'])).toThrow('EVIDENCE_OBJECT_PATH_INVALID');
  expect(() => saveArtifactCheckpoint(root, current, identity, ['.git./config'])).toThrow('EVIDENCE_OBJECT_PATH_INVALID');
  expect(() => saveArtifactCheckpoint(root, current, identity, ['.WORKFLOW-SYSTEM/runtime/file'])).toThrow('ARTIFACT_RESTORE_FORBIDDEN');
  expect(() => saveArtifactCheckpoint(root, current, identity, ['a.txt#fragment'])).toThrow('ARTIFACT_RESTORE_FORBIDDEN');
});

test('G16 a competing ordinary writer and a crashed owner cannot publish a mixed task state', () => {
  const { root, current } = fixture();
  const module = path.resolve(import.meta.dir, '../runtime/vnext/src/runtime-io.ts');
  withGovernanceWriteLock(root, () => {
    const child = spawnSync('bun', ['-e', `import { withGovernanceWriteLock } from ${JSON.stringify(module)}; withGovernanceWriteLock(${JSON.stringify(root)}, () => { throw new Error('must not enter'); });`], { encoding: 'utf8' });
    expect(child.status).not.toBe(0);
    expect(child.stderr).toContain('GOVERNANCE_WRITE_LOCKED');
  });
  const crash = spawnSync('bun', ['-e', `import { withGovernanceWriteLock } from ${JSON.stringify(module)}; withGovernanceWriteLock(${JSON.stringify(root)}, () => process.exit(79));`], { encoding: 'utf8' });
  expect(crash.status).toBe(79);
  expect(() => assertGovernanceReadable(current)).toThrow('GOVERNANCE_WRITE_LOCKED');
  expect(fs.readFileSync(current, 'utf8')).toBe('retained task history\n');
});

test('G16 real process exit during multi-file restore leaves a durable journal and fails closed', () => {
  const { root, current, identity } = fixture();
  const checkpoint = saveArtifactCheckpoint(root, current, identity, ['a.txt', 'b.txt']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'second A\n'); fs.writeFileSync(path.join(root, 'b.txt'), 'second B\n');
  const plan = prepareArtifactRestore(root, current, identity.task_id, identity.document_id, checkpoint, ['a.txt', 'b.txt']);
  const module = path.resolve(import.meta.dir, '../runtime/vnext/src/artifact-checkpoints.ts');
  const child = spawnSync('bun', ['-e', `import { applyArtifactRestore } from ${JSON.stringify(module)}; applyArtifactRestore(${JSON.stringify(root)}, ${JSON.stringify(current)}, ${JSON.stringify(plan)}, () => process.exit(79));`], { encoding: 'utf8' });
  expect(child.status).toBe(79);
  expect(() => assertNoArtifactPublication(current)).toThrow('ARTIFACT_RECOVERY_REQUIRED');
  expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('first A\n');
  expect(fs.readFileSync(path.join(root, 'b.txt'), 'utf8')).toBe('second B\n');
});

test('restore completion publication failure rolls back; process exit at completion keeps the journal', () => {
  const { root, current, identity } = fixture();
  const checkpoint = saveArtifactCheckpoint(root, current, identity, ['a.txt']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'second A\n');
  const plan = prepareArtifactRestore(root, current, identity.task_id, identity.document_id, checkpoint, ['a.txt']);
  expect(() => applyArtifactRestore(root, current, plan, undefined, () => { throw new Error('receipt write failed'); })).toThrow('receipt write failed');
  expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('second A\n');
  expect(() => assertNoArtifactPublication(current)).not.toThrow();
  const module = path.resolve(import.meta.dir, '../runtime/vnext/src/artifact-checkpoints.ts');
  const child = spawnSync('bun', ['-e', `import { applyArtifactRestore } from ${JSON.stringify(module)}; applyArtifactRestore(${JSON.stringify(root)}, ${JSON.stringify(current)}, ${JSON.stringify(plan)}, undefined, () => process.exit(79));`], { encoding: 'utf8' });
  expect(child.status).toBe(79);
  expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('first A\n');
  expect(() => assertNoArtifactPublication(current)).toThrow('ARTIFACT_RECOVERY_REQUIRED');
});
