# 托管文档契约：目标、需求、实施计划及资料关联

契约设计 0.3（2026-10-11，VN-01 确定）。当前已验收源码及本地 `0.24.6` 产物支持 `vnext-product-doc/v3` 的解析、校验与保存，Manifest 保持 `vnext-product-manifest/v2`；分发安装、宿主 Skill 指导及 TraceLens 只读接入的实际证据见[最新实施与验收交接](../../ops/full-scope-planning-evidence/实施与验收交接.md)，不表示 npm 发布或已合并 main。日常使用见[maintain-project 指南](../../guides/maintain-project.md)。

本文件是生产侧和离线消费者共用的字段语义。第 1–9 节描述既有格式，第 10 节是 v3 最小增量；发生冲突时按所读文件的格式版本解释。v1 保留读取与显式迁移，v2 写入兼容保留；无需全项目迁移。正文中的设计演算及历史阶段说明保留原背景，当前交付以以上入口为准。Schema 通过不认证业务事实。

## 1. 入口、范围及版本

默认入口为项目根下 `.workflow-system/PRODUCT.yaml`。可显式指定另一入口，但不能静默合并两份当前基线。没有入口时报告未启用；普通文档仍可按调用者原有能力阅读，不猜成托管条目。

```yaml
schema: vnext-product-manifest/v2
project_id: sample-product
entry: docs/product/PROJECT.md
managed_paths:
  - docs/product/*.md
  - docs/product/discussions/*.md
source_paths:
  - docs/evidence/**
  - docs/workflow/*.md
  - TASKS/**/*.md
  - docs/product/history/**
  - docs/product/discussions/raw/**
capture_paths:
  - docs/product/history/**
  - docs/product/discussions/raw/**
exclude_paths: []
maintenance: enabled
```

| 字段 | 必填／类型 | 语义 |
|---|---|---|
| schema | 是／固定字符串 | 上述 v2；不是需求版本或发行版本。 |
| project_id | 是／非空字符串 | 稳定项目身份；改名移动不变。 |
| entry | 是／相对路径 | 含唯一 project 条目的托管文件。 |
| managed_paths | 是／非空路径或 glob 数组 | 当前规范条目；必须只有一处当前定义。 |
| source_paths | 是／数组，可空 | 可引用的只读资料，不表示已全部读取或全部采纳。 |
| capture_paths | 否／数组，默认空 | 可供本次已授权保存原文／必要历史的候选目录；不是无限写授权。应包含在 source_paths 的读取范围内。 |
| exclude_paths | 是／数组，可空 | 排除优先；不能通过更宽路径绕过。 |
| maintenance | 是／enabled 或 paused | 是否采用主动维护约定；paused 不影响读取，不创建后台任务。 |
| extensions | 否／对象 | 非核心扩展；不能改变当前语义。 |

路径使用 `/`，基于调用者明确的项目根；拒绝绝对路径、NUL、路径穿越和越界。首版跳过符号链接／目录联接并诊断。历史、原文不得同时命中 managed_paths 成为第二份当前定义。超出候选范围的写入需先取得实际授权并调整配置，不能静默扩大范围。

只枚举 managed_paths。source_paths 用于按引用读取，不递归扫描所有原始资料。默认不扫描 `.git`、依赖、构建产物、Runtime 分发或 records。vNext 为定位已知 task 可使用现有 assistance；消费者可按明确登记的单个来源打开原始报告，但不从 journal 计算任务状态。无法定位的 opaque ref 保留为文本标识，不自动访问网络。

请求使用 paths 缩小读取范围时，命中本次选择的具体 managed_paths 登记文件（包括选中的 entry）仍须读取或报告遗漏，不能因 glob 无法发现缺失文件而宣称完整；未选登记不扩入范围，排除仍优先。请求 glob 的静态目录前缀必须实际可枚举：普通文件不能作为已成功枚举的空目录；通配目录内不匹配最终模式的普通文件不误报遗漏。同一路径兼作具体文档和 glob 目录时，可读文档照常读取，目录范围缺口单独保留在 coverage。字节读取完整性、结构可用性、业务盘点与交付结论分别报告，读取缺口不否决独立的已授权写入或 task 操作。

逻辑身份为 `(project_id, item_id)`；读取另带工作副本根标识。两个 worktree 即使 project_id 相同也不自动合并未提交资料。

## 2. Markdown 唯一语法

```markdown
---
schema: vnext-product-doc/v2
items:
  - id: REQ-IMPORT
    type: requirement
    scope: current
---
# 导入需求

## [REQ-IMPORT] 批量导入

### 需求内容
支持已约定的数据输入。

### 范围边界
本期范围以正文为准。

### 验收要求
对有效和无效输入给出约定结果。
```

一个或多个条目采用同一语法。每个 YAML items 成员必须对应一个顶层二级标题 `## [ID] 标题`，ID 在头部和条目标题各出现一次。标题是条目标题的唯一来源，不在元数据重复存 title。正文到下一个顶层二级标题或 EOF；三级标题是业务章节。一级标题、前言、普通附录不变成需求。

按 Markdown AST 识别条目，不对全文用正则拆分；代码、引用、列表里的假标题不创建条目。每类必要章节固定，正文内容可自由使用表格、列表、例子和更深标题，额外三级章节保留；未知业务信息可明确写未记录，不为填模板造事实。

UTF-8 读取可接受 BOM、LF、CRLF。YAML 只允许 JSON 兼容值，禁止重复键、自定义标签、锚点／别名、合并键和可执行解释；日期写字符串。核心字段闭合，未知字段不猜别名，扩展只进 extensions。读取方须逐条降级，不能一项错误隐藏整份可用资料。

通用元数据：`id`、`type` 必填；`links: Link[]`、`sources: SourceRef[]`、`extensions: object` 可选。ID 为 1–96 位 ASCII 字母／数字及 `._-`，首字符为字母或数字。类型只取下表九项；前缀只是建议，不替代 type。

## 3. 条目类型及固定字段

### 3.1 project、goal、module、requirement、design

