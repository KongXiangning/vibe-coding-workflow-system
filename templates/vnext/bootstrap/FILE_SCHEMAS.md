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
- `docs/workflow/CONTRACTS.md`
- `docs/workflow/DECISIONS.md`
- `docs/workflow/STATUS.md`
- `docs/workflow/LESSONS.md`
- `docs/workflow/ROADMAP.md`

`CURRENT_TASK.md` carries its vNext YAML envelope and runtime state. Its body
contains the task identity, acceptance, Allowed / Conditional / Forbidden
scope buckets, implementation steps, and execution evidence.

For an ordinary independent request, `CURRENT_TASK.md` is first written by the
typed `create-draft` action as `draft + active`. The definition is closed to
the existing task sections (`background_context`, `acceptance`, the three scope
buckets, `affected_contracts`, decision fields, plan/steps, regression checks,
rollback points, and conditional design/release/propagation sections). A
repeated `update-draft` keeps the same `TASK_ID`, `TASK_SLUG`, and `document_id`
and preserves execution/audit history. A draft has no execution authority.

The typed `confirm-draft` action is the only draft-to-active transition. It
must repeat the draft identity, carry the exact current `source_tuple.revision`
as `draft_revision`, include claim-bound evidence and explicit confirmation
authority, and leave no unresolved user-owned questions. Runtime then changes
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
pattern, and top-level `task_slug` is canonical lowercase kebab-case. The old
development-only `reused_candidate_ref` / evidence-inclusive digest shape is
unsupported; a vNext reader fails closed and never silently reinterprets it.
