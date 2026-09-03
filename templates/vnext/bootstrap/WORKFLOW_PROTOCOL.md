schema_version: 1
kind: vnext-protocol

# vNext Workflow Protocol

This protocol describes the pure vNext project surface. The project-local
Runtime is the only writer of authoritative task state. Bootstrap is an
administrative transaction that establishes governed assets and never creates
an active task or feature implementation.

## Authoritative boundaries

- `PROJECT_PROFILE.yaml` identifies the project and workflow home.
- `docs/workflow/CURRENT_TASK.md` is the sole task and advancement state source.
- Contracts, Decisions, Status, and host guidance are written only through
  their typed Runtime operation boundaries.
- Generated assets are staged, validated, promoted atomically, and read back.
- An interruption marker is fail-closed evidence, not permission to guess a
  recovery action.

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
that must route to an entry with explicit P-12 write authority.

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
