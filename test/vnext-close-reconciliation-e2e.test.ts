import { afterEach, describe, expect, test } from 'bun:test';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { stringify } from 'yaml';
import {
  applyVNextRuntimeProposal,
  createArchiveProposal,
  createLessonRecordProposal,
  createProjectStatusProposal,
  previewCloseTask,
  readCanonicalCurrentTask,
  readDurableLessonRecords,
  readLessonMarkers,
  type ArchiveDelta,
  type AuthorityEvidence,
  type ClosureEvidence,
  type DeliverySummary,
  type LessonRecordDelta,
  type ProjectStatusDelta,
  type RuntimeProposal,
  type RuntimeResult,
  type RuntimeState,
} from '../scripts/vnext-runtime';

// P-12 admission for this persistent system-level E2E:
// existing transaction tests prove individual archive/status/Lesson replay and
// rollback behavior, but do not prove post-archive interruption, process
// restart from durable files, and cross-operation reconciliation as one
// business flow.
const P12_CLOSE_RECONCILIATION_E2E_ADMISSION = {
  decision: 'admitted',
  owner: 'workflow-system maintainers',
  basis: 'critical-invariant',
  proves: 'a terminal archive survives post-archive interruption and restart repairs only missing STATUS and admitted Lesson reconciliation',
  existingEvidenceInsufficiency: 'existing Runtime tests cover individual close transactions and retries, not the ordered archive-plus-reconciliation restart flow',
  assertionBoundary: 'isolated pure-vNext Virtual Project durable CURRENT_TASK, archive, STATUS, and LESSONS state',
  failureDisposition: 'block the system-level vNext quality gate until post-archive reconciliation recovery is restored',
} as const;

const FIXTURE_TASK_ID = '901';
const FIXTURE_TASK_SLUG = 'close-reconciliation-e2e';
const FIXTURE_TASK_TITLE = 'Close reconciliation E2E fixture';
const FIXTURE_DOCUMENT_ID = 'doc-111111111111111111111111';
const STATUS_ITEM = 'close reconciliation e2e task';
const STATUS_RISK = 'none beyond the completed close reconciliation fixture';
const STATUS_CHECKPOINT = 'observe the close reconciliation E2E checkpoint';
const LESSON_REF = 'lesson-close-reconciliation-e2e';
const CURRENT_TASK_RELATIVE_PATH = 'docs/workflow/CURRENT_TASK.md';
const STATUS_RELATIVE_PATH = 'docs/workflow/STATUS.md';
const LESSONS_RELATIVE_PATH = 'docs/workflow/LESSONS.md';
const ARCHIVE_RELATIVE_PATH = `TASKS/TASK-${FIXTURE_TASK_ID}-${FIXTURE_TASK_SLUG}.md`;
const STATUS_RECONCILIATION_BEGIN = '<!-- BEGIN vNext close-task STATUS reconciliation -->';

const temporaryRoots: string[] = [];

function fixtureState(overrides: Partial<RuntimeState> = {}): RuntimeState {
  return {
    schema_version: 1,
    kind: 'vnext-current-task-runtime-state',
    task_id: FIXTURE_TASK_ID,
    task_slug: FIXTURE_TASK_SLUG,
    workflow_status: 'active',
    lifecycle_state: 'active',
    resume_requires_review: false,
    resume_review_reasons: [],
    active_step_id: 'step-close-reconciliation',
    active_step_status: 'completed',
    finding_queue_revision: 0,
    review_cycle: {
      id: 'review-cycle-close-reconciliation-e2e',
      cycle_phase: 'discovery',
      repair_round: 0,
      counted_repair_wave_ids: [],
      active_repair_wave_id: null,
      verification_new_finding_wave_used: false,
      verification_new_finding_wave_id: null,
    },
    findings: [],
    execution_log: [],
    applied_proposals: [],
    ...overrides,
  };
}

