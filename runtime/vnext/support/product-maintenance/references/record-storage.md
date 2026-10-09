# Record storage: inspect, archive, reclaim and restore

This is a subflow of maintain-project. It uses the existing assistance archive
service, not product-maintenance read/check/apply/capture. No PRODUCT manifest,
business-maintenance mode, task preparation or task closure is required. Read
`../../ASSISTANCE_API.md` section “Indexed lossless record archives” for the exact
service contract. This reference owns orchestration, not archive eligibility.

## Select intent and scope

- “检查记录占用 / 哪些记录可以归档”: inspect only; report without changing the project.
- “归档历史记录 / 归档这些记录，保留原件”: create and verify, retain loose originals.
- “归档并回收重复散文件 / 回收已验证归档的重复文件”: perform the explicitly authorized
  create/verify/quarantine/reclaim sequence, or the needed remaining stages.
- “恢复归档”: verify and restore the selected original paths; never overwrite conflicts.

An unqualified maintain-project call remains the existing business maintenance
entry. A vague “归档这个任务/项目” is not automatically record-storage permission:
clarify only when it could materially change task state, business files or cleanup
scope. Do not ask again for an already clear choice or turn each filename/action
into another approval. An instruction to implement/install this capability is not
authority to clean the user's project. No automatic trigger on size, age, task
closure, install/upgrade, ordinary execution or Git commit.

Use the actual project root. Keep user-selected refs, archive IDs and exclusions;
do not widen to all records because selection is inconvenient. Runtime `plan` and
its verified catalog decide qualifying paths. Never infer that closed/old/similar
tests, failures, decisions or database states can be omitted. Archive bytes stay exact.

## Commands and a read-only preview

Run native Node, with one JSON object on stdin and the project root as a separate
argument (quote paths for the host shell):

`node .workflow-system/runtime/support/assistance.mjs archive --root <project>`

The source-repository equivalent is `node runtime/vnext/support/assistance.mjs`.
Use the installed command in a target project; no Bun build is needed there.

Start with `{"action":"plan"}`. For an explicit subset, use
`{"action":"plan","refs":["<actual logical record path>"]}`. Omitted refs means
all eligible loose facts in that project, not all business files. Retain returned
candidate refs, sizes and SHA256 values and the existing archive count. Planning
is not full archive verification and does not create an archive.

Use ordinary read-only directory listing/stat to measure physical regular-file
count and bytes under `.workflow-system/records`; do not follow symbolic paths.
Keep these groups separate: loose candidates returned by Runtime; immutable
archive backing; quarantine/receipts; excluded recovery/display/view files; other
noncandidate or unreadable paths. Report concrete exclusions using the API's
rules, not a second eligibility regex. Existing archived logical facts are not
new loose candidates. When enumeration is incomplete, report its gap, not zero.

The API excludes CURRENT_TASK, task-view(s), all display-* recovery files and
old-editor capture inodes. Noncandidate files, locks and temporary files are not
cleanup permission. Do not delete them. If task context is needed, `task-status`
is read-only; a missing/broken task or PRODUCT manifest does not block inspection.
Do not call record, task prepare/rebuild, snapshot or any archive write just to
save an inspection result. Keep temporary outputs outside the project; do not
create views, backups, receipts or business documents for a read-only request.

## Create and verify, retaining originals

For authorized creation, freeze the actual candidate refs from the preview. If
the preview is no longer current, reread plan for those refs and compare ref,
size and SHA256 before writing. Do not silently include later loose additions.
If a referenced fact changed/disappeared, report the changed scope and stop the
dependent cleanup; refresh the preview or resolve the material choice first.

Run `{"action":"create","refs":["<each planned candidate ref>"]}`. Inspect
`status`, `archive_ids`, `archived`, `originals_retained` and the actual inventory.
Check archived identities against the preview before any removal. Empty candidates
or `nothing-to-archive` means no new archive; it does not authorize selecting old
archives for cleanup. Concurrent/late facts remain loose for a future operation.

