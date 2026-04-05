# Workflow Protocol

```yaml
Protocol-Version: 0.2.0
Status: Formal Spec
Last-Updated: 2026-04-03
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

### 3.4 Task identity contract

The workflow-system task identity contract is defined at the runtime layer, not at generator render time.

Canonical rules:

- `TASK_ID` must be a project-local, immutable decimal identifier once materialized
- the canonical format is a zero-padded decimal string with at least 3 digits
- `TASK_SLUG` must be a project-local, immutable lowercase ASCII kebab-case slug once materialized
- `TASK_TITLE` must be concrete non-placeholder text before task identity is treated as materialized

Examples:

- valid `TASK_ID`: `001`, `042`, `1203`
- valid `TASK_SLUG`: `bootstrap-governance`, `fix-registry-drift`

Live-doc contract:

- `CURRENT_TASK.md` is the canonical live source of task identity during an active task cycle
- inside `## 任务信息`, the live task package must carry:
  - `任务 ID`
  - `任务标题`
  - `任务 slug`
- `TASK_ARCHIVE.md` and `archive-task` consume those same values later

Archive naming contract:

- archive path pattern: `TASKS/TASK-{{TASK_ID}}-{{TASK_SLUG}}.md`
- the concrete archive filename must be derived from materialized live values, not from guessed or regenerated values

Materialization boundary:

- bootstrap planning (`P7a`, Adoption `A2`) must preserve task identity placeholders
- task identity becomes concrete only during Adoption `A3` or an equivalent approved runtime execution flow
- `archive-task` must read concrete `TASK_ID`, `TASK_TITLE`, and `TASK_SLUG` from live `CURRENT_TASK.md`
- `archive-task` must fail closed if any of those fields are missing or still placeholder text
- runtime helpers may derive a slug from task title only as an explicit surfaced step; generators must not silently auto-discover task identity

---

## 4. Project-type specialization rules

The generator must specialize skills by project type.

Supported project types in Protocol-Version `0.2.0`:

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
- Protocol-Version `0.2.0` currently defines emphasis text only for:
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

### 5.2 Must remain as placeholders in Protocol-Version `0.2.0`

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

- Protocol-Version `0.2.0` validates overlap conflicts between explicit paths and restricted directory patterns
- Protocol-Version `0.2.0` does **not yet** perform semantic path authorization such as "outside its workflow role" or "writes code paths" classification

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
6. task placeholders intentionally preserved in Protocol-Version `0.2.0` remain untouched

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

## 10. Protocol scope for Version `0.2.0`

Protocol-Version `0.2.0` constrains the workflow skill generator to the following scope:

1. read `PROJECT_PROFILE.yaml`
2. read `templates/skills/*.SKILL.md.tmpl`
3. expand project-level variables
4. render output to `generated/workflow-skills/`
5. validate the rendered set

