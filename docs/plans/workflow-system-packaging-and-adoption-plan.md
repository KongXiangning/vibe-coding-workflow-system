# Workflow System Packaging And Adoption Plan

Status: Complete
Owner: kongx
Last-Updated: 2026-04-05
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
- A file ownership matrix classifies every target path into one of six modes — `replace-managed`, `merge-managed`, `live-doc`, `runtime-host`, `install-infrastructure`, `scaffold-once` — eliminating ad-hoc override rules at implementation time.
- `workflow:install` and `workflow:adopt` both perform a full preflight before any writes; if any planned write hits a frozen rule or local drift conflict, the entire command fails before the first write.
- Bundle identity is no longer based solely on `package.json.version`. It is now `workflow_system_version + source_tree_hash`, with the output directory fixed to `dist/workflow-system/workflow-system-<version>+<source-tree-hash-short>/`, resolving the conflict when source changes but the version does not.

Completion note:

- W1-W6 are now implemented in-repo.
- `workflow:pack`, `workflow:install`, and `workflow:adopt` are shipped as supported runtime commands.
- acceptance criteria and packaging/adoption regression coverage were reviewed against the repository state on 2026-04-05 and found aligned with this plan.

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
- a target-local `VERSION` scaffold
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
  VERSION
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

- `paths.workflow_template_directories` → fixed: `["templates/docs", "templates/skills"]`. These are directory identifiers (not glob patterns) used by generators to locate template sources.
- `paths.generated_artifacts` (workflow portion) → fixed: `["generated/workflow-docs/**", "generated/workflow-skills/**", "SKILL_REGISTRY.md"]`. Uses `**` glob suffix per the `repoPatternMatchesPath()` grammar so that individual files within the directories are matched. `SKILL_REGISTRY.md` is included because it is generated by `gen:registry` during the adopt phase. Source-repo-specific paths (e.g., `browse/dist/**`) are excluded.
- `boundaries.workflow_owned_paths` → derived from the ownership matrix's `replace-managed` paths plus `PROJECT_PROFILE.yaml`. Concretely: all 12 managed scripts, `templates/docs/**`, `templates/skills/**`, `WORKFLOW_PROTOCOL.md`, `FILE_SCHEMAS.md`, `PROJECT_PROFILE.yaml`. Source-repo-specific entries are excluded.
- `validation.matrix_seed` → selection rule: include protocol-level entries where `blocker_level === 'blocks-generator'` (these validate generator output structure via `--dry-run` and work without external test infrastructure), plus all `layer === 'project'` placeholder slots. Exclude protocol-level `blocks-merge` entries (test commands like `bun run test:workflow-skills`) because they depend on optional test file imports that the target project may not have.
- `boundaries.forbidden_paths_seed` → fixed: `[".git/**", "node_modules/**"]`
- `runtime.*` → fixed: `{ "package_manager": "bun", "module_system": "esm" }`

The template also includes **target-project-owned defaults** — sensible starting values for fields that generators and validators require but which the target project owns after scaffold. These defaults are only written when the profile is scaffolded from scratch (absent target). They are never touched during upgrade merges. Required by:

- `projectPlaceholders()` (workflow-core.ts L143-153): `project.type`, `runtime.languages`, `runtime.test_commands`, `decision_types`, `paths.source_directories`, `boundaries.forbidden_paths`, `architecture_rules`
- `validateProfilePathSemantics()` (workflow-core.ts L340-362): `paths.documentation_files`, `paths.existing_skill_template_patterns`, `boundaries.generated_only_paths`, `governance.current_documents`

Without these defaults, a freshly scaffolded profile would fail on the first `gen:all` or `workflow:health` run.

The template is not a separate file in the bundle output directory.

`profile_scaffold_template` schema:

