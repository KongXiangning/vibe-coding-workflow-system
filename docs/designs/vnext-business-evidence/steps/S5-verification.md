# S5：完整验证、分发边界和真实业务dogfood

建议：GPT-6 Astra medium执行；需要独立总审查时另开xhigh或其他reviewer会话。前置：S1-S4完成且没有未收敛的阻断finding。

## 阅读范围

CONTEXT/HANDOFF；PLAN §7-12及验收矩阵。先读真实变更清单与对应接口，不全量重读所有历史设计。核对package.json和S0记录的分发/安装边界。

## 任务

1. 汇总V1-V14：哪些是已有回归、哪些有本次证据、哪些仍缺失。不得为凑行数逐项新增测试；修复仅限本轮明确缺口。
2. 核对共享校验：prepare/execute/review/complete/close、raw proposal及支持的旧格式路径不能互相绕过。没有Provider时caller-reported局限要在正常结果和文档中显示，不被UI摘要洗掉。
3. 按已有生成器更新生成物；检查版本、协议schema、源码模板、安装Runtime与技能输出一致。对已安装active任务遵守S0兼容决定，不自动升级/重置真实业务目录。
4. 运行实际存在且已准入的相关生成/验证/聚合测试与git diff --check，记录命令、版本、结果，不照抄用户历史通过清单。
5. 定位并使用已有FixFlow或等价已授权隔离业务实例。真实执行需求边界内的提交→持久化→重新读取；若任务包含页面则从页面走。环境缺失明确blocked，不以mock测试通过替代。
6. 以同一小型场景验证“规则已通过但流程missing/failed，不能完成”，再获得合法流程结果后完成。还要验证临时环境故障重试路径；不修改真实用户数据。
7. 汇总新增/修改测试是否都有P-12依据，是否出现同一文件无必要case增长；语义检查读断言而不是只数pass。
8. 输出最终状态、变更范围、兼容决策、剩余风险和后续Provider/AST候选。没有实际运行或环境blocked的场景不能标clean。

## 完成标准

完整结果是“业务证据治理闭环（caller-reported assurance）”，不是“Runtime独立证明所有测试真实执行”。若真实dogfood不具备条件，允许交付已完成代码及确切阻塞，但总体状态保留dogfood-blocked。

不擅自发布npm、不自动commit/push、不升级无关依赖。更新HANDOFF后停止，交给独立总审查。

## 本次调用共同边界

先读本包CONTEXT.md、HANDOFF.md和作用域内现有AGENTS/CLAUDE，再按下面的最小源码范围核对。历史提交只是参考，实际以S0记录的工作区为准。若前置步骤未完成，指出精确缺口，不自行跨步补做。

只实施本步骤；不自动开始下一步骤或调用另一个public Skill。遵守仓库既有任务确认和Runtime渠道，不手改CURRENT_TASK来解锁。保持既有未提交、未跟踪和已暂存改动，不reset/clean/stash/全量restore，不自动commit/push。

本文列的是候选文件，不是目录任意写授权；先确定实际精确文件和生成物footprint。新增必要同级小模块须说明为何现有模块不足并沿用已有scope admission，不能为了模块美观扩建平台。

对真正改变的共享行为运行已有focused checks；必要时复用/修改已有回归。新持久测试逐组说明保护的控制义务，不为每个字段造测试。不做shadow evaluator，不只检查文案关键词。

结束时给出实现行为、准确文件、真实命令/结果、未完成/blocked、assurance边界；在已准入范围内更新HANDOFF，只写实际事实。不能把自检叫作独立review。
