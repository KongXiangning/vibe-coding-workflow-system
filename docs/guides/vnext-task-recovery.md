# vNext 0.20.12：任务纠错、执行恢复与有界上下文

## 适用范围

在原任务的目标、验收义务和总写权限内恢复。Task ID、document ID、原始请求、已执行步骤定义及日志保持历史身份；用户决定只追加。目标、验收或总权限变化返回用户决定或不支持结果。归档关闭任务不原地重开。

本指南适用于通用项目；源码交付中的临时夹具验证不代表真实目标项目业务验收。真实目标项目状态为 **待部署验收**。

## 输入分流与证据

沿用 `review-change`、`debug-task`、`prepare-task`、`execute-step` 公共 Skill：

- 无关请求：`route-input` 绑定当前 source revision 和输入摘要，返回既有 capture/owner 路线。
- 历史结论反证：`review-change` 记录真实质疑；不要求当前存在待审 execution。
- 历史执行错误：`debug-task` 诊断，引用确切 execution ID 和证据；无需制造通过报告。
- 目标、验收或权限变化：明确交给用户，不转成恢复权限。

分流关系和确认信息仍为 `caller-reported`，Runtime 校验绑定和权限，不认证真人身份或自动证明自然语言关系。

日常读取使用统一的只读 `task-context` 投影：它返回当前总览、完整当前确认定义（同一可见会话可用精确 definition revision 复用）、当前步骤、未完成义务、已记录依赖、未知依赖提示和全局门禁；不直接展开 RuntimeState、完整 `execution_log` 或 `applied_proposals`。`task-read` 只按精确对象、事件、报告或历史 revision 读取，历史按需分页。`validate --summary` 只核验当前聚合，`validate --deep` 才遍历完整事件和对象历史；读取收据只证明版本与返回范围，不授予写权限。

迁移是独立的存储维护动作：先执行 `task-storage-migration` 的 `preview`，再用仍匹配的 `source_revision` 明确提交。迁移保留旧 CURRENT_TASK 原字节、旧 locator 与已读到的历史材料；无法证明的缺口保持缺失，不补造结论。受管任务数据位于 `<workflow_home>/task-data/<document_id>/`，分发升级不会删除目标项目拥有的 `task-data`。

粘贴文本可经 `ingest-evidence` 提交 `source_revision`、`source_locator` 和 `body`。Runtime 保存内容寻址正文及来源对象，返回引用和 SHA-256。禁止任意绝对路径读取。单对象上限 1 MiB，单次快照上限 8 MiB、128 个文件；旧正文通过有界 `file-context` 读取，不把整个历史包送入模型。

## 准备、确认和执行

1. 读取当前本地 Runtime context。若已有 preflight、部分写入或待审结果，先 `suspend-recovery` 绑定来源、原因和证据。它保留真实尝试、累计 diff 及未审路径；存在审查 finding owner 时先走原 finding 路线。
2. `prepare-replan` 生成 `correction-replan-candidate/v2`。支持 `conclusion-correction` / `execution-recovery`，策略为 `forward-fix` / `artifact-restore` / `mixed`；最多 16 个目标和 16 个恢复步骤。旧单 challenge 输入可规范化，新行为必须用 v2 receipt。
3. 审阅候选的 source tuple、Basis/计划 revision、全部旧义务去向、历史完成引用、结果影响关系、证据接收、写入步骤和精确 restore plan。准备阶段不改变现行定义或活动位置。
4. 用 `confirm-replan` 提交精确 receipt 和 caller-reported 决定。任何来源、候选、证据或写入计划漂移使确认失效；不需要的候选用 `discard-replan` 丢弃。同一时刻仅一个未确认批次。
5. 通过普通 `preflight-step`、执行、`record-step-result`、`review-context`、`record-review-result` 和 `complete-reviewed-step` 完成恢复。全部步骤已完成而尚未结项时，可以尾部追加恢复。

### 宿主调用中断后的执行续接