| type | 特有字段 | 必要三级章节 |
|---|---|---|
| project | inventory 必填：`{state: partial或reconciled, checked_sources: SourceRef[], unreviewed_sources: SourceRef[], note?: string}` | 项目定位；盘点范围与未核对项 |
| goal | scope 必填；task_bindings 可选 | 目标说明；范围边界 |
| module | scope 必填 | 可选分类／导航；范围边界，不作为交付评估对象 |
| requirement | scope 必填；assessment_id 为可选 ID／null；task_bindings 可选 | 需求内容；范围边界；验收要求 |
| design | intent_state 必填：proposed／adopted／retired | 设计方案；约束与取舍；实际实现与差异 |

scope 为 current／planned／candidate／retired，不含 done。已交付要求仍可 current；retired 不计为开发完成。inventory.reconciled 只指列出的来源已经对账，要求 checked_sources 非空、unreviewed_sources 为空；无精确摘要时仍显示版本未知，不宣称范围外没有需求。

design.adopted 是采用的目标方案，不是代码状态。正文中的用户约束仍按实际来源有效。requirement.assessment_id 只选择展示入口，不证明摘要适用于当前实现；不按时间自动挑选另一条摘要。

### 3.2 change

必填：`recorded_at: string`；`basis: {kind: user|delegated|document-edit, text: string, sources?: SourceRef[]}`；`deltas: {target: item_id, before: string|null, after: string|null, note?: string}[]`，非空。

必要章节：变更说明；影响与未同步项。before 为 null 时说明此前不存在还是旧意不可得。target 可是 plan；涉及工作项时在 note 指明其稳定 ID，不把计划调整强行解释为需求变更。先保存 change 不证明所有正文已同步。小排版不强制建 change；变化种类不形成封闭审批清单。

### 3.3 assessment

| 字段 | 规则 |
|---|---|
| target | 必填，requirement ID。 |
| target_basis | 必填，定位被评估需求材料的文件 SourceRef；旧内容不可得则保留原引用并诊断。 |
| target_definition_sha256 | 必填，计算摘要或 null；算法见第 7 节。 |
| checked_at | 必填字符串，实际对账时间，不是扫描时间。 |
| subject | 必填对象：kind 为 working-copy／commit／release／unknown，value 为字符串或 null；unknown 合法，不能假装工作副本标签是精确代码快照。 |
| implementation | 必填：unknown／none-reported／partial-reported／delivered-reported。 |
| verification | 必填：unknown／not-run-reported／failure-reported／pass-reported／mixed-reported。 |
| pending_sources | 可选 SourceRef 数组；已取得但尚未纳入该摘要的相关新材料，不能被旧 PASS 遮蔽。 |

必要章节：覆盖范围；交付与验证依据；剩余与待核对。原始报告通过通用 sources 引用；非 unknown 标签须有对应来源和准确范围，没有材料不能写 none-reported／not-run-reported。

新增反证后可先登记 pending_sources，再在同次或后续授权维护中对账；登记了待核对不等于结论已更新。不同实现版本或不同输入范围的结果应分开解释，不把它们机械混成同一对象的 mixed。实质结论变化保留旧依据；可创建新 assessment 并调整入口，重复读取不自动追加。

### 3.4 discussion

必填：`raw_ref` 为带实际 sha256 的文件 SourceRef；`submitted_at: string`；`origin: {channel: chat|codex|other|unknown, locator?: string, occurred_at?: string|null}`；`record_state: active|archived`。

必要章节：整理摘要；议题与未决问题。可以先写原文已保存、尚未整理。用户上传的实际字节原样保留；粘贴文本按收到的文本保存为 UTF-8，不声称取得平台完整导出。只有链接且未取得正文时，保留链接来源但不建立正文已归档的 discussion。

推断关联用 discusses，保留来源片段。确认关联不采纳观点；采纳具体观点时更新正式需求／设计并记录依据，原 discussion 不转换类型。原文和摘要均需纳入用户实际的隐私／共享策略。

## 4. 项目实施计划 plan

项目 plan 与 Runtime prepare 返回的 task plan 完全不同。本条目只描述工作安排，不维护 task 生命周期或任务完成资格。

| 字段 | 必填／类型 | 规则 |
|---|---|---|
| intent_state | 是／proposed、adopted、retired | 候选不自动成为当前安排；采用项目计划不自动采用其中各 task。 |
| targets | 是／非空数组 | 每项 `{target: goal或requirement的ID, coverage: 非空文本}`；计划覆盖哪些业务范围。 |
| work_items | 是／数组，可空 | 工作项；空数组表示尚未分解，不能宣称计划已经完整。 |

必要章节：实施策略；阶段与工作项说明；调整与未决事项。

每个 WorkItem 的固定字段：

| 字段 | 必填／类型 | 规则 |
|---|---|---|
| id | 是／稳定 ID | 在 plan 内唯一，插入工作不重编号。完整身份为 `(plan_id, work_item_id)`。 |
| title | 是／非空文本 | 工作项没有独立条目标题，名称以此字段为准。 |
| outcome | 是／非空文本 | 预期交付什么；不是已经完成的声明。 |
| scope | 是／非空文本 | 本工作项覆盖与排除的范围，不复制完整需求正文。 |
| targets | 是／数组 | 同 plan.targets 的结构；可空但显示业务归属待明确，不虚构目标。应在所属计划范围内，偏差诊断而不删数据。 |
| state | 是／included、deferred、withdrawn | 仅表示当前计划成员安排，不含执行状态。历史已完成工作可仍 included。 |
| origin | 是／initial、added、unknown | 是否原定工作；旧安排不可得时 unknown，不编造原计划。 |
| stage | 否／文本 | 展示分组，不创建阶段状态机。 |
| depends_on | 否／数组 | 每项含 item_id、kind、reason；kind 为 order／prerequisite，reason 为非空文本；首版同 plan 内。order 为安排，prerequisite 为声明的工程前提，两者都不是 Runtime gate。 |
| replaces | 否／工作项 ID 数组 | 同计划拆分／合并／替代去向；旧项保留 withdrawn，不静默重用身份。 |
| sources | 否／SourceRef 数组 | 原计划、插入依据及必要历史。added 应能说明来由，缺来源显示依据不足。 |

