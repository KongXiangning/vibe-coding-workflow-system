# vNext 业务证据治理：最终实施计划

计划版本：2026-09-11 / revision 1。性质：交给新 Codex 会话的实施规格，不是“已经完成”的报告。

历史审查基线：`KongXiangning/vibe-coding-workflow-system@166d2ce0f6ce76fe666b94c5181b23a252b9be1e`。本计划依据已读取的该提交源码和用户提供的进度制定，未读取用户本地未提交工作区，未执行项目测试。S0 必须核对实际 HEAD、工作区和已安装/分发版本；不得 reset 到历史基线。

推荐包路径：`docs/designs/vnext-business-evidence/`。若实际位置不同，后续提示词使用实际位置，不要额外复制一份。本文是设计规格；HANDOFF 是本次重构的交接记录，二者都不代替产品 Runtime 的 canonical task state。

## 0. 用户目标、原进度与本次纠偏

用户不要求默认严格 TDD。目标是：避免一次简单功能甚至文案修改自动生成大量无价值测试；必要单元测试必须锚定已确认业务要求、契约、缺陷或相关关键风险；需要跨组件完成的业务目标不能靠局部测试全绿冒充可用；适合的业务流程需要实际验证。不是一律少测，也不是一律新增 E2E。

前序实施已完成测试策略治理与 prepare-task 分类，并在当时契约下得到 clean。随后原 Step 3 实现了首步 mandatory Red、expected-failure、Red 后 review；聚焦审查发现单步任务无法完成、blocked 无同计划重试、滚动日志可能淘汰 Red。用户随后明确不走默认严格 TDD，因此本轮是对前序设计的定向修订，不是继续修补完整 TDD 引擎。

不应继续用“所有 test-first 至少两个步骤且必须改产品代码”修单步死局。纯测试资产任务首次运行即通过是合法的；单纯调查/验证请求可用现有 validate-change/debug-task，不为它制造假实现步骤。

### 0.1 对“现在只改三项”的最终审查

三项可以保留为工程主线，但各项必须闭环：

| 主线 | 正确的本轮边界 | 不够的做法 |
|---|---|---|
| A. 撤销默认强制 TDD | 去掉按 step index 强制 Red；为普通任务提供真实的无固定先后策略；显式顺序要求仍有约束 | 仅删除 Red 分支，却保留“明确功能必须 test-first / 其他只能 implementation-first” |
| B. 打通业务证据 | 正常 prepare/execute/complete/close 接口能按稳定 claim/slot/check 身份处理不同义务，区分结果、来源与适用版本 | 只让数组能放多个 slot，新任务仍统一生成 planned-validation，占位而不使用 |
| C. 风险/逻辑检查点 | 不要求每步 review；所需检查点涵盖此前未审查的相关变更，并保留修复验证 | 只把 required 改为 not-required，评审仍只看最后一步 |

必要配套不另起平台工程：最小结果报告与失效规则随 B 落地；测试必要性/oracle 审查随 C 落地；现有 blocked 死局在真实 dogfood 前补最小受控重试。完整可信执行 Provider、AST/跨框架 discovery、全局 Test ID/catalog 继续后置。

## 1. 权威和能力边界

### 1.1 保持 Target Architecture 的核心

P-03：自适应深度不能绕过必要治理。P-05：发现问题不等于获得修复授权。P-06：模型判断和提议，Runtime 做确定性检查与事务。P-07：canonical Markdown/YAML 保持唯一项目治理真相。P-12：验证 claim、运行/复用检查、准入新持久测试是三个独立决定。P-13：范围约束覆盖所有已知写入，read context 不等于写权限。P-14：风险/逻辑边界评审，不是每步仪式性评审。

默认不改 Target Architecture，不因本轮增加内部参数就新增 public Skill。仅修改确实与本计划冲突的 discussion、contract/schema、模板与实现。Blueprint 只有存在相关冲突才改。若本地新权威版本确实阻止本计划某项行为，S0 精确列出冲突及最窄修订，不自行把整份架构 supersede。

