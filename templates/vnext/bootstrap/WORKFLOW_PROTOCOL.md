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

