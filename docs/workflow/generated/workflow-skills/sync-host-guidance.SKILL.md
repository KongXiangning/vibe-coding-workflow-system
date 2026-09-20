---
name: sync-host-guidance
preamble-tier: 2
version: 0.1.0
description: |
  Sync AGENTS.md with the confirmed workflow rules and project-wide guidance.
purpose: |
  同步 AGENTS.md，确保 Codex 侧读取已确认的项目级协作约束、命令入口和 workflow 指引。
stage: 阶段 7：状态同步
trigger: |
  项目级协作约束、统一命令入口、宿主说明或 workflow 指引发生变化时。
inputs:
  - host_guidance_files
  - project_profile
  - current_task
  - confirmed_global_constraints
  - synced_governance_docs
reads:
  - .workflow-system/PROJECT_PROFILE.yaml
  - AGENTS.md
  - docs/workflow/CURRENT_TASK.md
  - docs/workflow/CONTRACTS.md
  - docs/workflow/DECISIONS.md
  - docs/workflow/STATUS.md
  - docs/workflow/BASELINES.md
writes:
  - AGENTS.md
forbidden_writes:
  - scripts
  - test
must_check:
  - 是否存在项目级宿主指引变化；没有则输出 no-op 并继续 handoff
  - 哪些变化属于项目级长期规则，而不是本轮任务临时说明
  - AGENTS.md 是否与已确认治理文档保持同一治理基线
  - 统一命令入口、验证方式、禁区和 workflow 使用顺序是否与已确认治理文档一致
  - 是否需要把新的宿主说明、AI 协作约束或禁止事项同步到 AGENTS.md
stop_conditions:
  - 全局约束尚未确认
  - 当前变化仍是任务级临时说明
  - AGENTS.md 与其他治理文档冲突且无法判定真值
output:
  - 更新后的 AGENTS.md
  - 无宿主指引变化时的 no-op 结论
handoff:
  success: capture-lessons
  failure: ask-user
decision_policy:
  mechanical: 可以同步两个宿主文件中的公共 workflow 指引、统一命令和结构。
  taste: 保留项目既有语气，不要把宿主说明改成模板腔。
  user_challenge: 不得把未确认的任务级临时约定升级成项目级全局规则。
verification:
  - AGENTS.md 对项目级规则的描述与已确认治理文档一致；无宿主指引变化时已 no-op
  - 命令、路径和 workflow 入口与已确认治理文档一致
allowed-tools:
  - Read
  - Write
  - Edit
  - AskUserQuestion
benefits-from:
  - /sync-status
  - /sync-contracts
  - /sync-decisions
notes:
  - 这是持续同步宿主指引的 skill，不替代初始化阶段的 scaffold / bootstrap。
  - 如果 AGENTS.md 缺失，应根据已确认治理文档补回。已有 CLAUDE.md 属于目标项目自有文件，保持原样，不补写、不同步。
sync_rules:
  - 项目级 workflow 规则变化后同步
  - 没有项目级宿主指引变化时输出 no-op 并继续交给 capture-lessons
  - 已有 CLAUDE.md 不属于本 skill 的写入范围
host_guidance_categories:
  - workflow bootstrap / task flow
  - project-wide command entrypoints
  - AI collaboration constraints and forbidden zones
  - deploy / release / verification guidance when confirmed
---

# Skill: sync-host-guidance

## Purpose

同步 AGENTS.md，确保 Codex 侧读取已确认的项目级协作约束、命令入口和 workflow 指引。

## Trigger

项目级协作约束、统一命令入口、宿主说明或 workflow 指引发生变化时。

## Inputs

- host_guidance_files
- project_profile
- current_task
- confirmed_global_constraints
- synced_governance_docs

## Project Variables

### core
- vibe-coding-workflow-system
- ai-engineering-workflow
- TypeScript, Markdown

