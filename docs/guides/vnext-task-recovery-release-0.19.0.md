# vNext 0.19.0 源码与隔离发行验收记录

后续审查更正：下面的测试通过记录是当时实际结果，不能证明通用恢复能力完整。固定包反向 CLI 审查发现四个 P1：首次执行恢复空值崩溃、回退可被跳过、同报告分批质疑卡死、跨恢复步骤失败预算重置。修复与重新验收见 [0.19.1 记录](vnext-task-recovery-release-0.19.1.md)。另一个 P2 活动批次互斥问题按用户要求不在本次修复范围内。

## 最终交付状态

| 项目 | 实际结果 |
| --- | --- |
| 源码契约、生成物与测试 | 通过；最终 `test:workflow-all` 退出 0，各子进程合计 569 pass / 0 fail |
| 本次 tgz 的隔离安装后验证 | 通过；完整恢复至 archive，以及真实 0.18.7 活动数据 upgrade/显式初始化 |
| 包注册表发布 | 尚未上传；本次交付本地固定 tgz |
| 真实目标项目升级与业务验收 | 本任务未执行，**待部署验收** |

固定包：[vibe-governance-0.19.0.tgz](../../tmp/releases/0.19.0/vibe-governance-0.19.0.tgz)，1,199,948 字节。

SHA-256：`10e25435ff7756ae6e15e5739f7c2a52f5bbd3f6d560dcb926b350f42c6dc979`。

包内 Runtime `dist/cli.js` 与源码构建产物一致：`bc88dddf58cb4da80aa7169c6654e549f522fa14e95e2d9c9f6e5dbc66f53c09`。

源码提交和全部摘要见 [release-metadata.json](../../tmp/releases/0.19.0/release-metadata.json)。最终聚合设置 `VNEXT_RECOVERY_TGZ` 为上面这个固定文件，两个恢复分发测试没有重新选择包或使用浮动版本。测试后再次核对包及 Runtime SHA 未变。

## 实际验证命令

| 命令 | 结果 |
| --- | --- |
| `bun install` | 通过，依赖无变化 |
| `bun run gen:all` | 通过；重新生成参考产物 |
| `bun run build:vnext-runtime` | 通过，生成受跟踪的 `runtime/vnext/dist/cli.js` |
| `bun run validate:vnext-source` | 通过 |
| `bun run validate:vnext-runtime` | 通过 |
| `bun run validate:protocol` | 通过，target-project 验证槽继续未绑定 |
| `bun run validate:freshness` | 通过 |
| `bun run test:workflow-vnext-runtime` | 最终聚合实际调用：168 pass / 0 fail |
| `bun run test:workflow-vnext-system-e2e` | 最终聚合实际调用：10 pass / 0 fail |
| `bun run test:workflow-distribution` | 最终聚合实际调用：19 pass / 0 fail |
| `bun run test:workflow-all` | 569 pass / 0 fail，退出码 0；包括迁移 20 项、bootstrap 11 项 |
| `bun run workflow:health --root .` | 通过 |
| `bun run build:vibe-governance-distribution` | 通过，版本锁步 0.19.0 |
| `npm pack --json --pack-destination ../../tmp/releases/0.19.0` | 在分发包目录成功生成本地 tgz |
| `git diff --check` | 通过 |

日志：[完整聚合](../../tmp/releases/0.19.0/workflow-all.log)、[源码契约](../../tmp/releases/0.19.0/source-validation.log)、[Runtime 契约](../../tmp/releases/0.19.0/runtime-validation.log)、[protocol](../../tmp/releases/0.19.0/protocol-validation.log)、[freshness](../../tmp/releases/0.19.0/freshness-validation.log)、[health](../../tmp/releases/0.19.0/health.log)。实现阶段的迁移、分批和尾部失败日志也保留于同一发行目录；失败没有记为通过，最终修复后重新完整运行。

## 基线与边界

