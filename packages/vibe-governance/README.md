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

The installed Skill uses the target-local Node path
`.workflow-system/runtime/dist/cli.js bootstrap-support prepare` to form a
typed governance proposal. It does not require the workflow-system source
repository, Bun, `WORKFLOW_SYSTEM_ROOT`, or source-side generation commands;
the project-local Runtime performs the governed commit and read-back.

The package is assembled by the source repository's release command:
`bun run build:vibe-governance-distribution`.
