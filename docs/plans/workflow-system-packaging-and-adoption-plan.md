# Workflow System Packaging And Adoption Plan

Status: Active
Owner: kongx
Last-Updated: 2026-04-04
Depends-On: [workflow-system-implementation-plan.md](./workflow-system-implementation-plan.md), [workflow-system-artifact-inventory.md](./workflow-system-artifact-inventory.md)

## Purpose

This document records the next engineering step after the current workflow-system incubation baseline.

The current repository has already completed the workflow-system implementation surface needed for protocol, generators, bootstrap planning, validation, runtime health, runtime manifest, host sync, and lifecycle governance.

The next goal is no longer protocol incubation.
The next goal is to package that completed capability into a deployable workflow-system bundle that can be installed into a real target project through scripts and commands, and then used to complete first adoption work quickly and safely.

This plan is intentionally separate from the existing documents:

- [workflow-system-implementation-plan.md](./workflow-system-implementation-plan.md) remains the historical baseline for incubation intent, sequencing, and adoption boundary rules
- [workflow-system-artifact-inventory.md](./workflow-system-artifact-inventory.md) remains the authoritative implementation inventory and completion ledger for the already-built workflow-system surface

This document owns the packaging, installation, first-adoption, and repack / upgrade closure plan.

## Closure Summary

This plan completes the productization loop with the following core decisions:

- `workflow:manifest` continues to serve as the sole semantic source for the existing runtime / import contract. `workflow-bundle.json` is a packed superset and must not define a parallel contract.
- A new install-state file `.workflow-system/install-state.json` records bundle identity, installed files, last-install checksums, and merged `package.json` / `PROJECT_PROFILE.yaml` fragments, serving as the basis for re-run and upgrade determination.
- A file ownership matrix classifies every target path into one of four modes — `replace-managed`, `merge-managed`, `live-doc`, `runtime-host` — eliminating ad-hoc override rules at implementation time.
- `workflow:install` and `workflow:adopt` both perform a full preflight before any writes; if any planned write hits a frozen rule or local drift conflict, the entire command fails before the first write.
- Bundle identity is no longer based solely on `package.json.version`. It is now `workflow_system_version + source_revision`, with the output directory fixed to `dist/workflow-system/workflow-system-<version>+<source-revision>/`, resolving the conflict when source changes but the version does not.

## Current Completed Baseline

The completed baseline that supports this plan is summarized from [workflow-system-artifact-inventory.md](./workflow-system-artifact-inventory.md).

The following capability areas are already complete in the current repository:

- workflow generators:
  - `gen:workflow-skills`
  - `gen:workflow-docs`
  - `gen:registry`
- bootstrap planning / dry-run capability
- task identity contract
- project-level validation model
- protocol-level validation runner and freshness checks
- runtime health entry
- runtime export manifest
- isolated host sync for Claude / Codex / Factory
- lifecycle governance docs and validation homes

Those capabilities mean the current repository already contains the workflow-system engine needed to support packaging and adoption.

The remaining gap is not protocol definition.
The remaining gap is productization:

- there is not yet a real bundle export command
- there is not yet a target-project installer
- there is not yet an automated `A3`-boundary adoption command that materializes missing live docs safely

## Imported Artifact Checklist

This section records the normalized artifact checklist for a real target project import.

### Required Engine Surface

The minimum workflow-system engine imported into a target project must include:

- `scripts/workflow-core.ts`
- `scripts/repo-path-patterns.ts`
- `scripts/workflow-doc-contracts.ts`
- `scripts/task-identity.ts`
- `scripts/bootstrap-project-governance.ts`
- `scripts/validation-model.ts`
- `scripts/run-validation.ts`
- `scripts/check-freshness.ts`
- `scripts/gen-workflow-skills.ts`
- `scripts/gen-workflow-docs.ts`
- `scripts/gen-registry.ts`
- `scripts/workflow-runtime.ts`
- `WORKFLOW_PROTOCOL.md`
- `FILE_SCHEMAS.md`
- `templates/skills/**`
- `templates/docs/**`
- a project-local `PROJECT_PROFILE.yaml` scaffold
- the minimum workflow `package.json` contract:
  - required `workflow:*` scripts
  - required `gen:*` scripts
  - required `validate:*` scripts
  - `yaml` runtime dependency
  - Bun engine requirement

### Explicitly Not Imported As Source Of Truth

The following must not be treated as import-time project truth:

- native `gstack` browse / design / unrelated repo subsystems
- current-repository live governance docs as the target project's live truth
- current-repository generated outputs as the target project's committed truth
- current-repository host runtime outputs under `.agents/skills/`, `.claude/skills/`, or `.factory/skills/`

