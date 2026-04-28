# Workflow System Bundle Audit

Bundle: `dist/workflow-system/workflow-system-0.14.5.0+ded286c453de`

## Local Recheck After Fixes

Source: local `bun run gen:all` after commit `71ad89e2` (`Fix workflow skill contracts`).

Legend:

- **Resolved**: the locally regenerated outputs no longer reproduce the original issue.
- **Invalid premise**: the original finding relied on treating `generated/workflow-skills/**` as target-project live runtime artifacts. The runtime contract defines them as **source-repo reference outputs**, while install only manages `script` / `protocol` / `template` artifacts (`scripts/workflow-runtime.ts:322-323, 341, 1024-1027`).

### 1. `design-baseline-init`

**Status:** Resolved

1. **Resolved.** `output` / execution text now align with the authorized write surface by explicitly treating `DATABASE.md` as the home and `docs/designs/database-design.md` as the companion draft.
2. **Resolved.** `BASELINES.md` / `DECISIONS.md` are now described consistently as draft outputs instead of “如适用”.

### 2. `greenfield-init`

**Status:** Resolved

1. **Resolved.** Human-readable text now explains that `writes` enumerates host-compatible authorized paths while only the current host file should actually be updated.
2. **Resolved.** `forbidden_writes` now blocks code directories, so init runs no longer have an empty file-level guard.

### 3. `legacy-inventory`

**Status:** Resolved

1. **Resolved.** The skill no longer advertises `schema snapshot`; it now consistently outputs `DATABASE.md`.
2. **Resolved.** The source template now uses profile-derived code directories instead of hardcoded `src/`, `scripts/`, `test/`, `migrations/`, `db/`, `prisma/`, `drizzle/`, and `deploy/`, and the regenerated reference output now explicitly explains that its concrete directory list is a source-repo render, not a universal target-project directory contract.

### 4. `adopt-existing-project`

**Status:** Resolved

1. **Resolved.** Host-guidance wording now matches the host-compatible authorization model used by `writes`.
2. **Resolved.** `writes` now includes `docs/adoption/ADOPTION_REPORT.md`, matching the body’s “必要时更新 adoption 报告” behavior.

### 5. `create-current-task`

**Status:** Partially resolved

1. **Resolved.** `reads` now includes `CONTRACTS.md`, matching the skill’s source-of-truth and propagation rules.
2. **Invalid premise.** The repo-specific rendered project variables are still present in `generated/workflow-skills/create-current-task.SKILL.md`, but that file is a source-repo reference render, not an installed target-project runtime skill.

### 6. `review-current-task`

**Status:** Partially resolved

1. **Resolved.** `reads` now includes `PROJECT_PROFILE.yaml`, so the skill can actually police task-package overrides against project-level settings.
2. **Invalid premise.** The remaining repo-specific rendered project variables are expected in source-repo reference outputs.

### 7. `lock-scope`

**Status:** Partially resolved

1. **Invalid premise.** The rendered project structure in `generated/workflow-skills/lock-scope.SKILL.md` is still repo-specific because this file is a source-repo reference render, not a target-project-installed live skill.
2. **Resolved.** `reads` now includes `PROJECT_PROFILE.yaml`, matching the precedence rules that mention it.

### 8. `classify-decisions`

**Status:** Partially resolved

1. **Resolved.** `writes` no longer includes `DECISIONS.md`; the skill now only writes `CURRENT_TASK.md`, matching its classification-only role.
2. **Invalid premise.** Repo-specific rendered project variables in the generated reference output are expected for the source repo.

### 9. `decompose-task`

**Status:** Invalid premise

1. **Invalid premise.** This finding targets repo-specific rendered project variables inside a source-repo reference output, not a target-project-installed live skill.

### 10. `implement-current-step`

**Status:** Invalid premise

