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
- A file ownership matrix classifies every target path into one of five modes — `replace-managed`, `merge-managed`, `live-doc`, `runtime-host`, `install-infrastructure` — eliminating ad-hoc override rules at implementation time.
- `workflow:install` and `workflow:adopt` both perform a full preflight before any writes; if any planned write hits a frozen rule or local drift conflict, the entire command fails before the first write.
- Bundle identity is no longer based solely on `package.json.version`. It is now `workflow_system_version + source_tree_hash`, with the output directory fixed to `dist/workflow-system/workflow-system-<version>+<source-tree-hash-short>/`, resolving the conflict when source changes but the version does not.

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
  .workflow-system/
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
dist/workflow-system/workflow-system-<version>+<source-tree-hash-short>/
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
- `profile_scaffold_template`
- `post_install`
- `verification`
- `import_contract`
- `host_compatibility`
- `includes_optional_tests`

`profile_scaffold_template` is a structured object embedded directly in `workflow-bundle.json`. It contains the curated default values, section structure, and seed data needed to render a new `PROJECT_PROFILE.yaml` in a target project. It is **not** extracted from the source repository's `PROJECT_PROFILE.yaml` — the source profile contains repository-specific values (e.g., gstack's `browse/dist/**`, `design/dist/**`) that must not leak into target project scaffolds. Instead, the pack command builds the template from the bundle contract and the ownership matrix as follows:

- `paths.workflow_template_directories` → fixed: `["templates/docs", "templates/skills"]`
- `paths.generated_artifacts` (workflow portion) → fixed: `["generated/workflow-docs", "generated/workflow-skills"]`. These are the workflow system's generation output directories. Source-repo-specific paths (e.g., `browse/dist/**`) are excluded.
- `boundaries.workflow_owned_paths` → derived from the ownership matrix's `replace-managed` paths plus `PROJECT_PROFILE.yaml`. Concretely: all 12 managed scripts, `templates/docs/**`, `templates/skills/**`, `WORKFLOW_PROTOCOL.md`, `FILE_SCHEMAS.md`, `PROJECT_PROFILE.yaml`. Source-repo-specific entries are excluded.
- `validation.matrix_seed` → selection rule: include protocol-level entries where `blocker_level === 'blocks-generator'` (these validate generator output structure via `--dry-run` and work without external test infrastructure), plus all `layer === 'project'` placeholder slots. Exclude protocol-level `blocks-merge` entries (test commands like `bun run test:workflow-skills`) because they depend on optional test file imports that the target project may not have.
- `boundaries.forbidden_paths_seed` → fixed: `[".git/**", "node_modules/**"]`
- `runtime.*` → fixed: `{ "package_manager": "bun", "module_system": "esm" }`

The template is not a separate file in the bundle output directory.

`profile_scaffold_template` schema:

```json
{
  "runtime": {
    "package_manager": "bun",
    "module_system": "esm"
  },
  "paths": {
    "workflow_template_directories": ["templates/docs", "templates/skills"],
    "generated_artifacts": ["generated/workflow-docs", "generated/workflow-skills"]
  },
  "boundaries": {
    "workflow_owned_paths": [
      "scripts/workflow-core.ts",
      "scripts/repo-path-patterns.ts",
      "scripts/workflow-doc-contracts.ts",
      "scripts/task-identity.ts",
      "scripts/bootstrap-project-governance.ts",
      "scripts/validation-model.ts",
      "scripts/run-validation.ts",
      "scripts/check-freshness.ts",
      "scripts/gen-workflow-skills.ts",
      "scripts/gen-workflow-docs.ts",
      "scripts/gen-registry.ts",
      "scripts/workflow-runtime.ts",
      "templates/docs/**",
      "templates/skills/**",
      "WORKFLOW_PROTOCOL.md",
      "FILE_SCHEMAS.md",
      "PROJECT_PROFILE.yaml"
    ],
    "forbidden_paths_seed": [".git/**", "node_modules/**"]
  },
  "validation": {
    "matrix_seed": [
      { "name": "workflow-skills-validation", "layer": "protocol", "command": "bun run gen:workflow-skills --dry-run", "blocker_level": "blocks-generator", "description": "Validate workflow skill templates.", "owner": "workflow-system" },
      { "name": "workflow-docs-validation", "layer": "protocol", "command": "bun run gen:workflow-docs --dry-run", "blocker_level": "blocks-generator", "description": "Validate generated governance doc structure.", "owner": "workflow-system" },
      { "name": "registry-validation", "layer": "protocol", "command": "bun run gen:registry --dry-run", "blocker_level": "blocks-generator", "description": "Validate registry generation.", "owner": "workflow-system" },
      { "placeholder": true, "name": "unit", "layer": "project", "command": "", "blocker_level": "blocks-merge", "description": "Bind target project unit-test command during A4.", "owner": "target-project" },
      { "placeholder": true, "name": "integration", "layer": "project", "command": "", "blocker_level": "blocks-merge", "description": "Bind target project integration-test command during A4.", "owner": "target-project" },
      { "placeholder": true, "name": "e2e-smoke", "layer": "project", "command": "", "blocker_level": "blocks-merge", "description": "Bind target project smoke validation during A4.", "owner": "target-project" },
      { "placeholder": true, "name": "contract-compatibility", "layer": "project", "command": "", "blocker_level": "blocks-merge", "description": "Bind target project contract checks during A4.", "owner": "target-project" }
    ]
  }
}
```

Placeholder entries in `validation.matrix_seed` (those with `"placeholder": true`) are scaffolded as commented-out YAML entries in the rendered `PROJECT_PROFILE.yaml`, indicating where the target project should bind its own commands during Adoption A4. Non-placeholder entries (protocol-level validators) are scaffolded as active entries. The `matrix_seed` schema matches the real `PROJECT_PROFILE.yaml` validation matrix structure (`name`, `layer`, `command`, `blocker_level`, `description`, `owner`). `project.name`, `project.slug`, and `project.primary_hosts` are not in the template — they are derived at install time from the target project context (see Profile Scaffold Defaults below).

### Bundle Identity Rules

`bundle_id` format is fixed: `workflow-system@<version>+<source-tree-hash-short>`.

`workflow_system_version` is read from the source repository's `package.json` `version` field at pack time (see `workflow-runtime.ts` L445). This is the single authoritative source; the `VERSION` file is not used.

`source_tree_hash` is computed over all `EXPORT_ARTIFACTS` source files used to produce this bundle — regardless of whether those files appear verbatim in the bundle output directory. This means:

- `script`, `protocol`, and `template` category source files are included (they also appear as bundle output files).
- `config` category source files (`package.json`, `PROJECT_PROFILE.yaml`) are included because their content affects the bundle's `package_json_contract` and profile scaffold. They are not copied to the bundle output directory but their changes alter the bundle contract.
- `test` category source files are included only when `--include-tests` is specified.

Therefore:

- A pack without `--include-tests` hashes required script + protocol + template + config source files.
- A pack with `--include-tests` hashes all of the above plus optional test source files.
- The two produce different `source_tree_hash` values and therefore different `bundle_id` values and output directories.

Changes to unrelated repository files (README, browse subsystem, etc.) never affect the hash. The hash algorithm is SHA-256, truncated to 12 hex characters for `bundle_id` and stored in full in `source_tree_hash`.

#### `source_tree_hash` Computation Algorithm

The exact algorithm is:

1. Enumerate all included source files from `EXPORT_ARTIFACTS` (filtered by `--include-tests`).
2. Expand glob entries (`templates/docs/**`, `templates/skills/**`) to concrete file paths.
3. Normalize every path to forward-slash separators (regardless of host OS) and sort lexicographically (byte-order ascending).
4. For each file in sorted order, compute: `SHA-256(utf8(normalized_path) + 0x00 + raw_file_bytes)`. The `0x00` null byte separator prevents path/content boundary ambiguity.
5. Collect all per-file hex digests into a sorted list (already sorted by path order from step 3).
6. Concatenate all hex digests (no separator) and compute `SHA-256` of the concatenated string (UTF-8 encoded).
7. The result is the full `source_tree_hash`. Truncate to the first 12 hex characters for `source-tree-hash-short` in `bundle_id`.