function currentTaskBody(state: RuntimeState): string {
  return [
    '# vNext CURRENT_TASK',
    '',
    '## 任务信息',
    '',
    `- 任务 ID：${state.task_id}`,
    `- 任务标题：${FIXTURE_TASK_TITLE}`,
    `- 任务 slug：${state.task_slug}`,
    `- 当前状态：${state.workflow_status}`,
    `- 生命周期状态：${state.lifecycle_state}`,
    `- 恢复需审查：${state.resume_requires_review ? 'true' : 'false'}`,
    `- 恢复审查原因：${state.resume_review_reasons.join(', ')}`,
    '',
    '## 背景与上下文',
    '',
    '- synthetic close-task post-archive reconciliation scenario',
    '',
    '## 验收标准',
    '',
    '- [ ] terminal archive and reconciliation remain durable after restart',
    '',
    '## 允许修改范围',
    '',
    '### Allowed Files',
    '',
    '- synthetic-fixture/**',
    '',
    '### Conditional Files',
    '',
    '- docs/** when the close transaction authorizes reconciliation',
    '',
    '## 禁止修改范围',
    '',
    '### Forbidden Files',
    '',
    '- .git/**',
    '',
    '## 受影响的契约',
    '',
    '- synthetic close-task reconciliation contract',
    '',
    '## 已确认决策',
    '',
    '- archive, STATUS, and LESSONS remain independently retryable',
    '',
    '## 待确认问题',
    '',
    '- none',
    '',
    '## 实现方案',
    '',
    '- exercise the existing typed close-task Runtime operations',
    '',
    '## 审查问题队列',
    '',
    '- none',
    '',
    '## 传播治理记录',
    '',
    '- synthetic fixture only',
    '',
    '## 实施步骤',
    '',
    `- ${state.active_step_id}: complete the close reconciliation fixture`,
    '',
    '## 回归检查项',
    '',
    '- [ ] run the isolated close reconciliation E2E',
    '',
    '## 回滚点',
    '',
    '- restore the terminal fixture snapshot if reconciliation read-back fails',
    '',
    '## 设计约束',
    '',
    '- no sync-state component is permitted',
    '',
    '## 发布后验证',
    '',
    '- synthetic restart from durable files',
    '',
    '## 执行记录',
    '',
    '- task step completed before close',
    '',
  ].join('\n');
}

function createVirtualProject(state: RuntimeState = fixtureState()): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-vnext-close-reconciliation-e2e-'));
  temporaryRoots.push(root);
  fs.mkdirSync(path.join(root, '.workflow-system'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.workflow-system', 'PROJECT_PROFILE.yaml'),
    [
      'schema_version: 1',
      '',
      'project:',
      '  name: close-reconciliation-e2e-fixture',
      '  type: test',
      '',
      'paths:',
      '  workflow_home: docs/workflow',
      '',
    ].join('\n'),
    'utf8',
  );

  const currentTaskPath = path.join(root, CURRENT_TASK_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(currentTaskPath), { recursive: true });
  const frontmatter = {
    schema_version: 1,
    kind: 'vnext-current-task',
    document_id: FIXTURE_DOCUMENT_ID,
    runtime_state: state,
  };
  fs.writeFileSync(currentTaskPath, `---\n${stringify(frontmatter).trimEnd()}\n---\n${currentTaskBody(state)}`, 'utf8');

  fs.writeFileSync(path.join(root, STATUS_RELATIVE_PATH), [
    '# STATUS.md',
    '',
    '## 项目概览',
    '',
    '- 项目：close-reconciliation-e2e-fixture',
    '',
    '## ✅ 已完成且稳定',
    '',
    '- [ ] baseline',
    '',
    '## 🔨 正在开发',
    '',
    '- [ ] none',
    '',
    '## 📋 待开发',
    '',
    '- [ ] none',
    '',
    '## ⚠️ 已知风险 / 观察点',
    '',
    '- none',
    '',
    '## ❌ 已移除 / 推迟',
    '',
    '- none',
    '',
    '## 🔜 下一检查点',
    '',
    '- baseline',
    '',
    '## 最近更新记录',
    '',
    '- initial synthetic fixture',
    '',
  ].join('\n'), 'utf8');

  fs.writeFileSync(path.join(root, LESSONS_RELATIVE_PATH), [
    '# LESSONS.md',
    '',
    '## 使用规则',
    '',
    '- reusable only',
    '',
    '## 通用',
    '',
    '- none',
    '',
    '## 数据与存储',
    '',
    '- none',
    '',
    '## 前端与交互',
    '',
    '- none',
    '',
    '## 后端与服务',
    '',
    '- none',
    '',
    '## 测试与回归',
    '',
    '- none',
    '',
    '## 部署与运行时',
    '',
    '- none',
    '',
  ].join('\n'), 'utf8');

  fs.mkdirSync(path.join(root, 'TASKS', 'inbox'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'synthetic-login.ts'), 'export function syntheticLogin() { return true; }\n', 'utf8');
  return root;
}

