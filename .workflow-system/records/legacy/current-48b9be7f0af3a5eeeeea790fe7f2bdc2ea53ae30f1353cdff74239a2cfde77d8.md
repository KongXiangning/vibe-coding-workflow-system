# CURRENT_TASK.md

## 任务信息

- 项目：vibe-coding-workflow-system
- 项目类型：ai-engineering-workflow
- 任务 ID：010
- 任务标题：建立 workflow vNext capability contract 与 golden fixture 基线
- 任务 slug：workflow-vnext-capability-contract
- 当前状态：active
- 生命周期状态：active
- 恢复需审查：false
- 恢复审查原因：
- 当前 handoff：ask-user
- 创建时间：2026-08-30

## 背景与上下文

- 任务 `009` 已完成 37 个 workflow Skill 的 K/M/R/D 审计，用户已确认按推荐顺序继续。
- 推荐顺序的 Phase 0 是先让 public / internal / runtime / compat 能力在协议中可表示，并建立覆盖 37 个逐项 `MR-*` 和 18 个组合 `GR-*` 的 golden fixture 基线。
- 本任务不引入 facade 行为、不删除旧 Skill、不改变旧 handoff、registry、host sync、install、pack 或 generated reference 默认语义。
- 现有 37 个 Skill 必须继续作为当前 authoritative runtime surface；vNext capability surface 在本任务中只作为 additive、machine-readable、可验证的 shadow contract。

## 验收标准

- [x] `.workflow-system/WORKFLOW_PROTOCOL.md` 定义 public / internal / runtime / compat 四层 capability 语义、source precedence、authority boundary、terminal behavior、兼容规则和 no-second-state-source 约束。
- [x] `.workflow-system/FILE_SCHEMAS.md` 定义 capability manifest 与 golden fixture manifest 的最小字段、闭合集合、更新方向和 fail-closed 校验要求。
- [x] machine-readable capability manifest 表达 10 个候选公开入口、显式 modes、`covers_stages`、内部能力、Runtime operation 声明和 compatibility aliases。
- [x] 37 个现有 Skill name 全部且仅一次映射到 public entry / mode、internal capability 或 Runtime proposal route；本任务不移除任何旧 name。
- [x] 10 个当前 stage group 由 vNext `covers_stages` 完整覆盖，且覆盖可被 validator 机械证明。
- [x] golden fixture manifest 唯一覆盖 `MR-K01..K05`、`MR-M01..M20`、`MR-R01..R07`、`MR-D01..D05` 和 `GR-01..GR-18` 共 55 个 case。
- [x] 每个 fixture 至少记录 invariant、initial state、invocation、expected guard/verdict/writes/handoff/terminal behavior、diff target 和 evidence；不适用项必须显式标记而不是省略。
- [x] fail-closed validator 能拒绝重复/遗漏 alias、dangling target/mode/capability/runtime operation、stage coverage 缺口、非法 terminal handoff、fixture ID 缺口或重复、case 与 capability 不可解析映射。
- [x] capability test 接入现有 protocol quality path；`validate:protocol` 能运行该基线，同时不改变现有 generator 输出内容。
- [x] 现有 37 个 Skill、generated references、registry 和 host sync 结果保持不变；完整回归和 freshness 通过。

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
- Health checks: protocol validation、capability contract tests、full workflow regression、freshness、workflow health
- Canary window: not applicable
- Performance baseline: 记录新增 validator 的运行时间，不设产品性能阈值
- Rollback / recovery: 回退本任务新增 manifest/parser/test 和 protocol/schema 增量；保留任务 009 审计与现行 37-Skill surface。
- Release evidence: not applicable

## 允许修改范围

### Allowed Files

- `docs/workflow/CURRENT_TASK.md`
- `.workflow-system/WORKFLOW_PROTOCOL.md`
- `.workflow-system/FILE_SCHEMAS.md`
- `.workflow-system/WORKFLOW_CAPABILITIES.yaml`（新增）
- `scripts/workflow-capabilities.ts`（新增）
- `test/fixtures/workflow-capability-cases.yaml`（新增）
- `test/workflow-capabilities.test.ts`（新增）
- `package.json`

## 条件修改范围

### Conditional Files

- `docs/workflow/CONTRACTS.md`：仅当实现与回归证明 capability manifest / validator 已成为稳定长期边界时，补充 additive contract；不得改变现有 Skill/runtime contract。
- `docs/workflow/DECISIONS.md`：仅记录用户已确认的 contract-first、all-37-compatible、no-second-state-source 决策；不得提前确认 facade 默认推广或 alias 删除窗口。
- `docs/workflow/STATUS.md`：仅在本任务完成关键验证后同步任务 010 状态；任务 009 的 closure 同步已经完成。
- `.workflow-system/PROJECT_PROFILE.yaml`：只有现有 validation matrix 无法在不改变 layer/owner 语义的情况下执行 capability test 时才允许 additive protocol-level entry；优先复用现有 `workflow-skills-tests`。
- `test/run-validation.test.ts`：仅当新增 protocol-level validation entry 时补充矩阵回归；否则禁止修改。

