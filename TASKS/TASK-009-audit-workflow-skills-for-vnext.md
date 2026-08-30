# TASK-009-audit-workflow-skills-for-vnext

## 任务元数据

- 项目：vibe-coding-workflow-system
- 项目类型：ai-engineering-workflow
- 任务 ID：009
- 任务标题：审计 37 个 workflow Skill 并定义 vNext 迁移基线
- 任务 slug：audit-workflow-skills-for-vnext
- 开始时间：2026-08-30
- 结束时间：2026-08-30
- 最终状态：done / regression-passed / archived

## 原始任务包快照

- 目标：完成全部 37 个 workflow Skill 的 `Keep / Merge / Runtime / Delete` 审计，得到目标公开入口、不可丢失治理语义、迁移回归用例和下一步计划。
- 验收标准：37 项唯一分类；逐项目标、保留语义、压缩面和回归用例；全局治理不变量；分阶段迁移计划、首个垂直试点、决策 gate 和停止条件。
- 原始允许修改范围：`docs/workflow/CURRENT_TASK.md`、`docs/product/workflow-skill-kmrd-audit.md`、`docs/product/workflow-vnext-migration-plan.md`。
- closure-only 范围扩展：用户确认按推荐步骤继续后，只增加本归档文件和 `docs/workflow/STATUS.md`，用于结束任务 009 并建立任务 010；没有扩大任务 009 的产品或实现目标。

## 实际改动摘要

- 代码：无。
- 产品文档：新增 `docs/product/workflow-skill-kmrd-audit.md` 和 `docs/product/workflow-vnext-migration-plan.md`。
- 治理记录：更新 `docs/workflow/CURRENT_TASK.md`；收尾时同步 `docs/workflow/STATUS.md` 并生成本归档。
- 审计结果：`Keep 5 / Merge 20 / Runtime 7 / Delete 5`，合计 37，无遗漏、无重复。
- 候选目标：10 个 thin public entries、shared internal capabilities、typed semantic proposals、deterministic Runtime transactions、37-name compatibility layer。

## 契约与决策记录

- 受影响契约：本任务只形成产品审计和迁移建议，没有改变现行 protocol、schema、Skill、handoff、runtime、registry、host sync 或 generated surface。
- 新增或更新决策：无长期决策写入；公开入口名称、兼容窗口和 Runtime surface 在后续任务中按阶段确认。
- 保持不变的关键边界：canonical Markdown/YAML live governance docs 保持项目事实源；generated references 不反向成为规范源；`capture-work-item` 保持 record-only；review/report-only 保持只读；active ownership、lifecycle、finding admission 和 source/target isolation 不变。

## 验证与交付证据

- 覆盖检查：37 个 template name 与 37 个审计行严格一一对应；`Keep/Merge/Runtime/Delete = 5/20/7/5`；37 个 `MR-*` 与 18 个 `GR-*` case 完整。
- 仓库验证：`bun run validate:protocol`、`bun run validate:freshness`、`bun run test:workflow-all`、`bun run workflow:health --root .` 全部通过；测试分组共 `273 pass / 0 fail`，health 为 `OK`。
- 变更边界：任务实施阶段只修改原始 Allowed Files；归档阶段只增加本文件和 STATUS 同步，没有触碰 Skill、模板、脚本、测试、协议、生成结果或 registry。
- 发布证据：Release mode 为 none；Deploy source 为 none；Target environment 为 local；Canary window、Performance baseline 和 Release evidence 不适用；Rollback 未触发。
- 交付物：`docs/product/workflow-skill-kmrd-audit.md`、`docs/product/workflow-vnext-migration-plan.md`。

## Lessons 回写

- 本任务新增经验：无。审计结论和迁移停止条件属于产品架构基线，已写入 `docs/product/**`，不重复写入 `LESSONS.md`。
- 需要延后补充的经验：只有在实际 shadow migration 出现可复用失败模式后再沉淀。

## 后续关联

- 后续任务：任务 `010` / `workflow-vnext-capability-contract`，先实现 public/internal/runtime/compat 协议表示和 55 项 golden fixture 基线；不删除旧 Skill。
- 首个后续行为试点：在任务 010 contract baseline 通过后，另开任务引入只读 `review-change + validate-change` shadow facade。
- 相关 issue / PR：无。
- 归档位置：`TASKS/TASK-009-audit-workflow-skills-for-vnext.md`
