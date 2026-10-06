# maintain-project v1 本轮可靠性交付证据

日期：2026-10-05。本轮工作计划是 [hardening-plan](../vnext-project-maintenance-hardening-plan.md)，权威仍为既有 requirements、document-contract 和 API。结果仅覆盖下述实际检查，不继承 2026-10-04 的首版或旧审核 PASS。

后续审查发现的 R01～R04 已按用户“继续修复这4项P2”实施；最新产物与结果见本文末尾的“后续四项 P2 修复”。前文保留首次交付的结果和当时限制，不作为最新产物摘要。

## 基线与实际交付

- worktree：`project-goals-requirements`；分支：`codex/maintain-project-v1`。
- 开始及交付时 HEAD：`20ba0275270493b94b4f02eca33cc3b8c38b198d`。没有 reset、源仓库提交、推送或部署。
- 初始只有未跟踪 `docs/ops/vnext-maintain-project-hardening-plan.md`。它与 Downloads 中提供的文件 SHA-256 均为 `7a33e04a8794c51bd9df7beef2f99bd218068735d6baec4fbf5dc0c6b36590af`，先原样移动到用户指定 ops 路径，最终仅补状态链接。没有覆盖已有代码修复或用户编辑。
- 检查了 AGENTS、适用 vNext 规则、冻结注册及目标标记；没有冻结目标。本仓库仍未创建 PRODUCT。
- Node `v24.12.0`、Bun `1.3.10`，Windows。源构建使用 Bun；已安装 helper 和离线消费只用 Node。
- 本地未发布候选 `0.24.1`。保持既有版本锁步和同版本内容不可覆盖规则；同步 root/Distribution/Runtime package、Runtime lockfile/contract 和 kernel 的版本常量。kernel 只改版本行，assistance/task reducer 没有改逻辑。

真实 assistance 分配一个源实施 task：`task-05b880c9a4288ad327c5302992c6eb7c`（TASK-011），一个候选计划组织 A/B/C 三阶段。[准备结果](checks/implementation-task.json)、[A](checks/task-A.json)、[B](checks/task-B.json)、[C](checks/task-C.json)和[最终回读](checks/implementation-task-status.json)记录了事实和关联：三条 execution 已保存，association=applied；未自动 adopt/focus/close，新 task 仍 draft，既有 task 不处置。源 CURRENT_TASK 是原 legacy/drift，投影部分完成且旧字节未改；实时状态由 task-status 重建，不把这一缺口伪报为显示已修复。

## 代码、契约与流程改动

| 位置 | 实际改动 |
| --- | --- |
| writer.ts | 版本先核对，统一 content/updates/append 的 old→next 检查；同 ID/type、已知跨文件重复、dismissed 同源/等价关系保护；独立 remove_fields；实际受影响坏项可合法修复；局部正文和邻项 AST 落点写前核对。 |
| paths.ts / catalog.ts | 遗漏与硬预算停止分开；明确缺失、选中 entry、相关 junction/目录及预算进入 omitted；其他可读路径继续；实际 paths/excluded_paths 与结构数量单列，不枚举所有 source_paths。 |
| cli.ts / offline-reader.ts | 可用服务与请求完整性区分；漏读返回非零退出码且保留可读条目，未启用仍是正常 not-enabled；check 的 partial 与离线遗漏一致。 |
| schemas.ts / API / document-contract | 仅新增 file-operation 的 remove_items、remove_relations 精确删除声明，补足原协议无法区分删除与重试遗漏的输入；它们不是批准或 force，也不跳过身份、迁移、历史和 I/O 保护。文档版本仍 v1/v2，result/request envelope 仍 v1。 |
| requirements / 六类 references / 主 Skill | 保留 VPM-01～25，补目标材料、退出与共享风险、工作分解、多对多、探索结果、排序/前提、外部反证、历史当前范围、讨论决定及重试。主 Skill 只加共用路由/结果规则。 |
| 原测试、生成资产和使用文档 | 原产品测试增加六组功能回归；安装测试扩展实际 Node 正反行为；所有 dist、Schema、契约副本从源重建。指南明确本地候选尚未发布。 |

没有新增 task 状态、审批、维护 gate、第二模型、KPI、自动排期、完整需求树或全项目迁移。没有修改 LawAgent、TermLink、TraceLens、fixflow 或其他真实项目。

## F01～F06 本轮对照

