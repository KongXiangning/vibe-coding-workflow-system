# Vibe Governance Distribution / Installer

Status: Approved (Phase 1 design frozen)
Owner: `vibe-coding-workflow-system` maintainers
Version: 1.0
Updated: 2026-09-04
Product: **Vibe Governance**  
CLI / package working name: **`vibe-governance`**  
Runtime: **Vibe Governance Runtime**

This document freezes the vNext Distribution Boundary. It is additive to the
accepted vNext Runtime, bootstrap, and Migration Pack contracts. It does not
rename the existing project-local `.workflow-system/` storage path.

## Document positioning

- Type: architecture / distribution boundary
- Purpose: define the reproducible software-delivery surface and its fail-closed
  install, migration, upgrade, ownership, and transaction contracts.
- Audience: maintainers of the source repository, release engineering, and
  implementers of target-project installation tooling.
- Necessity level: M0; without this boundary, software delivery can be
  mistaken for project governance initialization or can leave an unsafe hybrid
  installation.

## Scope

This freeze covers the Phase 1 Node Distribution CLI, release manifest and
payload, canonical Agent Skill layout, project-local Runtime delivery, explicit
Distribution state transitions, legacy Migration Pack orchestration, internal
changed-path calculation, scoped rollback, and target read-back validation.

Project governance initialization remains the `bootstrap-project` Agent Skill
boundary.
The explicit non-goals in section 10 are outside this freeze.

## 1. Boundary and state model

Distribution state is software-delivery state. Governance state is project
truth. They are separate state machines and neither may be inferred from the
other.

The Distribution classifier has exactly these states:

```text
uninstalled
legacy
vnext(version)
```

The permitted Distribution transitions are:

```text
uninstalled -> install  -> vnext(current)
legacy     -> migrate  -> vnext(current)
vnext(old) -> upgrade  -> vnext(current)
```

`pure vNext` may remain as a descriptive phrase for a compatibility-free
surface in historical evidence, but it is not a project-wide state and is not
used by the Distribution classifier.

Governance remains independent:

```text
install
-> vNext distribution installed
-> governance not bootstrapped
-> invoke the `bootstrap-project` Agent Skill
-> governed project
```

`Install != Bootstrap`. The Installer must not infer or write project business
facts, `PROJECT_PROFILE.yaml`, Contracts, Decisions, STATUS, or a task
definition. A fresh install therefore has no canonical `CURRENT_TASK.md` and
no project governance profile. Daily Runtime entrypoints return
`BOOTSTRAP_REQUIRED` until bootstrap has established those facts.

## 2. Explicit command admission

The official user-facing surface is an ephemeral Node package:

```bash
npx vibe-governance@latest install
npx vibe-governance@latest migrate
npx vibe-governance@latest upgrade
```

CLI argument admission is fail-closed: `--root` must be followed by a
non-empty project path that is not another flag. A missing value never
resolves to the current working directory, and malformed arguments are
rejected before any Distribution operation is dispatched.

The commands are strict dispatches:

| Command | Admitted source state | Result | Forbidden implicit action |
|---|---|---|---|
| `install` | `uninstalled` | install, or same-version no-op | legacy conversion or vNext upgrade |
| `migrate` | `legacy` | independent Migration Pack conversion and install | fresh install or vNext upgrade |
| `upgrade` | `vnext(old)` | safe/idle vNext replacement | legacy parsing or conversion |

`install` reports `migration-required` for a legacy target and
`upgrade-required` for an older vNext target. `migrate` never interprets a
legacy document itself; it orchestrates the independent Migration Pack.
`upgrade` never falls back to migration.

The optional `next` result/CLI hint is neutral text. Its value and plain CLI
rendering are:

```text
Next:
  invoke the `bootstrap-project` Agent Skill
```

