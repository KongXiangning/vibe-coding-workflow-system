# VN-01 共用样例：目标、顺序、分解与范围化结论

状态：契约样例已确定；2026-10-11。依据：[文档契约第 10 节](../document-contract.md)。VN-03 源码与本地产物已按本例实现 v3 Schema、生产和离线读取，供后续 TL-02 消费侧使用；以下所有项目、对象、证据和结果均为合成资料，不是业务项目交付证明。Skill、完整分发安装及 TraceLens 页面尚未实施。

修订 0.3.2：保留 0.3.1 的范围声明、两份依据和旧需求变体；新增同定位缺字段、显式修正坏报告及保守摘要策略的消费预期。这些演算不保证 AI 必然遵循或业务结论正确。

修订 0.3.3（2026-10-15）：区分无法验证原依据的保守核对，与已验证旧目标快照时的其他范围声明变化豁免；报告原完整定义摘要保持不变。

以下代码块分别代表同一合成项目的文件。定义与报告分开；manifest 保持 v2，文档使用待实施的 v3。`sample-copy-a` 只在该合成工作副本登记内有效。摘要是按契约算法对本页定义代码块计算的值，复用样例时不要将它当成真实项目摘要。

## 1. 输入

`.workflow-system/PRODUCT.yaml`：

```yaml
schema: vnext-product-manifest/v2
project_id: sample-scoped-import
entry: docs/product/PROJECT.md
managed_paths:
  - docs/product/PROJECT.md
  - docs/product/ASSESSMENTS.md
source_paths:
  - docs/product/PROJECT.md
  - docs/evidence/import.md
capture_paths: []
exclude_paths: []
maintenance: enabled
```

`docs/product/PROJECT.md`：

```markdown
---
schema: vnext-product-doc/v3
items:
  - id: PROJECT
    type: project
    inventory:
      state: partial
      checked_sources: []
      unreviewed_sources: []
      note: 合成场景，不声明全项目已盘点。
    root_goal_id: G-ALL
    requirement_order: [R-PIPELINE, R-IMPORT, R-OLD, R-DELTA, R-NEW]
  - id: G-ALL
    type: goal
    scope: current
    assessment_scopes:
      - {target: G-ALL, scope_id: OVERALL, coverage: 演示与持续使用的总体结果}
  - id: G-DEMO
    type: goal
    scope: current
    goal_kind: stage
    assessment_scopes:
      - {target: R-IMPORT, scope_id: FULL, coverage: 固定知识集全量入库；排除持续更新及失败恢复}
      - {target: R-NEW, scope_id: BATCH, coverage: 约定批次输入}
    links:
      - {id: demo-parent, relation: part_of, target: G-ALL, origin: declared, state: active}
  - id: G-LIVE
    type: goal
    scope: current
    assessment_scopes:
      - {target: R-IMPORT, scope_id: RECOVERABLE, coverage: 全量入库及失败恢复；增量识别另由 R-DELTA 承接}
      - {target: R-PIPELINE, scope_id: PIPELINE, coverage: 约定输入与恢复流程}
      - {target: R-DELTA, scope_id: DELTA, coverage: 增量识别}
    links:
      - {id: live-parent, relation: part_of, target: G-ALL, origin: declared, state: active}
  - id: R-PIPELINE
    type: requirement
    scope: current
    links:
      - {id: pipeline-live, relation: supports, target: G-LIVE, origin: declared, state: active}
  - id: R-IMPORT
    type: requirement
    scope: current
    links:
      - {id: import-parent, relation: part_of, target: R-PIPELINE, origin: declared, state: active}
      - {id: import-demo, relation: supports, target: G-DEMO, origin: declared, state: active}
      - {id: import-live, relation: supports, target: G-LIVE, origin: declared, state: active}
  - id: R-OLD
    type: requirement
    scope: retired
  - id: R-DELTA
    type: requirement
    scope: current
    links:
      - {id: delta-live, relation: supports, target: G-LIVE, origin: declared, state: active}
      - {id: delta-import, relation: depends_on, target: R-IMPORT, origin: declared, state: active}
  - id: R-NEW
    type: requirement
    scope: current
    links:
      - {id: new-demo, relation: supports, target: G-DEMO, origin: declared, state: active}
      - {id: new-replaces, relation: replaces, target: R-OLD, origin: declared, state: active}
  - id: R-UNORDERED
    type: requirement
    scope: current
---
# 合成导入项目

## [PROJECT] 导入项目
### 项目定位
验证目标、范围与对象选择。
### 盘点范围与未核对项
仅覆盖这组合成资料。

## [G-ALL] 可使用的内容导入系统
### 目标说明
演示与持续使用均有明确结果。
### 范围边界
总体使用结果需独立核对，不按任务数量汇总。

## [G-DEMO] 固定知识集演示阶段
### 目标说明
演示固定知识集导入。
### 范围边界
只要求全量导入，不要求持续更新。

## [G-LIVE] 持续更新目标
### 目标说明
持续导入内容并从失败中恢复。
### 范围边界
全量导入、增量更新和失败恢复。

## [R-PIPELINE] 导入流程
### 需求内容
维护全量及持续导入流程。
### 范围边界
保留父需求；子需求细化不替代父项。
### 验收要求
按约定输入和恢复场景核对。

## [R-IMPORT] 内容入库
### 需求内容
将约定内容写入目标库。
### 范围边界
演示范围只含全量，持续使用范围另含恢复能力。
### 验收要求
分别核对全量入库和失败恢复。

## [R-OLD] 手工输入
### 需求内容
旧手工导入方式。
### 范围边界
本合成场景已明确由 R-NEW 替代并退出当前要求。
### 验收要求
历史保留，不作为当前缺口。

## [R-DELTA] 增量导入
### 需求内容
只导入新增内容。
### 范围边界
持续使用目标下的新增要求。
### 验收要求
核对增量识别；具体实现尚未判定。

## [R-NEW] 批量输入
### 需求内容
以批量输入替代手工输入。
### 范围边界
替代依据仅为本合成场景设定，不代表真实用户决定。
### 验收要求
核对约定批次输入；结果尚未判定。

## [R-UNORDERED] 未登记顺序的要求
### 需求内容
已读到、但未纳入项目登记顺序。
### 范围边界
不因顺序缺失隐藏需求。
### 验收要求
保持可读；成果未知。
```

