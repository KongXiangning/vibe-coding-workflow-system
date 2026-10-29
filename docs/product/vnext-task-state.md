# vNext：每个 Task 一份当前记录

状态：前六步源码、隔离联合验收及旧数据副本演练已完成；真实项目升级与发行尚未执行。
历史迁移与正式发布属于后续步骤。
确定日期：2026-10-29。源码基线：`1b73259aa362bd3942a84c6acb91b8b8e252a54b`。
合成样例：[task-state-v1.json](../ops/contract-examples/task-state-v1.json)。

## 1. 要实现的业务行为

一次 Task 保留目标、采用范围、需求／功能点关联、当前执行及验证结果、重要约束和遗留问题。
反复修改代码或运行同一项测试，更新对应位置，不为每次操作保存永久 event，也不将旧全文
追加到任务文件。任务关闭后，TraceLens 仍能识别任务身份、关联范围及实际结果。

例如，实现断线重连时，单元测试先失败后通过，任务记录保存当前单元测试结果；真机测试
仍失败则独立保留失败和未解决问题。每轮日志、截图、blob 留在任务临时目录，关闭收尾时
清理。明确需要长期保留的现场资料先转存为正式附件。可重新运行的测试继续保存在代码中。

本契约定义新模式的保存方式。既有 journal、历史字节及分发格式的转换属于后续
迁移步骤；本文和样例不会切换当前项目的数据源，也不是已发布发行包或安装验收证明。

## 2. 文件、身份与版本

`task_key = SHA256(UTF8(task_id))`，不裁剪或重新规范化原 ID。使用摘要作为文件名，是为了
接纳既有非 UUID 身份且不将调用者输入直接作为 Windows 路径；`task_id` 本身保持原值。

| 位置 | 内容与保存规则 | Git |
| --- | --- | --- |
| `.workflow-system/tasks/<task_key>.json` | 每个 Task 一份当前记录，原子更新 | 纳入 |
| `.workflow-system/tasks/state.json` | 项目当前焦点、显示编号分配位置、项目修订号 | 纳入 |
| `.workflow-system/tmp/tasks/<task_key>/` | 本任务的报告、附件清单、blob、日志及临时截图 | 排除，收尾清理 |
| `.workflow-system/tasks/retained/<task_key>/` | 明确选择保留的实际附件，沿用内容对应的正常文件后缀 | 明确保留时纳入 |
| `records/task-view.json`、`<workflow_home>/CURRENT_TASK.md` | 可重建的当前展示；展示基线及正常恢复副本使用固定位置、固定数量 | 排除 |

原始日志和其 blob 副本均应进入同一 Task 的临时范围，避免只清副本却留下原报告。
当前展示仍是派生文件。正常更新不产生逐修订的 task-views、display-*、回执或指针文件。
外部编辑的展示按实际差异报告和处理，不当作可任意删除的临时材料。

| 格式 | 标记 | 用途 |
| --- | --- | --- |
| 任务文件 | `kind: vnext-task-state`、`schema_version: 1` | 新的任务记录格式 |
| 项目文件 | `kind: vnext-task-project-state`、`schema_version: 1` | 固定一份项目事实 |
| 状态查询 | `kind: task-query/v2` | 明确只提供保留下来的当前信息 |
| 写入响应 | `kind: task-write/v1` | 小型写入结果 |
| 临时材料清理响应 | `kind: task-cleanup/v1` | 当次清理结果，不另存回执 |

版本属于各自的格式族。新任务文件的 `schema_version: 1` 不修改既有 CURRENT_TASK v2、
event v1/v2 或 PRODUCT 的版本。旧 journal 项目继续使用现有 `task-query/v1`；显式迁移
完成并发布合法 `tasks/state.json` 后，才选择新事实源。同一 Task 不双写两个事实源。
安装软件不自动执行该切换。未知格式如实报错，不改读旧数据冒充当前状态。

## 3. 任务记录的字段

创建时即可确定的身份字段必填。尚未发生的执行、审查、关闭使用 null 或空集合，不能
填入虚构结果。表中容器均是当前内容，不是按调用次数追加的操作历史。

