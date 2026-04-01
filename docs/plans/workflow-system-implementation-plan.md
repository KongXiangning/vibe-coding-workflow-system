# Workflow System Implementation Plan

Status: In Progress
Owner: kongx
Last-Updated: 2026-04-01

## Current Execution Order

P1. Harden `WORKFLOW_PROTOCOL.md` into a formal spec.
P2. Build the shared parser / validator / atomic-writer core.
P3. Implement `gen:workflow-skills`.
P4. Implement `gen:registry`.
P5. Implement `gen:workflow-docs`.
P6. Define the generated docs <-> live docs hybrid sync strategy.
P7. Implement `bootstrap-project-governance` and task identity.
P8. Define the project-level validation model and CI blockers.
P9. Wire the validation model into workflow skills, generator tests, and CI.
P10. Integrate Claude / Codex runtime entrypoints.
P11. Add versioned governance for long-term evolution.

## Summary

This plan does not aim to extend `gstack` itself.

Its goal is to use the ideas, workflow skeleton, and constraint model extracted from `gstack` to build a dedicated workflow-system that can later be separated cleanly from this repository.

The resulting system should remain logically independent from native `gstack` capabilities even if some incubation work happens inside the current repo first.

One key decision is already locked:

- `generated/workflow-docs/*` uses a hybrid model
- generated docs define structure, required headings, placeholders, and update constraints
- repo-root live docs carry project truth and runtime content
- synchronization must be controlled and must not allow silent dual truth

Additional boundary decisions are also locked:

- this system is incubated inside the current repo, but its paths and contracts must stay separable from native `gstack` artifacts
- workflow-system generated artifacts should prefer their own namespace and migration-friendly layout over reuse of `gstack` root artifacts
- protocol-level validation and project-level validation are separate layers and must not be merged into one catch-all gate

## Execution Model

This plan has two different execution contexts and they must not be confused:

1. **Incubation context, current repository**
2. **Consumption context, target project**

The workflow-system is being **designed and implemented in the current repository**.

The workflow-system is intended to be **generated and used in a target project** based on that target project's actual profile, structure, boundaries, and validation requirements.

This means:

- work on the protocol, generators, registry logic, sync model, bootstrap logic, and runtime entrypoints happens in the current repository
- generation output for real use is driven by the target project's `PROJECT_PROFILE.yaml`
- the current repository is the incubation and validation environment
- the target project is the eventual consumer environment

### Step-to-context mapping

The canonical execution context for each phase is:

| Phase | Primary execution context | Notes |
|------|----------------------------|-------|
| P1 | Current repository | Harden the protocol in the incubation repo. |
| P2 | Current repository | Build shared core code in the incubation repo. |
| P3 | Current repository | Implement and validate the workflow-skills generator in the incubation repo. |
| P4 | Current repository | Implement and validate the registry generator in the incubation repo. |
| P5 | Current repository | Implement and validate the docs generator in the incubation repo. |
| P6 | Current repository | Define sync policy in the incubation repo, but the policy governs future target-project adoption. |
| P7 | Cross-context | Implement bootstrap in the current repo; execute bootstrap against a target project. |
| P8 | Current repository | Define the validation model in the incubation repo. |
| P9 | Cross-context | Wire protocol-level checks in the current repo; apply project-level validation rules when used in a target project. |
| P10 | Cross-context | Implement runtime entrypoints in the current repo; consume them from target projects. |
| P11 | Target project / extracted workflow-system | Long-term governance is primarily owned by the extracted workflow-system and the projects that adopt it. |

### What happens where

#### Current repository responsibilities

- define and harden protocol rules
- build and test generator code
- build and test registry generation
- build and test docs generation
- define sync policy
- implement bootstrap and runtime entrypoints
- validate that the workflow-system is internally coherent

#### Target project responsibilities

- provide the real `PROJECT_PROFILE.yaml`
- consume generated workflow artifacts
- materialize and maintain live governance docs
- run project-specific validation gates
- use bootstrap, sync, and runtime integration in the context of the target project's own boundaries and constraints

### Non-goal clarification

This plan does **not** mean:

- permanently turning the current `gstack` repository into the final home of the workflow-system
- making the current repo root layout the permanent output contract for all future projects
- treating `gstack` itself as the required consumer of the resulting workflow-system

The current repository is the place where the system is being incubated.

The final workflow-system is meant to be portable and ultimately usable outside this repository.

## Current Implementation Status

