---
name: verify-contracts
preamble-tier: 2
version: 0.2.0
description: >
  Verify that the current diff does not violate locked interface or architecture
  contracts.
purpose: |
  专门核查接口契约和架构契约是否被破坏。
stage: 阶段 5：范围复核
trigger: |
  diff 较大、涉及稳定边界，或 review-diff 发现潜在契约风险时。
inputs:
  - current_diff
  - contracts
  - current_task
reads:
  - git diff
  - CONTRACTS.md
  - CURRENT_TASK.md
writes: []
forbidden_writes:
  - scripts
  - browse/src
  - design/src
  - test
  - browse/test
  - CONTRACTS.md
must_check:
  - 接口签名与返回结构
  - 稳定导出与表结构
  - 依赖方向、状态流、目录职责、DTO 语义
stop_conditions:
  - 发现锁定契约已被破坏
  - 发现需要修改 CONTRACTS.md 才能解释当前改动
output:
  - 接口契约检查结果
  - 架构契约检查结果
handoff:
  success: run-regression
  failure: ask-user
decision_policy:
  mechanical: 可以自动比对签名、字段和依赖方向变化。
  taste: 不要把风格类建议当作契约问题。
  user_challenge: 发现必须放宽契约时必须停下并请求确认。
verification:
  - 接口层与架构层都已检查
  - 已明确标注是否破坏锁定契约
  - 没有静默放宽边界
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - AskUserQuestion
benefits-from:
  - /review-diff
notes:
  - 如果契约需要调整，应回到人工决策，而不是在此 skill 中放宽。
contract_layers:
  - 接口契约
  - 架构契约
scope_sources:
  - CONTRACTS.md
  - CURRENT_TASK.md
diff_filters:
  - 签名变化
  - 依赖方向变化
  - DTO / 事件语义变化
violation_levels:
  - "major: 破坏扩展性"
  - "critical: 破坏锁定契约"
pass_criteria:
  - 无锁定契约破坏
  - 无未授权架构反向依赖
---

# Skill: verify-contracts

## Purpose

专门核查接口契约和架构契约是否被破坏。

## Trigger

diff 较大、涉及稳定边界，或 review-diff 发现潜在契约风险时。

## Inputs

- current_diff
- contracts
- current_task

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

- 接口签名与返回结构
- 稳定导出与表结构
- 依赖方向、状态流、目录职责、DTO 语义

## Stop Conditions

- 发现锁定契约已被破坏
- 发现需要修改 CONTRACTS.md 才能解释当前改动

## Decision Policy

- `mechanical`: 可以自动比对签名、字段和依赖方向变化。
- `taste`: 不要把风格类建议当作契约问题。
- `user_challenge`: 发现必须放宽契约时必须停下并请求确认。

## Verification

- 接口层与架构层都已检查
- 已明确标注是否破坏锁定契约
- 没有静默放宽边界

## Extension Fields

### contract_layers
- 接口契约
- 架构契约

### scope_sources
- CONTRACTS.md
- CURRENT_TASK.md

### diff_filters
- 签名变化
- 依赖方向变化
- DTO / 事件语义变化

### violation_levels
- major: 破坏扩展性
- critical: 破坏锁定契约

### pass_criteria
- 无锁定契约破坏
- 无未授权架构反向依赖

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

- 如果契约需要调整，应回到人工决策，而不是在此 skill 中放宽。
- This is a draft skill template generated from the workflow schema in `vibe-coding-workflow.md`.
- Replace project variables with concrete project-specific values during skill generation.

## Project-Type Emphasis

- Emphasize script boundaries, generated artifact discipline, and host compatibility.
- Bias validation toward generator correctness, workflow closure, and documentation sync.
- Treat accidental interference with existing generation pipelines as a critical risk.
