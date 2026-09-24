---
name: review-change
description: Read the recorded step change, persist one review result, then stop.
entry_contract:
  entry: review-change
  mode:
    - default
  intent: Review the current recorded step or record bounded counterevidence to an earlier result without changing the implementation.
  input_contract:
    required:
      - current_task
    optional:
      - recorded_step_execution
      - external_counterevidence
  authority_owner: none
  mutation_boundary:
    product_files: []
    governance_sources: []
    forbidden_targets:
      - product files
      - test files
      - configuration files
      - direct governance writes
      - proposal or helper files
  internal_capabilities:
    - project-context-resolver
    - read-only-review-guard
    - diff-target-resolver
    - scope-guard
    - mutation-authority-policy
  runtime_operations:
    - task-state-transaction
    - user-decision-transaction
  # Candidate interruptions: apply run-entry internal recovery before any terminal result.
  stop_conditions:
    - ordinary checkpoint review lacks a current executed step and verified review target
    - the review cannot be completed read-only
    - after read-back and supported internal recovery, a required external fact or unrecoverable integrity conflict still prevents recording the truthful review result
  output_kind: review-result
---

# vNext Skill: review-change

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

## Intent

Review the cumulative task delta at the current checkpoint. Do not modify code, tests, configuration, or governance sources.

## Operating rules

The v1-only reviewability restriction below does not apply when Runtime requires
cumulative review for an elevated v2 dynamic footprint expansion, even when the
ordinary step checkpoint is not-required. A private local discovery with no
consumers or contract impact does not add a checkpoint; ordinary required review
and existing unreviewed elevated changes still apply.

Start with a fresh `validate --summary`, then call the read-only
`task-context(entry:"review-context", mode:"review")` and follow every required
continuation. Use exact `task-read`/`review-read` references for the definition,
reports, evidence, source files, and cumulative diff. Reuse definition text only
in the same visible session with the exact task/document and
`definition_revision`; compression, a new session, or a revision change
requires a fresh read. A receipt proves only a version and returned range, not
review authority or comprehension. A compact/store error or incomplete
required page is a blocker; do not bypass it by loading unbounded CURRENT_TASK
history. For ordinary checkpoint review obtain a fresh `review-context` with
its cumulative diff and current evidence. Historical counterevidence does not
require a current reviewable execution; choose its route before invoking
ordinary `review-context`.

Use **Project document navigation** in
`.workflow-system/runtime/support/CONTEXT_API.md` to read the project sources
relevant to the admitted review target. Discovery may be broader than the diff;
it does not widen the review target or authorize task changes. Start with the
saved `project_documents` and `affected_contracts` returned by `review-context`,
read their relevant sections, and apply **Project document conflicts** in that
support file. Persist unresolved authority conflicts as blockers, not invented repairs.

For a v2 task, treat the task authority envelope as the hard structural review
boundary and treat `planned_mutation_targets` as guidance. Confirm that every
actual changed path maps to an authorized domain or exact exception, that
explicit forbidden/governance paths were not touched, and that any
planned-footprint expansion has its exact blast-radius assessment, evidence
references and `self-admit` disposition. Review the model's semantic judgment:
prefer the smallest correct local fix; for shared/elevated/high targets inspect
exports, references, consumers, contract/DTO/schema role, persistence,
concurrency and security boundaries. Caller count is evidence, never a policy
threshold. An uncertain or escalated expansion is not clean. Read/discovery
outside the envelope is allowed and is not itself a finding.
Also verify that the v2 execution was bound to the current project authority-map
revision and that every planned command write was admitted by the deterministic
exact/subset footprint proof; a stale revision or synthetic glob proof is a
blocker, not a review waiver.
For a newly admitted persistent test, also consume only the current change-set
admission and verify every P-12 field, including oracle boundary, reuse and
the reason existing evidence was insufficient; do not treat `authority_diff:
none` as permission to skip that review.

Classify each new input using `route-input` with the exact current source revision,
input reference/hash, relation, requested operation and reason. Return the binding
and one of: unrelated -> capture/owner; conclusion counterevidence -> historical
review; execution recovery -> execute-step, or debug-task only when the diagnosis
is uncertain; goal/acceptance/total authority change -> user decision or
unsupported. Supply `diagnosis_status: uncertain` only when logs and project
context do not establish the cause or corrective attempts have contradicted the
original diagnosis. Runtime checks binding and permissions; it does
not prove natural-language relatedness. Counterevidence is not product-fix authority.
For pasted or external text use `ingest-evidence` on stdin with source_revision,
source_locator and body, then cite the returned immutable evidence_ref/SHA-256.
Do not create helper files or request arbitrary absolute-path reads. Keep disputed
material contested until assessed; dismissal requires evidence, not convenience.

