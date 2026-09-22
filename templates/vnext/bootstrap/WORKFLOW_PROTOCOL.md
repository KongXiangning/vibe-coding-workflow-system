schema_version: 1
kind: vnext-protocol

# vNext Workflow Protocol

This protocol describes the vNext governed project surface. The project-local
Runtime is the only writer of authoritative task state. Bootstrap is an
administrative transaction that establishes governed assets and never creates
an active task or feature implementation.

The Vibe Governance Distribution is installed separately from governance
bootstrap. `Install != Bootstrap`: a fresh Node Distribution install provides
software and the canonical `.agents/skills/<skill-name>/SKILL.md` surface, but does not create
`PROJECT_PROFILE.yaml`, Contracts, Decisions, STATUS, or `CURRENT_TASK.md`.
The next required project transition is to invoke the `bootstrap-project` Agent
Skill.

## Authoritative boundaries

- `PROJECT_PROFILE.yaml` identifies the project and workflow home.
- `docs/workflow/CURRENT_TASK.md` is the sole task and advancement state source.
- Contracts, Decisions, Status, and host guidance are written only through
  their typed Runtime operation boundaries.
- vNext Skills are installed canonically under `.agents/skills/<skill-name>/SKILL.md`; old
  host-specific Skill directories are compatibility inputs only.
- Bootstrap-owned governance assets are staged, validated, promoted atomically,
  and read back; Distribution software is validated separately as a read-only
  prerequisite.
- An interruption marker is fail-closed evidence, not permission to guess a
  recovery action.

## P-13 Mutation Scope and Command Side Effects

P-13 also covers repo-local command side effects: tracked, untracked, ignored,
generated, build, cache, temporary, and helper writes are all mutations, and
`.gitignore` is not an exemption. A known write-capable command requires a
bounded `expected_write_footprint` admitted through the canonical scope
evaluator before execution; an unbounded footprint blocks the command. After
execution, available `observed_write_paths` are evaluated by the same guard,
and cleanup cannot turn a recorded unauthorized mutation into a pass. A final
Git diff is evidence only. Without OS-level monitoring, transient create/delete
history cannot be claimed complete.

## Mutation Authority v2

Mutation Authority v2 is an explicit task-versioned boundary. A v2 task must
declare `mutation_authority_version: 2` together with:

```yaml
mutation_authority:
  domains: [node-rollout]
  exact_exceptions: []
  forbidden: []
```

The project profile may define the stable ownership map:

```yaml
mutation_authority:
  domains:
    - id: node-rollout
      roots: [packages/node-rollout/**]
    - id: rust-rollout
      roots: [native/codex-rollout-collector/**]
```

Domain roots are bounded repository-relative exact paths or literal `/**`
prefixes. IDs are unique, roots owned by different domains may not overlap,
and path resolution fails closed when it is ambiguous. A path with no domain
is `unclassified` and cannot be admitted by ordinary same-envelope expansion.
The map is a mutation ownership boundary, not a dependency graph.

Authority domains are established through a project lifecycle. The `inventory`
mode proposes `authority_domain_candidates` from observed project structure;
those candidates carry evidence but grant no write permission. In `greenfield`,
`adopt`, or `realign`, the project owner may confirm the selected candidate
IDs/roots with a decision source and verbatim decision text. Only that explicit
confirmation is promoted into the canonical `PROJECT_PROFILE.yaml` map.
`prepare-task` selects the existing map and never guesses ownership or rebuilds
it for an individual task. A simple project may confirm one broad application
domain, but it still follows the same admission route.

Every confirmed v2 task records the stable revision/digest of the canonical
domain map in Runtime state. If the profile map changes, the active task fails
closed before execution admission and requires explicit authority
task authority-domain revalidation; ordinary correction-replan, P-12
admission, and exact-path amendment do not rebind it. It never inherits a
newly widened project grant.

Read/discovery is intentionally wider: the Agent may read, grep, trace callers,
inspect consumers, and establish root cause in another domain. None of that
creates write authority. Runtime allows writes only when the candidate path is
in the task's positive domain envelope or an explicitly authorized exact
exception, after applying task `forbidden` and fixed governance boundaries.
An out-of-envelope write is a hard
`MUTATION_AUTHORITY_EXPANSION_REQUIRED` blocker; it is not reported as a
generic v1 `PREFLIGHT_SCOPE_BLOCKED` result.

