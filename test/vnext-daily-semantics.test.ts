import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { stringify } from 'yaml';
import {
  applyVNextRuntimeProposal,
  createFindingQueueProposal,
  createTaskStateProposal,
  previewCloseTask,
  readCanonicalCurrentTask,
  type ArchiveDelta,
  type AuthorityEvidence,
  type FindingQueueDelta,
  type RuntimeProposal,
  type RuntimeState,
  type StepReviewReceipt,
} from '../scripts/vnext-runtime';

// P-12 admission for this persistent Runtime behavior guard:
// the frozen multi-step/checkpoint/repair invariant is not covered by the
// existing single-step progress and isolated finding-budget tests.
const P12_DAILY_SEMANTICS_TEST_ADMISSION = {
  decision: 'admitted',
  owner: 'workflow-system maintainers',
  basis: 'critical-invariant',
  proves: 'durable multi-step advancement cannot bypass required review or repair verification',
  existingEvidenceInsufficiency: 'existing Runtime tests cover single-step progress and isolated repair budgets, not their ordered combination',
  assertionBoundary: 'vNext Runtime task-state transaction and canonical CURRENT_TASK read-back',
  failureDisposition: 'block the Phase 2 daily-execution quality gate until the frozen advancement boundary is restored',
} as const;

const temporaryRoots: string[] = [];