1. For an ordinary checkpoint, ask Runtime `review-context` for the successful `implemented` or `test-red` execution awaiting a required review checkpoint, the semantic boundary of Runtime-recorded cumulative change set, complete file index and bounded text diff, acceptance, validation evidence, the v1 mutation scope or v2 authority envelope, planned targets, current-execution dynamic expansions, Persistent Tests, and any admitted findings. The index and summaries are delivered in bounded form; if `complete_for_operation` is false, read every named block through `task-read`/`review-read` before judging the change. A summary omission is not a clean result. Review only that target and context. A blocked execution, a step without a review checkpoint, or an already completed step is not reviewable. When Runtime classifies a v2 expansion as requiring dynamic review, that cumulative review is mandatory even when the ordinary step checkpoint is `not-required`; a clean review consumes only the expansions bound to this execution identity and retains their review association in history. For new counterevidence to a previously completed result, inspect the exact claim/slot/result and retained source, then use `record-evidence-challenge` with a repository-relative evidence file and its SHA-256. This records `contested`, not an automatic invalidation or a new review verdict. If a contested challenge is demonstrably not substantiated, use `dismiss-evidence-challenge` with a hashed assessment file explaining why; retain the old report and challenge. Do not call `record-review-result` for a nonexistent current execution.
2. Check step compliance, planned-vs-actual footprint, authority admission, every dynamic assessment, implementation or test correctness, acceptance coverage, validation evidence, unauthorized persistent-test changes, and regression risk. For historical `test-red`, verify that only frozen test assets were admitted, the assertions encode the required behavior, and the recorded failure is caused by missing behavior rather than syntax, type, import, fixture, tool, unrelated-test, or environment failure; Red carries no final acceptance evidence. New flexible execution requires no Red; explicit prerequisites use S2 bound reports and consumption receipts and must not be waived by review.
3. In discovery, report all clear repairable findings together, including a finding whose file lies outside current mutation or step authority. Runtime records that finding with `repair_scope_hint: outside-current-authority`; the warning is not mutation permission. In verification, verify the admitted findings and affected regression surface; report any newly discovered issue without widening the repair yourself.
   When the review verifies an admitted finding is resolved, include its exact
   fingerprint in `resolved_fingerprints`; do not report it as unresolved merely
   to compensate for a stale queue projection. New findings remain pending
   normal Runtime admission.
4. Return exactly one verdict:
   - `clean`: the recorded change is acceptable.
   - `findings`: include specific file, failure condition, required behavior, root-cause confidence, and evidence for each repairable project-owned issue; the existing repair handoff then belongs to `execute-step`.
   - `blocked`: include the blocker and recommended route when review or convergence cannot proceed safely. Judge the cause from the actual evidence: a known unavailable external condition names the missing condition, responsible owner and resume condition, without treating it as risk acceptance or automatically demanding `debug-task`; for an uncertain or contradicted diagnosis, `debug-task` may be the recommended_route. A failure count or error string alone does not choose the route. A review blocked solely by temporarily unavailable evidence may be repeated against the same unchanged execution after that condition is restored. For that repeatable review, recommend `review-change`; for external help, recommend `user`. Neither means a risk-acceptance transaction.
   `record-review-result` records these facts only. If the user chooses what to
   do with a finding, use the internal `record-user-decision` transaction with
   the exact task/source revision and, when applicable, review/change-set and
   finding fingerprints. `repair-finding`, `defer-finding`, `reject-finding`,
   `accept-finding-risk`, `reopen-finding`, and exact-path `authorize-mutation` are distinct audited effects;
   Runtime must not infer them from prose. A mixed decision may repair A and
   defer C. A disposition alone preserves the pending review and step. Only
   when the user separately authorizes advancement, use
   `advance-with-exceptions`, naming every remaining finding and blocker after
   all current review findings have durable dispositions; it produces a disposition receipt, never a
   fabricated `clean` result. A reopened finding must receive a fresh repair
   handoff and cannot reuse an old clean review. To repair a range-out finding,
   record a separate `authorize-mutation` decision for sorted exact paths from
   the pending review, then pass its decision ID to `prepare-task:amend-scope`.
   A defer/reject/accepted-risk disposition needs no scope amendment.
