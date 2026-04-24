# Vibe Coding Methodology

这个目录收纳 gstack 中面向大型 Vibe Coding 项目的方法论文档。它们是理解 workflow-system 设计取舍的背景材料，不是生成器的唯一规范源。

## 阅读顺序

1. [`vibe-coding-methodology.md`](./vibe-coding-methodology.md)
   - 总入口。解释为什么大型 AI 辅助开发需要边界、任务、状态和决策治理。
2. [`vibe-coding-workflow.md`](./vibe-coding-workflow.md)
   - 执行流程。把一次需求从进入、拆解、实现、复核到交付沉淀串起来。
3. [`vibe-coding-quality-system.md`](./vibe-coding-quality-system.md)
   - 质量体系。聚焦契约锁定、范围锁定、状态追踪、回归验证和失控诊断。

## 与正式规范的关系

这些文档解释治理思想和使用方式；正式字段、协议、模板和校验规则仍以仓库根目录下的规范源为准：

- [`WORKFLOW_PROTOCOL.md`](../WORKFLOW_PROTOCOL.md)
- [`FILE_SCHEMAS.md`](../FILE_SCHEMAS.md)
- [`PROJECT_PROFILE.yaml`](../PROJECT_PROFILE.yaml)
- [`templates/docs/`](../templates/docs/)
- [`templates/skills/`](../templates/skills/)

如果本文档和正式规范冲突，按正式规范和生成器实现执行。

## 维护边界

- 方法论文档可以描述原则、流程意图和人工判断标准。
- 不在这里维护字段结构、枚举值、错误码、模板章节或生成器行为。
- 涉及 workflow-system 的机器可执行规则时，先更新正式规范源，再让这些文档补充解释。
