---
name: implement-current-step
preamble-tier: 2
version: 0.2.0
description: >
  Implement only the current step from CURRENT_TASK.md and refuse opportunistic
  scope expansion.
purpose: |
  只实现 CURRENT_TASK.md 中当前步骤，禁止顺手扩散。
stage: 阶段 4：小步实现
trigger: |
  进入具体编码实现时。
inputs:
  - current_task_current_step
  - contracts
  - confirmed_decisions
  - lessons
reads:
  - CURRENT_TASK.md
  - CONTRACTS.md
  - DECISIONS.md
  - LESSONS.md
writes:
  - scripts
  - browse/src
  - design/src
  - test
  - browse/test
  - CURRENT_TASK.md
forbidden_writes:
  - .git/**
  - node_modules/**
  - CONTRACTS.md
  - DECISIONS.md
must_check:
  - 是否只执行当前步骤
  - 是否只改允许范围内的文件
  - 是否遵守既有决策与 lessons
stop_conditions:
  - 需要修改范围外文件
  - 需要破坏锁定契约
  - 实现依赖未确认的 Taste / User challenge 决策
output:
  - 代码改动
  - 修改文件列表
  - 本步验证结果
  - CURRENT_TASK.md 更新
handoff:
  success: review-diff
  failure: ask-user
decision_policy:
  mechanical: 可以自动选择低风险实现细节与局部重构内联形式。
  taste: 样式、文案、交互布局等不得静默决定。
  user_challenge: 不得绕过锁定架构、接口和用户已定方向。
verification:
  - 修改文件全部在授权范围内
  - 当前步骤有最小验证结果
  - CURRENT_TASK.md 执行记录已更新
allowed-tools:
  - Read
  - Grep
  - Glob
  - Write
  - Edit
  - Bash
  - AskUserQuestion
benefits-from:
  - /decompose-task
notes:
  - 这是唯一允许改业务代码的主要实现 skill。
allowed_change_types:
  - 新增
  - 局部修改
  - 最小必要删除
disallowed_patterns:
  - 顺手重构
  - 顺手补 unrelated bug
  - 未经授权扩大范围
step_limit:
  - 一次只允许完成一个当前步骤
regression_expectation:
  - 完成后至少提供最小验证结果
  - 不得把未验证步骤标记为完成
---

# Skill: implement-current-step

## Purpose

只实现 CURRENT_TASK.md 中当前步骤，禁止顺手扩散。

## Trigger

进入具体编码实现时。

## Inputs

- current_task_current_step
- contracts
- confirmed_decisions
- lessons

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

- 是否只执行当前步骤
- 是否只改允许范围内的文件
- 是否遵守既有决策与 lessons

## Stop Conditions

- 需要修改范围外文件
- 需要破坏锁定契约
- 实现依赖未确认的 Taste / User challenge 决策

## Decision Policy

- `mechanical`: 可以自动选择低风险实现细节与局部重构内联形式。
- `taste`: 样式、文案、交互布局等不得静默决定。
- `user_challenge`: 不得绕过锁定架构、接口和用户已定方向。

## Verification

- 修改文件全部在授权范围内
- 当前步骤有最小验证结果
- CURRENT_TASK.md 执行记录已更新

## Extension Fields

### allowed_change_types
- 新增
- 局部修改
- 最小必要删除

### disallowed_patterns
- 顺手重构
- 顺手补 unrelated bug
- 未经授权扩大范围

### step_limit
- 一次只允许完成一个当前步骤

### regression_expectation
- 完成后至少提供最小验证结果
- 不得把未验证步骤标记为完成

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

- 这是唯一允许改业务代码的主要实现 skill。
- This is a draft skill template generated from the workflow schema in `vibe-coding-workflow.md`.
- Replace project variables with concrete project-specific values during skill generation.

## Project-Type Emphasis

- Emphasize script boundaries, generated artifact discipline, and host compatibility.
- Bias validation toward generator correctness, workflow closure, and documentation sync.
- Treat accidental interference with existing generation pipelines as a critical risk.
