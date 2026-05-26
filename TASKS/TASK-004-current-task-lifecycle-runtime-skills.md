# TASK-004-current-task-lifecycle-runtime-skills

## 任务元数据

- 项目：vibe-coding-workflow-system
- 项目类型：ai-engineering-workflow
- 任务 ID：004
- 任务标题：实现 CURRENT_TASK lifecycle runtime skills 与 resume review handoff（第二阶段）
- 任务 slug：current-task-lifecycle-runtime-skills
- 开始时间：2026-05-26
- 结束时间：2026-05-26
- 最终状态：done / regression-passed / archived

## 原始任务包快照

- 来源草案：`docs/workflow/NEXT_TASK_DRAFT_004_LIFECYCLE_RUNTIME_SKILLS.md`
- 目标：在任务 `003` 已稳定的 lifecycle contract foundation 上，实现 pause / interrupt / resume runtime skills，并把 resume review gate 固定接回 `review-current-task`。
- 关键验收：
  - 新增 `pause-current-task`、`interrupt-current-task`、`resume-paused-task`、`resume-interrupted-task` 四个 runtime skill template。
  - 四个 lifecycle runtime skill 归入 `阶段 7：状态同步`，并在 registry 中位于 `sync-current-task` 之前。
  - suspend / interrupt skill 必须声明 fail-closed file transaction，并保留完整 live `CURRENT_TASK.md` snapshot / canonical restore payload。
  - resume skill 只接受显式、无歧义、`ready_for_resume + recovery_only` 的输入，不允许自动挑选 package。
  - resume 成功后固定回到 `review-current-task`，不得直接进入实现。
  - `review-current-task` 必须消费 `恢复需审查`、`恢复审查原因` 与 rollback point 三字段，不得静默清 gate。
  - `WORKFLOW_GUIDE`、`SKILL_REGISTRY`、generated reference outputs 与测试必须同步。
  - 不新增 lifecycle state、resume reason、artifact kind、artifact path 或 protocol-level named error。
  - 不实现 ownership-aware root-cause routing、inbox / backlog artifact 或 runtime manifest / install / health report contract。

## 实际改动摘要

- Skill templates:
  - 新增 `templates/skills/pause-current-task.SKILL.md.tmpl`。
  - 新增 `templates/skills/interrupt-current-task.SKILL.md.tmpl`。
  - 新增 `templates/skills/resume-paused-task.SKILL.md.tmpl`。
  - 新增 `templates/skills/resume-interrupted-task.SKILL.md.tmpl`。
  - 扩展 `templates/skills/review-current-task.SKILL.md.tmpl`，加入 Resume Review Gate、drift reason 检查和不得静默清 gate 的规则。
- Guide / registry:
  - 更新 `templates/docs/WORKFLOW_GUIDE.md.tmpl`，加入 lifecycle runtime skill 入口、标准流程和场景路由。
  - 更新 `scripts/gen-registry.ts`，将四个 lifecycle runtime skill 纳入 `WORKFLOW_ORDER`、`HIGH_RISK_SKILLS` 和 `阶段 7：状态同步` branch-style summary。
- Generated reference outputs:
  - 通过生成器同步 `docs/workflow/generated/workflow-skills/{pause-current-task,interrupt-current-task,resume-paused-task,resume-interrupted-task}.SKILL.md`。
  - 通过生成器同步 `docs/workflow/generated/workflow-skills/review-current-task.SKILL.md`。
  - 通过生成器同步 `docs/workflow/generated/workflow-docs/WORKFLOW_GUIDE.md`。
  - 通过生成器同步 `docs/workflow/SKILL_REGISTRY.md`。
- Tests:
  - 扩展 `test/gen-workflow-skills.test.ts`，覆盖 lifecycle runtime skill contract、handoff、fail-closed transaction、payload / marker / gate 规则和 review-current-task resume gate。
  - 扩展 `test/gen-registry.test.ts`，覆盖 stage 7 顺序、branch summary 和 high-risk coverage。
  - 扩展 `test/gen-workflow-docs.test.ts`，覆盖 guide 中 lifecycle runtime skill routing。
