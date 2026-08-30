# docs/workflow/CONTRACTS.md

## 使用规则

- 修改任何代码前先阅读本文件。
- 变更 `🔒` 项必须先记录到 `docs/workflow/DECISIONS.md` 并获得明确确认。
- 变更 `🟡` 项允许执行，但必须在任务总结中显式说明。
- `🟢` 项可自由修改，但仍需遵守整体分层与依赖方向。
- 本文件只固化 confirmed 事实；inferred / unknown 项进入 `docs/workflow/STATUS.md`、`docs/workflow/ROADMAP.md` 或 `docs/adoption/**`。

## 一、接口契约

### 🔒 已锁定接口

- 名称：source repo CLI contract
  - 路径 / 符号：`package.json` scripts
  - 当前语义：`gen:*`、`validate:*`、`test:*`、`workflow:*` 是本仓库和外部 target 项目消费 workflow-system 的公开命令入口。
  - 不可破坏项：命令名、source repo / target repo 语义、dry-run / write 语义、错误分类必须保持可追溯。
  - 备注：证据见 `docs/adoption/API_INVENTORY.md`。
- 名称：runtime install/sync contract
  - 路径 / 符号：`scripts/workflow-runtime.ts`
  - 当前语义：`workflow:install` 只面向外部或隔离 target root；source repo root、自身父目录 / 祖先目录以及与 source repo 共享 `.git` root 的 crossing root 必须 fail-closed 拒绝。`workflow:sync --root .` 可用于 source repo self-use 的 host skill 同步。
  - 不可破坏项：source repo 禁止 self-install；source parent / ancestor root 与 shared `.git` crossing 不得被当作 install target；target project 必须使用独立 root；host sync 必须保留 `workflow-system-*` 隔离 namespace。
  - 备注：未来若需要 source-repo import/repair 等价流程，必须先在协议和 runtime 中设计独立语义。

### 🔒 已锁定核心函数 / 导出

- 模块：`scripts/workflow-runtime.ts`
  - 函数 / 符号：`workflow:health`、`workflow:manifest`、`workflow:pack`、`workflow:install`、`workflow:sync`
  - 输入输出：CLI flags、manifest/install/sync/health report。
  - 不可破坏项：install、sync、pack、health 的语义不能互相替代；install drift repair flags 只修对应 managed surface。
  - 备注：`--replace-managed-drift` / `--repair-bootstrap-drift` 不是重新初始化入口。
- 模块：`scripts/gen-workflow-skills.ts`、`scripts/gen-workflow-docs.ts`、`scripts/gen-registry.ts`
  - 函数 / 符号：`gen:workflow-skills`、`gen:workflow-docs`、`gen:registry`
  - 输入输出：`.workflow-system/PROJECT_PROFILE.yaml`、协议/schema、templates -> generated reference outputs。
  - 不可破坏项：不得从 generated outputs 反向维护规范；结构变更必须从协议/schema/templates 开始。
  - 备注：generated freshness 是 protocol-level gate。
- 模块：`scripts/task-identity.ts`
  - 函数 / 符号：`TaskIdentityStatus`、`CurrentTaskWorkflowStatus`、`TaskLifecycleState`、`CurrentTaskOwnershipStatus`、`TaskArtifactKind`、`getTaskArtifactPath()`、`getTaskArchivePath()`。
  - 输入输出：live `CURRENT_TASK.md` identity fields、task artifact kind -> normalized identity / ownership / artifact path contract。
  - 不可破坏项：`TaskIdentityStatus` 只表达 identity completeness；workflow status、lifecycle state 和 active ownership 不得混用；`getTaskArchivePath()` 必须保持 archive-only 兼容 wrapper。
  - 备注：非法 status tuple、workflow status 与 resume gate drift 必须保持 named error 可追踪。

### 🔒 已锁定数据结构 / DTO / 事件 / 表结构