`preflight-step` 一旦成功提交，Runtime 就会把本次执行的
`execution_id`、`preflight_id`、attempt、计划 revision、精确候选路径、change
set 和审查基线保存在当前任务中。若宿主调用在返回 receipt 前结束，下一次调用直接以
`{}` 执行 `resume-preflight`，使用它返回的同一 receipt 继续真实命令和
`record-step-result`；该入口只读，不新建 attempt、不扣 retry/repair/finding 预算，
也不要求为了重建 receipt 重跑业务命令。

升级 0.20.5–0.20.15 的旧任务时，Runtime 只从同一 `preflight_id`、当前
`source_revision` 和已提交的 `record-step-preflight` proposal 恢复；缺少完整证据时返回
结构化 `execute-step-preflight-decision`，不能从自由文本或 Git diff 猜候选路径。用户明确
选择 `not-started` 或 `started-unknown` 后，调用 `reconcile-preflight` 记录决定并清除悬挂
准入，再重新 `preflight-step`/`begin-repair`；不会伪造 receipt、结果或预算。宿主的 token、
时间和工具次数属于调用承载层，不是 vNext 任务预算；调用结束只意味着稍后续接，不改变任务状态。

### 已授权的增量范围延续

当 `execute-step` 发现确实需要新增文件，但用户已经明确授权了这一次精确增量，可由用户在后续独立调用公共 `prepare-task`，模式为 `amend-scope`。这条路线是独立版本化的 `scope-amendment-candidate/v1`，保留旧 `correction-replan/v2` 的 `permission_change: none` 语义。调用者提交精确的新增路径、可选的持久测试路径，以及原授权的来源和原文；若缺少 exact-path 授权，Runtime 只返回缺失路径并停止；若授权已存在，Runtime 生成候选 digest/receipt 并在同一路由内完成提交，不把 digest 当成第二次用户批准对象。

它可以消费 `blocked_by_replan`、已有代码改动、admitted/in-progress finding 和 pending review。提交后写入新的延续步骤，旧步骤定义、失败和未完成义务、finding、累计审查基线、review cycle 与预算都保留；不会清空 pending review 或重置 review cycle。用户随后仍须独立调用 `begin-repair`/fresh preflight、真实执行、重验、`review-change` 和后续步骤推进，直到 `close-task`；只有 amendment 成功不代表完成。若路径、授权来源或候选内容漂移，Runtime fail closed。

公共 Skill 只返回可受理的 `prepare-task`/`amend-scope` 下一步建议，不在当前调用中自动串联或要求用户手工构造 receipt/authority transition。
若修订承接的是无 finding 的 clean pending review，用户随后调用 `complete-reviewed-step` 指向原步骤；Runtime 只消费这条已保存的 clean review，并把新延续步骤保持为 ready，仍须独立 fresh preflight、执行和新审查。

结论模式必须同时满足原任务 mutation scope 和项目声明的非可执行边界；`docs/`、扩展名或阅读清单本身不授权写入。执行模式也不能扩大原任务写集。

`pending_step_changes` 只替换从未执行且未 preflight 的后续定义；挂起的已预检步骤保留旧定义，以新 ID 映射其未完成义务。每个旧 claim/slot 和被替换步骤必须有具体去向。改检查方法时用新 check ID 和 `replaces_check_id`，保留原需求、subject paths 和 required boundaries。新 before-step 消费者需要新的前置验证与消费关系。

多目标可以部分准备，未处理的质疑保持未解决并阻止普通推进/结项。证据不成立时，可用独立评估证据驳回；不应为获得恢复入口虚构错误。

## 精确产物恢复

保护版本 2 的任务在步骤 preflight 和真实结果边界保存受管文件前后像；`artifact-checkpoints` 列出 checkpoint，只有现行治理状态登记的 committed checkpoint 可用于恢复。它绑定 task、step definition、execution/attempt、阶段与文件状态，区别于累计审查 first-touch baseline。

候选的 `restore_plan` 指明 checkpoint ID、确切文件集、当前预期哈希、目标哈希或 absent。prepare/confirm 不修改产品。恢复步骤须声明 `runtime:artifact-restore` command footprint，preflight 后用 `apply-artifact-restore` 提交当前 receipt。随后仍须真实检查、记录和审查。

