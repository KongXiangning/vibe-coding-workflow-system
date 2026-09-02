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

