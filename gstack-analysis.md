# gstack Analysis

This document summarizes what `gstack` is, which problems it solves, and how its
document-generation workflow works across planning, review, shipping, and
retrospectives.

## What gstack is

`gstack` is an AI engineering workflow system built around `SKILL.md` files.
It turns a general-purpose coding agent into a specialized virtual software team:
product reviewer, engineering reviewer, designer, QA lead, release engineer,
debugger, documentation updater, and retrospective analyst.

Two major pieces define the project:

- A large skill library implemented as `SKILL.md.tmpl` templates and generated
  `SKILL.md` files
- A persistent headless browser system (`browse`) that gives QA and automation
  workflows low-latency, stateful browser access

## High-level capabilities

gstack can be used to:

- Reframe raw ideas into stronger product directions
- Produce structured planning and review artifacts before implementation
- Generate and critique architecture, UX, and delivery plans
- Run browser-based QA using a persistent Chromium daemon
- Review diffs before landing and classify findings into auto-fix vs user decision
- Ship changes with versioning, changelog updates, PR creation, and doc sync
- Record learnings across sessions and generate retrospectives from repo history

## Core architecture

At a high level, the system looks like this:

```text
SKILL.md.tmpl --> gen-skill-docs.ts --> SKILL.md
                       |
                       +--> resolver modules
                       |
                       +--> host-specific output (Claude / Codex / Factory)

Agent --> browse CLI --> localhost HTTP server --> Chromium via CDP
```

Key architectural ideas:

- Skills are template-driven, not hand-maintained independently per host
- Placeholder resolvers inject shared workflows, setup blocks, and policy text
- The browser is daemonized for persistence and speed
- Discovery is filesystem-based: templates are found dynamically, not from a
  hardcoded registry

## Skill template system

The template pipeline is centered in `scripts/gen-skill-docs.ts`.

### How generation works

1. Discover `SKILL.md.tmpl` files in the repo root and one directory level below
2. Read the template frontmatter and body
3. Find placeholders like `{{PREAMBLE}}` or `{{INVOKE_SKILL:plan-ceo-review}}`
4. Resolve each placeholder through `scripts/resolvers/index.ts`
5. Generate host-specific `SKILL.md` output

### Important frontmatter fields

Typical skill templates declare:

```yaml
---
name: qa
preamble-tier: 4
version: 2.0.0
description: |
  Systematically QA test a web application and fix bugs found.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
benefits-from:
  - /plan-ceo-review
---
```

Key meanings:

- `name`: skill identity
- `preamble-tier`: how much shared context and policy text gets injected
- `description`: routing hint and host-facing summary
- `allowed-tools`: execution permissions
- `benefits-from`: upstream skill relationships

### Major resolver families

- `preamble.ts`: session context, routing rules, contributor behavior, telemetry
- `review.ts`: review dashboards, completion audits, spec review loops
- `review-army.ts`: parallel specialist review orchestration
- `design.ts`: design methodology, anti-slop rules, design scoring workflows
- `browse.ts`: browse setup, command reference, snapshot documentation
- `testing.ts`: test bootstrap and coverage audit sections
- `utility.ts`: base branch detection, QA workflow, deploy bootstrap, changelog
- `learnings.ts`: prior-learning search and learning capture
- `confidence.ts`: confidence scoring rules for findings
- `composition.ts`: skill composition through `{{INVOKE_SKILL:...}}`

## Browse subsystem

The browse subsystem is one of the most distinctive technical components in the
repo.

### Why it exists

Starting a fresh browser for every agent action is too slow and loses cookies,
tabs, sessions, and local storage. gstack solves this by keeping Chromium alive
behind a lightweight localhost server.

### Properties

- First use starts the stack in a few seconds
- Later calls are roughly sub-second
- Cookies, tabs, sessions, and local storage persist between commands
- The server auto-shuts down after idle timeout

### Practical effect

This makes browser-driven QA and interactive debugging much more realistic than
stateless screenshot-only tooling.

## Document generation lifecycle

One of gstack's strongest ideas is that documentation is not a final cleanup
task. It is generated and refined across the whole software lifecycle.

```text
IDEA --> DESIGN --> REVIEW --> CODE --> SHIP --> DOCUMENT --> RETRO --> LEARN
```

The sections below summarize the main documentation-producing skills.

## 1. Requirements and problem framing: `/office-hours`

### Primary output

- Design/problem document under `~/.gstack/projects/$SLUG/*-design-*.md`

### Purpose