Before `prepare-task` confirms a v2 definition, Runtime proves every planned
target, exact command write, bounded command footprint, and persistent-test path
against the selected project authority. Planned targets need no blast-radius
assessment, but they must be inside an authorized domain or exact exception and
outside Forbidden/governance boundaries. Command writes use only an exact path
or literal `/**` directory-prefix grammar, and a command glob is admitted only
when its pattern is a deterministic subset of one granted domain root. An exact
exception never proves a directory glob; synthetic probe paths are not proof.

`implementation_steps[].planned_mutation_targets` is guidance, not an
independent v2 ACL. A target outside that planned footprint but inside the
envelope requires a Skill/model blast-radius assessment before it is admitted.
The assessment records the target/relevant symbol, reason, locality,
visibility, cross-component consumers, contract impact, evidence references,
and `self-admit` or `escalate` disposition. Runtime validates structure,
target binding, first-touch before-state, domain/forbidden/governance
boundaries and audit state; the Agent owns the semantic judgment. Caller-count
thresholds are not policy. Prefer the smallest correct local change; broader
shared changes need evidence that the local alternative would be incorrect,
duplicative, or contract-breaking. An elevated/high target may still be
self-admitted when its root-cause and regression/consumer evidence is strong;
uncertainty or multiple plausible directions escalates to the user.

Every self-admitted planned-footprint expansion is retained in audit, but
`dynamic_review_required` is selected from the assessment rather than from the
fact that the target was unplanned. A local/private/no-consumer/no-contract-impact
self-admission adds no checkpoint by itself; elevated, shared/public,
cross-component, contract-impact or uncertain expansion retains cumulative
review. If discovery happens after another path has already been modified, the
Agent calls the internal `execute-step:extend-preflight` action with the current
receipt, additional targets, assessments and evidence references regardless of
review depth. Runtime captures the new paths' before-state before first touch,
returns a replacement receipt, keeps the same attempt and plan revision, does
not consume retry budget, and does not create a continuation. Results must use
the newest receipt. A clean cumulative `review-change` is mandatory only when
the retained assessment or ordinary checkpoint requires it.

An existing test file inside the envelope follows ordinary expansion, while
the assessment and review must cover oracle/reuse/boundary changes. A new
persistent test whose first-touch state is absent still requires the full P-12
admission record. This preserves `new persistent test != ordinary file`.

Only a real authority change—such as Node to Rust/shared-protocol or a new
cross-domain exact exception—uses `prepare-task:amend-scope` with explicit
user authorization. An absent new persistent test inside an already
authorized domain uses the same infrastructure with a complete typed P-12
record and `authority_diff: none`; it is a real admission, not a no-op.
Same-envelope implementation discovery still uses `extend-preflight`. The
authority amendment settlement gate blocks only a preflighted attempt without
its matching recorded result; ready retries, settled blocked/repair results,
and pending review/findings may be preserved. The route keeps the old
immutable candidate, history/findings/review/budget lineage and continuation
semantics, and a committed candidate cannot be discarded. Tasks without the
v2 marker, or with version 1, retain legacy exact step-scope semantics and are
not silently reinterpreted.

## Public entry invocation terminal boundary

`entry-recovery/v1` applies to every public entry. A rejected Runtime operation
is an internal recovery checkpoint, not a terminal invocation. The invoking Skill
owns state inspection, diagnosis, request correction and supported recovery,
then resumes the original intent. A `next_route` alone does not complete an
unfinished request. Internal capability reuse does not require another user
invocation. This rule also governs entries' `stop_conditions`: those interrupt
the candidate operation while recovery proceeds within existing authority.

Budget thresholds require the AI to review retained failures, necessity and the
next approach. They are not a limit on an explicit user instruction. When that
instruction covers continuation, record its original source/text and the separate
analysis, use the typed continuation/extension operation, and continue without
asking again solely because of the counter. Preserve cumulative counts. Never
infer a risk waiver from a request to repair, or erase failed evidence. An admitted
attempt retains its identity through preflight and execution without spending a
second continuation. Read-only/report-only instructions still end at their facts
or verdict; unrelated mutation needs its own authority.


