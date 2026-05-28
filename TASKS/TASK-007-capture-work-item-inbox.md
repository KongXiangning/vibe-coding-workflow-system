# TASK-007-capture-work-item-inbox

## 任务元数据

- 项目：vibe-coding-workflow-system
- 项目类型：ai-engineering-workflow
- 任务 ID：007
- 任务标题：实现 capture-work-item 与 inbox artifact，支持无关新事项记录
- 任务 slug：capture-work-item-inbox
- 开始时间：2026-05-28
- 结束时间：2026-05-28
- 最终状态：done / regression-passed / archived

## 原始任务包快照

- 来源草案：`docs/workflow/NEXT_TASK_DRAFT_007_CAPTURE_WORK_ITEM_INBOX.md`
- 目标：为 workflow-system 增加 `capture-work-item` record-only 入口和 `TASKS/inbox/**` artifact contract，使与当前任务无关的新事项可以被审计记录，而不污染当前 active task、lifecycle state、task identity、runtime routing 或 create chain。
- 关键验收：
  - 新增 `capture-work-item` workflow skill template，并生成对应 reference skill。
  - 定义 `TASKS/inbox/INBOX-<YYYYMMDD>-<short-id>-<slug>.md` path contract 与最小 schema。
  - `relation_to_current_task = unrelated` 时只写 `TASKS/inbox/**`，不得修改当前任务目标、验收、范围、实施步骤、审查队列或 active ownership marker。
  - `scope_widening_candidate` 转 `/lock-scope`；`uncertain` fail-closed 到 `ask-user`。
  - `handoff.success = create-current-task` 仅保留 generator-compatible fallback；record-only 成功语义通过 `conditional_handoff.capture_only = ask-user` 表达。
  - duplicate read-back 必须读取 live `CURRENT_TASK.md` 与现有 `TASKS/inbox/**`，疑似重复时 fail-closed。
  - validator 拒绝非法 inbox path、缺 required fields、inbox 混入 archived / paused / interrupted task artifact 或 lifecycle state 污染。
  - guide / registry 把 `capture-work-item` 表达为 `阶段 1：需求进入` 的 record-only branch，而不是 create-current-task 主链。
  - 不修改既有 create / root-cause / regression / review-finding skill、runtime、task identity 或 lifecycle state。

## 实际改动摘要

- Protocol / schema:
  - 更新 `.workflow-system/WORKFLOW_PROTOCOL.md` 与 `.workflow-system/FILE_SCHEMAS.md`，声明 inbox artifact family、最小字段、record-only 语义、stage-1 guide / registry 暴露约束，以及 `capture` / `backlog_item` / `inbox_item` 不属于 lifecycle state。
- Validation:
  - 更新 `scripts/workflow-doc-contracts.ts`，补入 inbox artifact path parser / validator 与 capture guide snippet 校验。
  - 更新 `scripts/run-validation.ts`，扫描 `TASKS/inbox/**`，拒绝 stray path、缺 required fields、archive / suspended artifact 混淆和 live lifecycle pollution。
  - 更新 `test/run-validation.test.ts`，覆盖非法路径、stray inbox、archive 混入、lifecycle pollution 与 guide contract。
- Skill / guide / registry:
  - 新增 `templates/skills/capture-work-item.SKILL.md.tmpl`，锁定 reads / writes / forbidden_writes、relation gate、duplicate read-back、fail-closed handoff 与 `conditional_handoff.capture_only = ask-user`。
  - 更新 `templates/docs/WORKFLOW_GUIDE.md.tmpl`，加入 `/capture-work-item` record-only branch 入口。
  - 更新 `scripts/gen-registry.ts`，将 `capture-work-item` 插入 `WORKFLOW_ORDER`，并让 `阶段 1：需求进入` summary 区分 main chain 与 record-only branch。
  - 通过 `bun run gen:all` 同步 `docs/workflow/generated/workflow-skills/capture-work-item.SKILL.md`、`docs/workflow/generated/workflow-docs/WORKFLOW_GUIDE.md` 与 `docs/workflow/SKILL_REGISTRY.md`。
- Tests:
  - 更新 `test/gen-workflow-skills.test.ts`、`test/gen-workflow-docs.test.ts`、`test/gen-registry.test.ts` 与 `test/run-validation.test.ts`，覆盖新增 skill、guide、registry 与 validator 合约。
