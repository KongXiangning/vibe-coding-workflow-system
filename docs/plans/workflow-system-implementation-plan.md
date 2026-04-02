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
| Hybrid sync strategy | ✅ Defined in `WORKFLOW_PROTOCOL.md` §14; protocol-only in P6, implementation deferred to bootstrap/runtime sync tooling | repo root |
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

> `scripts/workflow-core.ts` is the fully extracted shared core (315 lines). Contains 5 types (`JsonValue`, `JsonObject`, `HandoffRef`, `WriteOperation`, `ErrorReport`), 4 constants (`STAGE_MAP`, `STAGE_ALIASES`, `REQUIRED_STAGES`, `RESERVED_FAILURE_TARGETS`), and 19 functions covering loading, parsing, rendering, validation, handoff, atomic writes, error emission, and generator orchestration. All 3 generators now import and reuse the core protocol paths from this module, with no material duplication in the currently-implemented shared protocol logic. Unit tests: 46 tests, 89 assertions in `test/workflow-core.test.ts`.

What was delivered:

- Types: `HandoffRef`, `WriteOperation`, `ErrorReport` for cross-generator contracts
- Constants: `STAGE_MAP` (English→Chinese), `STAGE_ALIASES` (Chinese→English) for dual-form stage validation
- Functions: `resolveRoot`, `ensureCleanOutputDir`, `validateRequiredFields`, `extractHandoff`, `validateHandoff`, `validateStages` (English+Chinese), `emitError`, `emitWarning`, `executeWrites`, `runGenerator`
- All 3 generators refactored: skills (222→183 lines), docs (181→165), registry (347→323)
- 46 unit tests covering all shared functions with error cases
- Full suite: 61 tests, 895 assertions, zero-diff generated output
- Design note:
  - structured error output is now centralized in the shared core
  - some generator-specific logic still exists by design where the generators differ in output shape and validation details

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

Acceptance criteria completed in P4:

- ✅ the registry covers every workflow skill (18/18)
- ✅ stage, handoff, and skill counts match the generated skills exactly
- ✅ `bun run test:registry` catches missing metadata, unknown handoffs, stage gaps, and placeholder issues (5 tests, 247 assertions)
- ✅ the registry path is consistent with `WORKFLOW_PROTOCOL.md` §13.2

Deferred follow-up outside P4 closure:

- ⚠️ CI freshness check not yet wired — templates can change without registry regeneration being enforced in CI
- This follow-up belongs to later CI integration work, not to the completed core generator behavior of P4

### P5. Implement `gen:workflow-docs`

Status: **Partially Complete — Skeleton Generation Done, Final Closure Owned by P6**

> `bun run gen:workflow-docs` is operational. 7 governance doc skeletons are generated to `generated/workflow-docs/`. Tests exist at `test/gen-workflow-docs.test.ts` and are runnable via `bun run test:workflow-docs`. P5 is complete only for skeleton generation and structural validation. Final closure of P5 is explicitly owned by P6, which determines whether the docs generator's output assumptions align with the hybrid sync policy.

What was delivered:

- The docs generator reads `templates/docs/*.md.tmpl`, `FILE_SCHEMAS.md`, and `PROJECT_PROFILE.yaml`, expands project-level placeholders, and preserves runtime placeholders
- Required heading validation enforces `FILE_SCHEMAS.md` structure for each doc type
- Atomic write: all docs are rendered and validated in memory before any are written to disk
- Generated docs are skeletons only — they do not overwrite repo-root live docs
- Output: 7 docs in `generated/workflow-docs/`

What remains open:

- confirmation that generated skeleton structure matches the final hybrid sync ownership model
- confirmation that structure-owned vs live-owned boundaries are correct
- any retrofit required if P6 tightens or clarifies sync-policy assumptions

Inputs:

- `templates/docs/*.md.tmpl`
- [`FILE_SCHEMAS.md`](../../FILE_SCHEMAS.md)
- `PROJECT_PROFILE.yaml`

Outputs:

- `generated/workflow-docs/`

Acceptance criteria completed in P5:

- ✅ every required workflow doc is generated (7/7)
- ✅ each rendered doc satisfies `FILE_SCHEMAS.md` heading requirements
- ✅ `bun run test:workflow-docs` catches missing templates, missing headings, unresolved placeholders, and partial writes (4 tests, 114 assertions)

Acceptance criteria deferred to P6 for final closure:

- P6 confirms that P5 output assumptions are valid under the hybrid sync model
- if P6 changes ownership boundaries, required retrofit is recorded and applied before P5 is considered fully closed

Dependencies:

- depends on P1 and P2
- should follow P3 and P4

### P6. Define the generated docs <-> live docs hybrid sync strategy

Status: **Complete (Protocol-only, and Closes P5 Ownership Assumptions at the Protocol Layer)**

> `WORKFLOW_PROTOCOL.md` now defines the hybrid sync model in §14. The protocol locks the ownership split between generated docs and live docs, defines lifecycle states and sync actions, requires diff-first confirmation for any existing live doc, preserves live-owned content during structural refresh, and adds a CI sync contract. P6 also serves as the formal closure step for P5 ownership assumptions. No sync engine, `sync:check` command, bootstrap enforcement, or runtime sync tooling was implemented in P6 by design; execution-layer enforcement is deferred to later phases.

What was delivered:

- structure/content ownership split:
  - generated docs own filenames, required headings, heading order, reserved placeholder slots, and structure-level constraints
  - live docs own project truth and runtime content inside those sections
- lifecycle model for live docs:
  - `absent`
  - `materialized`
  - `drifted`
  - `orphaned`
- allowed sync actions:
  - `materialize`
  - `refresh-structure`
  - `merge-safe update`
  - `propose-diff only`
- classification rules for existing live docs:
  - `structure-compatible`
  - `structure-drifted but mergeable`
  - `incompatible and diff-only until confirmed`
- confirmation policy:
  - `materialize` is automatic only for absent files
  - any existing live doc must start with diff-only review
  - structural writes require explicit per-file confirmation
- first-adoption rules for projects with pre-existing live governance docs
- placeholder preservation rules for project placeholders vs runtime placeholders
- CI sync contract:
  - future sync checks must block merge on structural drift or incompatibility
  - sync checks remain separate from generated-artifact freshness checks
- P5 closure rule:
  - P5 is not fully closed until P6 validates the ownership model behind generated docs
  - if P6 reveals a mismatch, P5 must be reopened for retrofit rather than silently treated as finished

Deliverables:

- formal hybrid sync section in [`WORKFLOW_PROTOCOL.md`](../../WORKFLOW_PROTOCOL.md) §14

Dependencies:

- depends on P1 and P5

Acceptance criteria (all met at the protocol layer):

- ✅ every governance doc has a clear structure owner and content owner
- ✅ no undefined overlap remains between generated docs and live docs at the policy level
- ✅ bootstrap and runtime sync now have a protocol-level policy to implement against
- ✅ existing live docs can be onboarded without blind overwrite behavior at the policy-definition level
- ✅ P6 now serves as the formal closure step for P5 ownership assumptions

Not claimed by P6:

- bootstrap entrypoint implementation
- runtime sync tooling implementation
- automated enforcement of the sync policy in execution code

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
