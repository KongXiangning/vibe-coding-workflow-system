/** One-time legacy migration projections. Never used by daily Runtime calls. */
import { parseDocument, stringify } from 'yaml';

export type AlignmentContext = { host_files: string[]; workflow_documents: string[] };
export const VNEXT_ENTRIES = ['bootstrap-project', 'prepare-task', 'review-draft', 'execute-step', 'review-change', 'debug-task', 'task-lifecycle', 'capture-work-item', 'close-task', 'validate-change', 'git-commit'];

export function originalBackupPath(sourcePath: string, hash: string): string {
  return `.workflow-system/legacy/${hash}/${sourcePath}`;
}

export function isAlignedPath(p: string): boolean {
  return ['AGENTS.md', 'package.json', '.workflow-system/PROJECT_PROFILE.yaml',
    'docs/workflow/WORKFLOW_GUIDE.md', 'docs/workflow/DOCUMENT_CATALOG.md', 'docs/workflow/STATUS.md'].includes(p);
}

const obsoleteScripts = new Set(['gen:workflow-docs', 'gen:workflow-skills', 'gen:registry', 'gen:all',
  'validate:protocol', 'validate:all', 'validate:freshness', 'workflow:health', 'workflow:manifest',
  'workflow:sync', 'workflow:pack', 'workflow:install']);
const oldScriptPath = /scripts\/(?:gen-workflow-docs|gen-workflow-skills|gen-registry|run-validation|check-freshness|workflow-runtime)\.ts/;
const oldOwnedPath = /^(?:templates\/(?:docs|skills)(?:\/|$)|docs\/workflow\/(?:generated(?:\/|$)|SKILL_REGISTRY\.md$)|scripts\/(?:workflow-core|repo-path-patterns|workflow-doc-contracts|task-identity|bootstrap-project-governance|validation-model|run-validation|check-freshness|gen-workflow-skills|gen-workflow-docs|gen-registry|workflow-runtime)\.ts$)/;

function profile(content: string, context: AlignmentContext): string {
  const doc = parseDocument(content, { uniqueKeys: true });
  if (doc.errors.length || doc.warnings.length) throw new Error('Ambiguous legacy profile');
  const value = doc.toJS();
  for (const [section, fields] of Object.entries({ paths: ['workflow_template_directories', 'generated_artifacts'],
    boundaries: ['generated_only_paths', 'workflow_owned_paths'], governance: ['current_documents'] })) {
    for (const field of fields) {
      const list = value[section]?.[field];
      if (Array.isArray(list)) value[section][field] = list.filter((p: unknown) => typeof p !== 'string'
        || (!oldOwnedPath.test(p.replaceAll('\\', '/')) && (!['AGENTS.md'].includes(p) || context.host_files.includes(p))));
    }
  }
  if (value.paths?.workflow_template_directories?.length === 0) value.paths.existing_skill_template_patterns = [];
  if (Array.isArray(value.architecture_rules)) value.architecture_rules = value.architecture_rules.filter((rule: string) =>
    !['Keep workflow automation and generators in scripts/.', 'Treat templates/skills/ as workflow skill template sources, not runtime outputs.'].includes(rule));
  if (Array.isArray(value.boundaries?.workflow_owned_paths)) {
    for (const entry of VNEXT_ENTRIES) {
      const p = `.agents/skills/${entry}/**`;
      if (!value.boundaries.workflow_owned_paths.includes(p)) value.boundaries.workflow_owned_paths.push(p);
    }
  }
  if (Array.isArray(value.validation?.matrix)) value.validation.matrix = value.validation.matrix.filter((slot: any) => {
    if (slot.owner !== 'workflow-system') return true;
    return !/^bun run (?:gen:workflow-(?:docs|skills)|gen:registry) --dry-run$/.test(slot.command ?? '');
  });
  for (const slot of value.validation?.matrix ?? []) {
    if (oldScriptPath.test(slot.command ?? '') || /\bbun run (?:gen:|workflow:)/.test(slot.command ?? '')) throw new Error(`Unresolved legacy validation command: ${slot.name}; explicit review required`);
  }
  // Existing business slots and facts are kept; these checks only verify software.
  value.validation ??= {};
  value.validation.matrix ??= [];
  for (const [name, command] of [['vnext-contract', 'validate-contract'], ['vnext-current-task', 'validate --summary']]) {
    if (value.validation.matrix.some((slot: any) => slot.name === name)) throw new Error(`Conflicting validation slot: ${name}`);
    value.validation.matrix.push({ name, layer: 'protocol', command: `node .workflow-system/runtime/dist/cli.js ${command} --root .`, blocker_level: 'blocks-merge', description: 'Validate installed vNext software/canonical state; not business acceptance.', phase: 'P9', owner: 'workflow-system' });
  }
  return stringify(value);
}

