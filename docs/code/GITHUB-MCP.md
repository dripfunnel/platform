# GITHUB-MCP.md: connect Claude Code to GitHub

How every developer connects Claude Code to GitHub, so Claude can create and update issues,
task cards on the **DripFunnel** project, and pull requests, as you. Do it once per machine.
It takes about 5 minutes.

Last updated: 2026-09-29.

---

## 1. How it works

| Decision | Rejected | Why |
|---|---|---|
| **The server is shared; the token is personal.** [`.mcp.json`](../../.mcp.json) in the repo points Claude Code at GitHub's remote MCP server (`https://api.githubcopilot.com/mcp/`) and reads the token from **your** `GITHUB_PAT` | One shared token; each developer configuring the server themselves | Issues and pull requests show their real author, and a token can do only what its owner can. Everyone gets the same server and tools |
| **Toolsets:** `context`, `repos`, `issues`, `pull_requests`, `users`, `projects`, `labels` | GitHub's defaults | `projects` and `labels` are off by default, and task cards need both ([WORKFLOW.md](WORKFLOW.md) §3) |
| **A fine-grained token limited to `dripfunnel/platform`, 90 days at most** | A classic token with every repository | The least access that works, and it expires by itself |

The token never goes in the repo, in a chat with Claude, in a commit or in a screenshot
(AGENTS.md security rules).

---

## 2. Setup, once per developer

### Step 1: create a fine-grained token

On github.com: **your avatar → Settings → Developer settings → Personal access tokens →
Fine-grained tokens → Generate new token**.

| Field | Value |
|---|---|
| Token name | `claude-code-dripfunnel` |
| Resource owner | **`dripfunnel`** |
| Expiration | 90 days |
| Repository access | Only select repositories → **`dripfunnel/platform`** |
| Repository permissions | **Issues**: Read and write · **Pull requests**: Read and write · **Contents**: Read-only · **Metadata**: Read-only (GitHub sets it) |
| Organization permissions | **Projects**: Read and write |

Copy the token (`github_pat_…`). GitHub shows it only once.

If the organisation requires approval for fine-grained tokens, an org owner approves it
under **dripfunnel → Settings → Personal access tokens → Pending requests**. It doesn't work
until then.

### Step 2: put it in your shell profile

```bash
echo 'export GITHUB_PAT=github_pat_PASTE_YOURS_HERE' >> ~/.zshrc
source ~/.zshrc
```

Use your shell's profile if it isn't zsh (`~/.bashrc` for bash).

**Keep the name `GITHUB_PAT`.** Claude Code sends variables named like `*_TOKEN`, `*_KEY`,
`*_SECRET` or `*_PASSWORD` as **empty** in remote MCP headers, so `GITHUB_TOKEN` would
silently fail.

### Step 3: restart your editor

Quit VS Code completely (**⌘Q**, not just closing the window) and open it again, or start it
from a terminal that already has the variable:

```bash
code ~/projects/df/platform
```

The Claude Code extension only sees `GITHUB_PAT` if the editor started after it was set.
In a terminal, open a new tab instead.

### Step 4: approve the server

In a terminal inside the repo:

```bash
claude
```

Trust the folder, and **approve the `github` server** when asked. The approval is stored
in your own settings, not in the repo.

### Step 5: check it

```bash
claude mcp list
```

You should see:

```
github: https://api.githubcopilot.com/mcp/ (HTTP) - ✔ Connected
```

Inside Claude Code, `/mcp` shows the same. **Start a new conversation**: a conversation
that was open before the server connected doesn't get its tools.

---

## 3. Using it

Ask Claude in plain words, for example:

- "Create a task card for the Orders list screen." Claude writes it in the
  [WORKFLOW.md](WORKFLOW.md) §3 card format, creates the issue in `dripfunnel/platform`,
  and adds it to the DripFunnel project with Kind, Status and assignee.
- "Assign #12 to @username and move it to In progress."
- "What's still in Todo?" or "Show open pull requests waiting for my review."
- "Commit this on the branch for #12 and open the pull request." Claude follows
  [WORKFLOW.md](WORKFLOW.md) §2: branch `#12/<kind>/<short-name>`, and commits and title
  starting with `#12`.

Claude acts with your token, so everything it creates shows you as the author. Review what
it writes before you merge.

---

## 4. When it doesn't work

| What you see | Cause | Fix |
|---|---|---|
| `⏸ Pending approval` | The server hasn't been approved on this machine | Run `claude` in the repo and approve `github` (step 4). To start over: `claude mcp reset-project-choices` |
| A missing-variable warning for `GITHUB_PAT` | The editor or terminal started before the variable was set | `echo $GITHUB_PAT` in a new terminal should print something; then restart the editor (step 3) |
| `401 Unauthorized` | The token is wrong, expired or revoked | Make a new token (step 1) and replace it in `~/.zshrc` |
| `403` or "resource not accessible" | The token lacks a permission, or the org hasn't approved it yet | Check step 1's permissions; ask an org owner to approve the pending request |
| Claude can create issues but not project items | Projects: Read and write is missing (organisation permission) | Edit the token and add it |
| Claude says it has no GitHub tools | The conversation started before the server connected | Start a new conversation |

---

## 5. Rotation and leaving

- **Before the token expires**, make a new one (step 1), replace it in `~/.zshrc` and
  restart the editor. Then delete the old token on GitHub.
- **When a developer leaves**, they revoke their token, or an org owner does under
  **dripfunnel → Settings → Personal access tokens → Active tokens**.
- **If a token leaks** (a commit, a chat, a screenshot), revoke it on GitHub at once and make
  a new one. Removing it from the repo isn't enough.
