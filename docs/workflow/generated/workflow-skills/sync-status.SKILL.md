---
name: sync-status
preamble-tier: 2
version: 0.2.0
description: >
  Update docs/workflow/STATUS.md to reflect actual project progress and stable
  boundaries after the task step finishes.
purpose: |
  更新 docs/workflow/STATUS.md，反映当前项目整体进度和稳定状态。
stage: 阶段 7：状态同步
trigger: |
  任务阶段完成或状态发生变化时。
inputs:
  - current_task
  - status_doc
  - verification_results
reads:
  - docs/workflow/STATUS.md
  - docs/workflow/CURRENT_TASK.md
writes:
  - docs/workflow/STATUS.md
forbidden_writes:
  - scripts
  - browse/src
  - design/src
  - test
  - browse/test
must_check:
  - 哪些模块进入稳定
  - 哪些任务仍在开发中
  - 哪些需求被取消或推迟
  - 发布后状态是否为 stable / observing / blocked / rolled-back
stop_conditions:
  - 状态变化事实不清
  - 当前任务尚未完成关键验证
  - canary 或 benchmark 未完成但试图写入稳定
output:
  - 更新后的 docs/workflow/STATUS.md
handoff:
  success: sync-contracts
  failure: ask-user
decision_policy:
  mechanical: 可以自动移动任务状态和整理模块清单。
  taste: 不要用乐观措辞代替事实状态。
  user_challenge: 未稳定内容不得写成稳定。
verification:
  - docs/workflow/STATUS.md 与本轮验证结果一致
  - 开发中 / 稳定 / 推迟状态分类清晰
  - 发布后状态与 Release evidence 一致
allowed-tools:
  - Read
  - Write
  - Edit
  - AskUserQuestion
benefits-from:
  - /sync-current-task
notes:
  - docs/workflow/STATUS.md 是现状文件，不是路线图文件。
sync_rules:
  - 阶段完成或状态变化后同步
  - 状态应反映真实现状
stability_threshold:
  - 至少完成当前任务验收并通过关键验证后，才能写入稳定区
post_release_statuses:
  - stable
  - observing
  - blocked
  - rolled-back
post_release_sync_rules:
  - canary 或 benchmark 未完成时只能写 observing 或 blocked
  - rollback / recovery 已触发时写 rolled-back
  - Release evidence 不足时不得写 stable
post_release_fields:
  - Release mode
  - Deploy source
  - Target environment
  - Health checks
  - Canary window
  - Performance baseline
  - Rollback / recovery
  - Release evidence
---

# Skill: sync-status

## Purpose

更新 docs/workflow/STATUS.md，反映当前项目整体进度和稳定状态。

## Trigger

任务阶段完成或状态发生变化时。

## Inputs

- current_task
- status_doc
- verification_results

## Project Variables

### core
- gstack
- ai-engineering-workflow
- TypeScript, Markdown, Shell

### structure
- scripts, browse/src, design/src, test, browse/test
- .git/**, node_modules/**
- Keep repository-wide automation and generators in scripts/., Treat templates/skills/ as workflow skill template sources, not runtime outputs., Do not hand-edit generated outputs in dist/ or generated SKILL.md files., Preserve the subsystem split between browse/, design/, scripts/, and docs., Prefer Bun/TypeScript for new generation and validation tooling.

### execution
- bun test, bun run skill:check, bun run test:audit
- mechanical, taste, user_challenge

## Required Reads

1. Read every file listed in frontmatter `reads` before making any decision.
2. If a required file is missing, follow `handoff.failure` instead of guessing.
3. When `docs/workflow/CURRENT_TASK.md` exists, treat it as the source of truth for scope.

## Must Check

- 哪些模块进入稳定
- 哪些任务仍在开发中
- 哪些需求被取消或推迟
- 发布后状态是否为 stable / observing / blocked / rolled-back

## Stop Conditions

- 状态变化事实不清
- 当前任务尚未完成关键验证
- canary 或 benchmark 未完成但试图写入稳定

## Decision Policy

- `mechanical`: 可以自动移动任务状态和整理模块清单。
- `taste`: 不要用乐观措辞代替事实状态。
- `user_challenge`: 未稳定内容不得写成稳定。

## Verification

- docs/workflow/STATUS.md 与本轮验证结果一致
- 开发中 / 稳定 / 推迟状态分类清晰
- 发布后状态与 Release evidence 一致

## Extension Fields

### sync_rules
- 阶段完成或状态变化后同步
- 状态应反映真实现状

### stability_threshold
- 至少完成当前任务验收并通过关键验证后，才能写入稳定区

### post_release_statuses
- stable
- observing
- blocked
- rolled-back

### post_release_sync_rules
- canary 或 benchmark 未完成时只能写 observing 或 blocked
- rollback / recovery 已触发时写 rolled-back
- Release evidence 不足时不得写 stable

### post_release_fields
- Release mode
- Deploy source
- Target environment
- Health checks
- Canary window
- Performance baseline
- Rollback / recovery
- Release evidence

## Post-Release Status Sync

发布后状态只能同步为：

- stable
- observing
- blocked
- rolled-back

未完成 canary 或 benchmark 时，不得把任务写成 stable。缺少 Release evidence 时写 blocked；仍在观察窗口内写 observing；已触发 Rollback / recovery 时写 rolled-back。

同步前必须读取 docs/workflow/CURRENT_TASK.md 的发布后验证字段：Release mode、Deploy source、Target environment、Health checks、Canary window、Performance baseline、Rollback / recovery、Release evidence。

## Execution Protocol

1. Restate the goal in one sentence.
2. Read all files listed in `reads`.
3. Check `must_check` items before acting.
4. Respect `forbidden_writes` and current task boundaries.
5. If any `stop_conditions` match, stop and hand off to `handoff.failure`.
6. Produce the artifact(s) described in `output`.
7. Hand off to `handoff.success` when the skill completes normally.

## Output Contract

- Only write the files listed in `writes`.
- If `writes` is `[]`, respond without persisting files.
- Surface assumptions explicitly.
- Keep the result structured and auditable.
- Report unresolved risks rather than hiding them.

## Notes

- docs/workflow/STATUS.md 是现状文件，不是路线图文件。
- This is a draft skill template generated from the workflow schema in `vibe-coding/vibe-coding-workflow.md`.
- This source-repo reference render already expands the current `.workflow-system/PROJECT_PROFILE.yaml`; target projects re-render these values during install / sync.

## Reference Render Semantics

- This generated file is a source-repo reference render produced from the current `.workflow-system/PROJECT_PROFILE.yaml`.
- The concrete project values shown here reflect this repository's profile, not a universal target-project default.
- Target projects render workflow skills from their own `.workflow-system/PROJECT_PROFILE.yaml` during install / sync.

## Project-Type Emphasis

- Emphasize script boundaries, generated artifact discipline, and host compatibility.
- Bias validation toward generator correctness, workflow closure, and documentation sync.
- Treat accidental interference with existing generation pipelines as a critical risk.