| 字段 | 类型与含义 |
| --- | --- |
| `kind`、`schema_version` | 上表的格式标记 |
| `task_id`、`display_id`、`title` | 稳定真实身份、显示编号、当前名称；显示编号不作跨副本身份 |
| `revision` | 正整数；一次实际任务内容更新递增一次；无变化重试不递增 |
| `created_at`、`closed_at` | 实际记录时间；未知旧时间为 null；恢复 active 后 closed_at 为 null |
| `lifecycle` | draft、active、paused、closed；导入未解决状态可为 ambiguous |
| `creation_key`、`creation_request_sha256`、`creation_plan_ref`、`last_write` | 固定的创建身份与摘要／初始计划标识；最后一次请求的 key、request_sha256 和小型 result，不保留请求正文 |
| `adopted_plan_ref`、`candidate_plan_ref` | 采用计划和当前候选计划的稳定标识，未知为 null |
| `work_position` | `{plan_ref, step_id}` 或 null；关闭不删除实际停留位置 |
| `plans` | 采用计划、当前候选及仍被明确引用的必要范围版本；每份含 ref、业务正文与 steps |
| `product_refs` | 已知 PRODUCT owner／binding 的定位信息；不另存一份可独立修改的绑定分类 |
| `constraints`、`decisions` | 带稳定 ID 的有效约束、必要决定、适用目标、实际来源 |
| `remaining_work` | 当前未完成工作、验证缺口及明确延期内容 |
| `delivery` | 本 Task 实际交付摘要和按 owner_id／point_id 定位的结果，不推导整个需求满足 |
| `relations` | origin、dependency、return_entry、return_result、continuation 的当前事实 |
| `retained_artifacts` | 明确保留的附件 ID、path、实际 sha256、size、purpose；不列临时 blob |
| `commits`（按需） | 显式记录的真实提交关联，同一 SHA 更新同一项，不自动补录 |

`state.json` 必填 kind、schema_version、revision、current_task_id、next_display_number。
current_task_id 可为 null；next_display_number 是下次分配位置，不回收已分配身份。
项目 revision 在这些项目事实实际改变时递增；单独更新某个 Task 不必改项目 revision，
但会改变查询的 view_revision。
任务存储目录不作为 PRODUCT 当前定义的扫描目录；PRODUCT 按 source_paths 读取明确来源。

每个 `plans[].steps[]` 保存 id、title、state 及下列当前内容：

| 字段 | 更新单位 |
| --- | --- |
| `execution` | 本步骤当前一次代码实施的 ref、摘要、source_revision、命令、recorded_at；未实施为 null |
| `checks` | `(check_id, environment_id)` 唯一的验证项，保存命令、selector、result、摘要、execution_ref、subject、observed_at |
| `review` | 当前目标 execution_ref 的审查 ref、结论、范围、来源和时间；未审查为 null |
| `review_decision` | 针对该 review_ref 的实际处置，与审查结论分开；未处置为 null |
| `findings` | 当前未解决问题，以 finding_id 定位；必要的已接受约束放 decisions／constraints |
| `disposition` | 带 ref 和 execution_ref 的明确步骤工作处置、理由和 remaining_work；不能用测试通过自动生成 finished |

check_id 标识测试目的，environment_id 标识实际环境；二者不能使用每轮时间戳或 run_id。
新增真实验证范围可增加验证项，重复执行更新同一项。命令与被测版本是结果内容，不用
每次代码版本作为新槽位。常用 result 为 passed、failed、not-run、unknown；无法归一的
原报告值保存在摘要中并标 unknown，不猜为通过。

delivery.items 使用 owner_id、point_id、coverage、plan_ref、step_id，以及分开的
implementation（implemented／partial／not-implemented／unknown）与 verification
（passed／failed／not-run／unknown）。未知身份或步骤可为 null 并写明范围。
它是任务报告，不替代 PRODUCT 的需求定义、绑定或有适用范围的 Assessment。

relations 沿用既有父任务 ID、父计划／步骤、派生原因、移交范围、返回策略及续接上下文。
return_entry 只保存一个当前父步骤检查点（身份、计划、生命周期、步骤事实摘要和焦点
版本），不复制完整父 Task。关闭不推导 dependency=satisfied；返回仍只恢复工作位置。
新的父步骤工作、焦点切换、暂停或计划变化会阻止过期自动返回，不回放业务操作。

## 4. 写入、替换和引用规则