`docs/product/ASSESSMENTS.md`：

```markdown
---
schema: vnext-product-doc/v3
items:
  - id: A-DEMO
    type: assessment
    target: R-IMPORT
    target_basis: {kind: file, path: docs/product/PROJECT.md, item_id: R-IMPORT}
    target_definition_algorithm: vnext-product-definition/v1
    target_definition_sha256: 67c6af37db967502e78c5b9de0b2a700b7adc0749c911f49c53e243432a808cc
    goal_basis: {kind: file, path: docs/product/PROJECT.md, item_id: G-DEMO}
    goal_definition_algorithm: vnext-product-definition/v1
    goal_definition_sha256: 09351d926d7aaa9fd6df4cf87f930559095bec66639ca34a278d3065db954261
    checked_at: "2026-10-11T10:00:00+08:00"
    applicability: {goal_id: G-DEMO, scope_id: FULL, coverage: 固定知识集全量入库；排除持续更新及失败恢复}
    subject: {kind: working-copy, value: sample-copy-a, revision: sample-baseline}
    conclusion: satisfied
    implementation: delivered-reported
    verification: pass-reported
    sources: [{kind: file, path: docs/evidence/import.md}]
  - id: A-LIVE
    type: assessment
    target: R-IMPORT
    target_basis: {kind: file, path: docs/product/PROJECT.md, item_id: R-IMPORT}
    target_definition_algorithm: vnext-product-definition/v1
    target_definition_sha256: 67c6af37db967502e78c5b9de0b2a700b7adc0749c911f49c53e243432a808cc
    goal_basis: {kind: file, path: docs/product/PROJECT.md, item_id: G-LIVE}
    goal_definition_algorithm: vnext-product-definition/v1
    goal_definition_sha256: 9fc7db52440d164bdfb82e7637174d611b4cf6f55d5f32b0a9d7c4f51ccbaee4
    checked_at: "2026-10-11T11:00:00+08:00"
    applicability: {goal_id: G-LIVE, scope_id: RECOVERABLE, coverage: 全量入库及失败恢复；增量识别另由 R-DELTA 承接}
    subject: {kind: working-copy, value: sample-copy-a, revision: sample-baseline}
    conclusion: partially-satisfied
    implementation: partial-reported
    verification: mixed-reported
    sources: [{kind: file, path: docs/evidence/import.md}]
  - id: A-RELEASE
    type: assessment
    target: R-IMPORT
    target_basis: {kind: file, path: docs/product/PROJECT.md, item_id: R-IMPORT}
    target_definition_algorithm: vnext-product-definition/v1
    target_definition_sha256: 67c6af37db967502e78c5b9de0b2a700b7adc0749c911f49c53e243432a808cc
    goal_basis: {kind: file, path: docs/product/PROJECT.md, item_id: G-DEMO}
    goal_definition_algorithm: vnext-product-definition/v1
    goal_definition_sha256: 09351d926d7aaa9fd6df4cf87f930559095bec66639ca34a278d3065db954261
    checked_at: "2026-10-11T12:00:00+08:00"
    applicability: {goal_id: G-DEMO, scope_id: FULL, coverage: 固定知识集全量入库；排除持续更新及失败恢复}
    subject: {kind: release, value: sample-release-0}
    conclusion: not-satisfied
    implementation: none-reported
    verification: failure-reported
    sources: [{kind: file, path: docs/evidence/import.md}]
  - id: A-ALL
    type: assessment
    target: G-ALL
    target_basis: {kind: file, path: docs/product/PROJECT.md, item_id: G-ALL}
    target_definition_algorithm: vnext-product-definition/v1
    target_definition_sha256: c7f8d38074fed123dd7d4dde4559fadf48df741042c152f425f5890f41bbb67e
    goal_basis: {kind: file, path: docs/product/PROJECT.md, item_id: G-ALL}
    goal_definition_algorithm: vnext-product-definition/v1
    goal_definition_sha256: c7f8d38074fed123dd7d4dde4559fadf48df741042c152f425f5890f41bbb67e
    checked_at: "2026-10-11T12:30:00+08:00"
    applicability: {goal_id: G-ALL, scope_id: OVERALL, coverage: 演示与持续使用的总体结果}
    subject: {kind: working-copy, value: sample-copy-a, revision: sample-baseline}
    conclusion: undetermined
    implementation: unknown
    verification: unknown
    sources: [{kind: file, path: docs/evidence/import.md}]
---
# 范围化报告

## [A-DEMO] 演示范围
### 覆盖范围
R-IMPORT 在 G-DEMO 的 FULL 范围，sample-copy-a 的 sample-baseline。
### 交付与验证依据
合成证据明确全量入库可用。
### 剩余与待核对
此范围无已知缺口；不覆盖恢复能力。

## [A-LIVE] 持续使用范围
### 覆盖范围
R-IMPORT 在 G-LIVE 的 RECOVERABLE 范围，同一工作副本版本。
### 交付与验证依据
全量入库已确认；失败恢复明确未达到约定。
### 剩余与待核对
缺少失败恢复；不把 R-DELTA 的未知混成当前已验证结果。

## [A-RELEASE] 另一发布对象
### 覆盖范围
同一演示范围，sample-release-0。
### 交付与验证依据
合成旧发布对象没有入库能力，约定演示失败。
### 剩余与待核对
全量入库未达到约定；不覆盖 sample-copy-a。

## [A-ALL] 总体使用结果
### 覆盖范围
G-ALL 的 OVERALL 范围。
### 交付与验证依据
已有演示成果，但没有总体实际使用核对。
### 剩余与待核对
总体尚未判定；保留各局部成果。
```

