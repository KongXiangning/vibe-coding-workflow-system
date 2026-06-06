# INBOX-20260601-6a9f-methodology-gap-business-shapes

- artifact_kind: inbox_item
- item_id: 20260601-6a9f
- title: 对照 methodology 进一步补齐未完整迁移的一等业务形态
- type: idea
- source: review
- captured_at: 2026-06-01T01:36:09+08:00
- relation_to_current_task: unrelated
- current_task_id: 008
- description: |
    基于对 `vibe-coding/vibe-coding-methodology.md` 的补读，记录一条后续可分流评估的事项：
    当前 workflow-system 虽已覆盖单活 `CURRENT_TASK` 驱动的通用研发链，但若严格以 methodology 为基准，仍有一组“方法论明确存在、当前系统未完整迁移或明显简化”的一等业务形态值得后续单独 triage。

    当前优先记录的形态包括：
    1. 前置需求澄清流（如 `/office-hours`）。
    2. 完整规划编排流（如 `/plan-ceo-review`、`/plan-eng-review`、`/plan-design-review`、`/autoplan`）。
    3. 设计评审流（UI / UX / 可访问性 / 响应式专项评审）。
    4. 正式 ship 交付流（版本、changelog、PR/MR body、shipping gate）。
    5. 发布后文档同步流（`document-release`）。
    6. retro / learn 闭环。
    7. 多 agent 并行冲刺、浏览器 QA、完整 release orchestration。

    该事项与当前 live task `008` 无直接实现关系；任务 `008` 聚焦的是为既有 `003-007` 分支补齐高层方法论文档叙事，而不是继续扩展新的 workflow-system 业务流。
- evidence: |
    - `vibe-coding/vibe-coding-methodology.md:98-114` 明确写出当前 workflow-system 没有完整迁移多 agent 并行冲刺、复杂浏览器 QA 和完整 release orchestration。
    - `vibe-coding/vibe-coding-methodology.md:2092-2301` 保留了 `/office-hours`、规划 review 链、`Ship`、`document-release` 等方法论链路。
    - `templates/skills/` 当前 skill 清单聚焦通用 current-task 主链，缺少与上述方法论链路一一对应的独立 workflow skill。
    - `docs/workflow/CURRENT_TASK.md:7-10` 显示当前 active task 为 `008 / methodology-docs-cover-003-007-skill-branches`，与本事项的后续产品化/迁移评估不属同一执行范围。
- suggested_next_action: triage_later
- status: captured