- Governance sync:
  - `docs/workflow/CONTRACTS.md` 固化 lifecycle runtime skills / resume review routing contract。
  - `docs/workflow/DECISIONS.md` 新增 `AD-008`，并将 `DEFER-003` 标记为由 `AD-008` 落地替代。
  - `docs/workflow/LESSONS.md` 记录 branch-style registry summary 必须覆盖完整 stage membership 的经验。
  - `docs/workflow/STATUS.md` 先记录能力面稳定，随后按完成审核修正为“任务 004 close/archive 收尾待完成”，避免把未归档任务误写为已归档完成。

## 契约与决策记录

- 受影响契约：
  - `CURRENT_TASK lifecycle runtime skills / resume review routing`
  - workflow generated reference outputs generated-only discipline
  - stage 7 registry branch-style routing
  - resumed task 的 `review-current-task` 首个消费者规则
- 新增或更新决策：
  - `AD-008`: lifecycle runtime skills 统一在阶段 7 通过 `review-current-task` 完成恢复审查。
  - `SUPERSEDED-002`: `DEFER-003` 已由 `AD-008` 落地替代。
- 保持不变的关键边界：
  - 不重开任务 `003` 的 protocol / schema foundation。
  - 不新增 dedicated resume review skill。
  - 不允许 resume 自动挑选 suspended package。
  - 不扩大到 inbox / backlog artifact。
  - 不修改 runtime manifest / install / health report contract。
  - generated reference outputs 与 `SKILL_REGISTRY.md` 只能由生成器同步。

## 验证与交付证据

- 实现提交：
  - `23c36e73 feat: add lifecycle runtime skills`
- 审查范围：
  - `06bfc714..23c36e73`
- 测试 / 验证：
  - `bun run gen:all` 通过。
  - `bun run test:workflow-skills` 通过。
  - `bun run test:registry` 通过。
  - `bun run test:workflow-docs` 通过。
  - `bun run test:workflow-all` 通过，201 pass / 0 fail。
  - `bun run validate:protocol` 通过。
  - `bun run validate:freshness` 通过。
  - `bun run workflow:health --root .` 通过。
  - 完成审核后的 `sync-current-task` / `sync-status` 修正后，`bun run validate:protocol` 通过。
- review / QA：
  - 步骤 6-9 的 `/review-diff`、`/review-implementation`、`/verify-contracts`、`/run-regression` 均未发现阻断问题。
  - 完成审核发现的问题不是实现缺陷，而是 close/archive 收尾事实与 `STATUS.md` 记录不一致；已通过 `sync-current-task` 与 `sync-status` 暴露并修正。
- 交付摘要：
  - 任务目标：已完成。
  - 是否越界修改：否。
  - 是否触碰稳定契约：是，已同步 `CONTRACTS.md` 和 `DECISIONS.md`。
  - Release mode：none。
  - Deploy source：none。
  - Target environment：local。
  - Health checks：generator / test / protocol validation only。
  - Canary window：not applicable。
  - Performance baseline：not applicable。
  - Rollback / recovery：revert task diff or restore `docs/workflow/CURRENT_TASK.md` from task start base `06bfc714`。
  - Release evidence：local command output recorded in `docs/workflow/CURRENT_TASK.md` and `docs/workflow/STATUS.md`。
  - canary result：not applicable。
  - performance baseline result：not applicable。
  - rollback status：not triggered。
  - remaining observation：lifecycle 后续如继续扩到 inbox / backlog artifact 或 runtime manifest / install / health report contract，必须另开任务并重新锁范围。

## Lessons 回写

- 本任务新增经验：
  - Branch-style registry summaries must still match full stage membership。
- 任务过程中复用的既有经验：
  - Contract foundation tasks must not drift into runtime delivery。
  - Template changes require freshness closure after generated outputs move。

## 后续关联

- 后续任务：
  - 如需继续推进 lifecycle 相关工作，单独评估 inbox / backlog artifact 或 runtime manifest / install / health report contract。
  - 如需实现 target root guard，单独锁定 `scripts/**`、`test/**`、协议和基线影响范围。
  - 下一轮入口：`/create-current-task`。
- 相关 issue / PR：无。
- 归档位置：`TASKS/TASK-004-current-task-lifecycle-runtime-skills.md`
