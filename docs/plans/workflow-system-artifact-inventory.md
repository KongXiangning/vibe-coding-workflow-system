# Workflow System Artifact Inventory

Status: Active
Owner: kongx
Last-Updated: 2026-04-03
Source-Plan: [workflow-system-implementation-plan.md](./workflow-system-implementation-plan.md)

## Purpose

This document is the canonical inventory of implementation artifacts produced by the workflow-system plan.

It is intentionally separate from the main implementation plan:

- the main plan records intent, sequencing, scope, and acceptance logic
- this inventory records concrete code files, generated outputs, tests, and current phase status

The plan document should remain stable.
This inventory document is the place that must change as implementation progresses.

## Update Rule

This rule is mandatory:

- whenever execution of the workflow-system plan advances a phase in a material way, this inventory must be updated in the same change
- no phase step is considered complete until this inventory has been updated to reflect that step
- if code, generated outputs, tests, or phase status change without a corresponding update here, the implementation step is incomplete

Material changes include:

- phase status changes
- new code files added for a phase
- new generated artifacts added or relocated
- new test files added
- existing artifact paths changed
- a phase moves from partial to complete

Do not treat this as optional documentation cleanup.
Updating this file is part of completing the implementation step itself.

## Completion Gate

This document is a required completion gate for execution of the workflow-system plan.

For every completed or materially advanced step:

- update the corresponding phase row in this document
- update `Last-Updated`
- add, remove, or relocate artifact paths as needed
- adjust the phase status when a step changes the implementation state

If a change does not update this file when required, that change must be treated as not fully closed.

## Phase Inventory