Protocol-Version `0.2.0` excludes the following:

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
ROADMAP.md
BASELINES.md
```

Protocol-Version `0.2.0` extends the required generated doc set with lifecycle-governance docs:

- `ROADMAP.md` for milestone / roadmap / version-window planning
- `BASELINES.md` for release, compatibility, security, deploy, and non-functional baselines

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

The docs generator must preserve runtime placeholders in Protocol-Version `0.2.0`:

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

Boundary rule:

- live docs may add content inside an existing generated-owned section, but that flexibility does not grant structural ownership over new independent headings or sections
- heading-level and section-level structure remains part of the generated contract surface, even when the live doc adds project-specific content nearby
- any extra heading, including a new sub-heading inserted inside an existing generated-owned section, counts as extra heading-level structure rather than ordinary live-owned content

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

- `structure-compatible`: all required generated headings exist at the required heading levels and in the canonical order; only content differs, and there are no extra heading-level structural additions outside the generated contract
- `structure-drifted but mergeable`: the required headings can still be mapped unambiguously, but order, spacing, or generated-owned structure has drifted; a merge may be safe after review. This state does not include live-only independent headings or sections outside the generated contract
- `incompatible and diff-only until confirmed`: one or more required headings are missing, renamed, duplicated ambiguously, reorganized so structure-preserving sync is no longer trustworthy, or expanded with extra heading-level structure outside the generated contract, including any live-only heading or sub-heading that is not part of the generated heading tree

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
- in Protocol-Version `0.2.0`, `incompatible and diff-only until confirmed` means the sync layer may present the diff and classification result, but it must stop without writing
- any confirmed follow-up for an `incompatible` file is outside the automatic sync actions defined by P6 and must be handled by a separate manual decision or a later-phase contract
- if a file is `incompatible` because of extra live-only headings or sections, the sync layer must not automatically preserve, move, fold, or reorder that extra structure
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
- if a live doc includes extra independent headings, sections, or sub-headings outside the generated contract, first adoption must classify it as `incompatible and diff-only until confirmed`
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

## 16. Validation model

This section defines the project-level validation model, blocker levels, layer precedence, and the contract for target projects to declare their validation matrix.

### §16.1 Validation layers

Validation is split into two layers with distinct ownership and scope:

1. **Protocol-level validation** — owned by the workflow-system, validates generator correctness and workflow integrity
2. **Project-level validation** — owned by the target project, validates implementation quality and project-specific contracts

Protocol-level validation covers:

- template schema validity
- stage coverage completeness
- handoff graph closure
- placeholder resolution rules
- path grammar correctness
- atomic write correctness
- read/write boundary conflicts
- registry freshness against generated skills
- docs freshness against generated skeletons

Project-level validation covers:

- unit tests
- integration tests
- end-to-end / smoke tests
- contract compatibility checks
- performance baselines
- reliability checks
- compatibility checks
- security checks
- deploy / release constraints

### §16.2 Blocker levels

Every validation entrypoint must declare exactly one blocker level.

The blocker levels are, in order of severity:

| Blocker level | Semantics |
|---|---|
| `blocks-generator` | Failure prevents generator output from being written. Protocol-level only. |
| `blocks-merge` | Failure prevents merge into the protected branch. |
| `blocks-ship` | Failure prevents release or deploy. |
| `warning-only` | Failure is logged but does not block any gate. |

Assignment rules:

- protocol-level validation entrypoints default to `blocks-generator` unless overridden by the protocol
- the workflow-system seeds the minimum unbound project-level slots at `blocks-merge` so the base matrix has explicit blocker levels before a target project binds real commands
- a target project may adjust the blocker level of its own project-level slots when binding them in its configuration
- a target project may promote a `warning-only` entrypoint to a higher blocker level in its own configuration
- project-level entrypoints may not use `blocks-generator`; that blocker level is reserved for protocol-level gates
- a target project may not demote a workflow-system-defined `blocks-generator` entrypoint below `blocks-merge`

### §16.3 Layer precedence

Layer precedence is mandatory and must be enforced by any validation runner.

Precedence rules:

1. Protocol-level validation always runs first.
2. If protocol-level validation fails at `blocks-generator` or `blocks-merge` severity, project-level validation results are not authoritative for release decisions.
3. Project-level validation only runs on top of a protocol-valid workflow-system state.
4. A validation runner must not interleave protocol-level and project-level checks in a way that obscures which layer failed.
5. Validation reports must tag every result with its layer (`protocol` or `project`) so failures from different layers cannot be conflated.

Precedence table:

| Gate | Protocol-level must pass first? | Project-level runs? | Decision authority |
|---|---|---|---|
| Generator output | Yes | No | Protocol-level only |
| Merge | Yes | Yes, if protocol passes | Both layers; protocol failure overrides project pass |
| Ship / deploy | Yes | Yes, if protocol passes | Both layers; protocol failure overrides project pass |
| Warning report | No (runs unconditionally) | No (runs unconditionally) | Advisory only |

### §16.4 Validation matrix contract

A target project declares its validation matrix in `PROJECT_PROFILE.yaml` under the `validation` key.

The validation matrix is a list of named entrypoints with the following required fields:

```yaml
validation:
  matrix:
    - name: <string>            # human-readable entrypoint name
      layer: <protocol|project> # which validation layer this belongs to
      command: <string>         # executable command or runner
      blocker_level: <blocks-generator|blocks-merge|blocks-ship|warning-only>
      description: <string>     # purpose of this entrypoint
      phase: <string>           # when this entrypoint is expected to be bound (e.g., "P9", "A4")
      owner: <string>           # who owns this entrypoint ("workflow-system" or "target-project")