```json
{
  "schema_version": 1,
  "project": {
    "type": "application",
    "summary": "TODO: describe this project"
  },
  "runtime": {
    "languages": ["TypeScript"],
    "package_manager": "bun",
    "module_system": "esm",
    "build_commands": [],
    "test_commands": ["bun test"],
    "dev_commands": []
  },
  "paths": {
    "source_directories": ["scripts"],
    "documentation_files": ["README.md"],
    "workflow_template_directories": ["templates/docs", "templates/skills"],
    "existing_skill_template_patterns": ["*/SKILL.md.tmpl", "SKILL.md.tmpl"],
    "generated_artifacts": ["generated/workflow-docs/**", "generated/workflow-skills/**", "SKILL_REGISTRY.md"]
  },
  "boundaries": {
    "forbidden_paths": [".git/**", "node_modules/**"],
    "generated_only_paths": ["generated/workflow-docs/**", "generated/workflow-skills/**", "SKILL_REGISTRY.md"],
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
    ]
  },
  "architecture_rules": [
    "Keep workflow automation and generators in scripts/.",
    "Treat templates/skills/ as workflow skill template sources, not runtime outputs.",
    "Do not hand-edit generated outputs."
  ],
  "decision_types": ["mechanical", "taste", "user_challenge"],
  "governance": {
    "current_documents": [
      "PROJECT_PROFILE.yaml",
      "WORKFLOW_PROTOCOL.md",
      "FILE_SCHEMAS.md",
      "SKILL_REGISTRY.md"
    ],
    "planned_documents": []
  },
  "validation": {
    "matrix_seed": [
      { "name": "workflow-skills-validation", "layer": "protocol", "command": "bun run gen:workflow-skills --dry-run", "blocker_level": "blocks-generator", "description": "Validate workflow skill templates.", "phase": "P9", "owner": "workflow-system" },
      { "name": "workflow-docs-validation", "layer": "protocol", "command": "bun run gen:workflow-docs --dry-run", "blocker_level": "blocks-generator", "description": "Validate generated governance doc structure.", "phase": "P9", "owner": "workflow-system" },
      { "name": "registry-validation", "layer": "protocol", "command": "bun run gen:registry --dry-run", "blocker_level": "blocks-generator", "description": "Validate registry generation.", "phase": "P9", "owner": "workflow-system" },
      { "placeholder": true, "name": "unit", "layer": "project", "command": "", "blocker_level": "blocks-merge", "description": "Bind target project unit-test command during A4.", "phase": "A4", "owner": "target-project" },
      { "placeholder": true, "name": "integration", "layer": "project", "command": "", "blocker_level": "blocks-merge", "description": "Bind target project integration-test command during A4.", "phase": "A4", "owner": "target-project" },
      { "placeholder": true, "name": "e2e-smoke", "layer": "project", "command": "", "blocker_level": "blocks-merge", "description": "Bind target project smoke validation during A4.", "phase": "A4", "owner": "target-project" },
      { "placeholder": true, "name": "contract-compatibility", "layer": "project", "command": "", "blocker_level": "blocks-merge", "description": "Bind target project contract checks during A4.", "phase": "A4", "owner": "target-project" }
    ]
  }
}
```

**Scaffold section ownership summary:**

| Section | Owner | Scaffold behavior | Upgrade behavior |
|---------|-------|-------------------|------------------|
| `runtime.package_manager/module_system` | workflow | Written from template | Merge (exact-match) |
| `paths.workflow_template_directories` | workflow | Written from template | Merge (superset) |
| `paths.generated_artifacts` | workflow | Written from template | Merge (superset) |
| `boundaries.workflow_owned_paths` | workflow | Written from template | Merge (superset) |
| `validation.matrix` | workflow | Seeded from template | Merge (additive) |
| `project.primary_hosts` | workflow | Derived at install time | Merge (additive) |
| `project.name/slug` | target | Derived at install time | Never touched |
| `project.type/summary` | target | Defaults from template | Never touched |
| `runtime.languages/test_commands/...` | target | Defaults from template | Never touched |
| `paths.source_directories/documentation_files` | target | Defaults from template | Never touched |
| `boundaries.forbidden_paths/generated_only_paths` | target | Defaults from template | Never touched |
| `architecture_rules` | target | Defaults from template | Never touched |
| `decision_types` | target | Defaults from template | Never touched |
| `governance.*` | target | Defaults from template | Never touched |

`validation.matrix_seed` extends the real `PROJECT_PROFILE.yaml` validation-entry schema with one bundle-only metadata field: `"placeholder": true` for A4 target-project slots. When the scaffold is rendered into `PROJECT_PROFILE.yaml`, every seeded entry is emitted as an **active YAML item** inside `validation.matrix` with the real parser-required fields (`name`, `layer`, `command`, `blocker_level`, `description`, `phase`, `owner`). For placeholder slots, the renderer omits the bundle-only `placeholder` field and keeps `command: ""`, leaving them as real unbound project-level slots rather than comments. Optional explanatory YAML comments may be added adjacent to those entries, but the entries themselves must remain present in `validation.matrix` so downstream parsing and additive merges work. `project.name`, `project.slug`, and `project.primary_hosts` are not in the template — they are derived at install time from the target project context (see Profile Scaffold Defaults below).

