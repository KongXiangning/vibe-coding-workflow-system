# vibe-coding-workflow-system

用中文回答。

This repository is the standalone source for the Vibe Coding workflow-system. Use historical comparison material only when the task explicitly asks for migration or methodology comparison.

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
- This source repo may self-sync host skills with `workflow:sync --root . --host <host> --write`, but must not self-install with `workflow:install --root .`.
- Project-level validation slots owned by `target-project` stay unbound in this source repo; source repo quality checks use the commands below.

CURRENT_TASK lifecycle boundaries:

- `CURRENT_TASK.md` lifecycle work is contract-first: stabilize protocol/schema/template/resolver/validator behavior before adding runtime lifecycle skills.
- Active ownership is derived from `当前状态` plus `生命周期状态`; do not collapse lifecycle semantics back into `当前状态` or infer ownership from suspended package presence.
- Suspended packages under `TASKS/paused/**` and `TASKS/interrupted/**` are task recovery artifacts, not `docs/workflow/` governance catalog documents.
- Do not add pause / resume / interrupt runtime skills, guide / registry routing, inbox / backlog artifacts, or runtime manifest / install / health report changes unless the current task explicitly scopes them and re-locks scope.

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
