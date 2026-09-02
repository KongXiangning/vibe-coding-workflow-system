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