### Bundle Identity Rules

`bundle_id` format is fixed: `workflow-system@<version>+<source-tree-hash-short>`.

`workflow_system_version` is read from the source repository's `package.json` `version` field at pack time (see `workflow-runtime.ts` L445). This is the single authoritative source; the `VERSION` file is not used.

`source_tree_hash` is computed over all `EXPORT_ARTIFACTS` source files used to produce this bundle — regardless of whether those files appear verbatim in the bundle output directory. This means:

- `script`, `protocol`, and `template` category source files are included (they also appear as bundle output files).
- `config` category: only `package.json` is included — its content directly determines the bundle's `package_json_contract` field. `PROJECT_PROFILE.yaml` is **excluded** because the `profile_scaffold_template` is curated from hardcoded values and the ownership matrix, not extracted from the source profile. Changes to the source repository's `PROJECT_PROFILE.yaml` (e.g., adding gstack-specific paths) do not alter the bundle.
- `test` category source files are included only when `--include-tests` is specified.

Therefore:

- A pack without `--include-tests` hashes required script + protocol + template + `package.json` source files.
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

`EXPORT_ARTIFACTS` entries with `category: 'config'` (`package.json`, `PROJECT_PROFILE.yaml`) are not copied to the target project as files. Their handling is asymmetric:

- `package.json` — pack reads it to generate the `package_json_contract` field. Included in `source_tree_hash` because its content directly determines the contract.
- `PROJECT_PROFILE.yaml` — pack does **not** read it. The `profile_scaffold_template` is curated from hardcoded values and the ownership matrix, not extracted from the source profile. **Excluded** from `source_tree_hash`.

`PROJECT_PROFILE.yaml` remains in `EXPORT_ARTIFACTS` because `workflow:manifest` reports it as a required import artifact (target projects need to know they need a profile), and the manifest's `import_contract` references it. Removing it from `EXPORT_ARTIFACTS` would break the manifest's completeness. The pack command simply skips it during hash computation and bundle content generation.

Only entries with `category` values of `script`, `protocol`, `template`, and `test` produce actual files in the bundle output directory.

### Relationship To `workflow:manifest`

`workflow:manifest` is the canonical contract. `workflow-bundle.json` must not diverge from its semantics. The bundle JSON may only add bundle-specific metadata (identity, checksums, timestamps) on top of the manifest contract.

The `profile_scaffold_template` in `workflow-bundle.json` is bundle-specific metadata — it does not exist in the manifest. The manifest declares that a profile is required; the bundle provides the means to scaffold one. This is analogous to the manifest declaring required scripts while the bundle provides the actual files.

## Ownership Matrix And Upgrade Rules

Every target path belongs to exactly one ownership mode. This matrix is normative and must not be extended at implementation time without updating this plan. There are six modes: `replace-managed`, `merge-managed`, `live-doc`, `runtime-host`, `install-infrastructure`, and `scaffold-once`.

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

### `scaffold-once`

Paths:

- `VERSION`

Rules:

- File absent during `workflow:install` → create.
- Scaffold value derives from target `package.json.version` if present and non-empty; otherwise use `0.0.0`.
- File present → `workflow:install` and `workflow:adopt` never modify it.
- Not tracked in `managed_files[]` and not treated as workflow-owned for upgrade drift detection; it is a target-project-owned bootstrap prerequisite.
- Subject to frozen checks like all other planned writes.

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

`host_sync_state` is a map keyed by host name (`claude`, `codex`, `factory`). Each entry records the sync namespace, timestamp, and synced entries for that host independently. `workflow:install` initializes the map with the `--host` value (or detected host) as a placeholder entry shaped exactly as:

```json
{
  "namespace": "workflow-system-*",
  "synced_at": null,
  "synced_entries": []
}
```

`synced_at: null` means "host selected but never successfully synced yet". `workflow:adopt --host <host>` updates only that host's entry after successful sync, preserving other hosts' state. This allows sequential `workflow:adopt --host claude` then `workflow:adopt --host codex` without losing the first host's sync record.

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
   - `VERSION` scaffold written if absent.
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

