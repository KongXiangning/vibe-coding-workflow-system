---
name: review-draft
description: Independently review one prepared task draft against its original request and authoritative project context without writing state.
entry_contract:
  entry: review-draft
  mode: []
  intent: Produce one independent, read-only semantic and executability verdict for a current task draft.
  input_contract:
    required:
      - draft_target
    optional:
      - verbatim_request_or_exact_request_source
      - authority_sources
      - caller_context
  authority_owner: none
  mutation_boundary:
    product_files: []
    governance_sources: []
    forbidden_targets:
      - product files
      - governance sources
      - CURRENT_TASK.md
      - Runtime state
      - finding queues
      - review receipts
      - registry
      - installation surface
      - host surface
  internal_capabilities:
    - project-context-resolver
    - source-authority-policy
    - decision-authority-gate
    - scope-guard
    - mutation-authority-policy
    - draft-consistency-challenge
    - evidence-admission-policy
    - read-only-review-guard
  runtime_operations: []
  # Candidate interruptions: apply run-entry internal recovery before any terminal result.
  stop_conditions:
    - the target is not one exact draft + active CURRENT_TASK revision
    - the linked Task Basis and an exact caller-supplied legacy request source are both unavailable
    - the linked Task Basis is missing, stale, or does not match the draft identity
    - source authority cannot be established well enough to classify a material conflict
    - the review would need to mutate product, governance, Runtime, finding, registry, installation, or host state
  output_kind: draft-review-result
---

# vNext Skill: review-draft

## Authorized intent and truthful outcomes

Apply the shared Authorized Intent section in `.workflow-system/WORKFLOW_PROTOCOL.md`.
Separate execution facts from completion qualification and user disposition.
Same-intent internal recovery needs no repeated permission. Explain material
consequences before a new user-owned decision; never invent permission or PASS.
Read-only intent stays read-only. A suggested next route is not the user's only
choice. An unknown Runtime rejection is diagnosis, not a proven recovery path.

## Invocation authority and internal recovery

recovery_boundary: entry-recovery/v1

Public result routing: `next_route` (or `recommended_route.entry`) is `null` or a
declared public Skill base name. Put a declared public mode in `next_mode`
separately. Choose it only from the verified terminal result. Never copy
`task-context.overview.next_entry` / `next_options`, review
`blocker.next_route`, or a `run-entry` recovery command into the public route.
Complete same-intent internal recovery here; report a new user choice separately
with `next_route: null`.

The caller's explicit invocation authorizes this entry's stated intent and its
necessary internal recovery within the existing authority. This entry owns that
recovery until its requested result is produced or a genuinely undecidable choice
requires the caller. A Runtime rejection interrupts a candidate operation; it is
not, by itself, a terminal Skill result, even when listed under stop_conditions.

Read retained state and the rejection, correct stale identity or request shape,
then use typed diagnostic, review-consumption, preflight, retry or amendment
operations as needed and resume the original intent. Calling an internal capability
does not require the user to invoke another public Skill. Do not repeat an unchanged
rejected request. Preserve failed evidence, findings and disposition history.

Attempt and repair quotas are analysis checkpoints. Inspect previous failures,
reassess the cause, necessity and next approach, and record the analysis. When the
existing explicit instruction covers continuation, use its original source/text
for the supported continuation or budget-extension transaction and proceed; do not
ask for renewed authorization merely because a counter is exhausted. Keep the
analysis distinct from the user's words and retain cumulative attempt counts.
Do not invent risk acceptance, a waiver, or permission beyond that instruction.
Ask only for a choice or authority that cannot be determined from the instruction
and available evidence; report the concrete unresolved choice, not just a gate code.

A read-only, review-only or investigate-only entry completes with its requested
facts/verdict; recovery does not authorize unrelated implementation. For actual
unavailable dependencies or damaged state, attempt the supported recovery first,
then report the precise external prerequisite if it cannot be restored internally.
Never fabricate success or bypass an incomplete atomic commit.

### Shared internal recovery driver

Use Runtime `run-entry --root <project>` for Runtime operations in this entry.
Send `invocation` (stable `id`, this public `entry`, requested `intent`, original
`decision_source` and verbatim `decision_text`) and `operation` (`command`,
optional `args`, semantic JSON `input`). Keep this invocation identity throughout
internal recovery. The driver executes existing typed Runtime commands, not public
Skills or product shell commands. Read-only context reads may still be direct.

The driver returns a compact summary and `outcome_ref` / `detail_ref`. Read needed
full receipts with Runtime `entry-output-read`, supplying the returned `reference`,
`offset: 0` and `max_bytes: 8192`; follow `next_offset` until null. A page boundary
is not an execution limit. Do not reconstruct receipts from shortened messages.

