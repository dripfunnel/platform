# WORKFLOW.md: how we plan, build, review and merge

How work moves from a task card to `main`. It applies to every person and every AI agent
working in this repo. The coding rules themselves are in [../../AGENTS.md](../../AGENTS.md)
and [DESIGN.md](DESIGN.md); this document is about the process around them.

Last updated: 2026-09-29.

---

## 1. Decisions

| Decision | Rejected | Why |
|---|---|---|
| **Every piece of work is one work item, one branch, one pull request**, and the work item is a GitHub issue on the DripFunnel project | Several items per branch; long-lived personal branches; work without an issue | Each change can be reviewed, reverted and deployed on its own, and traced back to its card |
| **Branch names are `#<issue>/<kind>/<short-name>`**, kind `feature`, `task` or `bug` (§2) | Free-form names; `feature/<name>` without an issue | The issue links branch, commits, pull request and card; the kind says what the change is and decides whether it gets an environment |
| **Every commit message starts with `#<issue>` and a space** (§2.1) | Free-form messages | Every commit on `main` points to the card that explains it |
| **Enforced in three places** (§2.2): git hooks, a required `naming` check on every pull request, and GitHub rulesets on `main` and `dev` | Trusting people to remember | Hooks catch a mistake before the commit exists; the check and rulesets make it impossible to merge, because hooks can be skipped |
| **Claude reviews every pull request, advisory only** (§7) | A required check that can fail on an AI judgement | A second pass costs nothing to ignore and catches what a tired reviewer misses; blocking on a non-deterministic judgement would teach people to re-run until it passes |
| **Only new feature development gets a feature environment** (`feature/…`). Tasks and bugs run the gates only | An environment for every branch or pull request | Environments cost money and Hyperdrive slots (at most about 25 at once, [FEATURE-ENVIRONMENTS.md](FEATURE-ENVIRONMENTS.md) §5). Only a new feature needs clicking through before it merges |
| **Small pull requests: about 400 changed lines at most**, not counting generated files and the lockfile | Large pull requests that ship a whole area | A reviewer can read every line properly, so mistakes in tenancy, layers and reuse get caught |
| **`main` and `dev` are protected**: pull requests only, the `gates` and `naming` checks must pass, no force-push, no direct push or commit by anyone, AI agents included | Direct pushes | Pushing `main` is a production action ([../ARCHITECTURE.md](../ARCHITECTURE.md) §6) |
| **Reviews follow experience**: the senior developer reviews junior work; the lead reviews senior work, with `/code-review` as a second pass | Self-merge; review by whoever is free | Every change is read by someone who knows the architecture at least as well as its author |
| **Squash and merge** *(proposed)* | Merge commits; rebase merges | `main` gets one commit per work item, easy to read and to revert |

---

## 2. Kinds of work and branch names

| Kind | Use it for | Branch | Environment |
|---|---|---|---|
Every branch is **`#<issue>/<kind>/<short-name>`**: the GitHub issue number of its card, the
kind of work, and a short name.

| Kind | Use it for | Branch | Environment |
|---|---|---|---|
| **Feature** | New functionality a user can see or use: a screen, a flow, an API capability behind a screen | `#<issue>/feature/<short-name>`, e.g. `#12/feature/abandoned-carts` | **Yes**: a complete environment on `<issue>-<short-name>-*.dripfunnel.ai` (e.g. `12-abandoned-carts-store.dripfunnel.ai`), redeployed on every push and removed when the branch is deleted ([FEATURE-ENVIRONMENTS.md](FEATURE-ENVIRONMENTS.md)) |
| **Task** | Everything else that isn't a defect: foundations (database, tenancy, core types), refactors, tooling, CI, dependencies, docs, design-token work | `#<issue>/task/<short-name>`, e.g. `#13/task/db-foundation` | No: gates only |
| **Bug** | Fixing a defect in something already merged | `#<issue>/bug/<short-name>`, e.g. `#14/bug/money-rounding` | No: gates only |

- **The issue must exist and be open** in `dripfunnel/platform`; create the card first.
- **Short names**: lowercase letters and digits, words joined by `-`, no `/`, at most about
  20 characters. That keeps a feature's hostnames readable.
- **Quote the name in a terminal.** `#` starts a comment in the shell, so
  `git switch -c #12/feature/offers` creates nothing. Write
  `git switch -c '#12/feature/offers'` and `git push -u origin '#12/feature/offers'`.
