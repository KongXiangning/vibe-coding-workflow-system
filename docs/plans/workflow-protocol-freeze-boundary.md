# WORKFLOW_PROTOCOL Freeze Boundary

Status: Active
Owner: kongx
Last-Updated: 2026-04-02

This document is the single update location for `WORKFLOW_PROTOCOL.md` freeze scope, update rules, and post-review boundary decisions.

The implementation plan remains a frozen baseline and should not be used as the rolling location for freeze-policy edits.

## Freeze conclusion

`WORKFLOW_PROTOCOL.md` is eligible for **partial freeze evaluation**, but it is not globally frozen.

Current interpretation:

- the `P1-P6` implemented surface is the current stable protocol baseline
- the protocol must not be treated as fully frozen across `P7a-P11`
- future phases may extend the protocol, but they must not silently rewrite already-aligned `P1-P6` semantics

## In-scope freeze surface

The current partial-freeze scope covers:

- protocol core rules already consumed by implementation and tests:
  - input precedence
  - placeholder grammar
  - path grammar
  - canonical stage enum
  - skill metadata schema
  - handoff rules
  - atomic write contract
  - structured error shape
  - machine-checkable success criteria
- implemented generator contracts:
  - `gen:workflow-skills`
  - `gen:workflow-docs`
  - `gen:registry`
- the protocol-layer sync model defined in `P6`

## Out-of-scope freeze surface

The following remain open and are outside the current freeze scope:

- `P7a` bootstrap planning and dry-run contract
- `P7b` task identity contract
- `P8` project-level validation model and blocker contract
- `P9` additional CI/reporting wiring beyond the currently implemented checks
- `P10` runtime entrypoints and import/install contract
- `P11` versioned long-term governance

## Update rules

After this point, updates to `WORKFLOW_PROTOCOL.md` must follow these rules:

- do not describe an unimplemented capability as already implemented
- do not promote a future-phase contract into a current mandatory rule without matching implementation/test alignment
- do not change `P1-P6` semantics as incidental wording cleanup; such changes must be treated as protocol changes
- any semantic change inside the partial-freeze scope must be checked against:
  - implementation behavior
  - `test:workflow-*`
  - the current implementation plan's phase ownership
- future-phase additions should be appended as explicit extensions or boundary sections, rather than back-editing stable baseline meaning

## Post-review boundary decisions

- 2026-04-02: path grammar inside the `P1-P6` stable baseline is clarified to allow only restricted terminal directory-recursive patterns of the form `dir/**`
- this is a semantic correction within the existing path grammar and generator validation surface, not a future-phase extension
- the implementation and `test:workflow-*` coverage must stay aligned to this exact boundary:
  - explicit relative paths are allowed
  - terminal `/**` is allowed
  - other wildcard forms remain invalid
- 2026-04-02: repo-wide path semantics are explicitly split into two layers:
  - workflow protocol fields (`reads`, `writes`, `forbidden_writes`) remain on the restricted baseline above
  - repo-level governance/discovery fields in `PROJECT_PROFILE.yaml` may use a separate repo-pattern grammar
- this layered clarification does not widen the frozen `P1-P6` workflow contract; it only prevents repo-level glob use from being misread as a protocol change
- 2026-04-03: the P6 sync model is clarified to treat extra live-only headings or sections outside the generated contract as `incompatible and diff-only until confirmed`
- this is a baseline clarification inside the existing P6 protocol surface, not a new execution-layer capability
- this clarification does not change `P7a-P11` ownership and does not imply that sync tooling already implements the classification

## Operational use

Use this document when:

- evaluating whether a proposed protocol edit is inside or outside the frozen baseline
- deciding whether a protocol change is additive or semantic
- recording future refinements to the freeze boundary without reopening the implementation plan

Do not use the implementation plan as the working log for freeze-policy updates unless the plan itself is being intentionally reopened.
