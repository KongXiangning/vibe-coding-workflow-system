# D01／D02 修复交付与原功能核对

日期：2026-10-06。worktree `project-goals-requirements`，分支 `codex/maintain-project-v1`。
实际 HEAD 仍为 `20ba0275270493b94b4f02eca33cc3b8c38b198d`；对象是保留此前全部未提交修复的
本地候选 0.24.1。没有 reset、覆盖用户工作、提交、推送、发布或部署。
[上一轮审查](../post-c-p2-review/README.md)及原始 findings 不改写，旧 PASS 不计入本次结果。

## 修复及正反证据

| 项目 | 修前真实行为 | 本次实现与合法路径 | 保护和反例 |
| --- | --- | --- | --- |
| D01，原功能回归 | 合法正文以闭合 HTML table 结束，仅一个末尾 LF；20ba 可 append，修前 helper 报 BODY_BOUNDARY，新需求未保存。 | 共同 bodySeparator 根据实际末行补足根标题前的空行，用于局部正文替换及每个追加条目。无末尾换行、单换行、空白末行、LF／CRLF、闭合 HTML 和批量追加均有稳定回归。原正文每个字节不 trim、不重写；需求定义摘要保持。 | HTML 及普通正文旧行为可用；坏邻项 YAML 映射和旧正文连续字节保留，完整 preimage 保留。仅写入器在原 EOF 后新增的确定性分隔行免于被算作旧坏项修改。额外根二级标题仍 BODY_BOUNDARY，磁盘原文不变。 |
| D02，C02 遗留误拒绝 | 存在 dismissed 历史及重复 active ID，只改 scope，关系数组未变；原文 usable，重复仅 warning；修前局部／整文件均 DISMISSED_RELATION，bindings 同样。 | 未变关系字段不重做激活检查；实际变化先匹配完整保留行，再匹配同 ID／身份的说明等编辑，每份旧 active 只匹配一次。重复原值、warning、否定决定保留，scope 及既有关联说明可保存。 | 新等价 ID、新增重复 active 行、同 ID 混合状态下 dismissed→active 都不能借重复掩盖激活。无新依据失败且原文不变；当前用户明确反转记录为 text 来源后可合法保存，不要求额外材料或重复确认。 |

本轮新增两个稳定产品回归组，扩展既有安装回归；F01～F06、R01～R04、C01～C03 和原产品回归
全部保留。C03 的旧断言将解析器 body 范围与业务原文混为一体；现在核对旧 body 的所有原始字节
及仅含新增行尾的后缀、旧映射精确字节和 preimage，未放宽任意改写旧正文。分隔符例外只适用于
helper 构造的局部 EOF 追加，不是公开 force 字段、整文件绕过或任意 Markdown 兼容。

修改包括 writer、两份测试、权威 document-contract、API、recovery reference、实施／验证／交付记录。
主 Skill 路由、其他业务能力、路径权限、联接跳过、身份／v1 显式迁移、历史来源与保存冲突保护未改变。
生成 contract、helper、Runtime 和分发从源码重建；未手工补 dist。没有新业务状态、维护 gate、审批、
task reducer、自动重新打开 task／恢复 retired 目标或自动创建 PRODUCT。

## 实际验证与四层结果

[修前 RED](red.txt)两个新回归失败；[修后 GREEN](green.txt)两个回归通过，197 个断言。
最终不同测试 **53 pass / 0 fail，993 个断言**，不重复累加 RED／GREEN、Node 样例或协议内部测试：