- `gen:all` is executed into a temporary workspace directory, not the target project's `generated/` tree. The mechanism is: create a temp directory, copy `PROJECT_PROFILE.yaml`, `VERSION`, all `templates/` content, and all `scripts/` content into it, then invoke `gen:all` with the `WORKFLOW_SYSTEM_ROOT` environment variable pointing to the temp directory. Existing generators (`gen-workflow-skills.ts`, `gen-workflow-docs.ts`, `gen-registry.ts`) already resolve their root via `resolveRoot()` which respects this env var (see `workflow-core.ts` L91-94). `gen-workflow-docs.ts` additionally reads `VERSION` from root (L28), which is why it must be included.
- Bootstrap classify is also invoked with `WORKFLOW_SYSTEM_ROOT=<temp-dir>` set (so that `resolveRoot()` returns the temp dir as `systemRoot`), **plus** `--target-root <temp-dir>` (so that `targetRoot` also points to the temp workspace). Bootstrap has a dual-root model (`systemRoot` for reading `generated/` outputs, `targetRoot` for reading profile and live docs — see `bootstrap-project-governance.ts` L652-654). Both roots must point to the temp workspace; otherwise bootstrap would fall back to the source repository root for generated docs, violating the dry-run isolation.
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
- Present → merge workflow-owned sections only; do not rewrite target-project semantics. **Additionally**, run a preflight completeness check: verify that all fields required by `projectPlaceholders()`, `validateProfilePathSemantics()`, and bootstrap planning metadata extraction exist in the target profile. If any required field is missing, fail with `incompatible_target` and list the missing fields. This prevents install from succeeding while leaving the profile in a state that would immediately fail `gen:all`, `workflow:health`, or bootstrap classify. The installer does not patch missing target-owned fields — the target project must add them manually.

Required fields for preflight completeness check (must all be present and non-empty):

- `project.name`, `project.slug`, `project.type` (from bootstrap planning / `projectPlaceholders`)
- `runtime.languages`, `runtime.test_commands` (from `projectPlaceholders`)
- `decision_types`, `architecture_rules` (from `projectPlaceholders`)
- `paths.source_directories` (from `projectPlaceholders`)
- `boundaries.forbidden_paths` (from `projectPlaceholders`)
- `paths.documentation_files`, `paths.existing_skill_template_patterns` (from `validateProfilePathSemantics`)
- `paths.generated_artifacts`, `boundaries.generated_only_paths`, `boundaries.workflow_owned_paths` (from `validateProfilePathSemantics`)
- `governance.current_documents` (from `validateProfilePathSemantics`)

### Workflow-Owned Sections

- `project.primary_hosts`
- `runtime.package_manager`
- `runtime.module_system`
- `paths.workflow_template_directories`
- `paths.generated_artifacts` (workflow-related items only)
- `boundaries.workflow_owned_paths`
- `validation.matrix`

### Target-Project-Owned Sections (Preserved)

These sections are written with sensible defaults during scaffold (absent profile) but are **never touched** during upgrade merges. After scaffold, the target project owns them completely.

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
- `paths.existing_skill_template_patterns`
- `boundaries.forbidden_paths`
- `boundaries.generated_only_paths`
- `architecture_rules`
- `decision_types`
- `governance.*`

These fields are required by `projectPlaceholders()` (workflow-core.ts L143-153) and `validateProfilePathSemantics()` (workflow-core.ts L340-362). A scaffolded profile missing any of them would fail on the first `gen:all` or `workflow:health` run.

### Profile Scaffold Defaults

When scaffolding a new `PROJECT_PROFILE.yaml`, the following defaults apply. All other sections use the values from `profile_scaffold_template` (see schema above).

- `project.name` / `slug` → prefer target `package.json.name`; fall back to target directory name.
- `project.primary_hosts` → prefer explicit `--host` flag; otherwise fall back to directory markers (`.claude` / `.agents` / `.factory`); otherwise current runtime host. This is the same precedence used by `workflow:install`; explicit CLI input always wins over auto-detection.
- `runtime.package_manager` → `bun`
- `runtime.module_system` → `esm`
- `validation.matrix` → seed with `blocks-generator` protocol entries (3 validators) + 4 A4 project placeholder slots. `blocks-merge` protocol entries (test commands) are excluded from scaffold because they depend on optional test file imports.
- `boundaries.workflow_owned_paths` → seed with all `replace-managed` paths from the ownership matrix plus `PROJECT_PROFILE.yaml`.
- `boundaries.forbidden_paths` → seed with `.git/**`, `node_modules/**`.
- All target-project-owned defaults (`project.type`, `runtime.languages`, `paths.source_directories`, `architecture_rules`, `decision_types`, `governance.*`, etc.) → values from `profile_scaffold_template`. The target project should customize these after install.

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

