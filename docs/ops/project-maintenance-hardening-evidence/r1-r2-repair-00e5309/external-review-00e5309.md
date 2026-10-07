# maintain-project v1 hardening 独立审查

日期：2026-10-06。审查结论：**需要修改，暂不宜把本轮 A/B/C 可靠性闭环整体验收为通过。**

确认 **4 项 P2**：1 项新回归、3 项基线已有但本轮承诺修复仍遗漏的问题。未发现足以定为 P1 的新问题。原六项典型复现大多已修复，现有选定测试最终全部通过；但新增反例证明“测试通过”尚不足以覆盖共同写入链和 requested-read completeness。

## 1. Findings first

### R1 · P2 · 整文件受影响条目判定漏掉 YAML 语法变化，能把可用需求保存成不可用

位置：[writer.ts:233–238](https://github.com/KongXiangning/vibe-coding-workflow-system/blob/00e5309e872130f87fc1c33525bf944eb394b824/runtime/vnext/src/product-maintenance/writer.ts#L233-L238)，放行链为 287–290，反向合法修复误拒绝在 265。

正常 `content` 操作仅将 REQ-A 的 `scope: current` 增加一个同值重复键，或给其值加未引用 YAML anchor，正文、ID/type 和其他条目完全不变。`changedItem` 只比较解码后的 metadata 与正文，所以 `affected_items=[]`，带 item_id 的新解析错误没有进入所选条目校验。

- 指定基线：相同候选 exit 1、`STRUCTURE_INVALID`，原字节不变
- 固定提交：exit 0、`saved`，返回 `YAML_DUPLICATE_KEY` / `YAML_ANCHOR` error，却仍写盘；回读 REQ-A 从 usable 变成 unusable
- 反方向：原 REQ-A 有这些可可靠定位的条目内部语法问题，合法整文件只删除重复键/anchor、保留另一个坏邻项原字节，反而返回 `INVALID_ITEM_CHANGED`

这是**明确的新回归**。影响是普通格式整理可能损坏结构并误报成功，精确修复又被阻断。应把稳定条目的原始 YAML map/AST 或诊断变化纳入实际 affected 判定，拒绝本次新引入的条目错误，同时允许合法修复并保留未改坏邻项。不要禁止整文件写入，也不要要求先修整份文档。

复现：`node review-write-chain-probes.mjs`，结果中 `F05-introduce-same-value-duplicate-key`、`F05-introduce-unused-anchor`、`F05-duplicate-key-repair`、`F05-anchor-repair`；记录有完整请求、前后原文、apply/read 和 preimage。正反行为由 `review-write-chain-verify.mjs` 独立断言。

### R2 · P2 · 重复 dismissed ID 可用一行抵消多份历史，未声明删除也会丢记录

位置：[writer.ts:275–278](https://github.com/KongXiangning/vibe-coding-workflow-system/blob/00e5309e872130f87fc1c33525bf944eb394b824/runtime/vnext/src/product-maintenance/writer.ts#L275-L278)，关键是 277 的 `nextRelations.some(...)`。

初始两条 dismissed 关系共用 ID，但分别指向不同目标；或两条 TaskBinding 共用 ID，但关联不同真实 task。该文档可用，只报重复 ID warning。候选数组只保留其中一条，没有 `remove_relations`、`remove_fields` 或当前反转依据。

- links / task_bindings × local / content 共四组合，固定提交均 exit 0、`saved`，回读历史由 2 行变 1 行
- 指定基线也如此，属于本次 F01/F02/D02 保护仍遗漏，**不称新增回归**

同一个 next dismissed 行被反复用来证明每个旧行“仍保留”，且未核对确定性的关系身份。日常数组补丁漏项就会静默丢失另一个目标/task 的否定依据。应消耗式逐行匹配 dismissed，考虑 ID、身份与数量；未匹配历史沿用明确删除/真实重新关联路径。保留重复 ID 仅 warning、无关 scope/assessment 修改、合法 text 反转和明确删除能力，不新增墓碑、审批或强制清理。

复现记录：`duplicate-dismissed-links-local`、`duplicate-dismissed-links-whole`、`duplicate-dismissed-task_bindings-local`、`duplicate-dismissed-task_bindings-whole`，基线/当前均留存完整输入和回读。

### R3 · P2 · 选择 glob 后，范围内明确登记的缺失文件不再报遗漏

位置：[catalog.ts:40–45](https://github.com/KongXiangning/vibe-coding-workflow-system/blob/00e5309e872130f87fc1c33525bf944eb394b824/runtime/vnext/src/product-maintenance/catalog.ts#L40-L45)。

合法 PROJECT.md 存在；manifest 明确登记 PROJECT.md 和不存在的 MISSING.md。默认 `read {}` 正确 exit 1、complete=false、omitted 包含 MISSING.md；但改为同范围 `read {"paths":["docs/product/*.md"]}`，固定提交返回 **exit 0、complete=true、omitted=[]、diagnostics=[]**。input.paths 替换 managed_paths 后只补回 entry，其他命中本次选择的显式登记义务丢失。

影响是常见的子范围/glob 读取把已知移动或删除误报完整。应在本次选择内补回所有显式登记文件，再应用排除规则；不扩大未选范围、不扫描 source_paths。基线亦有此问题，是 F04 修复遗漏。

复现：`node review-read-probes.mjs`；`review-read-probes.json` 中 `default detects missing explicit registered file` 与 `broad selection hides missing explicit registration`。`review-read-more.mjs` 留存基线对照。

### R4 · P2 · glob 必须经过的目录实际为普通文件，CLI 和离线仍报告完整

位置：[paths.ts:108–111](https://github.com/KongXiangning/vibe-coding-workflow-system/blob/00e5309e872130f87fc1c33525bf944eb394b824/runtime/vnext/src/product-maintenance/paths.ts#L108-L111)。

manifest 登记 PROJECT.md 和 `docs/product/section/*.md`，但 section 实际是普通文件。静态前缀被 visit 后，它既不满足最终 glob，也不是目录，函数直接无诊断返回。

- 固定 helper：read exit 0、complete=true、omitted=[]；check exit 0、status=checked
- 固定离线 reader：同样 exit 0、complete=true
- 基线同样错误，属于 F04 修复遗漏

这不是成功枚举目录后的合法零匹配。目录被手工换成文件、路径误配等情况从未完成请求枚举。应对明确前缀的非目录状态记录已知路径/模式遗漏，继续读取其他独立范围；保留 symlink/junction 跳过及权限边界。

复现：`review-read-probes.mjs` 的 `file glob prefix`、`file glob prefix check`，以及 `review-read-more.mjs` 的基线/离线对照。

## 2. 审查对象与执行范围

- 仓库：KongXiangning/vibe-coding-workflow-system
- 固定完整 SHA：`00e5309e872130f87fc1c33525bf944eb394b824`
- 基线完整 SHA：`20ba0275270493b94b4f02eca33cc3b8c38b198d`
- 获取时 `origin/codex/maintain-project-v1` 正好指向固定 SHA；固定提交的直接父提交就是上述基线，merge-base ancestor 检查 exit 0
- diff：313 个文件，144,934 增行、154 删行，大量为保留的历史验证资料；本审区分产品源码、生成资产与证据
- 只用本次云工作区。独立 detached checkout；另建测试/基线 worktree。未使用 K-PC、保存的编码环境或真实业务项目
- 已读 AGENTS.md、权威 README/requirements/document-contract、实施/验收/方案/API 及对应源码、六 references、主 Skill、回归和历史证据；仓库没有 `.agents/skills`
- 原审查 checkout 最终 clean。没有修复源码、创建提交、推送、发布、部署、处置业务 task 或改真实项目。所有测试写入仅在独立测试副本/临时合成目录
- 环境：Linux、Node v24.19.0、仓库锁定 Bun 1.3.10；依赖来自官方 registry，缓存仅在本次临时工具目录

## 3. F01–F06 逐项结论

48 组写链对照（30 当前、18 基线；144 次实际 Node CLI 调用）保留完整请求/结果/原文/回读，另有 93 项断言验证这些结果。断言通过证明复现一致，**不是证明新缺陷已经修复**。F04 另有当前/基线/离线及权限控制组。

| 原问题 | 原始典型缺陷的前后证据 | 合法/反向控制 | 本轮判定 |
|---|---|---|---|
| F01 content 绕过身份、dismissed、v1迁移 | 基线同 ID/type 改写、无 migrate、同源重新关联可错误 saved；当前拒绝并保留原字节 | 明确迁移、合法整文件正文、明确删除/替代、当前 text 反转可用 | 典型修复有效；R2 历史保留遗漏仍在 |
| F02 来源换序恢复 dismissed | links/bindings、local/content 同源换序/重复：基线 saved，当前 DISMISSED_RELATION | 来源属性序/显示变化不算新依据；当前明确反转 text 可 saved、preimage 保留 | 原换序问题修复；重复 dismissed 历史数量 R2 未闭环 |
| F03 仅 remove_fields 不生效 | 基线 file unchanged/字段还在；当前删除 assessment_id 并回读消失 | 缺字段 unchanged；先合并后删；删 id/type/必需 scope 拒绝；历史 assessment 保留 | 通过本次所测正反边界 |
| F04 漏读仍完整 | 显式缺失/选中 entry/目录错误、相关链接、预算均报 omitted，独立路径继续 | 有效空 glob、排除/未选择范围、坏项字节完整、source许可不全扫均分开 | R3/R4 两个请求完整性遗漏，未完成 |
| F05 合法整文件不能修选中坏项 | unknown 字段修复：基线 failed，当前 saved；另一个坏邻项原字节不变 | 选中项必须合法，身份/迁移/历史保护仍生效 | 典型修复有效；R1 等值 YAML 语法漏验/误拒绝是新回归 |
| F06 body H2 使约束越界 | 基线额外真 H2 saved；当前 BODY_BOUNDARY；吞邻项的未闭合结构也拒绝 | 三级约束、代码/引用/列表伪 H2、合法 whole 附录、闭合 HTML/分隔符仍可用 | 通过本次所测正反边界 |

F04 本次还真实执行 chmod000 的目录/文件 EACCES，分别得到 DIRECTORY_UNAVAILABLE / DOCUMENT_UNAVAILABLE，遗漏保留且独立 PROJECT 可读。Linux symlink 检查不能写成 Windows junction 本次复验；仓库旧 Windows 日志只算历史证据。

## 4. A/B/C 分层交付判断

| 层次 | 本次能确证的结果 | 不能升级成的结论 |
|---|---|---|
| A 可靠性 | 共同写入链和原六项典型修复有有效正反回归；新增四项反例已经逐条复现 | A 尚未闭环，不能用现有全绿覆盖新反例 |
| B 业务语义 | VPM-01～25 保留；S01～S13 逐项可追踪；六 references 补语义，主 Skill 仍为路由/共同规则；未确证新业务语义代码故障 | 并非每个分支都做过实际宿主语义验收，也非所有模型/生产项目通过 |
| C 源码/生成分发 | Bun 源构建、Node 目标运行保持；34/34 维护资产与最终归档 manifest checksum 匹配；权威/生成 contract 一致 | fresh locked build 的两个 bundle 并非逐字相同；详见下方限定 |
| C 目标安装 | rebuilt 与 exact committed helper 都通过安装回归；本次真实 0.24.0→0.24.1 升级、11/11 业务资产不变，installed helper 与固定提交 SHA 相同 | 不代表用户真实项目升级或包已发布 |
| C 离线/宿主 | 本次无 Runtime/node_modules 离线读取与 installed helper ID 一致；历史42条工具调用与合成快照可检查保存/重试/回读 | 工具调用结果不独立证明宿主阅读及候选生成过程；本审没有重演全套13场景语义 |

业务边界核对：没有新 task 状态/gate、CURRENT_TASK 手改、reducer 复制、KPI 子系统、自动排期/完整需求树、第二模型、审批体系、自动重开旧 task/复活 retired goal。经营结果仍 goal body/sources；宿主判断语义，helper 处理格式/定位/身份/历史/覆盖/保存。当前明确用户反转可直接作为 text SourceRef，无外部材料或重复确认要求。范围退出、延期、外部失败、停止、在授权下必要清理路径仍保留；task close 与需求当前验收仍分开。

### 真实宿主证据的准确边界

`docs/ops/project-maintenance-hardening-evidence/README.md:48,77` 与 `vnext-project-maintenance-validation.md:46` 声称宿主实际读取资料后生成候选。仓库有 `host-agent/observations.jsonl:1–42` 的 helper/assistance 输入输出与前后合成资料；它们能支持真实保存、失败恢复、prepare/close 和回读链，不只是静态设计样例。

但提交中缺少所称临时 `host.mjs` 和可独立核实的宿主资料/Skill 阅读及候选生成来源。本审不能由这些已填完整候选的 API 记录独立认证模型语义生成过程，也**不能反向断言脚本冒充或造假**。这是证据限定，不计为第五项源码缺陷。最小补充是可核实的输入→相关资料/Skill读取→候选→调用→回读记录，或将该层标为未独立核实。

最后 D 修复报告已经明确：14 个确定性样例不是 S01～S13 重验，四个 closed task 来自受控快照，`business_semantics_replayed=false`。这一限定正确，本次不能把 D 的新测试数字升级成全部宿主语义 PASS。

## 5. S01–S13 完整追踪

以下“未覆盖”是验收证据边界，不自动等于实现缺陷，也不要求机械创建13个 task 或13套机制。

缩写：`R/` = `runtime/vnext/support/product-maintenance/references/`；`T` = `test/product-maintenance.test.ts`；`H` = `docs/ops/project-maintenance-hardening-evidence/host-agent/`；`O:N` = `H/observations.jsonl` 第 N 行；`P/` = `H/snapshot/docs/product/`。所有 host 示例均为合成资料；以下不将其提升为真实用户业务或跨模型结果。

| 方案场景（原编号/原题） | 实现与权威语义 | 确定性证据 | 所留 host 操作/回读和剩余边界 |
|---|---|---|---|
| S01：目标演进和经营结果材料 | 保留 goal scope/body/sources 和 replaces；R/update:36-40、R/reconcile:52-55；contract:83-116 | T:379-385 的全 scope 读取，T:30-49 身份与合法正文/替代路径；没有 KPI 或 goal assessment | O:8-9 新建 inventory，P/GOALS:4-21；G-REGISTER retired、G-TRIAL current，90/18 和统计未知保留，注册/邀请/试用范围可解释。**不是旧 goal 原位调数值的操作验收**；同目标调口径、复原等分支无宿主实测，报告已承认未穷举 |
| S02：退出范围与仍然存在的共享风险 | scope 退出≠完成/删代码；R/update:24-29,46-49、R/reconcile:45-50；requirements:104-113 | T:417-443 允许 scope 更新并保留旧正文/冲突，T:488-494 retired 不复活/不 gate | O:8-9；P/REQUIREMENTS:45-67 保留优惠券旧失败及支付退货风险。**REQ-COUPON 一开始就以 retired 新建**，并非已存在失败 requirement 的实际退役过程；无实际共享金额影响分析/已授权清理分支；不能称支付退货已验收 |
| S03：拆需求与拆实施工作的区别 | R/update:42-45；R/plan:8-35；保留 work_items 与 task+step_id，真正拆合保留 prior IDs/destinations，不复制 PASS | T:474-487 一 REQ/稳定 E6 work items/未来无 task；T:30-49、346-378、428-437 合法 append/身份/迁移，但**不验证拆合业务判断** | O:8-9、13、18：REQ-BOOK + BOOK-CHECK/NOTIFY/FEE，E6A/B 使用同一真实 prepare task 和不同 step_id。独立需求拆分、合并和逐范围交付继承未逐枝宿主实测（报告已承认） |
| S04：多对多和范围化关联 | R/plan:30-36,47-53；contract:175-194；plans.ts 反算绑定，无中央 task 状态副本 | T:474-487 保留/幂等 binding，不创建 records；plans.ts:101-116 按 owner/task/role/coverage 诊断、回读反算 | O:14、16-18 真实权限 task 同时绑定 REQ-PERM 与 REQ-AUDIT，coverage 只含权限/操作人、不含查询导出；O:29 是**未执行任务的合法停止**，不是完成权限实现后证明审计仍未完成。后一完成分支仍为规则/结构证据；无按 task 数完成率 |
| S05：未知—探索—调整计划 | R/plan:3-6,47-50；探索结果可否定 design，而需求仍 current 未交付；future work 无伪造 task_id | T:379-385 无 task 需求可见；T:474-487 未来 work 无 binding；无自动探索状态机 | O:15 真实 prepare，O:20 close 接纳合成不可行观察，O:23 retire DES-LOG；P/DESIGN:8-14、PLAN:14、REQ-LOG:93-102 区分探索/产品。没有断电实测，未来方案只是待细化；简单任务不强制探索在流程中保留、未单独宿主跑分支 |
| S06：临时工作纳入、优先顺序与真实前提 | R/plan:15-21,55-60；origin=added、stable IDs、deferred、order/prerequisite；plans.ts 只做引用/循环诊断 | T:474-494 稳定 E6R、新增来源、撤销前置项/环不 gate | O:23 初次安排错误，O:26 修正方向；P/PLAN:4,12-14 最终 REPORT-OPT deferred 且在 AUDIT-EXPORT 之后为 order，AUDIT-ACTOR 为 prerequisite。旧 preimage/plan-before 保留。未操作在执行 task 的范围修订，未证明真实操作记录前提已满足；无自动调度 |
| S07：E6 外部失败、插入修复和复验闭环 | R/reconcile:3-43,54-58；R/plan:38-45；不补验证 task、不重开 A/B/替换 C、R close≠复验 | T:474-509 结构/新的 pending；T:438-453 冲突与 capture。自动测试 task IDs 是明确合成 opaque 值，不冒充实际服务结果 | O:13-22 真实 prepare A/B 同 task、绑定失败后仅补关系；O:21,23,27-32 真实 R、plan/repair、执行记录、close 后 AS-INTEGER 不变再独立选 AS-DECIMAL。原整数 PASS、小数 FAIL、前后源 hash 与报告保存；外部版本未知仍 pending。**冲突是 A/B/权限/探索绑定，未对 R 绑定注入冲突**；只有两金额样本，不含 Excel 文件格式、完整导出或 C 独立部分执行 |
| S08：历史归属与当前修复范围 | R/reconcile:34-38,45-50；R/plan:20-21,35-36,60；不恢复 retired、不归罪历史作者 | T:488-494 retired 保留；T:474-487 repairs 为历史范围非根因认证 | P/LEGACY:4-22 REQ-CSV 始终 retired；P/REQUIREMENTS:14,103-109 E6R 仅当前 Excel 小数，repairs 指原 E6A，未知引入者。只证明此有限历史/当前分离；**旧 CSV 的明确兼容支持仍有效、纯历史只记不修**两个分支未实际运行，不能仅凭 retired 标记认为覆盖 |
| S09：选择性讨论收存、多议题与局部采纳 | R/discussion:3-43；capture/关联/确认/采纳分开，未知作者日期不造，归档指令不执行 | T:445-453 一次原始字节/重复复用/URI 不当正文；T:495-509 recall.adopted=false | O:5 capture，10 失败后11仅重试 summary，12采纳错误提示；P/DISCUSSIONS:4-11、REQ-ERROR:111-117 仅该片段进入 current，REQ-MULTI candidate，云关系 dismissed/候选区分。已有数据可核对；**模型不可用和无匹配只保存 pending**没有实际宿主分支记录，指令不执行只有没有该操作的负证据 |
| S10：否定持久与合法重新关联 | writer:188-228,266-278；R/discussion:45-53、API:118-137；按具体 relation/target/coverage 保护，明确反转 text 合法 | T:50-79 +152-193 +208-273 +311-345 覆盖换序/重复/属性序/未知字段/重复 active，合法反转与旧字节 | O:24 同源重复激活失败，25 当前 text 反转 LC-CANDIDATE→G-CLOUD 成功并保存 discussion-before；LC-IMPORT→REQ-EXCEL 仍 dismissed。有合法确定性写入通道，不需外部材料/重复确认。**反转决定本身是合成 fixture**；不能由此证明模型面对真实用户反转必然正确解释 |
| S11：长需求约束不丢失 | writer:258-285；R/update:51-56、R/recovery:48-69；约束 authority 不因附录掉落 | T:122-130 额外 H2/吞邻项拒绝且字节不变，合法深标题与伪标题/附录；T:274-310 D01 分隔回归 | O:31 二级越界拒绝，32 合法 ###，34回读；P/REQUIREMENTS:93-102 禁原始数据上传及诊断但不禁全部联网。**手改真实附录里的限制→宿主识别/归属修复**未验；没有真实联网行为测试（如实披露） |
| S12：多 worktree、冲突及安全重试 | catalog:9-12,40-81 根隔离/真实覆盖；writer 的 digest/单文件发布；R/recovery:22-27,48-55；无跨文件事务/外部编辑器绝对 CAS | T:438-453、510-516、538起：冲突保留、raw复用、distinct roots/helper并发；tests 的两个 temp dirs不是实际 git worktree证明 | O:16-18 冲突仅补绑定；O:36-37 B 缺 helper 后明确用 A installed artifact+B root；worktree-check.json 记录相同 project_id 不同 root/definition。提交没有 git worktree 创建/列表原始输出，因此**根隔离可验证，真实 Git worktree 建立过程靠记录自述**；外部编辑器竞态限制明确 |
| S13：手工修改、局部修复、缺失诊断及真实结果 | writer 修 remove_fields/selected malformed；paths/catalog 遗漏；R/inventory:28-36、R/recovery:11-46；v1读不迁移、显式写迁移 | T:80-130、133-207、346-437 覆盖删除/坏邻项/缺文件/目录/junction/追加/v1；Windows junction 只承认提交 Windows 日志，不将本次 Linux 观察等同验证 | O:33 selected-raw-repair 保留 REQ-HAND 业务正文/REQ-BAD-KEEP 字节；34+最终/离线诊断留1坏项。**移动文档后在授权已知范围重定位/更新 manifest**及未知位置分支只有流程说明，无 host 操作；未通过格式修复恢复旧意 |


## 6. 本次实际测试、构建与失败记录

所有数字为本次执行；不继承仓库旧 PASS，不重复累计重跑。最终选定已有测试共 **90 项通过**：62 项 Bun + 28 项 Node。Bun `expect()` 共1374次；Node 原生断言不混入该数字。Protocol 内部检查及独立缺陷探针不再累计成测试总数。

| 命令/范围 | 最终结果 | 原始证据文件 |
|---|---|---|
| Bun1.3.10 `install --frozen-lockfile`；`bun run test:product-maintenance` | 33 pass / 0 fail / 761 expect | install-deps.log、product-test.log |
| `bun run test:product-maintenance:install` | 1 pass / 0 fail / 125 expect，包含源码构建和实际 installed Node | install-test-env-fixed.log |
| 恢复测试副本中的提交版 helper/offline → build distribution → `bun test test/product-maintenance-install.test.ts` | 1 pass / 0 fail /125，重跑不重复计数 | distribution-committed.log、install-committed.log |
| `bun run validate:vnext-source` / `test:workflow-vnext-source` | 契约通过；19 pass /115 expect | validate-vnext-source.log、test-workflow-vnext-source.log |
| `bun run validate:protocol` / `validate:freshness` | 均 exit0 | validate-protocol.log、validate-freshness.log |
| `bun test test/vibe-governance-distribution.test.ts --test-name-pattern 'fresh Node install\|valid idle legacy migrate\|same-version install is\|vNext upgrade preserves'` | 7 pass /19 filtered /179 expect | distribution-focused-isolated.log |
| `bun test test/vnext-bootstrap-project.test.ts --test-name-pattern 'promotes a disposable\|preserves an existing CLAUDE'` | 2 pass /11 filtered /194 expect | bootstrap-focused.log |
| `node --test test/vnext-assistance.test.mjs test/vnext-task-management.test.mjs` | 28 pass /0 fail | assistance-task-tests.log |
| Node 实际基线包安装→固定包升级→独立 offline | 0.24.0 installed、0.24.1 upgraded；11/11资产不变；helper等于提交；27usable/1invalid；offline ID一致 | actual-upgrade.mjs、actual-upgrade-summary.json、actual-{old-install,fixed-upgrade,upgrade-read,upgrade-offline}.json |
| `node review-write-chain-probes.mjs`；verify | 48组前后case；93断言确认预期控制/缺陷结果，四项P2仍存在 | review-write-chain-results.json、review-write-chain-verify.mjs |
| `node review-read-probes.mjs`；read-more；read-controls | 原始F04控制有效，R3/R4仍错误complete=true；基线/离线可追踪 | review-read-{probes,more,controls}.json |
| `git diff --check <baseline> <fixed>` | **exit2**；证据文件末尾空行、旧baseline-red空格及方案Markdown硬换行 | diff-check.log |

### 已发生的失败，不隐藏或计为最终通过

1. 首次安装回归 0pass/1fail，installer `PAYLOAD_STAGE_FAILED`。结构化诊断显示 npm 尝试写不可用的 `/home/agent/.npm`；仅将本进程 `NPM_CONFIG_CACHE` 指向可写的本次临时目录后重新完整运行通过。不是产品源码修复。
2. 定向 distribution 与 bootstrap 首次并行运行，二者 `beforeAll` 会重建同一 package payload；distribution 首轮4pass/3fail，后者都在安装阶段 rejected。原日志保留，未抓取这三次结构化 blocker，因此不据此定性产品缺陷。停止并行后同一命令独立重跑7/7通过；最终只引用隔离结果。
3. 独立旧包升级探针初次漏带 CLI `--json`，实际旧包安装成功，JSON解析因尾随 Next 提示失败；补正确参数后在新的临时目录完整跑通。原输出/探针错误保留，非产品升级失败。
4. 固定提交差异的 whitespace 检查 exit2，与历史自述 `git diff --check=0` 的范围/时点不能混用。这里只属格式/证据整洁度，不另列业务 P2。

### 生成产物与可重复性

固定 helper SHA256：`42ca8baf451c48af30f68f5804a932684ea44740427d3b3cda017e87c8109bf5`。
固定 offline SHA256：`8b923e073a8cc27c8bf8cd8c0524980df6082525f8d05fb402d239ae5179de2a`。

clean Bun1.3.10 + frozen lock 重建的 helper/offline SHA 分别为 `5248ae337829c4e1ee4bdb8877342c8f88b4fe71826a0ac61ddd0d740512ca46` / `e550f76ebbf74b0430bdfc92d7f5c646758c426bbb5afcc0720993f0cb3dd83e`。全部代码差异仅为 debug 可选的 supports-color/has-flag：旧 bundle 从上级 node_modules 打入这些未锁定模块，本次没有，原 try/catch 中的 optional require 被替代；产品逻辑未变。记录为可重复构建限制，不能声称逐字重现，也不能据此指控手补 dist 或产品功能回归。精确提交产物另行安装执行并通过。

实际安装升级使用指定 baseline 的现成 runtime 分发和固定提交的精确 helper/offline，均从源码装配本地候选包，未冒充 npm 已发布版本。11项业务资产前后 hash 见 summary；未导入历史任务记录冒充新执行。

### 未运行/未验证

未运行 `test:workflow-all`、完整 TypeScript 检查、全部 Runtime/迁移/分发用例、workflow:health、npm/tgz发布安装、最低 Node20、Windows现场 junction、真实用户业务项目、其他宿主/模型、真实硬件、TraceLens UI。没有扩大为外部编辑器绝对 CAS、跨文件强事务或全源扫描承诺。

## 7. 验收建议与交付物

优先修复 R1/R2 的共同写链，再补 R3/R4 requested-read 覆盖，复用现有 product-maintenance/安装回归加最小正反用例；保持合法 whole-file、坏项精确修复、明确删除和当前用户反转。然后重建源生成产物，复验精确 installed Node/offline；S01～S13 继续按范围汇报证据，不用新增框架或机械 task 拆分补“覆盖率”。

本轮审查已完成，未代为修复。四项发现足以否决“无发现/完整可靠性闭环”的验收；不意味着所有既有能力失败，也不阻止其他独立授权工作。

### 可复现证据索引

本报告：`maintain-project-hardening-review-00e5309.md`。

- 写链最小探针：`review-write-chain-probes.mjs`、`review-write-chain-verify.mjs`、`review-write-chain-results.json`（完整前后原文及结果）
- 读取最小探针：`review-read-probes.mjs`、`review-read-more.mjs`、`review-read-controls.mjs` 和对应 JSON
- 分发资产清单核验：`review-distribution-hashes.json`
- 构建/现有测试/真实旧包升级证据：`vibe-review-evidence/`

脚本当前写入全在临时合成目录，顶部固定路径可按实际 checkout 位置调整；工具调用/原始 JSON 不是生产业务资料。报告中的所有 GitHub 链接固定到完整审查 SHA，行号不会随分支前进漂移。
