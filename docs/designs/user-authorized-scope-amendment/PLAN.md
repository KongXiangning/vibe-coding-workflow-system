# 用户授权范围修订：实施方案

- 状态：已实施（2026-09-16）；保留本方案作为设计与验收依据。
- 日期：2026-09-16
- 基线：源码仓库 `64649a75`，版本 `0.19.5`；实施前重新核对工作区。
- 定位：产品行为与 Runtime 工程修订；不作为目标项目的执行授权或任务状态。
- 执行对象：Luna Max；配套入口见 [HANDOFF.md](HANDOFF.md)。

## 1. 问题与目标

用户在一次 repair 中已修复六项 finding，定向测试通过，但完整回归被范围外测试文件的两个旧断言阻塞。用户明确授权加入 `native/codex-rollout-collector/tests/stage4_target_protocol.rs`；execute-step 要求先 replan，而 prepare-task 的 replan 只允许原任务总权限内纠正，最后要求用户执行不存在的 authority/scope transition。

这是调用者可以表达授权、产品却无法承接授权的缺口。本次目标：在保持用户手动调用公共 skill 的模式下，让用户明确授权的有限范围扩展能够正式提交、继续修复、重新验证与审查，且每次停止都给出真实可执行的下一步。

验收主线必须覆盖 **blocked + 已有代码改动 + 未收敛 finding + 新增测试路径**，不能只演示 ready、无 finding 的干净任务。

### 已核实的源码事实

| 位置 | 当前行为 | 修订意义 |
|---|---|---|
| `runtime/vnext/src/kernel.ts`：`buildCorrectionCandidate` | 存在 admitted/in-progress finding 即拒绝候选；全部写路径必须在旧任务范围内 | 范围授权不能直接复用受限 correction 的状态门禁 |
| 同文件：`CorrectionCandidateReceipt` / `confirmCorrectionReplan` | `permission_change` 固定为 `none`；确认后切换步骤、清 pending review、建立新的 review cycle | 不能只放开 scope 检查或照抄确认后状态重置 |
| `runtime/vnext/src/prepare-task-adapter.ts`：`suspend-recovery` | 未收敛 finding 阻止挂起 | 新路线不能要求先经过该入口 |
| `runtime/vnext/src/execute-step-adapter.ts`：`beginRepair` | 消费持久 review result，校验 reviewed execution、finding 路径、当前计划 | 必须接通新计划与旧 finding、累计审查基线的承接 |
| `runtime/vnext/src/task-context.ts`：`contextOverview` | blocked 时笼统返回 `debug-task or prepare-task:prepare-replan` | 需要条件化、能力感知的下一步 |
| `templates/vnext/skills/prepare-task.SKILL.md.tmpl` | 扩大总权限不在 replan 路线内；公共 skill 不互调 | 保留手动入口边界，增加可用的范围修订模式 |

以上基于当前源码及用户粘贴的执行记录；未读取或修改该真实 Rust 项目，不把粘贴结果冒充本地重跑证明。

## 2. 本次确定的产品规则

1. 公共 skill 由用户调用。本次不增加 skill 自动串联、外层调度器或后台自动推进。
2. AI 发现缺少范围时，可在当前入口整理具体增量；没有用户授权不得执行新增范围。
3. 用户已经明确授权的具体增量，可以在后续 `prepare-task` 调用中消费原决定，不重复询问同一问题。普通“继续”“repair”“replan”本身不构成范围扩展授权。
4. 授权记录与候选回执是两件事：原决定可早于候选存在；Runtime 提交仍须绑定刚生成的精确候选与版本。模型不能伪造用户当时批准了尚不存在的 digest。
5. 用户授权只覆盖指定增量；新增其他文件、命令写入、验收削弱或契约改变，必须单独展示差异并获得决定。
6. 当前支持级别沿用 `caller-reported`。Runtime 校验结构、范围与版本绑定，不声称能认证真人或判断自然语言含义。语义对应关系由 skill 根据可见用户消息形成并公开说明。
7. `docs/designs/trusted-authority-channel.md` 的冻结设计针对 administrative bootstrap realign。本次不编辑它、不开放 realign，也不将其真人认证前置要求扩展到普通任务范围修订。
8. 不因 blocked 或存在 finding 拒绝准备范围修订；不借范围修订消除 finding、失败、预算或待审代码。

