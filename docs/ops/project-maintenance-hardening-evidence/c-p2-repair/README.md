# C01–C03：共同写入链修复交付

日期：2026-10-06。worktree `project-goals-requirements`，分支
`codex/maintain-project-v1`，实际 HEAD 和勘察基线均为
`20ba0275270493b94b4f02eca33cc3b8c38b198d`。开始时已有 F01–F06、R01–R04
及业务资料的未提交修改；本次在它们之上继续修复，没有 reset 或覆盖旧修复/用户工作。
最新用户指令是“修复三项P2”。本地候选仍为未发布的 `0.24.1`，未提交、推送、发布或部署。

范围复审及用户基线见 [明确操作复审](../intent-baseline-review/README.md)。本次不增设业务
状态、task 状态、审批、force 或维护 gate。helper 对错误候选的具体诊断不否决用户目标；
当前明确决定可直接记录为 text 来源，不要求外部材料或重复确认。原 findings 与 verdict 保留，
用户修复处置、实际执行和范围自查另由现有 assistance 保存并回读。

[用户处置](../../../../.workflow-system/records/events/key-10de7db0a2ec9d8f9f27a68f4762a295c7ff7f40db9b677923c1f591c2f5483b.json)、
[执行](../../../../.workflow-system/records/events/key-3f8a49f15884df63f79a13e5bef1cfe31144c617383d1007ebc6276c810dec05.json)、
[范围自查](../../../../.workflow-system/records/events/key-35dabd12aeb82c9cdea26b4b7b229e4d3d40f93ae092ad3a0aad7eedaea34506.json)
均 recorded、association=applied。[管理回读](management-summary.json)确认当前范围 verdict=clean、
provenance=self-review，原 verdict=findings 和 C01/C02/C03 仍在。展示投影保持 partial/drift；
CURRENT_TASK 及旧审查原字节不变，源 task 仍为 draft，没有自动采用、结束步骤或关闭。

## 处置与正反证据

| Finding | 原行为 | 实际修复和允许的操作 | 仍被保护的反例 |
| --- | --- | --- | --- |
| C01 | 相同 text/uri/file 来源清理未知字段被认成新依据，错误 active 候选可保存。 | sourceKey 仅比较各类型已知依据字段，lines 仅比较 start/end。修格式保留 dismissed 可保存；当前明确反转作为 text 来源可同时修格式及重新关联。 | 只清理未知字段/显示信息、同材料换序或重试，不能自动恢复否定；失败原字节不变。 |
| C02 | 有同身份的 dismissed 历史及既有 active 关系时，未改关系也阻挡 scope、assessment_id 等无关修改；20ba 可以保存。 | 只核对实际激活：新 ID、dismissed→active 或真实关联身份变化。既有 active 且身份未变不重新审批，无关字段及说明修正可正常保存。 | 新增等价 active ID、将既有 active 改向被否定对象，仍需当前真实依据；不默默删除 dismissed。 |
| C03 | flow 序列整体重序列化或正文多补 LF，改变无关坏项字节，append/同文件拆分失败。 | AST 序列定位只插入新映射，保留 flow 注释/尾逗号及 block 缩进；正文复用已有行尾，不追加额外空行。普通新增、连续新增和同文件拆分可保存，坏邻项无需先修好。 | 正文真实二级越界、身份挪用、写入版本冲突等保护保留；失败不会写坏原文或宣称已保存。 |

原 helper SHA `9473c3213f529fe28743ff3708e39ca897a75abc34b29f56950335a985e742d4`。
三组持久回归在原 `test/product-maintenance.test.ts` 中追加，修前均失败，见 [RED](red.txt)。
[GREEN](green.txt) 为 3 pass / 232 assertions，覆盖 links/task_bindings、局部/整文件、
三类 SourceRef、坏来源未知成员、当前明确反转、无关字段变化、真实新激活、block/flow、
注释/尾逗号、缩进、BOM/LF/CRLF、连续新增、同文件拆分及原字节/preimage。

[Node 对照](results.json) 为 12 个有意义场景在实际 20ba `0.24.0`、本次修前 `0.24.1`
及修后 `0.24.1` 三套二进制上的 apply/read；36 组观察不当作 36 个持久测试 PASS。
当前期望全部吻合。原 C01 错误放行改为失败且原文不变；C02/C03 的合法请求转为 saved；
当前明确反转和原对照分支继续 saved。所有输入、前后字节、返回结果及回读可追溯。

## 四层检查