The following artifacts already exist and are operational:

| Artifact | Status | Location |
|----------|--------|----------|
| `WORKFLOW_PROTOCOL.md` | ✅ Hardened spec with 22+ sections; protocol versioning, stage enum, metadata schema, placeholder/path grammar, atomic write, error format, and success criteria all formalized (P1 complete) | repo root |
| `gen:workflow-skills` | ✅ Operational | `scripts/gen-workflow-skills.ts` |
| `gen:workflow-docs` | ✅ Operational | `scripts/gen-workflow-docs.ts` |
| `gen:registry` | ✅ Operational | `scripts/gen-registry.ts` |
| Generated workflow skills | ✅ 18 skills generated | `generated/workflow-skills/` |
| Generated workflow docs | ✅ 7 docs generated | `generated/workflow-docs/` |
| `SKILL_REGISTRY.md` | ✅ Auto-generated | repo root |
| Test commands | ✅ `test:workflow-skills`, `test:workflow-docs`, `test:registry`, `test:workflow-all` | `package.json` |
| Shared core module | ✅ Fully extracted to `scripts/workflow-core.ts` — 5 types, 4 constants, 19 functions; all 3 generators consume shared parsing, validation, handoff, atomic write, and error emission (P2 complete) | `scripts/` |
| Shared core tests | ✅ 46 unit tests (89 assertions) in `test/workflow-core.test.ts` | `test/` |
| Hybrid sync strategy | ❌ Not yet defined | — |
| Bootstrap entrypoint | ❌ Not yet implemented | — |
| Project-level validation model | ❌ Not yet defined | — |
| Runtime integration | ❌ Not yet implemented | — |

## Boundary Decisions

### Incubation vs extraction paths

The workflow-system is being incubated inside the current repository, but the target architecture is a standalone project.

That means every generated artifact must be classified as one of:

- incubation-local, allowed to live in this repo temporarily
- standalone-owned, expected to move unchanged into the extracted project
- bridge artifact, temporarily exposed to the current repo only for audit or compatibility

Specific path decisions:

- `generated/workflow-skills/` and `generated/workflow-docs/` are standalone-owned
- the implementation plan in `docs/plans/` is incubation-local

### Registry path authority

The current authoritative registry path is:

```
SKILL_REGISTRY.md  (repo root)
```

This is the production output path, not a bridge artifact. It is consistent with `WORKFLOW_PROTOCOL.md` §13.2 and the current `gen:registry` implementation.

Status of this decision:

- **Settled for incubation.** No open convergence task exists. The repo root path is the single source of truth during the incubation phase.
- **Open for extraction.** If the workflow-system is extracted into a standalone project, the registry path may need to change. At that point, a relocation rule and migration logic must be defined as part of the extraction work — not before.
- **No phase owns convergence.** This is not a P1 or P4 task. It is a future extraction-time decision that will surface when extraction is actually planned.

### Existing live-doc migration policy

The bootstrap path must support both greenfield projects and projects that already contain governance docs.

For projects with existing live docs, first adoption must follow this order:

1. generate workflow docs skeletons
2. compare live docs against generated structure
3. classify each file as:
   - structure-compatible
   - structure-drifted but mergeable
   - incompatible, requires proposed diff and explicit human confirmation
4. only after classification, materialize or refresh structure

Bootstrap must not blindly overwrite an existing live doc, even when the generated structure is considered authoritative.

### Validation layer precedence

Validation is split into two layers:

1. protocol-level validation
2. project-level validation

Protocol-level validation covers generator correctness and workflow-system integrity:

- schema validity
- stage coverage
- handoff closure
- placeholder resolution rules
- path grammar
- atomic write correctness
- registry/docs freshness rules tied to generator outputs

Project-level validation covers the target project's implementation quality:

- unit / integration / E2E / smoke
- project contract checks
- performance / reliability / compatibility / security / deploy checks

Precedence rules:

- protocol-level validation always runs first
- if protocol-level validation fails, project-level validation is not authoritative for release decisions
- project-level validation only runs on top of a protocol-valid workflow-system state
- `run-regression` remains a task-level verification entry, not the owner of the entire project-level validation model

## Phase Plan

### P1. Harden the protocol core

Status: **Complete**

