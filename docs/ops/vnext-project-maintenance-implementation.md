# vNext 项目目标与需求维护：实现方案

状态：首版已实施；本轮可靠性修复候选 `0.24.1`，未发布。依据：[入口](../product/project-maintenance/README.md)、[需求](../product/project-maintenance/requirements.md)、[契约](../product/project-maintenance/document-contract.md)。原勘察 main：`c40726fa54f5c88acf65a1a6266392829da916c9`，0.23.8。实际基线、检查及限制见[交付记录](vnext-project-maintenance-delivery.md)。

## 本轮可靠性收敛（2026-10-05）

工作计划见 [hardening-plan](vnext-project-maintenance-hardening-plan.md)，不替代既有需求／契约。写入先检查原格式及显式迁移，再生成候选，统一比较实际受影响身份、dismissed 历史和正文 AST 落点；仅 remove_fields 也执行删除。合法整文件修复选中未知字段可保存，无关坏条目保留原 YAML／正文。remove_items 和 remove_relations 补足原请求无法明确表达的精确删除，不是批准或 force；原文定位根级损坏仍使用既有授权的原文修复途径。

覆盖将遗漏和硬预算停止分开。保留权限、排除和联接跳过策略，登记／选定文件及 entry 的缺失进入 omitted；读取继续处理独立路径，不扫描全部 sources。CLI 与离线输出携带实际路径、排除范围、结构可用数及诊断；盘点和交付语义仍由宿主按来源判断。版本仅按既有 Distribution／Runtime 同步规则升为未发布 `0.24.1`，task reducer 无逻辑改动。

## 1. 当前代码事实及接入位置

2026-10-06，C01～C03 在同一 writer 继续收敛：只比较已知来源依据、只保护真实新激活，append 仅插入 AST 序列与正文边界。合法无关字段维护和同文件新增／拆分无需先修无关坏条目。实现、原行为及正反证据见 [本次交付](project-maintenance-hardening-evidence/c-p2-repair/README.md)；不新增状态、审批或维护 gate。

同日 D01／D02 修复统一正文分隔和实际激活比较：分隔行由共同写入器生成，旧正文所有原始字节保留；仅局部追加在原 EOF 后的确定性分隔行免于被算作无关坏条目修改。未改关系字段直接保留，字段变化则逐份匹配旧 active 记录，重复 ID 不再误挡普通维护，也不能掩盖实际恢复。实现及分层证据见 [D01／D02 交付](project-maintenance-hardening-evidence/d-p2-repair/README.md)。

以下保留设计时已核对的主线接口及接入依据。首版复用这些接口，未复制任务状态机。

| 当前文件 | 已有事实 | 本次接入方式 |
|---|---|---|
| [AGENTS.md](../../AGENTS.md) | 默认采用 assistance；产品／操作文档与 docs/workflow live 管理面分离 | 保持非阻塞原则；本设计放 product／ops，不把需求资料写成 live task 状态。 |
| [任务管理设计](../product/vnext-task-management.md) | prepare 分配 task 身份；同 task 可修订计划；采用、执行、处置分别记录 | 复用真实 task_id／plan_ref；不新增 task reducer。 |
| [TASK_MANAGEMENT_API.md](../../runtime/vnext/support/TASK_MANAGEMENT_API.md) | prepare、adopt、execution、test、review、step、close 等有现成关联路径 | 新 helper 不复制这些动作；Skill 需要实际 task 操作时使用原 API。 |
| [prepare-task 模板](../../templates/vnext/skills/prepare-task.SKILL.md.tmpl) | 已读取需求／设计／计划，支持同任务 replan；候选不是采纳 | 接收项目 work item 的业务范围；准备后补 TaskBinding，绑定失败不重复 prepare。 |
| [source 校验器](../../scripts/vnext-source-contract.ts) | PUBLIC_ENTRY_IDS、模式及元数据有显式集合 | 增加 maintain-project 的能力声明并同步检查；不恢复旧准入门禁。 |
| [分发构建器](../../scripts/build-vibe-governance-distribution.ts) | bundleArtifactSpecs 有显式 Skill／支持文件清单，copyMigrationSource 单列部分资源 | 新 Skill、helper、Schema、references 必须进入实际 bundle 和安装；只新增源文件不算交付。 |
| [package.json](../../package.json) | 源码使用 Bun；有 Node 原生 assistance 测试、build:vnext-runtime、分发构建及安装回归命令 | 按变更影响运行既有检查；新 helper 目标运行环境仍为已发布 Node，不要求业务项目安装 Bun。 |