This algorithm ensures: (a) deterministic output regardless of OS glob expansion order, (b) no collision between files whose concatenated content is identical but whose path boundaries differ, and (c) reproducibility across Windows and Unix systems via forward-slash normalization and binary-mode reads.

`source_commit` is the HEAD git commit SHA at pack time. `workflow:pack` does not require a clean git working tree. If there are uncommitted changes to included files, the `source_tree_hash` will reflect the actual file content on disk (which may differ from `source_commit`). The bundle metadata does not assert that `source_commit` matches `source_tree_hash`; consumers should treat `source_tree_hash` as the authoritative identity and `source_commit` as an advisory reference for traceability.

All file checksums (artifact checksums in `workflow-bundle.json`, managed file checksums in `install-state.json`) use SHA-256 over raw byte content with no line-ending normalization. Install and upgrade tools must read files in binary mode for checksum comparison to avoid CRLF/LF discrepancies on Windows.

Idempotency rule:

- Same source state + same flags, repeated pack → identical `bundle_id`, directory name, and artifact checksums.
- Source state changes but version does not → different `bundle_id` and output directory.
- `--include-tests` vs no `--include-tests` on the same source state → different `bundle_id` and output directory.
- `created_at` is a wallclock timestamp and is explicitly excluded from the idempotency assertion. It does not affect `bundle_id`, directory name, or artifact checksums.

The `artifacts` list in `workflow-bundle.json` must be the resolved list of actual bundle content files plus their checksums; abstract globs are not permitted. `workflow-bundle.json` itself is excluded from the `artifacts` list and from the `source_tree_hash` computation — it is the manifest, not an artifact. Bundle integrity is verified by confirming that every listed artifact matches its checksum and that no unlisted files exist in the bundle directory (aside from `workflow-bundle.json` itself).

`package.json` is not copied wholesale from the source repository into the target project. The bundle only exposes the `package_json_contract` fragment.

### EXPORT_ARTIFACTS Category Handling

`EXPORT_ARTIFACTS` entries with `category: 'config'` (`package.json`, `PROJECT_PROFILE.yaml`) are not copied to the target project as files. The pack command consumes them to generate the `package_json_contract` field and the `profile_scaffold_template` object embedded in `workflow-bundle.json`. Only entries with `category` values of `script`, `protocol`, `template`, and `test` produce actual files in the bundle output directory. However, all categories (including `config`) contribute to the `source_tree_hash` computation.

### Relationship To `workflow:manifest`

`workflow:manifest` is the canonical contract. `workflow-bundle.json` must not diverge from its semantics. The bundle JSON may only add bundle-specific metadata (identity, checksums, timestamps) on top of the manifest contract.

## Ownership Matrix And Upgrade Rules

Every target path belongs to exactly one ownership mode. This matrix is normative and must not be extended at implementation time without updating this plan. There are five modes: `replace-managed`, `merge-managed`, `live-doc`, `runtime-host`, and `install-infrastructure`.

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

The authoritative source of truth for the managed script list is the `EXPORT_ARTIFACTS` constant in `scripts/workflow-runtime.ts` (category `'script'`, `required: true`). This plan, `REQUIRED_PACKAGE_SCRIPTS`, and any pack/install logic must derive from that constant. When adding or removing a workflow engine script, update `EXPORT_ARTIFACTS` first, then propagate.

Rules:

- File absent → create.
- File exists and matches last-install checksum → overwrite on upgrade.
- File exists but does not match last-install checksum → local drift; install fails and reports conflict; no automatic overwrite.

For `replace-managed` glob directories (`templates/docs/**`, `templates/skills/**`), the bundle's file set is the complete set. Files present in the target directory but absent from the bundle are pruned during install/upgrade, provided they are tracked in install-state from a prior install. Files that exist in the target but were never installed by the workflow system are left untouched.

### `merge-managed`

Paths:

- `package.json`
- `PROJECT_PROFILE.yaml`

