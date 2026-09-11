# Workflow vNext 测试策略、执行与评审机制讨论结论

- **Status:** `Discussion consensus / architecture change pending`
- **Date:** `2026-09-11`
- **Scope:** `prepare-task、execute-step、review-testcase、review-change、Runtime 测试证据与测试复用`
- **Behavior impact:** `proposal only; current Runtime 尚未完整实现本文方案`
- **Origin:** `FixFlow current_task 完成阶段独立审核及后续设计讨论`
- **Related documents:**
  - [`workflow-vnext-target-architecture.md`](workflow-vnext-target-architecture.md)
  - [`workflow-vnext-implementation-blueprint.md`](workflow-vnext-implementation-blueprint.md)
  - [`workflow-vnext-phase1-prototype-assessment.md`](../product/workflow-vnext-phase1-prototype-assessment.md)

## 1. 文档目的

本文收敛一次围绕 FixFlow dogfood 结果展开的连续讨论。讨论从
`CURRENT_TASK` 完成阶段的日志审核开始，逐步涉及：

- `execute-step` 创建测试后，`review-change` 究竟审查了什么；
- 一次明显假阴性应归因于 Skill、模型还是 Runtime；
- 一个 task 应测试先行还是实现先行；
- `test-first | implementation-first | not-applicable` 应由谁决定；
- Runtime 应如何约束 Red、测试设计评审、分步实现、增量回归和最终回归；
- 已有测试如何复用，以及大型项目如何发现历史测试；
- 是否需要独立的 `review-testcase`。

本文既记录最终结论，也保留导致结论发生修正的关键过程，避免后续实施只看到最终结构而丢失设计理由。

本文不是已生效协议。凡与现有已接受架构冲突的部分，必须先完成正式的架构变更或 supersede 决策，才能进入实现。

## 2. 最终结论摘要

1. 顶层测试策略仍然只有三种：
   `test-first | implementation-first | not-applicable`。
2. Red 和 Green 不是与 `test-first` 并列的 mode；它们是测试证据或执行状态。
3. `test-first` 不能再等同于“第一步一律强制产生 Red”。它需要声明初始测试证据类型：
   `observed-red | reviewed-testcase | baseline-green`。
4. 严格 Red 只适用于存在稳定可执行边界、能够在实现前产生有业务意义失败的任务。
5. 对无法产生有意义 Red 的任务，应先完成并独立审查测试用例设计，不能把 import、fixture、工具或环境错误伪装成 Red。
6. 对已有完整测试且行为保持不变的修改，应优先复用测试并建立 `baseline-green`，不要求人为制造 Red。
7. 建议新增独立 `review-testcase`，专门审查测试设计、断言质量、复用映射和 Red 原因；它与 `review-change` 按变更类型互斥，不连续审查同一个 diff。
8. 测试的主要执行者应是 `execute-step` 约束下的 Runtime，而不是 reviewer。reviewer 负责独立核验，并可按风险复跑。
9. 每个实现步骤必须运行当前步骤对应测试和可能受影响的已 Green 测试；最终步骤必须运行本任务全量测试和项目回归。
10. 大型项目中的测试复用必须依赖稳定 Test ID、行为/契约映射、代码影响映射和机器维护的测试目录，不能依赖人或模型记忆历史 task。
11. Red/Green 的结构、顺序、命令、文件哈希和状态可以由 Runtime 强制；测试是否真正表达业务语义仍需要 Skill/模型审查。
12. Red 或普通执行因环境等非预期原因进入 `blocked` 后，应支持带解除证据的受控重试；不应被迫为一次临时故障 supersede/replan 整个 task。
13. 依赖 256 条滚动日志回查早期 Red 的淘汰风险极低，当前决定记录为已知限制，暂不修复。

## 3. 必须分开的三个概念轴

此前讨论多次发生歧义，根本原因是把策略、执行阶段和证据状态混成了一个枚举。最终设计必须将三者分开。

### 3.1 策略 mode：测试资产与实现按什么顺序产生

```text
test-first
implementation-first
not-applicable
```

- `test-first`：在产品实现前，先确定、创建、修改、复用或审查本 task 所需测试。
- `implementation-first`：先进行探索、基础设施搭建或技术验证，稳定测试依赖于前置发现；必须给出理由。
- `not-applicable`：任务不改变任何可执行行为，例如纯文档或治理元数据变更。

三种 mode 的来源优先级保持不变：

