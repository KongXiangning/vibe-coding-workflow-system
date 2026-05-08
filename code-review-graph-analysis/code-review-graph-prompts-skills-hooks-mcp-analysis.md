# code-review-graph 的 prompts / skills / hooks 可拆分 MCP 关键调用分析

## 结论

`code-review-graph` 里的 5 个 MCP 提示模板，以及若干 skill，并不是一组无法拆开的黑盒能力。相反，它们大多只是对少数几个 MCP 工具做的轻量编排。

需要先区分三件事：

1. **MCP 提示模板（prompts）**：返回的是“建议调用顺序”的提示内容，不是服务端自动执行的工作流。
2. **skills**：也是面向模型的操作说明，不是底层自动化编排引擎。
3. **hooks**：这是唯一真正自动触发命令的机制。

因此，如果目标是理解它的使用方法，或者评估哪些能力可被别的系统借用，重点不应该放在 prompt/skill 的名字上，而应该放在它们背后的 **固定调用套路** 和 **MCP 原子能力** 上。

最核心的模式可以概括为：

1. 先拿最小上下文
2. 再做结构探索或影响分析
3. 只在必要时深挖源码
4. 最后给出结论

## 贯穿所有 prompts 的共享规则

在 `prompts.py` 里，这 5 个模板共享同一段 token-efficiency preamble。它其实是比单个模板更重要的共性规则：

1. 总是先调用 `get_minimal_context`
2. 默认使用 `detail_level="minimal"`
3. 只有局部需要时才升级到 `standard` 或 `verbose`
4. 每轮尽量不超过 3 次工具调用
5. 优先定向查询，不做宽扫描
6. 审查变更时，先用最小风险摘要，再只对高风险项展开

这部分是原文档里一个关键漏项，因为它说明这些模板不只是“调哪些工具”，更是在强约束 **怎么节省 token 地调工具**。

## 一、5 个 MCP 提示模板，分别拆出的关键调用

## 1. `review_changes`

### 关键调用链

- `get_minimal_context(task="review changes...")`
- `detect_changes(detail_level="minimal" | "standard")`
- `query_graph(pattern="callers_of", target=<high-risk func>)`
- `get_affected_flows()`（仅在改动面较大时）

### 抽象出的关键能力

- 变更总览
- 风险分级
- 高风险函数的外部传播分析
- 较大改动的流程影响分析

## 2. `architecture_map`

### 关键调用链

- `get_minimal_context(task="map architecture")`
- `get_architecture_overview()`
- `list_flows()`
- `get_community()`（只针对少量目标社区）

### 抽象出的关键能力

- 架构快照
- 模块 / 社区视图
- 关键流程视图
- 架构文档底稿

## 3. `debug_issue`

### 关键调用链

- `get_minimal_context(task="debug: ...")`
- `semantic_search_nodes(query=<issue keywords>)`
- `query_graph(pattern="callers_of", target=<candidate>)`
- `get_flow(name=<relevant flow>)`（涉及执行流时）
- `get_review_context` / `get_impact_radius`（需要追踪具体变更时）

### 抽象出的关键能力

- 问题相关节点搜索
- 调用链追踪
- 执行流定位
- 变更传播定位

## 4. `onboard_developer`

### 关键调用链

- `get_minimal_context(task="onboard developer")`
- `list_graph_stats()`
- `get_architecture_overview()`
- `list_communities()`
- `list_flows()`

### 抽象出的关键能力

- 仓库技术概览
- 30 秒架构心智模型
- 模块分区
- Top critical flows

## 5. `pre_merge_check`

### 关键调用链

- `get_minimal_context(task="pre-merge check")`
- `detect_changes(detail_level="minimal")`
- `get_affected_flows()`（风险较高时）
- `query_graph(pattern="tests_for", target=<untested func>)`
- `refactor(mode="dead_code")`
- `find_large_functions` / `get_impact_radius`（仅在高风险时）

### 抽象出的关键能力

- 合并前风险扫描
- 测试缺口定位
- 流程影响确认
- 死代码 / 超大函数等卫生检查

## 二、skills 也能拆成 MCP 调用配方

这里还要补一个边界说明：

- prompts 和 skills 的共通点是：**都在描述推荐调用路径**
- 但它们不是代码里的强制执行 DAG
- 真正自动执行的是 hooks；prompts/skills 依然依赖宿主 AI 按说明去调用 MCP

此外还有一个容易漏掉的点：

- 某些 skill 本身不会直接给出完整策略，而是先调用 `get_docs_section_tool(...)` 去读取 token-optimized 的参考段落
- 也就是说，部分 skill 实际上是“skill 指令 + docs section + MCP tools”的三层组合，而不只是 skill + MCP

## 1. `build-graph`

### 核心链路

- `list_graph_stats_tool`
- `build_or_update_graph_tool`
- `list_graph_stats_tool`

### 本质

图谱准备 / 图谱刷新。

## 2. `review-delta`

### 核心链路

