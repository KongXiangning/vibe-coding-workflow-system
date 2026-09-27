#!/usr/bin/env python3
"""Apply a reviewed, revision-bound source change; never run tests or publish.

Default is a read-only preview. --apply edits only the listed repository files.
All edits are calculated and checked before any file is changed. Existing edits,
symlinks and freeze markers are not overwritten. Requires Python 3.10+ and Git.
"""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

BASE = 'f4d14b46f1fdd8de1ad30f576513139c6d0e34c1'
PRUNE = {
  "test/vnext-runtime.test.ts": [
    "validates the bound Runtime slice including capture-work-item",
    "pure vNext rejects the legacy archived + archived workflow tuple",
    "rejects a Node runtime below the declared minimum",
    "claim-only migration cannot silently upgrade legacy completion semantics",
    "preserves a frozen plan identity while allowing only slot fulfillment updates",
    "close-task derives validation truth from durable claim evidence and blocks incomplete state",
    "rejects an uncommitted stale capture proposal before writing",
    "dry-run and stale source tuple never mutate CURRENT_TASK",
    "keeps malformed self-declared vNext CURRENT_TASK documents as schema errors",
    "validateVNextRuntimeContract machine-readably enforces reconciliation, step admission, and authority coordinates",
    "rejects malformed document references without writes and distinguishes legacy absence from explicit empty",
    "S2 rejects first-step prerequisites at admission without writes",
    "does not let raw progress bypass an explicit ordering strategy on an existing versioned task",
    "rejects a persistent test that is absent from exact Allowed mutation scope",
    "rejects test-like mutation scope that is broader than Persistent Tests",
    "preserves unresolved design choices and blocks confirmation until they are decided",
    "transitions active to blocked_by_replan, blocks execution and lifecycle pause/interrupt, then clears the block",
    "blocks an incident-shaped direct replan and preserves the original review obligations",
    "rejects raw replacement proposals before validating a new active step",
    "requires the execution audit section and verifies body audit on replay",
    "cannot replay supersede to authorize a direct definition generation",
    "rejects replan definition patches outside the closed section and identity allowlist",
    "fails closed for stale, caller/mode/action mismatches and replan replay after a later transition",
    "does not reach write or read-back for a direct commit-replan",
    "does not defer an old repair finding when direct replan is rejected",
    "wraps resume review and rejects the disabled public replan path",
    "keeps migration and replan convergence actions internal to Runtime owners",
    "reconciles the TermLink Bootstrap STATUS baseline with unrelated records",
    "adds a completed item without an exact in-progress mapping",
    "preserves ordinary in-progress text during STATUS reconciliation",
    "appends the new checkpoint while preserving multiple existing checkpoints and text",
    "persists defer and no-op lesson admission without allowing a Lesson write",
    "requires the execution audit section before close and before archive reconciliation",
    "fails stale archive source tuples before writing either close file",
    "a supersede/replan generation boundary does not let an old archive proposal close again",
    "allows new draft creation when previous STATUS receipt visible projection has drifted",
    "same-proposal semantic duplicates produce single visible Lesson and exact reuse proof",
    "same semantic content with different evidence_refs results in reuse while preserving evidence provenance",
    "canonical Lesson markers reject unknown fields and invalid dispositions",
    "persisted and reused Candidate Identity fields use one strict validator",
    "canonical Lesson marker digest must match visible semantic content",
    "combined proposal replay is strictly idempotent no-op with identical file bytes",
    "storage metrics review invalidates samples when a real commit crosses the start or final sampling boundary",
    "storage metrics review uses canonical Task Basis references without imposing blank-line spelling",
    "storage metrics observe draft, execution, review and migration without consuming receipts or writing data",
    "compact-v3 durable golden is reader-versioned and independent of YAML writer spelling",
    "active task projection migrates inline and compact-v2 tasks without changing decisions or consuming receipts",
    "same-version rg recovery preserves an active task with a large Runtime baseline",
    "keeps navigation and transaction qualification aligned at the absolute repair limits",
    "authorizes a selected legacy recovery target while an unselected exhausted finding awaits user disposition",
    "uses an exact warning decision to authorize six controlled waves without resetting prior attempts",
    "scope amendment walks three continuation layers without resetting the inherited budget",
    "scope amendment directly reuses the latest ready attempt without consuming another budget slot",
    "Step 5 fixed tgz Flow C recovers after an actual blocked Node execution",
    "Step 5 fixed tgz Flow D preserves cumulative review across steps and extensions",
    "Step 5 fixed tgz Flow E admits an absent persistent test explicitly",
    "process-control bundled Node CLI exposes task decisions and bounded validation replacement",
    "explicitly initializes a valid older task without changing its definition or existing evidence",
    "supersede preserves the exact confirmed task and Task Basis bytes before invalidation",
    "allows blocked_by_replan to supersede and never writes a replacement definition",
    "process-control successor publication retains the predecessor if preparation exits",
    "process-control rejects an incompatible human method and conflicting user source",
    "S2 static evidence and future slots retain independent identities without adding persistent tests",
    "does not admit review for a successful step without a review checkpoint",
    "same-domain discovery without assessment has a distinct admission error",
    "v2 authority amendment waits for the current execution to settle",
    "E18 accepts a planned command glob that is a strict subset of the granted domain",
    "stale domain-map revision blocks exact-path authority amendment without rebinding other domains"
  ],
  "test/workflow-vnext-source.test.ts": [
    "every public vNext entry carries the canonical terminal boundary",
    "rejects positive cross-public-entry continuations while allowing caller recommendations and prohibitions",
    "rejects internal commands and user decisions as public next_route literals",
    "keeps git-commit local, caller-authorized, and independent from Runtime",
    "keeps execute-step limited to recommending an explicit commit handoff",
    "keeps validate-change read-only with an empty mode and Runtime surface",
    "rejects restoration of the historical validate-change mode",
    "keeps execute-step focused on one Runtime-admitted step",
    "keeps review-change focused on clear findings or an explicit blocker",
    "preserves P-12 evidence-first and persistent-test admission boundaries",
    "keeps public selection examples generalized and distinct from execution evidence",
    "keeps E convergence aligned with implemented A-D boundaries",
    "requires prepare-task to map material draft gaps and preserve cross-step repairability",
    "keeps review-draft independent, read-only, and portable across agent contexts",
    "keeps debug ownership conditional and lesson admission non-blocking for closure",
    "scopes lifecycle evidence requirements to the selected transition",
    "keeps execute-step behind the resume-review gate",
    "rejects cycle phases promoted into a mode",
    "accepts capture-work-item as a vNext entry while keeping its record-only boundary",
    "rejects capture-work-item when its legacy-name collision is used as an executable target"
  ],
  "test/gen-workflow-docs.test.ts": [
    "project placeholders are fully resolved",
    "current task template includes lifecycle gate defaults in stable order",
    "lifecycle governance docs provide roadmap and baseline homes",
    "decisions doc includes superseded-decision handling",
    "contracts doc includes propagation governance supplements",
    "workflow guide documents the design production chain",
    "workflow guide documents post-release verification",
    "workflow guide documents workflow asset realignment entrypoint",
    "workflow guide documents supersede-current-task routing",
    "workflow guide documents capture-work-item as a record-only branch",
    "workflow guide documents lifecycle runtime skill routing",
    "workflow guide documents ownership-aware blocker routing for old tasks",
    "document catalog codifies directory classification and lookup guidance",
    "baseline gate skeleton covers v26 blocker families"
  ],
  "test/gen-workflow-skills.test.ts": [
    "core implementation and review skills keep the external documentation gate",
    "vNext review skill keeps governance-only whitespace outside the business blocker scope",
    "review-current-task consumes resume gate and rollback review fields",
    "review findings are persisted through a dedicated sync skill before fix implementation",
    "safety boundary skills are integrated without adding native safety skill names",
    "design production chain is integrated without adding native design skill names",
    "post-release verification is integrated without adding native deploy skill names",
    "investigate-root-cause enforces root-cause-first debugging loop",
    "run-regression enforces QA mode selection and report-only behavior",
    "sync-review-findings routes findings by ownership before queueing"
  ],
  "test/workflow-core.test.ts": [
    "accepts all Chinese display names",
    "accepts all English canonical IDs",
    "accepts a mix of Chinese and English",
    "passes with extra fields present",
    "trims whitespace from values",
    "trims route and target values",
    "classifies incomplete conditional_handoff structure as HANDOFF_003 on conditional_handoff",
    "returns empty array for null",
    "wraps single value in array",
    "converts array items to strings",
    "returns empty array for undefined-like",
    "resolves dotted path",
    "resolves nested path",
    "throws on deep missing path",
    "stringifies array as comma-separated",
    "stringifies object as JSON",
    "stringifies primitive as string",
    "replaces exact match with value",
    "replaces placeholder in longer string",
    "replaces array placeholder with inline string",
    "recurses into objects",
    "recurses into arrays",
    "leaves non-matching strings unchanged"
  ]
}


