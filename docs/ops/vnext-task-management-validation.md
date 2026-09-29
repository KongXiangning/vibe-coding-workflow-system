# 完整任务管理：本次验证与交接

基线：`da0c3c211749b7349983ec0b41b360b65e0d1573`（0.23.2）。
设计依据：`docs/product/vnext-task-management.md`。本次修任务管理，不恢复流程审批，
不修改 TermLink、LawAgent 或 fixflow 的业务代码/任务数据，不发布版本。

## 实际修改

- 原生 assistance 入口新增 task / task-status；context 复用同一实时任务视图。
- 新 task-management.mjs 覆盖身份/编号、候选计划、采纳、执行/测试、审查、用户处置、
  步骤进度、真实 Git 对象关联、关闭/暂停/恢复/焦点，以及 link/correct/resolve/defer/rebuild。
- 正常任务操作尝试维护视图和 CURRENT_TASK；保存、关联、展示分别报告。
- 全日志重建不执行任何业务动作；旧 CURRENT_TASK 首次更新前留完整快照；用户后来编辑
  展示时默认不覆盖。历史原文、失败、审查和用户决定不改写。
- 11 个 Skill、协议、API、宿主指引统一要求查询实时视图，不从一页 find 或旧 tuple 猜状态。
- CLI 源码把普通 task-context 接到统一查询；--legacy 显式保留历史接口。分发清单加入新
  原生模块与接口文档。旧 dist 没有手工修改，必须在完整仓库重建。
- 5 个高价值集成场景新增到 test/vnext-task-management.test.mjs。原 6 项服务用例保留，
  其中复制安装目录的夹具补拷新依赖。test:workflow-assistance 包含这两个文件。

## 本轮实际执行

环境：Node.js v22.16.0，Linux 隔离临时项目，含本地临时 Git 仓库；非 Android/业务项目。
参考树不是完整当前仓库检出；本次修改的已有源码逐个核对当前 GitHub 基线 SHA。
未纳入本次变更的旧参考文件没有作为提交内容，也不用于声称全仓库通过。

```sh
node --check runtime/vnext/support/assistance.mjs
node --check runtime/vnext/support/task-management.mjs
node --test test/vnext-assistance.test.mjs test/vnext-task-management.test.mjs
git diff --check
```

**11 pass、0 fail**：6 个现有服务场景 + 5 个任务管理场景。

| 集成场景 | 已观察行为 |
| --- | --- |
| Task004 → Task005 完整链 | 关闭后移出焦点；新任务编号/身份稳定；draft review 不采纳；adopt 关联计划；失败执行、审查 findings、用户接受、步骤结束和真实 commit 分别可查；关闭不伪造通过；迟到报告/幂等采纳不复活任务 |
| 事实成功但视图写入失败 | 即时查询仍读取新事实而不是旧缓存；恢复缓存后 rebuild 不重放业务；用户展示编辑被保护，显式替换前保留快照 |
| 补齐已有计划与确认 | 无编号计划、既有审查与用户确认用 link 关联；旧字节不变，不重复 prepare/review/confirm；错误目标/不存在的冲突不能被报成关联完成 |
| 真实因果冲突与更正 | 并发采纳保留两个候选；defer 不等于 resolved；resolve 落实选择；更正错关联不改原报告；跨任务 review 不成为有效关联 |
| 安装位置原生 CLI / 并发 | 两个 .mjs 复制到安装位置后无需 kernel/npm 运行；同时创建不会复用显示编号；并发同请求采纳只保留一份语义操作 |

另以 TypeScript parser 检查 cli.ts、host-guidance.ts 和 build-vibe-governance-distribution.ts，
均无语法诊断。这不是项目类型检查或编译。11 个 Skill YAML 元数据与当前基线相同，
协议 YAML 可解析。没有新增入口/mode/审批字段，没有文案快照用例。

## 明确尚未执行

未运行 Bun source validator/测试、完整类型检查、完整 Runtime 构建、真实 tgz 分发安装/
升级、整个 Runtime 测试组、test:workflow-all、Agent 对话遵从性测试或真实业务记录迁移。
原生 CLI 的复制安装场景不能称为完整 npm 安装验收。未评测超大历史库全扫描耗时。

源码落库后，需要在完整源码仓库使用原构建流程生成 dist 和分发内容；当前源文件修改
不代表目标项目安装的旧 CLI/Skill 已经更新。限定验证可以采用：

```sh
bun run test:workflow-assistance
bun run validate:vnext-source
bun test test/workflow-vnext-source.test.ts
bun run build:vnext-runtime
bun run build:vibe-governance-distribution
git diff --check
```

安装验证只选现有 fresh install / upgrade 的相关场景，不自动转入全部分发或 Runtime 回归。
失败先判断接入错误、旧语义预期或环境问题；不能为旧 tuple/文案断言恢复开发门禁。

## 恢复用户已有的任务记录

由 Agent 读取目标项目的实际旧 CURRENT_TASK 和 records，不从聊天复述猜 record 内容。
先 task-status 看已识别/未关联事项。Task004 的明确关闭记录可自动识别；自由文本缺失
state/task_ref 时用 link 补充其实际含义。新 App 计划用既有计划 ref 导入稳定身份及编号，
再将已有草案审查和真正的确认记录关联到准确 plan_ref；不重跑业务、不重新索要已作决定。

如果只有一项归属/条件有歧义，只问这项。执行 rebuild 后回读：004 closed、新任务的
adopted_plan_ref 与原确认记录相符、current_step_id 及环境信息来自已采纳计划、未执行仍
未执行、旧失败仍保留。编号是否为005以实际已占用编号为准，不预先伪造。

只需重建、补登、更正时不运行测试/commit。若真实 Git 已提交但记录缺失，从本地 Git
取得实际 SHA 后登记，不能重新 commit。处理失败时展示 recorded/association/projection
各自结果和可执行的补充/暂缓选择，不说“全部完成”也不禁用开发。