5. Treat process-policy blockers as explicit decision points, not as evidence that the review has no conclusion. Preserve every finding, unresolved/resolved fingerprint, failed or not-run check, and blocker in the structured review. If the user authorizes continuation, use the Runtime-declared `record-user-decision` route and bind the exact task/source revision plus review/change-set and target IDs; Runtime may continue only that operation. Fact, identity, receipt, target, and replay conflicts remain hard rejects. A skipped check remains `not-run` (or its actual failed/blocked result) and any advancement is a disposition with exceptions, never `clean`.
6. Include `test_assessment: {applicable,reason,evidence_refs,necessity,oracle,boundary,reuse,applicability}` with explicit conclusions and supporting references. Read the cumulative delta; use `review-read` with its context receipt for unexpanded files and needed before/after ranges. Follow continuations before judging the relevant content; unavailable content is not clean. Do not replace dirty baselines with Git HEAD. Use `file-context` to locate/read reused tests and their dependencies; see `.workflow-system/runtime/support/CONTEXT_API.md` for inputs and limits. Check the original request and P-12 necessity/owner; whether expectations are independently specified; weak assertions and self-validation; mocks/fixtures versus real integration; reused test/claim mappings; current report and fixture versions. For an existing test file admitted through v2 discovery, explicitly assess oracle/reuse/boundary and any changed assertion oracle. A production constant can supply input, but an expectation that changes with the same defective constant cannot independently detect that defect. Test files need not change for reused checks or fixture changes to trigger these dimensions. Verify that each report is bound to its exact claim/slot/check: many PASS results, or one command PASS, do not increase assurance for an unrelated claim. Check the frozen selection remains minimum-sufficient, flag broad/whole-target/E2E evidence without its recorded basis, and reject a business-flow claim whose real boundary was bypassed by unit tests, mocks, or fixtures. Local rule success cannot replace missing/failed required flow evidence. Use one verdict for the mixed diff. Runtime validates structure and binding, not the truth of this caller-reported judgment.
6. Send an ordinary verdict to Runtime `record-review-result` on stdin. For an earlier-result challenge, record the challenge or its evidence-bound dismissal through the corresponding Runtime action; a confirmed error requires correction. Do not create proposal or helper files in the project.
7. Do not repair code or advance the step. A recommendation must not invoke another public Skill.

Use **Failure-oriented validation selection** in
`.workflow-system/runtime/support/CONTEXT_API.md` when assessing test effectiveness.
Compare assertion changes with the authoritative expected behavior, not just the
new implementation. A newly green oracle that now accepts the original defect is
not a fix. Verify setup actually reaches the disputed boundary: multiple planned
windows do not prove bounded live raw data, and cancellation before entry does not
prove cancellation during I/O. Check exact associations/replay equality rather than
non-empty fields. Ground each report claim in observed values and actual fixture
parameters; distinguish caller reports from independently executed observations.
Do not demand more tests, mandatory mutation testing or E2E when the existing
minimum evidence already detects the relevant failure. Apply materiality and the
existing repair scope, not a new gate for formatting or an inefficient extra PASS.

### Format hygiene scope

`git diff --check` and equivalent whitespace-only checks are hygiene checks, not
independent business acceptance evidence. They are blocking only when the
reported offending path is inside the current step's authorized mutable
business/product scope. If every reported path is immutable or hash-bound
governance evidence—such as `docs/workflow/task-basis/**`,
`docs/workflow/task-data/**`, `docs/workflow/evidence-objects/**`,
`docs/workflow/CURRENT_TASK.md`, `.workflow-system/**`, or retained
authorization text—preserve the exact bytes and hash, retain the failed
whole-tree invocation as historical evidence, and continue the review against
the authorized mutable paths. Do not emit `FORMAT_CHECK_SCOPE_BLOCKED`, request
an evidence-plan amendment, or require a waiver solely for that out-of-scope
whitespace. When a format gate is part of the confirmed plan, run or inspect a
scoped check for the mutable paths. A failure reported for an authorized
mutable path remains a real finding or blocker.

Verify actual evidence against `frozen_invocation` and its selector arguments.
For opaque invocation, compare the verbatim frozen command and inspect the wrapper's
real boundary; opaque metadata cannot establish focused execution or oracle quality.
Read boundary on each check and granularity on its selection, not on the claim.
Keep same-claim local rule and business-flow slots independently satisfied.
Incidental PASS from other cases does not prove this claim. Inspect whether the
declared business-flow actually crossed its required boundaries, whether mocks
or fixtures bypassed them, and whether the report overstates its observation.
Source existence is only structural authority binding: review the source text's
actual authorization for broad execution, including release-gate E2E.

## Required result

Return the Runtime-recorded `review-result`, inspected review target, findings or blocker, evidence, and at most one `next_route` recommendation for a later caller invocation. Then stop.

terminal_boundary: public-entry-terminal/v1

## Task decisions and proportional review

Read any frozen `user_decision` and result `waiver_decision_id`. Distinguish an
explicit manual observation from an unverified risk decision and from execution
PASS. Check that the cited user words address exactly those obligations; source
binding is caller-reported, not authenticated. A waiver does not resolve findings
or remove a required review. Engineering invocation replacement must preserve the
business observation and test selection; do not turn a local adjustment into a
whole-task redesign. A low-risk private discovery adds no new checkpoint, but
shared/public/contract-impact expansions and existing repair gates still require
review. Do not create findings merely because a legitimate internal route was used.


## Review of evidence-plan amendments

A user-authorized evidence selector amendment can prepare and commit within the
same task without an existing slot report or challenge. Distinguish review of a
plan/selection from counterevidence to an actual report; the latter still needs
its exact claim/slot/result. Do not instruct the user to invent a result, rename
a selection change as a business requirement, or supersede solely to reach a
planning route. Review sufficiency of the whole selected set, independent oracle
and real boundary, not one-test-per-slot or a fixed count. Preserve findings and
failures; historical clean review does not certify replacement checks. Do not
count future not-yet-due missing slots as present-step failures, although an
unsupported report of completed acceptance remains a real finding.
