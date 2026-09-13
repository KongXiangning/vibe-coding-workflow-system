# 项目文档依据与冲突：兼容及隔离流程验证

日期：2026-09-13。Assurance：**caller-reported**。

本轮通过两个全新隔离项目执行真实公开 Distribution CLI 安装、安装版 bootstrap-support、prepare/confirm、file-context、preflight、实际 Node 命令、record-step-result、review-context/read、record-review-result、complete-reviewed-step。没有调用内部写入函数或手改 CURRENT_TASK/receipt，没有修改真实 TermLink。

| 场景 | 实际操作与结果 |
| --- | --- |
| 普通任务 | REQ/API 均要求 2；读取画像、导航与正文，保存两个来源；正常确认、修改 limit.cjs、实际 node verify.cjs 返回 2 且 exit 0；审查差异与原文后提交 clean，步骤 completed。 |
| 需求变化 | 原需求 2，样本输入将 REQ 改为 3、API 保留 2；未决冲突正常保存，confirm 返回 DRAFT_DECISION_UNRESOLVED。明确的合成场景决定采用 3 并授权同步 API；保留原请求和该决定。改变义务沿用旧 claim 被 CLAIM_EVIDENCE_PLAN_CONFLICT 拒绝，使用新 A2/K2 后正常提交；旧确认凭据被 DRAFT_REVISION_CONFLICT 拒绝。实际实现与 API 同步为 3，Node 检查 exit 0，审查后步骤 completed。 |
| 文档过期 | 在读取之后追加 REQ 澄清；带旧 SHA256 再读返回 CONTEXT_STALE，重新读取返回真实新内容。validate 的任务来源仍保留原 hash，未静默刷新。文本变化不自动意味着矛盾；REQ 改为 3 的语义冲突由模型对照 API 的 2 后明确报告。 |
| 来源缺失 | 将隔离 API 文件移到场景目录保存，公开 file-context 返回非零和 ENOENT；没有把错误当 clean，读取没有写任务。恢复原文件后才继续准备流程。 |
| 历史读取 | 两个正常 bootstrap baseline 均可用 validate --summary 读取，project_documents 为 null。回归另外覆盖旧 semantic 输入没有新字段时继续创建/读取，以及 null 与显式 [] 的区别。未声称覆盖全部旧 workflow-system 格式或完成新的迁移。 |

两个项目的最终状态均是 `workflow_status: active` / `lifecycle_state: active` / `active_step_status: completed`，pending_review_paths 为空。**只验证到步骤完成，没有执行 close/archive，也不是产品发布验收。**需求变化验证发生在草案确认前；已确认任务的 replan 保存/幂等和前置拒绝由现有回归覆盖，本轮没有另做整条实机 supersede/replan 场景。

实际断言以独立字面量 2/3 为 oracle，没有从实现读取预期值。verify.cjs 是隔离场景准备的既有检查；需求变化时在确认前由场景输入调整预期值，实施阶段未创建/修改测试，Persistent Tests 为 none。合成场景中的明确决定只用于本轮隔离验证，不构成任何真实项目授权。审查由当前模型执行，不是独立 reviewer/可信 Provider 认证。

## 生成、分发与回归

- 已执行 gen:all、build:vnext-runtime、build:vibe-governance-distribution。已有源码改动保留，不手改生成物。
- 0.18.0 manifest：`ce611a2ccf8eafb1ae990e997a4ec0887cc0840a30c5b15df637d611fcfae32e`；bundle：`bundle-0ee88f9691ce41165c39f68c`。最终构建摘要与隔离安装一致。
- 两个安装 receipt 各列出 43 份受管软件文件，逐一 SHA256 核验均匹配，包括 Skill 和共享 Runtime 说明。
- vnext-runtime、vnext-context、vnext-daily-semantics、workflow-vnext-source、vnext-lifecycle-e2e 共 **155 pass / 0 fail / 2151 assertions**。
- validate:protocol、validate:freshness、workflow:health --root . 通过。health 是源码仓库现有检查，不代替隔离 vNext 流程结果。未重跑整个 workflow-all。

## 证据与限制

同目录 `DOCUMENT-CONTEXT-VERIFICATION.json` 保存命令索引、退出码、拒绝原因、日志 SHA256、实际 Node 输出、软件校验和最终 summary。完整输入/输出与脚本保留在 JSON 的 raw_evidence_root（系统临时目录，日后可能被清理）。索引保留首次 bootstrap-support 参数顺序错误；修正公开调用语法后继续，没有绕过预检。

Runtime 不自动检查保存的文档 hash 是否仍新鲜、不保证来源存在，也不检测全部语义矛盾。旧 hash 只在调用方带 hash 读取时触发 file-context 保护；任务 summary 可读并不代表文档有效。来源缺失时模型返回阻塞，没有伪造执行失败或持久 Runtime 阻塞。相关语义结论仍是 caller-reported。本轮未升级真实项目，未 commit/push/发布。