Normal implication:

- engine files, protocol docs, and templates are imported
- target-project generated outputs are regenerated locally
- target-project live docs are materialized locally under target-project ownership

### Optional Import Surface

The following artifacts are optional but recommended for auditability and future verification:

- `test/gen-workflow-skills.test.ts`
- `test/gen-workflow-docs.test.ts`
- `test/gen-registry.test.ts`
- `test/bootstrap-project-governance.test.ts`
- `test/task-identity.test.ts`
- `test/validation-model.test.ts`
- `test/run-validation.test.ts`
- `test/workflow-runtime.test.ts`

## Target Project Layout

The workflow-system target-project layout is fixed as follows.

### Standard Project-Owned Paths

These paths live directly in the target project root or standard subdirectories:

```text
<target-project>/
  package.json
  PROJECT_PROFILE.yaml
  WORKFLOW_PROTOCOL.md
  FILE_SCHEMAS.md
  SKILL_REGISTRY.md
  CONTRACTS.md
  CURRENT_TASK.md
  DECISIONS.md
  LESSONS.md
  STATUS.md
  TASK_ARCHIVE.md
  TASK_SUMMARY.md
  ROADMAP.md
  BASELINES.md
  scripts/
  templates/docs/
  templates/skills/
  generated/workflow-docs/
  generated/workflow-skills/
```

Interpretation:

- protocol docs, templates, scripts, registry, and live governance docs belong to the target project's standard repository layout
- generated docs remain under `generated/workflow-docs/`
- generated skills remain under `generated/workflow-skills/`
- live governance docs remain at repo root under the hybrid sync model

### Host Runtime Skill Paths

Host runtime skill sync remains isolated from the target project's standard engine layout.

Supported host paths:

- Codex: `.agents/skills/workflow-system-*`
- Claude: `.claude/skills/workflow-system-*`
- Factory: `.factory/skills/workflow-system-*`

Boundary rule:

- workflow skills sync only into the host runtime namespace
- protocol docs, templates, scripts, registry, generated outputs, and live governance docs remain in the target project's standard repository paths

## Bundle Contract And Identity

### Bundle Format

Bundle format is:

- directory bundle
- machine-readable manifest
- no mandatory zip / tar release format in v1

Output path is fixed:

```text
dist/workflow-system/workflow-system-<version>+<source-revision>/
```

### `workflow-bundle.json` Required Fields

`workflow:pack` reads the existing `workflow:manifest` output and generates `workflow-bundle.json`. The following fields are required:

- `contract_version`
- `workflow_system_version`
- `bundle_id`
- `source_commit`
- `source_tree_hash`
- `created_at`
- `artifacts`
- `package_json_contract`
- `post_install`
- `verification`
- `import_contract`
- `host_compatibility`
- `includes_optional_tests`

### Bundle Identity Rules

`bundle_id` format is fixed: `workflow-system@<version>+<source-tree-hash-short>`.

Idempotency rule:

- Same source state, repeated pack → identical `bundle_id`, directory name, and artifact checksums.
- Source state changes but version does not → different `bundle_id` and output directory.
- `created_at` is a wallclock timestamp and is explicitly excluded from the idempotency assertion. It does not affect `bundle_id`, directory name, or artifact checksums.

The artifact list in `workflow-bundle.json` must be the resolved list of actual bundle files plus their checksums; abstract globs are not permitted.

`package.json` is not copied wholesale from the source repository into the target project. The bundle only exposes the `package_json_contract` fragment.

### Relationship To `workflow:manifest`

`workflow:manifest` is the canonical contract. `workflow-bundle.json` must not diverge from its semantics. The bundle JSON may only add bundle-specific metadata (identity, checksums, timestamps) on top of the manifest contract.

## Ownership Matrix And Upgrade Rules

Every target path belongs to exactly one ownership mode. This matrix is normative and must not be extended at implementation time without updating this plan.

### `replace-managed`

Paths:

- `scripts/workflow-core.ts`
- `scripts/repo-path-patterns.ts`
- `scripts/workflow-doc-contracts.ts`
- `scripts/task-identity.ts`
- `scripts/bootstrap-project-governance.ts`
- `scripts/validation-model.ts`
- `scripts/run-validation.ts`
- `scripts/check-freshness.ts`
- `scripts/gen-workflow-skills.ts`
- `scripts/gen-workflow-docs.ts`
- `scripts/gen-registry.ts`
- `scripts/workflow-runtime.ts`
- `templates/docs/**`
- `templates/skills/**`
- `WORKFLOW_PROTOCOL.md`
- `FILE_SCHEMAS.md`