原审核临时 JSON 没有取得；以下是本轮隔离重建的原行为。[原 bundled Node 9 组探针](checks/baseline-node.json)保留实际请求、退出码、结果和字节摘要；[基线 RED](checks/baseline-red.txt)为 6 fail（预期的缺陷复现），不是通过。修复过程的[Node 对照](checks/fixed-node.json)、最终[24 项回归](checks/product.txt)及[66 个安装断言](checks/install.txt)分别保留；后续补充 null 历史 TaskRef 和已知跨文件身份保护也在最终套件中。

| 问题 | 基线实际行为 | 本轮处理与正反证据 |
| --- | --- | --- |
| F01 | content 同 ID 换成 goal、无新依据激活 dismissed、v1 无 migrate 写 v2，均 exit 0/saved。 | 全输入共用身份/迁移/历史保护；危险候选 failed 且原字节不变。合法整文件正文、明确删除/替代、选定显式迁移可 saved。已知其他登记文件的 ID 不能新增第二定义；移动仍有已授权普通工具路径。见 F01 组与 installed hardening 检查。 |
| F02 | 同源数组换序激活 dismissed，exit 0/saved。 | links 与 task_bindings 都按来源集合比较；换序、重复、对象键序、仅理由/显示信息、来源子集均不能恢复。更换等价 ID、漏掉 dismissed 也拒绝；null TaskRef 的相同位置不因显示备注/hash变成不同关系。当前明确改变决定的 text 来源可合法重新关联，原否定保留。 |
| F03 | overall saved，但 file unchanged，assessment_id 实际仍在；未执行删除。 | 无 metadata 的 remove_fields 真正删除；缺字段 unchanged；先合并再删；id/type/必需字段删除 failed。原 assessment/history 留存。安装后 Node 同样回读字段消失。 |
| F04 | 明确缺失和真实 Windows junction 跳过后 coverage.complete=true、exit 0。 | 请求范围 complete=false，omitted 列明确路径；独立 REQ 仍读到。有效目录零匹配 glob、明确排除、正常范围可 complete=true；坏条目是字节完整/结构部分不可用。Windows junction 实际执行，策略仍跳过。CLI/离线同一缺口均 exit 1。 |
| F05 | 合法 content 删除选中未知字段仍 failed/INVALID_ITEM_CHANGED。 | 从真实差异识别选中坏项，合法修复 saved；另一坏项完整 YAML/正文原字节保留，继续 unusable。改变无关坏项、身份或迁移保护仍 failed。含坏邻项的 null 关系数据也不拖垮未改原文的合法修复。 |
| F06 | 局部 body 尾部用普通二级标题越界，仍 exit 0/saved。 | 保存前解析实际 body/邻项，根二级越界、吞邻项的未闭合结构、目标身份变化 failed 且原文件不变。三级约束、代码/引用/列表伪标题以及合法整文件附录可保存。 |

上述通过只说明具体格式、定位、历史和保存行为。source/hash 改变不证明否定已被业务上推翻，宿主仍解释实际新依据；删除不是永久禁止，已明确选择不再逐字段确认。无法可靠定位原身份/根级 AST 时保留字节，采用已有授权的原文修复，而非禁用项目。

## S01～S13 覆盖映射

确定性回归不替代业务判断。当前宿主 Agent 实际读取合成 brief/interview/decisions、候选正文和报告后生成请求，再使用已安装 Skill/helper/assistance 保存、回读；临时 host.mjs 只是通用调用/记录器，没有业务答案判定分支。每个 tag 可在[逐次真实工具记录](host-agent/observations.jsonl)定位；[最终数据快照](host-agent/snapshot/)及[最终候选读取](host-agent/delivery-final-readback.json)保留正文与定位。所有输入、金额代码种子及决定都是合成测试材料，不能作为生产事实。

