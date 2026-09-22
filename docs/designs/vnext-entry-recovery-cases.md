# vNext 恢复验证用例盘点

状态：静态盘点及用例编写完成，尚未运行。只补新执行器的行为缺口，不另建测试框架。

## 直接复用

| 行为 | 现有用例位置 / 识别名称 | 本轮处理 |
|---|---|---|
| 真实环境失败 → 恢复 → 新 preflight → 执行 → 审查完成 | `test/vnext-runtime.test.ts`：`S4 retries an environment blocker...` | 复用 semantic task、命令探针和证据格式 |
| 预算扩展保留修复目标 | 同文件：`extends only the exact exhausted repair budget...` | 保留，不复制 |
| 受控修复超过默认额度 | 同文件：`uses an exact warning decision to authorize six controlled waves...` | 保留，不复制 |
| 范围调整继承预算及 ready attempt 复用 | 同文件：`scope amendment walks three continuation layers...`、`scope amendment directly reuses...` | 保留；新增驱动器层的耗尽继承场景 |
| 存储中断、报告沿袭和恢复 | `test/vnext-task-recovery-e2e.test.ts` 的 fixed tgz recovery 场景 | 复用，不为每个入口重复安装 |
| 关闭后补齐 STATUS/Lesson、重复恢复无写入 | `test/vnext-close-reconciliation-e2e.test.ts` 的 Scenario A–D | 保留，不复制 |
| 分页与不可变存储 | `test/vnext-task-context.test.ts`、`test/vnext-task-store.test.ts` | 保留；新回执分页单独补传输边界 |
| 验证失败和真实证据缺口 | `test/vnext-validate-change.test.ts` | 保留；不把负面验证结论当成恢复器失败 |

## 新增的五条有效场景

1. **普通预算全链路**：真实探针失败三次，错误分析绑定不改状态；正确复盘记录续行后，恢复证据不合格仍保留决定；修正证据后复用该决定，重放不增加次数，fresh preflight、真实探针成功、结果登记、审查完成。复用 `vnext-runtime.test.ts` 的现有夹具，不手写 canonical ledger。
2. **范围调整后预算耗尽**：通过真实 amendment 事务继承旧失败，驱动器续额并准入当前 continuation；原失败和累计次数保留。同文件。
3. **超过旧 16 MiB 的输出**：真实子进程产生确定的 18 MiB 数据，完整回执可读、默认摘要小于 16 KiB。这只证明传输，不冒充业务任务验证。
4. **Unicode 分页完整性**：真实 CLI 分页、拼接等于原数据；非法字符中间偏移失败不损坏文件，EOF 正常结束。
5. **回执被修改**：同长度内容变化仍由哈希发现，任意外部文件不能作为回执读取。

第 3–5 条位于 `test/vnext-entry-runner.test.ts`。删除了 11 个入口名称循环冒烟、假 restore/fail 命令和只检查包装字段的用例。普通预算的多次夹具初始化合并为一条连续场景。

## 简化执行范围

首次运行只需构建当前 CLI，然后执行新增文件及 `vnext-runtime.test.ts` 中的
`shared entry driver with real Runtime task transactions` 分组。失败定位到某个
底层能力时，再运行上表对应旧用例；不默认全量回归或逐入口重复安装。

这些是 Runtime/CLI 行为验证，不证明 AI 在所有自然语言指令下都能选择正确恢复
动作；也未进行真实目标项目升级、全入口 Agent dogfood 或任意进程崩溃点穷举。
