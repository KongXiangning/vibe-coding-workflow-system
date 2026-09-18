# D 实施证据与尚未验证的部分

D 初始实现基于 `b3d8410bd37db6a135783d10b6c3ef291cf119c5`，
提交为 `320704d3e3d2a956fff5663887e37fd00886e6e7`。

## 本轮审查修订

校准 prepare/review/support 的整体选择原则：检出力、全部必要义务和总体成本
共同决定最小充分集合。较窄 selector 不能撤销已绑定的用户/项目/发布义务；
合并调用须考虑批量 selector 和无关执行成本，并保留既有 breadth basis/source。
不增加 Runtime 字段、gate、状态或新的授权类型。

公开目录仅保留 `selection-patterns.json` 泛化说明，不再保存用户任务的原文、
项目路径、命令、来源指纹或审查原文。之前的公开摘录已从当前目录移除，
但没有改写历史；旧提交、其他 refs、缓存及副本仍可能保留它。没有把本次
泛化材料冒充原始事件证据，原业务 Rust 项目也没有在本轮重跑。

## 先前已执行的源码检出力校准（不是本轮新增效果结果）

D 初始实施使用同样的三个现有 metrics 回归对照旧/新生产源码：

```sh
bun test --timeout 60000 test/vnext-runtime.test.ts test/vnext-task-metrics.test.ts --test-name-pattern 'storage metrics review (invalidates samples when a real commit crosses the start or final sampling boundary|uses canonical Task Basis references without imposing blank-line spelling|normalizes missing legacy defaults before computing migration deltas)$'
```

| 源码 | 当时结果 | 含义 |
| --- | --- | --- |
| a37115d + 相同已选测试 | 0 PASS、3 FAIL | 三个对应业务断言检出原缺陷 |
| b3d8410 + 相同已选测试 | 3 PASS、0 FAIL | 真实事务、文件与编译后 Node CLI 的对应观察成立 |

记录对应 GitHub Actions run `35384635881`；这是知情实现者的历史检出力校准，
不是 fresh Agent 运行、不是新旧提示效果对照，也不是原业务 Rust 重跑。
本次只改 guidance 与公开材料，无须为文字修订重复该 Runtime 历史对照。

## 本轮可验证的范围

已有 P-12 source guard 覆盖整体必要性和合法宽执行措辞；一个 source-only
材料检查覆盖泛化格式与旧摘录移除。它们只验证分发源与公开材料的边界，
不运行语义选择器，也不宣称模型已理解。另核对实际包中的 Skill/support
与源码一致，评估答案目录不随目标项目安装。生成与 freshness 使用既有命令。

本轮本地实际命令：

```sh
bun test --timeout 60000 test/workflow-vnext-source.test.ts --test-name-pattern 'preserves P-12|keeps public selection examples|keeps execute-step focused|requires prepare-task to map'
bun run validate:vnext-source
bun run validate:vnext-runtime
bun run gen:all
bun run validate:freshness
bun run scripts/build-vibe-governance-distribution.ts --out <isolated-output>
```

4 PASS、0 FAIL（其中仅 1 个新增顶层 source-only 测试）；构建/契约、生成、
freshness 和四个 Skill/support 的包内字节核对通过。未跑全量测试，未执行
新的 Agent 效果评估。Runtime 源码、生成 Runtime、schema 和版本字节未变。


## 仍待独立效果验收

在有授权真实源码的新会话中保存 prepare-task 原始输出，再独立 review-draft。
同时观察局部检查、不适用测试、有依据宽回归和多观察合并，不能以文档齐全
或 source guard PASS 宣告达标。仍按约定统一升级目标项目后 dogfood；
不为每次正常任务增加盲测、双版本执行或文档 gate。
