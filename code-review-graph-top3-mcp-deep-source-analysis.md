# code-review-graph 最关键 3 项 MCP 能力深度源码级梳理

## 为什么是这 3 项

在第一批 6 项能力里，最值得继续下钻到源码级精度的，是下面 3 项：

1. `get_minimal_context`
2. `detect_changes`
3. `query_graph`

原因：

- `get_minimal_context` 是所有 prompt / skill 的统一入口
- `detect_changes` 是 review / pre-merge / regression 的核心分析器
- `query_graph` 是最通用的二级结构查询能力

另外两项：

- `get_affected_flows`：实现较直，复杂度低
- `get_architecture_overview`：高层概览清晰，第一轮已足够

## 一、`get_minimal_context`

## MCP 暴露层

### 位置

- `code_review_graph/main.py`

### MCP 名字

- `get_minimal_context_tool`

### 对外签名

```python
get_minimal_context_tool(
    task: str = "",
    changed_files: Optional[list[str]] = None,
    repo_root: Optional[str] = None,
    base: str = "HEAD~1",
)
```

### wrapper 行为

- 只是把 `repo_root` 经过 `_resolve_repo_root(...)`
- 然后直接转给 `tools/context.py:get_minimal_context(...)`

这说明它没有额外业务逻辑，核心都在 `tools/context.py`。

## 真实实现层

### 位置

- `code_review_graph/tools/context.py`

### 核心执行步骤

1. `_get_store(repo_root)`
2. `store.get_stats()` 取统计
3. 如果显式给了 `changed_files`，或 `_has_git_changes(root, base)` 为真：
   - 调 `analyze_changes(...)`
   - 提取 `risk_score`
   - 计算 `risk`（>0.7 high, >0.4 medium, 否则 low）
   - 提取 top 5 changed functions
   - 统计 test gap 数
4. 从 `communities` 表取 top 3 communities
5. 从 `flows` 表取 top 3 critical flows
6. 根据 `task` 文本做关键词路由
7. 用 `compact_response(...)` 返回紧凑结构

## 真实返回结构

来自 `compact_response()`：

- `status`
- `summary`
- `key_entities`
- `risk`
- `communities`
- `flows_affected`
- `next_tool_suggestions`

## 源码级注意点

### 1. 它不是“纯上下文工具”，而是轻量风险路由器

虽然名字叫 minimal context，但它实际已经做了：

- 统计
- 风险判断
- 测试缺口数量
- 下一步工具建议

所以它更接近：

**上下文入口 + 路由器 + 轻量变化摘要**

### 2. `next_tool_suggestions` 是关键词分流，不是模型推理

它只是看 `task.lower()` 里有没有关键词：

- review / pr / merge / diff
- debug / bug / error / fix
- refactor / rename / dead / clean
- onboard / understand / explore / arch

这意味着 workflow-system 如果未来要借这个能力，不能把 suggestions 当成“深智能推荐”，而要把它当成**provider 给出的默认导航建议**。

### 3. `flows_affected` 这个键名在这里有语义歧义

`get_minimal_context()` 实际上取的是：

- top 3 critical flows

然后交给 `compact_response()`，被统一写到：

- `flows_affected`

也就是说，在这个工具里，`flows_affected` **不一定是“当前变更真的影响到的流程”**，而可能只是“当前图里最重要的流程”。

这是一个很重要的源码级细节。  
如果 workflow-system 未来接它，不能把这个字段直接等价解释为“已确认受影响流程”。

### 4. 它依赖 postprocess 结果

如果图还没跑出 `communities` / `flows` 表，这两个部分会安静降级为空。

所以它的质量依赖：

- 图已建好
- 且最好做过 `postprocess="full"`

### 5. 它会在没有显式 changed_files 时偷偷探测 git 变化

这意味着它不是完全静态的“项目概览”。它可能会因为工作树变化而输出风险信息。

### 6. 它的自动变化探测偏 Git，而不是完整 VCS-aware

这里前置用的是 `_has_git_changes(root, base)`，内部直接跑：

- `git diff --name-only`
- `git status --porcelain`

所以：

- Git 项目里能自动感知工作区变化
- 非 Git / SVN 场景下，如果不显式传 `changed_files`，这层自动探测不会成立

这一点和 `detect_changes` 不同，后者在 changed-files / diff-ranges 层面对 SVN 也有支持。

## 对 workflow-system 的接入启示

### 适合怎么接

- 作为 graph-aware skill 的统一前置步骤
- 用来决定下一步走 `detect_changes` / `query_graph` / `get_architecture_overview`

### 不适合怎么接

- 不应把 `flows_affected` 直接当成任务包里的“已确认受影响流程”
- 不应把 `next_tool_suggestions` 当成协议级路由规则

---

## 二、`detect_changes`