- 名称：`.workflow-system/PROJECT_PROFILE.yaml`
  - 结构：project/runtime/paths/boundaries/governance/validation matrix。
  - 语义：source repo 长期项目画像、路径、边界和 validation 声明。
  - 不可破坏项：不得为了模拟 target repo 覆盖 source repo facts；`owner: target-project` 的 slots 不用于 source repo quality gate。
  - 备注：source repo 若需要额外 quality gate，应新增明确 source-repo-specific 入口或后续协议扩展。
- 名称：workflow generated reference outputs
  - 结构：`docs/workflow/generated/workflow-docs/**`、`docs/workflow/generated/workflow-skills/**`、`docs/workflow/SKILL_REGISTRY.md`
  - 语义：source repo 产品化生成证据。
  - 不可破坏项：不可手改；必须通过 templates / scripts 重新生成。
  - 备注：live docs 才承载本仓库运行事实。
- 名称：CURRENT_TASK lifecycle / resume gate contract
  - 结构：`docs/workflow/CURRENT_TASK.md > ## 任务信息` 中的 `当前状态`、`生命周期状态`、`恢复需审查`、`恢复审查原因`。
  - 语义：`当前状态` 表达 workflow task record 状态；`生命周期状态` 表达 task lifecycle ownership state；两者共同决定 active ownership。`恢复需审查` 与 `恢复审查原因` 承载恢复审查 gate。
  - 不可破坏项：`当前状态` 不得重新承担 lifecycle 语义；`生命周期状态` 必须保持闭集语义；resume review reasons 必须按闭合集合规范化，drift 必须 fail-closed 或进入 review gate。
  - 备注：第一阶段只稳定契约，不实现 lifecycle runtime skill。
- 名称：task artifact path contract
  - 结构：`TASKS/TASK-<TASK_ID>-<TASK_SLUG>.md`、`TASKS/paused/TASK-<TASK_ID>-<TASK_SLUG>.md`、`TASKS/interrupted/TASK-<TASK_ID>-<TASK_SLUG>.md`。
  - 语义：archive / paused / interrupted 是同一 task identity 的不同 artifact kind；paused / interrupted package 是 recovery input，不是 live governance document。
  - 不可破坏项：不得把 suspended package 提升为 `docs/workflow/` 常驻 governance catalog 对象；不得用 suspended package 是否存在反推 active ownership。
  - 备注：`getTaskArchivePath()` 仅保留 archive-only wrapper；多 artifact path contract 由统一 resolver 承载。
- 名称：workflow vNext Phase 0 capability / compatibility shadow contract
  - 结构：`.workflow-system/WORKFLOW_CAPABILITIES.yaml`、`test/fixtures/workflow-capability-cases.yaml`。
  - 语义：manifest 声明 public / internal / runtime / compat 四层产品能力与 37-name 迁移映射；fixtures 承载 37 个逐项 `MR-*` 与 18 个组合 `GR-*` non-loss evidence。两者只用于 source-repo conformance，不承载目标项目 live task、status、contract 或 decision facts。
  - 不可破坏项：37 个现有 Skill name 在 Phase 0 必须全部且仅一次保留，legacy handoff / writes 继续权威；public / internal / runtime 不得被当前 generator、registry、export、pack、install 或 host sync 当成已推广 surface；Runtime declaration 不得冒充已实现的状态事务。
  - 备注：10 个 public entry 名称是 shadow baseline，可在后续用户确认的迁移任务中演进，但任何演进都必须保持 alias coverage、stage coverage 和 golden evidence 可追溯。

### 🟡 可扩展不可破坏

- 可以新增 source-repo-specific quality gate，但不能复用 target-project validation slots 伪装 protocol checks。
- 可以新增 target root guard，例如 `scripts/guard-target-root.ts`，但必须先明确协议入口、错误分类和测试覆盖。
- 可以扩展 `docs/product/**`、`docs/guides/**`、`docs/ops/**` 等产品/业务文档目录，但不能把这些内容放入 `docs/workflow/` 治理管理面。

### 🟢 自由修改

