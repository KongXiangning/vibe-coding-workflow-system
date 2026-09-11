schema_version: 1
kind: vnext-file-schema

# vNext File Schema

The canonical project surface contains the following governed documents:

- `.workflow-system/PROJECT_PROFILE.yaml`
- `.workflow-system/vnext/SOURCE_CONTRACT.yaml`
- `.workflow-system/vnext/RUNTIME_CONTRACT.yaml`
- `.workflow-system/WORKFLOW_PROTOCOL.md`
- `.workflow-system/FILE_SCHEMAS.md`
- `docs/workflow/CURRENT_TASK.md`
- `docs/workflow/task-basis/TASK_BASIS-<TASK_ID>.md`
- `docs/workflow/CONTRACTS.md`
- `docs/workflow/DECISIONS.md`
- `docs/workflow/STATUS.md`
- `docs/workflow/LESSONS.md`
- `docs/workflow/ROADMAP.md`

`CURRENT_TASK.md` carries its vNext YAML envelope and runtime state. Its body
contains the task identity, acceptance, Allowed / Conditional / Forbidden
scope buckets, implementation steps, test strategy, and execution evidence.

Every ordinary draft links one identity-derived Task Basis by exact path and
SHA-256 revision. The Task Basis preserves only the verbatim original request
and later explicit user decisions, each with an exact source locator. It is
written and read back atomically with `CURRENT_TASK.md`; author summaries and
draft review findings are forbidden because they are not request authority.

New and refined drafts use the same canonical `runtime_state` to store
`claim_evidence_required: true` and a bounded, non-empty `claim_evidence` plan
with at least one `acceptance` claim. Legacy documents may omit these fields
and remain readable, but require prepare-task refinement/migration before
`task-complete` or terminal close-task. Each record has `claim_id`,
`claim_kind`, and planned `slots`; each slot has `slot_id`, `minimum_type`,
`disposition`, and `evidence_refs`. Only `existing`, `reused`, and
`newly-executed` dispositions with refs are complete. `missing`, `deferred`,
and `blocked` slots prevent Runtime `task-complete` and close-task validation.
An active + active legacy task is migrated through the typed
`prepare-task:default:migrate-claim-evidence` transaction, which installs only
the non-empty acceptance-bearing plan and preserves the task's existing
identity, definition, scope, execution state, history, findings, review state,
and lifecycle tuple; it is not a replan or lifecycle supersede.
The plan shape is frozen at prepare/confirm time: execute-step may update only
slot disposition and refs, and cannot add, remove, or redefine claims or
slots. Aggregate command success, notes, and model summaries are not a second
evidence state source.

For an ordinary independent request, `CURRENT_TASK.md` is first written by the
typed `create-draft` action as `draft + active`. The definition is closed to
the existing task sections (`background_context`, `acceptance`, the three scope
buckets, `affected_contracts`, decision fields, plan/steps, regression checks,
rollback points, and conditional design/release/propagation sections). A
repeated `update-draft` keeps the same `TASK_ID`, `TASK_SLUG`, and `document_id`
and preserves execution/audit history. A draft has no execution authority.

Every new or refined draft has one canonical `Test Strategy` record under its
regression-checks section:

```yaml
test_strategy:
  mode: test-first | implementation-first | not-applicable
  source: explicit-user | project-policy | inferred-default
  source_ref: <exact Task Basis coordinate, project policy file, or prepare-task-default>
  task_classification: contract-clear-behavior | exploratory-or-infrastructure | non-executable-change
  rationale: <bounded one-line reason>
```

`source` records why the mode was selected; it is not another authority source.
`explicit-user` binds `source_ref` to an exact Task Basis source coordinate;
`project-policy` binds it to an existing repository-relative policy file; and
`inferred-default` uses the fixed `prepare-task-default` reference.
Selection precedence is exact: an explicit user requirement overrides an
applicable project policy, and an applicable project policy overrides the
prepare-task default. If no mode can be selected reliably, prepare-task must
resolve it as a user-owned open question before committing the draft. A
behavior-changing task cannot use `not-applicable` merely to avoid tests.
`test-first` requires at least one exact Persistent Tests asset; its first step
must contain every such asset and no non-test target. `implementation-first`
must place any declared persistent tests only in later steps; Persistent Tests
may remain `none` when evidence-first admission or an explicit user denial does
not authorize a new persistent test. `not-applicable` is valid only for
`non-executable-change`, requires Persistent Tests to be `none`, and requires
every Allowed, Conditional, and implementation-step mutation pattern to be an
exact path or provable subset of
`.workflow-system/PROJECT_PROFILE.yaml#boundaries.non_executable_change_paths`.
Entries in that project-owned boundary are limited to exact paths or literal
directory prefixes ending in `/**`; wildcard-bearing prefixes and all other
wildcard layouts are unusable for this classification.
That project-owned field is distinct from documentation inventory: Markdown
such as a Skill template or host guidance can change executable Agent behavior.
Missing, empty, repository-wide, or ambiguous classification blocks only a new
`not-applicable` draft, not either executable test-strategy mode; existing
active tasks are not revalidated. Runtime
revalidates these rules for raw create, update, confirmation, and replan
proposals. The whole task definition, including this
record, is frozen by `confirm-draft`; changing it afterward requires replan.
Legacy tasks without this record remain readable, but every new, updated, or
replanned semantic draft must add it.

For a confirmed `test-first` task, Runtime derives the first implementation
step as the Red phase and every later step as Green. The Red execution result
uses `outcome: test-red`; one or more planned command or validation results use
`status: expected-failure` and add this closed evidence object:

