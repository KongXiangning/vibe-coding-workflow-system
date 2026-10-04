import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { stringify } from 'yaml';
import { newDocument } from '../runtime/vnext/src/product-maintenance/writer';
import { sectionsByType, type ObjectValue } from '../runtime/vnext/src/product-maintenance/model';

export function buildProductAssets(root: string): void {
  const support = path.join(root, 'runtime/vnext/support/product-maintenance');
  const write = (relative: string, content: string) => { const file = path.join(support, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
  fs.copyFileSync(path.join(root, 'docs/product/project-maintenance/document-contract.md'), path.join(support, 'contract.md'));
  const manifest = { schema: 'vnext-product-manifest/v2', project_id: 'replace-with-stable-project-id', entry: 'docs/product/PROJECT.md', managed_paths: ['docs/product/*.md', 'docs/product/discussions/*.md'], source_paths: ['docs/evidence/**', 'docs/product/history/**', 'docs/product/discussions/raw/**', '.workflow-system/records/events/*.json', 'TASKS/**/*.md'], capture_paths: ['docs/product/history/**', 'docs/product/discussions/raw/**'], exclude_paths: [], maintenance: 'enabled' };
  write('templates/PRODUCT.yaml', stringify(manifest));
  const source = { kind: 'text', text: '模板占位，替换为已取得且获授权的实际依据。', label: '非事实模板' };
  const fields: Record<string, ObjectValue> = {
    project: { id: 'PROJECT-ID', inventory: { state: 'partial', checked_sources: [], unreviewed_sources: [source] } },
    goal: { id: 'GOAL-ID', scope: 'current' }, module: { id: 'MOD-ID', scope: 'current' }, requirement: { id: 'REQ-ID', scope: 'current' },
    design: { id: 'DES-ID', intent_state: 'proposed' }, change: { id: 'CHG-ID', recorded_at: 'replace-with-actual-record-time', basis: { kind: 'delegated', text: '替换为实际变化依据' }, deltas: [{ target: 'REQ-ID', before: null, after: '替换为新意', note: '此前不存在或旧意未知，需说明' }] },
    assessment: { id: 'AS-ID', target: 'REQ-ID', target_basis: { kind: 'file', path: 'docs/product/REQUIREMENTS.md', item_id: 'REQ-ID' }, target_definition_sha256: null, checked_at: 'replace-with-actual-check-time', subject: { kind: 'unknown', value: null }, implementation: 'unknown', verification: 'unknown' },
    discussion: { id: 'DISC-ID', raw_ref: { kind: 'file', path: 'docs/product/discussions/raw/selected.txt', sha256: '0'.repeat(64), note: '占位摘要，必须替换为 capture 的实际摘要' }, submitted_at: 'replace-with-actual-submission-time', origin: { channel: 'unknown', occurred_at: null }, record_state: 'active' },
    plan: { id: 'PLAN-ID', intent_state: 'proposed', targets: [{ target: 'REQ-ID', coverage: '替换为业务范围' }], work_items: [] },
  };
  for (const [type, metadata] of Object.entries(fields)) {
    const filename = type === 'project' ? 'PROJECT' : type === 'requirement' ? 'REQUIREMENTS' : type.toUpperCase();
    write(`templates/${filename}.md`, newDocument([{ metadata: { type, ...metadata }, body: `## [${metadata.id}] 待填写的${type}\n${sectionsByType[type]!.map(name => `### ${name}\n未记录。按真实授权材料填写；模板不是业务决定或交付报告。`).join('\n')}\n` }], '格式模板（不是事实）'));
  }
  // Extract the authoritative E6 fenced file example, never import it as real task history.
  const example = fs.readFileSync(path.join(root, 'docs/product/project-maintenance/examples/e6-repair.md'), 'utf8');
  const pairs = [
    ['.workflow-system/PRODUCT.yaml', /## 2\.[\s\S]*?```yaml\r?\n([\s\S]*?)\r?\n```/],
    ['docs/product/PROJECT.md', /## 3\.[\s\S]*?````markdown\r?\n([\s\S]*?)\r?\n````/],
    ['docs/product/REQUIREMENTS.md', /## 4\.[\s\S]*?````markdown\r?\n([\s\S]*?)\r?\n````/],
    ['docs/product/PLAN.md', /## 5\.[\s\S]*?````markdown\r?\n([\s\S]*?)\r?\n````/],
    ['docs/product/ASSESSMENTS.md', /## 6\.[\s\S]*?````markdown\r?\n([\s\S]*?)\r?\n````/],
  ] as const;
  for (const [file, pattern] of pairs) {
    const match = pattern.exec(example); if (!match) throw new Error(`E6 source example block missing: ${file}`);
    write(`examples/e6/${file}`, `${match[1]}\n`);
  }
  const e6 = path.join(support, 'examples/e6/.workflow-system/PRODUCT.yaml');
  const data = fs.readFileSync(e6, 'utf8');
  fs.writeFileSync(e6, data.replace('source_paths: [docs/evidence/**]', 'source_paths: [docs/evidence/**, docs/product/raw/**]'));
  write('examples/e6/docs/product/raw/selected.txt', '示例选定讨论：先确认导入输入范围，是否支持三设备仍是备选；本文件不是用户聊天或已采纳决定。\n');
  const raw = fs.readFileSync(path.join(support, 'examples/e6/docs/product/raw/selected.txt'));
  const rawRef = { kind: 'file', path: 'docs/product/raw/selected.txt', sha256: createHash('sha256').update(raw).digest('hex') };
  write('examples/e6/docs/product/DISCUSSIONS.md', newDocument([{ metadata: { type: 'discussion', id: 'DISC-E6', raw_ref: rawRef, submitted_at: '2026-10-04T00:00:00Z', origin: { channel: 'unknown', occurred_at: null }, record_state: 'active', links: [{ id: 'L-IMPORT', relation: 'discusses', target: 'REQ-IMPORT', origin: 'inferred', state: 'active', reason: '仅示例同一导入主题，未采纳备选观点', sources: [{ ...rawRef, lines: { start: 1, end: 1 } }] }] }, body: '## [DISC-E6] 示例讨论\n### 整理摘要\n三设备是备选，不是本期任务。\n### 议题与未决问题\n本夹具只演示离线召回和来源位置，不是实际 Agent 行为证据。\n' }], '离线讨论示例'));
}
