schema_version: 1
kind: vnext-file-schema

# vNext File Schema

The canonical project surface contains the following governed documents:

- `.workflow-system/PROJECT_PROFILE.yaml`
- `.workflow-system/vnext/SOURCE_CONTRACT.yaml`
- `.workflow-system/vnext/RUNTIME_CONTRACT.yaml`
- `.workflow-system/WORKFLOW_PROTOCOL.md`
- `.workflow-system/FILE_SCHEMAS.md`
- `docs/workflow/CURRENT_TASK.md`
- `docs/workflow/task-basis/TASK_BASIS-<TASK_ID>.md`
- `docs/workflow/CONTRACTS.md`
- `docs/workflow/DECISIONS.md`
- `docs/workflow/STATUS.md`
- `docs/workflow/LESSONS.md`
- `docs/workflow/ROADMAP.md`

`CURRENT_TASK.md` carries its vNext YAML envelope and runtime state. Its body
contains the task identity, acceptance, Allowed / Conditional / Forbidden
scope buckets, implementation steps, test strategy, and execution evidence.

Every ordinary draft links one identity-derived Task Basis by exact path and
SHA-256 revision. The Task Basis preserves only the verbatim original request
and later explicit user decisions, each with an exact source locator. It is
written and read back atomically with `CURRENT_TASK.md`; author summaries and
draft review findings are forbidden because they are not request authority.

New semantic drafts accept `claim_evidence: ClaimEvidenceRecord[]`, replacing the
free `acceptance` array. Runtime renders acceptance requirements into the body;
raw drafts must match that exact projection. The plan is non-empty, contains at
least one acceptance claim, and every claim has at least one slot. Stable IDs
are task-local, never inferred from wording or array positions.

- Claim: `claim_id`, `claim_kind`, `requirement`, `source_ref`, `slots`.
- Slot: `slot_id`, concrete `minimum_type`, `due_step_id`,
  `applicability: current | before-step`, `check`, `report`, `disposition`,
  `evidence_refs`. New plans start missing, empty refs and null/absent reports;
  `planned-validation` is historical only.
- Check: `check_id` (unique within the task), `method: execution | static | human`,
  `entry`, `expected_observation`, `required_boundaries`, `allowed_substitutes`,
  exact `subject_paths`, `expected_result: passed | accepted | expected-failure`.
- Report: `result_id`, `status: passed | failed | blocked | not-run | skipped |
  accepted | expected-failure`, `evidence_plan_revision`, `subject_revision`,
  `actual_method`, `environment`, `assurance: caller-reported`. Shared transaction
  responses also expose `evidence_assurance: caller-reported`; success verifies
  the transaction, not independent execution authenticity. Assurance is
  fixed by Runtime; a supplied trusted/ci/runtime-local label never upgrades it.

`acceptance_evidence` submits `{claim_id, slot_id, check_id, minimum_type,
disposition, evidence_refs, report}` through record-step-result. Only the exact
frozen slot changes; other slots retain their facts. Reusing a ref does not
satisfy another slot. A changed report uses a new result_id. Draft changes to an
obligation require replacement IDs; confirmed definitions change only by replan.

