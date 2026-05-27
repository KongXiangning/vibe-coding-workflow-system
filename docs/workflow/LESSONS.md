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

### Contract foundation tasks must not drift into runtime delivery

- 场景：任务只要求稳定协议、schema、模板、resolver 和 validator，但相关概念天然指向后续 runtime skill、routing、registry 或 guide 改造。
- 结论：contract foundation 与 runtime delivery 必须拆开；第一阶段只能固化状态、路径、ownership、校验和恢复输入契约，不顺手实现 host workflow 行为。
- 触发信号：实现方案开始出现 `templates/skills/**`、`WORKFLOW_GUIDE` routing、`SKILL_REGISTRY`、runtime manifest / install / health report、inbox / backlog artifact 等范围外文件或概念。
- 应对动作：先把这些项写入 Forbidden / Deferred / Rejected 决策；如确实需要实现，停止当前任务并重新 `/lock-scope` 或拆后续任务。

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

### Runtime root-isolation tests should inject sourceRoot and prefer temp roots

- 场景：`workflow:install` 的 source/target root 隔离测试既要覆盖 source self-install、ancestor root、shared `.git` crossing，又要避免把 CI / monorepo 目录布局当成测试前提。
- 结论：当 runtime 逻辑依赖 source root 与 target root 的关系时，测试入口最好允许注入 `sourceRoot`，并优先用 `withTempRoot()` 构造 ancestor / shared-`.git` 场景；只有验证 source repo self-use allow path 时，才回到真实 `ROOT` 做 dry-run smoke。
- 触发信号：测试开始依赖 `path.dirname(ROOT)`、真实工作区父目录、宿主机 `.git` 布局，或为 shared `.git` 场景准备引入固定 fixture。
- 应对动作：给 install 入口保留可注入 `sourceRoot` 的测试钩子；用临时目录构造 `.git` directory / file、ancestor root 和 isolated target；source repo self-sync 只做 `syncWorkflowHost({ root: ROOT, host, write: false })` 之类的无副作用 smoke。

### Template changes require freshness closure after generated outputs move

- 场景：修改 `templates/skills/*.SKILL.md.tmpl` 后，测试或生成器可能派生更新 `docs/workflow/generated/workflow-skills/**`。
- 结论：局部 dry-run 通过不等于生成链已闭合；最终必须用 freshness 和完整 workflow tests 证明 generated outputs 与模板一致。
- 触发信号：`validate:freshness` 报 stale，或 `git status` 出现目标 generated workflow skill 变更。
- 应对动作：只通过生成器同步 generated reference outputs；随后运行 `bun run gen:workflow-skills --dry-run`、`bun run gen:registry --dry-run`、`bun run test:workflow-skills`、`bun run validate:protocol`、`bun run validate:freshness`。任务级收尾前再跑 `bun run test:workflow-all` 和 `bun run workflow:health --root .`。

### Single-file generated reference sync needs explicit diff proof

- 场景：模板变更只应影响一个 generated reference file，例如 `templates/docs/CURRENT_TASK.md.tmpl` 新增字段后同步 `docs/workflow/generated/workflow-docs/CURRENT_TASK.md`。
- 结论：允许单一 Conditional File 不等于允许一般 generated maintenance；必须证明生成器只同步预期文件和预期字段。
- 触发信号：`validate:freshness` 只报告一个 generated doc stale，或 `gen:all` 后 `git diff --name-only -- docs/workflow/generated docs/workflow/SKILL_REGISTRY.md` 出现额外文件。
- 应对动作：先运行对应生成器，再检查 generated / registry diff 范围；若只命中单一 Conditional File，继续聚焦测试和 full regression；若出现其他 generated / registry diff，停止并回到 `/lock-scope`。

### Branch-style registry summaries must still match full stage membership

- 场景：给 `SKILL_REGISTRY` 的某个 stage summary 增加 branch-style 特判时，容易只盯新增技能，而漏掉该 stage 已存在的历史成员。
- 结论：summary 特判必须和 stage 的完整成员集合一起校验，不能只断言新增 branch 片段。
- 触发信号：`scripts/gen-registry.ts` 对某个 `stage` 写了专门 summary 文案，或 `test/gen-registry.test.ts` 开始为该 stage 写顺序断言。
- 应对动作：同时断言 `parseRegistryRows(...).filter(stage === ...)` 的完整顺序和 summary 行文本；若发现遗漏，优先修 generator summary，使其反映真实 stage membership，而不是削弱顺序断言。

### Owner-sensitive workflow routing must separate ownership from handoff

- 场景：当前 active task 在 root-cause、regression 或 review-finding 阶段遇到旧任务遗留 blocker，既要判断问题归属，又要决定是否允许恢复旧任务。
- 结论：owner route 和下一步 handoff 必须分开表达；canonical route 只回答“归谁”，guard-aware alias 才回答“下一步怎么做”。如果 matching suspended package evidence 缺失、owner 不唯一，或 active-owner guard 未通过，必须 fail-closed 到 `ask-user`、`lock-scope`、`create-current-task` 或 `blocked / evidence gap`。
- 触发信号：技能开始出现 `resume_*_required -> resume-*` 一跳 handoff、试图仅凭 package presence 推断 owner，或把旧任务遗留问题直接塞进当前审查问题队列。
- 应对动作：先读取 matching suspended package evidence，再输出 canonical route；把恢复链改成 `resume_*_guard_passed` / `resume_*_guard_blocked`；只允许 `current_task_owned` 且当前范围内可修的 mechanical finding 进入当前队列，`report-only` 只报告 route 不自动执行 handoff。

## 部署与运行时

- 场景：
  - 结论：
  - 触发信号：
  - 应对动作：

### Fail-closed install guards must stop before other preflight planners

- 场景：在 `installWorkflowBundle()` 这类累积 `failures[]` 的 preflight 链中新增 target-root guard 时，如果 deny 之后继续执行 replace-managed / package / profile / bootstrap 规划，会把无关 failure 混进同一份报告。
- 结论：source/target root crossing 这类 fail-closed guard 必须在 bundle integrity 之后、其他 install 规划之前短路返回；否则 source repo self-install 之类非法目标会伪造出 `local_drift`、planned writes 或其他噪音，掩盖真正根因。
- 触发信号：同一次非法 install 报告里同时出现 `incompatible_target` 和不相关的 drift / frozen failure，或 deny 场景下仍然生成了 `planned_writes`。
- 应对动作：把 guard 放在 root / bundle 解析完成后的最早安全落点；deny 分支只返回单一、可追踪的 failure，并用 integration tests 断言 self-install、ancestor root、shared `.git` crossing 场景都不会继续生成 install plan。