It is returned only after an `uninstalled -> vnext` installation commits
successfully. Same-version `install` no-ops, successful `migrate`, successful
`upgrade`, and dry-run previews do not return or print that hint because none
of those outcomes means governance bootstrap is next. Distribution does not
encode Codex's `$bootstrap-project` syntax or another host's invocation
syntax.

The package is a distributable release artifact, not a requirement that the
artifact came from npm. Its payload is self-contained and reproducible so a
future CI or offline installer can use the same boundary. Portable bundle
validation binds artifact content hashes while allowing the package path and
local Git revision to differ between build and install machines. A target project
does not need Bun, the workflow-system source repository, `WORKFLOW_SYSTEM_ROOT`,
`gen:*`, `workflow:pack`, `workflow:sync`, or manual bundle/path selection.

## 3. Legacy Migration Pack boundary

The Migration Pack remains the only legacy-aware implementation. It owns
legacy protocol/schema reading, idle checks, offline structural conversion,
provenance, and legacy-surface removal. The Distribution CLI only supplies its
embedded release inputs and invokes its public API.

Migration keeps the existing safety contract:

- idle-only conversion;
- offline, deterministic conversion;
- fail closed on unsupported, ambiguous, frozen, or non-idle state;
- validation before vNext promotion;
- no legacy/vNext hybrid successful installation;
- rollback and read-back verification on promotion failure.

The Distribution journal may be present while the Pack runs; it is a recovery
boundary, not a legacy input. Pack conversion semantics are not duplicated in
the normal Installer or the Vibe Governance Runtime.

## 4. Canonical Skill and Runtime surfaces

The vNext canonical Agent Skill surface is the loader-native directory layout:

```text
.agents/skills/<skill-name>/SKILL.md
```

The release payload contains the prebuilt nine-entry vNext Skill set:

```text
.agents/skills/bootstrap-project/SKILL.md
.agents/skills/prepare-task/SKILL.md
.agents/skills/review-change/SKILL.md
.agents/skills/execute-step/SKILL.md
.agents/skills/debug-task/SKILL.md
.agents/skills/task-lifecycle/SKILL.md
.agents/skills/capture-work-item/SKILL.md
.agents/skills/close-task/SKILL.md
.agents/skills/validate-change/SKILL.md
```

Each Skill uses the loader-native directory layout
`.agents/skills/<skill-name>/SKILL.md` and begins with standard Agent Skill
frontmatter containing a matching `name` and a non-empty `description`,
followed by the vNext-specific `entry_contract`. A flat
`.agents/skills/<skill-name>.SKILL.md` file or a Skill without the required
standard metadata is not a valid vNext target.

New Distribution metadata does not contain `hosts: ["codex", "claude"]` or
another paired-host installation model. Existing `.codex/skills/`,
`.claude/skills/`, and `.factory/skills/` code is retained only where it is
needed to recognize/remove the old source-repository or legacy compatibility
surface. It is not a new vNext canonical target.

The target project's Runtime remains a fixed project-local installation:

```text
.workflow-system/runtime/
├── dist/cli.js
├── package.json
├── package-lock.json
├── src/
└── node_modules/
```

Daily Skills call that fixed Runtime directly, for example
`node .workflow-system/runtime/dist/cli.js apply --root .`. They do not call a
global long-lived Vibe Governance executable. The Runtime may continue to use
`package.json`, `package-lock.json`, and an internal `npm ci --omit=dev`
staging step; those are implementation details hidden from target users.

### 4.1 Bootstrap consumes Distribution; it does not own it

`bootstrap-project` runs only after the Distribution boundary has installed and
read back the project-local Runtime, Protocol, Schema, and nine canonical Agent
Skills. Bootstrap may validate those assets as read-only prerequisites, but it
does not regenerate, stage, promote, or receipt-own any Distribution-managed
software path. Its mutation set is limited to project identity, canonical
governance documents, mode-dependent design/adoption evidence, paired host
guidance, and Bootstrap transaction provenance.