```

Contract rules:

- `layer` must be either `protocol` or `project`; no other values are valid
- `blocker_level` must be one of the four levels defined in §16.2
- protocol-layer entrypoints with `owner: workflow-system` are defined by the workflow-system and must not be redefined by a target project
- project-layer entrypoints with `owner: target-project` are declared by the target project and bound during Adoption `A4`
- project-layer entrypoints may not declare `blocker_level: blocks-generator`
- an entrypoint with `command` set to an empty string or a placeholder is treated as `unbound`
- unbound entrypoints are not executed; they serve as documented slots for future binding

Minimum matrix:

The workflow-system defines the following protocol-level entrypoints as the minimum validation matrix:

| Name | Layer | Blocker level | Command | Owner |
|---|---|---|---|---|
| `workflow-skills-validation` | `protocol` | `blocks-generator` | `bun run gen:workflow-skills --dry-run` | `workflow-system` |
| `workflow-docs-validation` | `protocol` | `blocks-generator` | `bun run gen:workflow-docs --dry-run` | `workflow-system` |
| `registry-validation` | `protocol` | `blocks-generator` | `bun run gen:registry --dry-run` | `workflow-system` |
| `workflow-skills-tests` | `protocol` | `blocks-merge` | `bun run test:workflow-skills` | `workflow-system` |
| `workflow-docs-tests` | `protocol` | `blocks-merge` | `bun run test:workflow-docs` | `workflow-system` |
| `registry-tests` | `protocol` | `blocks-merge` | `bun run test:registry` | `workflow-system` |
| `bootstrap-tests` | `protocol` | `blocks-merge` | `bun run test:bootstrap-governance` | `workflow-system` |
| `task-identity-tests` | `protocol` | `blocks-merge` | `bun run test:task-identity` | `workflow-system` |

Target projects are expected to declare at least the following project-level slots (unbound by default):

| Name | Layer | Blocker level | Phase | Owner |
|---|---|---|---|---|
| `unit` | `project` | `blocks-merge` (default slot) | `A4` | `target-project` |
| `integration` | `project` | `blocks-merge` (default slot) | `A4` | `target-project` |
| `e2e-smoke` | `project` | `blocks-merge` (default slot) | `A4` | `target-project` |
| `contract-compatibility` | `project` | `blocks-merge` (default slot) | `A4` | `target-project` |

Non-functional entrypoint slots that a target project may optionally declare:

- `performance`
- `reliability`
- `compatibility`
- `security`
- `deploy`

When a target project binds any of those non-functional slots, the corresponding expectation must have a formal documented home in `BASELINES.md`.

### §16.5 Freshness as protocol-level gates

Docs freshness and registry freshness are protocol-level validation gates.

They are not project-quality layers.

Freshness rules:

- generated workflow skills must match the output of `gen:workflow-skills --dry-run`
- generated workflow docs must match the output of `gen:workflow-docs --dry-run`
- the committed `SKILL_REGISTRY.md` must match the output of `gen:registry --dry-run`

If any freshness check fails, it must be treated as a protocol-level failure with blocker level `blocks-merge`.

Freshness checks are complementary to generator dry-run checks:

- generator dry-run checks validate that templates can be rendered without errors
- freshness checks validate that committed artifacts match the current generator output

### §16.6 Separation of concerns

The following separation rules are mandatory:

- `run-regression` remains a task-level verification entry; it is not the owner of the entire validation model
- protocol-level validation and project-level validation must not be merged into a single catch-all gate
- a validation runner must report protocol-level results and project-level results separately
- CI checks for the workflow-system in the incubation repository wire only protocol-level entrypoints; project-level entrypoints are wired only in target projects during Adoption `A4`
- the validation model defines what must be checked and at what blocker level; it does not mandate a specific CI platform or runner implementation

## 17. Runtime integration contract

Runtime integration provides two layers between the workflow-system and its consumers (AI hosts, target projects):

1. **repo-local runtime entry** — a host-agnostic health check and manifest that works in both the source repository and any target project that has imported the workflow-system
2. **host-specific install/sync entry** — a thin layer that maps generated workflow artifacts to the path conventions of each supported AI host

### §17.1 Repo-local runtime entry

The repo-local runtime entry is the canonical single-command health check for the workflow-system. It validates:

- the project profile exists and is well-formed
- all generators produce fresh output (no stale committed artifacts)
- protocol-level validation passes

The runtime entry is implemented in `scripts/workflow-runtime.ts` and invoked via `bun run workflow:health`.

Runtime health reports have four components:

| Component | Check | Failure severity |
|-----------|-------|-----------------|
| `profile` | `PROJECT_PROFILE.yaml` exists and parses as valid YAML with required fields | fatal |
| `generators` | all three generators (`workflow-skills`, `workflow-docs`, `registry`) are fresh | error |
| `protocol` | protocol-level validation passes (`validate:protocol`) | error |
| `host` | detected or specified host is known and paths resolve | warning |

A runtime health check is **read-only** — it must never write files, modify generated outputs, or corrupt live docs.

### §17.2 Export manifest

The export manifest is a machine-readable listing of all workflow-system artifacts that a target project must import. The manifest is generated by `getExportManifest()` and returned by `bun run workflow:manifest --json`.

Each artifact in the manifest declares:

- `path` — relative to the workflow-system root
- `category` — one of: `script`, `protocol`, `template`, `config`, `test`
- `required` — whether the artifact is mandatory for a functioning workflow-system
- `description` — human-readable purpose

The manifest also declares:

- `package_json_contract` — the machine-readable minimum `package.json` surface a target project must merge, including required scripts, runtime dependencies, and engine constraints
- `requirements` — runtime dependencies (e.g., `bun >= 1.0`)
- `post_install` — commands to run after importing artifacts and merging the package script contract
- `verification` — commands to verify correct installation through the imported package script contract

`package.json` is part of the required import surface for `A1`.
The manifest must explicitly describe the minimum `workflow:*`, `gen:*`, and `validate:*` script contract plus the runtime dependencies needed by the imported workflow-system artifacts in a machine-readable `package_json_contract` field.
A target project must not be expected to discover those script entries from undocumented source-repository knowledge.

### §17.3 Import contract

The import contract defines the steps a target project follows during Adoption `A1` to import the workflow-system:

1. Run `workflow:pack` in the source workflow-system repo to export a deterministic bundle with `workflow-bundle.json`
2. Run `workflow:install --bundle <bundle-dir>` in the target repo to perform Adoption `A1`
3. Copy workflow-system scripts, protocol spec, templates, and the documented `package.json` contract surface
4. Merge the minimum `workflow:*`, `gen:*`, and `validate:*` scripts plus required runtime dependencies into the target project's `package.json`
5. Create or merge the project-specific `PROJECT_PROFILE.yaml`
6. Write `.workflow-system/install-state.json` only after the install transaction succeeds
7. Run `workflow:adopt` in the target repo to perform Adoption `A3`
8. Run generators to produce initial workflow outputs, materialize missing governed docs, run health, and sync generated artifacts to the target project's AI host

The import contract is self-documenting — a target project must not need undocumented repository knowledge to complete the import.

Public runtime interface notes:

- `workflow:install --root <target-repo>` and `workflow:adopt --root <target-repo>` operate on the explicit target repo; when `--root` is omitted they operate on the current working directory
- the recommended operator flow is `--dry-run --json` first, then a second run without `--dry-run` to apply
- install failures must report explicit categories so the operator can distinguish `frozen_path`, `local_drift`, `contract_conflict`, and `incompatible_target`
- adopt must preserve structured failure reporting for generator, materialization, health, and host-sync failures, with exit code `2` reserved for the missing-install prerequisite and exit code `1` for post-plan execution failures
- human-readable failure reports should be emitted on stderr; JSON reports remain machine-readable on stdout

### §17.4 Host-specific sync

Host-specific sync maps generated workflow artifacts to the path conventions of each supported AI host. The sync layer handles:

- path resolution (where generated SKILL.md files and docs go)
- host directory structure (`.claude/skills/`, `.agents/skills/`, `.factory/skills/`)
- isolation from native gstack skill outputs

Supported hosts and their conventions:

| Host | Skill output directory | Sync mechanism |
|------|----------------------|----------------|
| `claude` | `.claude/skills/workflow-system-*` | copy |
| `codex` | `.agents/skills/workflow-system-*` | copy |
| `factory` | `.factory/skills/workflow-system-*` | copy |

Constraints on host sync:

- host sync must not overwrite native gstack SKILL.md artifacts
- host sync must not rewrite protocol semantics
- host sync failures must not corrupt generated outputs or live docs
- target projects consume the sync logic defined here; they do not reimplement it locally
- `workflow:sync --write` must converge the host namespace to the current generated workflow skill set by pruning orphaned `workflow-system-*` directories within the selected host runtime root
- orphan pruning must be limited to the isolated `workflow-system-*` namespace and must never touch native `gstack-*` or other non-workflow host artifacts
- sync reporting must distinguish planned prune targets from successfully applied prune targets so dry-run and applied results are not conflated

### §17.5 Host detection

Host detection determines which AI host is active. Detection order:

1. explicit `--host` CLI flag (highest priority)
2. `WORKFLOW_HOST` environment variable
3. presence of host-specific directories in the project root (`.claude/`, `.agents/`, `.factory/`)
4. `project.primary_hosts[0]` from `PROJECT_PROFILE.yaml`
5. fallback to `'unknown'`

When host is unknown, the runtime entry reports a warning but does not fail — the core health check is host-agnostic.

### §17.6 Isolation guarantees

Runtime integration must satisfy the following isolation guarantees:

- workflow-system runtime outputs are separate from native gstack runtime outputs
- workflow-system generated skills use isolated `workflow-system-*` namespaces, not the native skill namespace
- runtime integration failures do not cascade to generators or protocol validation
- a target project that imports the workflow-system does not acquire native gstack skills or dependencies

## 18. Long-term versioned governance

This section extends the workflow-system from task / change governance into lifecycle governance.

### §18.1 Formal document homes

The lifecycle-governance surface uses the following formal document homes:

- `ROADMAP.md` — milestone planning, version windows, active scope windows, candidate backlog, and cross-milestone risks
- `BASELINES.md` — release, compatibility, security, deploy, performance, and reliability baselines
- `DECISIONS.md` — immutable decision records plus explicit superseded-decision handling

These docs are part of the generated workflow-doc contract, not ad-hoc optional notes. Their live content still follows the generated/live ownership split from §14.

### §18.2 Decision evolution rules

Decision records are append-only.

- do not silently rewrite or delete an accepted, deferred, or rejected decision entry
- when a decision is replaced, record the new decision in its normal decision section and add a superseded record under `## 🔁 已演进 / 已替代`
- each superseded record must include:
  - original decision ID
  - successor decision ID or the baseline / roadmap milestone that now owns the constraint
  - effective version or milestone
  - reason for the change
  - compatibility or migration handling