The `--host` flag on `workflow:install` does not change which `replace-managed` files are installed (those are always host-agnostic). It only affects: (1) the initial `host_sync_state` entry recorded in install-state, and (2) the `project.primary_hosts` default when scaffolding a new `PROJECT_PROFILE.yaml`. Precedence is fixed as: explicit `--host` flag → ENV override → directory marker → existing profile. If `--host` is omitted, the command follows the remaining fallback chain.

## Public Interfaces

Commands:

- `workflow:pack [--out-dir <path>] [--include-tests] [--json]`
- `workflow:install --bundle <dir> [--root <target>] [--host <claude|codex|factory>] [--dry-run] [--json]`
- `workflow:adopt [--root <target>] [--host <claude|codex|factory>] [--dry-run] [--json]`

`--root` defaults to the current working directory (`process.cwd()`). It must point to the target project root (the directory containing or that will contain `package.json`). If `--root` is a subdirectory of a git repository, the command does **not** walk up to the git root — it uses the specified (or cwd) directory literally.

Files:

- `workflow-bundle.json` — bundle manifest (inside bundle directory)
- `.workflow-system/install-state.json` — install state (inside target project)

## 使用说明

本节是 v1 打包 / 安装 / 首次采用流程的操作说明。它规定执行顺序、参数含义、预期输出，以及将 bundle 交给其他工程师或自动化系统时必须附带的最小上下文。

### 推荐执行顺序

v1 的标准执行顺序如下：

1. 在源 workflow-system 仓库执行 `workflow:pack`。
2. 将生成的 bundle 目录传输到目标环境。
3. 在目标项目执行 `workflow:install --dry-run`。
4. 如果 install dry-run 结果干净，再执行真实 `workflow:install`。
5. 在目标项目执行 `workflow:adopt --dry-run`。
6. 如果 adopt dry-run 结果干净，再执行真实 `workflow:adopt`。
7. 如果需要多个 host，则对剩余 host 逐个执行 `workflow:adopt --host <host>`。

常规规则：

- `workflow:pack` 只在源仓库执行。
- `workflow:install` 与 `workflow:adopt` 只在目标项目执行。
- 对一个新的目标状态，第一次真实 `install` 和第一次真实 `adopt` 之前都应先跑 `--dry-run`。

### 命令说明

#### `workflow:pack`

用途：

- 生成可分发的 workflow-system 目录 bundle
- 计算 bundle 身份与校验信息
- 输出 `workflow-bundle.json`

命令：

```bash
bun run workflow:pack [--out-dir <path>] [--include-tests] [--json]
```

参数：

- `--out-dir <path>`：覆盖默认 bundle 输出父目录；省略时输出到 `dist/workflow-system/`
- `--include-tests`：将可选协议测试文件一并打入 bundle，并纳入 `source_tree_hash` 计算
- `--json`：向 stdout 输出机器可读的 pack report

操作说明：

- 该命令只能在源 workflow-system 仓库执行
- 执行后需要记录 `bundle_id`、输出目录、`source_commit`，以及是否使用了 `--include-tests`
- v1 的产物是目录 bundle，不要求额外再打成 zip/tar

预期输出：

- bundle 目录：`dist/workflow-system/workflow-system-<version>+<source-tree-hash-short>/`，除非使用 `--out-dir` 覆盖父目录
- `workflow-bundle.json`
- 打包后的脚本、协议文档、模板，以及可选测试文件

#### `workflow:install`

用途：

- 将 workflow-system engine 导入目标项目
- 合并 workflow-owned 的 `package.json` 与 `PROJECT_PROFILE.yaml` 契约片段
- 创建 `.workflow-system/install-state.json`

命令：

```bash
bun run workflow:install --bundle <dir> [--root <target>] [--host <claude|codex|factory>] [--dry-run] [--json]
```

参数：

