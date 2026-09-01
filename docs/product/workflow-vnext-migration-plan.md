# Workflow vNext Migration Plan

- Status: `Target architecture accepted; simplified rollout plan`
- Planning date: `2026-08-31`
- Target architecture: [workflow-vnext-target-architecture.md](../designs/workflow-vnext-target-architecture.md)
- Product rule: an installed project runs either the old workflow or pure vNext; it does not run a long-lived legacy/vNext hybrid

## 1. Product rollout principle

The product migration has one narrow boundary:

```text
old project in `idle`
        ↓
one-time Migration Pack
        ↓
offline conversion of old governance documents
        ↓
install pure vNext
        ↓
old Skills no longer exist
```

The old Skill graph, old protocol, and old schema are migration inputs only. They are not a compatibility runtime layer in vNext. Existing projects do not receive a partial vNext surface while they are still running the old workflow.

The workflow-system source repository is an explicit development exception: it may temporarily retain the old implementation and experimental vNext implementation side by side for development and comparison. This source-repository dual track is not an installed-project product architecture, must not become a target-project compatibility contract, and must not cause old and vNext surfaces to be installed together.

## 2. Phase 1 — Minimum vNext Skill/Capability structure

Phase 1 determines and implements only the smallest target structure required for vNext. It defines the final execution model; it does not create a long-running legacy/shadow rollout for installed projects.

### 2.1 Daily intents

The daily surface remains exactly seven intent entries:

| Entry | Intent |
|---|---|
| `prepare-task` | Turn a request into a bounded executable intent |
| `execute-step` | Implement the admitted current step |
| `review-change` | Produce one unified read-only review verdict |
| `debug-task` | Establish root cause and select an authorized route |
| `task-lifecycle` | Perform an explicit lifecycle/ownership transition |
| `capture-work-item` | Record work proven unrelated to the active task |
| `close-task` | Prove closure eligibility and finish the task |

The administrative `bootstrap-project`, expert/automation `validate-change`, internal `sync-state`, and Runtime transaction surfaces are not additional daily intents.

### 2.2 Adaptive internal capabilities

Preparation, scope, classification, planning, decomposition, review dimensions, and evidence selection are adaptive internal capabilities rather than a fixed Skill handoff chain. The minimum capability structure retains:

- mandatory authority, scope, and dangerous-operation gates;
- adaptive depth selected from explicit risk and evidence triggers;
- unified review with separate finding admission;
- Review Convergence with bounded repair attempts and stop conditions;
- Evidence Admission for claims, evidence, and persistent-test decisions;
- `project-context-resolver` for relevant, precedence-aware canonical context;
- `knowledge-admission-policy` for Contract/Decision/Lesson growth;
- a shared Runtime transaction kernel with exact typed handlers;
- Markdown/YAML canonical governance knowledge as the only project truth.

These capabilities may be implemented or exercised experimentally in the source repository during Phase 1. They are not permission to expose old Skills, create a compatibility branch, or migrate project state at runtime.

### 2.3 Phase 1 boundaries

Phase 1 must not:

- make an installed business project run legacy and vNext together;
- make vNext Skills parse or understand the old protocol/schema;
- hot-migrate an active `CURRENT_TASK` or active finding/repair state;
- add paused/interrupted runtime migration;
- require every vNext reader to remain version-aware;
- introduce a complex legacy fallback route;
- install old Skills, aliases, adapters, or a shadow surface into a target project.

## 3. Migration Pack — idle-only, one-time offline upgrade

### 3.1 Upgrade precondition

Only an old project in its canonical `idle` state may enter the Migration Pack flow. `CURRENT_TASK.md` must already have completed its `close`/`archive` flow before the pack is allowed to run. An active task, unresolved finding/repair, paused work, interrupted work, pending lifecycle/recovery work, or ambiguous state is non-idle and blocks the upgrade.

Recoverable paused or interrupted work is also non-idle. It must be completed or otherwise settled through the old workflow before upgrade. The Migration Pack does not close/archive `CURRENT_TASK`, select an owner, reset attempts, invent recovery facts, or convert unfinished work into `idle`. When the precondition fails, the old installation and old governance documents remain unchanged; this is a migration stop, not a runtime fallback architecture.

### 3.2 Migration Pack scope

The Migration Pack is a separate, one-time, offline conversion tool. It is the only component allowed to read the old protocol and schema. Its input and write scope is limited to:

| Legacy surface | Allowed operation |
|---|---|
| `CONTRACTS` | mechanical heading/schema conversion, stable IDs, provenance, and validation |
| `DECISIONS` | mechanical heading/schema conversion, stable IDs, provenance, and validation |
| `LESSONS` | mechanical heading/schema conversion, stable IDs, provenance, and validation |
| `STATUS` / `BASELINES` and other long-term governance documents | mechanical structure and path/reference conversion |
| `TASK` archives | archive path/schema/reference conversion only |
| workflow schema/version metadata | version and schema-field conversion/validation |
| Skill installation surface | managed installation, registry, host, and generated-path conversion required for pure vNext |

`CURRENT_TASK.md` is an upgrade precondition, not a hot-migration input. Active findings, finding-repair state, paused packages, interrupted runtime state, and other unfinished lifecycle state are outside the pack scope and make the source project non-idle.

The pack must read the exact source project identity, transform copies offline, preserve original text and authoritative facts, record stable IDs and provenance, and validate the complete converted pack before installation. Conversion artifacts, mappings, and reports remain outside the vNext runtime truth model.

### 3.3 Mechanical conversion principle

Migration is structural conversion, not historical semantic re-interpretation. The pack does not require AI to re-understand every old governance document or decide how its meaning should change.

```text
old Markdown
  → new heading/schema
  → stable IDs
  → provenance
  → path/reference adjustments
  → validation
```

The pack must not guess:

- which symbol a Lesson precisely applies to;
- which Lessons are semantically duplicates;
- which semantic tags should be created;
- whether an ambiguous statement should be rewritten, merged, or superseded.

It preserves the original text and records unresolved structure as provenance or an explicit conversion issue. Later vNext use of the original text is the responsibility of `project-context-resolver`; `knowledge-admission-policy` governs new or explicitly proposed durable knowledge and is not a requirement for semantic reclassification during migration.

### 3.4 Pure vNext installation

Installation occurs only after the offline pack is complete and valid. The installed result contains:

- the vNext protocol, File Schema, and canonical project-document schema;
- the vNext daily, administrative, expert, internal, and Runtime surfaces;
- converted Markdown/YAML governance documents;
- no old Skill files, old registry entries, aliases, old-state adapters, or legacy host routes.

The old names are not resolvable after installation. A target project is not expected to keep the old runtime available as a fallback.

### 3.5 Unsupported schema in vNext

vNext readers support only the vNext schema. They may perform a schema check, but they do not become long-term version-aware readers and do not parse legacy content.

When a vNext entry detects an old or unsupported schema:

```text
migration-required
→ stop
```

The stop occurs before task execution, governance-state mutation, conversion, or fallback to an old Skill. The user must run the separate Migration Pack against an eligible idle old project.

### 3.6 Failure boundary

Migration is fail-closed and all-or-nothing with respect to vNext installation:

- a non-idle, ambiguous, stale, or unsupported source blocks the pack;
- a `CURRENT_TASK.md` that has not completed `close`/`archive` blocks the pack;
- conversion or validation failure leaves the old project unchanged;
- an incomplete or stale pack cannot install vNext;
- no partial vNext registry, host surface, schema marker, or generated output is promoted;
- after pure vNext installation, an old schema produces `migration-required`, not legacy fallback.

## 4. Phase 2 — Pure vNext state-changing workflow

After the minimum structure and Migration Pack boundary are defined, Phase 2 begins the state-changing vNext workflow. It runs only against vNext canonical schemas and does not carry an old-runtime compatibility branch. The first Phase 2 slice is implemented as the project-local Node package under `.workflow-system/runtime/` (with the source-repository implementation in `runtime/vnext/src/` and a development-only `scripts/vnext-runtime.ts` wrapper). The initial execution slice is bound to the pure-vNext `execute-step` caller; Slice A additionally binds the lifecycle handler to `task-lifecycle` and the minimal resume-review gate clear action to `prepare-task`.

Phase 2 introduces the first state-changing slice behind typed Runtime proposals and exact handlers:

- `execute-step` for an admitted current step;
- finding admission and bounded repair through Review Convergence;
- Evidence Admission and claim-bound validation;
- task-state and finding-queue commits through the shared Runtime kernel;
- pause, interrupt, and explicit paused/interrupted resume through `lifecycle-transaction`;
- `prepare-task` readiness/resume review through the minimal `clear-resume-review-gate` task-state action;
- fail-closed authority, scope, evidence, and dangerous-operation gates.

