# 完整任务管理：本次验证与交接

## 第一版再次收口审查修复（2026-10-05）

修复再次同代理审查隔离复现的 2 个 P2，范围为原生任务模块、回归测试和 API/产品说明。

- return_result 按有效生命周期、依赖选择与已保存的实际返回效果推导，不再对派生元数据
  生成另一项 RECORD_CONFLICT。内容一致的并发 close 或事后 dependency 保持返回、摘要和
  health 一致；明确选择 satisfied 或 unresolved 后无需第二次选择。后续有序结果仍展示
  当前尝试，真实并发冲突和焦点选择保持可见，原始记录字节不改写。
- 派生依赖去重和返回判断统一比较原任务/原计划/原步骤。旧计划的未解决依赖继续保留，
  不阻止新采纳计划中同名步骤的 prepare 或已有任务 link，也不误报 multiple-dependencies。

新增 7 个行为检查并扩展已有一致并发关闭场景。修复前聚焦检查 **8 fail、0 pass**；
修复后加上上一轮并发回归，聚焦检查 **14 pass、0 fail**。覆盖操作结果、完整视图、摘要、
context、重建、事件数量和原始字节保留。未在产品源码中加入临时调试日志。

最终验证：

- `bun run test:workflow-assistance`：**94 pass、0 fail、1 skip**，其中任务管理 **54 pass**。
  跳过项仍为宿主物理符号链接能力限制，Git index 链接模式另有覆盖。
- `bun run validate:vnext-source` 与 `bun run test:workflow-vnext-source`：通过，源码测试
  **19 pass、0 fail**。
- `bun run validate:protocol`、`bun run validate:freshness`、两个原生模块语法检查及
  `git diff --check`：通过。
- `bun run build:vibe-governance-distribution`：本地构建成功，版本仍为 0.23.8。

未执行 test:workflow-all、发布、Git 提交/推送或业务项目升级。复制安装原生 CLI 的跨进程
回读包含在服务回归中；安装器未修改，本轮未重复安装器测试。原生服务验证不代表模型
对话遵从性验收或 TermLink 已更新。

## 第一版审查修复（2026-10-05）

修复同代理审查中隔离复现的 1 个 P1、2 个 P2。变更限定于原生任务模块、回归测试、
API/产品说明和本记录；不新增入口、审批规则或版本号，不修改目标项目任务数据。

| 审查问题 | 修复与回读 |
| --- | --- |
| 子任务并发 close/resume/pause 或 satisfied/unresolved 仍触发返回 | 按返回边界的因果状态检查子任务生命周期与依赖；矛盾替代保留并抑制返回，显式选择来源可恢复返回；一致替代与返回后的正常变化不误判 |
| 空步骤补关联后整个视图不可读 | 来源步骤沿用既有 obj 归一化；null 步骤的 prepare/link/status/context/query/correct 均可执行，原记录字节保留 |
| 人工返回忽略其他前置问题并显示 ready | 检查父步骤 waiting_on_task_ids，并保留子任务生命周期歧义；人工选择的焦点保持，缺口未解决时不建议 continue-step，解决后可恢复 ready |

新增 8 个行为检查，扩展已有多依赖人工返回场景。先在修复前运行：7 个聚焦检查中
6 fail、1 pass（其中并发根场景及子场景分别计数）；补充选择来源和一致替代后，最终
聚焦检查 9 pass、0 fail。没有在产品源码中添加临时日志。

最终验证：

- `bun run test:workflow-assistance`：**87 pass、0 fail、1 skip**；跳过项仍为宿主物理
  符号链接能力限制，Git index 链接模式另有覆盖。
- `bun run validate:vnext-source` 与源码契约测试：通过，**19 pass、0 fail**。
- `bun run validate:protocol`、`bun run validate:freshness`、原生模块语法检查及
  `git diff --check`：通过。
- `bun run build:vibe-governance-distribution`：本地构建成功，版本仍为 0.23.8；原生 CLI
  的复制安装与跨进程回读包含在服务回归中。本轮未重复分发安装器测试，安装器未修改。

未执行 test:workflow-all、发布、Git 提交/推送或业务项目升级。原生回归不代表模型对话
遵从性验证，也不代表 TermLink 已安装本次更新。