function guidance(content: string): string {
  const block = '## workflow-system baseline\n\n- 当前 workflow-system 为 vNext；命令在本仓库实际根目录执行，不使用历史绝对工作目录。\n- workflow-system 技能仅使用 `.agents/skills/<entry>/SKILL.md`。\n- 日常入口：' + VNEXT_ENTRIES.map(x => '`' + x + '`').join('、') + '。\n- 先读对应 SKILL.md；prepare/confirm、review 和完成校验按当前 Runtime 契约执行。\n- 软件验证：`node .workflow-system/runtime/dist/cli.js validate-contract --root .` 与 `node .workflow-system/runtime/dist/cli.js validate --root . --summary`。\n- 本项目不运行旧 workflow-system 的 Bun 生成、registry 或 host 同步命令。\n- 项目事实与业务验证以 `.workflow-system/PROJECT_PROFILE.yaml` 为准；业务约束和私有技能仍有效。\n\n';
  // Section-scoped edits preserve unrelated host instructions byte-for-byte.
  let result = content.replace(/^## workflow-system baseline[^\r\n]*\r?\n[\s\S]*?(?=^## |$(?![\s\S]))/m, block);
  if (result === content && !content.includes('## workflow-system baseline')) result = block + content;
  result = result.replace(/(^\d+\. `[^`]+`\r?\n)([\s\S]*?)(?=^\d+\. `|^## |$(?![\s\S]))/gm, (whole: string) =>
    /(?:\.codex|\.claude|\.agents)\/skills\/workflow-system-[^/]+\/SKILL\.md/.test(whole) ? '' : whole);
  result = result.replace(/^\d+\. workflow-system bootstrap skills .*\r?\n/gm, '')
    .replace(/^\d+\. workflow 管理的 live docs .*$/gm, '- workflow 当前文档在 `docs/workflow/`；历史材料不代表当前操作入口。');
  return result;
}

export function alignLegacyText(p: string, content: string, context: AlignmentContext, backup: string): string {
  if (p === 'AGENTS.md') return guidance(content);
  if (p === '.workflow-system/PROJECT_PROFILE.yaml') return profile(content, context);
  if (p === 'package.json') {
    const value = JSON.parse(content);
    for (const [name, command] of Object.entries(value.scripts ?? {})) {
      if (!obsoleteScripts.has(name) || typeof command !== 'string') continue;
      if (oldScriptPath.test(command) || (name === 'gen:all' && command === 'bun run gen:workflow-skills && bun run gen:workflow-docs && bun run gen:registry')) delete value.scripts[name];
      else throw new Error(`Custom command overlaps legacy workflow name: ${name}; explicit review required`);
    }
    for (const [name, command] of Object.entries(value.scripts ?? {})) {
      if (typeof command === 'string' && (oldScriptPath.test(command) || /\bbun run (?:gen:|workflow:)/.test(command))) throw new Error(`Custom command still depends on legacy workflow: ${name}; explicit review required`);
    }
    return JSON.stringify(value, null, 2) + '\n';
  }
  if (p === 'docs/workflow/WORKFLOW_GUIDE.md') return '# vNext workflow 使用指南\n\n' +
    '在本仓库根目录读取 `.workflow-system/PROJECT_PROFILE.yaml`、当前协议与对应 `.agents/skills/<entry>/SKILL.md`。\n\n' +
    VNEXT_ENTRIES.map(entry => `- \`${entry}\`：以已安装技能的入口契约为准。`).join('\n') +
    '\n\n普通任务先 prepare，再显式 confirm；执行、review、验证和关闭按计划要求进行，不默认强制 Red。\n' +
    '不要运行源仓库生成器或旧 workflow-system 技能。业务验证使用项目画像中的 target-project 槽。\n' +
    '旧暂停包只作原文材料，须另行明确请求、读取业务现状，再通过 prepare/confirm 建立计划；不可直接 resume。\n' +
    `\n迁移前指南原文：\`${backup}\`（历史证据，不是当前操作指引）。\n`;
  if (p === 'docs/workflow/DOCUMENT_CATALOG.md') return '# 当前 workflow 文档目录\n\n' +
    '本目录在迁移时按实际文档生成快照；后续通过当前 vNext 文档维护更新，不调用旧生成器。\n\n' +
    context.workflow_documents.map(file => `- \`${file}\``).join('\n') +
    '\n\n技能入口：`.agents/skills/`；Runtime：`.workflow-system/runtime/dist/cli.js`。\n' +
    `\n迁移前目录：\`${backup}\`。历史 TASK 与暂停材料在 TASKS/，不自动视为当前任务。\n`;
  if (p === 'docs/workflow/STATUS.md') return '# STATUS\n\n## 当前 workflow 状态\n\n' +
    '- 当前任务以 CURRENT_TASK.md 为准：迁移安装 vNext bootstrap baseline（closed / archived）。\n' +
    '- 该基线只表示软件迁移，不表示所有业务工作完成。旧暂停包和未完成义务仍待单独处理。\n\n' +
    '## 迁移前状态快照\n\n以下全部为迁移前历史描述；其中“当前任务”、active、closeout 等不代表新的 CURRENT_TASK。业务事实与未完成工作保留，后续按真实业务状态对账。\n\n<details>\n<summary>展开迁移前原文</summary>\n\n' + content + '\n</details>\n';
  return content;
}