```text
explicit-user > project-policy > inferred-default
```

`confirm-draft` 后，mode、来源、理由及相关测试决策一起冻结；变更必须走 replan。

### 3.2 初始测试证据：实现前能证明什么

仅当 `mode: test-first` 时，继续选择：

```text
observed-red
reviewed-testcase
baseline-green
```

建议的语义结构如下：

```yaml
test_strategy:
  mode: test-first
  source: explicit-user | project-policy | inferred-default
  classification: contract-clear-behavior | exploratory-or-infrastructure | non-executable-change
  rationale: <为什么选择该策略>
  initial_test_evidence:
    kind: observed-red | reviewed-testcase | baseline-green
    rationale: <为什么实现前可以或不可以获得有意义的 Red>
```

三种初始证据的含义：

| kind | 适用情况 | 实现前要求 |
|---|---|---|
| `observed-red` | 稳定业务边界已经存在，目标行为缺失或 bug 可被测试准确观察 | 真实运行冻结测试，并因目标业务行为缺失而失败 |
| `reviewed-testcase` | 测试可以先设计或编写，但实现前执行只能得到无业务意义的结构性错误 | 独立审查测试设计，不伪造 Red |
| `baseline-green` | 已有测试完整覆盖本次保持不变的行为 | 实现前真实运行并通过，冻结基线与测试哈希 |

### 3.3 执行与证据状态：测试当前处于什么状态

建议至少区分：

```text
testcase-authored
testcase-reviewed
red-verified
green-verified
blocked
```

这些是状态或结果，不是 public mode。一个 `test-first` task 可以从
`testcase-reviewed` 或 `red-verified` 开始，随后让各业务切片逐步成为
`green-verified`。

## 4. 有价值的讨论演进

### 4.1 起点：FixFlow 最后一个测试步骤的独立审核

FixFlow 日志显示：

1. `execute-step` 新增 `test/tickets.test.ts` 并运行测试；
2. 独立会话中的 `review-change` 读取该测试 diff、检查断言并复跑测试；
3. review 记录 `clean`；
4. 后续 `execute-step` 消费 clean review，Runtime 将步骤和 task 推进到完成。

因此，实际 review 并非完全跳过测试代码；它确实审查了测试文件。但是这次审核暴露出更深的问题：仅看到“测试通过”并不足以证明测试有效，reviewer 可能把弱断言、假阳性或错误失败原因判断为 clean。

### 4.2 Skill、模型与 Runtime 的归因边界

讨论形成的归因原则是：

- Skill 已明确要求检查某项内容，而模型仍漏掉明显问题，主要属于模型执行质量问题；
- Skill 没有提供必要任务、证据或 stop condition，属于 Skill 设计问题；
- Runtime 本可机器强制顺序、身份、文件、命令或状态，却只相信模型自报，属于 Runtime 防护缺口；
- 测试是否真正表达业务语义不能完全机器判定，即使 Runtime 更强，仍需要独立 reviewer。

这意味着不能因为一次 `review-change` 假阴性就自动判定 Skill 不合格，也不能因为 Skill 写了正确说明就宣称系统已经可靠。最终效果取决于“Skill 语义要求 + 模型执行 + Runtime 可验证约束”三层共同作用。

### 4.3 初始方案：所有 test-first 都强制 Red

早期方案把 `test-first` 简化为：

```text
第一步：只改测试并得到 test-red
第二步及以后：实现并得到 Green
```

Runtime 随后实现了第一步必须为 `test-red`、必须包含
`expected-failure`、Red 后必须 clean review 才能进入后续实现等约束。

这一方案解决了“测试代码创建后直接以通过作为完成”的一部分问题，但后续聚焦审核发现：

1. Runtime 没有确保 `test-first` 一定存在后续实现步骤，可能产生完成不了的单步骤 task；
2. 非预期失败被记录为 `blocked` 后，缺少同一计划内的重试路径；
3. 后续 Green 是否存在依赖滚动 `execution_log` 回查早期 Red，极长 task 存在证据淘汰风险；
4. Runtime 接受调用方提交的 `expected-failure` 文本，尚不能证明测试命令真的执行过；
5. 更根本地，并不是所有 test-first task 都能在实现前产生有业务意义的 Red。

其中：

- blocked 重试决定修复；
- 日志淘汰决定暂时忽略；
- “所有 test-first 都强制 Red”被后续讨论修正。