实施从 `project-goals-requirements` worktree 的 `445cee1f0eb01b2feede98e2addda209f418179c` 开始，核对后相对勘察基线仅有六份设计文档变更；既有接口有效。以下算法和边界保持设计语义，实际可调用接口以随软件安装的 `product-maintenance/API.md` 为准。

## 2. 模块结构

新增独立产品文档 helper，不在 assistance 每次启动时无条件加载，不导入旧 kernel、任务资格检查或 CURRENT_TASK parser。实际组织：

```text
runtime/vnext/src/product-maintenance/
  model.ts       # 契约类型；业务状态不是 Runtime 状态
  parser.ts      # YAML + Markdown AST、条目位置及局部降级
  catalog.ts     # 当前条目索引、反向引用、工作副本隔离
  references.ts  # SourceRef、TaskRef、定义摘要及历史读取
  plans.ts       # 工作项／TaskBinding 的确定性检查
  writer.ts      # 已授权候选文件安全写入、capture、结果分项
  cli.ts         # read/check/apply/capture；不做模型推理
  schemas.ts     # v1/v2 文档、入口及请求/结果结构定义
  paths.ts       # 范围匹配、边界及有界枚举
  offline-reader.ts # 无 Runtime 的只读消费者入口

templates/vnext/skills/maintain-project.SKILL.md.tmpl
runtime/vnext/support/product-maintenance/
  contract.md    templates/    schemas/    references/
```

使用现有 `yaml` 和生产依赖 `unified`／`remark-parse` 的真正 Markdown AST。helper 与离线消费者均打包全部依赖，目标项目无需源码、Bun 或这些 npm 模块。源产物 `runtime/vnext/dist/product-maintenance.js` 安装到 `.workflow-system/runtime/support/product-maintenance.js`；`bun run build:product-maintenance` 生成 Schema、模板、契约副本和两份独立 Node 产物，已纳入 Runtime／分发构建。

不先建立 monorepo SDK、数据库、事件溯源平台或公共全量图服务。目录、反向关系与 hash 检查先在内存生成；读取按范围／条目展开。原文分页与大文件读取采用有边界或流式方案，显示未覆盖范围，不用受限 exec 缓冲吞整个历史。

## 3. helper 的职责与建议调用面

已实现接口：

```text
node .workflow-system/runtime/support/product-maintenance.js <read|check|apply|capture> --root <project>
```

stdin JSON 承载具体选择；stdout JSON 表达实际结果。路径及内容按值传递，不能拼成 shell 命令。

| 动作 | 输入与结果 | 禁止行为 |
|---|---|---|
| read | 入口、条目／范围选择；返回目录、按需正文、来源、反向关系、覆盖与诊断 | 不写缓存／记录，不调用模型，不创建 task。 |
| check | 明确文件／候选内容；返回结构、标题、ID、关系和 hash 诊断 | 不返回业务许可，不用旧 task 状态阻断检查。 |
| apply | 明确候选文件、新建或已读内容摘要、操作范围；逐文件报告保存／冲突／结构问题 | 不把 expected digest 当授权票据；不全量重写无关正文。 |
| capture | 已取得且获授权的文本／文件及目标位置；保存原文并返回真实 SourceRef | 不自动抓取 URL，不把模型输出冒充用户原件。 |

请求／结果 envelope 已在 B1 固定并随分发提供 `request-v1.json`、`result-v1.json`。结果携带 `development_gate:false` 与 `qualification:not-evaluated`，失败使用实际失败／部分结果，不以统一 success 隐藏未保存；没有 approve、force 或 completion token。首版产品对象使用 Agent 在当前目录核对后指定的稳定 ID；task 身份只复用既有任务服务。

## 4. 大模型与 Skill

maintain-project 的入口只包含意图路由、权限／非阻塞边界、结果要求和按需资料位置。五类意图的工作方法放独立 references，不把全部 Schema、迁移指南及示例展开到每次调用。

