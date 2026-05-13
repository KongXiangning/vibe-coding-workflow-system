# TASK-001-ctx7-skill-gate

## 任务元数据

- 项目：vibe-coding-workflow-system
- 项目类型：ai-engineering-workflow
- 任务 ID：001
- 任务标题：为核心实现与审查 skill 接入 ctx7 外部文档门禁
- 任务 slug：ctx7-skill-gate
- 开始时间：2026-05-12
- 结束时间：2026-05-13
- 最终状态：done / regression-passed

## 原始任务包快照

完整快照保留在本文档下方的 `## 归档快照：原 CURRENT_TASK.md` 章节。

## 实际改动摘要

- 代码：`test/gen-workflow-skills.test.ts` 增加核心 skill generated output 的 External Documentation Gate 覆盖测试。
- 模板：`templates/skills/{plan-implementation,implement-current-step,investigate-root-cause,review-implementation}.SKILL.md.tmpl` 加入条件性 `External Documentation Gate`。
- 生成产物：`docs/workflow/generated/workflow-skills/{plan-implementation,implement-current-step,investigate-root-cause,review-implementation}.SKILL.md` 随生成链同步。
- 治理文档：`STATUS.md`、`CONTRACTS.md`、`DECISIONS.md`、`LESSONS.md`、`AGENTS.md`、`CLAUDE.md` 已同步本轮稳定边界、决策、经验和宿主指引。

## 契约与决策记录

- 受影响契约：新增 `core skill External Documentation Gate` BehaviorContract。
- 新增或更新决策：`AD-004` 确认四个核心实现 / 审查 skill 使用条件性门禁；`DEFER-002` 明确本轮不把 external docs evidence 协议化。
- 保持不变的关键边界：不修改 `.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md`、`templates/docs/CURRENT_TASK.md.tmpl`；不把 ctx7 接入 `create-current-task`；generated reference outputs 继续只由生成链派生。

## 验证与交付证据

- 测试 / 验证：`bun run gen:workflow-skills --dry-run`、`bun run gen:registry --dry-run`、`bun run test:workflow-skills`、`bun run validate:protocol`、`bun run validate:freshness`、`bun run test:workflow-all`、`bun run workflow:health --root .` 均通过。
- review / QA：`review-diff` clean；`review-implementation` clean；`verify-contracts` passed；`run-regression` 使用 diff-aware mode，目标为 `working-tree`。
- 发布后验证：Release mode 为 `none`；Deploy source、Target environment、Health checks、Canary window、Performance baseline、Rollback / recovery、Release evidence、canary result、performance baseline result、rollback status 均为 not-applicable。
- remaining observation：外部 target repo 的历史安装版本与兼容窗口未知；generated workflow skill reference outputs 必须继续通过生成链维护。

## Lessons 回写

- 本任务新增经验：workflow 规则变更必须闭合模板、generated reference、测试、状态、契约、决策和宿主指引传播链；live governance docs 的修改范围需要在 `CURRENT_TASK.md` 显式放宽；模板变更后必须补 freshness closure。
- 需要延后补充的经验：暂无。

## 后续关联

- 后续任务：如要实现 target root guard，需单独创建新任务并锁定 `scripts/**`、`test/**`、协议和基线影响范围。
- 相关 issue / PR：无外部 issue / PR。
- 归档位置：`TASKS/TASK-001-ctx7-skill-gate.md`

## 归档快照：原 CURRENT_TASK.md

# CURRENT_TASK.md

## 任务信息

- 项目：vibe-coding-workflow-system
- 项目类型：ai-engineering-workflow
- 任务 ID：001
- 任务标题：为核心实现与审查 skill 接入 ctx7 外部文档门禁
- 任务 slug：ctx7-skill-gate
- 当前状态：regression-passed
- 创建时间：2026-05-12

## 背景与上下文

- 用户原始需求：先分析哪些 workflow skill 需要接入 ctx7，并明确不是把 ctx7 接入 `create-current-task`；现在先把“4 个主 skill 如何接入 ctx7 MCP 和 ctx7 skill / CLI”的需求生成任务。
- 问题陈述：当前 workflow skill 模板没有统一的外部文档门禁，容易在涉及第三方 library、framework、SDK、API、CLI tool 或 cloud service 时基于过期认知规划、实现、调试或评审。
- 最小可接受结果：在 4 个主 skill 中建立一致但分工明确的 ctx7 外部文档门禁：`plan-implementation`、`implement-current-step`、`investigate-root-cause`、`review-implementation`。
- 关联需求 / issue：无外部 issue；来自当前对话中的 ctx7 接入分析。

## 验收标准

- [x] `templates/skills/plan-implementation.SKILL.md.tmpl` 明确在技术方案依赖第三方库 / 框架 / SDK / API / CLI / cloud service 当前行为时触发 ctx7，并把外部文档 evidence 写入实现方案。
- [x] `templates/skills/implement-current-step.SKILL.md.tmpl` 明确编码阶段先复用 `CURRENT_TASK.md` 中已有 ctx7 evidence；补查阈值按“是否影响当前实现正确性”判断，只有 evidence 不足、新增 / 扩展 / 质疑第三方 API / 配置 / CLI current behavior，或错误可能来自第三方当前行为时才补查。
- [x] `templates/skills/investigate-root-cause.SKILL.md.tmpl` 明确调试阶段先收集 symptom / reproduction，再用 ctx7 验证第三方行为相关 root cause hypothesis，不允许用文档查询替代复现和证据链。
- [x] `templates/skills/review-implementation.SKILL.md.tmpl` 明确评审阶段用 ctx7 验证 diff 中第三方 API / 配置 / CLI / cloud service 用法，并把文档证据纳入 finding 或 clean 结论。
- [x] 四个主 skill 都显式声明同名 `External Documentation Gate`，共享一致的调用优先级和失败处理规则：ctx7 MCP -> 可确认 current docs 的 ctx7 / docs skill -> ctx7 CLI -> blocked reason。
- [x] 不把 `create-current-task` 改造成 ctx7 查询入口；它最多可在后续任务审查中记录“需要外部文档 evidence”。
- [x] 不手改 `docs/workflow/generated/**` 或 `docs/workflow/SKILL_REGISTRY.md`；如模板变更影响生成输出，必须通过生成命令更新。
- [x] 回归检查通过或记录明确 blocked reason，至少覆盖 workflow skill 生成 / freshness / 相关测试。

## 设计约束

- Design mode: none
- Design source: none
- Design acceptance: not-applicable
- Design evidence: not-applicable
- Design open decisions: none

## 发布后验证

- Release mode: none
- Deploy source: none
- Target environment: unknown
- Health checks: not-applicable
- Canary window: not-applicable
- Performance baseline: not-applicable
- Rollback / recovery: revert the task diff before merge if validation fails
- Release evidence: not-applicable

## 允许修改范围

- `templates/skills/plan-implementation.SKILL.md.tmpl`
- `templates/skills/implement-current-step.SKILL.md.tmpl`
- `templates/skills/investigate-root-cause.SKILL.md.tmpl`
- `templates/skills/review-implementation.SKILL.md.tmpl`
- `test/**`，仅限为上述模板行为补充或更新 workflow skill 生成 / registry / freshness 相关测试
- `docs/workflow/CURRENT_TASK.md`
- `docs/workflow/STATUS.md`，仅限记录本任务进入日常任务流后的当前状态、风险观察点和下一检查点
- `docs/workflow/LESSONS.md`，仅限 materialize workflow 必需的 lessons 占位结构；不得写入一次性聊天过程或未经复用验证的经验