`public-entry-terminal/v1` is the canonical invocation boundary for every
public daily, administrative, and expert entry in the vNext surface. One
explicit public Skill invocation may complete only that entry's intent, its
declared internal capabilities, and its bound Runtime operations.

Invoking a public Skill explicitly authorizes pursuing that entry's stated
intent and its routine internal recovery operations within the caller's
declared scope. A Runtime rejection is a diagnostic result, not automatically a
terminal result: inspect current state, correct request or identity mistakes,
resume/reconcile retained work, and use the entry's typed recovery operations
before returning. A warning threshold may be satisfied by recording the
caller's already expressed instruction when it unambiguously covers the exact
operation and risk; never manufacture an unstated decision. Preserve failed
checks, cumulative changes, review findings, and audit history. Ask the caller
only when the next action requires a materially new choice or authority that
cannot be inferred from the invocation, or when a fact cannot be established.

When the entry reaches its result—success, an unrecoverable or undecidable
blocker, no-op, report, or another declared terminal result—it must return to
the caller and stop. A result may
contain at most one `next_route` recommendation for a later public entry or
mode, but that recommendation is informational only: the current invocation
must not invoke the next public Skill.

Internal capabilities and the Runtime operations declared by the current entry
are not public Skill chaining. Bootstrap's explicitly permitted `design` →
`greenfield` and `inventory` → `adopt` transitions remain internal mode
transitions of the same `bootstrap-project` invocation; they do not authorize
invoking another public Skill.

The shared `run-entry` driver receives the caller-reported invocation identity,
intent and original instruction and executes typed operations plus selected internal
recovery actions before resuming the requested operation. Its recovery-required
result is addressed to the agent, not a terminal Skill result for the user. All
public entries bind their Runtime work to this driver. Ordinary retry budget
continuation can be recorded and applied by the driver from retained AI reassessment
and the existing instruction, without renewed user authorization.

Runtime can observe this explicit envelope, not the conversation itself. The host
remains responsible for truthful instruction provenance and semantic choices;
Runtime enforces typed operations and write boundaries. Existing low-level APIs
remain available and do not independently run an AI or guarantee a Skill outcome.

## Bootstrap modes

`design`, `greenfield`, `inventory`, `adopt`, and `realign` have distinct
preconditions. Confirmed facts retain provenance; inferred and unknown facts
remain visible and cannot silently become authority.

## Ordinary task lifecycle

`docs/workflow/CURRENT_TASK.md` is the only current-task owner. An independent
request may be prepared only after the prior task is `closed + archived` (the
bootstrap `TASK-000` baseline may be the first closed source without an
archive). The Runtime allocates the next unused identity and applies this
closed transition:

```text
closed + archived -> create-draft -> draft + active
draft + active -> update-draft -> draft + active
draft + active -> confirm-draft -> active + active
```

`draft + active` is durable but never executable. Repeated preparation must
preserve `TASK_ID`, `TASK_SLUG`, and `document_id`, replace only the typed task
definition, and must not auto-confirm or patch arbitrary Markdown. The only
draft-to-active route is explicit `prepare-task:confirm`, bound to the exact
current draft revision and explicit user or authorized-caller authority.
Execution and finding admission reject drafts until that Runtime transition
succeeds; the prior archive remains immutable.

