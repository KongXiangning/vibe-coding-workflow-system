# E6：原计划三项、外部验证和计划外修复

这是契约示例，不是 LawAgent、TermLink 或其他真实项目的记录。下面的 task ID、来源文字和结果均为虚构；只能转换为隔离测试夹具，不能导入用户项目当作既有事实。示例展开真实 E6A／B／C 是独立 task 的一种情形；若它们实际是单 task 的步骤，TaskRef 使用原 task_id＋step_id。

## 1. 事件顺序与应有解释

| 时点 | 实际情形／用户意图 | 维护结果 |
|---|---|---|
| T0 | 一项需求预先划分 E6A、E6B、E6C | 一项 REQ、一份项目 plan、三个工作项；不必立即创建三个 task。 |
| T1 | A、B 已结束，C 未开始 | 保留实际任务来源；项目计划不新增 done 或复制任务生命周期。 |
| T2 | 用户自行验证导入脚本并提交失败材料 | 不要求验证 task；区分用户报告和 Agent 复现，更新／标记交付对账。 |
| T3 | 已有明确授权，决定先插入修复 E6R | 新增工作项和真实修复 task 的绑定；原 A／B／C 身份不变。 |
| T4 | 修复完成，取得实际复验材料 | 按实际范围和对象更新摘要，不凭 task close 自动变 PASS。 |

下列文件描述 T3。T0 的安排在 plan 正文保留，E6R.origin=added；这是必要的局部历史，不是每次读写生成一份全量快照。

## 2. 文件：.workflow-system/PRODUCT.yaml

```yaml
schema: vnext-product-manifest/v2
project_id: example-e6
entry: docs/product/PROJECT.md
managed_paths: [docs/product/*.md]
source_paths: [docs/evidence/**]
capture_paths: []
exclude_paths: []
maintenance: enabled
```

## 3. 文件：docs/product/PROJECT.md

````markdown
---
schema: vnext-product-doc/v2
items:
  - id: PROJECT-E6
    type: project
    inventory:
      state: partial
      checked_sources: []
      unreviewed_sources:
        - {kind: text, text: '本夹具只展示导入相关范围，不代表真实全项目盘点。', label: 示例范围}
  - id: GOAL-IMPORT
    type: goal
    scope: current
  - id: MOD-IMPORT
    type: module
    scope: current
    links:
      - {id: L-GOAL, relation: supports, target: GOAL-IMPORT, origin: declared, state: active}
---
# 示例项目

## [PROJECT-E6] 项目说明
### 项目定位
验证项目文档如何表达预先规划与计划外修复。
### 盘点范围与未核对项
只覆盖导入相关示例，其他业务未盘点。

## [GOAL-IMPORT] 可靠导入
### 目标说明
按已约定的输入行为提供可靠导入能力。
### 范围边界
业务细则以 REQ-IMPORT 为准；本夹具不是实际产品规范。

## [MOD-IMPORT] 导入业务
### 业务能力
导入脚本及使用其结果的相关工作。
### 范围边界
只组织本示例的需求，不定义代码修改权限。
````

## 4. 文件：docs/product/REQUIREMENTS.md

````markdown
---
schema: vnext-product-doc/v2
items:
  - id: REQ-IMPORT
    type: requirement
    scope: current
    assessment_id: AS-IMPORT
    links:
      - {id: L-MODULE, relation: part_of, target: MOD-IMPORT, origin: declared, state: active}
    task_bindings:
      - id: B-A
        task:
          task_id: example-task-A
          source: {kind: text, text: 'E6A 的任务记录来源占位；测试中不是一次真实 task 操作。', label: 示例}
        role: implementation
        coverage: 导入脚本的既定实施范围
        origin: declared
        state: active
        plan_items: [{plan_id: PLAN-IMPORT, work_item_id: E6A}]
      - id: B-B
        task:
          task_id: example-task-B
          source: {kind: text, text: 'E6B 的任务记录来源占位。', label: 示例}
        role: implementation
        coverage: 第二批已规划范围
        origin: declared
        state: active
        plan_items: [{plan_id: PLAN-IMPORT, work_item_id: E6B}]
      - id: B-C
        task:
          task_id: example-task-C
          source: {kind: text, text: '本变体中 E6C task 已创建，但还未开始。', label: 示例}
        role: implementation
        coverage: 依赖约定导入结果的后续范围
        origin: declared
        state: active
        plan_items: [{plan_id: PLAN-IMPORT, work_item_id: E6C}]
      - id: B-R
        task:
          task_id: example-task-R
          source: {kind: text, text: '本次实际 prepare 成功后应使用返回的 task 身份；这里仅为夹具。', label: 示例}
        role: repair
        coverage: 本次提交的失败样例涉及的导入行为
        origin: declared
        state: active
        plan_items: [{plan_id: PLAN-IMPORT, work_item_id: E6R}]
        repairs:
          - task:
              task_id: example-task-A
              source: {kind: text, text: '脚本属于 E6A 交付范围；未确定缺陷何时引入。', label: 示例历史}
            coverage: 导入脚本相关交付，不代表整个 E6A 均需重做
            sources:
              - {kind: text, text: '用户报告导入输入出现异常；本示例没有真实日志或复现。', label: 示例观察}
        sources:
          - {kind: text, text: '示例决定：先修复相关导入行为，再推进受影响的 E6C 工作。', label: 示例决定}
