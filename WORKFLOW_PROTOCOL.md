# Workflow Protocol

```yaml
Protocol-Version: 0.1.0
Status: Formal Spec
Last-Updated: 2026-04-02
```

This file defines the execution rules for the workflow skill system.

Its purpose is narrower than `vibe-coding-workflow.md`:

- `vibe-coding-workflow.md` explains the full methodology
- `WORKFLOW_PROTOCOL.md` defines the concrete rules the generator must follow

### Versioning scheme

This protocol uses semantic versioning:

- **Major** — breaking change to generator contract (field removed, enum value renamed, validation rule changed in a way that rejects previously-valid input)
- **Minor** — new optional feature or section that does not break existing generators
- **Patch** — clarification, typo fix, or example addition with no behavioral impact

Generators must declare which protocol version they target. A generator targeting `0.x` must accept that the protocol is still stabilizing and breaking changes may occur without a major bump until `1.0.0`.

---

## Freeze status

This protocol is currently under **partial freeze evaluation**, not full freeze.

Interpret this file using the following boundary:

- the `P1-P6` implemented surface is the current stable baseline
- `P7a-P11` remain open for future extension and must not be read as already implemented unless execution code and tests exist
- updates should extend or clarify the protocol without silently rewriting already-aligned `P1-P6` semantics

For the authoritative freeze boundary and update rules, see [`docs/plans/workflow-protocol-freeze-boundary.md`](./docs/plans/workflow-protocol-freeze-boundary.md).

---

## 1. Inputs to the generator

The workflow skill generator must treat the following inputs as authoritative:

1. `PROJECT_PROFILE.yaml`
2. `templates/skills/*.SKILL.md.tmpl`

The generator must not infer project facts from chat context alone.

If a required value is missing from `PROJECT_PROFILE.yaml`, generation must fail loudly instead of silently defaulting.

Methodology references such as `vibe-coding-workflow.md` may inform template authoring and review, but they are not direct machine inputs in the current implemented generators.

### 1.1 Input precedence

When multiple sources define the same value, the following precedence applies (highest first):

1. **`WORKFLOW_PROTOCOL.md`** — protocol rules are always authoritative. A generator must not override protocol-defined constraints with project-level or template-level values.
2. **`PROJECT_PROFILE.yaml`** — project configuration takes precedence over template defaults.
3. **Template defaults** — values embedded in `.tmpl` files are the lowest-priority source.

Conflict resolution rules:

- If `PROJECT_PROFILE.yaml` defines a value that contradicts a protocol rule, the protocol rule wins and the conflict must be logged as a warning.
- If a template embeds a default that `PROJECT_PROFILE.yaml` also defines, the profile value wins silently.
- Chat context, LLM inference, and runtime conversation history are never authoritative for protocol or project values. They may inform task-level placeholders only.

---

## 2. Output model

The workflow skill generator must emit generated skills into a dedicated output root:

```text
generated/workflow-skills/
```

Each generated skill should use this naming rule:

```text
<skill-name>.SKILL.md
```

Examples:

- `generated/workflow-skills/create-current-task.SKILL.md`
- `generated/workflow-skills/implement-current-step.SKILL.md`
- `generated/workflow-skills/review-diff.SKILL.md`

This output root is intentionally separated from:

- existing repo-native `*/SKILL.md`
- host runtime install locations
- `templates/skills/*.SKILL.md.tmpl`

That separation avoids colliding with the existing gstack build pipeline while the workflow skill system is still under development.

---

## 3. Variable substitution rules

The generator must expand template variables from `PROJECT_PROFILE.yaml` using deterministic mapping.

### 3.0 Placeholder grammar

Placeholder syntax:

```
{{UPPER_SNAKE_CASE}}
```

Rules:

- Delimiters are exactly `{{` and `}}` with no whitespace inside the braces.
- Names must be `[A-Z][A-Z0-9_]*` (uppercase ASCII letters, digits, underscores; must start with a letter).
- Nesting is not supported. `{{OUTER_{{INNER}}}}` is invalid.
- Conditional logic is not supported. Placeholders are simple string substitution only.
- Escaping: literal `{{` in output is not a supported use case in v0. If a template needs literal double braces, the generator must not interpret them as placeholders — but no escaping mechanism is defined. Templates must avoid ambiguous sequences.

Placeholder categories:

| Category | Behavior | Error on unresolved? | Examples |
|----------|----------|---------------------|----------|
| Project-level | Must be expanded from `PROJECT_PROFILE.yaml` | Yes — hard fail | `{{PROJECT_NAME}}`, `{{TECH_STACK}}` |
| Runtime (task-level) | Must be preserved as literal placeholder text | No — intentionally unresolved | `{{TASK_ID}}`, `{{TASK_SLUG}}` |
| Docs-specific runtime | Must be preserved as literal placeholder text | No — intentionally unresolved | `{{TASK_TITLE}}`, `{{DATE}}`, `{{AUTHOR}}` |
| Docs-specific project | Must be expanded | Yes — hard fail | `{{VERSION}}` |

Complete placeholder table:

| Placeholder | Category | Source | Used by |
|-------------|----------|--------|---------|
| `{{PROJECT_NAME}}` | Project | `project.name` | skills, docs, registry |
| `{{PROJECT_TYPE}}` | Project | `project.type` | skills, docs, registry |
| `{{TECH_STACK}}` | Project | `runtime.languages` | skills, docs, registry |
| `{{TEST_COMMANDS}}` | Project | `runtime.test_commands` | skills, docs, registry |
| `{{DECISION_TYPES}}` | Project | `decision_types` | skills, registry |
| `{{CODE_DIRECTORIES}}` | Project | `paths.source_directories` | skills, docs, registry |
| `{{FORBIDDEN_PATHS}}` | Project | `boundaries.forbidden_paths` | skills, docs, registry |
| `{{ARCHITECTURE_RULES}}` | Project | `architecture_rules` | skills, docs, registry |
| `{{VERSION}}` | Docs-project | `VERSION` file | docs |
| `{{TASK_ID}}` | Runtime | Task context (bootstrap/runtime) | skills, docs |
| `{{TASK_SLUG}}` | Runtime | Task context (bootstrap/runtime) | skills, docs |
| `{{TASK_TITLE}}` | Docs-runtime | Task context (bootstrap/runtime) | docs |
| `{{DATE}}` | Docs-runtime | Task context (bootstrap/runtime) | docs |
| `{{AUTHOR}}` | Docs-runtime | Task context (bootstrap/runtime) | docs |

### 3.1 Core project variables

| Template variable | Source in `PROJECT_PROFILE.yaml` |
|---|---|
| `{{PROJECT_NAME}}` | `project.name` |
| `{{PROJECT_TYPE}}` | `project.type` |
| `{{TECH_STACK}}` | `runtime.languages` |
| `{{TEST_COMMANDS}}` | `runtime.test_commands` |
| `{{DECISION_TYPES}}` | `decision_types` |

### 3.2 Structure variables

| Template variable | Source in `PROJECT_PROFILE.yaml` |
|---|---|
| `{{CODE_DIRECTORIES}}` | `paths.source_directories` |
| `{{FORBIDDEN_PATHS}}` | `boundaries.forbidden_paths` |
| `{{ARCHITECTURE_RULES}}` | `architecture_rules` |

### 3.3 Task and archive variables

The following variables are runtime task values rather than static project facts:

- `{{TASK_ID}}`
- `{{TASK_SLUG}}`

These should remain unexpanded in template output unless the generator is run with explicit task context.

For the initial generator version:

- expand project-level variables
- preserve task-level variables as placeholders

---

## 4. Project-type specialization rules

The generator must specialize skills by project type.

Supported project types in Protocol-Version `0.1.0`:

- `frontend-app`
- `backend-service`
- `fullstack-app`
- `ai-engineering-workflow`
- `tooling-cli`

### 4.1 Frontend-oriented projects

Must emphasize:

- page / component / state boundaries
- UI regression and smoke checks
- interaction and empty-state validation

### 4.2 Backend-oriented projects

Must emphasize:

- API contract stability
- schema / migration risk
- transaction and auth boundaries

### 4.3 Fullstack projects

Must emphasize:

- frontend / backend / database split
- end-to-end regression checks
- DTO and event naming consistency

### 4.4 Tooling / workflow systems

Must emphasize:

- script boundaries
- generated artifact discipline
- host compatibility
- documentation synchronization

The current repo (`gstack`) should be treated as:

```text
ai-engineering-workflow
```

which behaves most like a tooling / workflow system.

Current implementation:

- the workflow skill generator appends a `## Project-Type Emphasis` section to each rendered skill body
- that section is derived from `project.type` in `PROJECT_PROFILE.yaml`
- Protocol-Version `0.1.0` currently defines emphasis text only for:
  - `frontend-app`
  - `backend-service`
  - `fullstack-app`
  - `ai-engineering-workflow`
  - `tooling-cli`
- an unknown `project.type` still fails earlier through required profile validation, but no additional emphasis block is generated unless the type is explicitly mapped by the generator

---

## 4a. Canonical stage enum

The workflow system defines exactly 10 stage groups. Generators must validate that all stages are represented.