function state(overrides: Partial<RuntimeState> = {}): RuntimeState {
  return {
    schema_version: 1,
    kind: 'vnext-current-task-runtime-state',
    task_id: '010',
    task_slug: 'daily-semantics-fixture',
    workflow_status: 'active',
    lifecycle_state: 'active',
    resume_requires_review: false,
    resume_review_reasons: [],
    active_step_id: 'step-1',
    active_step_status: 'ready',
    finding_queue_revision: 0,
    review_cycle: {
      id: 'review-cycle-0',
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

function body(): string {
  return [
    '# vNext CURRENT_TASK',
    '',
    '## 任务信息',
    '',
    '- 任务 ID：010',
    '- 任务标题：Daily semantics fixture',
    '- 任务 slug：daily-semantics-fixture',
    '- 当前状态：active',
    '- 生命周期状态：active',
    '- 恢复需审查：false',
    '- 恢复审查原因：',
    '',
    '## 允许修改范围',
    '',
    '### Allowed Files',
    '',
    '- scripts/**',
    '',
    '### Conditional Files',
    '',
    '- docs/** when evidence is present',
    '',
    '## 禁止修改范围',
    '',
    '### Forbidden Files',
    '',
    '- .git/**',
    '',
    '## 实施步骤',
    '',
    '- step-1: implement the low-risk preparation',
    '  - Purpose: establish the first bounded change',
    '  - Mutation scope: scripts/step-1.ts',
    '  - Required evidence: existing focused validation',
    '  - Review checkpoint: not-required',
    '',
    '- step-2: implement the contract boundary',
    '  - Purpose: change the shared contract safely',
    '  - Mutation scope: scripts/step-2.ts',
    '  - Required evidence: focused contract validation',
    '  - Review checkpoint: required: contract boundary',
    '',
    '- step-3: finish the remaining bounded work',
    '  - Purpose: complete the task after the checkpoint',
    '  - Mutation scope: scripts/step-3.ts',
    '  - Required evidence: existing regression validation',
    '  - Review checkpoint: not-required',
    '',
    '## 执行记录',
    '',
    '- historical execution record',
    '',
  ].join('\n');
}

function makeRoot(initial: RuntimeState = state()): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-vnext-daily-semantics-'));
  temporaryRoots.push(root);
  fs.mkdirSync(path.join(root, '.workflow-system'), { recursive: true });
  fs.writeFileSync(path.join(root, '.workflow-system', 'PROJECT_PROFILE.yaml'), [
    'schema_version: 1',
    '',
    'project:',
    '  name: daily-semantics-fixture',
    '  type: test',
    '',
    'paths:',
    '  workflow_home: docs/workflow',
    '',
  ].join('\n'), 'utf8');
  const currentTaskPath = path.join(root, 'docs', 'workflow', 'CURRENT_TASK.md');
  fs.mkdirSync(path.dirname(currentTaskPath), { recursive: true });
  fs.writeFileSync(currentTaskPath, `---\n${stringify({
    schema_version: 1,
    kind: 'vnext-current-task',
    document_id: 'doc-000000000000000000000000',
    runtime_state: initial,
  }).trimEnd()}\n---\n${body()}`, 'utf8');
  return root;
}

function authority(...kinds: AuthorityEvidence['kind'][]): AuthorityEvidence[] {
  return kinds.map(kind => ({
    kind,
    source: 'docs/workflow/CURRENT_TASK.md',
    subject: '010',
  }));
}

function stepProposal(root: string, input: Partial<Parameters<typeof createTaskStateProposal>[1]> = {}): RuntimeProposal {
  const current = readCanonicalCurrentTask(root);
  return createTaskStateProposal(current, {
    mode: 'default',
    status: 'completed',
    evidence_refs: ['evidence:step'],
    idempotency_key: `step-${current.runtimeState.active_step_id}-complete`,
    authority_evidence: authority('active-task-owner', 'scope-admission', 'evidence-admission'),
    ...input,
  });
}

function finding(fingerprint = 'finding-contract', reviewCycleId = 'review-cycle-1'): FindingQueueDelta {
  return {
    kind: 'finding-queue',
    action: 'admit',
    cycle_phase: 'discovery',
    finding_admission_wave_id: 'finding-admission-wave-1',
    finding: {
      fingerprint,
      category: 'correctness',
      owner_task_id: '010',
      scope: 'admitted',
      decision: 'mechanical',
      file: 'scripts/step-2.ts',
      failure_condition: 'the contract boundary is inconsistent',
      violated_invariant: 'INV-DAILY-001',
      root_cause_status: 'confirmed',
      max_repair_attempts: 2,
      evidence_refs: ['evidence:finding'],
      review_cycle_id: reviewCycleId,
    },
  };
}

function findingProposal(root: string, delta: FindingQueueDelta, idempotencyKey: string): RuntimeProposal {
  const current = readCanonicalCurrentTask(root);
  const evidenceRefs = delta.action === 'admit' ? delta.finding.evidence_refs : delta.evidence_refs;
  return createFindingQueueProposal(current, {
    mode: 'repair',
    delta,
    idempotency_key: idempotencyKey,
    authority_evidence: authority('active-task-owner', 'scope-admission', 'finding-admission', 'evidence-admission'),
    evidence_refs: evidenceRefs,
  });
}

function reviewReceipt(overrides: Partial<StepReviewReceipt> = {}): StepReviewReceipt {
  return {
    cycle_id: 'review-cycle-0',
    cycle_phase: 'discovery',
    diff_target: 'HEAD~1..HEAD',
    diff_target_verification: 'verified',
    verdict: 'clean',
    admitted_fingerprints: [],
    evidence_refs: ['evidence:review'],
    ...overrides,
  };
}

function archiveDelta(): ArchiveDelta {
  return {
    kind: 'archive',
    action: 'archive',
    closure_evidence: {
      acceptance_satisfied: true,
      validation_complete: true,
      no_admitted_or_in_progress_findings: true,
      no_unresolved_closure_blocker: true,
      release_evidence: { triggered: false, complete: false, evidence_refs: [] },
      rollback_evidence: { triggered: false, complete: false, evidence_refs: [] },
      observation_evidence: { triggered: false, complete: false, evidence_refs: [] },
      remaining_risks_non_blocking: true,
      archive_path_verified: true,
    },
    delivery_summary: {
      goal: 'complete the daily semantics fixture',
      actual_changes: ['completed all admitted steps'],
      verification: ['Runtime daily semantics test passed'],
      release_evidence: [],
      rollback_evidence: [],
      observation_evidence: [],
      next_action: 'observe the completed task',
    },
    remaining_risks: ['none beyond the completed fixture'],
    lesson_admission: { decision: 'defer', candidate_refs: [], evidence_refs: [] },
    evidence_refs: ['evidence:closure'],
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('vNext Core Daily Execution Semantics', () => {
  test('records the admitted persistent test at the behavioral Runtime boundary', () => {
    expect(P12_DAILY_SEMANTICS_TEST_ADMISSION).toMatchObject({
      decision: 'admitted',
      basis: 'critical-invariant',
      assertionBoundary: 'vNext Runtime task-state transaction and canonical CURRENT_TASK read-back',
    });
  });

  test('advances low-risk steps, blocks a required checkpoint bypass, then completes the remaining steps', () => {
    const root = makeRoot();

    const first = applyVNextRuntimeProposal(root, stepProposal(root, {
      idempotency_key: 'daily-step-1-complete',
      evidence_refs: ['evidence:step-1'],
    }));
    expect(first.status).toBe('success');
    expect(first.advancement).toMatchObject({ outcome: 'advanced', from_step_id: 'step-1', to_step_id: 'step-2' });
    expect(readCanonicalCurrentTask(root).runtimeState).toMatchObject({ active_step_id: 'step-2', active_step_status: 'ready' });

    const bypass = applyVNextRuntimeProposal(root, stepProposal(root, {
      idempotency_key: 'daily-step-2-bypass',
      evidence_refs: ['evidence:step-2-bypass'],
    }));
    expect(bypass.status).toBe('blocked');
    expect(bypass.code).toBe('REVIEW_CHECKPOINT_REQUIRED');
    expect(readCanonicalCurrentTask(root).runtimeState.active_step_id).toBe('step-2');

    const started = applyVNextRuntimeProposal(root, stepProposal(root, {
      status: 'in-progress',
      idempotency_key: 'daily-step-2-start',
      evidence_refs: ['evidence:step-2-start'],
    }));
    expect(started.status).toBe('success');
    expect(started.advancement?.outcome).toBe('not-applicable');

    const checkpoint = reviewReceipt({
      evidence_refs: ['evidence:step-2-review'],
    });
    const second = applyVNextRuntimeProposal(root, stepProposal(root, {
      idempotency_key: 'daily-step-2-complete',
      evidence_refs: ['evidence:step-2', 'evidence:step-2-review'],
      diff_target: checkpoint.diff_target,
      review_receipt: checkpoint,
    }));
    expect(second.status).toBe('success');
    expect(second.advancement).toMatchObject({ outcome: 'advanced', from_step_id: 'step-2', to_step_id: 'step-3', review_phase: 'discovery' });

    const final = applyVNextRuntimeProposal(root, stepProposal(root, {
      idempotency_key: 'daily-step-3-complete',
      evidence_refs: ['evidence:step-3'],
    }));
    expect(final.status).toBe('success');
    expect(final.advancement).toMatchObject({ outcome: 'task-complete', from_step_id: 'step-3', to_step_id: null });
    expect(readCanonicalCurrentTask(root).runtimeState.active_step_status).toBe('completed');
    expect(previewCloseTask(root, archiveDelta()).closure_eligibility.eligible).toBe(true);
  });

  test('routes repair through the same step, requires verification, and re-enters advancement only on the same diff', () => {
    const root = makeRoot();
    expect(applyVNextRuntimeProposal(root, stepProposal(root, {
      status: 'in-progress',
      idempotency_key: 'repair-step-2-start',
      evidence_refs: ['evidence:repair-start'],
    })).status).toBe('success');

    expect(applyVNextRuntimeProposal(root, findingProposal(root, finding(), 'repair-finding-admit')).status).toBe('success');
    expect(applyVNextRuntimeProposal(root, findingProposal(root, {
      kind: 'finding-queue',
      action: 'record-repair-attempt',
      fingerprint: 'finding-contract',
      review_cycle_id: 'review-cycle-1',
      repair_wave_id: 'repair-wave-1',
      evidence_refs: ['evidence:repair-attempt'],
    }, 'repair-finding-attempt')).status).toBe('success');

    const repair = applyVNextRuntimeProposal(root, stepProposal(root, {
      mode: 'repair',
      status: 'completed',
      idempotency_key: 'repair-step-2-complete',
      evidence_refs: ['evidence:repair-complete'],
      repair_fingerprint: 'finding-contract',
      diff_target: 'HEAD~1..HEAD',
    }));
    expect(repair.status).toBe('success');
    expect(repair.advancement?.outcome).toBe('repair-awaiting-verification');

    const unresolvedBypass = applyVNextRuntimeProposal(root, stepProposal(root, {
      idempotency_key: 'repair-step-2-bypass-open-finding',
      evidence_refs: ['evidence:repair-bypass'],
    }));
    expect(unresolvedBypass.status).toBe('blocked');
    expect(unresolvedBypass.code).toBe('REVIEW_CONVERGENCE_REQUIRED');

    expect(applyVNextRuntimeProposal(root, findingProposal(root, {
      kind: 'finding-queue',
      action: 'resolve',
      fingerprint: 'finding-contract',
      evidence_refs: ['evidence:finding-resolved'],
    }, 'repair-finding-resolve')).status).toBe('success');

    const wrongPhase = reviewReceipt({
      cycle_id: 'review-cycle-1',
      cycle_phase: 'discovery',
      admitted_fingerprints: [],
      evidence_refs: ['evidence:wrong-phase'],
    });
    const wrongPhaseResult = applyVNextRuntimeProposal(root, stepProposal(root, {
      idempotency_key: 'repair-step-2-wrong-phase',
      evidence_refs: ['evidence:wrong-phase'],
      diff_target: wrongPhase.diff_target,
      review_receipt: wrongPhase,
    }));
    expect(wrongPhaseResult.status).toBe('blocked');
    expect(wrongPhaseResult.code).toBe('REVIEW_VERIFICATION_REQUIRED');

    const verification = reviewReceipt({
      cycle_id: 'review-cycle-1',
      cycle_phase: 'verification',
      admitted_fingerprints: ['finding-contract'],
      evidence_refs: ['evidence:verification'],
    });
    const verified = applyVNextRuntimeProposal(root, stepProposal(root, {
      idempotency_key: 'repair-step-2-verified',
      evidence_refs: ['evidence:repair-final', 'evidence:verification'],
      diff_target: verification.diff_target,
      review_receipt: verification,
    }));
    expect(verified.status).toBe('success');
    expect(verified.advancement).toMatchObject({ outcome: 'advanced', from_step_id: 'step-1', to_step_id: 'step-2', review_phase: 'verification' });
    const after = readCanonicalCurrentTask(root).runtimeState;
    expect(after.active_step_id).toBe('step-2');
    expect(after.findings.find(item => item.fingerprint === 'finding-contract')?.status).toBe('resolved');
    expect(after.execution_log).toEqual(expect.arrayContaining([
      expect.objectContaining({ idempotency_key: 'repair-step-2-complete', advancement: 'repair-awaiting-verification' }),
      expect.objectContaining({ idempotency_key: 'repair-step-2-verified', advancement: 'advanced', review_receipt: verification }),
    ]));
  });

  test('fails closed when a multi-step definition loses checkpoint metadata', () => {
    const root = makeRoot();
    const proposal = stepProposal(root, {
      idempotency_key: 'daily-malformed-step-definition',
      evidence_refs: ['evidence:malformed-step'],
    });
    const current = readCanonicalCurrentTask(root);
    fs.writeFileSync(current.filePath, current.raw.replace('  - Required evidence: existing regression validation\n', ''), 'utf8');

    const blocked = applyVNextRuntimeProposal(root, proposal);
    expect(blocked.status).toBe('blocked');
    expect(blocked.code).toBe('TASK_STEPS_INVALID');
  });

  test('keeps advancement idempotent and rejects a cross-step proposal', () => {
    const root = makeRoot();
    const proposal = stepProposal(root, {
      idempotency_key: 'daily-idempotent-advance',
      evidence_refs: ['evidence:idempotent'],
    });
    expect(applyVNextRuntimeProposal(root, proposal).status).toBe('success');
    const replay = applyVNextRuntimeProposal(root, proposal);
    expect(replay.status).toBe('no-op');
    expect(readCanonicalCurrentTask(root).runtimeState.execution_log.filter(item => !('action' in item))).toHaveLength(1);

    const current = readCanonicalCurrentTask(root);
    const crossStep = {
      ...stepProposal(root, {
        idempotency_key: 'daily-cross-step',
        evidence_refs: ['evidence:cross-step'],
      }),
      semantic_delta: {
        kind: 'task-state' as const,
        action: 'step-progress' as const,
        step_id: 'step-1',
        status: 'completed' as const,
        evidence_refs: ['evidence:cross-step'],
      },
      source_tuple: current.sourceTuple,
    };
    const blocked = applyVNextRuntimeProposal(root, crossStep);
    expect(blocked.status).toBe('blocked');
    expect(blocked.code).toBe('ACTIVE_STEP_CONFLICT');
  });
});
