# 给 Luna Max 的实施提示

状态：已实施（2026-09-16）。[PLAN.md](PLAN.md) 保留为本次需求、设计取舍、切片与验收依据；实现前的版本快照仍为 0.19.5 / `64649a75`。

以下正文可直接交给 Luna Max：

---

请在 `E:\coding\vibe-coding-workflow-system` 实施 `docs/designs/user-authorized-scope-amendment/PLAN.md`。

目标是修复用户已明确授权扩充当前修复范围，却仍被 execute-step → prepare-task replan 反复阻塞的流程死路。当前公共 skill 由用户手动调用，不能改成 AI 自动串联。

先阅读根 AGENTS.md、方案与直接相关的 Runtime/契约/skill 模板/测试，检查 FREEZE_REGISTRY 和目标文件冻结标记。不要把本仓库源码修订重新塞入本次待修复的目标项目治理死循环，也不要改 CURRENT_TASK 来伪造实施权限。

按 S0–S4 连续推进，完成已授权范围内必要的实现、测试、契约和生成同步。切片不等于每完成一个都停下来重新请求授权；方案中的文件表是落点导航，不是禁止修改必要辅助文件的名单。

关键设计不能省略：

1. 新增独立、版本化的 scope-amendment 路线，保留旧 correction-replan/v2 的 `permission_change:none`。
2. 允许消费先前明确的用户授权，不要求用户重复同意同一增量；保留原文来源，标为 caller-reported。精确候选回执由 Runtime 生成，不能假装用户先前批准过该 digest。
3. 覆盖 blocked + 已有代码改动 + admitted/in-progress finding；不能要求 finding 先全部关闭或先通过现有 suspend-recovery。
4. 新建延续步骤，保留旧定义、失败、未完成义务、finding、累计审查基线及已用预算；不要照抄旧 replan 的清 pending-review/重置 review-cycle 行为。
5. 接通 begin-repair、fresh preflight、重验、新审查、后续步骤推进与最终关闭。只让 confirm 返回成功不算完成。
6. task-context/adapter/skill 返回的下一步必须可实际受理；用户不需要自己拼 receipt 或理解内部 authority transition。
7. 不修改冻结的 administrative trusted-authority 设计，不实现真人认证、不开放 bootstrap realign、不自动发布或升级真实消费者。

先用隔离夹具证明旧缺陷，再实现并覆盖 PLAN 中 A01–A18，至少包含一个固定 tgz 安装后的 Node CLI 全链路场景。将新增测试接入聚合脚本，完成 gen:all、validate:protocol、validate:freshness、test:workflow-all、workflow:health --root . 与 git diff --check。

如源码与方案有出入，先找保留产品语义的实现方式；只有涉及新的用户决策或实际冻结文件时才报告具体冲突，不把一般实现选择交回用户。工作区可能有其他修改，保留它们。无需并行子代理，也不要创建新的 Codex 任务。

完成后用中文报告：功能闭环、真实测试结果、兼容与 caller-reported 限制、尚存问题，以及用户可直接复制的手动 skill 操作示例。不要声称独立审查 clean；不要 commit、push、publish 或修改真实业务项目。

---

本文件仅交接实施任务。创建它不表示已启动 Luna Max、已授权部署或已改动目标项目。
