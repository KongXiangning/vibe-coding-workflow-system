# 本次重构交接记录

**最新交接（2026-09-13）：迁移器、必要契约与回归的源码修订已完成；真实 alpha 本轮未改动，整体迁移仍待从恢复后的旧基线重新验证。本轮不支持已是 vNext 的补齐迁移。两个历史暂停包及未完成义务仍按原文保留，待单独处理。未 commit、push 或发布。**

S0 核实日期：2026-09-11；审查修订：2026-09-12。S1–S5 已实施；本会话累计审查发现 1 个 P1 和 3 个 P2，用户已授权修复，结果见末尾；具体落地范围见末尾实施记录，本文件不替代产品 canonical 状态或用户执行授权。

**0.17.0 阶段增量（历史记录）：Runtime 按需上下文与 rg 检索已实施为本地 0.17.0；当时完整回归 534 pass / 0 fail。该阶段接口与后续 dogfood、提交记录见下文，不代表当前完成状态。**

**2026-09-12 用户最新执行约束：本次纠偏明确不使用旧治理渠道。** 此指令覆盖 PLAN §7、CONTEXT 和各 step 中会导向旧治理链的执行要求；不得调用旧 close/archive/create/lock-scope，不为本轮恢复旧 host skills，也不迁移、归档或手改任务 010。后续源码切片按用户直接指定的步骤及精确文件范围执行，不以旧任务所有权或旧/新治理回执作为源码开发的前置条件；产品 Runtime 的契约、验证与真实 dogfood 要求保持不变。用户先后单独授权 S1–S5，并于累计 diff 审查后明确授权修复四项 finding；本轮限这四项及必要回归、生成同步，不自动发布或推进其它任务。

