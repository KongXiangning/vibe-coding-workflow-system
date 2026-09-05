/**
 * Canonical STATUS.md section schema shared by Bootstrap producers and the
 * Runtime project-status consumer.
 */

export const STATUS_SECTIONS = {
  overview: { title: '项目概览' },
  completed: { title: '✅ 已完成且稳定' },
  inProgress: { title: '🔨 正在开发' },
  pending: { title: '📋 待开发' },
  risks: { title: '⚠️ 已知风险 / 观察点' },
  removedOrDeferred: { title: '❌ 已移除 / 推迟' },
  nextCheckpoint: { title: '🔜 下一检查点' },
  recentUpdates: { title: '最近更新记录', aliases: ['最近更新记录', 'Recent Updates'] },
} as const;

export type StatusSectionKey = keyof typeof STATUS_SECTIONS;

export const STATUS_SECTION_KEYS = [
  'overview',
  'completed',
  'inProgress',
  'pending',
  'risks',
  'removedOrDeferred',
  'nextCheckpoint',
  'recentUpdates',
] as const satisfies readonly StatusSectionKey[];

export const STATUS_REQUIRED_SECTION_TITLES: readonly string[] = Object.freeze(
  STATUS_SECTION_KEYS.map((key) => STATUS_SECTIONS[key].title),
);
