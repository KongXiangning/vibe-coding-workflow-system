# WORKFLOW_GUIDE.md

## 使用规则

- 本文件说明 workflow-system 的日常操作顺序：什么时候读哪些治理文档、什么时候调用哪些 skill。
- 本文件只解释使用方法，不定义字段、章节、错误码或 gate 语义。
- 详细文档结构以 `.workflow-system/FILE_SCHEMAS.md` 为准；skill 的 reads / writes / handoff 以对应 `SKILL.md` 为准。
- 如果本文件与 `.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md` 或具体 skill frontmatter 冲突，以规范源和 skill frontmatter 为准。
- `generated/workflow-skills/**` 与 `generated/workflow-docs/**` 是 source-repo reference render，不是安装到 target project 后的 live runtime artifacts；target repo 会在 install / sync 时按自己的 `.workflow-system/PROJECT_PROFILE.yaml` 重新渲染。

## 文档速查

| 文档 | 作用 | 主要使用时机 |
| --- | --- | --- |
| `STATUS.md` | 当前项目状态、稳定模块、风险和下一检查点 | 开始任务前、任务结束后 |
| `ROADMAP.md` | 里程碑、当前窗口、候选事项和跨阶段风险 | 规划阶段、排优先级时 |
| `CURRENT_TASK.md` | 本轮任务目标、范围、验收、设计约束、发布后验证、回归和执行记录 | 每轮工作前、每步完成后 |
| `CONTRACTS.md` | 稳定接口、架构边界、目录职责和不可破坏约束 | 实现前、审核前、契约复核前 |
| `DECISIONS.md` | 已确认的架构、产品、口味、暂缓和否决决策 | 涉及选择、取舍或改方向时 |
| `LESSONS.md` | 可复用经验、踩坑记录和触发信号 | 调试前、复盘时、遇到类似问题时 |
| `BASELINES.md` | 发布、兼容、安全、部署、性能和 gate 基线 | 涉及发布 gate、兼容窗口或非功能要求时 |
| `TASK_SUMMARY.md` | 交付摘要结构参考 | 交付前准备摘要时 |
| `TASK_ARCHIVE.md` | 任务归档结构参考 | 任务完成后、追溯历史时 |

## Skill 速查

