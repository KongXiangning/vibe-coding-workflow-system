# maintain-project 首版实际证据

本目录保存当前宿主 Agent 在 2026-10-04 使用实际安装 Skill、Node helper 和既有 assistance 的运行证据。材料属于隔离合成业务，不是用户项目、真实聊天或生产事故；讨论输入中的历史指令不授予执行权限。完整解释见[交付记录](../vnext-project-maintenance-delivery.md)。

`host-agent/` 是原目录的字节快照：`snapshot-index.json` 列出每个文件实际 SHA 与字节数，readback 保留原工作副本路径。PRODUCT、业务文档、原文、history、actual checks、基线／修复代码和原服务 events 位于原相对路径。它不是源码项目的当前托管基线，不应把事件导入其他项目，也不应重放历史 task 请求。

`agent-observations.jsonl` 是此次实际 JSON 输入／输出及次序的追加记录，不是普遍证明宿主模型质量的自动测试。`final-install-evidence.json` 分别记录真实升级、目标资产保留、helper SHA、检查退出码和无 Runtime 消费者结果。E6A／B／R 的 task ID 由原任务服务分配；C 未创建。原外部反例失败、旧 PASS、修复后的实际 PASS 和未核对范围同时保留。

`checks/` 保存最终候选实际命令的 JSON 结果及 stdout／stderr。源码行为、既有服务回归、分发／安装、protocol／freshness 与宿主语义操作分别记录，不能把某层通过当作另一层或真实 UI 通过。