### structure
- scripts, test
- .git/**, node_modules/**, dist/**
- Keep workflow-system automation and generators in scripts/., Treat templates/skills/ as workflow skill template sources, not runtime outputs., Treat templates/docs/ as workflow governance doc template sources., Do not hand-edit generated reference outputs under docs/workflow/generated/** or docs/workflow/SKILL_REGISTRY.md., Keep gstack references as methodology or historical comparison material unless a task explicitly targets gstack integration., Prefer Bun/TypeScript for generation, validation, packaging, and runtime sync tooling.

### execution
- bun run test:workflow-all, bun run validate:protocol, bun run validate:freshness
- mechanical, taste, user_challenge

## Required Reads

1. Read every file listed in frontmatter `reads` before making any decision.
2. If a required file is missing, follow `handoff.failure` instead of guessing.
3. Treat `.workflow-system/PROJECT_PROFILE.yaml` plus the already-synced governance docs as the source of truth for project-wide host guidance.

## Must Check

- 是否存在项目级宿主指引变化；没有则输出 no-op 并继续 handoff
- 哪些变化属于项目级长期规则，而不是本轮任务临时说明
- AGENTS.md 是否与已确认治理文档保持同一治理基线
- 统一命令入口、验证方式、禁区和 workflow 使用顺序是否与已确认治理文档一致
- 是否需要把新的宿主说明、AI 协作约束或禁止事项同步到 AGENTS.md

## Stop Conditions

- 全局约束尚未确认
- 当前变化仍是任务级临时说明
- AGENTS.md 与其他治理文档冲突且无法判定真值

## Decision Policy

- `mechanical`: 可以同步两个宿主文件中的公共 workflow 指引、统一命令和结构。
- `taste`: 保留项目既有语气，不要把宿主说明改成模板腔。
- `user_challenge`: 不得把未确认的任务级临时约定升级成项目级全局规则。

## Verification

- AGENTS.md 对项目级规则的描述与已确认治理文档一致；无宿主指引变化时已 no-op
- 命令、路径和 workflow 入口与已确认治理文档一致

## Extension Fields

### sync_rules
- 项目级 workflow 规则变化后同步
- 没有项目级宿主指引变化时输出 no-op 并继续交给 capture-lessons
- 已有 CLAUDE.md 不属于本 skill 的写入范围

### host_guidance_categories
- workflow bootstrap / task flow
- project-wide command entrypoints
- AI collaboration constraints and forbidden zones
- deploy / release / verification guidance when confirmed

## Execution Protocol

1. 先读取 `.workflow-system/PROJECT_PROFILE.yaml`、`docs/workflow/CURRENT_TASK.md`、`docs/workflow/CONTRACTS.md`、`docs/workflow/DECISIONS.md`、`docs/workflow/STATUS.md`、`docs/workflow/BASELINES.md`，再读取现有 `AGENTS.md`。
2. 只同步**项目级长期规则**：workflow 入口、统一命令、禁区、验证入口、宿主协作方式。不要把本轮任务临时说明、一次性 workaround 或未确认猜测写入宿主指引。
3. 只更新 `AGENTS.md`。如果存在 `CLAUDE.md`，将其视为目标项目自有的历史宿主指引，不读取、不覆盖、不删除，也不要求与 AGENTS.md 同步。
4. 如果 `AGENTS.md` 缺失，按已确认治理文档补回；不要因为 `CLAUDE.md` 是否存在而改变写入范围。
5. 如果发现 AGENTS.md 与已确认治理文档冲突，先列出冲突事实并按 `handoff.failure` 停下，不要擅自选择一个版本覆盖另一个。
6. 不修改业务代码，不重写项目战略，不把任务级实现细节升级成项目级长期约束。

## Hard Boundaries

- 不修改 `scripts, test`。
- 不把 `docs/workflow/CURRENT_TASK.md` 中的临时执行说明直接复制成长期宿主规则。
- 不写入、删除或重写已有的 `CLAUDE.md`。
- 不得静默改变项目级 AI 协作约束、验证入口或禁止事项的含义。

## Handoff

- 成功：`capture-lessons`
- 失败：`ask-user`

## Reference Render Semantics

- This generated file is a source-repo reference render produced from the current `.workflow-system/PROJECT_PROFILE.yaml`.
- The concrete project values shown here reflect this repository's profile, not a universal target-project default.
- Target projects render workflow skills from their own `.workflow-system/PROJECT_PROFILE.yaml` during install / sync.

## Project-Type Emphasis

- Emphasize script boundaries, generated artifact discipline, and host compatibility.
- Bias validation toward generator correctness, workflow closure, and documentation sync.
- Treat accidental interference with existing generation pipelines as a critical risk.