| 场景 | 保留／修复／补流程 | 本轮验收与具体边界 |
| --- | --- | --- |
| S01 目标与结果材料 | 保留 goal/body/sources；update/reconcile 补区分调口径与替代。 | inventory/当前快照：G-REGISTER retired→G-TRIAL，注册保留、奖励延期、试用引导新增；90/18 材料口径未知，不判达成。不新增 KPI/goal assessment；数值调整的所有分支未穷举。 |
| S02 退出与共享风险 | 原 scope/历史/局部影响保留，补 update/reconcile。 | REQ-COUPON retired；支付/退货 current、共享金额风险待核对；旧失败材料保留，无自动删除代码或清理 task。没有实际支付/退货实现验收。 |
| S03 分解层次 | 保留 work_items/稳定 ID，补 plan/update。 | REQ-BOOK 一个要求、BOOK-CHECK/NOTIFY/FEE 三工作项；E6A/B 以同一真实 task＋step 引用。独立需求拆合未逐枝宿主实测；合法 append/替代和身份保护由回归覆盖。 |
| S04 范围多对多 | 保留 TaskBinding，无中央重复状态，plan/reconcile 补例。 | binding-only-retry：同一权限 task 分别绑定权限、审计操作人字段；停止后完整审计仍未通过。任务不是完整覆盖量或完成率。 |
| S05 未知与探索 | 保留 exploration/verification 角色，补计划和设计分支。 | LOG-PROBE 真实 task，接纳合成“方案不可行”观察后结束探索、DES-LOG retired，REQ-LOG current 未交付；没有硬件断电或新探索子系统。 |
| S06 插入与顺序 | 保留 stable work IDs、added/deferred、order/prerequisite。 | plan-and-repair/correct-order-direction：审计导出 inserted，REPORT-OPT deferred；操作记录为真实前提，紧急程度只决定排序。初次排序方向在本轮纠正，旧请求及 preimage 留存。 |
| S07 外部失败/E6 | 保留 assistance/assessment/pending；修 A 底座与流程。 | 外部报告不补验证 task；Agent 本地整数 exit0、小数 exit1，修后两者 exit0。binding-conflict 后只补关系；E6R 新 task＋计划/历史绑定，不重开 A/B，不替换 C。 |
| S08 历史与当前修复 | 保留 retired 和范围化 repairs，补来源解释。 | REQ-CSV 始终 retired；R 只服务当前 Excel 样本，repairs 不指认引入者。兼容/其他格式/生产缺陷未验证，纯历史不自动创建修复。 |
| S09 多议题讨论 | 保留 capture/discussion，补局部采纳/失败恢复。 | raw-before-upgrade→discussion-unsaved→discussion-saved 复用原文，不再 capture。只有错误行号/原因进入 REQ-ERROR，云和多设备保持候选/否定区别；作者/日期未知，归档发布指令未执行。 |
| S10 否定与重新关联 | F01/F02 实现＋discussion/recovery 方法。 | discussion-repeat-rejected：同源重复拒绝；current-decision-reassociate：当前合成明确改变决定可恢复候选 G-CLOUD 关系，保留 LC-IMPORT 否定和 discussion-before 原文。不是云功能被采纳。 |
| S11 长约束 | F06 实现＋update/recovery。 | body-escape-rejected 后用三级章节 separate-reconciliation 保存；最终 REQ-LOG 保有原始数据/诊断约束，不泛化为禁止全部联网。未做真实联网行为实测。 |
| S12 worktree/重试 | 复用版本、根标识、单文件发布；补恢复说明。 | [实际 Git worktree](host-agent/worktree-check.json)同 project_id、不同未提交正文 hash/root，不合并；过期 binding 请求不覆盖，task数始终4。外部编辑器全面 CAS、强事务和业务自动合并未实现。 |
| S13 手改/坏项/缺失 | F03/F04/F05＋inventory/recovery。 | selected-raw-repair 删除 REQ-HAND 未知字段，不回滚业务正文；REQ-BAD-KEEP 未改仍 unusable。新旧 Node、实际 junction、缺失 entry、离线诊断回归均可追溯。未知移动位置/根级坏身份需按已授权范围原文定位，不全盘搜索。 |

四条验收流为：目标/计划（S01/02/03/05/06）、交付/E6（S04/07/08）、讨论/决定（S09/10）、故障恢复（S11/12/13）。这不是新增四个长期框架或十三个 task。合成业务共用四个真实 native task；[最终 task-status](host-agent/final-task-status.json)全日志回读四个 closed，不代表完整产品 PASS。E6C 没有 task。

需求 REQ-EXCEL 的定义摘要始终 `ce620df7436d3a0b7eee1dd06f14b4a41f765a88808c3b2d87eb6542bcf52be3`。原 AS-INTEGER/整数 PASS/小数 FAIL 保留；修复 close 后仍先显示 AS-INTEGER，随后独立对账选择 AS-DECIMAL。新摘要只覆盖两组实际样本，外部报告版本未知仍在 pending_sources；支付退货、所有金额格式、导出和生产对象不被局部 PASS 遮住。[原始检查](host-agent/snapshot/docs/evidence/actual-checks.json)记 before decimal=1、after integer/decimal=0 及真实前后代码 SHA。

## 四层结果与命令