```yaml
expected_failure:
  kind: behavior-not-implemented
  expected_behavior: <behavior asserted by the test>
  observed_failure_signature: <bounded runner output identifying that failure>
```

All companion results must pass. `failed`, `blocked`, and `not-run` results,
or failures caused by syntax, type, import, fixture, tool, unrelated-test, or
environment problems, make the Red attempt blocked rather than successful.
`test-red` carries no acceptance evidence and cannot update claim-evidence
slots. A clean review of that recorded Red change set is required before
Runtime advances to later steps. Outside that first Red phase,
`expected-failure` and `test-red` are invalid; ordinary implemented results
still require every planned command and validation to pass.

The typed `confirm-draft` action is the only draft-to-active transition. It
must repeat the draft identity, carry the exact current `source_tuple.revision`
as `draft_revision`, include claim-bound evidence and explicit confirmation
authority, and confirm a non-empty frozen evidence plan with an acceptance
claim. Runtime then changes
the tuple to `active + active`; stale, malformed, unauthorized, or conflicting
proposals fail without mutating the canonical file.

## LESSONS.md durable marker schema

The current vNext marker contract is
`vnext-lesson-marker/canonical-v1` under `schema_version: 1`. A persisted
marker has exactly these keys and omits `disposition`:

```text
task_id, task_slug, document_id, archive_path, archive_revision,
source_revision, candidate_ref, candidate_digest, evidence_refs
```

A reused marker adds exactly `disposition: reused` and
`reused_candidate`, whose exact four-coordinate target is:

```text
task_id, document_id, archive_revision, candidate_ref
```

Persisted and reused identities share field validation: `task_id` is validated
as a task ID, `document_id` is `doc-` plus 24 lowercase hex characters,
`archive_revision` is an exact SHA-256, `candidate_ref` uses the safe key
pattern, and top-level `task_slug` is canonical lowercase kebab-case. The
`candidate_digest` covers only the seven semantic knowledge fields and excludes
`candidate_ref` and `evidence_refs`; digest or visible provenance mismatch is
`LESSON_PROVENANCE_MISMATCH`. Unknown or missing fields and invalid disposition
values are `LESSON_INVALID`; all non-canonical shapes fail closed.

`vnext-lesson-marker/canonical-v1` is the first supported durable Lesson marker
contract. If a future released supported durable schema changes incompatibly,
the ordinary Runtime reader must wait for an explicit schema-evolution /
offline-migration boundary instead of guessing or silently reinterpreting
durable state.

## Contract / Decision promotion marker schema

`close-task` performs final knowledge admission before archive and stores the
admission bundle in the canonical task archive. Only `admit`, `merge`, and
`supersede` create typed Runtime writes after archive:
`contract-candidate-commit` targets `CONTRACTS.md`, and
`decision-record-transaction` targets `DECISIONS.md`. `defer`, `reject`, and
`no-op` create no durable governance write. The Skill/model supplies the
semantic candidate and admission decision; Runtime validates and writes the
canonical document.

Each durable marker contains `schema_version`, `knowledge_kind`,
`candidate_id`, `candidate_fingerprint`, disposition, optional matched
predecessor, the complete closed candidate, archive/task provenance, proposal
idempotency/proposal digest, and semantic digest. The candidate uses the
existing resolver fields (`candidateId`, `kind`, `fingerprint`, `statement`,
`sourceRefs`, `applicability`, authority/stability/evidence, deduplication,
supersession, consumers, and Decision `decisionContext`). Existing equivalent
records are no-ops; identity, provenance, semantic, and idempotency conflicts
fail closed without overwrite.

### Optional Implementation Anchors

```yaml
implementation_anchors:
  coverage: observed | verified-scope
  source_revision: <workspace revision>
  anchors:
    - path: <safe repository-relative path>
      symbol: <optional stable symbol>
      role: <bounded role>
      evidence_refs: []
```

Anchors may be empty and are normally limited to 0–5 observed high-value
locations. They forbid absolute/traversal/wildcard/line-number locators and are
navigation hints only: not a dependency graph, completeness guarantee, scope
authority, or mutation authority. Future consumers validate path/symbol against
current code, then expand live references according to evidence and risk;
missing or stale anchors cause broader live search, not trust in historical
locations. close-task never performs a repository-wide completeness scan merely
to populate anchors.

## Inbox / record-only artifact

`capture-work-item:record` is bound to the vNext Runtime through
`inbox-record-transaction`. A proven-unrelated item is persisted only at
`TASKS/inbox/INBOX-<YYYYMMDD>-<short-id>-<slug>.md` using the closed inbox
record fields from the source File Schema. Runtime derives and validates this
path, requires complete relation evidence, `duplicate_check: clear`, and an
owner route, and writes at most one record. The transaction binds the current
task source tuple, returns exact replay as a no-op, rejects identity or
provenance collisions, and leaves `CURRENT_TASK.md` and all other task,
lifecycle, governance, and product files unchanged.

## Expert validation result

`validate-change` produces an ephemeral `validation_result` for one explicit
claim or behavior boundary. Its selected evidence is the minimum-sufficient
evidence admitted for that claim; it is not a durable project document. The
result records the target, `passed | failed | inconclusive | blocked` verdict,
selected evidence, observations, references, gaps, zero product/governance/
Runtime side effects, and a non-binding recommended route. The entry never
creates a persistent test or admits a finding. A persistent-test evidence gap
must be routed to an authorized entry for explicit P-12 admission.