数组顺序用于展示；没有显式依赖时不能从顺序推断因果或强制串行，也不能据此声称已确认可并行。环、悬空、withdrawn 前置项都要诊断，但仍显示原安排。计划不能用“前项 task 已关闭”证明实际工程前提满足。

work item 不必立即有 task，也不强制永久一对一。task 创建后，关联只保存在相关 goal／requirement 的 TaskBinding，plan 的工作项反向计算任务列表；不在 plan 再保存 task ID 数组或任务状态副本。没有项目计划的直接 task 关联完全合法。

### 4.1 业务范围与规划的消费规则

预先规划、持续选取、混合是使用策略，不是新字段或 Runtime 模式。无 plan 的项目同样展示已读到的完整业务范围，包括 current／planned／candidate／retired、已交付要求、无 task／无工作项的要求和共享约束；条目的阅读顺序不代表实施顺序。需要持久保存的动态选取结论、来源及未决项可写在 project 正文，消费者原样展示，不自行从正文计算语义上的剩余待办或另建权威 backlog。已有适用 plan 时，同一结论只在该 plan 维护，不要求复制到 project。

调用者明确选定某 plan 时，展示该条目的 targets、intent_state、正文及 work_items 的原数组顺序、stage、范围和覆盖；不要拓扑排序后冒充原安排，也不把阶段转成完成状态。plan_tasks 只是按 `(plan_id, work_item_id)` 反查绑定的辅助结果，不能代替工作项元数据或完整需求。跨阶段需求可由多个工作项分别表达覆盖，不给该需求分配唯一实施或完成名次。

多个 plan 分别展示各自范围和 proposed／adopted／retired 状态。adopted 不等于唯一全项目当前计划；选定来自当前调用者的明确范围或选择，不从修改时间、文件名、数组首项或最新候选推断，也不自动合并计划。没有直接工作项／TaskBinding 关联只表示没有该关系，不能断言业务遗漏；覆盖仍需读取目标、需求、计划正文及范围化依据核对。

复用 read 的 `detail: items` 获取完整原文和定位；默认摘要不含 body，不能以此断言没有动态选取结论。离线样例输出 items 的 body 与 metadata，不调用模型、Runtime 或 journal。coverage.complete 只表示本次选定路径的枚举与字节读取，须同时保留 paths、omitted 及诊断；read 另保留 selection，离线样例默认读取入口登记范围。局部读取完整不等于全项目已盘点。结构不可用或未读到的范围保持未知，task 关闭、已有绑定、旧 PASS 及摘要无变化均不升级为当前完整覆盖／交付。

随安装包的 examples/e6 演示预先规划及插入修复，examples/planning/no-plan 与 examples/planning/multiple-plans 演示持续选取、混合、多计划和跨阶段消费。它们是虚构的离线输入；消费测试验证原文、关系、顺序和读取边界，不证明宿主 Agent 的语义判断或 TraceLens 页面已实现。

## 5. TaskRef、PlanItemRef 与 TaskBinding

### 5.1 TaskRef

```yaml
task_id: null
source:
  kind: file
  path: TASKS/legacy-import.md
  section: 导入脚本实施
label: E6A
```

必填字段：`task_id: 非空字符串|null`、`source: SourceRef`。可选：`label`、`plan_ref`、`step_id`，均为非空字符串。task_id／plan_ref 是既有服务返回或可靠历史资料中的原值，不能施加新的 UUID 规则，也不能用显示编号猜身份。无稳定 ID 的历史引用允许 null，只按具体来源定位并显示身份未确认，不分配假 task。

plan_ref 是 Runtime 某次候选／采用计划的原引用；step_id 用于原 task 内步骤，不表示独立 task。source 可引用保存的原始记录或文档；定位不到时保留而不触发修复 Runtime。工作副本之间不自动拼接。

### 5.2 TaskBinding

绑定仅放在 goal／requirement 元数据的 `task_bindings` 数组；该条目即业务关联目标，不重复写 owner ID。

| 字段 | 必填／类型 | 规则 |
|---|---|---|
| id | 是／条目内稳定 ID | 用于幂等和纠正；不同业务范围可分别关联同一 task。 |
| task | 是／TaskRef | 真实 task 或可定位历史来源。 |
| role | 是 | implementation／repair／verification／exploration／reference；角色属于关联，不是整个 task 的固定类型。 |
| coverage | 是／非空文本 | 与 owner 对应的具体工作范围。 |
| origin | 是／declared、inferred | 推断不是执行授权，也不等于任务实际完成。 |
| state | 是／active、dismissed | dismissed 不进有效关联，保留理由以免重试复活。 |
| reason | 条件必填／文本 | inferred、dismissed 必填。 |
| sources | 否／SourceRef 数组 | inferred 必须非空；明确关联也应保留已有依据。 |
| plan_items | 否／数组 | `{plan_id, work_item_id}`；允许多个，默认空。不是 Runtime plan_ref。 |
| repairs | 否／数组 | `{task: TaskRef, coverage: 文本, sources: SourceRef[]}`；关联被修复的历史工作或范围，不认证缺陷引入者。 |

同一 task 服务多个需求时，在各 owner 下保存各自覆盖关系；不另外写中央绑定库。去重参考 owner、真实 task 身份／明确来源、角色和覆盖范围，最终判断范围等价可由 Agent 完成，程序不能凭同名合并。重试需先检查现有记录；task 已创建而绑定写失败，只补绑定，不能重新 prepare。

retired owner 可保留历史修复关系，但不能据此宣称它已重新成为 current。当前修复服务于新要求时另建其范围绑定。关联不主动 close、resume、focus、adopt 或 supersede 任一 task。

## 6. 通用来源和条目关系

SourceRef 为三选一，核心字段闭合：

| kind | 字段 |
|---|---|
| file | 必填 path；可选 item_id、section、`lines: {start, end}`（1-based 包含两端）、sha256（64 位小写十六进制）、note |
| uri | 必填 uri；可选 note；仅保存，不自动网络访问 |
| text | 必填 text、label；无法定位到本地文件的已知文字依据，转述不得标成用户逐字原话 |