Rules:

- Only workflow-owned fragments are operated on.
- **First install (no install-state exists):**
  - Workflow-owned fragment absent in target → write the bundle contract value.
  - Workflow-owned fragment present and compatible with the bundle contract → accept the existing value and record it as the baseline in install-state.
  - Workflow-owned fragment present but incompatible → fail with `contract_conflict`; do not overwrite.
  - **Compatibility definition for `package.json`** (per key type):
    - `scripts[gen:*]`, `scripts[bootstrap:*]`, `scripts[validate:*]`, `scripts[workflow:*]` — compatible if and only if the existing value is **byte-identical** to the bundle contract value. Any difference (even whitespace) is `contract_conflict`.
    - `dependencies.yaml` — compatible if the existing value is a semver range that **intersects** the bundle contract range (evaluated via `semver.intersects`). Exact match is not required. Disjoint ranges are `contract_conflict`.
    - `engines.bun` — compatible if the existing value, parsed as a semver range, is **satisfied by** the bundle contract's minimum version (evaluated via `semver.satisfies(bundleMin, existingRange)`). If the existing range would exclude the bundle's required minimum, it is `contract_conflict`.
  - **Compatibility definition for `PROJECT_PROFILE.yaml`** (per section type):
    - **Exact-match sections** (`runtime.package_manager`, `runtime.module_system`): compatible if and only if the existing value is **identical** to the bundle contract value (e.g., `"bun"`, `"esm"`). Any other value is `contract_conflict`.
    - **Superset sections** (`paths.workflow_template_directories`, `paths.generated_artifacts`, `boundaries.workflow_owned_paths`): compatible if the existing array **contains all** bundle-required entries (extra target-project entries are preserved). If any bundle-required entry is missing, it is written (merged in). This never triggers `contract_conflict` — missing entries are added, extra entries are kept.
    - **Additive sections** (`project.primary_hosts`, `validation.matrix`): always compatible. Bundle seed entries are merged into the existing array without removing existing entries. Duplicate entries (by identity key: host name for `primary_hosts`, `name` field for `validation.matrix`) are not duplicated.
    - If the entire `PROJECT_PROFILE.yaml` workflow-owned section is absent in target, it is written from the bundle's `profile_scaffold_template`. If the section is present, the per-section rules above apply.
- **Upgrade install (install-state exists):**
  - Target fragment matches last-install value → upgrade to new bundle value.
  - Target fragment was modified by the user → install fails and reports `local_drift`; no automatic write-back.

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

### Unmanaged Paths

The following target paths appear in the project layout but are not managed by install or adopt:

- `SKILL_REGISTRY.md` — generated artifact; produced by `gen:registry` during the adopt phase. Not tracked in install-state. Re-generated on each `workflow:adopt` or manual `gen:all`.
- `generated/workflow-docs/` — generated artifacts; produced by `gen:workflow-docs`. Not tracked in install-state. `workflow:install` does not touch this directory. `workflow:adopt` regenerates it via `gen:all`.
- `generated/workflow-skills/` — generated artifacts; produced by `gen:workflow-skills`. Same policy as `generated/workflow-docs/`.

These paths are owned by the target project's local generation cycle, not by the bundle.

### `install-infrastructure`

Paths:

- `.workflow-system/install-state.json`

Rules:

- Created and updated exclusively by `workflow:install` and `workflow:adopt`.
- Not sourced from the bundle (not a bundle artifact).
- Not user-editable — manual edits may cause drift detection failures on next install.
- Subject to frozen checks like all other planned writes.
- Ownership mode exists to close the matrix; no other paths use this mode in v1.

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
- `host_sync_state` (keyed by host name)
  - `namespace`
  - `synced_at`
  - `synced_entries[]` (skill name + target path)

`managed_files[]` only tracks `replace-managed` paths (whole-file ownership). The `mode` field is currently always `replace-managed` but is included for forward compatibility if additional managed modes are introduced later. `merge-managed` paths (`package.json`, `PROJECT_PROFILE.yaml`) are tracked separately via `package_json_fragment` and `project_profile_fragment`, which record only the workflow-owned key/value pairs — not the full file content.

