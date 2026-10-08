# 项目规划实施：独立源码审查

审查时间：2026-10-08 03:34 UTC

## 结论

截至本次手写源码稳定后的复查，未发现仍开放的功能缺陷。曾发现一项低优先级契约与离线输出不一致，已修正文案并复查。源码结论不代替最终分发／安装和宿主语义验收。

## 基线与范围

- 实际 HEAD：`84589392b27394cd6fcce16d6029f37faed2b962`，分支 `codex/maintain-project-v1`；审查其工作区差异，没有改动或提交仓库文件
- 已完整读取授权计划 `vnext-project-planning-next-step-sol.md`（Library `libfile_11e75b12f7c48191bff1e06e53754cbb`，91 行）、AGENTS、适用 vNext 规则及维护 requirements／contract
- 检查规划、充分性、对账 references、主 Skill 路由、guide、消费样例生成器及新增源码／安装行为断言，并核对现有 read、offline reader、catalog、plan 反向绑定及 prepare 路径

## 发现与处置

### 已修：P3，离线 coverage.selection 的文档承诺不符合实际输出

位置：`docs/product/project-maintenance/document-contract.md:168`

初稿无条件要求 coverage 同时保留 `paths`、`selection`、`omitted`。但 `runtime/vnext/src/product-maintenance/offline-reader.ts:10` 返回的 `catalog.coverage` 不含 `selection`；实际 Node 离线读取两份新样例均验证了这一差异。CLI read 才额外提供 `selection`。

实施者已改为：共同保留 paths、omitted 和诊断；read 另保留 selection；离线样例默认读取入口登记范围。复查确认与现有两个接口一致。无需因此扩展 Schema 或 Runtime，不属于已复现的业务语义故障。

## 关键判断

- 资料充分性及前置候选集中定义在 inventory，plan／reconcile 复用；四类问题、已有信息复用、前提种类／必要时点／最小能力、历史否定与当前反转均有明确处理
- 无 plan 的选择可保存于 project 正文，并在真实授权范围内直接 prepare；不要求完整全局计划，也不把建议等同于执行或关闭授权。绑定失败保留真实 task 身份并仅补绑定
- 三种策略不产生新模式或状态字段；切换保留计划、任务身份和历史。完整需求与剩余工作分开，拆合／收紧／恢复文字不自动继承旧 PASS
- 项目工作安排允许多项前提；执行中派生任务继续沿用既有限制，没有把单层／单未收束派生限制扩成项目规划限制
- 消费规则与现有 helper 足以保留完整正文、原工作项顺序、独立多计划、跨阶段覆盖、无直接关联的共享约束及部分读取边界；未扩张为语义 backlog 计算或 TraceLens 页面交付

## 本审查实际执行

- `git diff --check`：通过
- `bun test test/product-maintenance.test.ts -t 'planning samples preserve'`：1 pass、0 fail、61 断言，37 项被过滤
- 对 no-plan／multiple-plans 各执行完整 Node read、仅 REQUIREMENTS 路径读取、max_files=1 读取和独立 offline reader，共 8 次只读调用：正常输出保留要求／计划；限额调用退出码 1、complete=false 且明确 omitted；无计划正文、局部历史 PASS 和 pending_sources 可见
- 已审查安装测试增量，包含实际安装 helper 与无 Runtime 消费结果比较、原文不变和登记缺失文件降级。未把审查测试代码等同于该安装测试已执行

## 待验收边界

本报告形成时，最终生成产物同步／分发安装回归和两条隔离宿主语义验收仍在进行。手写 contract 的最后措辞修改需要经过正常构建同步，不能手改生成副本。实际宿主读取自然语言资料、决定、写入及回读证据尚待独立核查；预填样例和上述 61 条确定性断言不能证明这些业务路径已通过。真实用户项目、TraceLens 页面、发布／推送／部署不在本审查范围。

## 最终复查附录（2026-10-08 03:56 UTC）

### 结论与证据范围

本轮新增实现没有仍开放的功能缺陷。上述 P3 已关闭；最终 contract 生成副本与源码一致。已完成两组隔离宿主材料的独立复查，足以支持本计划六条业务路径在本次实际运行中获得观察证据。此结论限于本次宿主、合成业务资料和已运行路径，不保证所有模型／真实业务项目均正确，也不表示 TraceLens 页面已实施。

独立阅读了原始自然语言输入、宿主逐阶段决定、真实 helper／task 调用结果、回读正文及命令报告，不仅依据 RESULT 或不变式标签作判断。另做 13 项只读比较，全部通过，包括真实返回 task 的绑定、切换前后 task 事件文件逐文件摘要、旧 PASS 元数据与正文内容、完整需求拆合、恢复定义摘要、未变离线／导出要求，以及实际代码／测试／报告摘要。正文内容比较忽略条目追加所需的末尾分隔空白，不声称整文件或正文范围每个字节恒定。

