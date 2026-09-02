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
validator. The earlier development-only `reused_candidate_ref` and
evidence-inclusive digest form is unsupported and must fail closed; Runtime
does not silently reinterpret or migrate it. A future released compatibility
source requires an explicit offline migration before the reader accepts it.