### 1.2 Skill、Runtime、宿主分别负责什么

Skill 引导模型理解原请求、选择场景、评判必要性、检查断言和复用关系。它不是文件系统沙箱，也不会因为出现“独立评审”字样就自动创造独立身份。

Runtime 强制已确认的定义、身份关联、范围、结果结构、版本适用性、推进与关闭条件。它不能从一个 claim ID 或 source_kind 标签推断断言有业务价值，也不能仅凭自报判断测试真的执行。

本期仍可接收调用方执行报告，但始终以 `caller-reported` 等价语义记录。Runtime 能拒绝缺项、显式类型不匹配、版本不匹配、已报告失败/未运行，不能识别所有虚假报告。业务完成输出必须携带实际 assurance，不可写“Runtime 已独立证明所有测试执行”。项目要求更高 assurance 而尚无支持时，阻断相应义务，不偷偷降级。

完整 Provider 后置不等于已知可信度缺口不存在。它是后续提升执行事实可信度的明确事项，而不是等发现模型作弊才承认问题。hash 只能绑定内容；由 Agent 可写的数据、nonce、字段或同权限文件不自动成为信任根。

### 1.3 本轮不扩大范围

不新建 public review-testcase/review-tests、不建全局 test registry、独立 Red/Green 生命周期、通用执行平台、所有语言 reporter、AST 扫描平台、动态覆盖图或跨宿主沙箱。不把已有业务项目改造、依赖全量升级或 kernel 大拆分作为附带目标。

允许小型共享校验模块，前提是被真实 Runtime 入口使用，而不是新建只在测试中使用的 shadow evaluator。不会为了“未来可能有用”大量增加可选字段。

## 2. 冻结决定 D1：最小改动解除强制测试顺序

### 2.1 保留字段名，为默认流程增加明确空间

保留 `test_strategy`、现有 source/source_ref/task_classification/rationale。建议在原 mode 中增补 `flexible`，避免为改名重写整套 schema：

- `flexible`：普通可执行任务的默认；测试与实现可按业务切片安排。必须预先明确验收/验证责任，但不强制全部测试代码先写或先 Red。
- `test-first`：仅来自明确用户/项目顺序要求，或有具体依据的已确认计划；对应测试准备先于其负责的实现，不要求所有测试集中在首步，也不自动要求 Red。
- `implementation-first`：存在明确的实现/探索在先需求时使用，保留理由；不能成为普通任务为了逃避 test-first 而伪报“探索性”的通道。
- `not-applicable`：沿用无可执行行为的合法分类及项目边界验证；不因是 Markdown 就认定无可执行行为，不因“不新建持久测试”就选它。

如果 S0 发现当前版本已有完全等价的无顺序表示，复用它，不重复引入 flexible。否则本计划选择增补这个内部参数值。它不是新增 public entry/mode，不需要保持“永远只有三个值”这一已经失效的讨论结论。

保留 `explicit-user > project-policy > inferred-default` 的选择优先级；它不是越过现有高权限契约、安全边界或伪造用户授权的许可。

### 2.2 取消错误的全局推导

删除新语义下 `stepIndex === 0 -> red`、所有 test-first 必须至少一个新测试资产、首步必须包含所有测试且无产品路径、后续所有步骤只能 Green 等通用约束。implementation-first 不再要求把本任务全部持久测试一律集中到指定的后续阶段；只执行已确认的局部顺序要求。

正常业务任务不再扫描滚动 execution_log 寻找 mandatory Red。保留有价值的 expected-failure 数据类型与历史读取，但不得让任意 expected-failure 等同实现完成。

### 2.3 显式要求不能因为取消默认约束而被抹掉

有明确 test-first 或缺陷复现前置要求时，在确认计划中指明它约束哪些检查/实现边界。优先用既有步骤依赖或 D2 义务引用表达，不建新的全局测试阶段图。