## 派生前置任务与原步骤续接（2026-10-05）

环境：Windows / Node.js v24.12.0 / Bun 1.3.10，当前完整源码仓库及隔离临时项目。
范围：原生任务服务、查询展示、四个 vNext Skill 模板、共享协议、API 和产品设计。
沿用同一事实日志、独立稳定身份及 development_gate=false；没有新增准入内核、版本号
或自动业务执行。单层、每个原步骤一个未收束派生前置任务；超出范围保留提案并报告。

新增 23 个行为检查覆盖：

- 准备/采纳与焦点切换分开；切入时捕获实际工作，而非准备时的旧位置。
- 自动返回保留原步骤执行、finding、审查和处置，不自动 finish 或伪造 PASS。
- 关闭未解决任务、提前/事后记录依赖结果、人工返回及原任务范围/状态变化。
- 用户的新焦点、真实并发工作与显式选择；补登 historical 执行不影响当前返回。
- 已有任务补关联、旧格式已识别步骤及返回后的计划采纳，不重建身份或改写历史。
- 同一关闭/返回事件的幂等重放、缓存重建、投影发布失败后的实时读取与恢复。
- 多依赖/嵌套提案的可见限制，以及复制安装的原生 CLI 跨进程返回和不重复记账。

最终执行结果：

| 检查 | 实际结果 |
| --- | --- |
| `bun run test:workflow-assistance` | 79 pass、0 fail、1 skip；跳过项为宿主无法创建物理符号链接，Git index 链接模式另有覆盖 |
| `bun run validate:vnext-source` 与 `bun test test/workflow-vnext-source.test.ts` | 契约通过；19 pass、0 fail |
| `bun run validate:protocol` | 通过 |
| `bun run gen:workflow-docs` 与 `bun run validate:freshness` | 生成及新鲜度通过；三份参考输出同步换行，无 Git 语义差异 |
| 两个原生模块 `node --check` 与 `git diff --check` | 通过 |
| `bun run build:vibe-governance-distribution` | 本地分发构建成功，版本仍为 0.23.8 |
| 定向 fresh Node install / legacy 与 summary upgrade | 3 pass、0 fail，保留未确认/不可读目标任务 |

未执行 test:workflow-all、Agent 对话遵从性评测、发布、Git 提交/推送或业务项目升级。
测试安装位于隔离夹具；源码和本地分发成功不代表 TermLink 等目标项目已更新。
旧真实任务的派生来源需从实际证据 link/correct，不从粘贴聊天猜历史返回检查点。

## df2815ca 四项缺陷修复验证（2026-09-29）

修复基线：`df2815cabdae80c0d696803d1ec40b22ff94af6b`。
范围为有效事件解释、展示发布、异常锁恢复和操作结果判定；不改变开发准入策略。

在 Windows / Node.js v24.12.0 的隔离临时项目中执行：

```sh
node --test test/vnext-assistance.test.mjs test/vnext-task-management.test.mjs
git diff --check
```

结果：**16 pass、0 fail**，差异格式检查通过。新增及扩展的行为场景包括：

- 冲突已解决后由 A 更正为 B，重建后仍采用 B，原选择与更正记录保留。
- 检查后修改、最终安装前的路径保存均报告展示冲突；旧文件句柄在发布期间和发布后
  写入的内容保留在历史捕获文件中。恢复只尝试创建不存在的路径，不删除竞争者的文件。
- 新锁发布时元数据已完整；陈旧空锁和损坏锁保留原文并通过后继锁恢复，重复重建可用；
  新空锁及仍存活的持有者不被抢占，原生 CLI 并发场景也经过异常锁恢复路径。
- 循环关联、无效审查目标及其后续决定不再报告 association=applied；原始事实仍保存。

保留原有无资格门禁场景。未运行全量 Runtime、test:workflow-all、分发构建、安装升级
或模型交互评测；这些源代码验证不代表业务项目已经部署更新。

## 原始任务管理交付记录

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

只需重建、补登、更正时不运行测试/commit。仅在用户明确要求补登 Git 关联时，从本地 Git
取得实际 SHA 后登记；普通提交不要求补录。处理失败时展示 recorded/association/projection
各自结果和可执行的补充/暂缓选择，不说“全部完成”也不禁用开发。
