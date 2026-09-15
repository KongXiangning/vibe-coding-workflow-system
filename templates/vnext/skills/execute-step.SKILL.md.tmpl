---
name: execute-step
description: Implement exactly the confirmed current task step, then stop.
entry_contract:
  entry: execute-step
  mode:
    - default
    - repair
  intent: Implement exactly the confirmed current step.
  input_contract:
    required:
      - confirmed_current_task
    optional:
      - canonical_review_result
  authority_owner: task
  mutation_boundary:
    product_files:
      - admitted_scope
    governance_sources: []
    forbidden_targets:
      - files outside the current step mutation scope
      - persistent tests absent from the confirmed task
      - governance and installation surfaces
  internal_capabilities:
    - task-identity-guard
    - scope-guard
    - resume-review-gate
    - root-cause-loop
    - owner-route-resolver
  runtime_operations:
    - task-state-transaction
    - finding-queue-transaction
  stop_conditions:
    - Runtime does not expose one executable confirmed current step
    - Runtime blocks a candidate path, planned command, persistent test, or repair
    - a failed command or validation cannot be diagnosed and recovered within the current plan and bounded attempt budget
    - a Red result comes from syntax, import, fixture, tool, or environment failure rather than unimplemented behavior
    - Runtime rejects the submitted result or review receipt
  output_kind: change-result
---

# vNext Skill: execute-step

## Confirmed recovery execution

Only execute the active confirmed recovery step. For artifact-restore or mixed,
obtain ordinary preflight then call `apply-artifact-restore` with that receipt for
the declared `runtime:artifact-restore` footprint. Run post-restore checks, record
real outcomes, and complete required cumulative review. Never reset/clean/checkout
the repository or roll back governance records. Drift, missing checkpoints,
frozen files or retained publication journals are blockers. Read CONTEXT_API.md.
Runtime must persist `artifact-restore-completion/v1` for the exact candidate and
attempt. A passed command report cannot replace it. Keep restored paths at their
confirmed target images through result recording and reviewed completion; place
forward edits in a subsequent recovery step. Missing or changed completion facts
block successful advancement; actual failures can still be recorded truthfully.
After an environment retry, obtain fresh preflight and call apply-artifact-restore
again. Runtime may revalidate exact targets against the original immutable v1
fact and mint a new attempt-bound v2 fact. Run fresh checks and review; never
reuse the old receipt as proof of the new attempt. Recovery progress through raw
apply also requires the durable current admitted attempt and retained budget.

## Intent

Implement only the confirmed `CURRENT_TASK` step selected by Runtime. Do not redesign the task, widen scope, or implement a later step.

## Operating rules

Start with a fresh `validate --summary`, then follow **Bounded CURRENT_TASK
reading** in `.workflow-system/runtime/support/CONTEXT_API.md`. Read the full
definition range on first use. Reuse it only while it remains completely
visible in this conversation and task ID, document ID, and
non-null `evidence_plan_revision` still match the fresh summary; otherwise read it
again. Use the latest summary for status. Do not load the entire canonical
file just to recover its definition or treat earlier evidence as current.

Before implementation, follow **Project document navigation** in
`.workflow-system/runtime/support/CONTEXT_API.md` for the confirmed step's relevant
requirements, plan, design, Contracts, and Decisions. This reading does not reopen
the plan or widen its mutation scope. Read the saved `project_documents` and
`affected_contracts` using `validate --summary`, then their relevant body sections.
Apply **Project document conflicts** in that support file before preflight and
when contradictions emerge during execution; preserve existing explicit decisions.