1. 新计划获得稳定 plan_ref；候选晚写入不自动采用。候选槽位固定一份，修改计划正文时
   用新 plan_ref 替换旧草稿，并使旧草稿审查不再适用；相同内容重试不换标识。保留当前
   采用／候选，以及仍被 PRODUCT、父子关系或未解决事项引用的必要范围版本，其余中间
   草稿可替换。已明确关联的范围正文不原地改写；保留范围版本不包含其历次运行全文。
   已采用范围自动保留；候选尚需长期引用时，调用方用 retain_plan_refs 明确固定其定义，
   不在每次运行／查询中扫描全项目推断引用。不可把会被替换的草稿作为固定正式来源。
2. 新的实际代码实施替换当前 execution 并获得新的 execution_ref；同一请求重试复用它。
   checks 与 review 必须明确关联实际目标，旧结果不自动认证新的 execution。仍未解决的
   finding 不因新审查没有重复列出而消失；解决或接受需明确指向 finding_id。
   新 execution 使旧目标的当前 review 置为 null，步骤回到 executed；旧 finished 依据不
   继续代表本轮工作已结束，后续仍用实际 step 处置。开放 finding 独立保留。
3. 同一验证项在同一环境重测，只替换该项。单元通过不能覆盖真机失败；当前未运行不能
   变成过去通过。历史完整输出留在临时材料，修复原因若仍影响后续工作则写入必要决定。
4. 对实际被测版本和环境如实记录。execution_ref 不一致时查询明确标为不适用；任意后续
   代码变更与旧证据的语义关系仍需正常实施／验证判断，Runtime 不自动认证当前代码。
5. 已完成、跳过、延期、关闭是工作处置。用户明确结束未完成任务时，保留失败、未运行、
   未解决 finding 和 remaining_work；不清除它们以满足关闭。

plan_ref、execution_ref、review_ref 为 Runtime 返回的不透明标识，不是可打开的文件路径。
它们在其目标被保留期间保持稳定；不将已删除目标的标识重新赋给另一个结果。PRODUCT
继续按 task_id、plan_ref、step_id 关联，来源另指向真实任务文件或正式附件。

当前来源使用 source_ref（实际项目内相对路径）、source_sha256（本次读取的任务 JSON
原始字节摘要）及 revision；正文可通过 read 打开。source_sha256 不写回任务事实，
不以 view_revision 或去掉写入元数据后的展示正文摘要代替。
绑定至活跃任务的可变来源不冒称不可变原件。需要固定字节的正式评估使用最终写入后
实际读取的文件摘要；修改任务后旧摘要变化应明确显示，不替换旧摘要掩盖变化。

正式报告保存前先完成其所需附件的转存和任务最终写入。后续 cleanup 只删临时材料、
返回统计，不修改任务 JSON、不递增任务 revision，避免清理元数据立即使报告来源失效。
新的业务更正属于真实修订，与只重试清理分开。

## 5. 写入接口

沿用 assistance.mjs 的 task、record、snapshot、read、find、task-status、context 命令。
管理服务仍不运行代码、测试或 Git 操作。以下约定只适用于切换后的新任务存储。

所有 task 事实写入使用稳定 task_ref、expected_revision 和 idempotency_key；新 prepare
由服务分配 task_id，不带 expected_revision。影响项目焦点的动作另带 expected_project_revision。
这些字段由工具／Skill 使用，不增加用户批准环节。使用既有短管理锁、原子文件替换；
旧修订写入不静默覆盖新结果。跨任务／焦点操作分别报告实际持久化结果，不假称跨文件事务。

创建幂等键保存在各 Task 的 creation_key 中，重复创建不产生第二项任务。其他动作只保留
last_write：相同 key／完整请求摘要的最近请求重放返回 already-applied；相同 key 不同
输入返回 IDEMPOTENCY_CONFLICT。更早请求携带旧 revision 返回 REVISION_CONFLICT，不
为无限幂等回放保存历史，也不声称旧请求从未执行。调用方回读后决定是否更新管理信息，
不重新执行测试。摘要使用递归排序对象键、保留数组顺序的完整请求 JSON 的 UTF-8 SHA256。
创建之后再重放创建请求仍定位原 Task；若初始草稿已替换，返回 plan_ref=null 与
initial_plan_retained=false，不用当前计划冒充当时草稿。创建摘要未知时明确报告
IDEMPOTENCY_ORIGIN_UNAVAILABLE。带附件的请求重放不重新捕获或校验附件，以独立诊断注明。