An `entry-operation-result/v1` with `recovery-required` is addressed to the agent:
inspect its original `outcome`, code, commit facts and concrete routes, perform
analysis, then submit corrected input or a `recovery` plan with `reason` and
`operations`. The driver stops at the first unresolved operation and returns
`recovery-applied` after successful recovery operations. Read canonical state and
the retained receipts, then resume only an original operation still needed for
this invocation. Never replay an operation reported as committed merely because
its reply was interrupted; reconcile that transaction first.
`operation-complete` means that operation finished, not that this Skill's intent
is complete. Continue until its actual requested result is available.

For ordinary execute-step retry budget exhaustion, supply `budget_analysis` with
`document_id`, `plan_revision`, the proposed `attempt_id` from global-gates, and
`evidence_refs` to retained analysis of failures, necessity and the next approach.
The driver records continuation using the original instruction, increases the
attempt allowance through the existing transaction, and retries the operation
with the resulting decision ID. No renewed user instruction is needed. Other
repair/wave quotas use their typed extension operations in `recovery.operations`.
Evidence and analysis are the agent's responsibility, never invented user speech.

Before returning any blocked result, classify it: an internal operation awaiting
recovery stays in this invocation; an unresolved user choice must state the actual
alternatives; an unavailable external prerequisite must name what internal
recovery could not restore. Completed reports/verdicts remain legitimate outcomes.

## Intent

Review one already prepared task draft independently from the authoring pass.
Evaluate whether the draft preserves the original request, applies existing
authority correctly, defines observable behavior deliberately, admits
sufficient proof, and can be executed step by step. This entry is read-only and
does not repair the draft.

## Bounded task context protocol

Start with `validate --summary`, then call the read-only
`task-context(entry:"review-draft", mode:"default")` and follow required
continuations. Read the exact Task Basis, definition, prior findings, and
reports with `task-read`, and use `file-context` for cited project documents.
Only the same visible session and exact `definition_revision` permit definition
reuse. Receipts prove only version and returned range; they do not prove
comprehension or grant write authority. On session compression, a revision
change, an incomplete required page, or a compact/store error, reread or stop
with a blocker rather than loading unbounded CURRENT_TASK history.

## Input boundary

1. Resolve one exact `draft + active` `CURRENT_TASK` and record its task,
   document, and draft revision. Do not review an inferred, stale, confirmed,
   active-execution, or reconstructed draft.
2. Resolve the exact Task Basis path and revision linked by `CURRENT_TASK`.
   Verify that the linked file exists, its content hash and task/document
   identity match the draft, and then use its verbatim original request plus all
   recorded user decisions as the request basis. This is what makes a different
   conversation or agent valid without hidden history. For a legacy draft with
   no Task Basis link, an exact request source supplied by the caller is the only
   fallback. Never reconstruct the request from the candidate draft, its
   acceptance criteria, the draft author's summary, or a previous review.
   If exact request evidence is unavailable or the link is stale, return
   `needs-user` for that missing or conflicting input instead of reclassifying
   already-recorded user decisions as unsupported draft behavior.
3. Follow **Project document navigation** in
   `.workflow-system/runtime/support/CONTEXT_API.md` to locate the candidate's
   relevant project sources independently of the author's selected references.
   Read the candidate's saved `project_documents` / `affected_contracts` using
   `validate --summary` and apply **Project document conflicts** in that support
   file; distinguish an unresolved choice from an already-authorized resolution.
   Read only the authoritative sources and minimal repository facts needed to
   evaluate the candidate. Treat prior author rationale and conclusions as
   untrusted context; evaluate the request, sources, draft, and repository facts
   directly. Prior `draft_review_result` documents or messages are findings,
   not request authority: do not use them as Task Basis or as proof that a user
   chose an observable behavior.

For a v2 candidate, independently verify that `mutation_authority_version: 2`
and the task authority envelope name only project domains justified by the
request. Check the profile's domain IDs, bounded roots, overlap behavior and
the exact-exception/forbidden partition. Read/discovery dependencies may be
listed as context without becoming mutation authority. Confirm that each step
uses `planned_mutation_targets` as guidance rather than a second hard ACL, and
that the draft leaves room for same-domain implementation discovery with a
blast-radius assessment and risk-selected cumulative review. Independently
trace the complete proposed write set to the request, authoritative design and
code relationships. A necessary one-off cross-domain file may be a proposed
task-level exact exception in a new draft without a separate pre-draft user
message naming it; verify its reason and the draft's normal confirmation route.
Do not accept an unrelated path merely because it is listed. Check whether
several uncovered files represent a stable module that needs one bounded,
owner-confirmed project-domain update, rather than many task exceptions or a
domain built from the previous task's file list. Request a user scope decision
only for an actual goal change, explicit exclusion, or unresolved authority
choice; group related paths into one concrete question. Once a task is
confirmed, an out-of-envelope target still needs a recorded amendment and a
fresh preflight before mutation. Review the local-vs-shared decision: prefer the
smallest correct local change, require evidence for a broader shared change,
and surface uncertain consumer or contract impact as `needs-user`.

