# 新会话必读上下文

目标仓库：KongXiangning/vibe-coding-workflow-system。历史基线 `166d2ce0f6ce76fe666b94c5181b23a252b9be1e`；实际以 S0 核实的本地 HEAD/工作区为准，不 reset、不覆盖既有改动。

用户目标：不走默认严格 TDD；不因简单功能/文案变更生成一堆无价值测试；必要规则单测有明确业务/契约/缺陷依据；跨边界验收需要适合的真实流程证据，局部 pass 不能替代。不是所有任务强制新增单测+E2E。

本计划替代前序讨论中的 mandatory Red 及过度流程化建议。原1/2项曾在旧契约下clean；原Step3实现mandatory Red后有单步死局、blocked无重试、滚动日志淘汰问题。不要继续补“所有test-first至少两步且必须改产品代码”。

## 已决定，不要重新发散

1. Target Architecture核心保持；不新public测试Skill、全局test registry或独立测试状态机。
2. 三条主线：取消默认TDD；claim证据正常接口闭环；风险检查点且不漏累计变更。
3. 保留`test_strategy`等字段；默认增补`flexible`（若本地已有等价机制则复用）。旧三mode继续承担明确语义，不能伪报implementation-first来容纳普通任务。显式顺序/复现要求不能被跳过。
4. 多槽必须实际落入prepare→execute→complete→close，不是只把数组放宽。新任务非空plan、至少一acceptance、每claim至少一slot；稳定claim/slot/check ID，不按验收文字/序号误配。
5. 最小结构化报告、check/slot绑定、结果/版本/产物适用性本期做。默认caller-reported；无实际provider不能靠source_kind自报升级为trusted。完整provider后置，不宣称执行真实性已机器保证。
6. 相关代码/测试/fixture配置变化使证据重核或保守失效；纯Runtime审计更新不能无条件使新证据全部失效。
7. P-12测试准入补明确来源、claim、必要性与已有证据不足；同一允许文件内部测试价值先由review核验，不假称已有AST硬控制。
8. 不再每步required；后续required checkpoint必须覆盖前面未审查的相关变更。必要时首版保守审累计task diff；repair verification仍必需。
9. 测试oracle/弱断言/重复与mock边界审查本期随review落地；不是等新dogfood再次失败才做。
10. 最小blocked retry在真实dogfood前做：同计划、权限不变、保留失败、有界尝试、幂等；不能直接complete或造finding解锁。
11. 不假设vNext从未发布。S0核查版本/安装与active task；不静默解释旧记录。pre-vNext legacy与vNext旧task区别处理。
12. Skill是模型指令，不是执行器/沙箱。Runtime检查机器可见结构与绑定，不保证自然语言业务判断。独立身份需宿主，换Skill名称不等于独立评审。

## 执行习惯

先读实际作用域AGENTS/CLAUDE。本文件+HANDOFF+当前steps/Sx足以启动单步；按当前步骤指定章节回读PLAN，不全库扫读、不要一次打印整份kernel。

按S0→S1→S2→S3→S4→S5，每次只做用户指明的一步，停止后交接；不自动commit/push，不跨调用串联公共Skill。按现有治理渠道确认/更新任务，不手改CURRENT_TASK解锁。

HANDOFF是本次重构导航，不替代产品canonical状态。完成报告必须区分代码测试通过、业务dogfood结果和caller-reported可信度。完整规格见PLAN.md；每步结束更新实际hash/文件/验证/风险。
