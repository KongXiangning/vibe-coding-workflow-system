# Repo Path Grammar

Status: Active
Owner: kongx
Last-Updated: 2026-04-02

This document defines the repo-level path and pattern grammar used outside the workflow protocol contract.

## Summary

The repository now uses two path grammars:

- `Workflow Path Grammar`
  - applies only to workflow contract fields: `reads`, `writes`, `forbidden_writes`
  - allows explicit relative paths and terminal directory-recursive patterns of the form `dir/**`
- `Repo Pattern Grammar`
  - applies to repo-level discovery, governance, ownership, and test-selection fields
  - allows explicit relative paths plus limited glob support with `*` and `**`

These grammars are intentionally separate. Repo-wide glob usage must not be read as widening the workflow protocol contract.

## Workflow Path Grammar

Used by:

- workflow skill frontmatter `reads`
- workflow skill frontmatter `writes`
- workflow skill frontmatter `forbidden_writes`
- `PROJECT_PROFILE.yaml` `boundaries.forbidden_paths` because it expands into `{{FORBIDDEN_PATHS}}`

Allowed:

- `scripts/foo.ts`
- `generated/workflow-docs/**`
- `.git/**`

Invalid:

- `*.ts`
- `**/*.md`
- `foo/**/bar`
- `**`

## Repo Pattern Grammar

Used by:

- `paths.documentation_files`
- `paths.existing_skill_template_patterns`
- `paths.generated_artifacts`
- `boundaries.generated_only_paths`
- `boundaries.workflow_owned_paths`
- `governance.current_documents`
- diff-based test selection patterns in `test/helpers/touchfiles.ts`

Allowed syntax:

- explicit relative paths such as `SKILL_REGISTRY.md`
- single-segment wildcard `*`
- multi-segment wildcard `**`

Examples:

- `*/SKILL.md.tmpl`
- `templates/docs/*.md.tmpl`
- `**/SKILL.md`
- `browse/dist/**`

Still invalid:

- absolute paths
- `..` traversal
- control characters
- unsupported glob syntax such as braces, character classes, or extglob

## Shared Implementation

The shared implementation lives in [`scripts/workflow-core.ts`](/e:/coding/github/gstack/scripts/workflow-core.ts):

- workflow restricted grammar:
  - `validatePathEntry`
  - `validatePathEntries`
- repo-level pattern grammar:
  - matcher and entry validation in [`repo-path-patterns.ts`](/e:/coding/github/gstack/scripts/repo-path-patterns.ts)
  - profile field classification in [`workflow-core.ts`](/e:/coding/github/gstack/scripts/workflow-core.ts)
  - `validateRepoPatternEntry`
  - `validateRepoPatternEntries`
  - `repoPatternMatchesPath`
  - `validateProfilePathSemantics`

Validation rule:

- `boundaries.forbidden_paths` remains workflow-facing and is still required because it feeds `{{FORBIDDEN_PATHS}}`
- other repo-level pattern fields are validated when present; they are not promoted into mandatory generator inputs just by sharing the grammar

Any new consumer of repo-level path fields must use these shared helpers rather than introducing a private matcher.