1. **Invalid premise.** The rendered `writes` / structure values are source-repo reference renderings, not hardcoded target-project runtime restrictions.
2. **Invalid premise.** The remaining “Replace project variables...” note appears in the reference output because this repo renders its own profile into `generated/**`.

### 11. `review-diff`

**Status:** Partially resolved

1. **Resolved.** `reads` no longer contains `git diff`; the diff remains an execution input/context, not a path entry.
2. **Invalid premise.** Repo-specific rendered project variables in the generated reference output are expected.

### 12. `verify-contracts`

**Status:** Partially resolved

1. **Resolved.** `reads` no longer contains `git diff`.
2. **Invalid premise.** Repo-specific rendered project variables in the generated reference output are expected.

### 13. `run-regression`

**Status:** Partially resolved

1. **Resolved.** `reads` now only contains path entries (`CURRENT_TASK.md`, `PROJECT_PROFILE.yaml`); diff/test/checklist inputs remain dynamic inputs instead of fake paths.
2. **Invalid premise.** Repo-specific rendered project variables in the generated reference output are expected.

### 14. `investigate-root-cause`

**Status:** Partially resolved

1. **Resolved.** `reads` no longer contains prose descriptors like `报错信息` / `当前 diff` / `相关日志或测试结果`.
2. **Invalid premise.** Repo-specific rendered project variables in the generated reference output are expected.

### 15. `sync-current-task`

**Status:** Partially resolved

1. **Resolved.** `reads` no longer contains `验证结果` / `实际修改结果`.
2. **Invalid premise.** Repo-specific rendered project variables in the generated reference output are expected.

### 16. `sync-status`

**Status:** Partially resolved

1. **Resolved.** `reads` no longer contains descriptive pseudo-inputs like `验证结果`.
2. **Invalid premise.** Repo-specific rendered project variables in the generated reference output are expected.

### 17. `sync-contracts`

**Status:** Partially resolved

1. **Resolved.** `reads` no longer contains `实际改动` / `验证结果`.
2. **Invalid premise.** Repo-specific rendered project variables in the generated reference output are expected.

### 18. `sync-decisions`

**Status:** Partially resolved

1. **Resolved.** `reads` no longer contains `实际结果` / `用户确认信息`.
2. **Invalid premise.** Repo-specific rendered project variables in the generated reference output are expected.

### 19. `capture-lessons`

**Status:** Partially resolved

1. **Resolved.** `reads` no longer contains `验证结果` / `本轮问题与修复过程`.
2. **Invalid premise.** Repo-specific rendered project variables in the generated reference output are expected.

### 20. `prepare-delivery-summary`

**Status:** Partially resolved

1. **Resolved.** `reads` no longer contains `验证结果` / `git diff --stat` / `状态同步结果`; it now reads real paths only.
2. **Invalid premise.** Repo-specific rendered project variables in the generated reference output are expected.

### 21. `archive-task`

**Status:** Resolved

1. **Resolved.** `reads` no longer contains `任务摘要` as a fake path entry.
2. **Resolved.** The generated body now preserves the `TASK_ID` / `TASK_SLUG` materialization checks in both `Must Check` and `Stop Conditions`.

## Review Log

### 1. `design-baseline-init`

**Status:** Issues found

1. **[P2] (confidence: 9/10)** `generated/workflow-skills/design-baseline-init.SKILL.md:26-34, 51-57, 97-103`
   `writes` simultaneously lists `DATABASE.md` and `docs/designs/database-design.md` as required outputs, but the same skill's `output` section and execution rule 5 describe them as an either-or choice. The frontmatter is the normative contract, so this mismatch can push the agent to create two database-design artifacts for one initialization pass.
2. **[P2] (confidence: 9/10)** `generated/workflow-skills/design-baseline-init.SKILL.md:33-34, 57, 102-103`, `generated/workflow-docs/WORKFLOW_GUIDE.md:28`
   `writes` marks `BASELINES.md` and `DECISIONS.md` as fixed outputs, while the body says they are draft-only and `output` says they are only produced "如适用". The guide also describes them as optional drafts, so the bundle currently overstates what this skill must emit.

