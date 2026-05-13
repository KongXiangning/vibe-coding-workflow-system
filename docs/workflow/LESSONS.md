# docs/workflow/LESSONS.md

## 使用规则

- 只记录跨任务可复用的经验
- 每条经验都要说明触发信号和应对动作
- 不要把一次性聊天过程原样粘贴到这里

## 通用

### Lesson 模板

- 场景：
- 结论：
- 触发信号：
- 应对动作：

### Workflow rule changes must close the propagation chain

- 场景：修改核心 workflow skill 行为时，规则会同时影响模板、generated reference outputs、测试断言、契约、决策和宿主指引。
- 结论：只改模板不足以完成稳定规则变更；必须沿 `templates -> generated reference -> tests/freshness -> contracts/decisions -> host guidance` 链条确认是否需要同步。
- 触发信号：某条规则被写入多个核心 skill，或被提升为 `CONTRACTS.md` / `DECISIONS.md` 中的长期边界。
- 应对动作：先完成模板和生成验证，再判断是否同步 `CONTRACTS.md`、`DECISIONS.md`、`AGENTS.md`、`CLAUDE.md`；只同步已确认的长期规则，不复制任务级临时说明。

### Live governance docs need explicit scope widening

- 场景：任务执行中需要更新 `STATUS.md`、`LESSONS.md` 等 live governance docs，但初始范围只允许代码或模板。
- 结论：live governance docs 虽然属于 `docs/workflow/*.md`，仍需要在当前任务中明确允许范围、风险和验证方式，避免治理状态和任务事实漂移。
- 触发信号：`STATUS.md` 与 `CURRENT_TASK.md` 对步骤、风险或下一检查点描述不一致；required read 的治理文档缺失或只有占位结构。
- 应对动作：回到范围锁定或记录范围扩大原因，再做最小同步；确认 live governance docs 不承载产品、方法论、操作手册或一次性聊天内容。

## 数据与存储

- 场景：
  - 结论：
  - 触发信号：
  - 应对动作：

## 前端与交互

- 场景：
  - 结论：
  - 触发信号：
  - 应对动作：

## 后端与服务

- 场景：
  - 结论：
  - 触发信号：
  - 应对动作：

## 测试与回归

- 场景：
  - 结论：
  - 触发信号：
  - 应对动作：

### Template changes require freshness closure after generated outputs move

- 场景：修改 `templates/skills/*.SKILL.md.tmpl` 后，测试或生成器可能派生更新 `docs/workflow/generated/workflow-skills/**`。
- 结论：局部 dry-run 通过不等于生成链已闭合；最终必须用 freshness 和完整 workflow tests 证明 generated outputs 与模板一致。
- 触发信号：`validate:freshness` 报 stale，或 `git status` 出现目标 generated workflow skill 变更。
- 应对动作：只通过生成器同步 generated reference outputs；随后运行 `bun run gen:workflow-skills --dry-run`、`bun run gen:registry --dry-run`、`bun run test:workflow-skills`、`bun run validate:protocol`、`bun run validate:freshness`。任务级收尾前再跑 `bun run test:workflow-all` 和 `bun run workflow:health --root .`。

## 部署与运行时

- 场景：
  - 结论：
  - 触发信号：
  - 应对动作：