This skill reframes the original idea before implementation begins. It is
designed to challenge weak assumptions and force specificity.

### Main rules and constraints

- Two operating modes:
  - startup mode for real business/customer discovery
  - builder mode for hobby/open-source/delight-oriented exploration
- Produces planning/design output only, not implementation
- Uses forced questions to test whether the problem is real and well-specified
- Encourages evidence, specificity, and discomfort over polished vague answers
- Requests permission before doing web-based competitor/landscape research

### Role in the lifecycle

This is the front door for raw ideas. Its output becomes input to later plan
review skills.

## 2. Strategic planning document: `/plan-ceo-review`

### Primary output

- CEO plan documents in `~/.gstack/projects/$SLUG/ceo-plans/...`

### What it generates

- Premise challenge
- Existing-code leverage map
- Dream-state comparison
- Implementation alternatives
- Scope decisions
- Error and rescue registry
- Failure modes registry
- System architecture diagrams
- Data-flow and observability expectations

### Strong constraints

- Scope must be explicitly challenged before detailed planning begins
- No silent failures
- Every error should be named, not hand-waved
- Four shadow paths are required for flows: nil, empty, error, success
- ASCII diagrams are mandatory for non-trivial systems
- A "NOT in scope" section is required
- Completeness is favored over shortcutting

### Role in the lifecycle

This skill converts product intent into a high-rigor strategic plan and hands
that plan forward to design and engineering review stages.

## 3. Engineering architecture review: `/plan-eng-review`

### Primary output

- Structured engineering review output and persisted review metadata
- Inline ASCII diagrams, test maps, and failure-mode registries

### What it enforces

- Existing-code leverage should be checked before new abstractions are added
- Large or complex plans should be challenged
- Architecture, code quality, tests, and performance are all mandatory sections
- Key flows require diagrams
- Test coverage must be mapped to codepaths
- Failure scenarios must be made explicit

### Notable execution rule

The skill is intentionally interactive: after each major review section, it is
supposed to stop and let the user react before continuing.

### Role in the lifecycle

This is the main technical rigor gate before implementation or shipping.

## 4. Design planning review: `/plan-design-review`

### Primary output

- Visual mockups
- Design annotations added back into the plan
- Comparison boards and review artifacts under the project design directory

### Core method

Each design dimension is rated from 0 to 10, then the reviewer must describe
what a 10 would look like, revise the plan, and re-rate.

### Main dimensions

- Information architecture
- Interaction state coverage
- User journey and emotional arc
- AI slop risk
- Design system alignment
- Responsive behavior and accessibility
- Accessibility deep dive

### Design constraints

- "Specificity over vibes"
- Empty states are treated as features
- Responsive does not mean simply stacking layouts
- Accessibility is mandatory
- Generic AI-generated patterns are considered failure modes

### Role in the lifecycle

This skill turns a product plan into a better-defined UX and interaction plan
before code is written.

## 5. Orchestration of planning docs: `/autoplan`

### Primary output

- Sequentially updated plan file
- Restore point snapshots
- Phase summaries
- Final approval gate containing surfaced taste decisions and user challenges

### Behavior

It runs the planning skills in order:

1. CEO review
2. Design review when UI scope exists
3. Engineering review

### Decision model

It classifies outcomes as:

- Mechanical: auto-decide silently
- Taste: auto-decide but surface at final gate
- User challenge: never silently decide when both models recommend changing the
  user's stated direction

### Role in the lifecycle

This is the plan pipeline coordinator. It connects ideation and detailed review
without requiring the user to manually invoke every phase in sequence.

## 6. Pre-landing review report: `/review`

### Primary output

- Review report persisted through review logs
- Structured findings split into CRITICAL and INFORMATIONAL
- Auto-fix vs Ask classification
- Greptile reply templates
- Learning capture for future sessions

### Review style

The skill is intentionally fix-first:

- identify issues
- auto-fix safe issues
- ask the user about risky or ambiguous fixes
- persist results for dashboards and later workflows

### Extra governance

- Cross-reference with `TODOS.md`
- Detect stale documentation
- Persist review results for later use by `/ship` and dashboards

### Role in the lifecycle

This is the immediate pre-merge quality gate for code changes.

## 7. Shipping documentation: `/ship`

### Primary outputs

- Updated `VERSION`
- Updated `CHANGELOG.md`
- Updated `TODOS.md`
- PR or MR body
- Logical, bisectable commits
- Persisted shipping metrics

### Main constraints