从 0.19.1 起，Runtime 在删除恢复 journal 前保存绑定候选、attempt 和 preflight 的 `artifact-restore-completion/v1` 不可变凭据。记录成功结果和完成审查步骤时，必须同时存在该凭据且文件仍匹配恢复目标；调用者填报命令通过不能代替回退。对恢复路径的前向修改放在下一个恢复步骤。失败结果仍可如实记录。旧活动恢复缺少凭据时明确阻塞，升级不会补造历史执行事实。

仅支持仓库内有界常规 UTF-8 文件及新增/删除状态；符号链接、子模块、二进制、超限内容、远端副作用无通用回退。任务/Basis/历史、Runtime 安装目录及 `.git` 均排除。无 checkpoint 时只能前向修复或报告缺口；当前内容漂移时阻塞并保留用户修改。

多文件恢复采用持久 journal 和精确前像；失败尝试回滚，进程中断或无法证明一致时 fail closed。遗留 `.vnext-artifact-restore.lock` 或 `.vnext-governance-write.lock` 必须保留供诊断，不能直接删除后继续，也不能用 reset/clean/无条件 checkout。此版本不提供自动清理故障 journal 的公共命令。任务记录从不随产品回退。

## 证据承接与预算

`evidence-carry-forward/v2` 固定原始 report/result/计划来源，B、C 计划仅新增接收关系；不会把 A 报告改成 B 原生执行。消费时校验正文对象、报告与 check 定义、subject 和环境配置，以及未解决反证。正文哈希不变不代表结论有效。

同文档部分改变时保留旧正文和其他分析，但绑定整份文档的旧 slot 可能需要局部重新验证；没有自动条目级语义等价证明。v1 凭据缺少可验证正文来源时阻塞相关承接，需重新验证该 slot。材料引用、证据复用、历史完成承接分别记录。

累计审查基线和未审 diff 不清零，新改动需要新审查。候选次数按稳定问题身份累计，原失败尝试及 finding repair budget 保留；跨恢复计划的同问题失败和修复 wave 继续计数。达到预算返回诊断/用户决定，不通过改文件名或恢复 ID 重试。

当且仅当当前待审结果是 `REPAIR_BUDGET_EXHAUSTED`，可以在用户明确授权后调用 `prepare-task:extend-repair-budget`。输入绑定精确 `review_id`、当前周期中全部且仅限已耗尽的 `finding_fingerprints`、固定的 `additional_repair_attempts: 1`，以及决定来源和原文。若仅 repair wave 周期额度耗尽而 finding 仍有尝试次数，可显式传 `extension_scope: "repair-round"` 与空目标集合；Runtime 只追加一个周期额度，不改变任何 finding 的尝试次数。Runtime 为 finding 目标只增加一次额度，并保留现有尝试次数、状态、pending review、累计审查基线、任务定义与身份；默认上限仍为每 finding 两次、每周期三个 repair wave，显式扩展的绝对上限均为八。导航与事务使用同一资格判定：候选下一轮必须不超过 8，且每个被授权的耗尽 finding 必须低于 8 次；达到任一绝对上限时，`task-context` 不再推荐不可执行的扩展，而是返回结构化阻断原因和用户自有的诊断/受控恢复决策路线。扩展后同一 blocked review 直接路由到 `execute-step:repair`，新执行结果和验证审查照常消费；它不要求先清空 pending review/findings，也不生成 correction-replan candidate。预算授权集合只决定哪些 finding 可以增加尝试次数，不替代最新审查的完整修复集合；仍有预算的未解决 finding 必须保留，审查结构化确认已解决的 finding 会在同一 Runtime 事务中结案，不得重新安排。