## 条件允许修改范围

- `.workflow-system/WORKFLOW_PROTOCOL.md`：仅当模板新增的 ctx7 门禁字段、证据结构或工具调用规则需要协议层声明时允许修改。
- `.workflow-system/FILE_SCHEMAS.md`：仅当 `CURRENT_TASK.md` 或 generated docs schema 需要新增稳定字段时允许修改。
- `templates/docs/CURRENT_TASK.md.tmpl`：仅当决定把 `External docs evidence` 固化为任务包标准章节时允许修改。
- `scripts/**`：仅当现有生成器 / 校验器无法接受已确认的模板结构且需要同步规则时允许修改。
- `docs/workflow/generated/**` 与 `docs/workflow/SKILL_REGISTRY.md`：只能由生成命令更新，不得手工编辑。

## 范围锁定

- Safety mode: frozen-scope
- 锁定理由：任务目标集中在 4 个 workflow skill 模板的 ctx7 外部文档门禁；未明确允许的文件默认禁止修改。
- Allowed Files:
  - `templates/skills/plan-implementation.SKILL.md.tmpl`
  - `templates/skills/implement-current-step.SKILL.md.tmpl`
  - `templates/skills/investigate-root-cause.SKILL.md.tmpl`
  - `templates/skills/review-implementation.SKILL.md.tmpl`
  - `docs/workflow/CURRENT_TASK.md`
  - `docs/workflow/STATUS.md`
  - `docs/workflow/LESSONS.md`
- Conditional Files:
  - `.workflow-system/WORKFLOW_PROTOCOL.md`：仅当模板新增的 ctx7 门禁规则需要成为协议级规范时允许；必须说明新增协议段落、影响范围和验证命令。
  - `.workflow-system/FILE_SCHEMAS.md`：仅当新增稳定 evidence 字段或 CURRENT_TASK 结构需要 schema 支撑时允许；必须说明字段语义和兼容性。
  - `templates/docs/CURRENT_TASK.md.tmpl`：仅当确认 `External docs evidence` 成为标准任务章节时允许；必须同步 docs 生成验证。
  - `test/**`：仅限覆盖本任务模板行为、生成器兼容性、registry 或 freshness 检查；不得新增无关业务测试。
  - `scripts/**`：仅当生成器 / 校验器无法接受已确认模板结构时允许；必须先记录具体失败证据和最小脚本改动。
  - `docs/workflow/generated/**`、`docs/workflow/SKILL_REGISTRY.md`：仅允许由生成命令更新，禁止手工编辑。
- Forbidden Files:
  - `.git/**`
  - `node_modules/**`
  - `dist/**`
  - `package.json` scripts，除非后续明确发现验证入口缺失并重新锁定范围。
  - `AGENTS.md`、`CLAUDE.md`，除非后续确认需要通过 `sync-host-guidance` 同步项目级宿主规则并重新锁定范围。
  - `README.md`、`vibe-coding/**`、`docs/product/**`、`docs/guides/**`、`docs/ops/**`
  - 任何未列入 Allowed Files 或 Conditional Files 的 skill 模板。
- Dangerous surfaces:
  - generated/live docs 边界：不得手改 generated reference outputs。
  - source/target 身份边界：不得执行 `workflow:install --root .`。
  - workflow behavior drift：不得改变 handoff 图、skill 名称或 source repo CLI 语义。
  - protocol/schema drift：只有在必要且可验证时才触碰 `.workflow-system/**`。
- Unlock / widening conditions:
  - 必须回到 `/lock-scope`，不能在实现阶段直接越界。
  - 必须写明扩大原因、影响文件、风险、验证方式。
  - 必须重新生成 Allowed Files / Forbidden Files / Conditional Files。
  - 若触碰 `CONTRACTS.md` 锁定项或覆盖 `DECISIONS.md` 已确认决策，必须停止并先取得明确确认。

### 范围扩大记录：STATUS / LESSONS live governance docs

- 扩大原因：
  - `docs/workflow/STATUS.md` 是本 source repo 的 live governance 状态面；本任务从“后续创建 CURRENT_TASK”进入实际任务流后，需要同步当前任务状态、剩余风险和下一检查点，避免 STATUS 与 CURRENT_TASK 矛盾。
  - `docs/workflow/LESSONS.md` 是多个 workflow skill 的 required read；本任务执行早期已因该文件缺失阻塞，用户随后 materialize 了结构兼容的 lessons 文件。将其纳入本任务范围，是为了保留 required read 的治理基线，而不是记录一次性经验。
- 影响文件：
  - `docs/workflow/STATUS.md`
  - `docs/workflow/LESSONS.md`
- 风险：
  - live governance docs 可能被误用来承载产品、方法论或一次性对话内容，破坏 `docs/workflow/` 只承载治理管理面的目录职责。
  - `STATUS.md` 可能提前标记任务稳定，掩盖 `review-implementation` 模板尚未实施和完整步骤 9-11 尚未完成的事实。
  - `LESSONS.md` 若写入未经复用验证的内容，会降低 lessons 作为跨任务经验库的可信度。
- 验证方式：
  - 后续 `/review-diff` 必须确认 `STATUS.md` 仅记录本任务状态、风险和下一检查点，且没有覆盖 `CURRENT_TASK.md` 或 `CONTRACTS.md`。
  - 后续 `/review-diff` 必须确认 `LESSONS.md` 仅包含结构兼容的 lessons 占位或已确认可复用经验，不包含一次性聊天记录。
  - 回归仍以 `bun run gen:workflow-skills --dry-run`、`bun run gen:registry --dry-run`、`bun run test:workflow-skills`、`bun run validate:protocol`、`bun run validate:freshness` 为准；若后续认为 live governance docs 也需要更广覆盖，再运行 `bun run workflow:health --root .`。

## 禁止修改范围

- `.git/**`
- `node_modules/**`
- `dist/**`
- 不得为本任务修改业务无关 skill 模板。
- 不得手工编辑 `docs/workflow/generated/**` 或 `docs/workflow/SKILL_REGISTRY.md`。
- 不得执行 `workflow:install --root .`。
- `docs/workflow/STATUS.md` 和 `docs/workflow/LESSONS.md` 只允许本任务声明的 live governance 最小同步，不得承载产品、方法论、操作手册或未验证经验。

## 受影响的契约

- `templates/skills/**` 是 workflow skill template source；变更必须从模板开始。
- `docs/workflow/generated/**` 与 `docs/workflow/SKILL_REGISTRY.md` 是 generated reference outputs；只能通过生成器更新。
- `docs/workflow/STATUS.md` 与 `docs/workflow/LESSONS.md` 是 live governance docs；可记录本 source repo 治理状态和跨任务经验，但不得覆盖 `CONTRACTS.md` 锁定契约或 `DECISIONS.md` 已确认决策。
- source repo quality gate 使用 `validate:protocol`、`validate:freshness`、`test:workflow-all`、`workflow:health --root .` 等 source repo 检查，不绑定 target-project slots。

## 已确认决策

