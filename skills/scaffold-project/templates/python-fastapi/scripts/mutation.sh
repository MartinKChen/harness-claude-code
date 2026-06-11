#!/usr/bin/env bash
# Single source of truth for the backend's DIFF-SCOPED mutation test.
#
# Mutation testing is the deterministic, executable form of pattern-test-coverage's
# deletable-code lens: a SURVIVING mutant is a line the production code could have
# gotten wrong while the whole suite stayed green — i.e. a concrete coverage gap.
# A reviewer LLM can only *approximate* this by eye; the tool proves it.
#
# Why this is NOT in scripts/ci-checks.sh (and not in the pre-push hook):
#   mutation runs the test suite once PER mutant, so a whole-repo run is minutes-
#   to-hours and would wedge every push. We keep it fast and meaningful by scoping
#   to the DIFF — only the lines this branch changed — and run it as its own CI job
#   (.github/workflows/pr-validation.yml), never in the interactive push path.
#
# Contract (what every stack's mutation.sh guarantees, so CI + the reviewer can rely on it):
#   - argument $1 = the base git ref to diff against (default: origin/main).
#   - mutate ONLY the changed application source vs that base.
#   - write the surviving-mutant report to mutation-report.txt at the surface root.
#   - exit non-zero iff a mutant SURVIVED on a changed line (that is the gate).
#   - no changed source / tool absent → exit 0 with a loud note (never a silent pass).
set -uo pipefail

BASE="${1:-origin/main}"
REPORT="mutation-report.txt"
: > "$REPORT"

# Changed application source on this branch vs the base (exclude tests + migrations —
# a surviving mutant there is noise, not a product-behavior gap).
mapfile -t CHANGED < <(git diff --name-only "${BASE}...HEAD" -- 'app/**/*.py' 2>/dev/null \
  | grep -vE '(^|/)(tests?|migrations|alembic)/' || true)

if [ "${#CHANGED[@]}" -eq 0 ]; then
  echo "==> [backend] mutation: no changed app/ source vs ${BASE} — nothing to mutate." | tee -a "$REPORT"
  exit 0
fi

if ! uv run mutmut --help >/dev/null 2>&1; then
  echo "==> [backend] mutation: mutmut not installed (dev dep) — COVERAGE GAP, not a pass." | tee -a "$REPORT"
  exit 0
fi

echo "==> [backend] mutation: diff-scoped mutmut over ${#CHANGED[@]} changed file(s) vs ${BASE}"
printf '  - %s\n' "${CHANGED[@]}"

# Scope mutmut to exactly the changed files. (Flag name is tool-version-tunable;
# the contract above — diff-scoped run, report file, exit code — is what CI relies on.)
paths="$(IFS=,; echo "${CHANGED[*]}")"
uv run mutmut run --paths-to-mutate "$paths" || true

# Surviving mutants are the gate. `mutmut results` lists them; capture and count.
survivors="$(uv run mutmut results 2>/dev/null | grep -iE 'survived' || true)"
uv run mutmut results 2>/dev/null >> "$REPORT" || true

if [ -n "$survivors" ]; then
  echo "==> [backend] mutation: SURVIVING mutants on changed lines — coverage gap (see ${REPORT})." >&2
  echo "$survivors" >&2
  exit 1
fi

echo "==> [backend] mutation: no surviving mutants on changed lines — diff is mutation-covered."
exit 0
