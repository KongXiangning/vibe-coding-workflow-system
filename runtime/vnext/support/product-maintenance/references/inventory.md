# Authorized business inventory

Read PRODUCT and summary catalog first. If absent, follow recovery.md to initialize
only the authorized project-owned manifest and assets; do not scan a project and
guess all ordinary Markdown files to be managed. Ask only about genuinely missing
material/scope, not permission already present in the request. Resolve the exact root.

Read selected business documents and needed implementation context. Inventory the
project positioning, goals, modules and complete known requirements, including
delivered capability, future/candidate scope, retired scope and unclassified items.
Do not create new business requirements merely to fill templates or match task count.
Code/report shows actual implementation or observed behavior, not confirmed user intent.
Existing explicit constraints in design retain their authority.

Create project.inventory with checked_sources and unreviewed_sources; partial is
normal when only one area was requested. Reconciled requires nonempty checked
sources and no unreviewed sources and means those listed sources only. Include
source digests when actual bytes were obtained; unknown versions stay unknown.
Use one current body per ID and allow multiple entries per file. A project entry
does not replace requirements' actual content. No task, design or module is required
to keep a known requirement visible. Unknown business fields say 未记录.

Use templates/PROJECT.md and REQUIREMENTS.md as formats, replace illustrative
content with source-grounded bodies. Check/apply with the actual read byte digest,
read back all affected entries and report unread scope. Pure inventory never
prepares/adopts a task or executes product code. Return the actual known business
picture and missing scope, not a schema-success completion claim.

Separate requested-path byte coverage, usable/invalid structure, inventory of the
listed business sources and scoped delivery results. An absent registered/selected
file, inaccessible relevant directory or skipped junction is unread coverage;
report its known path/pattern without guessing contents. Continue other readable
selected paths. A successful empty glob is an empty scope, not evidence that no
requirements exist elsewhere. source_paths grants reference reading only.
Selected concrete registrations remain expected under a glob; do not lose their
missing-file diagnostics. A static glob prefix must be an actual readable directory;
a file there does not prove zero requirements. Keep exclusions and unselected scope
out of coverage claims, and do not turn unrelated nonmatching files into missing scope.
For a moved file use stable identity only within already authorized known paths,
or update the explicitly known manifest path; unknown location remains unknown.

## Shared material sufficiency and prerequisite analysis

Use this analysis for inventory, reconcile and planning. First locate and read existing
relevant information (including source bodies, design, earlier decisions and dispositions),
then compare contradictions, and only then identify real gaps. A separate document is
not required when the needed rule already exists in available material. Neither a missing
file type nor a template heading proves missing business information.

Distinguish four cases:
- Known material is unread/unavailable: keep its actual source in unreviewed_sources
  and state the reading problem, not a fabricated missing file or business conclusion.
- Read information conflicts: show the actual conflicting scope and sources; do not
  choose by timestamp or silently discard an explicit constraint.
- Information necessary for the current decision/work is unspecified: describe the
  precise unanswered question and when it affects the work, without inventing an answer.
- Future/optional improvement: keep it a suggestion, not a current requirement or gate.

For each important issue retain affected scope, evidence, impact, unknown portion and
current disposition. Reuse the existing location if this is already recorded. Place
unestablished candidates/decisions in the project or applicable plan's unresolved body;
known unread sources use inventory. Do not score document completeness with assessment:
assessment is exclusively the existing scoped delivery/verification account.

A proposed prerequisite must explain why it is needed, whether it is currently met
(and on what evidence), whether it is a business rule, design condition, implementation
work or external condition, and when it is needed (development, integration or delivery).
Consider the smallest reusable existing capability. For example, locating the original
payment transaction may use an existing provider transaction ID/query; it does not imply
building a wallet subsystem. An optional architecture choice is not a mandatory prerequisite.
If an unknown condition affects only integration/delivery, say so and preserve independent
work that is already authorized; non-blocking never means pretending a real condition met.

Read prior dispositions before reanalysis/retry. Do not revive a declined suggestion
without new material evidence or an explicit current reversal. A current user reversal
is usable basis under the existing rules; do not introduce a separate candidate-approval
workflow. Once an authorized decision adopts a candidate, update the corresponding
requirement, design or work arrangement with its basis and resolve/reference its former
unresolved location instead of maintaining duplicate current conclusions.

## Older project material within the requested inventory

For a requested business overview, source registration is the starting point. Read
selected original bodies, then combine update, plan and reconcile as applicable:
- Preserve complete goals/requirements and source-backed delivered coverage, not
  just document titles or a list of uncompleted tasks.
- If an old plan is still adopted/applicable, retain its scope and stable work IDs
  in plan/work_items; a historical or undecided plan is not newly adopted. Current
  explicit arrangements may be saved without reconstructing the entire old order.
- Associate reliable historical task identities through TaskBinding with precise
  coverage. Unknown identity uses task_id=null and a locatable original source;
  a display number is not a guessed identity. Never prepare/reopen old work.
- For relevant material CR/decision changes, use change with original before/after
  and source; unknown old meaning stays null with explanation. recorded_at is the
  actual recording time, not an invented historical occurrence date. Do not migrate
  every CR or archive all history as a prerequisite.

Process useful batches and read back bodies, bindings, arrangements, progress and
remaining scope. Say which requested outputs are still missing even if every listed
source was read or Schema passed. Respect existing PRODUCT identities and prior
successful writes; only supplement unresolved work on retry.