- 起始源码：`070b91ed179b9b7e310d7c48e4fd96be679d69f2`，0.18.7；起始工作树干净。
- 实施分支：`codex/vnext-task-recovery-0.19.0`。
- 冻结依据：当前 `.workflow-system/WORKFLOW_PROTOCOL.md` 的 Freeze status。已最小删除悬空权威文档引用；未创建新冻结权威文档。实际修改文件无冻结 header；仓库无两处 FREEZE_REGISTRY。
- 不改真实目标项目，不调用真实项目 dogfood apply。聚合入口内原有 dogfood 测试只测试纯解析/分类函数。
- 软件版本：根、Runtime、分发包和 Runtime 契约锁步为 **0.19.0**。Runtime state schema 仍为 1；显式保护标记为 2；候选、确认 receipt、证据承接为 v2；artifact checkpoint 为 v1。
- 基线验证：Runtime/context 133 项通过；源码契约、protocol、freshness、health 通过。未发现基线失败。

## 实现摘要

输入分流与受管证据摄取；多目标及分批历史纠错；正常步骤前和任务尾部恢复；真实尝试挂起保全；未执行计划的稳定身份修订；新检查身份与前置消费重绑定；不可变历史完成引用；A→B→C 原始报告锚点承接；步骤级产物 checkpoint、精确恢复 journal；共享治理写锁与来源 CAS；跨计划问题预算；固定版本安装/升级兼容验证。

原任务权限和旧验收义务保持不变，结论纠错不会取得产品代码权限。产品回退只新增任务事实。旧 raw replan/commit-replan 仍拒绝，旧 receipt 不授权 v2 行为。

## 验收矩阵与测试入口

| 场景 | 测试依据 |
| --- | --- |
| G01/G02 输入关系与权限 | 固定包 CLI `route-input` 拒绝权限变化；Runtime scope 反向测试 |
| G03 多目标、分批、未解决阻塞 | 安装后先批量纠错，再分别处理 A/B；第一批完成后普通 preflight 仍拒绝；任务尾部分批不提前 task-complete |
| G04 部分质疑不成立 | Runtime 原有纠错组件扩展：独立评估摘要校验、驳回幂等、保留原报告 |
| G05/G06 前插与尾部追加 | 固定包 CLI 恢复后继续后续步骤，最终真实 archive |
| G07 进行中尝试 | CLI 实际 preflight、部分文件写入、suspend-recovery；验证 ledger 保留及后续累计审查 |
| G08 历史结果与后续计划 | 实际完成历史步骤，再以 execution ID 诊断、将未完成后续义务映射新 ID；旧日志逐项保留 |
| G09/G20 检查更正与时序 | `G09 G20` Runtime 测试真实完成前置步骤；同 check ID 被拒绝，新 check 与新消费者保留旧历史、不复制 receipt |
| G10 多轮承接 | Runtime A→B→C→D 回归及固定包多轮链；原 report/result/计划版本不被改写 |
| G11/G12 正文及反证 | 不可变旧正文取回/损坏拒绝；同 subject 哈希的反证阻塞报告；全文件 slot 仍受适用性检查 |
| G13/G14 精确回退及漂移 | 常规文件修改、删除、新增的精确恢复；用户无关文件保留、当前版本漂移及缺基线拒绝 |
| G15 mixed | 安装后内部恢复路径只恢复选定文件，保留另一结果，再执行前向修复及审查 |
| G16 并发与中断 | 真子进程争用治理锁、退出保留锁；多文件发布中途退出保留 journal 并 fail closed；原有 Task/Basis 中断恢复测试 |
| G17 拒绝边界 | raw replan、旧/篡改 receipt、跨任务 checkpoint、同 check ID；治理、冻结、二进制及 Windows 路径别名拒绝 |
| G18 预算 | 丢弃并更换 candidate/step ID 后第四个同质疑候选拒绝；稳定 claim/slot 和历史步骤累计失败/repair wave，保留 finding 已耗预算 |
| G19 自定义布局 | 自定义 governance home 的文件系统测试，固定包获准 `notes/` 非可执行文档 |
| D01/D03 固定包闭环 | npm 安装本地 tgz，经真实 vibe-governance bin 安装；仅调用目标内 node Runtime 完成 bootstrap 至 archive |
| D02 旧数据升级 | 从指定 Git 基线构建真实 0.18.7 CLI 创建活动任务；新固定包 upgrade 保持字节，显式初始化先保存原像再设置版本 2 |

新增文件系统测试接入 `test:workflow-vnext-runtime`，固定包测试接入 `test:workflow-vnext-system-e2e`，均由 `test:workflow-all` 执行。新增持久测试针对计划列明的不变量、跨进程文件系统行为和安装边界，不要求每个 claim 都添加测试。

