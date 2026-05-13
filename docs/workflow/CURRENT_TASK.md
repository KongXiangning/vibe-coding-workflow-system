# CURRENT_TASK.md

## 当前状态

- 当前没有活跃任务。
- 上一任务已归档：`TASKS/TASK-001-ctx7-skill-gate.md`
- 上一任务 ID：001
- 上一任务 slug：ctx7-skill-gate
- 上一任务最终状态：done / regression-passed
- 归档时间：2026-05-13

## 下一轮入口

- 下一步 handoff：`create-current-task`
- 新任务开始前，根据新的用户需求重新生成任务包。
- 不要从上一任务归档文件推断新任务范围；新任务必须重新声明目标、验收标准、允许修改范围、禁止修改范围、验证策略和回滚点。

## 保留观察点

- 如要实现 target root guard，先开独立任务并锁定 `scripts/**`、`test/**`、协议和基线影响范围。
- source repo 仍禁止执行 `workflow:install --root .`。
- generated reference outputs 继续只由生成器维护，不手工编辑。