function authority(...kinds: AuthorityEvidence['kind'][]): AuthorityEvidence[] {
  return kinds.map(kind => ({
    kind,
    source: CURRENT_TASK_RELATIVE_PATH,
    subject: FIXTURE_TASK_ID,
  }));
}

function closureEvidence(): ClosureEvidence {
  const notTriggered = { triggered: false, complete: false, evidence_refs: [] as string[] };
  return {
    acceptance_satisfied: true,
    validation_complete: true,
    no_admitted_or_in_progress_findings: true,
    no_unresolved_closure_blocker: true,
    release_evidence: { ...notTriggered },
    rollback_evidence: { ...notTriggered },
    observation_evidence: { ...notTriggered },
    remaining_risks_non_blocking: true,
    archive_path_verified: true,
  };
}

function deliverySummary(): DeliverySummary {
  return {
    goal: 'complete the close reconciliation E2E fixture',
    actual_changes: ['completed the synthetic terminal task'],
    verification: ['existing close-task Runtime handlers exercised'],
    release_evidence: [],
    rollback_evidence: [],
    observation_evidence: [],
    next_action: 'observe the synthetic reconciliation checkpoint',
  };
}

function archiveDelta(): ArchiveDelta {
  return {
    kind: 'archive',
    action: 'archive',
    closure_evidence: closureEvidence(),
    delivery_summary: deliverySummary(),
    remaining_risks: [STATUS_RISK],
    lesson_admission: {
      decision: 'admit',
      candidate_refs: [LESSON_REF],
      evidence_refs: ['e2e:evidence:lesson'],
    },
    evidence_refs: ['e2e:evidence:closure', 'e2e:evidence:lesson'],
  };
}

function statusDelta(): ProjectStatusDelta {
  return {
    kind: 'project-status',
    action: 'sync',
    status: 'completed',
    summary: 'close reconciliation E2E fixture completed',
    completed_items: [STATUS_ITEM],
    remaining_risks: [STATUS_RISK],
    next_checkpoint: STATUS_CHECKPOINT,
    evidence_refs: ['e2e:evidence:status'],
  };
}

function lessonDelta(): LessonRecordDelta {
  return {
    kind: 'lesson-record',
    action: 'record',
    candidates: [{
      candidate_ref: LESSON_REF,
      category: '测试与回归',
      scene: 'Archive can commit before downstream reconciliation finishes.',
      conclusion: 'Restart should retry only missing typed reconciliation operations.',
      trigger: 'The process stopped after archive read-back and before Lesson reconciliation.',
      cause: 'Archive, STATUS, and LESSONS have independent durable write boundaries.',
      action: 'Reconstruct close-task reconciliation from canonical files and receipts.',
      consumer: 'future close-task recovery flow',
      evidence_refs: ['e2e:evidence:lesson'],
    }],
    evidence_refs: ['e2e:evidence:lesson'],
  };
}

function archiveProposal(root: string, delta: ArchiveDelta): RuntimeProposal {
  return createArchiveProposal(readCanonicalCurrentTask(root), {
    delta,
    idempotency_key: 'close-reconciliation-archive',
    authority_evidence: authority('active-task-owner', 'evidence-admission'),
    evidence_refs: delta.evidence_refs,
  });
}

function statusProposal(root: string, delta: ProjectStatusDelta): RuntimeProposal {
  return createProjectStatusProposal(readCanonicalCurrentTask(root), {
    delta,
    idempotency_key: 'close-reconciliation-status',
    authority_evidence: authority('evidence-admission'),
    evidence_refs: delta.evidence_refs,
  });
}

function lessonProposal(root: string, delta: LessonRecordDelta): RuntimeProposal {
  return createLessonRecordProposal(readCanonicalCurrentTask(root), {
    delta,
    idempotency_key: 'close-reconciliation-lesson',
    authority_evidence: authority('evidence-admission'),
    evidence_refs: delta.evidence_refs,
  });
}