## MCP 暴露层

### 位置

- `code_review_graph/main.py`

### MCP 名字

- `detect_changes_tool`

### 对外签名

```python
async def detect_changes_tool(
    base: str = "HEAD~1",
    changed_files: Optional[list[str]] = None,
    include_source: bool = False,
    max_depth: int = 2,
    repo_root: Optional[str] = None,
    detail_level: str = "standard",
)
```

### wrapper 行为

- 用 `asyncio.to_thread(...)` 调 `detect_changes_func(...)`

### 为什么要 `to_thread`

源码注释写得很明确：

- 它要跑 `git diff` 子进程
- 还会做 BFS / 分析
- 在 Windows + stdio MCP 场景里，阻塞调用可能导致挂起

所以 detect_changes 被包装成 async，不是因为它逻辑天然异步，而是为了 **不阻塞 MCP server 事件循环**。

## 真实实现层

### 位置

- `code_review_graph/tools/review.py`

### 核心执行步骤

1. `_get_store(repo_root)`
2. 自动找 changed files：
   - `get_changed_files(root, base)`
   - 没有则回退到 `get_staged_and_unstaged(root)`
3. `parse_diff_ranges(str(root), base)` 取行级 diff 范围
4. 相对路径 remap 成绝对路径
5. 调 `analyze_changes(...)`
6. 如 `include_source=True`，附加 changed function 源码片段
7. 按 `detail_level` 返回 minimal 或 standard

## 核心算法层：`analyze_changes()`

### 位置

- `code_review_graph/changes.py`

### 核心逻辑

1. 如无 `changed_ranges`，自己跑 `parse_diff_ranges()`
2. 用 `map_changes_to_nodes()` 把变化行映射到 graph nodes
3. 只保留 `Function` / `Test` / `Class`
4. 对每个节点跑 `compute_risk_score()`
5. overall risk = max(node risk)
6. 调 `flows.get_affected_flows(store, changed_files)`
7. 找无 `TESTED_BY` 的 changed nodes 作为 `test_gaps`
8. 按风险排序给出 `review_priorities`

## `compute_risk_score()` 的真实评分因子

- flow participation：cap 0.25
- cross-community callers：cap 0.15
- test coverage：0.30 → 0.05 缩放
- security keyword：+0.20
- caller count：cap 0.10

### 一个重要细节

这里测试覆盖用的是：

- `store.get_transitive_tests(...)`

也就是说，它考虑的是**传递性测试覆盖**，不只是直接 `TESTED_BY` 边。

这比 `query_graph(pattern="tests_for")` 更强。

## 真实返回结构

### `detail_level="minimal"`

- `status`
- `summary`
- `risk_score`
- `changed_file_count`
- `test_gap_count`
- `review_priorities`（只保留 top 3 名字）

### `detail_level="standard"`

- `status`
- `changed_files`
- `summary`
- `risk_score`
- `changed_functions`
- `affected_flows`
- `test_gaps`
- `review_priorities`

## 源码级注意点

### 1. 这是一个“组合分析器”，不是单一 BFS 包装

它把这些东西绑在一起了：

- git diff 行级范围
- graph node 映射
- per-node 风险评分
- 受影响流程
- 测试缺口

所以它特别适合 review / regression / pre-merge。

### 2. `max_depth` 目前是个可疑参数

`detect_changes_tool` 和 `detect_changes_func` 都暴露了 `max_depth`，但从当前执行链看：

- `detect_changes_func()` 没把它传给 `analyze_changes()`
- `analyze_changes()` 也没有直接消费它

也就是说，**当前源码下这个参数基本处于“接口上暴露了，但主逻辑没实际使用”的状态**。

这对 workflow-system 很重要：  
如果以后接这个能力，不应该假设 `max_depth` 真能控制 detect_changes 的传播深度。

### 3. `include_source=True` 会让它变重

默认是 `False`，这是对的。  
一旦打开，它会给每个 changed function 拼源码片段，输出体量会明显增大。

### 4. 它对 changed file 检测有双重 fallback

- 先 diff `base`
- 再看 staged / unstaged

所以它对“未提交但已修改”的工作区也有感知。

### 5. 它的变化识别层是 VCS-aware 的

`detect_changes` 底下依赖的两层能力：

- `get_changed_files(...)`
- `parse_diff_ranges(...)`

都支持 Git / SVN 自动分流。  
这意味着它在变化识别层面，比 `get_minimal_context` 更接近真正的 VCS-aware 实现。

## 对 workflow-system 的接入启示

### 适合怎么接

- `review-diff`
- `review-current-diff`
- `run-regression`
- `verify-contracts`
- `debug-and-fix-current-task`

### 不适合怎么接

- 不要把它当“唯一传播真相”
- 不要依赖 `max_depth` 做严格协议语义

---