- ctx7 不作为 `create-current-task` 的主查询入口；本任务聚焦 4 个主 skill。
- 4 个主 skill 是：`plan-implementation`、`implement-current-step`、`investigate-root-cause`、`review-implementation`。
- 接入方式采用条件性 External Documentation Gate，而不是每次执行 skill 都强制查询 ctx7。
- 调用优先级为：优先 ctx7 MCP；没有 MCP 时使用可确认会获取当前文档的 ctx7 / docs skill；没有可用 skill 但宿主允许 shell / CLI 时使用 `ctx7` CLI；都不可用时记录 blocked reason，不能默默回退到训练数据判断当前 API 行为。

## 待确认问题

- 本轮不把 `External docs evidence` 固化为 `CURRENT_TASK.md` 标准章节；先作为 `实现方案` / `执行记录` / debug report / review report 内的结构化小节。
- 本轮不在 `.workflow-system/WORKFLOW_PROTOCOL.md` 中新增外部文档门禁规范段落；先只在四个模板中落地。
- 本轮不同步 `sync-host-guidance`，不修改 AGENTS.md / CLAUDE.md；宿主级规则传播另开任务或后续通过 `sync-host-guidance` 处理。

## 实现方案

- Goal: 为 4 个核心 workflow skill 增加一致的 ctx7 外部文档门禁，确保涉及第三方 library、framework、SDK、API、CLI tool 或 cloud service 当前行为时，方案、实现、调试和评审都有当前文档依据。
- Architecture impact:
  - 主要修改 `templates/skills/plan-implementation.SKILL.md.tmpl`、`templates/skills/implement-current-step.SKILL.md.tmpl`、`templates/skills/investigate-root-cause.SKILL.md.tmpl`、`templates/skills/review-implementation.SKILL.md.tmpl`。
  - 生成器、registry、generated workflow skills 是派生产物；不得从 `docs/workflow/generated/**` 反向维护规则。
  - 本轮默认不改 handoff 图、skill 名称、CLI 入口、`.workflow-system/WORKFLOW_PROTOCOL.md` 或 `.workflow-system/FILE_SCHEMAS.md`。
- Technical approach:
  - 在四个模板中显式加入同名 `External Documentation Gate`，不能只依赖 `plan-implementation` 传导给后续 skill；每个目标 skill 必须能在单独运行时识别 ctx7 触发条件、调用优先级、失败处理和 evidence 落点。
  - Gate 共享一致调用优先级：优先使用 ctx7 MCP；MCP 不可用时使用可确认会获取当前文档的 ctx7 / docs skill；没有可用 skill 且宿主允许 shell / CLI 时使用 `ctx7` CLI；全部不可用时记录 blocked reason，不得用训练数据默默替代当前文档。
  - 每个 skill 的落点不同：
    - `plan-implementation`：触发阈值是技术路线依赖第三方 current behavior；触发后主动按共享 gate 顺序取证，并把 evidence 摘要写入 `## 实现方案`。
    - `implement-current-step`：实现前先复用 `CURRENT_TASK.md` 既有 evidence；补查阈值按“是否影响当前实现正确性”判断，而不是按“是否出现第三方名词”判断。只有当前实现新增、扩展或质疑第三方 current behavior 时才补查 ctx7；若已有 evidence 足以覆盖本步 API / 参数 / 配置 / CLI 用法，则复用 evidence。
      - 必须补查：当前步骤新增第三方 API / SDK / CLI / config 用法且 `CURRENT_TASK.md` 没有对应 evidence；既有 evidence 只覆盖方案级选择但不覆盖实现所需参数、返回结构、配置字段、命令 flag 或版本约束；实现中发现第三方行为和原计划不一致；报错、类型不匹配、运行失败或测试失败可能来自第三方当前行为；使用认证、路由、构建配置、插件系统、云服务权限、SDK 初始化或 breaking-change 较多 API 等易变 surface；需要判断某写法当前是否仍受支持、是否 deprecated 或是否已有替代写法。
      - 可以不补查：`CURRENT_TASK.md` 已有 evidence 且当前实现完全落在 evidence 覆盖范围内；只是移动、封装或调用项目内已有第三方 wrapper，没有新增 API 面；修改纯业务逻辑、类型整理或局部重构，不依赖第三方当前行为；第三方用法已有项目内稳定先例且本步只是照同一模式使用，没有新增参数或配置。
      - 停止并回问 / 回到方案：补查后发现需要升级依赖版本、在官方 SDK 和 REST API 之间改路线、引入新库或替换既有库、改变架构边界 / 数据结构 / 用户行为 / 已锁定契约，或 ctx7 evidence 和当前计划冲突导致原实现方案不再成立时，不得在实现阶段自行决定，应停止并回到 `plan-implementation` / `ask-user`。
      - Evidence 落点：写入执行记录或本步验证记录，说明复用的 evidence 或补查得到的 current docs evidence。
    - `investigate-root-cause`：触发阈值是第三方行为相关 root cause hypothesis 需要验证；必须先收集 symptom / reproduction，再用共享 gate 验证假设；文档只能支持或否定假设，不能替代复现。
      - Evidence 落点：写入 debug evidence / 调查报告，和 symptom、reproduction、root cause hypothesis 形成证据链。
    - `review-implementation`：触发阈值是 diff 中第三方 API / 配置 / CLI / cloud service 用法需要审查；使用共享 gate 验证当前用法是否成立。
      - Evidence 落点：写入 finding 或 clean 结论，说明文档证据如何支持问题判断或通过判断。
  - `plan-implementation` 需要新增受控回问规则：纯 mechanical 的文档验证和项目既有技术栈用法可以自动取证并形成方案；若 ctx7 evidence 暴露多个会改变架构边界、产品行为、依赖版本、长期维护路径或用户已确认方向的候选方案，必须以 plan 形式回问用户确认，不能自行裁决。
  - 证据结构先作为模板中的报告/小节要求，不新增 `CURRENT_TASK.md` 标准章节；若后续生成器或审查证明需要 schema 化，再回到 `/lock-scope` 扩大范围。
- Alternatives considered:
  - 只改 AGENTS.md / CLAUDE.md：不足以约束 generated workflow skills，且当前 scope 已禁止宿主指引同步。
  - 接入所有 skill：范围过宽，会污染同步、归档、状态维护等治理类 skill。
  - 接入 `create-current-task`：与用户已确认方向冲突；任务创建只登记需求，不承担技术文档查询。
  - 协议化 `External docs evidence` 字段：更稳定但范围扩大到协议/schema/docs 模板；当前先采用模板级规则，后续如复用稳定再沉淀。
- Data / state flow:
  - 当前任务约束 -> 4 个 skill 模板 -> `gen:workflow-skills` 生成 reference skills -> `gen:registry` 更新 registry -> freshness / protocol / tests 验证。
  - ctx7 evidence 在任务执行时由对应 skill 写入方案、执行记录、debug report 或 review report；本轮不新增持久 DTO。
- Compatibility:
  - 保持现有 workflow handoff、skill 名称和 CLI 语义。
  - 对不涉及第三方当前行为的任务为 no-op，不要求额外查询。
  - 对缺少 ctx7 MCP / CLI 的宿主，行为是显式 blocked reason，而不是失败隐藏或离线推断。
- Risks and rollback:
  - 风险 1：四个模板的门禁文本漂移。缓解：使用同名小节和一致调用优先级。
  - 风险 2：规则太强导致纯内部任务被误阻塞。缓解：触发条件限定为第三方 current behavior。
  - 风险 3：生成输出变化未同步。缓解：运行生成和 freshness 校验。
  - 回滚方式：撤销本任务模板 diff，重新运行生成命令恢复 generated reference outputs。
