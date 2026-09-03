import { afterEach, describe, expect, test } from 'bun:test';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { stringify } from 'yaml';
import {
  applyVNextRuntimeProposal,
  createArchiveProposal,
  createContractCandidateProposal,
  createDecisionRecordProposal,
  knowledgeProvenanceFromArchive,
  readCanonicalCurrentTask,
  readDurableKnowledgeRecords,
  type ArchiveDelta,
  type ArchiveAuditLogEntry,
  type AuthorityEvidence,
  type ClosureEvidence,
  type DeliverySummary,
  type KnowledgeAdmissionBundle,
  type KnowledgeAdmissionRecord,
  type KnowledgeCandidate,
  type RuntimeProposal,
  type RuntimeState,
} from '../scripts/vnext-runtime';
import { fingerprintKnowledgeStatement } from '../scripts/project-context-resolver';

// P-12 admission for this focused persistent test:
// individual Runtime tests prove archive, Contract/Decision, and Lesson
// transactions separately, but do not prove that close-task admission is
// persisted in the archive and can be reconciled from disk after a process
// interruption without duplicating long-term knowledge.
const P12_CLOSE_KNOWLEDGE_ADMISSION = {
  decision: 'admitted',
  owner: 'workflow-system maintainers',
  basis: 'critical-invariant',
  proves: 'normal close-task promotes admitted Contract/Decision candidates through typed Runtime handlers and reconstructs pending knowledge from the canonical archive after restart',
  existingEvidenceInsufficiency: 'transaction-level tests do not cover archive admission provenance plus cross-operation restart reconciliation',
} as const;

const TASK_ID = '901';
const TASK_SLUG = 'knowledge-promotion-fixture';
const TASK_TITLE = 'Knowledge promotion fixture';
const DOCUMENT_ID = 'doc-222222222222222222222222';
const CURRENT_TASK = 'docs/workflow/CURRENT_TASK.md';
const CONTRACTS = 'docs/workflow/CONTRACTS.md';
const DECISIONS = 'docs/workflow/DECISIONS.md';
const ARCHIVE = `TASKS/TASK-${TASK_ID}-${TASK_SLUG}.md`;
const temporaryRoots: string[] = [];

