# vibe-governance

`vibe-governance` is the ephemeral Node distribution boundary for Vibe Governance.

```bash
npx vibe-governance@latest install
npx vibe-governance@latest migrate
npx vibe-governance@latest upgrade
```

The installer distributes software only. It does not bootstrap project facts;
after a successful fresh install, continue by invoking the
`bootstrap-project` Agent Skill.

The installed Skill uses the target-local Node path
`.workflow-system/runtime/dist/cli.js bootstrap-support prepare` to form a
typed governance proposal. It does not require the workflow-system source
repository, Bun, `WORKFLOW_SYSTEM_ROOT`, or source-side generation commands;
the project-local Runtime performs the governed commit and read-back.

The package is assembled by the source repository's release command:
`bun run build:vibe-governance-distribution`.

For a legacy migration with explicit user decisions, 0.18.0 accepts
`migrate --root <project> --decisions-file <json> --dry-run` followed by the
same command without `--dry-run`. Omitting the file retains strict admission.
First run `migrate --root <project> --json --dry-run` without decisions.
For a recognized legacy profile, `migration_target.target_root` and
`migration_target.target_identity` provide the exact binding even when admission
is rejected for missing decisions. Copy these values into the JSON below; do not
calculate identity from implementation details. Missing `migration_target` means
the target could not be identified; resolve the reported blockers first.
A returned identity does not authorize migration or declare any task completed.
Record file hashes from the original bytes and only decisions explicitly made by
the user, then repeat dry-run with `--decisions-file` and inspect the full plan
before running without `--dry-run`. Changed targets or bytes require fresh inputs.
The JSON schema is:

```json
{
  "schema_version": 1,
  "target_root": "<normalized absolute project path>",
  "target_identity": "<migration_target.target_identity from public dry-run>",
  "current_task": {
    "path": "docs/workflow/CURRENT_TASK.md",
    "sha256": "<full lowercase SHA-256 of original bytes>",
    "original_task_id": "<original legacy ID>"
  },
  "current_task_disposition": "completed-by-user-confirmation",
  "preserved_paused": [
    { "path": "TASKS/paused/<original filename>.md", "sha256": "<full SHA-256>" }
  ],
  "user_decision": { "source": "<decision source>", "verbatim": "<user's exact decision>" }
}
```

This input is caller-reported evidence, not an authenticated signature. Target,
task identity and file hashes must match. Active or interrupted work and open
current-task findings still block migration. Every paused file must be explicitly
listed for preservation. Pack v2 and its preservation receipt retain the decision;
Pack v1 and receipt v1 remain readable.

New migrations use Pack/receipt v3. Historical Markdown bodies retain their exact
text; normalized references are an index only. Current workflow guidance/profile
projections explicitly declare `original_text_preserved: false` and a hash-bound
backup under `.workflow-system/legacy/<sha256>/<original path>`. Host changes are
limited to workflow-system sections in existing files; no CLAUDE.md is created.
Known old workflow package scripts and all prefixed `workflow-system-*` Skill
directories in `.agents`, `.codex`, and `.claude` are removed transactionally.
Business configuration and non-prefixed `.agents` Skills remain target-owned.
Pack/receipt v1 and v2 retain their historical validation rules. Already-vNext
targets still reject migrate; this is not a repair or re-migration entry point.

The original current task is preserved at
`TASKS/legacy/CURRENT_TASK-<full SHA-256>.md`. Paused files retain their original
paths and bytes, without conversion or a completion claim. They cannot be passed
directly to native vNext resume. When separately requested, read the old package
and current business state, then establish a new explicit plan through normal
vNext prepare/confirm. Software migration does not complete that historical work.

Migration freeze checks retain explicit `@frozen` tags (case-insensitive), uppercase `DO NOT MODIFY` banners and registry entries. Ordinary mixed-case instructions such as "Do not modify business code" are not file-freeze markers.


### Local source checkout (PowerShell 7)

With Node, Bun and source dependencies installed (`bun install`), run from the
source repository root. The wrapper builds the local distribution and invokes
its public Node CLI; no published npm package is required.

```powershell
pwsh -File .\scripts\workflow-local.ps1 install "E:\coding\project"
pwsh -File .\scripts\workflow-local.ps1 migrate "E:\coding\project"
pwsh -File .\scripts\workflow-local.ps1 upgrade "E:\coding\project"
```

All default to dry-run; add `-Execute` only after reviewing the plan.
For migration decisions add `-DecisionsFile "E:\migration-decisions.json"`.
That parameter is rejected for install/upgrade. The wrapper does not infer user
decisions or choose a different operation. `migrate-local.ps1` remains a
compatibility entry for migrate. Runtime dependency installation may still need
network access.