`package_json_fragment` serialization format: a nested JSON object mirroring the `package.json` structure, containing only workflow-owned keys. Example:

```json
{
  "scripts": {
    "gen:workflow-skills": "bun run scripts/gen-workflow-skills.ts",
    "workflow:health": "bun run scripts/workflow-runtime.ts health"
  },
  "dependencies": { "yaml": "^2.7.1" },
  "engines": { "bun": ">=1.0.0" }
}
```

`project_profile_fragment` serialization format: a nested JSON object mirroring the `PROJECT_PROFILE.yaml` structure (converted from YAML to JSON), containing only workflow-owned sections. Example:

```json
{
  "runtime": { "package_manager": "bun", "module_system": "esm" },
  "paths": { "workflow_template_directories": ["templates/docs", "templates/skills"] },
  "boundaries": { "workflow_owned_paths": ["scripts/workflow-*.ts"] },
  "validation": { "matrix": [...] }
}
```

Both fragments are **deep-compared** against the current target file content during upgrade drift detection. The comparison extracts the same key paths from the current target file and compares values using deep equality (not string comparison of serialized forms).

`host_sync_state` is a map keyed by host name (`claude`, `codex`, `factory`). Each entry records the sync namespace, timestamp, and synced entries for that host independently. `workflow:install` initializes the map with the `--host` value (or detected host) as a placeholder entry. `workflow:adopt --host <host>` updates only that host's entry after successful sync, preserving other hosts' state. This allows sequential `workflow:adopt --host claude` then `workflow:adopt --host codex` without losing the first host's sync record.

Recovery: If `install-state.json` is missing but managed files already exist in the target project (e.g., deleted manually or lost after a clone), `workflow:install` treats this as a first-install scenario. Existing managed files that match the bundle's expected content are accepted and recorded as baseline. Files that differ trigger `contract_conflict` since there is no prior baseline to compare against. Users who lose install-state must either ensure managed files match the bundle or delete them before re-installing.

### `.workflow-system/` Directory Tracking

`.workflow-system/` must be committed to the target repository (not gitignored). It contains the install-state that is required for upgrade detection and drift comparison. Without it, `workflow:install` cannot distinguish first install from upgrade and may fail on existing managed files.

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
6. Output machine-readable install report (JSON format, schema versioned via `report_version` field).

Partial failure during step 5: If a write fails after preflight passed (e.g., disk full, permission error), the command aborts immediately with a non-zero exit code. Already-written files are not rolled back. `install-state.json` is written last; if it is absent after a failed run, the next `workflow:install` treats the project as first-install and re-evaluates all managed files. This is safe because first-install rules accept files matching the bundle content.

### `workflow:adopt` Transaction Flow

1. Read install state. Require that a bundle was installed successfully.
2. Execute `gen:all`. If `gen:all` fails (non-zero exit), abort the entire adopt with exit code 1. No subsequent steps execute.
3. Execute bootstrap classify / dry-run.
4. Generate materialize plan for absent live docs only.
5. Execute frozen check against planned materializations + host sync targets.
6. On pass → write absent docs, execute `workflow:health`, execute host sync.
7. If health or host sync fails → do not roll back already-materialized absent docs, but output an explicit failure report and do not modify any existing live docs.

Install-state update rules for `workflow:adopt`:

- Adopt does not modify `managed_files[]`, `bundle_id`, `workflow_system_version`, `package_json_fragment`, or `project_profile_fragment` — those are install-time fields.
- Adopt only updates `host_sync_state` in install-state, and only after **successful** host sync for the target host.
- If health fails (sync never executes) → install-state is **not** modified.
- If host sync fails → install-state is **not** modified for that host. Other hosts' entries are untouched.
- If host sync succeeds → install-state is updated atomically: the host's `host_sync_state` entry is written with the new `synced_at`, `namespace`, and `synced_entries[]`.