- Only the kind decides the environment: `#13/task/feature-flags` gets none.
- A bug found in a feature that hasn't merged yet is fixed on that feature's branch, not on
  a new `bug` branch.

### 2.1 Commit messages

Every commit message starts with **`#<issue>` and a space**, then says what changed and why,
e.g. `#12 add the abandoned carts list`. Usually the number is the branch's issue; a commit
that also closes another issue names that one.

- **Pull request titles follow the same rule, with the branch's issue number**, because the
  title becomes the commit on `main` when it is squashed.
- Allowed without a number, because git writes them: `Merge …`, `fixup! #12 …`,
  `squash! #12 …`, `amend! #12 …` and `Revert "#12 …"`.
- **Git treats lines starting with `#` as comments** and deletes them when you write the
  message in an editor. `pnpm git-hooks` (§2.2) sets `core.commentChar` to `;` for this
  repo, so `#12 …` survives. `git commit -m '#12 …'` works either way.

### 2.2 How the rules are enforced

| Where | What it refuses | Can it be skipped? |
|---|---|---|
| **Git hooks** in `.githooks/`, turned on once per clone with **`pnpm git-hooks`** | Committing on `main` or `dev`; committing on a branch not named `#<issue>/<kind>/<short-name>`; a commit message without `#<issue>`; pushing to `main` or `dev`; pushing a misnamed branch | Yes, with `--no-verify`, so the next two exist |
| **`naming` check** on every pull request ([`.github/workflows/naming.yml`](../../.github/workflows/naming.yml)) | A misnamed branch; a commit or title without `#<issue>`; a title whose number isn't the branch's; a number that isn't an issue in this repo; a branch whose issue is closed | No, once it is a required check (below) |
| **GitHub rulesets** on `main` and `dev` (below) | Any push or merge that isn't a reviewed pull request with passing checks; force-push; deletion | Only by the people on the bypass list; keep it empty |

The rules live in one place, [`scripts/git/naming.mjs`](../../scripts/git/naming.mjs), with
tests beside it. The hooks, the pull-request check and the feature-environment names
([FEATURE-ENVIRONMENTS.md](FEATURE-ENVIRONMENTS.md) §2) all use it.

**Rulesets to set in GitHub** (dripfunnel/platform → Settings → Rules → Rulesets; an org
owner or repo admin):

1. **`protect-main-dev`**, target branches `main` and `dev`, enforcement *Active*, bypass
   list empty:
   - Restrict deletions.
   - Block force pushes.
   - Require a pull request before merging: 1 approval; dismiss stale approvals on new
     commits; allowed merge method *Squash* (§1, *(proposed)*).
   - Require status checks to pass: `gates` and `naming`; branches must be up to date.
2. **`branch-names`**, target *all branches*, excluding `main`, `dev` and the patterns
   `#*/feature/*`, `#*/task/*` and `#*/bug/*`, enforcement *Active*:
   - Restrict creations.

   Nobody can then create a branch on GitHub whose name breaks §2.

If your GitHub plan offers **metadata restrictions** (commit message and branch name
patterns, documented for GitHub Enterprise), also add a commit-message rule `^#[1-9][0-9]* `
on all branches. The `naming` check already covers it.

---

## 3. The work item card

Every item starts as a card with these fields. A card that can't fill them in isn't ready
to start.

| Field | Says |
|---|---|
| **Kind and branch** | Feature, task or bug, and the branch name `#<issue>/<kind>/<short-name>` |
| **Folders** | The only folders the change may touch. Two cards in progress at once never share a folder |
| **Read first** | The doc sections that decide the design, e.g. "DATA-MODEL §5" |
| **Do** | The steps, numbered |
| **Done when** | Checks anyone can verify: tests that pass, behaviour on the environment, docs updated |
| **Not in this item** | What looks related but belongs to a later card |
| **Needs** | Cards that must be merged first. Don't start on top of an unmerged branch |

---

## 4. Before writing code

0. **Once per clone:** run `pnpm git-hooks` (§2.2). **Once per machine:** connect Claude Code to
   GitHub ([GITHUB-MCP.md](GITHUB-MCP.md)).
   The loop you repeat for one card is [HOW-TO-WORK-A-CARD.md](HOW-TO-WORK-A-CARD.md).
1. Read the card's "Read first" sections, and [../README.md](../README.md) §4 for the area.
2. **Right place first**: find the lowest layer the change belongs to
   ([../api/README.md](../api/README.md) §4). In the SPAs, keep it in the app unless another
   app needs it too; then move it to `apps/ui/shared/` and say so
   ([../ui/shared/README.md](../ui/shared/README.md) §2).
