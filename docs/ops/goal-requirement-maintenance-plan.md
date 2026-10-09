# vNext 目标需求维护改进与交接计划

更新日期：2026-10-10  
状态：本仓库 A–D 必要增量已实施并验证；已获提交与推送授权，未发布（2026-10-09 UTC）
实施者：当前会话中的 AI，可由 GPT 6.1 SOL 或 Astra 接续  
源码勘察基线：`fd088cd8`，软件版本 `0.24.4`

## 工作目标

让用户通过目标、需求、进展、安排和任务关联，看清项目已经做了什么、接下来准备做什么。AI 在讨论和实际工作中持续维护这些记录；实际执行仍以 task 为单位。

需求顺序用于记录和展示，可以插入、重排、延期，也可以把尚未完成的 B 移到已完成的 A 前面。调整展示安排不改变 A 的历史，不强制执行顺序，也不改变任何 task 的生命周期。真实业务前提仍需在相关工作中说明和处理。

本仓库本次负责 vNext 的必要增量改进、验证、软件交付，以及标准文档规范和使用交接材料。TermLink、Lawagent 的实际资料整理分别在各自项目中实施；TraceLens 依据本仓库交付的标准规范完成自己的解析、展示和页面验证。这些外部工作的完成不作为本仓库本轮交付条件。

本文是本仓库的实施路线和接续记录；长期产品语义仍写回现有产品文档，不另建一套 Runtime 管理体系。下述目标项目快照仅作为需求背景和交接依据，不是进入其他仓库实施的任务清单。

当前用户请求覆盖制定和保存计划；后续实施按届时已有效的授权范围连续完成，不把路线图本身当作修改其他项目、执行业务任务、提交、推送或发布的授权。

## 已确认基线

以下是 2026-10-10 的核查快照。实施开始时核对变化，不回退工作区来恢复这个快照。

| 对象 | 已确认情况 | 实施含义 |
|---|---|---|
| workflow-system | 源码、Runtime 包和本地分发包目录的版本声明均为 0.24.4 | 包版本一致不代表本轮产物已经验证 |
| 当前能力 | VPM-01 至 VPM-25 已定义；已有 helper、Skill、格式、样例和历史验证 | 先查实际差距，不把已有能力重复列为新增功能 |
| 当前格式 | 新写入使用 product manifest/doc v2；保留 v1 读取与显式迁移路径 | 优先复用现有格式；确实无法承载必要行为时才评估调整 |
| TermLink | 此前核查目录为 `E:/coding/TermLink-rust-source-resolution-codex`，安装记录为 0.24.4，已有 PRODUCT | 沿用当前身份和整理结果；不默认需要先升级 |
| TermLink 整理快照 | 此前读取为 46 个可用条目、2 条 TaskBinding、无 plan/change；另有未充分整理的历史来源 | 开始时重新读取，不能把旧计数当本轮验收目标 |
| Lawagent | `E:/coding/LawAgent` 安装记录为 0.24.4，无 PRODUCT；另两个工作副本安装较旧版本 | 后续明确实际目标工作副本，不合并不同副本的未提交资料 |
| TraceLens | 当前职责约定为只读；尚未完成其源码与页面现状核查 | 不能预先断言界面缺少哪些实现，不能默认增加写回功能 |
| 本源码仓库 | 无 PRODUCT 和安装式 Runtime 目录，但 assistance 已有 6 个任务，查询显示 TASK-010 仍 active | 使用本文推进本项工作；保留原记录，不为实施计划自动恢复、关闭或修复旧任务 |

本轮规划前已有三项工作区改动，后续实施应先辨认来源并保留：

- `runtime/vnext/dist/product-maintenance.js`
- `runtime/vnext/support/product-maintenance/offline-reader.js`
- `runtime/vnext/support/product-maintenance/examples/e6/docs/product/raw/selected.txt`

## 实施原则

