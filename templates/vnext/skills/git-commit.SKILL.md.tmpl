---
name: git-commit
description: Create one local Git commit for an explicitly intended change set; do not edit files, rewrite history, or push.
entry_contract:
  entry: git-commit
  mode: []
  intent: Create one local commit containing only the caller-authorized changes.
  input_contract:
    required:
      - repository
      - intended_changes
    optional:
      - preferred_message
      - workflow_result
  authority_owner: user
  mutation_boundary:
    product_files: []
    governance_sources: []
    forbidden_targets:
      - worktree file contents
      - changes outside intended_changes
      - history rewriting
      - branch changes
      - remotes and pushes
  internal_capabilities:
    - dangerous-operation-gate
  runtime_operations: []
  stop_conditions:
    - the repository or intended change set is ambiguous
    - unrelated changes are already staged
    - an intended path is missing or its current diff cannot be inspected
    - the commit fails or cannot be verified
  output_kind: git-commit-result
---

# vNext Skill: git-commit

## Intent

Create one local Git commit for the exact change set authorized by the caller. Do not modify file contents or manage workflow state.

## Operating rules

1. Inspect Git status and the staged and unstaged diff. When called after `execute-step`, use its commit scope, including the Runtime-written workflow document. If the intended set is unclear or unrelated changes are already staged, stop and ask the user.
2. Stage only the intended paths. Do not edit files, stage unrelated changes, or discard existing work.
3. Derive a concise commit message from the inspected diff unless the caller supplied one, then create exactly one local commit. Never amend, reset, clean, switch or create branches, or push.
4. Verify the new commit hash and committed paths. Report any remaining worktree changes.

## Required result

Return the commit hash, message, committed paths, remaining changes, and `next_route: null`, then stop. This invocation must not invoke another public Skill.

terminal_boundary: public-entry-terminal/v1