> `WORKFLOW_PROTOCOL.md` has been hardened from a 475-line draft into a ~717-line formal spec. Added 9 specification sections: protocol versioning (v0.1.0 + SemVer), canonical stage enum (10 groups with English IDs + Chinese aliases), formal skill metadata schema (13 fields with types/cardinality), placeholder grammar (syntax, categories, 14-placeholder table), path grammar (format rules, special tokens, validation), input precedence (Protocol > Profile > Template), atomic write rules (two-phase, idempotence, dry-run), structured error format (JSON schema, code namespaces, exit codes), and machine-checkable success criteria (per-generator tables).

What was delivered:

- Protocol version header with SemVer scheme
- Canonical stage enum §4a — 10 groups with English canonical IDs and Chinese display aliases
- Formal skill metadata schema §5.3 — 13 fields with types, cardinality, and validation rules
- Placeholder grammar §3.0 — syntax, categories, exhaustive table of 14 placeholders
- Path grammar §7a — format rules, special tokens, validation rules
- Input precedence §1.1 — Protocol > Profile > Template
- Atomic write rules §9a — two-phase commit, idempotence, dry-run contract
- Structured error format §9b — JSON schema, error code namespaces, exit codes
- Machine-checkable success criteria §11 — per-generator pass/fail tables

Acceptance criteria (all met):

- ✅ no high-impact semantic gaps remain
- ✅ every generator-critical behavior has a single source of truth in the protocol
- ✅ implementers do not need to invent rules for schema, path matching, placeholder handling, atomic write, or error shape

### P2. Build the shared parser / validator / writer core

Status: **Complete**

> `scripts/workflow-core.ts` is the fully extracted shared core (315 lines). Contains 5 types (`JsonValue`, `JsonObject`, `HandoffRef`, `WriteOperation`, `ErrorReport`), 4 constants (`STAGE_MAP`, `STAGE_ALIASES`, `REQUIRED_STAGES`, `RESERVED_FAILURE_TARGETS`), and 19 functions covering loading, parsing, rendering, validation, handoff, atomic writes, error emission, and generator orchestration. All 3 generators import from this module with zero duplicated protocol logic. Unit tests: 46 tests, 89 assertions in `test/workflow-core.test.ts`.

What was delivered:

- Types: `HandoffRef`, `WriteOperation`, `ErrorReport` for cross-generator contracts
- Constants: `STAGE_MAP` (English→Chinese), `STAGE_ALIASES` (Chinese→English) for dual-form stage validation
- Functions: `resolveRoot`, `ensureCleanOutputDir`, `validateRequiredFields`, `extractHandoff`, `validateHandoff`, `validateStages` (English+Chinese), `emitError`, `emitWarning`, `executeWrites`, `runGenerator`
- All 3 generators refactored: skills (222→183 lines), docs (181→165), registry (347→323)
- 46 unit tests covering all shared functions with error cases
- Full suite: 61 tests, 895 assertions, zero-diff generated output

Goal:

Create the shared execution core before any concrete generator so `skills`, `docs`, and `registry` do not fork their own logic.

The shared core must handle:

- loading `PROJECT_PROFILE.yaml`
- parsing skill/doc template frontmatter and body
- placeholder expansion
- path normalization
- handoff graph validation
- schema validation
- atomic write orchestration
- standard error emission

Deliverables:

- a repo-local shared core module
- stable internal interfaces for all generators

Dependencies:

- depends on P1

Acceptance criteria:

- all generators can consume the same parsing, validation, and writing layer
- generator-specific code does not duplicate protocol logic
- tests exist for parsing, validation, atomic write, and error emission

### P3. Implement `gen:workflow-skills`

Status: **Complete**

> `bun run gen:workflow-skills` is operational. 18 skills are generated to `generated/workflow-skills/`. Tests exist at `test/gen-workflow-skills.test.ts` and are runnable via `bun run test:workflow-skills`.

What was delivered:

- The workflow skill generator reads `PROJECT_PROFILE.yaml` and `templates/skills/*.SKILL.md.tmpl`, expands project-level placeholders, preserves task-level placeholders, and renders the full workflow skill graph
- Handoff closure, schema, writes conflicts, placeholder completeness, and stage coverage are all validated before output
- Atomic write: all files are rendered and validated in memory before any are written to disk
- Output: 18 skills in `generated/workflow-skills/`

Inputs:

- `PROJECT_PROFILE.yaml`
- `templates/skills/*.SKILL.md.tmpl`
- `WORKFLOW_PROTOCOL.md`

Outputs:

- `generated/workflow-skills/`

Acceptance criteria (all met):