function fileHash(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function fileBytes(root: string, relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function countOccurrences(content: string, needle: string): number {
  let count = 0;
  let offset = 0;
  while (true) {
    const index = content.indexOf(needle, offset);
    if (index < 0) return count;
    count += 1;
    offset = index + needle.length;
  }
}

function archiveFileCount(root: string): number {
  return fs.readdirSync(path.join(root, 'TASKS')).filter(name => /^TASK-\d+-[a-z0-9-]+\.md$/u.test(name)).length;
}

function archiveAuditCount(root: string): number {
  return readCanonicalCurrentTask(root).runtimeState.execution_log.filter(item => 'action' in item && item.action === 'archive').length;
}

function canonicalStateSnapshot(root: string): { current: string; archive: string; status: string; lessons: string } {
  return {
    current: fileBytes(root, CURRENT_TASK_RELATIVE_PATH),
    archive: fileBytes(root, ARCHIVE_RELATIVE_PATH),
    status: fileBytes(root, STATUS_RELATIVE_PATH),
    lessons: fileBytes(root, LESSONS_RELATIVE_PATH),
  };
}

function assertTerminalArchiveUnchanged(root: string, terminal: { current: string; archive: string }, beforeArchiveCount: number): void {
  const current = readCanonicalCurrentTask(root);
  expect(current.runtimeState.workflow_status).toBe('closed');
  expect(current.runtimeState.lifecycle_state).toBe('archived');
  expect(current.raw).toBe(terminal.current);
  expect(fileBytes(root, ARCHIVE_RELATIVE_PATH)).toBe(terminal.archive);
  expect(archiveFileCount(root)).toBe(beforeArchiveCount);
  expect(archiveAuditCount(root)).toBe(1);
}

function applyArchive(root: string, delta: ArchiveDelta): { proposalJson: string; terminal: { current: string; archive: string }; archiveResult: RuntimeResult } {
  const proposal = archiveProposal(root, delta);
  const proposalJson = JSON.stringify(proposal);
  const archiveResult = applyVNextRuntimeProposal(root, proposal, { now: () => '2026-09-03T00:00:00.000Z' });
  expect(archiveResult.status).toBe('success');
  expect(archiveResult.committed).toBe(true);
  expect(archiveResult.read_back_verified).toBe(true);
  expect(archiveResult.archive_path).toBe(ARCHIVE_RELATIVE_PATH);
  return {
    proposalJson,
    terminal: {
      current: fileBytes(root, CURRENT_TASK_RELATIVE_PATH),
      archive: fileBytes(root, ARCHIVE_RELATIVE_PATH),
    },
    archiveResult,
  };
}

function reconcileStatusFromDisk(root: string, delta: ProjectStatusDelta): RuntimeResult {
  return applyVNextRuntimeProposal(root, statusProposal(root, delta));
}

function reconcileLessonFromDisk(root: string, delta: LessonRecordDelta): RuntimeResult {
  return applyVNextRuntimeProposal(root, lessonProposal(root, delta));
}

function reenterCloseTaskFromDurableFiles(
  root: string,
  archiveProposalJson: string,
  closeDelta: ArchiveDelta,
): { preview: ReturnType<typeof previewCloseTask>; archiveReplay: RuntimeResult; status: RuntimeResult; lesson: RuntimeResult } {
  // This helper intentionally reconstructs every proposal from the filesystem.
  // The only retained input is the submitted archive proposal JSON, not its
  // parsed CURRENT_TASK snapshot or any caller-local reconciliation state.
  const preview = previewCloseTask(root, closeDelta);
  const archiveReplay = applyVNextRuntimeProposal(root, JSON.parse(archiveProposalJson));
  const status = reconcileStatusFromDisk(root, statusDelta());
  const lesson = reconcileLessonFromDisk(root, lessonDelta());
  return { preview, archiveReplay, status, lesson };
}

function assertNoOp(result: RuntimeResult, expectedPlannedWrites?: string[]): void {
  expect(result.status).toBe('no-op');
  expect(result.committed).toBe(false);
  expect(result.governed_mutation_count).toBe(0);
  expect(result.read_back_verified).toBe(true);
  if (expectedPlannedWrites !== undefined) expect(result.planned_writes).toEqual(expectedPlannedWrites);
}

describe('vNext close-task post-archive reconciliation recovery E2E', () => {
  afterEach(() => {
    for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  test('P-12 admission covers the isolated system-level business invariant', () => {
    expect(P12_CLOSE_RECONCILIATION_E2E_ADMISSION.decision).toBe('admitted');
    expect(P12_CLOSE_RECONCILIATION_E2E_ADMISSION.basis).toBe('critical-invariant');
    expect(P12_CLOSE_RECONCILIATION_E2E_ADMISSION.existingEvidenceInsufficiency).toContain('restart');
  });

  test('Scenario A: repairs only missing STATUS and admitted Lesson after archive interruption and restart', () => {
    const root = createVirtualProject();
    const delta = archiveDelta();
    const first = applyArchive(root, delta);
    const archiveCountBeforeRestart = archiveFileCount(root);

    // Simulated interruption: archive is durable, while no downstream
    // reconciliation transaction has been started.
    expect(fileBytes(root, STATUS_RELATIVE_PATH)).not.toContain(STATUS_RECONCILIATION_BEGIN);
    expect(readLessonMarkers(fileBytes(root, LESSONS_RELATIVE_PATH), LESSONS_RELATIVE_PATH)).toHaveLength(0);

    const restarted = reenterCloseTaskFromDurableFiles(root, first.proposalJson, delta);
    expect(restarted.preview.status).toBe('reconciliation');
    expect(restarted.preview.planned_operations).toEqual(['project-status-transaction', 'lesson-record-transaction']);
    assertNoOp(restarted.archiveReplay);
    expect(restarted.status.status).toBe('success');
    expect(restarted.status.committed).toBe(true);
    expect(restarted.status.governed_mutation_count).toBe(1);
    expect(restarted.status.read_back_verified).toBe(true);
    expect(restarted.lesson.status).toBe('success');
    expect(restarted.lesson.committed).toBe(true);
    expect(restarted.lesson.governed_mutation_count).toBe(1);
    expect(restarted.lesson.read_back_verified).toBe(true);

    assertTerminalArchiveUnchanged(root, first.terminal, archiveCountBeforeRestart);
    const status = fileBytes(root, STATUS_RELATIVE_PATH);
    const lessons = fileBytes(root, LESSONS_RELATIVE_PATH);
    expect(countOccurrences(status, STATUS_RECONCILIATION_BEGIN)).toBe(1);
    expect(status).toContain(`- ${STATUS_ITEM}`);
    expect(readDurableLessonRecords(lessons, LESSONS_RELATIVE_PATH)).toHaveLength(1);
    expect(readLessonMarkers(lessons, LESSONS_RELATIVE_PATH)).toHaveLength(1);
    expect(readDurableLessonRecords(lessons, LESSONS_RELATIVE_PATH)[0]?.marker.candidate_ref).toBe(LESSON_REF);
  });

  test('Scenario B: preserves completed STATUS and repairs only missing Lesson after restart', () => {
    const root = createVirtualProject();
    const delta = archiveDelta();
    const first = applyArchive(root, delta);
    expect(reconcileStatusFromDisk(root, statusDelta()).status).toBe('success');
    const beforeRestart = canonicalStateSnapshot(root);
    const archiveCountBeforeRestart = archiveFileCount(root);
    expect(readLessonMarkers(beforeRestart.lessons, LESSONS_RELATIVE_PATH)).toHaveLength(0);

    const restarted = reenterCloseTaskFromDurableFiles(root, first.proposalJson, delta);
    expect(restarted.preview.status).toBe('reconciliation');
    assertNoOp(restarted.archiveReplay);
    assertNoOp(restarted.status, []);
    expect(restarted.lesson.status).toBe('success');
    expect(restarted.lesson.committed).toBe(true);
    expect(restarted.lesson.governed_mutation_count).toBe(1);
    expect(restarted.lesson.read_back_verified).toBe(true);

    assertTerminalArchiveUnchanged(root, first.terminal, archiveCountBeforeRestart);
    expect(fileBytes(root, STATUS_RELATIVE_PATH)).toBe(beforeRestart.status);
    const lessons = fileBytes(root, LESSONS_RELATIVE_PATH);
    expect(readDurableLessonRecords(lessons, LESSONS_RELATIVE_PATH)).toHaveLength(1);
    expect(readLessonMarkers(lessons, LESSONS_RELATIVE_PATH)).toHaveLength(1);
  });

  test('Scenario C: fully reconciled terminal state is a deterministic zero-write restart no-op', () => {
    const root = createVirtualProject();
    const delta = archiveDelta();
    const first = applyArchive(root, delta);
    expect(reconcileStatusFromDisk(root, statusDelta()).status).toBe('success');
    expect(reconcileLessonFromDisk(root, lessonDelta()).status).toBe('success');
    const beforeRestart = canonicalStateSnapshot(root);
    const beforeHashes = [
      fileHash(path.join(root, CURRENT_TASK_RELATIVE_PATH)),
      fileHash(path.join(root, ARCHIVE_RELATIVE_PATH)),
      fileHash(path.join(root, STATUS_RELATIVE_PATH)),
      fileHash(path.join(root, LESSONS_RELATIVE_PATH)),
    ];
    const archiveCountBeforeRestart = archiveFileCount(root);

    const restarted = reenterCloseTaskFromDurableFiles(root, first.proposalJson, delta);
    expect(restarted.preview.status).toBe('reconciliation');
    assertNoOp(restarted.archiveReplay);
    assertNoOp(restarted.status, []);
    assertNoOp(restarted.lesson, []);

    expect(canonicalStateSnapshot(root)).toEqual(beforeRestart);
    expect([
      fileHash(path.join(root, CURRENT_TASK_RELATIVE_PATH)),
      fileHash(path.join(root, ARCHIVE_RELATIVE_PATH)),
      fileHash(path.join(root, STATUS_RELATIVE_PATH)),
      fileHash(path.join(root, LESSONS_RELATIVE_PATH)),
    ]).toEqual(beforeHashes);
    expect(archiveFileCount(root)).toBe(archiveCountBeforeRestart);
    expect(archiveAuditCount(root)).toBe(1);
    expect(countOccurrences(fileBytes(root, STATUS_RELATIVE_PATH), STATUS_RECONCILIATION_BEGIN)).toBe(1);
    expect(readDurableLessonRecords(fileBytes(root, LESSONS_RELATIVE_PATH), LESSONS_RELATIVE_PATH)).toHaveLength(1);
  });

  test('Scenario D: contradictory STATUS projection fails closed without repair or second archive', () => {
    const root = createVirtualProject();
    const delta = archiveDelta();
    const first = applyArchive(root, delta);
    expect(reconcileStatusFromDisk(root, statusDelta()).status).toBe('success');
    const statusPath = path.join(root, STATUS_RELATIVE_PATH);
    const statusBeforeContradiction = fs.readFileSync(statusPath, 'utf8');
    const contradictoryStatus = statusBeforeContradiction.replace(
      `- ${STATUS_ITEM}\n\n## 🔨 正在开发`,
      '- contradictory completed item\n\n## 🔨 正在开发',
    );
    expect(contradictoryStatus).not.toBe(statusBeforeContradiction);
    fs.writeFileSync(statusPath, contradictoryStatus, 'utf8');

    const beforeReentry = canonicalStateSnapshot(root);
    const archiveCountBeforeRestart = archiveFileCount(root);
    const restartedPreview = previewCloseTask(root, delta);
    expect(restartedPreview.status).toBe('reconciliation');
    const archiveReplay = applyVNextRuntimeProposal(root, JSON.parse(first.proposalJson));
    assertNoOp(archiveReplay);
    const conflictingStatus = reconcileStatusFromDisk(root, statusDelta());
    expect(conflictingStatus.status).toBe('blocked');
    expect(conflictingStatus.code).toBe('STATUS_PROVENANCE_MISMATCH');
    expect(conflictingStatus.committed).toBe(false);
    expect(conflictingStatus.governed_mutation_count).toBe(0);
    expect(conflictingStatus.read_back_verified).toBe(false);

    expect(canonicalStateSnapshot(root)).toEqual(beforeReentry);
    expect(fileBytes(root, STATUS_RELATIVE_PATH)).toContain('contradictory completed item');
    expect(archiveFileCount(root)).toBe(archiveCountBeforeRestart);
    expect(archiveAuditCount(root)).toBe(1);
    expect(readLessonMarkers(fileBytes(root, LESSONS_RELATIVE_PATH), LESSONS_RELATIVE_PATH)).toHaveLength(0);
  });
});