大模型负责业务归类、真实影响、文字变更和讨论摘要；程序负责结构、定位、摘要、幂等及文件写入。模型生成的候选只是待保存内容，结构通过不提升为事实认证。

默认先读取相关业务索引，再读候选正文／来源。召回讨论只先取摘要和位置，实际相关才展开；没有读到的资料不宣称已核对。需求明确变化时更新相应正文，不仅追加日志；保持未修改的要求和例外。

启用维护且已有授权时，在需求／设计变化、task 准备成功、新执行／验证材料出现时做相关维护。read-only 的 review 不因维护钩子偷偷写文件，可返回待维护引用，由已授权写入阶段处理。没有 PRODUCT.yaml、维护 paused、helper 不可用或资料错误时，不影响原工作流。

prepare-task 不需要先获得维护回执。纯产品整理不要求活跃 task；只有解析真实 task 身份／状态时，才通过现有 task-status／context 的完整语义接口，不用显示文件猜身份。TraceLens 不使用这些 Runtime 接口。

## 5. 六项核心扩展的实现算法

### VPM-07：范围化任务绑定

1. 有已知选定需求／工作项时直接复用；历史关联由 Agent 读取真实任务内容和候选需求判断。
2. 使用任务服务实际返回的 task_id、plan_ref 及可定位来源构造 TaskRef；无稳定 ID 的旧资料保留 null 和来源，不分配假身份。
3. 在关联 goal／requirement 一处写 TaskBinding：角色、覆盖范围、计划工作项及必要 repairs。程序校验目标／工作项和重复关系。
4. plan 与 TraceLens 从绑定反查，不双写任务列表／生命周期。绑定保存失败，后续只补绑定；不能重复调用新 task prepare。

### VPM-08：外部观察与交付对账

1. 用户提交材料先保存／引用。区分日志、用户报告、Agent 实际复现，外部验证不需要 task ID。
2. Agent 比较需求范围、原报告覆盖和实际检查对象；原报告／原文不修改。
3. 能完成对账时更新范围化 assessment；尚未完成时在选定 assessment 登记 pending_sources，或明确资料保存但相关文档尚未写入。
4. 需求 hash 未变不代表没有新反证；旧 PASS 不遮住新失败。不同版本／范围分别解释，修复 task 关闭不替代复验。

### VPM-09：候选关联与实际影响

1. 程序由变化点找需求／设计、TaskBinding、plan 的直接关系；记录读取范围。
2. Agent 判断真实依赖、无影响及待核对部分。普通 references 和 inferred 不能自动触发全图失效。
3. 确有依赖再扩大范围；定位代码根因复用既有调试能力，不在维护层造调试器。
4. 交付问题写 assessment，工作调整写 plan／必要 change，目标变化才改 requirement。分析不输出禁止执行的 gate。

### VPM-12：稳定身份与历史

1. 用 project＋item、plan＋work item 和既有 task 身份分别定位；移动不改 ID，插入不重编号。
2. 历史来源携带准确对象或明示未知；保留必要旧范围，不能用当前同 ID 正文冒充历史。
3. 拆分／替代保留去向和相关旧工作。修复旧需求时区分历史归属、当前有效要求和实际修复范围。
4. 不自动 resume 旧 task、恢复 retired 需求或重开已结束计划；用户明确纠错／删除按权限处理，不把错误关系永久冻结。

### VPM-24：项目实施规划

1. Agent 根据明确需求、采用设计和必要实现资料判断是否需要独立 plan；简单任务直接 prepare-task。
2. 复杂目标拆为有结果和范围的工作项；阶段可选，近期细化、远期保留边界，不为每个工作项创建新 REQ。
3. 程序检查 ID、业务覆盖引用、顺序及循环诊断。未知依赖保留说明，不能虚构完整路线。
4. 只为当前选中项创建真实 task；项目 plan_id 与 Runtime plan_ref 不互换。后续拆分／合并允许多个绑定。

### VPM-25：计划局部演进