- ✅ generated skill count matches template count (18/18)
- ✅ all rendered skills pass schema and graph validation
- ✅ no partial-success output is written (atomic two-phase render+write)
- ✅ `bun run test:workflow-skills` validates the generator output reliably (6 tests, 445 assertions)

### P4. Implement `gen:registry`

Status: **Complete**

> `bun run gen:registry` is operational. `SKILL_REGISTRY.md` is generated at repo root. Tests exist at `test/gen-registry.test.ts` and are runnable via `bun run test:registry`.

What was delivered:

- The registry generator reads `templates/skills/*.SKILL.md.tmpl` and `PROJECT_PROFILE.yaml`, extracts metadata from template frontmatter, and renders a human-auditable registry
- Uses the same stage enum and placeholder mapping as the skill generator (now via shared `scripts/workflow-core.ts`)
- Renders a workflow overview, stage-grouped skill tables, and success/failure handoff links
- The registry is a generated-but-committed artifact at repo root `SKILL_REGISTRY.md`

Inputs:

- `templates/skills/*.SKILL.md.tmpl`
- `PROJECT_PROFILE.yaml`

Outputs:

- `SKILL_REGISTRY.md` at repo root (consistent with `WORKFLOW_PROTOCOL.md` §13.2)

Acceptance criteria (all met):

- ✅ the registry covers every workflow skill (18/18)
- ✅ stage, handoff, and skill counts match the generated skills exactly
- ✅ `bun run test:registry` catches missing metadata, unknown handoffs, stage gaps, and placeholder issues (5 tests, 247 assertions)
- ⚠️ CI freshness check not yet wired — templates can change without registry regeneration being enforced in CI
- ✅ the registry path is consistent with `WORKFLOW_PROTOCOL.md` §13.2

### P5. Implement `gen:workflow-docs`

Status: **Complete**

> `bun run gen:workflow-docs` is operational. 7 governance doc skeletons are generated to `generated/workflow-docs/`. Tests exist at `test/gen-workflow-docs.test.ts` and are runnable via `bun run test:workflow-docs`.

What was delivered:

- The docs generator reads `templates/docs/*.md.tmpl`, `FILE_SCHEMAS.md`, and `PROJECT_PROFILE.yaml`, expands project-level placeholders, and preserves runtime placeholders
- Required heading validation enforces `FILE_SCHEMAS.md` structure for each doc type
- Atomic write: all docs are rendered and validated in memory before any are written to disk
- Generated docs are skeletons only — they do not overwrite repo-root live docs
- Output: 7 docs in `generated/workflow-docs/`

Inputs:

- `templates/docs/*.md.tmpl`
- [`FILE_SCHEMAS.md`](../../FILE_SCHEMAS.md)
- `PROJECT_PROFILE.yaml`

Outputs:

- `generated/workflow-docs/`

Acceptance criteria (all met):

- ✅ every required workflow doc is generated (7/7)
- ✅ each rendered doc satisfies `FILE_SCHEMAS.md` heading requirements
- ✅ `bun run test:workflow-docs` catches missing templates, missing headings, unresolved placeholders, and partial writes (4 tests, 114 assertions)

Dependencies:

- depends on P1 and P2
- should follow P3 and P4

### P6. Define the generated docs <-> live docs hybrid sync strategy

Status: **Not Started**

> ⚠️ **Dependency ordering concern**: This phase depends on P5, but the sync model is a design decision that should have informed P5's implementation. If P5's output assumptions conflict with the sync strategy defined here, retrofitting may be needed.

Goal:

Lock the structure/content boundary between generated docs and live docs so the system never drifts into dual truth.

The sync model must define:

- generated docs own structure, headings, placeholders, and update constraints
- live docs own project truth and runtime content
- allowed sync actions:
  - materialize
  - refresh-structure
  - merge-safe update
  - propose-diff only
- which files or actions require explicit human confirmation
- first-adoption behavior for projects that already contain live governance docs
- classification rules for existing live docs:
  - structure-compatible
  - structure-drifted but mergeable
  - incompatible and diff-only until confirmed

Deliverables:

- a formal sync section in [`WORKFLOW_PROTOCOL.md`](../../WORKFLOW_PROTOCOL.md)
- additional sync-policy documentation if needed

Dependencies:

- depends on P1 and P5

Acceptance criteria:

- every governance doc has a clear structure owner and content owner
- no undefined overlap remains between generated docs and live docs
- bootstrap and runtime sync behavior can only operate through this policy
- existing live docs can be onboarded without blind overwrite behavior