### 范围

支持同一 active 任务、同一目标与原验收义务下，为完成当前工作而增加有限的精确仓库文件路径，并同步步骤范围、Persistent Tests、相关命令 footprint 与验证计划。

首版只做 additive scope amendment：不删旧权限、不弱化验收、不改变既有公共契约、不隐含授权远端或破坏性操作。若目标文件已在任务总范围内但不在当前步骤范围内，也使用明确的步骤范围增量，不能误报为无需修订。

不纳入：任务目标替换、跨任务迁移、supersede 后继任务、自动发布、真实消费者升级、取消任务、增加重试预算、修改 freeze 管理、通用 rollback。确实触及这些需求时，明确报告本版不支持并说明需要解决的具体产品决策，不推荐不存在的命令。

## 3. 用户交互

### 已授权的本例

1. 用户在 execute-step 中明确授权加入该测试文件。execute-step 识别并保留该决定，解释该入口不能修改计划；提供唯一、可直接复制的 `prepare-task amend-scope` 指令，包含精确文件、目的和原授权来源。不调用其他 skill。
2. 用户调用 `prepare-task amend-scope`。它读取最新状态，生成完整候选，核验实际增量没有超出先前授权；使用该已有决定提交精确候选，不再要求用户同意相同内容。
3. 返回“已加入的范围、保留的未完成义务、验证要求”，以及可直接复制的 `execute-step repair` 指令；该指令必须能消费新计划。
4. 用户调用 execute-step，获取新的 repair preflight，修复测试、重跑完整相关回归、记录真实结果；之后按现有入口进行新审查。

### 尚未授权或候选超出授权

prepare-task 先生成具体候选，展示实际增加的文件及行为影响，只询问缺失的决定；确认时复用候选回执。候选漂移后先重新准备，不能把旧回执改成当前版本。若增量仍完全在原授权内，可沿用原决定；若语义或范围超出，则仅询问新增差异。

### 结果必须包含

当前状态、具体阻塞原因（若有）、已完成动作、是否需要用户决定，以及一个可执行的下一步。内部 digest/receipt 由 Runtime/skill 承接，不能要求人手工拼 JSON。必要时给出安装能力不足及升级需求；不能给出一个已知会失败的 skill 路由。

## 4. Runtime 设计

### 4.1 独立的版本化范围修订路线

在现有 prepare-task adapter 下新增内部命令：

- `prepare-scope-amendment`
- `confirm-scope-amendment`
- `discard-scope-amendment`

公共 skill 使用已实现的 `amend-scope` 模式；上述命令是 Runtime 内部动作，仍由用户手动调用公共 skill 触发，skill 不互相自动调用。

保留 correction-replan/v2 的 `permission_change:none` 语义。不得使旧 receipt 获得扩大权限的能力，不启用旧 raw `commit-replan` 绕过新路线。适当提取共享纯校验与存储代码，但不要让新路线继承旧 correction 的 finding 禁入条件。

### 4.2 候选与授权记录

新增 `scope-amendment-candidate/v1` 及配套 receipt，至少绑定：

| 数据 | 必须满足 |
|---|---|
| 任务坐标 | task/document identity、source revision、Task Basis revision、旧 definition/evidence plan revision |
| 权限增量 | 精确新增总范围路径、步骤范围变化、Persistent Tests 与命令 footprint 差异；Runtime 从新旧定义计算，不能只相信 caller 声明 |
| 新计划 | 新增延续步骤、全部未完成义务去向、受影响 check 及复验要求 |
| 运行状态 | 原 blocked attempt、review/finding 身份、累计 review coverage、预算及待审路径的摘要 |
| 工作区状态 | 已有受管改动与新增路径的准备时状态；确认前检测相关漂移，不遍历无关全仓库 |
| 授权关联 | 用户决定来源 locator、原文及显式结构化授权范围；标记为 caller-reported |
| 提交绑定 | Runtime 生成 candidate digest；确认同时绑定 receipt 与授权记录摘要；禁止 caller 重建 receipt |

