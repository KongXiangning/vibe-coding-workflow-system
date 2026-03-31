---
name: sync-contracts
preamble-tier: 2
version: 0.2.0
description: >
  Sync newly stabilized interfaces or architectural boundaries into CONTRACTS.md.
purpose: |
  将新形成的稳定接口或架构边界写入 CONTRACTS.md。
stage: 阶段 7：状态同步
trigger: |
  本轮任务新增了稳定接口、稳定结构或稳定架构规则时。
inputs:
  - contracts_doc
  - current_task
  - actual_changes
  - verification_results
reads:
  - CONTRACTS.md
  - CURRENT_TASK.md
  - 实际改动
  - 验证结果
writes:
  - CONTRACTS.md
forbidden_writes:
  - scripts
  - browse/src
  - design/src
  - test
  - browse/test
must_check:
  - 是否真的已经稳定
  - 应该写入接口层还是架构层
  - 是否会限制后续仍需迭代的内容
stop_conditions:
  - 边界尚未稳定
  - 需要修改现有锁定契约才能解释这次改动
output:
  - CONTRACTS.md 更新建议或实际更新
handoff:
  success: sync-decisions
  failure: ask-user
decision_policy:
  mechanical: 可以自动整理新增稳定边界的文档位置。
  taste: 不要因为写起来方便就提前锁死临时接口。
  user_challenge: 放宽或重写既有锁定契约必须停下确认。
verification:
  - 只有稳定边界被写入 CONTRACTS.md
  - 接口层与架构层分类正确
  - 未错误锁死临时实现
allowed-tools:
  - Read
  - Write
  - Edit
  - AskUserQuestion
benefits-from:
  - /sync-status
notes:
  - 契约记录的是稳定边界，不是当前所有实现细节。
sync_rules:
  - 新增稳定边界后同步
  - 不要提前锁定临时设计
stability_threshold:
  - 需经过当前任务验证并确认短期不会继续频繁改动
contract_layers:
  - 接口契约
  - 架构契约
---

# Skill: sync-contracts

## Purpose

将新形成的稳定接口或架构边界写入 CONTRACTS.md。

## Trigger

本轮任务新增了稳定接口、稳定结构或稳定架构规则时。

## Inputs

- contracts_doc
- current_task
- actual_changes
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
3. When `CURRENT_TASK.md` exists, treat it as the source of truth for scope.

## Must Check

- 是否真的已经稳定
- 应该写入接口层还是架构层
- 是否会限制后续仍需迭代的内容

## Stop Conditions

- 边界尚未稳定
- 需要修改现有锁定契约才能解释这次改动

## Decision Policy

- `mechanical`: 可以自动整理新增稳定边界的文档位置。
- `taste`: 不要因为写起来方便就提前锁死临时接口。
- `user_challenge`: 放宽或重写既有锁定契约必须停下确认。

## Verification

- 只有稳定边界被写入 CONTRACTS.md
- 接口层与架构层分类正确
- 未错误锁死临时实现

## Extension Fields

### sync_rules
- 新增稳定边界后同步
- 不要提前锁定临时设计

### stability_threshold
- 需经过当前任务验证并确认短期不会继续频繁改动

### contract_layers
- 接口契约
- 架构契约

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

- 契约记录的是稳定边界，不是当前所有实现细节。
- This is a draft skill template generated from the workflow schema in `vibe-coding-workflow.md`.
- Replace project variables with concrete project-specific values during skill generation.

## Project-Type Emphasis

- Emphasize script boundaries, generated artifact discipline, and host compatibility.
- Bias validation toward generator correctness, workflow closure, and documentation sync.
- Treat accidental interference with existing generation pipelines as a critical risk.