### 2. `greenfield-init`

**Status:** Issues found

1. **[P2] (confidence: 9/10)** `generated/workflow-skills/greenfield-init.SKILL.md:31-39, 52-55, 96-99`, `generated/workflow-docs/WORKFLOW_GUIDE.md:29`
   `writes` requires both `AGENTS.md` and `CLAUDE.md`, but the same skill's `output` section, execution rule 5, and the guide all describe a single host-specific guidance file. That means the machine-readable contract is stricter than the intended behavior and can make one initialization run emit the wrong host file.
2. **[P2] (confidence: 7/10)** `generated/workflow-skills/greenfield-init.SKILL.md:40, 102-107`, `generated/workflow-docs/WORKFLOW_GUIDE.md:7-8`
   `forbidden_writes` is empty even though the hard boundaries say this skill must not start implementation work. Because the guide says the skill frontmatter is normative, the bundle currently has no file-level guard stopping an init run from drifting into `src/**`, `test/**`, or `scripts/**` edits.

### 3. `legacy-inventory`

**Status:** Issues found

1. **[P2] (confidence: 9/10)** `generated/workflow-skills/legacy-inventory.SKILL.md:31-37, 53-59, 99-103`, `generated/workflow-docs/WORKFLOW_GUIDE.md:30`
   `writes` only allows `DATABASE.md`, but the same skill's `output` section, execution rule 4, and the guide all say the inventory may emit either `DATABASE.md` or a schema snapshot. Because the frontmatter is the normative contract, the documented alternate output path is not actually legal in this bundle.
2. **[P2] (confidence: 8/10)** `generated/workflow-skills/legacy-inventory.SKILL.md:16-30`, `CLAUDE.md:136-146`, `WORKFLOW_PROTOCOL.md:613-620`
   This skill is meant to inventory arbitrary existing repos, but its read scope hardcodes directory names like `src/`, `scripts/`, `test/`, `migrations/`, `db/`, `prisma/`, `drizzle/`, and `deploy/`. That conflicts with the repo's platform-agnostic design rule against hardcoded directory structures and risks missing the primary code in Rails (`app/`), Go (`cmd/`, `internal/`), or monorepo (`packages/`) projects, producing incomplete adoption facts.

### 4. `adopt-existing-project`

**Status:** Issues found

1. **[P2] (confidence: 9/10)** `generated/workflow-skills/adopt-existing-project.SKILL.md:33-41, 56-59, 103-107`, `generated/workflow-docs/WORKFLOW_GUIDE.md:31`
   `writes` requires both `AGENTS.md` and `CLAUDE.md`, but the skill body, output section, and guide all describe a single host-specific guidance file. That means the normative contract can force one adoption run to emit the wrong host file instead of just the active host's file.
2. **[P2] (confidence: 9/10)** `generated/workflow-skills/adopt-existing-project.SKILL.md:33-41, 56-60, 103`, `generated/workflow-skills/legacy-inventory.SKILL.md:34-36, 56-58`
   The skill says it may "附带 adoption 报告" when confirming the baseline, but `writes` does not include `docs/adoption/ADOPTION_REPORT.md` or any other adoption-report path. In practice the contract allows `legacy-inventory` to create the report, but does not allow `adopt-existing-project` to update or extend it even when the body explicitly says it may.

### 5. `create-current-task`

**Status:** Issues found

1. **[P1] (confidence: 10/10)** `generated/workflow-skills/create-current-task.SKILL.md:18-23, 100-107, 168-172`
   The skill's source-of-truth and propagation rules explicitly say `CONTRACTS.md` outranks `CURRENT_TASK.md` and that task packages must list affected locked contracts, but `reads` omits `CONTRACTS.md`. That means the draft task package can be generated without reading the very contract file it claims must take precedence.
