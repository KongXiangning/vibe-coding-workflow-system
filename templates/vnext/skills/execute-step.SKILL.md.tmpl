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
      - v2 files outside the task authority envelope
      - v1 files outside the current step mutation scope
      - v2 in-envelope unplanned files without a blast-radius assessment and self-admit disposition
      - persistent tests absent from the confirmed task
      - governance and installation surfaces
  internal_capabilities:
    - task-identity-guard
    - scope-guard
    - mutation-authority-policy
    - resume-review-gate
    - root-cause-loop
    - owner-route-resolver
  runtime_operations:
    - task-state-transaction
    - finding-queue-transaction
    - user-decision-transaction
  # Candidate interruptions: apply run-entry internal recovery before any terminal result.
  stop_conditions:
    - Runtime does not expose one executable confirmed current step
    - a candidate path, planned command, persistent test, or repair cannot be admitted through the current authorization and available internal recovery operations
    - a failed command or validation cannot be diagnosed and recovered within the current authorized plan
    - a Red result comes from syntax, import, fixture, tool, or environment failure rather than unimplemented behavior
    - after read-back and supported internal recovery, a required external fact, genuinely new user choice, or unrecoverable integrity conflict still prevents a truthful result
  output_kind: change-result
---

# vNext Skill: execute-step

## Invocation authority and internal recovery

recovery_boundary: entry-recovery/v1

The caller's explicit invocation authorizes this entry's stated intent and its
necessary internal recovery within the existing authority. This entry owns that
recovery until its requested result is produced or a genuinely undecidable choice
requires the caller. A Runtime rejection interrupts a candidate operation; it is
not, by itself, a terminal Skill result, even when listed under stop_conditions.

Read retained state and the rejection, correct stale identity or request shape,
then use typed diagnostic, review-consumption, preflight, retry or amendment
operations as needed and resume the original intent. Calling an internal capability
does not require the user to invoke another public Skill. Do not repeat an unchanged
rejected request. Preserve failed evidence, findings and disposition history.

Attempt and repair quotas are analysis checkpoints. Inspect previous failures,
reassess the cause, necessity and next approach, and record the analysis. When the
existing explicit instruction covers continuation, use its original source/text
for the supported continuation or budget-extension transaction and proceed; do not
ask for renewed authorization merely because a counter is exhausted. Keep the
analysis distinct from the user's words and retain cumulative attempt counts.
Do not invent risk acceptance, a waiver, or permission beyond that instruction.
Ask only for a choice or authority that cannot be determined from the instruction
and available evidence; report the concrete unresolved choice, not just a gate code.

A read-only, review-only or investigate-only entry completes with its requested
facts/verdict; recovery does not authorize unrelated implementation. For actual
unavailable dependencies or damaged state, attempt the supported recovery first,
then report the precise external prerequisite if it cannot be restored internally.
Never fabricate success or bypass an incomplete atomic commit.

### Shared internal recovery driver

Use Runtime `run-entry --root <project>` for Runtime operations in this entry.
Send `invocation` (stable `id`, this public `entry`, requested `intent`, original
`decision_source` and verbatim `decision_text`) and `operation` (`command`,
optional `args`, semantic JSON `input`). Keep this invocation identity throughout
internal recovery. The driver executes existing typed Runtime commands, not public
Skills or product shell commands. Read-only context reads may still be direct.

The driver returns a compact summary and `outcome_ref` / `detail_ref`. Read needed
full receipts with Runtime `entry-output-read`, supplying the returned `reference`,
`offset: 0` and `max_bytes: 8192`; follow `next_offset` until null. A page boundary
is not an execution limit. Do not reconstruct receipts from shortened messages.