Run `{"action":"verify"}` and require actual `status: verified` and complete
verification. **verify currently checks all existing archives**; an archive_ids
field does not narrow it. Do not describe it as selected-only or ignore an error
in a different archive. A nonzero command exit, unavailable result, mismatch,
missing/corrupt index/pack, or unknown result is failure, not a cleanup signal.

Creation alone retains all originals and usually increases current physical
storage by the pack/index size. Report that honestly; stop here unless the user's
authority also covers reclaiming duplicates. Merely seeing reclaim in this guide
or a Runtime response does not grant that authority.

## Explicitly authorized reclamation

Before actual cleanup, retain and check an independent recoverable backup of the
selected original facts or their complete verified archive/index/pack set. Use an
existing adequate backup, or retain a local recoverable copy as an ordinary part
of the authorized cleanup; do not ask again merely to carry out that safeguard.
Report the location, covered identities and verification. If a recoverable copy
cannot be retained, or an external destination/material new storage commitment is
needed, pause cleanup and explain that specific limitation or unresolved choice.
Backup creation never means silently uploading data or making a Git commit.

Derive selected archive IDs from the actual create/verify inventory and the user's
scope. Always supply explicit `archive_ids` to quarantine, reclaim and restore;
omitting them selects every existing archive. A clearly project-wide reclaim
request can cover all verified project archives; a refs-only request cannot
silently expand to unrelated records sharing an old archive. Reclaim operates on
complete archives only. If that conflicts with the requested subset, retain the
duplicates and explain the choice instead of widening scope.

After successful verification, run
`{"action":"quarantine","archive_ids":["<authorized actual archive ID>"]}`.
For an explicitly partial quarantine, also pass its actual `refs`; do not follow
with whole-archive reclaim without authority for that complete archive. Check the
result; quarantine moves verified duplicates but does not reduce total bytes.

Only after the requested complete archives are quarantined, run
`{"action":"reclaim","archive_ids":["<same authorized archive ID>"]}`.
The Runtime rechecks complete backing, loose/quarantine consistency and safe
removal. Require the actual reclaimed result and its verified inventory. Do not
replace this operation with rm, manual unlink, moved files or hand-edited receipts.

Any error stops subsequent destructive stages. Preserve completed create or
quarantine results, remaining loose files, recovery originals and the backup.
On interruption, inspect current plan/verify/results and resume only missing
authorized stages; do not retry a stale plan, repack blindly, rerun business work,
or guess that a failed command rolled everything back. Invalid/missing backing
needs a verified backup/recovery choice; do not fabricate an index or force
reclamation. A dead lock needs its explicit recover-lock procedure and actual
owner evidence, never an age-based deletion.

## Restore and report

For an explicit restore request, verify first, then run
`{"action":"restore","archive_ids":["<selected actual archive ID>"]}`,
adding exact `refs` only if restoring a selected subset. Restore recreates original
paths/bytes and retains archives. A conflicting existing path is preserved and
reported; never rename/delete/overwrite it without a separate applicable choice.
Verify restored refs by original size/SHA and ordinary assistance read. Restore
increases loose storage; do not automatically reclaim it again.

Report the requested scope and actually completed actions; preserved facts and
excluded recovery material; unresolved/unreadable scope; archive IDs and backup
location; and the precise restore command using actual IDs. Compare before/after
regular-file counts and content bytes including archive backing, quarantine,
receipts and retained files. State backup bytes separately and include newly
created rollback copies in any all-location net-change claim. `reclaimed_bytes`
is bytes removed from quarantine, not net savings for the whole sequence. Do not
claim `.git` history, filesystem allocated space or all future cases were reduced.

Old logical IDs, bodies, digests, parents and attachment associations stay intact;
checking selected refs does not prove full task replay is bounded. When task state
preservation matters, compare read-only task-status before/after without refreshing
views. An excluded display/capture inode can still receive late writes and remains
outside immutable archive reclamation.

If Git persistence is explicitly requested, follow the existing git-commit Skill
and exact assistance git-checkpoint plan/index/commit verification; include the
necessary packs/indices and verified loose deletions. No git add ., automatic
commit/push, or event/commit loop recording a checkpoint's own SHA. Until then,
report local changes and backup coverage as they actually stand. The final
next_route is advisory (normally null for completed storage work), not permission.