## 实际基线与写入边界（S0 快照；S1 增量见末尾）
- 根目录：`E:\coding\vibe-coding-workflow-system`；分支 `main`；HEAD / 历史参考均为 `166d2ce0f6ce76fe666b94c5181b23a252b9be1e`，相关路径比较无差异。
- 开始时 staged=0、tracked unstaged=0；13 个 untracked 文件全部属于本计划包，都是调用前已有内容，不能当成本轮新建或删除。未 reset、clean、stash、restore、commit、push。
- 实际指令：根 `AGENTS.md`、`CLAUDE.md`；已检查 `E:\`、`E:\coding` 祖先，没有额外 AGENTS/CLAUDE；仓库未发现下级同名指令。两处 FREEZE_REGISTRY 均不存在，本轮三个目标文件无 `@frozen` / `DO NOT MODIFY` 标记。
- 本次用户明确指定的 S0 设计文档写入：本包 `HANDOFF.md`、对应 `MANIFEST.json` 校验项，以及直接相关 `docs/designs/workflow-vnext-test-strategy-runtime-review-discussion.md` 的方向替代说明；不将这份文档授权扩展为 Runtime 实施授权。
- 源码仓库现存 `.workflow-system/WORKFLOW_PROTOCOL.md`（0.4.0）、`FILE_SCHEMAS.md` 和 Profile `paths.workflow_home=docs/workflow`；`CURRENT_TASK.md` 是 **pre-vNext 旧格式任务 010 / active + active / handoff=ask-user**。该状态仅作真实基线保留；依用户最新指令，不据此要求先结束旧任务或走旧治理链，不直接用新 Runtime 推进或手改它。
- 读到的 vNext Source/Runtime Contract 均为 `schema_version: 1 / Phase 2`；bootstrap Protocol/File Schema 及 canonical task/runtime envelope 也为 schema 1。`resolveTestStrategyExecutionContext` 返回的 `legacy` 仅指已解析 vNext task 缺 Test Strategy，不能与前一条旧文档格式混同。
- `VERSION`、根/package/runtime/distribution package、Runtime lock、contract package_version、源码/生成 CLI 常量均为 **0.15.3**；本机 Bun `1.3.10`、Node `v24.12.0`。生成 CLI 已存在，SHA-256=`4ed0ac53419d1f471c15bed25e74bcd669b16e2ee95ab34a30d808c3f2b6c1a7`，S0 未重建。
- 本地 `packages/vibe-governance/payload/distribution-manifest.json`：版本 `0.15.3`，digest=`a1b931924196f1b63728a87d0c05989db61be3e90fdab038f3638450abbcaf9d`；逐项 payload checksum 核对无漂移。
- 已确认消费者 `E:\coding\dogfood\fixflow`：HEAD=`61f196183aecdf4bd99441b3823b8f0c6cb17815`，分支 `dogfood/round8-v0153`；安装版本 `0.15.3`，installed_at=`2026-09-10T07:05:43.912Z`，digest=`c84320fdd14f679fec1d78e6db92315909c3269db192249788de037bf08430d5`；已读其 AGENTS/CLAUDE。
- FixFlow 受管文件与安装清单 checksum 全部吻合，但与本地同版本包有 **9 项内容差异**：三个 Skill（execute-step / prepare-task / review-change）、Protocol、File Schema、Runtime Contract、Runtime `dist/cli.js`、`src/kernel.ts`、`src/mutation-scope.ts`。安装 CLI 未命中本地 mandatory Red 两条检查文本，仍有单槽限制；不得只凭 0.15.3 认定它已运行本地 Step 3。
- FixFlow 当前 vNext 任务 `001 / implement-fixflow-ticket-creation-and-single-ticket-retrieval-api` 为 **closed + archived / ticket-api-tests completed**，无 active owner；source revision=`2ce6a42ab9aea277d04c3129843e7c7892dad15d9ecbfd7986963841167ef9e1`。既有 unstaged：`AGENTS.md`、`docs/workflow/CURRENT_TASK.md`；untracked：`TASKS/`。全部保留，未启动服务、测试、升级或清理。其他安装实例及 npm 发布现状未核实。
## 步骤状态
| 步骤 | 本次状态 | 进入后续切片前的边界 |
|---|---|---|
| S0 | 两项 P1 及计数修订后的快照已获本会话收窄复审 clean；本次另按用户指令纠正治理路线 | clean 仅覆盖当时两项接口修复与校验，不代表 Runtime 已实现，也不是当前新快照的全量复审 |
| S1 | 已实施；本会话后续审查记录两项 P2，用户同意不阻断 S2；两项在 S2 集成处理 | 版本感知 replan no-op 与关闭恢复 fixture 已修复并回归；S1/S2 均不可单独分发 |
| S2 | 已实施；两项审查问题已修复，本会话收窄复审 verdict=clean（171 pass / 0 fail） | 多槽、版本/报告、前置消费、共享完成及 P-12 已接通；限制见末尾 |
| S3 | 已实施；S5 聚合回归通过，独立累计总审待执行 | 稀疏检查点、累计目标与语义 assessment 一起接通；repair verification 保留 |
| S4 | 已实施；S5 聚合及真实服务 retry 通过，独立累计总审待执行 | 同计划环境 retry 接通；原失败/预算/幂等耐受日志淘汰 |
| S5 | 实施验证完成：完整聚合 528 pass / 0 fail，真实隔离 HTTP/SQLite dogfood 通过 | caller-reported assurance；本地 0.16.0 分发，真实安装未升级；独立总审待执行，不标 independent clean |
## 已冻结接口（S1–S5 已落地；实际验证和限制以末尾为准）
| 接口 | 确定的字段、落点与规则 |
|---|---|
| 无固定顺序 | `kernel.ts::TEST_STRATEGY_MODES/readTestStrategyDefinition` 增 `flexible`；普通可执行任务 inferred-default 使用它。保留 `source/source_ref/task_classification/rationale` 和优先级；not-applicable 仍要求 non-executable-change。implementation-first 要有具体实现/探索前置依据，不能冒充默认出口。 |
| 顺序执行 | `executionPhaseForStrategy` 为新语义增加 `flexible` / `test-first` 非 Red 阶段，通常 `required_outcome=implemented`；`assertPreparedTestStrategy/assertTestStrategySequenceReady/assertTestStrategyExecutionTransition` 不再按 index 推导 Red 或全任务 tests-only。显式测试代码/复现前置绑定下述 slot `before_step_id`，S1 对 test-first/implementation-first 返回 `TEST_STRATEGY_PREREQUISITE_UNSUPPORTED`，S2 闭环；expected-failure 只证明获准复现，不完成正向 acceptance。 |
| 版本边界 | 新 prepare/raw create-draft 由 Runtime 写入 canonical `runtime_state.business_evidence_version: 1`，调用方无需新增顶层输入；S1 标记仅代表新顺序语义，S2 才扩展证据输入。未知版本读取即拒绝，update/confirm 不静默补标记，明确授权的 commit-replan 可采纳新语义。缺标记的 vNext 内部旧记录保留读取/历史归档核验，不自动增标记、claim、成功报告或清 review；新 Runtime 执行旧 active task 返回 `TASK_SEMANTICS_UPGRADE_REQUIRED`，由旧安装完成，或通过明确确认的 replan 转换。旧格式项目仍是 Migration Pack 的 idle-only 边界，不能用本标记迁移任务 010。 |
| 新 prepare 输入 | `PrepareTaskSemanticDraft` 新语义以 `claim_evidence: ClaimEvidenceRecord[]` 取代自由 `acceptance: string[]` 输入；`DraftTaskDefinition.acceptance` 由 acceptance claims 渲染，raw draft 必须校验投影一致，不形成第二套可独立改写的验收。非空计划、至少一个 acceptance、每 claim 非空 slots。 |
| Claim 定义 | 复用 `claim_id/claim_kind/slots`，增加 `requirement/source_ref`（明确要求及 Task Basis/权威来源坐标）；身份使用现有 raw Runtime 可接受的任务内稳定 ID，不按文字匹配或数组位置重编号。相同 ID 不得偷换要求；草稿更换义务须显式替换身份并丢弃旧结果，确认后只能 replan。 |
| Slot 定义 | 复用 `slot_id/minimum_type/disposition/evidence_refs`，增加 `due_step_id`、`applicability: current/before-step`、`check`、可空 `report`。仅 before-step 要求 `before_step_id` 和 Runtime-owned、初始为空的 `prerequisite_receipt`；其到期步骤不得晚于所约束步骤。current 槽不接收这两个字段；正向 acceptance 必须用 current，不能改标 before-step 逃避新版本验证。新计划禁用 planned-validation；沿用 focused-test、integration-smoke、browser-session-check、static-proof 等具体类型，不设强弱总序。 |
| Check 定义 | 每 slot 首版一个 `check:{check_id,method,entry,expected_observation,required_boundaries,allowed_substitutes,subject_paths,expected_result}`；method=`execution/static/human`；entry 是已批准命令/验证入口或静态/人工对象，expected_result=`passed/accepted/expected-failure`。check_id 在任务内唯一；一次运行可经多条明确映射报告支持多个 check，不能共享 ref 自动扩散。 |
| 计划版本 | `runtime_state.evidence_plan_revision` 由 Runtime 对冻结 claim/slot/check 定义（含 applicability、due_step_id、before_step_id）、策略、步骤/命令、scope、持久测试准入计算 SHA-256；排除 disposition/report/prerequisite_receipt/执行审计。保留现有 preflight `plan_revision=stepPlanRevision(stepPlan)` 作为步骤级防陈旧字段，二者不与 CURRENT_TASK source revision 混用。 |
| 结果写入 | 保留 execute 输入名 `acceptance_evidence`，元素改为 `{claim_id,slot_id,check_id,minimum_type,disposition,evidence_refs,report}`；所有 claim_kind 都按身份受理。`normalizeAcceptanceEvidence/updateClaimEvidence` 只合并已冻结槽结果；拒绝未知/重复身份、错槽、重定义计划及用 command passed 代替 check 报告。 |
| Report | `report:{result_id,status,evidence_plan_revision,subject_revision,actual_method,environment,assurance}`；status=`passed/failed/blocked/not-run/skipped/accepted/expected-failure`。`result_id` 绑定这一报告和定位；产物定位复用 slot.evidence_refs，不重复存两套 refs；Runtime 把 caller report assurance 固定为 `caller-reported`，自报 trusted/runtime-local/ci 不提升。每 check/命令级报告，不声称逐用例覆盖。 |
| 非执行结果 | static/human 依已确认受理策略使用 accepted 和可核验来源，不捏造退出码；人类验收必须来自现有可验证授权渠道，模型自称“人类通过”不可接受。项目要求更高 assurance 或来源不可验证时 blocked；正向 acceptance 不允许 expected-failure。 |
| 报告上下文读取（审查修复） | 安装版 Runtime `evidence-context`，stdin `{}`。返回 task_id/document_id/evidence_plan_revision、checks[{claim_id,slot_id,check_id,subject_revision,subject_snapshot}]、committed=false、evidence_assurance=caller-reported。执行检查后取当前声明对象版本，提交仍重新核验；不写报告/基线/前置回执，不授予编辑或完成权限。 |
| 对象适用性 | `check.subject_paths` 为冻结、精确的可读对象集合，含相关实现、测试、fixture/helper 和执行配置；复用 `captureReviewTarget` manifest，其 revision 绑定 report.subject_revision。提交报告时都校验当前对象；current 槽在到期完成/关闭时再次重算，相关变化或影响不明则失效重跑。before-step 槽在消费前也受此检查，消费后仅证明该历史边界，后续实现变化不改写已履行的前置事实，不能用它满足 current 槽。仅审计修订不失效；不声称捕获未申报路径或全过程。 |
| 前置消费 | S2 在所约束步骤**首次准入、编辑之前**，由 Runtime 重新核验已报告结果、计划和对象指纹，并原子写入该槽 `prerequisite_receipt:{step_id,preflight_id,result_id,subject_snapshot}`；subject_snapshot 复用 Runtime 捕获的 ReviewTarget，须匹配 check 路径集合及 report.subject_revision，step_id 必须等于 before_step_id。仅下述 record-step-preflight 可生成 receipt；调用方/raw proposal 不得提供或补造。消费后 receipt、所绑定 report/disposition/refs 不可覆盖，重放保持原记录；同计划同 step 的 retry 保留这一首次准入事实。 |
| 共享完成函数 | 扩展并导出 `kernel.ts::evaluateClaimEvidence`，增加 root/current 和 `due-step/preflight/close` 上下文；`validateClaimEvidence/assertClaimEvidencePlanPreserved` 强化定义与报告绑定，删除 adapter 的重复 `claimEvidenceComplete`。raw step-progress、recordStepResult、completeReviewedStep、task-complete、closureEligibilityBlockers 共用。到期且未消费的 before-step 报告须匹配当时对象；所约束步骤准入及后续执行必须已有合法消费记录，不能 raw 直接完成绕过。关闭检查所有 current 槽的当前适用性，及所有 before-step 槽的冻结计划、合法 receipt/历史 snapshot 与原报告绑定；缺 receipt 仍阻断，但不要求旧复现快照等于修复后的当前代码。 |
| 证据保留 | 已受理 report、refs、前置 receipt/subject_snapshot 保留在 canonical claim slots，不靠 256 条 execution_log 反查。日志/报告产物仍须保留并可定位至对应验证/关闭完成，before-step 不豁免这一要求。归档保留当时事实和 assurance，外部日志日后消失不改写历史；另一任务/新计划复用必须重新准入，不能复制旧前置 receipt。 |
| P-12 准入 | `persistent_tests[]` 保留 `path/proves`，其中 proves 改用稳定 claim_id；补 `owner/owner_source/source_ref/basis/existing_evidence_insufficiency/assertion_boundary/failure_disposition`。basis 仅 acceptance/regression/critical-invariant/critical-risk；沿用原 Persistent Tests section 渲染与精确文件 scope 校验，raw parser 同样检查，不增加 catalog/AST。 |
| 检查点输入 | `implementation_steps[].review_checkpoint:{policy,reason}`，policy 复用 required/not-required；`semanticDraftDefinition` 渲染现有 metadata；`task-steps.ts::parseCheckpoint/materializeStep` 两类都保留理由，缺失/矛盾拒绝。项目强制、关键边界、最终评审/合法最终免审需显式声明；repair verification 不免。 |
| 累计目标 | 首版选择**保守累计 task diff**，不是分段平台。canonical `runtime_state.review_coverage:{change_set_id,base,target,preimages,pending_paths,last_clean_revision}`；base/target 复用 ReviewTarget，preimages 保存精确路径首次接触的 state 和 base64 内容/符号链接目标，需与 base hash 相符。没有 preimage 只有 hash 无法重建 dirty diff，不能拿 Git HEAD 补造；本轮修复撤除 64/256 KiB 字节门槛，保留 256 个精确路径上限，canonical 大小随首触内容增长。 |
| Preflight 事务 | 复用既有 **task-state-transaction 的事务机制**，新增内部 action `record-step-preflight`，不调用 `step-progress/in-progress` handler（其当前尾部无条件清 pending_review_result）。semantic_delta 为 `{kind:"task-state",action:"record-step-preflight",step_id,candidate_paths,evidence_refs}`，沿用 authority/preconditions/idempotency envelope；Runtime 自行读取并生成记录，不接受 caller 提供 preimage/前置 receipt。S2 接前置消费，S3 再接首触 preimage/累计基线；不新增 public Skill、mode 或 CLI command。 |
| Preflight 保留/路由 | `preflightStep` 和 raw action 的共享 guard 必须先于写入及幂等重放检查待处理 review：findings 返回 begin-repair、clean 返回 complete-reviewed-step、blocked 返回已记录 blocker.next_route；都不写、不返回新的可执行 preflight receipt、不自动调用下一入口，错版本返回冲突并保留记录。无 pending review 但仍有 open findings 或 blocked step 也不准入普通执行。成功登记只增前置消费/首次基线及审计，保持任务/步骤状态、scope、findings、repair/retry budget、review_cycle、pending_review_result、pending_paths/last_clean_revision；旧基线不可刷新。返回事务后的 source revision。 |
| 累计合并/Review 消费 | `recordStepResult` 合并本步已准入路径和累计未审路径，核对 before/after，保留重复修改、新增、删除及用户 dirty 归属。`reviewContext/latestRecordedExecution` 使用单一 canonical 累计 target；原 execution id 仅作触发身份。有效 clean receipt 或已确认精确免审归属才结束相应 pending_paths；preflight 不清任何待审范围或评审结果。默认 step-progress/recordStepResult 也不能绕过此保护：有 pending review 时普通结果写入阻断，仅合法 clean 完成或绑定该评审的 admitted repair 结果可以消费/替换它。pending_review_result/StepReviewReceipt 仍绑定 change_set_id + target revision；beginRepair 保留绑定，repair 后旧 clean 失效并走 verification。 |
| 语义 review | prepare/review-draft/review-change 模板落实 owner、必要性/复用、oracle 独立性、弱断言、mock/fixture 真实边界及适用版本；对应 review result 增 `test_assessment:{applicable,reason,evidence_refs,necessity,oracle,boundary,reuse,applicability}`，各适用维度写结论/依据。Runtime 检查完整与目标绑定，模型读 diff 判断语义；不创造独立身份。 |
| Repair 范围 | 保留 `beginRepair/normalizeFinding/resolveVerifiedFindings` 和 finding/repair budget；prepare 必须为后续检查点保留精确早期实现/测试修复路径或已满足的 Conditional。当前 normalizeFinding 还检查 current-step scope，发现早期文件不等于获得修复权，不能扩成目录任意写。 |
| Retry | 新增内部 task-state action / execute adapter command `retry-step`，不新增 public Skill/mode。输入 `{step_id,blocked_attempt_id,blocker_resolution_refs,idempotency_key}`；只在 active+active、同一冻结计划/验收/策略/scope、解除证据充分且原 blocker 非未解决 finding/越权观察时，blocked→ready；随后重新 preflight/执行/报告。不能直接 completed。 |
| Retry 留存 | canonical `runtime_state.step_attempts[step_id]` 保存 `{evidence_plan_revision,max_attempts:3,attempts:[{attempt_id,idempotency_key,status,blocker,evidence_refs}]}`（初次+最多两次 retry）；execution report 绑定 attempt_id。幂等键/失败摘要不依赖滚动 applied_proposals/log，重放不计数，预算不能随审计淘汰重置。新 attempt 不沿用失效 clean，不清 findings；代码/fixture 修复仍走已准入执行/repair，语义变化才 replan。 |
| 分发 | S1 建立语义标记，S1–S4 仅本地切片、均不可单独分发。S5 目标下一语义版本 `0.16.0`，先核对发布占用再按现有 lockstep 同步 VERSION/package/lock/contract/kernel 常量并重建；不覆盖已安装的 0.15.3 内容。旧归档可读、新建任务用新语义、旧 active 升级路径需实际负向验证。 |
## 三条最小输入/输出示例（设计示意，不写真实 CURRENT_TASK）
1. 普通功能：`test_strategy={mode:"flexible",source:"inferred-default",source_ref:"prepare-task-default",task_classification:"contract-clear-behavior",rationale:"无明确测试顺序要求"}`；已批准规则槽 `C-rule/S-rule/K-rule applicability=current` 在 `step-rule` 到期。prepare/confirm 后 preflight 应返回 `execution_phase=flexible, required_outcome=implemented`；首次检查 passed 合法，不要求 Red、第二个假实现步骤或新增测试。本轮本地 S1 已接受此 mode；已安装的 0.15.3 未升级，不能按包版本推定同一能力。
2. 规则不填流程槽：同一 `claim_id=C-save` 下两个 `applicability=current` 槽：`S-rule/K-rule minimum_type=focused-test due_step_id=step-rule` 与 `S-flow/K-flow minimum_type=integration-smoke due_step_id=step-flow`。仅提交 `{claim_id:"C-save",slot_id:"S-rule",check_id:"K-rule",minimum_type:"focused-test",disposition:"newly-executed",evidence_refs:["<保留的规则报告>"],report:{result_id:"R-rule",status:"passed",evidence_plan_revision:"<当前计划SHA256>",subject_revision:"<Runtime对象SHA256>",actual_method:"execution",environment:"<实际环境>",assurance:"caller-reported"}}`，可满足 step-rule，到期前 S-flow 仍 missing；task-complete/close 拒绝。将此报告改填 S-flow 而保留 K-rule/type，也必须拒绝。
3. 累计 review：步骤 A 免审修改 `src/rule.ts`（首次接触内容已含用户脏改动 U），步骤 B required 只改 `src/api.ts`；B 的 `review_context.recorded_execution.execution_result.review_target` 与 change_delta 必须包含 A+B 的实际变更，base 对 rule.ts 从 U 起算而非 HEAD。返回单一累计 target revision；晚到 clean、B 后又改 A 或 repair 未 verification 都不能消除 pending。
### 本次 findings 的有界反例（S2/S3 实现验收；本轮仅文档推演）
| 场景 | 修订后的确定结果 |
|---|---|
| 显式先复现再修复 | 非正向验收的复现槽 `applicability=before-step, due_step_id=reproduce, before_step_id=fix` 在 H0 报 expected-failure；fix 首次 preflight 对 H0 核验并记录消费。修复到 H1 后，独立 current 修复槽在 H1 passed；关闭接受历史 H0 前置 + 当前 H1 交付证据，不重跑“修复前仍失败”。 |
| 消费前陈旧/伪造前置 | H0 报告后、fix 准入前对象已变 Hx，preflight 拒绝并不生成 receipt；缺报告、错计划、直接 raw 完成 fix、caller 提供 receipt 同样拒绝。消费后改写原报告或新任务复制 receipt 也拒绝；仅有历史复现而无当前修复证据不能关闭。 |
| findings 后再次 preflight | 同一目标上 pending findings 尚未 begin-repair；返回 begin-repair，所有 canonical 字段逐字保留。改发普通 raw step-progress/recordStepResult 也不能清掉它；随后由独立调用的 begin-repair 消费原 findings，不改成普通执行。 |
| clean/blocked/重放 | pending clean 返回 complete-reviewed-step；pending blocked 返回原 blocker 路由；不返回编辑许可。待处理 review 存在时，即使命中旧 preflight 幂等键也先走此 guard；无待处理 review 的合法重放不刷新原 preimage/消费记录、不计 repair/retry 次数。 |
## S1–S5 最小读写地图与生成 footprint
下表 S1/S2 范围已获用户逐步直接实施授权，S3–S5 仍为候选范围；依用户决定不写源码仓库 canonical scope。路径相对本仓库；花括号仅列举确定文件，不是 glob 授权。共同只读：PLAN 对应 D1–D5、Target P-03/05/06/07/12/13/14、实际 AGENTS/CLAUDE/当前任务及相关合同；每次先核对最新 HEAD/status/冻结。
| 切片 | 必读符号；候选修改文件 | 生成物与已有验证入口 |
|---|---|---|
| S1 | `runtime/vnext/src/kernel.ts` 上表顺序/版本函数；`prepare-task-adapter.ts::{normalizeSemanticDraft,semanticDraftDefinition}`；`execute-step-adapter.ts::{executionPhase,preflightStep,recordStepResult}`；`review-change-adapter.ts::reviewContext`；`.workflow-system/vnext/{SOURCE_CONTRACT,RUNTIME_CONTRACT}.yaml`；`templates/vnext/bootstrap/{WORKFLOW_PROTOCOL,FILE_SCHEMAS}.md`；`templates/vnext/skills/{prepare-task,execute-step,review-change}.SKILL.md.tmpl`；`scripts/vnext-source-contract.ts`；`test/{vnext-runtime,vnext-daily-semantics,workflow-vnext-source}.test.ts`。 | 如需运行依赖 compiled CLI 的 checks，先准入 `runtime/vnext/dist/cli.js` 并 `bun run build:vnext-runtime`；复用 runtime.test 的 test-first Red / inferred defaults / raw-forged-green 组及 daily/source tests 验证 V1/V2/V3/V13，不逐字段新增测试。 |
| S2 | `kernel.ts::{validateClaimEvidence,evaluateClaimEvidence,assertClaimEvidencePlanPreserved,closureEligibilityBlockers,captureReviewTarget}`、step-progress 及新增 record-step-preflight 共享 guard/前置消费 handler；prepare/execute adapters（含 preflightStep）；`runtime/vnext/src/mutation-scope.ts` 的 Persistent Tests 读取；同两份 contract/bootstrap schema；`templates/vnext/skills/{prepare-task,execute-step,review-draft,validate-change,close-task}.SKILL.md.tmpl`；`scripts/vnext-validate-change.ts::evaluateValidationEvidence`；`scripts/vnext-source-contract.ts`；`test/{vnext-runtime,vnext-daily-semantics,vnext-mutation-scope,vnext-close-reconciliation-e2e,vnext-validate-change,workflow-vnext-source}.test.ts`。 | build 同 S1；生产 API/CLI fixture 覆盖 V3/V4/V5/V6/V7/V8/V12 及上表前置、待处理 review 反例；同步 preflight 从纯只读到有界登记的 contract/模板，raw、adapter、complete 和 close 共用校验；不新建 shadow evaluator。 |
| S3 | `runtime/vnext/src/{kernel,task-steps,prepare-task-adapter,execute-step-adapter,review-change-adapter}.ts`（metadata、扩展 S2 record-step-preflight 登记首触 preimage、累计 target、clean 消费和 normalizeFinding 的 current-step repair 范围）；同两份 contract/bootstrap schema；`templates/vnext/skills/{prepare-task,review-draft,review-change,execute-step}.SKILL.md.tmpl`；`scripts/vnext-source-contract.ts`；`test/{vnext-runtime,vnext-daily-semantics,vnext-lifecycle-e2e,workflow-vnext-source}.test.ts`。 | build 同 S1；V9/V10/V13 用脏基线、多路径重复修改/删除、新文件、错版本 receipt 和 repair fixture，并验证上表 pending review/重放保留规则在加入基线后仍成立；preimages 存 canonical task，不另建 review 数据库/临时目录。 |
| S4 | `runtime/vnext/src/{kernel,execute-step-adapter}.ts`（action schema/transition/replay/attempt ledger/CLI command 集合）；同两份 contract/bootstrap schema；`templates/vnext/skills/execute-step.SKILL.md.tmpl`；`scripts/vnext-source-contract.ts`；`test/{vnext-runtime,vnext-daily-semantics,vnext-lifecycle-e2e,workflow-vnext-source}.test.ts`。只读 `scripts/vnext-runtime.ts`、`runtime/vnext/src/cli.ts` 的集合分派，现有路由可复用，不预先扩大这两个文件写权限。 | build 同 S1；生产入口验证 V11，以及计划变更/伪解除/耗尽/日志淘汰/幂等/越权 blocker 不洗白；不以 admitted finding 冒充环境 retry。 |
| S5 | `VERSION`、`package.json`、`packages/vibe-governance/package.json`、`runtime/vnext/{package.json,package-lock.json}`、`kernel.ts::VNEXT_RUNTIME_PACKAGE_VERSION`、Runtime Contract；只读 `scripts/{build-vibe-governance-distribution,vibe-governance-distribution,vnext-migration-pack,fixflow-dogfood-upgrade,fixflow-dogfood-cleanup}.ts`；必要回归 `test/{vibe-governance-distribution,vnext-lifecycle-e2e,vnext-close-reconciliation-e2e,fixflow-dogfood-upgrade}.test.ts`。bootstrap `CURRENT_TASK.md` / runtime support template 仅在旧 idle 引导不满足新建边界时精确准入。 | build → `build:vibe-governance-distribution` 写 `packages/vibe-governance/dist/cli.js`、`payload/distribution-manifest.json` 及 manifest 枚举的 `payload/{migration-source,vnext-bundle}` 文件；生成前展开准确清单。`gen:all` 负责旧 reference/docs/registry，**不生成 vNext Runtime/Skill 源模板**，无模板/profile 传播就不为 S1–S4 仪式性运行。 |

- 全程不手改 `runtime/vnext/dist/cli.js`、`docs/workflow/generated/**` 或 `SKILL_REGISTRY.md`。S5 才做 PLAN §9.1 全量聚合及 freshness/health；生成、测试临时文件和包 payload 都必须先有 bounded expected_write_footprint，不能因为 ignored 就放行。
- S5 当前现成 dogfood 入口是 FixFlow 的 TypeScript/Fastify + 文件 SQLite，任务要求 POST `/tickets` → GET `/tickets/:id`、关闭并重开相同临时 DB 后仍存在；入口限定后端，不擅自新增 UI。`test/tickets.test.ts` 可供复用评估；用授权隔离数据记录真实成功及“规则 passed、流程失败/缺失”拒绝。S0 未核验运行环境可用性。
- `dogfood:fixflow:upgrade` 不是单纯测试命令：其源码包含版本写入、构建、Git/目标变更及 `E:\coding\dogfood-artifacts\vibe-governance` 工件；当前已有目标脏改动。S5 要先审清候选动作和精确目标授权，不以计划包隐式允许 commit/升级/cleanup，也不复用真实生产 DB。

## S0 初次核实的真实验证与剩余阻塞

- 完整读取 PLAN、CONTEXT、S0、旧 HANDOFF；按符号核实 Step 3 全部关键限制仍在：首步 Red、所有 tests 首步、后续 clean-Red 日志依赖、prepare 单 planned-validation 槽及每步 required、execute 文字/位置配对单槽、completion 仅 disposition+refs、review 只取 active step 最新 execution；blocked 仅 repair 可转 in-progress/completed，普通重试缺失。已有底层多槽/身份保持、非空 acceptance 计划、文件 hash manifest、repair verification 可复用。
- `git rev-parse HEAD`、`git branch --show-current`、`git status --short`、`git diff --stat`、`git diff --cached --stat`、`git ls-files --others --exclude-standard` 及相关路径 historical diff：符合上述基线；两份 distribution 清单逐项 SHA-256 核对通过，不能把此检查说成业务执行证据。
- `bun run validate:vnext-source`：exit 0，Phase 2 / 8 daily / 1 admin / 2 expert / 26 capabilities / 10 Runtime operations；`bun run scripts/vnext-runtime.ts validate-contract --root .`：exit 0，0.15.3 / **9 bound operations**（2026-09-12 重读返回数组纠正原计数；与 Source 的 10 项 catalog 声明不是同一统计）。
- `bun run scripts/vnext-runtime.ts validate --root .`：exit 1，`MIGRATION_REQUIRED: docs/workflow/CURRENT_TASK.md is not a vNext CURRENT_TASK document; run the Migration Pack.`；`node E:\coding\dogfood\fixflow\.workflow-system\runtime\dist\cli.js validate --root E:\coding\dogfood\fixflow`：exit 0，证明可解析其 closed/archived 状态，不证明历史业务报告真实执行。
- 本轮 `git diff --check` 通过；另查 untracked HANDOFF 的行尾空白/冲突标记，均为 0。逐文件 SHA-256 比较确认只改本轮三个设计文件，CURRENT_TASK 与其余既有计划文件未变；HANDOFF 的 MANIFEST bytes/SHA-256 已同步并逐项核对。未运行 build、gen、测试套件、真实 dogfood 或独立 review，不能引用旧测试计数充当本轮结果。
- **G1 已撤回（错误推导的旧治理前置）**：PLAN §7 原有一般治理挂接要求，但未指定“先归档 010、再经旧 create/lock-scope 建项”；这条具体路线是此前交接与回复的推导。用户现已明确禁止旧治理渠道，010 占用、旧 Skill 缺失及缺少 vNext confirmation receipt 均不再作为本轮源码开发阻塞。仍须遵守用户单步授权、精确文件/生成范围及不手改 canonical 的边界；后续用户已单独授权执行 S1，见末尾记录。不得伪造回执或声称旧任务已收尾。
- **G2（S5 前真实条件）**：同版本两份不同 payload 已证实；外部发布版本/其他消费者未盘点，需新版本和显式升级边界。当前 FixFlow dirty 与运行环境尚未处理，既有 upgrade 脚本不能直接自动执行。与本计划无关的依赖升级、用户改动归属调查均不附带开展。
- Target P-03/05/06/07/12/13/14 与本轮方向无实质冲突，Target/Blueprint 不改。P-05 仍写 review read-only，但当前 Runtime Contract 已允许 `record-review-result`；保留现有授权实现并记录这一既有差异。旧 discussion 的三 mode、新 review-testcase、全局 Test ID/Provider、滚动日志限制后置等结论已局部标记被本计划取代/待实施，不能作为当前协议引用。
- 剩余保证边界：caller-reported 不能证明运行事实，hash 只绑定内容；同文件测试准入语义仍需读 diff，Runtime 不声称 AST/逐用例拦截、自然语言风险全自动识别或宿主独立评审身份。

## 2026-09-12 S0 审查修复记录

- 来源：用户发起的只读审查对 HANDOFF `85b5879b18bbd7c732da104634f55d1e9eeee59f583e27d918290dbe0eef1a5e` 给出 verdict=findings，随后明确要求修复；本轮仅改 HANDOFF/MANIFEST，保留此前 discussion 修改、其他计划文件及 Runtime/canonical 状态。
- P1「复现槽在修复后失效导致死局」：已在 Slot/对象适用性/前置消费/共享完成接口及反例中修订；P1「preflight 清掉待处理评审」：已改为有独立保留规则的内部 record-step-preflight action，补 raw/adapter 共用 guard、待处理结果路由及重放约束。计数改为 9。均是设计修复，运行能力仍待 S2/S3 实施。
- 本轮实际核验：重读 PLAN §2.3、§3.5、§5.2–5.3 和 kernel 清理副作用、beginRepair 前置；`validate-contract` 返回 exit 0 / 9 bound operations。文档差异、逐文件 SHA-256、MANIFEST 校验与反例一致性自检用于确认本次两文件边界；未新增或运行测试、build、gen、dogfood，未将自检记为复审 clean。

- 收窄复审记录：本会话对 HANDOFF `c10213a727b18e14464d9e3c232361a2d285ce26be1f4300e505395295b3e633` 给出限定范围的 verdict=clean；仅覆盖两项 P1 修复、9 项计数和 MANIFEST，不是宿主认证独立回执。本次治理说明修改不追认继承该 clean。

## 2026-09-12 S1 实施与实际验证
- 范围与基线：HEAD 仍为 `166d2ce0f6ce76fe666b94c5181b23a252b9be1e`；保留此前 discussion（SHA-256 `55a9b41de9592783b87b21f8c7a567d44ffc3b1470dc828cc8c880ab5b7015ca`）及计划包。未改 CURRENT_TASK/AGENTS/CLAUDE、旧治理或 FixFlow；无 commit/push/install/发布。
- 实现：`kernel.ts` 接通 flexible 默认、版本判别、共享顺序/完成拒绝；`execute-step-adapter.ts` 接收新 mode/phase。prepare adapter 复用共享枚举与校验，raw create/update/confirm/replan 复用 kernel；无需改其输入形状或新增模块。删除按步序推导 Red、全任务 tests-only 和滚动日志 Red 扫描。显式顺序在准备和执行处均 blocked；expected-failure 不能满足 implemented，历史结构保留读取。
- 实际修改：`runtime/vnext/src/{kernel,execute-step-adapter}.ts`、`.workflow-system/vnext/RUNTIME_CONTRACT.yaml`、`scripts/vnext-source-contract.ts`、`templates/vnext/bootstrap/{WORKFLOW_PROTOCOL,FILE_SCHEMAS}.md`、`templates/vnext/skills/{prepare-task,execute-step,review-change}.SKILL.md.tmpl`、`test/{vnext-runtime,vnext-daily-semantics,workflow-vnext-source}.test.ts`，以及本 HANDOFF/MANIFEST。SOURCE_CONTRACT catalog 和 prepare/review adapter 无需改动。`bun run build:vnext-runtime` 仅生成 `runtime/vnext/dist/cli.js`，SHA-256 `83a7a0dae27fab68fcf7fd4b5743620a3e17603063644993267a911778d30712`；包版本仍 0.15.3，仅本地切片。
- 验证：`bun test test/vnext-runtime.test.ts test/vnext-daily-semantics.test.ts test/workflow-vnext-source.test.ts` 最终 **133 pass / 0 fail / 1366 expectations**；覆盖正常 prepare→confirm→preflight→实际子进程首次测试 passed→record→review→complete、无新增测试、混合首步、显式顺序 semantic/raw 拒绝、raw test-red 拒绝、缺/未知版本与零写入；既有范围、确认、review/repair 回归保持通过。`validate:vnext-source` exit 0（10 catalog operations），`validate-contract --root .` exit 0（9 bound operations）；build 与 diff/checksum 检查通过。修订期间的失败已修复，未引用为通过证据。
- 限制与 S2 依赖：test-first、implementation-first 和新复现执行当前均为 `TEST_STRATEGY_PREREQUISITE_UNSUPPORTED` / 拒绝新 test-red，不能分发为完整能力；S2 接通冻结 check/slot 的 before_step_id、消费前对象核验、不可覆盖 receipt 与共享完成检查后再开放。尚未改多槽 API、稀疏 review 或 retry。未跑全量 workflow suite、freshness/health、真实 dogfood 或独立审查；Runtime 报告仍为调用方报告，隔离测试执行不升级通用 assurance。
S1 后续审查：两个 P2 均非进入 S2 的阻塞；没有执行绕过或产品关闭恢复缺陷的证据。用户授权 S2 后完成对应集成修复，见下。

## 2026-09-12 S2 实施与实际验证
- 前置/范围：完整重读 CONTEXT、HANDOFF、S2 及 PLAN §3/4/7 和指定验收；核对 AGENTS/CLAUDE、冻结与 HEAD/status。HEAD 仍为 `166d2ce0f6ce76fe666b94c5181b23a252b9be1e`，无 staged 写入；保留 S1、discussion 和计划包，未改 CURRENT_TASK、FixFlow、AGENTS/CLAUDE，未运行旧治理、install、commit/push 或分发。版本保持 0.15.3。
- 接口落地：prepare 的 `claim_evidence` 取代自由 acceptance 数组，Runtime 投影 acceptance；稳定 claim/slot/check 与要求/来源绑定，草稿替换义务需新身份，旧 check ID 不得换检查。execute 的 `acceptance_evidence` 精确合并身份、类型、disposition/refs/report；拒绝错槽、伪造 receipt 与计划重定义。同 result ID 不能变更报告或产物映射；普通报告固定 caller-reported，validate-change 的临时输出也明确这一 assurance。
- 消费落地：`evidence_plan_revision` 对冻结定义取 SHA-256；`evaluateClaimEvidence(records,{root,current,due_step_id?})` 同时服务 raw progress、adapter 完成和 preview/archive。到期前允许 future missing，到期/最终完成拒绝缺失、failed/blocked/not-run/skipped、错版本或不可定位报告。声明的实现/测试/fixture/config 对象 manifest 变化使报告不适用，审计变化不使其失效。static/accepted 不伪造退出码；非验收 before-step 的 expected-failure 仅履行准入复现，不完成正向 acceptance。
- 前置落地：内部 `record-step-preflight` 复用原 task-state transaction（无新公共 Skill/mode/CLI）；仅需首次消费前置时 normal preflight 写入，返回提交后的 source revision 与 committed。Runtime 检查消费时对象并生成不可覆盖 receipt；raw 不能跳过消费。H0 复现消费后，H1 修复报告可完成并实际归档。pending clean/findings/blocked 在写入及重放前保留并返回原消费路线，陈旧目标返回冲突；无 pending 但有 open findings/blocked step 也不能普通执行。未增加 S3 累计 diff 或 S4 retry。
- P-12：semantic/raw 同时校验 Persistent Tests 的 path、稳定 claim_id proves、owner/owner_source/source_ref、basis、existing_evidence_insufficiency、assertion_boundary、failure_disposition；basis 不接受 coverage。继续复用精确文件 mutation-scope，不实现 AST/全局 Test ID。prepare/review-draft 指令补必要性、oracle、弱断言与 mock/fixture 边界；S3 的结构化 review assessment/累计检查点仍未实施。
- 实际改动：`runtime/vnext/src/{kernel,prepare-task-adapter,execute-step-adapter}.ts`；`.workflow-system/vnext/RUNTIME_CONTRACT.yaml`；`scripts/vnext-validate-change.ts`；`templates/vnext/bootstrap/{FILE_SCHEMAS,WORKFLOW_PROTOCOL}.md`；`templates/vnext/skills/{prepare-task,execute-step,review-draft,validate-change,close-task}.SKILL.md.tmpl`；`test/{vnext-runtime,vnext-daily-semantics,vnext-close-reconciliation-e2e}.test.ts`；本 HANDOFF/MANIFEST。build 仅重建 `runtime/vnext/dist/cli.js`。SOURCE_CONTRACT/public catalog、mutation-scope 实现、review-change adapter 无须修改；工作区其余显示的 S1 改动保留。
- 验证：`bun run build:vnext-runtime` 通过；`bun test test/vnext-runtime.test.ts test/vnext-daily-semantics.test.ts test/vnext-close-reconciliation-e2e.test.ts test/vnext-mutation-scope.test.ts test/vnext-validate-change.test.ts test/workflow-vnext-source.test.ts` 最终 **170 pass / 0 fail / 1655 expectations**。覆盖正常 prepare/confirm/preflight/record/review/complete、raw 和真实 archive 路径；ticket 规则检查后写 JSON，由新进程重新读取；规则报告通过而必要流程槽缺失/失败不能 complete/close；fixture 变化、静态证据、前置消费/重放/陈旧 review、P-12 与身份伪造拒绝。该跨进程示例是隔离 Runtime 回归，不是 FixFlow dogfood。Source 校验通过（10 catalog operations），Runtime contract 校验通过（9 bound operations），diff/checksum 校验通过。
- S1 P2 收敛：`currentMatchesSemanticDraft` 增版本/计划标记判别，同内容旧 active replan 不再误报 no-op（已有合法 supersede/replan 边界保持）；close reconciliation fixture 使用新策略/证据，A–D 四场景恢复至真实归档后恢复断言，全部通过。
- S2 初次实施 SHA-256（后续修复见下）：`runtime/vnext/src/kernel.ts`=`fb4183cbddcf20a84982dc1ba7953fa2645b3c5c69d4e323174237846633c49a`；`runtime/vnext/src/prepare-task-adapter.ts`=`531eeb951647e795da7ca6ec5c6c2c6d99cb2f075840d14325ab199b42414ece`；`runtime/vnext/src/execute-step-adapter.ts`=`54939f98161f9f7d315b50d6f38bd6d2ceb1d892090e1099b66e429e090a67bc`；`runtime/vnext/dist/cli.js`=`ecd856b843e2698092e3ad834420ec93853431e442711857c1acbb872e7342f4`。
- 限制/下一步：本地 S2 无剩余失败检查；等待用户独立审查实际 diff，之后才可另行授权 S3。未跑全量 workflow/freshness/health、独立审查、真实 FixFlow dogfood 或安装升级；无可用 tsc，未声称独立类型检查。产物需保留为 repo-relative 可读文件，任意远程/已清理日志不能用于新完成；人工验收没有认证渠道时明确 `EVIDENCE_AUTHORITY_UNSUPPORTED`，没有真实 Provider 或 assurance 升级。manifest 仅覆盖声明对象，不能证明运行真实性、遗漏依赖或逐用例价值；这些保证仍需真实执行/人工审查或后续能力。S3、S4、S5 未开始。


## 2026-09-12 S2 审查问题修复
- 来源：用户审查实际 diff 后发现 P1 历史复现放行后续失败、P2 首步前置准入后死局，随后明确授权修复。本轮仅处理这两项，未开始 S3，未使用旧治理渠道，未修改 CURRENT_TASK/FixFlow，无 commit/push/分发；HEAD 与版本仍为上述基线。
- P1：共享 kernel 对 expected-failure 的许可限定为当前执行提交的新 result_id、稳定 claim/slot/check 对应报告、未消费的 before-step 槽且约束严格后续步骤。历史或已消费报告不能授权修复/交付失败；报告完整一致性仍由既有共享校验核对。没有引入 Provider 或提升 caller-reported assurance。
- P2：共享计划准入以 TEST_STRATEGY_PREREQUISITE_UNSUPPORTED 明确拒绝约束第一步的前置槽。当前正常接口需要在更早的授权执行步骤提交报告；不增加额外写入口、不静默豁免明确前置要求。due_step_id 仍保留既有“最迟到期”语义，不强制将所有 due==before 配置拒绝。
- 本轮精确修改：runtime/vnext/src/kernel.ts、test/vnext-runtime.test.ts、templates/vnext/bootstrap/FILE_SCHEMAS.md、templates/vnext/skills/{prepare-task,execute-step}.SKILL.md.tmpl、本 HANDOFF/MANIFEST；build 生成 runtime/vnext/dist/cli.js。其余 S1/S2 与 discussion 既有改动保留。
- 回归依据/P-12：复用现有 S2 H0→H1 生命周期组，依据本次 P1 缺陷让前后步骤运行同名命令，验证修复阶段 expected-failure 被共享 Runtime 拒绝、canonical 零写入、无法 complete/close，然后提交 passed 仍能完成并实际归档；此前不同命令的成功场景不能检出该缺陷。新增一个首步前置准入组，依据本次 P2，覆盖 semantic/raw 拒绝与 canonical 零写入，避免已确认任务卡死。owner 为本仓库 Runtime，来源为本次用户修复授权及 S2 §5/9；边界是报告绑定与可执行准入，非执行真实性或业务 Provider。
- 实际验证：bun run build:vnext-runtime 通过；六个原 S2 相关文件的 bun test 最终 171 pass / 0 fail / 1662 expectations；validate:vnext-source 通过（10 catalog operations），scripts/vnext-runtime.ts validate-contract --root . 通过（9 bound operations）；git diff --check 通过。编写回归时调整了两处断言以符合现有接口抛错行为，最终无失败。按 simplify 技能检查本次修改可读性，未扩展重构。
- 限制/下一步：两项已修复并自检，尚未经过修复后独立复审；等待用户收窄复审。首步前置仍不支持，现为准入明确拒绝；新结果仍是 caller-reported。未运行全量 workflow/freshness/health、独立类型检查、真实 FixFlow dogfood 或安装升级。S3/S4/S5 未开始。
- 修复后 SHA-256：`runtime/vnext/src/kernel.ts`=`8d48cb3f5133d4c5b7326f5e5a2da6f9176e40157dcd97c35241f1f0c8bc9350`。
- 修复后 SHA-256：`runtime/vnext/dist/cli.js`=`2ffb06948328ff05768ebd3bbe414fceae2e8f829a95dcdbce6cb6df8a8f1c82`。


## 2026-09-12 S3 实施与实际验证
- 前置/边界：读取 CONTEXT、HANDOFF、S3、PLAN §4–5/V9–V10 和根 AGENTS/CLAUDE；无下级指令或 freeze registry，候选源码/模板无冻结标记。S2 修复后的 kernel `8d48cb3f…c8bc9350` 与 CLI `2ffb0694…6df8a8f1c82` 经本会话上一轮收窄复审 clean，满足本步前置（非宿主认证独立回执）。HEAD 仍为 `166d2ce0f6ce76fe666b94c5181b23a252b9be1e`，版本仍 0.15.3；保留 S1/S2/discussion 改动，不使用旧治理，不改真实 CURRENT_TASK/FixFlow，无 commit/push/分发。
- 检查点接口：semantic step 接收 `review_checkpoint:{policy,reason}`；required/not-required 都渲染理由，历史省略输入保守转 required，不默认为免审。新 sparse plan 缺理由、最终免审未明确覆盖整个累计任务、required checkpoint 未保留早期精确修复路径时拒绝。合法 final waiver 采用已确认 reason 的 `final-exemption: <整项累计免审理由>`，不绕过项目政策或 repair verification；这是现有 policy/reason 内的明确编码，不增公共模式。
- 累计覆盖：canonical `review_coverage:{change_set_id,base,target,preimages,pending_paths,last_clean_revision}`。新建任务初始化空覆盖；S2 internal record-step-preflight 原子捕获候选路径首次实际文件/缺失/符号链接状态与 base64 内容，base 哈希绑定内容，不用 Git HEAD。单路径 64 KiB、总 decoded 256 KiB 上限；超限 blocked。重新 preflight 复用已有基线，不用未记录改动刷新它。正常 execution log 仍只记本次 actual_changed_paths，`cumulativeReviewExecution` 给 review/clean/repair 消费者投影单一累计 base/target/change_delta；review-context 额外返回 `review_preimages`，可重建用户 dirty 基线。累计状态不依赖滚动日志淘汰；当前触发 execution 仍沿用原日志身份。
- 消费/修复：当前路径的 raw before-state 必须等于已登记 target；合并结果核对所有已登记路径变化与本次实际写入一致。免审中间步骤仍需记录执行和到期证据，pending 留到后续 checkpoint。clean completion 或已确认 final cumulative exemption 才消费 pending；findings/blocked/陈旧结果与 preflight 不清它。close 重核累计 target 与有效消费。begin-repair、verification 和 complete 同样使用累计目标，既有队列/预算与 current-step scope 保留；同任务 replan 保留已有累计归属并撤销旧 clean，不能以新基线洗掉原改动。
- 语义评审：新增 `test_assessment:{applicable,reason,evidence_refs,necessity,oracle,boundary,reuse,applicability}`；新累计 review 必须完整记录并由外层 execution/change-set/target 绑定。声明 execution check 或 Persistent Tests 即要求 applicable=true，即使测试文件未变；引用须被事务 evidence_refs 覆盖。prepare/review-draft/review-change 模板同时要求原请求强度、必要性/复用、独立 oracle、弱断言、自我验证、fixture/mock 及真实业务流程槽检查。仅结构/绑定由机器验证；内容判断和报告仍 caller-reported，无 Provider/AST/全局 Test ID，也无独立身份认证。
- 实际文件：`runtime/vnext/src/{kernel,task-steps,prepare-task-adapter,execute-step-adapter,review-change-adapter}.ts`；`.workflow-system/vnext/RUNTIME_CONTRACT.yaml`；`scripts/vnext-source-contract.ts`；`templates/vnext/bootstrap/{WORKFLOW_PROTOCOL,FILE_SCHEMAS}.md`；`templates/vnext/skills/{prepare-task,execute-step,review-draft,review-change}.SKILL.md.tmpl`；`test/vnext-runtime.test.ts`；本 HANDOFF/MANIFEST。build 仅重建 `runtime/vnext/dist/cli.js`。无新模块、公共 Skill 或测试平台；未修改 lifecycle/daily/close 测试源码，使用其既有回归。
- P-12/实际回归：新增两个有限 S3 场景组，owner=本仓库 Runtime，source=用户本次 S3 授权及 PLAN §4–5/V9–V10，basis=regression/critical-invariant。既有逐步 required fixture 无法发现早期漏审和 dirty 归属，因此用生产 prepare/preflight/record/review/repair/complete 路径补足：A 免审改 a、B 只改 b而 review 含 a+b；真实写入的早期测试 diff 使用生产常量作 expected 被记录为 oracle finding，后续改为独立要求值并 verification；dirty preimage、晚到 stale review、缺 assessment、raw 跳过中间执行、免审缺到期证据、新增/删除/重复写、blocked 保留 pending、超限零写入、clean 后改早期文件不能 close。混合 diff 一个 verdict；测试记录的是有限 fixture 中的审查判断，不声称自动读懂 oracle。复用原 S2 H0/H1、多槽及 repair/关闭恢复回归。
- 最终验证：`bun run build:vnext-runtime`、`bun run validate:vnext-source`（10 catalog operations）、`bun run scripts/vnext-runtime.ts validate-contract --root .`（9 bound operations）通过；`bun test test/vnext-runtime.test.ts test/vnext-daily-semantics.test.ts test/vnext-lifecycle-e2e.test.ts test/vnext-close-reconciliation-e2e.test.ts test/vnext-mutation-scope.test.ts test/vnext-validate-change.test.ts test/workflow-vnext-source.test.ts` 最终 **176 pass / 0 fail / 1868 expectations**。编写期间暴露的重复 preflight、评审重放字段顺序及旧 contract 断言已修复，最终结果不引用失败轮次。diff 与 MANIFEST 校验通过；按 simplify 收敛本次公共构造/投影。自检不记为独立 review。
- 限制/下一步：等待用户审查 S3 实际 diff，未开始 S4。不存在本轮已知失败检查；未跑全量 workflow/freshness/health、独立类型检查、真实 FixFlow dogfood、安装升级或独立审查。旧无 review_coverage 的低层历史 fixture/既有记录保留原解析，正常 preflight 可建立首次基线，不宣称从旧日志恢复已丢失的 dirty preimage；新 create/replan 和正常 adapter 使用累计覆盖，旧 active 的完整升级矩阵仍由 S5 验证。精确修复路径也必须已有 Runtime 登记基线，未登记的新修复路径/超限文件明确阻断，不能伪造 preimage 或自动扩权限。累计 manifest 只覆盖已登记/声明对象，不检测任意未报告写入；项目政策和最终免审理由的语义正确性仍须模型/人工审查。S4 retry 在 dogfood 前完成的约束保持。
- S3 SHA-256：`runtime/vnext/src/kernel.ts`=`4cd5f0ed06a967c164e5b0bef49e41551541f3b4d5f994cd9a31081cb07111ed`。
- S3 SHA-256：`runtime/vnext/src/task-steps.ts`=`8a9969368428b49b55b277c4f07e88218c317d1b01867d16658371a017bf2c60`。
- S3 SHA-256：`runtime/vnext/src/prepare-task-adapter.ts`=`16db6252f5f3a959e2fb301df4756d72b3ea3c8db5539fd2047e64e50e2f9c93`。
- S3 SHA-256：`runtime/vnext/src/execute-step-adapter.ts`=`441203fbeea49ed2bfe4d329b8599ccd01bb7e0c930af6bfb78040da13daad5e`。
- S3 SHA-256：`runtime/vnext/src/review-change-adapter.ts`=`8365a297deb5873a4c8b36945ee9f7242190c77183c9e3f1beafa8ef4b405a02`。
- S3 SHA-256：`runtime/vnext/dist/cli.js`=`e03194ccdd18b200c82596cd28d9253f5b6bc853a25537a254ea63e1b075c316`。


## 2026-09-12 S4 实施与实际验证
- 前置/范围：重读 CONTEXT、HANDOFF、S4、PLAN §6–7/V11、AGENTS/CLAUDE 和 blocked/repair/review/裁剪调用链；无新增下级指令或冻结，实际 S3 kernel/execute/CLI hash 与上述记录一致。S3 已实施并有 176 项通过记录，用户明确授权本步；S3 未独立复审，本轮不补称 clean。HEAD 仍为 `166d2ce0f6ce76fe666b94c5181b23a252b9be1e`，版本仍 0.15.3，保留所有既有改动与 discussion hash；无旧治理调用、CURRENT_TASK/FixFlow 修改、commit/push/分发，S5 未开始。
- 入口：既有内部 action 无同计划恢复动作，因此扩展 `task-state-transaction` 的 `retry-step`，execute adapter 同名 stdin 命令输入 `{step_id,blocked_attempt_id,blocker_resolution_refs,idempotency_key}`；`createStepRetryProposal` 使用既有 task/document/source/authority envelope。只读核验 scripts/vnext-runtime.ts 和 src/cli.ts 已从 adapter 命令集合动态分派，无须修改，不新增 public Skill/模式/恢复平台。
- 准入：只恢复 ordinary active blocked step；原结果必须显式 `blocker_kind: environment`、actual_changed_paths 为空、有 blocked 结果且没有 failed 结果。未声明分类默认为 unknown，不允许通过后来一句“环境好了”把业务失败/不明原因洗成 retry。pending review/open findings、计划变化、声明被测对象变化、预算耗尽均拒绝。任务定义/权限/slot 不变，恢复动作只 ready 并撤销累计旧 clean，保留 pending_paths、原 claim reports、findings 和 review cycle；不重启服务、不重置 DB、不修改产品。
- 解除报告：blocker_resolution_refs 仅引用保留的 repo-relative JSON 文件（单份最多 64 KiB），格式 `environment-restored/v1`，精确绑定 task_id/document_id/step_id/blocked_attempt_id/evidence_plan_revision/subject_revision，status=passed，含具体 diagnosis/resolution。对象 snapshot 覆盖失败时声明的 review target 和 check.subject_paths；与当前不符则 `RETRY_SUBJECT_STALE`。泛化解锁文本、错失败/版本/对象报告拒绝。报告仍是 caller-reported，不是可信环境 Provider；Runtime 验证结构/绑定，调用者负责真实诊断与观测。
- Ledger：`step_attempts[step_id]={evidence_plan_revision,max_attempts:3,attempts}`，初次 ordinary 结果登记第一 attempt；后续 retry 生成 ready attempt，preflight 以新 attempt_id 登记 preflighted，再允许结果。每 attempt 保留 `attempt_id,idempotency_key,request_digest,status,blocker,evidence_refs`，blocked 保存原 execution_result 与 subject_snapshot；后续 attempts 不覆盖前次失败，resolution refs 与执行 refs 一起保留。ready/旧 attempt receipt 不能直接提交成功或 completed，仍需正常检查/claim证据/review。相同 retry 的 durable request digest 在滚动 applied_proposals/execution_log 之外做 no-op；改请求/跨 document/plan 冲突。初次加两次 retry，第三次失败后 `RETRY_BUDGET_EXHAUSTED`，路线 debug-task/user。same-plan replan 不能清 blocked ledger 来刷新预算；真正新计划沿用明确 replan 授权边界。
- 精确修改：`runtime/vnext/src/{kernel,execute-step-adapter}.ts`，`.workflow-system/vnext/RUNTIME_CONTRACT.yaml`，`templates/vnext/bootstrap/{WORKFLOW_PROTOCOL,FILE_SCHEMAS}.md`，`templates/vnext/skills/execute-step.SKILL.md.tmpl`，`test/vnext-runtime.test.ts`，本 HANDOFF/MANIFEST；build 仅生成 `runtime/vnext/dist/cli.js`。prepare/review adapters、task-steps、source-contract 脚本、daily/lifecycle/close 测试源码及其它既有改动保持。按 simplify 规则检查本次实现，未增加独立模块或扩展无关恢复。
- P-12/回归依据：新增两个有限 S4/V11 场景组，owner=本仓库 Runtime，source=用户本次 S4 授权与 PLAN §6，basis=regression/critical-invariant；既有 blocked 测试只证明拒绝执行，不能证明可恢复或持久预算。第一组真实启动 Bun 子进程：环境缺失 exit 9，补环境后的探针 exit 0，retry ready，再 preflight/重新运行 exit 0；缺业务 slot 仍不得完成，补绑定报告后 clean review/complete。API/raw/CLI 重放 no-op，原失败留存，旧 receipt 被拒绝。通过 257 次正常、较小的 state-only 审计登记实际触发两种 256 条日志裁剪（无手改 canonical、无伪造执行），裁剪后重新执行及重放仍通过。第二组覆盖 unknown、错对象、scope/策略/claim 扩字段、dry-run零写入、两次 retry 后预算耗尽和旧请求不解锁；定义/findings不变。
- 实际验证分两次完整覆盖六个相关文件：`bun test test/vnext-runtime.test.ts test/vnext-daily-semantics.test.ts test/vnext-close-reconciliation-e2e.test.ts test/vnext-mutation-scope.test.ts test/vnext-validate-change.test.ts test/workflow-vnext-source.test.ts --test-name-pattern '^(?!.*S4 retries an environment)'` 为 **174 pass / 0 fail / 1717 expectations**；`bun test test/vnext-runtime.test.ts --test-name-pattern 'S4 retries an environment'` 为 **1 pass / 0 fail / 292 expectations**（约 35 秒，显式 90 秒上限）。合计不同测试 **175 pass / 0 fail / 2009 expectations**。早期全量报告裁剪方案约 233 秒触发默认 5 秒 timeout，已换成较小正常审计并通过，未把超时轮记为成功。
- `bun run build:vnext-runtime`、`bun run validate:vnext-source`（10 catalog operations）、`bun run scripts/vnext-runtime.ts validate-contract --root .`（9 bound operations）、git diff --check 与 MANIFEST 校验通过。实际失败定位/修复后 S2/S3 关键回归及其余六文件均通过；本轮未重跑 lifecycle E2E、全量 workflow/freshness/health、独立类型检查、独立审查、真实 FixFlow dogfood 或安装升级。
- 限制/下一步：S4 自检完成，待用户审查实际 diff；不开始 S5。只处理已登记的无写入临时环境阻塞；业务/未知根因、已发生写入、缺少旧 attempt ledger 的历史 blocked 记录不自动迁移或补造诊断，返回准确 blocker，按 debug/合法 repair/明确 replan 路由处理。对象变动不以 retry 洗白；环境报告无独立真实性保证。首次执行与重复同 attempt 的正常报告仍沿用现有 Runtime 受理边界，不新增全局执行器或尝试调度服务。
- S4 SHA-256：`runtime/vnext/src/kernel.ts`=`4099f99468ca2355f8ede88eb15ddffac4c501b8d8988b50a0ec1987fd7929ff`。
- S4 SHA-256：`runtime/vnext/src/execute-step-adapter.ts`=`7278e03e92b5b3360b37ad06bb297e58e05e8250708dde1aa84a3abe1fdb3894`。
- S4 SHA-256：`runtime/vnext/dist/cli.js`=`83ea00d63a28008c6e49e22c57969e21fcca287cee71b5942ee0e33f46ff0def`。

## 2026-09-12 S5 总验收、分发与隔离业务验证
- 边界/前置：读取 CONTEXT、HANDOFF、S5、PLAN §7–12/验收矩阵、根及 FixFlow AGENTS/CLAUDE；无 freeze registry 或本轮目标冻结标记。HEAD 仍为 `166d2ce0f6ce76fe666b94c5181b23a252b9be1e`，Bun 1.3.10、Node v24.12.0。S1/S2 的既有审查问题已收敛；S3/S4 的实现和回归存在，无已登记未修阻断 finding，但尚无独立复审。本次是 S5 实施自检，不能补称独立 clean；独立总审仍待用户另行调用。用户不使用旧治理的约束继续有效，未以旧 CURRENT_TASK 解锁源码开发。
- 本轮修复仅针对实际缺口：共享 `kernel.ts::buildResult` 返回 `evidence_assurance: caller-reported`，不再让正常事务 success 摘要丢掉证据可信度上限；类型、契约注释、FILE_SCHEMAS、execute-step 模板与既有 S2 自报 trusted 断言同步。知识沉淀 fixture 仍用无报告的旧完成态，bootstrap realign fixture 仍在创建 draft 时导入成功结果并用无前置的 implementation-first；它们实际触发共享证据拒绝，现改用明确 flexible/静态 fixture、先空计划后绑定观察，保留原归档/对账/realign 断言。不放宽 Runtime gate，不增加测试数量或新测试平台。
- P-12：上述两个既有 fixture 保护 Runtime 归档后知识持久化/STATUS 对账和 bootstrap realign 保留义务，已有测试已准入；本轮来源为用户 S5 与 PLAN V5/V13，basis=regression/critical-invariant。它们的静态 fixture 只是进入被测归档事务的准备条件，不冒称真实业务成功。读过实际断言：知识测试检查 archive provenance、typed promotion、重启幂等和不覆盖；realign 检查逐项 durable record/STATUS 保留。业务 dogfood 复用现有 FixFlow 产品，零新增持久测试；HTTP 状态、请求字面值、open 状态及重启前后完整工单对比构成 oracle，不从生产常量生成预期。
- 版本/分发：按 S0 冻结决定同步 `VERSION`、根/package/runtime package、Runtime lock、contract package_version 与 kernel 常量为 **0.16.0**；schema 仍 1，business_evidence_version 仍 1，不升级依赖。公共 npm registry 查询 `https://registry.npmjs.org/vibe-governance` 返回 HTTP 404（只能说明本次公共查询未找到包，不声称私有 registry 或其它安装不存在）。通过既有 build/gen 更新 Runtime CLI、四份含版本的 generated workflow docs（BASELINES/DOCUMENT_CATALOG/ROADMAP/STATUS）和本地 distribution。payload/dist 是既有忽略生成目录，没有手改生成物。分发 digest=`4f637a67a46c570f3c96901048ab2e14e9bb41b5c3b63c1190b3b3accbb4b06e`，bundle=`bundle-86af278910b08595d5f13a3c`。最终 dogfood 安装的 33 个受管产物与本地 payload 逐字节一致。
- 兼容实测：在临时副本通过 Distribution CLI 将真实 FixFlow 的 0.15.3 安装升级到 0.16.0；21 个非分发文件（docs/TASKS/源码/测试/AGENTS/CLAUDE/package）与真实目录逐字节一致。复制来的旧 task001 已 closed+archived，但 prepare 的确返回 `PREVIOUS_TASK_RECONCILIATION_INCOMPLETE`（缺 STATUS 对账），未解锁、清除或伪造对账。因此业务路径使用另一全新隔离根，正常 install → bootstrap-support preview/显式 write → prepare/confirm，不修改旧任务。真实 FixFlow 仍 0.15.3，CURRENT_TASK source revision 仍 `2ce6a42ab9aea277d04c3129843e7c7892dad15d9ecbfd7986963841167ef9e1`，dirty 仍 AGENTS.md、CURRENT_TASK.md、TASKS/。源仓库旧任务010的 vNext validate 仍返回 `MIGRATION_REQUIRED`；只读 health OK 不代表它已迁移，未执行旧治理迁移/关闭或真实 upgrade 脚本（该脚本含自动 commit）。
- 真实业务路径：保留目录 `C:/Users/kongx/AppData/Local/Temp/s5-fixflow-qRigqP/`，控制脚本 `C:/Users/kongx/AppData/Local/Temp/s5-dogfood.ts`；`target/` 是升级兼容副本，`fresh/` 是正常新建任务实例，`business/data/fixflow.sqlite` 是唯一业务数据库。源码 src/app.ts、src/server.ts、package.json 与真实 FixFlow 相同。用现有 Bun build 生成 Node server.js（也纳入 check.subject_paths），直接启动 Node 进程，loopback HTTP POST /tickets → GET /tickets/:id → 服务退出 → 第二 Node 进程读取同一 SQLite 文件；PID **47444 → 6304**，提交与两次读取均 HTTP 200，工单 id=1，所有业务字段一致；不依赖 mock、内存 DB、页面或真实用户数据。所有本次服务已退出，临时数据库和日志留存待审。
- 同场景负向及恢复：初始服务未运行，HTTP 不可达，record-step-result 登记无产品写入的 environment blocker；启动服务后 GET 未知 id 得到 404，提交精确绑定 `environment-restored/v1`，retry→ready、相同请求 no-op、重新 preflight。无效 priority 的真实 POST 返回 400，rule 槽成功而 flow 尚未执行，此时 raw complete 返回 `CLAIM_EVIDENCE_INCOMPLETE`，raw close 返回 `CLOSURE_NOT_ELIGIBLE`，preview 包含 incomplete。完成真实持久化/重启读取后提交独立 flow 报告，经同调用方语义 review、complete-reviewed-step、raw archive 成功，最终 validate 为 closed+archived。此次 dogfood 没有伪造 failed 业务报告；failed/blocked/not-run/skipped 槽的拒绝另由既有 Runtime 回归实测。failure.json、resolution.json、rule.json、flow.json 分别保留，未用成功报告覆盖原失败；全部 assurance 为 caller-reported。
- 正常入口：上述 prepare/confirm/preflight/record/retry/review/complete/apply/validate 均调用**隔离实例已安装的 Node Runtime CLI**。raw proposal 只经生产构造器和 apply，不直接改 canonical；readCanonicalCurrentTask/captureReviewTarget 用于读取实际身份与对象版本。最终 Runtime 日志在上述根的 runtime-log.json，成功/拒绝事务均含 evidence_assurance=caller-reported；read-back 验证的是写入，不是 Provider 认证。模型对测试必要性、独立 oracle、mock 边界和适用版本作了显式 assessment；这是同调用方审查，不是独立 reviewer 身份。

### S5 验收矩阵（实际覆盖与局限）
| ID | 实际证据与结论 |
|---|---|
| V1/V2 | Runtime flexible/第一次通过回归；实际 FixFlow 验证任务 flexible，无 Red 或产品修改要求。 |
| V3 | 既有 H0 复现→首次 preflight 消费→H1 修复及 wrong/stale/forged/raw 前置回归，显式顺序未放宽。首步自身前置明确不支持。 |
| V4 | 实际已安装 CLI：rule 成功、flow missing 时 complete/close 拒绝；真实 flow 完成后才允许。 |
| V5 | 既有 S2 同场景错身份/failed/blocked/not-run/skipped、共享 raw 拒绝，且本次 dogfood raw 不能旁路。 |
| V6 | 既有静态槽/复用与 future slot 独立身份回归；知识/realign fixture 使用 accepted/static，不造退出码。无认证 human 通道仍 blocked。 |
| V7 | 既有 P-12 缺准入/泛 coverage/未列持久测试路径拒绝；本次业务未新增持久测试。 |
| V8 | 既有 fixture 改动失效、审计不失效、H0 历史消费回归；实际报告绑定源码/生成执行文件/package 和计划版本。只覆盖声明对象。 |
| V9 | 既有 S3 A 免审、B 只改另一文件而累计 target 包含 A+B，dirty preimage 不以 HEAD 代替。 |
| V10 | 既有 S3 早期 circular oracle finding→repair→verification、晚到 clean/无 assessment/范围不足拒绝；真实 dogfood 有实际读内容的 assessment，无独立身份认证。 |
| V11 | 既有 257 条正常审计裁剪后仍保留失败/幂等/三次预算、错对象/unknown 拒绝；实际服务恢复走 retry/new preflight/new run，原失败保留。 |
| V12 | 既有自报 trusted 强制 caller-reported；本轮补正常事务输出断言，实际安装输出/报告均 caller-reported。 |
| V13 | unversioned/未知语义标记/原有 dirty/旧格式 active 拒绝和安装升级回归；实际 0.15.3 副本升级保留 21 文件，旧 STATUS 对账缺口如实阻断新任务。 |
| V14 | 真实 HTTP 提交、file SQLite、进程退出后新 PID 重读通过；后端场景，无 UI 要求，不拿规则或 mock 替代流程。 |

- 最终验证（2026-09-12）：`bun run build:vnext-runtime`、`bun run gen:all`、`bun run build:vibe-governance-distribution`、`bun run validate:vnext-source`（10 operations）、`bun run validate:vnext-runtime`（9 bound operations）、`bun run validate:protocol`、`bun run validate:freshness`、`bun run workflow:health --root .` 均通过。**完整 `bun run test:workflow-all` 退出码 0，15 个子测试批次合计 528 pass / 0 fail / 8258 expectations**，包括 Runtime 三文件 137、system E2E 8、knowledge 9、migration 14、bootstrap 11、distribution 17 及其余实际脚本。最终完整日志为 `C:/Users/kongx/AppData/Local/Temp/s5-all-complete.log`；前期失败批次不计入通过数（知识/realign 旧 fixture 和开发中的 contract 未知键问题均已修复）。同版本最终 dogfood 通过日志为 `C:/Users/kongx/AppData/Local/Temp/s5-dogfood-direct.log`。
- S5 精确增量：七处版本源（VERSION、根/package/runtime/lock、Runtime Contract、kernel），kernel 的共享 result assurance 字段，FILE_SCHEMAS 与 execute-step 模板，既有 `test/vnext-runtime.test.ts` 断言、`test/vnext-knowledge-promotion.test.ts` / `test/vnext-bootstrap-project.test.ts` fixture，Runtime dist、四份版本生成文档及本 HANDOFF/MANIFEST。Distribution dist/payload 由既有生成器重建于忽略目录。未改真实 CURRENT_TASK、真实 FixFlow 或既有 discussion；discussion SHA-256 仍 `55a9b41de9592783b87b21f8c7a567d44ffc3b1470dc828cc8c880ab5b7015ca`。diff --check 与包内 12 项 MANIFEST 校验通过。
- S5 SHA-256：`runtime/vnext/src/kernel.ts`=`adc1e8d03671d86b480e15744bc192af57eca1719a08d871a183b35993b36c20`。
- S5 SHA-256：`runtime/vnext/src/execute-step-adapter.ts`=`7278e03e92b5b3360b37ad06bb297e58e05e8250708dde1aa84a3abe1fdb3894`。
- S5 SHA-256：`runtime/vnext/dist/cli.js`=`32f228e5763760adec6bb7c7def4aaab1afef832ff22eb1ae3b91dcde6e76d3a`。
- S5 SHA-256：`test/vnext-knowledge-promotion.test.ts`=`f26572b2f7df8318fb681e8518932c8bf94ccbe26c095f99726b1c1969e27997`。
- S5 SHA-256：`test/vnext-bootstrap-project.test.ts`=`c8019390c43c53f480c9697a6a676031543b2e14ed420ac5fa9045bfaa0a533e`。


- 当前限制/整体状态：S5 实施及上述隔离业务验证完成；没有未修复的本轮已知实现 finding，但**独立总审尚未完成，整体不能标记 independent clean 或可自动发布**。真实原 FixFlow 的旧 task001 STATUS 对账未完成、源仓库任务010未迁移，均保留，不据此绕过用户禁止的旧治理；需要今后明确授权的目标处理。本次成功实例仅 archive 完成，未在该临时任务另做 STATUS/知识传播；相关关闭恢复由既有 E2E 覆盖。没有 Provider/宿主认证、AST/全局 Test ID、独立类型检查或真实生产升级。未声明的对象/写入、报告真实性和语义价值不是 Runtime 硬保证。retry 仍限无写入且已登记的 environment blocker；历史无 ledger、业务失败/unknown、预算耗尽须诊断或明确授权的修复/重规划。停止于 S5，下一步是用户另行调用独立累计总审，不自动发布、commit 或 push。


## 2026-09-12 累计审查四项修复（用户直接授权）

- 边界：基于 HEAD `166d2ce0f6ce76fe666b94c5181b23a252b9be1e` 的已有 33 文件累计 diff；无 staged 改动，未跟踪计划包保留。核对根 AGENTS/CLAUDE，无下级指令、freeze registry 或目标冻结标记。本轮不走旧治理、不修改真实 CURRENT_TASK/FixFlow、不 commit/push，不运行业务 dogfood。版本仍为本地未发布的 0.16.0。
- P1 retry：撤除“失败前零写入”条件。已通过原 scope/命令/实际 delta 校验的修改会随 blocked 结果登记，保留在原 failure 和累计 review 目标；恢复要求失败后声明对象不变、无业务 failed 结果、同计划/权限、原有三次预算和幂等。ready 后重新 preflight/运行/报告，仍不得以环境恢复直接完成。unknown/业务失败不自动重新分类，越权、对象漂移和待处理 findings 继续拒绝。
- P2 读取接口：新增 execute adapter 内部只读命令 `evidence-context`，复用 captureReviewTarget，无公共 Skill/Provider/执行器。空对象 stdin 返回各冻结 check 的当前对象版本；Skill 不再依赖源码 helper 或自行实现 hash。新 Node CLI 回归检查多槽独立版本、读取零 canonical 写入、相关对象变化后旧报告拒绝及新报告受理。此入口不证明检查真的执行，assurance 不提升。
- P2 Skill：review-draft 审查计划充分性与可执行性，明确 draft 缺执行报告正常；validate-change 对独立 validation_target 工作，只有提供 task plan 时才绑定相关槽，不能要求无关槽或任务完成。保留 P-12 owner/source、claim、必要性/已有证据不足、oracle 和 mock 边界审查。按 simplify 检查本次改动，未新增公开入口或复制新流程。
- P2 基线：保留 canonical 首触内容、精确路径集合和 hash 验证，移除 64 KiB/文件和 256 KiB/任务的硬门槛，未新增外部快照仓库或存储平台。仍受已有 256 路径上限约束；canonical 文档大小和解析成本随首触内容增长，不声称超大资产成本恒定。既有 S3 场景改用约 748 KB dirty 文件，实际跨免审步骤、累计 review、修复及 verification，首触内容逐字保留；撤去旧的“大于 64 KiB 必须拒绝”断言。
- P-12：来源为用户本次四项修复授权与 PLAN V8/V9/V10/V11/V12，owner=Runtime 源仓库，basis=regression/critical-invariant。复用 S3/S4 场景，S4 改为先合法改文件再遇环境故障；新增一个 CLI 上下文场景组，保护安装包调用者可构造多槽报告、只读及 stale 拒绝义务。已有 helper 测试不能证明 Node CLI 输出闭环，不逐字段增用例。fixture 结果仅用于验证 Runtime 契约，不冒称业务流程证据。
- S5 记录澄清：修复前 dogfood 的事务使用安装版 Node CLI，但 `s5-dogfood.ts` 第 6 行从本源码仓库导入 captureReviewTarget/readCanonicalCurrentTask/提案构造器。该次应记为“安装 CLI 执行事务，源码 helper 辅助构造输入”；历史 HTTP/持久化日志仍对应修复前版本。本次没有重新执行真实业务流程，不能将旧 dogfood 结论或旧安装 checksum 套用到修复后产物。
- 最终验证：定向 `bun test test/vnext-runtime.test.ts --test-name-pattern 'evidence-context|S4|S3'` 为 5 pass / 0 fail / 360 expectations；完整 `bun run test:workflow-all` 退出码 0，15 批次合计 **529 pass / 0 fail / 8271 expectations**，日志 `C:/Users/kongx/AppData/Local/Temp/vnext-review-fixes-all.log`。首次完整运行因本次写入的 CRLF 导致两项 LF 字符串 fixture 失败，恢复本次文件原 LF 后完整重跑通过，没有改测试断言掩盖错误。最后的 P-12 文案收窄另以 source suite 28 pass / 0 fail 验证。Runtime build、source/runtime contract、protocol、freshness、health 及 diff --check 均通过；完整 suite 含实际 distribution build/install/upgrade 回归。
- 安装版只读 smoke：新目录 `C:/Users/kongx/AppData/Local/Temp/vnext-review-fixed-install-crnoqoog`，通过分发 CLI 正常 install；使用之前的隔离 review fixture（不是业务数据），安装版 Node `evidence-context` 返回冻结 C1/S1/K1 当前 subject manifest，canonical 逐字节未变。`review-smoke.json` 保留结果；已分发 CLI/kernel 与当前源码生成物一致。最初校验脚本尝试比较未分发的 src/execute-step-adapter.ts 而报 FileNotFound，改为比较实际分发的 CLI/kernel 后通过；Runtime 命令本身成功，未导入源码 helper 构造报告版本。
- 精确本轮增量：kernel/execute adapter、Runtime Contract、FILE_SCHEMAS/WORKFLOW_PROTOCOL、execute-step/review-draft/validate-change 模板、既有 Runtime 测试文件、本 HANDOFF/MANIFEST；既有生成器重建 Runtime dist 和忽略的 distribution dist/payload。未修改其它已有源码差异；33 个受跟踪文件累计内容变化集合保持。P1/P2 四项已修复并自检，尚无修复后的独立复审或真实业务 dogfood；不标 independent clean 或已完成修复版业务验收。
- 修复 SHA-256：`runtime/vnext/src/kernel.ts`=`eda8b4b9a2c81f84523f3f983b0865cbfc6d60997792d69b059cd6eee9b88c47`。
- 修复 SHA-256：`runtime/vnext/src/execute-step-adapter.ts`=`34efa9823c573911bd0e56bc44fd558d9f2d3779cec3d239b109a45f6480f2c5`。
- 修复 SHA-256：`runtime/vnext/dist/cli.js`=`d8a272b934554c25071de9d9fe3c93aea2f3221554a47b4393d447e4b18f8fe9`。
- 修复 SHA-256：`test/vnext-runtime.test.ts`=`fe6c6fa6f29897e6c24db7dc47022e10ecb87494a9905894d3a8bfbe0eac3f6f`。
- 保留限制：caller-reported 不认证执行真实性；基线存储仍随已准入首触文件内容增长；unknown/业务失败、历史无 ledger 或预算耗尽需真实诊断与合法修复，不能伪造 finding/报告。真实旧任务及数据保留原状。下一步为用户按需收窄复审或授权修复版隔离业务 dogfood，停止，不自动发布/commit/push。

## 2026-09-12 Runtime 按需上下文与 rg 检索实施

- 授权与基线：用户确认本会话计划后要求实施；规格增量见 `RUNTIME_CONTEXT_PLAN.md`。起点 HEAD `5d5cafef18fff8306371966f50855c400187f9be`、0.16.0、工作树干净。根 AGENTS/CLAUDE 适用，无冻结登记或目标冻结标记。本轮不走旧治理渠道，不改真实 CURRENT_TASK/PROJECT_PROFILE，不操作真实业务数据，不 commit/push/发布。
- 版本：源码、Runtime、Distribution、锁文件、Runtime Contract 与生成版本同步到 **0.17.0**；canonical schema / business_evidence_version 保持原值。新增构建依赖固定 `diff@9.0.0`、`fflate@0.8.2`、`tar-stream@3.1.7`；前者打入日常 CLI，后两者只进入独立安装辅助 CLI，目标 Runtime npm 依赖仍为既有 yaml。依赖许可证随包保存。

### 正常读取接口与最小读写地图

- `review-context {}`：沿用既有累计 target、receipt、审查义务；完整路径/状态/hash 索引仍在 `recorded_execution.execution_result`，首个变更文件给出 `text_diff`，其它路径在 `unexpanded_paths`。**不再默认返回 review_preimages/content_base64**；完整首触正文由 `<workflow_home>/review-preimages/<sha256>.blob` 保存并由 `review-read` 按 hash 读取，不更换 dirty 起点或使用 Git HEAD 补造。
- `review-read`：stdin `{context_receipt,path,view?,start_line?,end_line?,offset?,max_bytes?}`；view=`diff/before/after`。复用已有 source/step/cycle/execution/cumulative-target 校验，范围从 Runtime 首触内容和已记录目标读取；陈旧 receipt/对象拒绝。二进制、链接、缺历史基线、diff 计算超限均明确返回 content_status，不视作 clean。
- `file-context`：stdin `operation=search` 接受 roots、globs、字面量 query、include_hidden、limit、max_bytes；`operation=read` 接受 path、sha256、行范围、offset、max_bytes。无需已确认任务。真实 rg 返回有限候选；默认 ignore，显式 glob 遵循 rg 原生覆盖优先级。无匹配、部分结果、超时和错误有区别；不把候选当作完整测试目录或通过报告。
- 文本默认 16 KiB、最大 64 KiB，完整文件索引另列；UTF-8 字节续读不拆字符，非首个文件页绑定 sha256。行范围 1-based inclusive；offset/total_bytes 相对所选范围。搜索默认 50 条、最多 200 条、10 秒超时；raw stdout/超长单行也受限。完整输入定义随包放在 `.workflow-system/runtime/support/CONTEXT_API.md`。
- `validate --summary`：返回身份、版本、状态及待审路径等摘要，不含 Runtime 正文；原 `validate` 完整诊断格式保留。prepare/review 两个现有 Skill 只增加调用路由与按需文档引用，frontmatter/entry_contract 未变，没有新公共 Skill。
- 读取链：CLI → file-context/review adapter → 原有 canonical/manifest 校验或 rg/当前文件；不写 canonical、基线、报告、权限、测试身份或 review 结论。未改动的旧测试不进入首触存储。复用测试及 helper/fixture/config 沿用 S2 的 check.subject_paths、版本失效与 report；新增/修改测试仍需 P-12。

### rg 安装、升级与失败边界

- Installer 的 `prepareRuntimeDistribution` 在现有暂存流程中运行独立 `install-tools.js`：优先验证本地 rg，再复用兼容 PATH rg（14.1+ 的 14 系列或 15 系列，并执行功能探针）；否则下载官方固定 **15.2.0** 平台包，校验内置 SHA-256 后提取指定可执行文件。Windows/Linux/macOS x64/arm64 有固定映射，Linux 为 musl。
- 管理目录为 `.workflow-system/runtime/tools/rg/`，与 node_modules 一同声明计划写入并进入目录提交/回滚；安装前校验路径、所有权和冻结边界。PATH 复用不把机器绝对路径写进 canonical。下载/解包/校验/探针失败仅影响暂存，不宣称安装成功。只读命令不下载；缺依赖返回 RG_DEPENDENCY_MISSING。
- 同版本正常 upgrade 可在受管软件完整时补足丢失的 rg 依赖，继续经过原升级准入、冻结、自检和回滚；不扩展为一般漂移修复平台，不绕过源码漂移。旧安装升到 0.17.0 也通过同一链路。未使用系统包管理器、管理员权限、全局 PATH 修改或数据库。

### 实际验证

- 最终完整 `bun run test:workflow-all` **退出码 0，15 批次合计 534 pass / 0 fail / 8423 expectations**；日志 `C:/Users/kongx/AppData/Local/Temp/vnext-context-all-complete.log`。包括 Runtime/多槽完成门、S3 累计及 repair、retry、迁移、bootstrap、实际 npm 打包安装、分发升级/回滚和现有检查。新增 5 组上下文/依赖场景复用真实 rg；已有 S3 增补 Node CLI `review-context → review-read`、raw validate 兼容和 summary 零正文验证，读取前后 canonical 字节一致。
- P-12 测试依据：本次用户计划、PLAN V8/V9/V10/V12 的版本/累计目标/真实接口义务；owner=Runtime 源仓库。新独立文件仅覆盖此前缺少的真实检索、长行续读、依赖安装错误；已有生命周期与安装用例承接 CLI 读取和回滚，不新增业务测试平台或可信 Provider。
- 大基线场景实测：首触正文 **782,022 bytes**（前文“约 748 KB”为旧估算），base64 为 **1,042,696 bytes**；追加一条断言的文本 diff 为 **280 bytes**，累计上下文整体断言小于 64 KiB。该 280 bytes 仅是 diff，不包含索引/报告元数据，也不是精确 tokenizer token 数。完整首触内容仍逐字保存。
- 最终 Windows 真实下载安装：`C:/Users/kongx/AppData/Local/Temp/vnext-context-final-jQs389/report.json`。对子进程移除 PATH 中的 rg，使用最终分发 Node CLI install，实际从官方源下载校验 15.2.0；再用安装版 CLI 搜索已有测试并按第 2 行读取 CRLF 文本，三次退出码均 0。安装后 CLI SHA-256 与当前源码生成物相同；没有创建 CURRENT_TASK、基线或报告。此为真实工具安装/读取 smoke，不是业务 dogfood。
- Runtime build、Distribution build、gen:all、source/runtime contract、protocol、freshness、health 已通过。通用 skill-creator quick_validate 不认识仓库原有 `entry_contract` 顶层字段，两份 Skill 前后 frontmatter 完全相同；本轮保留仓库专用 Skill 契约，不将通用校验结果写成通过。
- 中间失败不计为通过：新增安装测试局部变量重名已修正；并发重建分发目录期间的 bootstrap 失败在固定产物串行运行中消失；原“空所有权”夹具补充清理新增 rg 依赖目录，保留原有所有权断言。最终以以上退出码 0 的完整日志为准。

### 产物与剩余限制

- 日常 `dist/cli.js` 为 951,411 bytes（原 917,166，增加 34,245）；独立安装辅助产物 97,661 bytes；本次 Windows rg.exe 为 4,218,880 bytes。Skill 正文仅作必要路由，详细 API 与第三方声明按需读取。
- SHA-256：`runtime/vnext/src/file-context.ts`=`6aebcbf295b56ab8db36604d0435075a5c4aa6708ca1f2333e901ac2072c531e`；`review-change-adapter.ts`=`c9e9320985aad643a94fcc3c50af3a7bfe1cf4381ab37b463e83b8b5612b147e`。
- SHA-256：`runtime/vnext/src/rg-tool.ts`=`1fedc058c184777e2832d817db1efda4d21ca0ce911c61d8ea4b758999119b37`；`install-tools.ts`=`194a486fa41b5fc70f293faa645c703f2febd04e4b02a16179de204dd85a4fa9`。
- SHA-256：`runtime/vnext/dist/cli.js`=`1b6ca2a5ec9781da666df59f9687d74186053dca58cc2e183d1e40b871a2b9ae`；`dist/install-tools.js`=`52dda1d9ccff732ba5363449c0b77c74969012259ad44d9bc9bb1fc90cc0386c`。
- 本轮工程实现与 Windows 验证完成，无已知未修复阻塞。**未实际运行 Linux/macOS 可执行程序，也未重新运行业务 dogfood、未做独立复审**；ZIP/tar.gz 有隔离解析回归，不替代平台运行。完整 canonical 的存储、解析与 Runtime 内存成本仍随基线内容增长；搜索是当前树候选发现，不覆盖 Git 已删除历史。报告与语义 review 仍为 caller-reported，不提升真实性保证。
- 下一步：用户可独立审查本轮未提交 diff，再另行授权修复版隔离业务 dogfood。到此停止，不自动开始其它步骤或发布。

## 2026-09-12 聚焦审查 P2 修复：大基线下 rg 恢复

- 用户直接授权修复；保留此前未提交改动。根 AGENTS/CLAUDE 适用，无冻结登记；未修改真实 CURRENT_TASK、PROJECT_PROFILE 或业务数据，未使用旧治理渠道，未 commit/push/发布。版本保持 0.17.0。
- 问题复现：正常 Runtime preflight 保存大基线后，安装版完整 validate 成功但输出 1,234,839 bytes；丢失 rg identity 后，同版本 upgrade 因子进程默认缓冲上限产生 ENOBUFS，误报 UPGRADE_NON_IDLE。
- 修复：Distribution 升级准入对已安装 0.17.0 及以后版本调用 validate --summary，读取 summary 中的原有状态元组；仍只接受 active + active 或 closed + archived。旧 Runtime 不支持摘要，保留原始 validate 路径，不假定旧接口存在。未修改 Runtime 实现、Skill 或完成证据门。
- 回归：复用正常 prepare/confirm/preflight fixture，构建独立临时分发包并安装真实 Runtime；确认原始输出超过 1 MiB，删除隔离 rg identity 后 dry-run ready、实际 upgrade upgraded、依赖恢复，canonical 字节不变。已有 draft 拒绝用例扩展覆盖旧版读取与新版摘要两条路径。P-12 owner=Runtime 源仓库，basis=regression/critical-invariant，依据本次用户修复授权及按需上下文计划的恢复/权限保持义务；不把 fixture 当作业务 dogfood。
- 验证：最终大基线定向回归 1 pass / 0 fail / 9 expectations（隔离构建夹具版本）；完整 test:workflow-all 退出码 0，15 批次合计 536 pass / 0 fail / 8436 expectations，日志 C:/Users/kongx/AppData/Local/Temp/vnext-rg-recovery-fix-all.log。完整运行期间只对已执行的大基线夹具补充了独立临时构建，随后定向重跑通过；完整分发批次包含最终的两条 draft 拒绝回归。protocol、freshness、health、改动文件 diff --check 均通过；按 simplify 检查保持小范围实现。
- 限制：旧于 0.17.0 的 Runtime 仍使用原始 validate，其已有大输出限制未在本轮扩展处理。未运行 Linux/macOS 可执行程序、未重新运行业务 dogfood或独立复审。此次确认的 P2 已修复并自检；不标 independent clean。到此停止。

## 2026-09-12 修复版 0.17.0 隔离业务 dogfood 完成

- 本轮基线：HEAD `fc32e9039311335aff5f147920189d1088909199`，开始时工作树干净。此前修复已由外部提交到当前 HEAD；本轮没有 commit/push/发布。用户授权继续隔离业务验证，不使用旧治理渠道。根 AGENTS/CLAUDE 适用，无冻结登记；源 Runtime、Skill、真实 CURRENT_TASK/PROJECT_PROFILE、真实 FixFlow 业务文件均未修改。
- 当前结论：**工程实现及修复版真实业务流程验证完成，assurance=caller-reported**。本次同调用方阅读实际累计 diff 后提交 review，不标为宿主认证独立审查或可信 Provider。无本次剩余 dogfood 阻塞；跨平台运行与更强真实性认证仍未验证。
- 成功实例：`C:/Users/kongx/AppData/Local/Temp/v017-business-QprE5H/`。主结果 `result.json`；安装核验 `installation.json`；正常 Runtime 输入/输出 `runtime-log.json` 和 `close-log.json`；负向门 `negative-gates.json`；实际业务报告 `project/rule.json`、`project/flow.json`、`project/observations.json`；审查输入 `review-context.json`、`app-diff.json`、`test-diff.json`。驱动 `driver.mjs`、`close-driver.mjs` 随实例保留，只导入 Node 内置模块，**没有从源码仓库导入 Runtime 状态读取、hash/manifest 或 proposal 构造 helper**。治理操作全部经安装版 Node CLI；报告版本通过 evidence-context 获取，raw proposal 使用普通 JSON 输入接口。
- 隔离业务范围：复制既有 FixFlow src/test/package，复用其已有依赖（只读 node_modules junction）。只在新 project 中将工单 title/location 写入值 trim；更新既有创建测试的输入为带空白文本，保留原有独立预期断言，新增测试数 0。既有 4 个测试实际执行，4 pass / 0 fail。SQLite 是原 FixFlow 产品存储，数据库仅位于此实例的 `business/data/fixflow.sqlite`，不属于 vNext 依赖或新存储设计。服务只监听 loopback；未使用真实用户数据。
- 正常接口闭环：Distribution install → bootstrap-support preview/显式 write → file-context search/read 发现并按行读取已有测试 → prepare-draft/confirm-draft → 两步 preflight/record → evidence-context → review-context/review-read → record-review-result → complete-reviewed-step → apply archive → apply project-status。ordinary flexible 首步允许实现，无 mandatory Red。首步免审，末步 required 累计目标实际为 `src/app.ts`、`server.js`、`test/tickets.test.ts`，早期修改没有丢失。模型侧读取的 app/test diff 分别 506/454 bytes；完整原文仍由 Runtime 保存。
- 环境恢复实测：服务未启动时真实 HTTP 连接失败，record-step-result 登记 environment blocker，并保留已准入的测试修改。启动服务后 GET 未知工单返回 404，提交精确绑定 failure 的 environment-restored/v1；retry 成功，重复同请求 no-op，再重新 preflight 和实际运行。failure.json 与 resolution.json 保留，没有覆盖失败、直接完成或伪造 finding。
- 必要负向门实测：既有测试成功且实际非法 priority POST 返回 HTTP 400后，只提交 rule 成功报告，flow 仍 missing；raw complete 返回 CLAIM_EVIDENCE_INCOMPLETE，raw archive 返回 CLOSURE_NOT_ELIGIBLE（包含 durable claim evidence incomplete），两者 committed=false、governed_mutation_count=0。没有把格式错误当作此门通过，也没有编造 failed 业务报告；failed/blocked/not-run 等变体继续引用既有工程回归。
- 真实成功流程：带首尾空白的 POST /tickets 返回 HTTP 200，标题 `Persistence ticket`、位置 `Lab 017`、priority `medium`、status `open` 与显式预期相符；GET 返回同对象。停止 Node PID 61764 后以 PID 78928 启动同一产品服务，从同一磁盘数据库 GET，HTTP 200 且所有字段与首次保存对象完全一致。两个进程已退出。随后提交独立 flow 报告，保留 rule 报告，Runtime 返回 evidence_assurance=caller-reported。
- 完成及对账：实际阅读 app/test/生成 server 三项累计 diff、四项测试结果及 HTTP 报告后提交同调用方语义 assessment，涵盖必要性、独立 oracle、复用与真实存储边界。完成末步、归档及 STATUS 对账均 read-back verified；STATUS 重放 no-op。最终摘要 `task_id=001, workflow_status=closed, lifecycle_state=archived, active_step_status=completed, pending_review_paths=[]`。Lesson 显式 defer，未声称产生独立知识或额外成果。
- 分发与环境：Node v24.12.0，Runtime/Distribution 0.17.0。正常重建 Runtime 与分发，工作树无生成内容变化；分发 digest `6033f2a39b02c41a948927ce95077ef80fe977a948c485f37f4f7a0e1b8a699c`，bundle `bundle-77afe5096e22a828ffd26413`。安装后 41 个受管文件逐一核对 checksum；安装 CLI 与源码构建 CLI SHA-256 均 `1b6ca2a5ec9781da666df59f9687d74186053dca58cc2e183d1e40b871a2b9ae`。实际 file-context 使用兼容 rg；本次未重新验证无 PATH rg 下载（此前实际 Windows 下载记录保留）。
- 本次检查：build:vnext-runtime、build:vibe-governance-distribution、validate:vnext-source、安装/源码 Runtime validate-contract、validate:protocol、validate:freshness、workflow:health、git diff --check 通过。此前完整工程回归为 536 pass / 0 fail；本轮未改实现，不重复计作本次完整重跑。V1/V2/V4/V9/V11/V14 具有本次业务实例，V8/V10/V12 维持既有工程回归并补充本次版本绑定/语义阅读；V3/V5/V6/V7/V13 的其它变体仍以先前已记录回归为证，不声称本次逐项业务重演。
- 真实目录保护：真实 FixFlow 的 app.ts、server.ts、tickets.test.ts、package.json 和 CURRENT_TASK 前后 SHA-256 一致，哈希保留在 installation.json；真实 CURRENT_TASK revision 仍 `2ce6a42ab9aea277d04c3129843e7c7892dad15d9ecbfd7986963841167ef9e1`。没有读取/重置真实业务数据库，所有服务工作目录均是本次新 business 根；源仓库治理状态保持原样。
- 中间尝试如实保留：`v017-business-bIcHKk` 的驱动误传 preflight 不支持字段，Runtime 拒绝；`v017-business-LI6Ogd` 的 raw complete envelope 漏 rule.json 引用，Runtime 在 evidence 校验拒绝。只修临时驱动输入，未改 Runtime；早期目录与日志保留，不计为成功实例，所启动服务均在 finally 退出。最终成功实例独立完成全部上述过程。
- 剩余局限：当前树检索不覆盖 Git 已删除历史；完整基线的存储/解析成本仍随内容增长；旧于 0.17.0 的升级读取保留原有大输出限制。未运行 Linux/macOS 可执行程序、生产升级、真实页面（本业务 API 无页面）或独立身份审查；不认证所有调用方报告真实性。不再留“修复版真实流程报告未补齐”作为阻塞，下一步仅为用户按需审阅本次证据或决定发布；本轮到此停止。

## 0.18.0 旧迁移兼容与 alpha 落地（2026-09-12）

### 范围、接口与实际完成

- 用户明确授权本方案及真实 alpha 迁移。起始源码 HEAD `469b8419e987825c5e345b4c181d064c7eaeed4b`，工作树干净；现行 AGENTS/CLAUDE 与冻结边界已核对。没有 reset、旧治理调用、源码 CURRENT_TASK 改写、commit、push 或发布。仅操作 `E:/coding/TermLink-rust-source-resolution-alpha`，未操作 gemini。
- 已完成 `migrate --decisions-file`：caller-reported 决定绑定目标绝对路径/identity、当前任务原始路径/完整 SHA-256/历史 ID、完成认定、每个暂停文件路径/SHA-256、用户原文与来源。缺省保持严格准入；错目标/hash/ID、未声明暂停包、活动或中断状态及当前 open finding 继续阻断，无 force。
- Pack v2 纳入决定；保留旧 Pack v1 确定性 identity 和旧转换规则；receipt v1/v2 都可读。共享 `migration-preservation.ts` 只校验结构化保留证据，没有旧协议解析、兼容 Skill 或恢复入口。Runtime/分发/契约同步为 0.18.0。
- 旧 CURRENT_TASK 原始字节纳入现有原子事务，以完整 hash 命名备份；同内容复用、冲突拒绝。暂停包不进入转换、写入、删除清单。暂存依赖后、落盘前重新校验 Pack/目标漂移，落盘后校验备份与暂停文件摘要；原有冻结/回滚保留，外层回滚清单包括 rg 工具目录。
- 真实历史材料暴露并修复两处兼容问题：WORKFLOW_GUIDE 的同目录文件引用仅在校验视图兼容；内联 HTTP/本机路径与命令示例保持原文，不将命令反斜杠或字面 `\n` 改成斜杠。旧 Pack v1 仍按旧字节规则校验，v2 使用收窄后的引用规则。未扩张 public Skill。

### 真实 alpha 迁移与原文保护证据

- 原安装 0.14.5（legacy protocol 0.3.0）；用户将 `TASK-20260827-002` 明确认定为完成。未手改旧 CURRENT_TASK 来满足预检，其原始状态 `completed_verified_archived（TASK-20260827-002 已归档）`、历史 ID 和缺失的旧生命周期字段保留在来源证据中。
- 先在隔离副本验证，再对真实 alpha 重新快照、dry-run、核对与副本一致的清单，经正常 Node 分发入口迁移：97 项写入、187 项旧受管文件删除，业务 `src/`、`tests/`、`docs/codex/` 零写入/删除。安装返回 `installed`、`read_back_verified=true`。
- 对迁移前 1,554 个 Git tracked/untracked 文件逐项核验：1,392 个字节不变；48 份长期文档/归档/项目 profile 经 canonical 转换，正文只允许清单内确定性路径规范化，零额外差异；项目 facts 解析后完全一致。其他变化限于声明的旧软件产物替换/删除及新任务基线。原有 15 modified、2 untracked 的业务改动保留；其中 dirty STATUS 与未跟踪的旧任务归档只加 canonical 结构并保留正文、原始摘要。未运行或替换业务代码/测试，未删除未跟踪业务文件。
- 当前任务原文备份：`E:/coding/TermLink-rust-source-resolution-alpha/TASKS/legacy/CURRENT_TASK-f75cd2d7a0bc4559fa41b5d4a3afd4781e18d9fcd4251f0409a7c6b17f22593c.md`；其 SHA-256 等于文件名中的完整值，与迁移前旧 CURRENT_TASK 字节一致。
- 暂停包一：`TASKS/paused/TASK-20260615-001-app-codex-ipc-realtime-sync.md`，SHA-256 `f46d952bed22f798c543102b0092c00b34ec01ea4777be91181ce406789a6d6c`。
- 暂停包二：`TASKS/paused/TASK-20260727-002-codex-single-authority-owner-control-plane.md`，SHA-256 `b4ce7320e3baeeeef168847c6dc07f7d6e5d4f1f198907e08b8d6a616a76195b`。
- 两个暂停包在副本与真实目录前后均同路径同字节；**未转换、未认定完成、不可直接由 vNext resume**。各自原文内的 manual smoke、后续步骤等未完成义务仍存在。安装版 Runtime 的两个合法形状 resume dry-run 都返回 `RUNTIME_PATH_INVALID`（不满足当前任务 identity-derived package 路径），`committed=false`、`governed_mutation_count=0`；没有为测试伪造新任务或将暂停包改成原生格式。
- 持久 receipt：`E:/coding/TermLink-rust-source-resolution-alpha/.workflow-system/vnext/MIGRATION_RECEIPT.json`，schema 2、Pack `migration-5bfa1cd9d14999d5e24ebbdd`；含用户决定逐字摘录、来源、旧 ID/hash、备份路径和暂停文件摘要，assurance=`caller-reported`，paused_disposition=`verbatim-unconverted-not-resumable`。它不是认证签名，也不是历史测试、归档成功或业务执行的证明。
- Runtime `validate --summary` 与 `validate-contract` 成功；新软件基线为 `000 / bootstrap-baseline / closed + archived`，canonical revision `76eddc36c81faf1f4f3b3bf6dd8e49567519eac17c30a2469eac79cea716b710`，没有把旧历史 ID 转成此任务。42 个软件受管文件全部校验。源码构建与安装 CLI SHA-256 均 `f6cd5f77428d02a5f674a91ef35f592fd6f951c1f456db4ac236cea09e3b8819`。
- 最终分发 digest `a99115cd71c8126accd697c3843695c54d57015425db49c31f03377bb24e5b70`，bundle `bundle-1b1095dbab110446691f1646`，与真实安装相同。再次 `migrate` 保持原有 `MIGRATION_NOT_APPLICABLE`、零清单/零写入语义；正常 `install` 重验为 `no-op`、`read_back_verified=true`。Pack 层同 identity 重放成功由回归覆盖，不混称 CLI migrate 返回 replayed。

### 验证与边界

- 本轮完整 `test:workflow-all` 为 **540 pass / 0 fail**。其后副本发现的边界修正已重跑迁移回归 **18 pass / 0 fail / 100 assertions**，含备份复用/冲突、哈希绑定/漂移、当前 open finding、暂停不转换、失败回滚、Pack 重放、旧 v1 命令转换兼容、内联示例保留。分发回归另重跑 **18 pass / 0 fail**；不把增量测试冒充新的完整测试轮次。
- `build:vnext-runtime`、`build:vibe-governance-distribution`、`gen:all`、`validate:protocol`、`validate:freshness`、`workflow:health --root .` 和 `git diff --check` 已执行；最终文档写回后再核对生成新鲜度与差异。验证报告是本调用方实测记录，不声称独立审查身份。
- 最终证据目录 `C:/Users/kongx/AppData/Local/Temp/alpha-vnext-migration-nwpMoh`：`preimage/`、`original-hashes.json`、`original-status.txt`、`copy-confirmed-*-result.json`/`copy-confirmed-verification.json`、`alpha-decisions.json`、`alpha-preflight.json`、`alpha-result.json`、`alpha-verification.json`、`alpha-canonical.json`、`alpha-contract.json`、`alpha-replay.json`、`alpha-install-readback.json`、逐项检查脚本及测试日志。真实项目的上述 receipt/旧当前任务备份/暂停原文不依赖临时目录存续。
- 早期 `alpha-vnext-migration-keH4uU` 与 `alpha-vnext-migration-MEfAwJ` 为中间副本；后者正文检查发现命令被旧转换器改写，已修复并以全新副本重验。它们不作为最终成功证据，真实项目在修复验证完成前未落盘。
- **迁移完成；历史暂停工作仍待单独处理。** 本轮没有真实业务执行、业务验收或暂停工作接续。后续须用户单独指定暂停包，模型先读原文和当前业务状态，再通过正常 vNext prepare/confirm 明确计划。目标自有 AGENTS/私有 Skills 与长期文档中的历史指令未作语义改写，旧路由文字属于保留内容，不能据此认定旧命令仍受安装支持。未验证 Linux/macOS 实机迁移；无剩余软件迁移阻塞。到此停止，不自动创建业务任务。

### 用户复审后的结论纠正（2026-09-12）

本节撤回上节“迁移完成”及“无剩余软件迁移阻塞”作为整体验收结论。分发安装、Runtime canonical 读取、旧 CURRENT_TASK 备份和暂停包 hash 校验通过，只能证明相应安装与保留边界；**目标 workflow-system 整体迁移未完成**。

用户提供的只读复审指出四组未收敛事项，本轮针对性复核确认了以下实际问题：

1. AGENTS 仍要求旧 sync-host-guidance、Bun 生成/同步及旧工作目录；当前宿主入口未对齐已安装 vNext。
2. WORKFLOW_GUIDE 与 DOCUMENT_CATALOG 仍引用旧流程和已删除产物；保留历史内容不能替代当前可执行指南。
3. PROJECT_PROFILE 仍声明旧模板/生成目录、旧生成验证命令及不存在的 CLAUDE.md；业务事实保留不等于验证矩阵可用。真实 `.agents/skills/` 下可见 37 个 workflow-system-* 旧目录，先前隔离副本只额外复制 .codex/.claude 技能目录，未覆盖这些既存入口；此前“无双入口”的验证范围不充分。
4. STATUS 当前视图仍保留旧任务 active/closeout 描述。正文校验曾将路径规范化视为可接受，未证明逐字保真；实查 Windows 安装文档将 `{localappdata}\\Programs\\TermLink` 作为 repo-relative 规范化，已进入正文。source_sha256 是原始输入摘要，并非转换后正文摘要，所以哈希不同本身不能单独证明损坏；但不能用此解释免除对用户报告的 13 份正文差异逐项核查，也不能继续将 original_text_preserved 等同于字节保真。

下一修复范围应同时覆盖迁移器的实际入口盘点/收敛、目标宿主与项目画像、当前指南/目录/状态对账，以及原文保留与转换声明契约，并在包含现存 .agents 技能的完整隔离副本验收。当前报告纠正没有修改真实 alpha、删除旧技能、改写历史任务或暂停包，也没有把旧任务标完成绕过检查。整体完成前必须重新验收上述四组事项；历史暂停工作继续保持独立待处理状态。


## 2026-09-13：迁移完整性修订（源码与回归）

### 已实施边界

- Pack 升为 schema 3，receipt 升为 schema 3；继续校验旧 v1/v2 Pack 与 receipt，旧转换规则含义不变。版本保持尚未发布的 0.18.0。
- 新转换规则 `canonical-verbatim-v2` 保持历史 Markdown 正文原文；路径规范化仅用于索引。变量赋值、Windows 路径表达式不再误当仓库路径。当前投影的头部索引对应实际新正文，来源索引与原文绑定。
- AGENTS/CLAUDE 只修订 workflow-system 指引与旧技能引用，保留业务约束和私有技能；不存在的 CLAUDE 不创建。当前 GUIDE、CATALOG、STATUS 与 vNext 入口及 baseline 对齐，历史业务状态明确作为历史快照保留。
- 项目画像和 package.json 只清理已识别的旧 workflow 配置、失效命令；保留业务事实、业务槽、依赖与脚本。遇到自定义命令冲突或未解决引用拒绝迁移，不猜测替换。
- 明确修订的当前文档不再声明原文保真：`original_text_preserved: false`，原始文件完整备份至 `.workflow-system/legacy/<sha256>/<原路径>`。原文备份、投影、原路径和 receipt 完整性绑定；辅助宿主/package 文件保持原生格式。
- 删除 `.agents/.codex/.claude` 中识别出的旧 `workflow-system-*` 技能整个目录及支持文件；保留私有技能与非前缀同名技能。完整目录纳入漂移、冻结与删除清单检查，临时命名子目录不遗漏。
- 沿用现有事务、漂移拒绝、冻结检查、回滚及幂等；不增加通用恢复平台、public Skill 或日常 Runtime 业务能力。原先 decisions-file 的精确完成决定及暂停包保留语义不变。

### 实际验证

- `bun run gen:all` 与完整 `bun run test:workflow-all` 通过：541 pass / 0 fail。日志：本机临时目录 `migration-v3-all.log`。
- 完整回归后补充了投影索引、完整目录漂移、原路径/来源索引绑定和表达式分类检查；最终 `bun test test/vnext-migration-pack.test.ts`：19 pass / 0 fail，130 assertions。日志：`migration-v3-tests-final.log`。
- 最终分发构建后，定向分发集成测试显式使用 `node` 运行正常 migrate 入口与安装后的 Runtime：1 pass / 0 fail，17 assertions（其余 17 项筛选未运行）。覆盖 37 个旧技能目录、业务指引/脚本保留及安装后校验。日志：`migration-v3-node-final.log`。此前完整套件中的分发测试使用 Bun；不将其冒称为 Node 验证。
- 本地 0.18.0 分发 digest：`6a737588bc8a2d7f3f299a62c8bfa3aece1012655d715486cf7c483f8bbd387e`，bundle：`bundle-fe6ccb5f83d7cc8732201b82`。此摘要不代表真实 alpha 已安装此修订。

### 尚未完成与下一步

本轮仅源码、契约、生成分发和隔离回归 fixture；没有写入真实 alpha，没有还原其基线，没有替换业务源码/测试或清理其未跟踪文件。保留本轮开始前的未提交修改，没有 commit、push 或发布。

下一阶段须在用户恢复后的旧 alpha 基线上制作隔离副本，完整迁移并核对业务改动、项目事实、当前入口、历史原文和两个暂停包；之后再对真实旧基线快照、dry-run 并核对精确清单。已是 vNext 的再次 migrate 补齐场景明确不支持。非 workflow 的 AGENTS 路径与用户业务指引不由本次迁移器改写。源码回归通过不能替代真实项目迁移验收，历史暂停工作也不能随软件迁移视为完成。

最终检查：`validate:protocol`、`validate:freshness`、`workflow:health --root .` 与 `git diff --check` 均通过。health 为源码仓库既有检查，不表示调用旧治理完成/归档渠道。


## 2026-09-13：独立审查两项修复与后续阻塞

本轮仅修复冻结误判和公开 decisions 输入缺口，保留已有修改。真实 alpha 仍为旧基线 `6f1182f9f7ebb2818e237f487f38e6e15a881f81`、工作树干净；未写入目标、未 commit/push/发布。

- 冻结检测继续检查前 20 行：保留大小写不敏感的显式 `@frozen` 标签、全大写 `DO NOT MODIFY` 标记和原冻结登记规则；普通 `Do not modify business code in this skill.` 不再误判。加入自然语言反例、真实标记/登记正例及旧技能支持文件的正常 Node 迁移回归。
- 公开 `migrate --root <project> --json --dry-run` 在旧 profile 身份可解析时返回 `migration_target: {target_root,target_identity}`，包括缺少决定而拒绝的情形。该数据不授予准入，不生成用户决定。README、CLI help 和迁移契约同步；公开 Node 测试仅使用该输出构造决定，并验证错哈希拒绝、dry-run 不落盘。
- 最终迁移回归：20 pass / 0 fail，138 assertions（临时目录 `migration-freeze-fix.log`）。最终完整分发回归：19 pass / 0 fail，249 assertions（`migration-public-suite-final.log`）。首轮新增测试错误使用 active 任务，准入正确拒绝；修正为历史完成格式后通过，未放宽产品规则。
- `validate:protocol`、`validate:freshness`、源码 `workflow:health --root .` 和 diff 检查通过；本轮没有重新运行全部 workflow-all，不将局部套件冒称全量回归。

对原验收隔离副本 `E:/coding/_acceptance/alpha-vnext-migration-20260913/alpha-copy` 再执行正常 Node dry-run：冻结误判已消失且目标身份公开返回，但出现后续 `UNSAFE_PATH`，指向 AGENTS 中 `E:\\coding\\TermLink\\.codex\\skills\\local-dev-server-control\\SKILL.md` 的历史私有技能 Markdown 链接。证据在临时目录 `alpha-fixed-dry-run.json`。其路径索引仍将 Markdown 绝对链接当成不安全仓库路径；本轮未改写目标正文或绕过错误。

迁移整体验收仍 blocked，未执行迁移写入。下一修复应聚焦历史 Windows Markdown 外部路径的索引分类，同时维持真实读写路径校验和正文保真；然后从旧基线重新做公开用户流程验收。历史暂停工作仍待单独处理。


## 2026-09-13：Windows 私有技能链接阻塞修复

仅在 Pack v3 的 Markdown 引用索引中，将盘符绝对路径识别为 external，原值保留、adjusted=false；涵盖反斜杠/双反斜杠、正斜杠和带空格的尖括号链接。它们不被读取，不成为写入目标。实际 resolveRepoPath 与 artifact 目标准入保持不变；控制字符、父级穿越仍拒绝，Pack v1/v2 原规则不变。契约已同步。

回归将真实 Windows 私有技能链接放入 AGENTS 业务段和历史正文，验证原文备份、正文一致性、索引分类与正常迁移/回滚。最终迁移套件 20 pass / 0 fail / 140 assertions（临时目录 migration-windows-links-final.log）；公开 Node 分发定向测试 2 pass / 0 fail / 27 assertions（migration-windows-node-final.log，其余 17 项未运行）。生成一致性与 diff 检查通过。本轮未声称重跑 workflow-all。

正常 Node migrate --decisions-file --json --dry-run 在既有 alpha 隔离副本返回 ready，blockers=[]，计划写入 105 项、删除 295 项；证据：本机临时目录 alpha-windows-fixed-dry-run.json。旧快照涉及的 1554 个路径在副本与真实旧 alpha 间逐字节一致，未执行迁移写入。此前两项阻塞及本项阻塞均已解除，但 ready 仅为预检结果，不是完整迁移验收。

真实 alpha 未改动，保留已有源码修改，未 commit/push/发布。下一步按公开用户流程在隔离副本执行迁移并独立验收实际效果；历史暂停工作仍待单独处理。

## 2026-09-13：项目文档固定导航入口（限读取规则）

按用户本轮要求，只补“项目画像 → 文档中心 → 与任务相关的 REQ、PLAN、架构/技术/设计、Contracts/Decisions 正文”的读取路径。使用 skill-creator 的渐进读取原则：共享说明位于现有 `runtime/vnext/support/CONTEXT_API.md#project-document-navigation`，prepare-task（含 refinement/replan）、execute-step、review-draft、review-change 四个模板引用该说明；SOURCE_CONTRACT 补充既有画像和文档中心作为导航输入。没有新增 public Skill、项目格式字段、自动语义解析或治理写入接口，没有修改迁移器。

`paths.documentation_files` 作为种子而非全量必读列表；优先实际项目目录，缺索引时从 README 的文档链接和已观察目录进行有界检索。只跟随与任务有关的 related_docs/related_code、章节和 ID；保留用户/宿主明确要求的完整读取，检索截断不等于不存在。目录、草案、归档和模板不自动成为现行要求；有实质冲突或必要来源不可用时使用既有 unresolved/blocker 结果。来源只通过现有解释或引用说明，不塞入用户原文 Task Basis，不声称 Runtime 证明模型已读或自动识别全部冲突。

实际验证：

- `validate:vnext-source` 通过；`bun test test/workflow-vnext-source.test.ts test/vnext-context.test.ts` 为 33 pass / 0 fail / 336 assertions。
- `validate:protocol`、`validate:freshness` 通过；现有生成参考 fresh。本轮不新增机械镜像文本的测试。
- 正常分发构建完成，四个模板和共享说明均进入 payload。0.18.0 manifest digest：`74490d04f70d852549b8286ba1d53cfe8fc3a975ea50ca0e45f2aed5a35101fc`；bundle：`bundle-17e41c2c8e12faf1f25a5189`。公开 Node 安装定向回归 `fresh Node install promotes complete software`：1 pass / 0 fail / 124 assertions，其余 18 项未运行。未声称重跑 workflow-all。
- 对真实 TermLink codex 使用已安装 Node Runtime `file-context` 只读查询：画像列出 `docs/README.md`，文档中心定位 `docs/product/`，检索 Linux installer 得到 REQ-20260715 的正文与其 related_docs 指向的 PLAN，再从现行 Decisions 找到 AD-003。检索均 pass、不截断，按范围读取返回文本和 SHA-256；没有创建或确认业务任务。
- 该样本同时暴露历史材料限制：REQ/PLAN 的验收仍指向可变的 CURRENT_TASK，而现有 CURRENT_TASK 已是 bootstrap 000；PLAN 还记有待外部 smoke。导航找到这些材料不意味着验收已完成，也不能把 bootstrap 的验收当成旧安装器验收。本轮保留原文，仅报告该限制。

本轮仅修订源码说明、契约和模板并构建本地分发，保留既有修改，未写真实 TermLink/alpha，未手改已安装 Skill、receipt 或 CURRENT_TASK，未 commit/push/发布。真实 TermLink 的安装版尚未获得本轮模板修订；此前列出的旧命令、私有 Skill 路径、遗漏产品约束及 receipt stale 不在本轮修复范围内。下一步若升级目标，应沿正常软件升级入口；结构化持久文档依据与版本门禁仍是后续独立范围。


## 2026-09-13：任务保存具体项目文档依据

本轮只补正常任务输入、canonical 持久化和后续读取，不扩展迁移器或语义冲突平台。未修改真实 TermLink 项目，未 commit/push/发布，保留本轮开始前的源码改动。冻结注册表不存在，修改文件无适用冻结标记。

接口与存储：

- `prepare-draft` / `replan` 的 semantic JSON 可选地成对提供 `project_documents` 与 `affected_contracts`。前者最多 64 项，每项为 `{path, section, revision, purpose}`，字段为有界单行文本；path 是仓库相对正斜杠路径，不接受越界/绝对路径，同路径同章节不重复。后者是本任务拟影响的具体契约引用/说明列表；查阅某契约不自动表示修改它。
- 来源记录写入既有 CURRENT_TASK 背景章节的 `### Project documents` / version 1 JSON；契约影响写入既有“受影响的契约”章节，撤除固定 `- none`。不另存文档全文，不混入用户原文 Task Basis。共享 codec 参与 Runtime 定义校验与读取。
- `validate --summary`、完整 `validate` 和 `review-context` 返回 `project_documents` / `affected_contracts`。执行使用已有 summary 读取；没有新增公共命令。旧任务未记录来源返回 null，显式无来源返回 []；旧任务缺少背景/契约章节时 summary 不要求补齐新格式。
- 新记录在 refinement/replan 时必须明确重提交两个字段（可显式 [] 删除），不会被旧输入静默清空。未采用新记录的历史输入维持原行为。来源变化改变 canonical revision，旧确认凭据失效；已确认任务仍要求授权的 supersede/replan。
- Runtime 契约、FILE_SCHEMAS、共享 CONTEXT_API、prepare-task 模板和分发源码列表同步；Skill 仅增加共享说明引用。使用 skill-creator 的精简/渐进读取原则，并按 simplify 检查本次改动。

实际验证：

- Runtime、context、daily-semantics 共 123 项通过。组合运行的 source 测试最初有 3 项因编辑器换行变为 CRLF 而失败，恢复 prepare-task 模板原 LF 后，source 全部 28 项通过。
- 最终代码再次定向运行 4 项 / 78 assertions 全通过：独立 Node CLI prepare/validate 的持久读回、修改依据后旧确认失效、非法/重复来源无写入、历史 null 与显式 []、累计 review 读取来源、replan 保存与幂等。未把这些测试表述为模型已阅读或理解真实业务文档。
- `validate:protocol`、`validate:freshness` 通过；公开 Node 全软件安装定向回归 1 pass / 124 assertions。未运行完整 workflow-all，也未在真实业务项目创建任务或进行新 dogfood。
- 本地 0.18.0 分发已按构建脚本生成；最终 manifest `3de129faa50801863c58ecbf054f67448213a0db4df6f9f93412500b1e95f581`，bundle `bundle-a0307b7c0d6f48d3c8ddf80b`。

限制：revision/path/purpose 是 caller-reported 的来源说明；Runtime 校验结构，不认证文件存在、模型已经读取、版本真实/仍最新、权威选择正确或全部冲突均已识别。本轮没有自动版本漂移门禁。模型仍须通过导航和 file-context 核实正文及实际冲突；必要冲突继续进入既有 unresolved/blocker。源码分发已修订，真实目标的安装版尚未更新。


## 2026-09-13：接通项目文档冲突处理（第四项）

本轮在源码仓库接通准备/refinement/replan、实施、草案审查和变更审查的模型处理规则。共享说明位于 `runtime/vnext/support/CONTEXT_API.md#project-document-conflicts`，四个既有 Skill 模板直接引用，没有新增 public Skill、冲突文件、Runtime 字段或通用冲突平台。按 skill-creator 使用共享说明，复用第二项的持久文档依据和既有决定/审查通道。未修改真实目标项目，保留已有改动，未 commit/push/发布。

处理闭环：

- 准备/重规划对照实际请求、Task Basis 用户决定及来源正文；通过 `design_decisions.unresolved` 保存双方位置、矛盾、影响及所需决定，通过 `decided` 保存有来源的既定解决方案，并提交 project_documents/affected_contracts。只把真实用户原文加入 Task Basis；未决问题继续阻止确认。
- 实施首先通过 `validate --summary` 读取任务记录的依据，再读相关正文；审查分别通过 summary/review-context 读取记录并独立检查遗漏。null 历史依据需明确未记录，不能当成已读或无来源。版本变化只触发相关内容核查，不自动判定冲突，也不能静默刷新冻结任务。
- 明确既有授权解决同一个选择时引用并按授权处理，不重复询问；一般性的“实施”请求不被解释为替用户裁定矛盾。超出已确认计划的改变仍须正常 replan，不通过修改依据绕过范围或生命周期。
- 草案审查使用现有 authority-conflict findings / needs-user。变更审查使用现有 `record-review-result` 的 blocked verdict，`PROJECT_DOCUMENT_CONFLICT` 是 blocker.code 的具体取值；summary 包含位置、影响、决定，next_route 为 user 或 prepare-task:replan。已确定的实际实现缺陷仍走正常 findings，不把授权冲突伪装为可修代码问题。
- 实施前冲突通过 change-result.blocker 返回，停止相关执行。执行中仅在真实计划检查失败/受阻时才可提交 blocked record-step-result；否则保留现场并返回阻塞，不声称已写 Runtime。需求冲突不能冒充 environment 来使用 retry。所有路由仍是后续调用建议。

实际验证：新增冲突草案回归及扩展已有累计审查阻塞回归，3 项 / 64 assertions 通过，证明未决不能确认、显式决定及来源正常保存后可确认、审查 blocker 正常持久化并阻止完成/继续执行。此为调用方提供冲突结论的 Runtime 回归，不是独立模型语义识别实验。source/context 33 项 / 336 assertions、validate:protocol、validate:freshness、公开 Node 安装定向回归 1 项 / 124 assertions 全部通过；未重跑 workflow-all，未进行真实业务 dogfood。

本地 0.18.0 分发已生成：manifest `ce611a2ccf8eafb1ae990e997a4ec0887cc0840a30c5b15df637d611fcfae32e`，bundle `bundle-0ee88f9691ce41165c39f68c`。真实 TermLink 的安装版尚未更新。限制仍明确：语义比对及授权解读是模型 caller-reported 判断，Runtime 只保存结果并执行既有门禁，不能保证发现所有矛盾，也未实现自动来源版本失效门禁。


## 2026-09-13：兼容与真实隔离流程验证

完成普通任务、需求变化、文档过期、来源缺失、历史无依据字段读取五类验证。详见同目录 `DOCUMENT-CONTEXT-VERIFICATION.md` 与 `.json` 命令/结果索引。两个全新隔离项目均通过公开 CLI 安装/bootstrap 和正常任务入口，实际 Node 检查分别返回 2/3、exit 0，记录 caller-reported evidence 后 review/complete-reviewed-step 成功；没有手改任务状态。最终只是步骤 completed，任务仍 active，未执行 close/archive，不冒充真实 TermLink 验收。

155 项 / 2151 assertions 回归全部通过，protocol/freshness/源码 health 通过；gen:all 和 Runtime/分发构建已同步。最终 manifest `ce611a2ccf8eafb1ae990e997a4ec0887cc0840a30c5b15df637d611fcfae32e` 与两份安装一致，每份 receipt 的 43 个受管软件文件 SHA256 均匹配。原有改动保留，未 commit/push/发布，真实目标项目未更新。

实际限制：没有自动文档失效/语义冲突门禁；缺失来源错误没有伪造为 canonical blocked。历史覆盖指无新依据字段的 vNext/bootstrap/旧 semantic 输入，不代表全部旧治理格式。已确认后完整 supersede/replan 仅由回归覆盖；此次真实需求变更流程在草案确认前发生。全文日志位于 JSON 指明的隔离临时目录，关键结果与摘要已写入仓库报告。


## 2026-09-13：TermLink codex 正常 Distribution upgrade

用户明确要求通过正常 `upgrade` 入口更新 `E:\coding\TermLink-rust-source-resolution-codex`。目标原为 vNext `0.18.0`、旧 manifest `6a737588bc8a2d7f3f299a62c8bfa3aece1012655d715486cf7c483f8bbd387e`；旧收据列出的 42 个受管文件全部匹配。源码同版本的新版内容 digest `ce611a2ccf8eafb1ae990e997a4ec0887cc0840a30c5b15df637d611fcfae32e` 触发正常同版本身份门禁 `MANAGED_TARGET_DRIFT`，预览无写入。没有绕过门禁或手改目标收据。

为满足版本单调升级，将源码 VERSION、根/分发/Runtime package、Runtime lockfile、Runtime 契约与源码常量统一递增为 `0.18.1`，按现有构建生成 Runtime 与分发产物；未发布。新版 manifest `2b187f47d07cf2e9ec60cdc799d54f130062dcebf6a751bcfdd4c60ac1b556f0`，bundle `bundle-7c2b483078faa654c4581d6b`。正常 `upgrade --dry-run` 返回 ready：46 个计划写入（受管软件/依赖/收据）、零删除、零 blocker；`validate:vnext-runtime` 通过，Distribution 的 upgrade 定向回归 6 pass / 35 assertions。

随后执行 `pwsh -File .\scripts\workflow-local.ps1 upgrade 'E:\coding\TermLink-rust-source-resolution-codex' -Execute`，公开 CLI 返回 `upgraded`、`read_back_verified: true`。目标安装状态为 `0.18.1`，43 个受管文件 SHA256 均匹配，新 `project-documents.ts` 和共享说明已安装。安装版 `validate-contract`、`validate --summary` 均成功；canonical bootstrap task 仍是 `000` / `closed + archived`，历史 `project_documents: null`。重复升级预览为 `no-op`、零写入。升级前后目标 Git status 条目完全一致，HEAD 保持 `20b79197ce8889294c7a12585ebe3ae008fac11d`；AGENTS、画像、CURRENT_TASK、指南、契约、业务源码、package.json 七项项目自有文件 SHA256 不变。

本轮只完成目标软件 upgrade，未创建真实业务任务、未修改项目文档依据或业务代码、未 commit/push/发布。旧历史任务及已有未提交修改维持原状。隔离验证报告原先的 0.18.0 摘要是当时的历史结果，不应误读为当前安装版。
