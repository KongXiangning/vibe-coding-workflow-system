export const WORKFLOW_DOC_NAMES = [
  'CONTRACTS.md',
  'CURRENT_TASK.md',
  'DECISIONS.md',
  'LESSONS.md',
  'STATUS.md',
  'TASK_ARCHIVE.md',
  'TASK_SUMMARY.md',
] as const;

export type WorkflowDocName = (typeof WORKFLOW_DOC_NAMES)[number];

export const WORKFLOW_DOC_SET = new Set<WorkflowDocName>(WORKFLOW_DOC_NAMES);

export const WORKFLOW_DOC_REQUIRED_HEADINGS: Record<WorkflowDocName, readonly string[]> = {
  'CONTRACTS.md': ['## 使用规则', '## 一、接口契约', '## 二、架构契约', '## 三、变更规则'],
  'CURRENT_TASK.md': [
    '## 任务信息',
    '## 背景与上下文',
    '## 验收标准',
    '## 允许修改范围',
    '## 禁止修改范围',
    '## 受影响的契约',
    '## 已确认决策',
    '## 待确认问题',
    '## 实施步骤',
    '## 回归检查项',
    '## 回滚点',
    '## 执行记录',
  ],
  'DECISIONS.md': ['## 使用规则', '## 🏗️ 架构决策', '## 🎨 口味决策', '## ⏸️ 暂缓决策', '## ❌ 已否决'],
  'LESSONS.md': [
    '## 使用规则',
    '## 通用',
    '## 数据与存储',
    '## 前端与交互',
    '## 后端与服务',
    '## 测试与回归',
    '## 部署与运行时',
  ],
  'STATUS.md': [
    '## 项目概览',
    '## ✅ 已完成且稳定',
    '## 🔨 正在开发',
    '## 📋 待开发',
    '## ⚠️ 已知风险 / 观察点',
    '## ❌ 已移除 / 推迟',
    '## 🔜 下一检查点',
    '## 最近更新记录',
  ],
  'TASK_ARCHIVE.md': [
    '## 任务元数据',
    '## 原始任务包快照',
    '## 实际改动摘要',
    '## 契约与决策记录',
    '## 验证与交付证据',
    '## Lessons 回写',
    '## 后续关联',
  ],
  'TASK_SUMMARY.md': [
    '## 任务信息',
    '## 目标与结果',
    '## 改动范围',
    '## 契约与决策变化',
    '## 验证结果',
    '## 风险与后续',
    '## 交付清单',
  ],
};

export const WORKFLOW_DOC_RUNTIME_PLACEHOLDERS = new Set([
  '{{TASK_ID}}',
  '{{TASK_TITLE}}',
  '{{TASK_SLUG}}',
  '{{DATE}}',
  '{{AUTHOR}}',
]);

export type MarkdownHeading = {
  level: number;
  text: string;
};

export function isWorkflowDocName(value: string): value is WorkflowDocName {
  return WORKFLOW_DOC_SET.has(value as WorkflowDocName);
}

export function parseMarkdownHeadings(content: string): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  const pattern = /^(#{1,6})\s+(.+?)\s*$/gm;
  let match: RegExpExecArray | null = null;

  while ((match = pattern.exec(content)) !== null) {
    headings.push({
      level: match[1].length,
      text: match[2].trim(),
    });
  }

  return headings;
}

export function headingsEqual(left: MarkdownHeading[], right: MarkdownHeading[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every(
    (heading, index) => heading.level === right[index]?.level && heading.text === right[index]?.text,
  );
}
