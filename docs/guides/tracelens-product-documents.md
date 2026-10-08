# 需求与目标维护成果：标准模板与 TraceLens 解析交接

本文面向产品文档维护者和 TraceLens 实施者，整理现有成果的模板、格式、解析入口与展示要求。使用现有 `vnext-product-manifest/v2` 和 `vnext-product-doc/v2`，不新增格式版本。字段权威是[文档契约](../product/project-maintenance/document-contract.md)与[生产 Schema](../../runtime/vnext/support/product-maintenance/schemas/)；本文是使用索引，发生差异时先核对契约和实际解析器。

交付范围是文档、可复用模板和消费者样例；没有修改 TraceLens 源码或验证其页面。

## 1. 成果清单与模板选择

目标项目以 `.workflow-system/PRODUCT.yaml` 为唯一默认入口。文件名和目录可以按项目调整；机器身份来自 `project_id`、条目 `id` 和 `type`，不依赖中文文件名或 ID 前缀。

| 成果 | 模板 | 何时使用 | 展示位置 |
|---|---|---|---|
| 入口清单 | [PRODUCT.yaml](../../runtime/vnext/support/product-maintenance/templates/PRODUCT.yaml) | 启用维护，登记当前文档、来源、历史和排除范围 | 项目选择、读取范围 |
| 项目概况 `project` | [PROJECT.md](../../runtime/vnext/support/product-maintenance/templates/PROJECT.md) | 记录定位、盘点来源与未核对范围 | 项目总览、资料缺口 |
| 目标 `goal` | [GOAL.md](../../runtime/vnext/support/product-maintenance/templates/GOAL.md) | 记录要达到的业务结果与边界 | 目标树、目标详情 |
| 模块 `module` | [MODULE.md](../../runtime/vnext/support/product-maintenance/templates/MODULE.md) | 组织业务能力和需求归属 | 模块分组 |
| 完整需求 `requirement` | [REQUIREMENTS.md](../../runtime/vnext/support/product-maintenance/templates/REQUIREMENTS.md) | 保留完整内容、边界和验收要求，包括已交付部分 | 需求列表、详情、关系图 |
| 设计 `design` | [DESIGN.md](../../runtime/vnext/support/product-maintenance/templates/DESIGN.md) | 记录目标方案、取舍及实际实现差异 | 方案视图 |
| 实施安排 `plan` | [PLAN.md](../../runtime/vnext/support/product-maintenance/templates/PLAN.md) | 需要持久化阶段和稳定工作项时使用 | 阶段、工作项及显式依赖 |
| 变化依据 `change` | [CHANGE.md](../../runtime/vnext/support/product-maintenance/templates/CHANGE.md) | 记录实质变化的依据、前后范围与未同步项 | 变化时间线 |
| 交付对账 `assessment` | [ASSESSMENT.md](../../runtime/vnext/support/product-maintenance/templates/ASSESSMENT.md) | 对具体需求、版本和覆盖范围记录实施与验证报告 | 交付与验证面板 |
| 思考资料 `discussion` | [DISCUSSION.md](../../runtime/vnext/support/product-maintenance/templates/DISCUSSION.md) | 收存实际取得的选定原文，整理议题和关联 | 讨论、原文与未决问题 |

上表不是每个项目必须拥有十份文件。一个文件可以放多个不同类型的条目；没有总体计划也可以维护需求并直接关联真实任务。讨论、变更和交付摘要仅在有实际材料时创建。

模板中的 `未记录`、`replace-with-*`、示例 ID 和全零摘要是占位内容。建立真实文档时替换身份、范围与来源；`discussion.raw_ref.sha256` 必须使用原文实际字节摘要。缺少业务事实时保留未知，不复制合成样例中的决定、任务或通过报告。

## 2. 入口格式与目录边界

以下是可调整的目录模板，不表示本仓库已启用业务维护：

```text
<项目根>/
  .workflow-system/PRODUCT.yaml
  docs/product/PROJECT.md
  docs/product/REQUIREMENTS.md
  docs/product/DESIGN.md
  docs/product/PLAN.md                 # 可选
  docs/product/CHANGES.md              # 按实际变化记录
  docs/product/ASSESSMENTS.md          # 按实际对账记录
  docs/product/discussions/DISCUSSIONS.md
  docs/product/discussions/raw/        # 已取得的选定原文
  docs/product/history/                # 必要的历史材料
  docs/evidence/                       # 实际报告与验证依据
```

```yaml
schema: vnext-product-manifest/v2
project_id: replace-with-stable-project-id
entry: docs/product/PROJECT.md
managed_paths:
  - docs/product/*.md
  - docs/product/discussions/*.md
source_paths:
  - docs/evidence/**
  - docs/product/history/**
  - docs/product/discussions/raw/**
capture_paths:
  - docs/product/history/**
  - docs/product/discussions/raw/**
exclude_paths: []
maintenance: enabled
```