`docs/evidence/import.md`：

```markdown
# 合成证据
sample-copy-a／sample-baseline：全量入库可用，失败恢复未达到约定。
sample-release-0：没有全量入库能力，演示失败。
本文件只构造契约案例，不是任何真实验证报告。
```

## 2. 基础输出与一致性预期

本表为规范演算输出，不是现有解析器运行结果。在每个候选报告的定义摘要匹配且无新增反证时：

| 读取选择 | 必须得到的结果 |
| --- | --- |
| 总目标 | G-ALL；G-DEMO 是明确阶段子目标，G-LIVE 是必要子目标，不把它们平铺为三个总目标。 |
| 当前结构 | R-IMPORT part_of R-PIPELINE；父项仍 current；R-IMPORT 同时 supports G-DEMO、G-LIVE，身份不复制。 |
| 当前全景顺序 | R-PIPELINE、R-IMPORT、R-DELTA、R-NEW；R-OLD 的登记位置保留但被 current 筛选隐藏；R-UNORDERED 在“未指定顺序”入口。 |
| G-DEMO 筛选 | 登记列表子序列 R-IMPORT、R-NEW；R-IMPORT 的父项可作为图上下文保留，不因此加入直接支撑列表。 |
| G-LIVE 筛选 | R-PIPELINE、R-IMPORT、R-DELTA；依赖边不重排。 |
| 当前评估范围 | 从各 goal.assessment_scopes 取 target 对应范围；R-IMPORT 在 G-DEMO 为 FULL，在 G-LIVE 为 RECOVERABLE；不从报告选出当前范围。 |
| R-IMPORT／G-DEMO／FULL／working-copy sample-copy-a@sample-baseline | 选择 A-DEMO：satisfied；不被更新的 A-LIVE 或 A-RELEASE 覆盖。 |
| R-IMPORT／G-LIVE／RECOVERABLE／同一工作副本版本 | 选择 A-LIVE：partially-satisfied；全量成果和恢复缺口同时保留。 |
| R-IMPORT／G-DEMO／FULL／release sample-release-0 | 选择 A-RELEASE：not-satisfied；不能套用 A-DEMO。 |
| 同一需求和范围／另一个 commit 或 sample-copy-b | undetermined／no-applicable-report；不跨对象或工作副本套用。 |
| G-ALL／OVERALL／sample-copy-a@sample-baseline | A-ALL：undetermined，同时保留演示成果；不自动汇总子项。 |
| R-NEW replaces R-OLD | 进入历史演变；R-OLD 退出当前范围是其 scope 与合成依据的结果，不由 replaces 自动产生。 |

