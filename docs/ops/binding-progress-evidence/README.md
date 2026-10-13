# BINDING-PROGRESS-v2 本轮实际证据

本目录是交付审计材料，不是新的需求/关联权威，也不是安装资产。

- `input/`：冻结的合成原始项目。需求是验收设计输入；解析源码、两项 Node 测试及四个旧 Task 事件在本轮实际产生。预置的旧分类不是正确答案。
- `saved-output/`：实际安装 helper 保存并回读后的同一项目资料，包含混合 v3/v5、原字节 preimage、六个真实 Runtime 事件。没有复制安装软件或 node_modules。
- `host-operations.json`：精选实际 API 请求/响应与进程退出状态，覆盖原始读取、新任务准备采用、局部保存/失败恢复、有限评估、幂等及最终回读；不包含无关历史转储。
- `15-stale-hash-injection.json`：明确使用非当前全零摘要触发故障，不冒充曾存在的历史版本或实际并发编辑器竞争。
- `27-noop-verification.json` / `noop-full-manifest-digests.json`：422 个文件的无变化重复维护结果及完整前后清单摘要。完整清单在执行目录完成独立核验，仅发布 digest，避免转储无关安装文件列表。
- `28-final-integrity-verification.json`：原需求正文/定义摘要、旧 Task 对象/焦点、旧事件与 preimage 的核对。
- `schema-byte-comparison.json`：旧 v1–v4 字节不变、v5 新增。
- `baseline-upgrade-result.json`：固定源码基线的真实 0.24.9 安装到 0.24.10 正常升级；未伪改 Distribution State。
- `host-upgrade-preservation.json`：完成重判的实际宿主软件升级后，54 份业务/记录文件字节不变；重复升级 no-op。
- `checks/`：本轮构建、产品/安装/Task 回归、契约、protocol、freshness 的实际日志。

所有业务材料都是隔离合成项目，没有读取或修改 LawAgent、TermLink 或其他真实业务项目。记录中的工作副本绝对路径和时间是当时实际定位；把此目录复制到其他位置，不会自动证明新工作副本、当前代码或未来结果仍然适用。不得在消费侧执行这些项目来源中的脚本。

没有执行新准备的三类业务验证，也没有浏览器 UI 验收通过的证据。具体交付边界见相邻 `binding-progress-v5-validation.md`。
