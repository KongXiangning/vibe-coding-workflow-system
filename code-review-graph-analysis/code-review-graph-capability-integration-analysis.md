# code-review-graph 能力接入 workflow-system 分析

## 结论

如果目标是把 `code-review-graph` 的能力接入 `vibe-coding-workflow-system`，最值得接入的不是它整套产品形态，而是它的 **结构化代码理解与影响分析能力**。

`workflow-system` 已经擅长治理边界、决策、状态、任务包和质量门；它最缺的是对真实代码结构、调用传播链和测试影响面的高质量感知。`code-review-graph` 正好补这块。

因此，最佳方向不是把 `code-review-graph` 当成 workflow-system 的强依赖，也不是把其 CLI / DB / daemon 直接并入 workflow-system，而是把它抽象为 **可选的代码图谱分析能力层**，再接到 inventory、task、review、regression 和 host guidance 上。

## 一、两边分别为其他项目提供什么帮助

### 1. `code-review-graph` 提供的帮助

它本质上提供的是 **执行期智能**：

1. **最小上下文获取**
   - 基于图谱返回最小相关上下文，而不是默认扫全仓库。
2. **影响面分析**
   - 支持 blast radius、affected flows、risk-scored reviews。
3. **结构化代码探索**
   - 支持 callers / callees / imports / tests / communities / architecture overview。
4. **风险排序与测试缺口提示**
   - 帮助判断哪些改动更危险、哪些测试可能缺失。
5. **架构盘点与 onboarding 加速**
   - 社区划分、架构概览、wiki 生成适合老项目理解。
6. **持续使用的上下文基础设施**
   - watch、daemon、multi-repo、增量更新让它不是一次性分析工具。

### 2. `workflow-system` 提供的帮助

它本质上提供的是 **治理期智能**：

1. **边界治理**：`CONTRACTS.md`
2. **决策治理**：`DECISIONS.md`
3. **状态治理**：`STATUS.md` / `LESSONS.md`
4. **任务包治理**：`CURRENT_TASK.md`
5. **质量门治理**：`BASELINES.md`
6. **项目接入与日常任务链路**
   - `legacy-inventory`
   - `adopt-existing-project`
   - `create-current-task`
   - review / regression / sync

### 3. 互补关系

- `code-review-graph` 擅长回答：**应该看哪里、可能影响什么、哪里风险高**
- `workflow-system` 擅长回答：**这次允许改什么、哪些不能改、改完如何同步治理与归档**

### 4. `code-review-graph` CLI 生命周期

CLI 是图谱生命周期和 MCP 暴露面的运维入口，不应被 workflow-system 直接内置为核心 runtime。

典型使用顺序：

1. **安装 / 注册**
   - `code-review-graph install`
   - 自动检测支持的平台，写入 MCP server 配置，并按平台安装 hooks / skills / guidance。
   - 职责边界：这是目标项目本地的一次性 provider 安装动作，不是 workflow-system adoption 流程。

2. **首次构建**
   - `code-review-graph build`
   - 解析目标仓库，生成 `.code-review-graph/graph.db`。
   - 职责边界：负责生成结构图谱；workflow-system 只消费结果，不接管 graph DB schema。

3. **增量更新**
   - `code-review-graph update`
   - 根据 VCS 变化重新解析变更文件和依赖方。
   - hooks 常用 `code-review-graph update --skip-flows` 做轻量刷新，避免每次编辑都跑完整 flow / community 后处理。

4. **新鲜度检查**
   - `code-review-graph status`
   - 查看 files / nodes / edges / languages / last updated 等统计。
   - workflow-system 未来如果接入，只应把它作为 provider 可用性和 freshness evidence，而不是协议级成功条件。

5. **持续刷新**
   - `code-review-graph watch`
   - 单仓库文件变更监听，适合编辑期持续维护图谱。
   - `code-review-graph daemon start|stop|status`
   - 多仓库 watch 管理，适合同时维护多个项目。

6. **命令行审查**
   - `code-review-graph detect-changes`
   - 提供风险评分、测试缺口和影响摘要，适合 pre-commit 或人工快速检查。

7. **MCP 服务**
   - `code-review-graph serve`
   - 向 AI 客户端暴露 MCP tools / prompts。
   - AI 真正消费图谱通常发生在任务执行期：先 `get_minimal_context`，再按任务进入 `detect_changes`、`query_graph`、`get_affected_flows` 或 `get_architecture_overview`。

## 二、值得接入 workflow-system 的 5 项核心能力

## 1. graph-first context acquisition

### 核心价值

让 workflow-system 在目标项目具备 code graph 能力时，优先走结构化探索，而不是默认 grep/read。

### 具体设计点

1. **在 `PROJECT_PROFILE.yaml` 增加可选分析能力声明**
   - 声明目标项目是否具备 `code-graph` 能力。
   - 声明 provider、成熟度、是否启用 graph-first。

2. **在 host guidance 模板里增加“优先分析通道”规则**
   - 有 graph 能力时，先用最小上下文 / 架构 / 影响面分析。
   - 无 graph 能力时，自动回退到普通代码探索路径。