Runtime owns `evidence_plan_revision`, a SHA-256 of the frozen task definition
and claim/slot/check plan, excluding result fields and execution audit. Reports
bind `subject_revision` to the Runtime file manifest for declared subject paths
(including relevant implementation, tests, helpers, fixtures and configuration).
CURRENT_TASK and .git are not subject paths. Audit changes do not stale evidence;
changed declared subjects do. Undeclared dependencies and transient writes are
not comprehensively observed. Retain repository-relative artifact files in
`evidence_refs` (optional #locator) through completion/close. Missing artifacts
block new completion; historical archive reads do not rewrite recorded facts.

All completion paths share Runtime evidence evaluation: due and overdue slots
must succeed before step completion; future slots may remain missing; final
completion/close checks every slot. Disposition or command pass alone cannot
substitute for a bound applicable report. Static checks use accepted without a
process exit code. No authenticated human acceptance provider is bound, so human
reports are explicitly blocked; higher assurance requires a future real provider.

Only before-step slots carry `before_step_id` and nullable Runtime-owned
`prerequisite_receipt: {step_id, preflight_id, result_id, subject_snapshot}`.
A prerequisite cannot constrain the first step: reports
must be submitted through an earlier authorized execution step. Only a new report
submitted in the current execution for an unconsumed prerequisite constraining a
later step can authorize expected-failure; historical reports cannot authorize
failure in a later repair or delivery execution.
Their due step is no later than the constrained step. Before editing that step,
internal `record-step-preflight` validates current objects and atomically consumes
the prerequisite. Raw ordinary progress cannot bypass consumption. Consumed
report, refs and receipt are immutable: close validates that historical snapshot
instead of demanding the repaired code still reproduce the old failure. Positive
acceptance always uses current successful evidence. Pending review routes to its
existing consumer before any preflight write or replay; stale review targets
block without clearing findings, receipts or budgets.

Persistent Tests retain exact path + stable claim IDs in `proves`, plus `owner`,
`owner_source`, `source_ref`, `basis` (acceptance/regression/critical-invariant/
critical-risk), `existing_evidence_insufficiency`, `assertion_boundary`, and
`failure_disposition`. Both semantic and raw admission validate these fields.
File allowlisting remains the machine boundary; review judges necessity, oracle
independence and mock boundaries inside an allowed test file. No AST control or
global Test ID registry is claimed.

For an ordinary independent request, `CURRENT_TASK.md` is first written by the
typed `create-draft` action as `draft + active`. The definition is closed to
the existing task sections (`background_context`, `acceptance`, the three scope
buckets, `affected_contracts`, decision fields, plan/steps, regression checks,
rollback points, and conditional design/release/propagation sections). A
repeated `update-draft` keeps the same `TASK_ID`, `TASK_SLUG`, and `document_id`
and preserves execution/audit history. A draft has no execution authority.

Every new or refined draft has one canonical `Test Strategy` record under its
regression-checks section:

```yaml
test_strategy:
  mode: flexible | test-first | implementation-first | not-applicable
  source: explicit-user | project-policy | inferred-default
  source_ref: <exact Task Basis coordinate, project policy file, or prepare-task-default>
  task_classification: contract-clear-behavior | exploratory-or-infrastructure | non-executable-change
  rationale: <bounded one-line reason>
```

`source` records why the mode was selected; it is not another authority source.
`explicit-user` binds `source_ref` to an exact Task Basis source coordinate;
`project-policy` binds it to an existing repository-relative policy file; and
`inferred-default` uses the fixed `prepare-task-default` reference.
Selection precedence is exact: an explicit user requirement overrides an
applicable project policy, and an applicable project policy overrides the
prepare-task default. If no mode can be selected reliably, prepare-task must
resolve it as a user-owned open question before committing the draft. A
behavior-changing task cannot use `not-applicable` merely to avoid tests.
Executable inferred-default uses `flexible`; no tests-only first step or
mandatory Red follows from step index. Explicit test-first/implementation-first
must retain its source and rationale and bind approved before-step slots; absent
prerequisites remain `TEST_STRATEGY_PREREQUISITE_UNSUPPORTED`.
`not-applicable` requires Persistent Tests=none and proven non-executable scope
under PROJECT_PROFILE boundaries.non_executable_change_paths (exact paths or
literal directory-prefix /** only); documentation inventory is not proof.

Runtime-owned `runtime_state.business_evidence_version` is optional for historical
reading, but must equal 1 when present. New semantic/raw create-draft and explicitly
authorized commit-replan persist 1; update/confirm cannot silently upgrade an old
record. Execution and first closure reject missing versions with
`TASK_SEMANTICS_UPGRADE_REQUIRED`; unknown versions fail closed. Reading an archive
never synthesizes the marker. S2 additionally requires the frozen evidence plan revision; reading never invents
reports or prerequisite receipts for old records.

Preflight exposes `execution_phase: flexible` and `required_outcome: implemented`
for ordinary tasks. Newly admitted tests may pass immediately. All planned command
and validation results must pass or match an admitted reproduction for implemented; expected-failure cannot satisfy
positive acceptance. Historical test-red/expected-failure structures remain readable;
new expected-failure results require the exact admitted before-step reproduction
check and report, with passed companion results.

Historical `status: expected-failure` retains the closed structure:

```yaml
expected_failure:
  kind: behavior-not-implemented
  expected_behavior: <behavior asserted by the test>
  observed_failure_signature: <bounded runner output identifying that failure>
```

Companion results must pass; syntax, type, import, fixture, tool, unrelated-test
and environment failures do not count as successful reproduction. Historical
`test-red` carries no final acceptance evidence. New executions use implemented for completing the admitted reproduction work;
that outcome does not satisfy any separate positive acceptance claim.

The typed `confirm-draft` action is the only draft-to-active transition. It
must repeat the draft identity, carry the exact current `source_tuple.revision`
as `draft_revision`, include claim-bound evidence and explicit confirmation
authority, and confirm a non-empty frozen evidence plan with an acceptance
claim. Runtime then changes
the tuple to `active + active`; stale, malformed, unauthorized, or conflicting
proposals fail without mutating the canonical file.

## LESSONS.md durable marker schema

The current vNext marker contract is
`vnext-lesson-marker/canonical-v1` under `schema_version: 1`. A persisted
marker has exactly these keys and omits `disposition`:

```text
task_id, task_slug, document_id, archive_path, archive_revision,
source_revision, candidate_ref, candidate_digest, evidence_refs
```

A reused marker adds exactly `disposition: reused` and
`reused_candidate`, whose exact four-coordinate target is:

```text
task_id, document_id, archive_revision, candidate_ref
```

Persisted and reused identities share field validation: `task_id` is validated
as a task ID, `document_id` is `doc-` plus 24 lowercase hex characters,
`archive_revision` is an exact SHA-256, `candidate_ref` uses the safe key
pattern, and top-level `task_slug` is canonical lowercase kebab-case. The
`candidate_digest` covers only the seven semantic knowledge fields and excludes
`candidate_ref` and `evidence_refs`; digest or visible provenance mismatch is
`LESSON_PROVENANCE_MISMATCH`. Unknown or missing fields and invalid disposition
values are `LESSON_INVALID`; all non-canonical shapes fail closed.

`vnext-lesson-marker/canonical-v1` is the first supported durable Lesson marker
contract. If a future released supported durable schema changes incompatibly,
the ordinary Runtime reader must wait for an explicit schema-evolution /
offline-migration boundary instead of guessing or silently reinterpreting
durable state.

## Contract / Decision promotion marker schema

`close-task` performs final knowledge admission before archive and stores the
admission bundle in the canonical task archive. Only `admit`, `merge`, and
`supersede` create typed Runtime writes after archive:
`contract-candidate-commit` targets `CONTRACTS.md`, and
`decision-record-transaction` targets `DECISIONS.md`. `defer`, `reject`, and
`no-op` create no durable governance write. The Skill/model supplies the
semantic candidate and admission decision; Runtime validates and writes the
canonical document.

Each durable marker contains `schema_version`, `knowledge_kind`,
`candidate_id`, `candidate_fingerprint`, disposition, optional matched
predecessor, the complete closed candidate, archive/task provenance, proposal
idempotency/proposal digest, and semantic digest. The candidate uses the
existing resolver fields (`candidateId`, `kind`, `fingerprint`, `statement`,
`sourceRefs`, `applicability`, authority/stability/evidence, deduplication,
supersession, consumers, and Decision `decisionContext`). Existing equivalent
records are no-ops; identity, provenance, semantic, and idempotency conflicts
fail closed without overwrite.

### Optional Implementation Anchors

```yaml
implementation_anchors:
  coverage: observed | verified-scope
  source_revision: <workspace revision>
  anchors:
    - path: <safe repository-relative path>
      symbol: <optional stable symbol>
      role: <bounded role>
      evidence_refs: []
```

Anchors may be empty and are normally limited to 0–5 observed high-value
locations. They forbid absolute/traversal/wildcard/line-number locators and are
navigation hints only: not a dependency graph, completeness guarantee, scope
authority, or mutation authority. Future consumers validate path/symbol against
current code, then expand live references according to evidence and risk;
missing or stale anchors cause broader live search, not trust in historical
locations. close-task never performs a repository-wide completeness scan merely
to populate anchors.

## Inbox / record-only artifact

`capture-work-item:record` is bound to the vNext Runtime through
`inbox-record-transaction`. A proven-unrelated item is persisted only at
`TASKS/inbox/INBOX-<YYYYMMDD>-<short-id>-<slug>.md` using the closed inbox
record fields from the source File Schema. Runtime derives and validates this
path, requires complete relation evidence, `duplicate_check: clear`, and an
owner route, and writes at most one record. The transaction binds the current
task source tuple, returns exact replay as a no-op, rejects identity or
provenance collisions, and leaves `CURRENT_TASK.md` and all other task,
lifecycle, governance, and product files unchanged.

## Expert validation result

`validate-change` produces an ephemeral `validation_result` for one explicit
claim or behavior boundary. Its selected evidence is the minimum-sufficient
evidence admitted for that claim; it is not a durable project document. The
result records the target, `passed | failed | inconclusive | blocked` verdict,
selected evidence, observations, references, gaps, zero product/governance/
Runtime side effects, and a non-binding recommended route. The entry never
creates a persistent test or admits a finding. A persistent-test evidence gap
must be routed to an authorized entry for explicit P-12 admission.


## Cumulative review coverage and assessment (S3)

Semantic steps accept `review_checkpoint: {policy: required | not-required,
reason: string}`. Both policies retain a non-empty reason in step metadata.
Omitted semantic checkpoint input conservatively retains required review for
existing callers. Sparse plans reserve exact earlier repair paths at later
required checkpoints. A final waiver must explicitly state `final-exemption:`
with a reason for exempting the entire cumulative target; it does not override
project policy or repair verification.

Runtime owns `review_coverage: {change_set_id, base, target, preimages,
pending_paths, last_clean_revision}`. Base and target use the file manifest;
preimages contain `{path,state,sha256,content_base64}` (null for absent), captured
at first admitted touch, not reconstructed from Git HEAD. The manifest remains
bounded by the existing 256 exact-path limit. Content has no fixed byte cutoff:
canonical size scales with the admitted first-touch files, including large files.
Every preimage still validates canonical base64 and its content hash.
Unrecorded changes cannot refresh the baseline. Repeated paths retain their
original content; add/delete paths retain absent states. Ordinary execution logs
retain each invocation's actual writes; the review context projects one cumulative
delta and supplies review_preimages. Pure audit changes do not change its target.

`test_assessment: {applicable,reason,evidence_refs,necessity,oracle,boundary,reuse,
applicability}` accompanies cumulative review results, bound by the enclosing
execution/change-set/target identity. Every field must be explicit and referenced.
Declared persistent tests or execution checks require applicable=true even if
no test file changed. Assess reused mappings, critical fixtures, original request
strength, independent expected values, weak assertions, and real business-flow
boundaries. Runtime validates records and binding, not semantic judgment or
reviewer identity. No trusted Provider is introduced.


## Same-plan retry (S4)

`retry-step` is an internal execute-step adapter command using the existing
`task-state-transaction`, not a public Skill or recovery platform. Input is
`{step_id,blocked_attempt_id,blocker_resolution_refs,idempotency_key}`; no scope,
strategy, claim, finding, or completion overrides are accepted.

Ordinary preflight receipts and execution results bind `attempt_id`. A blocked
result may declare `blocker_kind: environment | unknown` (omission means unknown).
Environment eligibility requires at least one blocked command or validation and
no failed result. Prior admitted writes are retained in the cumulative review
target and failure snapshot; subjects must not change after that failure. It does not relabel business assertion
failures or unknown causes as transient environment failures.

`step_attempts[step_id]` stores `{evidence_plan_revision,max_attempts:3,attempts}`.
Each attempt retains `{attempt_id,idempotency_key,request_digest,status,blocker,
evidence_refs}`; status is ready/preflighted/blocked/implemented. A failure stores
its original execution result plus the manifest of declared review/check subjects.
Retry creates ready; preflight alone changes it to preflighted. Results cannot
use an old attempt or skip preflight. The previous blocked entry is immutable;
resolution references and failures survive the 256-entry audit log windows.
Same-key/same-request replay is no-op even after those windows are trimmed; a
changed request conflicts. Same-plan replan cannot reset a blocked retry budget.

Every blocker_resolution_ref names a retained repo-relative JSON file, at most
64 KiB, with exactly `{kind,task_id,document_id,step_id,blocked_attempt_id,
evidence_plan_revision,subject_revision,status,diagnosis,resolution}`. Require
kind=environment-restored/v1, status=passed, the exact failed task/attempt/plan/
subject snapshot, and concrete diagnosis/resolution observations. Current declared
subjects must still match. These reports are caller-reported evidence, not a
trusted environment probe or Provider. Plain unlock notes are insufficient.

Budget exhaustion routes to debug-task/user. Changed code or fixtures require
legitimate execution/repair permissions; changed scope or acceptance requires
explicit replan. Pending review/findings stay with their existing consumer.
Retry changes neither business evidence nor permissions, performs no service or
DB operations, and requires fresh execution before normal completion/review.

### Read-only evidence context

The execute adapter `evidence-context` accepts `{}` on stdin for an active,
confirmed versioned task. It returns task_id, document_id, evidence_plan_revision,
checks[{claim_id,slot_id,check_id,subject_revision,subject_snapshot}],
committed=false and evidence_assurance=caller-reported. Each snapshot covers the
frozen check.subject_paths at read time, after running the check. This operation
does not write state, refresh reports/preimages/prerequisites or authorize edits.
Submission still rechecks current subjects; a later change requires a new check
and report, not merely a newly copied hash.

### Read-only source context

`review-context` returns the complete cumulative file index and bounded text
diff, not raw first-touch base64. `review-read` binds before/after/diff ranges to
its existing context receipt. `file-context` searches existing project tests
and reads current files without requiring a confirmed task; it never creates
baselines, admissions or reports. `validate --summary` omits baseline bodies;
plain `validate` retains the diagnostic format. Inputs, byte/line ranges,
continuation and incomplete-result handling are defined in the installed
`.workflow-system/runtime/support/CONTEXT_API.md`.
