#!/usr/bin/env bash
# Print, one per line, every E2E spec file added or modified on the current
# slice branch since `origin/main`. Heuristic: a Playwright spec path
# contains one of the common e2e directory markers AND ends in `.spec.ts`,
# `.spec.tsx`, `.spec.js`, or `.test.ts` / `.test.tsx` / `.test.js`.
#
# Run this from inside the slice-branch worktree.
#
# Usage:
#   list-touched-e2e-specs.sh
set -euo pipefail

git fetch origin main >&2

git diff --name-only --diff-filter=AM "origin/main...HEAD" \
  | grep -E '(^|/)(e2e|tests?/e2e|playwright)/' \
  | grep -E '\.(spec|test)\.(ts|tsx|js|jsx|mjs|cjs)$' \
  || true
