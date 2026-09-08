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

After a successful fresh install, continue in the target project with:

```text
Next:
  invoke the `bootstrap-project` Agent Skill
```

In Codex, invoke that Skill explicitly as `$bootstrap-project`; other Agent
hosts use their native Agent Skill invocation syntax.

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

Before invoking the `bootstrap-project` Agent Skill, that command returns
`BOOTSTRAP_REQUIRED` rather than guessing project governance state.

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

## FixFlow dogfood specimen cleanup

To roll a newly committed Vibe Governance version into FixFlow, use the
upgrade command. It derives the next dogfood branch from the currently
installed target version, preserves a sole dirty `CURRENT_TASK.md` specimen if
needed, builds and pins a local tarball, runs the tarball's real published bin,
validates, commits, and pushes the target upgrade.

```powershell
# Read-only source/target/branch preflight.
bun run dogfood:fixflow:upgrade -- --version 0.14.8

# Execute the fixed-version target upgrade.
bun run dogfood:fixflow:upgrade -- --version 0.14.8 --apply
```

The Vibe Governance release surface must already be committed, clean, and
release-lockstep at the requested version. Local documentation, test, and
FixFlow operational-script changes do not block a release. A tarball at an
existing version path is reused only when its SHA-256 is identical; otherwise
the command stops without overwriting the pinned artifact.

`dogfood:fixflow:cleanup` remains available when only specimen preservation
and baseline restoration are required:

For the local FixFlow dogfood target, use the target-specific cleanup command
after a `prepare-task` specimen needs preserving. Its target is intentionally
fixed to `E:\coding\dogfood\fixflow`; the only required variable is the
installed Vibe Governance version.

```powershell
# Read-only preflight: it never modifies FixFlow.
bun run dogfood:fixflow:cleanup -- --version 0.14.7

# Preserve the sole dirty CURRENT_TASK specimen on a new remote branch, then
# restore only that file and validate the clean committed baseline.
bun run dogfood:fixflow:cleanup -- --version 0.14.7 --apply
```

The command accepts only a clean target or exactly one unstaged modification to
`docs/workflow/CURRENT_TASK.md`. Before any write it verifies the FixFlow
profile, the declared Distribution/Runtime version, the committed TASK-000
bootstrap baseline, freeze policy, and the absence of an existing specimen
branch. It does not use `reset`, `stash`, or `git clean`, and it never runs a
workflow Skill or a Distribution upgrade.

Target projects do not need Bun, `WORKFLOW_SYSTEM_ROOT`, `gen:*`, `workflow:pack`,
`workflow:sync`, or manual bundle/path selection. See
[the Distribution design](docs/designs/vibe-governance-distribution-installation.md)
for the frozen boundary and compatibility policy.