准备测试设计、已有测试选择和测试代码先行是不同要求；不要把用户明确要求“测试代码先写”弱化为写一句验收标准。Runtime 只强制它实际能观察的前置记录；不能声称证明同一次任意工具会话中所有编辑的物理先后。

若某种显式前置尚不能由本期路径表达/履行，明确报告 unsupported/blocked，不偷偷改 flexible。S1 可以暂时保留这项阻断，S2 接通后完成相应验收；未闭环版本不得作为完整能力分发。

预期失败仅能满足计划明确准入的复现/负向证据；不能满足“行为已经修复/功能已经交付”的正向验收。严格 TDD 不是本轮默认引擎，也不在本轮扩建其专用状态机。

## 3. 冻结决定 D2：真正接通多种业务证据

### 3.1 数据模型最小要求

沿用 CURRENT_TASK 的 `claim_evidence`；底层本已有多槽结构，优先移除日常适配器限制，不再并行新建一套 test_obligations 真相。

新建/更新的新协议任务必须有非空证据计划、至少一条 acceptance claim、每条 claim 至少一个 slot。不是 `0..N claim`。稳定 ID 只需在任务内有效，不是全局 Test ID 基础设施。

任务准备接口需要能表达以下关系：

    原始请求/权威来源
        -> acceptance claim（稳定 ID、要求内容或精确来源）
        -> evidence slot（稳定 ID、具体 minimum_type、完成期限）
        -> check（执行/检查目标、入口、预期观察、证据来源）
        -> result reference（状态、版本、产物、assurance）

复用已有字段，避免同一语义保存两份。S0 固定最终类型/字段落点后，S1-S4 不反复更名。

每个 slot 指定已有证据类型，例如 focused-test、integration-smoke、browser-session-check、static-proof 或项目已接受的等价类型。新任务不能把需要区分的义务全降为无差别 planned-validation；该值可保留作已明示的旧格式读取，不能充当新协议全能通过槽。

一次运行可以支持多个已映射槽位，但不能因共享一条 evidence_ref 就自动满足所有 claim。类型之间不建立“E2E 永远比 unit 高，因此随便替代”的总序。

### 3.2 必须落到真实业务计划

同一个验收确实需要规则和流程两类证据时，正常 prepare-task 必须能生成两个不同槽，并在 execute/complete/close 中分别检查。普通纯规则变更可只有一个 focused-test 槽；文档修改可只有静态检查；不强迫每项验收新增两套测试。

跨边界验收应描述入口和结果，以及哪些边界必须真实参与、哪些替身可接受。例如“网页创建后重新读取仍存在”不能由三个 mock 单元测试报告替代。只验证后端 API 的需求不自动扩大成前端浏览器验收；金额规则也不自动扩大成完整下单流程。

slot 的最低证据类型和边界选择仍由模型/评审判断，Runtime 检查已确认计划与报告的对应关系，不能声称理解任何自然语言业务边界。

### 3.3 更新不再按验收文字或数组位置匹配

execute-step 提交稳定的 claim_id + slot_id + check_id 等价引用。拒绝未知身份、少报必要结果、把一个槽结果写入另一个槽、确认后重定义义务、自由增加/删除 claim。

ID 由既有 Runtime 分配或按已接受机制形成，在草稿重排和后续调用中保持身份与要求的绑定；不能每次根据数组序号重新赋值而把旧证据错绑给新要求。

slot 在到期步骤之前可以保持 pending/missing，不阻断尚未到期的其他业务切片；本步骤到期义务不满足则不得完成本步骤。task-complete/close 必须检查全任务必要义务。

### 3.4 现在就落地最小结果报告，而非只预留 producer 枚举

对执行型证据至少保留这些事实的结构化报告：check/slot 身份、实际报告状态、相关计划版本、被测对象指纹、报告/日志等定位、执行方式和必要环境说明、assurance。

