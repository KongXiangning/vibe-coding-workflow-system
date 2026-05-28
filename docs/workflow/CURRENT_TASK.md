# CURRENT_TASK.md

## 任务信息

- 项目：vibe-coding-workflow-system
- 项目类型：ai-engineering-workflow
- 任务 ID：007
- 任务标题：实现 capture-work-item 与 inbox artifact，支持无关新事项记录
- 任务 slug：capture-work-item-inbox
- 当前状态：archived
- 生命周期状态：archived
- 恢复需审查：false
- 恢复审查原因：
- 创建时间：2026-05-28

## 背景与上下文

- 本任务已完成并归档到 `TASKS/TASK-007-capture-work-item-inbox.md`。
- 归档内容保留任务定义、实施摘要、契约 / 决策同步、验证证据、发布后验证字段、remaining observation 与后续建议。
- 下一轮入口：`/create-current-task`。

## 验收标准

- [x] 已新增 `capture-work-item` workflow skill template，并能生成对应 generated skill。
- [x] 已定义 inbox artifact path contract 与最小 schema，路径固定为 `TASKS/inbox/INBOX-<YYYYMMDD>-<short-id>-<slug>.md` 风格，且不会与 archived / paused / interrupted task artifact 混淆。
- [x] `capture-work-item` 只在 `relation_to_current_task = unrelated` 时成功写入 `TASKS/inbox/**`，不会修改当前 `CURRENT_TASK.md` 的任务目标、验收标准、Allowed / Conditional / Forbidden Files、实施步骤、审查问题队列或 active ownership marker。
- [x] `relation_to_current_task = scope_widening_candidate` 时不写 inbox，而是转 `/lock-scope`；`relation_to_current_task = uncertain` 时 fail-closed 到 `ask-user`。
- [x] `handoff.success = create-current-task` 仅保留为 generator-compatible fallback；record-only 成功语义必须通过 `conditional_handoff.capture_only = ask-user` 表达，不得被 guide / registry 解释为 capture 后默认创建任务。
- [x] `capture-work-item` 必须读取 live `CURRENT_TASK.md` 与现有 `TASKS/inbox/**` 做轻量 duplicate read-back；命中 title / slug / evidence 疑似重复时必须 fail-closed 到 `ask-user`，不得静默覆盖或继续写入。
- [x] validator 能拒绝非法 inbox path、缺少 required fields 的 inbox item，以及把 inbox artifact 混入 `TASKS/paused/**`、`TASKS/interrupted/**`、`TASKS/TASK-*.md` 或 `CURRENT_TASK.md` lifecycle state 的情况。
- [x] `capture-work-item` 归入 `阶段 1：需求进入`，但 guide / registry summary 必须把它表达成 record-only branch，而不是 `create-current-task` 主链的一部分。
- [x] 不修改 `create-current-task`、`investigate-root-cause`、`run-regression`、`sync-review-findings`、`scripts/workflow-runtime.ts`、`scripts/task-identity.ts` 或 `test/task-identity.test.ts`；若实现证明必须触碰这些面，立即停止并回 `/lock-scope`。
- [x] 不新增 `CURRENT_TASK.md` lifecycle state；`capture` 与 `backlog_item` 继续不是 lifecycle state。

## 设计约束

- Design mode: none
- Design source: none
- Design acceptance: not applicable
- Design evidence: not applicable
- Design open decisions: none

## 发布后验证

- Release mode: none
- Deploy source: none
- Target environment: local
- Health checks: not applicable beyond repo-local regression matrix
- Canary window: not applicable
- Performance baseline: not applicable
- Rollback / recovery: 回退到 task start base `3ec116de`，撤销任务 `007` 引入的 protocol / schema / validator / template / registry / guide / test / governance diff
- Release evidence: `bun run gen:all`、`bun run test:workflow-all`（209 pass / 0 fail）、`bun run validate:protocol`、`bun run validate:freshness`、`bun run workflow:health --root .` 均通过；详见归档文件。

## 允许修改范围

- 任务已归档；当前无 active task allowed files。

## 禁止修改范围

- 任务已归档；新任务必须通过 `/create-current-task` 重新锁定范围。

## 受影响的契约

- `capture-work-item / TASKS/inbox/** record-only intake` 已同步到 `docs/workflow/CONTRACTS.md`。
- `AD-011` 已同步到 `docs/workflow/DECISIONS.md`。

## 已确认决策