The old Skill implementation may remain in the source repository for comparison while this work is developed. It is not installed alongside the Phase 2 product surface. The `supersede` lifecycle mode and durable `prepare-task:replan` path remain contract-only for Slice B; inbox, status, archive, and lesson operations stay contract-only and unbound until their own phases.

Slice A binds `lifecycle-transaction` only for `pause`, `interrupt`, `resume-paused`, and `resume-interrupted`. `supersede` and durable `prepare-task:replan` remain proposal-only for Slice B. The lifecycle transaction owns the exact `CURRENT_TASK.md` plus identity-derived suspended-package pair, including atomic write, read-back, rollback, and fail-closed idempotence. A resume proposal carries the observed SHA-256 `recovery_package_revision`; Runtime compares it with the package bytes read at apply time and checks the live resume gate against the package header before snapshot normalization. Replays revalidate the secondary package before returning `no-op`; a consumed `rehydrated` package may be replaced by the next suspend cycle, while ready/incomplete sibling packages remain blocking. It never reads or hot-migrates an old paused/interrupted runtime.

### 4.1 Slice B — same-task supersede and replan design freeze

Slice B uses same-task replan: `TASK_ID`, `TASK_SLUG`, and the canonical `CURRENT_TASK.md` document identity do not change. Supersede invalidates the current task definition, not the task identity. Only a genuinely independent user request may enter the new-task path and create a new identity.

The two non-active owner tuples are distinct and both retain `lifecycle_state = active`:

| State | Meaning | Execution | Legal exits |
|---|---|---|---|
| `blocked_by_replan + active` | continuation is unsafe, but authority, evidence, or a user-owned decision is insufficient to declare the definition invalid | `execute-step`, pause, and interrupt fail closed | evidence proves the old definition remains valid → `active + active`; invalidation is confirmed → `superseded + active` |
| `superseded + active` | sufficient authority/evidence has formally invalidated the old definition | `execute-step`, pause, and interrupt fail closed; the old definition can never be restored | successful `prepare-task:replan` replacement only → `active + active` |

The legal transitions are:

```text
active + active → mark-replan-blocked → blocked_by_replan + active
blocked_by_replan + active → clear-replan-block → active + active
active + active → supersede → superseded + active
blocked_by_replan + active → supersede → superseded + active
superseded + active → commit-replan → active + active
```

`task-lifecycle:supersede` produces only a typed Supersede proposal containing invalidation kind (`goal | scope | acceptance`), reason, evidence references, and partial-diff disposition (`reusable`, `rollback_required`, `stop_propagation`; each may be empty). It removes execution authority from the old definition and does not write a new goal, acceptance, scope, plan, or steps. `prepare-task:replan` independently resolves context and authority, forms a bounded replacement definition, and produces a typed Replan proposal. Runtime validates schema, identity, source revision, transition, authority marker, and deterministic commit; it does not decide semantic disposition.

Supersede and replan are separate transactions. If replan is blocked after supersede, the task remains `superseded + active`; supersede is never rolled back to restore the old plan. Replan uses a closed replacement of existing task-definition sections and preserves identity, historical execution/provenance/audit records, prior invalidation evidence, and finding history. An old finding never automatically receives repair authority under the replacement definition; if still applicable it must pass finding admission again.

On a successful `commit-replan`, Runtime applies deterministic task-state normalization: the replacement definition supplies `active_step_id`, `active_step_status` becomes `ready`, old admitted or in-progress findings become `deferred` / non-actionable and require fresh finding admission if still applicable, resolved/rejected/already-deferred findings remain history, `review_cycle` resets to the initial no-active-cycle baseline, `resume_requires_review` becomes `false`, and `resume_review_reasons` becomes `[]`. `execution_log` and `applied_proposals` are preserved.

## 5. Subsequent vNext phases

After the first state-changing slice is stable, add the remaining intents incrementally:

1. `task-lifecycle` for pause, interrupt, resume, supersede, and related ownership transitions created within vNext;
2. `close-task` for closure evidence, summary, status, and archive transactions;
3. `bootstrap-project` for design, greenfield, inventory, adopt, and realign flows for projects that are not being upgraded through the Migration Pack;
4. additional project-specific gates and operations only when their authority, evidence, and rollback boundaries are explicit.