预算阻断不是“没有审查结论”。Runtime 保留 blocked review 中的结构化 `findings`、`unresolved_fingerprints`、`resolved_fingerprints` 和 `blocker`；`resolved_fingerprints` 会同步更新 finding queue，不能只留在文字证据里。对旧 0.20.5 状态，如果历史 blocked review 已经把这些字段清空，升级不会从自由文本猜测结论，也不会要求手改 `CURRENT_TASK.md`：先用正式 `upgrade` 完成分发升级，再用 `review-context` 取得绑定当前 execution/target 的新 receipt，重新提交一次带完整结构化 finding、未解决项、已解决项和证据引用的 `record-review-result`。只有这次审查重新形成精确的 `REPAIR_BUDGET_EXHAUSTED` pending review 后，才允许用户以这次重新记录返回的 `review_id` 和精确耗尽集合调用预算扩展；receipt、task/source revision、execution、change set 和目标路径任一过期都必须重新审查，不能靠重放或改状态绕过。

当普通扩展已因周期或单 finding 的八次上限不可执行，用户可走独立的受控恢复授权；八次是切换到显式授权路线的阈值，不是停止修复的终态。审查结果可为仍需处理的 Runtime-admitted finding 写入结构化 `finding_dispositions`（`must-fix`、`normal-fix` 或 `defer`，并绑定 basis/evidence）；它们为用户选择提供依据，但不强制所有耗尽项都归类为 `must-fix` 或进入本次 grant。用户调用 `prepare-task:authorize-controlled-repair-recovery` 时提交精确的 `review_id`、非空且已准入的修复目标子集 `recovery_fingerprints`、`recovery_basis`、`decision_source`、`decision_text`、`evidence_refs`，以及可选的正整数 `additional_controlled_repair_waves`（省略时为 1）。Runtime 自动绑定完整最新修复集合、task/document、execution、cycle、change set 与 review target revision。授权记录有限数量的、各自可审查的 controlled repair wave，并可沿同一 execution/change-set/cycle 绑定继续后续审查；每个选中 finding 的普通尝试次数仍按原值累计，受控消费不能超过本次授权额度。普通尝试次数、周期次数、历史证据和审查基线均不重置。

受控授权集合与本轮修复集合严格分离：仍有普通预算的未解决 finding 仍进入完整修复集合，已验证解决项不会再次进入，审查新发现必须先经过正常 finding admission，不能因受控授权自动获得权限。未入选 grant 且普通预算耗尽的 finding 保持开放；用户可在授权前后通过 `record-user-decision` 明确延后、拒绝或接受风险，或者提供另一个适用预算。在其获得预算或结案前，完整 repair wave 不会遗漏它并直接执行。精确授权重放为 no-op；过期 review、越权目标、重复增额、超出受控次数、重建任务、supersede 或直接改状态均拒绝。没有结构化 disposition 的旧 blocked review 也可在用户明确列出 exact target/basis/evidence 后使用 legacy-explicit-user 桥接，且只为选中的目标增额。Runtime 不从自由文本推断。

每 grant 五个 wave、每 finding 五次受控尝试、每 review 一个 grant 是强警告阈值，不再是用户继续授权的硬拒绝。请求跨越任一阈值时，先以 `record-user-decision` 登记单独的 `continue-after-warning`：绑定当前 `review_id`、`change_set_id`、`gate_code: CONTROLLED_RECOVERY_LIMIT`，用排序后的 `target_ids` 精确列出本次选中的 `finding:<fingerprint>`，并以 `authorized_repair_waves` 绑定用户批准的具体 wave 数；保留用户原文和证据。再将该决定的 `idempotency_key` 作为 `warning_decision_id` 提交受控授权。Runtime 只能消费这条警告决定一次，记录新的累计受控尝试上限和有限 wave 配额，旧 grant、历史次数及审查事实不重置。仍有可用 wave 的同一授权或尚未完成的 repair preflight，须先执行或恢复，不能并发签发相互争用的 grant。

范围外发现也能登记：`review-change:record-review-result` 会保存 finding，并标注历史性的 `repair_scope_hint: outside-current-authority`，不因此授予修改权限。用户决定暂不处理时，用 `record-user-decision` 将其置为 deferred、rejected 或 accepted-risk；若决定修复，则单独记录 `authorize-mutation`，以排序的 `exact_paths` 指向当前 pending review 中的 finding 文件，同时绑定 `review_id` 和 `change_set_id`。然后调用 `prepare-task:amend-scope`，在 `authorization` 中传入该决定的 `decision_id`；Runtime 将决定 ID、review/change-set 绑定保留在 scope-amendment candidate、candidate receipt 和提交审计中，并在准备与提交两个阶段重新核对当前 pending review。审查已结束或绑定发生变化时返回 `SCOPE_AMENDMENT_AUTHORIZATION_CONFLICT`，必须记录一条新的 review-bound 决定；Runtime 复用原文、验证路径，并沿既有 scope amendment 路线检查路径安全、计划和执行结算后，才允许实际改动。审查事实、用户决定与修改权限分别保留审计记录。