1. 目标和需求保持完整正文，包括已交付部分；进展通过实际结果和范围化说明呈现，不按 task 数量计算完成率。
2. 用户已经明确采用的变化，在已有维护授权内直接落实；讨论中的备选、疑问不自动变成需求。维护当前决定不要求先归档整段聊天。
3. AI 负责选择适用文档、填写必要关联和保存位置。普通新增、重排不要求用户先选择规划策略或回答内部字段问题；确有业务歧义时再聚焦澄清。
4. 一个需求可关联多个 task，一个 task 可关联多个需求；纯维护或探索任务可以没有需求归属。历史任务沿用真实身份，身份不明时保留可定位来源。
5. 目标变化、需求变化、实际交付分别判断。功能已交付不自动证明总体目标达成；同时应利用已有材料给出有用的进展总结，不能无理由长期全部标为未知。
6. 不新增需求审批状态机，不把依赖、展示顺序、文档完整性或维护回执变成执行门槛。现有可选依赖和进展描述继续可用。
7. vNext 维护文档，TraceLens 只读展示。用户通过 AI 调整顺序后由页面重新读取，不在本次默认加入拖动写回或其他文档编辑功能。
8. 不以整理历史为由重开、重建或执行旧 task，不把软件升级等同于业务资料已经整理。资料整理可以使用现有能力先行开展。

## 总体步骤

| 大步骤 | 工作 | 交付物 | 完成判断 |
|---|---|---|---|
| A | 核对实际差距 | 场景与现有能力、证据、缺口的对应记录 | 区分已支持、指引含糊、实际故障和仅资料待整理 |
| B | 实施必要增量 | 最小范围的 Skill、参考文档及必要工具修改 | 每项修改对应 A 中的具体问题；无需修改的能力保留 |
| C | 验证与软件交付 | 增量验证结果、必要分发产物和安装说明 | 源码、产物、安装、Agent 行为分别报告 |
| D | 完善标准规范与交接 | 标准契约、模板、解析样例及项目整理指引 | 目标项目和 TraceLens 的 AI 可据此独立开展工作 |

建议按 A → B → C → D 推进。D 的规范和指引随 B 的实际改动同步完善，交付时核对版本一致性；不必等 C 完成才开始整理说明。A 若确认某能力无需修改，直接复用；没有新软件修改时跳过无必要的构建和升级。真实项目整理、TraceLens 页面接入和后续业务使用由对应项目另行实施，不要求在本仓库等待其完成。

## A 核对实际差距

### A1 复核版本与工作副本

读取适用 AGENTS、冻结约束、Git 状态和本次计划；核对源码、分发及已有安装证据之间的差异。旧任务状态只作为已有事实保留，不能冒认为本项工作的实施进度。真实目标项目的本地指引、工作副本和修改检查写入交接要求，由对应项目实施者在开始工作时执行。

产出：在本文执行记录中保存实际基线、变动及影响。只记录必要摘要，不复制整份 task-status 或产品目录。

### A2 逐场景映射现有能力

| 场景 | 预期行为 | 重点核对 |
|---|---|---|
| 目标增加或口径变化 | 更新受影响目标，保留必要变化依据；未受影响需求保持原样 | 目标正文与需求关联是否同步，是否误把目标变化等同于任务重建 |
| 新增、拆分或修改需求 | 按实际独立范围维护需求，同一需求的实施批次仍可使用多个工作项/task | 是否只记一句摘要，遗漏当前正文、范围或关联 |
| 规划法规导入，发现数据库未准备 | 补出必要准备工作并放在导入之前，说明实际原因；按用户需要表达为需求或该需求下的工作项 | 是否凭空扩建基础设施，是否把展示依赖变成 Runtime 门槛 |
| A 已完成，明确接下来 B、C | 保存 A、B、C 的安排和各自进展 | 无总体 plan 时能否自然保存；机器可解析顺序是否实际落入有序结构 |
| 用户把 B 移到 A 前面 | 保存 B、A、C 的展示顺序，保留 A 的交付历史和原任务状态 | 是否错误要求重开任务、修改发生日期或重复确认 |
| 普通聊天尚在比较 B、C | 保留建议或未决内容；明确采用后在授权内维护对应正文与安排 | 是否把所有讨论自动采纳，或要求整段聊天归档才允许维护决定 |
| 直接 prepare，无项目计划工作项 | 能确认归属时写真实 TaskBinding；不强制建立总体计划 | 当前入口措辞是否导致漏关联；未知归属是否如实保留 |
| 同一需求追加范围，旧 task 已关闭 | 保留旧覆盖，新增 task 服务新范围 | 是否错误继承旧通过结论或重开旧 task |
| task 结束 | 更新有关进展，说明已安排的下一项或提出建议 | 业务下一项与公共 Skill 的 next_route 分开；已有原任务续接优先按实际上下文处理 |
| 旧项目资料整理 | 读取正文并形成业务全貌、关联、适用安排及重要变化 | 是否只做来源登记，未说明用户要求的产出仍缺什么 |
| 保存冲突或重复执行 | 保留已成功部分，只补剩余关联或文档 | 不重复 prepare，不复制需求或变化记录；维护失败不阻止独立工作 |