授权关联须明确 `existing-explicit-decision` 与 `candidate-confirmation`：前者表示先前明确授权，后者表示看到候选后作出的决定。它们共享精确增量校验，不共用“用户批准了候选 digest”的叙述。

路径必须是规范化仓库相对路径，不支持新增通配符；防止 `..`、绝对路径、符号链接逃逸、受管状态目录及 Runtime 安装文件借业务 scope 获权。沿用既有 frozen/project policy 检查，不通过产品 amendment 修改治理文件权限。

准备只存候选及审计材料，不变更有效执行权限、CURRENT_TASK 活动位置或产品文件。与 correction 候选共用单一未确认变更槽，明确报候选冲突，可显式丢弃后再准备。丢弃保留审计标记。

### 4.3 状态转换与历史承接

采用**新的延续步骤 ID**，不重写已经执行/预检步骤的定义，不给旧执行结果套新定义。

确认范围修订时：

1. 保存原 task/Basis/definition 的不可变前像；保留 task/document ID 与原始请求，追加用户决定。
2. 原 S1 的失败 attempt、执行日志、review、finding 与代码保持原样；新增延续步骤，例如 Runtime 分配的 `S1-R1`，在未完成后续步骤之前执行。
3. 记录完整 continuation 关系：旧步骤/attempt、延续步骤、尚未完成义务、finding、review target、预算来源。旧步骤标记为存在延续关系，不能伪装为 completed；未完成义务只转交一次。
4. 为仍有 finding 的任务建立可供 `begin-repair` 消费的当前 repair context，引用原 review 及 continuation。原 review result 不改写为新步骤审查结果，也不直接清除所有 pending review 来解锁。
5. 累计 review coverage 的 first-touch base、未审路径、review/finding 身份保持；新增路径在 fresh preflight 登记 before-state。不能以确认时工作区或 Git HEAD 覆盖旧基线。
6. 保留同一问题的 repair/retry 已用预算；新步骤 ID 不获得一套全新预算。若预算已耗尽，报告真实原因，本次不以 scope amendment 解锁预算。
7. 旧 receipt 失效，后续必须新 preflight；确认本身不完成修复、不产生测试通过或 clean review。
8. 受影响的证据槽要求新报告；不受影响的历史证据仅在现有 carry-forward 条件满足时承接。保留 claim/slot 义务，改变检查定义时使用新 check ID 和 replacement 关联，不弱化 subject/boundary。
9. 延续步骤经过执行与新审查后，按 continuation 关系推进原后续步骤；close/reconciliation 能区分历史失败步骤与当前未完成义务，不能永久被旧 blocked 状态卡住。

不要直接照搬 `confirmCorrectionReplan` 的 pending-review 清空和 review-cycle 重置逻辑。实现时重点检查 `beginRepair`、`currentDefinitionExecutionLog`、完成判定及累计 review target 的关联。

### 4.4 状态准入

| 当前状态 | 范围修订行为 |
|---|---|
| active + ready，无 finding | 可准备及确认；仍需明确范围授权 |
| active + blocked，已有真实失败结果 | 可准备及确认，保留失败与预算 |
| blocked + admitted/in-progress finding + 已有改动 | 必须支持；不能要求先收敛 finding 或先调用 suspend-recovery |
| 待审 execution、尚未形成 finding | 可修订，但完整保留待审覆盖，不能把未审变更标为 clean |
| 只有 preflight，尚未记录真实执行结果 | 可整理候选；确认前需如实记录该尝试结果/挂起状态，不虚构零写入或成功；提供可用的登记入口 |
| active task 缺 task preservation | 经现有明确的 preservation 初始化保存原材料；不可手改标记 |
| resume-review、未知语义版本、存储 journal 异常 | 指向确实可用的对应处理入口；没有入口则明确 unsupported，不伪造进展 |
| superseded、closed 或 archived | 本版不受理，不原地重开 |

确认必须原子更新 task/Basis/store/事件等受管状态，沿用现有 journal 与恢复机制。相同确认可幂等回读；不同来源、路径增量或候选不能复用。中断后不得出现“有效权限已扩大但历史/授权记录丢失”的可执行状态。