3. **Reusable first**: search the app's own modules and `apps/ui/shared/` before writing
   anything new.
4. **Ask when the docs are silent or contradict each other.** Don't guess. Write the
   question on the card and ask the lead.

---

## 5. While building

- **Commit small and often** on your branch, each message starting with `#<issue>` (§2.1)
  and saying why.
- **Tests with the code**, not after: unit tests beside the file; integration tests in
  `apps/api/tests/`. Anything touching tenant data gets isolation tests.
- **Docs in the same change**: when the code and a doc disagree, fix the doc in the same
  pull request and say which ([../README.md](../README.md) §6).
- **No new dependency** without a stated reason in the pull request, and never one that
  does the job of an existing one.
- **No secrets** in code, commits, pull requests or screenshots.
- **Rebase on `main`** before opening the pull request, and whenever `main` changes code you
  depend on.
- If the change grows past about 400 lines, **stop and split the card** before asking for
  review.

---

## 6. The pull request

**Before opening it**, run `pnpm turbo run build typecheck lint test`. Run
`test:integration` too once it exists. Both must pass.

**The description has:**
0. **Title:** `#<issue>` of the branch, a space, and what the change does (§2.1).
1. **What and why**, in two or three sentences, and `Closes #<issue>` so the card closes
   when it merges.
2. **Docs followed**, e.g. "DATA-MODEL §5.2", and any doc changed in this pull request.
3. **Commands run and their results.** If something couldn't be run, say so.
4. **For features:** the environment's URLs from the workflow summary, and what the reviewer
   should click through.
5. **For UI:** screenshots of every designed state that changed (empty, loading, error,
   read-only, phone).
6. **Risks:** migrations, data changes, anything hard to undo.

---

## 7. Review

**Who reviews:**

| Author | Reviewer |
|---|---|
| Junior developer | Senior developer |
| Senior developer | Lead, plus `/code-review` |
| AI agent | Whoever asked for the work |

**Claude reviews every pull request too**, through
[`.github/workflows/claude-review.yml`](../../.github/workflows/claude-review.yml): it reads
AGENTS.md and this section's checklist, then comments inline and once at the top. It is
**advisory** — it never blocks a merge and never replaces the reviewer above. Treat its
comments as a colleague's: fix them or say why not. It needs **both** the
[Claude GitHub App](https://github.com/apps/claude) installed on the repository and the
repository secret `CLAUDE_CODE_OAUTH_TOKEN` — without the app the job cannot get a token to
comment with, and fails with "Claude Code is not installed on this repository". It is
skipped on pull requests from forks, where secrets are not available.

Anything that becomes a core type or a shared component (`core/`, `db/scoped`,
`apps/ui/shared/`) gets a careful line-by-line review, whoever wrote it.

**The reviewer checks:**
- **Layers:**
  - imports only from its own layer or lower;
  - nothing deep-imported from another module;
  - logic in the lowest layer it belongs to.
- **Tenancy:**
  - every tenant read and write goes through `db/scoped` with a context;
  - no store, seller or partner id is taken from the client as authority;
  - isolation tests exist.
- **Reuse:**
  - nothing duplicated that already exists;
  - shared code moved to `shared/` only when a second app uses it.
- **Correctness:**
  - money is `Money`;
  - times are UTC;
  - lists are paginated;
  - errors are `DfError` with codes, and nothing internal leaks to a client.
- **UI:**
  - every designed state is present;
  - text comes from messages;
  - tokens are used, never raw colours;
  - keyboard and focus work;
  - contrast is at least 4.5:1.
- **Tests:** they cover the rules, not only the happy path. No test was weakened to pass.
- **Docs:** updated where the change makes them wrong.
- **Size and scope:** the change matches the card; nothing from "Not in this item" slipped in.

Ask for changes in the pull request, one comment per point. The author replies to or fixes
each one. The reviewer approves only when every point is closed.

---

## 8. Merge and after

1. Squash and merge once the `gates` and `naming` checks pass and the reviewer approves. Only
   after that.
2. **Delete the branch.** For a feature, this also removes its environment.
3. Move the card to done. Cards that needed this one can start now.

---

## 9. Open questions

- Squash and merge as the only allowed merge method (§1, *(proposed)*).
- A pull request template in `.github/` that carries §6's description headings.