- `docs/adoption/**` 中的 inventory / adoption 报告内容，按 bootstrap/adoption 流程维护。
- `docs/workflow/*.md` 中 live 内容，按 workflow skills 和本文件约束维护。
- 非 generated 的说明文档可在对应目录中维护，但涉及协议/schema/模板结构时必须回到正式规范源。

## 二、架构契约

### 🔒 依赖方向

- `.workflow-system/WORKFLOW_PROTOCOL.md` 和 `.workflow-system/FILE_SCHEMAS.md` 是结构与规则源头。
- `templates/**` 只能承载协议/schema 已声明的结构。
- `scripts/**` 实现生成、验证、pack/install/sync/runtime 行为。
- `test/**` 验证协议、生成器、runtime 和契约。
- `docs/workflow/generated/**` 和 `docs/workflow/SKILL_REGISTRY.md` 只能由生成器写入。

### 🔒 分层规则

- source repo 质量控制端与 target-project 消费端必须物理路径隔离、命令语义隔离、validation layer 隔离。
- source repo 负责规范、生成、验证、打包、同步能力。
- target project 只在独立 root 中消费 install、bootstrap/adoption 和 host sync。
- `workflow:install --root .` 对 source repo 是禁止路径。
- `workflow:sync --root . --host <host> --write` 是 source repo self-use 的允许路径。

### 🔒 状态流 / 数据流

- 结构变更：协议/schema/templates -> generator -> generated reference -> freshness。
- 项目事实变更：workflow skill -> live `docs/workflow/*.md`。
- task lifecycle 判定：live `docs/workflow/CURRENT_TASK.md` task identity fields -> task identity parser / resolver -> ownership state；suspended packages 只能作为 recovery input。
- suspended package validation：`TASKS/paused/**` 与 `TASKS/interrupted/**` -> `workflow-doc-contracts.ts` structure validation -> `run-validation.ts` synthesized protocol check。
- target 安装：source repo bundle -> external target root -> target bootstrap/adoption -> source repo render/sync target。
- source self-use：source repo generated skills -> `.codex/skills/workflow-system-*` / `.claude/skills/workflow-system-*`。

### 🔒 目录职责

- `docs/workflow/*.md`：本 source repo 的 live governance docs，只记录治理状态、任务、契约、决策、路线图、基线和经验。
- `docs/workflow/generated/**`：产品化 reference render，不承载运行事实。
- `docs/workflow/SKILL_REGISTRY.md`：generated registry，不手改。
- `docs/adoption/**`：self-adoption inventory / 接管材料。
- `docs/designs/**`：后续设计基线。
- `README.md`、`vibe-coding/**`、`docs/product/**`、`docs/guides/**`、`docs/ops/**`：source repo 产品、业务、方法论、使用或运维说明。

### 🔒 事件 / DTO 语义

- validation matrix 的 `layer: protocol` 归 workflow-system；`layer: project` 且 `owner: target-project` 的 slots 归 target project Adoption A4。
- `suspended-task-package-validation` 是 protocol-level synthesized check，blocker level 为 `blocks-merge`；目录不存在或无 package 时通过，stray suspended artifact 或非法 suspended package 必须 fail-closed。
- install drift repair flags：
  - `--replace-managed-drift` 只修 install-state 中 `replace-managed` 管理项。
  - `--repair-bootstrap-drift` 只修 install-state 中 `bootstrap-skill-install` 管理项。
  - 两者都不重做 inventory/adoption，不覆盖 target-owned project facts。

## 三、变更规则

- 任何跨层依赖变动都必须先明确记录原因和影响。
- 任何接口返回结构变化都必须有兼容策略或明确升级计划。
- 任何“顺手重构”如果超出当前任务范围，必须停止并单独立项。
- source repo / target project 隔离规则变更必须进入 `DECISIONS.md`，并同步 `BASELINES.md` 与相关测试计划。
- generated/live docs 边界变更必须先更新协议/schema/templates/generator，不得只改 live 文档。

## 四、传播治理补充

### candidate 回写记录