| 场景 | 使用 skill | 主要读取 | 主要产出 |
| --- | --- | --- | --- |
| 新项目设计基线 | `/design-baseline-init` | 原始需求、用户目标、技术栈偏好、交付约束 | `ROADMAP.md`、`ARCHITECTURE.md`、`DATABASE.md`、`docs/designs/**`、`BASELINES.md` / `DECISIONS.md` 草案 |
| 初始化新项目治理基线 | `/greenfield-init` | 已确认设计基线、用户目标、技术栈偏好、`.workflow-system/PROJECT_PROFILE.yaml` scaffold | 首版 `.workflow-system/PROJECT_PROFILE.yaml`、`AGENTS.md`、`CLAUDE.md`、`ROADMAP.md`、`CONTRACTS.md`、`BASELINES.md`、`STATUS.md`、`DECISIONS.md` |
| 老项目事实盘点 | `/legacy-inventory` | 由 profile / 仓库事实确定的代码目录、README/docs、package scripts、数据库和部署线索 | `ARCHITECTURE.md` 当前事实版、`DATABASE.md`、`docs/adoption/**`、`ROADMAP.md` 缺口草案 |
| 接管老项目治理基线 | `/adopt-existing-project` | `legacy-inventory` 产物、现有仓库事实、用户确认信息 | 首版 `.workflow-system/PROJECT_PROFILE.yaml`、`AGENTS.md`、`CLAUDE.md`、`ROADMAP.md`、`CONTRACTS.md`、`BASELINES.md`、`STATUS.md`、`DECISIONS.md`，必要时更新 `docs/adoption/ADOPTION_REPORT.md` |
| 创建任务包 | `/create-current-task` | `.workflow-system/PROJECT_PROFILE.yaml`、`CONTRACTS.md`、`STATUS.md`、`DECISIONS.md`、用户需求 | `CURRENT_TASK.md` |
| 审查任务包 | `/review-current-task` | `CURRENT_TASK.md`、`.workflow-system/PROJECT_PROFILE.yaml`、`CONTRACTS.md`、`DECISIONS.md`、`STATUS.md` | 修订后的任务边界、验收、设计约束和风险 |
| 锁定范围 | `/lock-scope` | `CURRENT_TASK.md`、`CONTRACTS.md`、`DECISIONS.md` | Safety mode、Allowed Files、Forbidden Files、Conditional Files、Dangerous surfaces、Unlock / widening conditions |
| 分类决策 | `/classify-decisions` | `CURRENT_TASK.md`、`DECISIONS.md` | Mechanical / Taste / User challenge 分类 |
| 拆解步骤 | `/decompose-task` | `CURRENT_TASK.md`、`CONTRACTS.md`、`DECISIONS.md` | 小步实施计划 |
| 调查根因 | `/investigate-root-cause` | `CURRENT_TASK.md`、代码和日志线索 | Symptom、Reproduction、Root cause hypothesis、Evidence、Minimal fix path、Regression check |
| 实现当前步骤 | `/implement-current-step` | `CURRENT_TASK.md`、`CONTRACTS.md`、`DECISIONS.md`、`LESSONS.md` | 代码改动、dangerous command gate、验证结果、执行记录 |
| 审查 diff | `/review-diff` | `CURRENT_TASK.md`、`CONTRACTS.md`、`DECISIONS.md`，以及当前 diff 上下文 | scope drift / decision drift / safety boundary review / 回归风险 |
| 验证契约 | `/verify-contracts` | `CONTRACTS.md`、`CURRENT_TASK.md`，以及当前 diff 上下文 | 接口和架构契约检查结果 |
| 执行回归 | `/run-regression` | `CURRENT_TASK.md`、`.workflow-system/PROJECT_PROFILE.yaml`，以及当前验证上下文 | QA mode、Target surface、Checks run、Browser/session requirement、Release evidence、Findings、Pass / fail、Evidence、Handoff |
| 同步任务记录 | `/sync-current-task` | `CURRENT_TASK.md`、本轮执行/验证事实 | 更新后的 `CURRENT_TASK.md` |
| 同步契约 | `/sync-contracts` | `CURRENT_TASK.md`、`CONTRACTS.md`、本轮稳定边界事实 | 新稳定边界记录 |
| 同步决策 | `/sync-decisions` | `CURRENT_TASK.md`、`DECISIONS.md`、用户确认事实 | 新确认决策记录 |
| 同步宿主指引 | `/sync-host-guidance` | `.workflow-system/PROJECT_PROFILE.yaml`、`AGENTS.md`、`CLAUDE.md`、以及已确认项目级约束 | 更新后的 `AGENTS.md` / `CLAUDE.md` |
| 同步状态 | `/sync-status` | `CURRENT_TASK.md`、`STATUS.md`、验证事实 | 更新后的项目状态 |
| 交付摘要 | `/prepare-delivery-summary` | `CURRENT_TASK.md`、`STATUS.md`、验证/同步事实 | 交付摘要内容，不自动写文件 |
| 捕获经验 | `/capture-lessons` | `CURRENT_TASK.md`、`LESSONS.md`、验证/复盘事实 | `LESSONS.md` 更新建议 |
| 归档任务 | `/archive-task` | `CURRENT_TASK.md`、`STATUS.md`、交付摘要事实 | `TASKS/TASK-{{TASK_ID}}-{{TASK_SLUG}}.md` 和下一轮入口建议 |

## 标准任务流程

0. 初始化完成后进入日常任务链路：新项目先走 `/design-baseline-init` → `/greenfield-init`，老项目先走 `/legacy-inventory` → `/adopt-existing-project`。
1. 先读 `STATUS.md` / `ROADMAP.md`，确认当前任务是否处在正确窗口。
2. 用 `/create-current-task` 创建 `CURRENT_TASK.md`。
3. 用 `/review-current-task` 收敛目标、验收、风险和范围。
4. 用 `/lock-scope` 明确 Safety mode、`Allowed Files`、`Forbidden Files`、`Conditional Files`、Dangerous surfaces 和受影响契约。
5. 用 `/classify-decisions` 识别哪些决策可自动处理，哪些必须用户确认。
6. 用 `/decompose-task` 拆成一次只做一个当前步骤的小步计划。
7. 每一步用 `/implement-current-step` 实现，并把执行记录写回 `CURRENT_TASK.md`。
8. 每步后用 `/review-diff`、`/verify-contracts`、`/run-regression` 做范围、契约和回归复核；`/run-regression` 必须先选择 QA mode。UI / 登录 / 表单 / 路由 / 状态流任务必须考虑 browser-backed smoke；UI / 视觉任务必须有 Design mode、Design source、Design acceptance、Design evidence 或 blocked reason；发布 / 部署 / canary / benchmark 任务必须有 Release mode、Deploy source、Target environment、Health checks、Rollback / recovery、Release evidence 或 blocked reason。如果测试或验证失败且根因不明确，先进入 `/investigate-root-cause`，不要直接修代码。
9. 用 `/sync-current-task`、`/sync-status`、必要时 `/sync-contracts` / `/sync-decisions` / `/sync-host-guidance` 同步治理事实。
10. 交付前用 `/prepare-delivery-summary`，交付后用 `/capture-lessons` 和 `/archive-task` 完成沉淀。