| 层次 | 本轮实际结果 | 不代表的结论 |
| --- | --- | --- |
| 源码/契约 | 产品 24 pass/0 fail/195 assertions；source 19 pass/0 fail；registration、protocol、freshness 通过；gen:all 从源生成，旧 generated 结果无手改。 | 无独立审查，无任意 Markdown/编码变体或所有模型语义保证。 |
| 分发 | build:vnext-runtime、build:vibe-governance-distribution 成功；既有 distribution 定向 7 pass，bootstrap 定向 2 pass。最终包含 helper/Skill/六 references/模板/Schema/契约/离线 reader。 | 未跑 npm/tgz 打包安装、未发布，不意味着业务项目已升级。 |
| 安装 | 安装回归 1 pass/0 fail/66 assertions，实际目标 Node 正反行为。另从本基线重建旧候选 0.24.0，真实新装→最终 0.24.1 upgrade；[11项业务资产](host-agent/upgrade-assets.json)全部前后 SHA 相同。 | 旧包为指定 Git 源码重建的候选，不冒称 npm 已发布版本；仅隔离目录。 |
| 宿主/消费者 | 本会话真实宿主工具调用和判断＋实际金额反例/修复；最终读取 9 文件、27 usable、1 invalid、字节 scope.complete=true，inventory.partial，当前局部 assessment 仍 pending。无 Runtime/node_modules 的独立 Node consumer 读九类对象。 | 不是生产项目、其他模型、硬件断电或 TraceLens 页面通过。 |

首次交付共 **53 项不同测试通过**，不重复累计重跑次数；原审核/旧交付的 18、19、92 等数值不计入该次交付。

| 实际命令/选择 | 退出码与结果 | 原始记录 |
| --- | --- | --- |
| bun run test:product-maintenance | 0；24 pass | [product.txt](checks/product.txt) |
| bun run test:product-maintenance:install（自身重建 runtime/分发） | 0；1 pass/66 assertions | [install.txt](checks/install.txt) |
| bun run validate:vnext-source / test:workflow-vnext-source | 0；契约通过 / 19 pass | [registration](checks/registration.txt)、[source](checks/source.txt) |
| bun test distribution：fresh Node install / valid idle legacy migrate / same-version no-op / vNext upgrade preserves | 0；7 pass/19 filtered | [distribution.txt](checks/distribution.txt) |
| bun test bootstrap：promotes disposable / preserves CLAUDE | 0；2 pass/11 filtered | [bootstrap.txt](checks/bootstrap.txt) |
| bun run gen:all / validate:protocol / validate:freshness | 均0 | [generation](checks/generation.txt)、[protocol](checks/protocol.txt)、[freshness](checks/freshness.txt) |
| 本地 Node install旧候选→upgrade最终候选 | 均0，资产11/11相同 | [旧安装](host-agent/delivery-old-install.json)、[升级](host-agent/delivery-upgrade.json) |
| Node offline 完整/缺失 entry＋junction；同目录CLI对照 | 0 / 1；CLI同为1，omitted一致 | [完整](host-agent/offline-final-complete.json)、[部分](host-agent/offline-final-partial.json)、[对照](host-agent/consumer-comparison.json) |
| git diff --check | 0（交付最后执行） | 检查摘要记录另存 |

最终 Distribution digest `4b41de749787c9a106709c165bf903c52644694179084a29283b70eb3182f364`，bundle `bundle-b042ead6ae11e4c8c8ebc125`。[完整清单](checks/distribution-manifest.json)。源/最终安装 helper SHA 均为 `d97298d9bf0ee91ad20caca9e74689d8f7b422ed213c8a3b159d48d1eb0a8397`，离线 reader 均为 `12b753da0e79a7bdf68a8c9ef59c5225371cad1595d42b4530a38367df19b9c9`。生成产物没有手补。

## 实际失败、恢复与剩余限制