- 对象路径：`workflow:install --root <target>`
  - 当前状态：`locked-candidate`
  - direct consumers：external target repo operators
  - cross_boundary：source repo -> target repo
  - critical_path_hit：yes
  - locked_hit_chain：install-state / managed files / bootstrap skills
  - writeback_required：yes, contract and baseline

### LayoutContract

- 容器路径：`docs/`
  - machine_anchor：directory taxonomy
  - layout_model：workflow governance / generated reference / adoption inventory / product docs separated by directory
  - locked_properties：`docs/workflow/generated/**` generated-only; `docs/workflow/*.md` live governance only
  - locked_relations：`docs/workflow/` must not absorb product/business docs
  - cascade_sources：`.workflow-system/FILE_SCHEMAS.md`; `templates/docs/DOCUMENT_CATALOG.md.tmpl`; `WORKFLOW_GUIDE.md.tmpl`
  - sibling_reflow_sensitive：yes
  - insertion_guard：
    - mode：review-required
    - protected_siblings：`docs/workflow/generated/**`, `docs/adoption/**`, `vibe-coding/**`
  - breakpoint_contracts：not-applicable
  - stacking_context：not-applicable
  - side_effect_scope：documentation discoverability and governance ownership

### BehaviorContract

- 对象路径：source repo self-use flow
  - assertions：
    - source repo must not self-install
    - source parent / ancestor root must not be used as install target
    - roots sharing the same `.git` anchor as the source repo must not be used as install target
    - source repo may self-sync host skills
    - target project must use external or isolated root
  - verification：`bun run test:workflow-all`; `bun run workflow:health --root .`

- 对象路径：core skill External Documentation Gate
  - assertions：
    - `plan-implementation`、`implement-current-step`、`investigate-root-cause`、`review-implementation` 必须显式声明同名 `External Documentation Gate`。
    - gate 只在第三方 library / framework / SDK / API / CLI tool / cloud service 的 current behavior 会影响方案、实现、根因判断或评审结论时触发。
    - 共享调用优先级必须保持为：ctx7 MCP -> 可确认 current docs 的 ctx7 / docs skill -> `ctx7` CLI -> blocked reason。
    - 全部取证通道不可用时必须记录 blocked reason，不得用训练数据默默替代 current docs 判断。
    - `plan-implementation` 的 evidence 落点是实现方案；`implement-current-step` 的 evidence 落点是执行记录或本步验证记录；`investigate-root-cause` 的 evidence 落点是 debug evidence / 调查报告；`review-implementation` 的 evidence 落点是 finding 或 clean 结论。
    - `create-current-task` 不作为 ctx7 主查询入口；任务创建最多记录后续需要外部文档 evidence。
  - verification：`bun run gen:workflow-skills --dry-run`、`bun run gen:registry --dry-run`、`bun run test:workflow-skills`、`bun run validate:protocol`、`bun run validate:freshness`

- 对象路径：CURRENT_TASK lifecycle / suspended package foundation
  - assertions：
    - v1 lifecycle state set is `active`、`paused_pending_closure`、`paused_blocked`、`interrupted`、`archived`.
    - `backlog_item`、`capture`、`active_review_required` are not v1 lifecycle states.
    - active ownership is derived from `当前状态` plus `生命周期状态`, not from suspended package presence.
    - suspended packages must carry review-ready recovery fields before they can be used as resume input.
    - `artifact_kind = interrupted` additionally requires checkpoint evidence, dirty attribution, environment state, and recovery strategy.
    - runtime lifecycle skills and guide / registry routing now consume this foundation contract through a dedicated runtime delivery contract; inbox / backlog artifacts and runtime manifest / install / health report contract remain outside scope unless a later task explicitly widens scope.
  - verification：`bun run gen:all`、`bun run test:workflow-all`、`bun run validate:protocol`、`bun run validate:freshness`、`bun run workflow:health --root .`

