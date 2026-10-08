# Host-Agent requirement evolution acceptance

## Result

Completed the thick baseline and all seven incremental business requests using the installed `maintain-project` Skill, product-maintenance Node helper, and assistance task service. These are **synthetic business materials in an isolated installed host**, with a **real local parser/test run and real synthetic service task**. They are not production-product checks or fabricated prefilled service outcomes.

No source repository files, external services, real user projects, Git commits, or pushes were used. No helper operation was rejected, so recovery was not needed. No implementation or tests were run after the initial baseline. Stage decisions were made from the natural-language inputs by the host Agent; the retained scripts serialize those decisions and call the real services.

Final audit: 13 preservation checks verified. Managed read covered 7 files, 24 usable items, 0 invalid items, and 0 omissions. Two expected `DEFINITION_CHANGED` warnings remain for historical assessments. Schema/read completeness is not a delivery claim.

## Baseline established before evolution

- Original material is captured verbatim at `host-evolution/docs/product/history/00-baseline-input.txt`
- Canonical assets include project positioning, `GOAL-MONTHEND`, complete `REQ-IMPORT`, shared `REQ-OFFLINE`, current unimplemented `REQ-EXPORT`, candidate `REQ-MULTI`, adopted `DES-LOCAL`, and `PLAN-LAUNCH`
- Plan work IDs: `WI-IMPORT-FIRST`, pending `WI-IMPORT-NEXT`, pending `WI-EXPORT`, deferred `WI-MULTI`
- Real task: `task-1d991d0962e5673c41f5e57b0a869ed9` / `TASK-001`
- Real task plan ref: `.workflow-system/records/events/key-89df00c31b616b71a16c95e112b0c840fb63987d90fb6b0caef684195044fb48.json`
- Original requirement binding: `B-IMPORT-FIRST`, persisted before parser creation/testing
- Actual command: `node --test synthetic/integer-parser.test.mjs`
- Actual result: exit 0, 3 tests passed. Cases cover exact positive/negative/large integer conversion to cents, invalid raw values and physical line numbers including decimal rejection, CRLF and explicit unsupported-header rejection
- Parser SHA-256: `b4ce0a58c31736899abd18448f7566a27ef9f98c2ed328101169c756b76aecfb`
- Test source SHA-256: `2f6e0980f2ea5146949ac29f14cc355a4063433b0ea33f4231a73236b3348200`
- Raw test output SHA-256: `c21ca4888ee927083e1e108c06812b25b7134b40e5309307353ed28ce651a5d4`
- Scoped historical assessment: `ASS-INTEGER-INITIAL`, implementation `partial-reported`, verification `pass-reported`, linked to immutable original requirement bytes and exact code/test/report sources
- Original requirement definition: `1e4c7a0adfbfbb68e79add716158f6883f0b14e76ba835dfebcdc6e4b72dde3d`

The task was then closed with explicit remaining work and no independent review. Closure did not finish the step or certify the product. Final state still has one unfinished step, one execution observation, one test observation, zero reviews, and zero commits.

Proof before all later changes: `03-baseline-checkpoint.json`, `03-baseline-final.output.json`, `03-task-before-close.output.json`, `03-task-baseline-closed.output.json`. Initial binding readback is `02-binding-readback.output.json`. Exact local delivery basis is `host-evolution/docs/evidence/initial-delivery-basis.json`.

## Stage and evidence map

Each prefix below has the exact staged input capture, host decision, before/readback requests and real outputs, apply requests/results, and operation receipts. Originals live in `host-evolution/docs/product/history/<prefix>-input.txt`. Every stage reloaded the installed Skill and queried actual task state before proceeding.