### 六条业务路径

1. **三种策略与切换**：selection `01` 实际无项目 plan prepare，仅得到 draft task，并绑定真实返回身份；`03` 为全部已知范围形成八个稳定工作项、保留可选方向；`04` 混合切换保留工作项身份／依赖、唯一 task 及事件字节。原 project 当前结论迁到 plan，project 留历史定位。
2. **部分交付后需求变化**：selection `02a` 实际运行一个 provider-ID 查询成功样例；`02b` 按明确指令关闭任务，未伪造 finish／独立审查。新退款记录和重查提示要求得到保存，旧成功范围、未实现／未验证范围均保留；没有创建或启动下个 task。
3. **已有信息、真实缺口与可选前提**：selection `01`／`05` 读取已有设计和拒绝决定，区分已有整数分／日志约束、30／45 天冲突、执行幂等未决、生产资料不可读及可选队列／审计方向。钱包拒绝没有重试复活。只讨论未来条件后，383 项树清单及 task revision 均未变化。生产来源读取的唯一 exit 1 是预设未取得资料，不伪造成业务失败或新文件。
4. **多计划、跨阶段与部分读取**：selection `06` 的实际安装 helper、独立离线输出和宿主消费解释一致。明确选择 PLAN-IMPORT，三个计划分开，原顺序／stage／coverage 保留；共享审计无直接关联不被判遗漏。仅 REQUIREMENTS 的完整读取不冒充全项目完整或没有计划。独立离线 CLI 只测完整入口读取，路径裁剪使用 helper，未混称。
5. **厚基线目标转向**：evolution `03` 检查点先有实际整数解析器、三例 Node PASS、真实 task／绑定、设计和待做导出。`10` 仅调整同一指标，`20` 替换目标并保留旧目标、已有正常导入、离线／不上传约束、待做导出及未同步细节。没有用解析器测试证明新业务目标。
6. **旧 PASS／绑定后的需求演进**：evolution `30` 仅拆工作且需求定义不变；`40` 真正拆为两个可验收要求；`50` 合并为新身份并保留退休去向；`60` 收紧小数精度但不写代码；`70` 恢复整数定义且与阶段 5 摘要相同，当前仍选择 not-run-reported／unknown。原 task、绑定、旧 PASS 和代码／测试／报告均保留，未自动认证新范围。

关键原始索引：`evidence-selection/RESULT.md`、`06-human-consumer-interpretation.md`、各阶段 `*.request.json`／`*.stdout.json`；`evidence-evolution/03-baseline-checkpoint.json`、`10` 至 `70` 阶段输入／决定／回读、`80-final-read.output.json`、`80-final-task-summary.output.json`。共核对 61 次 selection 调用及 72 次 evolution 调用的回执；只有上述预设缺失来源返回非零。

### 最终确定性与安装证据

已读取 `checks` 中实际日志及退出码：产品源码＋安装 39 pass／1243 断言；vNext 源契约 19 pass／115；五项定向分发 5 pass／151；protocol、freshness、vNext-source 验证退出码均为 0。最终构建的 bundle 为 `bundle-629757db81d1bf4288b6180f`，最终安装 manifest 摘要为 `5d9bafc597790d81b6e639418a72e0f6d334b45da6ae2824cc9b145941ef83d7`。这不是全量 workflow-all 或所有分发测试通过声明。

附加 packed npm 原测试实际失败：源、目标继承同一 `/tmp` Git 根，被现有 TARGET_ROOT_DENIED 正常拒绝；更早一次命令工作目录错误而没有匹配测试。两者日志保留。另在两个各自 git init 的授权隔离目录检查到不同 Git 根、guard allowed=true，tgz 安装返回 installed／read_back_verified=true，实际 Node helper 正常返回未启用。该 smoke 满足既有隔离条件，未修改 guard 或 `/tmp/.git`；它不把原测试失败改写为通过。

### 仍存在但非本轮引入的附带安装问题

安装目录 `.workflow-system/runtime/node_modules/.bin/yaml` 为指向已删除暂存目录的绝对符号链接，直接调用该 YAML bin 不可用。只读复核两个上一轮 0.24.1 安装目录及本轮目录，均复现悬空目标；证据为 `checks/yaml-bin-prior-candidate-observations.json`。本轮未修改安装器，该问题不阻塞已运行的 bundled Node helper／离线 reader，但没有被修复，不应声称交付没有任何已知问题。可单独跟进，不扩为本次规划功能缺陷或静默扩大修复范围。

最终阅读 `docs/ops/project-planning-evidence/README.md`：63 项通过、原 packed 1 项环境失败和替代 smoke 明确分列；源码、安装、宿主、消费及未验证范围没有混称，未发现过度通过声明。另独立从最终安装的 runtime/package.json 解析并导入 YAML Node 模块，简单 parse 成功；这与悬空 `.bin/yaml` 的命令入口故障可明确分开。
