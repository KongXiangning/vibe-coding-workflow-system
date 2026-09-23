---
name: close-task
description: Prove closure eligibility and complete one governed task with truthful delivery evidence.
entry_contract:
  entry: close-task
  mode:
    - preview
  intent: Prove closure eligibility and finish one task with truthful delivery, final knowledge admission, status, archive, and lesson proposals.
  input_contract:
    required:
      - task_identity
      - acceptance_claims
      - validation_evidence
    optional:
      - release_evidence
      - rollback_plan
      - observation_window
      - remaining_risks
      - status_baseline
      - archive_target
      - contract_candidates
      - decision_candidates
      - lesson_candidates
      - caller_context
  authority_owner: task
  mutation_boundary:
    product_files: []
    governance_sources: []
    forbidden_targets:
      - product files
      - direct edits to CONTRACTS.md, DECISIONS.md, or LESSONS.md; use the typed Runtime proposals
      - task state without a Runtime proposal
      - project status without a Runtime proposal
      - archive without a Runtime proposal
      - registry
      - installation surface
      - host surface
  internal_capabilities:
    - project-context-resolver
    - closure-eligibility-gate
    - task-identity-guard
    - evidence-admission-policy
    - release-evidence-gate
    - knowledge-admission-policy
  runtime_operations:
    - project-status-transaction
    - user-decision-transaction
    - archive-transaction
    - lesson-record-transaction
    - contract-candidate-commit
    - decision-record-transaction
  # Candidate interruptions: apply run-entry internal recovery before any terminal result.
  stop_conditions:
    - task identity, acceptance, or validation evidence is missing or conflicted
    - release, rollback, observation, or remaining-risk evidence is incomplete when triggered
    - a blocker, open finding, or evidence gap would make completion untruthful
    - status or archive identity/path cannot be verified
    - the request uses an old or unsupported workflow schema
  output_kind: closure-result
---

# vNext Skill: close-task

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

## Recovery closure gate

Previously completed and currently valid are distinct. Unresolved challenges,
unmapped old obligations, incomplete recovery steps, stale evidence and unreviewed
cumulative changes block closure. Historical reports require verified original
anchors and current applicability; a plan revision is not new execution evidence.
Isolated distribution tests never prove a real target project's business acceptance.

An unresolved evidence challenge blocks successful close, even when an old
report was marked passed and the last ordinary review was clean. Do not mark
the challenged report clean or silently defer its obligation to obtain closure.

## Intent

Prove closure eligibility and finish one task with a truthful delivery summary. Ordinary closure is the default entry intent; `preview` is the explicit terminal, non-mutating variant.

## Bounded task context protocol

Start with `validate --summary`, then use `task-context(entry:"close-task", mode)`
and follow all required continuations. Read exact reports, findings, receipts,
and history through `task-read`; use `file-context`/`review-read` for files and
diffs. Reuse a definition only for the same visible session and exact
`definition_revision`. Receipts are read-only version/range evidence, not
authorization or proof of understanding. Compression, a new session, a
revision change, a compact-store error, or an incomplete required page requires
a fresh read or an explicit blocker; it must not trigger an unbounded Markdown
fallback.

## Operating rules

