---
name: classify-decisions
preamble-tier: 2
version: 0.2.0
description: >
  Classify implementation decisions into mechanical, taste, and user-challenge
  categories.
purpose: |
  把任务中的决策分为 Mechanical、Taste、User challenge。
stage: 阶段 3：方案拆解
trigger: |
  开始拆步骤前。
inputs:
  - current_task
  - confirmed_decisions
  - user_preferences
reads:
  - CURRENT_TASK.md
  - DECISIONS.md
writes:
  - CURRENT_TASK.md
  - DECISIONS.md
forbidden_writes:
  - scripts
  - browse/src
  - design/src
  - test
  - browse/test
must_check:
  - 哪些决策可自动处理
  - 哪些属于口味选择
  - 哪些触及已确认方向
stop_conditions:
  - 用户目标与既有决策冲突
  - 口味选择会显著影响实现但尚未确认
output:
  - 决策分类结果
  - 待确认的 Taste / User challenge 项
handoff:
  success: decompose-task
  failure: ask-user
decision_policy:
  mechanical: 可自动整理和分类已有明确决策。
  taste: 必须显式列出，不能装作默认值。
  user_challenge: 禁止静默更改用户已明确表达的方向。
verification:
  - CURRENT_TASK.md 中已有决策分类区
  - 需要用户确认的决策已单独列出
  - 不会把口味问题伪装成技术必然
allowed-tools:
  - Read
  - Write
  - Edit
  - AskUserQuestion
benefits-from:
  - /lock-scope
notes:
  - 这是治理 skill，不是设计替代品。
decision_policy_rules:
  - Mechanical 可自动决定
  - Taste 需要暴露给用户
  - User challenge 禁止静默决定
---

# Skill: classify-decisions

## Purpose

把任务中的决策分为 Mechanical、Taste、User challenge。

## Trigger

开始拆步骤前。

## Inputs

- current_task
- confirmed_decisions
- user_preferences

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
3. When `CURRENT_TASK.md` exists, treat it as the source of truth for scope.

## Must Check

- 哪些决策可自动处理
- 哪些属于口味选择
- 哪些触及已确认方向

## Stop Conditions

- 用户目标与既有决策冲突
- 口味选择会显著影响实现但尚未确认

## Decision Policy

- `mechanical`: 可自动整理和分类已有明确决策。
- `taste`: 必须显式列出，不能装作默认值。
- `user_challenge`: 禁止静默更改用户已明确表达的方向。

## Verification

- CURRENT_TASK.md 中已有决策分类区
- 需要用户确认的决策已单独列出
- 不会把口味问题伪装成技术必然

## Extension Fields

### decision_policy_rules
- Mechanical 可自动决定
- Taste 需要暴露给用户
- User challenge 禁止静默决定

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

- 这是治理 skill，不是设计替代品。
- This is a draft skill template generated from the workflow schema in `vibe-coding-workflow.md`.
- Replace project variables with concrete project-specific values during skill generation.

## Project-Type Emphasis

- Emphasize script boundaries, generated artifact discipline, and host compatibility.
- Bias validation toward generator correctness, workflow closure, and documentation sync.
- Treat accidental interference with existing generation pipelines as a critical risk.