Partial failure during step 6 (write absent docs): If writing one absent doc fails (e.g., permission error), the command aborts immediately. Already-written absent docs are not rolled back — they are live-doc files now owned by the target project. Health and host sync do not execute. The failure report lists which docs were written and which failed.

Both commands must support `--dry-run`. Dry-run outputs the full plan / report but performs zero repo-tracked writes.

`--dry-run` behavior for `workflow:adopt`:

- `gen:all` is executed into a temporary workspace directory, not the target project's `generated/` tree. The mechanism is: create a temp directory, copy `PROJECT_PROFILE.yaml`, `VERSION`, all `templates/` content, and all `scripts/` content into it, then invoke `gen:all` with the `WORKFLOW_SYSTEM_ROOT` environment variable pointing to the temp directory. Existing generators (`gen-workflow-skills.ts`, `gen-workflow-docs.ts`, `gen-registry.ts`) already resolve their root via `resolveRoot()` which respects this env var (see `workflow-core.ts` L91-94). `gen-workflow-docs.ts` additionally reads `VERSION` from root (L28), which is why it must be included. Bootstrap classify is invoked with `--target-root <temp-dir>`, which it already accepts.
- Bootstrap classify and materialize planning run against the temporary generated outputs.
- The full plan (including what would be materialized, health check expectations, and host sync targets) is reported.
- On exit, the temporary workspace is cleaned up. No files are written to the target project.

## `package.json` Merge Policy

`workflow:install` rules for `package.json`:

- Target file absent → scaffold a minimal Bun + ESM `package.json` with exactly these keys:
  ```json
  {
    "name": "<derived-from-directory-name>",
    "version": "0.0.0",
    "private": true,
    "type": "module",
    "scripts": { /* workflow-owned scripts from bundle contract */ },
    "dependencies": { "yaml": "<bundle-contract-value>" },
    "engines": { "bun": "<bundle-contract-value>" }
  }
  ```
  `name` is the target directory's basename, lowercased, with spaces replaced by hyphens. `version` starts at `0.0.0`. `private: true` prevents accidental npm publish. All workflow-owned keys are populated from the bundle's `package_json_contract`.
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
  - Present and the existing semver range is satisfied by the bundle contract's minimum version → preserve the existing value.
  - Present and the existing semver range excludes the bundle contract's minimum version → fail with `contract_conflict`.

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
- `validation.matrix` → seed with `blocks-generator` protocol entries (3 validators) + 4 A4 project placeholder slots. `blocks-merge` protocol entries (test commands) are excluded from scaffold because they depend on optional test file imports.
- `boundaries.workflow_owned_paths` → seed with all `replace-managed` paths from the ownership matrix plus `PROJECT_PROFILE.yaml`.
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

### Exit Codes

All workflow commands use the following exit code mapping:

- `0` — success.
- `1` — general failure (runtime error, I/O error).
- `2` — preflight failure: `frozen_path` or `local_drift` detected.
- `3` — contract failure: `contract_conflict` or `incompatible_target`.

### Report Format

All machine-readable reports (install report, adopt report, dry-run output) are JSON objects written to stdout. Each report includes a `report_version` field (integer, starting at 1) to support forward-compatible schema evolution. Human-readable summaries are written to stderr when `--json` is not specified.

### v1 Limitations

- v1 does not provide `--force` to override frozen or drift failures.
- v1 does not provide a `workflow:uninstall` command. To remove the workflow system from a target project, delete the files listed in `.workflow-system/install-state.json` `managed_files[]`, reverse the `package_json_fragment` and `project_profile_fragment` merges manually, then delete the `.workflow-system/` directory.
- v1 distributes bundles as directory copies (e.g., `cp -r`, `rsync`, git submodule, or manual transfer). No registry publish or fetch protocol is provided.

### Multi-Host Install

A single `workflow:install` execution targets one host at a time. To install for multiple hosts, run `workflow:install` once (host-agnostic managed files are written), then `workflow:adopt --host <host>` separately for each host. Alternatively, `--host all` may be supported in a future version but is not part of v1.

