# TASK-003-current-task-suspend-resume-contract-foundation

## 任务元数据

- 项目：vibe-coding-workflow-system
- 项目类型：ai-engineering-workflow
- 任务 ID：003
- 任务标题：补齐 CURRENT_TASK 暂停 / 中断 / 恢复协议与工件契约（第一阶段）
- 任务 slug：current-task-suspend-resume-contract-foundation
- 开始时间：2026-05-25
- 结束时间：2026-05-26
- 最终状态：done / regression-passed

## 原始任务包快照

- 来源草案：`docs/workflow/NEXT_TASK_DRAFT_003_CURRENT_TASK_LIFECYCLE.md`
- 目标：先稳定 `CURRENT_TASK` suspend / interrupt / resume 的第一阶段协议契约，不实现 lifecycle runtime skills。
- 关键验收：
  - v1 lifecycle state 闭集：`active`、`paused_pending_closure`、`paused_blocked`、`interrupted`、`archived`。
  - `backlog_item`、`capture`、`active_review_required` 不属于 v1 lifecycle state。
  - `CURRENT_TASK.md > ## 任务信息` 区分 `当前状态` 与 `生命周期状态`，并新增 `恢复需审查` / `恢复审查原因` gate。
  - `scripts/task-identity.ts` 分离 identity completeness、workflow status、lifecycle state、ownership status 和 artifact kind。
  - task artifact path 扩展为 archive / paused / interrupted 三类路径。
  - `workflow-doc-contracts.ts` 校验 suspended package path / structure。
  - `run-validation.ts` 接入 `suspended-task-package-validation` protocol-level synthesized check。
  - 不新增 lifecycle runtime skill、inbox / backlog artifact、guide / registry routing 或 runtime manifest / install / health report contract 变更。
- 完整执行记录保留在归档前的 `docs/workflow/CURRENT_TASK.md` diff 和本归档摘要中。

## 实际改动摘要

- 协议 / schema：
  - `.workflow-system/WORKFLOW_PROTOCOL.md` 定义 lifecycle state、active ownership、transition / resume gate、fail-closed idempotence、partial failure recovery 和 dual-active protection。
  - `.workflow-system/FILE_SCHEMAS.md` 定义 `CURRENT_TASK` lifecycle / resume gate 字段映射、closed enums、suspended package 最小字段与 artifact path contract。
- 模板 / generated reference：
  - `templates/docs/CURRENT_TASK.md.tmpl` 新增 `生命周期状态：active`、`恢复需审查：false`、空 `恢复审查原因` 默认字段。
  - `docs/workflow/generated/workflow-docs/CURRENT_TASK.md` 仅通过生成器同步上述三个 reference render 字段。
- 实现 / 测试：
  - `scripts/task-identity.ts` 新增 workflow status、lifecycle state、ownership status、artifact kind、artifact path resolver、status tuple 校验和 resume gate drift helper。
  - `scripts/bootstrap-project-governance.ts` 将 `BootstrapTaskIdentityPlan` 从单一 `archive_path_pattern` 升级为 `artifact_paths` 映射，并记录 source-repo governance output impact assessment。
  - `scripts/workflow-doc-contracts.ts` 新增 suspended package path parser、path template helper 和 structure validator。
  - `scripts/run-validation.ts` 接入 `suspended-task-package-validation` synthesized check。
  - 相关测试覆盖 workflow docs、task identity、bootstrap governance 和 run-validation flow。
- 治理同步：
  - `docs/workflow/STATUS.md` 标记任务 003 已完成且稳定。
  - `docs/workflow/CONTRACTS.md` 固化 lifecycle / resume gate、artifact path、task identity resolver 和 suspended package validation 边界。
  - `docs/workflow/DECISIONS.md` 记录 `AD-005`、`AD-006`、`AD-007`、`DEFER-003`、`REJECTED-002`、`REJECTED-003`。
  - `docs/workflow/LESSONS.md` 记录 contract foundation 防止漂移到 runtime delivery、单一 generated reference sync 需 diff proof 两条经验。
  - `AGENTS.md` 与 `CLAUDE.md` 同步 `CURRENT_TASK` lifecycle 长期边界和 `workflow:health --root .` 命令。