function runtimeState(overrides: Partial<RuntimeState> = {}): RuntimeState {
  return {
    schema_version: 1,
    kind: 'vnext-current-task-runtime-state',
    task_id: TASK_ID,
    task_slug: TASK_SLUG,
    workflow_status: 'active',
    lifecycle_state: 'active',
    resume_requires_review: false,
    resume_review_reasons: [],
    active_step_id: 'step-knowledge-promotion',
    active_step_status: 'completed',
    finding_queue_revision: 0,
    review_cycle: {
      id: 'review-cycle-knowledge-promotion',
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
    `- 任务标题：${TASK_TITLE}`,
    `- 任务 slug：${state.task_slug}`,
    `- 当前状态：${state.workflow_status}`,
    `- 生命周期状态：${state.lifecycle_state}`,
    `- 恢复需审查：${state.resume_requires_review ? 'true' : 'false'}`,
    `- 恢复审查原因：${state.resume_review_reasons.join(', ')}`,
    '',
    '## 背景与上下文',
    '',
    '- synthetic ordinary task whose stable architecture knowledge is admitted at close',
    '',
    '## 验收标准',
    '',
    '- [ ] terminal task and admitted knowledge remain durable after restart',
    '',
    '## 允许修改范围',
    '',
    '### Allowed Files',
    '',
    '- src/synthetic-login.ts',
    '',
    '### Conditional Files',
    '',
    '- docs/workflow/** when close-task reconciliation is authorized by the typed Runtime proposal',
    '',
    '## 禁止修改范围',
    '',
    '### Forbidden Files',
    '',
    '- .git/**',
    '',
    '## 受影响的契约',
    '',
    '- login boundary must retain its stable protocol obligation',
    '',
    '## 已确认决策',
    '',
    '- the synthetic login boundary remains owned by the existing Runtime entrypoint',
    '',
    '## 待确认问题',
    '',
    '- none',
    '',
    '## 实现方案',
    '',
    '- exercise close-task knowledge admission and typed Runtime promotion',
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
    `- ${state.active_step_id}: implement the synthetic knowledge promotion flow`,
    '',
    '## 回归检查项',
    '',
    '- [ ] verify canonical Contract/Decision records and replay',
    '',
    '## 回滚点',
    '',
    '- restore the synthetic fixture files if a typed transaction fails',
    '',
    '## 设计约束',
    '',
    '- no direct Markdown writer and no sync-state component',
    '',
    '## 发布后验证',
    '',
    '- reconstruct close-task admission from durable files',
    '',
    '## 执行记录',
    '',
    '- implementation step completed before closure',
    '',
  ].join('\n');
}

function contractsDocument(): string {
  return [
    '# CONTRACTS.md',
    '',
    '## 使用规则',
    '',
    '- Contracts are durable project invariants.',
    '',
    '## 一、接口契约',
    '',
    '- Existing interface obligations remain explicit.',
    '',
    '## 二、架构契约',
    '',
    '- Architecture boundaries are recorded with evidence.',
    '',
    '## 三、变更规则',
    '',
    '- Contract changes require typed admission.',
    '',
    '## 四、传播治理补充',
    '',
    '- Consumers validate current implementation references.',
    '',
    '## vNext Contract Records',
    '',
  ].join('\n');
}

function decisionsDocument(): string {
  return [
    '# DECISIONS.md',
    '',
    '## 使用规则',
    '',
    '- Decisions preserve confirmed technical choices.',
    '',
    '## 一、已确认决策',
    '',
    '- Confirmed decisions require explicit authority.',
    '',
    '## 二、已拒绝/不采用',
    '',
    '- Rejected alternatives remain historical context.',
    '',
    '## 三、待确认决策',
    '',
    '- none',
    '',
    '## 四、演进记录',
    '',
    '- Synthetic fixture baseline.',
    '',
    '## vNext Decision Records',
    '',
  ].join('\n');
}

function statusDocument(): string {
  return [
    '# STATUS.md',
    '',
    '## 项目概览',
    '',
    '- 项目：knowledge-promotion-fixture',
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
    '- knowledge promotion checkpoint',
    '',
    '## 最近更新记录',
    '',
    '- initial synthetic fixture',
    '',
  ].join('\n');
}

function lessonsDocument(): string {
  return [
    '# LESSONS.md',
    '',
    '## 使用规则',
    '',
    '- reusable lessons only',
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
  ].join('\n');
}

function createVirtualProject(state = runtimeState()): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-vnext-knowledge-promotion-'));
  temporaryRoots.push(root);
  fs.mkdirSync(path.join(root, '.workflow-system'), { recursive: true });
  fs.writeFileSync(path.join(root, '.workflow-system', 'PROJECT_PROFILE.yaml'), [
    'schema_version: 1',
    '',
    'project:',
    '  name: knowledge-promotion-fixture',
    '  type: test',
    '',
    'paths:',
    '  workflow_home: docs/workflow',
    '',
  ].join('\n'), 'utf8');

  const workflowRoot = path.join(root, 'docs', 'workflow');
  fs.mkdirSync(workflowRoot, { recursive: true });
  fs.writeFileSync(
    path.join(root, CURRENT_TASK),
    `---\n${stringify({
      schema_version: 1,
      kind: 'vnext-current-task',
      document_id: DOCUMENT_ID,
      runtime_state: state,
    }).trimEnd()}\n---\n${currentTaskBody(state)}`,
    'utf8',
  );
  fs.writeFileSync(path.join(root, CONTRACTS), contractsDocument(), 'utf8');
  fs.writeFileSync(path.join(root, DECISIONS), decisionsDocument(), 'utf8');
  fs.writeFileSync(path.join(root, 'docs/workflow/STATUS.md'), statusDocument(), 'utf8');
  fs.writeFileSync(path.join(root, 'docs/workflow/LESSONS.md'), lessonsDocument(), 'utf8');
  fs.mkdirSync(path.join(root, 'TASKS'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/synthetic-login.ts'), 'export function syntheticLogin() { return true; }\n', 'utf8');
  return root;
}

function authority(...kinds: AuthorityEvidence['kind'][]): AuthorityEvidence[] {
  return kinds.map(kind => ({
    kind,
    source: CURRENT_TASK,
    subject: TASK_ID,
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
    goal: 'promote stable knowledge from the synthetic task',
    actual_changes: ['completed the synthetic login boundary'],
    verification: ['typed knowledge promotion transaction coverage'],
    release_evidence: [],
    rollback_evidence: [],
    observation_evidence: [],
    next_action: 'consume Contract and Decision anchors through live search',
  };
}

function anchorRevision(root: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'src/synthetic-login.ts'))).digest('hex');
}

function candidate(
  root: string,
  kind: 'contract' | 'decision',
  candidateId: string,
  statement: string,
  options: { anchor?: boolean; supersedes?: string | null } = {},
): KnowledgeCandidate {
  const evidenceRef = `knowledge:evidence:${candidateId}`;
  const applicability = {
    projectTypes: ['test'],
    pathsSymbolsOrSurfaces: ['src/synthetic-login.ts', 'syntheticLogin'],
    triggerConditions: ['the synthetic login boundary changes'],
  };
  return {
    candidateId,
    kind,
    fingerprint: fingerprintKnowledgeStatement(kind, statement, applicability),
    statement,
    sourceRefs: [{ locator: 'src/synthetic-login.ts#syntheticLogin', revision: 'fixture-source-observation-r1' }],
    applicability,
    authoritySource: kind === 'decision' ? 'user' : 'verified-evidence',
    stability: 'stable',
    evidenceRefs: [evidenceRef],
    noveltyAgainst: [],
    conflictSet: [],
    supersedes: options.supersedes ?? null,
    reviewOrExpiryTrigger: null,
    expectedConsumers: ['project-context-resolver'],
    ...(kind === 'decision' ? {
      decisionContext: {
        alternatives: ['replace the existing boundary with a separate storage layer'],
        constraints: ['preserve the current project-local Runtime boundary'],
      },
    } : {}),
    ...(options.anchor ? {
      implementation_anchors: {
        coverage: 'observed' as const,
        source_revision: anchorRevision(root),
        anchors: [{
          path: 'src/synthetic-login.ts',
          symbol: 'syntheticLogin',
          role: 'primary implementation',
          evidence_refs: [evidenceRef],
        }],
      },
    } : {}),
  };
}

function admission(candidateValue: KnowledgeCandidate, disposition: KnowledgeAdmissionRecord['disposition'] = 'admit', matched: string | null = null): KnowledgeAdmissionRecord {
  return {
    candidate: candidateValue,
    disposition,
    matched_knowledge_id: matched,
    reasons: [`${disposition} was selected by the close-task knowledge-admission policy`],
  };
}

function knowledgeEvidence(admissions: KnowledgeAdmissionBundle): string[] {
  return [
    ...admissions.contracts,
    ...admissions.decisions,
  ].flatMap(item => [
    ...item.candidate.evidenceRefs,
    ...(item.candidate.implementation_anchors?.anchors.flatMap(anchorValue => anchorValue.evidence_refs) ?? []),
  ]);
}

function archiveDelta(knowledgeAdmissions: KnowledgeAdmissionBundle): ArchiveDelta {
  return {
    kind: 'archive',
    action: 'archive',
    closure_evidence: closureEvidence(),
    delivery_summary: deliverySummary(),
    remaining_risks: [],
    lesson_admission: { decision: 'defer', candidate_refs: [], evidence_refs: [] },
    knowledge_admissions: knowledgeAdmissions,
    evidence_refs: [...new Set(['knowledge:evidence:closure', ...knowledgeEvidence(knowledgeAdmissions)])],
  };
}

function archiveProposal(root: string, delta: ArchiveDelta, idempotencyKey = 'knowledge-promotion-archive'): RuntimeProposal {
  return createArchiveProposal(readCanonicalCurrentTask(root), {
    delta,
    idempotency_key: idempotencyKey,
    authority_evidence: authority('active-task-owner', 'evidence-admission'),
    evidence_refs: delta.evidence_refs,
  });
}

function promoteContract(root: string, record: KnowledgeAdmissionRecord, idempotencyKey: string): RuntimeProposal {
  const current = readCanonicalCurrentTask(root);
  const evidenceRefs = [...new Set([
    ...record.candidate.evidenceRefs,
    ...(record.candidate.implementation_anchors?.anchors.flatMap(anchorValue => anchorValue.evidence_refs) ?? []),
  ])];
  return createContractCandidateProposal(current, {
    admission: record,
    provenance: knowledgeProvenanceFromArchive(root, current, evidenceRefs),
    idempotency_key: idempotencyKey,
    authority_evidence: authority('evidence-admission'),
    evidence_refs: evidenceRefs,
  });
}

function promoteDecision(root: string, record: KnowledgeAdmissionRecord, idempotencyKey: string): RuntimeProposal {
  const current = readCanonicalCurrentTask(root);
  const evidenceRefs = [...new Set([
    ...record.candidate.evidenceRefs,
    ...(record.candidate.implementation_anchors?.anchors.flatMap(anchorValue => anchorValue.evidence_refs) ?? []),
  ])];
  return createDecisionRecordProposal(current, {
    admission: record,
    provenance: knowledgeProvenanceFromArchive(root, current, evidenceRefs),
    idempotency_key: idempotencyKey,
    authority_evidence: authority('evidence-admission'),
    evidence_refs: evidenceRefs,
  });
}

function bytes(root: string, relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function hash(root: string, relativePath: string): string {
  return crypto.createHash('sha256').update(bytes(root, relativePath)).digest('hex');
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('vNext close-task knowledge promotion', () => {
  test('P-12 admission is specific to the close-task promotion gap', () => {
    expect(P12_CLOSE_KNOWLEDGE_ADMISSION.decision).toBe('admitted');
    expect(P12_CLOSE_KNOWLEDGE_ADMISSION.basis).toBe('critical-invariant');
    expect(P12_CLOSE_KNOWLEDGE_ADMISSION.existingEvidenceInsufficiency).toContain('restart');
  });

  test('admitted Contract and Decision candidates are archived then promoted with observed anchors', () => {
    const root = createVirtualProject();
    const contract = admission(candidate(root, 'contract', 'contract-login-boundary', 'The login boundary must preserve its authenticated request protocol.', { anchor: true }));
    const decision = admission(candidate(root, 'decision', 'decision-login-runtime', 'The login boundary remains owned by the existing project-local Runtime.', { anchor: true }));
    const delta = archiveDelta({ contracts: [contract], decisions: [decision] });
    const beforeCurrent = bytes(root, CURRENT_TASK);
    const archived = applyVNextRuntimeProposal(root, archiveProposal(root, delta));

    expect(archived.status).toBe('success');
    expect(archived.committed).toBe(true);
    expect(archived.read_back_verified).toBe(true);
    expect(bytes(root, CURRENT_TASK)).not.toBe(beforeCurrent);
    expect(readCanonicalCurrentTask(root).runtimeState.workflow_status).toBe('closed');
    expect(bytes(root, ARCHIVE)).toContain('## 知识晋升');
    expect(bytes(root, ARCHIVE)).toContain('contract-login-boundary');
    expect(bytes(root, ARCHIVE)).toContain('decision-login-runtime');

    const contractResult = applyVNextRuntimeProposal(root, promoteContract(root, contract, 'knowledge-contract-login'));
    const decisionResult = applyVNextRuntimeProposal(root, promoteDecision(root, decision, 'knowledge-decision-login'));
    expect(contractResult.status).toBe('success');
    expect(contractResult.committed).toBe(true);
    expect(decisionResult.status).toBe('success');
    expect(decisionResult.committed).toBe(true);

    const contractRecords = readDurableKnowledgeRecords(bytes(root, CONTRACTS), CONTRACTS, 'contract');
    const decisionRecords = readDurableKnowledgeRecords(bytes(root, DECISIONS), DECISIONS, 'decision');
    expect(contractRecords).toHaveLength(1);
    expect(decisionRecords).toHaveLength(1);
    expect(contractRecords[0]?.candidate.implementation_anchors?.anchors[0]?.symbol).toBe('syntheticLogin');
    expect(decisionRecords[0]?.candidate.implementation_anchors?.coverage).toBe('observed');
  });

  test('allows an explicit empty anchor set and a comparable workspace revision', () => {
    const root = createVirtualProject();
    const contract = admission({
      ...candidate(root, 'contract', 'contract-no-anchors', 'The boundary remains durable without a known code locator.'),
      implementation_anchors: {
        coverage: 'observed',
        source_revision: 'workspace/main@fixture-r1',
        anchors: [],
      },
    });
    expect(applyVNextRuntimeProposal(root, archiveProposal(root, archiveDelta({ contracts: [contract], decisions: [] }))).status).toBe('success');
    expect(applyVNextRuntimeProposal(root, promoteContract(root, contract, 'contract-no-anchors-promotion')).status).toBe('success');
    expect(readDurableKnowledgeRecords(bytes(root, CONTRACTS), CONTRACTS, 'contract')[0]?.candidate.implementation_anchors?.anchors).toEqual([]);
  });

  test('no candidate or task-local implementation detail produces no Contract/Decision write', () => {
    const root = createVirtualProject();
    const beforeContracts = bytes(root, CONTRACTS);
    const beforeDecisions = bytes(root, DECISIONS);
    const delta = archiveDelta({ contracts: [], decisions: [] });
    const result = applyVNextRuntimeProposal(root, archiveProposal(root, delta));

    expect(result.status).toBe('success');
    expect(bytes(root, CONTRACTS)).toBe(beforeContracts);
    expect(bytes(root, DECISIONS)).toBe(beforeDecisions);
    expect(readDurableKnowledgeRecords(beforeContracts, CONTRACTS, 'contract')).toHaveLength(0);
    expect(readDurableKnowledgeRecords(beforeDecisions, DECISIONS, 'decision')).toHaveLength(0);
  });

  test('restart reconstructs only the missing Decision and exact re-entry is a no-op', () => {
    const root = createVirtualProject();
    const contract = admission(candidate(root, 'contract', 'contract-reentry', 'The re-entry contract remains stable after archive.', { anchor: true }));
    const decision = admission(candidate(root, 'decision', 'decision-reentry', 'The re-entry choice remains project-local.', { anchor: true }));
    const delta = archiveDelta({ contracts: [contract], decisions: [decision] });
    const firstArchiveProposal = archiveProposal(root, delta);
    const firstArchiveJson = JSON.stringify(firstArchiveProposal);
    const archiveResult = applyVNextRuntimeProposal(root, firstArchiveProposal);
    expect(archiveResult.status).toBe('success');
    expect(applyVNextRuntimeProposal(root, promoteContract(root, contract, 'reentry-contract')) .status).toBe('success');

    const currentAfterInterruption = bytes(root, CURRENT_TASK);
    const archiveBeforeRestart = bytes(root, ARCHIVE);
    const contractBeforeRestart = bytes(root, CONTRACTS);
    const decisionBeforeRestart = bytes(root, DECISIONS);

    // Simulated process restart: reconstruct the source tuple, archive
    // provenance, and proposals from durable files rather than retained objects.
    const restartedCurrent = readCanonicalCurrentTask(root);
    const restartedArchiveAudit = restartedCurrent.runtimeState.execution_log.find((entry): entry is ArchiveAuditLogEntry =>
      'action' in entry && entry.action === 'archive',
    );
    expect(restartedArchiveAudit).toBeDefined();
    const restartedContract = restartedArchiveAudit!.knowledge_admissions.contracts[0]!;
    const restartedDecision = restartedArchiveAudit!.knowledge_admissions.decisions[0]!;
    const replayedArchive = applyVNextRuntimeProposal(root, JSON.parse(firstArchiveJson));
    const pendingDecision = applyVNextRuntimeProposal(root, promoteDecision(root, restartedDecision, 'reentry-decision'));
    const replayedContract = applyVNextRuntimeProposal(root, promoteContract(root, restartedContract, 'reentry-contract'));

    expect(restartedCurrent.runtimeState.workflow_status).toBe('closed');
    expect(replayedArchive.status).toBe('no-op');
    expect(replayedArchive.committed).toBe(false);
    expect(replayedArchive.read_back_verified).toBe(true);
    expect(pendingDecision.status).toBe('success');
    expect(pendingDecision.committed).toBe(true);
    expect(replayedContract.status).toBe('no-op');
    expect(replayedContract.read_back_verified).toBe(true);
    expect(bytes(root, CURRENT_TASK)).toBe(currentAfterInterruption);
    expect(bytes(root, ARCHIVE)).toBe(archiveBeforeRestart);
    expect(bytes(root, CONTRACTS)).toBe(contractBeforeRestart);
    expect(readDurableKnowledgeRecords(bytes(root, DECISIONS), DECISIONS, 'decision')).toHaveLength(1);
    expect(hash(root, ARCHIVE)).toBe(crypto.createHash('sha256').update(archiveBeforeRestart).digest('hex'));
  });

  test('equivalent semantic candidates deduplicate and merge/supersede require durable predecessors', () => {
    const root = createVirtualProject();
    const baseCandidate = candidate(root, 'contract', 'contract-base', 'The storage boundary remains explicit.', { anchor: true });
    const equivalentCandidate = candidate(root, 'contract', 'contract-equivalent', baseCandidate.statement, { anchor: true });
    const mergedCandidate = candidate(root, 'contract', 'contract-merged', 'The storage boundary remains explicit with a bounded adapter.', { anchor: true });
    const supersedingCandidate = candidate(root, 'contract', 'contract-successor', 'The storage boundary remains explicit with the accepted adapter.', { anchor: true, supersedes: baseCandidate.candidateId });
    const admissions = {
      contracts: [
        admission(baseCandidate),
        admission(equivalentCandidate),
        admission(mergedCandidate, 'merge', baseCandidate.candidateId),
        admission(supersedingCandidate, 'supersede', baseCandidate.candidateId),
      ],
      decisions: [],
    } satisfies KnowledgeAdmissionBundle;
    expect(applyVNextRuntimeProposal(root, archiveProposal(root, archiveDelta(admissions))).status).toBe('success');

    expect(applyVNextRuntimeProposal(root, promoteContract(root, admissions.contracts[0]!, 'base-contract')).status).toBe('success');
    const equivalent = applyVNextRuntimeProposal(root, promoteContract(root, admissions.contracts[1]!, 'equivalent-contract'));
    expect(equivalent.status).toBe('no-op');
    expect(applyVNextRuntimeProposal(root, promoteContract(root, admissions.contracts[2]!, 'merged-contract')).status).toBe('success');
    expect(applyVNextRuntimeProposal(root, promoteContract(root, admissions.contracts[3]!, 'successor-contract')).status).toBe('success');
    expect(readDurableKnowledgeRecords(bytes(root, CONTRACTS), CONTRACTS, 'contract')).toHaveLength(3);
  });

  test('identity/provenance and idempotency conflicts fail closed without overwrite', () => {
    const root = createVirtualProject();
    const original = admission(candidate(root, 'contract', 'contract-conflict', 'The original contract statement.', { anchor: true }));
    const otherTarget = admission(candidate(root, 'decision', 'decision-conflict', 'The other target decision.', { anchor: true }));
    const admissions = { contracts: [original], decisions: [otherTarget] } satisfies KnowledgeAdmissionBundle;
    expect(applyVNextRuntimeProposal(root, archiveProposal(root, archiveDelta(admissions))).status).toBe('success');
    expect(applyVNextRuntimeProposal(root, promoteContract(root, original, 'shared-idempotency')).status).toBe('success');
    const contractsBefore = bytes(root, CONTRACTS);
    const decisionsBefore = bytes(root, DECISIONS);

    const changedCandidate = candidate(root, 'contract', original.candidate.candidateId, 'A different semantic contract statement.', { anchor: true });
    const changedProposal = promoteContract(root, admission(changedCandidate), 'changed-proposal');
    const identityConflict = applyVNextRuntimeProposal(root, changedProposal);
    expect(identityConflict.status).toBe('blocked');
    expect(identityConflict.code).toBe('KNOWLEDGE_PROVENANCE_MISMATCH');
    expect(bytes(root, CONTRACTS)).toBe(contractsBefore);

    const idempotencyConflict = applyVNextRuntimeProposal(root, promoteDecision(root, otherTarget, 'shared-idempotency'));
    expect(idempotencyConflict.status).toBe('conflict');
    expect(idempotencyConflict.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(bytes(root, CONTRACTS)).toBe(contractsBefore);
    expect(bytes(root, DECISIONS)).toBe(decisionsBefore);
  });

  test('invalid or noncanonical implementation anchors are rejected before any write', () => {
    const root = createVirtualProject();
    const invalid = admission({
      ...candidate(root, 'contract', 'contract-invalid-anchor', 'The invalid anchor must never be persisted.'),
      implementation_anchors: {
        coverage: 'observed',
        source_revision: anchorRevision(root),
        anchors: [{
          path: '../src/synthetic-login.ts',
          symbol: 'syntheticLogin:10',
          role: 'guessed line anchor',
          evidence_refs: ['knowledge:evidence:contract-invalid-anchor'],
        }],
      },
    });
    expect(() => createContractCandidateProposal(readCanonicalCurrentTask(root), {
      admission: invalid,
      provenance: {
        task_id: TASK_ID,
        task_slug: TASK_SLUG,
        document_id: DOCUMENT_ID,
        archive_path: ARCHIVE,
        archive_revision: 'a'.repeat(64),
        source_revision: 'b'.repeat(64),
        evidence_refs: ['knowledge:evidence:contract-invalid-anchor'],
      },
      idempotency_key: 'invalid-anchor-proposal',
      authority_evidence: authority('evidence-admission'),
      evidence_refs: ['knowledge:evidence:contract-invalid-anchor'],
    })).toThrow(/RUNTIME_PATH_INVALID|IMPLEMENTATION_ANCHOR_INVALID/);
    expect(fs.existsSync(path.join(root, ARCHIVE))).toBe(false);
    expect(readDurableKnowledgeRecords(bytes(root, CONTRACTS), CONTRACTS, 'contract')).toHaveLength(0);
  });
});
