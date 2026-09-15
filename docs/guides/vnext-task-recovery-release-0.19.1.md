# vNext 0.19.1：四项 P1 修复与发行验证

## 范围

基于 `85340f79263629a9e62f07c5915ccc7afdff1e0b`（0.19.0），起始工作树干净。只修复本次审查的四项 P1。冻结依据仍为当前 WORKFLOW_PROTOCOL 的 Freeze status，实际修改文件没有冻结 header。P2 活动执行恢复批次互斥问题按用户要求保留，不能据此宣称原实施计划的全部通用能力已完成。

| P1 | 修复与验收 |
| --- | --- |
| 无历史质疑时首次执行恢复崩溃 | 可选 challenge 列表按空集合处理；固定包 CLI 真实完成 S1 后直接确认并执行恢复 |
| 跳过产物回退仍可推进 | Runtime 持久化候选/attempt/preflight 绑定凭据；成功结果及审查完成均核验凭据和精确目标文件；凭据发布在 journal 内 |
| 同一原报告的多个质疑分批卡死 | 经已确认候选和真实纠错结果关联原报告；三批逐项验证，保留原质疑 result ID，剩余项持续阻塞普通推进 |
| 新恢复 ID 重置失败预算 | 沿已确认 execution 及后续步骤替代关系承接问题身份，包括旧 v2 候选；三次真实失败后第四次 preflight 被拒绝 |

## 验证记录

原 0.19.0 固定 tgz 已通过同一组新增反向验收独立复现四个问题（4 fail，均为预期旧行为）。日志保存在发行目录的 `baseline-red.log`。正向历史均由安装后的真实 CLI 完成，没有手改 frontmatter。

| 验证 | 实际结果 |
| --- | --- |
| `bun install`、`gen:all`、`build:vnext-runtime` | 通过 |
| `validate:vnext-source`、`validate:vnext-runtime`、`validate:protocol`、`validate:freshness` | 通过 |
| `test:workflow-vnext-runtime` | 169 pass / 0 fail；包含回退完成凭据发布失败和真实进程退出 |
| `test:workflow-vnext-system-e2e` | 13 pass / 0 fail；包含固定包四个 P1 场景及真实 0.18.7 升级/保护初始化 |
| `test:workflow-distribution` | 19 pass / 0 fail |
| `test:workflow-all` | **573 pass / 0 fail，退出码 0**；上述三个入口由最终聚合实际执行，另含迁移 20 项、bootstrap 11 项 |
| `workflow:health --root .` | 通过 |
| `build:vibe-governance-distribution`、`npm pack` | 通过 |
| `git diff --check` | 通过 |

最终聚合设置 `VNEXT_RECOVERY_TGZ` 为下列固定文件。安装后测试使用真实 `vibe-governance` bin，随后仅调用临时目标内的 `node .workflow-system/runtime/dist/cli.js`。测试后的 137 个 payload 文件与 tgz 逐字节一致。

日志：[完整聚合](../../tmp/releases/0.19.1/workflow-all.log)、[旧包四项反例](../../tmp/releases/0.19.1/baseline-red.log)、[安装后聚焦验证](../../tmp/releases/0.19.1/installed-focused.log)、[源码 Runtime 聚焦验证](../../tmp/releases/0.19.1/runtime-focused.log)。初轮两个新增夹具漏传 `challenge_ids: []`，修正后通过；[初轮失败日志](../../tmp/releases/0.19.1/initial-fixture-failures.log)与[修正复测](../../tmp/releases/0.19.1/fixture-corrected.log)一并保留。没有把失败或未执行项计为通过。

## 固定发行包与实际修改文件

- [vibe-governance-0.19.1.tgz](../../tmp/releases/0.19.1/vibe-governance-0.19.1.tgz)，1,205,761 字节。
- tgz SHA-256：`6a3209e3856800987f362c57cd6abd187df88d6c6b8a0d64d188d8162cc50ebc`。
- 包内两份 Runtime `dist/cli.js` 与工作树一致，SHA-256：`7edca457256ea888d494bf3d4088503d69998f24de29b6684e62c3511d68e910`。
- 原 0.19.0 tgz 未改写，SHA-256 仍为 `10e25435ff7756ae6e15e5739f7c2a52f5bbd3f6d560dcb926b350f42c6dc979`。
- 源提交、平台及摘要见 [release-metadata.json](../../tmp/releases/0.19.1/release-metadata.json)，内部 payload 摘要见 [payload-hashes.json](../../tmp/releases/0.19.1/payload-hashes.json)。
- 实际修改 22 个文件，完整清单见 [source-files.txt](../../tmp/releases/0.19.1/source-files.txt)：Kernel、artifact-checkpoints、恢复协议常量、两份契约、execute-step Skill 源模板、CONTEXT_API、两个既有测试文件、版本/锁文件/Runtime 构建产物、使用及发行文档和重新生成的参考文档。未修改 P2 活动批次互斥逻辑。

## 兼容与部署

软件版本锁步 0.19.1；状态 schema 仍为 1，保护标记 2，候选/确认/承接 v2，checkpoint v1，新增 `artifact-restore-completion/v1`。升级不改旧活动治理字节，不自动补造恢复执行凭据。旧恢复缺少凭据时阻塞成功推进；应保全现场后评估受管恢复，不能删除故障 journal 或回退任务记录。旧候选和执行历史不被改写。

使用本次固定 tgz 安装/升级，禁止 `@latest`。安装步骤及保护初始化见 [使用指南](vnext-task-recovery.md)。恢复后对同一路径做前向修改时，使用后续恢复步骤；回退步骤自身在记录结果和审查完成时必须仍匹配恢复目标。

本次仅在 Windows 上执行，Node v24.12.0、Bun 1.3.10；其他平台的文件锁、rename、中断及安装链仍需各自验证。不支持的远端补偿、二进制/链接/子模块回退、归档任务重开、目标或权限扩张边界不变。

## 真实目标部署后的验收清单

- 核对固定 tgz SHA-256 和安装后 Runtime 版本；先保存升级前治理文件字节，再核对升级未改写它们。
- 按需要显式初始化保护元数据，验证旧正文和 Task Basis 已保全。
- 在已授权任务范围内验证历史结果纠错、原义务去向、剩余质疑阻塞及新审查。
- 需要产物恢复时核对 checkpoint、精确写集、用户漂移、完成凭据和恢复后的实际业务结果。
- 核对失败预算、有效证据承接和最终结项条件；保留 P2 已知限制的记录。

**包注册表：尚未上传。真实目标项目升级与业务验收：本任务不执行，待部署验收。**
