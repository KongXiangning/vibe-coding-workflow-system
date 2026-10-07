# 外部 00e5309 审查 R1／R2 修复交付

日期：2026-10-07。worktree `project-goals-requirements`，分支 `codex/maintain-project-v1`。
实际 HEAD：`00e5309e872130f87fc1c33525bf944eb394b824`，修复前工作区干净。
本次只修复外部报告 R1／R2，与此前 R01～R04 编号不同；保留原提交及全部既有修复。
本地候选仍为未发布 `0.24.1`，本次未提交、推送或部署。

输入为用户提供的[原审查报告](external-review-00e5309.md)，报告 SHA256
`a10bd228e8bda0f82a1235439e37fbf0d6b7b74c5f0c7721584d70f0e1176254`。
原报告和旧 findings 保留；R3／R4 读取范围误报本次未修改，不能认定完整加固通过。

## 修复、原行为及合法操作

| 项目 | 修前真实行为 | 实现与正反结果 |
| --- | --- | --- |
| R1，整文件 YAML 差异漏判 | 引入同值重复键或未使用 anchor，解码值／正文未变，saved=true，却使需求 unusable；反向删除坏语法被 INVALID_ITEM_CHANGED 拒绝。 | 受影响条目比较解码值、YAML 映射原文和结构诊断。非法引入失败、磁盘不变；整文件合法修复成功、preimage 精确保留，另一坏项的原 YAML／正文不变。覆盖块／流式 YAML、标量及条目 map anchor、anchor 改名、无变化重试。绝对行号／items 序号不参加比较，YAML 错误文案去除内嵌位置但保留独立 line 字段，前项换行不会误选未改的坏邻项。 |
| R2，重复 ID 的 dismissed 历史丢失 | 两个不同目标／task 的 dismissed 共用 ID，候选保留一个即可静默丢掉另一个；links／bindings、局部／整文件均 saved。 | 逐份匹配完整保留行及同 ID／实际身份，每份旧行只匹配一次。不同关联及第二份相同历史的未声明删除失败、磁盘不变；普通 scope／说明维护、数组换序、当前明确决定下恢复成功。remove_relations 验证实际删除的旧行，允许保留同 ID 另一行；无实际删除的声明失败，声明不能绕过恢复依据。恢复时区分共享 ID 的不同身份，同时保留跨 ID 等价关联及旧 ID 重新指向其他目标的原历史保护。 |

用户明确操作仍通过已有授权的格式修复、决定记录、精确删除及回读完成；没有新增业务状态、
维护 gate、审批字段或公共请求字段。没有全面禁止整文件、坏条目修复或合法重新关联。
原文、未改约束、否定决定及恢复决定保留，原 v1 显式迁移、身份、路径／联接、摘要冲突、
单文件发布和独立任务路径保持。源码及生成差异摘要见 [summary](summary.json)。

源码变更在 writer／parser；扩展原产品及安装回归，更新权威 document-contract、安装 API、
recovery reference、实施／验证和交付记录。主 Skill 路由及其余 references 无须重建业务场景。
Runtime、helper、离线 reader、契约副本及分发从源码生成，未手工补 dist。

## 最终验证与四层结果

[原缺陷 RED](red.txt)两个回归失败；补充的[诊断位置反例](diagnostic-position-red.txt)和
[旧 ID 保护反例](id-repurpose-red.txt)发现中间候选缺口后修正。最终 [GREEN](green-targeted.txt)
两组通过／112 断言，已包含在产品套件内，不重复计数。中间候选 helper `b5eacdb7…` 的结果
不能作为最终产物证据；私有 `.tmp/review-r1-r2/iteration-1` 保留当时输出及二进制。

最终不同测试 **55 pass／0 fail，1151 个断言**；不累计协议内部测试、RED／GREEN或 Node 探针：