- Validation strategy:
  - 先运行 `bun run gen:workflow-skills --dry-run` 验证模板 metadata、边界和 handoff。
  - 运行 `bun run gen:registry --dry-run` 验证 registry 仍可生成。
  - 若模板变更导致 generated reference outputs 变化，运行 `bun run gen:workflow-skills` 和 `bun run gen:registry`，不得手工编辑 generated 文件。
  - 运行 `bun run test:workflow-skills`、`bun run validate:protocol`、`bun run validate:freshness`。
  - 若只改模板文本且测试覆盖不足，至少补充人工 diff review，确认 4 个 generated skills 均包含门禁且无其它 skill 被改动。
- Open decisions:
  - `External docs evidence` 暂不协议化；若 review 或验证发现模板级小节不足，再重新锁定范围。
  - 暂不新增 `CURRENT_TASK.md` 标准章节；先让四个 skill 在各自报告区域记录 evidence。
  - 暂不同步 `AGENTS.md` / `CLAUDE.md`；宿主级规则同步另开任务或后续通过 `sync-host-guidance` 处理。
  - `plan-implementation` 的回问门禁本轮作为模板级行为规则落地；不引入新的长期决策文档，后续若多 skill 复用稳定再由 `sync-decisions` 沉淀。
- Handoff: 实现方案再审查通过；可进入 `/decompose-task`，不需要回到 `/lock-scope`。

## Skill 合理性审查

- Overall conclusion: 选择 `plan-implementation`、`implement-current-step`、`investigate-root-cause`、`review-implementation` 四个 skill 接入 ctx7 是合理的；它们分别覆盖方案形成、编码执行、异常定位、实现评审四个最容易依赖第三方 current behavior 的环节。
- `plan-implementation`: 合理，且需要更明确的取证和回问行为。该 skill 的职责是形成技术路线，若第三方 API / SDK / CLI / cloud service 当前行为影响方案，必须在进入分解前取得 current docs evidence；取证顺序为 ctx7 MCP -> 可确认获取当前文档的 ctx7 / docs skill -> `ctx7` CLI。若取证后仍存在多个会改变架构、行为、版本或长期维护路径的候选方案，应以 plan 形式回问用户确认，否则后续步骤会建立在不可靠或未确认的假设上。
- `implement-current-step`: 合理，但门禁应以复用已有 evidence 为主，补查阈值必须按“是否影响当前实现正确性”判断，而不是按“是否出现第三方名词”判断。该 skill 是唯一主要实现入口，适合在编码前检查 `CURRENT_TASK.md` 既有 evidence；若本步实现完全落在 evidence、项目内稳定 wrapper 或既有稳定先例覆盖范围内，则不补查；若新增 / 扩展 / 质疑第三方 API、参数、配置、CLI、版本约束或易变 surface，并可能影响实现正确性，则补查；若补查结果要求改变方案、依赖版本、架构边界或用户已确认方向，则停止并回到 `plan-implementation` / `ask-user`。
- `investigate-root-cause`: 合理，但必须保持“复现优先于文档查询”。该 skill 的核心职责是证据链和 root cause hypothesis，ctx7 只能用于验证第三方行为假设，不能替代 symptom、reproduction、日志、diff 或最小复现。
- `review-implementation`: 合理。该 skill 负责实现质量审查，适合把 ctx7 evidence 用于判断 diff 中第三方 API / 配置 / CLI / cloud service 用法是否正确，并把证据纳入 finding 或 clean 结论。
- `create-current-task`: 不接入为主查询入口是合理的。任务创建阶段只应记录“可能需要外部文档 evidence”的需求，不应过早查询具体第三方文档；否则会把需求登记和技术方案阶段混在一起。
- Shared rule shape: 四个 skill 应显式声明同名 `External Documentation Gate`，共享同一调用优先级和失败处理；不能只让 `plan-implementation` 传导给后续 skill。每个 skill 再声明自己的触发阈值和 evidence 落点：`plan-implementation` 写入实现方案，`implement-current-step` 写入执行记录，`investigate-root-cause` 写入 debug evidence，`review-implementation` 写入 finding 或 clean 结论。
- Decision classification: 当前选择属于 mechanical implementation policy，不改变产品行为、接口契约、数据结构或 handoff 图；`plan-implementation` 的回问规则用于捕获后续实际方案中的 Taste 或 User challenge，而不是在模板修订时预设具体技术选择。
- Residual risk: 最大风险不是选错 skill，而是门禁文本过宽导致内部任务被误阻塞；缓解方式是把触发条件限定为第三方 library / framework / SDK / API / CLI tool / cloud service 的 current behavior。
- Handoff: skill 合理性审查通过；下一步仍是 `/decompose-task`，把共享门禁和四个 stage-specific 落点拆成小步。

## 审查问题队列

- 当前来源：review-implementation
- Finding ID：RI-001
  - Severity：P2
  - Source：review-implementation
  - Status：resolved
  - File / symbol：`templates/skills/plan-implementation.SKILL.md.tmpl` / `External Documentation Gate`
  - Failure scenario：当 `External Documentation Gate` 已触发，但 ctx7 MCP、可确认 current docs 的 ctx7 / docs skill、ctx7 CLI 都不可用，或调用失败导致无法取得 current docs evidence 时，当前模板只要求记录 blocked reason，未明确禁止继续决定依赖第三方 current behavior 的技术路线；后续计划可能仍基于未验证的第三方当前行为展开。
  - Minimal fix direction：在 `plan-implementation` 的 gate 失败处理里明确：触发 gate 且无法取得 current docs evidence 时，不得继续决定第三方依赖技术路线；必须记录尝试过的通道、失败类型、受影响技术判断和 handoff。只有当受影响判断不是当前方案前置条件，或项目内已有稳定 wrapper / 已锁定契约足以覆盖当前判断时，才可继续，并写明 no-block reason。
  - Required test：重新检查 `templates/skills/plan-implementation.SKILL.md.tmpl` 中 `External Documentation Gate` 文本，确认包含“触发 gate 但无 evidence 时阻塞 / 不得继续决定技术路线”、blocked reason 必要字段、以及允许继续的例外条件；运行 `rg "External Documentation Gate|blocked reason|不得继续|current docs evidence|handoff" templates/skills/plan-implementation.SKILL.md.tmpl`。
  - Handoff：implement-current-step
  - Resolution：已在 `plan-implementation` 的 `External Documentation Gate` 中补充失败处理：触发 gate 但无法取得 current docs evidence 时，不得继续决定依赖第三方 current behavior 的技术路线；blocked reason 必须记录尝试通道、失败类型、受影响技术判断和 handoff；仅在不构成当前方案前置条件或已有稳定 wrapper / 锁定契约覆盖时可继续，并需写明 no-block reason。