---
# 导入需求

## [REQ-IMPORT] 导入行为
### 需求内容
按既定规则处理有效输入及错误输入。
### 范围边界
本次发现缺陷，不增加新的输入格式或改变原有目标。
### 验收要求
使用实际项目已经约定的输入和输出要求验证；不能把本示例文字当作真实验收计划。
````

## 5. 文件：docs/product/PLAN.md

````markdown
---
schema: vnext-product-doc/v2
items:
  - id: PLAN-IMPORT
    type: plan
    intent_state: adopted
    targets: [{target: REQ-IMPORT, coverage: 导入及其后续使用范围}]
    work_items:
      - id: E6A
        title: 第一批实施
        outcome: 提供包含导入脚本的第一批能力
        scope: 原 E6A 实施范围
        targets: [{target: REQ-IMPORT, coverage: 导入脚本基础范围}]
        state: included
        origin: initial
      - id: E6B
        title: 第二批实施
        outcome: 提供第二批约定能力
        scope: 原 E6B 实施范围
        targets: [{target: REQ-IMPORT, coverage: 第二批约定范围}]
        state: included
        origin: initial
        depends_on: [{item_id: E6A, kind: order, reason: 原分批安排}]
      - id: E6R
        title: 修复本次导入问题
        outcome: 处理本次失败所涉及的导入行为并取得实际检查结果
        scope: 不扩大输入格式，不推翻无关历史工作
        targets: [{target: REQ-IMPORT, coverage: 本次失败样例涉及范围}]
        state: included
        origin: added
        sources:
          - {kind: text, text: '原三项计划之后，依据用户提交的观察及当前决定新增。', label: 示例插入依据}
      - id: E6C
        title: 后续实施
        outcome: 提供依赖约定导入结果的后续能力
        scope: 原 E6C 范围，本次只调整相关先后安排
        targets: [{target: REQ-IMPORT, coverage: 后续使用范围}]
        state: included
        origin: initial
        depends_on:
          - {item_id: E6B, kind: order, reason: 原分批安排}
          - {item_id: E6R, kind: prerequisite, reason: 本示例中的 E6C 需要相关导入行为可靠；不能仅凭修复 task 关闭证明此前提满足}
---
# 导入实施计划

## [PLAN-IMPORT] 分批实施与修复安排
### 实施策略
按需求范围分批推进，实际 task 通过 TaskBinding 反向关联；此处没有 Runtime plan_ref。
### 阶段与工作项说明
原计划依次 E6A、E6B、E6C。本次保留 A、B 的历史处置，只插入 E6R 并调整相关 C 的安排。
### 调整与未决事项
E6R 为后加，不伪装成原定计划。缺陷是否由 A 引入尚未确定。修复及后续推进服从实际授权和工程条件；文档依赖不构成 Runtime 许可检查。
````

## 6. 文件：docs/product/ASSESSMENTS.md

````markdown
---
schema: vnext-product-doc/v2
items:
  - id: AS-IMPORT
    type: assessment
    target: REQ-IMPORT
    target_basis: {kind: file, path: docs/product/REQUIREMENTS.md, item_id: REQ-IMPORT, note: 示例未捕获历史字节和精确需求摘要，因此版本对齐未知}
    target_definition_sha256: null
    checked_at: '2026-10-04T00:00:00Z'
    subject: {kind: unknown, value: null}
    implementation: unknown
    verification: failure-reported
    sources:
      - {kind: text, text: '用户报告本次输入异常；不是 Agent 已复现的证明。', label: 示例用户报告}
    pending_sources:
      - {kind: text, text: '原历史检查的覆盖范围和具体代码对象尚未核对。', label: 示例待核对材料}
---
# 导入交付核对

## [AS-IMPORT] 本次问题的范围化摘要
### 覆盖范围
仅记录本次用户报告的输入问题；实际实现对象和完整影响范围未知。
### 交付与验证依据
A、B 的历史工作处置继续保留，但不因此宣布整个需求已交付。本条不改写原报告，也不把不同版本的结果简单合成同一对象的 PASS 或 mixed。
### 剩余与待核对
核对本次失败、历史覆盖及修复后的实际检查。即使需求正文未变，也不能忽略新报告；task-R 关闭不自动清空 pending_sources 或转为 pass-reported。
````

## 7. 必须覆盖的变体

C 尚未创建：删除 B-C 绑定即可，保留 E6C 工作项，不用假 task ID 填空。

E6A 是原 task 内步骤：TaskRef 保留原 task_id，填写真实 step_id 及必要的 Runtime plan_ref；不为本契约重新 prepare 三个 task。

早期目标修复：引用历史要求及原交付；当前修复另关联实际服务的有效需求，不能自动恢复 retired 目标。没有当前 plan 时直接 TaskBinding 也合法。

绑定写入失败：保留已返回真实 task ID，重试仅补绑定。计划变动不必把现有 Task C 重新 prepare；只有 task 本身的范围确需修订时才使用既有同任务路径。

读到本夹具的 TraceLens 应显示业务需求、四项当前工作安排、原定／新增区别、关联来源和待核对问题；不能显示“4 个任务中 2 个完成，所以需求完成 50%”，也不能从 included 推断正在执行。