## Review behavior

Build a transient semantic delta map and path-by-step interaction map, then
apply `draft-consistency-challenge` across these closed dimensions:

- requirement-to-acceptance mapping, including omissions and strengthened or
  weakened requirements;
- source conflicts and whether existing source-authority and decision-authority
  gates classified them without inventing a user-owned choice;
- externally observable defaults, required fields, accepted values, status
  codes, response shapes, normalization, stored data, and compatibility;
- validation and Persistent Tests coverage for each material acceptance or
  decided observable behavior;
- whether the validation set is minimum-sufficient for all required observations
  and independently authorized user/project/release or contract/risk obligations;
  prefer a narrower feasible set only when it preserves detection, boundaries and
  those obligations without increasing total cost. A focused selector's existence
  alone does not invalidate justified target/broad execution. Require an explicit
  breadth reason and existing permitted basis for `target`, E2E or broad regression;
- whether a business-flow claim retains required integration/flow evidence
  rather than being replaced by many local unit PASS results, whether E2E is
  actually admitted by its acceptance/low-cost/policy/user basis, and whether
  the proposed oracle can detect the real business failure;
- step-end executability in the current repository state, including whether a
  planned command can produce its claimed evidence at that point;
- cross-step repairability, treating v1 step scopes as permissions rather than
  exclusive file ownership and v2 `planned_mutation_targets` as guidance
  inside the task authority envelope; check that later validation has an
  in-authority repair route for earlier code and configuration.

Use existing authority, scope, and evidence capabilities only to classify what
the review detects. The review does not become another authority source, decide
a user-owned behavior, widen scope, admit a new persistent test, or convert a
recommendation into task state. Do not execute the draft's planned commands or
create a probe inside the project.

## Test value review

### Required policy

在本次调用中，审查测试与验证方案前，必须读取目标项目根目录下的：

`docs/workflow/test-admission-policy.md`

该文件是本阶段的必读 workflow policy，不是可选参考资料。
路径相对于目标项目根目录解析，不相对于当前工作目录或 skill 目录。

不能以仅引用文件路径或记得此前内容代替读取。
文件缺失或无法读取时，应明确报告，不得声称已完成依据该 policy 的检查。

### Review responsibilities

Test value review 是固定审查职责，不依赖用户额外提醒。
即使 draft 未提出新增测试，也必须检查受影响行为是否缺少关键验证。

按业务行为或契约分组审查，必要时下钻到具体用例：

1. 必要性与检出力
   检查拟新增或显著扩展的测试保护什么，以及能发现什么具体错误。
   不接受仅以新增代码、函数、分支、覆盖率或想象中的 edge case
   为依据的测试；识别重复断言、实现细节镜像和 mock 自证。

2. 已有证据与执行范围
   检查能否复用已有测试，是否存在重复建设，以及是否把不必要的
   整套测试绑定为本次 acceptance evidence。
   不把“转为 regression”当作保留低价值新增测试的理由。

3. 关键覆盖缺口
   检查业务行为、关键公共函数、共享能力、稳定契约、已知回归
   和重要不变量是否缺少必要保护。
   不得为了精简测试而一概删除单元测试，也不得泛化要求“再补测试”。

发现问题时，提出具体的复用、取消拟新增、合并、缩小范围、
调整证据选择或补足关键覆盖建议。
要求新增测试时，应指出缺少保护的行为或故障模式，
以及已有验证为什么不足。

沿用现有 draft 审查和 findings 处理方式；
本章节不授予删除现有测试、修改验收要求或变更 Runtime 状态的权限。

### Review output

在现有审查结论的简短文字说明中固定包含一项 `Test value review`，
不为 `draft_review_result` 增加字段：

- 无问题时：用一句话说明，未发现不必要的拟新增测试或重要验证缺口。
- 有问题时：只列具体问题、受影响的测试或测试组，以及建议动作和理由。
- 材料不足时：明确未能确认的部分，不以“未发现问题”代替未完成检查。

不逐项复述所有测试，不生成额外评分表、准入表或长篇检查记录。

## Required result

Return one self-contained `draft_review_result` that another agent can consume
without access to this reviewer or its hidden reasoning:

```yaml
draft_review_result:
  draft_target:
    task_id: <id>
    document_id: <id>
    draft_revision: <revision>
  request_basis:
    kind: linked-task-basis | supplied-source
    locator: <exact path or locator>
    revision: <exact revision when linked | null for supplied legacy source>
  verdict: clean | findings | needs-user
  findings:
    - id: <stable local id>
      severity: P0 | P1 | P2
      category: requirement-mapping | authority-conflict | observable-contract | evidence-plan | step-executability | cross-step-repairability
      request_refs: []
      source_refs: []
      draft_refs: []
      impact: <externally observable or execution impact>
      correction_basis: <request/source-determined correction or unresolved choice>
      owner: prepare-task | user
  governed_mutation_count: 0
  next_route: null | prepare-task
```