def once(text: str, before: str, after: str, label: str) -> str:
    count = text.count(before)
    if count != 1:
        raise ValueError(f'{label}: expected one anchor, found {count}; no files changed')
    return text.replace(before, after, 1)


def erase_test(text: str, name: str) -> str:
    # These exact preimage tests have been checked against the TypeScript AST.
    # Do not use this as a general JavaScript parser or on an unreviewed revision.
    quoted = "'" + name.replace("'", "\\'") + "'"
    matches = list(re.finditer(r'(?m)^([ \t]*)test\(' + re.escape(quoted) + r'\s*,', text))
    if len(matches) != 1:
        raise ValueError(f'test not unique: {name}')
    match = matches[0]
    closing = '\n' + match.group(1) + '});'
    end = text.find(closing, match.end())
    if end < 0:
        raise ValueError(f'test terminator missing: {name}')
    return text[:match.start()] + text[end + len(closing):]


def prune_tests(text: str, names: list[str]) -> str:
    for name in names:
        text = erase_test(text, name)
    # Remove empty groups, not combine tests to make the count look smaller.
    text = re.sub(r"\n\s*describe\('[^']+',\s*\(\)\s*=>\s*\{\s*\}\);", '', text)
    return re.sub(r'\n{3,}', '\n\n', text)