## 3. 独立变体及预期

每行从基础输入单独变化，不累积到下一行。克隆报告时只改表中列出的字段及必要正文，其他定位与摘要保留。

| 场景与输入变化 | 生产侧保存表达／消费侧预期 |
| --- | --- |
| 追加一批 R-X、R-Y，R-X 是 R-IMPORT 的依赖 | 在数组末尾按 R-X、R-Y 追加；旧位置不变，不拓扑排序。 |
| 用户明确重排为 R-DELTA、R-IMPORT、R-PIPELINE、R-OLD、R-NEW | 更新 project 数组并保留 change；G-DEMO 仍取子序列；不改 Task 或报告日期。 |
| 数组重复 R-IMPORT、加入不存在的 R-MISSING | 展示有效身份一次；分别诊断重复／悬空，R-UNORDERED 不消失。 |
| 去掉 root_goal_id；或指向 R-IMPORT；或重复 G-ALL 身份 | 分别为总目标未指定／无效类型／身份冲突；保留项目定位，不选 G-DEMO。 |
| 增加另一个 current goal G-OTHER，但 root_goal_id 不变 | 总目标仍 G-ALL；没有关系的目标保持可读，不猜成其子目标。 |
| 新增子需求 R-DETAIL part_of R-IMPORT | R-IMPORT 继续 current；R-DETAIL 作为新增项登记，细化不生成替代关系。 |
| R-OLD 改回 current 且仍有 replaces 边 | 显示替代尚未同步范围，不自动退休；保留两项真实状态。 |
| 添加反向 part_of 造成循环，或 inferred supports | 异常边诊断、候选边明确标注，不作为已声明有效分解，不阻止 Task。 |
| 克隆 A-DEMO 为 A-DEMO-2，checked_at 更晚，conclusion 相反且无 supersedes | 两条未替代报告：undetermined／multiple-reports；不按时间取新条。相同 conclusion 也不自动合并。 |
| A-DEMO-2 同定位、同 coverage，明确 supersedes: [A-DEMO] | 选择 A-DEMO-2，旧条保留历史；checked_at 只说明评估时间。 |
| 克隆 A-DEMO 为 A-DEMO-2，conclusion=not-satisfied，无 supersedes，仅删除 goal_definition_sha256 | 定位仍明确：新条作为不完整候选保留，当前为 undetermined／metadata-incomplete，同时保留 multiple-reports；不能静默只显示旧 satisfied。将该字段改为 null 也保持待核对，不因缺字段提高确定性。 |
| 同上克隆报告，但删除 applicability，无法精确定位 | 新条进入待核对列表，不猜其范围；FULL 选择仍可显示 A-DEMO 的已报告 satisfied，另列未定位材料提示，不冒称所有材料已核对。 |
| 克隆 A-DEMO 为 A-DEMO-BAD，supersedes: [A-DEMO, A-LIVE]；再克隆为 A-DEMO-FIX，supersedes: [A-DEMO, A-DEMO-BAD]，其余定位、依据完整不变；选择 G-DEMO／FULL／同对象 | FIX 对两条旧报告的同定位替代合法，选择 FIX 的 satisfied；BAD 的跨范围边保留历史诊断，不使当前选择持续 conflict。G-LIVE 的 A-LIVE 不被 BAD 删除，仍为 partially-satisfied。 |
| A-LIVE 写 supersedes: [A-DEMO]，选择 R-IMPORT／G-LIVE／RECOVERABLE／sample-copy-a@sample-baseline | A-LIVE 发出非法跨范围替代，该选择为 undetermined／conflict；不删除被指向的 A-DEMO。 |
| 同上非法边，选择 R-IMPORT／G-DEMO／FULL／同一工作副本版本 | A-LIVE 不在当前候选中，仍选 A-DEMO 为 satisfied；异常边可诊断，但不将被指向范围连带降级。 |
| 独立从基础输入克隆 A-DEMO-2，同定位同 coverage；A-DEMO 与 A-DEMO-2 互相 supersedes | 当前 FULL 选择为 undetermined／conflict；其他目标／范围的结论不受该环影响。 |
| 修改 R-IMPORT 的验收正文，保留原报告摘要 | undetermined／definition-changed；原满足报告及全量成果保留为历史，Task 可正常继续。 |
| 只将 G-DEMO 范围正文改为“要求全量导入并支持失败恢复”，保留声明和报告 | R-IMPORT 摘要未变，但 G-DEMO 摘要改变：FULL 选择为 undetermined／goal-definition-changed；不能继续称当前目标已满足。 |
| 只在 G-DEMO 增加 R-NEW／BATCH-CHECK 的合法声明，coverage 为“批量输入的追加检查”；明确选择原 R-IMPORT／FULL，仍引用已改变的当前文件，其他内容不变 | 所选 FULL 声明和需求摘要未变，但目标整体摘要改变且旧目标依据未恢复，旧 A-DEMO 仍为 undetermined／goal-definition-changed，并保留来源核对缺口和原成果。 |
| 先保存 G-DEMO 的完整旧文件快照，将其路径加入 source_paths，并令 A-DEMO.goal_basis 引用该快照及其实际文件 SHA-256；再仅增删改其他声明，明确选择 R-IMPORT／FULL | 验证原完整目标定义及文件摘要后，目标正文、类型、scope、关系及 FULL 均一致，A-DEMO 继续为 satisfied；历史摘要、原报告和交付对象不变。其他范围也可为同一需求的不同 scope_id。 |
| 在上述快照场景中改目标正文／关系／本范围，损坏或删除快照，或登记 pending_sources | 相应变化和依据缺口仍待核对；只要有其他缺口就不提供当前满足结论。目标自身 OVERALL 报告始终核对完整目标定义，不应用此豁免。 |
| 将 G-DEMO 当前声明的 FULL 改为 FULL-RECOVERY，并更新 coverage 为全量入库及失败恢复 | 默认当前范围为 FULL-RECOVERY，没有新报告时 no-applicable-report；显式拿旧 FULL 作当前查询为 scope-not-current。旧 A-DEMO 在历史入口继续可读。 |
| 只修改 FULL 声明 coverage 为新的恢复范围，没有改 scope_id | 当前声明与旧报告不符：scope-definition-changed，同时保留目标摘要变化诊断；要求维护身份，但不自动修复或阻止 Task。 |
| 去掉 G-DEMO.assessment_scopes；或增加同 target 的另一合法 scope_id | 分别为 scope-unavailable／未明确选择时 scope-selection-required；不按报告时间补当前范围。 |
| 只改 project.requirement_order 或新增 TaskBinding | R-IMPORT 定义摘要不变，不自动使报告待核对。 |
| A-DEMO.target_definition_sha256=null，或旧定义文件不可恢复 | undetermined／definition-unverified，保留原满足陈述，不伪称已核对当前要求。 |
| A-DEMO.goal_definition_sha256=null，或 goal_basis 不可恢复 | undetermined／goal-definition-unverified；完整的新定位不豁免目标依据核对。 |
| A-DEMO 新增 pending_sources 指向失败资料 | undetermined／pending-evidence；旧成果保留，不能以摘要未变忽略反证。 |
| A-LIVE 已确认全量成果，但恢复部分只有未知，conclusion 改 undetermined | 整体尚未判定，仍显示全量成果；不得改成 not-satisfied 或隐藏成果。 |
| subject.kind=unknown,value=null；或 working-copy 无 revision、有 limitations | unknown 不自动匹配已知对象；未固定副本只作为明确选中的已报告对象阅读，不称实时结论。 |
| 仅有原 v2 requirement.assessment_id 及旧 assessment | 定义／旧报告原样可读；总目标、项目顺序、新范围结论分别缺省降级，不从旧 PASS 推断 satisfied。 |

