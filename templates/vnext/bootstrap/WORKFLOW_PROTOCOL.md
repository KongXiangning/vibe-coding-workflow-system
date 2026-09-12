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

## Public entry invocation terminal boundary

`public-entry-terminal/v1` is the canonical invocation boundary for every
public daily, administrative, and expert entry in the vNext surface. One
explicit public Skill invocation may complete only that entry's intent, its
declared internal capabilities, and its bound Runtime operations.

When the entry reaches its result—success, blocked, no-op, report, or another
declared terminal result—it must return to the caller and stop. A result may
contain at most one `next_route` recommendation for a later public entry or
mode, but that recommendation is informational only: the current invocation
must not invoke the next public Skill.

Internal capabilities and the Runtime operations declared by the current entry
are not public Skill chaining. Bootstrap's explicitly permitted `design` →
`greenfield` and `inventory` → `adopt` transitions remain internal mode
transitions of the same `bootstrap-project` invocation; they do not authorize
invoking another public Skill.

This is an instruction-level and host-guidance boundary. The current Runtime
cannot observe conversation-level public Skill invocations, so it must not be
described as machine-enforced by Runtime. Runtime continues to enforce only
the typed operations and write boundaries it can observe.

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
new-test obligation, or failed-first-run obligation is inferred.
`not-applicable` still requires non-executable-change, Persistent Tests=none,
and exact/subset admission under the project-owned
`PROJECT_PROFILE.yaml#boundaries.non_executable_change_paths` policy. Missing,
ambiguous or executable paths cannot prove this classification; Markdown alone
is not non-executable evidence. Persistent-test admission and review remain required.
Confirmation freezes the strategy; changes require authorized replan.
Implemented results require passed companions; an expected-failure result must
bind the exact admitted before-step reproduction check and successful report. Expected-failure/test-red remain historical data types, never positive
acceptance. New reproduction results must bind the admitted before-step check; they never satisfy positive acceptance.
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
only restores an explicitly recorded environment blocker to ready in the
same plan. It retains failure evidence and permits at most three attempts in
canonical step_attempts. Retry never completes the step: a fresh preflight and
execution are required. Unknown/business failures and open findings do not use
retry; no server restart or database reset is an implicit recovery action.
