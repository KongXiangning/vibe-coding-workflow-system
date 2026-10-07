# 外部 00e5309 审查 R3／R4 修复交付

日期：2026-10-07。worktree `project-goals-requirements`，分支 `codex/maintain-project-v1`。
实际 HEAD：`00e5309e872130f87fc1c33525bf944eb394b824`；起始工作区保留上一轮未提交的
[R1／R2 修复](../r1-r2-repair-00e5309/README.md)，未 reset、覆盖或重复实施。
本轮只修复 R3／R4，候选仍为未发布 `0.24.1`；没有提交、推送、部署或修改真实业务项目。
[原审查报告](../r1-r2-repair-00e5309/external-review-00e5309.md)与旧 findings 原文保留。

## 原行为、实现和合法操作

| 项目 | 修前真实行为 | 本轮修复及正反证据 |
| --- | --- | --- |
| R3，选定 glob 遗失具体登记义务 | manifest 具体登记 PROJECT.md 和缺失的 MISSING.md；默认 read 正确不完整，改为 paths=[docs/product/*.md] 却 complete=true／exit 0。 | catalog 把本次选择内的具体 managed_paths 登记和 entry 加回枚举；缺失仍有 PATH_UNAVAILABLE／omitted，read exit 1、check partial，独立可用条目保留。排除／未选登记不扩入范围，合法零匹配仍完整；找回具体文件后可读。coverage.paths 保留原请求，没有新增公共字段、状态或 gate。 |
| R4，文件冒充 glob 目录 | section 是普通文件，但请求 section/*.md；read／check／离线均 complete=true、exit 0。 | 枚举时区分具体文档和 glob 静态目录前缀的用途；非目录报 PATH_UNAVAILABLE／omitted，独立条目继续读取。真实空目录、未选／排除前缀和通配目录内普通不匹配文件不误报。一个路径兼作具体文档时仍可读该文档，同时保留目录缺口，不因前缀已访问而丢掉用途判断。 |

核心实现只改 catalog／paths 共同读取链，writer／parser 与上一轮 SHA 完全相同；R1／R2
完整回归仍通过。原权限、安全路径、排除、默认软件／构建目录跳过、真实 Windows junction
跳过及硬预算策略保持，不枚举全部 source_paths、不新增 task 状态或维护 gate。
读取缺口不拒绝用户明确操作：本次实际在缺失登记仍存在时保存一个授权新需求，再按其精确路径
回读成功。未改资产、用户决定及历史材料保留；读完整性、结构、业务盘点和交付分别报告。

更新原权威 document-contract、安装 API、inventory／recovery references、实施／验证／交付记录。
主 Skill 及其余业务 references 无须重建；Runtime、helper、reader、契约副本与分发均从源码生成。

## 最终测试和四层结果

[RED](red.txt)两个新回归均复现漏报；[GREEN](green-targeted.txt)两组通过、56 断言，
已计入产品套件，不重复累计。最终不同测试 **57 pass／0 fail，1241 个断言**：

| 层次 | 本次实际结果 | 证据 |
| --- | --- | --- |
| 源码 | 产品 37 pass／929 assertions，保留原 35 项；vNext 源码契约 19 pass／115；协议及生成新鲜度通过。 | [产品](product-tests.txt)、[源码契约](source-tests.txt)、[协议](protocol.txt)、[新鲜度](freshness.txt) |
| 分发 | Bun 1.3.10 从源码重建 Runtime、helper、离线 reader、contract 与本地候选；源／生成 contract SHA 相同。 | [Runtime](build-runtime.txt)、[分发](build-distribution.txt)、[manifest](distribution-manifest.json)、[摘要](summary.json) |
| 目标安装 | 原安装回归 1 pass／197 assertions，实际已安装 Node helper 验证 R1～R4 和旧功能。另在新的隔离 Git 项目实际安装 0.24.0→升级本次 0.24.1；11 项业务资产 SHA 全相同，安装 helper／reader 与源生成产物一致。 | [安装回归](install-tests.txt)、[旧版安装](old-install.json)、[升级](upgrade.json)、[资产](upgrade-assets.json) |
| 当前宿主 Node／离线 | 4 个原审查读取输入及 10 个文件系统控制组，在修前／当前已安装 helper 上共 28 次观察；独立 reader 真实默认接口另有 14 次观察，共 42 次，预期均匹配。新升级项目再次验证 R3 选定缺口、R4 read／check 缺口、独立授权保存及回读；无 Runtime／node_modules 的离线目录读到相同可用 ID，并正确报告 R4。 | [原输入及对照](node-replay.json)、[R3](installed-r3-selected-gap.json)、[独立保存](installed-independent-save.json)、[精确回读](installed-scoped-read.json)、[R4 read](installed-r4-read.json)、[R4 check](installed-r4-check.json)、[离线缺口](offline-r4-gap.json)、[最终 helper](installed-final-read.json)、[最终离线](offline-final-read.json)、[交付摘要](delivery-summary.json) |

控制组包括合法空 glob、未选／排除登记、真实空目录、未选／排除前缀、普通非匹配文件、
source 目录中的文件／真实 junction 不被全扫、相关和排除的真实 Windows junction、文件预算。
每个只读夹具的原文件字节均核对未变。离线 CLI 没有 paths 或预算选择接口，14 次离线对照
只运行其实际默认接口；R3 的默认具体文件缺失在修前已可报告，不能冒充新增离线选择能力。

修前 helper SHA `a6df4d52ce65efa9d6ed106f86696ded8ddb3f1df896a625d2cd095d1a84dce3`；
最终 helper `aed9d8674db7a85dae521e42fda2d2251903d3dd8758aa34eb4fa174f68a97ed`。
离线 reader 从 `782d00fed8572df4f00c38e86f4f3e70035bf1d2b932007e81affb754efb68df`
变为 `ad7cddbedf6d519894f697119d4b224b2fb49e5bb7e4da5e9b0313856ff600be`。
Distribution digest `13f8766e2bfd98f0fc0d65ad5002b18c6befd4b49cddc0867b85fa29560b7ed2`，
bundle `bundle-d96c691686ae532c7f7c5325`。环境 Windows／Node v24.12.0／Bun 1.3.10。

升级后探针临时调整的是私有夹具 manifest；原文件精确恢复后，11 项原业务资产字节再次一致。
新需求和非目录原文件保留在夹具中。最终恢复范围读取 28 usable／1 unusable，字节范围完整；
旧坏项、inventory.partial、pending_sources 和历史报告保留，不能据此宣称全业务交付 PASS。

## 原生记录和剩余限制

实际执行及三项套件结果复用 TASK-011／计划 A，通过 assistance 保存；事实、关联、展示
投影分别见 [management-summary](management-summary.json)和请求／回执。R1／R2 的执行事实、
原审查和 CURRENT_TASK 字节保留，既有 projection.partial／drift 单独报告；没有自动采用计划、
切焦点、完成步骤、关闭或重开 task。外部报告 R1～R4 的实现及回归已依用户决定完成，
本次没有生成新的正式 clean review，也没有改写原审查 verdict。

本次仅为修复自查和确定性合成验收，未重演 S01～S13 宿主 Agent／跨模型业务判断或恢复遵从、
真实生产项目、硬件、TraceLens UI；原覆盖映射及证据缺口继续保留。未运行完整 workflow／
任务服务套件、Linux、最低 Node20、权限 ACL／EACCES 注入、npm／tgz 安装或发布部署。
既有外部编辑器非严格 CAS、跨文件非事务等限制不变。测试全绿不升级为完整加固验收。

[prepare](prepare.cjs)、[replay-and-delivery](replay-and-delivery.mjs)在源码 `.tmp/review-r3-r4` 使用；
保留修前 helper／reader及[原 catalog](pre-fix-catalog.ts)／[paths](pre-fix-paths.ts)，传入原证据包路径，
必须采用新的隔离目标名，不能覆盖旧同版本安装或观察。[collect-and-record](collect-and-record.cjs)
只收集已运行结果并保存真实管理事实；管理失败只补事实关联或摘要，不重放业务动作。
这些脚本没有宿主 Agent 业务答案，不能用来证明语义场景通过。
