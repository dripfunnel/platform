# WORKFLOW.md: how we plan, build, review and merge

How work moves from a task card to `main`. It applies to every person and every AI agent
working in this repo. The coding rules themselves are in [../../AGENTS.md](../../AGENTS.md)
and [DESIGN.md](DESIGN.md); this document is about the process around them.

Last updated: 2026-09-29.

---

## 1. Decisions

| Decision | Rejected | Why |
|---|---|---|
| **Every piece of work is one work item, one branch, one pull request** | Several items per branch; long-lived personal branches | Each change can be reviewed, reverted and deployed on its own |
| **Three kinds of work, named by branch prefix**: `feature/`, `task/`, `bug/` (§2) | Free-form branch names | The prefix says what the change is and decides whether it gets an environment |
| **Only new feature development gets a feature environment** (`feature/…`). Tasks and bugs run the gates only | An environment for every branch or pull request | Environments cost money and Hyperdrive slots (at most about 25 at once, [FEATURE-ENVIRONMENTS.md](FEATURE-ENVIRONMENTS.md) §5). Only a new feature needs clicking through before it merges |
| **Small pull requests: about 400 changed lines at most**, not counting generated files and the lockfile | Large pull requests that ship a whole area | A reviewer can read every line properly, so mistakes in tenancy, layers and reuse get caught |
| **`main` is protected**: pull requests only, the CI `gates` check must pass, no force-push, no direct push by anyone, AI agents included | Direct pushes | Pushing `main` is a production action ([../ARCHITECTURE.md](../ARCHITECTURE.md) §6) |
| **Reviews follow experience**: the senior developer reviews junior work; the lead reviews senior work, with `/code-review` as a second pass | Self-merge; review by whoever is free | Every change is read by someone who knows the architecture at least as well as its author |
| **Squash and merge** *(proposed)* | Merge commits; rebase merges | `main` gets one commit per work item, easy to read and to revert |

---

## 2. Kinds of work and branch names

| Kind | Use it for | Branch | Environment |
|---|---|---|---|
| **Feature** | New functionality a user can see or use: a screen, a flow, an API capability behind a screen | `feature/<short-name>`, e.g. `feature/abandoned-carts` | **Yes**: a complete environment on `<slug>-*.dripfunnel.ai`, redeployed on every push and removed when the branch is deleted ([FEATURE-ENVIRONMENTS.md](FEATURE-ENVIRONMENTS.md)) |
| **Task** | Everything else that isn't a defect: foundations (database, tenancy, core types), refactors, tooling, CI, dependencies, docs, design-token work | `task/<short-name>`, e.g. `task/db-foundation` | No: gates only |
| **Bug** | Fixing a defect in something already merged | `bug/<short-name>`, e.g. `bug/money-rounding` | No: gates only |

- **Never put the word `feature` in a task or bug branch name.** The workflow deploys every
  branch whose name contains `feature` anywhere, so `bug/feature-flag-typo` would create an
  environment. Write `bug/flag-typo`.
- Short names: lowercase, words joined by `-`, at most about 20 characters. That keeps a
  feature's hostnames readable.
- A bug found in a feature that hasn't merged yet is fixed on that feature's branch, not on
  a `bug/` branch.

---

## 3. The work item card

Every item starts as a card with these fields. A card that can't fill them in isn't ready
to start.

| Field | Says |
|---|---|
| **Kind and branch** | `feature/`, `task/` or `bug/`, and the branch name |
| **Folders** | The only folders the change may touch. Two cards in progress at once never share a folder |
| **Read first** | The doc sections that decide the design, e.g. "DATA-MODEL §5" |
| **Do** | The steps, numbered |
| **Done when** | Checks anyone can verify: tests that pass, behaviour on the environment, docs updated |
| **Not in this item** | What looks related but belongs to a later card |
| **Needs** | Cards that must be merged first. Don't start on top of an unmerged branch |

---

## 4. Before writing code

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

- **Commit small and often** on your branch, with messages that say why.
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
1. **What and why**, in two or three sentences, with a link to the card.
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

1. Squash and merge once the `gates` check passes and the reviewer approves. Only after that.
2. **Delete the branch.** For a feature, this also removes its environment.
3. Move the card to done. Cards that needed this one can start now.

---

## 9. Open questions

- Squash and merge as the only allowed merge method (§1, *(proposed)*).
- A pull request template in `.github/` that carries §6's description headings.
