# code-review-graph 第一批 6 项 MCP 能力源码级梳理

## 目标

本文件只梳理计划第一批接入 workflow-system 的 6 项能力，不覆盖 `code-review-graph` 全部实现。

范围包括：

1. `build_or_update_graph` / `list_graph_stats`
2. `get_minimal_context`
3. `detect_changes`
4. `get_affected_flows`
5. `query_graph`
6. `get_architecture_overview`

## 总体结论

这 6 项能力可以分成两层：

- **基础设施层**：图谱是否存在、是否新鲜
- **分析层**：最小上下文、变更风险、流程影响、结构查询、架构快照

从源码看，它们的实现并不神秘，绝大多数都是：

1. 通过 `_get_store()` 打开 graph store
2. 自动解析 `repo_root`
3. 在必要时使用 VCS-aware 变化检测（Git / SVN；个别快速探测路径仍偏 Git）
4. 调用下层 `GraphStore` / `changes.py` / `flows.py` / `communities.py`
5. 返回 `status + summary + payload`

这说明它们很适合被 workflow-system 以“可选 graph provider”的方式调用。

---

## 0. 共同基础设施

## `_get_store()`

### 位置

- `code_review_graph/tools/_common.py`

### 作用

- 校验 `repo_root`
- 通过 `find_project_root()` 自动解析项目根
- 通过 `get_db_path()` 打开 `.code-review-graph/graph.db`
- 返回 `(GraphStore, root)`

### 关键约束

- `repo_root` 必须是目录
- 且必须包含 `.git` 或 `.code-review-graph`
- 否则抛出校验错误

### 对 workflow-system 的意义

如果未来 workflow-system skill 直接调用这些 MCP 能力，需要假设：

1. 目标项目根目录可识别
2. 图数据库路径存在或可创建
3. provider 自己会处理 repo root 解析

---

## 1. `build_or_update_graph` / `list_graph_stats`

## 1.1 `build_or_update_graph`

### 入口位置

- `code_review_graph/tools/build.py`

### 函数签名

```python
build_or_update_graph(
    full_rebuild: bool = False,
    repo_root: str | None = None,
    base: str = "HEAD~1",
    postprocess: str = "full",
    recurse_submodules: bool | None = None,
)
```

### 真实执行路径

1. `_get_store(repo_root)`
2. `full_rebuild=True` 时调用 `full_build(root, store, recurse_submodules)`
3. 否则调用 `incremental_update(root, store, base=base)`
4. 如果增量更新没有变化，直接返回“up to date”
5. 否则调用 `_run_postprocess(...)`

### `postprocess` 语义

- `"full"`：signatures + FTS + flows + communities + summaries
- `"minimal"`：signatures + FTS
- `"none"`：不做后处理

### 下层关键实现

#### `full_build()`
- 位置：`code_review_graph/incremental.py`
- 关键逻辑：
  - `collect_all_files()` 收集文件
  - 清理已删除文件的旧数据
  - `CodeParser.parse_bytes()` 解析每个文件
  - `store.store_file_nodes_edges(...)` 写入
  - 支持串行与 `ProcessPoolExecutor` 并行解析
  - 最后记录 metadata，并尝试运行 ReScript / Spring / Temporal resolver

#### `incremental_update()`
- 位置：`code_review_graph/incremental.py`
- 关键逻辑：
  - `get_changed_files()` 找变化
  - `find_dependents()` 找 import 依赖方
  - changed + dependents 合并后重新解析
  - 用 hash 跳过内容没变的文件
  - 删除已不存在文件的数据
  - 最后更新 metadata，并按需跑 resolver

### 输出形状

统一返回：

- `status`
- `build_type`
- `summary`
- 文件 / 节点 / 边数量
- `changed_files`
- `dependent_files`
- `warnings`（如果 postprocess 有问题）

### 注意点

1. `postprocess="full"` 会牵涉 flows / communities，比较重
2. 没变化时会提前返回，不做额外工作
3. 增量更新依赖 VCS-aware 变化检测，源码层支持 Git / SVN 分流

### 对 workflow-system 的意义

这项更像**graph provider 就绪检查 / 新鲜度维护能力**，不是业务分析主能力，但必须作为前置条件存在。

## 1.2 `list_graph_stats`

### MCP 暴露层

- `code_review_graph/main.py`
- MCP 名字：`list_graph_stats_tool`

### MCP 签名

```python
list_graph_stats_tool(
    repo_root: str | None = None,
)
```

