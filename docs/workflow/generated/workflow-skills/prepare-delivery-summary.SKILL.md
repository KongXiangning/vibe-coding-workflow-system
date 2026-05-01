---
name: prepare-delivery-summary
preamble-tier: 2
version: 0.2.0
description: >
  Prepare a structured delivery summary that makes the completed work auditable
  and easy to hand off.
purpose: |
  整理本轮任务摘要，形成可交付、可复核的结果记录。
stage: 阶段 8：交付沉淀
trigger: |
  一轮任务完成后，准备收尾或交付时。
inputs:
  - current_task
  - verification_results
  - diff_stat
  - synced_state
reads:
  - docs/workflow/CURRENT_TASK.md
  - docs/workflow/STATUS.md
writes: []
forbidden_writes:
  - scripts
  - browse/src
  - design/src
  - test
  - browse/test
  - docs/workflow/STATUS.md
  - docs/workflow/CURRENT_TASK.md
must_check:
  - 任务目标完成情况
  - 修改文件清单
  - 是否越界
  - 验证结果
  - 发布后验证证据是否完整
  - 下一步建议
stop_conditions:
  - 关键验证仍未完成
  - release gate 未满足但试图交付为完成
  - 本轮结果仍存在未解释的高风险问题
output:
  - 交付摘要
handoff:
  success: archive-task
  failure: ask-user
decision_policy:
  mechanical: 可以自动整理结果、变更清单与验证摘要。
  taste: 不要用修辞掩盖风险。
  user_challenge: 不得把未完成事项写成已完成。
verification:
  - 摘要覆盖目标、修改、验证、风险、下一步
  - 摘要覆盖 release evidence、canary result、performance baseline result、rollback
    status 和 remaining observation
  - 摘要可被后来者直接消费
allowed-tools:
  - Read
  - Grep
  - Glob
  - Write
  - Edit
  - Bash
  - AskUserQuestion
benefits-from:
  - /capture-lessons
notes:
  - 如果以后要持久化摘要，可由生成器决定是否写文件。
summary_fields:
  - 任务目标
  - 完成情况
  - 实际修改文件
  - 是否越界修改
  - 是否触碰稳定契约
  - 验证结果
  - release evidence
  - canary result
  - performance baseline result
  - rollback status
  - remaining observation
  - 下一步建议
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

# Skill: prepare-delivery-summary

## Purpose

整理本轮任务摘要，形成可交付、可复核的结果记录。

## Trigger

一轮任务完成后，准备收尾或交付时。

## Inputs

- current_task
- verification_results
- diff_stat
- synced_state

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

- 任务目标完成情况
- 修改文件清单
- 是否越界
- 验证结果
- 发布后验证证据是否完整
- 下一步建议

## Stop Conditions

- 关键验证仍未完成
- release gate 未满足但试图交付为完成
- 本轮结果仍存在未解释的高风险问题

## Decision Policy

- `mechanical`: 可以自动整理结果、变更清单与验证摘要。
- `taste`: 不要用修辞掩盖风险。
- `user_challenge`: 不得把未完成事项写成已完成。

## Verification

- 摘要覆盖目标、修改、验证、风险、下一步
- 摘要覆盖 release evidence、canary result、performance baseline result、rollback status 和 remaining observation
- 摘要可被后来者直接消费

## Extension Fields

### summary_fields
- 任务目标
- 完成情况
- 实际修改文件
- 是否越界修改
- 是否触碰稳定契约
- 验证结果
- release evidence
- canary result
- performance baseline result
- rollback status
- remaining observation
- 下一步建议

### post_release_fields
- Release mode
- Deploy source
- Target environment
- Health checks
- Canary window
- Performance baseline
- Rollback / recovery
- Release evidence

## Release Delivery Evidence

发布 / 部署 / canary / benchmark 任务的交付摘要必须包含：

- Release mode
- Deploy source
- Target environment
- Health checks
- Canary window
- Performance baseline
- Rollback / recovery
- Release evidence
- canary result
- performance baseline result
- rollback status
- remaining observation

release gate 未满足时，不得把任务描述为完成；应输出 blocked risk 和后续动作。

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

- 如果以后要持久化摘要，可由生成器决定是否写文件。
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
