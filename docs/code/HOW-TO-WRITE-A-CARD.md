# HOW-TO-WRITE-A-CARD.md: from a request to a card on the board

How a request becomes a card: what to read, what to ask, what the card says and how it reaches
GitHub. It applies to every person and every Claude session that creates a task, bug or feature
in `dripfunnel/platform`. [WORKFLOW.md](WORKFLOW.md) §3 lists a card's fields;
[HOW-TO-WORK-A-CARD.md](HOW-TO-WORK-A-CARD.md) is what happens once it exists.

Claude follows this page whenever someone asks for a card. The repo skill
`.claude/skills/create-card` loads it.

Last updated: 2026-10-07 (#466).

---

## 1. Why cards are written this way

Cards are worked by Claude Code, with a person reviewing (HOW-TO-WORK-A-CARD §4). Whatever a
card leaves unsaid, the executor invents. The prototypes also hold behaviour that `docs/` never
wrote down. So a card is **complete before it is created**:
- every decision is taken and written down;
- the prompt can be pasted as it is;
- the acceptance criteria say when it is done, without anyone reading the diff.

Most of the cost of a card comes from scope that grows past what was asked. #421 was a one-line
rule bug that grew a table, a flow and a screen, and was cut back (AGENTS.md rule 6). The card
is where scope is fixed, so it is fixed by asking, not by guessing.

---

## 2. The steps

1. **Read** what the request touches (§3). Don't ask what the docs or code already answer.
2. **Ask** every open question, all before drafting (§4).
3. **Draft** the whole card from its template (§5–§7) and **show it**: title, body, issue type,
   board column, assignee.
4. **Create it only after a yes** (§8). A created issue's number is never reused, and the card is
   visible to the team.

A request covering several cards (a strand, or a feature with API and UI halves) gets one draft
per card. Show them together with their order and their **Needs** chain.

---

## 3. Read before asking

| Read | For |
|---|---|
| [../README.md](../README.md) §3–§4, then the "Read first" table in [../../AGENTS.md](../../AGENTS.md) | Which documents decide the area |
| Those documents' relevant sections | Scope and rules: what is in the release, what is decided, what is open |
| `designs/design.md`, then the screen in its prototype; `designs/MISSING-FEATURES.md` and `INCOMPLETE-FEATURES.md` | Any card touching a screen: the behaviour, states and wording. The prototype decides behaviour, `docs/` decides scope ([../README.md](../README.md) §3) |
| The release's plan, e.g. [../ui/store/FIRST-RELEASE.md](../ui/store/FIRST-RELEASE.md) §19–§21 | Whether a card already covers this. If it does, the request is a change to that card, not a new one |
| Open issues on the DF Platform board (search the title words) | Duplicates, and the cards this one **Needs** |
| The code the change lands in | Which folders, which layer (docs/api/README.md §4), and what already exists to reuse |
| For a bug: the code path, the tests around it, recent commits there | The likely cause, and whether a test should already have caught it |

---

## 4. Ask before drafting

Ask with the **AskUserQuestion** tool, one question per decision and up to four per call, in as
many rounds as needed. For each question:
- say what is undecided and where you looked;
- say what changes with the answer;
- give the realistic options with their consequences;
- put the recommended option first, marked "(Recommended)", saying why (AGENTS.md rule 1).

Where the question is scope, the **smallest option comes first**. Every bigger option names what
it adds: tables, migrations, endpoints, screens, jobs (CLAUDE.md "Smallest change first").

Don't ask what the docs, the prototype or the code already answer, and don't re-ask what the
person just said. Once they answer numbered points inline, act on the answers.

**Every card:**
- **Kind:** task, bug or feature (WORKFLOW §2). Only new, user-visible functionality is a
  feature, because a feature gets an environment.
- **Outcome:** who gets what. Which portal, which role (Owner, Manager, Staff, supplier tier,
  shopper, partner user, staff), which screen or API.
- **Scope:** what is in, and what looks related but is out. Out-of-scope items become
  **Not in this item**, or a card of their own.
- **Done:** how we will know. This becomes the acceptance criteria (§7).
- **Dependencies:** which cards must merge first.
- Anything the documents leave open or contradict, and anything the prototype draws that the
  docs don't cover (or the reverse).

**A task or feature, as it applies:**
- **Data:** new tables, columns or migrations? Kept, soft-deleted or erased (GDPR)?
- **Access:**
  - Who may do it: permission, plan limit, read-only and past-due behaviour, support sessions.
  - What a supplier, another store or another partner must never see (the isolation matrix,
    ACCESS §11).
- **Side effects:** emails, texts, webhooks, jobs, cache purges, and the audit entry (LOGGING §3).
- **UI:**
  - Which prototype screens, at what widths.
  - The empty, loading, error, permission-denied and read-only states.
  - Wording, if the prototype doesn't give it.
- **Third parties:** which provider, test or live accounts, keys still missing
  (THIRD-PARTY-ACCESS).

**A bug:**
- **Where:** the environment (local, dev, prod, a feature environment), the URL or host, the
  portal and the role signed in.
- **Steps:** numbered, from a known starting state (seed data, which store or partner), to the
  wrong result. Ask until they can be replayed by someone who wasn't there.
- **Expected and actual:** what should happen, and what happens instead, word for word:
  messages, error codes, screenshots, request ids from the logs. Never a secret or a customer's
  personal data.
- **How often:** always or sometimes, and since when (a release, a merge, a date).
- **What is affected:** who is affected, and whether data is wrong or lost (which needs a
  repair step on the card).
- **The smallest fix,** said before anything bigger (AGENTS.md rule 6). If the only fixes change
  behaviour or need additions, those become options in a question, each naming what it adds.

Take the person's answers into the card's **Decided** section, dated and attributed:
"Decided (2026-10-07, Gaurav)".

---

## 5. The card: every kind

**Title:** what changes, in plain words, without the issue number. For a bug, the wrong
behaviour: "Partner branding only changes colours in the store portal".

**Issue type:** Task, Bug or Feature. **Board:** DF Platform, column **BackLog**, **no
assignee** unless the request names one.

**Body sections, in this order:**

| Section | Says |
|---|---|
| **Kind and branch** | `Task, #<n>/task/<short-name>`. The short name follows WORKFLOW §2; the real number goes in after creation (§8) |
| **Folders** | The only folders the change may touch (WORKFLOW §3) |
| **Read first** | The document sections that decide the design, the prototype screens for UI, the style guide for anything visual |
| *(bug only)* **Environment**, **Steps to reproduce**, **Expected**, **Actual**, **Cause** if known | §6 |
| **Decided** | Every answer from §4, dated and attributed; the open questions the card leaves to the documented default, said as such |
| **Do** | The steps, numbered |
| **Prompt for Claude** | §7 |
| **Done when** | The acceptance criteria as checkboxes, §7 |
| **Not in this item** | What looks related but is out, with the card it belongs to if one exists |
| **Needs** | Cards that must merge first, or "Nothing" |
| Last line | `How to work a card: [docs/code/HOW-TO-WORK-A-CARD.md](docs/code/HOW-TO-WORK-A-CARD.md)` |

#312 is a task card in this shape, and #448 a bug card.

---

## 6. The bug sections

```
**Environment:** dev (store.acme.dripfunnel.ai), signed in as the store's Owner; seed data, store "Jaipur Looms".

**Steps to reproduce**
1. Open Orders and pick an order paid by card and not shipped.
2. Choose Cancel order, reason "Out of stock", and confirm.
3. Open Products › the order's item › Stock.

**Expected:** the order is cancelled, the shopper is refunded, and the item's reserved count drops by the order's quantity.
**Actual:** the order stays placed, the toast says "The payment provider didn't answer", and reserved has still dropped.

**Cause** (if known): `cancel` returns the refusal instead of throwing it, so the stock release commits (refunds.ts).
```

- Steps start from a state anyone can recreate: seed data, a named store, a role. They are
  numbered and do one thing each.
- Expected and actual are observable: on screen, in the API answer or in the database. "It
  doesn't work" is not an actual result.
- If it happens only sometimes, say how often, and what was different when it did.
- If the cause isn't known, leave it out rather than guess. The prompt then starts by finding
  it.

---

## 7. The prompt and the acceptance criteria

**Prompt for Claude.** One fenced block someone can paste into Claude Code as it is,
complete enough that nothing in it has to be looked up first. It says:
- **What to read:** the "Read first" sections by name; the prototype file and screen for UI work;
  the style guide for anything visual.
- **What the card is:** the number, the goal in two or three sentences, and to follow its
  **Decided** section.
- **Where to work:** the folders, and the layer for API code.
- **What to build:** the **Do** steps restated as instructions, with the rules that bite in this
  area: tenancy, permissions, money in minor units, the audit entry, the outbox for side effects.
- **The tests to write with the code:** the isolation cases for anything touching store data
  (caller kind × store × seller). For a bug, **a test that reproduces it first and fails**, then
  the fix.
- **For a bug, the smallest fix:** no new tables, endpoints or screens unless the bug can't be
  fixed without them, and anything else noticed goes in the reply as a suggested card.
- **What to do when the docs are silent:** record an open question on the card and take the
  documented default, or stop and ask if there is none.
- **The commands to run and report:** `pnpm turbo run build typecheck lint test`, and for API
  work the integration tests.
- To update the docs the change makes wrong, in the same change.
- **"Do not commit, branch or push"**, unless the card is for an unattended run that has that
  permission.

A card for design-heavy work may give a **starting** prompt instead: read these, then ask these
questions before building.

**Done when: the acceptance criteria.** Required on every card, as checkboxes (`- [ ]`). Each one
is a fact someone can check without reading the code. It covers:
- **Behaviour:** what a named role sees or can do, what is refused and with which code, and for a
  bug, "the steps above now give the expected result".
- **Tests:** the case that proves it, the isolation tests ACCESS §11 asks for, and for a bug the
  test that failed before the fix.
- **UI:** the screen next to its prototype at 390 and 1440 px, with each state.
- **Gates:** `pnpm turbo run build typecheck lint test` passes, and the integration tests for API
  work.
- **Docs:** which documents are updated.

Avoid criteria nobody can prove: "works well", "is fast", "clean code".

---

## 8. Creating it

Only after the person says yes to the draft:

1. **Create the issue** in `dripfunnel/platform` with its title, body and issue type. The
   number is unknown until it exists (issues and pull requests share one sequence), so create it
   with `#<n>` in the branch name.
2. **Update the body** with the real number in **Kind and branch**.
3. **Add it to the DF Platform project** (org `dripfunnel`, project 1) in **BackLog**, with no
   assignee unless the request named one.
4. **Reply with the link,** the column and anything left open.

Nothing else: no branch, no code. Work starts when someone picks the card up
(HOW-TO-WORK-A-CARD §3).

---

## 9. Before you show the draft

- [ ] Every question is answered, or recorded as left to a named documented default.
- [ ] The kind is right, and the branch follows WORKFLOW §2.
- [ ] **Read first** names the decisive sections, and the prototype and style guide for UI.
- [ ] A bug has its environment, numbered steps, expected and actual results.
- [ ] The prompt is complete and pasteable, and names the tests and gates.
- [ ] Every acceptance criterion is a checkbox someone can verify.
- [ ] **Not in this item** holds what was left out, and **Needs** the cards that come first.
- [ ] The scope is what was asked, nothing more (AGENTS.md rule 6).
