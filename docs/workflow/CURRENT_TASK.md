# CURRENT_TASK.md

## 任务信息

- 项目：vibe-coding-workflow-system
- 项目类型：ai-engineering-workflow
- 任务 ID：007
- 任务标题：实现 capture-work-item 与 inbox artifact，支持无关新事项记录
- 任务 slug：capture-work-item-inbox
- 当前状态：draft
- 生命周期状态：active
- 恢复需审查：false
- 恢复审查原因：
- 创建时间：2026-05-27

## 背景与上下文

- 任务 `006` 已完成归档，归档文件为 `TASKS/TASK-006-target-root-guard.md`；当前任务 `007` 由用户明确要求从 `docs/workflow/NEXT_TASK_DRAFT_007_CAPTURE_WORK_ITEM_INBOX.md` materialize 为新的 live task。
- 本任务承接任务 `003` 原始拆分里被明确 deferred 的 inbox / backlog artifact 能力，但当前范围只做 **record-only capture**，不实现 promote、prioritization 或 backlog grooming。
- 现有稳定契约已明确：`capture` 与 `backlog_item` 不是 `CURRENT_TASK` lifecycle state；paused / interrupted package 是 recovery artifact，不是 governance catalog 常驻对象；owner-sensitive routing 与 lifecycle runtime skills 已分别在任务 `005` / `004` 收敛。
- 本任务目标是在不污染当前 active task 的前提下，为 workflow-system 增加一个轻量、可审计的“只记录、不切任务”入口：`capture-work-item`。

## 验收标准

- [ ] 已新增 `capture-work-item` workflow skill template，并能生成对应 generated skill。
- [ ] 已定义 inbox artifact path contract 与最小 schema，路径固定为 `TASKS/inbox/INBOX-<YYYYMMDD>-<short-id>-<slug>.md` 风格，且不会与 archived / paused / interrupted task artifact 混淆。
- [ ] `capture-work-item` 只在 `relation_to_current_task = unrelated` 时成功写入 `TASKS/inbox/**`，不会修改当前 `CURRENT_TASK.md` 的任务目标、验收标准、Allowed / Conditional / Forbidden Files、实施步骤、审查问题队列或 active ownership marker。
- [ ] `relation_to_current_task = scope_widening_candidate` 时不写 inbox，而是转 `/lock-scope`；`relation_to_current_task = uncertain` 时 fail-closed 到 `ask-user`。
- [ ] `handoff.success = create-current-task` 仅保留为 generator-compatible fallback；record-only 成功语义必须通过 `conditional_handoff.capture_only = ask-user` 表达，不得被 guide / registry 解释为 capture 后默认创建任务。
- [ ] validator 能拒绝非法 inbox path、缺少 required fields 的 inbox item，以及把 inbox artifact 混入 `TASKS/paused/**`、`TASKS/interrupted/**`、`TASKS/TASK-*.md` 或 `CURRENT_TASK.md` lifecycle state 的情况。
- [ ] `capture-work-item` 归入 `阶段 1：任务创建`，但 guide / registry summary 必须把它表达成 record-only branch，而不是 `create-current-task` 主链的一部分。
- [ ] 不修改 `create-current-task`、`investigate-root-cause`、`run-regression`、`sync-review-findings`、`scripts/workflow-runtime.ts`、`scripts/task-identity.ts` 或 `test/task-identity.test.ts`；若实现证明必须触碰这些面，立即停止并回 `/lock-scope`。
- [ ] 不新增 `CURRENT_TASK.md` lifecycle state；`capture` 与 `backlog_item` 继续不是 lifecycle state。

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
- Health checks: not applicable
- Canary window: not applicable
- Performance baseline: not applicable
- Rollback / recovery: 回退到 `Task start base`，撤销本任务引入的 protocol / schema / validator / template / registry / guide / test 改动
- Release evidence: not applicable

## 允许修改范围

Allowed Files:

- `.workflow-system/WORKFLOW_PROTOCOL.md`
- `.workflow-system/FILE_SCHEMAS.md`
- `scripts/workflow-doc-contracts.ts`
- `scripts/run-validation.ts`
- `templates/skills/capture-work-item.SKILL.md.tmpl`
- `templates/docs/WORKFLOW_GUIDE.md.tmpl`
- `scripts/gen-registry.ts`
- `test/gen-workflow-skills.test.ts`
- `test/gen-registry.test.ts`
- `test/gen-workflow-docs.test.ts`
- `test/run-validation.test.ts`
- `docs/workflow/CURRENT_TASK.md`

Conditional Files:

- `docs/workflow/generated/workflow-skills/capture-work-item.SKILL.md`
  - condition：仅当 `capture-work-item` template 通过生成器成功渲染时允许同步。
  - required evidence：diff 只反映任务 `007` 的 capture / inbox contract 变更；不得手工编辑。
  - validation：`bun run test:workflow-skills`, `bun run validate:freshness`
- `docs/workflow/generated/workflow-docs/WORKFLOW_GUIDE.md`
  - condition：仅当 `templates/docs/WORKFLOW_GUIDE.md.tmpl` 为 capture / inbox 的 record-only 入口更新而变化时允许同步。
  - required evidence：diff 只反映 `/capture-work-item` 的入口与 record-only summary 变化。
  - validation：`bun run test:workflow-docs`, `bun run validate:freshness`
- `docs/workflow/SKILL_REGISTRY.md`
  - condition：仅当 `scripts/gen-registry.ts` 因新增 `capture-work-item` 重新生成 registry 时允许同步。
  - required evidence：新增 `capture-work-item` entry，位于 `阶段 1：任务创建`，且 summary 是 record-only branch。
  - validation：`bun run test:registry`, `bun run validate:freshness`
- `docs/workflow/CONTRACTS.md`
  - condition：仅当任务 `007` 形成稳定 inbox artifact / capture contract，需要由 `/sync-contracts` 固化时允许。
  - required evidence：diff 只记录 inbox artifact、record-only capture、非 lifecycle state、no active task pollution 边界。
  - validation：`bun run validate:protocol`
- `docs/workflow/DECISIONS.md`
  - condition：仅当任务 `007` 产生需要长期保留的 architecture / deferred / rejected decision，并由 `/sync-decisions` 写入时允许。
  - required evidence：diff 只记录已确认的 007 决策，例如 inbox 不等于 task、capture 不等于 lifecycle state、record-only 不自动 promote。
  - validation：`bun run validate:protocol`
- `docs/workflow/STATUS.md`
  - condition：仅当任务 `007` 完成后需要更新 capability / remaining follow-up 时允许。
  - required evidence：diff 只记录 capture / inbox record-only 能力状态。
  - validation：`bun run validate:protocol`
- `docs/workflow/LESSONS.md`
  - condition：仅当任务 `007` 过程中出现可复用经验，并由 `/capture-lessons` 写入时允许；无 lesson 时必须 no-op。
  - required evidence：diff 只记录跨任务可复用经验，不记录一次性执行流水。
  - validation：`bun run validate:protocol`

Safety mode:

- `frozen-scope`
- 选择理由：本任务会同时触碰 protocol / schema / validator / template / registry / guide / test 多条 source pipeline，但目标仍收敛为单一 record-only capture contract；风险主要是 inbox artifact 与 lifecycle / task artifact 边界混淆、record-only 语义被误接到 create chain、以及 generated artifact discipline 漂移，因此采用强范围冻结。

Dangerous surfaces:

- `artifact-kind confusion`
- `lifecycle-state contamination`
- `record-only branch misrouting`
- `generated artifact discipline`
- `active-task pollution`

Unlock / widening conditions:

- widening case 1：实现证明 inbox artifact discrimination 必须触碰 `scripts/task-identity.ts`、`test/task-identity.test.ts` 或 task artifact kind 闭集
  - reason：如果现有 validator / doc-contract 层无法在不扩展 task identity contract 的前提下区分 inbox 与 archive / paused / interrupted artifact，则需要重新评估是否升级为 task artifact kind。
  - impact files：`scripts/task-identity.ts`, `test/task-identity.test.ts`, `.workflow-system/WORKFLOW_PROTOCOL.md`, `.workflow-system/FILE_SCHEMAS.md`, `docs/workflow/CONTRACTS.md`, `docs/workflow/DECISIONS.md`
  - risks：把 record-only inbox 误提升成 lifecycle / task identity 一部分，扩大实现与兼容面。
  - validation：补齐 task identity、validator、registry / guide 与 protocol-level 回归，再重新执行 `bun run test:workflow-all`、`bun run validate:protocol`、`bun run validate:freshness`、`bun run workflow:health --root .`
- widening case 2：实现证明必须修改 `templates/skills/create-current-task.SKILL.md.tmpl`、`templates/skills/{investigate-root-cause,run-regression,sync-review-findings}.SKILL.md.tmpl`、`templates/docs/DOCUMENT_CATALOG.md.tmpl` 或 runtime manifest / install / health report contract
  - reason：如果 capture branch 无法在当前 record-only scope 内独立成立，而必须改变现有 routing / catalog / runtime contract，则已超出本任务授权边界。
  - impact files：对应 templates、generated outputs、必要的 tests，以及可能的 runtime / docs contract surfaces
  - risks：把记录入口静默扩大成 task routing、catalog reclassification 或 runtime feature
  - validation：停止当前实现，回 `/lock-scope` 重新生成 Allowed / Conditional / Forbidden Files 和新的验证矩阵
- 未明确允许的文件默认禁止修改。

## 禁止修改范围

Forbidden Files:

- `scripts/workflow-runtime.ts`
- `test/workflow-runtime.test.ts`
- `scripts/task-identity.ts`
- `test/task-identity.test.ts`
- `templates/skills/create-current-task.SKILL.md.tmpl`
- `templates/skills/investigate-root-cause.SKILL.md.tmpl`
- `templates/skills/run-regression.SKILL.md.tmpl`
- `templates/skills/sync-review-findings.SKILL.md.tmpl`
- `.workflow-system/PROJECT_PROFILE.yaml`
- `templates/docs/DOCUMENT_CATALOG.md.tmpl`
- `docs/workflow/DOCUMENT_CATALOG.md`
- `docs/workflow/NEXT_TASK_DRAFT_006_TARGET_ROOT_GUARD.md`
- `docs/workflow/NEXT_TASK_DRAFT_007_CAPTURE_WORK_ITEM_INBOX.md`
- `TASKS/TASK-006-target-root-guard.md`
- `vibe-coding/**`
- `dist/**`
- `.git/**`
- `node_modules/**`

## 受影响的契约

- `CURRENT_TASK lifecycle / suspended package foundation`
  - 兼容策略：`backward-compatible`
  - 影响：只新增 record-only inbox artifact contract，并继续明确 `capture` / `backlog_item` 不是 lifecycle state。
- `workflow governance artifact validation contract`
  - 兼容策略：`backward-compatible`
  - 影响：validator 需识别 `TASKS/inbox/**` 与 archive / paused / interrupted artifact 的边界，但不改变现有 suspended package recovery 语义。
- `WORKFLOW_GUIDE` / `SKILL_REGISTRY` stage-1 routing contract
  - 兼容策略：`backward-compatible`
  - 影响：在 `阶段 1：任务创建` 中新增 record-only branch，不改变 `create-current-task` 主链。

## Change Propagation Check

- trigger：yes；本任务会修改 protocol / schema、validator、skill template、guide / registry 与多处生成器测试，属于 source pipeline 的跨层扩展。
- impacted consumers：
  - 维护 source repo workflow-system 的开发者
  - 依赖 generated `WORKFLOW_GUIDE` / `SKILL_REGISTRY` 选择 workflow 入口的宿主用户
  - protocol-level validation 与 generated freshness 消费者
  - 未来可能消费 inbox artifact 的后续任务设计者
- compatibility strategy：`backward-compatible`
- required writeback candidates：
  - `docs/workflow/CONTRACTS.md`
  - `docs/workflow/DECISIONS.md`
  - `docs/workflow/STATUS.md`
