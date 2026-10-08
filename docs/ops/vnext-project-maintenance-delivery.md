# maintain-project 首版交付记录

> 2026-10-08，已从 `84589392` 实施项目规划与持续选取增量：三种策略、共享资料充分性／前提候选分析、消费约定和样例，以及两组安装后真实宿主增量链。实际检查、独立复审、原 packed 用例环境失败与既有辅助链接问题见[本轮交付证据](project-planning-evidence/README.md)。本轮未发布或向真实项目安装；本地提交身份以交付包报告为准，不继承下文历史通过数。

> 2026-10-05 本轮可靠性修复已在 `project-goals-requirements` / `codex/maintain-project-v1` 工作副本实施，基线及当前 HEAD 为 `20ba0275270493b94b4f02eca33cc3b8c38b198d`。本地候选 `0.24.1`，未提交、推送、发布或部署。本轮 F01～F06 原行为/修后正反证据、S01～S13 映射、53 项实际测试、四层交付和具体未执行项见 [本轮交付证据](project-maintenance-hardening-evidence/README.md)。
>
> 同日后续审查发现的 R01～R04 已按用户决定修复，最终候选结果见 [四项 P2 修复](project-maintenance-hardening-evidence/README.md#后续四项-p2-修复)：本次 48 项不同测试通过，包含原 24 项产品回归；此前测试数和产物摘要保留为历史。
>
> 2026-10-06，用户明确的维护操作不得被流程否决。后续 C01～C03 已修复并通过 [三项 P2 交付](project-maintenance-hardening-evidence/c-p2-repair/README.md)：本次 51 项不同测试通过，实际旧版 `0.24.0`→新候选 `0.24.1` 隔离升级保留 11 项业务资产；源码、分发、安装、Node／离线结果与未执行项分开记录。旧审查 findings 保留，本次不重演 S01～S13 的宿主业务决定、不新增状态或维护 gate。
>
> 2026-10-06，后续 D01／D02 已按用户要求修复，见 [本次修复交付](project-maintenance-hardening-evidence/d-p2-repair/README.md)：共同写入器负责 Markdown 分隔，未改重复 active 关联不再误挡维护，实际新增激活和历史删除仍保护旧否定。本次实际 53 项不同测试通过／1001 个断言，源重建、真实隔离版本升级及安装后 Node／离线消费分别取证；原业务 11 项资产未变。旧审查 findings 保留，本次为修复自查，不冒充正式 clean review、完整 S01～S13 语义重验或发布。
>
> 2026-10-07，实际 HEAD 已为 `00e5309e872130f87fc1c33525bf944eb394b824`，修复前工作区干净。按用户要求修复该提交外部审查中的 R1／R2（与旧 R01～R04 区分），见 [本次交付](project-maintenance-hardening-evidence/r1-r2-repair-00e5309/README.md)：整文件纳入 YAML 原文／稳定诊断，逐份保护 dismissed 历史，并保留合法修复、当前决定恢复及同 ID 部分明确删除。最终 55 项不同测试通过／1151 断言，原报告 8 个输入的修前／修后 16 次 Node 对照匹配；重新隔离升级保留 11 项业务资产，安装与离线回读一致。本次修复未提交或推送，候选 0.24.1 未发布。外部 R3／R4 仍未修复；不能以本次测试通过认定完整加固或 S01～S13 宿主语义全部通过。
>
> 同日进一步修复 R3／R4，保留上述未提交的 R1／R2 和实际 HEAD。见 [本次交付](project-maintenance-hardening-evidence/r3-r4-repair-00e5309/README.md)：选定 glob 内具体登记缺失仍报遗漏，非目录静态前缀不再冒充完整空匹配；合法空目录、未选／排除范围和普通非匹配文件保持可用，缺口下独立授权保存及回读成功。最终 57 项不同测试通过／1241 断言；4 个原读取输入、10 个控制组共 42 次 helper／离线观察匹配，新的真实隔离升级保留 11 项业务资产。外部 R1～R4 实现及回归已依次完成，本次为修复自查，仍未完成正式独立复审或 S01～S13 真实宿主语义重验，未提交、推送或发布。
>
> 下文是 2026-10-04 首版历史报告，保留原文、时间和检查范围；其中的通过数、候选哈希及宿主材料不算本轮 PASS。源 CURRENT_TASK 的既有 legacy/drift 未覆盖，任务事实及投影结果分开记录。

2026-10-07，依用户“提交并推送”指令，本轮提交范围为 R1～R4 源码修复、源重建产物、回归测试、契约与 references、两轮证据及原生执行记录。上述“未提交／推送”描述保留为各轮取证时状态。57 项测试结果保持原验证范围；宿主 Agent 业务语义与恢复流程、S01～S13 的剩余验收欠账不因提交而转为通过，候选包仍未发布。

日期：2026-10-04。工作目录：`project-goals-requirements` worktree。本地候选：`0.24.0`，尚未提交、推送或发布。需求与验收分别以[完整能力基线](../product/project-maintenance/requirements.md)、[契约](../product/project-maintenance/document-contract.md)、[实现方案](vnext-project-maintenance-implementation.md)、[验收矩阵](vnext-project-maintenance-validation.md)为准；本记录描述实际结果，不修改验收要求。

## 1. 基线、工作划分和所有权

开始时 HEAD 为 `445cee1f0eb01b2feede98e2addda209f418179c`，工作区干净。与文档勘察基线 `c40726fa54f5c88acf65a1a6266392829da916c9` 比较，差异仅为六份项目维护设计文档，共新增 899 行；重新核对的 assistance、任务管理、Skill 注册及分发接口可复用。实施检查了冻结注册与目标文件标记，未覆盖原有用户编辑。

通过现有 assistance 准备并采用一个包含 B1～B6 的实施 task：`task-dc53226a81e7d5a0045c6fa94e5f9a0a`（TASK-010），[原准备事件](../../.workflow-system/records/events/key-e5a1cb259a6a8725014c51df172d466cec2d43779bea25ee8f3f5904dd60e9be.json)保存范围、步骤与实际用户指令。顺序优先读取与安全更新、模型整理、规划及绑定、讨论关联与 E6，再收束分发、安装和消费者证据。

源码项目未启用 PRODUCT，未向目标业务项目安装或升级。原 CURRENT_TASK 不可识别为新显示格式，管理服务已保存历史字节，显示投影保留 drift；未为得到“完整成功”覆盖它。任务事实由 `task-status/context` 重建，与展示结果分别报告。

B1～B6 的实际执行和四项对应命令结果已补记，回读各步骤为 executed。记录关联均 applied，展示仍是原 legacy 格式并保留 `LEGACY_ASSOCIATION_REQUIRED`。未伪造独立审查、步骤结束或任务关闭；任务仍 active，下一建议为 review-change。完整[操作结果](project-maintenance-evidence/checks/implementation-task-operations.json)与[任务回读](project-maintenance-evidence/checks/implementation-task-status.json)分别保留事实、关联和投影。

## 2. 实际实现

产品 helper 位于 `runtime/vnext/src/product-maintenance/`，`read/check/apply/capture` 独立于任务服务：真正 YAML／Markdown AST、v1／v2 格式、逐条目降级、有界目录、稳定身份、需求定义摘要、引用及字节分页、计划／TaskBinding 对账和局部安全写入。引用可用性、历史定义与当前适用性分别表示。程序给直接影响候选，业务判断由当前宿主 Agent 完成。

`maintain-project` Skill 提供 default／inventory／update／plan／discussion／reconcile 入口，按需读取六份参考资料。准备任务后补真实绑定；执行、调试、验证及关闭中的已授权资料维护接入原流程，review-change 保持只读。不复制 reducer，不把缺文档、pending_sources、未绑定、未建计划或资料错误变成开发、提交、关闭或停止的门槛。

分发构建包含 Skill、独立 Node helper、API、权威契约副本、六份 references、九类条目及 PRODUCT 模板、六份 Schema、E6 格式示例和独立离线消费者。新维护 Skill 的 bundle 必须携带必要资源；不宣称只新增源文件已经安装。所有产品正文、原文及历史仍属于目标项目。版本统一到 `0.24.0` 是为了遵守既有同版本内容不可覆盖的安装约束，未改任务生命周期行为。

## 3. VPM-01～25 覆盖

以下每行指向实际能力及其证据；不是按编号建立二十五个命令或用样例替代功能。

| 能力 | 实现与验证依据 |
|---|---|
| 01 托管范围与契约 | manifest、Schema、路径／AST 诊断、模板；非法 YAML、越界、重复身份及局部降级行为测试。 |
| 02 首次盘点 | inventory 方法与真实 Agent 从选定 brief 生成目标／模块／需求；未读来源保留，原代码不提升为意图。 |
| 03 完整已知需求 | 所有 current／planned／candidate／retired 条目均可读，不依赖 task；真实候选多设备需求无 task 仍可见。 |
| 04 日常需求变更 | 选定条目正文／元数据更新、append 与 update 方法覆盖延期、撤销、拆合及恢复；真实单→三→单变更与原字节历史。 |
| 05 设计同步 | design 正文、intent_state 与实际差异；真实导入方案保留未实现／未检查部分，修复后局部同步。 |
| 06 变化依据 | change 前后意图及精确 SourceRef；真实两次设备范围变化有来源，未知不补造。 |
| 07 范围任务绑定 | TaskRef／TaskBinding 多对多、角色、coverage、plan_items／repairs 与历史 step；真实 native task 身份及绑定冲突后仅重试关联。 |
| 08 交付对账 | assessment、subject、basis、来源及 pending_sources；真实需求未变的新失败、旧 PASS 保留与修复后实际复验。 |
| 09 缺陷影响 | direct impact candidates＋宿主读取正文后局部判断；实际输入缺陷仅纳入受影响导入／诊断及计划。 |
| 10 不一致／遗漏 | 跨对象及历史定义诊断、选定摘要 pending 可见；不按时间选择正确答案，旧 PASS 不遮住反证。 |
| 11 手工编辑 | 合法内容即读、坏项保留原文位置；局部更新保持坏邻项及无关字节，未回滚手工业务意图。 |
| 12 身份／历史 | 稳定 item／work item、替代引用及原字节 preimage；两个 worktree 隔离，实际 A／B／C 插入 R 后不重编号、不重开旧 task。 |
| 13 触发／延期 | 原 Skill 的范围维护钩子与非阻塞恢复资料；未启用／paused／缺失及格式失败不影响原任务服务。 |
| 14 安全写入 | 显式已读摘要、短锁、单文件发布、逐文件结果、capture 幂等及 freeze；真实并发保存冲突、部分失败和 task 绑定重试。 |
| 15 离线读取 | 完整安装格式资产、v1 显式迁移与独立 Node 消费者；无 Runtime／node_modules 目录读取全部九类对象。 |
| 16 选择性提交 | capture 只接收本次选择的文本／字节／来源；只给 URL 时不宣称正文归档，真实讨论原文仅存一次。 |
| 17 原文／议题 | raw_ref 与 discussion 分离；真实三个议题、顾虑和未决项保留未知身份／日期，精确原字节可查。 |
| 18 模型语义关联 | 当前宿主 Agent 读候选实际正文后生成 inferred、片段和理由；没有额外模型服务或静态关键词采纳。 |
| 19 关联失败保留 | capture 与整理／关联分项结果及 recovery 方法；原文可独立成功，模型不可用不造需求。 |
| 20 思考召回 | discussion_targets 返回摘要和位置、按需展开；真实相关观点在改目标前召回，顾虑不自动变义务。 |
| 21 局部采纳 | 关联、confirmed 与正式采纳分离；真实仅采纳行号错误诊断片段，其余多设备／云端观点保留为候选或 dismissed。 |
| 22 整理纠错 | 摘要／record_state 更新、dismissed 来源与理由；重试不重复原文，无新依据不能复活否定关系。 |
| 23 隐私／存储 | 宿主模型、来源和 capture 边界，无网络获取／全聊天采集；归档指令不执行，不虚报 Git 忽略或历史删除保证。 |
| 24 实施分析 | 稳定 plan／工作项、阶段可选、范围／结果／依赖与未决项；真实 E6A／B 近期 task、C 未创建；简单工作可无项目 plan。 |
| 25 计划演进 | 可局部更新 work_items，区分 initial／added／unknown、替代与撤销诊断；真实 E6R 插入 C 前、有来源与工程理由，原安排原字节保留。 |

## 4. 四层验证

最终候选共 92 项聚焦与既有回归测试通过，无失败；source、protocol 与 freshness 校验通过。实际命令、退出码和 stdout／stderr 已收存到 `project-maintenance-evidence/checks/`；源码、分发、安装和宿主行为分别核对。

| 层次 | 实际检查 |
|---|---|
| 源码／契约 | 18 项产品行为回归；19 项 vNext source 注册回归；28 项既有 assistance／task-management 原生回归；source、protocol、freshness 校验。 |
| 分发 | 实际构建及 26 项 distribution 回归，覆盖新装、迁移、升级、冲突、事务及版本约束；所有维护支持文件进入 payload。 |
| 目标安装 | 1 项实际安装回归：无源码／Bun 的 Node helper、新装不启用 PRODUCT、已有业务资产升级保留和无 Runtime 消费者；另有真实 Agent 验收目录从旧 `0.23.8` 升级为 `0.24.0`。 |
| 宿主 Agent／消费者 | 当前宿主 Agent 使用已安装 Skill／helper 完成下节业务维护与真实脚本修复；独立消费者读取全部九类对象和 E6A／B／R／C。 |

| 最终实际命令 | 结果及记录 |
|---|---|
| `bun test test/product-maintenance.test.ts test/product-maintenance-install.test.ts` | [19 pass / 0 fail](project-maintenance-evidence/checks/product.json)，其中 18 项产品行为、1 项安装，126 个断言。 |
| `bun run test:workflow-vnext-source` | [19 pass / 0 fail](project-maintenance-evidence/checks/source.json)。 |
| `node --test test/vnext-assistance.test.mjs test/vnext-task-management.test.mjs` | [28 pass / 0 fail](project-maintenance-evidence/checks/assistance.json)。 |
| `bun run test:workflow-distribution` | [26 pass / 0 fail](project-maintenance-evidence/checks/distribution.json)，包含 Runtime／维护 helper 及完整分发构建。 |
| `bun run validate:vnext-source` | [通过](project-maintenance-evidence/checks/registration.json)：9 daily、1 administrative、2 expert、28 capabilities；Runtime operations 仍为 11。 |
| `bun run validate:protocol` | [通过](project-maintenance-evidence/checks/protocol.json)，源码项目未绑定 target-project 检查槽。 |
| `bun run validate:freshness` | [通过](project-maintenance-evidence/checks/freshness.json)；已执行 `bun run gen:all`，未手改生成资料。 |

最终[Distribution Manifest](project-maintenance-evidence/checks/distribution-manifest.json)为 `0.24.0`，摘要 `f80c1a1f1741326cfdf808b32370e8ad470c60e06c24d7c5e8dd3217eda3be08`，bundle 为 `bundle-052daf5aa79133cc062afa3e`。helper 的 SHA 为 `615657a417be0796c81145afec5c2f4379474f2ca5a86d6c79777cea2f6c7f8e`，与真实升级目录一致。

## 5. 实际宿主 Agent 与 E6 证据

该验收是当前宿主 Agent 对授权隔离目录中的合成业务材料进行的真实操作。输入、讨论人物及场景是合成数据；不是用户业务事故、真实用户聊天或平台完整导出。E6 基线代码有明确保留的种子缺陷，用于取得真实失败与修复，不冒称未知生产 bug。归档中的指令仅作资料。设计文件里的格式示例与本次实际执行证据分开。

[证据说明](project-maintenance-evidence/README.md)、[逐次请求与结果](project-maintenance-evidence/host-agent/agent-observations.jsonl)、[字节快照索引](project-maintenance-evidence/host-agent/snapshot-index.json)记录原验收位置、输入、输出和真实 event refs。只读快照不作为源码项目当前 PRODUCT。

实际顺序及观察：

1. 读取选定 brief；保存 partial 盘点、目标、模块、已知导入／错误需求、无 task 多设备候选、设计和三工作项计划。未读取其他业务保留为 unreviewed。
2. 原文 capture 后按实际候选正文判断三个议题。确认关联不修改需求；只采纳行号及原因的错误诊断片段。云端关系 dismissed。capture 重试复用同字节原文。当前导入正文单→三→单更新有实际来源和 preimage，保留离线约束。
3. 原任务服务实际创建 A、B。故意在已读摘要后追加用户编辑，绑定保存冲突；重新读取后只补绑定，task 数仍为 2。实际导入和空 label 检查通过，并留下未覆盖 ID 边界及自审范围。
4. 没有验证 task 时，Agent 运行空 ID 反例得到 exit 1，原始 stderr／stdout 保留。此处来源是 Agent 的实际无 task 检查，不写成“用户自己复现”。需求定义摘要保持 `df0de15f51c84db509579d589f679bd949dc8f3f5c2bbb1774830acc04247fc9`，原 PASS 与新增 pending 同时保留。
5. 读取相关正文并判断局部影响，在 A／B／C 的稳定安排中加入 E6R，保存原计划，创建真实修复 task。R 关联导入、诊断、历史 A 交付及问题来源；关联不认定缺陷由 A 引入。
6. 实际修改输入校验，运行有效单台、空／零／负数／小数／非数字 ID 和空 label 检查，全部通过，同一原反例 exit 0。R 关闭后旧 pending 仍在，随后用实际报告单独写 AS-FIXED 并选为当前摘要。旧失败／旧 PASS／历史 AS-BASE 均保留；未检查额外列、大数与其他业务，C 仍未创建。

| 工作项 | 真实 task_id | 最终事实 |
|---|---|---|
| E6A | `task-19a48ef12e4ed85aa3c8d751388b6bcc` | 原服务 closed，旧报告保留。 |
| E6B | `task-b826bc13b6b2256830175acc5597a7be` | 原服务 closed，未撤销或重开。 |
| E6R | `task-01bf13d3a5e7727efd33f8c55c9d7a6a` | 原服务 closed，关闭与复验摘要分开。 |
| E6C | 未创建 | 无虚构 task ID，不复制任务状态。 |

[最终升级证据](project-maintenance-evidence/host-agent/final-install-evidence.json)包含九个目标拥有文件升级前后相同的 SHA、安装 helper 与 payload 的相同 SHA，以及原反例与扩展检查实际 exit 0。[最终任务状态](project-maintenance-evidence/host-agent/final-task-status.json)来自原 assistance；[业务回读](project-maintenance-evidence/host-agent/final-product-readback.json)保留来源诊断、真实绑定、历史 pending 及选定新摘要。独立目录没有 Runtime 或 node_modules，消费者输出明确为文档报告、不计算 task 状态。

## 6. 使用和交付边界

使用[维护指南](../guides/maintain-project.md)。安装入口是 `.agents/skills/maintain-project/SKILL.md`；helper 是 `.workflow-system/runtime/support/product-maintenance.js`，JSON stdin／stdout。产品写入是实际逐文件结果，不提供跨文件事务；摘要复查与原子发布也不保证任意外部编辑器的严格 CAS。

实际验证环境为 Windows、Node `v24.12.0`、Bun `1.3.10`。未运行 `test:workflow-all` 或全仓 TypeScript 检查，未验证其他宿主模型、Node 20 或真实 TraceLens 前端。TraceLens 交付限于标准契约、格式样例、独立消费者与接入说明，未对其仓库写入。没有发布包、提交、推送或部署；用户业务项目也未升级。