## 禁止修改范围

### Forbidden Files

- `.git/**`
- `node_modules/**`
- `dist/**`
- `templates/skills/**`
- `templates/docs/**`
- `scripts/gen-workflow-skills.ts`
- `scripts/gen-workflow-docs.ts`
- `scripts/gen-registry.ts`
- `scripts/workflow-runtime.ts`
- `scripts/bootstrap-project-governance.ts`
- `scripts/task-identity.ts`
- `scripts/workflow-doc-contracts.ts`
- `scripts/validation-model.ts`
- `test/gen-workflow-skills.test.ts`
- `test/gen-workflow-docs.test.ts`
- `test/gen-registry.test.ts`
- `test/workflow-runtime.test.ts`
- `docs/workflow/generated/**`
- `docs/workflow/SKILL_REGISTRY.md`
- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `vibe-coding/**`
- `docs/product/**`

## 受影响的契约

- 本任务对 workflow-system 协议新增 capability migration contract，但保持现有 37-Skill contract 完全可用。
- `.workflow-system/WORKFLOW_CAPABILITIES.yaml` 是产品 capability/compat declaration，不承载目标项目 live task、status、contract 或 decision facts，因此不得成为第二项目状态源。
- 现行 source precedence、generated-only、source/target isolation、lifecycle、active ownership、finding admission、report-only、External Documentation Gate 和两层 validation 均保持不变。
- `package.json` 只允许 additive test command / existing test-chain integration；不得重命名或改变现有公开 CLI command 的语义。

## 已确认决策

- `Mechanical`：manifest/schema/parser/test 文件命名、YAML 解析、闭集/唯一性/引用完整性校验和测试组织可选择最小兼容实现。
- `Taste`：任务 009 提议的 10 个公开入口名称作为 Phase 0 shadow baseline 使用；本任务不将其推广为默认 host surface，也不声明最终数量永久冻结。
- `User challenge`：用户已确认“按推荐步骤继续”，本阶段据此采用 contract-first 顺序、保留全部 37 个旧 name、只声明 Runtime operation 而不实现状态写入、保持 host sync 默认暴露面不变。
- Compatibility policy：所有 37 个现有 Skill name 在 Phase 0 必须可解析且保持可调用；本任务不设置删除日期或自动弃用。
- Source of truth policy：canonical project facts 仍在现有 Markdown/YAML governance sources；capability manifest 只描述 workflow-system 产品能力与迁移映射。

## 待确认问题

- 无当前阻断项。
- Phase 1 是否立项由用户确认；推荐范围是 read-only facade shadow 与 semantic fixture strengthening，不进行 alias redirect、删除或 host 默认推广。
- Phase 1 gate 必须补齐：fixture `outcome/branch`；expected writes 与 mode/template/runtime 的精确一致性；严格 `/**` 通配符；handoff、diff target、terminal behavior 分支语义；Runtime operation-specific source / write 绑定。
- facade 默认推广、compat alias 退役窗口、Runtime 写事务 API、目标项目路径解析和 host sync public/internal 安装策略留给后续行为任务；本任务不得提前实现。

## 实现方案

- Goal: 在不改变现有 37-Skill 行为的前提下，建立可机器验证的 vNext capability/compat contract 和 55-case non-loss baseline。
- Architecture impact: 新增一个 protocol-owned manifest 与独立 validator/test；协议/schema additive 扩展；现有 generator/runtime/host surface 不变。
- Technical approach:
  - 用 `.workflow-system/WORKFLOW_CAPABILITIES.yaml` 声明 public entries、modes、internal capabilities、Runtime operations 和 37-name compat mapping。
  - 用 `test/fixtures/workflow-capability-cases.yaml` 承载 55 个 machine-readable golden case。
  - 用 `scripts/workflow-capabilities.ts` 解析并 fail-closed 校验两份 manifest，同时读取现有 skill template names 证明 37/37 compatibility coverage。
  - 在 `test/workflow-capabilities.test.ts` 覆盖合法基线与关键负例，并通过 `package.json` 把测试接入现有 protocol quality path。
- Alternatives considered:
  - 直接给 37 个 Skill frontmatter 增加新字段：本阶段拒绝，会制造 37 个 generated diff 并把 shadow contract 误变成 runtime 行为变更。
  - 直接修改 registry/host sync：本阶段拒绝，属于 Phase 1 之后的暴露面迁移。
  - 只保留 Markdown 审计表：拒绝，不能提供 fail-closed 引用、覆盖和 fixture 校验。