首版接收调用方报告；输入不是实际受支持 Provider 返回时，Runtime 一律按 caller-reported 受理。拒绝调用方仅填 runtime-local/ci/trusted 就提升 assurance。不必为尚未存在的浏览器、设备 Provider 枚举大量虚构受信任来源。

报告 `failed/blocked/not-run`（以及报告了 skipped 时）不能满足要求成功执行的槽。单独一个命令 passed 不能自动满足所有 check。没有 per-test reporter 时只声明检查/命令级报告，不伪称逐用例机器覆盖。typed caller report 仍可能误报，评审需核验引用，输出明确低 assurance。

新的 completion helper 不能继续只凭 disposition + 非空任意字符串判定通过；共享逻辑还要核验 report 与冻结义务、结果和适用对象的关系。raw proposal、adapter、complete-reviewed-step、task-complete 和 close-task 必须消费同一原则，不能上层严格底层仍可随意自造“已完成”。

非执行证据走相应已有受理策略，不强迫人工验收或静态证明产生进程退出码。人类验收的来源也不能自动由模型模拟人类签字。

### 3.5 最小证据失效与保留规则现在就有

计划版本和被测对象指纹与 CURRENT_TASK 日常事务 revision 分开；仅追加一次执行记录不应使刚产生的证据失效。

若相关实现、测试、fixture/helper 或执行配置在证据之后变化，受影响证据不能继续无条件满足义务。首版允许保守失效：无法证明某项已确认依赖不受影响时，重新执行预先批准的相关检查；不要求精确动态影响图。

使用 Runtime 可以读取并计算的已准入对象快照；不得假称覆盖任意未申报文件或全过程瞬时写入。执行者变更报告与候选路径审计仍保留现有信任限制。

当前完成决策必需的证据摘要/引用保留在现有 canonical task records 中，不只靠 256 条滚动日志反推。被清理的临时文件不能作为新完成判定的唯一可解析依据；所需产物保留到对应验证/关闭完成，归档按既有策略保存。历史归档不因为外部日志事后消失而被静默改写完成事实；重新复用该证据时必须重新检查适用性。

## 4. 冻结决定 D3：持久测试准入与语义评审

当前 `persistent_tests` 的 path + proves 不足以完整落实 P-12。新增或语义修改测试资产时，本期补足本来已经要求的 owner/authority source、关联 claim、准入依据、现有证据不足原因和断言/行为边界；复用现有 contract 已有术语，避免新造第二套枚举。

不是每个参数化输入都单独审批；按有限业务场景/测试组说明即可。复用不等于修改权限，新增测试数不是验收指标，覆盖率/鲁棒性偏好不能单独准入新测试。

仍使用精确文件准入与现有 mutation-scope evaluator。AST/discovery 可后置，但那意味着同一允许文件内的实际用例是否越界，当前仍需 review 读 diff 判断，不能声称 Runtime 已逐用例硬阻止。

review-draft / review-change 的必要维度现在加强，不等模型再次失败才加：

- 原请求和权威契约是否支持测试所表达的规则，是否擅自把默认值变成永久限制。
- 新增/修改测试是否必要；能否复用、合并或加强已有断言。
- oracle 是否独立锚定要求。生产常量可以构造输入，但预期不能无条件跟随同一错误实现变化。
- 弱断言、无条件 pass、自我验证、mock/fixture 是否绕过所声称的边界。
- 相关错误出现时测试是否有检出能力。按风险可做有界负向验证，但不强制每条测试 Red/变异测试。
- 已准入业务流程是否被局部 pass 替代；证据的版本、来源和局限是否如实描述。

测试变化和复用映射变化可在相应风险/逻辑检查点审查，不强制每个文件、每个测试建立一个独立 review 会话。Runtime 能检查所需维度的记录/绑定，不等于机器证明模型真的判断正确。

## 5. 冻结决定 D4：减少 review 不得产生漏审

