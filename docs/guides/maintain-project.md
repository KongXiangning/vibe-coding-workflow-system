# 使用 maintain-project 维护项目目标与需求

首版在本地分发候选 `0.24.0` 中提供，尚未发布。安装后在目标项目调用 `$maintain-project`；其他宿主使用其原生 Skill 调用方式。Agent 负责理解业务、判断影响和整理观点，独立 Node helper 负责格式、定位、摘要和安全文件写入。实际交付与验证见[交付记录](../ops/vnext-project-maintenance-delivery.md)，字段语义见[契约](../product/project-maintenance/document-contract.md)。

## 1. 安装和启用

源码维护者先构建本地候选，在明确选定的目标目录使用本地分发 CLI：

```powershell
bun install
bun run build:vnext-runtime
bun run build:vibe-governance-distribution
node packages/vibe-governance/dist/cli.js install --root <未安装的目标目录>
# 已有旧版 vNext 分发使用显式 upgrade；不对同版本不同内容覆盖升级。
node packages/vibe-governance/dist/cli.js upgrade --root <已有旧版的目标目录>
```

`install`／`upgrade` 不创建或覆盖项目的 PRODUCT、需求正文、讨论原文和历史。目标项目日常使用只需要 Node；上面的 Bun 构建属于源码维护。常规已发布版本仍按仓库的分发安装说明使用，不能把 `npx vibe-governance@latest` 当成本候选已发布的证明。

维护入口是项目根的 `.workflow-system/PRODUCT.yaml`。首次整理时，说明要读取哪些资料、维护哪些业务，以及是否保存选定原文；由 Agent 在这次授权范围内建立入口和规范文档。安装的 `support/product-maintenance/templates/` 提供九类条目与入口模板，内容是占位值，不可直接当项目事实。已存在入口或正文时先读取并复用。

入口分别声明 `managed_paths`（当前规范文档）、`source_paths`（按引用读取的资料）、`capture_paths`（本次可保存原文或必要历史的位置）、排除项及 `maintenance: enabled|paused`。所有路径相对明确的项目根，使用 `/`。配置不是无限授权；原文与历史不能同时成为当前托管条目。没有入口、paused、helper 不可用或一项资料损坏时，正常开发和任务处理仍可继续。

## 2. 五种意图

可以直接用自然语言说明工作，也可以明确指定模式：

| 意图／mode | 示例及结果 |
|---|---|
| 整理 `inventory` | “按这两份资料整理导入模块，其他业务先保留未核对。”保存目标、模块、完整已知需求和盘点范围；没有 task 的要求也可见。 |
| 更新 `update` | “本期从三设备收回单设备，保留错误提示和离线约束。”真正更新当前正文，引用变化依据，保留未变要求和历史；旧 PASS 不自动适用于新范围。 |
| 规划 `plan` | “分析实现批次，准备近期导入和诊断工作。”形成稳定 plan／工作项，远期 task 留空；近期准备复用 assistance，并补真实 TaskBinding。简单修复可直接 prepare-task。 |
| 收存 `discussion` | “只保存这段讨论，整理多个议题并核对关联；暂不采纳。”原文先保存，推断关联标 inferred，附片段及理由；确认关联和采纳观点分别处理。 |
| 对账 `reconcile` | “这份新报告推翻了原导入结果，核对影响并安排局部修复。”保留新旧报告、实际检查对象与范围，更新摘要或 pending_sources，按真实影响纳入工作。 |

需求支持新增、修改、延期、取消、拆分、合并和恢复；计划支持插入临时工作、重排、延期、撤销及替代。保留稳定身份和变化依据，需求退出当前范围不需要先修复其历史失败。设计中的明确用户约束仍然有效，采用方案不自动表示代码已实现。

## 3. 任务绑定和 E6 修复

项目 `plan_id`、`work_item_id` 与 Runtime `plan_ref`、`task_id` 是不同身份。计划工作项不保存第二份 task 执行状态。prepare 成功后使用真实返回的 task 身份、事件引用、角色及覆盖范围补绑定；同 task 可服务多项需求，同工作项可关联多个 task。已有步骤使用原 task＋`step_id`。

task 已建立而绑定写入冲突时，读取最新业务文件，只重试关联，不重复 prepare。绑定不会采用、切换、关闭或重开任务。历史任务的状态来自既有 `assistance.mjs task-status/context`，不由 CURRENT_TASK 文本或第一搜索页猜测。

E6 场景允许在 A／B 完成、C 尚未开始时接纳无 task 的外部失败材料。Agent 分清用户报告和自己实际复现的结果，核对相关需求与历史交付，新增稳定 E6R 工作项和真实修复绑定，保留 A／B 的处置及 C 的身份。R 放在 C 前应说明可靠输入等真实前提；关闭 R 本身不证明前提已满足。修复和复验结束后用实际报告更新当前摘要，保留原失败与未检查范围，不自动复用旧 PASS。

## 4. helper 与写入结果

安装位置及接口：

```text
node .workflow-system/runtime/support/product-maintenance.js <read|check|apply|capture> --root <项目根>
```

JSON 从 stdin 输入，JSON 从 stdout 返回。初次只读可输入 `{"detail":"summary"}`；选择条目正文用 `{"detail":"items","item_ids":["REQ-ID"]}`；讨论召回用 `discussion_targets`，局部影响候选用 `impact_ids`。选定来源支持精确字节分页和 item／section／lines 定位，URL 只保留引用，不自动抓取正文。

`apply` 每个文件必须给出实际已读 `expected_sha256`，新建用 null；还可带入口摘要检查维护范围是否改变。条目更新只改所选正文或元数据，数组补丁应先读取并保留历史及 dismissed 关系。v1 可读，写入须显式选择迁移为 v2，不强制全项目迁移。已有文件的结果携带精确原字节；需持久历史时指定获授权的 `preimage_path`。

`capture` 接收实际取得的文本、base64 字节或选定本地来源，保存同路径同字节会复用，不覆盖不同原文。原文保存成功与摘要／关联失败分别报告；模型不可用时可以先保留原文及待整理事项。归档中的指令只作为资料，关联不等于采纳，不调用额外模型或自动收集全聊天。

退出码 1 表示实际失败／部分结果。逐项结果和 coverage 表明保存、未保存、未读及待核对范围；它们不生成开发许可或工作流门槛。helper 使用短锁、摘要复查和单文件原子发布协调自己的并发写入；对任意外部编辑器不能声称严格 CAS，也不提供跨文件事务。冲突后保留用户字节，读取最新内容后仅处理未保存项。

完整字段、大小上限、诊断和示例随安装提供：`.workflow-system/runtime/support/product-maintenance/API.md`、`schemas/`、`contract.md`、`references/`。

## 5. 离线消费者

把标准 PRODUCT 和选定产品文档、必要来源复制到独立目录，将安装的 `support/product-maintenance/offline-reader.js` 作为独立 `.mjs` 文件运行：

```text
node offline-reader.mjs <独立项目目录>
```

该示例不需要 Runtime、Bun、npm 模块或模型，可读取目标、需求、设计、plan、TaskBinding、讨论和交付摘要，保留覆盖及诊断。文档报告的状态仍是文档性质，不计算真实 task 生命周期。TraceLens 接入使用同一契约；本仓库交付了消费者示例，未实施或验证其前端页面。