`managed_paths` 只登记当前规范文档。`source_paths` 只允许按明确引用读取资料，不要求递归扫描全部历史；`capture_paths` 是已授权保存原文或历史的候选位置。原文、历史不能同时登记为当前定义。路径使用 `/`，相对明确项目根；排除优先，不能越界或跟随符号链接／目录联接。

`maintenance: paused` 仍可读取。没有入口展示“未启用”，不可用展示“读取失败”，不支持的版本保留原文入口；这些情况均不能显示成零需求或项目已完成。

## 3. Markdown 统一格式

```markdown
---
schema: vnext-product-doc/v2
items:
  - id: GOAL-IMPORT
    type: goal
    scope: current
  - id: REQ-IMPORT
    type: requirement
    scope: current
    links:
      - id: L-SUPPORT
        relation: supports
        target: GOAL-IMPORT
        origin: declared
        state: active
---
# 目标与需求（格式示例）

## [GOAL-IMPORT] 可靠导入
### 目标说明
未记录。填写真实目标及来源。
### 范围边界
未记录。填写目标覆盖和排除范围。

## [REQ-IMPORT] 批量导入
### 需求内容
未记录。填写完整行为、规则和异常处理。
### 范围边界
未记录。填写本期、后续及排除内容。
### 验收要求
未记录。填写可观察的输入、条件和预期结果。
```

每个 `items` 成员对应一个根级二级标题 `## [ID] 标题`。标题只来自该标题，不在 YAML 重复保存 `title`。正文到下一个根级二级标题或文件末尾；业务章节用三级标题。新增普通二级附录也会结束前一个条目，不应用它承载该条目的必要内容。

解析须使用 Markdown AST：代码块、引用或列表中的伪标题不产生条目。正文可含表格、列表、例子和额外三级章节，完整保留；不从自然语言自动生成机器验收项、优先级或待办状态。

编码为 UTF-8，读取接受 BOM、LF 和 CRLF。YAML 只允许 JSON 兼容值；禁止重复键、自定义标签、锚点／别名、合并键。日期写引号字符串。ID 为 1–96 位 ASCII 字母、数字及 `._-`，首字符为字母或数字。同一项目中的当前条目 ID 唯一；改名移动不换 ID，拆分或合并需新身份和明确演进关系。

核心字段闭合，附加展示数据放在 `extensions`。不要在核心元数据另加 `status: done`、`progress`、`priority`、`owner` 或重复的中央任务列表。

## 4. 字段和固定章节速查

通用必填为 `id`、`type`；可选为 `links`、`sources`、`extensions`。以下列出各类型必填字段，完整可选字段和条件约束以契约、Schema 为准。

| type | 必填专有字段 | 必要三级章节 |
|---|---|---|
| project | `inventory: {state, checked_sources, unreviewed_sources}` | 项目定位；盘点范围与未核对项 |
| goal | `scope` | 目标说明；范围边界 |
| module | `scope` | 业务能力；范围边界 |
| requirement | `scope` | 需求内容；范围边界；验收要求 |
| design | `intent_state` | 设计方案；约束与取舍；实际实现与差异 |
| plan | `intent_state`、非空 `targets`、`work_items` 数组 | 实施策略；阶段与工作项说明；调整与未决事项 |
| change | `recorded_at`、`basis`、非空 `deltas` | 变更说明；影响与未同步项 |
| assessment | `target`、`target_basis`、`target_definition_sha256`、`checked_at`、`subject`、`implementation`、`verification` | 覆盖范围；交付与验证依据；剩余与待核对 |
| discussion | `raw_ref`、`submitted_at`、`origin`、`record_state` | 整理摘要；议题与未决问题 |

时间建议使用带时区的 ISO 8601 字符串，例如 `"2026-10-08T10:00:00+08:00"`；协议当前只约束字符串，不把这一建议宣称为已实现的日期校验。读取时间不能替代实际决定、提交或对账时间。

### 4.1 各状态维度独立展示

| 字段 | 合法值 | 推荐中文展示 |
|---|---|---|
| scope | current / planned / candidate / retired | 当前范围／后续范围／候选／退出范围 |
| intent_state | proposed / adopted / retired | 提案／已采用／已退出 |
| inventory.state | partial / reconciled | 部分盘点／所列来源已对账 |
| work_items[].state | included / deferred / withdrawn | 纳入安排／延期／撤回 |
| links 或 task_bindings 的 state | active / dismissed | 有效关联／已否定关联 |
| discussion.record_state | active / archived | 活跃资料／已归档 |
| assessment.implementation | unknown / none-reported / partial-reported / delivered-reported | 未知／报告未实施／报告部分实施／报告已交付 |
| assessment.verification | unknown / not-run-reported / failure-reported / pass-reported / mixed-reported | 未知／报告未运行／报告失败／报告通过／报告结果混合 |

