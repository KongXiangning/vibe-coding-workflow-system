# NEXT_TASK_DRAFT_007_CAPTURE_WORK_ITEM_INBOX.md

## 草案状态

- 用途：任务 007 候选任务包，供后续 `/create-current-task` 或 `/review-current-task` 复审。
- 当前状态：draft_for_review
- 不接管当前 `CURRENT_TASK.md`。
- 不代表任务 007 已开始实施。
- 本稿承接任务 `003` 原始后续拆分中 “capture-work-item / inbox artifact” 的 deferred 范围；由于当前任务 `006` 已被 target root guard 占用，本能力后移为任务 `007`。

## 任务信息

- 任务 ID：007
- 任务标题：实现 capture-work-item 与 inbox artifact，支持无关新事项记录
- 任务 slug：capture-work-item-inbox
- 建议初始 handoff：`create-current-task`

## 任务目标

为 workflow-system 增加一个轻量、可审计的**记录入口**，用于在当前 `CURRENT_TASK.md` 执行过程中，把**已由人判断为与当前任务无关**的新事项记录下来，而不打断或污染当前 active task。

必须覆盖的场景：

1. 用户提出新需求，但只想先记录，不想立即切换任务。
2. 执行当前任务时出现新灵感，但当前只需要留档，后续再评估。
3. 发现新 BUG，但已经由人判断它与当前 `CURRENT_TASK` 无关，因此只需要记录，不需要并入当前任务。

任务完成后应得到：

- 一个 `capture-work-item` workflow skill。
- 一个稳定的 inbox artifact path contract。
- 一个可校验的 inbox item 最小 schema。
- guide / registry 中可见的“只记录、不切任务”入口。
- 测试证明：capture 不会改写当前 active task 的目标、范围、步骤、验收或 ownership。

## 范围收窄结论

任务 `007` 草案默认只处理以下范围：

1. 定义 inbox artifact 身份、路径、最小字段和初始状态。
2. 新增 `capture-work-item` skill template。
3. 更新 guide / registry，让用户知道“只记录、不打断当前任务”的入口。
4. 增加生成器、文档契约和 validation 测试。

以下内容默认不并入任务 `007`：

- 不实现从 inbox 自动 promote 到 `CURRENT_TASK.md`。
- 不修改 `create-current-task`。
- 不修改 `investigate-root-cause`、`run-regression`、`sync-review-findings`。
- 不把 `new_bug_task_required` 扩展成 capture 分支。
- 不新增 `CURRENT_TASK.md` lifecycle state。
- 不把 `capture` 或 `backlog_item` 写成 lifecycle state。
- 不改变 pause / interrupt / resume 的 suspended package contract。
- 不修改 runtime manifest / install / health report contract。
- 不实现 backlog prioritization / backlog grooming。
- 不实现跨项目 issue tracker、GitHub issue、Linear / Jira 同步。

## P0 前置原则

### 1. capture 是“记录动作”，不是 task routing 或 lifecycle state

任务 `003` 已明确：

- `capture` 不是状态。
- `backlog_item` 不是 `CURRENT_TASK` 生命周期状态。
- inbox / backlog artifact 不属于 suspended task package。

任务 `007` 必须继续保持该边界。`capture-work-item` 只负责生成独立 inbox artifact，不得把 live `CURRENT_TASK.md` 的 `当前状态` 或 `生命周期状态` 改成 capture / backlog。

### 2. capture 只处理“已人工判断无关”的事项

本任务不让 workflow skill 帮用户重新做 owner / scope 判定。  
因此 `capture-work-item` 只处理下列输入：

- 用户已经明确说明“和当前任务无关，只先记录”
- 或调用方已经把 relation 明确标成 `unrelated`

若 relation 不是 `unrelated`：

- `scope_widening_candidate`：不写 inbox，转 `/lock-scope`
- `uncertain`：不写 inbox，转 `ask-user`

### 3. capture 不得污染当前 active task

`capture-work-item` 成功时不得修改当前任务的：

- 任务目标
- 验收标准
- Allowed Files / Conditional Files / Forbidden Files
- 实施步骤
- 审查问题队列
- active ownership marker

换句话说，capture 只是“落一条记录”，不是“顺手改变当前任务”。

