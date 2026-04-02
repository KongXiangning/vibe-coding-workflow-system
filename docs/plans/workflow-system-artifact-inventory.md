# Workflow System Artifact Inventory

Status: Active
Owner: kongx
Last-Updated: 2026-04-02
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
| P5 | [gen-workflow-docs.ts](/e:/coding/github/gstack/scripts/gen-workflow-docs.ts) | [CONTRACTS.md](/e:/coding/github/gstack/generated/workflow-docs/CONTRACTS.md), [CURRENT_TASK.md](/e:/coding/github/gstack/generated/workflow-docs/CURRENT_TASK.md), [DECISIONS.md](/e:/coding/github/gstack/generated/workflow-docs/DECISIONS.md), [LESSONS.md](/e:/coding/github/gstack/generated/workflow-docs/LESSONS.md), [STATUS.md](/e:/coding/github/gstack/generated/workflow-docs/STATUS.md), [TASK_ARCHIVE.md](/e:/coding/github/gstack/generated/workflow-docs/TASK_ARCHIVE.md), [TASK_SUMMARY.md](/e:/coding/github/gstack/generated/workflow-docs/TASK_SUMMARY.md) | [gen-workflow-docs.test.ts](/e:/coding/github/gstack/test/gen-workflow-docs.test.ts) | Partially Complete |
| P6 | [WORKFLOW_PROTOCOL.md](/e:/coding/github/gstack/WORKFLOW_PROTOCOL.md) §14 | Hybrid sync policy defined inside `WORKFLOW_PROTOCOL.md` | — | Complete (Protocol-only) |
| P7 | — | — | — | Not Started |
| P8 | — | — | — | Not Started |
| P9 | — | — | — | Not Started |
| P10 | — | — | — | Not Started |
| P11 | — | — | — | Not Started |

## Notes

- Path grammar for workflow generators is aligned to allow only restricted terminal directory patterns of the form `dir/**`; broader glob syntax remains invalid.
- P5 is intentionally marked `Partially Complete` because skeleton generation is done, but final closure depends on sync-policy alignment from P6.
- P6 is intentionally marked `Complete (Protocol-only)` because the policy is defined, but enforcement tooling is not yet implemented.