New semantic and raw drafts use Runtime-owned `business_evidence_version: 1`.
The frozen Test Strategy retains mode/source/source_ref/task_classification/rationale.
Modes are `flexible`, `test-first`, `implementation-first`, `not-applicable`.
Authority precedence remains `explicit-user` > `project-policy` > `inferred-default`;
source_ref binds an exact Task Basis coordinate, existing policy file, or
`prepare-task-default`, respectively. Executable inferred defaults use `flexible`.
Explicit ordering retains its reason and relevant target through approved before-step
slots; absent prerequisite definitions remain TEST_STRATEGY_PREREQUISITE_UNSUPPORTED.
It must never be silently downgraded. No first-step Red, global tests-only split,
new-test obligation, or failed-first-run obligation is inferred from step
position alone. In an explicitly authorized `test-first` flow, Runtime may
represent the per-execution admission phase `red` only when the current step
has a frozen, unconsumed before-step expected-failure obligation. Candidate
filenames and candidate composition cannot select the phase. Red admits only
exact paths in frozen Persistent Tests, including non-typical test paths; its
`required_outcome` remains `implemented`, because expected-failure evidence is
the reproduction proof. Replacement preflight preserves that phase and
rejects any discovered product target before Runtime state changes.
`not-applicable` still requires non-executable-change, Persistent Tests=none,
and exact/subset admission under the project-owned
`PROJECT_PROFILE.yaml#boundaries.non_executable_change_paths` policy. Missing,
ambiguous or executable paths cannot prove this classification; Markdown alone
is not non-executable evidence. Persistent-test admission and review remain required.
Confirmation freezes the strategy; changes require authorized replan.
When an active or `blocked_by_replan` task has existing work, admitted findings,
or pending review and the user has already explicitly authorized an exact
additional path set, the caller may use the independent versioned
`scope-amendment-candidate/v1` route. In v2 this route is reserved for a path
outside the task authority envelope; an omitted same-domain helper or an
existing same-domain test uses `execute-step:extend-preflight` instead. Runtime
creates the candidate digest and receipt only after checking that the
caller-reported authorization covers every exact authority expansion path; the
source text is retained and the digest is never a second user authorization
object. Runtime commits a continuation step while preserving the old
definition, failures, obligations, findings, review baseline, review cycle,
pending review, and budget. It does not change the legacy
`correction-replan/v2` `permission_change: none` route. Preparation/amendment,
fresh preflight, real execution, revalidation, review, and closure remain
separate caller invocations; a successful amendment alone is not completion.
Implemented results require passed companions; an expected-failure result must
bind the exact admitted before-step reproduction check and successful report. Expected-failure/test-red remain historical data types, never positive
acceptance. New reproduction results must bind the admitted before-step check; they never satisfy positive acceptance.
An actual `test-red` result in a Red preflight requires no additional warning
decision. Outside Red, only a decision for the exact
`TEST_STRATEGY_SEQUENCE_INVALID` gate permits recording and reviewing it as
`test-red`; its `acceptance_evidence` must contain a new report for the exact
unconsumed before-step non-acceptance reproduction check. Positive acceptance
remains forbidden and unsatisfied.
The user may record that warning after preflight, call `resume-preflight` for
the current source revision of the same execution, and supply its ID with
`record-step-result`; the result audit retains the decision ID.
Unversioned tasks remain readable, including archives, but execution/closure
returns `TASK_SEMANTICS_UPGRADE_REQUIRED`. Unknown versions fail closed. New
Runtime never silently upgrades an active task: use its previous installation
or an explicitly authorized replan. S1–S4 are local-only and not independently distributable.


For tasks with `claim_evidence_required: true`, prepare-task must persist a
non-empty frozen per-claim/per-slot evidence plan in the same canonical
`CURRENT_TASK.runtime_state`, including at least one `acceptance` claim.
Execution can update only planned slot disposition, `evidence_refs` and bound report; it
cannot create or redefine the plan at completion time. Every planned slot must
be `existing`, `reused`, or `newly-executed` and carry `evidence_refs`;
`missing`, `deferred`, or `blocked` evidence cannot become `task-complete`.
`close-task` consumes this durable state to derive `acceptance_satisfied` and
`validation_complete`; an aggregate command result or free-text note is not
sufficient. Legacy CURRENT_TASK documents remain readable, but require
prepare-task refinement/migration before terminal completion. For an active +
active legacy task, the canonical migration is the typed
`prepare-task:default:migrate-claim-evidence` task-state transaction: it
installs only a non-empty acceptance-bearing plan and preserves the existing
task identity, definition, scope, implementation state, execution history,
findings, review state, and lifecycle tuple. It is schema migration, not
business replan or lifecycle supersede. It does not add business_evidence_version
or remove the execution/closure version and evidence-plan gates.

## Durable Lesson marker boundary

