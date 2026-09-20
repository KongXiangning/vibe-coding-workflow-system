# 回放评估准则（不提供给准备会话）

## 公开案例边界

`selection-patterns.json` 是泛化后的说明材料，不是原始任务、可执行 fixture 或
验收证据。实际业务评估依赖另行获准的源码和需求，不从这些说明重建产品代码。
区分执行者报告、持久状态、独立审查和实际重跑；冲突参数不能任选一个当真。

## 语义评价，不做字段/关键词评分

判断独立预期能否区分相关的正确与错误行为；窗口、内存驻留、在途取消、
跨边界关联、真实消费者等仅在属于当前义务时评估。一个最终成功结果不能
自动证明过程中资源上界或取消响应。输入可使用生产 helper，oracle 不能
无条件跟随同一潜在缺陷。允许充分的非测试证据，不要求一模式一测试。

以完整义务集合为比较对象：必要观察、相关风险、独立用户/项目/发布要求。
只有较窄可行集合保留相同检出力、边界和所有义务且总成本不增加时，才要求
收窄。显式 package regression 即使有 focused acceptance check 仍可能必要。
多观察合并可以成立，但要比较批量 selector，计入额外无关 case、启动/运行、
维护和诊断成本；方便或一次启动不是充分依据。使用既有 breadth basis/source，
不新建“成本优势”授权类型。一次调用仍须分别报告其真正支持的各 slot。

## 不推动过度治理

尚未编写的测试可先评估可行 setup 与独立预期，不要求 prepare 执行。
未到期的 flow 证据不能提前当作阻塞，也不能为省测试删除必要 flow。
无依据宽测应在计划中纠正；额外 PASS 本身不是运行中永久阻塞的理由。
评估用普通说明，保留所读源版本、选择与不选原因、实际证明边界和未运行项；
不为目标 Runtime 新增字段或审批。

## 已有公开源码的历史检出力校准

这是源码仓库自己的真实历史缺陷，不替代原业务案例，也不证明提示词效果。
旧实现 `a37115df5cb97dae969582e8c9570653cd0cd20a` 与修复
`b3d8410bd37db6a135783d10b6c3ef291cf119c5` 可使用同样三个既有检查：

| 业务义务 | 已有 test 名称 | 独立观察 |
| --- | --- | --- |
| 不混合不同 revision 的样本 | `storage metrics review invalidates samples when a real commit crosses the start or final sampling boundary` | 实际并发事务使样本 unavailable；稳定后真实 CLI 一致 |
| 表示迁移不制造逻辑增长 | `storage metrics review normalizes missing legacy defaults before computing migration deltas` | 相同逻辑模型增量为 0 |
| 合法引用正确计数 | `storage metrics review uses canonical Task Basis references without imposing blank-line spelling` | 与真实文件 UTF-8 字节数一致，不受合法空行形式影响 |

复现时只移入匹配测试，保留旧生产实现并重建旧 CLI；用精确 name pattern。
只有相关业务断言失败才算检出，不能把 import/build 错误算成成功。
这些检查已由知情实现者选定，不是 fresh Agent 盲测。源码 guard、知情校准、
独立 Agent 运行和真实 dogfood 必须分别报告，不相互冒充。