`current` 可以包含已交付需求，`retired` 不代表开发完成；`adopted` 不代表执行过；`included` 不代表任务进行中。交付与验证标签附带“报告”性质、对象版本、覆盖范围和来源，不换算为实时任务状态或全项目完成率。

### 4.2 关系、来源与任务关联

`Link` 必填 `id, relation, target, origin, state`。`origin` 为 `declared|inferred`；推断关联须 `reason` 和非空 `sources`，被否定关联须 `reason`。反向关系由消费者计算，不写第二份关系库。

| relation | 合法方向 | 展示意义 |
|---|---|---|
| part_of | requirement→module；module→module | 业务归属 |
| supports | requirement／module→goal | 支持目标 |
| addresses | design→requirement | 方案覆盖需求 |
| depends_on | requirement／design→requirement／design | 业务或方案依赖 |
| replaces / derived_from | goal／module／requirement／design／plan→同类 | 替代或演进 |
| discusses | discussion→goal／module／requirement／design | 相关讨论，不表示采纳 |
| references | 任意条目→任意条目 | 普通参考 |

`SourceRef` 三选一：文件 `{kind: file, path, ...}`、URI `{kind: uri, uri, ...}`、文字 `{kind: text, text, label}`。文件可加 `item_id`、`section`、1-based `lines: {start,end}`、真实 `sha256` 和 `note`；URI 可加 `note`。无法定位的原话或转述保留准确来源标签，不能把转述标为逐字原话。

`TaskBinding` 只放在 goal／requirement 的 `task_bindings`。必填 `id, task, role, coverage, origin, state`；`task` 必填 `task_id`（可为 null）和 `source`，可选 `label, plan_ref, step_id`。真实身份未知时保留 null 与来源，不造 task ID。角色为 `implementation|repair|verification|exploration|reference`；推断／否定的来源约束同 Link。

可选 `plan_items: [{plan_id, work_item_id}]` 指向项目计划工作项；`repairs: [{task, coverage, sources}]` 指向历史被修复范围。工作项身份为 `(plan_id, work_item_id)`，不等于 Runtime `plan_ref`。仅展示报告中的标识和关联，离线消费不读取 journal 计算任务状态。

### 4.3 计划与交付摘要

Plan 的 `targets` 每项为 `{target, coverage}`，指向 goal／requirement。工作项必填 `id, title, outcome, scope, targets, state, origin`；`targets` 是同样的覆盖数组，可空但须保留归属未知。`origin` 为 `initial|added|unknown`，新增工作应有来源。可选 `stage`、`depends_on: [{item_id, kind, reason}]`、`replaces` 和 `sources`。

工作项按原数组顺序展示；依赖 `kind` 为 `order|prerequisite`，首版仅同计划。不能从显示顺序推断依赖，也不能从未声明依赖推断已确认可并行。多份计划分别显示，不按文件时间或首项猜唯一当前计划。

Requirement 的 `assessment_id` 仅选择交付展示入口；没有入口时显示“未选择摘要”，不按时间挑最新。Assessment 的 `target_basis` 指向当时需求文件；`target_definition_sha256` 是 `vnext-requirement-definition/v1` 定义摘要或 null，与整文件字节 SHA、Git SHA 不同。算法见契约第 7 节，消费者不要自行换算法。

`subject` 为 `{kind: working-copy|commit|release|unknown, value: string|null}`；版本未知保持未知。`pending_sources` 表示新材料尚未纳入原结论，旧通过报告仍保留但显著提示待对账。两份材料字节相同或需求摘要一致，也不证明当前代码适用。

## 5. TraceLens 解析与展示交接

建议先用现有独立解析器核对输入；TraceLens 自行实现解析时，以同一契约、Schema 和样例比较结构与降级结果。

### 5.1 两条读取路径

**离线路径：**复制 [offline-reader.js](../../runtime/vnext/support/product-maintenance/offline-reader.js) 为交接目录中的 `offline-reader.mjs`，配合标准项目文件使用。该文件包含解析依赖，无需安装 vNext、Bun、node_modules 或模型；以 `.mjs` 后缀在独立目录保证 ESM 解释。

```powershell
node <交接目录>/offline-reader.mjs <明确项目根>
```

其 JSON 是只读消费样例输出，包含 `contract, project_id, root, status, items, reverse_relations, plan_tasks, diagnostics, coverage, task_states`，不是另一个权威持久化文档协议。`items` 含 `id, type, title, metadata, body, path, line, definition_sha256`；只输出 usable 条目，坏条目须结合 diagnostics 返回原文查看。该输出不核对文件来源内容，也不提供 `read_at`，消费者自行记录读取时间；读取成功或退出码 0 均不足以证明无坏条目或无诊断。