- regression checks：
  - `bun run gen:all`
  - `bun run test:workflow-skills`
  - `bun run test:registry`
  - `bun run test:workflow-docs`
  - `bun run test:workflow-all`
  - `bun run validate:protocol`
  - `bun run validate:freshness`
  - `bun run workflow:health --root .`

## 已确认决策

- AD-005 / AD-008 / CONTRACTS 已锁定：`capture` 与 `backlog_item` 不是 lifecycle state，paused / interrupted package 不是 governance catalog 常驻对象。
- 当前任务只处理 `relation_to_current_task = unrelated` 的 record-only capture；`scope_widening_candidate` 走 `/lock-scope`，`uncertain` 走 `ask-user`。
- `capture-work-item` 必须是 record-only branch，不自动 promote，不自动切换当前任务，不自动进入实现链。
- 本任务默认不修改 `create-current-task`、`investigate-root-cause`、`run-regression`、`sync-review-findings`、`scripts/task-identity.ts` 或 runtime manifest / install / health report contract。
- `TASKS/inbox/**` 是拟新增的独立 artifact family，但默认不进入 `DOCUMENT_CATALOG.md`，除非后续 review 证明必须扩面并重新锁范围。

## 待确认问题

- inbox artifact 是否只在 validator / doc-contract 层区分即可，还是最终仍需上浮到 task identity contract；默认前者，若证据不足则回 `/lock-scope`。
- duplicate 检测的最小 read-back 规则是否只要求轻量 title / slug / evidence 近似检查，还是必须在本任务中更严格 schema 化。
- `DOCUMENT_CATALOG.md` 是否需要收录 inbox artifact；默认不收录，若必须收录则视为 widening。

## 实现方案

- Goal: 为 workflow-system 增加 `capture-work-item` record-only 入口和 inbox artifact contract，使“已人工判断与当前任务无关的新事项”可以被稳定记录，而不污染当前 active task、lifecycle state 或既有 task routing。
- Architecture impact:
  - 受影响模块：`.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md`、`scripts/workflow-doc-contracts.ts`、`scripts/run-validation.ts`、`templates/skills/capture-work-item.SKILL.md.tmpl`、`templates/docs/WORKFLOW_GUIDE.md.tmpl`、`scripts/gen-registry.ts` 与对应 tests。
  - 受影响边界：新增 inbox artifact family 与 record-only branch；不重开 task identity、runtime lifecycle、owner routing 或 runtime install / sync / health contract。
  - 生成链影响：新增 template / registry / guide / validator contract 后，generated skill、generated guide 与 registry 需要通过生成器同步并由 freshness 兜底。
- Technical approach:
  - 先在 protocol / schema 中声明 inbox artifact path contract、最小字段、record-only 语义，以及 `capture` / `backlog_item` 继续不属于 lifecycle state。
  - 再在 `workflow-doc-contracts.ts` 与 `run-validation.ts` 中增加 inbox artifact path / field validation，确保 inbox 与 archive / paused / interrupted artifact 路径边界清晰，且非法 lifecycle state 会 fail-closed。
  - 新增 `templates/skills/capture-work-item.SKILL.md.tmpl`，明确 reads / writes / forbidden_writes / relation gate / handoff；`handoff.success = create-current-task` 只保留 generator-compatible fallback，真实 record-only 成功路径固定为 `conditional_handoff.capture_only = ask-user`。
  - 更新 `WORKFLOW_GUIDE` 与 registry，使 `capture-work-item` 暴露在 `阶段 1：任务创建` 的 record-only branch 中，而不和 `create-current-task` 主链混写。
- Alternatives considered:
  - 把 inbox item 直接建模成新的 lifecycle state：不采用，已与 AD-005 / AD-008 / CONTRACTS 冲突。
  - 把 inbox artifact 纳入 `scripts/task-identity.ts` 的 task artifact kind 闭集：当前不采用，先尽量在 validator / doc-contract 层完成路径判定，避免扩大兼容面。
  - 直接扩展 `create-current-task` 或 owner-routing skills 消费 capture：不采用，超出本任务 record-only 范围。
  - 将 inbox artifact 直接收录进 `DOCUMENT_CATALOG.md`：当前不采用，避免把临时记录入口升级为 governance catalog 常驻对象。