An `entry-operation-result/v1` with `recovery-required` is addressed to the agent:
inspect its original `outcome`, code, commit facts and concrete routes, perform
analysis, then submit corrected input or a `recovery` plan with `reason` and
`operations`. The driver stops at the first unresolved operation and returns
`recovery-applied` after successful recovery operations. Read canonical state and
the retained receipts, then resume only an original operation still needed for
this invocation. Never replay an operation reported as committed merely because
its reply was interrupted; reconcile that transaction first.
`operation-complete` means that operation finished, not that this Skill's intent
is complete. Continue until its actual requested result is available.

For ordinary execute-step retry budget exhaustion, supply `budget_analysis` with
`document_id`, `plan_revision`, the proposed `attempt_id` from global-gates, and
`evidence_refs` to retained analysis of failures, necessity and the next approach.
The driver records continuation using the original instruction, increases the
attempt allowance through the existing transaction, and retries the operation
with the resulting decision ID. No renewed user instruction is needed. Other
repair/wave quotas use their typed extension operations in `recovery.operations`.
Evidence and analysis are the agent's responsibility, never invented user speech.

Before returning any blocked result, classify it: an internal operation awaiting
recovery stays in this invocation; an unresolved user choice must state the actual
alternatives; an unavailable external prerequisite must name what internal
recovery could not restore. Completed reports/verdicts remain legitimate outcomes.

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

Implement only the confirmed `CURRENT_TASK` step selected by Runtime. Do not redesign the task or widen the current step mutation scope in v1; do not widen v2 authority or implement a later step.
Mutation Authority v2 permits bounded implementation discovery within the
already authorized responsibility; the discovery assessment and review rules
below are part of execution, not a new task authority.

## Operating rules

Runtime does not define a per-invocation token, wall-clock, or tool-count
budget. Those are host concerns and must never be converted into a task
failure, a consumed attempt, a finding, or a reason to ask the user to split
one confirmed step. A host/session interruption is resumable: continue from
the durable Runtime state in a later call. If the prior call had already
committed preflight but its receipt was not returned, call
`resume-preflight` with `{}` and use the exact receipt it returns. This
read-only continuation creates no attempt, consumes no repair/finding budget,
and does not authorize a new path. If Runtime returns
`execute-step-preflight-decision` because an old receipt cannot be recovered,
do not loop on `resume-preflight` and do not invent candidate paths. Inspect
the retained execution, current files, and available dispositions. If those
facts determine the correct disposition within the existing instruction, call
`reconcile-preflight` with the exact `current_preflight_id`; ask the caller only
when the alternatives require a materially new choice. The transaction
records the choice, clears only the dangling admission, preserves the same
logical attempt and all review/finding/budget history, and requires a fresh
`preflight-step` or `begin-repair` afterward.

Process-policy gates are user decisions, not host-call limits. If Runtime
returns a budget, retry, review, checkpoint, or test-strategy gate, inspect its
`policy_route`/`task-context.overview.gates.policy_gates`. When the current
caller instruction already makes the exact continuation choice, record that
instruction through `record-user-decision` and bind its decision ID to the next preflight or
result-registration call. Runtime records the warning and continues only for
the named target. Stale task/revision/receipt/target facts remain hard errors.
When one operation crosses multiple process-policy gates, one user decision
may contain a distinct `continue-after-warning` effect for each gate and its
exact targets. Carry its ID through resume, preflight extension and result
registration. A blocked repair or new-finding budget review can continue
selected findings under its matching warning decision without becoming clean.
For a test-strategy warning recorded after preflight, call `resume-preflight`
to refresh the receipt's source revision for the same execution. Supply the
decision ID in `record-step-result.policy_decision_id` when recording the
actual `test-red` result.
If the user chooses to skip a check, submit `not-run` (or the actual failed or
blocked result) and use an exception disposition; never submit PASS or clean.

The compact-v3 CURRENT_TASK file is only an active navigation projection. Read
exact definition, authority, obligations and reports through the bounded Runtime
context/read APIs; do not treat summary text as the complete task or hand-edit
its immutable task-data material. Legacy task compaction uses the existing
explicit storage-migration route, never task replan or a size-based blocker.



