# Workflow Protocol

This file defines the execution rules for the draft workflow skill system.

Its purpose is narrower than `vibe-coding-workflow.md`:

- `vibe-coding-workflow.md` explains the full methodology
- `WORKFLOW_PROTOCOL.md` defines the concrete rules the generator must follow

---

## 1. Inputs to the generator

The generator must treat the following inputs as authoritative:

1. `PROJECT_PROFILE.yaml`
2. `templates/skills/*.SKILL.md.tmpl`
3. `vibe-coding-workflow.md` sections 3.5-3.10

The generator must not infer project facts from chat context alone.

If a required value is missing from `PROJECT_PROFILE.yaml`, generation must fail loudly instead of silently defaulting.

---

## 2. Output model

The draft workflow skill generator should emit generated skills into a dedicated output root:

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

Supported project types in the initial version:

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

---

## 5. Fields that must remain templated vs. fields that must be expanded

### 5.1 Must be expanded by the generator

- `{{PROJECT_NAME}}`
- `{{PROJECT_TYPE}}`
- `{{TECH_STACK}}`
- `{{CODE_DIRECTORIES}}`
- `{{TEST_COMMANDS}}`
- `{{FORBIDDEN_PATHS}}`
- `{{ARCHITECTURE_RULES}}`
- `{{DECISION_TYPES}}`

### 5.2 Must remain as placeholders in v1

- `{{TASK_ID}}`
- `{{TASK_SLUG}}`

### 5.3 Must remain template-level metadata

These fields are part of the skill protocol and should not be deleted or re-invented by the generator:

- `purpose`
- `stage`
- `trigger`
- `inputs`
- `reads`
- `writes`
- `forbidden_writes`
- `must_check`
- `stop_conditions`
- `output`
- `handoff`
- `decision_policy`
- `verification`

The generator may expand values inside these fields, but it must not change the field structure.

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
- a skill writes outside its own workflow role
- a review-only skill writes code paths

### 7.4 Contract-sensitive skills

The following skills must remain non-code-writing:

- `review-diff`
- `verify-contracts`
- `run-regression`

---

## 8. Validation rules

The generator must run structural validation after rendering.

Minimum validation checks:

1. required schema fields exist on every generated skill
2. every handoff target is valid
3. no `writes` / `forbidden_writes` conflict exists
4. all 8 workflow stages are represented
5. all placeholders intended for project expansion are resolved
6. task placeholders intentionally preserved in v1 remain untouched

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

## 10. Initial implementation scope

The first generator version should do only the following:

1. read `PROJECT_PROFILE.yaml`
2. read `templates/skills/*.SKILL.md.tmpl`
3. expand project-level variables
4. render output to `generated/workflow-skills/`
5. validate the rendered set

The first version should **not** yet:

- generate docs templates
- install generated skills into runtime host directories
- auto-edit existing gstack `SKILL.md` outputs
- auto-discover task-level values like `TASK_ID`

---

## 11. Success criteria

This protocol is considered implemented when:

- a generator can produce a complete rendered skill set from the current templates
- the rendered set passes handoff and boundary validation
- the output is isolated from the existing gstack generation pipeline
- the workflow remains auditable from input profile to rendered skill output

---

## 12. Docs generator expansion

The next workflow-system phase extends generation beyond skills into governance docs.

### 12.1 Additional authoritative inputs

The docs generator must also treat the following files as authoritative:

1. `templates/docs/*.md.tmpl`
2. `FILE_SCHEMAS.md`

It must not invent document sections that are not supported by `FILE_SCHEMAS.md`.

### 12.2 Docs output model

The workflow docs generator should emit rendered docs into:

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

The docs generator must preserve runtime placeholders in v1:

- `{{TASK_ID}}`
- `{{TASK_TITLE}}`
- `{{TASK_SLUG}}`
- `{{DATE}}`
- `{{AUTHOR}}`

### 12.4 Docs validation rules

The docs generator must fail loudly if:

- a required docs template is missing
- a rendered doc is missing required headings defined by `FILE_SCHEMAS.md`
- a non-runtime placeholder remains unresolved
- output is only partially written after validation failure

### 12.5 Scope note

The docs generator may emit generated skeletons, but it should not yet overwrite live governance files in the repo root automatically.

---

## 13. Skill registry generation

The workflow-system phase after docs generation adds a registry generator for human-readable skill indexing.

### 13.1 Registry inputs

The registry generator must treat the following files as authoritative:

1. `templates/skills/*.SKILL.md.tmpl`
2. `PROJECT_PROFILE.yaml`

It must extract metadata from skill frontmatter instead of relying on manually curated summaries.

### 13.2 Registry output model

The registry generator should emit:

```text
SKILL_REGISTRY.md
```

This file is a generated-but-committed artifact:

- humans should read it directly from the repo root
- generators should own its content
- hand edits should be overwritten by regeneration

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
- a required workflow stage is not represented
- the registry would be only partially written after a validation failure

### 13.5 Freshness enforcement

Changes to `templates/skills/*.SKILL.md.tmpl` should be validated in CI by regenerating `SKILL_REGISTRY.md` and checking that the repo stays clean.

That freshness check should be separate from runtime host skill-doc validation so the workflow-system layer remains auditable on its own.
