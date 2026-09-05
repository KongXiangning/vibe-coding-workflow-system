/**
 * Canonical STATUS.md section schema shared by Bootstrap producers and the
 * Runtime project-status consumer.
 */

/**
 * The sole ordered declaration for the canonical STATUS projection.
 *
 * All public STATUS projections below are derived from this tuple so adding,
 * removing, or renaming a section cannot silently leave another key list stale.
 */
export const STATUS_SCHEMA = [
  { key: 'overview', title: '项目概览' },
  { key: 'completed', title: '✅ 已完成且稳定' },
  { key: 'inProgress', title: '🔨 正在开发' },
  { key: 'pending', title: '📋 待开发' },
  { key: 'risks', title: '⚠️ 已知风险 / 观察点' },
  { key: 'removedOrDeferred', title: '❌ 已移除 / 推迟' },
  { key: 'nextCheckpoint', title: '🔜 下一检查点' },
  { key: 'recentUpdates', title: '最近更新记录', aliases: ['最近更新记录', 'Recent Updates'] },
] as const;

type StatusSchemaEntry = (typeof STATUS_SCHEMA)[number];

export type StatusSectionKey = StatusSchemaEntry['key'];

type StatusSectionKeys<T extends readonly { key: string }[]> = {
  [Index in keyof T]: T[Index] extends { key: infer Key extends string } ? Key : never;
};

function deriveStatusSectionKeys<T extends readonly { key: string }[]>(
  schema: T,
): StatusSectionKeys<T> {
  return schema.map((section) => section.key) as StatusSectionKeys<T>;
}

export const STATUS_SECTION_KEYS = deriveStatusSectionKeys(STATUS_SCHEMA);

type StatusSectionRecord = {
  [Entry in StatusSchemaEntry as Entry['key']]: Omit<Entry, 'key'>;
};

export const STATUS_SECTIONS: StatusSectionRecord = Object.fromEntries(
  STATUS_SCHEMA.map(({ key, ...section }) => [key, section]),
) as StatusSectionRecord;

export const STATUS_REQUIRED_SECTION_TITLES: readonly string[] = Object.freeze(
  STATUS_SCHEMA.map((section) => section.title),
);