- `--bundle <dir>`：必填，指向打包好的 workflow-system bundle 目录
- `--root <target>`：目标项目根目录；默认值为 `process.cwd()`
- `--host <claude|codex|factory>`：记录本次 install 的初始 host；只影响 host 默认值和 install-state，host-agnostic managed files 不因 host 而变化
- `--dry-run`：只生成并输出 install plan，不进行任何 repo-tracked 写入
- `--json`：向 stdout 输出机器可读的 install report

推荐执行步骤：

1. 执行 `workflow:install --bundle <dir> --root <target> --host <host> --dry-run --json`
2. 检查是否存在 `frozen_path`、`local_drift`、`contract_conflict`、`incompatible_target`
3. 如果结果干净，去掉 `--dry-run` 后按相同参数重新执行

操作说明：

- 如果已经知道目标 host，首次 install 应显式传 `--host`；CLI 显式输入优先级最高
- 如果目标仓库已经存在 `PROJECT_PROFILE.yaml`，在预期 install 成功前应先确认 target-owned required fields 完整
- 如果 install 以 `incompatible_target` 失败，需要先手工修复目标项目后再重跑；v1 不会自动补齐 target-owned incomplete profile 字段

预期输出：

- workflow-managed 脚本、模板、协议文档写入目标路径
- `package.json` 中的 workflow fragment 合并完成
- 若目标缺少 `VERSION`，则自动 scaffold
- `PROJECT_PROFILE.yaml` 被 scaffold 或 merge
- `.workflow-system/install-state.json` 最后写入

#### `workflow:adopt`

用途：

- 在目标项目执行安全的 A3 首次采用流程
- 在本地重新生成 workflow outputs
- 只 materialize 缺失的 live governance docs
- 执行 health checks 并同步所选 host 命名空间

命令：

```bash
bun run workflow:adopt [--root <target>] [--host <claude|codex|factory>] [--dry-run] [--json]
```

参数：

- `--root <target>`：目标项目根目录；默认值为 `process.cwd()`
- `--host <claude|codex|factory>`：adopt 时要同步的 host 命名空间
- `--dry-run`：以隔离 dry-run 模式执行生成与规划，零 repo-tracked 写入
- `--json`：向 stdout 输出机器可读的 adopt report

推荐执行步骤：

1. 执行 `workflow:adopt --root <target> --host <host> --dry-run --json`
2. 查看计划中的 absent-doc materialization、health 预期、host sync 目标
3. 如果结果干净，去掉 `--dry-run` 后重新执行
4. 如果还需要其他 host，则对每个额外 host 单独执行 `workflow:adopt --root <target> --host <other-host>`

操作说明：

- `workflow:adopt` 依赖先前一次成功的 `workflow:install`
- v1 不会自动修改已有 live docs；只会 materialize 缺失文件
- 第二次 adopt 是正常操作；它通常会重新执行 `gen:all`、`workflow:health` 和 host sync

预期输出：

- 重新生成 `generated/workflow-docs/`、`generated/workflow-skills/`、`SKILL_REGISTRY.md`
- 仅当 live docs 缺失时才写入新文件
- host sync 写入 `.agents/skills/workflow-system-*`、`.claude/skills/workflow-system-*` 或 `.factory/skills/workflow-system-*`
- 只有成功的 host 才会更新对应的 `host_sync_state`

### 标准端到端流程

#### 空目标项目

适用于目标项目此前从未安装过 workflow-system。

1. 源仓库：`bun run workflow:pack --json`
2. 将生成的 bundle 目录传输到目标环境
3. 目标仓库：`bun run workflow:install --bundle <bundle-dir> --root <target-root> --host <host> --dry-run --json`
4. 目标仓库：`bun run workflow:install --bundle <bundle-dir> --root <target-root> --host <host> --json`
5. 目标仓库：`bun run workflow:adopt --root <target-root> --host <host> --dry-run --json`
6. 目标仓库：`bun run workflow:adopt --root <target-root> --host <host> --json`

预期结果：

- 目标项目达到 A3 baseline
- workflow-owned 文件安装完成
- generated outputs 在目标项目本地重新生成
- 缺失的 live docs 被 materialize
- 所选 host 完成同步

#### 已有目标项目

适用于目标项目已经存在 `package.json`、`PROJECT_PROFILE.yaml`、live docs，或者已经安装过旧版本 workflow-system。