### P7. Implement `bootstrap-project-governance` and task identity

Status: **Not Started**

> ⚠️ **Scope concern**: This phase combines bootstrap entrypoint, live doc classification, materialization, first-run checklist, AND task identity definition. Consider splitting into: (a) bootstrap + materialization, (b) task identity system.

Goal:

Create the real first-run entrypoint for adopting the workflow-system, instead of relying on `init-governance` alone.

Bootstrap responsibilities:

- validate `PROJECT_PROFILE.yaml`
- run the skills/docs/registry generators
- classify existing live docs before any materialization
- materialize the minimum live docs using the hybrid sync policy
- output a first-run checklist
- output first-run validation commands
- define and materialize task identity rules

Task identity must define:

- `TASK_ID`
- `TASK_SLUG`
- `TASKS/TASK-<id>-<slug>.md` naming
- the contract between `CURRENT_TASK.md` and `archive-task`

Deliverables:

- a bootstrap entrypoint
- minimum live governance docs
- first-run checklist
- task identity rules

Dependencies:

- depends on P3, P4, P5, and P6

Acceptance criteria:

- a project without governance can complete first adoption
- a project with pre-existing governance docs can complete a non-destructive first adoption flow
- repo-root minimum governance docs become usable after bootstrap
- task identity no longer remains an unresolved placeholder concept
- `archive-task` can consume the defined naming scheme without special casing

### P8. Define the project-level validation model and CI blockers

Status: **Not Started**

Goal:

Upgrade validation from task-level regression checks to a project-level quality matrix.

The validation model must define:

- protocol-level validation scope and ownership
- validation layers:
  - unit
  - integration
  - E2E / smoke
  - target-project contract compatibility checks
- blocker policy:
  - what blocks generator success
  - what blocks merge
  - what blocks shipping
  - what is warning-only
- non-functional entrypoints:
  - performance
  - reliability
  - compatibility
  - security
  - deploy constraints

Deliverables:

- validation model spec
- CI blocker rule set
- validation-related extensions in `PROJECT_PROFILE.yaml` or adjacent config
- a precedence table separating protocol-level gates from project-level gates

Dependencies:

- depends on P1, P3, P4, and P5

Acceptance criteria:

- each validation layer has an explicit trigger, executor, and blocker level
- current projects can express a minimum validation matrix without ad hoc rules
- docs, generators, and CI interpret the validation model consistently
- protocol-level failures and project-level failures cannot be conflated by implementation
- docs freshness and registry freshness remain protocol-level gates, not project-quality layers

### P9. Wire the validation model into workflow skills, generator tests, and CI

Status: **Not Started**

Goal:

Turn the validation model into real quality gates instead of leaving it as documentation.

Implementation requirements:

- keep `run-regression` focused on task-level validation entry
- drive project-level quality gates from the validation model, not from one skill
- run protocol-level validation before any project-level validation gate is considered authoritative
- map generator tests to protocol success criteria
- run in CI at minimum:
  - protocol-level workflow-system validation
  - workflow skills validation
  - workflow docs validation
  - registry freshness / validation
  - required unit/integration checks

Deliverables:

- updated workflow skill behavior contracts
- `test:workflow-*` coverage aligned to the protocol
- CI checks for the workflow-system

Dependencies:

- depends on P2, P3, P4, P5, and P8

Acceptance criteria:

- local and CI judgments for the workflow-system are aligned
- protocol-breaking changes are surfaced by tests or CI
- "task finished" and "project passed gates" are treated as separate states
- protocol-level generator correctness and project-level quality gates remain distinct in reports and exit behavior

### P10. Integrate Claude / Codex runtime entrypoints

Status: **Not Started**

Goal:

Add runtime entrypoints only after protocol, generators, sync policy, and validation are stable.

Runtime integration should have only two layers:

- repo-local runtime entry
- host-specific install / sync entry

Constraints:

- runtime integration must not rewrite protocol semantics
- runtime integration must stay isolated from native `gstack` runtime outputs
- existing repo-native `SKILL.md` artifacts must not be overwritten

Deliverables:

- repo-local runtime entrypoints
- Claude / Codex host-specific install or sync entrypoints
- host compatibility notes

Dependencies:

- depends on P1 through P9

Acceptance criteria:

- Claude / Codex can consume workflow-system outputs without polluting the native `gstack` pipeline
- host-specific differences remain confined to install/sync logic
- runtime integration failures do not corrupt generated outputs or live docs