- Governance sync:
  - `docs/workflow/CURRENT_TASK.md` 同步验收、步骤、回归与审查事实，并在归档时切换为 archived 态。
  - `docs/workflow/STATUS.md` 写入任务 `007` 的稳定能力、风险与下一检查点。
  - `docs/workflow/CONTRACTS.md` 新增 `capture-work-item / TASKS/inbox/** record-only intake` 行为契约。
  - `docs/workflow/DECISIONS.md` 新增 `AD-011`，确认 capture-work-item 作为 record-only inbox branch，不自动进入任务主链。
  - `AGENTS.md` 与 `CLAUDE.md` 同步 record-only inbox host guidance 与 expansion guard。
  - `docs/workflow/LESSONS.md` 记录验收 checkbox 必须由 regression evidence 驱动的经验。

## 契约与决策记录

- 受影响契约：
  - `CURRENT_TASK lifecycle / suspended package foundation`
  - `workflow governance artifact validation contract`
  - `WORKFLOW_GUIDE` / `SKILL_REGISTRY` stage-1 routing contract
  - `capture-work-item / TASKS/inbox/** record-only intake`
- 新增或更新决策：
  - `AD-011`: `capture-work-item` 作为 record-only inbox branch，不自动进入任务主链。
- 保持不变的关键边界：
  - `capture`、`backlog_item`、`inbox_item` 继续不是 `CURRENT_TASK` lifecycle state。
  - `TASKS/inbox/**` 不进入 task identity、runtime lifecycle、paused / interrupted package、archive task artifact 或 `DOCUMENT_CATALOG.md`。
  - 不新增 promote、prioritization、backlog grooming、runtime manifest / install / health report 语义。
  - `create-current-task` 主链不因 capture 成功而自动触发。
  - generated reference outputs 与 `SKILL_REGISTRY.md` 只能由生成器同步。

## 验证与交付证据

- 审查范围：
  - `working-tree`
- 测试 / 验证：
  - `bun run gen:all` 通过。
  - `bun run test:workflow-skills` 通过，28 pass / 0 fail。
  - `bun run test:workflow-docs` 通过，24 pass / 0 fail。
  - `bun run test:registry` 通过，12 pass / 0 fail。
  - `bun test test/run-validation.test.ts` 通过，30 pass / 0 fail。
  - `bun run test:workflow-all` 通过，209 pass / 0 fail。
  - `bun run validate:protocol` 通过。
  - `bun run validate:freshness` 通过。
  - `bun run workflow:health --root .` 通过。
- review / QA：
  - `/review-diff` 结论为 clean，未发现 scope drift、decision drift 或非预期 generated diff。
  - `/review-implementation step11` 未发现 major / critical 问题。
  - `/verify-contracts` 未发现 locked contract violation。
  - `/run-regression` 结论为 pass，并据此完成 10 条验收标准勾选。
- 交付摘要：
  - 任务目标：已完成。
  - 是否越界修改：否。
  - 是否触碰稳定契约：是，已同步 `CONTRACTS.md` 与 `DECISIONS.md`。
  - Release mode：none。
  - Deploy source：none。
  - Target environment：local。
  - Health checks：not applicable beyond repo-local regression matrix。
  - Canary window：not applicable。
  - Performance baseline：not applicable。
  - Rollback / recovery：回退到 task start base `3ec116de`，撤销本任务引入的 protocol / schema / validator / template / registry / guide / test / governance diff。
  - Release evidence：local command output 已写入 `docs/workflow/CURRENT_TASK.md`、`docs/workflow/STATUS.md`、`docs/workflow/CONTRACTS.md` 与 `docs/workflow/DECISIONS.md`。
  - canary result：not applicable。
  - performance baseline result：not applicable。
  - rollback status：not triggered。
  - remaining observation：`test/run-validation.test.ts` 尚未直接覆盖“合法 inbox path 但缺 required field”的失败路径；实现层已在 `validateInboxArtifactPackage()` 中拒绝缺字段，当前全量回归通过。后续可用小型测试补齐覆盖精度。

## Lessons 回写

- 本任务新增经验：
  - Acceptance checkboxes need regression evidence before task closure。
- 任务过程中复用的既有经验：
  - Workflow rule changes must close the propagation chain。
  - Template changes require freshness closure after generated outputs move。
  - Generated reference outputs must be reviewed as generated-only evidence。

## 后续关联

- 后续任务：
  - 如需继续推进 promote、prioritization、backlog triage、`DOCUMENT_CATALOG.md` 收录、task identity 感知、runtime manifest / install / health report 或 lifecycle state 扩面，必须单独开任务并重新 `/lock-scope`。
  - 可选 follow-up：补一条合法 inbox path 但缺 required field 的 direct validator test，收敛当前 non-blocking coverage gap。
  - 下一轮入口：`/create-current-task`。
- 相关 issue / PR：无。
- 归档位置：`TASKS/TASK-007-capture-work-item-inbox.md`