The successful `close-task` boundary is frozen separately from the Slice B
replan boundary: `active + active` passes closure eligibility, then
`archive-transaction` atomically produces the canonical task archive and
changes the live tuple to `closed + archived`; only afterward may STATUS and
optional Lesson reconciliation run. This phase does not add non-success
terminal dispositions or a durable `TASK_SUMMARY.md` output.

Each later phase must preserve the seven-intent daily surface, adaptive internal capabilities, Review Convergence, Evidence Admission, canonical Markdown/YAML knowledge, and the Runtime kernel. It must not reintroduce a legacy compatibility runtime.

## 6. Acceptance gates

### 6.1 Phase 1 gate

- the seven daily intents and exposure tiers are explicit;
- internal capabilities are adaptive and are not executable public handoffs;
- Review Convergence and Evidence Admission have bounded contracts;
- `project-context-resolver` and `knowledge-admission-policy` have defined authority boundaries;
- Runtime has one shared kernel with operation-specific write boundaries;
- vNext Skills and readers accept only vNext schemas;
- source-repository experiments are isolated from target-project installation behavior.

### 6.2 Migration Pack gate

- an `idle` old project converts once from an exact source identity;
- any active, unresolved, paused, interrupted, or ambiguous old state is rejected without mutation;
- old governance documents are converted offline into validated canonical Markdown/YAML documents;
- conversion does not perform active-state hot migration or invoke vNext Skills to parse the old protocol;
- pure vNext installation contains no old Skill or compatibility surface;
- an old/unsupported schema in vNext returns `migration-required` and stops.

### 6.3 Phase 2 and later gates

- state changes use typed proposals and the shared Runtime kernel;
- review findings enter repair only through Evidence Admission and convergence checks;
- partial writes, guessed authority, unbounded repair, and success-shaped failure are impossible;
- lifecycle, closure, and bootstrap additions do not widen the daily surface or reintroduce legacy fallback.

The implemented Phase 2 slice additionally requires:

- `.workflow-system/runtime/package.json`, its lockfile, generated `dist/cli.js`, and `.workflow-system/vnext/RUNTIME_CONTRACT.yaml` validate as one versioned project-local Node Runtime distribution;
- the Runtime executes with its own locked dependency tree and does not resolve dependencies from the target project's business `node_modules`;
- the declared Node minimum is checked before any Runtime operation, and the staged package passes a Node self-check before promotion;
- `task-state-transaction` is bound to `execute-step` and only the minimal `prepare-task` resume-review gate clear action; `finding-queue-transaction` remains bound to `execute-step`;
- `lifecycle-transaction` is bound to `task-lifecycle` for `pause`, `interrupt`, `resume-paused`, and `resume-interrupted`, with exact `CURRENT_TASK.md` plus `TASKS/paused/...` or `TASKS/interrupted/...` boundaries;
- `supersede` and durable `prepare-task:replan` remain contract-only until Slice B;
- Slice B acceptance requires the same-task identity rule, the two non-active statuses, the separate supersede/replan transactions, and fail-closed execution/lifecycle prohibitions to be documented before implementation binding;
- canonical runtime state remains inside `CURRENT_TASK.md`, with body/frontmatter consistency checks;
- dry-run, stale-source conflict, idempotent replay, atomic rollback, and post-commit read-back behavior are covered by focused tests for both the single-file and lifecycle transactions;
- `execute-step` does not report a governance write unless the corresponding Runtime result is `success`.

## 7. Explicitly removed from the product architecture

The following are not migration features or rollout goals:

- long-term legacy plus vNext coexistence in a business project;
- hot migration of an active `CURRENT_TASK`;
- hot migration of finding repair state;
- paused/interrupted runtime migration;
- long-term version-aware parsing in every vNext reader;
- complex legacy fallback after vNext installation.

The only dual track permitted is the temporary source-repository development arrangement described in §1. It exists for implementation comparison and has no target-project installation semantics.

## 8. Next boundary

Phase 1's minimum vNext Skill/Capability structure and the independent
Migration Pack boundary are implemented in the source repository. Phase 2's
first product slice binds the shared Runtime transaction kernel for
state-changing `execute-step` task-state and finding-queue proposals. Slice A
also binds the thin `task-lifecycle` proposals for pause, interrupt, and the
two explicit resume modes, plus the minimal `prepare-task` action that clears
the post-resume review gate. Do not add legacy-aware vNext readers, runtime
hot migration, or a long-lived compatibility surface.