The installed vNext Runtime accepts only the current
`vnext-lesson-marker/canonical-v1` marker shape under `schema_version: 1`.
Persisted markers omit `disposition`; reused markers use
`disposition: reused` and an exact `reused_candidate` target containing
`task_id`, `document_id`, `archive_revision`, and `candidate_ref`. The
Candidate Identity fields use the same strict validators for the persisted
identity and reuse target, while `task_slug` uses the canonical task-slug
validator. Unknown or missing fields and invalid disposition values fail as
`LESSON_INVALID`; a digest or visible provenance mismatch fails as
`LESSON_PROVENANCE_MISMATCH`. The Runtime applies this canonical closed-schema
validation without guessing or silently reinterpreting non-canonical durable
state. If a future released supported durable schema changes incompatibly, an
explicit schema-evolution / offline-migration boundary must be defined before
ordinary readers accept the new shape.

## Record-only inbox binding

`capture-work-item` may submit one `capture-work-item:record` typed proposal to
the bound `inbox-record-transaction`. Runtime admits only a complete
`relation_to_current_task: unrelated` proof with resolved duplicate and owner
fields, derives the canonical `TASKS/inbox/INBOX-<YYYYMMDD>-<short-id>-<slug>.md`
target, and commits at most that one file. Stale source tuples, unsafe or
non-canonical targets, identity/provenance collisions, and failed read-back
are fail-closed; the active task and every other governance/product file stay
byte-identical.

## Expert validation boundary

`validate-change` is an expert/automation entry for one explicit validation
target. It applies evidence admission to select the minimum-sufficient
claim-appropriate evidence and returns an ephemeral `validation_result`.
Evidence kinds may include static proof, an existing regression, a focused
test, integration smoke, browser/session, visual, real-device, external
documentation, or release-health evidence; these are policy choices, not
public modes. The entry has no Runtime operation and must not mutate product,
governance, task, finding, host, or persistent-test state. A failed result is
not a finding admission, and a missing persistent regression is an evidence gap
that must return a terminal result with an optional `recommended_route` for a
later caller invocation of an entry with explicit P-12 write authority; the
current invocation must not invoke or hand off to that entry.

## Durable Contract / Decision promotion

`close-task` evaluates Contract, Decision, and Lesson candidates before archive
with the existing knowledge-admission policy. `admit`, `merge`, and `supersede`
Contract/Decision results become typed `contract-candidate-commit` or
`decision-record-transaction` proposals only after the archive is committed;
`defer`, `reject`, and `no-op` do not write. Runtime, not a Skill, owns the
canonical `CONTRACTS.md` / `DECISIONS.md` format, deduplication, provenance,
conflict, atomicity, and read-back.

The canonical task archive stores the complete knowledge admission bundle.
On closed-task re-entry, close-task reconstructs candidates from that durable
bundle and writes only missing records; existing exact records are no-ops,
provenance/identity conflicts fail closed, and archive/current terminal state
is never repeated or rewritten. No separate pending registry is introduced.

Contract and Decision records may include optional `implementation_anchors`
(zero to five `observed` or `verified-scope` path/symbol/role/evidence hints).
Anchors are navigation seeds, not completeness or mutation authority. Consumers
validate them against current code and expand live impact analysis according to
risk; stale anchors trigger broader search rather than trusted historical
locations.

### Business evidence completion (S2)

Prepare accepts stable claim/slot/check definitions, with acceptance rendered from
claims. Record-step-result merges exact slot reports; command success never fills
unreported flow slots. Step completion checks due obligations and close checks all
obligations using one Runtime evaluator, including current subject hashes and
retained artifacts. Caller-reported is the only supported assurance. No string
label supplies a trusted Provider or authenticated human signature.

The internal record-step-preflight transaction consumes approved prerequisites
and records first-touch review preimages before editing. It preserves pending review and budgets; findings route to
begin-repair, clean to complete-reviewed-step, blocked to its recorded route.
Consumed reproduction snapshots remain historical while current repair evidence
must match the repaired subjects. New definitions never import prior receipts.