### 4.4 关键修正：严格 TDD Red 与 testcase-first 不是一回事

严格 TDD 中，实现在前不存在并不意味着 Red 没有测试对象。测试运行的是当前基线系统，证明当前系统缺少目标行为。

例如已有 HTTP 应用，但尚未实现 `POST /tickets`：

```text
测试期望：POST /tickets → 201
当前结果：POST /tickets → 404
```

这是有意义的 Red，因为稳定 HTTP 边界存在，失败直接指向目标行为缺失。

但如果测试只能得到：

```text
Cannot find module
fixture missing
test runner cannot start
environment unavailable
```

那么该结果通常不能证明业务行为缺失。此时正确策略是先形成并审查测试用例，而不是把结构性失败标记为 Red。

由此形成 `observed-red` 与 `reviewed-testcase` 两种 test-first 初始证据。

### 4.5 第二次修正：已有完整测试时不应制造 Red

当 task 修改已有模块时，测试处理取决于业务语义，而不是“文件是否已经存在”：

- 行为保持不变且已有测试精确覆盖：复用测试，建立 `baseline-green`；
- 修复 bug 且已有测试已经失败：复用该测试作为 `observed-red`；
- 修改业务契约：旧测试只覆盖旧规则，需要先修改或新增测试；若稳定边界存在，再取得 `observed-red`；
- 测试仅在覆盖率层面经过函数，但断言没有证明本次 acceptance：不得宣称复用充分。

这使 `baseline-green` 成为第三种初始测试证据，但不改变顶层三种 mode。

### 4.6 第三次修正：测试复用不能依赖历史 task 记忆

大型项目会累计大量 task 和测试。让人或模型逐个回忆历史 task、通过名称猜测试文件，既不可扩展也不可靠。

因此最终方案增加稳定 Test ID、行为与代码主题映射、Runtime 生成测试目录和候选检索，但保留一个重要边界：机器检索返回候选，不自动证明语义覆盖；最终复用决定必须经过测试内容检查和必要的 `review-testcase`。

## 5. 最终推荐工作流

### 5.1 新行为，且可获得有意义 Red

```text
prepare-task
  冻结 test-first + observed-red、acceptance/test 映射、步骤和命令
  ↓
execute-step:testcase
  创建、修改或复用测试
  Runtime 执行冻结测试命令并记录业务性 expected failure
  ↓
review-testcase
  审查测试设计、断言、覆盖关系和 Red 原因
  ↓ clean
execute-step:implementation-1
  实现业务切片 1
  Runtime 运行该切片测试和已 Green 的关联测试
  ↓
review-change
  ↓ clean
execute-step:implementation-2
  实现业务切片 2并执行累计回归
  ↓
review-change
  ↓
...
  ↓
final execute-step
  全部任务测试 + 项目回归
  ↓
final review-change
  ↓
close-task
```

### 5.2 新行为，但实现前不能获得有意义 Red

```text
prepare-task
  冻结 test-first + reviewed-testcase
  ↓
execute-step:testcase
  编写完整测试用例；不伪造行为 Red
  ↓
review-testcase
  审查测试设计与 acceptance 映射
  ↓ clean
execute-step:implementation-1
  实现切片并首次运行其对应测试
  ↓
review-change
  ↓
后续增量实现、累计回归、最终全量回归
```

### 5.3 行为保持不变，已有测试完整覆盖

```text
prepare-task
  冻结 test-first + baseline-green，声明 tests reused
  ↓
execute-step:test-baseline
  Runtime 执行已有测试并记录通过基线，冻结测试哈希
  ↓
review-testcase
  验证“已有测试完整覆盖本次 acceptance/invariant”的复用结论
  ↓ clean
execute-step:implementation
  修改实现并重跑关联测试
  ↓
review-change
  ↓
最终全量回归
```

对低风险任务，未来可以通过项目策略允许省略独立 baseline
`review-testcase`，但不能省略 Runtime 可验证的基线与最终证据。是否允许该优化尚未在本次讨论中冻结。

### 5.4 多步骤增量 Green

假设一个 task 预先规划三组测试：

```text
T1：创建 Ticket
T2：参数校验
T3：持久化
```

在所有测试都已设计、编写和审查后：

```text
实现步骤 1：T1 必须 Green；T2、T3 可以保持为后续步骤负责
实现步骤 2：T1、T2 必须 Green；若修改了步骤 1 相关代码，T1 必须重跑
实现步骤 3：T1、T2、T3 全部 Green，并运行任务全量回归
```