这些是本轮工作样例，不是新增产品字段、Runtime 状态或每次使用必走的检查表。

### A3 分类并确定修改清单

优先阅读既有 [产品需求](../product/project-maintenance/requirements.md)、[契约](../product/project-maintenance/document-contract.md)、相关 Skill/reference、[规划交付证据](project-planning-evidence/README.md)和必要实现。已有证据按其实际版本及覆盖使用，不自动沿用为本轮通过。

每个场景给出一种处置：已有且适用、需要澄清指引、需要行为验证、已证实工具缺陷、仅目标项目资料待整理。怀疑入口容易漏做时，先尝试代表性场景或说明证据不足，不能直接宣称 Runtime 故障。

产出：问题、依据、影响、最小改动位置及验证办法。A 的完成条件是得到可执行的修改清单，或有依据地确认无需软件修改。

## B 实施必要增量

### B1 维护当前目标与需求

按 A 的具体结果改进更新、讨论采纳和局部同步指引。明确当前目标、需求正文、必要变化及受影响安排如何在一次已授权维护中落地。展示需要结构化顺序时，AI 维护现有 plan/work_items；无顺序展示需要的持续选取仍可沿用 project 正文。避免另建第二份需求正文或权威待办列表。

候选位置：`runtime/vnext/support/product-maintenance/references/update.md`、`discussion.md`、`plan.md` 和 `templates/vnext/skills/maintain-project.SKILL.md.tmpl`。这是核查定位，不表示全部文件必改。

### B2 衔接 task 与进展

按实际缺口完善 prepare 后绑定、执行结果出现后的局部维护，以及 close 后进展与下一项提示。无需总体计划也能关联；task 创建成功但绑定失败时保留真实身份，仅补关联。进展可以引用既有结果和用户确认，不为写摘要重跑完整产品测试。

候选位置：prepare-task、execute-step、close-task 模板，以及 `references/plan.md`、`reconcile.md`。保留现有任务管理和派生前置任务返回语义；“建议下一业务事项”不自动创建、切换或执行 task，也不替换公共 Skill 路由字段。

### B3 补足旧项目整理方法

按 A 的证据完善 inventory 到相关 update/plan/reconcile 的组合。用户要求项目全貌时，逐批处理有用的目标、需求、任务、安排和重要变化，而不是只登记目录。允许未知、冲突和部分整理，但明确还欠哪些用户所需成果；不以 Schema 通过宣布业务整理完成。

候选位置：`references/inventory.md` 和主 Skill 的意图路由。没有必要为 TermLink 的一次性脚本缺口开发通用历史迁移引擎。

### B4 处理实际工具限制并同步说明

仅修 A/B 中已证实影响场景的读写、解析或诊断问题。先尝试现有契约；确需公开格式调整时，写清无法表达的具体内容、兼容策略及消费者影响，再随实际改动同步，不预先指定新版本号。

长期语义改到既有 requirements/contract，使用方法改到 guide，实施结果记录在本文或必要的单份证据文件。避免为每个小步骤新建报告。

B 的完成条件：每项实际修改有明确原因，已有能力未被重复实现，源文件与生成物边界清晰，用户确认的轻量定位保持不变。

## C 验证与软件交付

### C1 选择增量检查