1. Verify immutable task identity, acceptance claims, claim-bound validation evidence, open findings, remaining risks, and the exact closure/archive target before preparing any proposal. A new/refined task must have a non-empty frozen `CURRENT_TASK.runtime_state.claim_evidence` plan with at least one acceptance claim; legacy CURRENT_TASK remains readable but requires prepare-task refinement/migration before terminal completion. Runtime derives `acceptance_satisfied` and `validation_complete` from that durable per-claim/per-slot state; every planned slot must be `existing`, `reused`, or `newly-executed` with `evidence_refs`. Missing, deferred, blocked, or aggregate command success cannot be summarized as complete, and the submitted closure booleans must match the durable derivation. Validation, reuse of an existing check, and creation of a persistent automated test remain separate decisions; the closure-side persistent-test disposition defaults to `persistent_test: false`, and closure does not infer a new test from missing evidence.
2. Evaluate release health, rollback, canary, and observation evidence when the task risk triggers them. A missing or unresolved requirement yields a blocked or observing result; it cannot be summarized as complete.
3. In `preview`, return the complete closure summary and eligibility verdict with zero Runtime proposals. In ordinary closure, prepare only typed proposals justified by the eligibility result: archive first, then admitted Contract/Decision candidates, then the existing Lesson and STATUS reconciliation operations.
4. Keep task status descriptive and preserve acceptance, verification, release/rollback, observation, and remaining-risk facts. Do not rewrite history or infer a stable archive path from an ambiguous identity.
5. Lesson admission may return `admit`, `defer`, or `no-op`; it only controls whether a `lesson-record-transaction` proposal exists and never blocks an otherwise eligible closure. When an admitted candidate matches an existing lesson digest (in historical lessons or earlier in the same proposal), lesson reconciliation writes a durable reuse proof referencing the exact target candidate coordinates rather than duplicating visible lesson text.
6. Contract and Decision candidates are classified by `knowledge-admission-policy` before archive. Only `admit`, `merge`, and `supersede` produce typed Runtime proposals; `defer`, `reject`, and `no-op` produce no governance write. Task-local implementation details remain in CURRENT_TASK/archive.
7. `archive-transaction` is the only operation allowed to change the task terminal tuple, and its two-file commit must be verified before preparing Contract, Decision, Lesson, or STATUS persistence. The archive stores the exact knowledge admission provenance needed for re-entry; this entry never claims that a proposal was written until Runtime returns a committed, read-back-verified result.
8. A `closed + archived` re-entry validates the matching archive receipt and reconstructs the archived knowledge admissions. It runs only missing Contract/Decision/Lesson/STATUS reconciliation; already persisted records are deterministic no-ops, and it never repeats archive or creates a next task.
9. After archive success the task is non-owner. Contract, Decision, STATUS, and Lesson operations use the matching archive receipt plus evidence admission for reconciliation; they must not require or recreate active-task ownership.
10. Implementation anchors are optional observed navigation hints (normally 0–5), not completeness claims or mutation authority. Record only paths/symbols confirmed by existing task evidence; future consumers validate anchors against current code and expand live impact analysis according to risk.
11. Ordinary verified closure is allowed only after the final canonical implementation step is durably marked `task-complete` by the Runtime. A required checkpoint must have its clean receipt, and every repair record must have same-diff verification and a terminal finding state; without an explicit exception decision, close-task cannot bypass an unfinished step, checkpoint, or repair route.
   When the user explicitly chooses to stop or proceed with known exceptions,
   submit a `close-with-exceptions` user decision bound to the exact remaining
   obligations and durable decision IDs (for example `step:<id>`, `validation`,
   `acceptance`, `task-complete`, or `remaining-risks`). Runtime may then archive with
   `completion_disposition: completed-with-exceptions` or
   `stopped-by-user`, but it preserves the real `acceptance_satisfied` and
   `validation_complete` values, failed/not-run checks, findings, risks, and
   evidence. This route is not `clean`, `verified`, or an automatic waiver for
   an unlisted obligation; ordinary closure remains required when the user has
   not made that explicit decision.
   Deferred, rejected and accepted-risk findings prohibit ordinary `verified` closure.
   `rejected` means declining repair; it does not prove a false positive or resolution.
   Include each exact `finding:<fingerprint>` in both the close decision's
   targets and `remaining_risks`. Runtime binds a current obligation snapshot to
   the decision; any subsequent change requires a fresh close authorization.
   For `stopped-by-user`, explicitly target `gate:stopped-by-user`, the pending
   `review:<review_id>` and `blocker:<code>` when present, and every remaining
   finding. Stopping preserves pending review, open findings, unfinished step
   progress and actual closure evidence; do not advance or clear findings as a
   prerequisite. A disposition-only decision does not authorize closing.
   If the task is `blocked_by_replan + active`, first record a separate
   `cancel-replan-block` decision targeting only `gate:blocked-by-replan`.
   This restores active workflow status while retaining pending review,
   findings and evidence. Bind the subsequent stop decision to the new current
   revision, then archive as `stopped-by-user`.

## Required result

Return one structured `closure_result` containing:

- exact task identity, acceptance and validation verdict, and closure eligibility;
- claim-bound validation results and separate persistent-test disposition; no new persistent test is implied by closure evidence requirements;
- delivery summary with release/rollback/observation evidence and remaining risks;
- preview or ordinary closure semantics and the exact status/archive targets;
- explicit Contract/Decision admission dispositions plus Lesson admission, defer, or no-op decision;
- typed Runtime proposals only when each operation's preconditions pass;
- at most one `next_route` recommendation, if applicable; it is informational only and must not invoke another public Skill;
- `terminal_boundary: public-entry-terminal/v1`; after this result, return to the caller and stop. Internal closure capabilities and declared Runtime operations are not public Skill chaining.

The fixed ordinary order is `archive-transaction` → admitted `contract-candidate-commit` / `decision-record-transaction` → optional `lesson-record-transaction` → `project-status-transaction`. Closure is not complete until Runtime validates and commits the authorized proposals; downstream failure never rolls back a successful archive, and re-entry repairs only missing durable knowledge/status/Lesson records.

## Business evidence boundary

Read the frozen claim/slot/check obligations and their declared real boundaries.
Require each due slot's bound applicable report; a local rule pass cannot replace
missing or failed flow evidence. Reports and this assessment are caller-reported,
not trusted execution attestations. Runtime completion checks current subjects,
retained artifacts and consumed prerequisite snapshots. Do not invent a human
signature or provider. Check P-12 owner/source, stable claim binding, necessity,
existing-evidence insufficiency, oracle independence, weak assertions, and whether
mock/fixture substitution contradicts the claimed boundary. No same-file AST
or per-test semantic enforcement is implied.

## Explicit user evidence and risk

Separate verified/manual observations from obligations discharged by explicit
user waiver. Keep missing/failed test facts and name accepted risks in the delivery
summary; do not describe waived checks as all-green. Runtime rechecks the exact
source and subjects and retains the decision in the archive. Existing required
review, findings, prerequisites and release/rollback gates remain authoritative.