| task action | 主要输入及写入结果 |
| --- | --- |
| prepare | plan 与可选 origin；创建任务或更新当前候选，返回 task_id、plan_ref |
| adopt | plan_ref、实际决定；改变采用范围；focus=true 才明确切换已有他任务焦点 |
| execution | plan_ref、step_id、摘要、source_revision、commands；替换该步骤 execution |
| test | plan_ref、step_id、check_id、environment_id、execution_ref、结果与命令／subject；更新一个验证项 |
| review | draft 对 plan_ref，change 对 execution_ref；更新该目标当前审查，finding 依稳定 ID 保留 |
| review-decision | review_ref、choice、实际决定及明确处理的 finding_id；不改写原审查结论 |
| step | plan_ref、step_id、实际工作 state、remaining_work；保留缺口并更新工作位置 |
| pause／resume／focus | 实际决定；更新生命周期／项目焦点；resume 才恢复关闭任务的普通实施写入 |
| close | 实际决定、最终 delivery、remaining_work；关闭并保留所有当前缺口，不立即清附件 |
| dependency | 实际 dependency 状态、摘要与来源；独立于生命周期，保持既有续接语义 |
| git | 显式要求的真实 SHA 关联；同一 SHA 不重复，未关联不表示没有提交 |
| retain | 明确临时 ref 与 purpose；将原字节复制至本任务 retained，更新 retained_artifacts，返回真实路径／摘要 |
| cleanup | 已关闭 task_ref、expected_revision；只清本任务临时目录，返回 task-cleanup/v1，不写任务事实 |
| rebuild | 只重建派生展示；不产生 event、不重跑业务 |
| correct／resolve／defer | 明确的 target、changes／selected_value／reason；只更正当前事实、处理真实歧义或保留具体待办，不清除其他缺口 |

closed Task 的普通 execution／test／snapshot／record 返回 TASK_CLOSED；确需后续实施使用
已授权 resume。更正已关闭任务的实际事实可用 correct 明确指定目标和字段；不隐式重开。
新模式 target 由 plan_ref、step_id、check_id／environment_id、finding_id 等已存在标识
定位；changes 仅更新该业务对象的明确字段，不修改真实 task_id 或写入元数据。
link／correct／resolve／defer 的旧 event_ref 形式仅供旧 journal 和迁移诊断；新记录的
更正使用任务、计划、步骤和 finding 等真实目标，不伪造一个原始 event。未知目标／输入
返回明确错误，可保留调用方已有临时输出，不另写永久“未关联事件”。

record 只保存所选 Task 的临时报告，按稳定 report_key 更新同一报告；不替代 task 状态
动作。snapshot 增加 task_ref，将明确文件复制进本 Task 临时目录，返回 ref、size、sha256，
不默认返回正文。files／evidence_refs 沿用明确捕获／引用的含义，但不能把别的 Task 的临时
附件作为本任务的永久依赖；需要长期使用时先 retain。无唯一 Task 时不猜归属；普通开发
无需为了保存一份业务文档而创建任务，直接维护该文档。

find 默认搜索正式任务信息和已登记正文；临时材料与旧历史只在明确 roots 下按需读取。
旧归档依然可显式读取，新查询不为计算当前状态重放全部旧事件。

task-write/v1 成功结果必需 status、recorded、task_id、revision、project_revision、source_ref、
association、projection、issues、detail_request；返回本动作产生的 ref 时放在 result。
默认不返回整个 Task／原请求／附件正文。status 为 applied、already-applied、
recorded-pending-view 或 failed。失败另带 code；recorded 描述本次持久化，不能推断业务通过。
任务已保存而展示失败时 recorded=true、status=recorded-pending-view，独立报告焦点结果。
项目级 rebuild 没有选中 Task 时，task_id／revision／source_ref／detail_request 为 null，
association=not-applicable；尚未创建任务的新项目不为 rebuild 生成一份会改变数据模式的展示。