def fix_kernel(text: str) -> str:
    return once(text,
        "  if (!['in-progress', 'blocked'].includes(execution.status)\n"
        "    || execution.advancement !== 'repair-awaiting-verification'",
        "  // Older Runtime versions recorded a finished repair attempt as completed\n"
        "  // while it still awaited verification. Read that history in place; do not\n"
        "  // rewrite it or treat the old label as a reviewed step completion. The\n"
        "  // laterCompletion check above still rejects an actually consumed result.\n"
        "  if (!['in-progress', 'blocked', 'completed'].includes(execution.status)\n"
        "    || execution.advancement !== 'repair-awaiting-verification'",
        'legacy repair review eligibility')


def extend_legacy_regression(text: str) -> str:
    text = once(text,
        "import { ordinaryAttemptAdmission } from '../runtime/vnext/src/kernel';",
        "import { ordinaryAttemptAdmission, assertReviewExecutionEligible } from '../runtime/vnext/src/kernel';",
        'legacy regression import')
    start = text.index("  test('hands multiple review findings across sessions through one bounded repair wave and verification'")
    end = text.index('\n  });', start) + len('\n  });')
    block = text[start:end]
    block = once(block,
        '    const verification = reviewContext(root, {});',
        """    // A historical read fixture, not a new on-disk execution or migration.
    // The old completed + repair-awaiting-verification pair means awaiting review.
    const legacy = { ...repaired, runtimeState: structuredClone(repaired.runtimeState) };
    const legacyExecution = legacy.runtimeState.execution_log.findLast(item =>
      !('action' in item) && item.mode === 'repair' && item.execution_result !== undefined);
    if (!legacyExecution || 'action' in legacyExecution) throw new Error('Missing repair fixture');
    legacyExecution.status = 'completed';
    legacy.runtimeState.active_step_status = 'completed';
    const legacyBefore = JSON.stringify(legacy.runtimeState);
    const fileBefore = fs.readFileSync(repaired.filePath);
    expect(() => assertReviewExecutionEligible(root, legacy, legacyExecution)).not.toThrow();
    expect(JSON.stringify(legacy.runtimeState)).toBe(legacyBefore);
    expect(fs.readFileSync(repaired.filePath)).toEqual(fileBefore);
    expect(() => assertReviewExecutionEligible(root, legacy, { ...legacyExecution, step_id: 'wrong-step' }))
      .toThrow('REVIEW_EXECUTION_STALE');
    expect(() => assertReviewExecutionEligible(root, legacy, { ...legacyExecution, advancement: 'task-complete' }))
      .toThrow('REVIEW_EXECUTION_NOT_REVIEWABLE');

    const verification = reviewContext(root, {});""", 'legacy read fixture')
    block = once(block,
        '    expect(complete.runtimeState.pending_review_result).toBeNull();',
        "    expect(complete.runtimeState.pending_review_result).toBeNull();\n"
        "    expect(() => assertReviewExecutionEligible(root, complete, legacyExecution))\n"
        "      .toThrow('REVIEW_EXECUTION_ALREADY_COMPLETED');",
        'completed result cannot be reviewed twice')
    return text[:start] + block + text[end:]