`BOOTSTRAP_RECEIPT.json` is therefore a record of one Bootstrap transaction,
not a universal governed-vNext validity token. A fresh installed project needs
Bootstrap to establish governance. A project whose idle legacy state was
successfully converted by the Migration Pack is already governed through
Migration Pack provenance and canonical governance state; it does not become
`incomplete` merely because no Bootstrap Receipt exists. Distribution upgrades
must not make a Bootstrap Receipt stale by changing software checksums.

## 5. Release Distribution Manifest

Every release package carries one minimal
`distribution-manifest.json`. It describes distribution-owned artifacts only:

```yaml
kind: vibe-governance-distribution-manifest
product: Vibe Governance
package_name: vibe-governance
distribution_version: <release x.y.z>
minimum_node: ">=20.0.0"
runtime_dependency_path: .workflow-system/runtime/node_modules
artifact_source: embedded-release
artifacts:
  - source_path: vnext-bundle/<payload-file>
    target_path: <concrete-project-relative-path>
    category: protocol|schema|skill|runtime|config
    required: true
    checksum: <sha256>
state:
  path: .workflow-system/vnext/DISTRIBUTION_STATE.json
  in_progress_path: .workflow-system/vnext/DISTRIBUTION_IN_PROGRESS.json
support:
  bundle_path: vnext-bundle
  migration_source_path: migration-source
  bundle_manifest_sha256: <sha256>
manifest_digest: <sha256>
```

The manifest has default-deny ownership. Only its explicit `target_path`
entries, plus its explicit state/journal paths, may be written by the
Installer. In Phase 1 the owned target set is limited to the vNext protocol,
schema, Runtime package, Runtime references, Runtime contracts, and
`.agents/skills/<skill-name>/SKILL.md`. It does not include project profile, governance
documents, `docs/workflow/CURRENT_TASK.md`, Contracts, Decisions, STATUS, or
task definitions.

The fixed `runtime_dependency_path` is the one explicitly declared derived
directory produced by the Runtime's `npm ci` staging strategy; no other
generated dependency path is admitted. The embedded `vnext-bundle` may contain the canonical baseline
`CURRENT_TASK.md` needed by the independent Migration Pack. That artifact is
not a fresh-install Distribution-owned target; only the Migration Pack may
promote it during legacy conversion.

Manifest validation is strict: schema/kind/product/package identity, Node
minimum, canonical target paths, deterministic ordering, manifest digest,
bundle-manifest digest, every artifact checksum, standard Agent Skill metadata,
and the shared vNext bundle validator must pass before any target mutation. No
`hosts` field is accepted.

Phase 1 uses lockstep release versioning. The release builder rejects a release
unless the Distribution package version, Runtime package version, Runtime
contract `runtime_distribution.package_version`, Runtime source constant
`VNEXT_RUNTIME_PACKAGE_VERSION`, and the generated Runtime constant all match.
The Distribution layer admits only plain release SemVer `x.y.z`; prerelease and
build metadata are not accepted until version comparison is upgraded to full
SemVer semantics.

## 6. Distribution State and governance separation

The Installer writes only a small Distribution State record:

```text
.workflow-system/vnext/DISTRIBUTION_STATE.json
```

It records the Distribution state/version, manifest digest, install time,
manifest-owned file checksums, compatibility absence, and the recovery
boundary. It contains no project identity, business facts, Contract, Decision,
STATUS, or task definition.

The classifier treats a malformed state, a managed-target drift, a mixed legacy
surface, or an interrupted journal as invalid and fails closed. It never
repairs such a target by guessing.

Upgrade ownership convergence is state-format-sensitive. For an admitted
current-format `DISTRIBUTION_STATE.json`, `managed_files` is authoritative even
when it is empty. After every old managed file passes the recorded checksum
check, the upgrade delete set is exactly:

```text
oldManagedPaths - currentManifestPaths
```