The `--host` flag on `workflow:install` does not change which `replace-managed` files are installed (those are always host-agnostic). It only affects: (1) the initial `host_sync_state` entry recorded in install-state, and (2) the `project.primary_hosts` default when scaffolding a new `PROJECT_PROFILE.yaml`. If omitted, the host is auto-detected via the standard 4-level fallback (CLI → ENV → directory marker → profile).

## Public Interfaces

Commands:

- `workflow:pack [--out-dir <path>] [--include-tests] [--json]`
- `workflow:install --bundle <dir> [--root <target>] [--host <claude|codex|factory>] [--dry-run] [--json]`
- `workflow:adopt [--root <target>] [--host <claude|codex|factory>] [--dry-run] [--json]`

`--root` defaults to the current working directory (`process.cwd()`). It must point to the target project root (the directory containing or that will contain `package.json`). If `--root` is a subdirectory of a git repository, the command does **not** walk up to the git root — it uses the specified (or cwd) directory literally.

Files:

- `workflow-bundle.json` — bundle manifest (inside bundle directory)
- `.workflow-system/install-state.json` — install state (inside target project)

### A1 / A3 Responsibility Split

`workflow:manifest` and protocol runtime contracts are updated so:

- A1 covers import + merge + scaffold only.
- A3 covers generation + classify + absent-doc materialization + health + host sync only.
- `workflow:manifest.import_contract` reflects this boundary. `gen:all`, `workflow:health`, and host sync are no longer attributed to the install phase.
- `ExportManifest.post_install` is an informational field listing commands the user (or the adopt command) should run after install completes. These commands are A3 steps executed by `workflow:adopt`, not part of the `workflow:install` transaction.

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

Dependency order: W1 → {W2 ∥ W3} → W4 → W5 → W6. W2 and W3 may be implemented in parallel once W1 is complete. W4 depends on both W2 and W3. W5 depends on W1 + W2 + W3. W6 runs continuously but completes after W5.

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
- Same source state with `--include-tests` vs without → different `bundle_id` and output directory.
- `workflow-bundle.json` is excluded from artifact checksums; bundle integrity verified via artifact list completeness.

### Install

- Empty target project → scaffold `package.json`, `PROJECT_PROFILE.yaml`, and managed files successfully.
- Existing `package.json` → preserve unrelated keys, merge only workflow-owned keys.
- Existing `PROJECT_PROFILE.yaml` → merge only workflow-owned sections.
- Target project is CommonJS → fail immediately, no auto-migration.
- Managed file with local drift → upgrade fails with zero writes.
- Any target path frozen → entire install produces zero writes.
- First install with existing compatible workflow-owned fragment → accept and record as baseline.
- First install with existing incompatible workflow-owned fragment → fail with `contract_conflict`.
- First install with existing `PROJECT_PROFILE.yaml` where `runtime.package_manager != "bun"` → fail with `contract_conflict`.
- First install with existing `PROJECT_PROFILE.yaml` where `paths.workflow_template_directories` has extra entries → compatible; bundle entries merged, extra preserved.
- First install with existing `PROJECT_PROFILE.yaml` where `validation.matrix` has existing entries → additive merge; no entries removed.
- Recovery from missing install-state with matching managed files → succeed as first-install.
- Recovery from missing install-state with non-matching managed files → fail with `contract_conflict`.
- `--dry-run` → full plan output, zero writes.

### Adopt

- Only absent live docs are materialized.
- Existing live docs remain untouched; classify / diff-only report is output.
- `CURRENT_TASK.md` runtime placeholders are preserved; no task identity generated.
- Target-project A4 validation commands are not executed.
- Host sync only touches `workflow-system-*` namespace.
- Sequential adopt for different hosts preserves each host's sync state in install-state independently.
- Second adopt run (all docs already exist) → zero materializations, re-runs gen:all / health / host sync only.
- `gen:all` failure → adopt aborts with exit code 1, no absent docs written, no health/sync.
- Absent doc write partial failure → already-written docs preserved, health/sync not executed, failure report lists written and failed docs.
- Health failure → install-state `host_sync_state` not modified.
- Host sync failure → install-state `host_sync_state` not modified for that host.
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