- Data / state flow: protocol/schema -> capability manifest + golden fixtures -> validator -> focused tests -> existing protocol quality path；不写 live project state。
- Compatibility: additive / backward-compatible；旧 name、旧 handoff、旧 generator outputs 和旧 install/sync 语义不变。
- Risks and rollback:
  - manifest 与现有模板漂移：validator 读取实际 template names 并要求一一覆盖。
  - 把 facade proposal 误当成默认 runtime：manifest 必须声明 shadow status，host/generator 文件列为 Forbidden。
  - fixture 只检查 ID 不检查语义：schema 要求 expected guard/verdict/writes/handoff/terminal/diff/evidence 字段并覆盖负例。
  - 回滚：删除新增 manifest/parser/test，撤回 protocol/schema/package additive change；现有执行面无需迁移回滚。
- Validation strategy: focused capability tests、现有 workflow skill tests、`validate:protocol`、`validate:freshness`、`test:workflow-all`、`workflow:health --root .`，并比较 generated/registry/host skill 文件零 diff。
- Open decisions: 后续 facade/runtime/host promotion decisions 均不在本任务内。
- Handoff: 完成 contract/fixtures/validator 后进入同一 diff target 的 review 与 regression；通过后停在 Phase 1 用户确认点。

## 审查问题队列

- Finding ID: `F-010-01`
  - Severity: major
  - Source: `review-implementation`
  - Status: resolved
  - File / symbol: `scripts/workflow-capabilities.ts > validateWorkflowCapabilityData`
  - Failure scenario: 直接调用 data-level validator 时省略 optional `templateContracts`，manifest 可在 legacy stage / write-class 与 target mode 漂移时仍返回成功；只有 file-level wrapper 会执行完整校验。
  - Minimal fix direction: 把 `templateContracts` 改为必填输入，由它派生 template name set；所有公开完整验证入口不得提供跳过 legacy contract check 的路径。
  - Required test: focused capability tests 继续通过，并新增/保留 data-level mutation 用例证明 stage/write-class drift 必须 fail-closed。
  - Handoff: `implement-current-step`
  - Resolution evidence: `templateContracts` 已改为 data-level validator 必填参数并作为 template name set 唯一来源；`bun run test:workflow-capabilities` 12 pass / 0 fail，standalone validator 通过。

## 传播治理记录

- change_start_set: `.workflow-system/{WORKFLOW_PROTOCOL.md,FILE_SCHEMAS.md,WORKFLOW_CAPABILITIES.yaml}`、`scripts/workflow-capabilities.ts`、`test/{fixtures/workflow-capability-cases.yaml,workflow-capabilities.test.ts}`、`package.json`。
- candidate_impact_set: protocol/schema consumers、source repo quality checks、future registry/host sync/facade/runtime consumers；本任务只实现前两项的 additive shadow contract。
- compatibility result: `backward-compatible`；旧 37-name surface 保留，新增 contract 不参与当前 handoff 执行。
- discovery evidence: 任务 009 审计、现有 37 个 Skill template、stage/handoff/generator/registry/runtime tests、AD-001..AD-011。
- union impact set: protocol、schema、manifest parser、test chain；templates/generator/registry/runtime/host/generated 属于 observed-but-forbidden downstream。
- observed contract drift: Protocol §17.4 记录 Codex `.agents/skills`，当前 runtime/tests/CONTRACTS 使用 `.codex/skills`；本任务不触碰 host sync，故只记录为独立后续 decision gate，不顺手修复。
- migration strategy: Phase 0 shadow contract -> Phase 1 read-only facade shadow -> 后续 state-changing slices；任一 hard invariant mismatch 立即停止推广。
- linked regression: `MR-K01..K05`、`MR-M01..M20`、`MR-R01..R07`、`MR-D01..D05`、`GR-01..GR-18`。

## 实施步骤

- [x] 步骤 1：稳定 protocol/schema 中 capability surface、compat alias 与 golden fixture contract。
- [x] 步骤 2：实现 10-entry / internal / Runtime / 37-alias machine-readable capability manifest。
- [x] 步骤 3：实现 55-case golden fixture manifest，补齐结构化 initial/expected evidence。
- [x] 步骤 4：实现 fail-closed parser/validator 和合法/非法 fixture 单元测试。
- [x] 步骤 5：接入现有 protocol quality path，证明现有 Skill/generator/registry/host outputs 零行为变化。
- [x] 步骤 6：完成 diff review、contract review、full regression、状态同步并停在 Phase 1 gate。

## 回归检查项