Start with a fresh `validate --summary`, then call the read-only
`task-context(entry:"preflight-step", mode:"default")`. Follow every required
continuation before treating the operation context as complete; use
`task-read`/`file-context`/`review-read` for exact definitions, results,
evidence, source files, and diffs. Reuse definition text only in the same
visible session with the exact task/document and `definition_revision`; after
compression, a new session, or a revision change, read it again. Use the latest
summary for status. A receipt is not permission or proof of comprehension, and
a compact/store error is a blocker rather than a reason to load unbounded
CURRENT_TASK history.

Before implementation, follow **Project document navigation** in
`.workflow-system/runtime/support/CONTEXT_API.md` for the confirmed step's relevant
requirements, plan, design, Contracts, and Decisions. This reading does not reopen
the plan or widen its mutation scope. Read the saved `project_documents` and
`affected_contracts` using `validate --summary`, then their relevant body sections.
Apply **Project document conflicts** in that support file before preflight and
when contradictions emerge during execution; preserve existing explicit decisions.

1. If the confirmed current step is already blocked, inspect its retained failed attempt and apply **Same-plan blocked-step recovery** before ordinary preflight; do not ask the user to choose another Skill for a confirmed in-scope correction. If the latest attempt is already `preflighted` but the previous host call did not return its receipt, call Runtime `resume-preflight` with `{}` and continue with its exact receipt. If it returns `execute-step-preflight-decision`, inspect the retained receipt, recorded result, and current file state; apply the supported reconciliation when those facts determine the disposition. Ask the caller only if two materially different dispositions remain possible. Do not invent a receipt, silently rerun, or loop on resume. Otherwise send intended changed paths, including every exact planned command write, to Runtime `preflight-step` on stdin. Runtime uses the same exact-target admission evaluator for ordinary and repair execution, freezes each before-state, and returns the frozen test-strategy mode, execution phase, required outcome, and Persistent Tests in the receipt. Runtime derives a `test-first` `red` phase only from the current step's frozen unconsumed before-step expected-failure obligation; candidate filenames or mixed candidate composition cannot change it, and its required outcome remains `implemented`. For v1, the task and current-step scopes are hard. For v2, `planned_mutation_targets` are guidance: planned targets receive normal admission, while an in-envelope unplanned target needs the complete blast-radius assessment below. Use only the current step, planned commands, validation, and receipt it returns. When a preflight request is rejected, inspect its exact code and state, correct stale identity or candidate-set mistakes, use the current entry's recovery operation, and retry. Return a blocker only when the needed fact, authority, or user choice cannot be established within this invocation.
   For a v1 path already declared in both the current step and `Conditional Files`, inspect the declared trigger against actual failure or integration evidence. When it is met, supply `conditional_authorizations` with the exact `pattern`, non-empty `evidence_refs`, and the task decision in `authority` to `retry-step` (when diagnosing a blocked attempt) and to the fresh `preflight-step` or `begin-repair`. The Runtime binds this admission to that execution and its receipt; reuse `resume-preflight` after an interrupted response. A conditionally declared path needs no scope amendment merely because its trigger was discovered during execution. Do not edit the path before its fresh preflight includes it.
2. For a v2 target outside `planned_mutation_targets` but inside an authorized domain, inspect the exact symbol, exports, references, consumers, contract/DTO/schema role, persistence/concurrency/security boundary, and existing Contracts/Decisions before choosing `self-admit` or `escalate`. Prefer the smallest correct local change. A shared or high-impact change may be self-admitted only when evidence shows the local alternative would be incorrect, duplicative, or contract-breaking and consumer/regression validation is covered. Caller count alone is never a threshold. Do not ask for user authorization for ordinary same-domain discovery; do not continue silently when the assessment is uncertain or escalated.
   Dynamic expansion authority is execution-scoped: Runtime considers only the current active step, plan revision, change set, and stable execution identity. An assessment recorded for an earlier step, continuation, or repair wave is audit history, not a reusable write grant; reassess the same path when a new execution discovers it.
