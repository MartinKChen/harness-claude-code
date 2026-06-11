#!/usr/bin/env bash
# Single source of truth for the frontend's DIFF-SCOPED mutation test.
#
# Mutation testing is the deterministic, executable form of pattern-test-coverage's
# deletable-code lens: a SURVIVING mutant is a line the production code could have
# gotten wrong while the whole suite stayed green — i.e. a concrete coverage gap.
# A reviewer LLM can only *approximate* this by eye; the tool proves it.
#
# Why this is NOT in scripts/ci-checks.sh (and not in the pre-push hook):
#   mutation runs the test suite once PER mutant, so a whole-repo run is minutes-
#   to-hours and would wedge every push. Stryker's `--since` mutates ONLY the files
#   changed vs a git ref, which keeps it fast and meaningful; we run it as its own
#   CI job (.github/workflows/pr-validation.yml), never in the interactive push path.
#
# Contract (shared with the backend mutation.sh, so CI + the reviewer can rely on it):
#   - argument $1 = the base git ref to diff against (default: origin/main).
#   - mutate ONLY files changed vs that base (Stryker `--since`).
#   - write the surviving-mutant report to mutation-report.txt at the surface root.
#   - exit non-zero iff a mutant SURVIVED on a changed line (that is the gate).
#   - tool absent → exit 0 with a loud note (never a silent pass).
set -uo pipefail

BASE="${1:-origin/main}"
REPORT="mutation-report.txt"
: > "$REPORT"

if ! npx --no-install stryker --version >/dev/null 2>&1; then
  echo "==> [frontend] mutation: Stryker not installed (dev dep) — COVERAGE GAP, not a pass." | tee -a "$REPORT"
  exit 0
fi

echo "==> [frontend] mutation: diff-scoped Stryker (--since=${BASE})"
# `--since` restricts mutation to files changed vs the base ref; the clear-text
# reporter lists survivors. Stryker's exit code is non-zero when the mutation score
# falls under the configured `thresholds.break`, which we set to gate on survivors.
if npx --no-install stryker run --since="${BASE}" --reporters clear-text,json 2>&1 | tee -a "$REPORT"; then
  echo "==> [frontend] mutation: no surviving mutants on changed lines — diff is mutation-covered."
  exit 0
fi

echo "==> [frontend] mutation: SURVIVING mutants on changed lines — coverage gap (see ${REPORT})." >&2
exit 1