- 当前来源：review-diff
- Finding ID：RD-002
  - Severity：P2
  - Source：review-diff
  - Status：resolved
  - File / symbol：`docs/workflow/STATUS.md` / task progress status
  - Failure scenario：`STATUS.md` 当前写着 `implement-current-step`、`investigate-root-cause`、`review-implementation` 模板仍未实施，并且下一检查点仍是步骤 5；但 `CURRENT_TASK.md` 已记录步骤 5 和步骤 6 完成，当前下一步应是步骤 7。该状态漂移违反范围扩大记录中的验证要求：`STATUS.md` 只能记录本任务状态、风险和下一检查点，且不能与 `CURRENT_TASK.md` 矛盾。
  - Minimal fix direction：把 `STATUS.md` 中任务状态、风险观察点、下一检查点和最近更新记录调整为当前事实：步骤 5 / 6 已完成，步骤 7 `review-implementation` 模板仍未实施，generated freshness 已恢复。
  - Required test：重新运行 `/review-diff`；并至少用 `rg "ctx7-skill-gate|步骤 7|review-implementation|freshness" docs/workflow/STATUS.md` 确认状态文本一致。
  - Handoff：implement-current-step
  - Resolution：已同步 `STATUS.md` 的任务状态、风险观察点、下一检查点和最近更新记录：步骤 5 / 6 已完成，步骤 7 `review-implementation` 模板仍未实施，前三个 generated reference outputs 已由生成器同步，`validate:freshness` 已恢复通过。
- 当前来源：review-implementation
- Finding ID：RI-002
  - Severity：P2
  - Source：review-implementation
  - Status：resolved
  - File / symbol：`docs/workflow/STATUS.md` / task progress status
  - Failure scenario：`STATUS.md` 仍声明只完成前三个模板、`review-implementation` 未实施，并把下一步指向步骤 7；但 `CURRENT_TASK.md` 已记录步骤 7 和步骤 8 完成。后续 agent 或人工若按 `STATUS.md` 继续执行，会重复处理已完成的 `review-implementation` 模板，并误判四模板一致性检查未完成。
  - Minimal fix direction：在当前 Allowed Files 内同步 `docs/workflow/STATUS.md`，把当前状态改为步骤 8 完成、步骤 9-11 待执行，并纳入 `review-implementation` generated output；不得写入产品、方法论或一次性聊天内容。
  - Required test：运行 `rg "步骤 8|步骤 9|review-implementation|ctx7-skill-gate" docs/workflow/STATUS.md` 或人工行号检查，确认 `STATUS.md` 与 `CURRENT_TASK.md` 的步骤 7 / 8 完成事实一致，且下一检查点指向步骤 9-11。
  - Handoff：implement-current-step
  - Resolution：已同步 `STATUS.md` 的任务状态、风险观察点、下一检查点和最近更新记录：四个目标模板均已完成，四模板一致性检查与最小生成测试已完成，`review-implementation` generated output 已纳入派生输出集合，下一步指向步骤 9-11 的生成 / registry dry-run、generated reference 确认和任务级回归。

## 传播治理记录

### change_start_set

- 对象路径：`templates/skills/plan-implementation.SKILL.md.tmpl`
- 对象类型：workflow skill template
- 变更起点语义：方案阶段外部文档门禁
- 对象路径：`templates/skills/implement-current-step.SKILL.md.tmpl`
- 对象类型：workflow skill template
- 变更起点语义：实现阶段外部文档门禁
- 对象路径：`templates/skills/investigate-root-cause.SKILL.md.tmpl`
- 对象类型：workflow skill template
- 变更起点语义：根因调查阶段外部文档门禁
- 对象路径：`templates/skills/review-implementation.SKILL.md.tmpl`
- 对象类型：workflow skill template
- 变更起点语义：实现评审阶段外部文档门禁

### discovery evidence

- `EvidenceRecord`：
  - mechanism：conversation-analysis
  - query_or_entrypoint：用户要求“实现部分 skill 接入 ctx7”，并确认 4 个主 skill 如何接入 MCP 和 skill / CLI
  - scope：workflow skill templates only
  - result_summary：ctx7 应作为条件性 External Documentation Gate 接入 4 个主 skill；create-current-task 不作为主查询入口。
  - confidence：high
  - gaps：尚未确认是否协议化 evidence 字段或同步宿主指引。

### aggregation / complexity

- `evidence_diff_threshold`：
  - absolute_diff：3
  - relative_diff_ratio：0.5
- `EvidenceAggregation`：
  - aggregation_strategy：union
  - candidate_impact_set：4 个主 skill 模板；条件影响协议/schema、测试、生成输出
  - significant_divergence：false
  - divergence_reason：not-applicable
  - unresolved_gaps：是否新增标准 evidence 章节；是否更新协议/schema
  - aggregated_confidence：high
- `over_limit_policy`：
  - threshold_trigger：not-triggered
  - selected_branch：direct-template-update
  - rationale：影响面可限制在 4 个模板和必要校验内
  - direct_consumers_semantics：generated workflow skills
  - total_candidate_consumers_semantics：host-installed workflow-system skills after sync
- `ComplexityAssessment`：
  - propagation_depth：template -> generated outputs -> host skills
  - direct_consumers：workflow skill generator
  - total_candidate_consumers：Codex / Claude / Factory host skill users
  - cross_boundary_hops：source repo -> generated reference -> host runtime install/sync
  - exceeded_metrics：none
  - threshold_status：within-limit
  - forced_strategy：none

### eligibility / candidate / registry

- `MutationEligibilityAssessment`：
  - common.object_path：`templates/skills/{plan-implementation,implement-current-step,investigate-root-cause,review-implementation}.SKILL.md.tmpl`
  - common.object_kind：workflow skill template
  - common.explicit_contract_state：allowed, generated outputs remain generated-only
  - common.discovered_direct_consumers：`scripts/gen-workflow-skills.ts`, `scripts/gen-registry.ts`
  - common.cross_boundary：yes, through generated skill bundle and host sync
  - common.critical_path_hit：yes
  - common.locked_hit_chain：template -> generator -> generated reference
  - common.registry_freshness：must-validate
  - common.rationale：模板是 workflow skill 行为源头，适合承载 ctx7 门禁规则。
  - when_pending_prerequisites.assessment_status：pending review-current-task
  - when_pending_prerequisites.blocking_gaps：确认协议/schema 是否需要变更
  - when_completed.assessment_status：to-be-filled
  - when_completed.eligibility：to-be-filled
- `implicit_shared_object_detection`：
  - object_path：External Documentation Gate rule text
  - object_kind：shared workflow behavior rule
  - direct_consumers：4 skill templates
  - cross_boundary：yes
  - critical_path_hit：yes
  - locked_hit_chain：generated skills
  - proposed_contract_state：candidate
  - writeback_required：possible protocol or decisions if stabilized
- `RegistryFreshnessReport`：
  - object_path：`docs/workflow/SKILL_REGISTRY.md`
  - registry_consumers：workflow users and audits
  - discovered_consumers：to-be-validated after generation
  - effective_consumers：to-be-validated after generation
  - freshness：pending regeneration after 2026-05-12 step 6 template change
  - reconciliation：step 6 `bun run gen:workflow-skills --dry-run` passed; full registry / freshness reconciliation remains for steps 9-11
  - divergence_summary：`templates/skills/implement-current-step.SKILL.md.tmpl` and `templates/skills/investigate-root-cause.SKILL.md.tmpl` changed after the previous fresh checkpoint; generated reference outputs must be reconciled by generator in the later generation step, with no hand edits.
- `EntityMutationChecklist`：
  - entity_name：ctx7 External Documentation Gate
  - covered_categories：skill templates, generated outputs, validation
  - unresolved_categories：protocol/schema permanence, host guidance sync
  - gap_resolution：
    - category：protocol/schema permanence
    - handling：review-current-task / plan-implementation 决定
    - blocker_error_code：none yet
- same-file wrapper / compat decision：
  - stable_source_object：existing skill handoff flow
  - successor_wrapper_or_compat_object：not-applicable
  - preserved_direct_entrypoints：existing workflow skill names
  - decision_rationale：新增条件性规则，不改 skill 名称或 handoff 图

