# 旧 journal → Task 当前记录：显式迁移

这是独立管理工具，不是旧 Migration Pack，也不是开发准入。install、upgrade、close-task
和普通 task 调用均不会执行它。先升级软件，再明确迁移已有数据。迁移期间暂停该副本的
任务写入；正式执行前先在项目副本演练。

## 命令

路径均为占位。plan 和备份必须位于项目外；同名备份不会被覆盖。

```powershell
node <project>/.workflow-system/runtime/support/task-state-migration.js plan --root <project> --out <external-plan.json>
node <project>/.workflow-system/runtime/support/task-state-migration.js apply --root <project> --plan <external-plan.json> --backup <external-backup.tar.gz>
node <project>/.workflow-system/runtime/support/task-state-migration.js verify --root <project> --plan <external-plan.json>
node <project>/.workflow-system/runtime/support/task-state-migration.js restore --backup <external-backup.tar.gz> --out <new-inspection-directory>
```

源码入口：`bun run build:task-state-migration` 构建 `runtime/vnext/dist/task-state-migration.js`；
`bun run test:task-state-migration` 执行回归。安装后的工具无需另装 npm 依赖。

## 处理规则

- plan 只读。采用旧 reducer 已确认的身份、范围、生命周期、焦点和当前步骤事实，保留
  task_id、display_id、plan_ref、父子关系及必要文本，不重放实施、测试或 Git。
  每个 Task 一份 JSON，加一份项目状态；旧计划正文保留，历轮完整报告进入外部备份。
  创建／关闭时间仅取身份匹配的明确原生事件；历史计划和生命周期材料的导入日期不冒充这些时间。
  已被 PRODUCT 或父子关系明确引用的计划标记 retained，后续替换候选也不丢失该范围。
- 同一检查目的和环境依因果先后合并，不同环境的失败分别保留。没有明确 execution_ref
  的旧检查不认证当前执行。未知结果和并发冲突为 unknown，保留原标签与来源。
  明确关闭时的 remaining_work 列表优先；更早声明仍保存在对应步骤。
- 保留最新生命周期的交付说明、约束、决定、缺口和历史导入文本。关闭不推导测试通过。
  旧返回检查点保留在 migration 历史字段，需显式建立新检查点，不伪造可自动续接状态。
- 检查 PRODUCT 受管文档及 Task 文本中的实际引用，source_paths 注册不代表全量保留。
  业务文档和 Task Markdown 不改写；被引用旧文件保留原路径、原字节与 SHA。
  引用包／索引时保留完整归档容器，避免半个归档无法读取。
- 旧来源是固定字节的引用依据。Git checkpoint 验证摘要，不要求恢复全部旧因果父记录。
  新任务查询直接读取当前记录，不重放归档事件。
- 在项目外流式生成 tar.gz，逐文件验证路径、大小和 SHA 后才切换。备份包括原过程
  数据、Task 文档、受管业务文档、被引用的现存来源、画像和读取软件等迁移输入，
  不包含完整工程或 Git 对象库。
- 在暂存目录写完全部 Task 与 state.json，整体发布目录后才删除清单内旧过程文件。
  未识别的用户文件及业务文件不清理。只合并 Git 策略，不改变 index、提交或推送。
  原来已跟踪的旧过程文件需按清单另行审阅并显式提交删除。

## 失败与恢复

源文件变化、软件不配套、冻结或策略冲突会在清理前报告。工具在构建时固定五个原生
读取模块的摘要，安装后也按这些摘要检查配套关系，不用模块自身与自身比较冒充校验。
PRODUCT 受管范围无法完整读取、固定引用指向会被替换的缓存、或引用过大而无法保留
时不切换。原来缺失／摘要不符的来源保留缺口，不改写成通过。

任务发布与展示分别报告。手写或不可信 CURRENT_TASK 不覆盖；可返回
`migrated-pending-display`，实际任务仍可读，另行处理展示差异。

切换前失败：旧 journal 仍为事实源，保留已验证备份，按残留重新计划并使用新备份名。
切换后清理失败：响应 migration_published=true，不回滚新任务或重跑业务。任务未变化、
备份仍校验通过时，原 plan 可重试 apply 继续同一清单；成功后重复调用为 already-migrated。

restore 只写入全新的检查目录，拒绝覆盖已有项目。它提供旧历史阅读材料，不覆盖迁移后
的新工作，也不运行业务。提交对象和完整代码仍从原工程 Git／工程备份取得。