## 三、`query_graph`

## MCP 暴露层

### 位置

- `code_review_graph/main.py`

### MCP 名字

- `query_graph_tool`

### 对外签名

```python
query_graph_tool(
    pattern: str,
    target: str,
    repo_root: Optional[str] = None,
    detail_level: str = "standard",
)
```

### wrapper 行为

- 仅做 `_resolve_repo_root(repo_root)`
- 直接转给 `tools/query.py:query_graph(...)`

## 真实实现层

### 位置

- `code_review_graph/tools/query.py`

### 支持的 pattern

- `callers_of`
- `callees_of`
- `imports_of`
- `importers_of`
- `children_of`
- `tests_for`
- `inheritors_of`
- `file_summary`

### 目标解析逻辑

源码里 target 解析分 3 步：

1. 直接当 qualified_name 查 `store.get_node(target)`
2. 不行就转成绝对路径再查
3. 还不行就 `store.search_nodes(target, limit=5)`

如果：

- 命中 1 个 -> 自动采用
- 命中多个 -> 返回 `status="ambiguous"`
- 命中 0 个 -> 返回 `status="not_found"`（`file_summary` 除外）

### 真实返回状态

它不只是 `ok/error` 两类，还包括：

- `ok`
- `error`
- `ambiguous`
- `not_found`

这对 workflow-system skill 设计很关键，因为你不能只按 happy path 设计。

## 几个关键 pattern 的源码细节

### `callers_of`

- 查 `store.get_edges_by_target(qn)`
- 只取 `CALLS` 边
- 如果 target 是常见 builtin 名称（如 `map`）且不是 qualified name，会直接跳过以避免噪声
- 如果按 fully qualified name 找不到，还会 fallback 到 plain name 搜 `CALLS` edges

### `tests_for`

- 先看 `TESTED_BY` 边
- 再按命名约定补搜：
  - `test_<name>`
  - `Test<name>`

### 关键差异

`tests_for` 这里用的是：

- 直接测试边 + 命名约定 fallback

而 `detect_changes` 风险分析用的是：

- `get_transitive_tests(...)`

所以两者的“测试覆盖”语义并不完全相同。  
如果 workflow-system 未来接这两个能力，不能把它们当同一个层级的证据。

### `importers_of`

- 会把 target canonicalize 成绝对路径
- 再查 `IMPORTS_FROM` 边

### `inheritors_of`

- 查 `INHERITS` / `IMPLEMENTS`
- 如果 fully qualified name 没命中，也会按 plain name fallback

## 输出形状

### `minimal`

- `status`
- `pattern`
- `target`
- `description`
- `summary`
- `result_count`
- `results`（裁剪字段）

### `standard`

- `status`
- `pattern`
- `target`
- `description`
- `summary`
- `results`
- `edges`

## 源码级注意点

### 1. `query_graph` 是最通用也最容易误用的能力

因为 pattern 很多、target 解析有 fallback，所以它很灵活，但也更容易：

- 命中歧义
- 结果噪声偏大
- 被误当成“强语义搜索”

### 2. `ambiguous` 是必须处理的正式分支

workflow-system 如果未来 skill 直接接 `query_graph`，必须允许：

- 让模型改用 qualified name
- 或者先做更精确定位

### 3. builtin 过滤是一个 provider-specific 约束

`callers_of(map)` 这种情况会被主动压噪。  
这对日常使用是好事，但如果 workflow-system 想做严格协议级语义，不能假设它对所有 target 都一致。

### 4. 它不是严格去重的结构查询器

从当前实现看，不同 pattern 分支大多直接 append 结果，没有统一去重层。  
这意味着它更适合作为“结构线索提供器”，而不应被当成完全规范化后的事实表。

## 对 workflow-system 的接入启示

### 第一批建议只开放的 pattern

- `callers_of`
- `callees_of`
- `tests_for`
- `imports_of`
- `importers_of`

### 不建议第一批默认依赖的 pattern

- `children_of`
- `inheritors_of`
- `file_summary`

不是不能用，而是第一批 skill 更不需要它们。

---

## 最终建议

如果 workflow-system 真要开始接 graph provider，这 3 项最适合扮演的角色是：

### `get_minimal_context`
- 统一入口
- 轻量路由

### `detect_changes`
- review / regression / pre-merge 主分析器

### `query_graph`
- 二级结构追踪器

## 关键源码级警告

1. `get_minimal_context` 的 `flows_affected` 在语义上可能只是 top flows，不一定真是 affected flows
2. `detect_changes` 暴露了 `max_depth`，但当前主逻辑并未真正使用
3. `query_graph(pattern="tests_for")` 的测试语义弱于 `detect_changes` 使用的 transitive test coverage

这 3 点如果不写清，workflow-system 后续接入时最容易抽错层。
