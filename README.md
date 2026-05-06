# Vibe Coding Workflow System

`vibe-coding-workflow-system` is the standalone source repository for the Vibe Coding governance workflow.

It owns the protocol, schemas, templates, generators, runtime sync/install scripts, and reference generated outputs used to install workflow governance into target projects.

## Source Layout

- `.workflow-system/` - protocol, file schemas, and source-repo project profile.
- `templates/docs/` - governance document templates.
- `templates/skills/` - workflow skill templates.
- `scripts/` - generators, validation, packaging, install/runtime sync, and shared helpers.
- `docs/workflow/` - committed reference generated outputs for this source repo.
- `vibe-coding/` - methodology background and historical comparison material.
- `test/` - workflow-system generator, validation, runtime, and contract tests.

Generated reference outputs under `docs/workflow/generated/**` and `docs/workflow/SKILL_REGISTRY.md` are committed for freshness checks. Edit protocol, schemas, templates, scripts, or profile first; then regenerate.

## Core Commands

```powershell
bun install
bun run gen:all
bun run validate:protocol
bun run validate:freshness
bun run test:workflow-all
bun run workflow:health
```

## Package and Inspect

Package the workflow-system for a target project:

```powershell
bun run workflow:pack --json
```

Inspect the import/install contract:

```powershell
bun run workflow:manifest --json
```

## Install Into a Target Project

Choose the latest bundle:

```powershell
$bundle = Get-ChildItem "dist\workflow-system" -Directory |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
```

Dry-run the install first:

```powershell
$target = "E:\coding\github\your-project"

bun run workflow:install --bundle $bundle.FullName --root $target --dry-run --json
```

If the dry-run report is clean, apply the install:

```powershell
bun run workflow:install --bundle $bundle.FullName --root $target
```

Install writes the workflow runtime, templates, protocol files, and the bootstrap skill set into the target repo. It also scaffolds `AGENTS.md`, `CLAUDE.md`, and `docs/workflow/WORKFLOW_GUIDE.md` only when they are missing.

If you need to run workflow commands against another repo without changing directories, keep using `WORKFLOW_SYSTEM_ROOT` to point at the target root.

## Bootstrap and Adoption Flow

After `workflow:install`, continue inside the target project:

```powershell
bun install
```

Then use the bootstrap skill chain in the target host:

- New project: `/design-baseline-init` -> `/greenfield-init`
- New project with existing workflow assets to realign first: `/realign-workflow-assets` -> `/greenfield-init`
- Existing project: `/legacy-inventory` -> `/adopt-existing-project`

After bootstrap or adoption, render and sync the full workflow runtime:

```powershell
bun run gen:all
bun run workflow:sync --host claude --write
bun run workflow:sync --host codex --write
bun run workflow:health
```

`workflow:install` preinstalls only the bootstrap skills. The full workflow skill set is rendered after `gen:all` and expanded into the host runtime by `workflow:sync`.