### 5.1 显式检查点策略

prepare-task 不再给每步硬编码 required；从已确认的风险/逻辑边界生成 required/not-required 和理由。不能简单改为“所有步骤默认 not-required”。保留项目策略要求、关键契约/风险、所需最终评审，以及 admitted repair 后 verification。

缺失、非法或相互矛盾的检查点声明，不能静默视为不需要。模型提出风险分类，Runtime 检查冻结策略、显式触发条件和所需记录；不声称 Runtime 能自动识别全部风险。

### 5.2 所需评审覆盖累计相关变更

当前 review adapter 主要读取最新步骤执行目标。允许跳过步骤评审后，下一个 required checkpoint 必须覆盖自上次有效检查点以来相关未审查变更，不能只检查最后一步改的那个文件。

优先复用现有 Runtime change_set/file manifest。在实现成本较低时分段累计；若分段过重，第一版允许保守审查任务的累计逻辑 diff。两者必须保持一个明确的 review target，而不是两次串行重复审查。

基线不能只假设干净 Git HEAD。须保留任务开始/首次接触路径时的 before-state 与既有脏改动归属；新文件、删除、重复修改同路径均纳入。不得将用户先前未提交改动误归为本次任务。

只有有效的 clean review/合法免审归属才能结束相应待审范围；findings、blocked、迟到或错版本 receipt 不能清空范围。累计目标/边界状态必须耐受会话中断，不只靠可淘汰日志反查。

### 5.3 修复仍需合法权限

后续集成/评审发现早期步骤的问题，repair 仍按根因与权限路由，不按“发现入口”限制只能改产品或只能改测试。prepare-task 的 path-by-step interaction check 应给后续修复保留精确可用路径或已有 Conditional 条件；不扩大成目录任意写。

混合 diff 同时评估实现和测试维度；验证复用映射时读取既有资产快照。独立验证请求优先使用 validate-change，不为满足 review target 制造无意义文件修改或固定 validation/review stage。

既有 review-result 的 Runtime 持久化路径按当前授权实现使用；不要在本轮顺便重写所有 review 只读/返回约定。若 Target 文字与当前权威 contract 存在既有差异，记录差异，不把所有历史问题扩大进本任务。

## 6. 冻结决定 D5：最小受控重试必须在 dogfood 前闭环

临时环境故障已被源码审查识别为恢复死局，所以不是“未来可能需要的系统”。本期实现一个内部同计划重试能力，优先复用已有 recovery/step action；不新增公共 retry Skill 或通用恢复框架。

只允许有证据表明 blocker 已解除、且任务/验收/策略/范围未变化的重试。新 attempt 重新 preflight、重新运行和重新提交结果。保留前次失败、attempt 身份和有限重试次数；幂等重放不重复计数，不因为滚动日志淘汰而无限刷新预算。

retry 不能改变测试期望、跳过检查、修改 scope、清空 findings、沿用已失效 clean review 或直接把 blocked 改 completed。环境状态好转不代表业务已经验证通过。

需要修改代码/fixture 时走已有 admitted execution/repair 权限；需要改变验收或范围才走 supersede/replan。证据不足、预算耗尽或需外部授权时阻断并说明真实后续路线，不伪造 finding 来解锁，不要求为一次临时故障重做整个任务。

## 7. 最小版本与安全措施

S0 核对当前发布/生成/安装版本和 active task。不得从“正在开发”推断这套软件从未分发，指定提交已有 package/distribution 和安装路径。

如果只是未分发的中间实现，可在当前开发版本一次改正并更新 fixture。若已有消费者，使用项目已有版本/能力边界，或增加最小语义版本标识；旧记录不能因同名字段而悄悄被重新解释，也不为短期中间错误建立永久双引擎。