### layout / behavior / migration / regression

- `LayoutContract`：
  - container_path：`templates/skills/`
  - machine_anchor：workflow skill template filenames
  - layout_model：one skill template per workflow behavior
  - locked_properties：generated outputs cannot be hand-edited
  - locked_relations：templates feed generated reference outputs
  - cascade_sources：`.workflow-system/WORKFLOW_PROTOCOL.md`, `.workflow-system/FILE_SCHEMAS.md`
  - sibling_reflow_sensitive：yes
  - insertion_guard：
    - mode：review-required
    - protected_siblings：unrelated skill templates
  - breakpoint_contracts：not-applicable
  - stacking_context：not-applicable
  - side_effect_scope：workflow behavior instructions and generated docs
- `BehaviorContract`：
  - object_path：ctx7 external documentation gate
  - assertions：
    - only triggers for third-party library/framework/SDK/API/CLI/cloud-service current behavior
    - all four target skills explicitly declare the same External Documentation Gate instead of relying on plan-implementation to propagate the rule
    - MCP is preferred when available
    - ctx7 / docs skill is fallback when MCP is unavailable and the skill can confirm current documentation lookup
    - ctx7 CLI is fallback when MCP / skill are unavailable and shell / CLI use is allowed by the host
    - unavailable docs must produce blocked reason, not unstated training-data fallback
    - plan-implementation asks the user before choosing among ctx7-backed alternatives that change architecture, behavior, dependency version, or long-term maintenance path
    - implement-current-step only performs supplemental lookup when third-party current behavior can affect current implementation correctness; existing sufficient evidence, stable local wrappers, pure business logic, and same-pattern reuse do not trigger lookup
    - implement-current-step stops instead of self-deciding when supplemental lookup implies dependency upgrades, SDK-vs-REST route changes, new/replaced libraries, architecture/data/behavior/contract changes, or conflict with the current plan
  - verification：template review, generated output review, workflow tests/freshness
- API downstream validation：
  - hook：not-applicable
  - store：not-applicable
  - page：not-applicable
  - widget：not-applicable
  - form：not-applicable
  - table：not-applicable
  - detail view：not-applicable
- `migration_plan_requirement`：
  - required：false
  - trigger_reason：conditional behavior text only; no persisted user data migration
- `StagedMigrationPlan`：
  - migration_id：not-applicable
  - phases：not-applicable
  - runtime_state：not-applicable
  - dependencies：not-applicable
  - verification：not-applicable
  - exit_criteria：not-applicable
- `LinkedRegressionRecord`：
  - regression_chain_id：not-applicable
  - current_issue：ctx7 not represented in core skill workflows
  - prior_fix_refs：none
  - window_scope：current task only
  - window_size：1
  - count_basis：conversation
  - linked_components：skill templates, generator outputs, registry
  - shared_objects：External Documentation Gate wording
  - relation：new enhancement
  - escalation：none

### blockers / gate status

- 当前执行步骤：implement-current-step
- 已完成 discovery：需求分析、候选 skill 分类、当前契约读取、范围锁定、LESSONS materialize、实现方案规划
- 剩余 blocker：
  - 无阻塞项；`External docs evidence` 协议化、`CURRENT_TASK.md` 标准章节和宿主指引同步均已作为本轮不做的范围外事项处理。