中途 `review-change` 不应完全放弃测试。主要测试执行发生在进入 review 之前，由 Runtime 产生凭证；reviewer 核对凭证并按风险独立复跑。把所有测试推迟到最后会积累失败、削弱步骤完成证据并增加定位成本，因此不作为默认策略。

## 6. Skill 职责与调用顺序

### 6.1 `prepare-task`

负责：

- 选择并说明顶层 mode；
- 选择 `initial_test_evidence.kind`；
- 建立 acceptance claim、Test ID、实现步骤和验证命令之间的映射；
- 从 Runtime 测试目录获取复用候选；
- 对每个测试声明 `reused | modified | new`；
- 为每个实现步骤规划当前测试、累计回归和最终全量回归；
- 在用户确认后冻结所有决策。

`prepare-task` 不能仅因测试文件名称或覆盖率命中就断言完整复用。

### 6.2 `execute-step`

负责：

- 修改当前步骤被准入的测试或产品文件；
- 请求 Runtime 执行已冻结命令；
- 消费 Runtime 产生的命令凭证；
- 记录 testcase、Red、baseline、增量 Green 或 blocked 结果；
- 不自行准入新测试，不跳过 required test set；
- 在 clean review 后请求 Runtime 完成当前步骤。

### 6.3 `review-testcase`（拟新增）

这是讨论形成的新增独立 Skill 提案。它只处理测试侧 checkpoint：

- acceptance claim 是否有对应测试；
- 断言是否具体、充分且不会无条件通过；
- mock、fixture 是否绕过真实行为；
- 复用测试是否真的覆盖当前要求；
- `observed-red` 是否由目标行为缺失导致；
- `baseline-green` 是否建立在未漂移测试上；
- 测试变更是否混入产品实现；
- 测试命令、输出和文件哈希凭证是否匹配。

它不修改测试或实现。

### 6.4 `review-change`

只处理产品实现侧 checkpoint：

- 当前实现 diff 是否符合步骤和 scope；
- 当前步骤负责的测试是否 Green；
- 已 Green 且受影响的历史测试是否保持 Green；
- 冻结测试是否被未授权修改或削弱；
- 验收、回归和最终全量测试证据是否充分。

它不应成为测试的第一次执行者。测试主要由 Runtime 在
`execute-step` 结果形成前执行；`review-change` 做独立核验和必要复跑。

### 6.5 两种 review 不是串行重复审查

正确路由：

```text
testcase-authored | test-red | baseline-green
  → review-testcase

implemented
  → review-change
```

错误路由：

```text
同一个测试-only diff
  → review-testcase
  → review-change
```

Runtime 应根据 execution kind 拒绝错误入口。

两类 findings 也必须保持类型一致：

```text
review-testcase:findings
  → execute-step:repair-testcase
  → review-testcase:verification

review-change:findings
  → execute-step:repair-implementation
  → review-change:verification
```

## 7. Runtime 应强制的内容

### 7.1 策略与步骤合法性

Runtime 应验证：

- mode、source、classification、rationale 和初始证据使用闭集；
- `observed-red` 必须有稳定边界、测试目标和可执行命令；
- `reviewed-testcase` 不能提交 `test-red`；
- `baseline-green` 必须引用已存在且验证通过的测试；
- test-first 的 testcase/baseline checkpoint 后必须存在至少一个产品实现步骤；
- 最终步骤必须包含任务全量测试和项目回归义务；
- confirm 后所有映射冻结，除 findings repair 或 replan 外不得修改。

### 7.2 Runtime-owned command receipt

当前 Runtime 主要验证调用方提交的结果结构。仅检查：

```json
{
  "status": "expected-failure",
  "observed_failure_signature": "..."
}
```

无法证明测试真实执行。最终推荐由 Runtime 运行冻结命令，至少记录：

- command ID、精确命令、工作目录；
- exit code；
- stdout/stderr 的有界摘要与摘要哈希；
- 执行时间、task/step/document/revision 坐标；
- 执行前后文件清单和写入审计；
- 测试资产内容哈希；
- result kind：passed、expected-failure、failed、blocked、not-run。

模型负责解释失败是否具有业务意义，但不能自行伪造命令是否执行或退出状态。

Runtime 命令执行必须继续遵守现有安全边界：预先批准的命令、固定 cwd、超时、输出上限、敏感环境过滤和写入 footprint。

