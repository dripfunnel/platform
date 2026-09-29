# HOW-TO-WORK-A-CARD.md: from a card to a merged pull request

What to actually do when a card is assigned to you. [WORKFLOW.md](WORKFLOW.md) holds the
rules; this page is the loop you repeat for every card.

You run the work through **Claude Code**: you decide, Claude types, you review. That makes
two things your job rather than Claude's — **checking the card is right before you start**,
and **reading every line before you ask for review**.

Last updated: 2026-09-29.

---

## 1. Once, before your first card

| Step | Command | Why |
|---|---|---|
| Install dependencies | `pnpm install` | |
| Turn on the git hooks | `pnpm git-hooks` | Refuses a branch, commit or push that breaks [WORKFLOW.md](WORKFLOW.md) §2, before the mistake exists |
| Connect Claude Code to GitHub | [GITHUB-MCP.md](GITHUB-MCP.md) | Claude can then read your card and open the pull request as you |
| Check the gates run | `pnpm turbo run build typecheck lint test` | If they fail on a clean `main`, say so before starting work |

---

## 2. Read the card before you start it

Read the whole card, then the documents in its **Read first** line. Not skimmed: the card
tells you which sections decide the design, and they are short.

Then check the card is still true. **Say so before writing code** if:

- the card contradicts a document, or two documents contradict each other;
- the **Folders** line doesn't contain a folder the work obviously needs;
- a card in **Needs** hasn't merged yet;
- you can't tell how you would prove a **Done when** line.

That is not a delay, it is the cheapest moment to fix a card. Ask on the issue, so the
answer stays with the card.

---

## 3. Start the branch

```bash
git switch main && git pull
git switch -c '#12/task/db-foundation'
```

**Quote the name.** `#` starts a comment in the shell, so an unquoted `git switch -c
#12/...` silently creates nothing. The branch name is on the card; don't invent your own.

Move the card to **In Progress** on the DF Platform project.

---

## 4. Work with Claude

**Paste the card's "Prompt for Claude" block** into Claude Code in this repo. It already
names the documents to read and the folders to stay inside. If the card has no prompt
block, paste the card itself and add: *"Read AGENTS.md and the documents in Read first
before writing anything. Ask me about anything the docs don't decide."*

While it works:

| Watch for | What to do |
|---|---|
| It touches a folder outside the card's **Folders** line | Stop it. Either the card is wrong or the change is |
| It writes a second copy of something that exists | Stop it. AGENTS.md "Reusable first": search `apps/ui/shared/` and the app's own modules |
| It says a gate passed | Ask which command and what it printed. Compiling is not passing |
| It asks a question you can't answer from the docs | Bring it to the issue, don't guess for it |
| It wants to commit, branch or push without you asking | Say no. You decide when that happens |

**Commit as you go**, small, each message starting with the card's number: `#12 add the
stores table`. The `commit-msg` hook checks it.

---

## 5. Before you ask anyone to look

Run the gates and read what they print:

```bash
pnpm turbo run build typecheck lint test
```

Then **read your own diff**, `git diff main...HEAD`, with the card next to it:

- Every **Done when** line: can you point at the thing that proves it?
- Anything in **Not in this item** that crept in? Take it out.
- Any comment that restates the code, any dead code, any `TODO` without an issue link?
- Any secret, key or personal data in a file, a log line or an error message?
- Does a document now disagree with your code? Fix the document in the same pull request.

Pull requests stay around **400 changed lines**. If yours is much bigger, split the card and
say so on the issue.

---

## 6. Open the pull request

Title: the card's number, a space, what it does — `#12 add the stores table`. Body, per
[WORKFLOW.md](WORKFLOW.md) §6: what and why with `Closes #12`, the docs you followed, and
**the commands you ran with their results**. If you couldn't run something, write that
instead of leaving it out.

The `gates` and `naming` checks run on the pull request. Both must be green before you ask
for review.

---

## 7. Review

Rakesh's work is reviewed by Akshay; Akshay's by Gaurav. Run `/code-review` yourself first —
it is a second pair of eyes, not a substitute for reading your own diff.

Answer every comment: fix it, or say why not. The reviewer closes the thread, not you. Then
squash and merge, delete the branch, and move the card to **Done**.

---

## 8. When you are stuck

Ask on the issue, not in a chat that disappears. A good question says what you tried, which
documents you read, and the two options you are choosing between. If the answer changes a
document, the document gets fixed in your pull request.