### wrapper 行为

1. 通过 `_resolve_repo_root(repo_root)` 解析目标仓库根目录
2. 直接转调 `tools/query.py:list_graph_stats(...)`
3. wrapper 本身不做业务加工、不做异常包装

### 真实实现层

- `code_review_graph/tools/query.py`

### 真实执行路径

1. `_get_store(repo_root)` 打开 graph store
2. `store.get_stats()` 聚合图谱统计
3. 通过 `EmbeddingStore(get_db_path(root))` 读取 embedding 数量
4. 拼接面向人读的 `summary`
5. 返回结构化统计字段
6. `finally` 中关闭 `GraphStore` 和 `EmbeddingStore`

### 下层关键实现

`GraphStore.get_stats()` 位于 `code_review_graph/graph.py`，主要查询：

- `nodes` 总数
- `edges` 总数
- `nodes_by_kind`
- `edges_by_kind`
- 去重后的 `languages`
- `kind = 'File'` 的文件节点数量
- metadata 中的 `last_updated`

### 输出形状

返回字段包括：

- `status`
- `summary`
- `total_nodes`
- `total_edges`
- `nodes_by_kind`
- `edges_by_kind`
- `languages`
- `files_count`
- `last_updated`
- `embeddings_count`

### 空图 / 未充分构建时的行为

- 如果 graph DB 存在但还没有解析出节点，`get_stats()` 仍会返回 `status="ok"`。
- 空图通常表现为 `total_nodes=0`、`total_edges=0`、`files_count=0`、`languages=[]`、`last_updated=None`，summary 中显示 `Last updated: never`。
- 这意味着 `status="ok"` 只代表 provider 可打开统计面，不代表图谱已经有可用代码知识。

### 失败行为

- `_get_store()` 会先校验 `repo_root`，目录不存在或不像项目根会抛错。
- `list_graph_stats()` 不捕获异常；数据库 schema 损坏、SQLite 查询失败或 embedding store 初始化失败会向 MCP 层冒泡。
- 因此 workflow-system 未来调用它时，不能只看 `status`，还要把工具调用失败视为 provider unavailable / graph unavailable。

### 注意点

1. 它是 provider 可用性和新鲜度探测工具，不是代码理解工具。
2. `last_updated` 能辅助判断图谱是否陈旧，但它不是严格 freshness gate。
3. `embeddings_count` 只能说明 embedding 覆盖情况，不能代表结构图谱是否完整。
4. 空图也可能返回 `ok`，所以必须结合节点数、边数、文件数判断是否可用。

对 workflow-system 来说，它主要用于：

- session 开始前探测 provider 是否可用
- `legacy-inventory` 的快速概览
- `build_or_update_graph` 前后验证图谱是否真正生成 / 更新

---

## 2. `get_minimal_context`

### 入口位置

- `code_review_graph/tools/context.py`

### 函数签名

```python
get_minimal_context(
    task: str = "",
    changed_files: list[str] | None = None,
    repo_root: str | None = None,
    base: str = "HEAD~1",
)
```

### 真实执行路径

1. `_get_store(repo_root)`
2. `store.get_stats()` 拿基本统计
3. 如果显式传入变化文件，或 Git 工作树快速探测发现变化：
   - 调 `analyze_changes(...)`
   - 计算 `risk_score`
   - 提取 `top_affected`
   - 统计 `test_gap_count`
4. 直接查数据库拿 top 3 communities
5. 直接查数据库拿 top 3 critical flows
6. 根据 `task` 关键词生成 `next_tool_suggestions`
7. 用 `compact_response(...)` 返回 ultra-compact 响应

### 关键词路由逻辑

它不是智能推理，而是简单关键词分流：

- review / pr / merge / diff -> `detect_changes`, `get_affected_flows`, `get_review_context`
- debug / bug / error / fix -> `semantic_search_nodes`, `query_graph`, `get_flow`
- refactor / rename / dead / clean -> `refactor`, `find_large_functions`, `get_architecture_overview`
- onboard / understand / explore / arch -> `get_architecture_overview`, `list_communities`, `list_flows`
- 否则走默认建议

### 输出形状

来自 `compact_response()`：

- `status`
- `summary`
- `key_entities`
- `risk`
- `communities`
- `flows_affected`
- `next_tool_suggestions`

### 注意点