- `ContractCompatibilityResult`：
  - error_code：none
  - object_path：templates/skills/**
  - severity：none
  - default_blocker_level：none
  - evidence：CONTRACTS.md allows template-source changes and forbids generated hand edits
  - strategy_origin.over_limit_policy_branch：direct-template-update
  - strategy_origin.divergence_state：none
  - branch_gate_mapping.merge_gate：workflow generation and freshness validation
  - branch_gate_mapping.ship_gate：step 4 / RI-001 regression passed: `bun run test:workflow-skills`、`bun run validate:protocol`、`bun run validate:freshness`
  - branch_gate_mapping.rationale：generated/live boundary must stay intact
  - suggested_resolution：review task, lock scope, then update templates

### conformance / verification cases

- 输入场景：任务要求实现 ctx7 接入核心 skill
- discovery evidence：conversation-analysis + governance docs
- 期望 `ContractCompatibilityResult`：no contract break if generated outputs are not hand-edited
- 期望 gate / severity / `strategy_origin`：template-source change with generator/freshness validation

## 实施步骤

- [x] 步骤 1：运行 `/lock-scope`，锁定 4 个主模板及条件文件范围。
  - 输入：用户需求、允许 / 禁止修改范围、generated/live 边界。
  - 输出：`## 范围锁定`。
  - 验证：Allowed Files 仅包含 4 个目标模板和 `docs/workflow/CURRENT_TASK.md`，Conditional Files 已声明触发条件。
- [x] 步骤 2：运行 `/plan-implementation`，形成模板级 `External Documentation Gate` 方案。
  - 输入：`CURRENT_TASK.md`、`CONTRACTS.md`、`DECISIONS.md`、`LESSONS.md`、项目 profile。
  - 输出：`## 实现方案`、`## Skill 合理性审查`、BehaviorContract 记录。
  - 验证：已明确共享 gate、调用优先级、四个 skill 的触发阈值和 evidence 落点；无协议/schema 扩围。
- [x] 步骤 3：运行 `/decompose-task`，把模板变更拆成一轮一个模板 / 一类验证的小步。
  - 输入：已确认的实现方案、范围锁定、验证策略。
  - 输出：本实施步骤清单。
  - 验证：每步都有明确输入、输出和验证方式；未把四个模板修改混成单步。
- [x] 步骤 4：运行 `/implement-current-step` 修改 `templates/skills/plan-implementation.SKILL.md.tmpl`。
  - 子目标：加入同名 `External Documentation Gate`，明确技术路线依赖第三方 current behavior 时触发 ctx7，并写入 `## 实现方案`。
  - 必须包含：共享调用优先级 `ctx7 MCP -> 可确认 current docs 的 ctx7 / docs skill -> ctx7 CLI -> blocked reason`；ctx7 evidence 暴露架构、行为、依赖版本或长期维护分歧时，以 plan 形式回问用户。
  - 输入：`## 实现方案` 中的 `plan-implementation` 规则。
  - 输出：已修改 `templates/skills/plan-implementation.SKILL.md.tmpl` 和本执行记录。
  - 验证：`rg "External Documentation Gate|ctx7 MCP|docs skill|blocked reason|实现方案|ask-user" templates/skills/plan-implementation.SKILL.md.tmpl` 可定位关键规则。
- [x] 步骤 5：运行 `/implement-current-step` 修改 `templates/skills/implement-current-step.SKILL.md.tmpl`。
  - 子目标：加入同名 `External Documentation Gate`，明确优先复用 `CURRENT_TASK.md` 既有 evidence，并按“是否影响当前实现正确性”决定是否补查。
  - 必须包含：必须补查、可以不补查、停止并回到 `plan-implementation` / `ask-user` 的三类阈值；evidence 写入执行记录或本步验证记录。
  - 输入：`## 实现方案` 中的 `implement-current-step` 补查阈值。
  - 输出：已修改 `templates/skills/implement-current-step.SKILL.md.tmpl` 和本执行记录。
  - 验证：`rg "是否影响当前实现正确性|必须补查|可以不补查|plan-implementation|ask-user|External Documentation Gate" templates/skills/implement-current-step.SKILL.md.tmpl` 可定位关键规则；`bun run gen:workflow-skills --dry-run` 通过。
- [x] 步骤 6：运行 `/implement-current-step` 修改 `templates/skills/investigate-root-cause.SKILL.md.tmpl`。
  - 子目标：加入同名 `External Documentation Gate`，明确只有第三方行为相关 root cause hypothesis 需要验证时才查 ctx7。
  - 必须包含：先收集 symptom / reproduction；ctx7 只支持或否定 hypothesis，不能替代复现和证据链；evidence 写入 debug evidence / 调查报告。
  - 输入：`## 实现方案` 中的 `investigate-root-cause` 规则。
  - 输出：已修改 `templates/skills/investigate-root-cause.SKILL.md.tmpl` 和本执行记录。
  - 验证：`rg "External Documentation Gate|root cause hypothesis|symptom|reproduction|debug evidence|不能替代复现" templates/skills/investigate-root-cause.SKILL.md.tmpl` 可定位关键规则；`bun run gen:workflow-skills --dry-run` 通过。
- [x] 步骤 7：运行 `/implement-current-step` 修改 `templates/skills/review-implementation.SKILL.md.tmpl`。
  - 子目标：加入同名 `External Documentation Gate`，明确 diff 中第三方 API / 配置 / CLI / cloud service 用法需要审查时用 ctx7 验证。
  - 必须包含：evidence 写入 finding 或 clean 结论；不直接修改代码；仍沿用 review-diff 的 diff review target。
  - 输入：`## 实现方案` 中的 `review-implementation` 规则。
  - 输出：仅修改 `templates/skills/review-implementation.SKILL.md.tmpl` 和必要执行记录。
  - 验证：`rg "External Documentation Gate|finding|clean|diff|third-party|ctx7" templates/skills/review-implementation.SKILL.md.tmpl` 可定位关键规则。
- [x] 步骤 8：运行 `/implement-current-step` 做模板一致性与最小测试补充评估。
  - 子目标：检查四个模板 gate 文本是否共享同一调用优先级，触发阈值和 evidence 落点是否各自独立；仅当现有测试无法覆盖生成 / registry / freshness 行为时，才在 `test/**` 内补充最小测试。
  - 输入：四个模板 diff、现有测试覆盖。
  - 输出：已在 `test/gen-workflow-skills.test.ts` 补充最小生成测试，断言 4 个目标生成 skill 保留 `External Documentation Gate`、ctx7 MCP / current-docs skill / `ctx7` CLI / blocked reason 调用优先级和禁止训练数据回退规则。
  - 验证：`rg -n --glob "*.SKILL.md.tmpl" "^## External Documentation Gate$|ctx7 MCP -> 可确认 current docs 的 ctx7 / docs skill -> ctx7 CLI -> blocked reason" templates/skills` 通过；`## External Documentation Gate` 只命中 4 个目标模板。`bun test test/gen-workflow-skills.test.ts` 通过，23 tests passed。
- [x] 步骤 9：运行生成 / 注册表 dry-run 验证。
  - 子目标：确认模板元数据、handoff、registry 仍可生成。
  - 输入：四个模板变更。
  - 输出：验证结果记录。
  - 验证：`bun run gen:workflow-skills --dry-run`、`bun run gen:registry --dry-run` 均通过。
- [x] 步骤 10：如 dry-run 显示 generated reference outputs 需要更新，运行生成命令。
  - 子目标：只通过生成器更新 `docs/workflow/generated/**` 和 `docs/workflow/SKILL_REGISTRY.md`。
  - 输入：dry-run 输出。
  - 输出：四个目标 generated workflow skill 已由生成链派生更新；当前 dry-run / freshness 确认无需额外写入。
  - 验证：`bun run validate:freshness` 通过；generated 文件保持生成器派生产物，未手工编辑 `docs/workflow/SKILL_REGISTRY.md`。
- [x] 步骤 11：运行审查和回归。
  - 子目标：完成 `/review-diff`、`/review-implementation`、`/verify-contracts`、`/run-regression`。
  - 输入：当前 diff、验证命令。
  - 输出：审查结论、契约验证、回归结果。
  - 验证：`review-diff` clean、`review-implementation` clean、`verify-contracts` 通过；`bun run test:workflow-skills`、`bun run validate:protocol`、`bun run validate:freshness`、`bun run test:workflow-all`、`bun run workflow:health --root .` 均通过。

## 回归检查项

- [x] `bun run gen:workflow-skills --dry-run`
  - Latest run：2026-05-13 步骤 9 通过，Generated 31 workflow skills dry-run。
- [x] `bun run gen:registry --dry-run`
  - Latest run：2026-05-13 步骤 9 通过，Generated workflow skill registry dry-run。
- [x] `bun run test:workflow-skills`
  - Latest run：2026-05-13 步骤 11 通过，23 tests passed，1741 expect() calls。
- [x] `bun run validate:protocol`
  - Latest run：2026-05-13 步骤 11 通过，Protocol: PASSED，No gates blocked。
- [x] `bun run validate:freshness`
  - Latest run：2026-05-13 步骤 11 通过，workflow-skills / workflow-docs / registry 均 fresh。
- [x] 如生成输出发生变化，运行对应生成命令并确认没有手工编辑 generated 文件。
  - Latest run：2026-05-13 步骤 10 确认四个目标 generated workflow skill 已由生成链派生更新；`bun run validate:freshness` 通过，`docs/workflow/SKILL_REGISTRY.md` 未出现在 diff 中。

## 回滚点

- Task start base：e878a687
- Last reviewed checkpoint：not-yet-created
- Current diff review target：working-tree

## 执行记录

- 2026-05-12：使用 `create-current-task` 生成 CURRENT_TASK.md 初稿；未进入实现。
- 2026-05-12：使用 `lock-scope` 锁定范围；Safety mode 设为 `frozen-scope`，后续实现默认只允许修改 4 个主 skill 模板和 `docs/workflow/CURRENT_TASK.md`，条件文件必须满足触发证据后才能修改。
- 2026-05-12：尝试进入 `plan-implementation`；因 required read `docs/workflow/LESSONS.md` 不存在，按 skill 规则停止，未更新实现方案、未修改代码。
- 2026-05-12：根据 `bootstrap:project-governance` 输出修正任务 ID 为 `001`，满足 task identity 要求的零填充十进制字符串格式。
- 2026-05-12：用户 materialize `docs/workflow/LESSONS.md` 后重新运行 `bootstrap:project-governance`，task identity 已 materialized，`LESSONS.md` 已 materialized 且 structure-compatible。
- 2026-05-12：完成 `plan-implementation`；确定本轮采用模板级 `External Documentation Gate`，不协议化 evidence、不新增 `CURRENT_TASK.md` 标准章节、不同步宿主指引。
- 2026-05-12：再次审查 `plan-implementation` 结果；确认当前方案不触发扩大范围、协议/schema 变更或宿主指引同步，handoff 仍为 `/decompose-task`。
- 2026-05-12：完成四个目标 skill 的合理性审查；确认接入点覆盖方案、实现、调试、评审四个第三方 current behavior 风险点，`create-current-task` 不作为主查询入口。
- 2026-05-12：按用户反馈修订 `plan-implementation` 方案细节；明确 ctx7 调用顺序为 MCP -> 可确认 current docs 的 ctx7 / docs skill -> CLI，并新增技术路线存在架构、行为、版本或长期维护分歧时的 plan 形式回问门禁。
- 2026-05-12：按用户反馈修订 `implement-current-step` 补查阈值；明确按“是否影响当前实现正确性”触发 ctx7，而不是按第三方名词触发，并规定补查结果改变方案、依赖、架构、数据、行为或契约时停止回到 `plan-implementation` / `ask-user`。
- 2026-05-12：按用户反馈修订共享 gate 传导规则；明确四个目标 skill 都必须显式声明同名 `External Documentation Gate`，共享 ctx7 MCP -> current-docs skill -> CLI -> blocked reason 的调用优先级，并分别声明触发阈值和 evidence 落点。
- 2026-05-12：完成步骤 4 `/implement-current-step`；在 `templates/skills/plan-implementation.SKILL.md.tmpl` 中加入 `External Documentation Gate`，明确 plan 阶段触发条件、ctx7 MCP / current-docs skill / CLI / blocked reason 调用优先级、evidence 写入要求和需要用户确认的回问规则。
- 2026-05-12：处理 `RI-001`；补强 `templates/skills/plan-implementation.SKILL.md.tmpl` 的 gate 失败处理，明确无 current docs evidence 且影响技术路线前置判断时必须阻塞，不得继续把未验证第三方 current behavior 写入方案或交给 `decompose-task`。
- 2026-05-12：完成步骤 4 / `RI-001` 后的审查与局部回归：`review-diff` clean、`review-implementation` clean、`verify-contracts` 通过；`bun run gen:workflow-skills --dry-run`、`bun run gen:registry --dry-run`、`bun run test:workflow-skills`、`bun run validate:protocol`、`bun run validate:freshness` 均通过。
- 2026-05-12：回归过程中生成链派生更新 `docs/workflow/generated/workflow-skills/plan-implementation.SKILL.md`；该文件变更来自模板生成结果，不是手工编辑。后续步骤 7-8 仍未执行，任务级回归检查项保持未勾选，需在四个模板全部完成后重新运行并最终确认。
- 2026-05-12：完成步骤 5 `/implement-current-step`；在 `templates/skills/implement-current-step.SKILL.md.tmpl` 中加入 `External Documentation Gate`，明确实现前优先复用 `CURRENT_TASK.md` 既有 evidence，补查阈值按“是否影响当前实现正确性”判断，并写明必须补查、可以不补查、停止回到 `plan-implementation` / `ask-user`、失败 blocked reason 和 evidence 写入执行记录的规则。最小验证：关键字 `rg` 通过，`bun run gen:workflow-skills --dry-run` 通过；generated reference outputs 待后续步骤统一确认 / 生成。
- 2026-05-12：完成步骤 6 `/implement-current-step`；在 `templates/skills/investigate-root-cause.SKILL.md.tmpl` 中加入 `External Documentation Gate`，明确必须先收集 symptom / reproduction / 日志 / diff 或最小复现，只有第三方行为相关 root cause hypothesis 需要验证时才查 ctx7，且 ctx7 evidence 只能支持或否定 hypothesis，不能替代复现和证据链。最小验证：关键字 `rg` 通过，`bun run gen:workflow-skills --dry-run` 通过；generated reference outputs 待后续步骤统一确认 / 生成。
- 2026-05-13：根据 `/run-regression` 发现的 freshness stale，运行 `bun run gen:workflow-skills`，仅通过生成器同步 generated reference outputs；`bun run validate:freshness` 随后通过。此记录只关闭当前 stale 问题，不替代后续第 4 个目标模板完成后的完整生成 / 审查 / 回归。
- 2026-05-13：根据 `/review-diff` 范围发现和用户明确指示，重新运行 `/lock-scope` 扩大范围，将 `docs/workflow/STATUS.md` 与 `docs/workflow/LESSONS.md` 纳入本任务 Allowed Files，并补充扩大原因、影响文件、风险和验证方式；仍保持 `frozen-scope`，未放宽 generated/live 边界、source/target 隔离或协议/schema 触碰条件。
- 2026-05-13：处理 `RD-002`；同步 `docs/workflow/STATUS.md` 的任务进度、风险观察点、下一检查点和最近更新记录，使其与 `CURRENT_TASK.md` 中步骤 5 / 6 已完成、步骤 7 待执行、freshness 已恢复的事实一致。
- 2026-05-13：完成步骤 7 `/implement-current-step`；在 `templates/skills/review-implementation.SKILL.md.tmpl` 中加入 `External Documentation Gate`，明确 review 阶段在 diff 中出现第三方 API / 配置 / CLI / cloud service current behavior 用法时触发 ctx7，current docs evidence 写入 finding 或 clean 结论，且不得把未验证第三方 current behavior 当作 clean 依据。最小验证：关键字 `rg` 通过，`bun run gen:workflow-skills --dry-run` 通过；当时 generated reference outputs 待后续步骤 9-10 统一确认 / 生成，后续已在步骤 10 确认 fresh。
- 2026-05-13：完成步骤 8 `/implement-current-step`；四个目标模板均显式声明同名 `External Documentation Gate`，共享 ctx7 MCP -> current-docs skill -> `ctx7` CLI -> blocked reason 的调用优先级，并分别保留 plan / implement / investigate / review 的独立触发阈值和 evidence 落点。因现有测试只覆盖生成结构与 handoff，新增 `test/gen-workflow-skills.test.ts` 最小断言，防止目标生成 skill 丢失 gate、调用优先级或禁止训练数据回退规则。最小验证：`rg` 一致性检查通过，`bun test test/gen-workflow-skills.test.ts` 通过，23 tests passed。测试的 `beforeAll` 通过生成器同步了 `docs/workflow/generated/workflow-skills/review-implementation.SKILL.md`；当时完整步骤 9-11 仍需继续执行，后续已完成。
- 2026-05-13：处理 `RI-002`；同步 `docs/workflow/STATUS.md` 的任务状态、风险观察点、下一检查点和最近更新记录，使其与 `CURRENT_TASK.md` 中步骤 7 / 8 已完成、步骤 9-11 待执行、四个目标 generated workflow skill 均已派生更新的事实一致。External Documentation Gate：本次仅同步项目内治理状态，不涉及第三方 current behavior，未触发 ctx7 补查。
- 2026-05-13：完成步骤 9 `/run-regression` 生成 / 注册表 dry-run 验证；`bun run gen:workflow-skills --dry-run` 通过，Generated 31 workflow skills；`bun run gen:registry --dry-run` 通过，registry dry-run 可生成。
- 2026-05-13：完成步骤 10 generated reference 确认；四个目标 generated workflow skill 已由生成链派生更新，当前 `bun run validate:freshness` 确认 workflow-skills / workflow-docs / registry 均 fresh，`docs/workflow/SKILL_REGISTRY.md` 未出现在 diff 中。未手工编辑 generated reference outputs。
- 2026-05-13：完成步骤 11 审查与回归；`review-diff` clean，`review-implementation` clean，`verify-contracts` 通过。`run-regression` 使用 diff-aware mode，目标为 `working-tree`；`bun run test:workflow-skills`、`bun run validate:protocol`、`bun run validate:freshness`、`bun run test:workflow-all`、`bun run workflow:health --root .` 均通过。Browser/session、visual evidence、release evidence 均为 not-applicable。External Documentation Gate：本次同步与回归只涉及项目内 workflow 模板、生成器和治理状态，不依赖第三方 current behavior，未触发 ctx7 补查。Handoff：`sync-status`。