| 层次 | 实际结果 | 证据 |
| --- | --- | --- |
| 源码 | 产品 33 pass／753 assertions；源码契约 19 pass／115 assertions；协议及生成新鲜度通过。 | [product](product.txt)、[source](source.txt)、[protocol](protocol.txt)、[freshness](freshness.txt) |
| 分发 | Bun 1.3.10 从源码构建 Runtime、helper、离线 reader、契约及分发；源／生成 contract SHA 相同。0.24.1 为未发布本地候选。 | [Runtime 构建](build-runtime.txt)、[分发构建](build-distribution.txt)、[实际 manifest](distribution-manifest.json)、[摘要](summary.json) |
| 目标安装 | 既有安装回归 1 pass／125 assertions，由 Node 运行已安装 helper，包括 D01、D02 正反及原覆盖。另在全新隔离目录实际安装 0.24.0 再 upgrade 至本次 0.24.1，11 项原业务资产 SHA 全相同；安装 helper 与源码产物一致。 | [install](install.txt)、[旧版本安装](delivery-old-install.json)、[升级](delivery-upgrade.json)、[资产](upgrade-assets.json) |
| 当前宿主 Node／离线消费者 | 13 个确定性写入样例 × 基线／修前／当前三套 Node 二进制，39 组输入、read、apply、原文及回读；当前预期正反均匹配。实际升级后的 helper 组合执行 D01 追加与 D02 scope 更新并回读；独立离线目录没有 Runtime／node_modules，读到新需求、原重复关联和 warning，与 helper 可用 ID 一致。 | [对照](results.json)、[探针输出](probes.txt)、[安装后输入](delivery-d-request.json)、[apply](delivery-d-apply.json)、[回读](delivery-d-read.json)、[离线](offline-read.json)、[交付摘要](delivery-summary.json) |

最终 helper SHA `43184d80b42a80f3852e8933ad3b6a808dc79ab32191556fcc7a78b8930dcb0e`；
修前 helper `cc4ebd6af391d43e601d499404efa88d3e5b2469581edca6295ff919d24d2387` 保留用于对照。
离线 reader SHA 仍为 `8b923e073a8cc27c8bf8cd8c0524980df6082525f8d05fb402d239ae5179de2a`。
Distribution digest `aebb8ef2f66aea304fefbd896ce92ef63f071dc685814c07d2345f825de5d990`，
bundle `bundle-4ea664a2b9816ded1bb42556`。执行环境 Windows／Node v24.12.0／Bun 1.3.10。

交付合成资料最终读取 10 files、29 usable、1 invalid，请求字节覆盖 complete；原 inventory.partial、
坏项、pending_sources 和历史报告保留。这不是整体业务或需求交付 PASS。四个 closed task 来自
此前受控合成快照，只回读消费，未重演执行、关闭或重新打开。当前 13 个写入样例不是 S01～S13
业务场景重验；原映射和已有证据保留，不能用本次确定性结果声称宿主业务语义全部通过。

## 记录、范围及剩余限制

本次用户修复决定和实际执行复用 TASK-011／原计划 A，原生 recorded／association 及 task-status
回读见本目录 management-summary.json 与相关结果；旧 D01／D02 findings 不改写，测试成功
不自动变成正式 clean review、计划采用、步骤结束或 task close。CURRENT_TASK 原字节保留，
原展示 projection.partial／drift 单独报告，不为补投影重新执行业务。

本次是修复自查和确定性合成验收，未新增正式复审／独立审查，也未重新执行 S01～S13 宿主 Agent
业务决定、真实生产项目、跨模型语义／恢复遵从、硬件或 TraceLens UI 验收。未运行完整 workflow／
任务服务套件、Linux、最低 Node20、npm/tgz 安装或生产部署；局部单文件发布的外部编辑器竞态、
跨文件非事务等原限制仍在。纯 CR frontmatter 的试验夹具在原读取阶段不可用，已改为可用 CRLF
夹具；本次不扩展 YAML 输入兼容，也不宣称纯 CR 完整文件已验证。环境限制均不否决用户已明确
的新增、拆分、范围调整等操作；必要格式转换、保留原文与决定后继续完成保存／回读。

探针 probes.ts 需放到源码 `.tmp/d-p2/probes.ts`，保留三套二进制路径，使用 Bun 编排／Node 执行。
delivery.mjs 必须在全新 `.tmp/d-p2/host-final`／offline-final 使用，不覆盖此前同版本候选安装。
脚本只用于隔离确定性验证，不是预填答案的宿主 Agent 语义验收脚本。
