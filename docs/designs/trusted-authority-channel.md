# Trusted Authority Channel

- Phase: `Architecture`
- Status: `Frozen / Implementation blocked`
- Date: `2026-09-06`
- Behavior impact: `none`

This document freezes the authority boundary required before an administrative
`bootstrap-project:realign` mutation may be implemented. It is an architecture
constraint, not a Runtime protocol or implementation specification.

The governing invariant is:

```text
Model proposes → Human authorizes → Runtime commits
```

It must never become:

```text
Model proposes → Model claims user authorized → Runtime commits
```

## 1. Current architecture gap

The current Bootstrap path has no trusted caller authority context outside the
proposal:

```text
ordinary Agent / CLI input
  → source Bootstrap facade
  → target-local bootstrap-support
  → BootstrapProjectProposal
  → Runtime proposal validation
  → atomic commit
```

The current proposal contains `authority_evidence`, but that evidence is only
`kind`, `source`, and `subject` data supplied with the proposal. Runtime checks
its shape in [`bootstrap.ts`](../../runtime/vnext/src/bootstrap.ts), but the
commit entry point has no independent authority argument. Target-local support
currently synthesizes `project-owner` evidence in
[`bootstrap-support.ts`](../../runtime/vnext/src/bootstrap-support.ts).

Consequently, Runtime cannot distinguish a real human authorization from an
Agent-generated claim such as:

```yaml
kind: project-owner
source: target-local bootstrap input
```

The existing `user-confirmation` and `authorized-caller` values in the general
Runtime evidence model are also proposal data. They provide structural and
coordinate validation patterns, but they are not an authenticated external
caller channel and cannot authorize administrative realign by themselves.

## 2. Trust boundary

### Untrusted / model-controlled data plane

The following are untrusted because an ordinary Agent can construct or modify
them:

- Bootstrap proposals and `authority_evidence`;
- target identity, mode, changed paths, semantic operations, and requested assets;
- facts and design baselines;
- ordinary CLI flags, including confirmation-like flags;
- free-text evidence sources and subjects;
- files, environment variables, tokens, or nonces available to the Agent.

These values may describe intent or provide audit metadata. None is a trust
root.

### Trusted authority domain

Trusted authority must enter Runtime through a channel outside the
model-controlled proposal. It must be issued by a trusted external authority
provider or harness adapter after a real human authorization event, and must
be bound to the exact mutation that Runtime is about to commit.

Runtime Core verifies the trusted context and its bindings. It does not decide
whether a user clicked a particular UI control, and it does not infer human
authorization from proposal text.

## 3. Threat model

The design must prevent at least these cases:

1. An Agent writes `project-owner`, `user-confirmed`, or equivalent evidence
   into a proposal.
2. An Agent changes the proposal, paths, or assets after approval and reuses
   the old authorization.
3. An authorization for one target or mode is replayed against another.
4. An Agent reuses an approval identifier, nonce, or token after consumption.
5. A copied file or environment variable is treated as an approval channel.
6. An unsupported harness silently falls back to a self-asserted confirmation.
7. A stale or structurally valid receipt is treated as current mutation
   authority.

Fail-closed behavior is required for every missing, stale, mismatched,
expired, or already-consumed authority condition.

## 4. Trusted Authority Contract

The following is the frozen conceptual contract. It is not yet a formal
Runtime type or protocol addition:

```ts
type TrustedAuthorityContext = {
  origin: TrustedAuthorityOrigin;
  target_identity: string;
  mode: 'realign';
  proposal_digest: string;
  approval_id: string;
  issued_at: string;
  expires_at?: string;
  single_use: true;
};
```

The authority provider issues the context after human authorization. The
context enters Runtime separately from the proposal. An Agent must not be able
to construct a context that Runtime accepts merely by writing these fields.

Each field has one responsibility:

- `origin` identifies the provider for audit and routing;
- `target_identity` prevents cross-target use;
- `mode` prevents cross-mode use;
- `proposal_digest` binds the exact mutation intent;
- `approval_id` identifies the provider-issued approval;
- `issued_at` and `expires_at` bound its lifetime;
- `single_use` states the required consumption policy.

`origin` is provider identity / audit metadata only. Runtime must not trust a
context because `origin === "codex-user-approval"`, or because it contains any
other expected string. Trust comes from the protected external
caller/provider boundary, or from a future provider proof that Runtime can
verify.

Likewise, `single_use: true` is only a consumption-policy declaration. It is
not a replay defense. The trusted provider or Runtime-maintained consumption
state must record whether `approval_id` has been consumed. A second submission
of a consumed approval must fail closed.

## 5. Runtime commit boundary

Future mutating Bootstrap commit must receive proposal and authority through
separate inputs:

```text
proposal --------------------------┐
                                   ├─ Runtime commit boundary
trusted authority context ---------┘
```

Runtime must recompute the canonical target identity and proposal digest, then
verify all of the following:

- the context came through a supported trusted provider boundary;
- target identity matches the current target exactly;
- mode is exactly `realign`;
- the recomputed proposal digest equals the authorized digest;
- the authority is within its validity window;
- the approval has not already been consumed.