- Test failures that belong to the branch block progress
- Coverage gates can block or require explicit override
- Plan completion and verification can block shipping
- Fresh verification is mandatory after post-test code changes
- Commits should be bisectable and ordered logically

### PR body content

The PR/MR description is itself a generated documentation artifact and typically
contains:

- summary
- test coverage
- pre-landing review
- design review
- eval results
- scope drift
- plan completion
- verification results
- TODO completion

### Role in the lifecycle

This skill packages code, process evidence, and release communication into a
single delivery workflow.

## 8. Documentation sync after shipping: `/document-release`

### Primary outputs

- Updates to `README.md`
- Updates to `ARCHITECTURE.md`
- Updates to `CONTRIBUTING.md`
- Updates to `CLAUDE.md`
- `CHANGELOG.md` voice polish
- `TODOS.md` cleanup
- Documentation health summary

### Important rules

- Read full files before editing
- Make factual auto-updates directly
- Ask the user about narrative or ambiguous changes
- Never clobber changelog history
- Never silently bump version
- Check discoverability: important docs should be reachable from key entry docs

### Role in the lifecycle

This keeps docs synchronized with shipped behavior rather than letting them drift
for weeks or months.

## 9. Retrospective report: `/retro`

### Primary outputs

- Repo or team retrospective report
- Metrics table
- Per-author leaderboard
- Time-distribution and session analysis
- Hotspot and churn analysis
- Trend analysis

### What it looks at

- Commit history
- Work sessions
- File churn
- PR size patterns
- Skill usage
- Backlog/TODO health
- Test and review signals

### Role in the lifecycle

This is the process-learning layer. It turns repo activity into operational and
team insight.

## 10. Knowledge capture: `/learn`

### Primary outputs

- `learnings.jsonl`
- Search, prune, export, stats, and add workflows
- Markdown export suitable for reference docs such as `CLAUDE.md`

### Entry schema

Each learning tracks:

- skill
- type
- key
- insight
- confidence
- source
- related files
- timestamp

### Role in the lifecycle

This skill captures patterns, pitfalls, architecture choices, and preferences so
the system improves over time.

## QA report structure

The repo also includes a concrete report template at
`qa/templates/qa-report-template.md`.

That template defines a standardized QA report with:

- metadata table
- health score by category
- top 3 issues
- console health summary
- severity breakdown
- detailed issue entries with repro steps and screenshots
- fixes applied
- regression section

This shows that gstack does not just describe QA behavior; it standardizes QA
reporting output too.

## TODO governance

The repo contains explicit TODO formatting rules, including a separate
`review/TODOS-format.md`.

### Expected structure

```text
# TODOS

## <Skill or Component>
### <Title>
What
Why
Context
Effort
Priority
Depends on

## Completed
```

### Key expectations

- Priority must be explicit
- Context should be good enough for delayed pickup
- Completed work is annotated with version and date
- TODOs are treated as formal project memory, not casual scraps

## Strong cross-cutting rules

Across the document and workflow skills, several rules repeat consistently:

- Zero silent failures
- Named errors, not vague "handle errors"
- Explicit failure-mode thinking
- Diagrams for non-trivial logic and flow
- Scope challenge before implementation
- Completeness over cheap shortcutting
- Search and reuse before building from scratch
- Test coverage must be explicit
- Documentation should stay discoverable
- Release notes should be user-facing, not commit-message sludge

## Why this project is interesting

gstack is not just a set of prompts. It is a structured operating system for AI
assisted software delivery.

Its interesting properties are:

- Strong opinions about rigor, not just productivity
- Documentation treated as an artifact of every phase, not an afterthought
- Template-based skills that scale across many commands and hosts
- Persistent browser infrastructure that enables realistic QA loops
- Memory and retrospective mechanisms that try to make the system compound over
  time

## Suggested way to read the repo

If you want to understand the codebase in depth, a good sequence is:

1. `README.md` for the project thesis
2. `ARCHITECTURE.md` for the browse daemon model
3. `scripts/gen-skill-docs.ts` and `scripts/resolvers/` for the skill engine
4. `office-hours/`, `plan-ceo-review/`, `plan-eng-review/`, and
   `plan-design-review/` for the planning/document lifecycle
5. `review/`, `ship/`, and `document-release/` for delivery and governance
6. `qa/` and `browse/` for execution and verification

## Bottom line

gstack can be understood as a disciplined AI engineering workflow framework.
Its main value is not only that it helps an agent do work, but that it forces
the work to pass through structured planning, review, QA, shipping, and
documentation checkpoints with explicit artifacts and quality gates.