- Data / state flow:
  - 用户调用 `/capture-work-item` -> 读取 live `CURRENT_TASK.md` 与现有 `TASKS/inbox/**` -> 校验 `relation_to_current_task`
  - `unrelated`：写入单个 inbox artifact，记录 current task snapshot 与 evidence，随后走 `conditional_handoff.capture_only = ask-user`
  - `scope_widening_candidate`：不写 inbox，直接 handoff `/lock-scope`
  - `uncertain`：不写 inbox，fail-closed 到 `ask-user`
  - protocol / schema / validator：在生成和 validation 流程中拒绝非法 inbox path、缺字段 artifact 与 lifecycle state 污染
- Compatibility:
  - `backward-compatible`；新增 record-only 入口，不改变已有 create / review / lifecycle / owner-routing 主链。
  - 现有 task archive、paused / interrupted package、runtime install / sync / health 和 task identity contract 保持不变，除非 review 证明必须 widening。
  - generated reference outputs 仍只通过生成器同步。
- Risks and rollback:
  - inbox artifact 与 archive / paused / interrupted artifact 路径判定不清，会导致 validator 或 guide 语义漂移。
  - registry / guide 若把 `handoff.success = create-current-task` 解释成默认主链，会把 record-only 入口误写成 create branch。
  - 如果不得不触碰 `scripts/task-identity.ts` 或 `DOCUMENT_CATALOG.md`，说明当前 scope 过窄，必须 relock。
  - 回滚方式：回退到 `Task start base`，撤销 protocol / schema / validator / template / registry / guide / test 改动；若只剩 live doc 差异，保留任务包并重新 review scope。
- Validation strategy:
  - Generator：`bun run gen:all`
  - Focused tests：`bun run test:workflow-skills`, `bun run test:registry`, `bun run test:workflow-docs`
  - Full regression：`bun run test:workflow-all`, `bun run validate:protocol`, `bun run validate:freshness`, `bun run workflow:health --root .`
  - Contract assertions：generated skill 的 reads / writes / forbidden_writes / conditional_handoff；registry stage-1 summary 的 record-only 文案；validator 对非法 inbox path / missing fields / lifecycle pollution 的拒绝行为
- Open decisions:
  - duplicate 规则是否需要在本任务就固定更细的 evidence 近似算法
  - `DOCUMENT_CATALOG.md` 是否在后续 review 中被证明必须感知 inbox artifact
- External Documentation Gate: not triggered；当前任务只依赖仓库内 protocol / schema / template / validator / guide / registry 事实，不依赖第三方 current docs 行为。
- Handoff: `review-current-task`

## 审查问题队列

- 无。

## 传播治理记录

### change_start_set

- 对象路径：`TASKS/inbox/INBOX-<YYYYMMDD>-<short-id>-<slug>.md`
  - 对象类型：record-only artifact path contract
  - 变更起点语义：新增独立 inbox artifact family，用于承载与当前任务无关的新事项记录。
- 对象路径：`capture-work-item`
  - 对象类型：workflow skill public surface
  - 变更起点语义：新增 record-only workflow 入口，不进入默认 create chain。
- 对象路径：`WORKFLOW_GUIDE` / `SKILL_REGISTRY`
  - 对象类型：workflow discovery surface
  - 变更起点语义：在 `阶段 1：任务创建` 中新增 capture 的 record-only branch。

### discovery evidence

- `EvidenceRecord`：
  - mechanism：task draft + live governance docs review
  - query_or_entrypoint：`docs/workflow/NEXT_TASK_DRAFT_007_CAPTURE_WORK_ITEM_INBOX.md`
  - scope：capture-work-item / inbox artifact / record-only branch
  - result_summary：现有 contracts 与 decisions 已锁定 `capture` / `backlog_item` 不是 lifecycle state，paused / interrupted package 不是 governance catalog；任务 `007` 可以在不修改 runtime / task identity / existing routing skill 的前提下先尝试 protocol / validator / template / guide / registry 的最小闭环。
  - confidence：high
  - gaps：inbox artifact 是否最终需要上浮到 task identity contract、duplicate read-back 规则强度、DOCUMENT_CATALOG 是否需要收录