This removes Distribution artifacts that the newer release intentionally no
longer declares, including obsolete `.agents/skills/<skill-name>/SKILL.md`
files and removed Runtime source files. A drifted or missing old managed file
blocks the upgrade before promotion.

The first upgrade from the older
`.workflow-system/vnext/INSTALL_STATE.json` format does not use that set
difference. That state had a wider and less precise compatibility surface, so
it uses a separate conservative mapping for known legacy host files; entries
outside that mapping are preserved rather than treated as Distribution-owned.
The two state formats therefore never share a blanket deletion algorithm.

## 7. Internal changed paths and transaction protocol

Users do not provide `--path` or `--paths-file` to Distribution commands. The
Installer calculates changed paths from the validated Manifest and the target
state, then internally validates the exact set. Bootstrap's separate
changed-path/conditional-authorization protocol is unchanged by this design.

The transaction is not described as one cross-directory filesystem atomic
rename. It is a rollback-capable all-or-rollback protocol:

```text
plan
-> validate destinations and ownership
-> stage files and Runtime dependencies
-> record preimage / journal
-> deterministic promotion
-> read-back checksums and Runtime contract
-> success commit / journal clear
```

On any failure:

```text
rollback
-> rollback read-back against the preimage
-> clear the journal only after verification
-> otherwise retain the journal and fail closed
```

The Distribution rollback preimage is scoped, not a snapshot of the target
repository. The Installer hashes only the exact Manifest/state paths that the
plan may write, the exact paths it may delete, and the explicitly declared
Runtime dependency directory. For `migrate`, the wrapper derives the same
scoped boundary from the validated Pack/bundle write/delete plan; this does not
move legacy parsing or conversion ownership out of the Pack. The journal path
is an explicit control path but is excluded from the content hash because it
is created after the preimage and removed after commit or verified rollback.
Directories are traversed only when the plan explicitly includes them;
symbolic links are recorded as links and never followed. Consequently,
unmanaged target-project trees such as `node_modules/`, `build/`, `target/`,
`.gradle/`, `.next/`, and `vendor/` are outside the Distribution preimage, and
their symlinks cannot make the normal install/upgrade Distribution preimage
fail or force a large repository scan. The Migration Pack's legacy target
identity and its own rollback snapshot remain separate legacy-safety semantics
and are not changed by this scoped Distribution preimage.

The existing shared staging, checksum, Runtime preparation, and atomic
file-transaction helpers remain the implementation primitives. The journal
makes the multi-directory boundary explicit without claiming filesystem
atomicity across `.workflow-system/`, `.agents/`, and generated dependency
directories.

## 8. Release payload

The release artifact carries, after release-time validation:

- the ephemeral Node Installer;
- the Distribution Manifest;
- the vNext Runtime package, lockfile, generated Node entrypoint, and required
  source references;
- the vNext protocol/schema and Runtime contracts;
- prebuilt vNext Agent Skills;
- static migration inputs and bundle assets required by the independent
  Migration Pack.

The embedded migration input is isolated under package payload paths. It is
not installed into the target and is not a new target-side compatibility
surface.

## 9. Compatibility and source-only tools

The old Bun `workflow:pack`, `workflow:install`, `workflow:sync`, generated
bundle layout, and host-specific Skill directories remain available only for
source-development, release engineering, or legacy compatibility where the
existing implementation still owns that behavior. They are not the normal
vNext user installation protocol and are not Distribution metadata.

The `.workflow-system/` project-local storage path is intentionally unchanged.
Path renaming is a separate future design.

## 10. Explicit non-goals for Phase 1

This freeze does not:

- turn the Runtime into a single self-contained file;
- remove Runtime `npm ci` or `package-lock.json`;
- bundle `yaml` into the Runtime;
- rename `.workflow-system/` to `.vibe-governance/`;
- redesign bootstrap plan-digest or conditional authorization;
- add a general ownership type system or a large collection of new receipt/state
  stores;
- change unrelated daily workflow semantics.

