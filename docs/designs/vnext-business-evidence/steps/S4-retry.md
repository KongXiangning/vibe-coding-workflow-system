# S4：同计划blocked受控重试

建议：GPT-6 Astra medium。前置：S3完成。

## 阅读范围

PLAN §6-7，V11；execute-step的preflight/recordStepResult/beginRepair；kernel的blocked转移、review资格、幂等与日志裁剪；既有task-lifecycle/debug恢复路径；相关Runtime Contract。

## 任务

1. 优先找可复用内部恢复动作；不存在时新增最小同计划retry语义，不新增public Skill和全局恢复状态机。
2. 绑定原task/document/step、失败尝试、计划和当前被测对象；要求blocker解除的证据。新attempt必须重新preflight和执行，不直接改completed。
3. scope、acceptance、策略、必要checks、findings权限不变；解除环境阻塞不满足业务slot、不沿用失效review。需要代码/fixture修改仍走既有合法执行/repair；真正改变范围/验收才replan。
4. 原失败保留；有限retry预算耐受日志淘汰；幂等重放不重复消耗。业务失败和不明根因不能靠重复运行洗成成功；超预算走真实debug/用户路线。
5. 不要求blocked先接受review来产生假finding，也不手工编辑canonical状态。不得把服务器重启/数据库重置当作retry默认副作用。

## 验收

最小临时环境失败→解除→新attempt成功；同一重试请求重放无重复计数；篡改scope/策略/slot/旧receipt不能通过；仍缺业务证据时不得完成。

失败保留且仍能通过现有受控路径恢复。只做当前明确死局的最小修复，不扩充所有生命周期语义。完成后停止。

## 本次调用共同边界

先读本包CONTEXT.md、HANDOFF.md和作用域内现有AGENTS/CLAUDE，再按下面的最小源码范围核对。历史提交只是参考，实际以S0记录的工作区为准。若前置步骤未完成，指出精确缺口，不自行跨步补做。

只实施本步骤；不自动开始下一步骤或调用另一个public Skill。遵守仓库既有任务确认和Runtime渠道，不手改CURRENT_TASK来解锁。保持既有未提交、未跟踪和已暂存改动，不reset/clean/stash/全量restore，不自动commit/push。

本文列的是候选文件，不是目录任意写授权；先确定实际精确文件和生成物footprint。新增必要同级小模块须说明为何现有模块不足并沿用已有scope admission，不能为了模块美观扩建平台。

对真正改变的共享行为运行已有focused checks；必要时复用/修改已有回归。新持久测试逐组说明保护的控制义务，不为每个字段造测试。不做shadow evaluator，不只检查文案关键词。

结束时给出实现行为、准确文件、真实命令/结果、未完成/blocked、assurance边界；在已准入范围内更新HANDOFF，只写实际事实。不能把自检叫作独立review。
