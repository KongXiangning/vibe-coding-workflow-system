# TASK-006-target-root-guard

## 任务元数据

- 项目：vibe-coding-workflow-system
- 项目类型：ai-engineering-workflow
- 任务 ID：006
- 任务标题：实现 target root guard 与 source/target root crossing 防护
- 任务 slug：target-root-guard
- 开始时间：2026-05-27
- 结束时间：2026-05-27
- 最终状态：done / regression-passed / archived

## 原始任务包快照

- 来源草案：`docs/workflow/NEXT_TASK_DRAFT_006_TARGET_ROOT_GUARD.md`
- 目标：为 `workflow:install --root <target>` 增加 fail-closed target-root guard，阻止 source repo root、source parent / ancestor root 和 shared `.git` root crossing 被误当作 target root，同时保留 isolated target install 与 source repo self-sync allow path。
- 关键验收：
  - `workflow:install --root .` 必须被拒绝。
  - source repo 父目录 / 祖先目录不得作为 install target。
  - 与 source repo 共享 `.git` root 的 crossing target 必须被拒绝。
  - 合法外部隔离 target root 的 install 必须继续允许。
  - `workflow:sync --root . --host <host> --write` 必须不回归。
  - 路径归一化与测试必须覆盖 Windows 差异，不能只靠字符串前缀判断。
  - 不得引入 protocol / schema / template / generated reference 变更。

## 实际改动摘要

- Runtime:
  - 新增 `scripts/guard-target-root.ts`，集中实现绝对路径规范化、ancestor 判断、`.git` directory / file anchor 识别和 allow / deny result。
  - 在 `scripts/workflow-runtime.ts` 的 `installWorkflowBundle()` 中于 bundle integrity 校验后接入 fail-closed guard；命中非法 target root 时以 `incompatible_target` 直接返回，避免继续生成 install plan。
  - 为 install 测试入口保留 `sourceRoot?: string` 注入位，降低 root-isolation integration tests 的环境耦合。
- Tests:
  - 新增 `test/guard-target-root.test.ts`，覆盖 self-install、ancestor root、isolated root、shared `.git` directory / file 等纯判定场景。
  - 扩展 `test/workflow-runtime.test.ts`，覆盖 self-install deny、ancestor deny、isolated allow、shared `.git` crossing deny，以及 source repo `syncWorkflowHost()` dry-run self-sync smoke。
- Governance sync:
  - `docs/workflow/CURRENT_TASK.md` 同步步骤、验收、审查与回归事实，并在归档时切换为 archived 态。
  - `docs/workflow/STATUS.md` 写入任务 `006` 的稳定状态与下一检查点。
  - `docs/workflow/CONTRACTS.md` 固化 install/self-sync contract 中的 target-root guard 边界。
  - `docs/workflow/DECISIONS.md` 新增 `AD-010`，并将 `DEFER-001` 标记为由 `AD-010` 替代。
  - `docs/workflow/LESSONS.md` 记录 fail-fast guard 落点和 root-isolation 测试策略。
  - `AGENTS.md` 与 `CLAUDE.md` 同步 source self-use allow path 与 install 禁区说明。

## 契约与决策记录

- 受影响契约：
  - `runtime install/sync contract`
  - `BehaviorContract / source repo self-use flow`
  - source / target root separation baseline
- 新增或更新决策：
  - `AD-010`: `workflow:install` 对 source-target root crossing 采用 fail-closed target-root guard。
  - `SUPERSEDED-003`: `DEFER-001` 已由 `AD-010` 落地替代。
- 保持不变的关键边界：
  - 继续保持 install-first-only，不扩大到其他 root 参数入口。
  - 不新增 protocol-level named error。
  - 不修改 `.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md`、`templates/**`、`docs/workflow/generated/**` 或 `docs/workflow/SKILL_REGISTRY.md`。
  - `workflow:sync --root . --host <host> --write` 继续作为 source repo self-use allow path。

## 验证与交付证据

- 审查范围：
  - `working-tree`
- 测试 / 验证：
  - `bun test test/guard-target-root.test.ts` 通过，6 pass / 0 fail。
  - `bun test test/workflow-runtime.test.ts test/guard-target-root.test.ts` 通过，55 pass / 0 fail。
  - `bun run test:workflow-all` 通过。
  - `bun run validate:protocol` 通过。
  - `bun run validate:freshness` 通过。
  - `bun run workflow:health --root .` 通过。
- review / QA：
  - 第二轮 `/review-diff`、`/review-implementation`、`/verify-contracts` 结论均为 clean。
  - `/run-regression` 结论为 pass。
- 交付摘要：
  - 任务目标：已完成。
  - 是否越界修改：否。
  - 是否触碰稳定契约：是，已同步 `CONTRACTS.md` 与 `DECISIONS.md`。
  - Release mode：none。
  - Deploy source：none。
  - Target environment：local。
  - Health checks：not applicable beyond repo-local regression matrix。
  - Canary window：not applicable。
  - Performance baseline：not applicable。
  - Rollback / recovery：回退到 task start base `85eae344`，撤销 target-root guard runtime / test / governance diff。
  - Release evidence：local command output 已写入 `docs/workflow/CURRENT_TASK.md`、`STATUS.md`、`CONTRACTS.md` 与 `DECISIONS.md`。
  - canary result：not applicable。
  - performance baseline result：not applicable。
  - rollback status：not triggered。
  - remaining observation：若未来要把 guard 扩大到 `workflow:install` 之外的 root 参数入口、引入 protocol-level named error，或设计 source-repair / import 等价流程，必须单独开任务重新锁范围。

## Lessons 回写

- 本任务新增经验：
  - Runtime root-isolation tests should inject sourceRoot and prefer temp roots。
  - Fail-closed install guards must stop before other preflight planners。
- 任务过程中复用的既有经验：
  - Workflow rule changes must close the propagation chain。
  - Live governance docs need explicit scope widening。

## 后续关联

- 后续任务：
  - 若要扩大 target-root guard 到其他 root 参数入口，单独开任务并重新 `/lock-scope`。
  - 若要新增 protocol-level named error 或 source-repair / import 等价流程，先在协议与 runtime 层重新设计。
  - 下一轮入口：`/create-current-task`。
- 相关 issue / PR：无。
- 归档位置：`TASKS/TASK-006-target-root-guard.md`
