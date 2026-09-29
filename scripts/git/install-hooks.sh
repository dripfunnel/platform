#!/bin/sh
# Run once per clone: pnpm git-hooks. Outside a git checkout it does nothing.
git rev-parse --git-dir >/dev/null 2>&1 || exit 0
git config core.hooksPath .githooks
git config core.commentChar ';'