pre-vNext legacy 与 vNext 内部旧版 task 是两回事。不能仅凭代码返回 `legacy` 就认定违反 P-08；按真实格式与现有已支持兼容规则判断。unsupported 新/旧 schema 在执行前明确阻断；历史归档保持可读。升级不伪造 claim、授权、成功执行或 clean review。

保护工作区：先记录 HEAD、status、staged/unstaged/untracked；不 git reset --hard、git clean、全量 checkout/restore、强推、自动 stash，也不回滚用户既有变更。用户未要求时不 commit/push。只回滚本轮已识别的写入；范围无法判断则停止该写入。

先完成包内计划文件与实际治理的合法挂接。计划不是绕过当前 repo 工作流确认、禁止写入和公开入口终止边界的后门。既有工作流不可用时输出精确阻塞，不手改 CURRENT_TASK 解锁。

## 8. 实施顺序与验收里程碑

以下是本次重构的工程切片，不是要加入业务产品的固定 Skill 阶段。逐步人工调用，每步完成即停止，不自动开始下一步。

| 步骤 | 主要交付 | 必须完成的证明 |
|---|---|---|
| S0 基线/接口冻结 | 核实本地差异；最窄 schema/版本/字段落点；读写地图；将原 discussion 对应结论标记为待修订或被替代 | medium 不需要重新判断方向；无未识别工作区覆盖风险 |
| S1 测试顺序纠偏 | flexible 默认；移除新语义 mandatory Red 和全任务 tests-only；保留显式要求与合法 expected-failure | 普通功能不强制 Red；不把旧显式任务悄悄放宽 |
| S2 业务证据闭环 | 多槽实际使用；稳定身份；最小 report/assurance；共享完成校验；最小失效规则；P-12 准入字段 | 规则 pass 不自动满足流程；错槽/失败/陈旧不能完成；非测试证据合法 |
| S3 检查点与测试评审 | required/not-required；累计目标；修复验证；oracle/必要性/流程边界审查 | 跳过早期 review 后不漏审；不为每步建立新仪式 |
| S4 同计划重试 | 有界恢复、尝试记录、幂等和权限不变 | 环境恢复可以重试；不能洗掉失败、扩大权限或直接完成 |
| S5 总验收/分发/dogfood | 全调用链负向验证；真实业务场景；版本和生成一致性；最终交接 | 无局部 pass 冒充流程；明确 caller-reported 可信度边界 |

每步附独立提示词。S1-S4 按共同契约更新相应 Source/Runtime Contract、Protocol/Schema、模板、实现与必要测试，避免文档声称已生效而代码尚未支持。S0 只冻结设计，不提前将全部 contract 标为已经实现。

首轮如果累计评审目标尚未完成，不提前单独发布降低 review gate 的代码。任何部分完成只标记该切片实现进度，不宣称完整新协议已经可用。

## 9. 最小验收矩阵

下表是行为场景，不是强制新增同等数量持久测试。复用已有测试、合并参数化场景，仅为独立控制义务准入必要回归。测试数量、覆盖率与“模板出现关键字”不是完成指标。