| Phase | Code files | Generated artifacts | Test files | Status |
|------|------------|---------------------|------------|--------|
| P1 | [WORKFLOW_PROTOCOL.md](/e:/coding/github/gstack/WORKFLOW_PROTOCOL.md) | Protocol sections inside `WORKFLOW_PROTOCOL.md` | — | Complete |
| P2 | [workflow-core.ts](/e:/coding/github/gstack/scripts/workflow-core.ts) | Shared generator core used by all generators | [workflow-core.test.ts](/e:/coding/github/gstack/test/workflow-core.test.ts) | Complete |
| P3 | [gen-workflow-skills.ts](/e:/coding/github/gstack/scripts/gen-workflow-skills.ts) | [archive-task.SKILL.md](/e:/coding/github/gstack/generated/workflow-skills/archive-task.SKILL.md), [capture-lessons.SKILL.md](/e:/coding/github/gstack/generated/workflow-skills/capture-lessons.SKILL.md), [classify-decisions.SKILL.md](/e:/coding/github/gstack/generated/workflow-skills/classify-decisions.SKILL.md), [create-current-task.SKILL.md](/e:/coding/github/gstack/generated/workflow-skills/create-current-task.SKILL.md), [decompose-task.SKILL.md](/e:/coding/github/gstack/generated/workflow-skills/decompose-task.SKILL.md), [implement-current-step.SKILL.md](/e:/coding/github/gstack/generated/workflow-skills/implement-current-step.SKILL.md), [init-governance.SKILL.md](/e:/coding/github/gstack/generated/workflow-skills/init-governance.SKILL.md), [investigate-root-cause.SKILL.md](/e:/coding/github/gstack/generated/workflow-skills/investigate-root-cause.SKILL.md), [lock-scope.SKILL.md](/e:/coding/github/gstack/generated/workflow-skills/lock-scope.SKILL.md), [prepare-delivery-summary.SKILL.md](/e:/coding/github/gstack/generated/workflow-skills/prepare-delivery-summary.SKILL.md), [review-current-task.SKILL.md](/e:/coding/github/gstack/generated/workflow-skills/review-current-task.SKILL.md), [review-diff.SKILL.md](/e:/coding/github/gstack/generated/workflow-skills/review-diff.SKILL.md), [run-regression.SKILL.md](/e:/coding/github/gstack/generated/workflow-skills/run-regression.SKILL.md), [sync-contracts.SKILL.md](/e:/coding/github/gstack/generated/workflow-skills/sync-contracts.SKILL.md), [sync-current-task.SKILL.md](/e:/coding/github/gstack/generated/workflow-skills/sync-current-task.SKILL.md), [sync-decisions.SKILL.md](/e:/coding/github/gstack/generated/workflow-skills/sync-decisions.SKILL.md), [sync-status.SKILL.md](/e:/coding/github/gstack/generated/workflow-skills/sync-status.SKILL.md), [verify-contracts.SKILL.md](/e:/coding/github/gstack/generated/workflow-skills/verify-contracts.SKILL.md) | [gen-workflow-skills.test.ts](/e:/coding/github/gstack/test/gen-workflow-skills.test.ts) | Complete |
| P4 | [gen-registry.ts](/e:/coding/github/gstack/scripts/gen-registry.ts) | [SKILL_REGISTRY.md](/e:/coding/github/gstack/SKILL_REGISTRY.md) | [gen-registry.test.ts](/e:/coding/github/gstack/test/gen-registry.test.ts) | Complete |
| P5 | [gen-workflow-docs.ts](/e:/coding/github/gstack/scripts/gen-workflow-docs.ts) | [CONTRACTS.md](/e:/coding/github/gstack/generated/workflow-docs/CONTRACTS.md), [CURRENT_TASK.md](/e:/coding/github/gstack/generated/workflow-docs/CURRENT_TASK.md), [DECISIONS.md](/e:/coding/github/gstack/generated/workflow-docs/DECISIONS.md), [LESSONS.md](/e:/coding/github/gstack/generated/workflow-docs/LESSONS.md), [STATUS.md](/e:/coding/github/gstack/generated/workflow-docs/STATUS.md), [TASK_ARCHIVE.md](/e:/coding/github/gstack/generated/workflow-docs/TASK_ARCHIVE.md), [TASK_SUMMARY.md](/e:/coding/github/gstack/generated/workflow-docs/TASK_SUMMARY.md) | [gen-workflow-docs.test.ts](/e:/coding/github/gstack/test/gen-workflow-docs.test.ts) | Complete |
| P6 | [WORKFLOW_PROTOCOL.md](/e:/coding/github/gstack/WORKFLOW_PROTOCOL.md) §14 | Hybrid sync policy defined inside `WORKFLOW_PROTOCOL.md` | — | Complete (Protocol-only) |
| P7a | [bootstrap-project-governance.ts](/e:/coding/github/gstack/scripts/bootstrap-project-governance.ts), [workflow-doc-contracts.ts](/e:/coding/github/gstack/scripts/workflow-doc-contracts.ts) | Dry-run bootstrap plan output only (no committed artifact) | [bootstrap-project-governance.test.ts](/e:/coding/github/gstack/test/bootstrap-project-governance.test.ts) | Complete |
| P7b | [task-identity.ts](/e:/coding/github/gstack/scripts/task-identity.ts), [WORKFLOW_PROTOCOL.md](/e:/coding/github/gstack/WORKFLOW_PROTOCOL.md) §3.4, [FILE_SCHEMAS.md](/e:/coding/github/gstack/FILE_SCHEMAS.md) | [CURRENT_TASK.md](/e:/coding/github/gstack/generated/workflow-docs/CURRENT_TASK.md), [TASK_ARCHIVE.md](/e:/coding/github/gstack/generated/workflow-docs/TASK_ARCHIVE.md), [archive-task.SKILL.md](/e:/coding/github/gstack/generated/workflow-skills/archive-task.SKILL.md), [create-current-task.SKILL.md](/e:/coding/github/gstack/generated/workflow-skills/create-current-task.SKILL.md), [SKILL_REGISTRY.md](/e:/coding/github/gstack/SKILL_REGISTRY.md) | [task-identity.test.ts](/e:/coding/github/gstack/test/task-identity.test.ts), [bootstrap-project-governance.test.ts](/e:/coding/github/gstack/test/bootstrap-project-governance.test.ts), [gen-workflow-docs.test.ts](/e:/coding/github/gstack/test/gen-workflow-docs.test.ts), [gen-workflow-skills.test.ts](/e:/coding/github/gstack/test/gen-workflow-skills.test.ts) | Complete |
| P8 | [validation-model.ts](/e:/coding/github/gstack/scripts/validation-model.ts), [WORKFLOW_PROTOCOL.md](/e:/coding/github/gstack/WORKFLOW_PROTOCOL.md) §16, [PROJECT_PROFILE.yaml](/e:/coding/github/gstack/PROJECT_PROFILE.yaml) `validation.matrix` | Validation model spec, blocker levels, layer precedence, and matrix contract defined in protocol and profile | [validation-model.test.ts](/e:/coding/github/gstack/test/validation-model.test.ts) | Complete |
| P9 | [run-validation.ts](/e:/coding/github/gstack/scripts/run-validation.ts), [check-freshness.ts](/e:/coding/github/gstack/scripts/check-freshness.ts) | Protocol-level validation runner with layer precedence, generator freshness checks | [run-validation.test.ts](/e:/coding/github/gstack/test/run-validation.test.ts) | Complete |
| P10 | [workflow-runtime.ts](/e:/coding/github/gstack/scripts/workflow-runtime.ts), [WORKFLOW_PROTOCOL.md](/e:/coding/github/gstack/WORKFLOW_PROTOCOL.md) §17, [package.json](/e:/coding/github/gstack/package.json) `workflow:*` scripts | Repo-local runtime health report, export manifest JSON, and isolated host-sync plans under `.claude/skills/workflow-system-*`, `.agents/skills/workflow-system-*`, or `.factory/skills/workflow-system-*` | [workflow-runtime.test.ts](/e:/coding/github/gstack/test/workflow-runtime.test.ts) | Complete |
| P11 | — | — | — | Not Started |