1. 它本质上是一个**路由型入口**，不是深分析器
2. 它依赖已存在的 communities / flows 表；如果没 postprocess 到这些表，会降级
3. 风险计算依赖 `analyze_changes()`，所以它并不是纯静态概览

### 对 workflow-system 的意义

这是最适合做 workflow-system graph-aware skill 统一入口的能力，因为它：

- 成本低
- 输出紧凑
- 能给下一步工具建议

---

## 3. `detect_changes`

### 入口位置

- `code_review_graph/tools/review.py`

### 函数签名

```python
detect_changes_func(
    base: str = "HEAD~1",
    changed_files: list[str] | None = None,
    include_source: bool = False,
    max_depth: int = 2,
    repo_root: str | None = None,
    detail_level: str = "standard",
)
```

### 真实执行路径

1. `_get_store(repo_root)`
2. 若未显式传 `changed_files`：
   - 先 `get_changed_files(root, base)`
   - 再回退到 `get_staged_and_unstaged(root)`
3. `parse_diff_ranges(str(root), base)` 解析 diff 行号范围
4. 把相对路径 remap 成绝对路径
5. 调 `analyze_changes(...)`
6. 如果 `include_source=True`，给 changed functions 加源码片段
7. 按 `detail_level` 返回 minimal 或 standard

### 下层核心算法：`analyze_changes()`

位置：

- `code_review_graph/changes.py`

逻辑：

1. 如果没给 `changed_ranges`，就自己跑 `parse_diff_ranges()`
2. `map_changes_to_nodes()` 把变更行映射到 graph nodes
3. 只保留 `Function` / `Test` / `Class`
4. 对每个节点跑 `compute_risk_score()`
5. 取最大值作为 overall risk
6. 调 `flows.get_affected_flows(...)`
7. 找没有 `TESTED_BY` 边的 changed nodes，生成 `test_gaps`
8. 按风险排序出 top 10 review priorities

### `compute_risk_score()` 的评分因子

位置：

- `code_review_graph/changes.py`

评分因子包括：

- flow participation（cap 0.25）
- cross-community callers（cap 0.15）
- test coverage（0.30 到 0.05 缩放）
- security keyword 命中（+0.20）
- caller count（cap 0.10）

### 输出形状

#### `detail_level="minimal"`

- `status`
- `summary`
- `risk_score`
- `changed_file_count`
- `test_gap_count`
- `review_priorities`（只保留 top 3 名字）

#### `detail_level="standard"`

- `status`
- `changed_files`
- `summary`
- `risk_score`
- `changed_functions`
- `affected_flows`
- `test_gaps`
- `review_priorities`

### 注意点

1. 这是 review / pre-merge / debug 的核心工具
2. 它本质上不是简单 diff，而是“diff ranges + graph nodes + flow/test/community 风险”的合成分析
3. `max_depth` 在 wrapper 里存在，但当前 `detect_changes_func()` 没直接把它传进 `analyze_changes()`；它更多是接口保留位

### 对 workflow-system 的意义

这是最值得接入 workflow-system review / regression / verify-contracts 链路的能力，因为它直接把“改了什么”转成“风险和验证优先级”。

---

## 4. `get_affected_flows`

### 入口位置

- wrapper：`code_review_graph/tools/review.py`
- 核心实现：`code_review_graph/flows.py`

### wrapper 签名

```python
get_affected_flows_func(
    changed_files: list[str] | None = None,
    base: str = "HEAD~1",
    repo_root: str | None = None,
)
```

### wrapper 逻辑

1. `_get_store(repo_root)`
2. 未给 `changed_files` 时，先通过 VCS-aware `get_changed_files(...)` 检测变化（Git / SVN），再回退到工作区 / 工作副本状态
3. 把相对路径转绝对路径
4. 调 `_get_affected_flows(store, abs_files)`
5. 返回排序后的 affected flows

### 核心实现逻辑

在 `flows.py` 中很直接：

1. `store.get_node_ids_by_files(changed_files)`
2. `store.get_flow_ids_by_node_ids(node_ids)`
3. 对每个 flow id 调 `get_flow_by_id(store, fid)`
4. 按 `criticality` 倒序排序

### 输出形状

- `status`
- `summary`
- `changed_files`
- `affected_flows`
- `total`

### 注意点

1. 这是个相对“纯”的映射工具：文件 -> 节点 -> flow -> criticality 排序
2. 它不自己做复杂风险评分，主要提供流程影响清单
3. 价值很高，但应视为增强证据，不应当唯一真相

### 对 workflow-system 的意义