Failure means no file write, no Bootstrap receipt generation, and no synthetic
`project-owner` evidence. `authority_evidence` inside the proposal may remain
as audit information, but it cannot elevate trust.

Runtime Core remains harness-neutral. It validates authority provenance and
binding at the commit boundary; it does not call Codex, Claude, Factory, or a
user interface.

## 6. Harness Adapter boundary

The target architecture is:

```text
Codex adapter ─┐
Claude adapter ├─> trusted authority provider/context
Factory adapter┘                 ↓
                  Agent → Bootstrap Proposal → Runtime commit boundary
```

An adapter is harness-specific. Its responsibility is to turn a real,
harness-level human authorization into the provider-neutral authority context.
It must not promote Agent-provided confirmation text, flags, files, or tokens
into trusted authority.

Runtime Core must not depend on any adapter API. An unsupported harness must
return an explicit blocker rather than falling back to `user_confirmed: true`
or proposal-owned `project-owner` evidence.

## 7. Proposal binding / digest semantics

`proposal_digest` is the exact binding between authorization and mutation. It
must be computed from the canonical, validated mutation intent, including at
least:

- target identity;
- Bootstrap mode;
- exact changed-path set;
- requested writes and canonical asset content/hashes;
- semantic operations and relevant proposal revision data.

Runtime recomputes the digest; the Agent cannot choose the digest accepted by
Runtime. Provider context fields and proposal-owned authority claims are not
the source of mutation truth and must not be used to weaken this binding.

Changing the target, mode, paths, assets, facts, baseline, semantic operation,
or any other mutation-relevant proposal field invalidates the prior authority.
No second independently maintained path-list or “approved fields” registry is
allowed to drift from the canonical proposal digest definition.

## 8. Replay / stale authority policy

### Mutating realign

Every mutating realign requires a fresh trusted authority context bound to the
exact proposal. Existing Bootstrap receipts, proposal evidence, or a previous
approval do not substitute for it.

Missing authority, wrong target, wrong mode, wrong digest, expired authority,
unknown provider, or consumed approval all fail closed.

### Unchanged true zero-write replay

An unchanged realign replay may remain authority-free only when it is provably
zero-write:

- target identity and managed checksums already match;
- the prior receipt is valid;
- there is no semantic overlay;
- no canonicalization, repair, receipt rewrite, or other mutation occurs.

Any repair, canonicalization, receipt regeneration, or other write is a
mutation and requires trusted authority. A zero-write replay is an idempotent
read-back, not authorization for a new commit.

The consistency mechanism between authority consumption and an atomic
filesystem commit remains an implementation open question. This document does
not implement it.

## 9. No-adapter behavior

Until at least one real trusted provider boundary exists:

- Agent may prepare and preview a realign proposal;
- Agent may not autonomously commit a mutating realign;
- Runtime returns a clear trusted-authority blocker;
- no governance file is written;
- no synthetic `project-owner` authority is generated;
- no new Bootstrap receipt is issued to certify the attempted mutation.

This restriction applies only to admin-level realign mutation. Ordinary
`prepare-task`, execute, review, repair, and close-task lifecycle behavior is
not globally disabled.

A manually typed terminal confirmation is an operational safeguard only. It is
not Runtime-verifiable trusted authority unless a future trusted adapter
delivers it through the frozen external boundary.

## 10. Explicit non-goals

This architecture freeze does not:

- implement Codex, Claude, or Factory approval adapters;
- define an approval UI;
- design OAuth, user accounts, a global daemon, or a signature service;
- add a `--confirmed` flag or equivalent proposal field;
- add a formal Runtime protocol field or code type;
- change Bootstrap, realign, Runtime, receipt, or lifecycle behavior;
- change Distribution or Governance ownership boundaries;
- add lifecycle E2E tests, CI, or a second authority registry.

## 11. Future implementation entrypoints

Future implementation must enter through these boundaries, in order:

1. Define the provider-neutral context and canonical proposal-digest rules.
2. Add a separate trusted context input at the Runtime commit boundary.
3. Remove target-local synthesis of `project-owner` as authority.
4. Specify provider proof / protected transport and approval consumption.
5. Implement one harness adapter.
6. Add focused fail-closed tests for missing, stale, mismatched, expired, and
   replayed authority.

No implementation may treat the current proposal-level evidence model as a
temporary trusted channel.

## 12. Open questions

- Which harness can provide a protected, authenticated human-approval channel?
- Should that channel be IPC, a host API, a signed envelope, or another
  provider-verifiable mechanism?
- Who owns the approval-consumption ledger?
- How are authority consumption and atomic filesystem commit coordinated after
  crashes or partial failures?
- Is expiry mandatory for every realign, and what is the maximum lifetime?
- Can a failed commit retry with the same approval, or must the provider issue
  a new one?
- Which exact canonical serialization is used for proposal digesting?
- Which Runtime result code represents unsupported provider / unavailable
  authority without changing the current protocol in this freeze?
- How is a true zero-write replay distinguished from canonical repair before
  the commit boundary?

Until these questions have an implementation-approved answer and at least one
real `TrustedAuthorityProvider` / harness adapter exists, mutating realign
implementation remains blocked.
