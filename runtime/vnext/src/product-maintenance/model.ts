export type ObjectValue = Record<string, any>;
export interface Diagnostic {
  code: string;
  path: string;
  message: string;
  item_id?: string;
  pointer?: string;
  line?: number;
  severity: 'error' | 'warning';
}
export interface Item {
  id: string;
  type: string;
  metadata: ObjectValue;
  path: string;
  title: string;
  body: string;
  sections: Record<string, { start: number; end: number; text: string }[]>;
  start: number;
  end: number;
  metadata_start: number;
  metadata_end: number;
  line: number;
  usable: boolean;
  diagnostics: Diagnostic[];
  definition_sha256?: string;
}
export interface ProductDocument {
  path: string;
  text: string;
  sha256: string;
  schema: string | null;
  version: 1 | 2 | null;
  items: Item[];
  diagnostics: Diagnostic[];
  frontmatter_start: number;
  frontmatter_end: number;
  body_start: number;
}
export interface Catalog {
  root: string;
  manifest_path: string;
  manifest: ObjectValue | null;
  manifest_sha256: string | null;
  status: 'available' | 'not-enabled' | 'unavailable' | 'unsupported';
  documents: ProductDocument[];
  items: Item[];
  byId: Map<string, Item>;
  diagnostics: Diagnostic[];
  coverage: ObjectValue;
}
export const sectionsByType: Record<string, string[]> = {
  project: ['项目定位', '盘点范围与未核对项'],
  goal: ['目标说明', '范围边界'],
  module: ['业务能力', '范围边界'],
  requirement: ['需求内容', '范围边界', '验收要求'],
  design: ['设计方案', '约束与取舍', '实际实现与差异'],
  change: ['变更说明', '影响与未同步项'],
  assessment: ['覆盖范围', '交付与验证依据', '剩余与待核对'],
  discussion: ['整理摘要', '议题与未决问题'],
  plan: ['实施策略', '阶段与工作项说明', '调整与未决事项'],
};
export function diagnostic(code: string, path: string, message: string, extras: Partial<Diagnostic> = {}): Diagnostic {
  return { code, path, message, severity: 'warning', ...extras };
}