- `get_docs_section_tool(section_name="review-delta")`
- `build_or_update_graph_tool()`
- `get_review_context_tool()`
- `query_graph_tool(pattern="tests_for")`

### 本质

增量变更审查 + 测试关联确认。

## 3. `review-pr`

### 核心链路

- `get_docs_section_tool(section_name="review-pr")`
- `git diff main...<branch>`（非 MCP 前置步骤，用于确定 PR 变更范围）
- `build_or_update_graph_tool(base="main")`
- `get_review_context_tool(base="main")`
- `get_impact_radius_tool(base="main")`
- `query_graph_tool(pattern="callers_of" | "tests_for")`

### 本质

PR 级别的变更审查 + 传播面分析 + 测试覆盖确认。

## 4. `debug-issue`

### 核心链路

- `get_minimal_context`
- `semantic_search_nodes`
- `query_graph(callers_of / callees_of)`
- `get_flow`
- `detect_changes`
- `get_impact_radius`

### 本质

从问题描述出发，逐步收窄到调用链和最近变更。

## 5. 其他 skill 也验证了同一拆分结论

虽然前面只展开了几个核心 skill，但另外几个 skill 也证明了同样的模式：

### `review-changes`

- `detect_changes`
- `get_affected_flows`
- `query_graph(pattern="tests_for")`
- `get_impact_radius`

本质仍然是：先风险扫描，再看流程影响，再补测试关联和 blast radius。

### `explore-codebase`

- `list_graph_stats`
- `get_architecture_overview`
- `list_communities`
- `get_community`
- `semantic_search_nodes`
- `query_graph`
- `list_flows` / `get_flow`

本质仍然是：先全局，再局部；先结构，再细节。

### `refactor-safely`

- `refactor_tool(mode="suggest" | "dead_code" | "rename")`
- `apply_refactor_tool`
- `detect_changes`
- `get_impact_radius`
- `get_affected_flows`
- `find_large_functions`

本质仍然是：先预览，再应用，再验证影响。

## 三、hooks 真正提供的不是分析逻辑，而是图谱新鲜度机制

## 1. `PostToolUse(Edit|Write|Bash)`

### 触发动作

- `code-review-graph update --skip-flows`

### 作用

在代码被修改后自动做增量刷新。

## 2. `SessionStart`

### 触发动作

- `code-review-graph status`

### 作用

在会话开始时确认图谱是否存在、是否可用。

## 3. git `pre-commit` hook

### 触发动作

- `code-review-graph update`
- `code-review-graph detect-changes --brief`

### 作用

在提交前给出轻量风险提示。

## hooks 可迁移的关键思想

真正值得提炼的不是 hook 机制本身，而是下面三个行为模式：

1. 会话开始先检查图谱可用性
2. 改完代码后自动刷新图谱
3. 提交前跑一次轻量风险扫描

这说明 hooks 主要解决的是 **图谱 freshness** 和 **提交前提醒**，而不是替代 prompts/skills 的分析逻辑。

## 四、最终可抽象出的 MCP 原子能力

把 prompts / skills / hooks 全部剥开后，真正高价值的 MCP 原子能力主要有 5 组。

## 1. 图谱准备 / 新鲜度

- `build_or_update_graph`
- `list_graph_stats`

## 2. 最小上下文入口

- `get_minimal_context`

## 3. 结构探索

- `query_graph`
- `semantic_search_nodes`
- `get_architecture_overview`
- `list_communities`
- `get_community`

## 4. 传播 / 影响分析

- `detect_changes`
- `get_impact_radius`
- `get_affected_flows`
- `get_flow`

## 5. 审查 / 收尾增强

- `get_review_context`
- `query_graph(pattern="tests_for")`
- `refactor(mode="dead_code")`
- `find_large_functions`

## 五、这说明什么

这说明：

1. `code-review-graph` 的 prompt / skill 设计，本质上是 **少量 MCP 原子能力的工作流编排**
2. 如果别的系统想借用它的价值，**没必要整包搬 prompt/skill**
3. 更合理的做法是抽出这些 MCP 原子能力和调用套路，再映射到自己的任务链路中

## 六、如果要迁移或借用，应优先借什么

从可复用性看，优先级最高的是：

1. `get_minimal_context`
2. `detect_changes`
3. `get_affected_flows`
4. `query_graph`
5. `get_architecture_overview`
6. `query_graph(pattern="tests_for")`

原因很简单：这几项共同覆盖了：

- 上下文缩小
- 传播判断
- 架构理解
- 测试关联
- 风险驱动审查

## 七、最终判断

是的，**这些模板和 skill 完全可以拆分出调用 MCP 的关键**。

而且拆完之后，比直接复用 prompt/skill 的名字更有价值。因为 prompt/skill 是 provider-specific 编排，真正可迁移、可抽象、可接入别的工作流系统的，是它背后的：

- 最小上下文入口
- 结构搜索
- 传播分析
- 测试关联
- 风险驱动检查
- 自动刷新图谱

这才是 `code-review-graph` 在工作流层面最值得被复用的部分。