| ID | 输入/情形 | 预期 |
|---|---|---|
| V1 | 普通明确功能，无显式 TDD | flexible 合法；无需假装探索、无需 mandatory Red |
| V2 | 已准入测试验证已有正确行为，第一次就通过 | 不要求制造 Red 或额外产品改动 |
| V3 | 用户明确测试代码/缺陷复现在先 | 不能以取消默认 Red 为由跳过明确前置 |
| V4 | 同一 claim 有 rule 与 flow 两槽，只给 rule 成功报告 | flow 仍缺失，不能 task-complete/close |
| V5 | 错 claim/slot/check、少结果、failed/blocked/not-run、显式类型不匹配 | 共享底层拒绝不适用更新/完成；raw proposal 不能绕过 |
| V6 | 一槽合法静态/人工证据或复用证据 | 不强制进程结果或新建测试 |
| V7 | 无新增测试准入，仅修改普通文档 | 保持无持久测试；测试请求不能只靠 coverage 理由 |
| V8 | 相关实现/fixture/配置在成功报告后变化 | 旧证据需重核或失效；仅更新任务审计不使全部结果失效 |
| V9 | step A 不需 review，step B 是 required 且只改另一个文件 | B 的 review target 包含此前未审查的相关 A 变更 |
| V10 | 混合代码/测试 diff；review 后新修改；repair 后验证 | 维度不漏；错版本 clean 无效；修复验证不被免审覆盖 |
| V11 | 临时环境故障 -> 解除 -> 新 attempt；重复相同请求 | 不 replan 整个任务；幂等不重复计数；不直接 completed |
| V12 | 调用方填 runtime-local/trusted，但没有可信 provider | 不提升 assurance；输出保持 reported 或拒绝 |
| V13 | 旧 active/缺字段任务、既有脏改动 | 不静默改语义、伪造证据或覆盖用户内容 |
| V14 | 真实业务提交/保存/再读流程（在需求包含的边界内） | 实际观察结果；环境不具备则明确 blocked，不拿 mock 全绿补齐 |

V4/V5/V8/V9/V11 等应尽量用生产 Runtime API/CLI 与 isolated fixture 驱动，而不是只证明新写的 helper 能返回期待值。review 语义通过实际读 diff 与 dogfood 记录评估，不能只检索 Skill 中关键词。

### 9.1 验证命令

先核对本地 package.json 中实际存在的脚本和已准入写入。以下在历史提交中存在，未在本次 ChatGPT 审查运行：

    bun run build:vnext-runtime
    bun run test:workflow-vnext-runtime
    bun run validate:vnext-source
    bun run validate:vnext-runtime
    bun run validate:protocol
    bun run validate:freshness
    bun run gen:all
    bun run test:workflow-all
    bun run workflow:health --root .
    git diff --check

每个开发步骤先执行相关 focused checks；最终 S5 才做完整聚合验证。生成物通过已有生成器更新，不手改生成文件迎合 freshness。依赖有问题只修本轮必须修的已授权问题，不顺便升级全库或业务项目依赖。

### 9.2 实际 dogfood

先定位仓库已有 FixFlow 说明/fixture/脚本，使用授权隔离实例及测试数据；不要假定用户本机已有某个服务，也不要默默重置真实业务数据库。流程包含用户需求实际涉及的入口到结果边界，不自动加 UI、设备或未来功能。

记录一次真实成功路径和一次“局部规则通过但流程缺失/失败”的拒绝路径。两者可用相同有限场景重复验证，不必持久化一堆新脚本。代码与合同测试通过而真实环境不可用时，结论为“该实现切片已验证，真实流程 dogfood blocked”，不是全方案 clean。

## 10. 新会话执行与交接

xhigh 的作用是核实本地事实、冻结最小接口、找交叉依赖；不是替 medium 储存隐藏记忆。先读完整 PLAN 一次，按 S0 落下接口和源码导航；medium 每步读 CONTEXT、HANDOFF 和当前 step，只按需回读指定 PLAN 章节与函数。

不要把完整聊天、整份 kernel 或所有历史设计每步重新塞入上下文。也不要为了省 token 漏读当前作用域 AGENTS/CLAUDE 指令与必要权威定义。源码导航优先“路径 + 符号”，行号只作历史参考。

每步输出：已实现行为、修改文件、实际验证命令和结果、未完成/blocked、残余可信度与范围边界、下一步。只更新 HANDOFF 中本次切片事实；Runtime 的 task 状态仍走 Runtime。

暂停与压缩前更新 HANDOFF。独立评审由用户使用 REVIEW.md 另起调用，不由实施 Skill 私自串联。审查未通过不开始下一步，修复限于对应 finding 和已准入范围。

## 11. 源码证据与精确导航（S0 只读核实）

以下均为历史提交 `166d2ce0f6ce76fe666b94c5181b23a252b9be1e`，若本地已变化，用符号搜索更新 HANDOFF，不按旧行号盲改。

