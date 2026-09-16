# Mutation Authority v2：实施记录

- 状态：已实施。本文件记录需求、设计取舍、切片与验收证据；不是目标项目的执行授权。
- 日期：2026-09-17
- 基线：源码仓库 `cf80ced3`（`0.19.5`），工作区在实施前重新核对。
- 定位：产品行为与 Runtime 工程修订。

## 1. 问题

vNext 把 `task mutation scope` 与 `step mutation scope` 同时当作规划范围与实际写入
authority。后果是两个方向都不对：

- 大型项目无法阻止 Agent 擅自扩大责任边界——因为总权限本身只是一张文件清单；
- 同一责任组件内的正常 implementation discovery（漏列一个 private helper、一个已存在的
  regression test）也必须升级成正式 scope amendment 并重新请求用户授权。

## 2. 目标模型

```text
Read broadly.
Write only inside explicit task authority.

Plan narrowly.
Allow implementation discovery inside that authority.

Let the coding model make bounded engineering judgments.
Make those judgments auditable.

Prefer local fixes over propagation.

Escalate true ownership/authority changes to the user.

Use review—not repetitive permission prompts—to control
same-authority blast-radius risk.
```

三个概念各自独立：

| 概念 | 角色 | 归属 |
|---|---|---|
| Task authority envelope | 唯一 hard mutation boundary，positive grant | Runtime |
| Planned mutation footprint | guidance，planned-vs-actual 证据 | Runtime 记录，Skill 规划 |
| In-envelope footprint expansion | bounded engineering judgment | Agent 判断，Runtime 审计 |

## 3. 落地实现

### 3.1 版本与兼容

- `runtime_state.mutation_authority_version`：缺失或 `1` 保持 legacy exact-path 语义
  （Allowed / Conditional / Forbidden + step hard scope）。
- `2` 启用 authority envelope + planned footprint + self-admitted expansion。
- 两条路径互不静默转换：v1 文档带 envelope section 会 fail closed，v2 文档缺 envelope
  section 同样 fail closed；只有显式 replan / task upgrade 才能升级。
- v1 → v2 不提供自动迁移。

### 3.2 项目级 authority domain

`.workflow-system/PROJECT_PROFILE.yaml`：

```yaml
mutation_authority:
  domains:
    - id: node-rollout
      roots:
        - packages/node-rollout/**
        - packages/node-rollout-tests/**
```

- Runtime 只解决 `path -> authority domain`，不构建 dependency graph。
- roots 只能是 exact path 或 literal `/**` 前缀。
- 同一 project 内 domain roots 重叠直接拒绝（`MUTATION_AUTHORITY_PROFILE_INVALID`）。
- 一个 path 匹配多个 domain：fail closed。
- 未匹配任何 domain：`unclassified`，永不通过普通 self-admission 获权。
- bootstrap/adoption 会写入一个 `application` domain 作为起点，大型项目再细分。
- 没有 domain map 的旧项目保持 legacy 语义，不静默推断整目录为 component。

### 3.3 Task envelope 的单一 canonical 载体

`CURRENT_TASK.md` 新增一个 section：

```markdown
## 变更权限

### Authority Domains

- `node-rollout`

### Exact Exceptions

- none
```

- Runtime 把该 section 作为 envelope 的唯一 canonical 来源解析回结构化
  `runtime_state.mutation_authority`，因此 replan / correction / scope amendment
  都重渲染同一份授权，不会丢也不会悄悄扩。
- compact frontmatter 不再重复携带 envelope（只保留 version marker），
  `state` 快照与 `execution_log` / `applied_proposals` 一样归一化处理，保证
  manifest state revision 与文档一致。
- `exact_exceptions` 只接受精确路径，用于用户显式授权的跨 domain 窄例外。

### 3.4 Planned footprint 与名字一致性

- step 的 `Mutation scope` 行现在是 **planned footprint**；它在
  `Target Architecture`、`FILE_SCHEMAS`、`Runtime Contract`、`SOURCE_CONTRACT`、
  Skill 与 DTO 中都被明确标注为 “planned footprint, not an independent authority
  boundary”。
- Runtime 侧把该行同时用作 “本 step 已规划的 target 集合”，因此
  planned-vs-actual 偏差仍然可见，但它不再是唯一 writable list。

### 3.5 Blast radius assessment

```yaml
target: {path: <exact>, symbol: <optional>}
reason: <为什么当前任务需要修改>
blast_radius: {locality, visibility, cross_component_consumers, contract_impact}
evidence_refs: [<evidence>]
disposition: self-admit | escalate
```

Runtime 校验结构、绑定、first-touch before-state 与 review coverage，
**不** 声称校验语义真实性。禁止 caller 数量阈值式 policy。

### 3.6 extend-preflight

`extend-preflight` 是 `execute-step` 内部 Runtime action：

