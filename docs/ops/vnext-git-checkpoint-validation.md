# vNext Git 检查点收口：实现与验证

基线：`c74828bdcfc4c12dbdd57ee658404cf7f79e14c7`。保留改造一的精简查询与改造二的因果内存优化。

## 用户体验与实施范围

普通任务/阶段提交由 **一次 git-commit Skill 调用**完成：读取实际授权和项目约定，
生成提交清单，完成已授权的精确配置/暂存，核对索引，执行 Git commit，再只读核对实际提交。
不新增需要用户调用的 archive/checkpoint Skill，不要求逐个确认生成文件，不登记提交自身 SHA。
实际已有范围冲突、项目自定义存储约定或部分暂存问题，仍须一次明确选择，不能自行扩大范围。

新增原生命令 `assistance.mjs git-checkpoint`，动作是 plan、verify-index、verify-commit。
命令本身只读，不执行 git add/commit/rm、不改配置、不写任务日志、缓存或展示。
Skill 按 API 中的操作说明执行正常 Git 写入；helper 的清单不是权限凭证或流程准入条件。
未引入新安装模块、数据库、依赖或持久化索引；仍由已有两个原生模块分发。

`mode=checkpoint` 默认选择项目级记录，避免仅按 task_id 遗漏跨任务因果引用或附件。
明确的 paths-only/staged-only 指令、exclude_paths 和已有 local-only 约定优先。
业务文件范围只来自 business_paths，不能借记录保存收进其他任务的业务改动。
暂存前检查真实 hunks；helper 验证的是记录字节和 Git 路径范围，不认证业务实现或用户意图。

## 保存策略

- events、attachments、evidence-objects、task-labels、旧 baseline/current 为持久事实。
- 当前版本保守地保存旧 display/display-capture 为恢复材料；不删除原文件，不承诺其未来写入
  已被 Git 备份。它们有独立分类计数，不冒充新的任务事实。本次不是恢复生命周期/磁盘回收改造。
- task-view.json、task-views、锁和临时文件按本地派生数据处理。只建议 scoped ignore，不删文件。
- CURRENT_TASK 只有带生成标记且与其保存视图逐字节相符，才进入默认忽略/显式取消跟踪方案。
  有人工修改、缺少比对视图或已有 staged 内容时，保留并报告，不静默隐藏。
- 未识别文件和现有忽略规则单独报告；没有 blanket add、force-add、自动归档或整目录删除。

plan 提议在 records/.gitignore、records/.gitattributes 追加带标记的小范围规则，必要时在
workflow_home/.gitignore 追加 CURRENT_TASK 规则。原有字节、换行和自定义内容保留。
修改过的 managed block、冻结文件与现有过滤/编码约定需核对，不能直接覆盖。
这些是目标项目自身数据配置，由第一次已授权检查点建立，不作为安装器可以覆盖的 Runtime 资产。
配置修改后重新生成清单，配置与业务/记录在同一次 Git commit 保存；不是另做一个配置提交。
取消跟踪仅通过明确 untrack_paths 的 `git rm --cached`，不删本地文件，也不使用 -f。

清单及核对结果只放操作系统临时目录，不能放进 records，避免新增“记录检查点的检查点”。
内容寻址数据使用 -text/-filter/-ident/-working-tree-encoding，核对暂存区实际 Git OID 与
原始字节构造的 OID。支持 Git SHA-1/SHA-256。不调用可能运行外部内容过滤器的 hash-object --path。
verify-index 返回整个索引树的内容指纹；verify-commit 将实际提交与它比较，能发现 hook/并发
暂存改动造成的差异。提交后不 auto-amend/reset/retry；以真实 SHA 报告结果和剩余项。

快照是规划时已观察到的文件集合，不是覆盖正在运行写入者的事务快照。规划后新出现的记录、
捕获文件的延迟写入、用户排除项保留并报告，留待后续授权检查点，不循环追赶到工作区零变动。
JSON/摘要损坏、已缺失附件及未关联记录保持原文。检查已保存字节与检查业务/历史资格分开：
已有证据缺口不阻止备份现有字节，也不能被备份成功改写为 PASS。

## 源码范围

1. runtime/vnext/support/assistance.mjs：只读的分类/配置建议/清单与实际索引、提交核对。
2. templates/vnext/skills/git-commit.SKILL.md.tmpl：同一入口的内部编排，保留精确授权与防递归。
3. templates/vnext/bootstrap/WORKFLOW_PROTOCOL.md：通用 Git checkpoint policy。
4. ASSISTANCE_API.md、TASK_MANAGEMENT_API.md：契约、兼容与操作说明。
5. test/vnext-git-checkpoint.test.mjs 与 package.json：加入定向行为回归入口。
6. 本文：范围、实测和交付限制。

