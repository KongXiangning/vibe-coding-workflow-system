# Vibe Governance Distribution / Installer

Status: design frozen for Phase 1 implementation  
Product: **Vibe Governance**  
CLI / package working name: **`vibe-governance`**  
Runtime: **Vibe Governance Runtime**

This document freezes the vNext Distribution Boundary. It is additive to the
accepted vNext Runtime, bootstrap, and Migration Pack contracts. It does not
rename the existing project-local `.workflow-system/` storage path.

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
-> /bootstrap-project
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

The package is a distributable release artifact, not a requirement that the
artifact came from npm. Its payload is self-contained and reproducible so a
future CI or offline installer can use the same boundary. A target project
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
`.agents/skills/<skill-name>/SKILL.md`; a flat
`.agents/skills/<skill-name>.SKILL.md` file is not a valid vNext target.

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

## 5. Release Distribution Manifest

Every release package carries one minimal
`distribution-manifest.json`. It describes distribution-owned artifacts only:

```yaml
kind: vibe-governance-distribution-manifest
product: Vibe Governance
package_name: vibe-governance
distribution_version: <semver>
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
bundle-manifest digest, every artifact checksum, and the shared vNext bundle
validator must pass before any target mutation. No `hosts` field is accepted.

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