2. **[P1] (confidence: 10/10)** `generated/workflow-skills/create-current-task.SKILL.md:154-162, 318`
   This generated bundle skill still embeds `gstack`-specific project variables (`scripts, browse/src, design/src, test, browse/test`) and even ships the note "Replace project variables with concrete project-specific values during skill generation." In other words, the installed artifact is still a half-generated template, not a target-project-ready skill.

### 6. `review-current-task`

**Status:** Issues found

1. **[P2] (confidence: 9/10)** `generated/workflow-skills/review-current-task.SKILL.md:18-24, 43-50, 95-98`
   The stop conditions and source-of-truth rules say this review must detect when `CURRENT_TASK.md` tries to override `PROJECT_PROFILE.yaml`, but `reads` does not include `PROJECT_PROFILE.yaml`. The skill cannot reliably police that boundary without reading the file it says must not be silently overridden.
2. **[P1] (confidence: 10/10)** `generated/workflow-skills/review-current-task.SKILL.md:134-142, 282`
   Like the preceding skill, this shipped bundle still contains `gstack`-specific project variables and an unresolved "Replace project variables..." note. That makes the runtime guidance repo-specific instead of target-project-specific.

### 7. `lock-scope`

**Status:** Issues found

1. **[P1] (confidence: 10/10)** `generated/workflow-skills/lock-scope.SKILL.md:23-30, 150-158, 314`
   The skill whose whole job is to define mutation boundaries ships with `forbidden_writes` and project structure hardcoded to `gstack` paths like `scripts`, `browse/src`, `design/src`, `test`, and `browse/test`. Installed into another repo, it starts from the wrong forbidden surface map before it even reads the target task.
2. **[P2] (confidence: 8/10)** `generated/workflow-skills/lock-scope.SKILL.md:17-22, 116-119`
   `source_of_truth_rules` says `CONTRACTS.md` outranks `PROJECT_PROFILE.yaml`, but `reads` never includes `PROJECT_PROFILE.yaml`. That means scope locking cannot reconcile project-level defaults or forbidden path declarations against the current task, even though the skill text claims that precedence model.

### 8. `classify-decisions`

**Status:** Issues found

1. **[P2] (confidence: 8/10)** `generated/workflow-skills/classify-decisions.SKILL.md:20-23, 36-39, 122-131`
   The purpose and output only promise classification results plus unresolved Taste / User challenge items, but `writes` also includes `DECISIONS.md`. That creates pressure to persist unconfirmed decision candidates into the durable decision log even though confirmed decision syncing is handled later by `sync-decisions`.
2. **[P1] (confidence: 10/10)** `generated/workflow-skills/classify-decisions.SKILL.md:83-91, 155`
   The bundle still ships `gstack`-specific project variables and the unresolved "Replace project variables..." note. This is not a generic installed skill yet.

### 9. `decompose-task`

**Status:** Issues found

1. **[P1] (confidence: 10/10)** `generated/workflow-skills/decompose-task.SKILL.md:96-104, 195`
   The installed skill still contains `gstack` as the project name, `scripts, browse/src, design/src, test, browse/test` as the project structure, and the explicit note that project variables still need replacement. That means the decomposition guidance is shipping with the source repo's metadata instead of the target repo's metadata.

### 10. `implement-current-step`

**Status:** Issues found

1. **[P1] (confidence: 10/10)** `generated/workflow-skills/implement-current-step.SKILL.md:23-30`
   `writes` is hardcoded to `scripts`, `browse/src`, `design/src`, `test`, `browse/test`, and `CURRENT_TASK.md`. For an installed workflow-system that is supposed to run inside arbitrary target repos, this contract makes most legitimate application files illegal to touch and ties implementation to the gstack repo layout.