没有修改 task-management.mjs、记录/证据格式、因果语义、CURRENT_TASK 发布算法、其他 Skill、
目标项目安装文件或真实任务状态。没有版本号变更、发布、部署或 main 分支修改。

## 已执行验证

环境：Linux x64，Node.js v22.16.0、Git 2.47.3。直接网络 clone 因 DNS 不可用；使用现有
交付源码副本与 GitHub 文件读取，并按指定基线的 Git blob SHA 验证所需原文件。
不是完整仓库 clone，没有因缺少完整源码而猜造安装/构建成功。

```sh
node --check runtime/vnext/support/assistance.mjs
node --check test/vnext-git-checkpoint.test.mjs
node --test test/vnext-assistance.test.mjs test/vnext-task-management.test.mjs test/vnext-git-checkpoint.test.mjs
```

结果：**42 项通过，0 失败**。原有 27 项全部保留，新增 15 项独立行为场景，覆盖：

- 项目级事件/附件/证据/恢复材料在一次 Git commit 中保存，跨任务记录不漏，其他业务文件不带入；
- 规划和核对不写磁盘/索引/日志；重复检查没有新管理事实或递归提交；
- paths-only、明确排除、已有忽略、特殊文件名、无关暂存及部分暂存保持；
- 字节级索引缺漏、CRLF 转换、危险属性、原始数据损坏及缺失引用分别如实报告；
- 新记录和旧句柄延迟写入保持可见；工作源变化及已核对索引之后的提交树变化被检测；
- 显式取消跟踪保留原文件；人工展示改动、staged 展示、自定义策略、冻结及不安全路径不被清理；
- 空 HEAD、SHA-256 Git 仓库，以及两个原生模块复制到安装布局后可直接执行；
- 真正 clone/checkout 往返后，CRLF 原始对象仍逐字节一致，任务事实可重建。

这些是确定性 helper 和按 Skill 契约编排的 Git 集成测试，不是对任意模型必然遵守 Skill 的保证。
未对标题或文案新增字符串测试；未运行目标项目业务测试。

## 用户上传记录的隔离验证

使用 records.zip 和 CURRENT_TASK 的副本，在一个新建的合成 Git 仓库中执行完整检查点流程。
没有目标项目原 .git、Git 属性或业务未提交文件，不能声称已经验证或清理其实际工作区。

| 原始 records 分类 | 文件数 | 结果 |
| --- | ---: | --- |
| 持久事实（包含两个旧基线文件） | 426 | 同一个检查点提交，保留原文 |
| 旧 display / display-capture 恢复材料 | 410 | 同一个检查点提交，原文件不删除 |
| 可重建视图与缓存 | 206 | 本地保留，忽略后不进入本次提交 |
| 合计 | 1042 | 原始文件内容、mtime 均未改变 |

额外有三个精确策略配置文件纳入同一次提交；已跟踪的生成 CURRENT_TASK 从索引移除但保留
本地原文件。因此清单保存 839 个文件，取消跟踪 1 个，只有 1 次新的 Git commit。
原始 1043 个样本文件（含 CURRENT_TASK）的 SHA-256 和 mtime 全部保持。
合成工作区状态干净，重复 plan 的 add_paths 和 configuration 都为空。
clone 后已保存记录逐字节一致；5 个任务、7 项问题、7 项未关联记录及 null 工作焦点保持，
source_revision/view_revision 一致。原有问题没有被备份成功消除。
没有把用户原始文件、任务标题、证据对象或原始计划清单加入源码仓库。

## 集成与仍未处理的事项

完整参数和同一 Skill 内的步骤在 ASSISTANCE_API。日常用户继续调用 git-commit，无需手动
构造 helper JSON。一次 invocation 内可以有多次内部命令，不等于只有一个系统调用。
初次遇到真实策略冲突时可能仍需一次确认；已确定的默认约定不重复询问。

在完整源码仓库重建分发清单并按既有方式安装/升级，才会使目标项目使用新 Skill、协议和
assistance.mjs。原有分发清单已收录这些路径，因此没有新模块漏装问题；本次没有跑完整
分发构建/正式安装事务，也没有执行完整类型检查、完整工作流套件或独立审查者复审。

```sh
bun run test:workflow-assistance
bun run build:vnext-runtime
bun run build:vibe-governance-distribution
```

以上 Bun 命令是后续完整环境集成步骤，不是本次已经执行的命令。

仍未处理：展示副本持续生成、旧恢复文件安全回收、read 的双表示、find 的大游标、全量扫描
成本、外部证据存储及远端备份策略。保存 Git 检查点不授予 push，也不能代替异机备份。
本次解决的是**授权提交时持久记录的遗漏与范围/字节核对**，不是提交后清空 records。