## 4. 旧文档对照输入

以下完整 Markdown 作为 `docs/product/LEGACY.md` 加入 manifest.managed_paths 与 source_paths，其他基础输入不变。它保持可识别的既有 v2 格式，不将 v3 字段写入 v2：

```markdown
---
schema: vnext-product-doc/v2
items:
  - {id: R-LEGACY, type: requirement, scope: current, assessment_id: A-LEGACY}
  - id: A-LEGACY
    type: assessment
    target: R-LEGACY
    target_basis: {kind: file, path: docs/product/LEGACY.md, item_id: R-LEGACY}
    target_definition_sha256: null
    checked_at: "2026-10-10T10:00:00+08:00"
    subject: {kind: unknown, value: null}
    implementation: delivered-reported
    verification: pass-reported
---
# 旧需求与报告

## [R-LEGACY] 历史导入需求
### 需求内容
保存历史导入要求。
### 范围边界
原有范围未补充新定位。
### 验收要求
保留原验收内容，不从旧报告补写要求。

## [A-LEGACY] 历史交付陈述
### 覆盖范围
原报告自述的历史范围，目标和对象未明确。
### 交付与验证依据
原报告自述 delivered-reported 和 pass-reported；本合成例没有新增核对材料。
### 剩余与待核对
保留旧陈述，当前目标、范围与对象适用性未知。
```