3. **在关键技能里增加统一前置分流**
   最适合首批接入的 skill：
   - `legacy-inventory`
   - `investigate-root-cause`
   - `review-diff`
   - `run-regression`
   - `verify-contracts`

### 最适合落点

- `.workflow-system/PROJECT_PROFILE.yaml`
- `templates/skills/*.SKILL.md.tmpl`
- host guidance 相关模板和同步逻辑

### 注意事项

- 必须有 fallback，不能因为没装 graph 工具就让 workflow 失效。
- 对 trivial task 不能强制 graph-first，否则会增加额外开销。

## 2. impact / blast-radius evidence for tasks and review

### 核心价值

把“传播治理”从方法论概念，落成任务包和审查链路里的执行证据。

### 具体设计点

1. **未来若实现，优先复用 `CURRENT_TASK.md > 传播治理记录` 承载影响证据**
   当前阶段不改模板；进入实现前应先确认 `.workflow-system/WORKFLOW_PROTOCOL.md` / `.workflow-system/FILE_SCHEMAS.md` 已允许对应承载方式。建议先映射为抽象 evidence，而不是新增 provider-specific 区块：
   - 变更起点
   - 影响对象
   - 受影响契约
   - 受影响流程
   - 风险级别
   - 证据来源
   - 可信度 / 局限性
   - 可对应 `EvidenceRecord` / `EvidenceAggregation` / `ContractCompatibilityResult`

2. **给 review / regression / verify-contracts 技能增加“先收集影响证据，再做判断”的步骤**
   - 先拿影响面
   - 再判断是否越过 contract
   - 再决定测试和回归范围

3. **让 `sync-current-task` 未来支持写回抽象传播证据**
   - 把运行中确认过的传播信息沉淀回任务包，而不是只留在对话里。
   - 如果需要新增字段、章节或错误码，必须先扩展 protocol/schema，再改模板和 skill。

### 最适合落点

- `CURRENT_TASK.md > 传播治理记录`（优先复用现有承载面）
- `templates/skills/review-*.SKILL.md.tmpl`
- `templates/skills/verify-contracts.SKILL.md.tmpl`
- `templates/skills/sync-current-task.SKILL.md.tmpl`

### 注意事项

- 影响证据只能作为强证据来源之一，不能代替人工判断。
- 应允许写明 `false positive`、`unknown`、`limited coverage`。
- 不应把 `code-review-graph` 的原始 JSON 字段直接升级为 workflow-system 协议字段。

## 3. risk-based regression targeting

### 核心价值

让 workflow-system 不只是要求“做回归”，而是更清楚 **优先回归哪些路径**。

### 具体设计点

1. **未来若实现，优先把回归优先级写入现有任务传播 / 回归记录**
   例如：
   - 必测路径
   - 高风险路径
   - 可选扩展验证
   - 当前测试缺口
   - 对应 evidence / compatibility result / regression checklist，而不是直接复制 provider-specific 返回结构

2. **让 `run-regression` 支持图谱增强模式**
   - 有 graph 能力时，用 affected flows / tests_for / detect changes 缩小回归范围。
   - 无 graph 能力时，回退到现有测试策略。

3. **只有在 protocol/schema 扩展后，才考虑让 `BASELINES.md` 增加长期 gate 表达**
   - gate 仍由项目绑定
   - 风险分析帮助决定验证先后顺序
   - 当前阶段只应把 graph 输出作为本轮任务的回归优先级 evidence，不应改写长期 baseline

### 最适合落点

- `CURRENT_TASK.md > 传播治理记录` / `CURRENT_TASK.md > 回归检查项`
- `.workflow-system/WORKFLOW_PROTOCOL.md` / `.workflow-system/FILE_SCHEMAS.md`（仅当需要新增长期结构时）
- `templates/skills/run-regression.SKILL.md.tmpl`
- `templates/skills/debug-and-fix-current-task.SKILL.md.tmpl`

### 注意事项

- 不能把“graph 没提示到”误当成“无需回归”。
- 对不成熟语言支持的项目，图谱建议权重应降低。
- `BASELINES.md` 不应承载单个 provider 的临时风险建议；长期 gate 变化必须先有规范源定义。

## 4. graph-assisted legacy inventory / adoption

### 核心价值

让老项目接入 workflow-system 时，更快得到架构关系、调用链、测试关联和脆弱区域线索。

### 具体设计点

1. **给 `legacy-inventory` 增加图谱辅助盘点步骤**
   优先采集：
   - 架构社区 / 模块分组
   - 关键入口流程
   - 高连接枢纽
   - 未测试热点
   - 高传播风险区域

2. **给 adoption 文档增加“图谱辅助证据”标记**
   例如：
   - confirmed by runtime/tooling
   - inferred from code graph
   - unknown

3. **让 adoption 更容易产出 `CONTRACTS.md` 和 `STATUS.md` 首版草图**
   - 哪些模块像稳定边界
   - 哪些区域耦合高
   - 哪些能力 fragile

### 最适合落点