**已有 helper 的路径：**直接调用目标项目安装的只读接口；正文读取必须指定 `detail: items`。

```powershell
'{"detail":"items","resolve_sources":true}' |
  node .workflow-system/runtime/support/product-maintenance.js read --root <明确项目根>
```

其 envelope 为 `product-maintenance-result/v1`，条目位于 `usable_items`，另有 `unusable_items`、`working_copy`、`read_at`、`documents`、`sources`、`coverage` 和 `diagnostics`。`resolve_sources` 只返回来源字节状态及定位核对，不展开原文；正文按明确 source 请求读取。不要把 helper 与离线样例两个 JSON 直接当同一 shape，`result-v1.json` 也不是离线样例输出 Schema。

### 5.2 解析流程与视图映射

1. 选择明确项目根和 manifest；只枚举登记的 managed 范围，保存本次 coverage 与排除项。
2. 校验版本、YAML、Schema 和 AST 章节；逐条降级。重复 ID 不按最新文件获胜，坏条目与诊断保留原文入口。
3. 以 `(工作副本根, project_id, item_id)` 建立展示索引；不同 worktree 不合并未提交内容。
4. 从 links、plan.targets、工作项 targets 和 TaskBinding 建立对应视图；保留各自语义、覆盖文字和推断／否定状态。
5. 从被显式选择的 assessment 展示交付报告，保留对象、版本、范围、来源和待对账材料；没有足够依据保持未知。
6. 渲染完整业务正文及未决项。Markdown 不执行 HTML／MDX／脚本、不加载远程资源；来源导航检查路径边界与 URI 协议，不自动联网取得正文。

| 视图 | 数据来源 | 必须一起展示 |
|---|---|---|
| 总览 | project、inventory、coverage | 所列盘点来源、未核对项、本次未读范围 |
| 目标与模块 | goal、module、supports、part_of | scope、原文范围、无关联条目 |
| 需求详情 | requirement、addresses、sources | 完整需求、边界、验收要求、来源定位 |
| 实施安排 | 明确选定的 plan、work_items、plan_tasks | 原顺序、stage、coverage、显式依赖及未知身份 |
| 交付面板 | assessment_id 指向的 assessment | 实施报告、验证报告、subject、pending_sources、定义对齐诊断 |
| 变化与讨论 | change、discussion、discusses | 前后范围、未同步项、来源、未决问题；不表示已采纳 |
| 诊断栏 | diagnostics、coverage.omitted、坏条目 | 可读部分与缺口并存，不把空结果显示成已完成 |

`coverage.complete` 只说明本次选择路径的枚举与字节读取完整。结构可用看 usable／invalid 数量及诊断，业务盘点看 inventory，交付看 assessment；四者分别展示。默认来源正文未读，不宣称全项目盘点完成。不要用已绑定或关闭的任务数、retired 条目数、adopted 计划数计算需求完成率。

## 6. 可交接样例与验收

[合成展示样例](../product/project-maintenance/examples/tracelens/README.md)含完整入口、九类条目、四种需求范围、计划工作项、未知历史任务、旧交付报告和待核对新反馈。所有业务、决定、任务来源与结果均是合成材料，原文文件摘要按实际样例字节生成。

此外复用[规划消费样例](../product/project-maintenance/examples/planning-consumption.md)：无 plan、多 plan、共享约束和跨阶段需求。复用 [E6 修复样例](../product/project-maintenance/examples/e6-repair.md)：历史交付、计划外修复和原工作续接。

交接文件应包含：本指南、文档契约、v1／v2 manifest 与 doc Schema、入口及九类模板、离线解析器、完整样例目录。保留相对目录结构以维持引用；替换样例目录只需换明确项目根。`request-v1.json`、`result-v1.json` 与 API 文档供需要 helper 接口的实施者按需带入。

TraceLens 接入完成标准：

- 能读取入口和九类条目，标题、正文、元数据与原文行号可定位；无 plan 仍展示完整已知范围。
- 正确区分四种 scope、方案采用、安排状态、交付报告与未知任务身份；不从这些字段自动生成完成率。
- 单份／多份计划保持原顺序和独立身份；推断、否定、待核对来源与缺失关系可见。
- 旧报告通过且出现新反证时，同时展示旧范围和待对账；不覆盖为当前完整通过。
- 缺文件、坏条目、重复 ID、不支持版本或读取预算耗尽时，保留可读部分、原文入口和明确覆盖缺口。
- 同一数据在独立解析和现有离线样例中得到一致的条目、章节、关系和诊断解释；最终页面需在 TraceLens 仓库另行验证。