文件来源须在登记读取范围内。优先定位 item_id 再匹配其内部 section；重复章节、缺失文件、摘要变化或越界都保留原引用并诊断。sha256 是实际文件字节摘要，不是 Git blob ID，不与任意 revision 字符串比较。哈希不能恢复缺失内容。

Link 固定字段：`id, relation, target, origin, state`；可选 `reason, sources`。origin 为 declared／inferred，state 为 active／dismissed；inferred 和 dismissed 必须 reason，inferred 必须非空 sources。target 是本项目条目 ID；跨项目不自动解析。

| relation | 合法方向／语义 |
|---|---|
| part_of | requirement→module；module→module；业务归属 |
| supports | requirement／module→goal；业务支持 |
| addresses | design→requirement；目标方案对应 |
| depends_on | requirement／design→requirement／design；业务或方案依赖，推断仅作候选 |
| replaces、derived_from | goal／module／requirement／design／plan→同类条目；替代或演进，不自动修改目标状态 |
| discusses | discussion→goal／module／requirement／design；无规范约束力的相关性 |
| references | 任意条目→任意条目；普通参考，不升级为强依赖或完成 |

plan.targets、work_items.targets 和 TaskBinding 已有专门结构，不用另一组 links 重复登记同一关系。反向关联由读取方计算。未知关系可先保留 references 和说明，不形成用户目标不可修改的错误。

## 7. 内容版本与历史

格式版本、需求内容依据、task plan 引用和产品发行版本分别处理。用户手动改正文不需要维护计数器或哈希。

文件 SourceRef 摘要结果为 same-bytes／changed／unavailable／unknown，只说明材料读取情况。整文件的其他条目或排版变化，不自动使所有设计、需求或证据失效。

需求定义摘要延续算法名 `vnext-requirement-definition/v1`，不因文档契约升 v2 无故改算法：

1. 提取该 requirement 的二级标题及完整正文至下一顶层二级标题／EOF；CRLF／CR 归一 LF，仅移除末尾连续 LF。
2. 取 declared＋active 的 part_of／supports／depends_on／replaces／derived_from links，仅 `[relation,target]`；去重后按 relation、target ASCII 排序。
3. 固定键序 `{type,id,scope,relations,body}`，紧凑 JSON，非 ASCII 按 UTF-8 输出。
4. 对 `vnext-requirement-definition/v1\n` 与 JSON 的 UTF-8 字节拼接计算 SHA-256。

排除 assessment_id、task_bindings、来源、讨论和 plan 引用；不递归散列整张依赖图。不能因为加一条修复关联或更新摘要入口而制造需求范围变化。正文排版仍可能影响摘要，只提示核对，不自动判定语义变化。

assessment.target_basis 指向当时需求材料，必要时在 capture_paths 中保存一次可恢复来源。原件完整性与当前需求定义对齐分别核对；history 不作为当前条目扫描。没有旧原件则保持历史可核验性未知，不因为存了哈希就声称验证过。

新增失败即使两个摘要都未变，也须通过 pending_sources 或新的范围化 assessment 纳入。恢复旧需求文字不证明当前代码恢复。历史可以复用已有精确版本或受影响材料，不默认每次复制全项目、不要求先 Git 提交。

## 8. 读写、降级及幂等

读取结果至少包含 usable_items、原文定位、覆盖范围、diagnostics、工作副本标识和读取时间。反向关系和任务状态解释不是新的权威文件。不支持的版本退回原文；唯一 ID 不明时不取最新文件获胜。任务编号提及不能自动创建 TaskBinding。

写入输入必须带明确路径、候选内容及已读取版本依据；新建必须检查目标确实不存在。程序只校验格式、范围和实际写入结果，不签发业务批准。生成或修改的条目应合法；若同文件已有其他坏条目，保留其原字节、只校验本次影响，不借机修复／删除，报告整文件仍部分可读。

整文件候选和局部更新共用 old→next 身份、版本、历史及实际落点检查。整文件的受影响条目同时比较解码内容、YAML 映射原文和结构诊断，不能因同值重复键或锚点的解码结果未变而跳过校验；允许合法修复选中坏字段及语法。无关坏条目的 YAML 和正文原字节保留，前项修改造成的绝对行号或 items 序号变化不算该坏项修改。普通更新不能重用同 ID 的 type，删除旧身份必须明确声明本次实际删除对象，拆合后的新身份不自动继承旧交付。API 的 remove_items／remove_relations 只是精确删除输入，不是批准、force 或新的文档字段；详细请求见随软件安装的 API。

局部 body 必须完整位于选中条目的根二级标题下。真实新增二级边界、吞掉相邻条目的结构在保存前拒绝；三级业务章节和代码／引用／列表的伪标题合法，正常文件附录仍可存在。正文里的明确用户限制不因手工写进附录就失去效力，宿主需报告并在既有授权内定位维护。

来源集合比较仅用于 dismissed 恢复保护：换序、重复来源、对象键顺序、来源显示信息或理由改写不构成新依据；不排序计划工作项等有展示顺序的数组。当前用户明确改变原决定可作为 text 来源，不要求另找外部材料或重复确认。宿主判断业务效力并保留旧否定及本次决定；缺省重试保留 dismissed，同目标同关系或真实 task／角色／精确范围的等价 ID 替换也不能绕过。明确删除仍有合法路径，不建立跨任意编辑的语义墓碑系统。

历史比较只使用 SourceRef 各类型的已知依据字段；清理未知字段（包括 lines 的未知成员）不构成新依据。恢复检查针对实际新增激活、dismissed→active 或关联身份改变；既有且仍为同一身份的 active 关系不因修改 scope、assessment_id 或说明而重新审批。未改 links／task_bindings 不重新触发恢复检查；既有 active ID 重复仍保留原值和诊断。关系字段实际变化时逐份匹配旧 active 记录，重复 ID 不能掩盖新增激活或旧 dismissed 的恢复。

