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

Common checks:

```powershell
bun run gen:all
bun run validate:protocol
bun run validate:freshness
bun run test:workflow-all
bun run workflow:health
```