### 7.3 增量 Green 与累计回归

Runtime 应持久化每个测试义务的状态和责任步骤：

```yaml
test_obligations:
  - test_id: TC-ticket-create
    acceptance_claim: AC-1
    green_by_step: implement-create-ticket
    state: red-verified | green-verified | blocked
```

步骤推进要求：

- 本步骤负责的测试全部转 Green；
- 已 Green 且因当前候选修改路径受到影响的测试重新通过；
- 后续步骤负责的测试可以保持 pending，不得被错误计为本步骤失败；
- task-complete 前所有 acceptance 绑定测试和最终回归均 Green。

### 7.4 blocked 受控重试

语法、fixture、工具、环境或其他非业务失败必须 truthful blocked，不能伪装 Red。但 blocker 解除后应支持：

```text
blocked
  → blocker-resolution receipt
  → ready
  → 重新执行同一 confirmed step
```

解除凭证必须绑定原 task、document、step、失败种类和当前 source revision，并保留原失败历史。它不允许改变 scope、测试策略或验收要求；这些变化仍需 replan。

### 7.5 已知低风险限制

当前 Red 顺序证明依赖最多 256 条 `execution_log`。理论上极长 task 或大量生命周期操作可能淘汰早期 Red，导致合法后续步骤被错误阻止。

本次讨论的判断是：普通 task 通常只有少量步骤，发生概率极低；先记录为已知限制，不在当前变更中引入独立永久 checkpoint 状态。若未来引入本文所述 test obligation state，该问题可自然消除。

## 8. 大型项目的测试复用与发现

### 8.1 不以 task 历史作为检索入口

历史 task 只保留 provenance。新 task 不应扫描或记忆所有历史 task，而应查询当前项目的测试追踪目录。

每个可复用测试至少需要：

```yaml
test_id: TC-ticket-api-create-valid
locator:
  path: test/tickets.test.ts
  test_name: POST /tickets creates a ticket
covers:
  behaviors:
    - ticket-api.create
  contract_refs:
    - docs/api/tickets.md#create-ticket
  historical_claims:
    - TASK-001/AC-1
subjects:
  routes:
    - POST /tickets
  symbols:
    - src/app.ts#createTicket
command:
  npm test -- tickets.test.ts -t "creates a ticket"
provenance:
  created_by_task: TASK-001
  last_verified_by_task: TASK-014
  content_hash: <sha256>
```

### 8.2 真相来源与索引

推荐“测试附近的稳定机器标识 + Runtime 可重建索引”：

```ts
// @test-id TC-ticket-api-create-valid
// @covers ticket-api.create
test('POST /tickets creates a ticket', async () => {
  // ...
});
```

或由项目测试 helper 提供等价结构化接口。

仓库保存可审查的文本身份与映射；Runtime 可以用生成 JSON、NDJSON 或本地 SQLite/cache 提供快速查询。索引不是第二业务真相源，必须能从仓库测试元数据、契约和归档 provenance 重建。

### 8.3 Runtime 内部候选解析

建议增加内部操作而非新的公共用户意图：

```text
resolve-test-candidates
```

输入 acceptance claims、contract refs、候选修改路径和代码符号，返回：

```yaml
exact_matches: []
impact_matches: []
stale_matches: []
uncovered_claims: []
```

检索优先级：

1. 稳定 behavior ID 或 authoritative contract ref；
2. 当前 claim 与历史 claim/test 映射；
3. 动态覆盖：哪些测试实际执行过候选文件或符号；
4. API route、类、函数、模块等代码主题；
5. 测试名称、路径、AST 和文本候选；
6. 无可靠匹配时标记 uncovered，而不是自动宣称不存在测试。

动态覆盖只能证明“执行到代码”，不能证明断言验证了业务语义。

### 8.4 当前步骤 required test set

Runtime 在 `execute-step` preflight 时根据候选修改路径和冻结映射生成：

```text
current-step tests
+ previously-green impacted tests
+ required integration/contract tests
+ final-step full regression（仅最终步骤）
```

该集合由 Runtime 返回并绑定 receipt，执行者不能自行删减。

### 8.5 关闭任务时更新追踪目录

`close-task` 将最终确认关系写入可重建 provenance：

```text
TASK-014/AC-1 → reused TC-ticket-api-create-valid
TASK-014/AC-2 → modified TC-ticket-api-validation
TASK-014/AC-3 → created TC-ticket-api-idempotency
```