- 对象路径：CURRENT_TASK lifecycle runtime skills / resume review routing
  - assertions：
    - `pause-current-task` 与 `interrupt-current-task` 必须通过 fail-closed suspended-package transaction 写出完整 live `CURRENT_TASK.md` snapshot，不得只保留最小 marker。
    - `resume-paused-task` 与 `resume-interrupted-task` 只接受显式、无歧义、`ready_for_resume + recovery_only` 的恢复输入，不允许自动挑选 package。
    - resume 成功后固定 handoff 到 `review-current-task`；`review-current-task` 是 `恢复需审查`、`恢复审查原因` 与 rollback point 的首个强制消费者，不得在 review 前静默清 gate。
    - `WORKFLOW_GUIDE`、`SKILL_REGISTRY` 与对应 generated reference outputs 必须把四个 lifecycle runtime skill 暴露在 `阶段 7：状态同步`；registry summary 使用 branch-style routing 表达 suspend / resume 与 steady-state sync 的关系。
    - generated workflow skills、generated workflow guide 与 registry 只能由生成器同步。
  - verification：`bun run gen:all`、`bun run test:workflow-skills`、`bun run test:registry`、`bun run test:workflow-docs`、`bun run test:workflow-all`、`bun run validate:protocol`、`bun run validate:freshness`、`bun run workflow:health --root .`

- 对象路径：ownership-aware root-cause / regression / review-finding routing
  - assertions：
    - `investigate-root-cause`、`run-regression`、`sync-review-findings` 的 owner routing 必须收敛到 6 个 canonical route：`current_task_owned`、`scope_widening_candidate`、`resume_paused_required`、`resume_interrupted_required`、`new_bug_task_required`、`user_decision_required`。
    - 命中 paused / interrupted owner 候选时，3 个 skill 都必须先读取 `TASKS/paused/**` 或 `TASKS/interrupted/**` 中的 matching suspended package evidence，不得仅凭 package presence、运行时记忆或模糊相似性猜测 owner。
    - skill-local alias 只能映射到 canonical route 或 pre-routing state；恢复链只能通过 `resume_*_guard_passed` / `resume_*_guard_blocked` 进入，不得保留 `resume_*_required -> resume-*` 的一跳 handoff。
    - `run-regression` 的 `report-only` 仍是 terminal report；可以报告 `Recommended route` / `Recommended handoff`，但不得自动触发恢复或修复链。
    - `sync-review-findings` 只允许把 `current_task_owned` 且当前 Allowed Files 内可修的 mechanical implementation finding 写入当前 `CURRENT_TASK.md > 审查问题队列`；paused / interrupted / new bug / user decision findings 必须保持队列隔离。
    - `WORKFLOW_GUIDE` 必须显式说明：旧任务遗留 blocker 阻断当前 active task 时，先走 canonical route + active-owner guard；当前 live task 仍 active 时，必须先让用户决定是否 pause / interrupt 当前任务，再进入恢复链。
  - verification：`bun run gen:all`、`bun run test:workflow-skills`、`bun run test:registry`、`bun run test:workflow-docs`、`bun run test:workflow-all`、`bun run validate:protocol`、`bun run validate:freshness`、`bun run workflow:health --root .`