3. If a new same-envelope target is discovered after another admitted path in the same attempt has changed, call Runtime `extend-preflight` with the current receipt, exact `additional_targets`, one assessment per unplanned target, and non-empty evidence references. Runtime captures only the new target's first-touch before-state and returns a replacement receipt. Keep the same stable `execution_id`, task, step, execution phase, attempt or repair wave, plan revision and retry budget; do not create a continuation or use `scope-amendment`. Ordinary and repair receipts use this same evaluator and action. Use the newest receipt for `record-step-result`. Runtime selects dynamic review from the existing assessment: private local changes with no cross-component consumers and no contract impact add no checkpoint; shared, public, cross-component or otherwise elevated changes still require cumulative review. The ordinary checkpoint and repair-verification gates remain unchanged. A clean review consumes only the expansions bound to that execution and result.
4. If a same-domain unplanned target lacks an assessment, inspect the target and supply the complete assessment in this invocation before retrying preflight. If the assessment is escalated, use the declared warning/authorization route when the caller's instruction covers the exact target; otherwise ask for the new scope choice. Do not route a missing assessment to authority amendment. If a target maps to another or no authority domain, inspect the component/path and evidence and use the typed authority amendment only when the caller has authorized those exact paths; otherwise ask for that expansion. Read/discovery across domains remains allowed. Never guess an `exact_exception` or convert a dependency read into authority.
5. Modify only paths admitted for the current step or the v2 replacement receipt. A persistent test may be created or changed only when it is already frozen in the confirmed task's `Persistent Tests` if its first-touch state is absent; an existing test file inside an authorized v2 domain may be an ordinary assessed expansion, but a target whose first-touch state is absent still requires the complete P-12 admission. In either case, review the test oracle, reuse, and boundary.
   For an absent same-domain persistent test, ordinary dynamic admission is a distinct `PERSISTENT_TEST_UNADMITTED` blocker. Route the complete P-12 decision through `prepare-task:prepare-scope-amendment` with `persistent_test_admissions` and no authority authorization when `authority_diff` is empty; this transition is not a no-op and does not invent any missing fact.
6. Obey the Runtime phase returned by the shared evaluator. `flexible` has no mandatory Red or tests-only first step; an admitted test may pass immediately. In a `test-first` Red execution, a test-only target may be admitted, but a product target discovered by `extend-preflight` is rejected before Runtime state changes; the same restriction applies to repair. `not-applicable` remains closed under discovery and every target must stay inside the project non-executable boundary. Use `outcome: implemented` only when planned results pass or explicitly match the admitted reproduction check. Explicit ordering requires Runtime-consumed before-step evidence; do not substitute flexible. Historical `outcome: test-red` and `status: expected-failure` remain readable. A new expected-failure result requires a new report submitted in this execution for its exact unconsumed before-step check constraining a later step. Historical reproduction reports cannot authorize later repair or delivery failures. Expected failure cannot satisfy positive acceptance. Syntax, type, import, fixture, tool, unrelated-test, and environment failures are not Red evidence; record actual failures as blocked before considering same-plan recovery.
7. Run only the current step's planned commands and validation. Do not substitute an unplanned write-capable command, full suite, whole target, broad regression, or E2E command. For an equivalent read-only invocation adjustment between attempts, use internal `replace-validation` under the constraints below. If the selection or business obligation must grow or change, use the existing bounded correction/replan mechanism; do not silently expand the command. If a command or validation fails, retain its real output, record the blocked result, and diagnose within the current owner and retained business attempt budget. A confirmed current-step code/test/fixture error may use **Same-plan blocked-step recovery** below without a separate public `debug-task` invocation or user route. Handle a changed plan or scope through its supported internal route when the existing instruction already determines and authorizes it. Ask only for an undetermined goal, scope, acceptance, contract or authority choice, or report evidence that remains unavailable after internal recovery; never stop merely because a host call is ending.
8. When the canonical review result contains findings, ask Runtime `begin-repair` for the complete admitted finding set. Repair only those findings in one bounded wave and do not use repair as an opportunity for unrelated improvements.
   If the pending review contains findings that the user explicitly wants to
   defer, reject, or accept as risk, route the exact decision through
   `record-user-decision`; do not remove them from the review by editing task
   data. A mixed decision leaves only the still-open admitted findings in the
   repair handoff. A disposition alone preserves the pending review and step.
   If all review findings are disposed and the user also authorizes advancement,
   use `advance-with-exceptions` with exact finding/blocker targets and keep the disposition receipt separate from
   `clean`. If the user later reopens a terminal finding, Runtime creates the
   fresh bound repair handoff while preserving its attempts and evidence.