P-12 admission binds persistent test paths to stable claims, source/owner,
necessity, existing evidence insufficiency and assertion boundary. Review checks
oracle independence and whether mocks actually cross the claimed boundaries.
Each step declares required/not-required and a reason; omitted semantic input
retains conservative required review for compatibility, never an implicit waiver.
A required checkpoint reviews the cumulative task delta from first-touch content,
including earlier exempt steps. The final checkpoint is required unless its
confirmed reason explicitly starts with `final-exemption:` and explains why the
entire cumulative task may be exempt. Project-required reviews cannot be waived.
Clean completion consumes pending coverage; findings, blocked and stale results
preserve it. Repair still requires verification. The internal retry-step action
can restore a recorded environment blocker or a confirmed same-plan current-step
failed check to ready only when its distinct evidence and scope gates pass. It
retains failure evidence and treats three attempts in canonical `step_attempts`
as a warning threshold; an exact recorded user decision permits further attempts.
Retry never completes the step: a fresh preflight and execution
are required. Unknown causes, changed plans, and open findings do not use this
retry; no server restart or database reset is an implicit recovery action.
When the latest ordinary failure has a pending blocked review and every finding
has been explicitly disposed or resolved, a `continue-after-warning` decision
for `RETRY_REVIEW_REQUIRED` binds the step, review, change set and blocker.
`retry-step` consumes that review atomically into the new attempt's
`consumed_review`; the old failed attempt stays intact. If the budget is also
exhausted, include `RETRY_BUDGET_EXHAUSTED` in the same decision. Existing user
wording authorizing the retry is sufficient input to record that decision; do
not ask the user to approve the same retry again. Fresh preflight and execution
remain required. A user who instead chooses to skip the failure may use
`advance-with-exceptions` from the blocked step, preserving failure facts.

## Current view, state, and complete history (0.20.8)

This additive storage contract preserves task identity, goal, acceptance,
authority, scope, test admission, review / repair budgets, and lifecycle
semantics. CURRENT_TASK.md remains the fixed human and Agent entrypoint. Its
single submission head selects the current source, definition, state, and
committed event range. Inline and compact-v2 tasks retain their original
complete definition presentation; execution and idempotency arrays are only a
compatibility hot-cache. New compact-v3 tasks keep exact immutable definition
and state references with current-step navigation in CURRENT_TASK, rather than
repeating the complete plan, claims and reports inline. The referenced material
belongs to the same canonical aggregate and is resolved through task-context /
task-read before execution. Summary text never grants authority. Existing tasks
remain readable; explicit representation-only task-storage-migration preserves
the old raw source and complete logical semantics without replan or a size gate.
Already-issued business receipts survive only a Runtime-proven storage-only
lineage with unchanged logical semantics; no business transaction is treated as
an equivalent source. Keep original receipts rather than repeating approval or
preflight after admitted edits. The v3 presentation model is versioned; YAML
emission changes alone do not invalidate intact historical material.
Complete history remains in the bound task-data aggregate and is never treated
as empty when the active preview is short.

The aggregate is stored under
<workflow_home>/task-data/<document_id>/ with a manifest, immutable
content-addressed objects/<sha256>.json, immutable
events/<sequence>-<sha256>.json, and rebuildable non-authoritative indexes.
Only objects and events acknowledged by the manifest head are committed facts.
Deduplication never merges independent execution, review, authorization,
result, or idempotency events. v1 has no automatic garbage collection, and
distribution upgrade / uninstall must not remove target-owned task-data.

Daily callers use the read-only task-context projection and exact task-read
references. Required projection content includes the current definition (or an
exact same-visible-session revision), current-step requirements, unfinished
obligations, recorded and unknown dependencies, global gates, latest execution,
and cumulative review target. It must not expand raw runtime state or
unbounded history by a recent-N heuristic. All metadata, lists, JSON, and text
use the UTF-8 byte budget and continuation fields; incomplete required content
is not complete. Receipts prove only version and returned range, never write
authority or execution qualification.

The normal sequence is `validate --summary` -> `task-context(entry, mode)` ->
all required continuation pages -> exact `task-read`/`file-context`/
`review-read` -> the existing preflight, execute, review, recovery, or lifecycle
operation. A pending journal, missing object, or revision conflict is a
recovery/error state and cannot be bypassed by reading the old full Markdown
history.

validate --summary checks the current aggregate and direct references;
validate --deep is the explicit full-history diagnostic. Storage migration is
a separate preview -> exact source_revision confirmation -> commit action. It
preserves exact legacy bytes, known history, and old locator aliases; a missing
preimage remains explicitly missing.

