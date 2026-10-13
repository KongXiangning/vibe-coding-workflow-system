# Implementation Roadmap 核对示例

这是可安装的合成消费者输入，不是用户真实决定或交付证据。先复制以下文件到隔离项目，再用 `read` 获取明确选择的路线图。文件路径不等于身份；旧 `PLAN.md` 无需改名。

`.workflow-system/PRODUCT.yaml`：

```yaml
schema: vnext-product-manifest/v2
project_id: roadmap-example
entry: docs/product/PROJECT.md
managed_paths: [docs/product/*.md]
source_paths: []
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
  - id: REQ-20
    type: requirement
    scope: current
---
# 合成项目

## [PROJECT] 权限分阶段示例
### 项目定位
演示一个需求跨阶段安排。
### 盘点范围与未核对项
只有合成定义；未读取真实代码或交付材料。

## [REQ-20] 权限、隐私和审计
### 需求内容
公共与租户边界、来源授权、隐私、必要审计及角色权限。
### 范围边界
基础约束与完整角色实现分阶段，但仍为同一需求。
### 验收要求
按实际对象分别核对每阶段；基础任务关闭不等于完整需求满足。
```

`docs/product/IMPLEMENTATION_ROADMAP.md`：

```markdown
---
schema: vnext-product-doc/v4
items:
  - id: PLAN-PERMISSIONS
    type: plan
    intent_state: proposed
    targets:
      - target: REQ-20
        coverage: 基础约束及完整角色实现
    work_items:
      - id: W20-A
        title: 基础约束
        outcome: 明确隔离、隐私和必要审计
        scope: 基础约束
        targets: [{target: REQ-20, coverage: 基础约束}]
        state: included
        origin: initial
        stage: before-01
      - id: W20-B
        title: 完整角色权限
        outcome: 实现角色、继承及权限审计
        scope: 完整角色实现
        targets: [{target: REQ-20, coverage: 完整角色实现}]
        state: included
        origin: initial
        stage: after-06-before-09
        depends_on:
          - item_id: W20-A
            kind: order
            reason: 合成安排；真实工程前提需另有证据
---
# 项目实施路线图

## [PLAN-PERMISSIONS] 权限实施路线图
### 实施策略
先基础约束，后完整角色；此示例尚未采用。
### 阶段与工作项说明
W20-A 与 W20-B 使用同一需求身份；没有创建未来 Task。
### 调整与未决事项
真实交付未知。未建立基线，不能宣称与当前需求已经核对。
```

首次读取请求：

```json
{"detail":"items","roadmap_query":{"plan_id":"PLAN-PERMISSIONS","selector":{"kind":"explicit-requirements","requirement_ids":["REQ-20"]}}}
```

应返回 `unknown`、`baseline-missing`、范围成员 `REQ-20`、两项 WorkItem 和 `snapshot_proposal`。提案中的 ID／摘要只是当前读取材料，没有任何 Task、交付结论或已核对认证。

真实 Agent 完成正文、设计、交付及影响核对后，在已有授权内保存实际安排；回读，再将 `snapshot_proposal` 的字段与以下真实信息合为 `planning_baseline`：

```json
{"checked_at":"<实际核对时间，带时区>","working_copy":"<read.working_copy.identity>","sources":[{"kind":"text","label":"实际核对依据","text":"<真实读取边界、用户决定和语义核对结果>"}],"unread_sources":[],"exceptions":[]}
```

用 `apply.files[].updates` 写入，并携带读到的文件 `expected_sha256`；保存后重新读取 `roadmap_query`，不再传入 selector，使读取使用已保存基线。后续手工修改 REQ-20 正文即出现 `definition-changed`；没有 Change 也能发现。再次核对且无需调整时，保存对应精确版本的 `no-adjustment` 处置和来源；延期用 `deferred`，保留风险及决定。同一版本不会重复要求确认。

总体范围用 `project-current`，六项近期范围用 `explicit-requirements` 的六个 ID；`target-subgraph` 只沿有效已声明组成／支撑关系计算。查看 `scope.outside_scope`、`scope.unassigned` 和 reasons，不能将其误认为已规划或已交付。多个路线图须分别显式选择，不按文件时间合并。

离线只读消费者：`node offline-reader.js <明确项目根> PLAN-PERMISSIONS`。它返回相同核对字段，不写入、调用模型或计算 Task 状态。TraceLens 应按相同契约展示，页面接入仍在其仓库另行验证。
