# Host consumer interpretation of unchanged installed multiple-plans sample

This is a human/model interpretation after reading actual bodies from the installed helper and standalone offline reader. The sample is supplied synthetic material, not observed business execution. Exact sample IDs include PLAN-IMPORT, so no adaptation was needed. The caller expressly selected PLAN-IMPORT; I did not infer a selection from file order, timestamp or adopted status.

## Complete read: business picture

The current goal is reliable handling of agreed import inputs. REQ-IMPORT remains current and includes valid inputs, erroneous inputs and newly added dual-device inputs, while retaining the single-device behavior. Adding file formats is excluded. The work must be checked separately for each input scope.

REQ-AUDIT is a current shared constraint across import stages: record results/errors without raw personal data, and check actual logs for redaction and result location. It has no independent work item, direct plan target or TaskBinding, but the selected import plan expressly carries it as a shared constraint. Its lack of those graph edges is not proof of omission; actual compliance remains unverified.

REQ-EXPORT is planned, outside the near-term arrangement and still part of known scope. REQ-STREAM is a candidate, not adopted, without adopted acceptance. REQ-LEGACY is retired historical scope: retirement is neither delivery nor restoration. No scope disappears merely because it lacks a task.

## Selected arrangement: PLAN-IMPORT

PLAN-IMPORT is adopted in the supplied document, covers REQ-IMPORT across near and later stages, and follows a hybrid strategy. This reading does not adopt it again or create/execute tasks. Original work-item presentation order is preserved:

1. W-VERIFY — stage 近期核对. Outcome/scope/coverage: errors feedback and existing single-device coverage
2. W-BASE — stage 近期实施. Outcome/scope/coverage: near-term partial dual-device input work
3. W-RELEASE — stage 后续交付. Outcome/scope/coverage: remaining inputs and integrated re-verification, with details still to be checked

All three are included plan members; included is not execution completion. REQ-IMPORT is covered across those stages, not given a unique implementation/completion rank. The only explicit engineering prerequisite is W-RELEASE requiring the actual dual-device capability from W-BASE. Historical task closure cannot satisfy that condition. W-VERIFY/W-BASE have no explicit dependency: neither serial execution nor safe parallelism can be deduced from array order or missing edges.

## Other plans remain separate

PLAN-EXPORT is proposed and covers the later export candidate. Its single W-RELEASE has stage 后续候选 and covers export design and acceptance-scope clarification. The identity (PLAN-EXPORT, W-RELEASE) differs from (PLAN-IMPORT, W-RELEASE). No starting date is decided, and this plan does not replace or merge into the selected import plan.

PLAN-LEGACY is retired and covers former legacy-format scope. Its empty work_items preserves history; it does not establish completion or silently reactivate old work.

## Evidence and unknowns

AS-BASE reports partial implementation and a historical single-device-valid-input pass. Its tested code version is unknown, its requirement-definition alignment is unknown, and pending_sources still names new dual-device scope and error feedback. These are supplied synthetic historical statements, not checks I ran. I did not query or reconstruct current task state for example-closed-base-task. B-BASE provides only historical single-device coverage and does not become a current whole-requirement delivery certificate.

Both full readers read six managed files / eleven usable items with complete requested-path byte coverage. The project inventory nevertheless remains partial: other business materials are unreviewed. Current error, dual-device and shared-audit implementation and verification remain unknown. Schema/reader parity cannot answer those business questions.

## Partial-read experiment

The installed helper was run with paths=[docs/product/REQUIREMENTS.md] and detail=items. It read exactly one file / five requirements, with complete byte coverage only for that selected path and no omitted selected file. From this isolated result, I can confirm the five requirement definitions/scopes, their exclusions and acceptance text, and the limited B-BASE historical binding declaration.

From the partial result alone, I cannot confirm the goal/project inventory, the actual PLAN-IMPORT body/order/stages/dependencies, the other plans' state/content, or AS-BASE's full evidence and pending sources. The request's selected ID is known intent, not evidence that this limited read acquired its plan. PROJECT_ENTRY and UNRESOLVED_TARGET diagnostics reflect unselected context; they do not establish that the sample globally lacks those objects. Empty plan output is not “no plans.” The full read provides those additional facts separately.

The installed standalone CLI accepts an explicit root and was tested for a full read only. Path-limited reading was exercised through the installed maintenance helper; I did not modify the reader or sample to manufacture a partial standalone pass. Copy file hashes were identical before/after and matched the installed sample.
