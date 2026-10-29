# 已迁移 v2 项目的旧 Task Store 清理

`scripts/cleanup-legacy-task-data.ts` 是源码仓库中的独立维护脚本。它不安装到目标 Runtime，
不由 upgrade、普通开发或 close-task 调用。新项目无需使用；旧 journal 项目先执行已有的
Task 数据迁移。本工具只处理已经能读取 `task-query/v2` 的项目。

在本源码仓库安装依赖后执行，计划和备份都放在目标项目外，所在父目录需预先存在：

```powershell
bun run scripts/cleanup-legacy-task-data.ts plan --root E:\coding\LawAgent --out E:\coding\LawAgent-record-backups\cleanup-plan.json
bun run scripts/cleanup-legacy-task-data.ts apply --root E:\coding\LawAgent --plan E:\coding\LawAgent-record-backups\cleanup-plan.json --backup E:\coding\LawAgent-record-backups\legacy-task-data.tar.gz
```

先在项目副本使用，核对当前任务和 TraceLens 的实际条目及关联后再应用真实项目。
执行期间暂停该项目的工作流写入。脚本按 PROJECT_PROFILE 的 workflow_home 定位目录。

处理范围为旧 `task-data` 中已识别的 Task Store 文件、`task-history` 的旧检查点和定义历史，
以及旧 workflow_home/evidence-objects 中摘要匹配的 blob。不识别的文件和策略文件保留。
当前 PRODUCT 的结构化文件引用、受管正文的实际链接及正式 Task 的保留附件会保护来源。
已迁移 Task 中的文件来源同样保留原字节，不因一个 manifest 来源引用而保留整个旧事务链；
旧文件是固定字节的历史依据，完整旧工具读取／回退需恢复备份。引用检查点时连同其实际 blob
保留。历史任务快照中的旧
manifest_path 不是新的当前依赖，source_paths 的路径登记也不等于全量保留。

清理前，每个旧 store 的最终正文会机械导出到 `TASKS/legacy/<document_id>-text.md`。
compact-v2/v3 的正文段落按原文复制，附上旧身份及状态说明；不让模型总结、判定业务通过，
不新增当前 Task 或改变其身份。当前业务文档、已有任务 Markdown 和 v2 Task 字节保持原样。
未知旧格式、未完成的旧事务、冻结、正文导出冲突或计划后变化会报告，不能静默丢失正文。

备份是单个项目外 tar.gz，包括该批旧目录和当前 Task／业务定义／已有任务文本等核对输入，
逐文件检查大小与 SHA 后才导出、删除。它包含检查点实际依赖的旧 blob，区别于只保存
检查点索引。备份不是整个工程或 Git 仓库，不补造此前已经缺失或从未提交过的数据。

可用同一工具把备份恢复到一个不存在的新目录；不会覆盖当前项目或重放业务：

```powershell
bun run scripts/cleanup-legacy-task-data.ts restore --backup E:\coding\LawAgent-record-backups\legacy-task-data.tar.gz --out E:\coding\LawAgent-record-backups\legacy-inspection
```

清理中途失败时保留已验证备份和已导出的正文。当前任务保持有效；源文件没有变化时，
使用同一 plan 和 backup 重试，续清剩余文件。不得覆盖或换成其他计划的备份。结果只返回
统计，不产生逐文件回执、永久事件或后台维护任务。

工具不暂存、提交、推送或改写 Git 历史。已跟踪旧文件删除仍显示在 Git 状态中；后续单独
审阅并提交精确清理范围。HEAD／索引不再包含这些已提交删除路径后，相应
PERSISTENT_FILE_MISSING 提示自然消失；原有真实引用缺口仍如实保留。