期望：assessment_id 可导航到旧报告；新结论为尚未判定且提示元数据不完整；不自动补目标、范围或对象。旧报告的非 unknown 标签没有对应来源时另保留缺证据诊断，不能把它当成合规的新报告。旧 v1 同样按本身版本只读。无 PRODUCT、暂停维护、未登记顺序、无总目标或无适用报告都不改变任何 Task 生命周期。

## 5. 完整 v3 报告引用 v2／v1 需求

这是独立变体：保留第 4 节 LEGACY.md 的 v2 定义；在 G-DEMO.assessment_scopes 追加 `{target: R-LEGACY, scope_id: LEGACY, coverage: 历史导入要求}`；将下列新报告文件加入 managed_paths。其他输入不变。这里只增加评估范围，不自动生成 supports 或 TaskBinding。报告中的目标摘要已包含这条新增声明；本变体未保存原目标快照，目标原有报告仍保留目标定义待核对提示，不能因新报告合法而回写旧报告依据。

`docs/product/SCOPED_LEGACY_REPORT.md`：

```markdown
---
schema: vnext-product-doc/v3
items:
  - id: A-LEGACY-SCOPED
    type: assessment
    target: R-LEGACY
    target_basis: {kind: file, path: docs/product/LEGACY.md, item_id: R-LEGACY}
    target_definition_algorithm: vnext-requirement-definition/v1
    target_definition_sha256: 9df629529fff92666877191e6d9ec3bd579c04027959933c0c772bf3dd014c59
    goal_basis: {kind: file, path: docs/product/PROJECT.md, item_id: G-DEMO}
    goal_definition_algorithm: vnext-product-definition/v1
    goal_definition_sha256: b23e10cce6e18c0ff92d8c3dc3730d3ef38ce4a86249ef7712d6ce312a812f32
    checked_at: "2026-10-11T13:00:00+08:00"
    applicability: {goal_id: G-DEMO, scope_id: LEGACY, coverage: 历史导入要求}
    subject: {kind: working-copy, value: sample-copy-a, revision: sample-baseline}
    conclusion: satisfied
    implementation: delivered-reported
    verification: pass-reported
    sources: [{kind: text, label: 合成对照证据, text: 本变体设定该对象已具备历史导入要求并经合成核对；不代表实际业务结果}]
---
# 新报告与旧需求对照

## [A-LEGACY-SCOPED] 明确范围的历史需求评估
### 覆盖范围
R-LEGACY／G-DEMO／LEGACY，仅覆盖旧需求约定。
### 交付与验证依据
本独立合成变体明确设置结果及依据；不是从旧 A-LEGACY 的 PASS 推断。
### 剩余与待核对
该约定范围无已知缺口，不覆盖其他导入范围。
```