1. If the confirmed current step is already blocked, inspect its retained failed attempt and apply **Same-plan blocked-step recovery** before ordinary preflight; do not ask the user to choose another Skill for a confirmed in-scope correction. Otherwise send intended changed paths, including every exact planned command write, to Runtime `preflight-step` on stdin. Runtime freezes their before-state and returns the frozen test-strategy mode, execution phase, required outcome, and Persistent Tests in the receipt. Use only the current step, planned commands, validation, and receipt it returns. If the task is unconfirmed, a resume gate is active, explicit prerequisite evidence is unsupported, or another preflight gate blocks, report that result and stop.
2. Modify only paths admitted for the current step. A persistent test may be created or changed only when it is already frozen in the confirmed task's `Persistent Tests`; do not admit another test during execution.
3. Obey the Runtime phase. `flexible` has no mandatory Red or tests-only first step; an admitted test may pass immediately. Use `outcome: implemented` only when planned results pass or explicitly match the admitted reproduction check. Explicit ordering requires Runtime-consumed before-step evidence; do not substitute flexible. Historical `outcome: test-red` and `status: expected-failure` remain readable. A new expected-failure result requires a new report submitted in this execution for its exact unconsumed before-step check constraining a later step. Historical reproduction reports cannot authorize later repair or delivery failures. Expected failure cannot satisfy positive acceptance. Syntax, type, import, fixture, tool, unrelated-test, and environment failures are not Red evidence; record actual failures as blocked before considering same-plan recovery.
4. Run only the current step's planned commands and validation. Do not substitute an unplanned write-capable command. If a command or validation fails, retain its real output, record the blocked result, and diagnose within the current owner and bounded investigation budget. A confirmed current-step code/test/fixture error may use **Same-plan blocked-step recovery** below without a separate public `debug-task` invocation or user route. Stop when the failure requires a changed goal, scope, acceptance, contract decision, external authority, or unavailable evidence.
5. When the canonical review result contains findings, ask Runtime `begin-repair` for the complete admitted finding set. Repair only those findings in one bounded wave and do not use repair as an opportunity for unrelated improvements.
6. Send declared actual changed paths, command results, validation results, and permitted acceptance evidence to Runtime `record-step-result` on stdin. Do not submit `outcome: test-red` without an admitted reproduction obligation (new executions use implemented and a bound expected-failure report). Runtime captures the after-state, derives the exact before/after delta, rejects a mismatched path declaration, and owns phase/order enforcement, scope re-checking, finding bookkeeping, proposal construction, state, read-back, and step advancement.
7. When the canonical review result is `clean`, call Runtime `complete-reviewed-step`; completion cannot add evidence, never supply or copy a review receipt, and do not edit product code again. Runtime retains the existing required review and repair verification gates.

If the fresh summary reports an unresolved evidence challenge, do not consume
the challenged old result. Only the confirmed correction step may run. Record a
new result ID for the exact challenged slot, then obtain a fresh clean review;
Runtime resolves the challenge on reviewed completion and advances to the
original pending step. Unaffected old reports may satisfy the new plan only
when Runtime supplies and rechecks an `evidence-carry-forward/v1` proof. A
previous before-step receipt or clean review cannot be copied to the correction.

## Required result

Return one structured `change-result` with the current step, Runtime-detected changed files, commands and validation run, evidence, Runtime result, and any blocker. A blocked `record-step-result` commit may be followed in this invocation only by bounded `retry-step`, fresh preflight, correction and rerun under the unchanged plan; no other public Skill is invoked. After an implemented/completed result, stop.

Only when Runtime reports successful step completion, return `next_route: git-commit` and a `commit_scope` containing the Runtime-detected changed files plus Runtime-written workflow paths. This is a recommendation for the user—or an explicitly configured outer orchestrator—to invoke later; neither execute-step nor Runtime invokes it. Otherwise recommend the appropriate review or blocker route. This invocation must not invoke another public Skill or start the next step.

terminal_boundary: public-entry-terminal/v1

## Slot reports and prerequisite consumption