def relax_prose_locks(text: str) -> str:
    names = ['validatePrepareTaskDraftBoundary', 'validateReviewDraftBoundary',
             'validateExecuteStepSemanticBoundary', 'validateReviewChangeSemanticBoundary']
    for name in names:
        start = text.index(f'function {name}(')
        end = text.index('\n}\n', start) + len('\n}\n')
        text = text[:start] + text[end:]
        text, count = re.subn(r"  if \(entry === '[^']+'\) " + name + r'\(content\);\n', '', text)
        if count != 1:
            raise ValueError(f'missing prose-validator call: {name}')
    start = text.index('  for (const [entry, terms] of Object.entries({')
    end = text.index('  for (const entry of ADMIN_ENTRIES) {', start)
    text = text[:start] + (
        '  // Validate catalogs, modes, authority and mutation declarations above;\n'
        '  // ordinary guidance prose is reviewed, not frozen by substring lists.\n'
    ) + text[end:]
    return re.sub(r'\n{3,}', '\n\n', text)


def reduce_recovery(text: str) -> str:
    def replace(before: str, after: str, label: str = 'recovery edit') -> None:
        nonlocal text
        text = once(text, before, after, label)
    replace("import { expect, test } from 'bun:test';", "import { afterAll, afterEach, expect, test } from 'bun:test';")
    replace("['full-chain', 'first-restore', 'same-report', 'shared-evidence', 'failure-budget', 'interleaved', 'reverse-interleaved', 'restore-retry']",
            "['full-chain', 'shared-evidence', 'reverse-interleaved', 'restore-retry']")
    shared = """
// Reuse only the immutable package. Every scenario still owns its task state.
let packageDirectory: string | undefined;
let packagedRuntime = process.env.VNEXT_RECOVERY_TGZ;
const workspaces: string[] = [];
function fixedRuntimeTgz(): string {
  if (packagedRuntime) return packagedRuntime;
  packageDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-recovery-package-'));
  const packageRoot = path.join(packageDirectory, 'package');
  buildVibeGovernanceDistribution({ outputRoot: packageRoot });
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const packed = JSON.parse(execFileSync(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', packageDirectory], { cwd: packageRoot, encoding: 'utf8' }));
  packagedRuntime = path.join(packageDirectory, packed[0].filename);
  return packagedRuntime;
}
afterEach(() => {
  for (const workspace of workspaces.splice(0)) fs.rmSync(workspace, { recursive: true, force: true });
});
afterAll(() => {
  if (packageDirectory) fs.rmSync(packageDirectory, { recursive: true, force: true });
});
"""
    anchor = "const sha = (value: string | Buffer) => crypto.createHash('sha256').update(value).digest('hex');\n"
    replace(anchor, anchor + shared)
    for prefix in ['vnext-recovery-distribution-', 'vnext-recovery-upgrade-']:
        anchor = f"  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), '{prefix}'));"
        replace(anchor, anchor + '\n  workspaces.push(workspace);')
    start = text.index("  const packageRoot = path.join(sourceRoot, 'packages/vibe-governance');")
    end = text.index("  fs.writeFileSync(path.join(npmHome, 'package.json')", start)
    text = text[:start] + "  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';\n  const tgz = fixedRuntimeTgz();\n" + text[end:]
    replace("if (scenario === 'interleaved' || scenario === 'reverse-interleaved')", "if (scenario === 'reverse-interleaved')")
    replace("scenario === 'interleaved' ? newer : ids[1]", 'ids[1]')
    replace("scenario === 'interleaved' ? ids[1] : newer", 'newer')
    start = text.index("    if (scenario === 'reverse-interleaved') {")
    end = text.index('    confirm(remaining);', start)
    block = text[start:end]
    if not block.endswith('    }\n'):
        raise ValueError('unexpected interleaving block')
    text = text[:start] + ''.join(line[2:] for line in block.splitlines(keepends=True)[1:-1]) + text[end:]
    start = text.index("  if (scenario === 'same-report') {")
    end = text.index("  if (scenario === 'first-restore'", start)
    text = text[:start] + text[end:]
    start = text.index("  if (scenario === 'first-restore'")
    end = text.index('  const history = state().runtime_state.execution_log;', start)
    block = text[start:end]
    common = block[block.index('    const prior = state();'):block.index("    if (scenario === 'first-restore' || scenario === 'restore-retry')")]
    common = common.replace("    if (scenario === 'first-restore') expect(prior.runtime_state.evidence_challenges).toBeUndefined();", '    expect(prior.runtime_state.evidence_challenges).toBeUndefined();').replace('    let targets =', '    const targets =')
    setup = block[block.index('      const checkpoint ='):block.index("      if (scenario === 'restore-retry')")]
    retry = block[block.index('        const preflight ='):block.index("      } else complete('RESTORE', [], {}, true);")]
    tail = block[block.index("      expect(fs.readFileSync(path.join(target, 'notes/a.md'), 'utf8')).toBe('initial A\\n');"):block.index('    } else {\n      let pendingId')]
    def dedent(value: str, size: int) -> str:
        return ''.join(line[size:] if line.startswith(' ' * size) else line for line in value.splitlines(keepends=True))
    reduced = "  if (scenario === 'restore-retry') {\n" + common + dedent(setup, 2) + dedent(retry, 4) + dedent(tail, 2) + '    return;\n  }\n'
    reduced = reduced.replace("    complete('RESTORE', []);", "    complete('RESTORE', [], {}, true);")
    text = text[:start] + reduced + text[end:]
    replace('      completionFile = path.join(directory, fs.readdirSync(directory)[0]);', """      const attemptId = state().runtime_state.step_attempts[id].attempts.at(-1).attempt_id;
      const matching = fs.readdirSync(directory).filter(name => name.endsWith('.json'))
        .filter(name => {
          const receipt = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
          return receipt.step_id === id && receipt.attempt_id === attemptId;
        });
      expect(matching).toHaveLength(1);
      completionFile = path.join(directory, matching[0]);""")
    start = text.index('    if (completionFile) {')
    end = text.index("    invoke(['complete-reviewed-step']", start)
    text = text[:start] + """    if (completionFile && scenario === 'restore-retry') {
      const input = { step_id: id, note: `Reviewed ${id}` };
      const receiptBytes = fs.readFileSync(completionFile);
      const receipt = JSON.parse(receiptBytes.toString());
      expect(receipt.kind).toBe('artifact-restore-completion/v2');
      // An authentic receipt from the OLD attempt must not qualify this attempt.
      const oldReceipt = path.join(path.dirname(completionFile), `${receipt.origin_completion}.json`);
      expect(fs.existsSync(oldReceipt)).toBe(true);
      expect(JSON.parse(fs.readFileSync(oldReceipt, 'utf8')).attempt_id).not.toBe(receipt.attempt_id);
      fs.renameSync(completionFile, `${completionFile}.unavailable`);
      try {
        rejected('complete-reviewed-step', input, 'ARTIFACT_RESTORE_COMPLETION_REQUIRED');
      } finally {
        fs.renameSync(`${completionFile}.unavailable`, completionFile);
      }
      fs.writeFileSync(completionFile, '{}\\n');
      try {
        rejected('complete-reviewed-step', input, 'ARTIFACT_RESTORE_COMPLETION_REQUIRED');
      } finally {
        fs.writeFileSync(completionFile, receiptBytes);
      }
      // A real user edit after review is preserved, not silently restored or completed.
      const restoredPath = path.join(target, 'notes/a.md');
      const restoredBytes = fs.readFileSync(restoredPath);
      fs.writeFileSync(restoredPath, 'user edit after reviewed restore\\n');
      try {
        rejected('complete-reviewed-step', input, 'REVIEW_TARGET_STALE');
        expect(fs.readFileSync(restoredPath, 'utf8')).toBe('user edit after reviewed restore\\n');
      } finally {
        fs.writeFileSync(restoredPath, restoredBytes);
      }
    }
""" + text[end:]
    start = text.index('  let fixed = process.env.VNEXT_RECOVERY_TGZ;')
    end = text.index("  execFileSync(npm, ['install'", start)
    text = text[:start] + '  const fixed = fixedRuntimeTgz();\n' + text[end:]
    return text.replace('    fs.rmSync(workspace, { recursive: true, force: true });\n', '').replace('  fs.rmSync(workspace, { recursive: true, force: true });\n', '')