- 安装初查把 not-enabled 误按漏读 exit1，已收窄到 available 的请求范围；版本锁步检查暴露遗漏的 Runtime package/constant，按原规则同步后重建通过。
- 初次隔离目录与源码共 Git root 被 installer 正确拒绝；建立真正独立合成 Git 根后正常安装，未用 force 绕过。
- 一个验收资料 Copy-Item 复制进了多一层 docs，最终 helper 如实给 entry/目录遗漏；只纠正夹具位置，未 replay 业务动作。之后新的正确旧安装/升级目录完成最终 artifact 的11项保留检查。错误观察仍在 observations。
- B worktree 初次无安装 helper，保留 unavailable；之后明确用 A 的安装 artifact＋B root 读取，未复制/合并 B 的未提交业务资料。
- 宿主初次排序方向和候选来源定位已在本轮纠正，旧请求、raw/preimage及结果留存，不以最终文件掩盖中间结果。
- 证据快照中的 `.workflow-system/events` 是一次额外只读复制；正式可定位副本为 `.workflow-system/records/events`。自动工具策略拒绝清理额外副本（只返回 blocked by policy，未说明细因），故保留；它不在 manifest 源范围，不作为当前日志导入或另算事实。
- **未执行**：test:workflow-all、整个 Runtime/assistance/task-management 回归、workflow:health、完整 TypeScript 类型检查、npm/tgz 安装、Linux及最低 Node20、独立审查、跨模型/生产项目/真实硬件/TraceLens页面、推送/发布/部署。
- SOURCE 当前展示 drift 仍可见；实际 task事实和视图回读分开。已授权业务和资料维护不因展示缺口被否决，且未自动关闭任一源任务。
- 未消除任意外部编辑器竞态、未提供跨文件强事务；根级身份/AST不可靠用合法原文修复，不扫描所有来源。没有对每种结构变体、每个需求拆合分支或未来任务操作做穷举承诺。

这些快照、脚本和 native task 事件仅为本轮只读测试证据，不是源码项目 PRODUCT，也不应装进用户项目冒充真实计划/决定/历史。真正可分发软件在 packages/vibe-governance 的本地候选中；所有外部交付仍未授权也未执行。

## 后续四项 P2 修复

审查对象仍是 `20ba0275270493b94b4f02eca33cc3b8c38b198d` 上的未提交工作副本，分支 `codex/maintain-project-v1`。原 [自审记录](../../../.workflow-system/records/events/key-6b4d438aae11d488ea7bb5268db9571903854c50091da81d2709701951a84609.json)的 findings 原样保留；[用户修复处置](p2-repair/decision-result.json)已保存、关联 applied，源任务仍 draft，旧 CURRENT_TASK 展示漂移未覆盖。本次仅修复这四项，不重演 S01～S13 的宿主业务决定，不自动处置旧 task。

修后[执行记录](../../../.workflow-system/records/events/key-e2c1b71a97f87b708e8897d9a4c7d6f36f53edd18b69d1451004ace0e25f3017.json)和[新自查记录](../../../.workflow-system/records/events/key-da2455adb8204ccedc8e83a097ba585015868dcd9dadd5ae5e18c7db5386ac74.json)均 recorded、association=applied。[实际回读](p2-repair/management-summary.json)确认新 verdict=clean 仅覆盖 R01～R04 及所列定向回归，provenance=self-review；原 verdict=findings 和四个 finding 仍在。显示投影仍 partial/drift，CURRENT_TASK 字节未改，没有将自查提升为独立审查或自动采用／结束任务。

修复前 helper 摘要 `d97298d9bf0ee91ad20caca9e74689d8f7b422ed213c8a3b159d48d1eb0a8397`。[原探针](p2-repair/pre-fix-review-probes.json)、[原审查输入](p2-repair/original-review.json)和[四项 RED](p2-repair/red.txt)保留失败证据；四组新持久回归在 `test/product-maintenance.test.ts`，修前均失败。源码只继续修改 paths/writer；API、document-contract 补准确语义，所有 dist、契约副本及 payload 从源重建，仍为未发布的 `0.24.1` 本地候选。

| Finding | 实际修复与正反结果 | 追踪 |
| --- | --- | --- |
| R01，原 glob 功能回归 | 前缀可达性按既有 `*`、`**`、`?` 字符语义匹配，支持 `**.md`／`nest**/*.md` 的跨目录匹配。深层项恢复可读；浅层 glob 不误读子目录，无关 junction 不跟随也不虚报遗漏。额外 28 组有界文件树对照与原完整 matcher 一致。 | R01 测试；[matcher 对照](p2-repair/glob-check.json)、[修后 Node](p2-repair/results.json) |
| R02，合法修复及重新关联回归 | 比较旧依据前检查数组及成员可比较性，null／非对象不成为新依据。仍有可比较旧来源时，删除空值或重试同来源不能激活 dismissed；明确当前反转的合法候选可保存，原字节 preimage 保留。覆盖 links／task_bindings、局部／整文件、非数组旧来源和坏邻项原字节。 | R02 测试；[产品回归](p2-repair/product.txt)、[Node 对照](p2-repair/results.json) |
| R03，精确删除新能力缺口 | 关系查找只在可识别旧成员上比较 ID，避免 null.id 异常。明确删除旧 dismissed 并修掉空成员、保留有效关系可 saved。遗漏声明、声明未删对象／未知 ID、候选仍含空成员均失败且原字节不变；没有静默清洗候选或丢弃无关坏条目。 | R03 测试；[安装后 Node 回归](p2-repair/install.txt) |
| R04，F04 遗留覆盖缺口 | 具体文件或选中 entry 实际为目录时记 PATH_UNAVAILABLE／omitted，read exit1、check partial；其他独立项仍读取。glob 前缀及名称带 .md 的普通遍历目录合法，不把目录都当漏读。 | R04 测试；[CLI Node 对照](p2-repair/results.json)、安装/离线回归 |

