import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { RootContent, Table, TableRow } from 'mdast';

/** Shared producer/consumer contract. This module never reads files or judges delivery. */
export const functionalPointContract = 'vnext-functional-points/v1';
export const standardPointHeaders = ['功能点', '实现判断', '本次已知交付/保留成果', '本对象验证与限制', '剩余、发现与边界'] as const;
export const pointFieldAliases = {
  point: ['功能点', '原功能点', '功能点编号', '功能义务', '原功能点/条款', '当前领域子项'],
  judgment: ['实现判断', '实施判断', '实施状态', '实现状态', '核对结果', '评估结论', '评估结果'],
  implementation: ['本次已知交付/保留成果', '已查事实', '实现现状', '实际实现', '已实现', '实现与已知成果', '有据成果', '已确认成果'],
  verification: ['本对象验证与限制', '验证状态', '验证依据', '验证结果', '既有验证及边界'],
  remaining: ['剩余、发现与边界', '具体缺口', '具体剩余', '明确剩余', '剩余与边界', '剩余范围', '完整范围剩余与限制', '剩余', '剩余与待核对', '不通过原因', '无法评估原因', '原因', '本对象边界', '保留边界'],
  evidence: ['实际实现与验证', '实现和验证', '实现与验证', '具体依据与边界', '具体依据', '已实施及验证依据'],
} as const;
type PointField = keyof typeof pointFieldAliases;
export interface PointDefinition { id: string; title: string; line: number }
export interface PointDiagnostic { code: string; message: string; line?: number }
export interface PointRow {
  point_id: string | null;
  point_text: string;
  line: number;
  supplementary: boolean;
  fields: { label: string; text: string; field: Exclude<PointField, 'point'> | null }[];
}
export interface FunctionalPoints {
  contract: typeof functionalPointContract;
  status: 'absent' | 'parsed' | 'partial' | 'unrecognized';
  coverage: 'complete' | 'incomplete' | 'unavailable';
  expected_points: string[] | null;
  missing_points: string[];
  duplicate_points: string[];
  unknown_points: string[];
  rows: PointRow[];
  diagnostics: PointDiagnostic[];
}
interface DocumentItem {
  id: string; type: string; body: string; line: number; path: string; usable: boolean;
  metadata: { target?: string; [key: string]: unknown };
}
const markdown = unified().use(remarkParse).use(remarkGfm);
const featureHeading = /^(?:功能点(?:与输入输出|清单|拆分)?|功能拆分|功能清单)$/;
type TextNode = { value?: unknown; alt?: string | null; children?: readonly TextNode[] };
function nodeText(node: TextNode): string {
  if (typeof node.value === 'string') return node.value;
  if (node.alt) return node.alt;
  return (node.children ?? []).map(nodeText).join('');
}
function columnField(label: string): PointField | null {
  return (Object.keys(pointFieldAliases) as PointField[]).find(field => (pointFieldAliases[field] as readonly string[]).includes(label)) ?? null;
}

/** Only explicitly labelled functional lists define the expected set; nested bullets are detail. */
export function readRequirementPoints(body: string, firstLine = 1): PointDefinition[] {
  const nodes = markdown.parse(body).children;
  const points: PointDefinition[] = [];
  for (const [index, heading] of nodes.entries()) {
    if (heading.type !== 'heading' || !featureHeading.test(nodeText(heading).trim())) continue;
    for (const node of nodes.slice(index + 1)) {
      if (node.type === 'heading' && node.depth <= heading.depth) break;
      if (node.type !== 'list') continue;
      for (const entry of node.children) {
        const title = nodeText(entry.children[0] ?? entry).trim();
        if (!title) continue;
        const marker = /^(F[1-9]\d*)[：:、.\s]+/.exec(title);
        points.push({ id: marker?.[1] ?? `F${points.length + 1}`, title: title.replace(/^(F[1-9]\d*)[：:、.\s]+/, ''), line: firstLine + (entry.position?.start.line ?? 1) - 1 });
      }
    }
  }
  return points;
}