## 按场景选择

| 场景 | 推荐入口 |
| --- | --- |
| 新项目只有产品想法，尚无架构/数据库/详细设计 | `/design-baseline-init` → `/greenfield-init` |
| 空仓库或无实现但已有确认设计基线 | `/greenfield-init` |
| 已有代码但无 workflow 治理基线，尚未完成事实盘点 | `/legacy-inventory` → `/adopt-existing-project` |
| 已有代码且已完成事实盘点 | `/adopt-existing-project` |
| 新需求进入 | `/create-current-task` |
| 任务范围太大或不清楚 | `/review-current-task` → `/lock-scope` |
| 需要多个模块联动 | `/classify-decisions` → `/decompose-task` |
| 从零建立设计系统或视觉方向 | `/create-current-task` → `/review-current-task`，在 `设计约束` 中选择 `design-system` |
| UI 方向不确定，需要多方案探索 | `/decompose-task` 拆出 `exploration` 步骤；有工具则使用设计生成 / comparison board，否则记录人工参考或 blocked risk |
| 已批准 mockup / 参考图需要转实现 | `/implement-current-step` 执行 `design-to-code`，只实现已确认设计 |
| 实现后需要视觉 QA | `/run-regression` + `/review-diff` 执行 `visual-qa` 和 design drift review |
| 需要配置部署或发布基线 | 更新 `BASELINES.md` 的发布 / 部署 / 性能可靠性基线，任务中记录 `Deploy source` |
| 发布前 readiness 检查 | `/run-regression` 使用 `release-readiness`，核对 CI、release gate、Rollback / recovery |
| 部署后 health check | `/run-regression` 使用 `deploy-verification`，输出 deploy log、health check 或 blocked reason |
| 上线后 canary 观察 | `/run-regression` 使用 `canary`，输出 canary window、采样结果、失败阈值和默认动作 |
| 性能基线对比 | `/run-regression` 使用 `benchmark`，输出 baseline source、指标、阈值和对比证据 |
| 高风险任务涉及生产、数据库、权限、认证、支付、部署、迁移、批量删除、force push 或历史重写 | `/lock-scope` 选择 `guarded` |
| 只允许改一个模块 | `/lock-scope` 选择 `frozen-scope`，并在 `CURRENT_TASK.md` 写明允许/禁止范围 |
| 需要危险命令或高影响操作 | `/implement-current-step` 执行 dangerous command gate |
| 需要解除或扩大修改范围 | 回到 `/lock-scope`，重新记录原因、影响文件、风险、验证方式和三类范围 |
| 不确定 bug 根因 | `/investigate-root-cause` |
| 测试失败但原因不明 | `/investigate-root-cause` |
| 回归验证失败 | `/investigate-root-cause` |
| 实现过程中出现异常 | `/investigate-root-cause` |
| 连续修复没有收敛 | `/investigate-root-cause` |
| 问题可能来自范围外系统或架构边界 | `/investigate-root-cause` |
| 代码已经改完，需要检查是否越界 | `/review-diff` |
| 担心破坏稳定接口或架构边界 | `/verify-contracts` |
| 需要证明本轮没回归 | `/run-regression`（默认 `diff-aware`） |
| 小任务或低风险改动只需快速验证 | `/run-regression`（`quick-smoke`） |
| 大任务、UI/交互或高传播面改动 | `/run-regression`（`full-qa`） |
| 只允许报告问题，不允许修复 | `/run-regression`（`report-only`） |
| 需要验证登录态页面或权限流 | `/run-regression`（`authenticated-browser`，先确认 session/cookie 可用） |
| 有 baseline、截图或历史报告需要前后对比 | `/run-regression`（`regression-baseline`） |
| 项目级 AI 协作规则、统一命令入口或宿主说明变了 | `/sync-host-guidance` |
| 任务完成但状态文档未同步 | `/sync-current-task` → `/sync-status` |
| 任务可以交付 | `/prepare-delivery-summary` → `/archive-task` |

