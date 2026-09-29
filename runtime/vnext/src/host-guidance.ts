/** Shared AGENTS.md guidance. Only recognized workflow text is replaced. */
const START = '<!-- vnext-assistance-guidance:start -->';
const END = '<!-- vnext-assistance-guidance:end -->';

export function renderAssistanceGuidance(): string {
  return [
    START,
    '## vNext workflow assistance',
    '',
    '- Read `.workflow-system/WORKFLOW_PROTOCOL.md` and the selected `.agents/skills/<entry>/SKILL.md`. Their assistance and one-time confirmation rules supersede older workflow admission/terminal instructions; project business constraints remain effective.',
    '- Runtime assists recording, evidence, snapshots and lookup. Use `.workflow-system/runtime/support/assistance.mjs` and `ASSISTANCE_API.md`; no mandatory preflight, run-entry, waiver, review receipt, retry budget or legacy state repair is needed for authorized work.',
    '- Query `assistance.mjs task-status` or `context.management` for current task/plan/step state. The journal-backed view replaces stale CURRENT_TASK tuples; ordinary `find` pages are not state queries. `task-context --legacy` is historical only.',
    '- Use the assistance `task` actions for prepare/adopt/execution/review/review-decision/step/git/close. Check fact persistence, association and view publication separately; normal state maintenance is not optional. Offer rebuild/link/correct/resolve/defer for unresolved management data, without replaying business work.',
    '- Read/search/record operations, stale metadata and equivalent details already authorized need no new confirmation. Report actual service failures and continue independent authorized work; never rerun business work just to obtain a receipt.',
    '- For a material deviation from a still-effective workflow commitment, disclose the action, gaps and concrete consequences together and ask once only if that informed choice is unresolved. Silence is not consent.',
    '- Reuse an informed decision for the same target, action and disclosed consequences, including across sessions. Only new material consequences, a changed action/target, or revised/revoked instructions require a new question about the change.',
    '- After confirmation, perform the chosen action and all already authorized stages. Do not require another Skill invocation or send the decision back through old complete/advance/close gates. A next_route is advice, not permission or a forced stop.',
    '- Record the actual decision and outcome separately using assistance records and links. Step/task dispositions retain failures, findings and unverified work; a saved decision or closed disposition is not PASS, clean or verified completion. Self-review remains self-review.',
    '- Respect the actual user scope and exclusions. A workflow decision does not authorize unrelated file changes, deletion, Git operations or deployment. Recording failure does not revoke a decision still available in the conversation.',
    END,
  ].join('\n');
}