只检查实际改动及受影响依赖。Skill/source 结构受影响时使用现有 source 校验；helper 行为修改时使用聚焦产品测试；任务核心没有改动时不扩大为完整任务管理回归。不要把文案逐句写成字符串测试，不自动执行 `test:workflow-all`。

当前可选脚本包括 `validate:vnext-source`、`test:workflow-vnext-source`、`test:product-maintenance`、`test:product-maintenance:install`。执行前检查脚本已有的构建步骤，避免重复构建。本文列命令不表示这些检查本轮已经通过。

### C2 补必要的 Agent 使用验证

复用已有证据覆盖的部分，在临时项目里验证本次变化或尚无证据的分支。可将“已有 A → 明确 B/C → 重排 → 为 B 准备并绑定 → 追加需求范围”组织成短使用过程，并单独检查旧资料整理是否只停在登记。

由实施 AI 实际读取、判断和操作；不能用脚本预填最终关联后声称验证了模型行为。不要求另起子代理或建立新测试平台。记录使用的模型、材料、实际结果和未覆盖范围；一次通过不保证所有模型永远不漏做。

### C3 生成和交付必要资产

按实际源改动使用既有构建链。产品契约的权威文件是 `docs/product/project-maintenance/document-contract.md`，其 support 副本和模板由 `scripts/product-maintenance-assets.ts` 生成；vNext Skill 来自 `templates/vnext/skills`，由分发构建携带。不能靠手改安装文件或生成副本代替源码修正，也不能假定旧的 `gen:all` 覆盖所有 vNext 资产。

软件有新增交付时，核对必要的产物一致性和隔离安装/升级，验证目标拥有的 PRODUCT、业务正文和历史得到保留。版本处理遵守现有分发规则，不提前指定新发行版本。分别报告源码、构建、隔离安装和 Agent 样例验证结果，不宣称真实项目已经升级、业务资料已经整理或 TraceLens 页面已经验证；没有软件变化时不为完成阶段而升级。

## D 完善标准规范与交接

### D1 核对标准文档规范

复用并按本次实际改动更新现有 [文档契约](../product/project-maintenance/document-contract.md)、生产 Schema、PRODUCT 入口和各类模板。明确目标、需求、进展依据、变化记录、有序工作项、TaskBinding 和来源定位的字段及语义。没有格式变化时不另造一套规范或升级版本。

完成判断：权威契约、生成的 support 副本、Schema 和模板相互一致，能表达本轮确认的记录与展示场景。用户不需要理解内部字段；这些材料面向维护 AI 和读取程序。

### D2 交付 TraceLens 消费说明与样例

以现有 [TraceLens 交接指南](../guides/tracelens-product-documents.md) 为入口，整理可直接交给 TraceLens 项目实施 AI 的材料清单：

- 标准契约、兼容版本说明、Schema、入口及条目模板。
- 独立离线解析器与已有完整样例；按实际缺口补充重排、需求演变、多个 task 关联和未知历史等输入。
- 文档字段到展示信息的映射，以及样例预期的条目、关系和数组顺序；不规定具体页面样式。
- 任务引用与实时任务状态的边界。产品文档提供关联和报告；task/step 的实时读取由 TraceLens 对接既有任务服务，不能从文档或 journal 另造状态计算规则。需要时提供既有 API 的准确入口。
- 缺资料、坏条目、无 plan、身份未知和读取不完整时的显示语义。

完成判断：交接材料能独立读取并解释样例，TraceLens 实施者无需依赖本次聊天猜测格式语义。验证的是规范和样例可消费，不是在本仓库检查或实现 TraceLens 页面。无需等待 TermLink 和 Lawagent 的真实整理结果才交付规范。

### D3 交付已有项目整理指引

复用 [maintain-project 使用指南](../guides/maintain-project.md)，补足对应项目实施 AI 需要的整理顺序、输入与交付判断。指引包括：

- 在所属项目确认工作副本、已有安装、PRODUCT、冻结约束和用户修改；TermLink 沿用已有身份，Lawagent 按实际资料建立入口。
- 读取正文并整理目标、完整需求和已有进展，不止登记来源。报告已有交付的具体覆盖，不凭旧 task 关闭认定需求全部完成，也不因缺全量新测试而抹去旧结果。
- 补有依据的历史任务关联，整理已有安排和重要变化；身份或日期未知时保留来源，不编造历史、不重开任务。
- 当前用户决定的新安排可以现在保存；无需还原完整历史，也无需把全部 CR 转为 change。需要展示顺序时应保存可解析的有序结构。
- 回读正文、关联、安排和未整理范围，区分软件安装、规范资料保存和业务整理结果。