### 4. inbox item 是记录，不是已承诺任务

inbox item 只表示“已捕获、待后续人工处理”。  
它不得自动变成 `CURRENT_TASK.md`，也不得自动进入 implementation chain。

若后续要执行 inbox item：

- 由人工另行决定如何转成正式任务
- 该 promote / create 入口不属于任务 `007`
- 需要未来单独任务再设计 create / promote 消费链

### 5. inbox artifact 必须可审计、可去重、可分类

每个 inbox item 至少应记录：

- artifact kind
- item id
- title
- type：requirement / idea / bug / chore / question
- source：user / implementation / review / regression / root-cause / other
- captured_at
- relation_to_current_task：unrelated
- current_task_id snapshot
- description
- evidence
- suggested_next_action：triage_later / ask_user
- status：captured

本任务只要求初始写入稳定；`promoted` / `rejected` / `duplicate` 等后续状态写回留待后续任务。

### 6. path contract 必须避免与 existing task artifacts 混淆

建议路径：

```text
TASKS/inbox/INBOX-<YYYYMMDD>-<short-id>-<slug>.md
```

要求：

- 不使用 `TASK-<TASK_ID>-<TASK_SLUG>.md` 命名，避免和 archived task 混淆。
- 不放入 `TASKS/paused/**` 或 `TASKS/interrupted/**`。
- 不纳入 active ownership 推导。
- validator 必须能识别 inbox artifact 与 archived / paused / interrupted task artifact 的边界。

## 技能与路由建议

### 1. `capture-work-item`

职责：

- 接收用户提供的新事项描述。
- 读取当前 `CURRENT_TASK.md`，仅用于记录当前 task snapshot 与避免 active task 污染。
- 生成 `TASKS/inbox/**` inbox artifact。
- 在成功后结束记录链，而不是继续启动正式任务链。

最小要求：

- 必须读取 `docs/workflow/CURRENT_TASK.md`。
- 必须写入唯一 inbox artifact path。
- 必须要求 `type`、`title`、`description`、`source`。
- 必须要求 `relation_to_current_task = unrelated` 才能成功写入。
- `relation_to_current_task = scope_widening_candidate` 时，必须转 `/lock-scope`。
- `relation_to_current_task = uncertain` 时，必须 fail-closed 到 `ask-user`。
- 重复项检测至少基于同目录 title / slug / evidence 的轻量 read-back 检查；发现疑似重复时必须 ask-user。

推荐 handoff：

- `handoff.success = create-current-task`
  - 仅作为当前生成器要求的合法 success target，不代表 capture 后默认创建任务。
  - record-only 成功语义必须通过 `conditional_handoff.capture_only = ask-user` 表达。
- `handoff.failure = ask-user`
- `conditional_handoff.capture_only = ask-user`
  - capture 成功后的默认语义分支：记录完成，等待用户决定后续是否还要处理该事项。
- `conditional_handoff.scope_widening_candidate = lock-scope`
  - 当输入其实应并入当前任务时，不写入普通 inbox。

### 2. guide / registry

必须明确以下入口：

- 新事项与当前任务无关，只想记录：`/capture-work-item`
- 新事项高度契合当前任务：`/lock-scope`
- 新事项让当前任务失效：`/supersede-current-task`

`capture-work-item` 固定归入：

- `阶段 1：任务创建`

但 guide / registry summary 必须把它表达成**record-only 入口**，而不是 `create-current-task` 主链的一部分。推荐 summary 语义：

```text
record branch: capture-work-item -> ask-user
```

## 本任务必须覆盖的代码面

### Protocol / schema / validators

- `.workflow-system/WORKFLOW_PROTOCOL.md`
- `.workflow-system/FILE_SCHEMAS.md`
- `scripts/workflow-doc-contracts.ts`
- `scripts/run-validation.ts`

说明：

- 草案默认认为 inbox artifact path contract、最小字段和 validation behavior 需要协议 / schema 留痕。
- 本任务不把 inbox 提升为 task identity artifact，因此默认不修改 `scripts/task-identity.ts`；若正式 review 证明 path discrimination 必须落到 task identity 层，再单独上浮范围。

### Skill templates

- `templates/skills/capture-work-item.SKILL.md.tmpl`

### Guide / registry