同时更新 locator、内容哈希、最后成功执行凭证和行为/代码映射。文件删除、重命名、断言漂移或命令失效后，候选必须成为 `stale`，不能直接复用。

老项目采用渐进式建立：初次扫描只形成未验证候选；每次 task 使用到某个测试时再由 `review-testcase` 确认其稳定身份和语义映射。

## 9. Skill 与 Runtime 的能力边界

| 能力 | Skill/模型 | Runtime |
|---|---|---|
| 理解用户业务要求 | 主责 | 不决定 |
| 判断测试断言是否表达业务语义 | 主责 | 只能验证结构 |
| 判断 mock/fixture 是否削弱测试 | 主责 | 可提供文件与执行证据 |
| 选择候选测试是否真正可复用 | 主责 | 提供检索候选与 stale 检测 |
| 冻结策略、步骤、Test ID 和命令 | 提议 | 强制与持久化 |
| 执行测试、记录退出状态和输出摘要 | 不应自报为真相 | 主责 |
| 文件范围、哈希、顺序和状态迁移 | 遵守 | 主责 |
| 判断 expected failure 是否业务性 | 解释与独立审查 | 验证命令事实和闭集结构 |
| 防止错误 review verdict | 依赖独立 reviewer 质量 | 可拒绝缺证据或错路由，不能完全理解语义 |

最终不应承诺“Runtime 自动判断测试质量”。可承诺的是：Runtime 让流程、执行事实和状态不可被轻易跳过，Skill 让业务语义得到专门审查。

## 10. 与当前已接受架构的冲突

这是本文进入实现前必须处理的 blocker。

现有 [`workflow-vnext-target-architecture.md`](workflow-vnext-target-architecture.md)
的 P-12 明确规定 Evidence-first / Persistent Test Admission 的完善“不引入 Test Skill、registry 或 state machine”。

现有 [`workflow-vnext-implementation-blueprint.md`](workflow-vnext-implementation-blueprint.md)
也把当前 daily semantics slice 限制为“不新增 Test Skill/registry/state machine”。

本文讨论结论提出：

- 新 public Skill：`review-testcase`；
- 可重建的测试追踪目录；
- testcase/Red/Green obligation state；
- Runtime-owned test command receipt。

这不是对现有约束的无影响补丁，而是架构范围扩展。继续实施前必须二选一：

1. 正式 supersede/修订 P-12 和 blueprint 的相关冻结边界，接纳本文方案；
2. 保留现有八个 daily intent entries，把 testcase review、目录查询和状态约束全部降为 `prepare-task`、`review-change` 和 Runtime 的内部 capability，不新增 public Skill，并缩小 registry/state 的持久化范围。

本次讨论对职责分离的偏好是方案 1，即独立 `review-testcase`；但“修改已接受架构和 public intent surface”的授权尚未在代码或治理文档中完成。因此本文状态是 architecture change pending，而不是 accepted implementation design。

## 11. 当前实现状态与偏差

截至本文日期：

- 三种顶层 mode、来源优先级、`implementation-first` 理由和 confirm 后冻结已进入前序设计/实现；
- 当前 Runtime 已加入 mandatory Red、`expected-failure` 结构和 Red 后 review gate；
- 当前实现仍把每个 test-first 的第一步硬编码为 Red；
- 当前 Runtime 仍主要接收调用方提供的 command/validation result，不拥有完整命令执行事实；
- 尚无 `review-testcase`；
- 尚无稳定 Test ID/test catalog；
- 尚无 `baseline-green` 或 `reviewed-testcase` 初始证据；
- 尚无 per-test obligation 的增量 Green 状态；
- blocked 后尚无同计划受控重试；
- 256 条日志淘汰限制仍存在。

因此，前序“步骤 1、2 clean”的结论只对当时冻结的三 mode 与
`prepare-task` 分类范围成立。后续讨论提出了新的子策略和架构能力，需要作为显式变更增量处理。

当前 Step 3 不能按本文最终方案判定完成；其 mandatory Red 设计需要重构，而不是只补一个“至少两个步骤”的检查。

## 12. 建议实施顺序

在没有正式架构授权前，不应直接修改 Runtime 以落地全部方案。建议顺序：