9. Send declared actual changed paths, command results, validation results, and permitted acceptance evidence to Runtime `record-step-result` on stdin. A `test-red` result requires actual expected-failure results plus the new report for the exact unconsumed before-step non-acceptance reproduction check in `acceptance_evidence`; it cannot satisfy positive acceptance. In a Red preflight it needs no extra policy decision; outside Red it requires an exact `TEST_STRATEGY_SEQUENCE_INVALID` user warning decision from the preflight receipt or supplied as `record-step-result.policy_decision_id` after preflight. Subsequent review retains the `test-red` fact. Normal new reproduction evidence may also use `implemented` with a bound expected-failure report. Runtime captures the after-state, derives the exact before/after delta, rejects a mismatched path declaration, and owns phase/order enforcement, scope re-checking, finding bookkeeping, proposal construction, state, read-back, and step advancement. If the host call ends before this submission, preserve the live workspace and continue in a later call with `resume-preflight`; if exact recovery is unavailable, use the explicit `reconcile-preflight` disposition route described above rather than a dead-end or an invented result.
   For a repair on a step that is already `completed` and awaiting verification, `outcome: blocked` records the repair execution fact while preserving the step progress as `completed`; it does not claim acceptance and does not consume the pending review. If an older Runtime retained the repair preflight or committed only the finding attempt, call `begin-repair` with the exact admitted paths to recover the same receipt, then retry `record-step-result` with the same execution identity. The exact replay is idempotent: it does not spend another finding attempt or controlled grant. After a blocked repair result, follow the `review-change` remediation review; do not call `complete-reviewed-step` until a later repair result has passed and received a clean review. Ordinary blocked steps keep their existing blocked-state recovery rules.
10. When the canonical review result is `clean`, call Runtime `complete-reviewed-step`; completion cannot add evidence, never supply or copy a review receipt, and do not edit product code again. When Runtime reports a risk-selected dynamic-review gate, obtain its fresh cumulative `review-change` result even if the ordinary checkpoint is not required. Do not add review merely because a low-risk private path was discovered. Runtime retains the existing required review and repair verification gates.

For selected validation, preserve the independently specified expected outcome.
A failing assertion is not permission to copy actual output into the oracle or
regenerate an expected snapshot merely to make it green. Resolve requirement/fixture
errors through the existing bounded repair/decision route. Record the observed
business facts and actual fixture/selector in the existing report, not just exit
status. Many incidental PASS results do not establish unobserved behavior. Stop
once the planned necessary validation is complete; do not add an E2E or full-suite
"confidence" run. These rules do not require pre-fix failure execution under flexible.

If the fresh summary reports an unresolved evidence challenge, do not consume
the challenged old result. Only the confirmed correction step may run. Record a
new result ID for the exact challenged slot, then obtain a fresh clean review;
Runtime resolves the challenge on reviewed completion and advances to the
original pending step. Unaffected old reports may satisfy the new plan only
when Runtime supplies and rechecks an `evidence-carry-forward/v1` proof. A
previous before-step receipt or clean review cannot be copied to the correction.