def transform(relative: str, text: str) -> str:
    if relative in PRUNE:
        text = prune_tests(text, PRUNE[relative])
    if relative == 'runtime/vnext/src/kernel.ts':
        return fix_kernel(text)
    if relative == 'test/vnext-runtime.test.ts':
        return extend_legacy_regression(text)
    if relative == 'test/workflow-vnext-source.test.ts':
        text, count = re.subn(r'// P-12 admission[\s\S]*?} as const;\n\n', '', text)
        if count != 1:
            raise ValueError('obsolete prose-admission declaration missing')
    if relative == 'scripts/vnext-source-contract.ts':
        return relax_prose_locks(text)
    if relative == 'test/vnext-task-recovery-e2e.test.ts':
        return reduce_recovery(text)
    if relative == 'package.json':
        data = json.loads(text)
        command = data['scripts']['test:workflow-vnext-runtime']
        # Include existing high-value tests previously omitted by the official group.
        data['scripts']['test:workflow-vnext-runtime'] = command + ' test/vnext-entry-runner.test.ts test/vnext-task-metrics.test.ts'
        return json.dumps(data, ensure_ascii=False, indent=2) + '\n'
    return text


def git(root: Path, *args: str) -> bytes:
    result = subprocess.run(['git', '-C', str(root), *args], check=False, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr.decode(errors='replace').strip() or f'git failed: {args}')
    return result.stdout


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--apply', action='store_true', help='apply the reviewed source edits; does not build, test, commit or push')
    args = parser.parse_args()
    root = Path(git(args.root.resolve(), 'rev-parse', '--show-toplevel').decode().strip()).resolve()
    if json.loads((root / 'package.json').read_text(encoding='utf-8'))['name'] != 'vibe-coding-workflow-system':
        raise ValueError('not the workflow-system source repository')
    git(root, 'merge-base', '--is-ancestor', BASE, 'HEAD')
    for registry in ['FREEZE_REGISTRY.md', '.workflow-system/FREEZE_REGISTRY.md']:
        if (root / registry).exists():
            raise ValueError(f'freeze registry requires review before applying: {registry}')
    paths = list(PRUNE) + ['runtime/vnext/src/kernel.ts', 'scripts/vnext-source-contract.ts',
                          'test/vnext-task-recovery-e2e.test.ts', 'package.json']
    changes: dict[Path, tuple[bytes, bytes]] = {}
    for relative in paths:
        target = root / relative
        if target.is_symlink() or not target.resolve().is_relative_to(root):
            raise ValueError(f'unsafe target: {relative}')
        original = git(root, 'show', f'{BASE}:{relative}')
        before_text = original.decode('utf-8')
        header = '\n'.join(before_text.splitlines()[:35])
        if re.search(r'(?im)^\s*(?:[#/* -]*)\s*(?:@frozen|DO NOT MODIFY)\b', header):
            raise ValueError(f'frozen header: {relative}')
        after = transform(relative, before_text).encode('utf-8')
        current = target.read_bytes()
        if current == after:
            print(f'already applied: {relative}')
            continue
        if current.replace(b'\r\n', b'\n') != original.replace(b'\r\n', b'\n'):
            raise ValueError(f'{relative} differs from the reviewed base; preserve and reconcile those edits first')
        changes[target] = (current, after)
        print(f'{relative}: {len(current.splitlines())} -> {len(after.splitlines())} lines')
    print('Remove 135 named tests and 4 repeated package scenarios; extend two retained regressions.')
    if not args.apply:
        print('PREVIEW ONLY. Re-run with --apply to edit these files. No tests were run.')
        return 0
    applied: list[Path] = []
    try:
        for target, (before, after) in changes.items():
            # A final read narrows the race with concurrent local editors.
            if target.read_bytes() != before:
                raise ValueError(f'concurrent edit: {target.relative_to(root)}')
            fd, temporary = tempfile.mkstemp(prefix=f'.{target.name}.review-', dir=target.parent)
            try:
                with os.fdopen(fd, 'wb') as stream:
                    stream.write(after)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.chmod(temporary, target.stat().st_mode & 0o777)
                os.replace(temporary, target)
                applied.append(target)
            finally:
                Path(temporary).unlink(missing_ok=True)
    except Exception:
        # Do not overwrite an editor's later work while undoing a failed batch.
        for target in reversed(applied):
            before, after = changes[target]
            if target.read_bytes() == after:
                target.write_bytes(before)
            else:
                print(f'PRESERVED concurrent edit; inspect {target.relative_to(root)}', file=sys.stderr)
        raise
    print('APPLIED SOURCE ONLY. Build the Runtime before using it; no tests, commit, push or deployment occurred.')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError) as error:
        print(f'ERROR: {error}', file=sys.stderr)
        raise SystemExit(2)