### layout / behavior / migration / regression

- `BehaviorContract`：
  - object_path：`capture-work-item` / inbox record-only flow
  - assertions：
    - `capture-work-item` 只接受 `relation_to_current_task = unrelated`
    - capture 成功后只写入 `TASKS/inbox/**`，不污染当前 active task
    - `scope_widening_candidate` 必须转 `/lock-scope`
    - `uncertain` 必须 fail-closed 到 `ask-user`
    - registry / guide 必须把 capture 表达成 record-only branch，而不是 create-current-task 主链
  - verification：generator tests + validator tests + `bun run test:workflow-all` + `bun run validate:protocol`

### blockers / gate status

- 当前执行步骤：`review-current-task`
- 已完成 discovery：
  - 已读取 draft `007`、`WORKFLOW_PROTOCOL`、`FILE_SCHEMAS`、`PROJECT_PROFILE`、`CONTRACTS`、`DECISIONS`、`STATUS` 与方法论文档。
  - 已确认本任务不是 UI / visual / release 任务；设计约束与发布后验证可保持 `none`。
  - 已确认草案目标与范围清晰：只做 inbox artifact、capture-work-item、guide / registry 暴露、validator / tests 闭环，不并入 create / routing / lifecycle / runtime contract widening。
  - 已确认 `capture` / `backlog_item` 不是 lifecycle state，paused / interrupted package 不是 catalog 对象，且 owner-routing / lifecycle runtime skills 已有稳定边界。
  - 已确认本任务命中 change propagation，需要后续评估是否回写 `CONTRACTS.md`、`DECISIONS.md`、`STATUS.md`。
- 剩余 blocker：
  - 无当前阻断；下一 handoff 进入 `/review-current-task`

## 实施步骤

- [x] 步骤 1：执行 `/create-current-task`，把 `NEXT_TASK_DRAFT_007_CAPTURE_WORK_ITEM_INBOX.md` materialize 为 live `CURRENT_TASK.md`，并补齐 scope、change propagation、rollback point 与初始验证策略。
- [ ] 步骤 2：执行 `/review-current-task`，确认 record-only 边界、Allowed / Conditional / Forbidden Files 与 acceptance wording 不再含糊。
- [ ] 步骤 3：执行 `/lock-scope`，冻结 protocol / schema / validator / template / guide / registry / test 的允许面，并决定是否需要把 task identity / catalog widening 明确写成 unlock 条件。
- [ ] 步骤 4：执行 `/classify-decisions` 与 `/plan-implementation`，确认 inbox artifact path / schema / validator / record-only routing 的最小实现路线。
- [ ] 步骤 5：执行 `/decompose-task`，把 protocol / schema、validator、skill template、guide / registry、tests 与回归拆成独立步骤。

## 回归检查项

- `bun run gen:all`
- `bun run test:workflow-skills`
- `bun run test:registry`
- `bun run test:workflow-docs`
- `bun run test:workflow-all`
- `bun run validate:protocol`
- `bun run validate:freshness`
- `bun run workflow:health --root .`
- validator 能拒绝非法 inbox path、缺字段 inbox item 与 lifecycle state 污染
- guide / registry 把 `capture-work-item` 表达成 record-only branch，而不是 create-current-task 主链

## 回滚点

- Task start base：`85eae344`
- Last reviewed checkpoint：`not-yet-created`
- Current diff review target：`working-tree`

## 执行记录

- 2026-05-27：已根据 `docs/workflow/NEXT_TASK_DRAFT_007_CAPTURE_WORK_ITEM_INBOX.md` materialize 任务 `007` 的 live `CURRENT_TASK.md`，并结合 `CONTRACTS.md`、`DECISIONS.md`、`STATUS.md` 与规范源补齐 Allowed / Conditional / Forbidden Files、Change Propagation Check、回滚点与初始实施步骤；`bun run validate:protocol` 与 `bun run workflow:health --root .` 已通过。下一 handoff 进入 `/review-current-task`。
