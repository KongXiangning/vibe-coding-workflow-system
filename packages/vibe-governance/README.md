# vibe-governance

`vibe-governance` is the ephemeral Node distribution boundary for Vibe Governance.

```bash
npx vibe-governance@latest install
npx vibe-governance@latest migrate
npx vibe-governance@latest upgrade
```

The installer distributes software only. It does not bootstrap project facts;
after a successful fresh install, continue by invoking the
`bootstrap-project` Agent Skill.

The package is assembled by the source repository's release command:
`bun run build:vibe-governance-distribution`.