### P11. Add versioned governance for long-term evolution

Status: **Not Started**

Goal:

Evolve the system from change governance into full lifecycle governance.

This phase adds:

- milestone / roadmap / phase planning
- non-functional constraint documents
- release / compatibility / security / deploy baselines
- decision evolution and superseded-decision handling

Deliverables:

- roadmap or milestone governance docs or sections
- decision evolution rules
- compatibility / security / deploy baseline documentation rules

Dependencies:

- depends on P1 through P10

Acceptance criteria:

- the system supports long-term roadmap and compatibility governance, not only task execution
- decisions, release constraints, deploy constraints, and non-functional baselines all have formal homes
- the workflow-system now governs the full project lifecycle

## Public Interfaces And Contract Changes

The following interfaces and contracts must be formalized or tightened:

- protocol schema, stage enum, path grammar, placeholder grammar, error format, and atomic write contract in [`WORKFLOW_PROTOCOL.md`](../../WORKFLOW_PROTOCOL.md)
- shared core APIs for:
  - parse
  - validate
  - expand
  - write atomically
  - emit standard errors
- generator CLI contracts for:
  - `gen:workflow-skills`
  - `gen:workflow-docs`
  - `gen:registry`
  - bootstrap entry
- registry output path: repo root `SKILL_REGISTRY.md` (settled for incubation; extraction-time relocation TBD)
- generated docs <-> live docs sync actions and boundaries
- task identity naming and archive contract
- validation model, layer precedence, and CI blocker contract

## Test Plan

The implementation must cover these test and acceptance scenarios:

- protocol-level
  - invalid stage
  - unknown placeholder
  - illegal path
  - conflicting writes / forbidden_writes
  - broken handoff
  - invalid atomic-write behavior
- shared core
  - profile parsing
  - template parsing
  - schema validation
  - error formatting
  - partial write prevention
- skills generator
  - successful full render
  - failure on missing metadata
  - failure on broken handoff graph
  - correct preservation of runtime placeholders
- registry generator
  - correct stage grouping
  - correct handoff rendering
  - failure on missing metadata
  - freshness check behavior
- docs generator
  - required-heading validation
  - failure on unresolved non-runtime placeholders
  - atomic output write behavior
- sync model
  - structure refresh does not overwrite live runtime content
  - human-confirmation-required updates only enter propose-diff paths
  - existing live docs are classified before materialization
- bootstrap
  - first adoption succeeds on a project without governance docs
  - first adoption succeeds on a project with pre-existing governance docs without blind overwrite
  - task identity is generated and consumed by `archive-task`
- validation / CI
  - protocol-level failures stop the workflow-system before project-level gates are treated as authoritative
  - blocker vs warning behavior is correct
  - local and CI outcomes match
- runtime integration
  - Claude / Codex integration succeeds without polluting native `gstack` outputs

## Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| P6 sync strategy may require P5 retrofitting | Medium — generated docs output assumptions could conflict with sync policy | Define sync model principles before expanding P5 scope; current P5 output is minimal enough to adapt |
| P7 scope too large for single phase | Medium — delays, unclear ownership, partial delivery | Split into bootstrap+materialization and task identity sub-phases |
| Shared core duplication (P2 gap) | **Resolved** — `scripts/workflow-core.ts` extracted; remaining gap is path normalization, handoff graph, and atomic write orchestration not yet in shared core | Continue extracting as generators evolve |
| Stage count ambiguity (8 vs 10) | Low — causes confusion in validation rules | Clarify canonical stage enum in WORKFLOW_PROTOCOL.md as part of remaining P1 work |
| Extraction timeline undefined | Low — incubation artifacts may calcify into permanent dependencies | Review separability at each phase boundary |

## Assumptions And Defaults

- this workflow-system is intended to become an independently separable project
- `generated/workflow-docs/*` uses the hybrid model, structure from generated docs and truth-bearing content from live docs
- [`WORKFLOW_PROTOCOL.md`](../../WORKFLOW_PROTOCOL.md) is the highest-priority protocol source
- v1 optimizes for protocol correctness, generator consistency, and sync clarity before runtime convenience
- task-level placeholders remain unresolved during generation and are materialized only during bootstrap or runtime flows
- the registry is generated at repo root `SKILL_REGISTRY.md` — this is the authoritative production path during incubation, not a bridge artifact; extraction may require relocation with explicit migration
