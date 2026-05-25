# vibe-coding-workflow-system

用中文回答。

## Current Work Scope

- 本仓库是 `vibe-coding` workflow-system 的独立源码仓库。
- 只有在任务明确要求做历史对比或迁移审查时，才把方法论文档和历史对比材料当作补充上下文。
- 修改 workflow-system 时，优先阅读 `.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md`、`.workflow-system/PROJECT_PROFILE.yaml`、`vibe-coding/README.md`、`vibe-coding/vibe-coding-workflow.md` 和 `vibe-coding/vibe-coding-quality-system.md`。

## Build Commands

```powershell
bun install
bun run gen:all
bun run validate:protocol
bun run validate:freshness
bun run test:workflow-all
bun run workflow:health --root .
```

## Key Conventions

- Workflow skills are generated from `templates/skills/*.SKILL.md.tmpl`.
- Workflow docs are generated from `templates/docs/*.md.tmpl`.
- Do not hand-edit `docs/workflow/generated/**` or `docs/workflow/SKILL_REGISTRY.md`; regenerate them.
- Keep target-project facts in `.workflow-system/PROJECT_PROFILE.yaml` when installing into another project. Do not overwrite target-owned runtime facts just to match this source repo.
- `docs/workflow/*.md` are this source repo's live governance docs; `docs/workflow/generated/**` and `docs/workflow/SKILL_REGISTRY.md` are generated reference evidence.
- `docs/workflow/` is the governance management surface only. Product, usage, methodology, and operations docs belong in `README.md`, `vibe-coding/**`, `docs/product/**`, `docs/guides/**`, or `docs/ops/**`.
- This source repo may self-sync host skills with `workflow:sync --root . --host <host> --write`, but must not self-install with `workflow:install --root .`.
- Project-level validation slots owned by `target-project` stay unbound in this source repo; source repo quality checks use `validate:protocol`, `validate:freshness`, `test:workflow-all`, and `workflow:health --root .`.

## CURRENT_TASK Lifecycle Boundaries

- `CURRENT_TASK.md` lifecycle work is contract-first: stabilize protocol/schema/template/resolver/validator behavior before adding runtime lifecycle skills.
- Active ownership is derived from `当前状态` plus `生命周期状态`; do not collapse lifecycle semantics back into `当前状态` or infer ownership from suspended package presence.
- Suspended packages under `TASKS/paused/**` and `TASKS/interrupted/**` are task recovery artifacts, not `docs/workflow/` governance catalog documents.
- Do not add pause / resume / interrupt runtime skills, guide / registry routing, inbox / backlog artifacts, or runtime manifest / install / health report changes unless the current task explicitly scopes them and re-locks scope.

## Workflow External Documentation Gate

- `plan-implementation`, `implement-current-step`, `investigate-root-cause`, and `review-implementation` must each keep an explicit `External Documentation Gate`.
- Trigger the gate only when third-party library, framework, SDK, API, CLI tool, or cloud service current behavior affects the plan, implementation correctness, root-cause hypothesis, or review conclusion.
- Use this fallback order: ctx7 MCP -> a ctx7/docs skill that confirms current docs lookup -> `ctx7` CLI -> blocked reason.
- Do not silently use training data as a substitute for current docs when the gate is required.
- Do not make `create-current-task` the primary ctx7 lookup entrypoint; it may only record that later external-doc evidence is needed.

## File Mutation Guard

Before modifying files, check for freeze governance:

- `FREEZE_REGISTRY.md`
- `.workflow-system/FREEZE_REGISTRY.md`
- header markers such as `@frozen` or `DO NOT MODIFY`

If a target file is frozen, stop and report the reason instead of editing it.