| 证据 | 路径/符号 | 历史发现 |
|---|---|---|
| R1 | docs/designs/workflow-vnext-target-architecture.md / P-03,05,06,07,12,13,14 | 最小充分证据、单一真相、逻辑检查点与权限边界 |
| R2 | runtime/vnext/src/kernel.ts / readTestStrategyDefinition（约3001-3061） | contract-clear 默认强制 test-first |
| R3 | 同文件 / assertPreparedTestStrategy, executionPhaseForStrategy, assertTestStrategySequenceReady（约3238-3330） | 全测试首步、按序号 Red、滚动日志反推 |
| R4 | runtime/vnext/src/prepare-task-adapter.ts / claimEvidence, semanticDraftDefinition（约557-620） | 每 acceptance 一个 planned-validation；每步 required review |
| R5 | runtime/vnext/src/execute-step-adapter.ts / normalizeAcceptanceEvidence, updateClaimEvidence（约820-888） | 按文字匹配、要求单槽、报告引用更新完成 disposition |
| R6 | 同文件 / recordStepResult, completeReviewedStep（约1150-1370） | not-required 可直接请求完成；结果/claim 校验与消费路径 |
| R7 | runtime/vnext/src/review-change-adapter.ts / latestRecordedExecution, reviewContext | review 主要绑定最新步骤和对应目标 |
| R8 | runtime/vnext/src/prepare-task-adapter.ts / persistent_tests normalization（约395-424） | 主要是 path + proves |
| R9 | runtime/vnext/src/mutation-scope.ts / evaluateMutationScope, isLikelyPersistentTestPath | 路径级准入；不是完整文件系统监控或 AST 语义证明 |
| R10 | scripts/vnext-validate-change.ts / evaluateValidationEvidence | 调用方证据选择器，不是 runner |
| R11 | docs/designs/trusted-authority-channel.md | 自报 authority/来源字段不是信任根；不要混同授权认证与结果可信度 |
| R12 | package.json；runtime distribution/installer 相关受影响引用 | 已有生成/测试/分发能力，不能假设从未有消费者 |

模板入口：templates/vnext/skills/{prepare-task,execute-step,review-draft,review-change,validate-change,close-task}.SKILL.md.tmpl。
契约/生成入口：.workflow-system/vnext/{SOURCE_CONTRACT,RUNTIME_CONTRACT}.yaml；templates/vnext/bootstrap/{WORKFLOW_PROTOCOL,FILE_SCHEMAS}.md；scripts/vnext-source-contract.ts；已存在的 generator/distribution 代码按被引用位置读取。
必要回归优先定位：test/vnext-runtime.test.ts、test/vnext-daily-semantics.test.ts、test/vnext-mutation-scope.test.ts、test/workflow-vnext-source.test.ts、相关 close/lifecycle/distribution tests。仅当它们保护受影响行为时修改。

## 12. 完成标准与后续事项

本期完整完成必须同时满足：默认不强制 TDD；正常调用能分别履行规则/流程义务；义务关联和报告适用性有共享 Runtime 校验；检查点减少而不漏审；测试必要性/oracle 评审落实；环境 blocker 可受控恢复；所选兼容与分发边界验证；真实 dogfood 结果如实记录。

本期可声明“业务证据治理闭环（caller-reported assurance）”。不能声明“对任何宿主硬性保证所有测试真实执行”“所有测试都有业务价值”“所有越权写入物理不可发生”。

后续可信执行适配器是已识别的可信度增强，不依赖全局注册表；当项目需要更强执行证明时单独立项。AST/test discovery、候选索引依真实使用问题决定，仍不自动演变为 Test Skill/独立测试状态机。

不要为了守住旧的“三项”字面数量而漏掉配套，也不要为了配套回到建设完整测试平台。交付三个闭环主线，按 S0-S5 实施即可。