1. 决定是否 supersede 现有“不新增 Test Skill/registry/state machine”约束；
2. 修订协议和 schema，保持三 mode，增加初始测试证据闭集；
3. 更新 `prepare-task` 的分类、测试复用候选和 claim/test/step 映射；
4. 定义稳定 Test ID、可重建目录和 legacy 渐进接入；
5. 定义 Runtime-owned command receipt 及安全执行边界；
6. 定义 testcase、Red、baseline、incremental Green、final Green 状态迁移；
7. 若架构批准，新增 `review-testcase` 及 typed findings/verification 路由；否则作为 `review-change` 内部严格分支实现；
8. 增加 blocked resolution receipt 和同步骤受控重试；
9. 更新 `review-change` 的 required test set、累计回归与最终回归规则；
10. 增加兼容性、迁移、错路由、弱证据、stale test、blocked retry 和完整工作流测试；
11. 重新进行 FixFlow dogfood，并分别审核 Skill 遵从性、模型 verdict 质量和 Runtime 防护效果。

## 13. 已决定、暂缓与未决定事项

### 已决定

- 顶层保持三种测试策略 mode；
- Red/Green 不作为第四种 mode；
- test-first 初始证据至少区分 observed Red、reviewed testcase 和 baseline Green；
- 复用优先，但必须是 claim-level 语义复用，不是文件名或覆盖率复用；
- 测试主要由 Runtime 在 execute 阶段执行，reviewer 独立核验；
- 实现步骤采用局部测试 + 已 Green 影响回归，最后执行全量回归；
- `review-testcase` 与 `review-change` 不连续审查同一 diff；
- blocked 需要受控 retry；
- 大型项目需要稳定 Test ID 和机器维护的候选索引。

### 暂缓

- 256 条 execution log 淘汰问题；
- baseline reuse 是否允许按低风险项目策略省略独立 `review-testcase`；
- 对所有现有测试一次性补 Test ID。

### 尚未决定或需要实现设计

- 是否正式扩展 public Skill surface；
- `initial_test_evidence` 和 test obligation 的最终字段名、版本和迁移规则；
- 以单个 test case、test command 还是 command group 作为 Runtime 最小状态粒度；
- 不同语言/测试框架的 Test ID 与 machine-readable reporter 适配方式；
- Runtime command runner 的进程隔离、环境过滤、超时和输出保留策略；
- 测试目录的文本真相来源、生成格式和本地索引实现；
- 动态覆盖信息如何更新、失效和参与 required test set；
- review-testcase 的 public entry 是否满足现有 P-02 对新增 mode/entry 的证明义务。

## 14. 验收本文后续设计的最低场景

后续协议和实现至少应覆盖这些端到端场景：

1. 新 API 通过稳定 HTTP 边界取得 observed Red，review-testcase clean 后分步 Green；
2. 全新模块无法产生业务性 Red，走 reviewed-testcase，不接受 import error 伪装 Red；
3. 行为保持不变的重构复用已有测试，建立 baseline Green，测试哈希保持冻结；
4. 已有失败测试直接复用于 bug fix，无需新增测试；
5. 业务规则改变时旧测试不能被误判为覆盖新 claim；
6. 后续步骤修改早期代码路径时，早期已 Green 测试自动进入 required test set；
7. 测试名称相似但断言无关时，候选检索不能自动批准复用；
8. 测试被重命名、删除或内容漂移后成为 stale；
9. reviewer 对弱断言产生 testcase finding，repair 后只能回到 testcase verification；
10. implementation finding 不能错误路由到 testcase repair；
11. 环境 blocker 解除后可在不 replan 的情况下重试同一 confirmed step；
12. 最终 task-complete 必须有全部 obligation Green 和完整回归 receipt；
13. Runtime 拒绝模型伪造 command exit status、错 revision receipt 或错误 review 入口；
14. legacy task 没有新字段时保持可读，但不能被静默解释为已满足新证据协议。

## 15. 最终原则

本次讨论最终收敛为四条原则：

```text
测试策略决定顺序，不冒充测试结果。
Runtime 证明执行事实，不冒充业务理解。
Skill 审查业务语义，不自报机器事实。
历史测试依赖稳定索引，不依赖人的记忆。
```

任何后续实现若把 `test-first` 再次简化为 mandatory Red、把 Green
简化为“最终跑一次所有测试”、把 coverage 命中当作语义覆盖，或者让
reviewer 成为测试的第一次执行者，都没有满足本次讨论形成的设计结论。