- `templates/docs/WORKFLOW_GUIDE.md.tmpl`
- `scripts/gen-registry.ts`

### Tests

- `test/gen-workflow-skills.test.ts`
- `test/gen-registry.test.ts`
- `test/gen-workflow-docs.test.ts`
- `test/run-validation.test.ts`

## 关键测试断言建议

- `capture-work-item` template 能生成对应 `.SKILL.md`。
- `capture-work-item` 位于 `阶段 1：任务创建`。
- `test/gen-registry.test.ts` 必须断言 stage summary 使用 record-only 文案，而不是 create branch 文案。
- `capture-work-item` 的 `reads` 包含 `docs/workflow/CURRENT_TASK.md` 与 `TASKS/inbox/**`。
- `capture-work-item` 的 `writes` 只包含 `TASKS/inbox/**`。
- `capture-work-item` 的 `forbidden_writes` 必须禁止 source code、`CURRENT_TASK.md` task body、`TASKS/paused/**`、`TASKS/interrupted/**`、`TASKS/TASK-*.md` archive、runtime manifest / install / health report。
- `capture-work-item` 的 `handoff.success` 必须是 `create-current-task`，但只能作为 generator-compatible fallback；record-only 成功语义必须走 `conditional_handoff.capture_only = ask-user`。
- `test/gen-workflow-docs.test.ts` 承载文档契约断言：inbox artifact path parser 能接受 `TASKS/inbox/INBOX-<YYYYMMDD>-<short-id>-<slug>.md`，并能识别 inbox artifact 与 paused / interrupted / archived task artifact 的边界。
- `test/run-validation.test.ts` 承载 validation 断言，validator 能拒绝：
  - stray inbox artifact path
  - 缺少 required fields 的 inbox item
  - 把 inbox item 放入 paused / interrupted / archived task path
  - 把 `capture` / `backlog_item` 写成 `CURRENT_TASK.md` lifecycle state
- 不测试 `create-current-task` 从 inbox 消费，也不测试 `new_bug_task_required -> capture` 分支；这些都不在任务 `007` 范围内。

## 修改范围修订

### Allowed Files

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

### Conditional Files

- `docs/workflow/generated/workflow-skills/capture-work-item.SKILL.md`
  - condition：仅当 `capture-work-item` template 经 `bun run gen:workflow-skills` 或 `bun run gen:all` 成功生成时允许同步。
  - required evidence：diff 只来自任务 `007` 的 capture / inbox 变更；不得手工编辑。
  - validation：`bun run test:workflow-skills`、`bun run validate:freshness` 通过。
- `docs/workflow/generated/workflow-docs/WORKFLOW_GUIDE.md`
  - condition：仅当 `templates/docs/WORKFLOW_GUIDE.md.tmpl` 为 capture / inbox record-only 入口更新而变化时允许同步。
  - required evidence：diff 只反映 `/capture-work-item` 的 record-only 入口说明；不得混入 create / routing skill 变更。
  - validation：`bun run test:workflow-docs`、`bun run validate:freshness` 通过。
- `docs/workflow/SKILL_REGISTRY.md`
  - condition：仅当 `scripts/gen-registry.ts` 重新生成 registry 时允许同步。
  - required evidence：新增 `capture-work-item` registry entry，归入 `阶段 1：任务创建`，并使用 record-only summary；不得手工编辑。
  - validation：`bun run test:registry`、`bun run validate:freshness` 通过。
- `docs/workflow/CONTRACTS.md`
  - condition：仅当任务 `007` 形成稳定 inbox artifact / capture contract，需要由 `/sync-contracts` 固化时允许。
  - required evidence：diff 只记录 inbox artifact、capture action 非 lifecycle state、no active task pollution、record-only 边界。
  - validation：`bun run validate:protocol` 通过。
- `docs/workflow/DECISIONS.md`
  - condition：仅当任务 `007` 产生需要长期保留的 architecture / deferred / rejected decision，并由 `/sync-decisions` 写入时允许。
  - required evidence：diff 只记录已确认的 007 决策，例如 inbox 不等于 task、capture 不等于 lifecycle state、record-only 不自动 promote。
  - validation：`bun run validate:protocol` 通过。