// Exact statements emitted by the previous bootstrap and migration generators.
// Unknown lines, including additions inside an old workflow section, survive.
const OLD_LINES = new Set([
  'This project uses the pure vNext workflow surface.',
  '- Use `bootstrap-project` only for project setup or explicit realignment.',
  '- Use `prepare-task` before executing a new task.',
  '- Use `execute-step` only for the admitted current step.',
  '- Use `review-change`, `debug-task`, `task-lifecycle`, `capture-work-item`, and `close-task` according to their contracts.',
  '- The project-local Runtime and canonical `docs/workflow/CURRENT_TASK.md` are authoritative for task state.',
  '- Do not edit governance state directly or treat discovery context as write authority.',
  '## Public entry terminal boundary',
  '`public-entry-terminal/v1` applies to every public Skill invocation.',
  "- An explicit Skill invocation authorizes its stated intent and routine internal recovery within the caller's scope. Do not require a second instruction for a corrected request, retained-state recovery, or an unambiguous warning decision already covered by the caller's words.",
  "- A Runtime rejection is diagnostic: inspect current state, correct the request, and use this entry's typed recovery operations before returning blocked. Preserve failed evidence, cumulative changes, findings, and audit history.",
  "- Ask the caller only when a materially new choice or authority is needed, or a required fact cannot be established. Record any warning decision from the caller's actual instruction; never invent one.",
  '- Complete only this entry intent, its internal capabilities, and its bound Runtime operations.',
  '- After a terminal result, return to the caller and stop.',
  '- Report at most one `next_route` / `recommended_route`; it is recommendation-only for a later caller invocation, and the current invocation must not invoke another public Skill.',
  '- A public `next_route` is null or a declared public Skill base name; put a declared public mode in `next_mode` separately. Derive it from the verified terminal result. Report a required user decision separately with `next_route: null`.',
  '- `task-context.overview.next_entry` / `next_options`, review `blocker.next_route`, and `run-entry` recovery routes can name internal Runtime operations. Never copy them into a public `next_route`; complete same-intent recovery inside this invocation.',
  '- This is instruction-level host guidance; the current Runtime cannot observe conversation-level public Skill chaining.',
  '- 当前 workflow-system 为 vNext；命令在本仓库实际根目录执行，不使用历史绝对工作目录。',
  '- workflow-system 技能仅使用 `.agents/skills/<entry>/SKILL.md`。',
  '- 先读对应 SKILL.md；prepare/confirm、review 和完成校验按当前 Runtime 契约执行。',
  '- 软件验证：`node .workflow-system/runtime/dist/cli.js validate-contract --root .` 与 `node .workflow-system/runtime/dist/cli.js validate --root . --summary`。',
  '- 本项目不运行旧 workflow-system 的 Bun 生成、registry 或 host 同步命令。',
  '- 项目事实与业务验证以 `.workflow-system/PROJECT_PROFILE.yaml` 为准；业务约束和私有技能仍有效。',
  '- This project uses workflow-system for AI delivery governance.',
  '- Read `.workflow-system/PROJECT_PROFILE.yaml`, `.workflow-system/WORKFLOW_PROTOCOL.md`, `.workflow-system/FILE_SCHEMAS.md`, `docs/workflow/DOCUMENT_CATALOG.md`, and `docs/workflow/WORKFLOW_GUIDE.md` before changing workflow-managed docs.',
  '- Bootstrap skills are preinstalled in both `.claude/skills/workflow-system-*` and `.codex/skills/workflow-system-*`.',
  '- New project: `/design-baseline-init` -> `/greenfield-init`.',
  '- Existing project: `/legacy-inventory` -> `/adopt-existing-project`.',
  '- If workflow assets are mixed between legacy and current paths, run `/realign-workflow-assets` before `/greenfield-init`.',
  '- After bootstrap or workflow template changes, run `bun run gen:all`, `bun run workflow:sync --host claude --write`, `bun run workflow:sync --host codex --write`, and `bun run workflow:health`.',
  '- When project-wide AI collaboration rules, host instructions, or shared workflow commands change later, run `/sync-host-guidance` so `AGENTS.md` and `CLAUDE.md` stay aligned.',
  'This file was scaffolded during workflow-system install so Codex-compatible agents can start from the same governance baseline.',
]);

function stripLegacyLines(section: string): string {
  return section.split(/(?<=\n)/u).filter(line => {
    const text = line.trim();
    return !OLD_LINES.has(text) && !text.startsWith('- 日常入口：');
  }).join('');
}

export function updateHostGuidance(content: string): string {
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const block = renderAssistanceGuidance().replaceAll('\n', newline);
  const start = content.indexOf(START), end = content.indexOf(END);
  if (start >= 0 || end >= 0) {
    if (start < 0 || end < start || content.indexOf(START, start + START.length) >= 0
      || content.indexOf(END, end + END.length) >= 0) throw new Error('Ambiguous AGENTS.md assistance markers; preserve the file for inspection.');
    return content.slice(0, start) + block + content.slice(end + END.length);
  }
  let retained = content.replace(/<!-- vNext bootstrap managed guidance; preserve target-owned additions outside this block\. -->[\s\S]*?^Project slug:[^\r\n]*(?:\r?\n|$)/mu,
    section => stripLegacyLines(section.replace(/^<!--[^\n]*-->(?:\r?\n)?/u, '')));
  retained = retained.replace(/^## workflow-system(?: baseline)?[^\r\n]*\r?\n[\s\S]*?(?=^#{1,6} |$(?![\s\S]))/gmu,
    section => stripLegacyLines(section));
  return block + newline + newline + retained;
}