### 4.5 下一步路由

建立共享的只读路由判定，供 task-context 与相关 adapter 结果消费，避免多处硬编码字符串分叉。路由不能从 Runtime 自行推断自然语言授权，未传入授权关联时只表明可进入范围修订准备。

区分同计划 retry、已有 finding repair、缺范围需 amendment、待审 review、已有候选待决定、安装版本不支持等情形。测试必须真的调用所推荐的下一入口，而不是只断言出现了名称。模板使用这些事实生成一个人可读指令，不自动执行公共 skill。

## 5. 实施切片与文件落点

下表是工程导航，不是目标项目式精确文件授权名单。Luna 可调整直接相关的实现、契约、测试及生成链来闭环本功能；不要因必要辅助文件未列出而重复制造本次死锁。无关功能、冻结文件及真实消费者仍不在范围内。

| 切片 | 主要工作 | 主要落点 | 完成证据 |
|---|---|---|---|
| S0 复现与契约 | 隔离夹具重现真实死锁；固定上述新语义、状态与输入/输出 | 新增 `test/vnext-scope-amendment.test.ts`；`.workflow-system/vnext/{RUNTIME_CONTRACT,SOURCE_CONTRACT}.yaml`；`templates/vnext/bootstrap/{WORKFLOW_PROTOCOL,FILE_SCHEMAS}.md` | 修订前主线被旧规则阻塞；协议描述无真假授权混淆 |
| S1 候选与提交 | 新类型、命令、版本绑定、授权关联、幂等与保存 | 建议新增 `runtime/vnext/src/scope-amendment.ts`；`kernel.ts`、`prepare-task-adapter.ts`、`cli.ts`、`task-evolution-io.ts`、`task-store.ts` | 候选不授予执行权；确认正确写入且历史可回读；漂移/越权被拒绝 |
| S2 延续修复 | continuation、finding/review/预算承接、旧 receipt 失效、完成推进 | `execute-step-adapter.ts`、`review-change-adapter.ts`、`kernel.ts`、`task-recovery.ts` 与关闭核对相关模块 | 主线走到 fresh repair、重验、新审查及推进；六项旧修复仍在累计审查内 |
| S3 交互与上下文 | amend-scope 模式、既有授权复用、精确下一步与不支持说明 | `task-context.ts`；prepare-task / execute-step / debug-task skill 模板；`runtime/vnext/support/CONTEXT_API.md`；`docs/guides/vnext-task-recovery.md` | 用户无需理解 receipt 或内部 transition；跨 skill 仍由用户发起 |
| S4 分发与验证 | 契约校验器、生成资产、隔离安装 Node CLI 全链路、兼容回归 | `scripts/vnext-source-contract.ts` 等相关校验器；生成/打包脚本；新 e2e 测试及 package scripts | 源码与安装包行为一致；全套必需检查通过 |

切片是实施顺序，不要求每片结束再让用户重新授权。S1/S2 未完成闭环前不能宣称功能可用或单独分发。不要扩展为 kernel 全量重构。

版本号与 package/lock/contract 的统一调整遵循现有分发方式；本方案不预定发布版本、不授权 publish。生成内容通过脚本更新，禁止手改 `docs/workflow/generated/**`、registry 或打包产物。

## 6. 必须通过的验收矩阵