Note: Only the workflow-system engine scripts listed above are managed. Target-project scripts outside this list are never touched.

Rules:

- File absent → create.
- File exists and matches last-install checksum → overwrite on upgrade.
- File exists but does not match last-install checksum → local drift; install fails and reports conflict; no automatic overwrite.

### `merge-managed`

Paths:

- `package.json`
- `PROJECT_PROFILE.yaml`

Rules:

- Only workflow-owned fragments are operated on.
- Target fragment matches last-install value → upgrade to new bundle value.
- Target fragment was modified by the user → install fails and reports conflict; no automatic write-back.

### `live-doc`

Paths:

- `CONTRACTS.md`
- `CURRENT_TASK.md`
- `DECISIONS.md`
- `LESSONS.md`
- `STATUS.md`
- `TASK_ARCHIVE.md`
- `TASK_SUMMARY.md`
- `ROADMAP.md`
- `BASELINES.md`

Rules:

- `workflow:install` never touches live docs.
- `workflow:adopt` only writes absent files.
- Existing live docs always go through classify + diff-only; they are never automatically modified.

### `runtime-host`

Paths:

- `.agents/skills/workflow-system-*`
- `.claude/skills/workflow-system-*`
- `.factory/skills/workflow-system-*`

Rules:

- Only the `workflow-system-*` namespace is touched.
- Orphaned `workflow-system-*` directories may be pruned.
- Non-workflow namespaces are never touched.

## Install State And Transaction Model

### Install State File

New file: `.workflow-system/install-state.json`

Required fields:

- `state_version`
- `bundle_id`
- `workflow_system_version`
- `installed_at`
- `managed_files[]`
  - `path`
  - `mode`
  - `bundle_checksum`
  - `installed_checksum`
- `package_json_fragment`
- `project_profile_fragment`
- `host_sync_namespace`

### `workflow:install` Transaction Flow

1. Read bundle and target project state.
2. Generate the complete install plan without writing any files.
3. Execute frozen check, ownership check, and drift check against all planned writes.
4. If any check fails → exit entirely with zero repo-tracked writes.
5. On pass → execute writes:
   - `replace-managed` files written.
   - `package.json` merge applied.
   - `PROJECT_PROFILE.yaml` merge / scaffold applied.
   - `.workflow-system/install-state.json` written.
6. Output machine-readable install report.

### `workflow:adopt` Transaction Flow

1. Read install state. Require that a bundle was installed successfully.
2. Execute `gen:all`.
3. Execute bootstrap classify / dry-run.
4. Generate materialize plan for absent live docs only.
5. Execute frozen check against planned materializations + host sync targets.
6. On pass → write absent docs, execute `workflow:health`, execute host sync.
7. If health or host sync fails → do not roll back already-materialized absent docs, but output an explicit failure report and do not modify any existing live docs.

Both commands must support `--dry-run`. Dry-run outputs the full plan / report but performs zero repo-tracked writes.

`--dry-run` behavior for `workflow:adopt`:

- `gen:all` is executed into a temporary workspace directory, not the target project's `generated/` tree.
- Bootstrap classify and materialize planning run against the temporary generated outputs.
- The full plan (including what would be materialized, health check expectations, and host sync targets) is reported.
- On exit, the temporary workspace is cleaned up. No files are written to the target project.

## `package.json` Merge Policy

`workflow:install` rules for `package.json`:

- Target file absent → scaffold a minimal Bun + ESM `package.json`.
- Target exists and `type !== "module"` → fail immediately; do not auto-migrate to ESM.
- Workflow-owned keys are limited to:
  - `scripts[gen:*]`
  - `scripts[bootstrap:project-governance]`
  - `scripts[validate:*]`
  - `scripts[workflow:*]`
  - `dependencies.yaml`
  - `engines.bun`
- All non-workflow keys are preserved unconditionally.
- `engines.bun` handling:
  - Absent → write the bundle contract value.
  - Present and satisfies the bundle contract → preserve the existing value.
  - Present and incompatible → fail.

## `PROJECT_PROFILE.yaml` Merge Policy

`workflow:install` rules for `PROJECT_PROFILE.yaml`:

- Absent → render from bundle-embedded profile scaffold template and write.
- Present → merge workflow-owned sections only; do not rewrite target-project semantics.

### Workflow-Owned Sections