完成判断：每个项目的 AI 可以据此制定本项目的具体整理步骤并执行；本仓库不代写其业务资料，不把实际整理结果作为本轮完成条件。

## 后续项目交接

以下是交接去向，均不属于本仓库的实施阶段：

| 所属项目 | 接收材料 | 在该项目完成的工作 |
|---|---|---|
| TermLink | 已交付的维护能力与整理指引、已有资料快照 | 核对实际工作副本，补齐目标需求、进展、历史 task 关联、安排和重要变化 |
| Lawagent | 同一规范与整理指引 | 明确目标副本，从实际材料形成可持续维护的项目全貌 |
| TraceLens | D1、D2 的标准规范、解析说明和样例 | 核对现有实现，接入只读展示及 task/step 导航，在本项目验证页面 |

后续真实业务中的持续维护，也在所属项目观察和验证。若发现可复现的 vNext 通用问题，将相关输入、预期和实际结果反馈到本仓库，再单独安排必要修复；项目资料和页面问题在各自项目处理。不为了等待真实使用而延迟本仓库已经完成的交付。

本仓库本轮完成条件为 A 至 D 的必要工作已有结果：已确认的问题得到相应处置、实际改动得到适当验证、标准规范与交接材料可用，未验证部分如实说明。真实项目升级、资料整理和 TraceLens 页面完成分别由所属项目报告。

## 接续与记录方式

大步骤及 A 至 D 的小步骤编号只用于本文定位，不创建 task、不分配生命周期，也不是 Runtime 门禁。不同模型接续时先读工作目标、执行记录和当前小步骤，再按需读取相关源文件；不要求每次重读全部历史。

每轮已授权实施完成一个可检查的工作单元，连同必要验证与回读一起做完，再更新下表。记录实际改动、结果、限制和下一步，不把计划中的行为写成已完成。需要更细的文件、输入和检查安排时，在开始该小步骤时补充；远期项目的未知源码不提前猜测。

| 工作单元 | 当前状态 | 实际结果 | 下一步 |
|---|---|---|---|
| 本轮总计划与小步骤 | 本地实施完成 | 具体结果、证据和边界见下方执行记录 | 用户审阅；外部项目按交接另行实施 |
| A | 完成 | 实际基线、逐场景分类及最小修改已确定 | 无待实施工具缺陷 |
| B | 完成 | 源指引、显式遗漏诊断、重排消费样例；复用 v2 与现有 task 服务 | 不新增管理体系 |
| C | 完成 | 源检查、41 项产品／安装测试、19 项 source 测试、实际 AI 隔离操作与候选升级 | 未发布；真实项目未升级 |
| D | 完成 | 权威契约、生成副本／模板／Schema核对，TraceLens 与项目整理交接 | 页面和真实资料由所属项目验收 |

### 本轮执行记录（2026-10-09 UTC）

原计划日期为 2026-10-10；本环境实际 UTC 日期为 2026-10-09，以下按实际执行时间记录，不回填历史日期。实施者为当前 Codex（系统标注 GPT-6，具体服务构建未暴露）。独立只读复核由本会话另一个审查代理完成；不是独立业务测试团队。

**A1 基线。** 工作目录 `/workspace/vibe-coding-workflow-system`，分支 `work` 初始 HEAD `fd088cd8fea7e0e966da7fae9b0db2da07102f7b`、工作树干净。`git fetch origin main` 后确认 `origin/main=a3496d43c3c6aa1d3f9549f011173cfbb3cf6c8e`，`git merge --ff-only origin/main` 成功。差异只有正式计划及两份已编译 helper 的依赖定位变化；没有用户未提交的三项旧快照改动，不 reset／覆盖／清理工作。根 AGENTS 已读，无下级 AGENTS／本地 .agents skills／冻结登记；源模板与相关 vNext 协议为本轮适用指引。只读 task-status 仍为 6 个历史任务、TASK-010 active；未写本仓库旧任务／记录／CURRENT_TASK。

