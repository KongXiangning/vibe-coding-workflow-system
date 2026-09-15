---
name: review-change
description: Read the recorded step change, persist one review result, then stop.
entry_contract:
  entry: review-change
  mode:
    - default
  intent: Review the current recorded step or record bounded counterevidence to an earlier result without changing the implementation.
  input_contract:
    required:
      - current_task
    optional:
      - recorded_step_execution
      - external_counterevidence
  authority_owner: none
  mutation_boundary:
    product_files: []
    governance_sources: []
    forbidden_targets:
      - product files
      - test files
      - configuration files
      - direct governance writes
      - proposal or helper files
  internal_capabilities:
    - project-context-resolver
    - read-only-review-guard
    - diff-target-resolver
    - scope-guard
  runtime_operations:
    - task-state-transaction
  stop_conditions:
    - ordinary checkpoint review lacks a current executed step and verified review target
    - the review cannot be completed read-only
    - Runtime rejects the review result
  output_kind: review-result
---

# vNext Skill: review-change

## Intent

Review the cumulative task delta at the current checkpoint. Do not modify code, tests, configuration, or governance sources.

## Operating rules

Start with a fresh `validate --summary`, then follow **Bounded CURRENT_TASK
reading** in `.workflow-system/runtime/support/CONTEXT_API.md`. Read the full
definition range on first use. Reuse it only while it remains completely
visible in this conversation and task ID, document ID, and
non-null `evidence_plan_revision` still match the fresh summary; otherwise read it
again. Use the latest summary for status. For ordinary checkpoint review obtain
a fresh `review-context` with its cumulative diff and current evidence. Historical
counterevidence does not require a current reviewable execution; choose its route
before invoking ordinary `review-context`.

Use **Project document navigation** in
`.workflow-system/runtime/support/CONTEXT_API.md` to read the project sources
relevant to the admitted review target. Discovery may be broader than the diff;
it does not widen the review target or authorize task changes. Start with the
saved `project_documents` and `affected_contracts` returned by `review-context`,
read their relevant sections, and apply **Project document conflicts** in that
support file. Persist unresolved authority conflicts as blockers, not invented repairs.

Classify each new input using `route-input` with the exact current source revision,
input reference/hash, relation, requested operation and reason. Return the binding
and one of: unrelated -> capture/owner; conclusion counterevidence -> historical
review; execution error -> debug-task; goal/acceptance/total authority change ->
user decision or unsupported. Runtime checks binding and permissions; it does
not prove natural-language relatedness. Counterevidence is not product-fix authority.
For pasted or external text use `ingest-evidence` on stdin with source_revision,
source_locator and body, then cite the returned immutable evidence_ref/SHA-256.
Do not create helper files or request arbitrary absolute-path reads. Keep disputed
material contested until assessed; dismissal requires evidence, not convenience.

1. For an ordinary checkpoint, ask Runtime `review-context` for the successful `implemented` or `test-red` execution awaiting a required review checkpoint, Runtime-recorded cumulative change set, complete file index and bounded text diff, acceptance, validation evidence, mutation scope, Persistent Tests, and any admitted findings. Review only that target and context. A blocked execution, a step without a review checkpoint, or an already completed step is not reviewable. For new counterevidence to a previously completed result, inspect the exact claim/slot/result and retained source, then use `record-evidence-challenge` with a repository-relative evidence file and its SHA-256. This records `contested`, not an automatic invalidation or a new review verdict. If a contested challenge is demonstrably not substantiated, use `dismiss-evidence-challenge` with a hashed assessment file explaining why; retain the old report and challenge. Do not call `record-review-result` for a nonexistent current execution.
2. Check step compliance, scope, implementation or test correctness, acceptance coverage, validation evidence, unauthorized persistent-test changes, and regression risk. For historical `test-red`, verify that only frozen test assets were admitted, the assertions encode the required behavior, and the recorded failure is caused by missing behavior rather than syntax, type, import, fixture, tool, unrelated-test, or environment failure; Red carries no final acceptance evidence. New flexible execution requires no Red; explicit prerequisites use S2 bound reports and consumption receipts and must not be waived by review.
3. In discovery, report all clear repairable findings together. In verification, verify the admitted findings and affected regression surface; report any newly discovered issue without widening the repair yourself.
4. Return exactly one verdict:
   - `clean`: the recorded change is acceptable.
   - `findings`: include specific file, failure condition, required behavior, root-cause confidence, and evidence for each repairable issue.
   - `blocked`: include the blocker and recommended route when review or convergence cannot proceed safely.
5. Include `test_assessment: {applicable,reason,evidence_refs,necessity,oracle,boundary,reuse,applicability}` with explicit conclusions and supporting references. Read the cumulative delta; use `review-read` with its context receipt for unexpanded files and needed before/after ranges. Follow continuations before judging the relevant content; unavailable content is not clean. Do not replace dirty baselines with Git HEAD. Use `file-context` to locate/read reused tests and their dependencies; see `.workflow-system/runtime/support/CONTEXT_API.md` for inputs and limits. Check the original request and P-12 necessity/owner; whether expectations are independently specified; weak assertions and self-validation; mocks/fixtures versus real integration; reused test/claim mappings; current report and fixture versions. A production constant can supply input, but an expectation that changes with the same defective constant cannot independently detect that defect. Test files need not change for reused checks or fixture changes to trigger these dimensions. Local rule success cannot replace missing/failed required flow evidence. Use one verdict for the mixed diff. Runtime validates structure and binding, not the truth of this caller-reported judgment.
6. Send an ordinary verdict to Runtime `record-review-result` on stdin. For an earlier-result challenge, record the challenge or its evidence-bound dismissal through the corresponding Runtime action; a confirmed error requires correction. Do not create proposal or helper files in the project.
7. Do not repair code or advance the step. A recommendation must not invoke another public Skill.

## Required result

Return the Runtime-recorded `review-result`, inspected review target, findings or blocker, evidence, and at most one `next_route` recommendation for a later caller invocation. Then stop.

terminal_boundary: public-entry-terminal/v1
