# vNext 0.20.6：任务纠错、执行恢复与有界上下文

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

当且仅当当前待审结果是 `REPAIR_BUDGET_EXHAUSTED`，可以在用户明确授权后调用 `prepare-task:extend-repair-budget`。输入绑定精确 `review_id`、当前周期中全部且仅限已耗尽的 `finding_fingerprints`、固定的 `additional_repair_attempts: 1`，以及决定来源和原文。Runtime 为每个 finding 只增加一次额度，并保留现有尝试次数、状态、pending review、累计审查基线、任务定义与身份；默认上限仍为每 finding 两次、每周期三个 repair wave，显式扩展的绝对上限均为八。扩展后同一 blocked review 直接路由到 `execute-step:repair`，新执行结果和验证审查照常消费；它不要求先清空 pending review/findings，也不生成 correction-replan candidate。预算授权集合只决定哪些 finding 可以增加尝试次数，不替代最新审查的完整修复集合；仍有预算的未解决 finding 必须保留，已解决 finding 不得重新安排。

预算阻断不是“没有审查结论”。Runtime 保留 blocked review 中的结构化 `findings`、`unresolved_fingerprints` 和 `blocker`。对旧 0.20.5 状态，如果历史 blocked review 已经把这些字段清空，升级不会从自由文本猜测结论，也不会要求手改 `CURRENT_TASK.md`：先用正式 `upgrade` 完成分发升级，再用 `review-context` 取得绑定当前 execution/target 的新 receipt，重新提交一次带完整结构化 finding、未解决项和证据引用的 `record-review-result`。只有这次审查重新形成精确的 `REPAIR_BUDGET_EXHAUSTED` pending review 后，才允许用户以这次重新记录返回的 `review_id` 和精确耗尽集合调用预算扩展；receipt、task/source revision、execution、change set 和目标路径任一过期都必须重新审查，不能靠重放或改状态绕过。

0.19.1 会沿已确认候选的历史 execution 和后续步骤替代关系承接问题身份，包括旧 v2 候选；三次真实失败后，新恢复步骤的 preflight 仍拒绝。针对同一原报告的多个质疑可分批处理：保留原 result ID，通过已确认纠错结果建立关联，剩余质疑继续阻塞普通推进，每批都需新的结果与审查。

## 安装、升级和兼容

使用发行报告列出的固定 `vibe-governance-0.20.6.tgz`，先核对 SHA-256。可在独立安装目录执行：

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
