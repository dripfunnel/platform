# CLAUDE.md: platform

@AGENTS.md

## Claude Code specifics

- **Questions**: ask them with the AskUserQuestion tool, one question per decision. Put the
  explanation from AGENTS.md "Ask before assuming" in the question and option descriptions,
  and list your recommended option first, marked "(Recommended)". Ask before starting work,
  not halfway through it.
- **Read narrowly**: start with `docs/README.md` and `docs/ARCHITECTURE.md`, then only the documents in the
  "Read first" table that the task touches, then only the source files it needs. Don't
  re-survey the whole repo for each task.
- **Smallest change first** (AGENTS.md "Working with the user" rule 6): on a bug card, write
  down the smallest fix before opening any file to change. In an AskUserQuestion about scope, the
  smallest option comes first, marked "(Recommended)" unless it truly can't fix the problem, and
  every bigger option's description lists what it adds (new tables or migrations, endpoints,
  screens, jobs). Anything you notice along the way goes in your reply as a suggested card, not
  into the diff.
- **Right place first**: in `apps/api`, put a change in the lowest layer it belongs to
  (docs/api/README.md §4). In an SPA, keep it in that app unless the other SPA needs
  it too, then move it to `apps/ui/shared/` and say so.
- **UI work opens `designs/` first.** Before building or changing any screen, component or
  style, read the app's prototype (`DF Store` → `apps/ui/store`, `DF Platform` →
  `apps/ui/platform`, `DF Admin` → `apps/ui/admin`, `DF Storefront` → `templates/storefront`;
  `designs/design.md` maps every screen to its file) and `DripFunnel Style Guide.dc.html` for anything touching colour, type,
  spacing, radius or a component's look. Check the screen in `designs/MISSING-FEATURES.md`
  and `designs/INCOMPLETE-FEATURES.md` so you don't build a dead end. The prototype decides
  **behaviour**; `docs/` decides **scope and rules** (docs/README.md §3). When they disagree
  about behaviour, ask. Name in your reply which prototype and which of its screens you read.
- **Comment less than you want to.** AGENTS.md "Code" rule 2 is a limit, not a preference:
  one or two lines, citing a document rather than restating it. Reaching a third line means
  the explanation belongs in the commit message or the pull request, which is also where
  anyone looking for it will go.
- **Done means verified**: run the commands in AGENTS.md "Commands" before saying a change
  works, and report each one's result. If you couldn't run something, say that.
- **Creating a card**: use the `create-card` skill (`.claude/skills/create-card`), which follows
  docs/code/HOW-TO-WRITE-A-CARD.md. Questions go through AskUserQuestion before any draft, and
  nothing is created on GitHub until the draft is approved.
- **Stop at the diff**: no commits, branches or pushes unless the user asks in that
  message.