### Task-level user decisions and engineering adjustments

Explicit human observations and risk waivers use the source-bound internal
prepare-task commands defined in FILE_SCHEMAS.md. They are caller-reported:
manual acceptance is not automated PASS, and waiver is not evidence. Fact and
transaction-integrity failures (wrong task, stale source revision, forged or
stale receipt, changed review target, and conflicting idempotency/identity)
remain hard rejects. Process-policy gates (budget, review, checkpoint, retry,
test strategy, and user-directed exception handling) are different: without a
matching explicit user decision they return a concrete `record-user-decision`
route; with one, Runtime records a warning and audit and executes the exact
authorized operation. A decision never turns a failed, blocked, or not-run
check into PASS or `clean`.
Review facts and user disposition are separate records. `record-review-result`
must preserve the review's `findings`, `blocked` reason, unresolved and resolved
fingerprints, failed checks, and evidence even when the review cannot execute a
repair. A caller-reported decision is submitted through the atomic internal
`record-user-decision` transaction, never by first writing an authorization and
then hand-editing a finding or pending review. Its exact source text, task/source
revision, optional review/change-set binding, effects, evidence references and
idempotency key are retained in Task Basis and audit history. The transaction
may repair a named finding, defer it, reject it, accept its risk, reopen a
terminal finding, or advance/close with explicitly named exceptions. It never
turns a failed or blocked check into PASS or `clean`.

For a mixed review, a repair effect and a defer/reject/accept-risk effect may be
committed together: the repair set contains only the still-open admitted targets,
while the terminal disposition is recorded as a separate decision. A disposition
can be recorded on its own while preserving the pending review and step. Only
when the user also authorizes advancement does `advance-with-exceptions` produce
a `disposition` receipt with
`completion_disposition: user-directed-with-exceptions`; it does not invoke an
empty repair wave or fabricate a clean receipt. `reopen-finding` is an explicit
decision that may restore a deferred/rejected/accepted-risk finding within its
current findings or blocked review without consuming that review or advancing.
It binds the exact review and unchanged execution target, retains repair counts,
and requires any unfinished execution to be reconciled first. With no pending
review, the decision creates a bound repair handoff when needed, preserves previous
attempts and evidence, and never reuses an old clean review. Exact replay is a
no-op; stale identity, cross-task/review/change-set targets, and mismatched
source revisions remain integrity errors. A later `close-with-exceptions`
decision may authorize terminal closure only for its exact remaining obligations;
false acceptance/validation facts and the exception decision IDs remain visible
in the archive.
Advancement requires dispositions for every current review candidate and
unresolved fingerprint, and an exact `blocker:<code>` target for any blocker;
the consumed review is retained in the same atomic decision audit. Discovery
disposition receipts keep `admitted_fingerprints` empty under the existing phase
constraint. Deferred, rejected and accepted-risk findings require exceptional closure, with exact
`finding:<fingerprint>` targets in the close decision and `remaining_risks`.
`rejected` records a refusal to repair, not a proven false positive or resolution.
Each close decision binds a Runtime-generated obligation snapshot; changes to
the definition, runtime facts, reviewed files or evidence satisfaction invalidate
it. Historical decisions without that snapshot cannot authorize closure.
Stopping is independently authorized with `gate:stopped-by-user`, exact pending
review/blocker targets and remaining finding targets. The stop archive preserves
pending review, open findings and unfinished progress without advancing or
claiming verification. `continue-after-warning` records a review-bound,
target-bound and quota-bound acknowledgement for a process-policy continuation;
it does not consume a repair wave or claim a clean review. The same warning
decision is retained on the consuming preflight, attempt, queue delta, or
execution record.
Distinct process-policy gates crossed by the same operation may be covered by
separate `continue-after-warning` effects in one decision; each gate checks
its own exact targets. A blocked repair or new-finding budget review may
resume selected repair targets with that decision, retaining the blocked
review as an audit fact. To stop a `blocked_by_replan + active` task, first
record a separate `cancel-replan-block` decision for
`gate:blocked-by-replan`. It restores active workflow status without removing
review or finding facts; a subsequent `close-with-exceptions` decision may
authorize stopped-by-user archival. When a user explicitly advances while
skipping a validation,
the affected evidence remains `not-run` (or its original failed/blocked status)
and the step receives a user-directed exception receipt, never a clean receipt.
`authorize-mutation` records
an exact-path decision bound to pending review findings, but does not itself
change task or step mutation scope. The existing scope amendment may consume
its decision ID before any mutation.