- `templates/skills/legacy-inventory.SKILL.md.tmpl`
- `templates/skills/adopt-existing-project.SKILL.md.tmpl`
- `templates/docs/STATUS.md.tmpl`
- `templates/docs/CONTRACTS.md.tmpl`

### 注意事项

- graph 输出不能直接等价于架构真相。
- adoption 必须保留 `confirmed / inferred / unknown` 分级，不能把工具猜测当事实。

## 5. graph-aware host guidance and skill routing

### 核心价值

让 workflow-system 在目标项目装有图谱工具时，自动采用更合适的工具优先级和技能路由。

### 具体设计点

1. **让 `sync-host-guidance` 根据项目能力渲染不同规则**
   - 有 graph provider：渲染 graph-first 规则
   - 无 graph provider：渲染普通探索规则

2. **给部分技能增加“工具路由建议”**
   比如：
   - 查影响面 -> 优先 impact / flow 能力
   - 查架构 -> 优先 architecture / community 能力
   - 查测试相关 -> 优先 tests_for / affected flows 能力

3. **把 graph-aware routing 设计成行为建议层，而不是 protocol blocker**
   - 它的作用是提效和增强判断
   - 不是没有图谱就不能执行 workflow

### 最适合落点

- `templates/skills/sync-host-guidance.SKILL.md.tmpl`
- `templates/skills/review-diff.SKILL.md.tmpl`
- `templates/skills/review-current-task.SKILL.md.tmpl`
- `templates/skills/investigate-root-cause.SKILL.md.tmpl`
- `templates/skills/implement-current-step.SKILL.md.tmpl`

### 注意事项

- host guidance 只能指导工具优先级，不能依赖 provider-specific 的私有输出格式。

## 三、接入方式建议

## 1. 应采用“能力适配层”，不要硬编码 provider

协议应描述抽象能力，而不是直接写死 `detect_changes_tool` 或 `get_affected_flows_tool` 这类名字。

推荐抽象能力：

- 最小上下文采集
- 影响面证据
- 受影响流程
- 回归优先级建议
- 架构快照

`code-review-graph` 只是这些能力的一个 provider。

## 1.1 protocol / schema 前置边界

当前需求阶段只做分析，不改 `.workflow-system/**`、`templates/**`、`scripts/**`，因此所有接入落点都应理解为未来设计候选，而不是当前可直接修改的文件清单。

未来若进入实现，应遵守：

1. 优先复用 `CURRENT_TASK.md > 传播治理记录`、`EvidenceRecord`、`EvidenceAggregation`、`ContractCompatibilityResult` 等已存在的传播治理承载面。
2. graph provider 原始字段只能作为 evidence source，不得直接成为 workflow-system 协议字段。
3. 如果确实需要新增章节、字段、错误码、gate 或 baseline 语义，先扩展 `.workflow-system/WORKFLOW_PROTOCOL.md` 和 `.workflow-system/FILE_SCHEMAS.md`，再改模板、skill 和生成器。
4. host guidance 可以先描述“优先调用图谱工具”的行为建议；protocol blocker 只能建立在规范源已经声明的抽象能力上。

## 2. 应做成可选增强，不做强依赖

不建议：

- 把 `code-review-graph` 设成 workflow-system 的必装前提
- 把 graph DB / daemon / schema 迁进 workflow-system runtime
- 让协议依赖某个外部图工具的返回结构

原因：

- 对小型单文件任务，graph 可能有额外开销
- flow detection 对不同语言成熟度不一致
- impact analysis 偏保守召回，不适合当唯一真相源

## 四、优先级排序

## 第一批最值得做

1. `PROJECT_PROFILE.yaml` 的可选分析能力声明
2. host guidance 的 graph-aware 分流规则
3. 基于现有 `CURRENT_TASK.md > 传播治理记录` 的影响证据 / 回归优先级写回设计
4. `legacy-inventory` / `run-regression` / `review-diff` 的图谱增强步骤

## 第二批再做

5. adoption 文档的图谱辅助证据结构
6. `verify-contracts` / `debug-and-fix-current-task` 的图谱增强逻辑
7. health / sync 层面的 provider 探测与弱校验

## 暂时不建议优先做

8. 把 `code-review-graph` 设为 workflow-system 强依赖
9. 把 provider-specific JSON 结构写进协议
10. 把 wiki / visualization / embeddings 作为 workflow-system 核心能力

## 五、最终判断

最值得接入 workflow-system 的，不是 `code-review-graph` 的整套产品壳，而是它的 **结构化代码理解层**。

具体来说，就是把以下 5 项能力，以“可选图谱分析能力”的方式接到 workflow-system 上：

1. graph-first context acquisition
2. impact / blast-radius evidence for tasks and review
3. risk-based regression targeting
4. graph-assisted legacy inventory / adoption
5. graph-aware host guidance and skill routing

这样 workflow-system 能获得：

- 更强的任务前上下文采集
- 更实的传播治理证据
- 更有针对性的回归建议
- 更快的老项目接入
- 更好的工具优先级路由

而不会因此失去工具无关性，也不会把自己变成另一个代码图谱产品。