## 9. Migration Pack implementation contract

The one-time implementation lives in `scripts/vnext-migration-pack.ts`; it is
not an additional Skill and is not called by `workflow-runtime.ts`. The command
surface is intentionally small:

```text
bun run scripts/vnext-migration-pack.ts preflight --target <old-project>
bun run scripts/vnext-migration-pack.ts convert --target <old-project> --out <pack-dir>
bun run scripts/vnext-migration-pack.ts validate --pack <pack-dir> --target <old-project>
bun run scripts/vnext-migration-pack.ts install --pack <pack-dir> --bundle <vnext-bundle-dir> --target <old-project> --write
bun run scripts/vnext-migration-pack.ts migrate --target <old-project> --out <pack-dir> --bundle <vnext-bundle-dir> --write
```

`convert` performs only read-only inspection of the old project and writes an
external pack directory. The directory contains `migration-pack.json`,
`migration-report.json`, `artifacts/<stable-id>.content`, and
`originals/<stable-id>.source`. Every converted artifact has a deterministic
stable ID, separate original/canonical SHA-256 values, source revision/tree
hash, legacy-target revision/tree hash, source/target path, path-reference
inventory, and provenance. Markdown artifacts receive the deterministic
vNext canonical frontmatter envelope while retaining the complete legacy body;
the profile receives a validated `vnext_migration` extension. `CURRENT_TASK.md`, protocol/schema source files, paused packages,
interrupted packages, and active finding/repair state are never conversion
artifacts. Original document bytes are copied verbatim; semantic deduplication,
Lesson applicability inference, and AI rewriting are out of scope.

`migrate` is the composed one-shot command: it runs `convert` and then the
same validated install path. Omitting `--write` keeps the install phase in
dry-run mode; no target files are changed until `--write` is supplied.

`install` requires both a validated pack and a separately validated
`vnext-bundle.json`. The bundle is bound to the exact source root identity,
revision, and tree hash and must declare `legacy_compatibility: absent` plus
explicit vNext protocol/schema markers, canonical `CURRENT_TASK`, valid Skill
entry contracts, and all seven daily-entry Skill artifacts. The target must still match the pack's
project identity, archived/archived idle snapshot, source checksums, and legacy
installation surface. A changed target or source is stale and stops before any
write.

After promotion, a bound state-changing entry invokes the installed Runtime
with `node .workflow-system/runtime/dist/cli.js apply --root .` and sends the
typed proposal on stdin (or via `--proposal-file`). The Runtime package owns
its dependency tree under `.workflow-system/runtime/node_modules`; it does not
borrow the business project's package or `node_modules`.

The Phase 2 Runtime package, generated Node entrypoint, lockfile, source
references, and `RUNTIME_CONTRACT.yaml` are vNext-bundle artifacts only; they
are intentionally not part of the legacy `workflow:pack` or legacy host
installer artifact set. A legacy target therefore never receives the Phase 2
Runtime as a partial vNext surface. Promotion stages the package and runs
`npm ci --omit=dev` plus the Runtime self-check before the project-local
`.workflow-system/runtime/` directory is atomically promoted.

Installation writes a pure-vNext surface through one rollback-capable file
transaction, replaces the old `CURRENT_TASK.md` and protocol/schema with the
bundle artifacts, removes the old managed host/generated/registry surface, and
writes `.workflow-system/vnext/INSTALL_STATE.json` plus
`.workflow-system/vnext/MIGRATION_RECEIPT.json`. It never writes or closes the
old task during preflight/conversion. An exact pack/bundle/target identity
replay is a no-op; a different marker is a conflict. Any post-install legacy
Skill or compatibility surface causes the transaction to roll back.

Installation also creates an atomic
`.workflow-system/vnext/MIGRATION_IN_PROGRESS.json` boundary before promotion.
If the process is interrupted, a later preflight/install fails closed on this
marker instead of guessing whether the target is safe to retry. Once the
completed install state and all artifact hashes validate, an explicit replay
clears the stale marker. A failed transaction clears the marker only after the
target tree matches the pre-install snapshot with that marker excluded from
the comparison; otherwise the marker remains an operator-recovery blocker.

The machine-readable pack boundary is recorded in
`.workflow-system/vnext/MIGRATION_PACK_SCHEMA.yaml`. The schema and focused
tests are source-repository conformance evidence only; neither the pack nor
its reports become vNext project truth or a long-lived compatibility layer.