- `project.primary_hosts`
- `runtime.package_manager`
- `runtime.module_system`
- `paths.workflow_template_directories`
- `paths.generated_artifacts` (workflow-related items only)
- `boundaries.workflow_owned_paths`
- `validation.matrix`

### Target-Project-Owned Sections (Preserved)

- `project.name`
- `project.slug`
- `project.type`
- `project.summary`
- `runtime.languages`
- `runtime.build_commands`
- `runtime.test_commands`
- `runtime.dev_commands`
- `paths.source_directories`
- `paths.documentation_files`
- `boundaries.forbidden_paths`
- `architecture_rules`
- `decision_types`
- `governance.*`

### Profile Scaffold Defaults

When scaffolding a new `PROJECT_PROFILE.yaml`, the following defaults apply:

- `project.name` / `slug` → prefer target `package.json.name`; fall back to target directory name.
- `project.primary_hosts` → prefer existing `.claude` / `.agents` / `.factory` directory markers; then explicit `--host` flag; then current runtime host.
- `runtime.package_manager` → `bun`
- `runtime.module_system` → `esm`
- `validation.matrix` → seed with workflow-system protocol entries + 4 A4 project slots.
- `boundaries.forbidden_paths` → seed with `.git/**`, `node_modules/**`.

## Frozen Guard And Safety Boundary

`workflow:install`, `workflow:adopt`, and host sync must reuse the project governance frozen determination — not invent a separate check.

### Frozen Determination Sources

- `FREEZE_REGISTRY.md`
- File header `@frozen` / `DO NOT MODIFY` markers
- Higher-level governance rules

### Enforcement

Any planned write that hits a frozen determination is blocked before the first write of the entire command.

### Failure Report Categories

The failure report must distinguish:

- `frozen_path` — target path is frozen by governance.
- `local_drift` — managed file was modified locally since last install.
- `contract_conflict` — bundle contract conflicts with target project state.
- `incompatible_target` — target project fails a prerequisite (e.g., CommonJS).

### v1 Limitations

v1 does not provide `--force` to override frozen or drift failures.

## Public Interfaces

Commands:

- `workflow:pack [--out-dir <path>] [--include-tests]`
- `workflow:install --bundle <dir> [--root <target>] [--host <claude|codex|factory>] [--dry-run]`
- `workflow:adopt [--root <target>] [--host <claude|codex|factory>] [--dry-run]`

Files:

- `workflow-bundle.json` — bundle manifest (inside bundle directory)
- `.workflow-system/install-state.json` — install state (inside target project)

### A1 / A3 Responsibility Split

`workflow:manifest` and protocol runtime contracts are updated so:

- A1 covers import + merge + scaffold only.
- A3 covers generation + classify + absent-doc materialization + health + host sync only.
- `workflow:manifest.import_contract` reflects this boundary. `gen:all`, `workflow:health`, and host sync are no longer attributed to the install phase.

### Locked Adoption Boundary

Automation is intentionally locked to the `A3` safety boundary.

Allowed automatic adoption behavior:

- materialize absent live docs from generated skeletons
- materialize the target-project governance baseline
- preserve runtime placeholders in `CURRENT_TASK.md`
- run health checks
- run host sync

Explicitly not automatic in v1:

- merge-safe update of existing live docs
- structural refresh of existing live docs
- task identity invention or implicit task slug generation during initial adoption
- automatic resolution of project-specific validation commands

For existing live docs:

- bootstrap classification and diff planning must still run
- the tool may emit proposed actions and diff previews
- the tool must not automatically modify existing live docs

## Workstreams

This plan uses packaging-specific workstreams rather than reusing `P1-P11`.

### W1. Bundle Manifest And Export

Goal:

Create a real bundle export capability that converts the current repository workflow-system engine into a distributable directory package.

Deliverables:

- `workflow:pack`
- `workflow-bundle.json`
- stable bundle output layout under `dist/workflow-system/`

Acceptance:

- one command exports a complete bundle
- exported bundle contents match the manifest
- bundle excludes unrelated `gstack` subsystems

### W2. Installer And `package.json` Merge

Goal:

Create a target-project installer that imports the workflow-system engine and merges the minimum runtime contract without touching unrelated project behavior.

Deliverables:

- `workflow:install`
- workflow-only `package.json` merge logic
- workflow-owned file copy logic

Acceptance:

- installer works on an empty target project
- installer preserves unrelated `package.json` fields and scripts
- rerunning install is safe and idempotent

### W3. Target Profile Scaffold

Goal:

Make installation produce a usable target-project `PROJECT_PROFILE.yaml` baseline without requiring manual authoring before first run.

