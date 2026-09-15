# vNext 0.19.2：三项 P1 修复与发行验证

后续审查发现反向交错顺序仍会使中间报告质疑失联，见 [0.19.3 修复报告](vnext-task-recovery-release-0.19.3.md)。本页保留当时实际验证结果。

## 范围与实现

基于 `dbb93f4d6cb7ec74de65f68f8f78425bbc6049e9`（0.19.1），起始工作树干净。冻结依据为当前 WORKFLOW_PROTOCOL 的 Freeze status，实际修改文件没有冻结 header。只处理本次三项 P1，P2 活动执行恢复批次互斥问题按要求保持不变；不宣称原实施计划的全部通用能力已完成。

| P1 | 修复与安装后验收 |
| --- | --- |
| raw apply 绕过恢复失败预算 | 共享 Kernel step-progress 校验要求当前受管 preflight 和精确 attempt；未预检及三次失败后 raw 写入拒绝，已准入失败仍如实记录 |
| 交错质疑导致旧报告目标失联 | 从已确认候选、真实结果和 clean 完成快照建立有界关系；R0 剩余质疑跨 R1、R2 后可继续纠错，原引用不变 |
| 回退后环境重试死锁 | 核验原 v1 完成事实和当前精确目标，生成绑定新尝试的 v2 重核凭据；不重复覆盖文件，仍需新检查和审查 |

三个场景均以真实安装包 CLI 完成历史步骤。回退重试额外验证用户漂移、原凭据缺失、新凭据篡改和幂等重放。没有使用手改 frontmatter 作为正向证据。旧 0.19.1 固定包反例日志保留；初次回退夹具漏传 note，补齐后重新复现，不将夹具错误算作产品反例。

## 验证记录

| 验证 | 实际结果 |
| --- | --- |
| bun install、gen:all、build:vnext-runtime | 通过 |
| validate:vnext-source、validate:vnext-runtime、validate:protocol、validate:freshness | 通过 |
| test:workflow-vnext-runtime | 169 pass / 0 fail，含锁竞争与真实进程中断 |
| test:workflow-vnext-system-e2e | 15 pass / 0 fail，含最终固定包六个恢复场景及 0.18.7 升级保护 |
| test:workflow-distribution | 19 pass / 0 fail |
| test:workflow-all | **575 pass / 0 fail，退出码 0**；实际执行上述入口，另含迁移 20 项与 bootstrap 11 项 |
| workflow:health --root . | 通过 |
| build:vibe-governance-distribution、npm pack | 通过 |
| git diff --check | 通过 |

最终聚合指定 VNEXT_RECOVERY_TGZ 为下述固定文件，恢复场景通过真实 vibe-governance bin 安装，然后只调用临时目标内 node CLI。初轮源码 Runtime 169 pass / 0 fail，安装后聚焦三个场景 3 pass / 0 fail；最终以 [workflow-all.log](../../tmp/releases/0.19.2/workflow-all.log) 为准。

日志保存在 `tmp/releases/0.19.2/`：`baseline-red.log`、`baseline-restore-red.log`、`runtime.log`、`initial-focused.log` 及最终验证日志。初轮聚合因本次编辑将源码契约和 Skill 模板写成 CRLF 而出现 4 项源码测试失败（`initial-crlf-failure.log`）；恢复原 LF 后源码测试 28 pass / 0 fail，并重建包重新执行聚合。初轮包保留在 `initial-crlf/`，不作为交付包。

## 固定包与兼容

固定版本为 0.19.2，不覆盖旧版本 tgz。[vibe-governance-0.19.2.tgz](../../tmp/releases/0.19.2/vibe-governance-0.19.2.tgz)，1,201,494 字节。

- tgz SHA-256：`38ed6575a12c636474a108559e754cae9f7658047ebeffe849baeaa08ea6a639`。
- Runtime dist SHA-256：`fc7a113f0a32053f31ed2b7ff1dbad8a9487cfdfa40c516c1a5322276ed7391b`。
- 137 个 payload 文件逐字节核对，见 [payload-hashes.json](../../tmp/releases/0.19.2/payload-hashes.json)。
- 实际修改 20 个文件，范围为 Kernel、恢复协议常量、两份契约、execute-step 源模板、CONTEXT_API、安装后端到端测试、版本与锁文件、生成参考文档及发行说明。完整清单见 [source-files.txt](../../tmp/releases/0.19.2/source-files.txt)，源提交见 [release-metadata.json](../../tmp/releases/0.19.2/release-metadata.json)。

状态 schema 1、保护标记 2、候选/确认/承接 v2、checkpoint v1 保持不变。直接回退使用 completion v1，新尝试重核使用 completion v2，直接引用可验证的原 v1 对象，避免递归承接。升级不修改旧活动治理字节，不补造执行事实；缺失原事实保持阻塞。旧报告和历史定义不改写。安装与显式保护初始化见 [使用指南](vnext-task-recovery.md)，使用固定 tgz，禁止浮动版本。

仅在 Windows、Node v24.12.0、Bun 1.3.10 执行验证。其他平台仍须分别验证文件锁、rename、中断恢复和安装链。远端补偿、未经验证的二进制/链接/子模块回退、归档重开、目标及权限扩张仍不支持。

## 真实目标部署后验收

- 核对 tgz 摘要及安装后版本，保存并比较升级前后治理字节。
- 按需显式初始化保护，确认原 Task/Basis 正文已保全。
- 在原授权范围内验证多轮质疑、剩余目标阻塞、原义务和真实审查。
- 核对恢复 checkpoint、精确写集、用户漂移、环境重试的新凭据和实际业务结果。
- 验证累计失败预算及结项条件，记录 P2 已知限制。

**包注册表：尚未上传。真实目标项目升级与业务验收：本任务不执行，待部署验收。**
