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
- **References are read-only**: `../vendure-backend`, `../community-plugins` and
  `../vendure-storefront-template` are for reading. Never edit
  them.
- **Right place first**: in `apps/api`, put a change in the lowest layer it belongs to
  (docs/api/README.md §4). In an SPA, keep it in that app unless the other SPA needs
  it too, then move it to `apps/ui/shared/` and say so.
- **Done means verified**: run the commands in AGENTS.md "Commands" before saying a change
  works, and report each one's result. If you couldn't run something, say that.
- **Stop at the diff**: no commits, branches or pushes unless the user asks in that
  message.