function pointId(text: string, target: string, points: PointDefinition[] | null): { id: string | null; issue?: string } {
  const ids = [...text.matchAll(/(?:^|[\s/、；;,–—~至-])(F[1-9]\d*)(?=\s|[：:、.;；,/–—~至-]|$)/g)].map(match => match[1]!);
  if (new Set(ids).size > 1 || /F[1-9]\d*\s*[-–—~至]\s*\d+/.test(text)) return { id: null, issue: 'POINT_GROUPED_ID' };
  const explicit = /^(?:(.+)\/)?(F[1-9]\d*)(?=\s|[：:、.]|$)/.exec(text);
  if (explicit?.[1] && explicit[1] !== target) return { id: null, issue: 'POINT_TARGET_MISMATCH' };
  if (explicit) return { id: explicit[2]! };
  const original = [...new Set([...text.matchAll(/原功能\s*(\d+)/g)].map(match => `F${match[1]}`))];
  if (original.length > 1) return { id: null, issue: 'POINT_GROUPED_ID' };
  if (original.length === 1) return { id: original[0]! };
  const exact = points?.filter(point => text === point.title || text.startsWith(`${point.title} `)) ?? [];
  if (exact.length === 1) return { id: exact[0]!.id };
  return { id: null, issue: 'POINT_ID_UNRECOGNIZED' };
}
const cells = (row: TableRow): string[] => row.children.map(cell => nodeText(cell).trim());