| 选择／变化 | 预期 |
| --- | --- |
| R-LEGACY／G-DEMO／LEGACY／sample-copy-a@sample-baseline | 新报告两份依据均匹配，satisfied；旧 requirement 仍为 v2，不要求迁移。 |
| 仅将 LEGACY.md 标识改为 v1，其他允许字段和正文不变 | requirement 摘要算法仍为 vnext-requirement-definition/v1，结果相同；未向 v1 添加核心字段。 |
| 将该 requirement 显式迁为 v3，但新报告仍记录旧算法 | definition-algorithm-changed，当前尚未判定；保留旧依据，不直接比较跨算法哈希。 |
| 去掉新报告的 goal_basis／goal_definition_algorithm | metadata-incomplete，不能以 target 摘要匹配替代目标核对。 |
| 适用 goal 仍为 v2、没有当前范围声明 | scope-unavailable，历史报告可读，不从报告反推当前范围。 |

## 6. v3 项目中的混合格式需求批次

本变体独立从基础输入开始。项目已经采用 v3 的 `requirement_order`，新增需求文件仍可采用合法 v2；顺序登记依据项目的能力，不依据需求文件的版本。先将 `docs/product/MIXED_V2.md` 加入 managed_paths，再用同一 apply 请求依次保存本文件、向基础 PROJECT.md 追加 v3 需求 R-V3-NEW；不显式提交项目顺序。新增 v3 需求正文沿用 R-NEW 的三个业务章节并替换身份，元数据为 `{id: R-V3-NEW, type: requirement, scope: current}`。

`docs/product/MIXED_V2.md`：

```markdown
---
schema: vnext-product-doc/v2
items:
  - {id: R-V2-NEW, type: requirement, scope: current}
  - {id: R-V2-NEXT, type: requirement, scope: current}
---
# 旧格式新增需求批次

## [R-V2-NEW] 保存新增导入要求
### 需求内容
保存本次新增的导入要求。
### 范围边界
仅覆盖这批输入。
### 验收要求
需求文件保持 v2，能够回读且在项目登记顺序中出现。

## [R-V2-NEXT] 保存后续检查要求
### 需求内容
保存本次后续检查要求。
### 范围边界
不改变其他需求的状态。
### 验收要求
在本批前一项之后登记。
```

| 保存／变化 | 预期 |
| --- | --- |
| 按上述批次保存成功 | 原数组后依次追加 R-V2-NEW、R-V2-NEXT、R-V3-NEW；旧位置及 R-OLD 历史登记保留，R-UNORDERED 仍未登记。MIXED_V2.md 不迁移，需求可读。 |
| 按当前文件摘要再次维护相同身份 | 不重复追加已登记身份，不重新排序。 |
| 同批追加 v2 需求并明确提供项目数组，故意不含新身份 | 以显式数组为准，该新需求保留在未指定顺序入口。 |
| 新增 v2 需求保存成功，但 v3 项目被冻结或顺序写入冲突 | 文件保存与顺序跟进结果分别返回；需求仍可读且在未指定顺序入口，补写失败的项目数组即可。 |
| 项目自身仍为 v2，只新增 v2 需求 | 保持既有保存结果，不自动迁移项目或添加 v3 顺序字段。新增 v3 需求而缺少可用 v3 项目时，保留既有顺序待维护提示。 |