retain、cleanup 只作用于服务确定的本任务普通文件，拒绝越界与符号链接／junction。
cleanup 的修订检查、与 resume 的竞争以及实际删除由管理 I/O 协调；snapshot 发布时也要
核对任务尚可写，关闭后的迟到捕获不能再次留下 blob。清理失败返回 partial 和剩余路径，
已保存的关闭保持有效；重试不修改 Task。清理统计直接返回，不新增永久回执。

## 6. 查询与 TraceLens 交接

task-status、task status 和 context.management 在新存储中返回 task-query/v2。它承诺
当前记录和仍明确保留的范围，不承诺完整开发历史。v1 的事实重放／完整历史语义不套用
到 v2。消费者必须识别版本；旧 TraceLens 不认识 v2 时显示不支持或已有旧快照，不拼接。

| 请求字段 | 约定 |
| --- | --- |
| detail | summary（默认）、task、step；旧 full 不冒充新接口，返回 INVALID_QUERY |
| task_ref | 稳定真实 ID 或本副本内无歧义显示编号；省略仅选择唯一当前焦点 |
| step_id | detail=step 必填，选择采用计划的精确步骤 |
| workflow_home | 沿用登记项目内目录的解析与范围限制 |
| offset、limit | 仅 summary 分页；默认 0／20，limit 1..100 |
| expected_view_revision | 后续页必填；所有返回的 detail_request／next_request 均携带该版本 |

task_id、plan_ref 仍不是查询选择字段，误用返回 INVALID_QUERY；查看保留范围通过 task
detail 的 plans 按真实 ref 定位，step 请求只查询当前采用计划。

v2 顶层必需 kind、status=available、detail、workflow_home、view_revision、project_revision、
current_task_id、selection、task_count、lifecycle_counts、coverage、issues。
view_revision 绑定本次实际读取的项目／任务内容；它不是 Git SHA。版本变化返回
QUERY_VIEW_CHANGED，不混合两批结果。读取不写任务、展示、附件、时间戳或回执。

summary 返回 tasks 与 pagination。每项至少有 task_id、display_id、title、revision、
lifecycle、created_at、closed_at、adopted_plan_ref、current_step_id、current_step、source_ref、source_sha256、
remaining_work、detail_request；current_step 无对象时为 null。分页沿用 v1 的 total、
offset、limit、next_offset、view_revision、next_request。身份选择仍用 selection 的
requested_task_ref、task_id、status，未解析不改选另一项任务。

task detail 返回 task 或 null。非 null 时提供当前业务字段、plan（采用计划或 null）、
plans（保留范围）、steps（采用计划步骤）以及现有 origin／dependency／continuation
等关系和 advisory next_*。不返回 creation_key／last_write 等写入元数据，不提供
executions／tests／reviews／dispositions 的历次全文数组。需要旧保留范围时读取 plans，
不因步骤同名混用当前采用范围。current_step_id 在关闭时为 null，work_position 仍可保留。

step detail 返回 task 身份、实际来源路径与字节摘要、采用计划摘要、step 或 null、selection.requested_step_id 和
step_status。step 保留 id、state、execution_ref、execution、review_ref、review_status、
findings、review_choice、disposition_ref 及 tests（checks 的当前结果展示）；各 ref 是逻辑
身份，真实原文入口只使用 source_ref。结论缺失显示未知，不以 null 或 closed 推定通过。
tests 中每项带 applies_to_current_execution：只有存在当前 execution 且引用一致才为 true。
它只表示报告关联目标一致，不认证当前工作区；旧目标的 passed 需显示不适用，不能参与
本轮验证通过。current review 与 disposition 同样不得消费旧 execution 的结论。

coverage 固定说明 storage=task-state、history=not-retained，并用 complete 描述本次任务
记录是否完整可读；分页是否读完由 pagination 表达。不可读／迁移缺口进入 issues，计数
只表示已识别任务，complete=false 时不能声称它是项目完整任务数。

read 继续按明确真实路径分页返回实际字节与摘要；逻辑 plan_ref／execution_ref 不能当路径
使用。可变任务文件翻页期间变化应报告版本变化并重读，不能拼接前后版本。临时来源清理
后如实显示不再保留；旧未迁移来源丢失显示不可用，不改名为已清理或伪造原文。