- 对象路径：capture-work-item / `TASKS/inbox/**` record-only intake
  - assertions：
    - `capture-work-item` 是 `阶段 1：需求进入` 的 record-only branch，不属于 `create-current-task` 主链；成功记录后默认回到 `ask-user`，不得自动 promote、切换当前任务或创建新任务。
    - `TASKS/inbox/INBOX-<YYYYMMDD>-<short-id>-<slug>.md` 是独立 inbox artifact family，用于记录已判断与当前 live task 无关的新事项；它不是 `TaskArtifactKind`、不是 lifecycle state、不是 paused / interrupted / archive package，也不纳入 `DOCUMENT_CATALOG.md`。
    - `capture-work-item` 只允许在 `relation_to_current_task = unrelated` 时写入 inbox artifact；`scope_widening_candidate` 必须转 `/lock-scope`，`uncertain` 和 duplicate-suspected 必须 fail-closed 到 `ask-user`。
    - capture 过程必须读取 live `CURRENT_TASK.md` 与现有 `TASKS/inbox/**` 做 title / slug / evidence 轻量 duplicate read-back；不得静默覆盖或继续写入疑似重复事项。
    - inbox artifact validation 必须拒绝非法 inbox path、缺少 required fields、inbox artifact 混入 `TASKS/paused/**` / `TASKS/interrupted/**` / `TASKS/TASK-*.md`，以及把 `capture` / `backlog_item` 写入 live `CURRENT_TASK.md` lifecycle state 的污染。
    - `WORKFLOW_GUIDE` 与 `SKILL_REGISTRY` 必须把 `capture-work-item` 表达成 record-only branch，并保持 `handoff.success = create-current-task` 只是 generator-compatible fallback，真实成功语义由 `conditional_handoff.capture_only = ask-user` 表达。
    - promote、prioritization、backlog grooming、`DOCUMENT_CATALOG.md` 收录、task identity 感知、runtime manifest / install / health report 扩面都不属于该契约；如后续需要，必须单独开任务并重新锁范围。
  - verification：`bun run gen:all`、`bun run test:workflow-skills`、`bun run test:registry`、`bun run test:workflow-docs`、`bun test test/run-validation.test.ts`、`bun run test:workflow-all`、`bun run validate:protocol`、`bun run validate:freshness`、`bun run workflow:health --root .`

- 对象路径：workflow vNext Phase 0 capability / compatibility shadow baseline
  - assertions：
    - `.workflow-system/WORKFLOW_CAPABILITIES.yaml` 必须保持 `status: shadow`，并声明 10 个候选 public entry、完整 mode、internal capability、Runtime operation 与 37 个 compat alias；compat alias name set 必须与实际 `templates/skills/*.SKILL.md.tmpl` name set 严格相等。
    - K/M/R/D 只表达迁移 disposition，不授予 exposure 或写权限；Phase 0 public / internal / runtime 固定不可安装，compat alias 继续保留现行可调用语义。
    - alias target dependency、legacy stage 与 write-class 必须由 validator 对照实际 template fail-closed 校验；只读 orchestration alias 不得被映射为 writer / repair mode。
    - Runtime operation 必须使用 `runtime-proposal-envelope`、canonical source / exact write allowlist、source tuple、authority evidence、conflict key 与 atomic fail-closed result contract；当前仅为声明，不存在可执行写事务。
    - 55 个 golden fixture ID 必须完整、唯一且可解析；Phase 1 行为推广前还必须补齐 branch-aware exact writes、handoff、diff target、terminal behavior 和 operation-specific source / write 约束。
    - capability manifest 不是当前 runtime source pipeline、target-project state 或 host install surface；不得形成第二状态源或绕过现行 37-Skill authority。
  - verification：`bun run test:workflow-capabilities`、`bun run test:workflow-skills`、`bun run validate:protocol`、`bun run validate:freshness`、`bun run test:workflow-all`、`bun run workflow:health --root .`

### compat path / wrapper rules

- stable source object：`workflow:install`
  - same-file reuse pattern：none approved for self-install
  - successor wrapper / compat object：future `workflow:self-sync` / `workflow:source-repair` only after protocol design
  - preserved direct entrypoints：external target install
  - decision rationale：avoid source/target ownership collision

### API change downstream validation

- hook：not-applicable
- store：not-applicable
- page：not-applicable
- widget：not-applicable
- form：not-applicable
- table：not-applicable
- detail view：not-applicable

### frozen zone / UI anchor migration

- frozen zone：
  - zone type：`fully-frozen`
  - protected siblings：`docs/workflow/generated/**`, `docs/workflow/SKILL_REGISTRY.md`
  - removal precondition：protocol/schema/templates/generator change plus freshness validation
- `UIAnchorReplacement`：
  - old_anchor：not-applicable
  - successor_anchor：not-applicable
  - transition_window：not-applicable
  - alias_policy：none
  - alias_details：not-applicable
  - relation_migration：not-applicable
  - removal_precondition：not-applicable
  - verification：not-applicable