## 契约与决策记录

- 受影响契约：
  - `CURRENT_TASK lifecycle / resume gate contract`
  - `task artifact path contract`
  - `scripts/task-identity.ts` identity / ownership / artifact path resolver boundary
  - `suspended-task-package-validation` protocol-level synthesized check
- 新增或更新决策：
  - `AD-005`: CURRENT_TASK lifecycle foundation 先稳定契约再实现 runtime skills。
  - `AD-006`: CURRENT_TASK active ownership 由 workflow status 与 lifecycle state 共同决定。
  - `AD-007`: suspended package 是 task artifact，不是 workflow governance catalog 对象。
  - `DEFER-003`: Lifecycle runtime skills and routing 后续单独任务处理。
  - `REJECTED-002`: 拒绝手工编辑 generated reference outputs。
  - `REJECTED-003`: 拒绝把本任务扩大为一般 generated maintenance。
- 保持不变的关键边界：
  - source repo 禁止 `workflow:install --root .`。
  - generated reference outputs 只能由生成器写入。
  - `docs/workflow/` 仍只承载治理管理面。
  - target-project validation slots 不绑定为 source repo quality gates。

## 验证与交付证据

- 测试 / 验证：
  - `bun run gen:all` 通过。
  - `bun run test:workflow-all` 通过，201 pass / 0 fail。
  - `bun run validate:protocol` 通过。
  - `bun run validate:freshness` 通过。
  - `bun run workflow:health --root .` 通过。
  - `git diff --check` 和 `git diff --cached --check` 通过；仅有 CRLF/LF 提示。
- review / QA：
  - `/review-diff`：clean。
  - `/review-implementation`：clean，External Documentation Gate 未触发。
  - `/verify-contracts`：clean。
  - `/run-regression`：diff-aware + final full regression passed。
- 交付摘要：
  - 任务目标：已完成。
  - 是否越界修改：否；generated diff 仅限单一 Conditional File。
  - 是否触碰稳定契约：是，已同步 `CONTRACTS.md` 和 `DECISIONS.md`。
  - Release mode：none。
  - Deploy source：none。
  - Target environment：local。
  - Health checks：generator / test / protocol validation only。
  - Canary window：not applicable。
  - Performance baseline：not applicable。
  - Rollback / recovery：revert task diff or restore `CURRENT_TASK.md` from task start base `23f52e85`。
  - Release evidence：local command output。
  - canary result：not applicable。
  - performance baseline result：not applicable。
  - rollback status：not triggered。
  - remaining observation：lifecycle runtime skills、routing、guide / registry、inbox / backlog artifact、runtime manifest / install / health report contract 仍需单独任务和重新锁范围。

## Lessons 回写

- 本任务新增经验：
  - Contract foundation tasks must not drift into runtime delivery。
  - Single-file generated reference sync needs explicit diff proof。
- 需要延后补充的经验：
  - 若后续实现 pause / resume / interrupt runtime skills 时再次触发 guide / registry / runtime 边界问题，可补充 runtime delivery 专项 lesson。

## 后续关联

- 后续任务：
  - 如继续推进 lifecycle 工作，应单独创建任务实现 pause / resume / interrupt runtime skills，并重新锁定 `templates/skills/**`、guide / registry、runtime、tests 和 generated outputs 的范围。
  - 如继续推进治理硬化，可单独任务评估 `scripts/guard-target-root.ts` 或 source-repo-specific CI gate。
  - 下一轮入口：`/create-current-task`。
- 相关 issue / PR：无。
- 归档位置：`TASKS/TASK-003-current-task-suspend-resume-contract-foundation.md`