1. 先执行 `workflow:install --dry-run`
2. 处理 `contract_conflict`、`local_drift`、`frozen_path`、`incompatible_target`
3. 执行真实 `workflow:install`
4. 执行 `workflow:adopt --dry-run`
5. 检查 existing live docs 的 diff-only report
6. 如果 A3 计划可接受，再执行真实 `workflow:adopt`

预期结果：

- workflow-owned engine surface 被安装或升级
- 已存在的 live docs 保持不变
- 只有缺失的 live docs 会被 materialize

#### 升级已有安装

适用于源仓库发生变化，需要把新 bundle 安装到已存在 workflow-system import 的目标项目。

1. 源仓库重新执行 `workflow:pack` 并记录新的 `bundle_id`
2. 目标仓库执行 `workflow:install --bundle <new-bundle-dir> --root <target-root> --dry-run --json`
3. 处理 drift 或 contract failures
4. 执行真实 `workflow:install`
5. 执行 `workflow:adopt --dry-run`
6. 执行真实 `workflow:adopt`

预期结果：

- 未被修改的 workflow-managed files 原地升级
- 被用户修改过的 managed files 以 drift conflict 失败
- target-owned profile 内容与 live docs 保持不变

### 最小交接内容

当 bundle 被交给其他工程师、团队或自动化系统时，必须至少附带以下上下文：

- `bundle_id`
- bundle 目录路径
- `workflow_system_version`
- `source_commit`
- 是否使用了 `--include-tests`
- 目标项目根目录
- 目标 host 或 host 列表
- 目标项目当前属于空仓、已有项目、还是已有安装升级场景
- 对已有 profile 是否必须在 install 前阻断不完整状态
- 期望执行的完整命令顺序

最小交接示例：

```text
Bundle: workflow-system@1.2.3+abc123def456
Path: /path/to/workflow-system-1.2.3+abc123def456/
Source commit: 0123456789abcdef
Include tests: no
Target root: /repo/example-project
Initial host: codex
Run order:
  1. bun run workflow:install --bundle /path/to/workflow-system-1.2.3+abc123def456 --root /repo/example-project --host codex --dry-run --json
  2. bun run workflow:install --bundle /path/to/workflow-system-1.2.3+abc123def456 --root /repo/example-project --host codex --json
  3. bun run workflow:adopt --root /repo/example-project --host codex --dry-run --json
  4. bun run workflow:adopt --root /repo/example-project --host codex --json
```

### 每个阶段需要检查的内容

在执行 `workflow:pack` 之前：

- 确认当前源仓库状态就是要交付的状态
- 决定是否需要把可选测试一并打包

在执行真实 `workflow:install` 之前：

- 确认 `--bundle` 路径指向预期 bundle 目录
- 确认 `--root` 路径指向预期目标仓库根目录
- 确认所选 host 正确
- 检查 dry-run 输出中是否有 drift、frozen path、contract incompatibility

在执行真实 `workflow:adopt` 之前：

- 检查哪些 live docs 缺失并将被 materialize
- 检查已有 live docs 的 diff-only 输出
- 确认所选 host namespace 正确
- 确认 dry-run report 中没有意外的 health 或 sync targets

在执行 `workflow:adopt` 之后：

- 验证 host sync 只触碰了 `workflow-system-*` 命名空间
- 验证 generated outputs 是在目标项目中本地生成的，而不是从源 bundle 复制进来的
- 验证 `.workflow-system/install-state.json` 中写入了预期的 host sync entry

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
- preflight completeness check for existing profile (fail-fast if missing required fields, do not silently patch)
- minimum validation matrix seeding

Acceptance:

- target project can run workflow commands after install without hand-authoring a profile from scratch
- existing incomplete profile → install fails with clear list of missing fields
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
- Empty target project → scaffold `VERSION` so that `gen:workflow-docs` can run immediately.
- Existing `package.json` → preserve unrelated keys, merge only workflow-owned keys.
- Existing `PROJECT_PROFILE.yaml` → merge only workflow-owned sections.
- Existing `PROJECT_PROFILE.yaml` missing required target-owned fields (e.g., `project.slug`, `project.type`) → fail with `incompatible_target` listing missing fields.
- Existing target with missing `VERSION` → scaffold `VERSION` from `package.json.version` or `0.0.0`.
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
- Existing `VERSION` remains untouched across upgrade.

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