- [x] 10 个 public entry、全部 modes、internal capability 和 Runtime operation 的引用闭合。
- [x] 37 个 template name 与 37 个 compat alias 严格一一对应。
- [x] 10 个 current stage group 全覆盖，无未知 stage。
- [x] 55 个 fixture ID 完整、唯一且都能解析到 capability/invariant。
- [x] duplicate、missing、dangling、terminal-handoff、stage-gap 和 fixture-gap 负例均 fail-closed。
- [x] `bun run test:workflow-skills` 通过并实际包含 capability contract tests。
- [x] `bun run validate:protocol`、`bun run validate:freshness`、`bun run test:workflow-all`、`bun run workflow:health --root .` 通过。
- [x] `templates/**`、generated references、`SKILL_REGISTRY.md`、generator、runtime 和 host skill surface 零 diff。

## 回滚点

- Task start base：`f62a525f5e9990d62954627f5a77ef85155d07f1`，并保留任务 009 已审查的 product docs / archive / STATUS 工作区工件。
- Last reviewed checkpoint：任务 009 归档与 37/37 审计证据；未创建 git checkpoint。
- Current diff review target：相对 Task start base 的 working-tree，按本任务 `change_start_set` 路径限定；任务 009 已归档工件作为 pre-existing reviewed set 排除。

## 执行记录

- 2026-08-30：用户确认按任务 009 的推荐顺序继续；任务 009 已归档，创建任务 010。
- 2026-08-30：Phase 0 固定为 additive shadow contract；保留全部 37 个旧 Skill、旧 handoff、generator/registry/runtime/host surface，不进入 facade 行为实现。
- 2026-08-30：完成步骤 1。`WORKFLOW_PROTOCOL` 升级为 additive `0.4.0`，新增 §4c capability/compat/non-loss contract；`FILE_SCHEMAS` 新增 manifest/fixture schema、闭集和 fail-closed error categories。`bun run validate:protocol` 通过，现有 generator/registry 输出未修改。
- 2026-08-30：吸收 `luna_worker` 只读勘察结果：K/M/R/D disposition 与 exposure 分离；stage 改为 per-mode；authority boundary 改为四 owner 结构；Phase 0 public/internal/runtime 固定 `installable=false`，compat 固定 `installable=true` 且保留旧 handoff/writes。
- 2026-08-30：完成步骤 2。新增 `.workflow-system/WORKFLOW_CAPABILITIES.yaml` shadow manifest；机械校验确认 10 个 public entry、23 个 internal capability、10 个 Runtime operation、37 个 compat alias，K/M/R/D 数量为 5/20/7/5，alias 与 template name 严格相等，stage 与全部引用闭合。
- 2026-08-30：完成步骤 3。新增 `test/fixtures/workflow-capability-cases.yaml`；机械校验确认 37 个 row case 与 alias 双向一致、18 个 global case 完整，55 个 ID 无遗漏/重复/额外项，全部 capability refs 可解析。
- 2026-08-30：`luna_worker` 交叉审计发现 `continue-current-step` 与 `debug-and-fix-current-task` 不得直接映射到 writer/repair。新增 `execute-step:orchestrate`、`debug-task:orchestrate` 两个只读 shadow mode；补齐 lessons/findings legacy stage union、user-owned gate escalation，并强制 alias dependency set 与 target mode 完全一致。
- 2026-08-30：强化 Runtime declaration：统一 `runtime-proposal-envelope`、exact write allowlist、source tuple、authority evidence 与 conflict key；不实现任何状态写事务。
- 2026-08-30：完成步骤 4/5。新增 `scripts/workflow-capabilities.ts` 与 12 组正/负测试，接入 `test:workflow-skills`；该入口 28 个既有 Skill tests + 12 个 capability tests 全通过，`validate:protocol` 通过，forbidden downstream surface 零 diff。
- 2026-08-30：完成 diff / implementation / contract review。修复 `F-010-01`：data-level validator 不再允许省略实际 template contract 校验；复核后当前 Phase 0 无未解决 finding。
- 2026-08-30：`luna_worker` 第二轮只读复核确认 K/M/R/D 为 `5/20/7/5`，37 个 alias 的 capability/runtime/stage/write-class 差异为 0，55 个 fixture 无重复；最终 verdict 为 Phase 0 可收束、不可把 manifest 当成已实现 Runtime executor。
- 2026-08-30：完整回归通过：`test:workflow-capabilities` 12 pass / 0 fail（58 expectations），`test:workflow-all` 285 pass / 0 fail，`validate:protocol`、`validate:freshness` 与 `workflow:health --root .` 均通过；templates、generated references、registry、generator、runtime 和 host surface 零 diff。
- 2026-08-30：同步 `AD-012` 与 `DEFER-004`。Phase 0 完成并停在 Phase 1 用户确认门；下一阶段优先强化 branch-aware fixture 语义与 read-only equivalence，不做 alias redirect。