- `docs/workflow/STATUS.md`
  - condition：仅当任务 `007` 完成后需要更新当前 capability / remaining follow-up 时允许。
  - required evidence：diff 只记录 capture / inbox record-only 能力状态。
  - validation：`bun run validate:protocol` 通过。
- `docs/workflow/LESSONS.md`
  - condition：仅当任务 `007` 过程中出现可复用经验，并由 `/capture-lessons` 写入时允许；无 lesson 时必须 no-op。
  - required evidence：diff 只记录跨任务可复用 lesson，不记录一次性执行流水。
  - validation：`bun run validate:protocol` 通过。

### Forbidden Files

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
- `vibe-coding/**`
- `dist/**`
- `.git/**`
- `node_modules/**`

## 建议验收标准

- 已新增 `capture-work-item` workflow skill template。
- 已定义 inbox artifact path contract 与最小 schema。
- `capture-work-item` 可以生成 `TASKS/inbox/**` item，并保持当前 `CURRENT_TASK.md` 任务目标、范围、步骤、验收和 active ownership 不变。
- `capture-work-item` 能区分 requirement / idea / bug / chore / question。
- `capture-work-item` 只接受 `relation_to_current_task = unrelated` 的记录请求；`uncertain` -> `ask-user`，`scope_widening_candidate` -> `lock-scope`。
- `capture-work-item` 的成功路径是 record-only：记录完成后走 `conditional_handoff.capture_only = ask-user`，不自动创建任务。
- `handoff.success = create-current-task` 只是 generator-compatible fallback，不得被实现或 guide 解释为 capture 后默认创建新任务。
- validator 能拒绝非法 inbox path、缺字段 inbox item、把 inbox artifact 混入 paused / interrupted / archived task path。
- guide / registry 已暴露 `/capture-work-item` 的 record-only 入口。
- 不新增 `CURRENT_TASK.md` lifecycle state。
- 不修改 `create-current-task`、`investigate-root-cause`、`run-regression`、`sync-review-findings`。
- 不实现 backlog prioritization / automatic promotion。
- 回归通过：
  - `bun run gen:all`
  - `bun run test:workflow-skills`
  - `bun run test:registry`
  - `bun run test:workflow-docs`
  - `bun run test:workflow-all`
  - `bun run validate:protocol`
  - `bun run validate:freshness`
  - `bun run workflow:health --root .`

## 建议实施顺序

1. 先在 protocol / schema 中明确 inbox artifact 是独立 record-only work item，不是 lifecycle state。
2. 再实现 path parser / validator，确保 inbox 与 paused / interrupted / archived task artifact 不混淆。
3. 再新增 `capture-work-item` skill template，锁定 trigger / reads / writes / forbidden_writes / handoff。
4. 再更新 `WORKFLOW_GUIDE.md.tmpl` 与 `scripts/gen-registry.ts`，暴露 record-only 入口。
5. 最后补生成器测试、validator 测试和全量回归。

## 已确认决策

- **任务 007 补回原 003 拆分中的场景 4**
  - 当前任务 `006` 已被 target root guard 占用；capture / inbox 能力后移到 `007`。
- **capture 是动作，不是 lifecycle state**
  - 不把 `capture` / `backlog_item` 写入 `CURRENT_TASK.md` lifecycle state。
- **inbox item 是记录，不是已承诺任务**
  - 不自动 promote，不自动执行，不自动改变当前任务。
- **capture 不污染当前 active task**
  - 和当前任务相关的新点不属于 capture 范围；无关事项才走 inbox。
- **007 只做 record-only 入口**
  - 不扩展 `create-current-task`，不扩展现有 routing skill，不把 capture 接入自动 create / routing 链。
- **capture-work-item 归入阶段 1 的 record branch**
  - registry 中固定归入 `阶段 1：任务创建`。
  - guide / registry summary 必须表达它是 record-only branch，不是 create-current-task 主链。

## 待确认问题

- inbox artifact 是否需要进入 `DOCUMENT_CATALOG.md`；草案默认不进入。若正式 review 证明 catalog 必须扩面，本任务必须暂停并回 `/lock-scope`，不得在当前默认范围内直接修改。
- 是否需要在本任务里先定义 `duplicate` 的最小 read-back 规则，还是只保留字段与疑似重复 `ask-user` 行为。