## Notes

- Path grammar for workflow generators is aligned to allow only restricted terminal directory patterns of the form `dir/**`; broader glob syntax remains invalid.
- Repo-level path and discovery fields are now treated as a separate grammar layer from workflow protocol fields; shared matching is factored into `scripts/repo-path-patterns.ts`, while profile field classification remains in `scripts/workflow-core.ts`.
- P4 registry coverage was tightened during review: `test/gen-registry.test.ts` verifies registry stage and handoff metadata against committed generated workflow skills, not only template frontmatter, and does so without generating repo-tracked artifacts during the test run.
- P5 is now treated as complete at the current implementation layer: skeleton generation and structure validation are done, and P6 has already closed the ownership assumptions for generated docs at the protocol layer.
- `test/gen-workflow-docs.test.ts` validates committed generated docs without generating repo-tracked artifacts during the test run.
- P6 is intentionally marked `Complete (Protocol-only)` because the policy is defined, but enforcement tooling is not yet implemented.
- P7a is now implemented as a non-destructive bootstrap CLI via `bun run bootstrap:project-governance`; it runs protocol-level generator dry-runs, classifies repo-root governed docs against `generated/workflow-docs/`, and emits a structured adoption plan, checklist, and unbound `A4` validation slots without writing live docs.
- `scripts/workflow-doc-contracts.ts` now centralizes required workflow-doc headings and runtime-placeholder allowances for docs generation, bootstrap planning, and workflow-doc tests.
- P7b now defines a concrete task identity contract: `TASK_ID` is a zero-padded decimal string, `TASK_SLUG` is lowercase ASCII kebab-case, `CURRENT_TASK.md` becomes the live source of task identity, and archive naming is fixed to `TASKS/TASK-<TASK_ID>-<TASK_SLUG>.md`.
- Bootstrap output now reports `task_identity` status separately from governed-doc classification so Adoption `A2` can distinguish placeholder-preserved task packages from A3-ready concrete identities without writing any archive files.
- P8 defines the project-level validation model in `WORKFLOW_PROTOCOL.md` §16 with six subsections: validation layers, blocker levels, layer precedence, validation matrix contract, freshness as protocol-level gates, and separation of concerns. The `scripts/validation-model.ts` module provides types, constants, matrix parsing, layer partitioning, and report building. `PROJECT_PROFILE.yaml` now carries a `validation.matrix` with 8 protocol-level and 4 project-level entrypoints. `test:workflow-all` now includes bootstrap, task-identity, and validation-model tests.
- P9 wires protocol-level checks via `scripts/run-validation.ts` (matrix-driven runner with `--layer`, `--blocker-level`, `--json`, `--dry-run` flags) and `scripts/check-freshness.ts` (compares committed generated artifacts against dry-run output). `validate:protocol`, `validate:all`, and `validate:freshness` scripts are available in `package.json`. `test:workflow-all` now includes `test:run-validation`.
- P10 adds `scripts/workflow-runtime.ts` as the repo-local runtime entry for `workflow:health`, `workflow:manifest`, and `workflow:sync`. The export manifest defines the Adoption `A1` import/install contract, host compatibility notes, and the required artifact set. Host sync writes only into isolated `workflow-system-*` namespaces so native `gstack` runtime outputs are not overwritten. `test:workflow-all` now includes `test:workflow-runtime`.
