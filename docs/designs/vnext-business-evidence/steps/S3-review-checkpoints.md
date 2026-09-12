# S3：风险检查点、累计目标与测试语义评审

建议：GPT-6 Astra medium。前置：S2完成。

## 阅读范围

PLAN §4-5，V9-V10。prepare适配器的semanticDraftDefinition和step输入；task-steps检查点解析；execute的not-required完成路径；review-change-adapter的latestRecordedExecution/reviewContext；kernel的review target/receipt/repair convergence；prepare/review-draft/review-change模板相关段落。

## 任务

1. 允许每步显式required/not-required及理由；不再硬编码全部required，也不全部默认not-required。保留必要项目政策、风险/逻辑边界、所需final review和repair verification。
2. 修正“只审最新一步”的问题：所需checkpoint评审覆盖前面未审查的相关变更。优先复用现有change_set/manifest；分段过重可按S0选择保守审累计task diff，不能漏早期步骤。
3. 基线覆盖既有dirty归属、新增/删除和同路径多步修改。以一个逻辑review target绑定receipt。findings/blocked/错版本不清待审范围，状态可跨会话恢复。
4. 防止稀疏checkpoint出现“早期文件不能在后续修”的死局。prepare现有path-by-step检查应为预见修复给出精确scope/Conditional或重切片；实际发现新越界仍按权限处理。
5. review-change按相关触发审查测试必要性、原需求强度、oracle独立性、弱断言/自我验证、fixture/mock、复用映射及流程证据；review-draft审查验证计划和来源。不强制新增public Skill或每个测试一个review。
6. 测试文件未变但复用映射/关键fixture变化仍可触发对应维度；混合diff统一verdict。finding按根因/权限路由，不按发现入口只能修某类文件。
7. Runtime可要求维度记录及正确绑定，不声称机器证明审查语义正确或独立身份。保留现有public-entry terminal boundary。

## 验收

必须有真实回归：step A免审改文件a，step B required只改文件b，review能看到a+b；A或B后续再变导致相应旧clean无效。not-required步骤仍不能跳过到期evidence；repair后verification仍必需。

oracle审查使用有限实际diff示例；不能只在template测试中匹配关键词就算完成。生产常量用作输入不是一概禁止，关键是预期是否随被测错误同步变化。

本步不得为了省事保留只审最后一步，也不得以“先免审，以后补累计目标”发布半成品。完成后停止。

## 本次调用共同边界

先读本包CONTEXT.md、HANDOFF.md和作用域内现有AGENTS/CLAUDE，再按下面的最小源码范围核对。历史提交只是参考，实际以S0记录的工作区为准。若前置步骤未完成，指出精确缺口，不自行跨步补做。

只实施本步骤；不自动开始下一步骤或调用另一个public Skill。遵守仓库既有任务确认和Runtime渠道，不手改CURRENT_TASK来解锁。保持既有未提交、未跟踪和已暂存改动，不reset/clean/stash/全量restore，不自动commit/push。

本文列的是候选文件，不是目录任意写授权；先确定实际精确文件和生成物footprint。新增必要同级小模块须说明为何现有模块不足并沿用已有scope admission，不能为了模块美观扩建平台。

对真正改变的共享行为运行已有focused checks；必要时复用/修改已有回归。新持久测试逐组说明保护的控制义务，不为每个字段造测试。不做shadow evaluator，不只检查文案关键词。

结束时给出实现行为、准确文件、真实命令/结果、未完成/blocked、assurance边界；在已准入范围内更新HANDOFF，只写实际事实。不能把自检叫作独立review。