| 层次 | 本次实际结果 | 证据 |
| --- | --- | --- |
| 源码 | 产品 35 pass／873 assertions，包括原 33 项；vNext 源码契约 19 pass／115 assertions；协议及生成新鲜度通过。 | [产品](product-tests.txt)、[源码契约](source-tests.txt)、[协议](protocol.txt)、[新鲜度](freshness.txt) |
| 分发 | Bun 1.3.10 重建 Runtime、helper、reader、契约和分发；源／生成 contract SHA 相同。0.24.1 是本地候选。 | [Runtime](build-runtime.txt)、[分发](build-distribution.txt)、[实际 manifest](distribution-manifest.json)、[摘要](summary.json) |
| 目标安装 | 原安装回归 1 pass／163 assertions，由实际已安装 Node helper 执行旧覆盖及 R1／R2。另在全新隔离 Git 项目真实安装 0.24.0，再升级本次 0.24.1；11 项原业务资产 SHA 全相同，安装 helper 等于源码产物。 | [安装回归](install-tests.txt)、[旧版安装](old-install.json)、[升级](upgrade.json)、[资产](upgrade-assets.json) |
| 当前宿主 Node／离线消费者 | 复用原审查 8 个原始输入，修前／当前已安装二进制共 16 次观察；修前原行为与原报告一致，修后预期正反均匹配。升级后的项目实际执行坏语法修复、未声明删除拒绝、当前决定恢复及明确部分删除并回读；独立离线目录无 Runtime／node_modules，可用 ID／最终关联与 helper 相同，坏邻项仍有诊断。 | [原输入及对照](node-replay.json)、[安装后修复](installed-r1-repair.json)、[拒绝](installed-r2-implicit.json)、[恢复](installed-r2-reversal.json)、[删除](installed-r2-removal.json)、[回读](installed-readback.json)、[离线](offline-readback.json)、[交付摘要](delivery-summary.json) |

最终 helper SHA `a6df4d52ce65efa9d6ed106f86696ded8ddb3f1df896a625d2cd095d1a84dce3`；
修前 `42ca8baf451c48af30f68f5804a932684ea44740427d3b3cda017e87c8109bf5`。
离线 reader SHA `782d00fed8572df4f00c38e86f4f3e70035bf1d2b932007e81affb754efb68df`；
distribution digest `2c8b3bf5ba1a77e4f0faf8b05d43fdbe6df9f4b3d4f6e366ec29e22090916d6b`，
bundle `bundle-da299bd5edd0706ef9e8decb`。环境 Windows／Node v24.12.0／Bun 1.3.10。

首次升级夹具未独立 Git init，被既有 TARGET_ROOT_DENIED 正确拒绝，
[失败原结果](fixture-initial-install-rejected.json)保留。随后新建独立 Git 项目验证，
没有修改安装器规则或覆盖任何旧目标。最终只读到该合成范围字节完整，29 usable／2 unusable；
坏项、原 inventory.partial、pending_sources 及历史材料仍保留，不是全项目业务交付 PASS。

## 记录及尚未验证的范围

实际执行及三项套件结果复用 TASK-011／计划 A，通过原生 assistance 保存；事实、关联、投影
分别见 [management-summary](management-summary.json)及请求／回执。没有自动采用计划、切换焦点、
完成步骤、关闭或重开 task。CURRENT_TASK 和旧审查原字节保留；旧展示 drift 单独报告。
本次是修复自查，未生成正式 clean review，外部 R3／R4 仍为已知未修项。

本次没有重新执行 S01～S13 宿主 Agent 业务判断、真实生产项目、跨模型语义／恢复遵从、
硬件或 TraceLens UI 验收；原覆盖映射和其证据限制保留。这些脚本使用确定性合成夹具，
不能证明真实宿主语义通过。没有运行完整 workflow／任务服务套件、Linux、最低 Node20、
npm／tgz 安装或生产部署。跨文件非事务、外部编辑器非严格 CAS 等原限制保持。

[replay-and-delivery](replay-and-delivery.mjs)应在源码 `.tmp/review-r1-r2` 运行，第二参数是
用户证据包解压路径；需保留修前 helper，使用新的隔离目标名，不能覆盖已有同版本目标或原观察。
[collect-and-record](collect-and-record.cjs)只收集已运行结果并保存真实执行事实；原生 idempotency_key
用于已有事实恢复，不允许重复执行业务。两者不是预填宿主 Agent 业务答案的验收脚本。
