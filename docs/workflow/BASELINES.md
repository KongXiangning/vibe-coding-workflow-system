# docs/workflow/BASELINES.md

## 使用规则

- 本文件定义发布、兼容性、安全、部署和非功能要求的最低基线。
- 基线是可版本化约束，不是一次性检查清单。
- 基线变化时追加新记录并标注生效版本 / 窗口，不直接抹掉旧约束。
- 本仓库作为 source repo 时，quality gates 与 target-project validation slots 必须分离。

## 版本治理概览

- 当前版本：0.14.5
- 项目：vibe-coding-workflow-system
- 项目类型：ai-engineering-workflow
- 主要技术栈：TypeScript, Markdown
- 关联验证入口：`bun run validate:protocol`, `bun run validate:freshness`, `bun run test:workflow-all`, `bun run workflow:health --root .`

## 发布基线

### REL-001: Source repo release readiness

- 状态：active
- 生效版本 / 窗口：0.14.x self-adoption baseline
- 发布前必须满足：
  - `bun run gen:all`
  - `bun run validate:protocol`
  - `bun run validate:freshness`
  - `bun run test:workflow-all`
  - `bun run workflow:health --root .`
- 阻塞级别：blocks-merge
- 证据 / 验证入口：命令输出、CI 或人工验证记录
- release readiness gate：protocol and freshness must pass before pack/install guidance is updated
- 例外处理：例外必须记录到 `docs/workflow/DECISIONS.md`

## 兼容性基线

### COMP-001: Source / target root separation

- 状态：active
- 生效版本 / 范围：0.14.x self-adoption baseline
- 兼容对象：`workflow:install`, `workflow:sync`, external target roots, source repo root
- 不可破坏项：
  - source repo root 不得作为 `workflow:install --root` target
  - target project 必须使用独立 root
  - test target 必须位于 `.tmp/target-projects/**` 或最小化 `test/fixtures/target-projects/**`
  - source repo self-use 只能使用 `workflow:sync --root . --host <host> --write`
- 验证入口 / 观察指标：manual command review now; future guard tests if implemented
- 升级 / 迁移说明：如需 source-repo repair/import 等价流程，先新增协议和 runtime 语义

## 安全基线

### SEC-001: Generated artifact mutation guard

- 状态：active
- 生效版本 / 范围：0.14.x self-adoption baseline
- 最低要求：不得手改 generated reference outputs
- 禁止项：
  - hand-edit `docs/workflow/generated/**`
  - hand-edit `docs/workflow/SKILL_REGISTRY.md`
  - use target-project facts to overwrite source repo `.workflow-system/PROJECT_PROFILE.yaml`
- 验证入口 / 审查方式：`bun run validate:freshness`, `git diff`, code review
- 例外审批：无直接例外；必须修改模板/协议/生成器后重新生成

## 部署基线

### DEP-001: Bundle install separation

- 状态：active
- 生效版本 / 环境：source repo pack/install workflow
- 部署前检查：
  - external target root has been explicitly selected
  - dry-run install report reviewed
  - drift repair flags used only after confirming managed drift scope
- 发布步骤 / 回滚要求：
  - pack in source repo
  - install into external target root
  - bootstrap/adoption in target host
  - render/sync from source repo against target root
- health endpoint：not-applicable
- production URL：not-applicable
- deploy status source：`workflow:health --root <target>` and install/sync reports
- 观测与告警：manual report or CI if configured
- canary window：not-applicable
- 失败后的默认动作：stop; inspect failure category; do not delete and reinstall target governance files blindly

## 性能与可靠性基线

### NFR-001: Generator and runtime reliability

- 状态：active
- 生效版本 / 范围：source repo generator/runtime changes
- 指标：generation completes, freshness passes, runtime health passes
- 目标阈值：all listed source repo checks pass
- performance regression threshold：not defined
- baseline source：`package.json`, `.workflow-system/PROJECT_PROFILE.yaml`
- 观测周期：before merge / before publishing updated bundle guidance
- 验证入口：`bun run test:workflow-all`, `bun run workflow:health --root .`
- 例外处理：record explicit blocked reason in `STATUS.md` / `CURRENT_TASK.md`

## Gate 与错误码基线

### GATE-001: Source repo quality gates

- 状态：active
- 生效版本 / 范围：source repo self-adoption baseline
- blocker level：blocks-merge
- 适用错误码：not-applicable for current source repo commands
- merge gate：`validate:protocol`, `validate:freshness`, `test:workflow-all`
- ship gate：`workflow:health --root .`, plus pack/install smoke when release requires it
- 升级条件：protocol/freshness/test/runtime failures
- 相关 strategy_origin / branch 语义：source-repo-specific, not target-project slots
- 兼容窗口 / removal precondition：cannot remove until replacement source-repo gate is documented
- 证据归档位置：`CURRENT_TASK.md` or task archive after task flow starts

### GATE-002: Target-project validation slots

- 状态：active
- 生效版本 / 范围：external target project Adoption A4
- blocker level：blocks-merge default slot
- 适用错误码：not-applicable
- merge gate：target project bound command
- ship gate：target project bound command if release-critical
- 升级条件：target project binds performance/reliability/security/deploy slots
- 相关 strategy_origin / branch 语义：target-project-owned
- 兼容窗口 / removal precondition：do not bind these slots for source repo quality gates
- 证据归档位置：target project `docs/workflow/**`

### GATE-003: Source / target isolation guard

- 状态：candidate
- 生效版本 / 范围：future runtime hardening
- blocker level：blocks-merge
- 适用错误码：future `SOURCE_TARGET_ROOT_CONFLICT` or equivalent if protocol adds it
- merge gate：guard tests pass
- ship gate：pack/install contract tests pass
- 升级条件：target root equals source root, source parent, or crosses current source repo `.git`
- 相关 strategy_origin / branch 语义：prevent ownership collision
- 兼容窗口 / removal precondition：not applicable until implemented
- 证据归档位置：future tests and runtime report

## 基线变更记录

- 2026-05-07：建立 source repo self-adoption 首版 baseline。