**A2–A3 场景映射。** 复用依据为当前 requirements、contract、API、writer/catalog/paths 与现有测试，以及 `project-planning-evidence/README.md` 的 0.24.1 历史样例证据。历史通过不算本轮重跑；以下明确本轮增量。

| 计划场景 | 分类／最小处置 | 本轮验证或复用边界 |
|---|---|---|
| 目标增加／口径变化 | 已支持身份与局部正文；澄清当前决定同步受影响安排 | update/requirements；复用既有 evolution 03/10/20 证据，未新跑目标数值场景 |
| 新增／拆分／修改需求 | 已有 v2 局部更新与身份历史保护；补当前决定直接维护 | C2 三设备追加实际保存；拆合复用既有 evolution 30–70 与产品回归 |
| 法规导入／数据库未准备 | 已有共享前提分析；澄清最小必要工作与展示顺序 | plan 指引；无真实数据库场景新增执行，不凭空扩大设施 |
| A 已完成后明确 B/C | 指引含糊：project 正文不能兑现机器顺序 | 明确使用适用／局部 plan.work_items；C2 保留 A 报告并安排 B/C |
| B 移到 A 前 | 格式已支持；补历史不变的直接行为说明 | C2 实际 B/A/C 与旧报告／绑定字节核对；重排样例双 reader 一致 |
| 普通聊天比较／明确采用 | 指引需区分采纳和收存意图 | update/discussion；C2 无 discussion 直接保存明确决定；备选不采纳复用旧证据 |
| 无计划工作项直接 prepare | 主 prepare 入口条件过窄 | C2 REQ-AUDIT 实际 prepare 与绑定，无 plan_items，不新增审计 plan |
| 旧 task 关闭后追加范围 | 已支持范围关联；强调不重开／不继承旧 PASS | C2 原 A 是带准确来源的历史关闭报告，当前 Runtime 不伪造旧关闭事件；新增三设备不扩旧绑定 |
| task 结束与下一事项 | 原执行／关闭已接 reconcile，补业务建议与 next_route／续接分离 | 未改 reducer；本轮未再执行 close／派生返回，复用现有任务规则和规划证据 |
| 旧项目资料整理 | 指引没有明确组合到旧 plan/task/CR | inventory 补条件式组合；C2 四份旧原文实际形成正文、plan、历史绑定、assessment、change |
| 保存冲突／重复操作 | 已有摘要冲突与重试能力 | C2 真实 WRITE_CONFLICT 后保留人工补充，仅补绑定；两个 prepare 总数不变 |
| 明确 docs/dist/PLAN.md 登记 | 已证实工具缺陷：0 文件却 complete=true | paths 保留隐含排除并报告遗漏；修复前后 JSON、源码／安装／离线回归 |

**B 实际修改。** inventory/update/discussion/plan/reconcile 五份参考指引，maintain-project/prepare-task/execute-step/close-task 四份源模板，requirements/contract 与两份交接指南；paths 唯一行为修复及其回归。增加由 `product-maintenance-assets.ts` 生成的 reordered 样例，保持 v2，不增加 Schema 字段或第二份状态系统。所有 dist、contract 副本、模板／Schema／消费输入从源构建；没有手改生成物。a3496d43 两份 bundle 原有 yaml 路径注释随本环境从 `runtime/vnext/node_modules` 重建为根 `node_modules`，不是额外业务算法变更。

**C1 实际命令及结果。** Node `v24.19.0`，Bun 固定 `1.3.10`（安装在 `/tmp/vnext-toolchain`），npm 缓存 `/tmp/vnext-npm-cache`。以下运行时 PATH 包含该 Bun；不需要目标项目安装 Bun。