## 越界处理

- 如果实现需要修改 `CURRENT_TASK.md` 的 `Allowed Files` / `Conditional Files` 之外的文件，停止当前实现并回到 `/lock-scope`。
- 未明确允许的文件默认禁止修改。
- workflow-system 不依赖 native hook；即使没有 shell 拦截器或 session-level freeze，也必须按 Safety mode、mutation scope 和 dangerous command gate 执行。
- workflow-system 不绑定具体设计生成工具、comparison board、Pretext 或 browse daemon；`DESIGN.md` 只能作为 optional source，不加入 required reads。
- workflow-system 不绑定部署平台、canary daemon、benchmark 工具、Lighthouse 或 Web Vitals runner；真实 merge、push、deploy 和监控轮询只能由宿主、CI/CD 或项目工具执行，并作为 Release evidence 写回任务。
- UI / 视觉任务如果没有 `DESIGN.md`、mockup、截图或参考链接，必须进入 `design-system` 或 `exploration`，不能直接实现。
- 没有 deploy baseline、health endpoint、production URL、deploy log 或性能 baseline 时，发布后验证必须输出 blocked risk，不能把任务标记为已稳定。
- 实现阶段不得静默更换字体、颜色、布局、动效、品牌语气或整体视觉方向。
- 高风险任务应在 `/lock-scope` 选择 `guarded`；只允许改一个模块时选择 `frozen-scope`。
- 危险命令必须在 `/implement-current-step` 先说明 command、risk、target、rollback/recovery、scope check 和 confirmation，不能伪装成普通 Bash 操作。
- 解除或扩大范围必须回到 `/lock-scope`，不能在实现过程中直接修改未授权文件。
- 如果实现需要改变 `CONTRACTS.md` 中锁定边界，先记录决策并获得确认。
- `CURRENT_TASK.md` 不能覆盖 `CONTRACTS.md`；`DECISIONS.md` 只记录原因和历史，不单独定义当前有效规则。
- 如果实现依赖 Taste 或 User challenge 决策，先通过 `/classify-decisions` 暴露并确认。
- 如果 diff 已经越界，先用 `/review-diff` 标记越界文件，再决定回滚、拆任务或扩大范围。
- `/run-regression` 是只读验证入口；`report-only` 模式只输出问题和证据，不进入实现或修复。
- 需要登录但 session/cookie 不可用时，验证结论必须标记为 blocked，不得把未验证页面记为通过。
- workflow-system 不绑定具体 browse daemon；如果项目有浏览器工具或宿主支持浏览器能力，应执行 browser-backed smoke，否则记录人工验证项或 blocked risk。

## 交付检查

- `CURRENT_TASK.md` 的验收标准已满足。
- 实际改动文件没有未解释的 scope drift。
- Safety mode、Dangerous surfaces、Unlock / widening conditions 已说明。
- 没有未说明的 dangerous command、deployment 或 database surfaces。
- UI / 视觉任务的 Design mode、Design source、Design acceptance、Design evidence、Design open decisions 已说明。
- 视觉结论有截图、mockup、人工验收记录、browser-backed smoke 或 blocked reason 支撑。
- 发布后验证的 Release mode、Deploy source、Target environment、Health checks、Canary window、Performance baseline、Rollback / recovery、Release evidence 已说明。
- 发布结论有 CI、deploy log、health check、截图、监控链接、manual note 或 blocked reason 支撑。
- `CONTRACTS.md`、`DECISIONS.md`、`STATUS.md` 中需要同步的事实已同步。
- 回归检查项已有执行结果。
- QA mode、Target surface、Checks run、Browser/session requirement、Findings、Pass / fail、Evidence、Handoff 已说明。
- 交付摘要已能说明目标、结果、范围、验证和剩余风险。
- 可复用经验已写入或建议写入 `LESSONS.md`。
