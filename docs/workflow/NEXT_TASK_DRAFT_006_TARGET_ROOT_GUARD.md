# NEXT_TASK_DRAFT_006_TARGET_ROOT_GUARD.md

## 草案状态

- 用途：任务 006 候选任务包，供后续 `/create-current-task` 或 `/review-current-task` 复审。
- 当前状态：draft_for_review
- 不接管当前 `CURRENT_TASK.md`。
- 不代表任务 006 已开始实施。
- 本稿基于任务 `005` 已完成归档的前提，只继续推进 **target root guard / source-target root crossing 防护**。

## 任务信息

- 任务 ID：006
- 任务标题：实现 target root guard 与 source/target root crossing 防护
- 任务 slug：target-root-guard
- 建议初始 handoff：`create-current-task`

## 任务目标

在 source repo self-use / target-project isolation 已经稳定的前提下，为 workflow-system 增加一层 runtime fail-closed guard，阻止以下 crossing root 被错误当作 target root 使用：

1. `workflow:install --root .`
2. target root 是 source repo 的父目录或祖先目录
3. target root 与 source repo 共享或交叉 `.git` root，导致 source/target ownership 混淆

同时保持以下允许路径不被误伤：

- 合法外部 target root 的 `workflow:install`
- source repo 合法的 `workflow:sync --root . --host <host> --write`

## 范围收窄结论

任务 `006` 草案默认只处理以下范围：

1. runtime install-first target-root guard
2. target root 归一化 / crossing 判定 helper
3. runtime tests 与最小 target fixtures
4. guard 稳定后必要的治理 writeback

以下内容默认不并入任务 `006`：

- `.workflow-system/WORKFLOW_PROTOCOL.md` / `.workflow-system/FILE_SCHEMAS.md` 改动
- templates / generated reference outputs / `SKILL_REGISTRY.md` 改动
- lifecycle / ownership routing 继续扩面
- target-project validation slots、CI gate 或 deploy contract 变更
- 未经复审直接把 install-first 扩成所有 root 参数入口

## P0 前置原则

### 1. install-first，不默认扩大到所有入口

草案默认先守住 `workflow:install --root <target>` 的 crossing 风险。  
若后续代码阅读证明同一 shared helper 必须同时覆盖其他 target-root 入口，且不会破坏 source self-sync，才允许在正式任务包中申请 widening。

### 2. self-sync allow path 不能被误拦截

source repo 合法的：

- `workflow:sync --root . --host <host> --write`

必须继续保持允许。  
guard 的目标是防止 source repo 被误当作 **target install root**，不是阻止 source repo self-use。

### 3. crossing 判定必须基于规范化证据

draft 建议 guard 只依赖可审计证据：

- 规范化后的绝对路径
- 祖先 / 后代目录关系
- `.git` root 关系

不得只靠字符串前缀或 AI 记忆猜测。

### 4. error classification 不能私自扩协议

若 crossing guard 需要新的 protocol-level named error、schema 字段或 generator / template 配合，本任务必须停止并回 `/lock-scope`。  
草案默认优先复用现有 runtime error 承载方式。

### 5. fixture 必须隔离，不能把真实 source repo 当 target

测试 target 应放在：

- `.tmp/target-projects/**`
- `test/fixtures/target-projects/**`

不得把真实 source repo 本身当成可写 target fixture。

## 初步实现建议

### 1. runtime 入口

- 主入口：`scripts/workflow-runtime.ts`
- 候选 helper：`scripts/guard-target-root.ts`

建议把 crossing 判定集中成独立 helper，再由 install-first 入口消费，避免多个分支复制路径判断逻辑。

### 2. 判定模型

draft 建议至少覆盖以下拒绝分支：

- source root self-install
- source repo 父目录 / 祖先目录
- shared `.git` root crossing

建议至少覆盖以下允许分支：

- 外部隔离 target root
- source self-sync allow path

### 3. 测试面

建议最少覆盖：

- source root self-install 被拒绝
- parent-root / ancestor-root 被拒绝
- shared-git-root crossing 被拒绝
- isolated target 被允许
- self-sync allow path 不受影响

## 候选修改面

建议 Allowed Files 候选：

- `scripts/workflow-runtime.ts`
- `scripts/guard-target-root.ts`
- `test/workflow-runtime.test.ts`
- `test/guard-target-root.test.ts`
- `test/fixtures/target-projects/**`
- `docs/workflow/CURRENT_TASK.md`

建议 Conditional Files 候选：

- `docs/workflow/CONTRACTS.md`
- `docs/workflow/DECISIONS.md`
- `docs/workflow/STATUS.md`
- `docs/workflow/LESSONS.md`

建议 Forbidden Files 候选：

- `.workflow-system/WORKFLOW_PROTOCOL.md`
- `.workflow-system/FILE_SCHEMAS.md`
- `templates/**`
- `docs/workflow/generated/**`
- `docs/workflow/SKILL_REGISTRY.md`
- `vibe-coding/**`

## 初步验收建议

- crossing target root 会 fail-closed
- source self-sync allow path 不回归
- 路径归一化覆盖 Windows 路径差异
- runtime tests 能证明拒绝 / 允许路径
- 不引入新的 protocol/schema/generated 变更

## 风险与暂停条件

- 风险 1：路径归一化不完整，Windows 下误判或漏判
- 风险 2：guard 接入点过宽，误拦截 source self-sync
- 风险 3：shared `.git` root 识别不足，仍留下 crossing 漏洞
- 风险 4：为了错误分类而顺手扩大到协议层

以下情况应暂停并回 `/lock-scope`：

- 需要新增 protocol-level named error
- 需要改 `.workflow-system/WORKFLOW_PROTOCOL.md` / `.workflow-system/FILE_SCHEMAS.md`
- 需要改 templates / generated outputs / registry
- 需要把 install-first 扩成更大 runtime contract

## 建议下一步

1. 用 `/review-current-task` 或 `/create-current-task` 正式消费本草案。
2. 在 live task 中锁定 install-first 范围、error classification 边界与回滚点。
3. 再进入 `/lock-scope` 和后续实现链。
