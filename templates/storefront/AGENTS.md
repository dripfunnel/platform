# AGENTS.md: this store's site

**A push to `main` goes live by itself.** The platform builds the pushed commit, checks it, and puts it
on the store's live address. A change that breaks the theme rules is refused, and the site stays as it was.

**Before every push to `main`, run:**

```bash
pnpm check
```

It runs the build's theme rules on the files git holds, then the TypeScript check, and prints each problem
as `file:line  rule  message`. Fix every problem it prints, and `git add` any file it says is not added,
before you push. A few rules need the store's own data, so only the build checks them; `pnpm check` names
them at the end.