同 ID 的既有 active 行也不能替代被删除的 dismissed 历史行；应保留该历史、按新依据实际恢复，或使用既有精确字段／关系删除声明。重复诊断不变成普通字段维护的前置条件。

dismissed 历史也逐份匹配同 ID／关联身份及数量，一条保留记录不能抵消另一关联或第二份相同记录的丢失。既有唯一 ID 的身份纠正仍可维护；重复 ID 的不同关联按实际身份区分。恢复已有身份时只比较该身份的否定依据，不能用共享 ID 的另一关联误挡当前明确决定。remove_relations 声明候选中实际删除的旧行，即使同 ID 的另一行仍保留也可合法保存；没有实际删除的声明不生效，声明不绕过重新关联的新依据检查。

追加只在原 YAML 序列和正文边界插入新内容，保留既有映射、注释、缩进及坏邻项正文的每个原始字节，不重排整序列。条目之间的分隔空行由写入器负责，局部正文替换和批量追加共用这一规则；闭合 HTML 等合法正文不依赖用户手工补末尾空行。解析范围包含分隔符时，仅本次局部追加在原 EOF 之后生成的确定性分隔行可以作为旧条目范围的新增后缀，不算修改旧正文；原正文、坏元数据映射、需求定义摘要及正文越界保护仍分别核对。此例外不接受候选中任意改写旧空白或业务内容，也不对整文件候选开放历史保护绕过。

旧来源或关系数组的空值／坏成员不阻止已有授权的合法修复及精确删除；历史比较保留可比较的旧依据，坏成员本身不算新依据。修改后的选中条目仍须合法，无关坏条目及原文保留。具体文件路径实际为目录时属于未读取的文件；glob 的遍历目录不因此成为遗漏，目录裁剪沿用完整路径匹配的 `*`／`**`／`?` 语义。

使用临时文件和单文件安全发布，写前重新核对已读字节，检测到并发变化则不覆盖；保留必要 preimage。不能声称普通检查＋rename 对所有外部编辑器构成严格 CAS；跨文件不承诺事务。自己的并发写可用短 I/O 协调，但锁不能影响项目开发、读取或保存其他材料。

原文保存、规范保存、task 管理操作、绑定及对账分别报告。重试先读已有产物，不能重跑业务命令、分配重复 task、复制原文或复活 dismissed。读取、打开页面和无变化核对不生成记录。

解析有字节／文件数限制时显式报告未覆盖部分，不默默裁剪后宣称全量。无旧快照时失败不等于空项目；保留旧结果时标出旧时间，不能把旧条目混装成新的完整状态。

coverage.complete 只指本次明确 managed 路径范围的枚举和字节读取。明确文件／选中 entry 缺失、相关目录不可达、相关 junction 跳过和预算耗尽都列入 omitted；遗漏可为已知目录或模式，不能虚构其中的文件数。一个遗漏不停止其他独立可读路径。有效目录枚举成功但 glob 零匹配可为完整空结果；排除和未选范围不在本次完整声明内。坏条目可以字节读完但结构部分不可用，分别看 usable／invalid 和 diagnostics。业务盘点只按 inventory 所列来源，交付另按 assessment 的对象、范围和依据解释；source_paths 仍只是引用许可，不全量扫描。

## 9. 兼容与职责边界

旧 v1 可只读：其八类条目沿用本契约相应字段和语义，不包含 plan、task_bindings、pending_sources 或 capture_paths。v1 的两种 schema 标记仍保持 v1；没有字段不能推定支持新增能力。要写入 v2 特性时，仅在既有授权涵盖时迁移相关文件／入口，保留原内容，不强制全项目一次迁移。v2 入口可登记 v1 来源／旧托管文件，读取按每份文件版本，不把 v2 字段静默写进 v1。

JSON Schema、AST 章节规则、跨对象语义和样例共同构成契约。Schema 是第一步，不证明来源真实、模型关联正确或业务完成；实现时生成并安装 v1／v2 所需格式说明和结构校验资产。

TraceLens 只扫描规范文档和明确来源。Markdown 不执行 HTML／MDX／脚本，不加载远程资源；文件和 URI 导航做边界及协议检查。正常 task 状态仍由 vNext 既有服务计算，TraceLens 只能展示文档报告性质的状态，不能把绑定存在、计划 adopted 或来源无变化解释为实时完成。

### 9.1 当前维护与消费澄清（保持 v2）

v2 的实施工作项展示顺序保存在 plan.work_items 数组；它只表达该 plan 的安排，不再作为项目需求全景的排序依据。v1／v2 没有项目级需求顺序时，需求进入“未指定顺序”入口，不能从 plan、文件名或正文猜出项目顺序。第 10 节的 v3 使用 project.requirement_order 独立登记。project 正文仍可保存选取结论。B、A、C 的工作项数组允许 A 已交付；计划重排不改变需求顺序、历史日期、TaskBinding、assessment 或实际 task 生命周期。必要 change 以实际变更的 plan 或 project 为 target，保留先前安排和当前依据。

当前明确决定可用准确标注的 text SourceRef 记录，不要求先保存整段聊天或创建 discussion。历史整理沿用真实 task_id，未知则 null 加可定位 source；重要旧变化的 recorded_at 是本次实际记录时间，旧发生时间不明在正文说明。已有范围化交付报告不因缺全量新测试消失，也不覆盖新增范围。

默认扫描排除仍适用于显式文件及 glob：.git、node_modules、.next、dist、build 路径段，以及 .workflow-system/runtime/ 和 .workflow-system/records/ 内。选定范围遇到这些隐含排除时报告 IMPLICIT_PATH_EXCLUDED 和 coverage.omitted，complete=false，不读取其中内容；用户明确 exclude_paths 的范围和未选范围不计遗漏。可以在已有授权内调整当前文档位置／登记，或明确缩小读取范围；单个只读历史来源仍按 source_paths 的明确引用读取，.git 与路径安全限制不变。

## 10. VN-01 最小增量：目标、需求顺序与范围化报告

本节是 VN-03 和 TL-02 的共同实施输入。共用输入与逐项预期见[范围化契约样例](examples/scoped-contract.md)，有限验收见[VN-01／VN-02 验收记录](../../ops/vnext-contracts-vn01-vn02-validation.md)。不建立第二份需求库、全局完成状态或 Task 门槛。