## 11. Acceptance scenarios

The Phase 1 implementation must prove:

1. fresh install creates the software surface and leaves governance
   unbootstrapped;
2. same-version install is an exact read-back no-op;
3. legacy install reports `migration-required`;
4. older vNext install reports `upgrade-required`;
5. unsupported/non-idle migration fails closed;
6. valid idle migration invokes the independent Pack and promotes one
   validated result;
7. older vNext upgrade is safe/idle-only and never parses legacy documents;
8. malformed/tampered payloads never promote;
9. managed-target drift/conflicts never get silently overwritten;
10. promotion failure restores the preimage or retains an explicit recovery
    journal;
11. every required `.agents/skills/<skill-name>/SKILL.md` is complete and no
    host-specific path is canonical;
12. the project-local Runtime contract reads back successfully; and
13. daily Runtime entry after install but before bootstrap returns
    `BOOTSTRAP_REQUIRED` (or its equivalent fail-closed result).

## 12. Definition of Done

- [x] `uninstalled`, `legacy`, and `vnext(version)` are the only Distribution
  states, and `install`, `migrate`, and `upgrade` reject implicit transitions.
- [x] A fresh install writes only manifest-owned software and returns the
  `bootstrap-project` Agent Skill next step without writing governance facts.
- [x] All nine canonical Skills install as
  `.agents/skills/<skill-name>/SKILL.md` with valid `name`, `description`, and
  `entry_contract` metadata.
- [x] The release builder enforces lockstep Distribution/Runtime versions and
  Phase 1 admits only plain `x.y.z` release versions.
- [x] Payload, manifest, checksums, destination ownership, Runtime contract,
  and read-back validation are release-time and install-time gates.
- [x] A packed npm artifact is installed into a temporary npm environment and
  its published `vibe-governance` bin completes a fresh target install.
- [x] Distribution rollback hashes only its declared scoped paths and restores
  or fails closed with a journal on promotion failure.
- [x] Current Distribution State upgrades delete exactly old managed paths no
  longer in the new manifest after checksum verification; old
  `INSTALL_STATE.json` uses a separate conservative compatibility mapping.
- [x] Bootstrap validates the installed Distribution read-only and promotes
  governance assets only; it never regenerates, promotes, or receipt-owns
  Runtime, Protocol, Schema, or Agent Skills.
- [x] `BOOTSTRAP_RECEIPT.json` records Bootstrap governance provenance only,
  and validated Migration Pack provenance can establish governed state without
  a Bootstrap Receipt.
- [x] CLI-level tests prove that `--root` without a value, or followed by a
  flag, exits before dispatch and cannot target the current directory.
- [x] Runtime, Migration Pack, bootstrap, source contract, freshness, health,
  and workflow-wide verification pass.

## 13. Traceability

Upstream architecture and migration constraints:

- [workflow-vnext-target-architecture.md](workflow-vnext-target-architecture.md)
- [workflow-vnext-implementation-blueprint.md](workflow-vnext-implementation-blueprint.md)
- [workflow-vnext-migration-plan.md](../product/workflow-vnext-migration-plan.md)

Implementation and verification:

- [vibe-governance-distribution.ts](../../scripts/vibe-governance-distribution.ts)
- [vnext-migration-pack.ts](../../scripts/vnext-migration-pack.ts)
- [vibe-governance-distribution.test.ts](../../test/vibe-governance-distribution.test.ts)
- [vnext-migration-pack.test.ts](../../test/vnext-migration-pack.test.ts)
- [vnext-runtime.test.ts](../../test/vnext-runtime.test.ts)
- [vnext-bootstrap-project.test.ts](../../test/vnext-bootstrap-project.test.ts)

## 14. Change history

| Date | Version | Change |
|---|---:|---|
| 2026-09-04 | 1.0 | Froze Phase 1 Vibe Governance Distribution boundary and implemented the Node Installer contract. |