- `capture-work-item` 是 record-only inbox branch，不自动 promote，不自动切换当前任务，不自动创建任务。
- `TASKS/inbox/**` 不进入 lifecycle state、task identity、runtime manifest / install / health report 或 `DOCUMENT_CATALOG.md`。
- 任何 promote / backlog / catalog / runtime 扩展都必须另开任务并重新锁范围。

## 待确认问题

- 无阻断项。
- 可选 follow-up：为合法 inbox path 但缺 required field 的失败路径补直接单测。

## 实现方案

- Goal: 已完成；详见 `TASKS/TASK-007-capture-work-item-inbox.md`。
- Architecture impact: 已同步 protocol / schema / validator / skill template / guide / registry / tests / governance docs。
- Technical approach: 已完成；详见归档。
- Alternatives considered: 已归档。
- Data / state flow: 已归档。
- Compatibility: backward-compatible。
- Risks and rollback: 回退到 task start base `3ec116de`。
- Validation strategy: 已执行并通过全量回归。
- Open decisions: none。

## 审查问题队列

- [minor][test_adequacy] `test/run-validation.test.ts` 尚未直接覆盖“合法 `TASKS/inbox/INBOX-YYYYMMDD-<id>-<slug>.md` 路径但缺少 required field”的失败路径；实现层已拒绝缺字段，当前回归通过。状态：non-blocking observation archived。

## 传播治理记录

### change_start_set

- 对象路径：`TASKS/inbox/INBOX-<YYYYMMDD>-<short-id>-<slug>.md`
- 对象类型：record-only artifact path contract
- 变更起点语义：新增独立 inbox artifact family，用于承载与当前任务无关的新事项记录。

### discovery evidence

- `EvidenceRecord`：
  - mechanism：archived task package
  - query_or_entrypoint：`TASKS/TASK-007-capture-work-item-inbox.md`
  - scope：capture-work-item / inbox artifact / record-only branch
  - result_summary：任务已完成并归档；长期事实已同步到 `STATUS.md`、`CONTRACTS.md`、`DECISIONS.md`、`AGENTS.md`、`CLAUDE.md` 与 `LESSONS.md`。
  - confidence：high
  - gaps：仅保留 non-blocking direct test coverage gap

### aggregation / complexity

- `evidence_diff_threshold`：
  - absolute_diff：3
  - relative_diff_ratio：0.5
- `EvidenceAggregation`：
  - aggregation_strategy：union
  - candidate_impact_set：archived
  - significant_divergence：false
  - divergence_reason：none
  - unresolved_gaps：non-blocking direct test coverage gap
  - aggregated_confidence：high
- `over_limit_policy`：
  - threshold_trigger：none
  - selected_branch：archived
  - rationale：任务已完成并归档，下一轮通过 `/create-current-task` 重新 materialize。
  - direct_consumers_semantics：保护旧入口 / wrapper / compat path
  - total_candidate_consumers_semantics：控制全传播面 / migration window
- `ComplexityAssessment`：
  - propagation_depth：closed
  - direct_consumers：archived
  - total_candidate_consumers：archived
  - cross_boundary_hops：closed
  - exceeded_metrics：none
  - threshold_status：not exceeded
  - forced_strategy：none

### eligibility / candidate / registry

- `MutationEligibilityAssessment`：
  - common.object_path：`capture-work-item / TASKS/inbox/**`
  - common.object_kind：record-only workflow intake
  - common.explicit_contract_state：stable
  - common.discovered_direct_consumers：guide / registry / validator / generated skill
  - common.cross_boundary：false
  - common.critical_path_hit：false
  - common.locked_hit_chain：false
  - common.registry_freshness：fresh
  - common.rationale：任务已完成并归档。
  - when_pending_prerequisites.assessment_status：not applicable
  - when_pending_prerequisites.blocking_gaps：none
  - when_completed.assessment_status：completed
  - when_completed.eligibility：archived
- `implicit_shared_object_detection`：
  - object_path：`TASKS/inbox/**`
  - object_kind：record-only artifact family
  - direct_consumers：validator / capture-work-item / guide / registry
  - cross_boundary：false
  - critical_path_hit：false
  - locked_hit_chain：false
  - proposed_contract_state：stable
  - writeback_required：done
- `RegistryFreshnessReport`：
  - object_path：`capture-work-item`
  - registry_consumers：`docs/workflow/SKILL_REGISTRY.md`
  - discovered_consumers：`templates/skills/capture-work-item.SKILL.md.tmpl`
  - effective_consumers：registry / guide
  - freshness：fresh
  - reconciliation：discovered-union
  - divergence_summary：none
