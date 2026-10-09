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
  buildPlanningExamples(root, write);
}

// Consumer inputs only: these synthetic decisions are not host semantic acceptance evidence.
function buildPlanningExamples(root: string, write: (relative: string, content: string) => void): void {
  write('examples/planning/README.md', fs.readFileSync(path.join(root, 'docs/product/project-maintenance/examples/planning-consumption.md'), 'utf8'));
  const source = (text: string) => ({ kind: 'text', text, label: '虚构消费样例，非用户决定' });
  const document = (metadata: ObjectValue, title: string, sections: string[]) => ({ metadata, body: `## [${metadata.id}] ${title}\n${sectionsByType[metadata.type]!.map((name, i) => `### ${name}\n${sections[i]}`).join('\n')}\n` });
  const binding = { id: 'B-BASE', task: { task_id: 'example-closed-base-task', source: source('合成历史：基础导入 task 已关闭，只覆盖单设备有效输入；不是当前任务状态查询。') }, role: 'implementation', coverage: '单设备有效输入的基础导入', origin: 'declared', state: 'active' };
  const requirements = [
    document({ type: 'requirement', id: 'REQ-IMPORT', scope: 'current', assessment_id: 'AS-BASE', task_bindings: [binding] }, '完整导入要求', ['处理有效输入、错误输入及新增双设备输入。', '保留已交付的单设备行为；本轮不新增文件格式。', '分别检查单设备、错误输入、双设备；历史单设备 PASS 不能代替其余检查。']),
    document({ type: 'requirement', id: 'REQ-AUDIT', scope: 'current' }, '共享审计约束', ['记录导入结果及错误，日志不得包含原始个人数据。', '跨所有导入阶段有效；没有独立工作项不等于遗漏。', '按实际日志核对脱敏和结果定位。']),
    document({ type: 'requirement', id: 'REQ-EXPORT', scope: 'planned' }, '后续导出', ['按已知格式导出处理结果。', '尚未进入近期安排，需求仍然保留。', '交付前核对约定格式，当前未验证。']),
    document({ type: 'requirement', id: 'REQ-STREAM', scope: 'candidate' }, '流式输入候选', ['是否需要流式输入尚未决定。', '不是已采纳工作。', '尚无已采纳验收要求。']),
    document({ type: 'requirement', id: 'REQ-LEGACY', scope: 'retired' }, '退出的旧格式', ['旧格式导入的历史范围。', '退出当前范围不等于已交付，也不恢复旧工作。', '仅保留历史约定，当前不作交付结论。']),
  ];
  const assessment = document({ type: 'assessment', id: 'AS-BASE', target: 'REQ-IMPORT', target_basis: { kind: 'file', path: 'docs/product/REQUIREMENTS.md', item_id: 'REQ-IMPORT', note: '未保存原需求字节，当前需求已增加双设备范围' }, target_definition_sha256: null, checked_at: '2026-10-01T00:00:00Z', subject: { kind: 'unknown', value: null }, implementation: 'partial-reported', verification: 'pass-reported', sources: [source('历史报告仅称单设备有效输入通过，代码版本未知。')], pending_sources: [source('新增双设备范围及错误输入反馈尚待核对。')] }, '历史局部检查', ['只有单设备有效输入。', '历史 task 关闭及局部 PASS 仅作为原范围资料，具体实现版本未知。', '新增双设备、错误输入及共享审计要求仍待核对。']);
  for (const variant of ['no-plan', 'multiple-plans']) {
    const prefix = `examples/planning/${variant}`;
    const project = document({ type: 'project', id: 'PROJECT-SELECT', inventory: { state: 'partial', checked_sources: [source('本轮已读取导入与审计要求及历史局部报告。')], unreviewed_sources: [source('其余业务资料尚未核对。')] } }, '规划消费示例', ['导入业务示例，完整需求与近期工作分开。', '已核对导入与共享审计；其余业务未知，字节读取完整不代表全项目盘点完成。']);
    project.body += variant === 'no-plan'
      ? '\n### 本轮选取与未决事项\n历史只报告单设备基础工作；本轮建议先核对错误输入，再按范围准备双设备工作，因为新反馈影响可靠导入。无总体 plan，选取建议尚不授权执行；共享审计、后续导出及候选流式输入仍保留。依据为 REQ-IMPORT、REQ-AUDIT 和 AS-BASE；未核对范围见 inventory。\n'
      : '\n### 规划阅读说明\n采用混合方式，近期导入工作见 PLAN-IMPORT，远期仍保留粗略阶段。PLAN-EXPORT 是另一个候选范围，PLAN-LEGACY 仅作历史；分别展示，不合并。调用者可明确选择 PLAN-IMPORT，此选择不写入新配置字段。\n';
    write(`${prefix}/.workflow-system/PRODUCT.yaml`, stringify({ schema: 'vnext-product-manifest/v2', project_id: `example-planning-${variant}`, entry: 'docs/product/PROJECT.md', managed_paths: ['docs/product/*.md'], source_paths: [], capture_paths: [], exclude_paths: [], maintenance: 'enabled' }));
    write(`${prefix}/docs/product/PROJECT.md`, newDocument([project, document({ type: 'goal', id: 'GOAL-RELIABLE', scope: 'current' }, '可靠导入', ['可靠处理已约定输入。', '范围由完整需求表达，不缩成当前 task。'])], '虚构规划消费样例'));
    write(`${prefix}/docs/product/REQUIREMENTS.md`, newDocument(requirements, '完整需求，非剩余待办'));
    write(`${prefix}/docs/product/ASSESSMENTS.md`, newDocument([assessment], '虚构历史局部报告'));
  }
  const work = (id: string, stage: string, target: string, coverage: string) => ({ id, title: coverage, outcome: `取得${coverage}的实际结果`, scope: coverage, targets: [{ target, coverage }], state: 'included', origin: 'initial', stage });
  const prefix = 'examples/planning/multiple-plans/docs/product';
  const plan = document({ type: 'plan', id: 'PLAN-IMPORT', intent_state: 'adopted', targets: [{ target: 'REQ-IMPORT', coverage: '导入范围按近期及后续阶段逐步展开，受共享审计约束' }], work_items: [work('W-VERIFY', '近期核对', 'REQ-IMPORT', '错误输入反馈与既有单设备覆盖'), work('W-BASE', '近期实施', 'REQ-IMPORT', '双设备输入的近期局部工作'), { ...work('W-RELEASE', '后续交付', 'REQ-IMPORT', '其余输入与集成复验，细节待核对'), depends_on: [{ item_id: 'W-BASE', kind: 'prerequisite', reason: '集成复验需要相关双设备行为真实可用；task 关闭不证明满足' }] }] }, '混合式导入安排', ['近期范围具体，后续交付阶段保留粗略安排，未说明依赖的工作可否并行尚未核对。', '按原数组展示 W-VERIFY、W-BASE、W-RELEASE；同一导入需求跨阶段覆盖。共享审计约束适用于每项，不另造审计工作项。', '远期细节和当前代码适用性未核对；数组顺序不是新增依赖。']);
  const candidate = document({ type: 'plan', id: 'PLAN-EXPORT', intent_state: 'proposed', targets: [{ target: 'REQ-EXPORT', coverage: '后续导出候选范围' }], work_items: [work('W-RELEASE', '后续候选', 'REQ-EXPORT', '导出方案与验收范围核对')] }, '另一个候选计划', ['候选尚未采用，不替代已采用导入安排。', 'W-RELEASE 在此 plan 有独立身份，不与 PLAN-IMPORT 的同名工作项合并。', '未决定启动时点；不按文档修改时间采纳。']);
  const retired = document({ type: 'plan', id: 'PLAN-LEGACY', intent_state: 'retired', targets: [{ target: 'REQ-LEGACY', coverage: '已退出的旧格式范围' }], work_items: [] }, '历史计划', ['保留原范围供历史阅读。', '当前不再分解；退出不代表完成。', '不会因打开页面自动恢复。']);
  write(`${prefix}/PLAN-IMPORT.md`, newDocument([plan], '已采用的局部安排'));
  write(`${prefix}/PLAN-EXPORT.md`, newDocument([candidate], '独立候选安排'));
  write(`${prefix}/PLAN-LEGACY.md`, newDocument([retired], '历史安排'));
  const reordered = 'examples/planning/reordered';
  for (const file of ['.workflow-system/PRODUCT.yaml', 'docs/product/PROJECT.md', 'docs/product/REQUIREMENTS.md', 'docs/product/ASSESSMENTS.md']) {
    write(`${reordered}/${file}`, fs.readFileSync(path.join(root, 'runtime/vnext/support/product-maintenance/examples/planning/no-plan', file), 'utf8'));
  }
  const reorderedProject = path.join(root, 'runtime/vnext/support/product-maintenance', reordered, 'docs/product/PROJECT.md');
  fs.writeFileSync(reorderedProject, fs.readFileSync(reorderedProject, 'utf8').replace(/### 本轮选取与未决事项[\s\S]*?(?=\n## |$)/, '### 历史选取与当前安排\n此前无 plan 时建议先核对错误输入；该建议已由 PLAN-LOCAL 的当前采用安排接替，现按 B、A、C 展示。完整需求、AS-BASE 与未核对范围继续保留；不在 project 再维护当前顺序。\n'));
  const localPlan = document({ type: 'plan', id: 'PLAN-LOCAL', intent_state: 'adopted', targets: [{ target: 'REQ-IMPORT', coverage: '基础 A 与新增 B/C 范围' }], work_items: [work('B', '近期', 'REQ-IMPORT', '双设备'), work('A', '历史交付', 'REQ-IMPORT', '单设备有效输入'), work('C', '后续', 'REQ-IMPORT', '错误输入')] }, '重排后的局部安排', ['仅覆盖导入，不是总体计划。', '展示 B、A、C；A 的历史单设备报告仍在 AS-BASE，B/C 尚未验证。', '从 A、B、C 调为 B、A、C；展示变化不重开 A，也不改变 task 状态。']);
  const evolved = requirements.map(item => ({ ...item, metadata: { ...item.metadata } }));
  evolved[0]!.metadata.task_bindings = [binding, { id: 'B-UNKNOWN', task: { task_id: null, source: source('旧报告提及错误提示工作，原身份和日期不明。') }, role: 'reference', coverage: '历史错误提示，仅待核对来源', origin: 'declared', state: 'active' }, { id: 'B-NEW', task: { task_id: 'example-new-device-task', source: source('虚构新 task 仅服务新增双设备范围。') }, role: 'implementation', coverage: '新增双设备输入', origin: 'declared', state: 'active', plan_items: [{ plan_id: 'PLAN-LOCAL', work_item_id: 'B' }] }];
  write(`${reordered}/docs/product/REQUIREMENTS.md`, newDocument(evolved, '新增范围保留历史覆盖'));
  write(`${reordered}/docs/product/PLAN.md`, newDocument([localPlan], '虚构重排消费输入'));
  write(`${reordered}/docs/product/CHANGES.md`, newDocument([document({ type: 'change', id: 'CHG-ORDER', recorded_at: '2026-10-09T00:00:00Z', basis: { kind: 'delegated', text: '虚构样例明确重排', sources: [source('将 B 放在已交付 A 前面，保留历史。')] }, deltas: [{ target: 'PLAN-LOCAL', before: 'A、B、C', after: 'B、A、C', note: '稳定工作项 B/A/C；不改变 A 历史。' }] }, '局部展示重排', ['只改变展示顺序。', '原单设备报告保留，新增范围不继承旧 PASS。'])]));
}
