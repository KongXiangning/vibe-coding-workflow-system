# code-review-graph 与 workflow-system 需求规格说明

## 1. 文档目的

本文件用于正式定义当前需求的目标、范围、约束、验收标准和后续决策点，确保后续分析、设计与实现都围绕同一问题展开。

## 2. 背景

`workflow-system` 当前主要提供项目治理能力，包括任务包、边界、决策、状态和质量门。  
`code-review-graph` 提供基于代码图谱的结构化理解能力，包括最小上下文、影响面分析、流程影响、架构快照和测试关联等。

当前需要判断的不是如何用 `workflow-system` 管理 `code-review-graph` 项目本身，而是：

- `code-review-graph` 如何被正确使用
- 它对其他项目做 vibe-coding 有什么价值
- 它与 `workflow-system` 如何协同
- 哪些能力值得接入 `workflow-system`

## 3. 问题陈述

当前存在以下待解决问题：

1. 缺少对 `code-review-graph` 完整使用方式的结构化说明。
2. 缺少对其 prompts / skills / hooks / MCP 能力分层的清晰拆解。
3. 缺少对它与 `workflow-system` 关系的明确结论，容易误判为冲突或必须深度集成。
4. 缺少对“哪些能力值得接入 workflow-system，哪些只是 provider-specific 封装”的正式判断依据。
5. 如果未来要在 `workflow-system` 的 skill 集中调用相关 MCP，缺少足够精度的源码依据。

## 4. 目标

本需求的目标是：

1. 完整解读 `code-review-graph` 的使用方式。
2. 判断 `code-review-graph` 对其他项目 vibe-coding 的实际帮助。
3. 明确 `code-review-graph` 与 `workflow-system` 的协同关系。
4. 提炼出值得接入 `workflow-system` 的关键能力。
5. 对第一批计划接入的关键 MCP 能力完成定向源码级梳理。

## 5. 非目标

当前需求 **不包括**：

1. 用 `workflow-system` 去治理 `code-review-graph` 项目的开发过程。
2. 把 `code-review-graph` 作为 adoption target 进行 inventory / adoption 改造。
3. 立即修改 `workflow-system` 协议、模板、脚本或 runtime 来完成真实接入。
4. 对 `code-review-graph` 全项目做全量源码级百科式说明。
5. 把 `code-review-graph` 设为 `workflow-system` 的强依赖。

## 6. 范围

## 6.1 需求范围内

- `code-review-graph` 的 CLI、MCP、skills、hooks、prompt templates 使用方式
- 其对其他项目 vibe-coding 的帮助分析
- 与 `workflow-system` 的最佳协同实践判断
- MCP 原子能力拆解
- 第一批接入候选能力的源码级梳理

## 6.2 需求范围外

- 真实实现 `workflow-system` 与 `code-review-graph` 的接入
- 编写接入后的正式协议字段
- 改动 `templates/**`、`scripts/**`、`.workflow-system/**`
- 改动 `code-review-graph` 仓库本身

## 7. 当前工作假设

1. `code-review-graph` 本质上是 **代码理解与影响分析层**。
2. `workflow-system` 本质上是 **治理与任务流层**。
3. 两者天然不冲突，且可以在目标项目中同时使用。
4. 当前阶段最佳实践更接近“先共用，再决定是否做轻接入”。
5. 如果未来接入 `workflow-system`，应优先做可选能力适配，而不是深度绑定。

## 8. 功能性需求

## FR-001：需要完整解读 `code-review-graph` 的使用方式

应覆盖：

- CLI
- MCP tools
- slash commands / skills
- hooks
- 5 个 MCP 提示模板

输出应能回答：

- 图谱如何生成
- 图谱如何更新
- AI 在什么阶段通过 MCP 消费图谱

## FR-002：需要判断其与 `workflow-system` 是否冲突

应明确回答：

- 两者是否冲突
- 是否应深度集成
- 是否直接同时使用更合理

当前结论应保留为：

- `code-review-graph` 负责“应该先看哪里”
- `workflow-system` 负责“这次允许怎么改”