TraceLens 按真实 task_id 定位 PRODUCT 绑定；plan_ref／step_id 确认范围及步骤。创建和
关闭时间直接读取字段，计划从 task.plan／plans 获取。SourceRef.file.path 使用任务实际
路径，固定 sha256 时仍核验真实字节。采用计划改变后的旧绑定保留原范围，显示历史／
待核对，不把旧结果套给新计划。不改 PRODUCT 的目标、需求、功能点或 Assessment 概念。

宿主可信入口、模块摘要登记、root／副本隔离和只读权限沿用现有约定。模块改动后按实际
可信来源重新登记，不由项目响应自动补发信任。派生文件降级需使用明确可识别的新格式
并标旧快照；不通过遍历旧 journal 或 CURRENT_TASK 补出一份假实时结果。
固定 task-view.json 的新缓存格式为 task-view/v2，必填 workflow_home、view_revision、
project_revision、current_task_id、tasks、coverage、issues；tasks 使用完整当前 task 展示，
不含写入元数据。只有完整可读且同 root／home 的缓存可降级，始终标 stale-or-unknown。
旧 task-view/v1 只在旧 journal 语境使用，不与 v2 查询或不同批次的详情拼接。

## 7. 关闭、Git 与迁移边界

close-task 的一次调用依次保存／回读最终任务结果，确定交付核对所需的明确材料，先
retain 并完成任务最终写入，再保存／复用 PRODUCT 评估或具体 pending 定位，最后 cleanup。
AI 执行正常结项判断，Runtime 按明确引用和目录完成复制、更新与清理，不逐文件评估价值。
评估无法完成不撤销关闭；必要来源尚未安置成功则清理待完成，不假称已全部回收。

正式任务、现有业务文档、测试和明确保留附件按正常授权提交；临时目录与派生展示排除。
Git checkpoint 对可变任务文件采用当前状态检查，取消其“不可变旧事实不得更新”的误判，
不强行收集临时附件。已跟踪旧 blob 的移出跟踪是迁移的一部分，不靠 .gitignore 假装完成，
不重写已有 Git 历史，也不自动提交、推送或部署。

历史迁移先用现有完整 reducer 得到真实任务状态，保留 ID、范围、重要约束、未完成事项
和仍被正式文档引用的信息，再对照结果并处理实际来源。旧摘要不能套到新内容；未知／
歧义内容保留具体缺口及一次性恢复材料。迁移前只读演练，正式切换需后续项目升级步骤。
旧内核、完整历史诊断和归档读取继续作为显式历史入口，不作为新任务管理前提。

## 8. 下一步实现的验收约束

- 同一 Task／范围重复更新 100 次，永久任务文件仍为一份，不嵌入 100 次历史全文。
- 同一 check_id／environment_id 重测替换一个结果，其他环境失败及开放 finding 保留。
- 新 execution 不继承旧 execution 的验证通过或 clean review；关闭允许保留失败及未运行。
- 同步重试不重复建任务／结果；旧 revision 明确冲突，任何重试不重跑业务命令。
- 关闭前先保存最终事实及必要附件；cleanup 成功后临时目录为空，正式 Task 的字节不变。
- 多 Task、迟到 snapshot、resume 与 cleanup 不误删其他任务或新恢复工作产生的材料。
- 无临时 blob 的 Git 新克隆仍能读取任务身份、关联、当前结果、约束和遗留问题。
- TraceLens 的任务关联、采用计划、起止时间、功能点结果和父任务续接保持实际含义。
- 读取／重复关闭／清理重试不增加永久 event、展示历史、来源副本或清理回执。

第一步仅校验本文、合成 JSON、交叉引用与示例身份一致性。第二步的 Runtime 验证如下；
TraceLens、Skill、正式安装及迁移仍需各自验收，示例和源码检查不表示已部署。

## 9. 第二步 Runtime 源码交付（2026-10-29）

实现位于 `runtime/vnext/support/task-state.mjs`，由 assistance.mjs 按实际存储模式分流；
重用既有管理 I/O 锁和原子写入，不导入旧开发准入内核。新模块已登记到分发和迁移源码
清单，并加入原生五模块复制冒烟；本步没有重建发行包或安装到真实项目。

