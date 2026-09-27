# CLAUDE.md: platform

@AGENTS.md

## Claude Code specifics

- **Questions**: ask them with the AskUserQuestion tool, one question per decision. Put the
  explanation from AGENTS.md "Ask before assuming" in the question and option descriptions,
  and list your recommended option first, marked "(Recommended)". Ask before starting work,
  not halfway through it.
- **Read narrowly**: start with `docs/ARCHITECTURE.md`, then only the documents in the
  "Read first" table that the task touches, then only the source files it needs. Don't
  re-survey the whole repo for each task.
- **References are read-only**: `../vendure-backend`, `../community-plugins`,
  `../vendure-storefront-template` and `../df-store-archived` are for reading. Never edit
  them.
- **Right place first**: in `apps/api`, put a change in the lowest layer it belongs to
  (docs/code/ARCHITECTURE.md §3). In an SPA, keep it in that app unless the other SPA needs
  it too, then move it to `shared/` and say so.
- **Done means verified**: run the commands in AGENTS.md "Commands" before saying a change
  works, and report each one's result. If you couldn't run something, say that.
- **Stop at the diff**: no commits, branches or pushes unless the user asks in that
  message.
