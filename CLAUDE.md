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

Common checks:

```powershell
bun run gen:all
bun run validate:protocol
bun run validate:freshness
bun run test:workflow-all
bun run workflow:health
```