最终源码产品套件 **28 pass / 0 fail / 316 assertions**，含原 24 项；安装套件 **1 pass / 0 fail / 86 assertions**；vNext source **19 pass / 0 fail / 115 assertions**。这次合计 48 项不同测试，重跑不累加。[产品](p2-repair/product.txt)、[安装](p2-repair/install.txt)、[source](p2-repair/source.txt)、[protocol](p2-repair/protocol.txt)、[freshness](p2-repair/freshness.txt)分别保存；后两项通过但不再叠加其内部子测试数。

四层结果：源码正反回归通过；Runtime/Distribution 从源构建成功；实际隔离旧候选 `0.24.0` 新装→最终 `0.24.1` 升级成功，业务 [11 项资产](p2-repair/upgrade-assets.json)全部 SHA 相同；目标 Node helper 与源码产物一致，独立离线消费者不含 Runtime/node_modules、读取 ID 与 helper 一致。[最终摘要](p2-repair/delivery-summary.json)为 9 个文件、27 usable、1 invalid、请求字节完整；坏项、inventory.partial、原 pending_sources 继续保留，不是整体业务 PASS。task 日志来自单一合成夹具的受控快照，四个 closed 的回读只验证记录消费，没有重新执行或关闭业务 task。

最终 helper SHA `9473c3213f529fe28743ff3708e39ca897a75abc34b29f56950335a985e742d4`，offline reader SHA `8b923e073a8cc27c8bf8cd8c0524980df6082525f8d05fb402d239ae5179de2a`。Distribution digest `d043a00b55fd92514eaf94213c90ebfaf0853f2531787a2dbabb565b70b39341`，bundle `bundle-bf1a6bc60deeafbf611a13f9`；[实际清单](p2-repair/distribution-manifest.json)。旧安装产物及原审查的二进制摘要保留，不用同版本覆盖先前已安装的候选。

本次为同宿主自查与确定性 Node/离线消费验收；自动探针不替代真实业务语义判断。未重新执行全套 workflow、整个任务服务回归、S01～S13 宿主业务动作、跨模型／生产项目／硬件／TraceLens 页面、Linux／最低 Node20、npm/tgz 安装；此前任务原生 28 项通过属于上一轮审查，未计入本次 48 项。源 task/CURRENT_TASK 的既有展示缺口、任意外部编辑器竞态及跨文件非事务限制仍在；未提交、推送、发布或部署。

## 后续三项 P2 修复（2026-10-06）

范围复审 C01～C03 已按用户“修复三项P2”继续收敛。最新 [交付及正反证据](c-p2-repair/README.md)记录 51 项不同测试、实际旧版本到新候选的升级、Node／离线结果及未执行范围。C01 同材料格式清理不再恢复否定，C02 未改既有 active 关系不再误挡字段维护，C03 精确追加支持同文件新增／拆分且坏邻项原字节保留。当前明确业务决定仍可直接记录执行，不新增状态或审批。旧 findings／报告和上述 48 项结果保留为历史；当前 helper 摘要以最新交付为准，不把测试通过提升为全部业务语义或独立审查 PASS。

## 后续 D01／D02 修复（2026-10-06）

[修后复审](post-c-p2-review/README.md)发现的两项维护误拒绝已按用户要求修复，原报告及 findings 保留。[最新交付](d-p2-repair/README.md)记录统一正文分隔、重复关联的实际激活和历史删除比较、本次 53 项测试／1001 个断言、42 组 Node 正反对照、真实隔离 0.24.0→0.24.1 升级及离线回读。分隔行属于写入器生成的文档结构，旧正文每个字节及未改约束继续保留；重复 active 仅保留诊断，明确操作可达成。本次不新增状态／gate，也不将确定性写入样例冒充 S01～S13 语义重验或正式 clean review。

