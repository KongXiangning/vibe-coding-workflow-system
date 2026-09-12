# 可直接复制的Codex提示词

使用前：把整个包放到仓库 `docs/designs/vnext-business-evidence/`，或附给Codex并让其定位实际位置。下面使用推荐路径；其他位置只改路径。无需把此前聊天整段复制进去。

## 0. 新会话初始化 / xhigh核实

```text
请处理 docs/designs/vnext-business-evidence/ 中的实施计划。
这是vNext测试治理纠偏，不是严格TDD改造，也不是新建测试平台。
先完整读取PLAN.md、CONTEXT.md和steps/S0-baseline-and-contracts.md，核对实际AGENTS、HEAD、未提交改动与版本，只执行S0。
按S0把具体接口、最小读写地图和真实基线写入HANDOFF.md；不要改Runtime实现，不开始S1。
已固定方向不要重新发散：默认无强制测试顺序，业务证据多槽真实接通，稀疏review覆盖累计相关变更，最小retry在dogfood前完成；完整Provider/AST/全局Test ID后置。
历史commit只是参考，不能reset。遵守现有治理写入/确认边界，不能靠手改CURRENT_TASK解锁。
输出核实结果、具体接口、剩余真实阻塞和下一步，随后停止。不要把读取称作跨会话缓存或隐藏记忆。
```

## 1. 测试顺序纠偏 / medium

```text
只执行 docs/designs/vnext-business-evidence/steps/S1-ordering.md。
先读CONTEXT.md、HANDOFF.md与本步骤引用的PLAN章节，确认S0前置已满足。按已冻结接口实施，不重新设计整体架构，不开始S2。
重点：为普通任务提供flexible或已有等价无顺序语义，撤除默认mandatory Red，不放宽明确用户前置要求。
使用正常Runtime调用链和必要回归验证；保护已有改动，不自动commit/push。结束更新HANDOFF并报告实际结果和限制。
```

## 2. 业务证据闭环 / medium

```text
只执行 docs/designs/vnext-business-evidence/steps/S2-evidence.md。
先读CONTEXT.md、HANDOFF.md和本步骤引用的PLAN章节，确认S1已完成。稳定claim/slot/check身份、多槽正常接口、report/assurance、相关版本失效、共享完成校验及P-12准入要一起闭环。
必须证明“规则报告通过但必要流程槽缺失/失败，不能complete/close”；不要只放宽数组，也不要造可信Provider。
保护已有改动，不自动commit/push。结束更新HANDOFF并报告验证和未完成事项，不开始S3。
```

## 3. 检查点与测试评审 / medium

```text
只执行 docs/designs/vnext-business-evidence/steps/S3-review-checkpoints.md。
先读CONTEXT.md、HANDOFF.md与相关PLAN章节，确认S2已完成。
取消逐步mandatory review必须同时解决累计review目标：后续required checkpoint涵盖此前免审的相关变更；repair verification保持。
补齐测试必要性、oracle、mock及业务流程证据审查，不新建public测试Skill。
保护已有改动，不自动commit/push。结束更新HANDOFF并报告实际验证，不开始S4。
```

## 4. 同计划重试 / medium

```text
只执行 docs/designs/vnext-business-evidence/steps/S4-retry.md。
先读CONTEXT.md、HANDOFF.md与相关PLAN章节，确认S3已完成。
只修当前blocked恢复死局：同计划、权限不变、保留失败、有界尝试、幂等；重新preflight和运行，不能直接completed或伪造finding。
不扩建通用恢复平台，保护已有改动，不自动commit/push。结束更新HANDOFF并报告实际验证，不开始S5。
```

## 5. 总验证与dogfood / medium

```text
只执行 docs/designs/vnext-business-evidence/steps/S5-verification.md。
先读CONTEXT.md、HANDOFF.md和PLAN验收矩阵，确认S1-S4及必要review已收敛。
核验真实Runtime共享入口、生成/分发一致性和已授权隔离业务dogfood；代码全绿不能替代真实流程。
结果明确caller-reported assurance，不把未运行/环境blocked写成clean。保护真实数据和已有改动，不自动发布、commit或push。
结束更新HANDOFF，报告整体已完成/阻塞与剩余局限，停止。
```

## 独立聚焦审查（任一里程碑后）

```text
请按 docs/designs/vnext-business-evidence/REVIEW.md 对刚完成的步骤进行独立聚焦审查。
从HANDOFF核实步骤与实际diff身份，不继承作者clean结论。只读，不修复、不开始后续步骤。
区分确定缺陷、已接受且明确标注的caller-reported局限、可后置增强；给出可复现finding、最小修复范围或clean及证据。
```

## 新会话恢复任一步

```text
先读 docs/designs/vnext-business-evidence/CONTEXT.md 和 HANDOFF.md。
不要推断上一会话隐藏上下文，不全库重扫。核实当前HEAD/dirty身份与HANDOFF是否一致；随后只执行我指定的steps/Sx文件，按需回读该步引用的PLAN章节和符号。
如果前一步没有收敛，报告精确缺口，不跨步自动修复。不重复询问已在计划中明确的设计选择。
```

每次复制对应块即可；S0可先用xhigh，后续逐步medium。独立审查不是要求每次开发步骤都建立新业务workflow节点，仅是本次较大重构的工程核验。必要治理确认仍以实际仓库约束为准。