2. **[P1] (confidence: 10/10)** `generated/workflow-skills/implement-current-step.SKILL.md:136-144, 294`
   The same skill also ships unreplaced `gstack` project variables plus the explicit note "Replace project variables with concrete project-specific values during skill generation." This confirms the runtime artifact is still carrying source-repo scaffolding.

### 11. `review-diff`

**Status:** Issues found

1. **[P2] (confidence: 10/10)** `generated/workflow-skills/review-diff.SKILL.md:18-23`, `WORKFLOW_PROTOCOL.md:471-473, 598-650`
   `reads` contains `git diff`, but the protocol says `reads` entries must be path-grammar values, not shell commands or prose handles. This bundle therefore violates its own workflow contract for read declarations.
2. **[P1] (confidence: 10/10)** `generated/workflow-skills/review-diff.SKILL.md:166-174, 355`
   The generated skill still embeds `gstack`-specific project variables and an unresolved instruction to replace them later. That makes the installed review context repo-specific instead of portable.

### 12. `verify-contracts`

**Status:** Issues found

1. **[P2] (confidence: 10/10)** `generated/workflow-skills/verify-contracts.SKILL.md:17-21`, `WORKFLOW_PROTOCOL.md:471-473, 598-650`
   `reads` includes `git diff`, which is not a path entry under the protocol's path grammar. The contract-check skill is therefore shipping with an invalid `reads` contract.
2. **[P1] (confidence: 10/10)** `generated/workflow-skills/verify-contracts.SKILL.md:96-104, 184`
   The bundle still contains `gstack` project variables and the "Replace project variables..." note. The installed skill has not been fully materialized for the target project.

### 13. `run-regression`

**Status:** Issues found

1. **[P2] (confidence: 10/10)** `generated/workflow-skills/run-regression.SKILL.md:20-26`, `WORKFLOW_PROTOCOL.md:471-473, 598-650`
   `reads` uses non-path descriptors like `当前 diff`, `测试命令`, and `验证清单`. The workflow protocol says `reads` must be path-like contract entries, so this shipped skill violates the schema.
2. **[P1] (confidence: 10/10)** `generated/workflow-skills/run-regression.SKILL.md:156-164, 339`
   The generated skill still embeds `gstack`-specific project variables and a note saying they still need replacement. That means the runtime regression guidance is not actually target-project-specific.

### 14. `investigate-root-cause`

**Status:** Issues found

1. **[P2] (confidence: 10/10)** `generated/workflow-skills/investigate-root-cause.SKILL.md:18-24`, `WORKFLOW_PROTOCOL.md:471-473, 598-650`
   `reads` uses descriptive items like `报错信息`, `当前 diff`, and `相关日志或测试结果` instead of protocol-valid path entries. That breaks the declared workflow schema for skill contracts.
2. **[P1] (confidence: 10/10)** `generated/workflow-skills/investigate-root-cause.SKILL.md:110-118, 230`
   The installed skill still carries `gstack` project metadata and an unresolved "Replace project variables..." note, so the bundle has not been fully specialized for the target repository.

### 15. `sync-current-task`

**Status:** Issues found

1. **[P2] (confidence: 10/10)** `generated/workflow-skills/sync-current-task.SKILL.md:17-22`, `WORKFLOW_PROTOCOL.md:471-473, 598-650`
   `reads` includes `验证结果` and `实际修改结果`, which are descriptions rather than protocol-valid path entries. The sync contract is malformed under the workflow protocol.
2. **[P1] (confidence: 10/10)** `generated/workflow-skills/sync-current-task.SKILL.md:81-89, 152`
   The shipped skill still embeds `gstack`-specific project variables and a note saying they must be replaced later. That makes the installed state-sync guidance source-repo-specific.

### 16. `sync-status`

**Status:** Issues found

1. **[P2] (confidence: 10/10)** `generated/workflow-skills/sync-status.SKILL.md:17-22`, `WORKFLOW_PROTOCOL.md:471-473, 598-650`
   `reads` uses `验证结果` as a descriptive pseudo-input rather than a protocol-valid path declaration. The skill contract does not conform to the workflow schema.