If the user has already authorized exact additional paths for a true v2 authority
change, use the internal `prepare-scope-amendment` capability with those paths
and the caller-reported decision source/text, then its supported commit route.
Runtime consumes that
existing explicit authorization through one `prepare-scope-amendment` route;
its candidate digest is an internal drift guard, not a second approval object.
The user does not construct an authority transition or receipt, and this
   `execute-step` invocation does not invoke `prepare-task` for them. Before any
   v2 target admission, Runtime compares the task-bound
   `authority_domain_revision` with the canonical project map; a missing or
   stale revision is fail-closed and must be resolved by explicit task
   authority-domain revalidation; ordinary correction-replan, P-12 admission,
   and exact-path amendment do not rebind it. Same-domain
discovery must use `extend-preflight`, not this route.
If the amendment retains a clean pending review for the prior step, use internal
`complete-reviewed-step` for that prior step. Runtime consumes only that retained
review and leaves the new continuation ready. Refresh task-context and preflight
for the authorized continuation of this same execution intent; consuming the old
review does not claim that the continuation has executed or passed review.

Execute `frozen_invocation` exactly; do not change its selector or expand its argv.
For opaque invocation, execute the frozen command verbatim. An engineering-only
invocation adjustment uses internal `replace-validation` between attempts: submit
source_revision, claim_id, slot_id, replaces_check_id, replacement_check and reason.
The new ID must retain the exact observation, boundary, subjects, result,
validation ownership, granularity, selector and breadth authority (including
focused E2E). Neither narrower nor broader selection is an engineering-only
replacement. Repository writes must remain none. Runtime changes only
that read-only invocation, invalidates its result, preserves other applicable
facts and retains the attempt budget. Record a failed/outstanding attempt first;
a replacement never clears a finding, review gate or prerequisite. Shared-check
redesign, broader validation, or changed business intent needs its existing
bounded correction/authority route, not an automatic supersede or full task rewrite.
Legacy metadata is not fabricated to enter this engineering-only route.

## Required result

Return one structured `change-result` with the current step, Runtime-detected
changed files, commands and validation run, evidence, Runtime result, and any
unresolved blocker. Before returning a blocker, apply the internal recovery rules
below; recovery is not restricted to same-plan retry.

- If result registration or storage publication fails, inspect the retained
  execution and transaction state first. Use the supported reconciliation or
  storage recovery route and establish whether the original result committed
  before retrying registration or admitting another business attempt.
- For a recorded execution failure, diagnose and use the applicable typed route:
  same-plan retry, equivalent `replace-validation`, evidence-plan amendment,
  review consumption or finding repair, budget reassessment and extension, or an
  already-authorized scope amendment. Use only routes supported by the retained
  facts and existing instruction; a request to repair is not a risk waiver.
- Invoke these as internal Runtime capabilities, refresh task-context and obtain
  the applicable receipt, then resume the original execution intent. An internal
  capability owned by another entry does not require invoking that public Skill
  or asking the user to issue a manual call. Do not repeat an unchanged rejection.
- Ask for a decision only when the required choice or authority is not determined
  by the existing instruction. If supported internal recovery cannot restore an
  external prerequisite, report that concrete prerequisite and retained state.

After an implemented/completed result for the requested execution intent, stop.
A Runtime-created recovery continuation serving that same intent is internal
recovery; this does not authorize starting unrelated later task steps.

Only when Runtime reports successful step completion, return `next_route: git-commit` and a `commit_scope` containing the Runtime-detected changed files plus Runtime-written workflow paths. This is a recommendation for the user—or an explicitly configured outer orchestrator—to invoke later; neither execute-step nor Runtime invokes it. Otherwise recommend the appropriate review or blocker route. This invocation must not invoke another public Skill or start an unrelated next step; the same-intent internal recovery described above remains its responsibility.

terminal_boundary: public-entry-terminal/v1

## Slot reports and prerequisite consumption

For persistent-test admission, do not admit another test during execution
without the complete P-12 owner, claim, basis, insufficiency, boundary, and
failure-disposition record. An existing in-envelope test file may still be an
ordinary assessed v2 footprint expansion.