| 层次 | 本次实际结果 | 证据 |
| --- | --- | --- |
| 源码 | product-maintenance 31 pass / 548 assertions，保留原 28 项；vNext source 19 pass / 115 assertions；protocol/freshness 通过。 | [产品](product.txt)、[source](source.txt)、[protocol](protocol.txt)、[freshness](freshness.txt) |
| 分发 | Runtime/helper/契约副本/payload 全从源构建；Distribution digest `a59816e08e913843321841c0d3b2969235dba087371dd2e0e77e0e6ed0a30013`，bundle `bundle-d9fa65b3a7b245c48fc3abd0`。 | [构建及安装测试](install.txt)、[manifest](distribution-manifest.json) |
| 安装 | 安装回归 1 pass / 112 assertions，目标 Node 正反路径包括 C01–C03、既有 F/R 回归及维护失败后的 assistance record/prepare/task-status。另在全新隔离目录真实安装基线 `0.24.0` 后升级最终候选 `0.24.1`，11 项目标业务资产 SHA 全不变。 | [安装](install.txt)、[旧版本新装](delivery-old-install.json)、[升级](delivery-upgrade.json)、[原文保护](upgrade-assets.json) |
| 宿主／离线消费者 | 当前 bundled/安装 helper 以 Node 实际执行并回读；独立离线消费者无 Runtime/node_modules，读取 ID 与 helper 一致且坏项诊断保留。单一合成历史数据快照读取为 9 文件/27 usable/1 invalid、请求字节完整；inventory.partial、pending_sources 和原失败仍在。 | [Node 输出](node-probes.txt)、[消费者](offline-read.json)、[摘要](delivery-summary.json) |

本次合计 **51 项不同测试，0 fail，775 assertions**；定向重跑、Node 对照及 protocol 内部
测试数不重复累加。旧 53/48 等通过数属于历史，不算本轮 PASS。源码之外的实际 Node 行为
验证了合法操作仍可达成，但不是宿主模型理解业务的认证。

最终 helper SHA `cc4ebd6af391d43e601d499404efa88d3e5b2469581edca6295ff919d24d2387`；
离线 reader SHA `8b923e073a8cc27c8bf8cd8c0524980df6082525f8d05fb402d239ae5179de2a`。
权威 document-contract 与生成副本 SHA 相同：
`dbaa7ad47e86018a3ad6da0942ea27c659f8e766fcf3c0596b27d2e6491845da`。
同版本不同内容的旧候选安装目录未覆盖；真实升级使用新的隔离目标。

## 文档、原功能和限制

产品代码仅继续修改共同 writer：已知来源比较、真实激活比较、追加候选生成。原
read/check/capture、路径权限/联接策略、显式 v1 迁移、身份保护、局部降级、幂等绑定及
原 assistance/reducer 逻辑未扩项；F01–F06、R01–R04 和原功能回归本次实际重新通过。
契约/API 说明精确语义；recovery reference 明确合法候选转换/恢复与用户目标的关系。

不承诺任意损坏文档都能原位置自动追加。无法可靠定位根 AST、无行尾的坏 EOF 等不能
同时做到合法边界和坏条目原字节不变时，Agent 在既有授权内选精确原文修复、合法完整
候选或已授权文档位置，不要求修复所有无关资料，不把具体失败扩成用户不能新增/拆分。
本次没有新增这类文档状态或审批接口，也未将所有格式边界列为新功能。

S01–S13 的原覆盖映射继续在上级报告；本次仅补 S03/S10/S13 等共用写入子分支证据，
未重演全部业务决定。真实宿主 Agent 的业务恢复遵从、跨模型、真实项目/硬件/TraceLens
页面、Linux/最低 Node20、npm/tgz 安装、完整 workflow/任务服务套件未在本次执行。
安装内用原生 assistance 验证具体失败不影响记录/prepare，不冒充完整 reducer 回归。
四个 closed 的任务消费来自合成旧快照，未重跑业务或关闭/重开这些 task。
源任务保持 draft；原 CURRENT_TASK 展示 drift 不覆盖，事实关联与展示分项记录。
外部编辑器竞态和跨文件非事务的既有限制仍在。自查只覆盖本次修复及所列回归，不代替
独立审查，不宣称当前项目需求全面交付 PASS。

复现探针时将本目录 probes.ts/delivery.mjs 放在源码根 `.tmp/c-p2/`，探针中的相对 import
及版本路径对应这个位置。源码用 Bun；目标 helper、安装和离线读取使用 Node。