| Canonical ID | Display name (Chinese) | Purpose | Phase |
|-------------|----------------------|---------|-------|
| `init` | 初始化 | Project governance initialization | Setup |
| `phase-1-intake` | 阶段 1：需求进入 | Task creation and intake | Planning |
| `phase-2-scope-lock` | 阶段 2：范围锁定 | Scope review and lock | Planning |
| `phase-3-decomposition` | 阶段 3：方案拆解 | Decision classification and task decomposition | Planning |
| `phase-4-implementation` | 阶段 4：小步实现 | Step-by-step implementation | Execution |
| `phase-4-6-exception` | 阶段 4/6：实现或验证异常 | Exception handling during implementation or regression | Execution |
| `phase-5-scope-review` | 阶段 5：范围复核 | Review diff and verify contracts | Review |
| `phase-6-regression` | 阶段 6：回归验证 | Regression verification | Review |
| `phase-7-sync` | 阶段 7：状态同步 | Sync task, status, contracts, decisions | Sync |
| `phase-8-delivery` | 阶段 8：交付沉淀 | Capture lessons, prepare summary, archive | Delivery |

### 4a.1 Validation rules

- Generators must accept both the canonical ID and the Chinese display name when reading the `stage` field from templates.
- Generators must validate that the rendered skill set covers **all 10 stage groups** (not 8 — the `phase-4-6-exception` stage is distinct).
- The canonical ID is the protocol-level identifier. The display name is an alias for human readability.
- A stage value that matches neither the canonical ID nor the display name is invalid and must cause generation to fail.
- Multiple skills may belong to the same stage. The minimum required coverage is at least one skill per stage group.

### 4a.2 Stage count clarification

This protocol defines **10 stage groups**, not 8. The original §8 reference to "all 8 workflow stages" was an undercount that omitted:

- `init` (setup, not a numbered phase)
- `phase-4-6-exception` (cross-phase exception handling)

All references in this protocol to stage coverage must use the count of 10.

---

## 5. Skill template contract

### 5.1 Must be expanded by the generator

- `{{PROJECT_NAME}}`
- `{{PROJECT_TYPE}}`
- `{{TECH_STACK}}`
- `{{CODE_DIRECTORIES}}`
- `{{TEST_COMMANDS}}`
- `{{FORBIDDEN_PATHS}}`
- `{{ARCHITECTURE_RULES}}`
- `{{DECISION_TYPES}}`

### 5.2 Must remain as placeholders in Protocol-Version `0.1.0`

- `{{TASK_ID}}`
- `{{TASK_SLUG}}`

### 5.3 Skill metadata schema

These fields are part of the skill protocol and must appear in every skill template frontmatter. The generator may expand values inside these fields but must not change the field structure.

| Field | Type | Required | Validation rule |
|-------|------|----------|----------------|
| `purpose` | `string` | Yes | Non-empty. Describes the skill's role in the workflow. |
| `stage` | `string` | Yes | Must match a canonical ID or display name from §4a. |
| `trigger` | `string` | Yes | Non-empty. Describes when this skill activates. |
| `inputs` | `string[]` | Yes | Non-empty array. Each entry is a path or description of required input. |
| `reads` | `string[]` | Yes | May be empty. Each entry is a path (per §7a path grammar) the skill reads. |
| `writes` | `string[]` | Yes | May be empty (for read-only skills). Each entry is a path the skill writes. |
| `forbidden_writes` | `string[]` | Yes | May be empty. Paths the skill must never write. Must not overlap with `writes`. |
| `must_check` | `string[]` | Yes | Non-empty array. Conditions the skill must verify before completing. |
| `stop_conditions` | `string[]` | Yes | Non-empty array. Conditions that must halt the skill. |
| `output` | `string` | Yes | Non-empty. Describes the skill's output artifact or action. |
| `handoff` | `object` | Yes | Must have exactly two keys: `success` (string) and `failure` (string). See §6 for validation rules. |
| `decision_policy` | `string` | Yes | Non-empty. Describes the skill's decision-making authority. |
| `verification` | `string` | Yes | Non-empty. Describes how to verify the skill completed correctly. |

Notes:

- All `string[]` fields are YAML sequences. A single-element list must still use sequence syntax.
- The `handoff` object must not contain additional keys beyond `success` and `failure`.
- Fields not listed above may appear in templates but are not validated by the protocol. Generators must not silently drop unknown fields.

---

## 6. Handoff graph rules

The generator must validate the full handoff graph after rendering all skills.

### 6.1 Valid targets

`handoff.success` must point to:

- another generated workflow skill

`handoff.failure` may point to:

- another generated workflow skill
- the reserved manual interaction node `ask-user`