Submit acceptance_evidence by claim_id + slot_id + check_id + minimum_type, with
disposition, retained evidence_refs and a structured report: result_id, status,
evidence_plan_revision, subject_revision, actual_method, environment, assurance.
After executing the check, send `{}` to Runtime `evidence-context` on stdin.
Use its evidence_plan_revision and the matching claim/slot/check's subject_revision.
This read-only snapshot grants no execution authority and proves no check ran.
Do not copy another slot's identity or report, or refresh a stale report without rerunning its check.
A rule pass cannot satisfy a flow slot. Failed, blocked, not-run, skipped and missing
slots cannot complete their due step or close the task. Static evidence uses
accepted, without invented exit codes. An explicit frozen human observation uses `record-human-acceptance`; a raw human
report cannot manufacture that decision. A waiver uses `record-evidence-waiver`,
not a successful report. Assurance remains caller-reported even when input says trusted.
Preserve the shared transaction output `evidence_assurance: caller-reported` in
user-facing summaries; a successful state write is not independent execution proof.

Preflight may atomically register an approved prerequisite before editing; use the
returned source revision. It must not clear pending review, findings or budgets.
When review is pending, inspect and consume it through its supported typed route
within the current instruction, then resume execution. Ask only for an unresolved
disposition that the instruction does not determine. Never forge or replace
a prerequisite_receipt; after consumption its historical snapshot and report are
immutable, while positive current evidence must reflect the repaired objects.


## Explicit risk continuation

If Runtime has recorded an applicable user waiver, keep the actual command or
validation status (`failed`, `blocked`, or `not-run`) and identify its
`waiver_decision_id`; never rename it passed. Only its exact read-only check
invocation and the decision’s frozen `validation_items` can use that marker.
Every other consumer of a shared command must also have an applicable waiver.
Required review, findings, prerequisites and implementation commands remain in force.
For a previously blocked attempt whose failed checks are all explicitly waived,
use ordinary `retry-step` with the exact retained Task Basis path in
`blocker_resolution_refs`; do not fabricate an environment-restored report or
repair diagnosis. Runtime retains the old failure and original budget and still
requires fresh preflight/result recording. Report completion with the accepted
risk separately from test results.

## Cumulative review boundary

Preflight records bounded first-touch content and approved prerequisites; preserve
its returned revision. A not-required step still submits actual execution and
all due evidence. Its changes remain pending for the next checkpoint. Do not
refresh a stale baseline or use Git HEAD as the task's dirty before-state. Review
uses the cumulative target, while actual_changed_paths describes this invocation.
Repair paths use the current repair preflight's same-envelope admission and may
append a newly discovered in-envelope target through `extend-preflight`. The
extension keeps the same repair wave and stable execution identity, captures
only the new target before-state, and requires no retry-budget or continuation
transition. Missing authority, assessment, phase admission, or baseline still
blocks before mutation. Clean
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
Use internal diagnostic capabilities when the cause is not yet established.
After diagnosis, recheck Runtime state, retry eligibility, preflight, scope and
due evidence within this invocation; diagnosis alone is not an execution receipt.
Ask only when the resulting correction requires an undetermined choice or new
authority. Do not require a later public invocation merely to perform diagnosis.

For an environment blocker, send Runtime `retry-step` the exact step_id,
durable blocked_attempt_id, blocker_resolution_refs, and stable idempotency_key
after obtaining concrete resolution evidence. Use the FILE_SCHEMAS-bound
environment-restored/v1 JSON report format. A generic note cannot discharge
the blocker.

If a blocked review of this ordinary failed attempt is pending, use the
`review_retry` binding from task-context. Record the already supplied user retry
instruction with a `continue-after-warning` effect for `RETRY_REVIEW_REQUIRED`,
binding exact step/review/blocker targets and review/change-set identity. Add a
`RETRY_BUDGET_EXHAUSTED` effect in the same decision when needed. Pass its
`policy_decision_id` to `retry-step`; Runtime preserves the review in the new
attempt before clearing pending review. Do not repeatedly ask for the same user
authorization. Open findings must first be repaired or explicitly disposed.
When the user chooses to skip the blocked step, use `advance-with-exceptions`
instead and preserve failed/not-run facts. A user may also reopen a deferred,
rejected or accepted-risk finding in its current pending review without first
advancing; use `reopen-finding` and retain the review for the repair.

