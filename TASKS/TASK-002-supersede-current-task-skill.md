# TASK-002-supersede-current-task-skill

## 任务元数据

- 项目：vibe-coding-workflow-system
- 任务 ID：002
- 任务标题：新增 supersede-current-task skill
- 任务 slug：supersede-current-task-skill
- 开始时间：2026-05-21
- 结束时间：2026-05-22
- 最终状态：done

## 原始任务包快照

- 目标：新增 `supersede-current-task` workflow skill，在未完成的 `CURRENT_TASK.md` 因目标、范围锁或验收标准失效而不能继续时，用新任务包安全替代旧任务包，并强制回到 `review-current-task -> lock-scope -> plan-implementation`。
- 验收标准：
  - skill 在模板源中定义，而不是只手工写 generated output。
  - 触发条件覆盖 scope invalidation，不把普通补步骤误判为 supersede。
  - 职责覆盖旧任务状态保留、未完成项保留、partial diff ownership、重写 `CURRENT_TASK.md`、重新定义 Allowed / Conditional / Forbidden Files、禁止直接进入实现。
  - registry、guide、generated outputs 和测试同步闭环。
  - 回归至少覆盖 `bun run gen:all`、`bun run test:workflow-all`、`bun run validate:protocol`、`bun run validate:freshness`。
- 允许修改范围：
  - `templates/skills/supersede-current-task.SKILL.md.tmpl`
  - `templates/docs/WORKFLOW_GUIDE.md.tmpl`
  - `scripts/gen-registry.ts`
  - `test/gen-workflow-skills.test.ts`
  - `test/gen-registry.test.ts`
  - `docs/workflow/CURRENT_TASK.md`
  - 条件文件：`docs/workflow/generated/**`、`docs/workflow/SKILL_REGISTRY.md`、`test/gen-workflow-docs.test.ts`
- 禁止修改范围：
  - `.workflow-system/PROJECT_PROFILE.yaml`
  - `.workflow-system/WORKFLOW_PROTOCOL.md`
  - `.workflow-system/FILE_SCHEMAS.md`
  - `templates/docs/**` 中除 `WORKFLOW_GUIDE.md.tmpl` 外的文件
  - `scripts/workflow-runtime.ts`
  - `scripts/gen-workflow-skills.ts`
  - `docs/workflow/CONTRACTS.md`
  - `docs/workflow/DECISIONS.md`
  - `docs/workflow/STATUS.md`

## 实际改动摘要

- 代码：
  - 新增 `templates/skills/supersede-current-task.SKILL.md.tmpl`
  - 更新 `scripts/gen-registry.ts`
  - 更新 `test/gen-workflow-skills.test.ts`
  - 更新 `test/gen-registry.test.ts`
  - 条件触发后更新 `test/gen-workflow-docs.test.ts`
- 文档：
  - 更新 `templates/docs/WORKFLOW_GUIDE.md.tmpl`
  - 通过 `bun run gen:all` 同步 `docs/workflow/generated/workflow-skills/supersede-current-task.SKILL.md`
  - 通过 `bun run gen:all` 同步 `docs/workflow/generated/workflow-docs/WORKFLOW_GUIDE.md`
  - 通过 `bun run gen:all` 同步 `docs/workflow/SKILL_REGISTRY.md`
  - 收尾链同步了 `docs/workflow/CURRENT_TASK.md`、`docs/workflow/STATUS.md`
- 配置 / 数据：
  - 无配置、数据库或部署数据变更。
  - 未越界到协议、schema、runtime 或 target-project validation slots。

## 契约与决策记录

- 受影响契约：
  - 继续遵守 generated reference outputs 只能由 generator 写入的锁定边界。
  - 继续遵守结构变更必须从 templates / scripts 起步，不得从 generated outputs 反向维护规范。
  - 新 skill 作为 additive workflow skill 接入，未改变 source repo / target repo 隔离契约。
- 新增或更新决策：
  - 无。`sync-decisions` 结论为 no-op。
- 保持不变的关键边界：
  - `create-current-task` 不是 ctx7 主查询入口。
  - source repo 禁止 `workflow:install --root .`。
  - source repo quality gates 不复用 `owner: target-project` slots。
  - `docs/workflow/generated/**` 与 `docs/workflow/SKILL_REGISTRY.md` 不手工编辑。

## 验证与交付证据

- 测试 / 验证：
  - `bun run gen:all`
  - `bun run test:workflow-skills`
  - `bun run test:registry`
  - `bun run test:workflow-docs`
  - `bun run test:workflow-all`
  - `bun run validate:protocol`
  - `bun run validate:freshness`
- review / QA：
  - `/review-diff`：clean
  - `/review-implementation`：clean
  - `/verify-contracts`：clean
  - `/run-regression`：pass
  - 收尾前再次人工复审当前实现：clean，无 major / critical finding
- 交付摘要：
  - 任务目标：已完成，`supersede-current-task` 已接入模板、registry、guide、生成产物与测试闭环。
  - 完成情况：完成，无阻塞剩余问题。
  - 实际修改文件：`templates/skills/supersede-current-task.SKILL.md.tmpl`、`scripts/gen-registry.ts`、`templates/docs/WORKFLOW_GUIDE.md.tmpl`、`test/gen-workflow-skills.test.ts`、`test/gen-registry.test.ts`、`test/gen-workflow-docs.test.ts`、`docs/workflow/generated/workflow-skills/supersede-current-task.SKILL.md`、`docs/workflow/generated/workflow-docs/WORKFLOW_GUIDE.md`、`docs/workflow/SKILL_REGISTRY.md`、`docs/workflow/CURRENT_TASK.md`、`docs/workflow/STATUS.md`
  - 是否越界修改：否；实现期改动保持在 Allowed / Conditional Files 内，治理同步通过关闭链完成。
  - 是否触碰稳定契约：未新增或放宽稳定契约；`sync-contracts` 结论为 no-op。
  - Release mode：none
  - Deploy source：none
  - Target environment：local
  - Health checks：generator / test / protocol validation only
  - Canary window：not applicable
  - Performance baseline：not applicable
  - Rollback / recovery：revert task diff or regenerate outputs from previous templates
  - Release evidence：local command output recorded in `CURRENT_TASK.md`
  - canary result：not applicable
  - performance baseline result：not applicable
  - rollback status：not triggered
  - remaining observation：
    - `CURRENT_TASK.md` 的收尾状态已在归档前切到 `prepare-delivery-summary`，归档后由 `create-current-task` 作为下一轮入口。
    - `STATUS.md` 的下一检查点仍指向收尾窗口附近语义，若马上开启新治理任务，可在新任务的 `sync-status` 中一起刷新。

## Lessons 回写

- 本任务新增经验：
  - 无新增独立 lesson；现有 “Workflow rule changes must close the propagation chain” 与 “Live governance docs need explicit scope widening” 已覆盖本轮经验。
- 需要延后补充的经验：
  - 若后续多次出现 archive 后 `STATUS.md` 下一检查点滞后，可再提炼为单独收尾 lesson。

## 后续关联

- 后续任务：
  - 如继续推进治理，优先为 `source-repo quality gate / target-project validation slots` 分层或 `target root guard` 另开新任务。
  - 下一轮入口：`/create-current-task`
- 相关 issue / PR：
  - 无
- 归档位置：
  - `TASKS/TASK-002-supersede-current-task-skill.md`