An exact pending `REPAIR_BUDGET_EXHAUSTED` review remains owned by its findings,
not correction replan. With an explicit caller-reported user decision,
`prepare-task:extend-repair-budget` adds exactly one attempt to every and only
currently exhausted finding, records the decision/audit, and preserves the task,
pending review, attempts, baseline, and evidence obligations. The retained review
then routes directly to `execute-step:repair`; without that decision it remains a
user-owned blocker. Default limits do not change, and explicit extensions are
bounded by the Runtime absolute limits. Navigation and the transaction use the
same qualification; once the candidate next repair round would exceed eight or
an authorized finding is already at eight attempts, task-context must stop
recommending `extend-repair-budget` and expose the blocker plus the user-owned
diagnostic/controlled-recovery decision route. If only the repair-wave quota is
exhausted, the same decision may use `extension_scope: repair-round` with an
empty fingerprint set; this extends only the cycle quota and preserves every
finding attempt count. A blocked review keeps its structured findings,
unresolved fingerprints, and resolved fingerprints; verified resolutions update
the finding queue in the same Runtime transaction, and the extra-budget
authorization is not a replacement for the full repair target set.

When ordinary repair extension reaches its eight-attempt or eight-round route
boundary, the user may authorize controlled recovery for an exact nonempty
subset of admitted unresolved findings. Structured review dispositions inform
that decision but do not force every exhausted finding into the grant. Runtime
derives the complete repair set and binds the pending review, execution, cycle,
change set and target revision. The grant carries a finite positive number of
separately reviewable repair waves across linked reviews, preserving ordinary
maxima, cumulative attempts and all history. An unselected exhausted finding
stays open until an explicit disposition or separate applicable budget. The
current `begin-repair` may select the authorized controlled findings together
with still-ordinary-budgeted findings; it does not force an unselected exhausted
finding into the execution.
Findings with remaining budget remain in the repair set, resolved findings
remain excluded, and new findings must complete ordinary admission. Five waves
per grant, five controlled attempts per finding and one grant per review are
warning thresholds. Crossing any threshold requires a separate
`continue-after-warning` decision bound to the exact review, change set,
selected `finding:<fingerprint>` targets and `authorized_repair_waves` count;
the new grant records that decision ID. A still-usable prior grant or
unfinished repair preflight must be completed or reconciled first. Free text
never grants recovery permission. Exact replay is a no-op; stale, cross-task,
duplicate, over-target or unacknowledged authorization is rejected.
Local equivalent read-only validation adjustments use execute-step's internal
replace-validation, preserving the task and its obligations. Low-risk private
same-domain discoveries do not add a review beyond the confirmed checkpoint;
elevated expansions retain cumulative review.

Only a genuine task invalidation permits supersede. A later explicit replacement
request may prepare a fresh successor with complete old-obligation disposition;
it cannot erase unfinished facts or execute before ordinary draft confirmation.
Supersede never automatically creates or approves a replacement.


### Same-task evidence-selection amendment

An explicit user decision may revise verification selection without replacing the
task's goal, acceptance, authority or business boundary. The internal
prepare/confirm/discard-evidence-plan-amendment commands are owned by prepare-task.
Preparation preserves the live task; confirmation versions only admitted check
selection and bound read-only current/future commands. A planned read-only
command with no evidence slot may instead use the explicit
`unbound_read_only_command_replacements` field: it must not match any existing
or newly bound slot command, must remain an exact active/future command with
`expected_repo_writes: none`, and requires a per-command reason. This changes
only the planned command scope; it creates no slot, waiver, report or product
write permission. It requires no challenge
when no report exists. Findings, failures and budgets persist. Affected reports
are historical, not new-plan evidence; a pending findings review remains active,
while an affected clean review is retained explicitly as historical and requires
fresh validation/review. Neither test deletion nor supersede follows from this
operation. The existing equivalent-invocation and genuine counterevidence routes
keep their original, narrower contracts.