- `EntityMutationChecklist`：
  - entity_name：`capture-work-item`
  - covered_categories：protocol, schema, validator, skill-template, guide, registry, tests, generated-reference, governance-sync
  - unresolved_categories：direct missing-field test coverage
  - gap_resolution：
    - category：test_adequacy
    - handling：non-blocking follow-up candidate
    - blocker_error_code：none
- same-file wrapper / compat decision：
  - stable_source_object：none
  - successor_wrapper_or_compat_object：none
  - preserved_direct_entrypoints：`create-current-task`
  - decision_rationale：capture branch remains record-only and does not replace create chain

### layout / behavior / migration / regression

- `LayoutContract`：
  - container_path：not applicable
  - machine_anchor：not applicable
  - layout_model：not applicable
  - locked_properties：not applicable
  - locked_relations：not applicable
  - cascade_sources：not applicable
  - sibling_reflow_sensitive：not applicable
  - insertion_guard：
    - mode：not applicable
    - protected_siblings：not applicable
  - breakpoint_contracts：not applicable
  - stacking_context：not applicable
  - side_effect_scope：not applicable
- `BehaviorContract`：
  - object_path：`capture-work-item / TASKS/inbox/**`
  - assertions：record-only, no active task pollution, relation gate, duplicate read-back, fail-closed routing, no lifecycle state expansion
  - verification：`bun run gen:all`, `bun run test:workflow-all`, `bun run validate:protocol`, `bun run validate:freshness`, `bun run workflow:health --root .`
- API downstream validation：
  - hook：not applicable
  - store：not applicable
  - page：not applicable
  - widget：not applicable
  - form：not applicable
  - table：not applicable
  - detail view：not applicable
- `migration_plan_requirement`：
  - required：false
  - trigger_reason：backward-compatible record-only branch
- `StagedMigrationPlan`：
  - migration_id：not applicable
  - phases：not applicable
  - runtime_state：not applicable
  - dependencies：not applicable
  - verification：not applicable
  - exit_criteria：not applicable
- `LinkedRegressionRecord`：
  - regression_chain_id：TASK-007
  - current_issue：none
  - prior_fix_refs：none
  - window_scope：task diff
  - window_size：one task
  - count_basis：workflow regression matrix
  - linked_components：protocol, schema, validator, guide, registry, generated skills
  - shared_objects：`CURRENT_TASK.md`, `TASKS/inbox/**`
  - relation：closed
  - escalation：none

### blockers / gate status

- 当前执行步骤：archived
- 已完成 discovery：任务 `007` 已完成并归档。
- 剩余 blocker：none
- `ContractCompatibilityResult`：
  - error_code：none
  - object_path：`capture-work-item / TASKS/inbox/**`
  - severity：none
  - default_blocker_level：none
  - evidence：regression passed
  - strategy_origin.over_limit_policy_branch：archived
  - strategy_origin.divergence_state：none
  - branch_gate_mapping.merge_gate：passed
  - branch_gate_mapping.ship_gate：passed
  - branch_gate_mapping.rationale：local workflow regression matrix passed
  - suggested_resolution：next task should start with `/create-current-task`

### conformance / verification cases

- 输入场景：archived task package
- discovery evidence：`TASKS/TASK-007-capture-work-item-inbox.md`
- 期望 `ContractCompatibilityResult`：none / passed
- 期望 gate / severity / `strategy_origin`：passed / none / archived

## 实施步骤

- [x] 步骤 1：创建并审查任务包。
- [x] 步骤 2：锁定范围、分类决策、制定方案并拆解步骤。
- [x] 步骤 3：完成 protocol / schema、validator、skill template、guide / registry、generated sync 与全量回归。
- [x] 步骤 4：同步 status / contracts / decisions / host guidance / lessons。
- [x] 步骤 5：准备交付摘要并归档。

## 回归检查项

- [x] `bun run gen:all`
- [x] `bun run test:workflow-skills`
- [x] `bun run test:registry`
- [x] `bun run test:workflow-docs`
- [x] `bun test test/run-validation.test.ts`
- [x] `bun run test:workflow-all`
- [x] `bun run validate:protocol`
- [x] `bun run validate:freshness`
- [x] `bun run workflow:health --root .`

## 回滚点

- Task start base：`3ec116de`
- Last reviewed checkpoint：`working-tree`
- Current diff review target：`working-tree`

## 执行记录

- 2026-05-28：任务 `007` 已归档到 `TASKS/TASK-007-capture-work-item-inbox.md`；`CURRENT_TASK.md` 切换为 `archived + archived` terminal tuple。下一轮入口为 `/create-current-task`。
