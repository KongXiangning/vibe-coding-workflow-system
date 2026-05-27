# TASK-005-ownership-aware-root-cause-routing

## 任务元数据

- 项目：vibe-coding-workflow-system
- 项目类型：ai-engineering-workflow
- 任务 ID：005
- 任务标题：实现 ownership-aware root-cause routing 与 blocker 归属判定（第三阶段）
- 任务 slug：ownership-aware-root-cause-routing
- 开始时间：2026-05-27
- 结束时间：2026-05-27
- 最终状态：done / regression-passed / archived

## 原始任务包快照

- 来源草案：`docs/workflow/NEXT_TASK_DRAFT_005_OWNERSHIP_AWARE_ROOT_CAUSE_ROUTING.md`
- 目标：在不重开 `003/004` protocol、schema、runtime foundation 的前提下，为 `investigate-root-cause`、`run-regression`、`sync-review-findings` 与 `WORKFLOW_GUIDE` 建立 ownership-aware blocker / root-cause / finding routing。
- 关键验收：
  - 3 个目标 skill 收敛到 6 个 canonical ownership route：`current_task_owned`、`scope_widening_candidate`、`resume_paused_required`、`resume_interrupted_required`、`new_bug_task_required`、`user_decision_required`。
  - 命中 paused / interrupted owner 候选时，必须先读取 matching suspended package evidence，再决定 route / handoff / queue 去向。
  - `conditional_handoff` 必须改为 guard-aware alias：`resume_*_guard_passed -> resume-*`、`resume_*_guard_blocked -> ask-user`。
  - `run-regression` 的 `report-only` 必须保持 terminal report。
  - `sync-review-findings` 只允许 `current_task_owned` 且当前范围内可修的 mechanical finding 进入当前 `CURRENT_TASK.md > 审查问题队列`。
  - `WORKFLOW_GUIDE` 必须显式说明旧任务遗留 blocker 阻断当前 active task 时的 owner-sensitive routing、active-owner guard 与 `/resume-*` / `/lock-scope` / `/create-current-task` / `/ask-user` 指引。
  - 不新增 lifecycle state、resume reason、artifact kind、artifact path、protocol-level named error。
  - 不引入 inbox / backlog artifact。
  - 不修改 runtime manifest / install / health report contract。

## 实际改动摘要

- Skill templates:
  - 更新 `templates/skills/investigate-root-cause.SKILL.md.tmpl`，补齐 ownership-aware root-cause routing、canonical route 闭集、matching suspended package evidence 读取、guard-aware handoff 与 fail-closed 文本。
  - 更新 `templates/skills/run-regression.SKILL.md.tmpl`，补齐 ownership-aware regression routing、report-only terminal rule、guard-aware alias 与 active-owner guard 输出。
  - 更新 `templates/skills/sync-review-findings.SKILL.md.tmpl`，补齐 owner-sensitive queue routing、只允许 `current_task_owned` 入当前队列，以及 paused / interrupted / new bug / user decision findings 的队列隔离。
- Guide / registry:
  - 更新 `templates/docs/WORKFLOW_GUIDE.md.tmpl`，显式补齐旧任务遗留 blocker 阻断当前 active task 时的 canonical route、active-owner guard 与下一步指引。
  - 通过生成器同步 `docs/workflow/SKILL_REGISTRY.md`，反映目标 skill 元数据变化。
- Generated reference outputs:
  - 通过生成器同步 `docs/workflow/generated/workflow-skills/{investigate-root-cause,run-regression,sync-review-findings}.SKILL.md`。
  - 通过生成器同步 `docs/workflow/generated/workflow-docs/WORKFLOW_GUIDE.md`。
- Tests:
  - 更新 `test/gen-workflow-skills.test.ts`，覆盖 3 个目标 skill 的 reads、canonical route、guard-aware alias、report-only terminal rule、queue isolation 与 fail-closed 断言。
  - 更新 `test/gen-workflow-docs.test.ts`，覆盖 guide 中的 ownership-aware blocker routing 与 active-owner guard 指引。