1. 读取当前安排和新依据，确认实际授权；已有明确调整不重复审批。
2. 按最小范围插入、延期、取消、重排或拆分工作项；origin 区分 initial／added／unknown，必要 change 保存前后安排。
3. E6R 可关联 E6A 历史交付并安排在 E6C 前；保留 E6A／B 身份和旧结果，工程前提不以 task close 替代。
4. 已创建 task 的修订仅在实际需要和授权内使用现有 prepare(existing task_id, base_plan_ref)／adopt；不为项目 plan 改顺序自动修订或替换全部 task。
5. 无当前计划的历史修复可直接绑定需求或纳入当前维护计划，不强制重开原计划。

## 6. 旧接口最小接入

在 prepare-task 加入“选定 work item → 任务范围 → 成功后 TaskBinding”资料入口；在执行／调试／验证的已授权结果维护处加入“新相关观察 → 局部对账”。close-task 仅在已有授权覆盖时同步相关摘要，失败不影响用户关闭或停止。

不要把这套业务判断放入 task-management.mjs 的 reducer；也不要因新增 Skill 修改旧操作的资格／状态含义。现有记录仍是事实来源，规范文档是项目资产，两者分工明确。

新条目注册需核对 `.workflow-system/vnext/SOURCE_CONTRACT.yaml`、`scripts/vnext-source-contract.ts`、模板元数据和分发清单；只补新能力及必要资源描述，不借此重新启用兼容层的强制 Runtime operation。相关安装／迁移入口通过分发构建器和现有 bundle 生成路径追踪，不能只修改一处硬编码数量。

## 7. 分发与数据所有权

必须完成：源码 helper 构建、Skill 和按需 references、模板、Schema 打包、安装路径、升级保留、目标项目 Node 执行验证。维护功能的库依赖需要打包或声明为实际可安装依赖，不能依赖源码仓库的 node_modules／Bun。

PRODUCT.yaml、托管需求／设计／plan、discussion 原文、history 属于目标项目数据，不进入软件升级覆盖列表。安装工具可提供可选启用／模板，但没有明确授权不得覆盖既有资产。helper 不改旧 records 存储，不创建新的事件系统。

源码加入新 public entry 后，检查 build-vibe-governance-distribution 的 skillEntries、bundleArtifactSpecs、copyMigrationSource 及其调用的 bundle 生成路径。只有 `gen:all` 通过不证明新 vNext 资产已分发；不要手改 docs/workflow/generated。

## 8. 可独立交付的实施切片

以下是实施建议，不是固定真实 task ID，也不是限制用户调整顺序的流程。

| 切片 | 交付物 | 主要能力／验证 |
|---|---|---|
| B1 契约读取闭环 | v1／v2 Schema、AST parser、目录／来源、正反样例、read/check | 01、11、15；长文档、部分错误、离线读取 |
| B2 维护与资料闭环 | 安全写入、capture、维护 Skill、模板与按需资料 | 02–06、13–14、16–23；真实 Agent 整理／变更／讨论 |
| B3 项目计划与任务绑定 | plan、TaskBinding、prepare-task 接入、幂等补登 | 07、12、24；一需求三工作项、未来 task 为空 |
| B4 E6 纠偏闭环 | 外部失败、局部影响、计划插入、交付对账 | 08–10、25；不重开旧 task，不把 close 当复验 |
| B5 分发与目标安装 | helper／Skill／资源打包、新装和升级保留验证 | 13–15、23；无源码／无 Bun 目标目录可用 |
| B6 消费者及交付收束 | 完整样例、独立读取检查、使用说明、实际验证记录 | 业务全貌、计划／任务／讨论分离、限制如实说明 |

分发链可随 B1 开始接入，不要等 B5 才发现不可安装。B2～B4 逐步复用检查，不要求为每个能力建立独立测试文件。TraceLens 的最小读取尽早验证；真实 UI 改造不是默认授权范围。

## 9. 验证、完成与后续文档维护

执行 [验收矩阵](vnext-project-maintenance-validation.md)。按影响选当前 package.json 中已有命令，新模块增加必要的聚焦行为测试。不得为了让旧预期通过而恢复开发准入、强制新建任务或丢弃原文。

实施完成后补记实际源码／安装路径、操作例子、检查命令、产物及未覆盖情况。本文中的建议命令在真正实现前不得写进用户使用说明当成现有接口。包版本发布按既有发行约束及授权处理，本设计不授予 npm publish、业务项目升级或部署权限。
