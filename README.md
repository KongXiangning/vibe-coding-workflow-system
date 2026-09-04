# Vibe Coding Workflow System

`vibe-coding-workflow-system` is the standalone source repository for the Vibe Governance workflow.

It owns the protocol, schemas, templates, generators, project-local Runtime,
release payload, and source-side validation used to build the Vibe Governance
distribution for target projects.

## Attribution

This project is inspired by and partially derived from
[gstack](https://github.com/garrytan/gstack), which is licensed under the MIT License.

The workflow-system implementation, templates, generators, runtime scripts, and
governance documents in this repository adapt those workflow-governance ideas for
personal Vibe Coding projects.

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

## Normal target-project installation

The official user-facing entry is the ephemeral Node CLI:

```bash
npx vibe-governance@latest install
```

It installs the validated Vibe Governance distribution, including the
project-local Node Runtime and all canonical Agent Skills under
`.agents/skills/<skill-name>/SKILL.md`. It does not create project profile facts, Contracts,
Decisions, STATUS, or a task definition.

After a successful install, continue in the target project with:

```text
Next: /bootstrap-project
```

The three explicit Distribution transitions are:

```bash
npx vibe-governance@latest install
npx vibe-governance@latest migrate
npx vibe-governance@latest upgrade
```

`install` handles an uninstalled target, `migrate` invokes the independent
idle-only Migration Pack for a legacy target, and `upgrade` handles an older
vNext Distribution. They never perform one another's transition implicitly.
Daily Skills invoke the fixed project-local Runtime, for example:

```bash
node .workflow-system/runtime/dist/cli.js validate --root .
```

Before `/bootstrap-project`, that command returns `BOOTSTRAP_REQUIRED` rather
than guessing project governance state.

## Source-development and legacy tooling

The following commands remain available to maintain this source repository and
to support the legacy compatibility boundary; they are not the normal target
installation protocol:

```powershell
bun install
bun run gen:all
bun run workflow:pack --json
bun run workflow:install --bundle <legacy-bundle> --root <target>
bun run workflow:sync --root <target> --host <legacy-host> --write
```

Release engineering builds the publishable package with:

```powershell
bun run build:vibe-governance-distribution
```

Target projects do not need Bun, `WORKFLOW_SYSTEM_ROOT`, `gen:*`, `workflow:pack`,
`workflow:sync`, or manual bundle/path selection. See
[the Distribution design](docs/designs/vibe-governance-distribution-installation.md)
for the frozen boundary and compatibility policy.