```yaml
current_preflight_receipt: ...
additional_targets:
  - path: src/internal/state.ts
    assessment: ...
```

Runtime 依次：校验同一 task/step/plan/attempt → 校验 path 在 envelope 内 →
校验 explicit Forbidden → 校验 assessment（`self-admit`） → 在第一次 mutation 前捕获
before-state → 并入 cumulative review coverage → 标记 dynamic review required →
返回 replacement preflight receipt。

不结算 execution、不消耗 retry budget、不产生 continuation、不改 plan revision；
旧 receipt 自然 stale，`record-step-result` 只接受最新 receipt。

新创建 persistent test 仍走 P-12 admission（`PERSISTENT_TEST_ADMISSION_REQUIRED`）；
已存在 test 文件在 envelope 内是普通 expansion，但必须声明 test oracle 是否改变，
并强制 review。

### 3.7 错误码与 review 强制

| 情况 | 结果 |
|---|---|
| path 在 envelope 外 | `MUTATION_AUTHORITY_EXPANSION_REQUIRED`（hard block，路由到 amend-scope） |
| path 在 envelope 内但未规划 | `MUTATION_BLAST_RADIUS_ASSESSMENT_REQUIRED`（自行评估后 self-admit） |
| assessment disposition 为 escalate | `MUTATION_TARGET_ESCALATED`，不静默继续 |
| 新 persistent test 试图 self-admit | `PERSISTENT_TEST_ADMISSION_REQUIRED` |
| 任意 planned footprint 外 self-admitted mutation | `mutation_dynamic_review.required = true` + `review_coverage.expanded_paths` |

review-change 的上下文与 Skill 必须同时看到 planned targets、self-admitted targets、
blast-radius assessment、evidence refs 与 actual diff。

### 3.8 scope-amendment 收口

- committed candidate 不可 discard（`SCOPE_AMENDMENT_ALREADY_COMMITTED`）。
- 真实 authority change 在 execution 未结算时拒绝
  （`SCOPE_AMENDMENT_EXECUTION_UNSETTLED`）。
- 同 envelope 内多一个普通文件不再进入 amendment。
- v2 task 的 amendment 只增长 `exact_exceptions`，不重新授予整个 domain。
- immutable old definition、continuation、pending review preservation、
  findings preservation、attempt budget lineage、additive semantics、
  explicit user authorization preservation 全部保留。

## 4. 验收

| ID | 场景 | 验证位置 |
| --- | --- | --- |
| A01 | planned A/B，发现 Node private C | `vnext-runtime.test.ts` v2 A01…A04 |
| A02 | C 在 initial preflight 前发现 | `vnext-mutation-authority.test.ts` A01/A02 |
| A03 | C 在已修改 A 后发现 | v2 A01…A04 + `vnext-mutation-authority-e2e.test.ts` E2E A |
| A04 | extend-preflight 不增 attempt、不改 plan revision | v2 A01…A04 + E2E A |
| A05/A06/A07 | high fan-in 必须评估；可 self-admit 但必须 review；不能证明则 escalate | `vnext-mutation-authority.test.ts` A05/A06/A07 + v2 A05…A07 |
| A08/A09/A10 | 跨 component hard block；read 允许；用户授权 exact path 后 amendment 成功 | v2 A08…A10 + E2E B |
| A11 | 旧 execution 未结算时先 settlement | v2 A11/A15 + E2E B |
| A12/A13 | existing test 可 self-admit + review；new test 需 P-12 | v2 A13 |
| A14 | 未规划 self-admission 强制累计 review | v2 A05…A07、A20 + E2E A |
| A15 | committed amendment candidate discard | v2 A11/A15 |
| A16 | v1 历史任务保持 exact-path 语义 | v2 A16 + `vnext-mutation-scope.test.ts` |
| A17 | v2 任务不因漏普通 same-domain file 触发 scope amendment | v2 A17 + E2E A |
| A18 | fixed tgz 完成 same-domain expansion E2E | `vnext-mutation-authority-e2e.test.ts` E2E A |
| A19 | fixed tgz 完成 cross-domain authority-amendment E2E | `vnext-mutation-authority-e2e.test.ts` E2E B |
| A20 | review 明确看到 planned / expanded / actual footprint | v2 A20 |

## 5. 明确不做

OS 级文件系统 sandbox、多语言 AST dependency graph、Runtime 自行判断业务必要性、
caller 数量阈值 policy、repo 内任意文件自由写、自动跨 component authority expansion、
自动 Skill chaining、symbol 级 hard enforcement、为每次 footprint expansion 建
continuation、为每个新 path 要求用户确认。

symbol / function 级 blast radius 在 v2 属于
`Skill semantic judgment + reference evidence + review`，不伪装成 Runtime 能精确
enforce 的能力。