运行 `node --test test/vnext-task-state.test.mjs`：20 项通过。实际覆盖一份任务文件的
100 次更新、不同环境的结果、旧结果失效、开放问题保留、候选／采用范围、幂等和旧修订
冲突、临时报告与捕获、Git ignore、明确保留、清理隔离／失败重试、迟到捕获、旧编辑器
句柄、只读查询、父任务续接、合成契约读取、原生命令行及不含临时 blob 的 Git 克隆。

同一 Task 的 100 次同范围更新未增加文件集合，任务文件只保留一个验证槽位；关闭清理
后正式任务字节和修订不变。清理统计不写永久回执，原始项目文件与他任务文件保留。
这些是隔离样例的行为验证，不是对所有真实项目体积或模型遵从性的测量。

旧任务／辅助服务／展示／固定证据／编码回归 107 项通过。旧归档、读取上下文和 Git
checkpoint 组 73 项通过、2 项因 Windows 文件符号链接能力跳过；唯一初始失败是一个
直接在空项目调用旧 record 的测试，补充 journal 场景标记后定向重跑 1 项通过。
旧模式测试显式建立旧数据目录，不把空项目的新默认路径误当成旧 journal。

`node --check`（新模块与 assistance）、`bun run validate:vnext-source`、新增模块的原生
payload／migration-source 清单检查及 `git diff --check` 通过。未运行 test:workflow-all，
没有创建源码仓库 Task、修改目标项目数据、递增版本、提交、推送或部署。

第三步的消费接通与验证见下一节。第二步完成时，close-task 清理接线、Git-checkpoint 与
安装 ignore 规则尚未接通；第四步交付见第 11 节。旧项目继续使用 journal/v1，数据迁移另行实施。

## 10. 第三步实施与验证（TraceLens 源码，2026-10-29）

`E:\coding\tracelens` 已支持 task-query/v2 与 task-view/v2，保留 v1 消费路径。
新增 task-state.mjs 的字节纳入可信登记与调用前后核验；旧四模块 Runtime 及登记继续可用，
不会自动信任新模块。查询、续页、详情和范围执行缓存均区分协议与视图版本。

任务原文与 PRODUCT 的 SourceRef 使用实际任务文件及 source_sha256；采用计划由任务内
保留范围按真实 ref 定位，步骤编号仅在该范围内解释。创建／关闭时间直接读取任务字段。
Task 详情展示任务目标、交付范围、需求／功能点 ID、实施与验证结果、各环境检查及遗留
问题；旧实施的检查显示不适用，不从关闭或清理生成需求满足结论。原文入口只消费明确
物理来源，计划、执行、复核等逻辑 ID 不伪装成文件。

隔离样例使用本仓库真实五模块 CLI 创建、执行、记录单元通过／真机失败、关闭并清理，
再由 TraceLens 读取。验证身份、PRODUCT 目标支撑与范围绑定、功能点 ID、实际来源摘要、
正式保留附件、起止时间及未解决问题，读取前后任务字节与 mtime 相同。另验证重采用后
同名步骤不继承旧绑定、不可读记录的覆盖缺口、模块改变后的 v2 陈旧快照及跨协议隔离。
真实浏览器在临时合成副本验证清理后的任务与步骤详情、来源入口、桌面和窄屏显示。

此步只适配两仓库源码；未升级真实业务项目、重建 workflow 发行包、迁移旧记录或执行
Git 提交／推送。具体消费测试与重跑命令见 TraceLens 的
`docs/ops/task-state-consumer-validation.md`。

## 11. 第四步实施与验证（close-task、Git、安装规则，2026-10-29）

close-task 模板先完成明确保留及最终任务写入，保存／回读关闭，再执行已授权的局部
交付核对，最后用关闭任务自己的 ID 和最新 revision 调用 cleanup。父任务恢复焦点
不会改变清理目标。必要材料保存失败则报告清理待完成；核对可以保留明确 pending，
不要求 AI 逐文件分类、不启动后台维护、不清理旧 journal。清理不改最终任务字节。
其他任务 Skill 已区分 v1／v2、逻辑引用与实际路径、当前检查与可替换的临时报告槽。

Git checkpoint 接纳可变 Task／项目状态和明确保留的附件，检查直接持久依赖和真实字节；
逻辑计划／执行 ID、临时报告和生成展示不是必须提交的来源。连续真实提交及无临时
文件的克隆可恢复任务身份、功能点关系、失败验证和遗留问题。缺失正式任务保留数据
缺口，被外部修改过的固定恢复副本不被静默移出跟踪。普通提交不遍历全项目历史。