For a failed command or validation with a confirmed current-step code, test, or
fixture cause, send the same `retry-step` with `repair_diagnosis` containing
`kind: same-plan-repair/v1`, `status: confirmed`, `owner: current-step`, the exact
`failed_check`, a concise `cause`, and non-empty exact `repair_paths`. The AI
must justify why each path is needed. Runtime admits them against current task
and step authority, not the failed preflight's historical candidate list. For
an unplanned v2 target, include `blast_radius_assessments` in `retry-step` and
repeat them in the fresh preflight. In the existing
`blocker_resolution_refs` field cite the retained failed-check evidence, not a
fabricated resolution report. The diagnosis is caller-reported and Runtime
retains it in the new attempt; it grants only a fresh preflight, not a pass.
No new project file is needed solely to carry the diagnosis.
The diagnosis identifies correction paths; it does not narrow the current
step's admitted execution or cumulative review scope. Include the diagnosed
paths and any other still-intended, currently authorized paths in fresh
preflight before editing any newly admitted path. A blocked attempt needs a
new retry and fresh preflight; `extend-preflight` is for an active preflight.
If Runtime rejects a mismatched candidate set, correct that request
and continue this invocation; do not turn a request-shape error into a new user
authorization question.

A whole-tree whitespace check that reports only immutable or hash-bound
governance evidence is not a failed business validation. Preserve its exact
failure result and continue with the authorized mutable-path check; do not
create `FORMAT_CHECK_SCOPE_BLOCKED` or require an evidence-plan amendment just
to exclude that governance material. A whitespace failure in an authorized
mutable business/product path remains a normal failed validation and follows
the retry/repair rules above.

Runtime retains ordinary attempt counts, failures, and recovery evidence beyond
rolling logs. A retry that crosses the ordinary warning threshold uses the
matching recorded user decision; the current user instruction to continue this
step supplies that decision when its scope is unambiguous. A successful retry
only sets ready.
Obtain a fresh preflight before any correction, then rerun the failed check and
all due validation/evidence in the same execution intent. If the host call ends
before the execution is complete, continue from the retained preflight in a
later call; a host boundary does not change task state or consume a business
attempt. Do not reuse old
receipts, checks or scope, claim completed, or invoke another public Skill.
No server restart, DB reset, or cleanup is implied. Diagnosis, findings, object
drift and budget rejections enter internal recovery: inspect, reconcile or record
the applicable decision, then resume. A route name alone is not a terminal result.
Do not route a confirmed same-scope test typo to `supersede`; that transition
requires an invalidated goal, scope, or acceptance.


## User-authorized evidence selection changes

An equivalent invocation fix uses replace-validation. An explicitly requested
selector/granularity change under unchanged observations, business boundary and
authority instead uses prepare-task's internal evidence-plan amendment route;
do not manufacture a report/challenge or recommend supersede for that gap.
After confirmation, refresh task-context and preflight. A retained findings
review continues through begin-repair in the same task and budget, with the new
planned commands. Old execution/clean review is never copied as new-plan PASS.
Finish an actually outstanding execution truthfully before a plan commit; do not
retroactively relabel the command that already ran. Tests not selected for
acceptance stay on disk; neither physical deletion nor broad regression is an
implicit consequence of selector amendment.

When a frozen step label still names the former whole-suite invocation, include
its selection-only `validation_replacements` in the same candidate instead of
claiming the old suite ran. Bind the old check IDs, preserve independent behavior
requirements and label ownership, and show the exact before/after description to
the user. Do not treat a selector rename as a waiver of a business obligation.