| Stage | Host business judgment and saved result | Key evidence prefix |
|---|---|---|
| 1 | Same outcome, numeric tuning: 50% → one-third keeps `GOAL-MONTHEND`. Only goal, affected design metric wording and plan coverage were synchronized. Requirement/assessment files unchanged | `10-stage1`; `10-stage1-unchanged.json` |
| 2 | Material outcome replacement: retire old goal and create `GOAL-ANOMALY` with replacement link. Keep single-user/offline/no-upload/import/export/future boundaries. Add planned `REQ-ANOMALY`; unknown business anomaly rules and speed criterion remain explicit. Export still pending; priority/new-goal fit and detailed anomaly design remain unsynchronized | `20-stage2`; before/after impact bodies and `CHG-GOAL-REPLACE` |
| 3 | Implementation batches only: withdraw pending `WI-IMPORT-NEXT`; add `WI-IMPORT-READ` and `WI-IMPORT-LOCATE`, both under unchanged `REQ-IMPORT`. Preserve initial delivery work item, task and PASS; do not create tasks | `30-stage3`; `30-stage3-preservation.json`; task-after output |
| 4 | Genuine independent acceptance: retire original `REQ-IMPORT`; create `REQ-IMPORT-VALID` and `REQ-IMPORT-ERROR`, both derived from original. Preserve original task binding and PASS at original owner. Add separately scoped historical reference bindings, not new implementation task claims or copied PASS. Keep each destination's unconfirmed scope | `40-stage4`; before/after readbacks and `CHG-REQUIREMENT-SPLIT` |
| 5 | Merge business commitment: retire split requirements and create `REQ-IMPORT-MERGED` replacing both. Keep split/merge destinations and all original history. Retain two implementation batches under one complete acceptance. Select new `ASS-MERGED-UNVERIFIED`, not the old PASS | `50-stage5`; `50-stage5-integer-wording.json`; assessment readback |
| 6 | Tighten same merged requirement: integers and ≤2 decimal places must convert exactly to cents; >2 decimals rejected with original line number. Update requirement and related arrangements only. Preserve design/implementation bytes and mark design detail unsynchronized. Select `ASS-DECIMAL-UNVERIFIED` with no new run; historical rejection of 1.25 is not represented as a new reproduction | `60-stage6`; `60-stage6-preserved-implementation.json` |
| 7 | Restore old integer wording and relevant plan scope; retain decimal change and assessment history. No code rollback or test rerun. Restored definition exactly equals stage 5, yet current selection remains `ASS-RESTORED-UNVERIFIED`, implementation unknown, verification not-run | `70-stage7`; `70-stage7-restoration-check.json`; final task readback |

Restored and stage-5 merged definition SHA-256 both equal `c6b620383269fd27dbe18ba5158084f0ada3fcf54d879cff321a8b8aa283e5ee`.

## Preserved facts and limits

- Original `REQ-IMPORT` binding retained exactly; `ASS-INTEGER-INITIAL` metadata and body content retained, ignoring trailing document-separator whitespace
- Goal replacement and requirement split/merge preserve old identities; no type or identity reuse
- No later task prepared, reopened, focused, or implicitly executed; there remains exactly one closed task
- No independent review fabricated; historical self-check is explicitly labeled
- Parser, test source, raw report, and unchanged stage-6/7 design bytes verified by SHA
- Current merged requirement does not select historical PASS even after exact definition restoration
- Offline, export, and future-multibook requirement body content remains unchanged from baseline, ignoring trailing document-separator whitespace
- Only historic definition mismatch warnings remain; those do not block maintenance and do not claim current code failure or success

## Final unverified scope

Current complete merged integer import has no fresh verification. Quoted/multicolumn CSV, large-file compatibility, broader error boundaries and user-facing location experience remain unconfirmed. Export is still unimplemented, with structure and priority/new-goal necessity unresolved. Business amount-anomaly rules and “quick” criterion remain undefined; malformed-field line numbers are not treated as the complete accounting anomaly solution. Full runtime privacy audit and real-user outcome measurements have not occurred. Decimal acceptance is historical/withdrawn from current wording, with no implementation or rollback performed.

## Final evidence

- `80-audit.json`: 13 checks, task counts, exact restored definition and implementation digests
- `80-check.output.json`: real helper structural/reference check
- `80-final-read.output.json`: complete selected managed scope plus source-byte status
- `80-final-task-summary.output.json`: real final task state
- All `.input.json`, `.output.json`, `.receipt.json`, `.stderr.txt` files preserve ordered requests and actual service outcomes; preimage captures retain prior document bytes

`next_route: null` — all authorized synthetic acceptance stages are complete; remaining implementation and verification were explicitly excluded from the last stages.