install／upgrade 将任务目录的 byte-exact 与 ignore 规则加入已有原子事务，读取目标
workflow_home，合并可识别规则块并保留自定义字节。规则文件归项目所有，不加入软件
所有权清单；同版本 upgrade 可补齐缺失规则。干跑不写入，冻结／冲突保留原状，失败
回滚软件与配置。不可读任务／展示不成为升级准入条件，也不会被新加的展示规则隐藏。
安装升级不创建 Task、不迁移数据、不清理临时目录或解除旧 blob 的 Git 跟踪。

本步实际检查：

| 验证范围 | 结果 |
| --- | --- |
| `vnext-task-state.test.mjs` + `vnext-task-state-checkpoint.test.mjs` | 27 项通过（20 + 7） |
| `vnext-task-state-install.test.ts` + `vnext-generation-install.test.ts` | 9 项通过；候选包在隔离目录构建，实际执行 Node 安装／读取入口 |
| 原分发安装／升级／回滚定向回归 | 14 项通过；旧 CURRENT_TASK 提交断言修正后单独重跑 1 项，其余 13 项通过 |
| `vnext-git-checkpoint-archive.test.mjs` + `vnext-generation-checkpoint.test.mjs` | 18 项通过 |
| 旧 Git checkpoint 的展示／配置定向回归与删除／paths 定向回归 | 分别 3 项、4 项通过 |
| `workflow-vnext-source.test.ts` | 19 项通过 |
| 三个原生模块 `node --check`、`validate:vnext-source`、`validate:protocol`、`validate:freshness`、`workflow:health --root .`、`git diff --check` | 通过 |

旧安装断言原先把 CURRENT_TASK 当成正式提交文件，现改为检查 ignore，并继续用旧
document-store 文件验证实际 Git／autocrlf 的字节保真。旧 journal 安装样例显式建立
旧数据环境，用交付的 Node 入口操作，安装前后逐字节核对历史；不拿新项目默认模式
冒充旧模式。构建脚本补齐 help／未知参数检查，查询用法不再意外启动默认构建。

验证覆盖真实 Runtime、Git 和安装事务以及安装后的 Skill 文本，不证明模型每次都能
遵从模板。v2 临时 record 不是无任务的永久收件箱；独立 work-item 沿用已授权的收集
文档／入口，缺失时如实报告未保存，不为收集事项擅自创建任务或新增另一套存储。
本步构建过本地测试候选包，未发布、递增版本、提交／推送或安装到真实业务项目；
未运行 test:workflow-all。以上为第四步当时的验证范围；后续验收见第 12、13 节，
第七步正式发行及真实项目升级尚未执行。

## 12. 第五步隔离联合验收（2026-10-29）

已串通候选包安装、100 轮合成执行、父子任务收尾、交付核对、临时清理、软件规则升级、
真实 Git 提交／克隆及 TraceLens 页面。3 个任务正式保存材料共 5 个文件、11,296 字节；
主任务的 204 个临时文件清为 0，最终任务摘要和需求／功能点关系保留。
同时补上中文路径原生删除回归和关闭状态标签修正。具体场景、体积、验证与交付边界见
[第五步联合验证记录](../ops/task-state-integration-validation.md)。第五步当时未执行旧数据迁移。

## 13. 第六步旧数据迁移与副本演练（2026-10-29）

显式管理工具在外部流式备份并逐文件验证后，将旧 reducer 的当前事实发布为 Task 记录；
安装／升级不触发转换，实际任务身份、范围和缺口保持。正式引用的旧原文及必要归档
容器保持路径与 SHA；历史导入日期不冒充任务创建时间，有明确引用的计划防止后续被替换。

TermLink 副本过程存储由 2,803 个文件／182.7 MiB 降至 162 个文件／30.0 MiB，包含新的
51 份 Task 与项目状态。TraceLens 的 308 个业务条目、76 条绑定及功能点范围保持，
原有未知身份／未关联缺口未被抹掉。真实 TermLink 未执行迁移；期间其并行变化另行记录。

工具、恢复验证、精确统计与交付边界见 [第六步副本迁移记录](../ops/task-state-migration-validation.md)。