/** Keep raw rows, unknown fields and line locators even when mapping fails. No fuzzy assignment. */
export function readAssessmentPoints(body: string, target: string, points: PointDefinition[] | null = null, firstLine = 1): FunctionalPoints {
  const rows: PointRow[] = [], diagnostics: PointDiagnostic[] = [];
  const headings: { depth: number; supplementary: boolean }[] = [];
  let candidates = 0, recognized = 0;
  function issue(code: string, message: string, line?: number): void { diagnostics.push({ code, message, ...(line === undefined ? {} : { line }) }); }
  function sourceLine(node: RootContent | TableRow): number { return firstLine + (node.position?.start.line ?? 1) - 1; }
  function readTable(table: Table): void {
    const headers = table.children[0] ? cells(table.children[0]) : [];
    const fields = headers.map(columnField);
    const pointColumns = fields.flatMap((field, index) => field === 'point' ? [index] : []);
    const looksLikePoints = headers.some(header => /功能点|功能义务|领域子项/.test(header))
      || table.children.slice(1).some(row => /^(?:[^/\s]+\/)?F[1-9]\d*(?=\s|[：:、./；;,–—~]|-F?\d|$)/.test(cells(row)[0] ?? ''));
    if (!pointColumns.length && !looksLikePoints) return;
    candidates++;
    if (pointColumns.length !== 1) { issue('POINT_TABLE_UNRECOGNIZED', '逐点表格必须有一个可映射的功能点列；原表格保留。', sourceLine(table)); return; }
    recognized++;
    if (table.children.length < 2) issue('POINT_TABLE_EMPTY', '逐点表格没有主记录。', sourceLine(table));
    const pointColumn = pointColumns[0]!;
    const supplementary = headings.some(heading => heading.supplementary);
    const semanticFields = fields.filter(field => field && field !== 'point');
    if (new Set(semanticFields).size !== semanticFields.length) issue('POINT_FIELD_DUPLICATE', '多个列映射到同一字段；保留各列，不静默覆盖。', sourceLine(table));
    if (!semanticFields.length) issue('POINT_FIELDS_MISSING', '逐点表格没有可映射的成果、验证、边界或判断字段。', sourceLine(table));
    for (const row of table.children.slice(1)) {
      const values = cells(row), text = values[pointColumn] ?? '', line = sourceLine(row);
      const mapped = pointId(text, target, points);
      if (mapped.issue) issue(mapped.issue, `无法唯一关联功能点：${text}；不按行序、合并编号或其他需求猜测。`, line);
      const record: PointRow = { point_id: mapped.id, point_text: text, line, supplementary, fields: [] };
      for (let index = 0; index < Math.max(headers.length, values.length); index++) {
        if (index === pointColumn || !values[index]) continue;
        const field = fields[index];
        const label = headers[index] ?? `[未命名列${index + 1}]`;
        record.fields.push({ label, text: values[index]!, field: field && field !== 'point' ? field : null });
        if (!field) issue('POINT_FIELD_UNMAPPED', `字段无法映射：${label}；保留原标签和内容。`, line);
      }
      if (!record.fields.length) issue('POINT_ROW_EMPTY', `功能点 ${text} 没有记录内容。`, line);
      rows.push(record);
    }
  }
  for (const node of markdown.parse(body).children) {
    if (node.type === 'heading') {
      while (headings.length && headings[headings.length - 1]!.depth >= node.depth) headings.pop();
      headings.push({ depth: node.depth, supplementary: /剩余分类|补充说明|补充分类/.test(nodeText(node)) });
    } else if (node.type === 'table') readTable(node);
    else if (node.type === 'paragraph' || node.type === 'html') {
      // GFM cannot form an AST table for malformed delimiters. Never inspect fenced code.
      const raw = body.slice(node.position!.start.offset, node.position!.end.offset);
      const pointHint = /功能点|功能义务|领域子项|\bF[1-9]\d*\b/.test(raw);
      if (pointHint && (/\|/.test(raw) && /\n/.test(raw) || /<table\b/i.test(raw))) {
        candidates++;
        issue('POINT_TABLE_UNRECOGNIZED', '存在疑似逐点表格，但不是可解析的 GFM 表格；原文保留。', sourceLine(node));
      }
    }
  }
  const primary = rows.filter(row => !row.supplementary && row.point_id);
  const counts = new Map<string, number>();
  for (const row of primary) counts.set(row.point_id!, (counts.get(row.point_id!) ?? 0) + 1);
  const duplicate = [...counts].filter(([, count]) => count > 1).map(([id]) => id);
  for (const id of duplicate) issue('POINT_ID_DUPLICATE', `功能点 ${id} 有多条主记录；不自动合并或选择。`, primary.find(row => row.point_id === id)!.line);
  for (const row of rows.filter(row => row.supplementary && row.point_id)) if (counts.get(row.point_id!) !== 1) issue('POINT_SUPPLEMENT_UNRESOLVED', `补充记录 ${row.point_id} 没有唯一主记录。`, row.line);
  const expected = points?.map(point => point.id) ?? null;
  const definitionConflict = expected !== null && new Set(expected).size !== expected.length;
  const known = expected !== null && expected.length > 0 && !definitionConflict;
  const missing = known ? expected.filter(id => !counts.has(id)) : [];
  const unknown = known ? [...counts.keys()].filter(id => !expected.includes(id)) : [];
  if (definitionConflict) issue('POINT_DEFINITION_CONFLICT', '需求功能点编号重复，无法验证覆盖。');
  if (candidates && !known) issue('POINT_COVERAGE_UNAVAILABLE', '目标需求未唯一读到、没有明确功能清单或编号冲突；不声明覆盖完整。');
  if (missing.length) issue(candidates ? 'POINT_ID_MISSING' : 'POINT_RECORDS_ABSENT', `缺少主记录：${missing.join('、')}；未覆盖点也应独立注明原因。`);
  if (unknown.length) issue('POINT_ID_UNKNOWN', `报告编号不在已读目标需求中：${unknown.join('、')}。`);
  let status: FunctionalPoints['status'] = 'parsed';
  if (!candidates) status = 'absent';
  else if (!recognized) status = 'unrecognized';
  else if (diagnostics.some(entry => entry.code !== 'POINT_COVERAGE_UNAVAILABLE')) status = 'partial';
  let coverage: FunctionalPoints['coverage'] = 'unavailable';
  if (known) coverage = status === 'parsed' && !missing.length && !duplicate.length && !unknown.length ? 'complete' : 'incomplete';
  return { contract: functionalPointContract, status, coverage, expected_points: known ? expected : null, missing_points: missing, duplicate_points: duplicate, unknown_points: unknown, rows, diagnostics };
}

export function assessmentPointResults(items: readonly DocumentItem[]): { report_id: string; path: string; functional_points: FunctionalPoints }[] {
  return items.filter(item => item.type === 'assessment').map(report => {
    const definitions = items.filter(item => item.id === report.metadata.target);
    const definition = definitions.length === 1 && definitions[0]!.usable && definitions[0]!.type === 'requirement' ? definitions[0] : undefined;
    const points = definition ? readRequirementPoints(definition.body, definition.line) : null;
    return { report_id: report.id, path: report.path, functional_points: readAssessmentPoints(report.body, report.metadata.target ?? '', points, report.line) };
  });
}

export function pointResultDiagnostics(results: ReturnType<typeof assessmentPointResults>): { code: string; path: string; item_id: string; message: string; line?: number; severity: 'warning' }[] {
  return results.flatMap(result => result.functional_points.diagnostics.map(entry => ({ ...entry, path: result.path, item_id: result.report_id, severity: 'warning' as const })));
}