| 命令 | 最终结果 | 归档内证据 |
|---|---|---|
| `bun install --frozen-lockfile` | 依赖安装成功，锁文件未变 | 环境执行记录 |
| `bun run build:vnext-runtime` | 成功；包含 product-maintenance 构建 | final-build-runtime-locked.log / run.json |
| `bun run build:vibe-governance-distribution` | 成功，锁步本地候选 0.24.5 | final-build-distribution-locked.log / run.json |
| `bun run validate:vnext-source` | PASSED | final-source.log / run.json |
| `bun test test/workflow-vnext-source.test.ts` | 19 pass，0 fail，115 assertions | final-source-tests.log / run.json |
| `bun test test/product-maintenance.test.ts test/product-maintenance-install.test.ts` | 41 pass，0 fail，1348 assertions | final-product-install.log / run.json |
| `node packages/vibe-governance/dist/cli.js install --root <隔离根>` | installed，read_back_verified=true | host-install-cache.json |
| 同 CLI `upgrade --root <隔离根>` | 0.24.4 初轮候选 → 0.24.5，upgraded／read_back_verified=true | agent/21-upgrade；保留文件摘要清单 |
| 安装后 helper read、assistance task-status | 9 usable，coverage.complete=true；仍 2 draft tasks | agent/22–23 回读 |
| `npm pack ./packages/vibe-governance --pack-destination /workspace/deliverables --cache /tmp/vnext-npm-cache` | 生成本地 tgz，不发布 | pack.log、package-sha256.json |
| `git diff --check` | 通过已跟踪修改；新生成样例单独检查只含生成器末尾空行 | 最终交接检查 |

最终不同通过用例共 60，1463 assertions；不累计中间重复运行。安装测试包含目标 PRODUCT／业务正文／原文／历史保留，独立离线 reader、新样例及遗漏诊断。安装测试中的旧版本夹具通过修改 fixture state 构造；C2 另有真实安装初轮候选再升级，不把它宣称为正式已发布 0.24.4 的全量升级矩阵。

中间失败均保留：首个新测试误对 check envelope 访问 usable_items（测试错误已修）；首次安装因默认 npm cache 不可写而失败，改可写缓存后通过；独立复核发现显式 `dir/**` 排除仍误报遗漏及样例旧建议未转历史，均修正。样例替换曾截断后续 goal，安装用例的 10 usable 断言失败，改为根标题边界替换后通过。版本修改时临时保护断言误把 kernel 中检测冻结的代码字符串当文件冻结，未完成常量修改造成一次锁步构建失败；核对真实头部后仅改版本常量，重新构建通过。以上不是最终通过的隐含例外，也没有绕过安装防护或自动审批拒绝。

**C2 实际 AI 验收。** 输入为本轮设计的四份合成旧原文，未预填最终标准文档或关联。实施 AI 实际读取安装 Skill／reference、原文及 helper 输出，再逐步选择并调用真实工具。通用 `transport.py` 只传 JSON、执行 Node、记录 stdout/stderr/exit 和前后文件，不生成语义答案。`agent-input.md` 明确合成材料与候选任务授权；`agent/00–23` 保留每步请求、实际结果、前后业务文件／记录；`agent-checks.json` 是事后不变量检查。原 A 仅为历史资料中的身份，未伪造本 Runtime 任务。两个实际新身份为 `task-fec57e3033763354c30a3e2813262efb`（审计，无 plan_items）与 `task-719d7c7a1e0ff5c9b75ebc9dfe122d84`（双设备 B）。未采用、执行或关闭它们，未伪造业务测试通过。

实际保存：四份旧原文 → 目标／完整需求、旧 plan、两条历史绑定（含 null）、范围化 AS-A、旧 CR；当前重排 B/A/C 及 change；直接 prepare 与真实绑定；并发正文补充下的失败与仅绑定重试；新增三设备正文及安排变化，原任务仍只覆盖双设备。AS-A 和四份原始资料字节始终不变，未收存整段聊天、未创建 discussion、未重开旧 task。最终 `DEFINITION_UNKNOWN`／`TASK_ID_UNCONFIRMED` 是保留的真实未知，不是整理失败或全量交付证明。

C2 首轮安装与最终软件的四份相关 Skill 和五份业务 references 相同；最终 helper 另补显式子树排除边界，最终新增离线样例也已修正。最终升级后逐文件与源码生成资产相等，见 final-installed-equality.json；不以第一次操作冒称第一次已用最终 helper。实际业务维护不是脚本提前写完答案再做结构测试，也不证明所有宿主模型都永不漏做。