Submit acceptance_evidence by claim_id + slot_id + check_id + minimum_type, with
disposition, retained evidence_refs and a structured report: result_id, status,
evidence_plan_revision, subject_revision, actual_method, environment, assurance.
After executing the check, send `{}` to Runtime `evidence-context` on stdin.
Use its evidence_plan_revision and the matching claim/slot/check's subject_revision.
This read-only snapshot grants no execution authority and proves no check ran.
Do not copy another slot's identity or report, or refresh a stale report without rerunning its check.
A rule pass cannot satisfy a flow slot. Failed, blocked, not-run, skipped and missing
slots cannot complete their due step or close the task. Static evidence uses
accepted, without invented exit codes. Human evidence remains blocked without an
authenticated channel. Assurance remains caller-reported even when input says trusted.
Preserve the shared transaction output `evidence_assurance: caller-reported` in
user-facing summaries; a successful state write is not independent execution proof.

Preflight may atomically register an approved prerequisite before editing; use the
returned source revision. It must not clear pending review, findings or budgets.
When review is pending, report its consumer route and stop. Never forge or replace
a prerequisite_receipt; after consumption its historical snapshot and report are
immutable, while positive current evidence must reflect the repaired objects.


## Cumulative review boundary

Preflight records bounded first-touch content and approved prerequisites; preserve
its returned revision. A not-required step still submits actual execution and
all due evidence. Its changes remain pending for the next checkpoint. Do not
refresh a stale baseline or use Git HEAD as the task's dirty before-state. Review
uses the cumulative target, while actual_changed_paths describes this invocation.
Repair paths require existing scope and a registered before-state; missing scope
or baseline must be routed explicitly, never expanded by the reviewer. Clean
completion or a confirmed final cumulative exemption consumes pending coverage;
repair requires a separate verification review even on an exempt step.


## Same-plan blocked-step recovery

For an ordinary execution stopped by a known temporary environment prerequisite,
record outcome=blocked and blocker_kind=environment when the affected result is
blocked and no business check reported failed. Declare all prior admitted writes;
Runtime retains them and requires subjects to remain unchanged since the failure.
Keep failed/unknown causes truthful. Diagnose a failure in this execution when
the original request authorizes implementation and the correction remains in
the confirmed current step. Do not invent a review finding to unlock recovery.
When diagnosis needs a separate investigation turn, `debug-task` may investigate
but cannot itself grant execution permission. A later caller invocation must
recheck Runtime state, retry eligibility, preflight, scope, and due evidence;
the diagnostic result alone cannot resume execution.

For an environment blocker, send Runtime `retry-step` the exact step_id,
durable blocked_attempt_id, blocker_resolution_refs, and stable idempotency_key
after obtaining concrete resolution evidence. Use the FILE_SCHEMAS-bound
environment-restored/v1 JSON report format. A generic note cannot discharge
the blocker.

For a failed command or validation with a confirmed current-step code, test, or
fixture cause, send the same `retry-step` with `repair_diagnosis` containing
`kind: same-plan-repair/v1`, `status: confirmed`, `owner: current-step`, the exact
`failed_check`, a concise `cause`, and non-empty exact `repair_paths`. These paths
must be a subset of the failed preflight's candidate paths. In the existing
`blocker_resolution_refs` field cite the retained failed-check evidence, not a
fabricated resolution report. The diagnosis is caller-reported and Runtime
retains it in the new attempt; it grants only a fresh preflight, not a pass.
No new project file is needed solely to carry the diagnosis.

Runtime permits initial execution plus at most two retries, preserving failures
and recovery evidence beyond rolling logs. A successful retry only sets ready.
Obtain a fresh preflight before any correction, then rerun the failed check and
all due validation/evidence in the same execution intent when time and authority
permit; otherwise report the ready state for continuation. Do not reuse old
receipts, checks or scope, claim completed, or invoke another public Skill.
No server restart, DB reset, or cleanup is implied. When blocked by diagnosis,
findings, object drift, or budget, report the exact reason and permitted route.
Do not route a confirmed same-scope test typo to `supersede`; that transition
requires an invalidated goal, scope, or acceptance.