修订 0.3.2（2026-10-11）：在 0.3.1 五项修订基础上，澄清同定位的不完整报告及已替代异常报告的消费方式，保留目标整体摘要的首版保守取舍。随后 VN-03 按此契约实现源码与本地产物，未改变本节业务规则；验证与限制见[VN-03 交付记录](../../ops/vnext-vn03-product-validation.md)。

本节字段、摘要与选择规则约束生产工具和只读消费者处理已保存材料，不要求宿主 AI 手工执行摘要或选择算法。AI 负责在授权内理解业务、说明适用范围、证据与未知；机器可读及摘要匹配都不认证判断正确。后续审查遵循[定稿方案 7.1.1 节](../../ops/TraceLens与vNext_目标需求管理及可视化完整方案.md#711-后续契约与-ai-指导审查原则2026-10-11-补充)。

### 10.1 格式与最小字段

采用新文档标识 `vnext-product-doc/v3`，因为 v2 的核心字段和 Link／Subject 都是闭合结构；不能把新增字段塞入 v2 或借 extensions 改变核心语义。Manifest 没有新增字段，继续使用 `vnext-product-manifest/v2`；VN-03 使其可登记 v1／v2／v3 文件，并按每份文件标识解析。源码及本地产物已实现，完整分发安装由 VN-05 验证。

除下表增量外，沿用第 1–9 节的 ID、Markdown 章节、来源、TaskBinding、计划和安全规则。新增字段不取代条目正文。

| 所在对象 | 字段与类型 | 必填性与含义 |
| --- | --- | --- |
| project | `root_goal_id: ID或null` | 可选；缺失／null 表示总目标未指定。非空时必须指向唯一可读的 current goal。 |
| project | `requirement_order: ID[]` | 可选；默认空，元素必须是需求 ID，保存全项目当前登记顺序，含退出当前范围的历史位置。重复或悬空引用诊断。 |
| goal | `goal_kind: outcome或stage` | 可选，默认 outcome；stage 仅在项目确实约定阶段时使用，不生成阶段号或推断时序。 |
| goal | `assessment_scopes: {target: ID, scope_id: ID, coverage: 非空文本}[]` | v3 可选，默认空；该目标当前采用的评估范围声明。target 指唯一 requirement 或该 goal 本身，(target,scope_id) 在本目标内唯一。不复制需求正文或结果，数组顺序不表示实施安排。 |
| Link | 扩展 `part_of` 的合法方向 | 另允许 goal→goal、requirement→requirement；仍为子→父，原 requirement→module、module→module 保留。 |
| Link | 扩展 `supports` 的合法方向 | 另允许 goal→goal；是支撑，不等同组成，不能据此声称支撑集合覆盖全部目标。 |
| assessment | `target: ID` | 必填，扩展为 requirement 或 goal；同一报告只评估一个对象。 |
| assessment | `applicability: {goal_id: ID, scope_id: ID, coverage: 非空文本}` | v3 必填；goal_id 指适用目标，scope_id 是该 target＋goal 下稳定的约定范围身份，coverage 说明包括／排除。目标报告的 goal_id 必须等于 target。 |
| assessment | `target_definition_algorithm: 非空字符串` | v3 必填，记录当时目标／需求定义实际使用的摘要算法；已知算法见 10.5，不从当前文件标识猜历史算法。 |
| assessment | `goal_basis: file SourceRef`、`goal_definition_algorithm: 非空字符串`、`goal_definition_sha256: SHA-256或null` | v3 必填，定位评估时的 applicability.goal_id 定义及当前范围声明；当前 v3 goal 使用 vnext-product-definition/v1。目标自评时这组依据须与 target 一致。 |
| assessment | `conclusion: satisfied或partially-satisfied或not-satisfied或undetermined` | v3 必填；依次展示“已满足／部分满足／未满足／尚未判定”。不能由 implementation、verification 或 Task 状态转换得到。 |
| assessment | `supersedes: ID[]` | 可选，默认空；明确替代同一结论定位下的旧 assessment，不删除旧报告，不凭 checked_at 替代。 |
| assessment.subject | 既有 `kind`、`value`；新增 `revision?: 非空文本`、`limitations?: 非空文本` | kind 仍为 working-copy／commit／release／unknown。revision 是实际被评估版本依据，不要求创建提交；精确对象未知时保留限制。 |

assessment 保留 target_basis、target_definition_sha256、checked_at、implementation、verification、pending_sources、sources 和三个必要章节。target_basis.item_id 必须等于 target，goal_basis.item_id 必须等于 applicability.goal_id；两者指评估时的定义材料，缺少可恢复旧材料仍需诊断。sources 保存交付、验证及结论依据，checked_at 用带时区的实际评估时间，不是扫描时间。非 undetermined 结论须有非空 sources 和正文中的适用证据；它们存在也不证明证据充分，业务判断由已授权评估完成。

需求定义只保存要求和验收，不在正文或 assessment_id 中复制当前结果。assessment 必须放在独立托管报告文件，避免正常结果维护改动定义文件的字节。报告正文的“覆盖范围／交付与验证依据／剩余与待核对”分别保留已确认成果、明确缺口和未知；新字段不要求机器验收项或 KPI。

### 10.2 总目标与当前关系

总目标仅从唯一 project 的 root_goal_id 选择。未指定时显示项目定位和 `ROOT_GOAL_UNSPECIFIED`；找不到、重复身份、类型不符或非 current 时分别报告未解析／身份冲突／无效，均不从 current goals、文件顺序、修改时间或图的无入边节点补选。多个 project 使项目入口冲突，也不选第一个。可读的目标与需求继续可见。

只将 declared＋active 且端点唯一、类型合法的关系用于已声明当前图。inferred 保留为候选，dismissed 为历史。part_of 表示当前细化或组成，supports 表示支撑，depends_on 是单独的局部依赖；replaces／derived_from 只进演变视图。循环、自关联、悬空和跨类型错误保留来源并诊断，异常边不冒充有效层次；合法的多父／多目标关系保留同一需求身份。

declared 表示当前规范明确记录、有可追溯依据的关系，不要求用户亲口填写内部 ID 或逐边确认。用户已采用的层级、正式源材料明确表达的关系，或当前授权明确涵盖且不改变业务范围的既有内容归类，可以由宿主分配／复用 ID 后保存 declared＋active，并保留实际来源；Agent 转述须标为转述，不能冒称用户原话。只请求盘点／比较时的新推断、冲突或依据不足的归属仍是 inferred 或未决。不得全库 inferred→declared，也不得把 Agent 整理的关系永久限定为 inferred；旧否定仍按已有来源与重关联规则保留。关系采用不证明交付、验证或业务执行授权。

有独立业务范围、需核对达成情况的上层能力默认使用父 requirement，具体功能或质量义务使用子 requirement，以子→父 part_of 组成；纯导航分类才可使用 module，module 不是必经层或交付评估对象。平台、原始章节、编号及简单描述／例子／验收条件可留在 sources、extensions 或正文。需要独立展开、关联或评估的明确功能应有独立 requirement；不机械将每个编号对象化。组织已采用范围可建立必要结构身份，但不能借新父项增加指标、设备覆盖、架构前提或其他业务承诺；共享内容保留一份身份和当前正文。

已采用且需要被当前图使用的结构必须通过稳定条目和核心 links 保存。extensions、正文分类或编号映射只能补充解释，不能代替组成／支撑关系，也不为每个祖先机械复制直接 supports。新增、细化、变更或采用归类时，在同一授权维护过程中处理受影响定义、关系、来源和新身份顺序；具体方法见安装 references/update.md。“同次”允许多次 helper、各文件独立保存，成功结果保留，冲突后只补未保存部分，不重复 Task／业务操作。

维护结束用实际 read/check、受影响原条目及 product_view.current_relations 回读本次采用的路径，分别说明正式关系、候选、未归属／未保存和只留正文的细项。格式合法、分类字段存在或文件 saved 都不证明结构已交付；无可靠归属本身不是坏文档，也不阻塞 Task。此核对针对本次采用关系，不新增永久期望关系库、完整性认证或后台同步。

补充子需求时父项默认保留原 scope 和身份。真实替代须同时保留新项 replaces→旧项、明确旧项退出哪些范围的依据，并实际更新旧项 scope 或适用关系。replaces 本身不退休旧项；旧项只退出一个目标时可以仍为 current，调整该目标的关系而不删掉其他目标的支撑。未同步部分显示待维护，不自动修正文档。

### 10.3 唯一项目级需求顺序

初次登记按本次采用的拆分顺序写入 project.requirement_order；以后每批按本批明确顺序追加，仅追加尚未登记的 ID。新增依赖、工作项、Task、改名、正文或报告更新均不重排已有 ID。只有用户明确采用重排时才更新该数组，并记录 change 的 project 目标、旧／新顺序与依据；重排后的列表称“当前登记顺序”，不声称历史创建顺序。

父子展开只是视图组织；不能为使已有子项紧邻新增父项而重排登记数组。完整当前范围包含已采用但较后实施、尚无 Task 的能力，不按 Task 清单截断要求或降为候选。

消费者按登记数组去重展示可唯一定位的需求；重复、非 requirement、悬空或身份冲突的引用逐项诊断，不隐藏其他需求。所有未被有效登记的可读需求保留“未指定顺序”入口；该入口可以为定位采用标明非业务排序的 ID 排序，但不能将其附加成已登记业务顺序。筛选目标／scope 后只取原列表子序列；retired 被筛选隐藏时仍保留其位置和来源，不重编号。工作项顺序继续只服务 plan。

### 10.4 结论定位与选择

一次选择使用 `(target, goal_id, scope_id, subject)`，并在同一 project 和已登记工作副本内进行。**当前 scope_id 只能来自所选 goal.assessment_scopes，不从评估报告反推当前范围。**选中 target 在该 goal 下只有一份声明时可采用其 scope_id；有多份时列出原声明供明确选择，未选显示 undetermined／scope-selection-required，不挑首项或最新报告。无声明、旧 goal 尚不能表达声明或 goal 身份／读取不明时显示 scope-unavailable；重复键、坏引用及不合法类型显示 conflict。这些缺口只影响展示。

coverage 是范围解释，不是前端语义表达式；报告文本与当前声明仅归一换行后逐字比较。已选 scope_id 不在当前声明中时为 scope-not-current；在但 coverage 不同时为 scope-definition-changed，均不能称当前满足。文字澄清保留身份、记录依据并重新核对报告，实质范围改变新建 scope_id 并更新当前声明；退出范围从声明数组移出并保留 change／历史，旧报告继续可读。历史入口可明确选择报告自己的旧范围，但必须标成历史陈述，不能越过当前声明规则冒充当前结论。

评估范围声明不自动创建 supports、part_of 或 TaskBinding。声明的登记是维护行为，不是评估已经完成；无报告仍未知。正文或声明变化后的 hash 诊断只提示核对，不自动判断该变化的业务效力。当前首版对所选目标整体定义作保守核对：新增另一条范围声明也会使同目标的旧报告待核对，保留其成果，不以此生成目标版本或 Task。

subject 的 kind＋value＋revision（缺失按 null）精确匹配，不把 commit、release 和工作副本标签自动换算为同一对象。commit.value 为实际完整提交身份，release.value 为实际发布身份；working-copy.value 为登记时绑定到该副本的标识，不能跨 root 复用结果。工作副本未固定 revision 时必须写 limitations，消费者只在用户明确查看这个已报告对象时展示，不自动称为实时工作副本结论。unknown 或 value=null 仅提供可读历史材料，不能自动匹配已知对象。

选择按以下顺序执行，结果的 reason 是展示诊断，不是持久化状态机：

1. 先解析唯一可读的 goal 和其当前范围声明，按上述规则得到 scope_id 或具体缺口。保留可读报告及原引用。完整结论定位精确相同才形成候选；定位明确但缺新依据等必需元数据的报告仍在该选择中保留为不完整候选，不能静默排除后只显示旧报告。缺 applicability、对象不明或格式不支持而无法精确定位的报告进入待核对列表，不能用正文猜范围或让其影响任意其他选择。完整字段但旧依据不可读的报告按第 5 步处理；未选范围／对象的报告继续在历史入口可读。
2. 仅对精确定位的候选应用显式 supersedes，只有同定位、旧报告存在且无循环的替代边才生效。先保留合法替代结果；已被合法替代的旧报告及其异常边留作历史诊断，不继续使当前选择冲突。未被替代候选的跨目标／范围／对象替代、缺目标或循环，使**发出非法声明的候选所属选择**显示 undetermined／conflict，保留候选及异常边。被它指向的其他选择不删除、不被连带降级；不能用非法边或循环冒充合法修正。不同 coverage 的未替代候选仍待核对，不自动合并。
3. 无适用候选显示 undetermined，reason=`no-applicable-report`。同定位的未替代不完整候选使当前选择为 undetermined／metadata-incomplete，即使同时存在完整旧报告也保留该缺口；多个候选等其他诊断一并保留。不能变成未满足或零成果。
4. 当前必需元数据、coverage 和两份定义依据只核对未被合法替代的候选；旧报告已过时的依据／文字作为历史诊断，不让它重新阻止有效替代。多个未被替代报告一律待核对，reason=`multiple-reports`，即使结论标签相同；首版不自动合并证据，也不按时间选最新。同定位不完整候选按第 3 步保留缺口，删除必需字段不能比填写 null 获得更确定的结论。单个有效报告才提供其 conclusion。
5. 对选中报告分别核对 target 与 goal 的当前定义。按报告保存的算法及旧依据版本核对算法身份，再与当前定义比较：target 摘要不同为 definition-changed，goal 摘要不同为 goal-definition-changed；任一摘要为 null、旧定义不可恢复或算法无法解释分别为 definition-unverified／goal-definition-unverified。文件升级导致算法不同且未重新核对时为 definition-algorithm-changed，不把跨算法数值不同冒充业务变化。有 pending_sources 为 pending-evidence。所有缺口分别保留，不由单个 reason 遮盖其他诊断；当前标签为 undetermined，原报告结论、成果和明确缺口仍是可读历史，不撤销交付、强制补测试或阻止 Task。

四值标签只针对该范围：partially-satisfied 需要明确已满足部分和明确未满足部分；一部分确定、其余未知时为 undetermined 并保留已知部分。新改进 Task 不自动否定满足报告；新增失败材料也不能被“摘要未变”掩盖。目标层独立使用 goal-targeted assessment，同样按范围与对象选择，不汇总子需求／Task 数量。

### 10.5 定义摘要及旧文档降级

v1／v2 继续采用第 7 节的 `vnext-requirement-definition/v1`，不改写旧摘要。v3 的 requirement 与 goal 使用 `vnext-product-definition/v1`：

1. body 仍按第 7 节提取、归一换行、移除末尾 LF。
2. relations 取 declared＋active 的 part_of／supports／depends_on／replaces／derived_from，仍仅取 `[relation,target]`、去重并按 ASCII 排序；新增合法方向也参与。
3. 紧凑 JSON 固定键序 `{type,id,scope,goal_kind,relations,assessment_scopes,body}`；requirement 的 goal_kind 和 assessment_scopes 均为 null；goal_kind 缺省为 outcome，goal.assessment_scopes 缺省为 []。每个声明仅取 `{target,scope_id,coverage}` 固定键序，coverage 归一换行，声明按 target、scope_id ASCII 排序；重复／坏声明不能算成有效定义。以 `vnext-product-definition/v1\n` 前缀拼接 UTF-8 字节计算 SHA-256。

新报告按实际评估时的定义版本保存算法，不靠后来已被覆盖的文件猜历史版本。v1／v2 requirement 使用 vnext-requirement-definition/v1；v3 requirement 和 goal 使用 vnext-product-definition/v1。读取时当前版本用于计算当前摘要，旧依据用于核对原算法；不识别或不可恢复就保留未核对，不将不同算法直接比较。目标正文或当前范围声明变化会改变 goal 摘要，需求摘要即使未变也不能遮蔽它。goal 自评两组算法／摘要必须一致。仍排除 assessment_id、task_bindings、sources、project.requirement_order 和报告；不递归散列子项或支撑图，不要求每新增需求生成目标版本。声明顺序也不改变需求展示顺序。

旧 assessment_id 仅为历史导航入口；v3 中也不能覆盖多范围选择。v1／v2 报告的 implementation、verification、subject 和正文仍可读，但缺新定位不推断四值结论。**完整 v3 报告可以引用未迁移的 v1／v2 requirement**，使用原 requirement 算法核对；所选 goal 的当前范围声明和目标依据仍须可读，通常仅将相关 goal 所在文件显式迁为 v3 即可，不要求迁移全部需求。旧文件未增加新核心字段，不冒称已升级。

| 报告／定义组合 | 当前结论规则 |
| --- | --- |
| v3 report → v3 requirement ＋ v3 goal 声明 | 两份 v3 定义依据和当前范围匹配才提供 conclusion。 |
| v3 report → v1／v2 requirement ＋ v3 goal 声明 | requirement 按原 v1 算法，goal 按新算法；完整匹配可以提供 conclusion，不强制迁移该 requirement。 |
| v3 report → 仍为 v1／v2 的适用 goal | 原目标可读，但没有当前范围声明，为 scope-unavailable；不从报告补出当前声明。旧 goal 的历史报告不升级成当前结论。 |
| v1／v2 report，或 v3 report 缺必需依据 | 保留历史与具体缺项，当前 metadata-incomplete；不把旧 PASS 转为 satisfied。 |

缺总目标、顺序、报告、新元数据、可用来源、当前定义核对或 PRODUCT 本身，都只影响相应展示和维护。文件字节读取完整、结构合法、定义对齐、业务盘点和交付结论仍是五种不同声明；正常 Task prepare／confirm／execution／close 与这些缺口保持独立。写入器真实并发保护和文件权限保持原规则。