Deliverables:

- profile scaffold behavior for missing profile
- patch behavior for incomplete profile
- minimum validation matrix seeding

Acceptance:

- target project can run workflow commands after install without hand-authoring a profile from scratch
- seeded matrix preserves protocol-level entries and unbound project-level slots

### W4. Safe `A3` Adoption Command

Goal:

Create an adoption command that completes the safe first-run baseline for a target project.

Deliverables:

- `workflow:adopt`
- generation step
- bootstrap step
- absent-doc materialization step
- health verification step
- host sync step

Acceptance:

- a target project can reach the live-doc baseline through one adoption command
- absent docs materialize safely
- existing live docs remain diff-only and untouched

### W5. Upgrade / Repack Flow

Goal:

Make the workflow-system upgradable after the source repository changes.

Deliverables:

- repeatable pack flow
- repeatable install flow
- bundle version reporting

Acceptance:

- new bundle versions can be installed over existing workflow-system imports
- workflow-owned engine files upgrade cleanly
- target live docs and non-workflow files are preserved

### W6. Docs And Test Coverage

Goal:

Document and verify the workflow-system packaging and adoption product as a supported capability rather than an implied future step.

Deliverables:

- protocol/runtime contract updates
- packaging/adoption plan documentation
- workflow tests for pack / install / adopt behavior

Acceptance:

- new commands and boundaries are documented in repository-owned governance docs
- tests cover nominal install, repeat install, and host-isolation behavior

## Acceptance Criteria

This plan is complete when all of the following are true:

- one command can export a workflow-system bundle from the current repository
- one command can install that bundle into an empty target project
- one command can complete first adoption to the `A3` safety boundary inside the target project
- repeat installation upgrades the workflow-owned engine surface without corrupting existing live docs
- host sync in the target project only touches the isolated `workflow-system-*` namespace

## Test Plan

### Pack

- Same source state, repeated pack → `bundle_id` and checksums stable.
- Source changes but version unchanged → output directory and `bundle_id` change.
- `workflow-bundle.json` artifact list matches actual bundle contents.
- `--include-tests` correctly controls optional test artifacts.

### Install

- Empty target project → scaffold `package.json`, `PROJECT_PROFILE.yaml`, and managed files successfully.
- Existing `package.json` → preserve unrelated keys, merge only workflow-owned keys.
- Existing `PROJECT_PROFILE.yaml` → merge only workflow-owned sections.
- Target project is CommonJS → fail immediately, no auto-migration.
- Managed file with local drift → upgrade fails with zero writes.
- Any target path frozen → entire install produces zero writes.
- `--dry-run` → full plan output, zero writes.

### Adopt

- Only absent live docs are materialized.
- Existing live docs remain untouched; classify / diff-only report is output.
- `CURRENT_TASK.md` runtime placeholders are preserved; no task identity generated.
- Target-project A4 validation commands are not executed.
- Host sync only touches `workflow-system-*` namespace.
- `--dry-run` → full plan output, zero writes.

### Upgrade

- Unmodified managed files upgrade from old bundle to new bundle.
- User-modified managed files trigger drift conflict.
- Package / profile workflow-owned fragments upgrade; target-owned content preserved.

### End-To-End

- `pack → install → adopt` on an empty repository target succeeds.
- `pack → install → adopt` on a target with existing live docs materializes only absent docs.
- Host sync failure does not pollute live docs or non-workflow host artifacts.

## Important Implementation Notes

- this document is a standalone plan, not an appendix to the historical incubation plan
- this document must not duplicate the full artifact inventory verbatim; it should summarize and reference it
- the imported artifact checklist, target-project layout, and command boundaries are intentionally promoted into explicit sections so they remain normative
- the current repository already contains the protocol / generator / runtime foundation needed for packaging
- the missing closure is specifically `pack`, `install`, and safe `adopt`
- this document intentionally keeps packaging and adoption in one file because they are one engineering closure loop, not two unrelated efforts

## Assumptions And Defaults

- v1 only supports Bun + ESM target projects; non-ESM projects are not auto-migrated.
- `workflow:manifest` is the canonical contract. `workflow-bundle.json` must not diverge from its semantics; it may only add bundle-specific metadata.
- v1 does not support automatic resolution of managed-file drift, frozen override, or existing live doc merge-safe refresh.
- v1 does not treat target-project generated outputs as source of truth to copy into the bundle; the target project must regenerate locally.
- this plan adds a new document only; it does not rewrite the historical `P1-P11` phase history.
- this document is the planning home for packaging and adoption, not a second artifact inventory.