Use `clean` only when no material gap remains. Use `findings` when every
correction is determined by the request or an authoritative source and can be
applied by a later `prepare-task` invocation. Use `needs-user` when any material
choice or required original input still belongs to the user. Every finding must
contain enough references and correction basis to serve as explicit
`caller_context` in another conversation; hidden conversation history is not a
handoff mechanism.

The result is not a confirmation receipt and does not authorize execution or
draft confirmation. `next_route: prepare-task` is only a recommendation for a
later caller invocation; this invocation must not invoke another public Skill.
Do not write findings, receipts, review state, or any other content to Runtime or
the repository. Set `terminal_boundary: public-entry-terminal/v1`, return to the
caller, and stop.

## Business evidence boundary

Independently reconstruct the expected business outcome from request/Contract,
then challenge the proposed check with one relevant wrong behavior. Read the
actual assertion, fixture and setup: would the wrong behavior still PASS? Explain
that gap in the existing finding's impact/correction basis; do not accept a test
name, selection reason, metadata completeness or suite count as proof of detection.
For a not-yet-written test, assess its planned setup and independent expected
observation; absent code or execution reports alone is not a draft finding.
Use **Failure-oriented validation selection** in
`.workflow-system/runtime/support/CONTEXT_API.md`. This is read-only reasoning,
not permission to execute tests, seed mutations or demand a mandatory Red run.
An equally cheap check with the same detection adds no required evidence. Prefer
repairing an inadequate oracle to adding redundant tests, without changing the
business requirement. Uncertainty about the expected behavior belongs to its
existing source/user decision route, not to a fabricated expectation.

Assess whether the draft's claim/slot/check plan can prove each declared real
boundary at the intended step. Review planned methods, prerequisites and evidence
availability; missing execution reports are expected in a draft and do not block
draft approval. For proposed persistent tests, check P-12 owner/source, claim
binding, necessity and why existing evidence is insufficient. Review oracle
independence and whether planned mocks/fixtures prove the promised boundary. Do not demand execution
or completion evidence during draft review. Reports remain caller-reported;
no Provider, authenticated human signature or AST enforcement is implied.

Treat unjustified validation breadth as a material evidence-plan finding, not a
harmless safety margin. Assess the whole selected set, not minimum granularity per
check. Preserve independently authorized user/project/release and contract/risk
obligations even when a smaller check alone proves an acceptance claim. Target or
broad execution still needs its existing selection/breadth basis and exact source;
E2E retains its separate admission. Do not narrow away an explicit obligation.

Compare feasible sets with equivalent detection and required boundaries, including
batched selectors when supported. Shared setup can justify a combined invocation
only with a concrete total-cost comparison accounting for unrelated cases,
execution, maintenance and diagnosis; convenience or one startup alone is not a
basis. Record the rationale using existing `selection_reason` / `breadth_reason`
and a permitted basis/source, not a new cost-advantage authority. “Same target,”
“previously green,” and “final step” do not establish necessity. Require narrowing
when no independent obligation requires the broader set and a narrower feasible
set preserves detection and boundaries at no greater total cost. Do not demand a full suite merely because it is available.

Review the complete slot/check boundary → granularity → frozen invocation binding.
Structured invocation binds literal argv/selector; opaque invocation freezes the
original wrapper command and cannot claim focused selection. Review its actual
granularity and necessity without requiring a rewrite into Runtime CLI grammar.
Check that selector arguments really narrow this runner, integration observes the
declared business-flow boundary, and any runner granularity limitation is real.
The same claim may require local rule and business-flow slots. Focused integration
is `business-flow` + `focused`; a whole integration target is `business-flow` +
`target` and still requires breadth authority. Focused E2E still needs E2E authority.
Inspect the actual Task Basis, requirements, Contract, Decision or policy authority
text, not just its existence. Release-gate E2E binds a real release/policy source;
claim authority need not originate in a user decision.
Apply that whole-set necessity and cost comparison before clean confirmation,
including new update/replan/recovery checks; legacy compatibility never exempts
replacement identities. These are boundary choices,
not a unit < integration < E2E substitution hierarchy.


Check each checkpoint's explicit reason and policy against project requirements.
A later required checkpoint must cover earlier exempt changes and retain exact
repair scope. Check any final exemption against the original authorization and
whole cumulative target. Review oracle independence and reused mappings even if
no persistent test is added; input constants are allowed, circular expected
values and mock-only substitutes for promised real flows are not evidence.
