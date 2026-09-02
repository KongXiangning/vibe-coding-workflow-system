---
schema_version: 1
kind: vnext-current-task
document_id: doc-000000000000000000000000
runtime_state:
  schema_version: 1
  kind: vnext-current-task-runtime-state
  task_id: '000'
  task_slug: bootstrap-baseline
  workflow_status: closed
  lifecycle_state: archived
  resume_requires_review: false
  resume_review_reasons: []
  active_step_id: bootstrap-baseline
  active_step_status: completed
  finding_queue_revision: 0
  review_cycle:
    id: review-cycle-0
    cycle_phase: discovery
    repair_round: 0
    counted_repair_wave_ids: []
    active_repair_wave_id: null
    verification_new_finding_wave_used: false
    verification_new_finding_wave_id: null
  findings: []
  execution_log: []
  applied_proposals: []
---
# vNext CURRENT_TASK

## 任务信息

- 任务 ID：000
- 任务标题：Bootstrap baseline (non-executable)
- 任务 slug：bootstrap-baseline
- 当前状态：closed
- 生命周期状态：archived
- 恢复需审查：false
- 恢复审查原因：

## 验收标准

- [x] The project-local vNext surface was promoted and read back.

## 允许修改范围

### Allowed Files

- `docs/workflow/**`

### Conditional Files

- `.workflow-system/vnext/BOOTSTRAP_RECEIPT.json` when bootstrap replay evidence and project-owner authority are present

## 禁止修改范围

### Forbidden Files

- `.git/**`
- `src/**`
- `app/**`
- `lib/**`
- `package.json`
- `package-lock.json`

## 实施步骤

- bootstrap-baseline: record the non-executable bootstrap baseline
  - Purpose: make the initial project state readable without creating an active task
  - Mutation scope: docs/workflow/**
  - Required evidence: bootstrap asset checksums and Runtime read-back
  - Review checkpoint: not-required

## 执行记录

- Bootstrap creates no active execution record.

