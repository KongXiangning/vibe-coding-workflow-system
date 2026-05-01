---
name: sync-decisions
preamble-tier: 2
version: 0.2.0
description: >
  Persist confirmed architecture, taste, deferred, or rejected decisions to
  docs/workflow/DECISIONS.md.
purpose: |
  把本轮已确认的决策写入 docs/workflow/DECISIONS.md。
stage: 阶段 7：状态同步
trigger: |
  本轮实现明确形成了新的架构决策、口味决策、暂缓项或否决项时。
inputs:
  - decisions_doc
  - current_task
  - actual_results
  - user_confirmation
reads:
  - docs/workflow/DECISIONS.md
  - docs/workflow/CURRENT_TASK.md
writes:
  - docs/workflow/DECISIONS.md
forbidden_writes:
  - scripts
  - browse/src
  - design/src
  - test
  - browse/test
must_check:
  - 决策属于哪一类
  - 为什么做这个选择
  - AI 是否被禁止自行更改该项
stop_conditions:
  - 决策尚未获得明确确认
  - 当前选择与既有已确认决策冲突
output:
  - docs/workflow/DECISIONS.md 更新
handoff:
  success: sync-host-guidance
  failure: ask-user
decision_policy:
  mechanical: 可以自动整理已确认决策的记录格式。
  taste: 口味决策必须保留用户判断痕迹。
  user_challenge: 不得替用户捏造未确认决策。
verification:
  - 新增决策已正确分类
  - 每条记录都有 why 与约束
  - 没有覆盖历史决策而不留痕迹
allowed-tools:
  - Read
  - Write
  - Edit
  - AskUserQuestion
benefits-from:
  - /sync-contracts
notes:
  - docs/workflow/DECISIONS.md 记录的是决策，不是临时想法。
sync_rules:
  - 出现已确认决策时同步
  - 暂缓项和否决项也要记录
decision_record_policy:
  - 只记录明确拍板的决策
  - 每条决策都要说明不可静默变更约束
---

# Skill: sync-decisions

## Purpose

把本轮已确认的决策写入 docs/workflow/DECISIONS.md。

## Trigger

本轮实现明确形成了新的架构决策、口味决策、暂缓项或否决项时。

## Inputs

- decisions_doc
- current_task
- actual_results
- user_confirmation

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

- 决策属于哪一类
- 为什么做这个选择
- AI 是否被禁止自行更改该项

## Stop Conditions

- 决策尚未获得明确确认
- 当前选择与既有已确认决策冲突

## Decision Policy

- `mechanical`: 可以自动整理已确认决策的记录格式。
- `taste`: 口味决策必须保留用户判断痕迹。
- `user_challenge`: 不得替用户捏造未确认决策。

## Verification

- 新增决策已正确分类
- 每条记录都有 why 与约束
- 没有覆盖历史决策而不留痕迹

## Extension Fields

### sync_rules
- 出现已确认决策时同步
- 暂缓项和否决项也要记录

### decision_record_policy
- 只记录明确拍板的决策
- 每条决策都要说明不可静默变更约束

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

- docs/workflow/DECISIONS.md 记录的是决策，不是临时想法。
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