`FORMAT_CHECK_SCOPE_BLOCKED` 只适用于授权可修改业务文件中的格式失败。若整树格式检查只命中不可变或哈希绑定的治理证据（例如 Task Basis、Runtime 管理状态、逐字授权原文），它不是业务阻断：保留原始字节、哈希和失败命令作为历史证据，对授权业务路径执行 scoped check，不创建该 blocker，也不要求用户为排除治理文件走 evidence-plan amendment 或 waiver。哈希绑定保护的是授权记录的完整性，不会把行尾空格提升为产品验收义务。历史上已经登记的 format blocker 仍如实保留，但可由一次遵守范围规则的 fresh review 对账；业务可修改路径自身的格式失败仍然阻断。

当同一执行同时触发多个流程警告，可在一条 `record-user-decision` 中记录多个不同 `gate_code` 的 `continue-after-warning` effect，逐一绑定精确目标；消费时每道门只核对对应 effect。`REPAIR_BUDGET_EXHAUSTED` 或 `NEW_FINDING_WAVE_BUDGET_EXHAUSTED` 的 blocked review，可用匹配的决定对选中的 finding 继续 `begin-repair`，审查原始 blocker 保留，不能伪造 clean。普通及 repair preflight 的授权 ID 必须随恢复、扩展和结果登记留在同一 execution identity 上。

若任务处于 `blocked_by_replan + active`，用户决定停止时，先调用 `record-user-decision`，单独记录 `cancel-replan-block` effect，`target_ids` 为 `["gate:blocked-by-replan"]`。Runtime 只将 workflow 状态恢复为 active，保留 pending review、finding 和证据；再用新的当前 revision 单独记录 `close-with-exceptions`，最后按 `stopped-by-user` 归档。导航会提供该决定入口。

### Repair 结果登记与格式检查范围

Repair 执行结果与步骤进度是两个事实。步骤已经处于 `completed`、等待 verification 时，repair 的失败命令或阻断验证以 `execution_result.outcome: blocked` 如实写入；步骤进度仍保持 `completed`，原 pending review、repair preflight、execution、change set、finding 和证据绑定保留。普通步骤的 `completed -> blocked` 仍按原状态机拒绝。若旧版本曾在登记结果前先写入 repair attempt，升级后的 Runtime 会识别同一 `repair_wave_id`，精确重试不重复扣尝试次数或消费 grant；有 retained preflight 时 `task-context` 返回 `execute-step:repair`，`begin-repair` 只重建同一 receipt，随后用原 receipt 重新提交结果。已有不同结果的同一 execution identity 不得覆盖，必须取得新的 repair preflight。

`git diff --check` 等格式门禁必须明确其检查对象。业务交付文件与 Runtime 管理的 `CURRENT_TASK`/Task Basis/逐字授权证据是不同对象：Runtime 不会删除、修剪或重写授权原文，也不会因为其中的行尾空格把整树结果伪造成通过；原整树检查结果和其证据仍保留为历史失败。但这类仅命中不可变治理证据的失败不阻断业务验收，也不要求用户为排除治理文件走 amendment；后续按授权业务文件执行 scoped check 即可。业务文件本身存在空白错误时，scoped check 仍必须失败，不能用“治理文件排除”掩盖。
如果该格式命令本来就是已计划的只读命令、但从未绑定 evidence slot，不得虚构 slot 或引用其他 slot；在同一正式路线中使用 `unbound_read_only_command_replacements`，为精确的旧/新命令提供逐项理由。Runtime 只接受 active/future、`expected_repo_writes: none` 且新旧命令均不属于任何 slot 的修正；它不创建 waiver 或 evidence，旧失败执行保持历史，新命令必须重新执行并重新 review。