- a decision is not considered superseded unless the successor or replacement home is explicit and auditable

### §18.3 Roadmap governance rules

`ROADMAP.md` is the formal home for:

- lifecycle phase planning
- milestone and version-window planning
- active window scope
- candidate backlog items
- cross-window risks and dependencies

The generated `ROADMAP.md` structure must remain aligned with `FILE_SCHEMAS.md`, and live projects may add content only inside those generated-owned sections per §14.

### §18.4 Baseline governance rules

`BASELINES.md` is the formal home for:

- release gates and version windows
- compatibility guarantees and migration notes
- security requirements and review expectations
- deploy, rollback, and release constraints
- performance and reliability baselines

Baseline records are versioned and append-only:

- each baseline entry must declare status and effective version or window
- baseline changes must be recorded in `## 基线变更记录`
- optional validation entrypoints such as `performance`, `reliability`, `compatibility`, `security`, and `deploy` should map to the corresponding baseline sections when a target project binds them

### §18.5 Ownership boundary

P11 formalizes long-term governance homes and documentation rules.

It does not centralize:

- target-project private release automation
- environment-specific deploy commands
- credentials, secrets, or operational procedures that belong to a concrete production environment

## 19. Future-contract boundary

This protocol revision is reviewed and corrected against the currently implemented `P1-P11` incubation surface.

The following contracts remain outside the currently implemented workflow-system baseline:

- target-project-specific command bindings for optional project-level validation slots
- production-environment credentials, secret rotation procedures, and deploy implementations
- extraction-time release governance beyond the documented roadmap and baseline contracts

Interpretation rule:

- later extraction or adoption work may extend this protocol
- later work must not be read as already implemented unless an execution-layer capability and its tests exist
- when a future contract is only mentioned as a boundary here, that mention is descriptive, not a claim of implementation
