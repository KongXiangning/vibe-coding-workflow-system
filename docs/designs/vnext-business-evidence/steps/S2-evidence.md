# S2：业务验证义务与结果报告闭环

建议：GPT-6 Astra medium；复杂共享类型以S0冻结接口为准。前置：S1完成。

## 阅读范围

PLAN §3、§4、§7；V4-V8、V12-V13。prepare-task-adapter的语义输入/claimEvidence/semanticDraftDefinition/persistent_tests；execute-step-adapter的normalizeAcceptanceEvidence/updateClaimEvidence/recordStepResult/completeReviewedStep；kernel中claim validate/plan preserved/completion/closure；真实close调用入口。按符号读，禁止整份kernel全量输出。

## 任务

1. 让正常prepare-draft输入实际支持多槽并在CURRENT_TASK持久化：新plan非空，至少一acceptance，每claim至少一slot；使用任务内稳定claim/slot/check身份及确认的要求绑定。
2. 去除按acceptance文字/数组位置匹配和“一claim只能一slot”假设。单次执行精确更新对应slot；其它slot保持原事实。到期步骤之外的未来义务仍可missing，本步到期和最终关闭严格校验。
3. 对一个确实跨边界的示例，实际规划并走通rule与flow两个不同槽；普通规则/文档仍可单槽。新计划不用planned-validation模糊占位代替具体检查。
4. 将最小结果报告绑定check、slot、计划/被测对象版本和产物引用。当前来源仍为caller-reported，assurance由受理路径决定，不允许调用方填写trusted/runtime-local等字段自行升级。
5. 共享Runtime校验拒绝错槽、未知check、所需结果缺失、显式不匹配、failed/blocked/not-run与陈旧结果。adapter、raw proposal、步骤推进及close消费相同约束，不能仅存在上层检查。
6. 相关被测对象、测试/fixture/helper/config变化后重核/保守失效；Runtime审计revision变化不让刚产生结果全失效。必要状态与引用不依赖滚动日志保留。
7. 沿用既有非执行证据受理；不要求静态证明/人工验收提供进程退出码，也不把来源伪造成真人确认。报告型证据仍不能证明执行真实性，应在输出明确。
8. 新增/语义修改持久测试补足P-12已有准入字段：来源/owner、claim、依据、已有证据不足及行为/断言边界。按场景/测试组，不每个输入一条；不用AST或全局Test ID。
9. 接通S1剩余的局部先行义务表示。尚未支持的显式前置不静默豁免。

## 验收

用真实adapter/raw proposal/close路径覆盖V4-V8、V12-V13，重点：“规则通过、流程missing/failed不能complete”；“写一个来源字符串不能成为可信Provider”；“多槽不靠文字复制配对”；“修改fixture后不能用旧报告收尾”。

本步不宣称阻止虚假caller report。若项目要求更高assurance，明确阻断或保留升级需求。文档和最终输出须区分结构受理与实际执行事实。

先小范围共享逻辑和已有测试，不建框架runner、业务状态数据库或通用workflow graph。若本步工作过大，可在同一S2内分2A数据与2B消费两个本地提交候选，但不能将仅有schema的半成品标记S2完成或分发。

## 本次调用共同边界

先读本包CONTEXT.md、HANDOFF.md和作用域内现有AGENTS/CLAUDE，再按下面的最小源码范围核对。历史提交只是参考，实际以S0记录的工作区为准。若前置步骤未完成，指出精确缺口，不自行跨步补做。

只实施本步骤；不自动开始下一步骤或调用另一个public Skill。遵守仓库既有任务确认和Runtime渠道，不手改CURRENT_TASK来解锁。保持既有未提交、未跟踪和已暂存改动，不reset/clean/stash/全量restore，不自动commit/push。

本文列的是候选文件，不是目录任意写授权；先确定实际精确文件和生成物footprint。新增必要同级小模块须说明为何现有模块不足并沿用已有scope admission，不能为了模块美观扩建平台。

对真正改变的共享行为运行已有focused checks；必要时复用/修改已有回归。新持久测试逐组说明保护的控制义务，不为每个字段造测试。不做shadow evaluator，不只检查文案关键词。

结束时给出实现行为、准确文件、真实命令/结果、未完成/blocked、assurance边界；在已准入范围内更新HANDOFF，只写实际事实。不能把自检叫作独立review。