0.19.1 会沿已确认候选的历史 execution 和后续步骤替代关系承接问题身份，包括旧 v2 候选；三次真实失败后，新恢复步骤的 preflight 仍拒绝。针对同一原报告的多个质疑可分批处理：保留原 result ID，通过已确认纠错结果建立关联，剩余质疑继续阻塞普通推进，每批都需新的结果与审查。

## 安装、升级和兼容

使用固定 `vibe-governance-0.20.12.tgz`，先核对 SHA-256：

`123FBA6E9B7778F52F71EC5C26B7A15938CE63E6E45D4F087127E44267F5F4D2`

可在独立安装目录执行：

```powershell
npm install --ignore-scripts --no-audit --no-fund <固定tgz绝对路径>
.\node_modules\.bin\vibe-governance install --root <目标路径> --json
# 已安装目标使用 upgrade：
.\node_modules\.bin\vibe-governance upgrade --root <目标路径> --json
node <目标路径>/.workflow-system/runtime/dist/cli.js validate --root <目标路径>
```

软件 upgrade 不重写活动 CURRENT_TASK/Basis，也不直接覆盖已安装目标的 `dist/cli.js`；分发事务只更新受管文件并做 read-back。旧状态可读；需要恢复写入时，先通过本地 CLI `initialize-preservation` 提交当前 `source_revision` 和 `basis_revision`，保全原字节后显式设置保护版本 2。对预算阻断旧状态，按上一节用新 receipt 重新记录结构化审查，不得由文字证据自动推断已解决项。旧 receipt 不授权新协议，未知版本 fail closed。已写入 v2 状态后，不支持直接降级 0.18.7 继续写任务；保留发行包及历史，前向处理兼容问题。

## 真实目标部署后验收清单（待部署验收）

- 核对固定包 SHA、安装版本、内部 Runtime/契约版本及目标平台。
- 核对 upgrade 前后活动任务/Basis 字节；显式初始化后核对不可变原像、身份、原始请求和活动位置。
- 用目标授权的真实问题核对输入关系；确认反证不扩大产品权限。
- 审阅目标的全部旧义务去向、恢复步骤和必要持久测试准入决定。
- 复核多目标及部分成立反证；未处理项不得被自动驳回或结项。
- 如需产物恢复，先审阅目标 checkpoint、精确文件集、漂移保护及平台文件锁行为。
- 实际执行恢复后检查、必要审查、前置证据再次消费和剩余步骤，再独立判断业务验收。

源码测试环境为 Windows。Linux/macOS 尚需运行相同的锁竞争、rename、部分恢复、中断 fail-closed 和固定包安装链；Windows 结果不代表这些平台已验收。

## 0.19.2 补充边界

- 恢复步骤的 raw `apply / step-progress` 同样要求当前受管 preflight；换步骤身份无法绕过累计失败预算。已经准入的尝试仍能如实记录失败。
- 原报告的剩余质疑可跨越交错的多轮纠错，通过真实结果和 clean 审查完成快照建立有界关系；原报告和质疑 result ID 保持不变。
- 回退已成功但随后环境阻塞时，先 `retry-step`、新 `preflight-step`，再调用 `apply-artifact-restore`。Runtime 验证当前精确目标和原 v1 完成事实，生成绑定新尝试、直接引用原事实的 `artifact-restore-completion/v2`；不重复改写产品。缺失原事实或用户修改导致阻塞；仍须新检查和审查。

发行验证见 [0.19.2 报告](vnext-task-recovery-release-0.19.2.md)。P2 活动执行恢复批次互斥限制仍保留。

## 0.19.3 交错顺序承接

多轮纠错同时承接选中质疑的原报告与该批实际替换的报告。实际替换关系只从已验证的候选来源历史正文与真实执行、clean 完成记录建立；历史缺失或篡改时拒绝。原质疑 result ID 不改写，未处理质疑继续阻塞普通推进。见 [0.19.3 发行报告](vnext-task-recovery-release-0.19.3.md)。