### 6.2 Invalid targets

Generation must fail if a handoff points to:

- a missing skill
- an empty value
- a target outside the allowed set above

### 6.3 Required chain coverage

The rendered chain must support:

```text
init-governance
  -> create-current-task
  -> review-current-task
  -> lock-scope
  -> classify-decisions
  -> decompose-task
  -> implement-current-step
  -> review-diff
  -> verify-contracts
  -> run-regression
  -> sync-current-task
  -> sync-status
  -> sync-contracts
  -> sync-decisions
  -> capture-lessons
  -> prepare-delivery-summary
  -> archive-task
```

Plus the failure detour:

```text
run-regression -> investigate-root-cause -> implement-current-step
```

---

## 7. Read / write boundary rules

The generator must validate four things:

### 7.1 Response-only skills

If a skill is analysis-only or review-only, it must render:

```yaml
writes: []
```

### 7.2 Persistent-write skills

If a skill updates governance documents or code, `writes` must contain explicit targets.

Ambiguous values such as:

- `response only`
- `some files`
- `as needed`

are invalid.

### 7.3 Forbidden write conflicts

Generation must fail if:

- a path appears in both `writes` and `forbidden_writes`
- an explicit path is inside a forbidden directory pattern such as `scripts/**`
- a forbidden explicit path is inside an allowed write directory such as `scripts`

Current implementation:

- Protocol-Version `0.1.0` validates overlap conflicts between explicit paths and restricted directory patterns
- Protocol-Version `0.1.0` does **not yet** perform semantic path authorization such as "outside its workflow role" or "writes code paths" classification

### 7.4 Contract-sensitive skills

The following skills are designated non-code-writing in the current templates and generated outputs:

- `review-diff`
- `verify-contracts`
- `run-regression`

Current implementation:

- this requirement is currently realized by template convention and generated output review (`writes: []`)
- the generator does not yet infer which paths are "code paths" and does not apply additional semantic enforcement beyond the explicit `writes` declarations

---

## 7a. Path grammar

Paths appearing in `reads`, `writes`, and `forbidden_writes` must follow these rules.

Boundary note:

- this grammar applies only to workflow contract fields: `reads`, `writes`, and `forbidden_writes`
- other repo-level path and pattern fields in `PROJECT_PROFILE.yaml` may use a separate repo-pattern grammar and are outside this protocol section

### 7a.1 Path format

- Paths are relative to the project root directory.
- Forward slash (`/`) is the separator, regardless of the host OS.
- Paths must not begin with `/` (no absolute paths).
- Paths must not contain `..` (no parent directory traversal).
- Trailing slashes are permitted and denote directories.

### 7a.2 Special path tokens

The following tokens expand to project-specific path sets at generation time:

| Token | Source | Expands to |
|-------|--------|-----------|
| Values from `{{CODE_DIRECTORIES}}` | `paths.source_directories` in `PROJECT_PROFILE.yaml` | One or more directory paths |
| Values from `{{FORBIDDEN_PATHS}}` | `boundaries.forbidden_paths` in `PROJECT_PROFILE.yaml` | One or more explicit paths or restricted directory patterns |

These tokens are expanded during variable substitution (§3). After expansion, the resulting paths must conform to the format rules above.

### 7a.3 Glob patterns

General glob patterns are **not supported** in `reads`, `writes`, or `forbidden_writes` in v0.

The only supported wildcard form is a restricted directory-recursive suffix:

- `dir/**`

This form means "the directory `dir` and all descendant paths under it".

Allowed examples:

- `scripts/**`
- `.git/**`
- `generated/workflow-docs/**`

Invalid examples:

- `*.ts`
- `**/*.md`
- `foo/*`
- `foo/**/bar`
- `**`

### 7a.4 Path validation

A path entry is invalid if it:

- contains `..`
- starts with `/`
- contains null bytes or control characters
- is an empty string
- contains any wildcard form other than a terminal `/**`

Invalid paths must cause generation to fail.

---

## 8. Structural validation

The generator must run structural validation after rendering.

Minimum validation checks:

1. required schema fields exist on every generated skill
2. every handoff target is valid
3. no `writes` / `forbidden_writes` conflict exists
4. all 10 workflow stage groups are represented (see §4a)
5. all placeholders intended for project expansion are resolved
6. task placeholders intentionally preserved in Protocol-Version `0.1.0` remain untouched

If any check fails, the generator must:

- exit non-zero
- print the exact failing skill and field
- avoid writing partial success-shaped output silently

---

## 9. Failure behavior

The generator must fail loudly for:

- missing required profile fields
- unresolved non-task placeholders
- invalid YAML structure in a template
- broken handoff edges
- conflicting read/write boundary definitions