## 实施中发现并处理的失败

- 先增加多轮承接失败用例，确认原凭据把接收计划误当原报告计划；修复原始锚点后保留原报告通过。
- 更严格正文校验暴露测试夹具复写共享证据文件；将不受影响证据分开保留，不绕过正文校验。
- 实际安装链暴露每步骤 preflight 未独立登记、checkpoint 规范摘要不一致、挂起审计转换及累计 dirty coverage 问题；分别修正并重跑。
- 聚合迁移测试暴露源码校验错误地要求 Runtime 契约在同目录；恢复独立协议产物兼容，实际源码仍校验两份契约一致。
- 分批 CLI 链暴露旧“所有历史到期证据”gate 阻止部分纠错收尾；仅当前受管批次允许独立完成，其余项仍阻止普通推进和结项。
- 尾部分批测试进一步暴露适配器的旧前置 gate；适配器复用 Kernel 的批次判断，未完成批次不产生 task-complete。
- 一次聚合进程加载旧模块后测试文件更新，造成混合测试快照失败；文件系统聚焦复测通过，最终聚合从同一份固定文件快照重跑。

## 明确不支持与平台范围

不支持跨目标继任、目标/验收/总权限扩大、已归档任务重开、远端/数据库通用补偿、二进制/符号链接/子模块回退、自动语义等价证明或无限重试。遗留恢复 journal/锁保持 fail closed；没有自动移除故障锁后继续的公共入口。

本次实际平台是 Windows，Node v24.12.0、Bun 1.3.10。Linux/macOS 未在本机执行；需运行相同的文件恢复、锁竞争、rename、中断和固定包安装链，不能把 Windows 结果视作跨平台验收。

## 部署与真实业务验收

安装升级、保护初始化、降级限制和目标部署后检查步骤见 [使用指南](vnext-task-recovery.md)。旧活动治理数据不会由软件 upgrade 自动迁移；新协议写入需要显式保全初始化。不能用旧版 Runtime 写已进入 v2 保护的新状态。

**真实目标项目升级与业务验收：本任务不执行，待部署验收。包注册表：尚未上传。**

## 实际修改文件（35 个）

```text
.workflow-system/WORKFLOW_PROTOCOL.md
.workflow-system/vnext/RUNTIME_CONTRACT.yaml
.workflow-system/vnext/SOURCE_CONTRACT.yaml
VERSION
package.json
packages/vibe-governance/package.json
runtime/vnext/package.json
runtime/vnext/package-lock.json
runtime/vnext/dist/cli.js
runtime/vnext/src/kernel.ts
runtime/vnext/src/prepare-task-adapter.ts
runtime/vnext/src/execute-step-adapter.ts
runtime/vnext/src/review-change-adapter.ts
runtime/vnext/src/runtime-io.ts
runtime/vnext/src/task-recovery.ts
runtime/vnext/src/artifact-checkpoints.ts
runtime/vnext/src/evidence-lineage.ts
runtime/vnext/support/CONTEXT_API.md
scripts/vnext-source-contract.ts
scripts/build-vibe-governance-distribution.ts
templates/vnext/skills/prepare-task.SKILL.md.tmpl
templates/vnext/skills/review-change.SKILL.md.tmpl
templates/vnext/skills/execute-step.SKILL.md.tmpl
templates/vnext/skills/debug-task.SKILL.md.tmpl
templates/vnext/skills/task-lifecycle.SKILL.md.tmpl
templates/vnext/skills/close-task.SKILL.md.tmpl
test/vnext-runtime.test.ts
test/vnext-task-recovery.test.ts
test/vnext-task-recovery-e2e.test.ts
docs/guides/vnext-task-recovery.md
docs/guides/vnext-task-recovery-release-0.19.0.md
docs/workflow/generated/workflow-docs/BASELINES.md
docs/workflow/generated/workflow-docs/DOCUMENT_CATALOG.md
docs/workflow/generated/workflow-docs/ROADMAP.md
docs/workflow/generated/workflow-docs/STATUS.md
```

四份生成参考文档仅随版本重新生成；没有手改生成参考文档。分发 payload/manifest 和 tgz 为构建产物；源码 checkout 的受跟踪 Runtime/dist 已同步。根 `bun.lock` 经安装核对无需变更。