## FR-003：需要分析 `code-review-graph` 对其他项目的通用价值

应至少覆盖以下价值面：

- 最小上下文获取
- 影响面分析
- 结构化代码探索
- 风险排序
- 测试缺口提示
- 架构盘点 / onboarding

## FR-004：需要拆解出值得接入 `workflow-system` 的能力

应区分：

1. 产品壳层能力
2. MCP 原子能力
3. 适合作为 `workflow-system` 可选增强能力的部分

## FR-005：需要锁定第一批候选接入能力

当前已锁定的第一批能力包括：

- `build_or_update_graph` / `list_graph_stats`
- `get_minimal_context`
- `detect_changes`
- `get_affected_flows`
- `query_graph`
- `get_architecture_overview`

## FR-006：需要对最关键能力做定向源码级梳理

至少应达到：

- 明确入口函数
- 明确 MCP 暴露层与真实实现层
- 明确主要参数是否真实生效
- 明确返回结构
- 明确容易误读的语义差异

当前最关键的 3 项为：

- `get_minimal_context`
- `detect_changes`
- `query_graph`

## FR-007：需要给出当前最佳实践判断

当前应保持以下判断：

1. 在目标项目中独立安装 `code-review-graph`
2. 用 CLI 负责 `install/build/update/watch/daemon`
3. 用 MCP 向 AI 暴露图谱能力
4. 用 `workflow-system` 负责任务、边界、决策、状态、质量门
5. 在执行任务时，由 `workflow-system` 的 skill / guidance 优先调用 graph MCP

## 9. 非功能性要求

## NFR-001：工具无关性

分析和后续设计不应把 `workflow-system` 锁死到单一 provider。

## NFR-002：边界清晰

必须持续区分：

- provider-specific 行为
- 可抽象能力
- 协议级能力

## NFR-003：可验证

所有接入判断都应尽量建立在源码、文档和真实调用链上，而不是只靠 README 级直觉。

## NFR-004：渐进式深化

在未进入真实实现前，不要求全量源码级说明；只对计划接入的能力做到源码级精度。

## 10. 当前明确约束

1. 不把 `code-review-graph` 设为 `workflow-system` 强依赖。
2. 不把 provider-specific 返回结构直接写进协议核心。
3. 优先做“可选能力适配”，不优先做“深度绑定”。
4. 先共用、先验证，再决定是否轻接入。
5. 只对真正计划接入的 MCP 能力做源码级精度梳理。

## 11. 当前有效产出

以下文档被视为服务于当前需求的有效中间产物：

- `code-review-graph-capability-integration-analysis.md`
- `code-review-graph-prompts-skills-hooks-mcp-analysis.md`
- `code-review-graph-first-batch-mcp-source-analysis.md`
- `code-review-graph-top3-mcp-deep-source-analysis.md`

以下文档被视为错误方向产物：

- `code-review-graph-integration-checklist.md`

## 12. 验收标准

当以下条件满足时，可认为当前需求阶段完成：

1. 已能完整说明 `code-review-graph` 的使用方式。
2. 已明确其与 `workflow-system` 的关系和最佳实践。
3. 已识别对其他项目 vibe-coding 最有价值的能力。
4. 已锁定第一批候选接入能力。
5. 已完成第一批能力的定向源码级梳理。
6. 已明确哪些行为属于 guidance 层，哪些未来可能进入 skill 设计。

## 13. 后续决策点

下一阶段需要回答的问题包括：

1. 哪些 `workflow-system` 现有 skill 最适合优先调用 graph MCP。
2. skill 在 provider 可用 / 不可用 / 图谱过期 / 查询歧义时应如何分支。
3. 哪些行为应写进 host guidance。
4. 哪些能力只适合 guidance 层，不适合写进协议或模板。
5. 是否需要设计 `workflow-system` 的 graph-aware 能力槽。

## 14. 一句话结论

本需求的核心不是“让 workflow-system 管理 code-review-graph 项目”，而是：

> **理解 `code-review-graph`，确认它如何与 `workflow-system` 协同，并识别哪些图谱能力值得被 `workflow-system` 有选择地复用。**