| ID | 场景 | 预期 |
|---|---|---|
| A01 | 主例：blocked repair、六项 finding、新增测试文件、明确用户授权 | 候选与确认成功；保留改动/失败/finding；fresh repair 可运行并走到新审查 |
| A02 | 只说“继续 repair”，没有范围决定 | 不扩大权限；准备具体增量并提示唯一缺失决定 |
| A03 | 原授权指定文件，后续候选完全匹配 | 接受已有决定，不再要求批准同一增量；不伪称原消息批准了 digest |
| A04 | 候选多出文件、放宽通配符或增加命令写目标 | 不能消费旧授权提交；返回具体差异 |
| A05 | 准备候选后源状态、Basis、相关文件或候选内容漂移 | 拒绝旧 receipt，原有效权限不变；重新准备而非手工刷新 receipt |
| A06 | 重复确认、重复命令、中断与恢复 | 幂等；无重复 continuation/决定；无部分可执行权限提交 |
| A07 | 旧 correction-replan/v2 与伪造旧 receipt | 原同范围纠错保持可用；不能获得扩权 |
| A08 | finding 未收敛、pending review 与累计 dirty diff | 无清队列、伪 clean 或基线刷新；新增路径之外原未审差异仍被审查 |
| A09 | 同一问题已消耗 retry/repair 预算 | continuation 沿用已用量；反复 amendment 无法刷新预算 |
| A10 | 路径穿越、绝对路径、符号链接、受管目录及冻结目标 | 被拒绝，不产生业务写权限 |
| A11 | 旧证据、旧 preflight 与旧 clean review | 不能直接证明新修复完成；受影响检查必须重跑 |
| A12 | 任务总范围已有文件、当前步骤未包含 | 正确修订步骤范围与 footprint，既不绕过也不误报总权限扩展 |
| A13 | 源码与固定 tgz 隔离安装后的 Node CLI | 同样完成 A01；不能只测内部函数 |
| A14 | task-context 推荐下一步 | 实际调用该入口能受理；不再返回无条件 debug/replan 二选一 |
| A15 | 旧 active 任务、缺 preservation、其他候选在途 | 有明确兼容处理与冲突提示；不静默迁移或丢候选 |
| A16 | 修复完成后执行原后续步骤并结项 | 未完成义务不丢失/不重复；旧失败保留且不永久阻止合法完成 |
| A17 | 未记录结果的 preflight、无 finding 的 pending review | 如实登记/承接后可继续；不为解锁伪造 findings 或成功结果 |
| A18 | skill 文案与交互样例 | 无授权与有授权两条样例均审阅；无公共 skill 互调、无重复索要同一授权 |

A01 使用最小 TypeScript/文本夹具模拟“新契约已确认，旧测试需同步”的因果关系即可，不依赖真实 Rust 项目或 Cargo。保留本例的完整路径语义与两项断言说明作为交互样例。测试不能把“改成总通过”当作修复；要证明必要行为检查仍会抓到错误。

### 验证命令

先运行新增定向测试及受影响的 recovery/context/review/close 测试，再运行仓库要求：

```powershell
bun run gen:all
bun run validate:protocol
bun run validate:freshness
bun run test:workflow-all
bun run workflow:health --root .
git diff --check
```

新增测试必须接入 `test:workflow-all` 或其子脚本；安装包 e2e 使用构建后的固定 tgz 和隔离临时项目。只有依赖缺失时才安装依赖。检查失败须区分新回归与既有问题，保留真实输出，不降低断言以通过。

## 7. 交付与边界

- 提交实现说明：改变了什么、如何保留旧义务、授权的 caller-reported 局限、哪些场景仍不支持。
- 列出定向测试、聚合检查、固定 tgz 安装验证的真实结果。
- 给出用户视角的完整示例：原授权 → prepare-task amend-scope → execute-step repair → 新 review；receipt/digest 由 Runtime 与 skill 承接。
- 不修改真实 Rust 项目、FixFlow 或其他消费者；不创建新 Codex 任务、不自动切换模型、不发布、不提交代码，除非后续另有明确指令。
- 本轮已完成方案所列 Runtime、契约、模板、生成同步与验证；不代表真实目标项目已执行修复或解除其业务阻塞。

## 8. 追踪与修订记录

- 上游：2026-09-16 用户粘贴的 repair → 授权扩范围 → replan 拒绝记录，以及“调用 skill 是用户操作”的澄清。
- 当前行为文档：[任务恢复指南](../../guides/vnext-task-recovery.md)。
- 下游：[Luna Max 交接提示](HANDOFF.md)、新增 Runtime/安装链路测试及用户指南。
- 2026-09-16：创建方案；选择独立 additive amendment、已有授权复用、延续步骤及 finding/预算保留，维持用户手动调用公共 skill。
- 2026-09-16：完成 S0–S4；保留旧 correction-replan/v2 的 `permission_change:none`，新增 `scope-amendment-candidate/v1`，并通过 A01–A18、固定 tgz CLI 与仓库全套校验。