**C3／D 交付。** 为避免同版本不同内容覆盖，将源码包、Runtime 包／lock、contract、kernel 常量和分发包锁步到未发布本地候选 `0.24.5`；Schema 保持 v1 读取／v2 新写。具体 bundle／manifest digest 在最终 build 日志。本地 tgz 位于 `/workspace/deliverables/vibe-governance-0.24.5.tgz`；源构建资产与最终隔离安装逐文件相等。可以在明确授权目标使用该候选或源分发 CLI，真实项目升级不在本轮。

D1 权威契约／生成 support 副本相同，Schema 与模板没有新字段需求。D2 以 `docs/guides/tracelens-product-documents.md` 为交接入口，reordered 10 条目含 B/A/C、旧变更顺序、3 task 关联（含未知历史）与旧范围摘要；源码生成、安装 helper 和离线 reader 一致。实时状态准确入口为 assistance task-status/context 与 TASK_MANAGEMENT_API，不从文档／journal 另造 reducer。D3 使用指南新增所属项目核对、分批正文整理、既有进展、条件式历史安排／绑定／变化及回读判断；TermLink/Lawagent 没有材料不阻塞本仓库，旧 46 条快照不作为本轮事实。

完整原始证据见同目录 `goal-requirement-maintenance-evidence.zip`；独立审查摘要另存于归档 `independent-review.md`。工作树保留完整未提交 diff 与新生成样例、证据包供审阅；没有提交、推送、发布、部署或改真实项目。

**未验证边界。** 未跑 test:workflow-all、完整 Runtime 生命周期／派生续接回归、Windows 原生、TraceLens 页面、真实项目升级／资料整理、真实业务或跨模型重复测试。本轮 task-end 文案保持原服务语义，未用结构通过冒称已真实 close 或宿主业务交付。外部交接各自在所属项目实施。本轮已授权实现、最小验证和独立复核完成；next_route: null。

## 依据与变更记录

- 用户在本次会话确认的轻量目标需求管理定位及两个已有项目整理需求。
- [目标需求能力基线](../product/project-maintenance/requirements.md)与[文档契约](../product/project-maintenance/document-contract.md)。
- [辅助 Runtime 设计](../product/vnext-assistance-runtime.md)与[当前任务管理设计](../product/vnext-task-management.md)。
- [项目维护交付记录](vnext-project-maintenance-delivery.md)与[规划增量证据](project-planning-evidence/README.md)。
- [TraceLens 文档交接](../guides/tracelens-product-documents.md)。
- [maintain-project 模板](../../templates/vnext/skills/maintain-project.SKILL.md.tmpl)、[prepare-task 模板](../../templates/vnext/skills/prepare-task.SKILL.md.tmpl)与[维护参考资料](../../runtime/vnext/support/product-maintenance/references/)。

2026-10-10：建立本计划。以 0.24.4 实际勘察为起点，明确先验证差距、按需修改、分项目整理和只读展示；未执行软件修改、升级或业务资料整理。

2026-10-10：按用户澄清收窄仓库职责。原 D 的真实项目整理、原 E 的 TraceLens 实施及原 F 的真实使用验证移为外部交接；本仓库路线改为 A 至 D，共 13 个小步骤，新增 D 负责标准文档规范、解析样例和整理指引的交付。

### 后续 Git 交付授权（2026-10-09 UTC）

用户在 17:03 UTC 明确授权提交并推送本轮完整 0.24.5 改动及必要样例／证据到 origin/main（授权消息 Sentinel_930847db03e8819185c25ecf6ca135a1）。此前执行记录中的“未提交／未推送”描述验收与 Library 打包时的事实，不是本次交付禁令。提交前重新 fetch，远端 main 仍为 a3496d43，无需合并；已验证文件与交付清单逐项摘要一致，本次仅追加交付授权说明。无无关改动或其他 CI 分支纳入；未授权 npm 发布或部署。提交与推送实际结果以 Git 和最终交付回复为准，不追加记录自身 SHA 的递归提交。