它非常适合接到：

- `run-regression`
- `review-diff`
- `verify-contracts`
- `debug-and-fix-current-task`

因为它能把“影响了哪些文件”提升到“影响了哪些关键路径”。

---

## 5. `query_graph`

### 入口位置

- `code_review_graph/tools/query.py`

### 函数签名

```python
query_graph(
    pattern: str,
    target: str,
    repo_root: str | None = None,
    detail_level: str = "standard",
)
```

### 支持的 pattern

- `callers_of`
- `callees_of`
- `imports_of`
- `importers_of`
- `children_of`
- `tests_for`
- `inheritors_of`
- `file_summary`

### 真实执行路径

1. `_get_store(repo_root)`
2. 校验 `pattern`
3. 尝试解析 `target`
   - 原样找节点
   - 尝试绝对路径
   - `search_nodes(target, limit=5)` 搜索
   - 多命中返回 `ambiguous`
4. 针对不同 pattern 跑不同 edge/node 查询
5. `minimal` 只返回裁剪后的 top 5 结果

### 几个关键分支细节

#### `callers_of`
- 会过滤通用 builtin 调用名（如 `map`）
- 如果按 fully qualified name 没找到，会 fallback 按 plain name 搜 CALLS edges

#### `tests_for`
- 先看 `TESTED_BY` 边
- 再按命名约定搜 `test_<name>` / `Test<name>`

#### `importers_of`
- 会把 target canonicalize 成绝对路径

#### `inheritors_of`
- 也有 plain name fallback

### 输出形状

#### `minimal`

- `status`
- `pattern`
- `target`
- `description`
- `summary`
- `result_count`
- `results`（裁剪字段）

#### `standard`

- `status`
- `pattern`
- `target`
- `description`
- `summary`
- `results`
- `edges`

### 注意点

1. `query_graph` 是第一批里最通用、也最容易滥用的能力
2. 第一批接入 workflow-system 时，不应把全部 pattern 都开放为默认路径
3. 最值得先锁定的 pattern：
   - `callers_of`
   - `callees_of`
   - `tests_for`
   - `imports_of`
   - `importers_of`

### 对 workflow-system 的意义

它适合作为通用二级查询工具，而不是统一入口。

---

## 6. `get_architecture_overview`

### 入口位置

- wrapper：`code_review_graph/tools/community_tools.py`
- 核心实现：`code_review_graph/communities.py`

### wrapper 签名

```python
get_architecture_overview_func(
    repo_root: str | None = None,
)
```

### wrapper 逻辑

1. `_get_store(repo_root)`
2. 调 `communities.get_architecture_overview(store)`
3. 生成 summary
4. 返回 communities / cross-community edges / warnings

### 核心实现逻辑

`communities.get_architecture_overview(store)` 主要做：

1. `get_communities(store)` 取社区
2. 建 `node -> community_id` 映射
3. 遍历 `store.get_all_edges()`
4. 统计 cross-community edges
5. 忽略 `TESTED_BY` 这种预期跨边界关系
6. 对 cross-community edge count > 10 的社区对生成 warnings
7. 如果社区名像 test community，则跳过 warning

### 输出形状

- `status`
- `summary`
- `communities`
- `cross_community_edges`
- `warnings`

### 注意点

1. 它不是简单“列社区”，而是把社区和耦合一起给出来
2. 这是它比 `list_communities` 更适合第一批接入的原因
3. 它对 adoption / inventory 非常有帮助，因为能快速指出高耦合区域

### 对 workflow-system 的意义

这是最适合接到：

- `legacy-inventory`
- `adopt-existing-project`
- `review-current-task`

的第一批架构快照能力。

---

## 第一批接入建议

## 建议作为 skill 级统一入口的

- `build_or_update_graph` / `list_graph_stats`
- `get_minimal_context`

## 建议作为 review / regression 核心能力的

- `detect_changes`
- `get_affected_flows`
- `query_graph`（限高价值 pattern）

## 建议作为 inventory / adoption 核心能力的

- `get_architecture_overview`

---

## 当前梳理的边界

这份文件已经达到“第一批接入前置的源码级梳理”标准，但还没有继续下钻：

- `GraphStore` 具体 SQL 层
- `get_review_context` 的深层输出策略
- `semantic_search_nodes` 的混合搜索实现
- communities / flows 的完整生成算法

如果下一步要真正改 workflow-system 的 skill，这些只需按第一批接入点继续定向补，不需要全量补完。