- Governance sync:
  - `docs/workflow/CONTRACTS.md` 固化 ownership-aware root-cause / regression / review-finding routing contract。
  - `docs/workflow/DECISIONS.md` 新增 `AD-009`，明确 canonical route 与 guard-aware handoff 分离。
  - `docs/workflow/LESSONS.md` 记录 owner-sensitive workflow routing 必须分离 ownership 与 handoff 的经验。
  - `docs/workflow/STATUS.md` 同步任务 `005` 的稳定事实与下一检查点。

## 契约与决策记录

- 受影响契约：
  - `ownership-aware root-cause / regression / review-finding routing`
  - workflow generated reference outputs generated-only discipline
  - `run-regression` report-only terminal rule
  - `sync-review-findings` finding queue isolation
- 新增或更新决策：
  - `AD-009`: ownership-aware blocker / root-cause / finding routing 保持 canonical route + guard-aware handoff 分离。
- 保持不变的关键边界：
  - 不重开 `003/004` 的 protocol / schema / runtime foundation。
  - 不新增 lifecycle state、resume reason、artifact kind、artifact path、protocol-level named error。
  - 不扩大到 inbox / backlog artifact。
  - 不修改 runtime manifest / install / health report contract。
  - generated reference outputs 与 `SKILL_REGISTRY.md` 只能由生成器同步。

## 验证与交付证据

- 审查范围：
  - `working-tree`
- 测试 / 验证：
  - `bun run gen:all` 通过。
  - `bun run test:workflow-skills` 通过。
  - `bun run test:registry` 通过。
  - `bun run test:workflow-docs` 通过。
  - `bun run test:workflow-all` 通过，201 pass / 0 fail。
  - `bun run validate:protocol` 通过。
  - `bun run validate:freshness` 通过。
  - `bun run workflow:health --root .` 通过。
- review / QA：
  - `/review-diff`、`/review-implementation`、`/verify-contracts` 整体结论为 clean，无阻塞性问题。
  - report-only 回归结论为 pass；未发现当前 diff 引入新的 freshness、registry 或 protocol 风险。
- 交付摘要：
  - 任务目标：已完成。
  - 是否越界修改：否。
  - 是否触碰稳定契约：是，已同步 `CONTRACTS.md` 与 `DECISIONS.md`。
  - Release mode：none。
  - Deploy source：none。
  - Target environment：local。
  - Health checks：generator / test / protocol validation only。
  - Canary window：not applicable。
  - Performance baseline：not applicable。
  - Rollback / recovery：revert task diff or restore `docs/workflow/CURRENT_TASK.md` from task start base `5833b5cc`。
  - Release evidence：local command output recorded in `docs/workflow/CURRENT_TASK.md` and `docs/workflow/STATUS.md`。
  - canary result：not applicable。
  - performance baseline result：not applicable。
  - rollback status：not triggered。
  - remaining observation：如后续要继续扩大到 protocol / schema / runtime 级别的 dedicated owner state、自动恢复策略或 inbox / backlog artifact，必须另开任务并重新锁范围。

## Lessons 回写

- 本任务新增经验：
  - Owner-sensitive workflow routing must separate ownership from handoff。
- 任务过程中复用的既有经验：
  - Template changes require freshness closure after generated outputs move。
  - Single-file generated reference sync needs explicit diff proof。

## 后续关联

- 后续任务：
  - 如需继续推进 owner routing 相关工作，评估是否需要 protocol / schema / runtime 级别的 dedicated owner state、自动恢复策略或 inbox / backlog artifact，并单独开任务重新锁范围。
  - 如需实现 target root guard，单独锁定 `scripts/**`、`test/**`、协议和基线影响范围。
  - 下一轮入口：`/create-current-task`。
- 相关 issue / PR：无。
- 归档位置：`TASKS/TASK-005-ownership-aware-root-cause-routing.md`