2. **[P1] (confidence: 10/10)** `generated/workflow-skills/sync-status.SKILL.md:103-111, 213`
   The installed skill still contains `gstack` project variables and the unresolved replacement note, so it is shipping source-repo context into target-project runtime behavior.

### 17. `sync-contracts`

**Status:** Issues found

1. **[P2] (confidence: 10/10)** `generated/workflow-skills/sync-contracts.SKILL.md:17-23`, `WORKFLOW_PROTOCOL.md:471-473, 598-650`
   `reads` contains `实际改动` and `验证结果`, which are descriptive labels, not path-grammar values. That makes the frontmatter invalid under the workflow protocol.
2. **[P1] (confidence: 10/10)** `generated/workflow-skills/sync-contracts.SKILL.md:88-96, 166`
   The generated skill still embeds `gstack` project variables and the note that they still need replacement. The runtime artifact is not fully materialized.

### 18. `sync-decisions`

**Status:** Issues found

1. **[P2] (confidence: 10/10)** `generated/workflow-skills/sync-decisions.SKILL.md:18-24`, `WORKFLOW_PROTOCOL.md:471-473, 598-650`
   `reads` includes `实际结果` and `用户确认信息`, which are prose descriptors rather than protocol-valid path entries. The skill frontmatter violates the declared schema.
2. **[P1] (confidence: 10/10)** `generated/workflow-skills/sync-decisions.SKILL.md:87-95, 162`
   The installed skill still ships with `gstack`-specific project variables and an unresolved "Replace project variables..." note, so it is not actually target-project-ready.

### 19. `capture-lessons`

**Status:** Issues found

1. **[P2] (confidence: 10/10)** `generated/workflow-skills/capture-lessons.SKILL.md:18-24`, `WORKFLOW_PROTOCOL.md:471-473, 598-650`
   `reads` contains descriptive items like `验证结果` and `本轮问题与修复过程` instead of path-like contract entries. That breaks the workflow protocol for frontmatter `reads`.
2. **[P1] (confidence: 10/10)** `generated/workflow-skills/capture-lessons.SKILL.md:89-97, 166`
   The bundle still contains `gstack` project variables and the unresolved project-variable replacement note. This is source-repo metadata leaking into an installed runtime skill.

### 20. `prepare-delivery-summary`

**Status:** Issues found

1. **[P2] (confidence: 10/10)** `generated/workflow-skills/prepare-delivery-summary.SKILL.md:18-23`, `WORKFLOW_PROTOCOL.md:471-473, 598-650`
   `reads` includes `验证结果`, `git diff --stat`, and `状态同步结果`, which are command/prose descriptors rather than protocol-valid paths. The frontmatter contract is invalid under the workflow schema.
2. **[P1] (confidence: 10/10)** `generated/workflow-skills/prepare-delivery-summary.SKILL.md:112-120, 226`
   The installed skill still embeds `gstack` project variables and an unresolved note saying they must be replaced later. That means the bundle is shipping unfinished template material.

### 21. `archive-task`

**Status:** Issues found

1. **[P2] (confidence: 10/10)** `generated/workflow-skills/archive-task.SKILL.md:18-23`, `WORKFLOW_PROTOCOL.md:471-473, 598-650`
   `reads` includes `任务摘要`, which is a prose label rather than a protocol-valid path entry. The archive skill therefore violates the workflow contract schema.
2. **[P2] (confidence: 9/10)** `generated/workflow-skills/archive-task.SKILL.md:32-42, 129-153`
   The frontmatter requires checking that `TASK_ID` and `TASK_SLUG` are materialized and stopping if they are still placeholders, but the generated body drops those checks from both "Must Check" and "Stop Conditions". The machine-readable contract and the human-readable execution text disagree on a critical archive precondition.
