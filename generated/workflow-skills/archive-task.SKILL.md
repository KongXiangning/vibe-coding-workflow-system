---
name: archive-task
preamble-tier: 2
version: 0.2.0
description: >
  Archive the completed task into TASKS/ and create a clean handoff into the
  next task cycle.
purpose: |
  将本轮任务归档到 TASKS/，并为下一轮留下清晰入口。
stage: 阶段 8：交付沉淀
trigger: |
  任务正式完成并确认可以归档时。
inputs:
  - current_task
  - delivery_summary
  - status_doc
reads:
  - CURRENT_TASK.md
  - 任务摘要
  - STATUS.md
writes:
  - TASKS/TASK-{{TASK_ID}}-{{TASK_SLUG}}.md
  - CURRENT_TASK.md
forbidden_writes:
  - scripts
  - browse/src
  - design/src
  - test
  - browse/test
  - CONTRACTS.md
  - DECISIONS.md
must_check:
  - 归档命名是否规范
  - 归档内容是否包含任务定义与结果
  - 是否需要创建下一轮任务包
stop_conditions:
  - 当前任务仍未满足验收标准
  - 下一步任务依赖尚不明确
output:
  - 归档文件
  - 下一轮入口建议
handoff:
  success: create-current-task
  failure: ask-user
decision_policy:
  mechanical: 可以自动整理归档结构与命名。
  taste: 不要在归档阶段改写历史。
  user_challenge: 任务未完成时不得强行归档。
verification:
  - 归档文件包含定义、执行、验证、后续建议
  - 归档命名符合规范
  - CURRENT_TASK.md 已为下一轮做好准备或明确保留
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - AskUserQuestion
benefits-from:
  - /prepare-delivery-summary
notes:
  - 归档是为了后续接力，不是简单移动文件。
archive_naming:
  - TASK-{{TASK_ID}}-{{TASK_SLUG}}.md
archive_conditions:
  - 当前任务满足验收标准
  - 关键验证已完成
  - 交付摘要已形成
next_task_policy:
  - 如果下一轮任务明确，应提示创建新的 CURRENT_TASK.md
---

# Skill: archive-task

## Purpose

将本轮任务归档到 TASKS/，并为下一轮留下清晰入口。

## Trigger

任务正式完成并确认可以归档时。

## Inputs

- current_task
- delivery_summary
- status_doc

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

- 归档命名是否规范
- 归档内容是否包含任务定义与结果
- 是否需要创建下一轮任务包

## Stop Conditions

- 当前任务仍未满足验收标准
- 下一步任务依赖尚不明确

## Decision Policy

- `mechanical`: 可以自动整理归档结构与命名。
- `taste`: 不要在归档阶段改写历史。
- `user_challenge`: 任务未完成时不得强行归档。

## Verification

- 归档文件包含定义、执行、验证、后续建议
- 归档命名符合规范
- CURRENT_TASK.md 已为下一轮做好准备或明确保留

## Extension Fields

### archive_naming
- TASK-{{TASK_ID}}-{{TASK_SLUG}}.md

### archive_conditions
- 当前任务满足验收标准
- 关键验证已完成
- 交付摘要已形成

### next_task_policy
- 如果下一轮任务明确，应提示创建新的 CURRENT_TASK.md

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

- 归档是为了后续接力，不是简单移动文件。
- This is a draft skill template generated from the workflow schema in `vibe-coding-workflow.md`.
- Replace project variables with concrete project-specific values during skill generation.

## Project-Type Emphasis

- Emphasize script boundaries, generated artifact discipline, and host compatibility.
- Bias validation toward generator correctness, workflow closure, and documentation sync.
- Treat accidental interference with existing generation pipelines as a critical risk.
