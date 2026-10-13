# Implementation Roadmap v4：实施与验证记录

实施日期：2026-10-14。输入为用户提供的 `vNext_Implementation_Roadmap_v2.md`（2026-10-13 设计 v2），用户本轮授权“按方案实施”。文档中的设计输入不视为既有交付证据。

## 实际实施范围

- A：正式 v4 文档契约及闭合 Schema，内部 `plan`／WorkItem／TaskBinding 接口保留，Manifest 仍为 v2；v1/v2/v3 兼容、单文件显式迁移和降级保护。
- B：显式选择路线图，project-current／target-subgraph／explicit-requirements，成员及实际定义算法、上下文和安排摘要比较；差异、未知、版本延期与来源定位；新基线保存前、发布前和保存后核对。纯读取不写记录，不导入 Task reducer，不计算交付。
- C：maintain-project 的首次、持续、局部维护及下一业务选取指引，prepare-task 的相关局部消费及 close-task 的续接优先规则；成功需求保留、失败只补局部，不新增规划门禁。Skill 文本是宿主行为指导，不能据此声称所有宿主行为已经验收。
- D：Schema、模板、合成可运行示例、安装 API／契约和离线只读消费者。TraceLens 交付的是生产侧契约与示例；未修改其独立仓库或声称页面完成。

只保存成员身份、摘要和少量来源／处置，不新增后台监听器、服务、全局状态库、未来 Task 或第二份需求正文。WorkItem 的 included/deferred/withdrawn 是规划状态，current 是版本核对结果，两者都不是交付 PASS。

## 验证结果

环境：Windows PowerShell，Bun 1.3.10，Node 本地运行；源码基线 `73ce058c7cad1dc20cca2575ab38e941a1207c77` 加本轮未提交改动。测试夹具是隔离合成项目，不是业务项目部署或宿主语义正确性的证明。

| 实际命令／检查 | 结果 |
|---|---|
| `bun run build:vnext-runtime`、`bun run build:product-maintenance` | 成功；Node 辅助程序与离线消费者重新构建，v4 Schema／契约／模板／示例生成 |
| `bun test test/product-maintenance.test.ts test/product-maintenance-v3.test.ts test/product-maintenance-roadmap.test.ts` | 最终 72 pass、0 fail；其中新增路线图 12 项，含源码与实际 Node bundle 路径 |
| `bun run build:vibe-governance-distribution` | 成功；本地 0.24.8 候选包，bundle `bundle-12ae5c9f07d949a09940e733`，manifest SHA-256 `452b5276ed9ca8e4ed041c7df09c3b811eb87b5dfb8abe3fd439cb88e78ef912`；不是 npm 发布 |
| `bun test test/product-maintenance-install.test.ts` | 最终 3 pass、0 fail；实际隔离安装与升级后执行 Node，回读 v4 基线，发现手工差异，只读不写，业务字节保留 |
| `bun run validate:vnext-source` | 通过；maintain-project／prepare-task／close-task 模板符合现行源码契约 |
| `bun run validate:protocol` | 通过；协议验证及其必要定向检查通过，无已绑定项目级 slot |
| `bun run validate:freshness` | 通过；既有生成文档与 registry 新鲜 |
| `bun run workflow:health --root .` | OK；生成新鲜度和协议通过 |
| `git diff --check` | 通过 |

初次回归曾出现资产生成测试临时目录未复制新增示例的失败；已补齐夹具输入，最终 72 项回归全部通过。未通过重试修改业务事实或放宽核对。`test:product-maintenance` 已纳入 v3 与路线图回归，后续执行该入口会验证新能力。

## 验收矩阵与边界

