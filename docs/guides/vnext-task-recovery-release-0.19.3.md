# vNext 0.19.3：交错质疑承接修复

## 范围与实现

基于 `fcf45181ae14293070ed1f659b0afcc77152d890`（0.19.2），起始工作树干净。冻结依据为 WORKFLOW_PROTOCOL 当前 Freeze status，修改文件无冻结 header。只修复四项 P1 中多质疑处理顺序的残留，P2 保持不变。

R0 有质疑 a、b；处理 a 得到 R1，随后新增针对 R1 的 c；先处理 b 得到 R2，再处理 c，旧实现因缺少 R1→R2 关系而阻塞。现实现从已校验的候选来源历史正文提取实际被替换的报告，并结合真实执行结果和 clean 完成快照建立关系；原质疑身份与报告均不改写，不接受调用者自填关系。

## 验证

初轮源码 Runtime 169 pass / 0 fail；两种交错顺序安装后 2 pass / 0 fail；补充历史缺失和篡改的反向交错场景 1 pass / 0 fail。原 0.19.2 固定包同一顺序失败，保留 [baseline-red.log](../../tmp/releases/0.19.3/baseline-red.log)。

两种交错顺序均由真实 CLI 完成历史步骤。历史来源缺失或正文篡改时无现行治理写入地拒绝；恢复原字节后完成合法链。直接篡改仅用于负向拒绝测试。

最终聚合指定 VNEXT_RECOVERY_TGZ 为本次固定包；恢复场景经真实 vibe-governance bin 安装后，仅调用临时目标内 Node CLI。完整聚合 **576 pass / 0 fail，退出码 0**，见 [workflow-all.log](../../tmp/releases/0.19.3/workflow-all.log)。

| 验证入口 | 实际结果 |
| --- | --- |
| bun install、gen:all、build:vnext-runtime | 通过 |
| validate:vnext-source、validate:vnext-runtime、validate:protocol、validate:freshness | 通过 |
| test:workflow-vnext-runtime | 169 pass / 0 fail |
| test:workflow-vnext-system-e2e | 16 pass / 0 fail；最终固定包七个恢复场景与 0.18.7 升级保护 |
| test:workflow-distribution | 19 pass / 0 fail |
| test:workflow-all | 576 pass / 0 fail；包括上述入口及迁移 20 项、bootstrap 11 项 |
| workflow:health --root . | 通过 |
| build:vibe-governance-distribution、npm pack、git diff --check | 通过 |

## 发行与兼容

固定版本 0.19.3，不覆盖旧发行包。[固定 tgz](../../tmp/releases/0.19.3/vibe-governance-0.19.3.tgz)，1,202,346 字节。

- tgz SHA-256：`49bf2a922e85f7aca81a3fd57f632867ff26670959011b730f2ee11bdedb90f1`。
- Runtime dist SHA-256：`c34bac824be66f040bfc115f9bf96773d715713e715331ee5f016a26a98c53e2`。
- 137 个 payload 文件逐字节核验，见 [payload-hashes.json](../../tmp/releases/0.19.3/payload-hashes.json)。
- 实际修改 18 个文件，见 [source-files.txt](../../tmp/releases/0.19.3/source-files.txt)：Kernel、两份契约、CONTEXT_API、安装后测试、版本/锁文件、Runtime 构建、生成参考文档和使用/发行说明。
- 源提交见 [release-metadata.json](../../tmp/releases/0.19.3/release-metadata.json)。

状态与恢复协议版本不变，使用既有不可变历史包建立关系，不迁移或重写旧治理数据。候选来源缺失、身份或摘要不匹配时拒绝承接。

安装及显式保护初始化见 [使用指南](vnext-task-recovery.md)。升级使用固定 tgz，核对包与安装后 Runtime 版本，保存并比较治理文件字节；不使用浮动版本，不回退 Task 历史。

本次只在 Windows、Node v24.12.0、Bun 1.3.10 验证；其他平台的文件锁、rename、中断和安装链仍需各自验证。远端补偿、不可验证二进制/链接/子模块回退、归档任务重开及权限扩张仍不支持。P2 未修复，不宣称完整通用恢复计划全部完成。

## 目标部署后验收

- 核对固定包 SHA、Runtime 版本和升级前后治理字节。
- 在原授权任务内验证两种交错质疑顺序、原报告身份和未解决项阻塞。
- 核对实际业务结论、新审查、原验收义务、失败预算及最终结项。
- 产物恢复时另核对 checkpoint、精确写集、用户漂移与新尝试凭据。

**包注册表：尚未上传。真实目标项目：本任务不操作，待部署验收。**
