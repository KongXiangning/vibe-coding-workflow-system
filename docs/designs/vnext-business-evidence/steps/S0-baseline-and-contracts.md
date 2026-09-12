# S0：核实真实基线并固定最小接口

建议执行模型：用户环境中的GPT-6 Astra xhigh。也可由medium执行；xhigh的用途是判断交叉依赖，不是“预加载缓存”。本次不改Runtime实现，不开始S1。

## 目标

将PLAN.md从有明确行为约束的方案变成适配当前本地源码的执行地图。不要重新讨论是否需要全局注册表、严格TDD或新public Skill。

## 必读

本次完整读PLAN.md一次；读CONTEXT.md和HANDOFF.md。读取实际作用域AGENTS/CLAUDE，Target Architecture相关P原则和当前Task/契约的必要部分。

按PLAN §11导航只读相关函数：kernel中的readTestStrategyDefinition/assertPreparedTestStrategy/executionPhaseForStrategy及claim完成校验；prepare适配器的claimEvidence/semanticDraftDefinition/persistent_tests；execute适配器的updateClaimEvidence/recordStepResult/completeReviewedStep；review适配器的reviewContext/latestRecordedExecution；task-steps的检查点元数据。不要一次打印整个kernel或扫描全部TASKS历史。

## 执行

1. 记录仓库根、HEAD/branch、status，分别识别staged/unstaged/untracked。相对历史基线只比较本计划相关路径。不拉取/重置分支，不保存会改变当前工作区的自动stash。
2. 核查用户此前Step3是否已存在、是否已被后续改动部分修复。记录真实差异，已有正确实现直接复用，禁止为与旧行号一致而退回旧代码。
3. 核对实际Source/Runtime Contract、协议schema、package/distribution版本和相关active/dogfood任务。分清pre-vNext legacy和vNext内部旧格式；不假设全部未发布。
4. 在HANDOFF的“已冻结接口”记录具体字段/函数落点：flexible等价策略；稳定claim/slot/check；报告+assurance；相关对象指纹/失效；累计review目标；retry复用点；最小版本边界。可以新增一个简短实施细节附录到PLAN，避免复制第二份规格。
5. 给出三条最小输入/输出示例（不是写入真实CURRENT_TASK）：普通功能无需Red；规则报告不能填流程槽；前一步免审后本次review应涵盖累计相关diff。
6. 核对本计划与Target Architecture。默认Target不动；只在discussion的相关结论中记录被本轮方向取代/待实施的状态，不把新方案谎称为已生效Runtime协议。没有冲突就不改Blueprint。
7. 为S1-S5列每步实际读写文件、需要先生成的产物和已有测试入口，按现有治理形成合法实施范围。当前工作流需要精确确认时返回该确认对象，不自行伪造确认。

## 验收/交付

HANDOFF不再只有待核实；medium可以直接执行S1而无需重新做架构选择。说明必要版本变化、哪些旧路径继续受支持/阻断、每步是否可单独分发（未闭环不能分发）。

只允许已准入的本包计划/交接和直接相关设计说明变更；不修改Runtime、测试、生成器、宿主配置，也不运行整个测试套件作为“基线仪式”。已有资料不足以确定关键消费者/权限时报告事实和最窄阻塞，不臆测。

完成后停止，推荐下一步S1。不要把读取完成称为缓存已加载或隐藏理解可跨会话共享。

## 本次调用共同边界

先读本包CONTEXT.md、HANDOFF.md和作用域内现有AGENTS/CLAUDE，再按下面的最小源码范围核对。历史提交只是参考，实际以S0记录的工作区为准。若前置步骤未完成，指出精确缺口，不自行跨步补做。

只实施本步骤；不自动开始下一步骤或调用另一个public Skill。遵守仓库既有任务确认和Runtime渠道，不手改CURRENT_TASK来解锁。保持既有未提交、未跟踪和已暂存改动，不reset/clean/stash/全量restore，不自动commit/push。

本文列的是候选文件，不是目录任意写授权；先确定实际精确文件和生成物footprint。新增必要同级小模块须说明为何现有模块不足并沿用已有scope admission，不能为了模块美观扩建平台。

对真正改变的共享行为运行已有focused checks；必要时复用/修改已有回归。新持久测试逐组说明保护的控制义务，不为每个字段造测试。不做shadow evaluator，不只检查文案关键词。

结束时给出实现行为、准确文件、真实命令/结果、未完成/blocked、assurance边界；在已准入范围内更新HANDOFF，只写实际事实。不能把自检叫作独立review。
