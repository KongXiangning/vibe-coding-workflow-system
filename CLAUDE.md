# vibe-coding-workflow-system

用中文回答。

This repository is the standalone source for the Vibe Coding workflow-system. Use historical comparison material only when the task explicitly asks for migration or methodology comparison.

Current vNext policy:

- Read `docs/product/vnext-assistance-runtime.md`, `docs/product/vnext-task-management.md`, and `templates/vnext/bootstrap/WORKFLOW_PROTOCOL.md` for the assistance-first workflow. They supersede historical task-kernel admission and recovery instructions.
- Query current task state through `runtime/vnext/support/assistance.mjs task-status` or `context.management`, computed from the retained journal. `CURRENT_TASK.md` is a generated display, not a second task authority.
- The retained kernel `validate` command is a historical interface, not the default task check. Use `validate-contract` for installed software; do not convert a `vnext-task-view` display to satisfy the old parser.
- Complete the stages already authorized by the user. Record actual results and gaps without requiring legacy preflight, waiver, review receipts, or another invocation for the same authorization.
- Select validation proportional to the change; do not automatically run `test:workflow-all`. See `docs/ops/vnext-assistance-validation.md` for verification and delivery limits.

Authoritative workflow-system sources:

- `.workflow-system/WORKFLOW_PROTOCOL.md`
- `.workflow-system/FILE_SCHEMAS.md`
- `.workflow-system/PROJECT_PROFILE.yaml`
- `templates/docs/**`
- `templates/skills/**`
- `scripts/**`

Generated reference outputs must be regenerated, not hand-edited:

- `docs/workflow/generated/**`
- `docs/workflow/SKILL_REGISTRY.md`

Source repo governance boundaries:

- `docs/workflow/*.md` are this source repo's live governance docs.
- `docs/workflow/generated/**` and `docs/workflow/SKILL_REGISTRY.md` are generated reference evidence.
- `docs/workflow/` is only the governance management surface; product, usage, methodology, and operations docs belong in `README.md`, `vibe-coding/**`, `docs/product/**`, `docs/guides/**`, or `docs/ops/**`.
- This source repo may self-sync host skills with `workflow:sync --root . --host <host> --write`, but must not self-install with `workflow:install --root .`; source parent / ancestor roots and roots sharing the same `.git` anchor as the source repo are also forbidden install targets.
- Project-level validation slots owned by `target-project` stay unbound in this source repo; source repo quality checks use the commands below.

Historical task-kernel lifecycle boundaries:

The following tuple and suspended-package rules apply to the optional historical
transaction interfaces only. They do not define the current journal task view or
require restoring an active `vnext-current-task` file.

- `CURRENT_TASK.md` lifecycle work is contract-first: stabilize protocol/schema/template/resolver/validator behavior before adding runtime lifecycle skills.
- Active ownership is derived from `当前状态` plus `生命周期状态`; do not collapse lifecycle semantics back into `当前状态` or infer ownership from suspended package presence.
- Suspended packages under `TASKS/paused/**` and `TASKS/interrupted/**` are task recovery artifacts, not `docs/workflow/` governance catalog documents.
- `capture-work-item` and `TASKS/inbox/**` are record-only intake surfaces; they do not automatically promote, switch the current task, enter `create-current-task`, become lifecycle states, or join task identity / catalog / runtime contracts.
- Do not add pause / resume / interrupt runtime skills, new guide / registry routing, promote / backlog behavior, task identity / catalog awareness, or runtime manifest / install / health report changes unless the current task explicitly scopes them and re-locks scope.

Workflow external documentation gate:

- `plan-implementation`, `implement-current-step`, `investigate-root-cause`, and `review-implementation` must each keep an explicit `External Documentation Gate`.
- Trigger the gate only when third-party library, framework, SDK, API, CLI tool, or cloud service current behavior affects the plan, implementation correctness, root-cause hypothesis, or review conclusion.
- Use this fallback order: ctx7 MCP -> a ctx7/docs skill that confirms current docs lookup -> `ctx7` CLI -> blocked reason.
- Do not silently use training data as a substitute for current docs when the gate is required.
- Do not make `create-current-task` the primary ctx7 lookup entrypoint; it may only record that later external-doc evidence is needed.

File mutation guard:

- Before modifying files, check for `FREEZE_REGISTRY.md`, `.workflow-system/FREEZE_REGISTRY.md`, and header markers such as `@frozen` or `DO NOT MODIFY`.
- If a target file is frozen, stop and report the reason instead of editing it.

Common checks:

```powershell
bun run gen:all
bun run validate:protocol
bun run validate:freshness
bun run test:workflow-all
bun run workflow:health --root .
```
