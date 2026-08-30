# Workflow vNext Phase 1 原型盘点（Superseded / Historical）

- 状态：`superseded / historical`
- 日期：2026-08-31
- 适用范围：本轮新增的 Phase 1 shadow、context、validation、sample 和测试文件
- 当前用途：保留探索过程和语义证据；不作为后续实现规范或前置读取材料
- 相关当前文档：
  - [`workflow-vnext-target-architecture.md`](../designs/workflow-vnext-target-architecture.md)
  - [`workflow-vnext-migration-plan.md`](workflow-vnext-migration-plan.md)
  - [`workflow-vnext-implementation-blueprint.md`](../designs/workflow-vnext-implementation-blueprint.md)

> **本文件已被 superseded，仅供历史参考。最终决策以以上三份当前文档为准。**

## 1. 历史记录结论

本文件记录的是一轮过度展开的 Phase 1 原型探索，以及为什么停止继续扩张。它不是 Target Architecture、Migration Plan 或 Skill implementation blueprint。

原型的当前处置如下：

1. 原型脚本、fixture、测试和 12-case runner 保留为 `experimental/reference`。
2. 不继续扩展 shadow runner、`validate-change` 沙盒或跨模型/跨 harness 对照平台。
3. 原型不接入正式生成、安装、host sync、registry 或业务项目的默认入口。
4. 原型测试可以独立运行作参考，但不参与正式 `test:workflow-all` 质量门。
5. 后续 Skill 重写直接遵循 implementation blueprint，不以本文件的旧建议为路线依据。

## 2. 本轮探索内容及历史价值

| 内容 | 历史价值 | 当前地位 |
|---|---|---|
| `docs/designs/workflow-vnext-target-architecture.md` | 意图入口、内部 capability、上下文/知识、Review Convergence 和 Evidence Admission 的设计材料 | 当前架构以该文档为准；本历史文档不再解释或覆盖它 |
| `docs/product/workflow-vnext-migration-plan.md` | 说明原型为何需要被简化 | 当前迁移规则以该文档为准：idle-only、一次性 Migration Pack、纯 vNext |
| `scripts/project-context-resolver.ts` | 相关性读取、权威优先级、冲突显式化和 provenance 的实验材料 | 仅作语义参考；未来实现按 blueprint 取舍 |
| `scripts/workflow-review-shadow.ts` | 多个旧 review Skill 合并为统一 review 输入/输出的实验材料 | `experimental/reference`，不作为正式执行器 |
| `scripts/workflow-validate-shadow.ts` | `validate-change` 作为专家/CI 证据入口的实验材料 | `experimental/reference`，不作为正式质量门 |
| `scripts/workflow-shadow-samples.ts` | 代表性行为情境的探索样本 | `experimental/reference`，不继续扩展 runner |
| `test/fixtures/workflow-vnext-shadow-sample-matrix.yaml` | 12 类情境的设计检查点 | 参考 fixture，不是真实跨模型回归证据 |
| 四组新增测试 | 上下文选择、统一审查、收敛和报告终止的示例 | 可独立运行参考，不进入正式全量质量门 |

## 3. 仍可保留的历史语义

以下内容是原型探索中有参考价值的语义，但其最终归属和边界已经由三份当前文档重新定义：

- 用户入口表达意图，不把普通规划、审查和测试选择拆成固定的 public stage。
- `CONTRACTS.md`、`DECISIONS.md`、`LESSONS.md` 按相关性读取；权威冲突显式报告，Lesson 不越权。
- 统一 review 的“发现问题”与“进入修复队列”是两个不同决策；产品判断、架构判断和用户授权不能由观察结果自动取得。
- 旧 Skill audit 可作为责任映射输入；最终的合并、Runtime 提取和 public surface 以 implementation blueprint 为准。
- 项目/环境特有知识仍由明确的 capability、门禁或专项实现承载，不由 shadow runner 泛化。

这些语义不意味着保留旧 Skill 兼容层、原地迁移 Runtime 或继续建设 shadow 测试平台。

## 4. 已被推翻的历史建议

以下内容不能再被后续任务当作当前要求：

- “37 个旧 Skill 先保持兼容”——已被纯 vNext 安装和旧 Skill 不存在的最终设计取代。
- active `CURRENT_TASK`、finding repair、paused/interrupted runtime 原地迁移——已被 idle-only、一次性离线 Migration Pack 取代。
- 业务项目长期 legacy + vNext 共存、复杂 legacy fallback、所有 vNext reader 长期 version-aware——均不属于产品架构。
- shadow runner、沙盒验证、12-case 自动对照和原型测试作为正式质量门——均降级为 experimental/reference。

遇到旧 schema 时，当前 vNext 行为是：

```text
migration-required
→ stop
```

## 5. 当前读取与决策规则

后续 vNext 实现任务**不要求先读取本文件**。需要确定当前架构、迁移边界或 Skill 责任时，直接使用：

1. [`workflow-vnext-target-architecture.md`](../designs/workflow-vnext-target-architecture.md)：最终设计与约束；
2. [`workflow-vnext-migration-plan.md`](workflow-vnext-migration-plan.md)：Phase 1、Migration Pack、Phase 2 及后续路线；
3. [`workflow-vnext-implementation-blueprint.md`](../designs/workflow-vnext-implementation-blueprint.md)：后续 Skill 重写的实施表。

`workflow-skill-kmrd-audit.md` 仍可作为 37-Skill 责任映射的补充输入，但不构成兼容承诺。

## 6. 原型文件处置

原型脚本、测试、fixture 和 runner 暂不删除，统一标记为：

- `experimental/reference`；
- 不参与正式生成、安装、host sync、registry 或业务项目产品架构；
- 不构成 Phase 1 完成证据或 vNext 推广前置门槛；
- 不应被继续扩展成 shadow 质量平台。

workflow-system 源仓库可以为了开发比较暂时保留这些旧实现和实验 vNext；这不改变安装项目必须是纯 vNext 的产品边界。