| 场景 | 证据范围 |
|---|---|
| T01、T02 | 24 项完整与 6 项局部首版基线；原 ID 保留，其他 18 项可见，无未来 Task；源码及 Node bundle 行为测试 |
| T05、T09、T10、T11、T13、T14 | 多 WorkItem 同一需求、无 Change 手工修改、新增未引用成员、局部无关新增、重排、退出的确定性比较 |
| T12、T15、T16 | 精确版本无需调整／延期，后续版本变化重显；旧 v3 Plan 未知且仅迁移选定文件 |
| T17、T18、T22 | 有限读取／部分核对未知、旧读取版本拒绝、跨文件部分成功保留、写入后回读、重复检查无额外记录 |
| T19、T21 | 显式 plan_id 与工作副本身份；安装后的只读示例可消费 v4；TraceLens 页面未验证 |
| T03、T04、T06、T07、T08、T20 | 对应历史交付／直接 Task／下一业务／真实前置／Change 定位／父续接已写入 Skill 及契约；本轮不把静态指导或算法夹具冒充真实宿主组合流程验收 |

未运行真实用户宿主 Agent 的首次与增量语义验收，未部署／升级 fixflow 或其他业务项目，未发布 npm、提交或推送，未执行 test:workflow-all。范围归属的自然语言含义、真实交付及前置仍由宿主 Agent 判断。跨文件没有严格事务保证，最后瞬间的外部编辑器竞争仍可能使已保存基线待复核；结果保留真实已存文件并报告 partial。

## 使用与恢复

新需求／定义先保存并回读，安排按已授权决定保存并回读，再保存实际核对基线。`snapshot_proposal` 只是材料，不自动认证已核对。缺少定义快照或 unread_sources 非空可保存局部基线，但再次消费为 unknown。不同副本的基线须在实际副本重新核对，不自动认证。

若需求保存成功而路线图失败，不回滚需求；下次消费会从成员／定义差异重新发现。保留陈旧基线的普通路线图编辑正常保存。管理任务的旧 CURRENT_TASK 展示漂移仍保留原文件，实际任务状态使用 assistance task-status；该展示缺口不影响产品源码工作。

## 审查发现修复（2026-10-14）

用户在 review-change 后授权“修复”。原审查 RM4-R1（P1）与 RM4-R2（P2）及其自审 provenance 保持原样，修复形成新的执行结果；本节是实现自查，不是独立正式复审或步骤关闭。

- RM4-R1：所有选择器都核对托管身份读取完整性；受限 paths、预算遗漏或无法解析的托管文件可能隐藏重复 ID，派生 unknown。完整身份读取不扩大局部业务范围，也不成为 Task Gate。新增源码／Node bundle 反例覆盖隐藏重复身份、未读文件和无法解析结构；实际安装后也验证受限读取不会返回 current。
- RM4-R2：新建／前移快照仍必须匹配当前版本；同一项目、工作副本和 selector 中的旧快照可以原样保留。保存前、发布前和回读均使用写入前的有效旧条目作为保留依据，不能用刚写入的数据自证。回读 retained_snapshots 标示旧字段／ID，消费继续保留明确 definition-changed 和 stale_exceptions。首次建立、换作用域及伪造旧值不能以保留为名绕过检查。
- 实际并发保护仍验证“已读中间版本在保存前再次变化”会被拒绝，不回滚已保存需求。原测试把保持原快照也作为拒绝条件，与修复后的保留语义冲突；已改成上述真实前移版本竞争，而不是删除并发验收。

本轮实际检查：

| 检查 | 结果 |
|---|---|
| build:product-maintenance | 成功；源码、Node bundle、离线消费者和安装契约同步 |
| 产品维护／v3／路线图定向回归 | 77 pass、0 fail，其中路线图 17 项 |
| build:vibe-governance-distribution | 成功；仍为未发布本地 0.24.8 候选，bundle `bundle-684c2e262294bcf9484cefb3`，manifest SHA-256 `fac7fbd199a3721683c0794efaac8fe4d816e95f83def433bb2a52c5c9f55d6f` |
| product-maintenance-install | 3 pass、0 fail；新修复在实际安装后的 Node 辅助程序中验证，升级保持业务字节 |
| validate:vnext-source／validate:freshness／git diff --check | 通过 |

未运行全量 test:workflow-all，未新增独立正式审查，未升级业务项目或发布／提交／推送。旧 CURRENT_TASK 漂移仍保留；执行事实保存、关联及实时 task-status 分别核对。