The generator must not:

- silently drop unknown fields
- silently invent fallback values
- silently skip broken templates

---

## 9a. Atomic write rules

All generators must follow a two-phase write protocol.

### 9a.1 Phase 1: Render and validate

- Read all inputs (profile, templates, schemas).
- Render all output artifacts in memory.
- Run all validation checks against the in-memory artifacts.
- If any validation check fails, stop. Do not proceed to phase 2.

### 9a.2 Phase 2: Write

- Only reached if all validations pass.
- Prepare the output location (create directory, clean stale files).
- Write all artifacts to disk.

### 9a.3 Failure guarantees

- If phase 1 fails, **zero files** must be written or modified.
- If the output directory was cleaned during phase 2 preparation and a write then fails, the generator is in an error state. This is an implementation bug, not a protocol-level recovery scenario.
- Generators must not leave partial output that could be mistaken for a successful generation.

### 9a.4 Idempotence

- Running a generator twice with identical inputs must produce identical output.
- Generators must not embed timestamps, random values, or process-specific data in output.

### 9a.5 Dry-run mode

- All generators must support a `--dry-run` flag.
- In dry-run mode, phase 1 (render + validate) executes fully.
- Phase 2 (write) is skipped.
- The generator must report what it would have written (file count, output path) and exit 0 if validation passed.

---

## 9b. Error output format

Generators must emit structured error output to stderr.

### 9b.1 Error object schema

Each error is a JSON object on a single line of stderr:

```json
{
  "generator": "gen:workflow-skills",
  "severity": "error",
  "code": "HANDOFF_001",
  "message": "Invalid handoff.success target",
  "file": "templates/skills/review-diff.SKILL.md.tmpl",
  "field": "handoff.success",
  "details": "Target 'nonexistent-skill' is not in the generated skill set"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `generator` | `string` | Yes | Generator identifier: `gen:workflow-skills`, `gen:workflow-docs`, or `gen:registry` |
| `severity` | `string` | Yes | `"error"` (blocks generation) or `"warning"` (logged, does not block) |
| `code` | `string` | Yes | Namespaced error code (see §9b.2) |
| `message` | `string` | Yes | Human-readable one-line summary |
| `file` | `string` | No | Path to the source file that caused the error |
| `field` | `string` | No | Specific field within the file |
| `details` | `string` | No | Additional context for debugging |

### 9b.2 Error code namespaces

| Prefix | Category | Examples |
|--------|----------|---------|
| `SCHEMA_` | Missing or invalid metadata structure | `SCHEMA_001` missing required field, `SCHEMA_002` invalid metadata structure |
| `HANDOFF_` | Handoff graph errors | `HANDOFF_001` invalid target or structure |
| `PLACEHOLDER_` | Placeholder resolution errors | `PLACEHOLDER_001` unresolved placeholder |
| `STAGE_` | Stage coverage errors | `STAGE_001` missing required stage coverage, `STAGE_002` invalid stage value |
| `PATH_` | Path grammar violations | `PATH_001` invalid path entry |
| `WRITE_` | Write boundary violations | `WRITE_001` writes/forbidden_writes conflict |
| `HEADING_` | Doc heading validation | `HEADING_001` missing required heading |
| `IO_` | Input/output and generator execution errors | `IO_001` input file error, `IO_002` generator execution failed |

Current implementation:

- `scripts/workflow-core.ts` currently emits structured errors for `SCHEMA_001`, `SCHEMA_002`, `HANDOFF_001`, `PLACEHOLDER_001`, `STAGE_001`, `STAGE_002`, `PATH_001`, `WRITE_001`, `HEADING_001`, `IO_001`, and `IO_002`
- `SYNC_` and additional suffixes such as `HANDOFF_002`, `PLACEHOLDER_002`, or `WRITE_002` remain namespace reservations at the protocol layer unless and until execution code emits them

### 9b.3 Human-readable summary

After all JSON error lines, the generator must print a single human-readable summary line:

```
gen:workflow-skills: generation failed — 2 errors, 1 warning
```

### 9b.4 Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success — all output generated and validated |
| `1` | Generation error — input/output/file-system failure |
| `2` | Validation error — rendered output failed protocol checks |

## 10. Protocol scope for Version `0.1.0`

Protocol-Version `0.1.0` constrains the workflow skill generator to the following scope:

1. read `PROJECT_PROFILE.yaml`
2. read `templates/skills/*.SKILL.md.tmpl`
3. expand project-level variables
4. render output to `generated/workflow-skills/`
5. validate the rendered set

Protocol-Version `0.1.0` excludes the following:

- generate docs templates
- install generated skills into runtime host directories
- auto-edit existing gstack `SKILL.md` outputs
- auto-discover task-level values like `TASK_ID`

---

## 11. Success criteria

This protocol is considered implemented when all of the following machine-checkable conditions pass.

### 11.1 Workflow skill generator (`gen:workflow-skills`)

| # | Condition | Verified by |
|---|-----------|-------------|
| 1 | Generated skill count equals template count | `bun run test:workflow-skills` — assertion: count match |
| 2 | Every generated skill has all 13 required schema fields (§5.3) | `bun run test:workflow-skills` — schema field check |
| 3 | Every `handoff.success` and `handoff.failure` target is valid (§6) | `bun run test:workflow-skills` — handoff validation |
| 4 | No skill has `writes` / `forbidden_writes` overlap (§7.3) | `bun run test:workflow-skills` — boundary check |
| 5 | All 10 stage groups are covered (§4a) | `bun run test:workflow-skills` — stage coverage |
| 6 | All project-level placeholders are resolved; only runtime placeholders remain | `bun run test:workflow-skills` — placeholder check |
| 7 | Output is isolated from native gstack `*/SKILL.md` artifacts | Output path is `generated/workflow-skills/` — structural guarantee |

### 11.2 Registry generator (`gen:registry`)

| # | Condition | Verified by |
|---|-----------|-------------|
| 1 | Registry covers every workflow skill template | `bun run test:registry` — row count match |
| 2 | Every registry row has required metadata columns | `bun run test:registry` — column check |
| 3 | All 10 stage groups are represented | `bun run test:registry` — stage coverage |
| 4 | Every handoff target in the registry is valid | `bun run test:registry` — handoff validation |
| 5 | All project-level placeholders are resolved | `bun run test:registry` — placeholder check |

### 11.3 Docs generator (`gen:workflow-docs`)

| # | Condition | Verified by |
|---|-----------|-------------|
| 1 | Every required governance doc is generated | `bun run test:workflow-docs` — doc count match |
| 2 | Every doc satisfies `FILE_SCHEMAS.md` required headings | `bun run test:workflow-docs` — heading validation |
| 3 | All project-level placeholders are resolved | `bun run test:workflow-docs` — placeholder check |
| 4 | Only runtime placeholders remain unresolved | `bun run test:workflow-docs` — allowed unresolved check |

### 11.4 Cross-generator

| # | Condition | Verified by |
|---|-----------|-------------|
| 1 | All generators use the same stage enum and placeholder mapping | Shared `scripts/workflow-core.ts` — structural guarantee |
| 2 | All generators follow two-phase atomic write (§9a) | Existing test coverage for partial-write prevention |
| 3 | The workflow remains auditable from input profile to rendered output | Manual: trace any generated artifact back to its template and profile values |

---

## 12. Docs generator expansion

The next workflow-system phase extends generation beyond skills into governance docs.

### 12.1 Additional authoritative inputs

The docs generator must also treat the following files as authoritative:

1. `PROJECT_PROFILE.yaml`
2. `VERSION`
3. `templates/docs/*.md.tmpl`

`FILE_SCHEMAS.md` is the normative authoring reference for required headings and document structure.

Current implementation:

- the docs generator does not yet parse `FILE_SCHEMAS.md` directly
- instead, the required heading contract is mirrored into generator code and must stay aligned with `FILE_SCHEMAS.md`
- the generator must not invent document sections that are not supported by the `FILE_SCHEMAS.md` contract

### 12.2 Docs output model

The workflow docs generator must emit rendered docs into:

```text
generated/workflow-docs/
```

Each generated file should keep its runtime filename:

```text
CURRENT_TASK.md
STATUS.md
DECISIONS.md
CONTRACTS.md
LESSONS.md
TASK_SUMMARY.md
TASK_ARCHIVE.md
```

### 12.3 Docs substitution rules

The docs generator must expand project-level placeholders such as:

- `{{PROJECT_NAME}}`
- `{{PROJECT_TYPE}}`
- `{{TECH_STACK}}`
- `{{TEST_COMMANDS}}`
- `{{CODE_DIRECTORIES}}`
- `{{FORBIDDEN_PATHS}}`
- `{{ARCHITECTURE_RULES}}`
- `{{VERSION}}`

The docs generator must preserve runtime placeholders in Protocol-Version `0.1.0`:

- `{{TASK_ID}}`
- `{{TASK_TITLE}}`
- `{{TASK_SLUG}}`
- `{{DATE}}`
- `{{AUTHOR}}`

### 12.4 Docs validation rules

The docs generator must fail loudly if:

- a required docs template is missing
- a rendered doc is missing required headings from the `FILE_SCHEMAS.md` contract
- a non-runtime placeholder remains unresolved
- output is only partially written after validation failure

### 12.5 Scope note

The docs generator may emit generated skeletons, but it must not write, overwrite, or reconcile live governance files in the repo root directly.

Any live-doc materialization or refresh must flow through the hybrid sync policy defined in §14.

---

## 13. Skill registry generation

The workflow-system phase after docs generation adds a registry generator for human-readable skill indexing.

### 13.1 Registry inputs

The registry generator must treat the following files as authoritative:

1. `templates/skills/*.SKILL.md.tmpl`
2. `PROJECT_PROFILE.yaml`

It must extract metadata from skill frontmatter instead of relying on manually curated summaries.

### 13.2 Registry output model

The registry generator must emit:

```text
SKILL_REGISTRY.md
```

This file is a generated-but-committed artifact:

- humans must read it directly from the repo root
- generators must own its content
- hand edits must be overwritten by regeneration

### 13.3 Registry rendering rules

The registry generator must:

- resolve project-level placeholders using the same mapping as the workflow skill generator
- preserve task-level placeholders such as `{{TASK_ID}}` and `{{TASK_SLUG}}`
- render a workflow overview grouped by stage
- render a detailed skill table grouped by stage
- include handoff success/failure targets for every skill

### 13.4 Registry validation rules

The registry generator must fail loudly if:

- a skill template is missing required metadata fields needed by the registry
- a handoff target points to an unknown skill
- a required workflow stage is not represented in the registry input coverage
- the registry would be only partially written after a validation failure

### 13.5 Freshness enforcement

Changes to `templates/skills/*.SKILL.md.tmpl` must be validated in CI by regenerating `SKILL_REGISTRY.md` and checking that the repo stays clean.

That freshness check is a workflow-system integrity check. It verifies that the generator and committed generated artifact still agree.

That freshness check must be separate from runtime host skill-doc validation and from repo-level sync/compliance checks so the workflow-system layer remains auditable on its own.

---

## 14. Hybrid sync model for generated docs and live docs

This section defines the contract between generated governance docs in `generated/workflow-docs/` and live governance docs in the repo root.

This section governs repository compliance, not generator correctness. A sync failure means the current repo state has drifted from the generated structure contract; it does not by itself mean the workflow generators are incorrect.

The purpose of this model is to prevent dual truth:

- generated docs remain the authoritative structure reference
- live docs remain the authoritative project-truth content record
- sync behavior must be explicit, classifiable, and reviewable

### 14.1 Ownership model

Generated docs own the following structural contract:

- filename
- required headings
- heading order
- reserved placeholder slots
- structure-level update constraints

Live docs own the following runtime or project-specific content:

- all text written under a valid heading
- filled placeholder values
- project-specific tables, checklists, decisions, and notes
- additions that stay inside an existing generated-owned section

Authority split:

- generated docs are the canonical source of truth for structure
- live docs are the canonical source of truth for project truth and runtime content

For the purpose of sync:

- "structure" means headings, heading nesting, required section order, and placeholder slots that must exist
- "content" means the text, lists, tables, and checkboxes stored inside those sections

### 14.2 Document lifecycle

Each live governance doc must be in exactly one lifecycle state:

- `absent`: no live doc exists at the expected repo-root path
- `materialized`: a live doc exists and is aligned with the generated structure contract
- `drifted`: a live doc exists, but its structure has diverged from the generated contract
- `orphaned`: a live doc exists, but there is no corresponding generated doc contract for that filename

Lifecycle notes:

- `absent` is valid before bootstrap or for docs that have not yet been materialized
- `materialized` does not require byte-for-byte equality; it requires structural alignment
- `drifted` means the file still belongs to the sync system, but human review is required before structural reconciliation
- `orphaned` is advisory only; automation must not delete it automatically

### 14.3 Allowed sync actions

The sync layer may expose exactly four actions:

1. `materialize`
2. `refresh-structure`
3. `merge-safe update`
4. `propose-diff only`

Action semantics:

- `materialize`: create a new live doc from the generated skeleton when the live file is `absent`
- `refresh-structure`: apply generated-owned structural changes to an existing live doc while preserving live-owned content under matched headings
- `merge-safe update`: apply a reviewed structural reconciliation to a `drifted` doc when heading mapping is still unambiguous
- `propose-diff only`: emit a diff and classification result without writing any live file

Default policy:

- if the live doc is `absent`, the default action is `materialize`
- if the live doc already exists, the default action is `propose-diff only`
- no existing live doc may be rewritten silently

### 14.4 Classification rules for existing live docs

An existing live doc must be classified before any write is allowed.

Classification outcomes:

- `structure-compatible`
- `structure-drifted but mergeable`
- `incompatible and diff-only until confirmed`

Classification rules:

- `structure-compatible`: all required generated headings exist at the required heading levels and in the canonical order; only content differs
- `structure-drifted but mergeable`: the required headings can still be mapped unambiguously, but order, spacing, or generated-owned structure has drifted; a merge may be safe after review
- `incompatible and diff-only until confirmed`: one or more required headings are missing, renamed, duplicated ambiguously, or reorganized so structure-preserving sync is no longer trustworthy

Minimum classification inputs:

- the generated doc for that filename
- the live doc for that filename
- the required heading contract implied by `FILE_SCHEMAS.md`

Automation must not downgrade an `incompatible` doc to a mergeable state by guesswork.

### 14.5 Human confirmation rules

Human confirmation policy is mandatory:

- `materialize` on an `absent` file does not require confirmation
- any action on an existing live doc requires a diff preview first
- `refresh-structure` requires explicit confirmation per file
- `merge-safe update` requires explicit confirmation per file
- `incompatible and diff-only until confirmed` files must never be auto-merged
- `orphaned` files must only produce a warning; they must not be deleted automatically

Confirmation must be file-scoped. A sync tool may batch prompts, but it must still expose exactly which files will be written.

### 14.6 First-adoption behavior

First adoption of the workflow system must be non-destructive.

Required order:

1. generate the authoritative skeleton docs
2. inspect the repo root for existing live governance docs
3. classify each existing live doc before any write
4. apply only the actions allowed by this section

First-adoption rules:

- if a required live doc is `absent`, it may be `materialize`d automatically
- if a live doc is `structure-compatible`, the tool must still start with `propose-diff only`; `refresh-structure` is allowed only after confirmation
- if a live doc is `structure-drifted but mergeable`, the tool must present a proposed merge diff and require confirmation before `merge-safe update`
- if a live doc is `incompatible and diff-only until confirmed`, the tool must emit the diff and stop without writing
- first adoption must never overwrite, truncate, or delete an existing live doc without explicit human confirmation

### 14.7 Placeholder preservation rules

Placeholder handling during sync must preserve the ownership split.

Rules:

- project-level placeholders are expanded during generated-doc rendering and are not re-expanded by the sync layer
- runtime placeholders such as `{{TASK_ID}}`, `{{TASK_TITLE}}`, `{{TASK_SLUG}}`, `{{DATE}}`, and `{{AUTHOR}}` may remain in generated skeletons and may be carried into newly materialized live docs
- once a live doc replaces a placeholder with concrete content, that concrete content becomes live-owned and must not be overwritten by a later structural refresh
- a new placeholder introduced by a protocol or template change may be inserted only through a reviewed structural sync action

The sync layer must treat placeholder replacement history as content, not as missing generated output.

### 14.8 CI sync contract

Sync validation in CI is separate from generator freshness checks.

It is a repository-compliance gate, not a workflow-system-integrity gate.

CI behavior:

- a future sync-check command must classify repo-root live docs against `generated/workflow-docs/`
- CI passes when each evaluated doc is either `absent` or `structure-compatible`
- CI blocks merge when any evaluated doc is `structure-drifted but mergeable` or `incompatible and diff-only until confirmed`
- `orphaned` files must emit warnings unless a stricter host policy overrides that default

Structured sync failures must use the §9b error shape with the `SYNC_` code namespace.

This check is complementary to generator freshness checks:

- freshness checks prove generated artifacts match templates and that the workflow system is internally consistent
- sync checks prove repo-root live docs still match the generated structure contract

---

## 15. Future-contract boundary

This protocol revision is reviewed and corrected against the currently implemented `P1-P6` surface only.

The following contracts are intentionally **not** finalized here and remain owned by later plan phases:

- `P7a`: bootstrap planning CLI, dry-run output contract, and classification/report shape
- `P7b`: task identity contract, including `TASK_ID`, `TASK_SLUG`, naming, and archive materialization behavior
- `P8`: project-level validation matrix, blocker levels, and precedence beyond the current protocol-level generator checks
- `P9`: CI/reporting wiring beyond the current `test:workflow-*` and freshness enforcement already implemented
- `P10`: runtime host install/sync entrypoints and target-project import/install contract
- `P11`: long-term versioned governance, release/compatibility/security/deploy baselines

Interpretation rule:

- later phases may extend this protocol
- later phases must not be read as already implemented unless an execution-layer capability and its tests exist
- when a future contract is only mentioned as a boundary here, that mention is descriptive, not a claim of implementation
