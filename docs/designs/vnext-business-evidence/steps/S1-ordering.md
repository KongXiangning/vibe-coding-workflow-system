# S1：解除默认mandatory Red，修正顺序策略

建议：GPT-6 Astra medium。前置：S0接口与工作区基线已固定。

## 阅读范围

CONTEXT、HANDOFF；PLAN §2、§7及V1-V3。源码只先读kernel的TestStrategy相关类型/readTestStrategyDefinition/assertPreparedTestStrategy/executionPhaseForStrategy/assertTestStrategySequenceReady/assertTestStrategyExecutionTransition；prepare/execute适配器中的对应调用；prepare/execute/review-change模板中与Red有关的规则。

候选写入：上述Runtime文件、相关SOURCE/RUNTIME Contract、templates/vnext/bootstrap协议schema、必要source validator、已有策略回归。各文件具体范围以S0为准。

## 任务

1. 按S0决定，保留现有字段名，增补flexible或复用已有等价表示。普通可执行任务默认无固定顺序；保留来源优先级、理由、显式确认和not-applicable真实边界。
2. 解除新语义“明确业务分类必然test-first”、按首步序号推导Red、全部测试必须首步且只准测试路径、所有test-first必须新增测试资产等通用规则。
3. 原mode不能被改成空标签。显式test-first/implementation-first约束只作用于已确认的相关目标；不自动全任务阶段化。未能履行的显式先行要求明确blocked，不暗改flexible。
4. 保留expected-failure及历史读能力，但只在已确认复现/负向义务下使用；不能把任意预期失败计为“功能完成”。若具体slot前置依赖S2，本步记录受控限制，不提前放行该路径。
5. 合法新增测试首次就pass、已有测试复用、普通小功能可以无Red；不要为满足旧分支造产品修改或“至少两步”。独立纯验证请求不制造假的implementation task。
6. 同步对应策略文档/Contract/schema/模板。禁止把所有旧active任务无版本区分重解释；按S0兼容边界处理。

## 验收

通过正常语义adapter和共享底层检查证明V1-V3；普通功能可以形成可执行草稿，不伪报探索分类。旧的mandatory-Red回归按新契约调整并说明原因，显式TDD/失败不能冒充实现的保护不能整体删除。

不要在本步顺便取消所有review、重做claim模型、做provider或AST。完成后更新HANDOFF，列明S2尚须接通的精确依赖，停止。

## 本次调用共同边界

先读本包CONTEXT.md、HANDOFF.md和作用域内现有AGENTS/CLAUDE，再按下面的最小源码范围核对。历史提交只是参考，实际以S0记录的工作区为准。若前置步骤未完成，指出精确缺口，不自行跨步补做。

只实施本步骤；不自动开始下一步骤或调用另一个public Skill。遵守仓库既有任务确认和Runtime渠道，不手改CURRENT_TASK来解锁。保持既有未提交、未跟踪和已暂存改动，不reset/clean/stash/全量restore，不自动commit/push。

本文列的是候选文件，不是目录任意写授权；先确定实际精确文件和生成物footprint。新增必要同级小模块须说明为何现有模块不足并沿用已有scope admission，不能为了模块美观扩建平台。

对真正改变的共享行为运行已有focused checks；必要时复用/修改已有回归。新持久测试逐组说明保护的控制义务，不为每个字段造测试。不做shadow evaluator，不只检查文案关键词。

结束时给出实现行为、准确文件、真实命令/结果、未完成/blocked、assurance边界；在已准入范围内更新HANDOFF，只写实际事实。不能把自检叫作独立review。
