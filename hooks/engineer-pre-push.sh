#!/usr/bin/env bash
# Pre-push gate for the `engineer` agent.
#
# Wired as a PreToolUse / Bash hook (see hooks/hooks.json). Fires on every Bash
# call but no-ops unless:
#   1. the command contains `git push`, AND
#   2. the cwd is an engineer worktree under `/tmp/harness-claude-code/<repo>/worktrees/`.
#
# When it fires, it runs the **fullstack** check set — backend AND frontend —
# regardless of which mode (A/B/C) the engineer is in. The engineer is
# fullstack by spec: even a Mode A task that nominally touches one side may
# cross the boundary, and the hook is the last gate before the slice branch
# leaves the worktree. Each stack's checks are guarded on the directory
# actually existing in this worktree, so a backend-only or frontend-only
# project still runs cleanly.
#
# Checks (matching skills/pattern-engineer-{python,frontend-standard,container}/SKILL.md):
#   container-presence: every deployable surface (backend/, frontend/, or a
#              root-level single-package layout) must have a Dockerfile +
#              .dockerignore, plus a top-level compose.yaml / docker-compose.yaml.
#              Push is denied with an explicit list of missing files if any are
#              absent — first slice that touches the surface owns creating them.
#   lockfile-tracked: every lockfile that exists in the worktree
#              (package-lock.json, pnpm-lock.yaml, uv.lock, poetry.lock,
#              Pipfile.lock, yarn.lock, Cargo.lock) must be tracked in git and
#              free of uncommitted modifications. PR #165's CI cache step
#              broke because `e2e/package-lock.json` was generated but never
#              `git add`-ed; the lockfile referenced by a CI cache key must
#              be visible to the workflow.
#   worktree-committed: the general case of lockfile-tracked — the slice branch
#              must leave the worktree with NOTHING uncommitted (no untracked,
#              no unstaged, no staged-but-uncommitted path). The failure this
#              closes: a TDD engineer that stages each commit by explicit path
#              while wrongly believing a module is pre-existing never names the
#              one file it authored at GREEN to `git add`. The file stays on
#              disk, so every local gate that reads the worktree — the test
#              suite AND this hook's own backend/frontend/smoke/e2e steps —
#              stays green; only a clean CI checkout that lacks the file fails,
#              after the branch has already left the worktree. `git status
#              --porcelain` honors .gitignore, so build output / .venv /
#              node_modules never trip it.
#   bootstrap: deps must be installed before any --no-install / uv run check
#              fires. Missing .venv → `uv sync`; missing node_modules →
#              `npm ci` (falls back to `npm install` if no lockfile yet).
#              Without this, `npx --no-install biome ...` and `uv run ruff ...`
#              fail with "command not found" rather than running the check —
#              an engineer who skipped local `npm ci` would have green hook
#              output and red CI.
#   stack-checks: per-surface toolchain gate, two tiers. DELEGATE — a surface
#              that ships `scripts/ci-checks.sh` (scaffold-project's
#              single-sourced gate: the SAME script the CI workflow and the
#              project's committed .githooks/pre-push run) runs exactly that
#              script and nothing else, so this hook can never drift from CI
#              and a new stack never requires editing this file. NOTE: mutation
#              testing (scripts/mutation.sh — the deterministic discharge of
#              pattern-test-coverage's deletable-code lens) is DELIBERATELY NOT
#              part of ci-checks.sh and is not run here: it executes the suite
#              once per mutant, so it lives in its own diff-scoped PR-validation
#              CI job, never in this interactive push path which must stay fast.
#              FALLBACK —
#              no ci-checks.sh: detect the surface's build manifest and run
#              the built-in set matching the pattern-engineer-<lang> skill:
#                pyproject.toml → uv run ruff / ruff format --check / mypy /
#                                 bandit / pytest
#                package.json   → biome check / tsc --noEmit / jest-or-vitest
#                go.mod         → gofmt -l / go vet / golangci-lint / go test -race
#                Cargo.toml     → cargo fmt --check / clippy -D warnings / cargo test
#                gradlew|mvnw   → ./gradlew check | ./mvnw verify
#                Package.swift  → swift build / swift test
#              A manifest whose toolchain binary is absent is a recorded
#              coverage gap (missing_toolchains), never a silent pass.
#   container-smoke: presence ≠ correctness. `docker compose up -d --build`
#              the worktree's stack with a slug-tagged image + slug-named
#              project, poll `/healthz` (and the SPA root, and a sample
#              `/api/...` route if declared) for 200s, then
#              `docker compose down -v` on EXIT. Catches nginx misconfig
#              (try_files, proxy_pass), missing /health, alembic-not-run,
#              SECURE_COOKIES-as-hard-coded, Settings()-eager-crash, and
#              container-user-not-able-to-write-PID — the cluster of runtime
#              defects that escaped PR #165's bootstrap.
#   e2e:       Playwright suite against the brought-up stack. Gated on
#              `e2e/tests/*.spec.ts` existing AND container-smoke having
#              brought a stack up. Catches strict-mode locator violations,
#              auth-flow semantic regressions (e.g. reset auto-logging-in),
#              empty-state-outside-`<main>`, and missing-endpoint-stub
#              failures that previously only surfaced in CI.
#   security:  universal, language-agnostic scans with a FIX-AWARE policy:
#              - gitleaks (secrets): BACKSTOP only — the primary home is the
#                consuming project's pre-commit hook (scaffold wires
#                .githooks/pre-commit) so a secret never enters a commit at
#                all; push-time is too late to prevent the leak from landing
#                in history. Here we scan just the outgoing commit range and
#                block on any hit.
#              - trivy fs (dependency CVEs + secrets + IaC misconfig, all
#                ecosystems): blocks ONLY on actionable findings — a CVE
#                with a released FixedVersion (bump the dep / base image), a
#                committed secret, or a misconfiguration. A HIGH/CRITICAL
#                CVE with NO upstream fix never blocks the push: it is
#                surfaced as an advisory via additionalContext and the
#                engineer files a tracking issue instead — an unfixable CVE
#                would otherwise wedge every push indefinitely.
#              - osv-scanner: FALLBACK lockfile scanner when trivy is absent
#                (broad lockfile coverage; its exit code can't split fixable
#                from unfixable, so an accepted-unfixable finding is
#                suppressed the OSV-idiomatic way — an IgnoredVulns entry in
#                osv-scanner.toml citing the tracking issue).
#              - semgrep (SAST): code-pattern findings are always actionable
#                — there is no "upstream fix" to wait for — so ERROR
#                severity blocks unconditionally.
#              Language-specific SAST (bandit, njsscan, gosec) belongs to the
#              stack-checks tier / ci-checks.sh, not here.
#              Behavior: when a scanner binary is present, it MUST pass;
#              when absent, the hook still emits a warning so the engineer
#              and the user can see the coverage gap. We don't auto-install
#              (toolchain churn isn't the hook's job), but we no longer let
#              "no binary installed" masquerade as "everything is fine."
#
# When checks fail, the hook emits a PreToolUse JSON deny on stdout — the
# `permissionDecisionReason` field is surfaced back to Claude (the engineer
# agent), so it can read the failure summary, fix the underlying issue, and
# retry the push.

set -uo pipefail

note() { printf '[engineer-pre-push] %s\n' "$*" >&2; }

deny() {
  # Emit a PreToolUse permission decision so Claude sees the reason.
  # See https://code.claude.com/docs/en/hooks.md (PreToolUse → hookSpecificOutput).
  local reason="$1"
  local context="${2:-}"
  jq -nc \
    --arg reason "$reason" \
    --arg context "$context" \
    '{
      hookSpecificOutput: (
        {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: $reason
        }
        + (if $context == "" then {} else {additionalContext: $context} end)
      )
    }'
  exit 0
}

allow_with_context() {
  # Let the push proceed (no permission decision — normal permission flow
  # continues) but inject context back to Claude. Used for non-blocking
  # advisories the engineer must act on AFTER the push (e.g. unfixable-CVE
  # tracking issues).
  jq -nc --arg context "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: $context
    }
  }'
  exit 0
}

input="$(cat)"

tool_name="$(printf '%s' "$input" | jq -r '.tool_name // ""')"
command="$(printf '%s' "$input" | jq -r '.tool_input.command // ""')"
cwd="$(printf '%s' "$input" | jq -r '.cwd // ""')"

# Only intercept Bash + git push.
[ "$tool_name" = "Bash" ] || exit 0
case "$command" in
  *"git push"*) ;;
  *) exit 0 ;;
esac

# Only fire inside an engineer-managed worktree. Outside that path, this is a
# user-driven push and we let it through untouched. Match the
# */harness-claude-code/*/worktrees/* segment rather than the leading /tmp
# prefix: on macOS /tmp is a symlink to private/tmp, so the cwd the hook
# receives is the resolved /private/tmp/harness-claude-code/.../worktrees/...
# path.
case "$cwd" in
  */harness-claude-code/*/worktrees/*) ;;
  *) exit 0 ;;
esac

if ! git -C "$cwd" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  note "cwd '$cwd' is not a git worktree; skipping checks"
  exit 0
fi

slice_branch="$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
if [ -z "${slice_branch}" ] || [ "${slice_branch}" = "HEAD" ]; then
  deny "engineer-pre-push: could not resolve slice branch in '$cwd' (detached HEAD?)"
fi

# Fullstack always — each stack's runner is internally gated on the matching
# directory existing under the worktree, so a backend-only or frontend-only
# project still runs cleanly.
note "running fullstack pre-push checks for branch '${slice_branch}'"

# --- per-stack runners -------------------------------------------------------

failures=()
fail_logs=""
missing_scanners=()

run_step() {
  local label="$1"
  shift
  note "  → ${label}: $*"
  local out
  if ! out="$( "$@" 2>&1 )"; then
    failures+=("${label}")
    note "    ✗ ${label} FAILED"
    fail_logs+=$'\n--- '"${label}"$' ---\n'"${out}"$'\n'
  fi
}

run_lockfile_tracked_check() {
  # Every lockfile that exists must be tracked in git AND free of uncommitted
  # modifications. PR #165's failure mode: `e2e/package-lock.json` was
  # generated by `npm install` but never staged — so the GitHub Actions
  # `setup-node` step couldn't resolve the path declared in
  # `cache-dependency-path` and the whole job aborted before any check ran.
  #
  # Scope: every lockfile flavor we recognize, anywhere under the worktree
  # except the usual ignore boundaries (node_modules, .venv, .git, dist,
  # build). Both "untracked" (never `git add`-ed) and "modified" (staged or
  # unstaged change vs HEAD) count as a failure — the lockfile a workflow
  # caches against must be exactly the lockfile in the pushed tree.

  local lock_patterns=(
    "package-lock.json"
    "pnpm-lock.yaml"
    "yarn.lock"
    "uv.lock"
    "poetry.lock"
    "Pipfile.lock"
    "Cargo.lock"
  )

  local untracked=()
  local pat
  for pat in "${lock_patterns[@]}"; do
    # Untracked = present on disk, unknown to git. `git ls-files --others
    # --exclude-standard` honors .gitignore, so a lockfile that's
    # explicitly-ignored (rare but possible) won't trip this.
    while IFS= read -r f; do
      [ -z "$f" ] && continue
      untracked+=("$f")
    done < <(git -C "$cwd" ls-files --others --exclude-standard -- "**/$pat" "$pat" 2>/dev/null | sort -u)
  done

  local modified=()
  for pat in "${lock_patterns[@]}"; do
    # `git status --porcelain` for tracked-and-modified files.
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      # Strip the two-char status prefix.
      modified+=("${line:3}")
    done < <(git -C "$cwd" status --porcelain -- "**/$pat" "$pat" 2>/dev/null \
             | grep -v '^??' || true)
  done

  if [ "${#untracked[@]}" -gt 0 ] || [ "${#modified[@]}" -gt 0 ]; then
    local list=""
    local f
    for f in ${untracked[@]+"${untracked[@]}"}; do list+=$'\n  - untracked: '"${f}"; done
    for f in ${modified[@]+"${modified[@]}"}; do list+=$'\n  - modified:  '"${f}"; done
    deny \
      "engineer-pre-push: blocking git push for ${slice_branch} — lockfile drift detected (untracked or uncommitted)" \
      "Every lockfile in the worktree must be tracked in git and free of uncommitted changes — CI workflows that cache against \`cache-dependency-path\` will fail if the lockfile they reference is missing or stale on the pushed tree. PR #165 hit exactly this with \`e2e/package-lock.json\` generated but never staged. Files flagged now:${list}

Stage and commit the lockfile(s) (\`chore(deps): commit <name>\` or fold into the same scaffold commit that introduced the package), then retry the push."
  fi

  note "lockfile-tracked check OK"
}

run_worktree_committed_check() {
  # The general case of run_lockfile_tracked_check. The most dangerous gap a
  # TDD engineer can leave is a file it AUTHORED but never `git add`-ed: it
  # staged each commit by explicit path while wrongly believing the module was
  # pre-existing, so the new file was never named to `git add`. Because the
  # file is still present on disk, every local gate that reads the worktree —
  # the test suite, and this hook's own backend/frontend/smoke/e2e steps —
  # stays green and never notices it was never committed. Only a clean CI
  # checkout (which doesn't have the file) fails, after the branch has left
  # the worktree.
  #
  # Invariant: the slice branch must leave the worktree with NOTHING
  # uncommitted. Runs BEFORE run_dep_bootstrap so an in-hook `uv sync` /
  # `npm ci` can't muddy the signal. `git status --porcelain` already honors
  # .gitignore, so an explicitly-ignored path (build output, .venv,
  # node_modules) never trips this — only tracked-but-modified and
  # untracked-not-ignored paths do.

  local dirty
  dirty="$(git -C "$cwd" status --porcelain 2>/dev/null || true)"
  if [ -z "$dirty" ]; then
    note "worktree-committed check OK"
    return
  fi

  # Partition for a more actionable message: `??` = untracked (the authored-
  # but-never-added smoking gun); anything else = a tracked path with staged
  # or unstaged changes that was never committed.
  local untracked="" tracked=""
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    case "$line" in
      '??'*) untracked+=$'\n  - untracked:   '"${line:3}" ;;
      *)     tracked+=$'\n  - uncommitted: '"${line:3}" ;;
    esac
  done <<EOF
${dirty}
EOF

  deny \
    "engineer-pre-push: blocking git push for ${slice_branch} — worktree is not clean; authored changes were never committed" \
    "The slice branch must leave the worktree with nothing uncommitted. Local gates (the test suite, this hook's own checks) read files from disk, so a file you authored but never \`git add\`-ed stays green here and only fails on a clean CI checkout that doesn't have it. Never assume a module is pre-existing — \`git add\` every path you touched and confirm \`git status\` is empty before pushing. Uncommitted now:${untracked}${tracked}

Stage and commit the listed path(s) onto the slice branch (same \`Task:\` / \`Refs\` trailers as your other commits), or — if a path is genuinely build output or scratch — add it to .gitignore, then retry the push."
}

run_dep_bootstrap() {
  # Install deps before any check fires. The downstream commands —
  # `npx --no-install biome ...`, `uv run ruff ...`, `npx playwright test` —
  # all assume their environment is materialized; without this step they
  # fail with "command not found", which an engineer can easily misread as
  # a hook bug. Better to install once here and run real checks against a
  # real env.

  if [ -d "$cwd/backend" ] && [ -f "$cwd/backend/pyproject.toml" ]; then
    if [ ! -d "$cwd/backend/.venv" ]; then
      note "backend/.venv missing — bootstrapping with 'uv sync'"
      ( cd "$cwd/backend" && uv sync ) || \
        deny "engineer-pre-push: 'uv sync' failed in backend/ — cannot bootstrap deps" \
             "Run \`cd backend && uv sync\` manually to see the underlying error; the hook cannot proceed without a usable .venv."
    fi
  fi

  if [ -d "$cwd/frontend" ] && [ -f "$cwd/frontend/package.json" ]; then
    if [ ! -d "$cwd/frontend/node_modules" ]; then
      note "frontend/node_modules missing — bootstrapping"
      if [ -f "$cwd/frontend/package-lock.json" ]; then
        ( cd "$cwd/frontend" && npm ci ) || \
          deny "engineer-pre-push: 'npm ci' failed in frontend/ — cannot bootstrap deps" \
               "Run \`cd frontend && npm ci\` manually to see the underlying error."
      else
        ( cd "$cwd/frontend" && npm install ) || \
          deny "engineer-pre-push: 'npm install' failed in frontend/" \
               "Run \`cd frontend && npm install\` manually to see the underlying error."
      fi
    fi
  fi

  if [ -d "$cwd/e2e" ] && [ -f "$cwd/e2e/package.json" ]; then
    if [ ! -d "$cwd/e2e/node_modules" ]; then
      note "e2e/node_modules missing — bootstrapping"
      if [ -f "$cwd/e2e/package-lock.json" ]; then
        ( cd "$cwd/e2e" && npm ci ) || \
          deny "engineer-pre-push: 'npm ci' failed in e2e/ — cannot bootstrap deps" \
               "Run \`cd e2e && npm ci\` manually."
      else
        ( cd "$cwd/e2e" && npm install ) || \
          deny "engineer-pre-push: 'npm install' failed in e2e/" \
               "Run \`cd e2e && npm install\` manually."
      fi
    fi
  fi

  note "dep bootstrap OK"
}

# --- stack checks: delegate to ci-checks.sh, fall back to manifest detection --

missing_toolchains=()

require_toolchain() {
  # require_toolchain <binary> <surface-label> → 0 when on PATH; otherwise
  # record the coverage gap (same loud-warning policy as missing scanners)
  # and return 1 so the caller skips that toolchain's checks.
  if command -v "$1" >/dev/null 2>&1; then return 0; fi
  note "  → ${2}: toolchain '$1' not on PATH — skipping its checks (coverage gap)"
  missing_toolchains+=("$1 (${2})")
  return 1
}

run_surface_checks() {
  # One deployable surface (backend/, frontend/, or the worktree root for a
  # single-package layout). Tier 1: a committed scripts/ci-checks.sh — the
  # scaffold's single-sourced gate that CI and the project's .githooks
  # pre-push also run — wins outright; running anything else alongside it
  # would reintroduce the hook↔CI drift it exists to kill. Tier 2: built-in
  # checks per build manifest, matching the corresponding
  # pattern-engineer-<lang> skill's tooling section.
  local dir="$1" label="$2"

  if [ -f "$dir/scripts/ci-checks.sh" ]; then
    run_step "${label}:ci-checks" bash -c "cd '$dir' && bash scripts/ci-checks.sh"
    return
  fi

  if [ -f "$dir/pyproject.toml" ]; then
    require_toolchain uv "$label" || return 0
    pushd "$dir" >/dev/null
    run_step "${label}:lint"     uv run ruff check .
    run_step "${label}:format"   uv run ruff format --check .
    run_step "${label}:type"     uv run mypy .
    run_step "${label}:security" uv run bandit -r .
    run_step "${label}:test"     uv run pytest
    popd >/dev/null
  elif [ -f "$dir/go.mod" ]; then
    require_toolchain go "$label" || return 0
    run_step "${label}:format" bash -c "cd '$dir' && unformatted=\"\$(gofmt -l .)\" && { [ -z \"\$unformatted\" ] || { echo \"gofmt needed: \$unformatted\"; exit 1; }; }"
    run_step "${label}:vet"    bash -c "cd '$dir' && go vet ./..."
    if command -v golangci-lint >/dev/null 2>&1; then
      run_step "${label}:lint" bash -c "cd '$dir' && golangci-lint run"
    else
      note "  → ${label}: golangci-lint not on PATH — skipping lint (coverage gap)"
      missing_toolchains+=("golangci-lint (${label})")
    fi
    run_step "${label}:test"   bash -c "cd '$dir' && go test -race ./..."
  elif [ -f "$dir/Cargo.toml" ]; then
    require_toolchain cargo "$label" || return 0
    run_step "${label}:format" bash -c "cd '$dir' && cargo fmt --check"
    run_step "${label}:lint"   bash -c "cd '$dir' && cargo clippy --all-targets -- -D warnings"
    run_step "${label}:test"   bash -c "cd '$dir' && cargo test"
  elif [ -f "$dir/gradlew" ]; then
    require_toolchain java "$label" || return 0
    run_step "${label}:check" bash -c "cd '$dir' && ./gradlew --no-daemon check"
  elif [ -f "$dir/mvnw" ]; then
    require_toolchain java "$label" || return 0
    run_step "${label}:check" bash -c "cd '$dir' && ./mvnw -q verify"
  elif [ -f "$dir/Package.swift" ]; then
    require_toolchain swift "$label" || return 0
    run_step "${label}:build" bash -c "cd '$dir' && swift build"
    run_step "${label}:test"  bash -c "cd '$dir' && swift test"
  elif [ -f "$dir/package.json" ]; then
    require_toolchain npx "$label" || return 0
    pushd "$dir" >/dev/null
    run_step "${label}:lint" npx --no-install biome check .
    run_step "${label}:type" npx --no-install tsc --noEmit
    # No `npm audit` here: dependency-CVE gating lives in security:trivy-fs,
    # which can block on fixable CVEs only — `npm audit` cannot make that
    # distinction and would wedge the push on advisories with no released fix.
    if npx --no-install jest --version >/dev/null 2>&1; then
      run_step "${label}:test" npx --no-install jest
    elif npx --no-install vitest --version >/dev/null 2>&1; then
      run_step "${label}:test" npx --no-install vitest run
    else
      note "  → ${label}: no jest/vitest resolvable — skipping unit tests (coverage gap)"
      missing_toolchains+=("jest|vitest (${label})")
    fi
    popd >/dev/null
  else
    note "  → ${label}: no ci-checks.sh and no recognized build manifest — skipping stack checks"
  fi
}

run_stack_checks() {
  local found=0
  if [ -d "$cwd/backend" ];  then found=1; run_surface_checks "$cwd/backend" "backend"; fi
  if [ -d "$cwd/frontend" ]; then found=1; run_surface_checks "$cwd/frontend" "frontend"; fi
  if [ "$found" -eq 0 ]; then
    # Single-package layout — the manifest sits at the worktree root.
    run_surface_checks "$cwd" "root"
  fi
}

# Non-blocking vulnerability advisories (unfixable CVEs). Collected by
# run_security_scans; surfaced via allow_with_context after the verdict so
# the engineer files tracking issues without the push being held hostage.
ADVISORIES=""

run_security_scans() {
  # Universal, language-agnostic security scans with a FIX-AWARE policy (see
  # the header). Each scanner runs when its binary is on PATH. When a binary
  # is absent the hook still flags the coverage gap (via `missing_scanners`)
  # so the engineer / user can't mistake "scanner not installed" for "no
  # findings."
  missing_scanners=()

  # gitleaks — BACKSTOP for secrets. The primary defense is the consuming
  # project's pre-commit hook (scaffold-project wires .githooks/pre-commit
  # with `gitleaks protect --staged`), which stops a secret before it enters
  # a commit at all. Here we scan only the OUTGOING commit range: cheap, and
  # it doesn't re-flag already-pushed history this push can't rewrite.
  if command -v gitleaks >/dev/null 2>&1; then
    local upstream
    upstream="$(git -C "$cwd" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)"
    if [ -n "$upstream" ]; then
      run_step "security:gitleaks" gitleaks detect --source "$cwd" --no-banner --redact --log-opts "${upstream}..HEAD"
    else
      # First push of the branch — no upstream yet; scan the full worktree.
      run_step "security:gitleaks" gitleaks detect --source "$cwd" --no-banner --redact
    fi
  else
    note "security:gitleaks — binary not on PATH; coverage gap"
    missing_scanners+=("gitleaks")
  fi

  # trivy — dependency CVEs (all lockfile ecosystems) + secrets + IaC
  # misconfig. One JSON scan, partitioned by actionability:
  #   - vulnerabilities WITH a FixedVersion → block (bump the dep/base image)
  #   - secrets + misconfigurations        → block (always fixable in-tree)
  #   - vulnerabilities WITHOUT a fix      → advisory: never blocks; the
  #     engineer files a tracking issue (kind:enhancement) per finding.
  if command -v trivy >/dev/null 2>&1; then
    local trivy_json trivy_err
    trivy_json="$(mktemp)"
    if ! trivy_err="$(trivy fs --quiet \
        --severity HIGH,CRITICAL \
        --scanners vuln,secret,misconfig \
        --skip-dirs node_modules --skip-dirs .venv --skip-dirs .git \
        --format json --output "$trivy_json" \
        "$cwd" 2>&1)"; then
      failures+=("security:trivy-fs")
      fail_logs+=$'\n--- security:trivy-fs ---\ntrivy scan itself failed:\n'"${trivy_err}"$'\n'
    else
      local fixable unfixable leaked misconf
      fixable="$(jq -r '[.Results[]?.Vulnerabilities[]? | select((.FixedVersion // "") != "")] | .[:20][] | "  - \(.VulnerabilityID) \(.PkgName)@\(.InstalledVersion) → fixed in \(.FixedVersion)"' "$trivy_json" 2>/dev/null || true)"
      unfixable="$(jq -r '[.Results[]?.Vulnerabilities[]? | select((.FixedVersion // "") == "")] | .[:20][] | "  - \(.VulnerabilityID) \(.PkgName)@\(.InstalledVersion) (\(.Severity), no fixed version released)"' "$trivy_json" 2>/dev/null || true)"
      leaked="$(jq -r '[.Results[]? | .Target as $t | .Secrets[]? | "  - \($t): \(.Title)"] | .[:10][]' "$trivy_json" 2>/dev/null || true)"
      misconf="$(jq -r '[.Results[]? | .Target as $t | .Misconfigurations[]? | "  - \($t): \(.ID) \(.Title)"] | .[:10][]' "$trivy_json" 2>/dev/null || true)"
      if [ -n "${fixable}${leaked}${misconf}" ]; then
        failures+=("security:trivy-fs")
        fail_logs+=$'\n--- security:trivy-fs (actionable findings — fix before pushing) ---\n'
        [ -n "$fixable" ] && fail_logs+=$'Fixable HIGH/CRITICAL CVEs (upgrade the dependency / base image):\n'"${fixable}"$'\n'
        [ -n "$leaked"  ] && fail_logs+=$'Secrets in the tree (remove + rotate):\n'"${leaked}"$'\n'
        [ -n "$misconf" ] && fail_logs+=$'IaC misconfigurations:\n'"${misconf}"$'\n'
      else
        note "security:trivy-fs — no actionable HIGH/CRITICAL findings"
      fi
      if [ -n "$unfixable" ]; then
        ADVISORIES+=$'\n--- security:trivy-fs — HIGH/CRITICAL CVEs with NO released fix (non-blocking) ---\n'"${unfixable}"$'\n'
      fi
    fi
    rm -f "$trivy_json"
  elif command -v osv-scanner >/dev/null 2>&1; then
    # Fallback when trivy is absent: osv-scanner covers the same lockfile
    # ecosystems but its exit code can't split fixable from unfixable. An
    # accepted-unfixable finding is suppressed the OSV-idiomatic way — an
    # IgnoredVulns entry in osv-scanner.toml with the tracking-issue URL as
    # the reason — so the gate stays meaningful.
    run_step "security:osv-scanner" osv-scanner --recursive "$cwd"
  else
    note "security:trivy-fs / osv-scanner — neither binary on PATH; dependency-CVE coverage gap"
    missing_scanners+=("trivy (or osv-scanner)")
  fi

  # semgrep — multi-language SAST. A code-pattern finding is always
  # actionable (the fix is editing the flagged code — there is no upstream
  # release to wait for), so ERROR severity blocks unconditionally.
  if command -v semgrep >/dev/null 2>&1; then
    run_step "security:semgrep" semgrep scan \
      --config auto \
      --severity ERROR \
      --error \
      "$cwd"
  else
    note "security:semgrep — binary not on PATH; coverage gap"
    missing_scanners+=("semgrep")
  fi
}

# Holds the compose-project name when smoke brings the stack up, so the EXIT
# trap can tear it down even if a later step fails.
SMOKE_COMPOSE_PROJECT=""

smoke_teardown() {
  if [ -n "${SMOKE_COMPOSE_PROJECT}" ]; then
    note "tearing down smoke stack (project=${SMOKE_COMPOSE_PROJECT})"
    ( cd "$cwd" && docker compose -p "${SMOKE_COMPOSE_PROJECT}" down -v ) >/dev/null 2>&1 || true
    SMOKE_COMPOSE_PROJECT=""
  fi
}
trap smoke_teardown EXIT

run_container_smoke() {
  # Bring the worktree's compose stack up, then probe it. The probes are the
  # minimum that would have caught PR #165's runtime defects:
  #   - GET /healthz (any host port the backend or its proxy publishes) →
  #     verifies the backend is listening AND that an alembic upgrade ran on
  #     boot (a backend whose ENTRYPOINT forgot `alembic upgrade head` will
  #     /health-fail the moment it touches the DB) AND that
  #     `_secure_cookies()`-style env-driven knobs resolve (Settings()-eager
  #     crashes show up here, not in pytest).
  #   - SPA root + a synthetic deep route (e.g. /signup) → if `try_files
  #     $uri $uri/ /index.html` is missing, the deep route returns nginx's
  #     404 instead of the SPA shell.
  #   - One backend API path through the proxy (e.g. `GET /api/v1/healthz` or
  #     a benign GET listed in $SMOKE_API_PATHS) → if the nginx proxy block
  #     is missing or below the SPA catch-all, the API request returns
  #     `index.html` as `text/html` instead of JSON.
  #
  # The smoke step is gated on a compose file actually existing — the
  # presence check above guarantees one for any deployable surface, so this
  # is effectively unconditional for a real engineer push.

  local compose_file=""
  for candidate in "$cwd/compose.yaml" "$cwd/compose.yml" "$cwd/docker-compose.yaml" "$cwd/docker-compose.yml"; do
    if [ -f "$candidate" ]; then compose_file="$candidate"; break; fi
  done
  if [ -z "$compose_file" ]; then
    note "no compose file in worktree — skipping container smoke"
    return
  fi

  if ! command -v docker >/dev/null 2>&1; then
    note "docker not on PATH — skipping container smoke (coverage gap)"
    missing_scanners+=("docker (container smoke)")
    return
  fi

  # Slug-tag the image and slug-name the compose project, mirroring the
  # engineer agent's per-slice isolation rule, so concurrent worktree runs
  # don't collide on container names or networks.
  local slug
  slug="$(printf '%s' "${slice_branch}" | tr '/' '-' | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._-]/-/g')"
  local repo_name
  repo_name="$(basename "$(git -C "$cwd" rev-parse --show-toplevel)")"
  local image_tag="${repo_name}:${slug}"
  SMOKE_COMPOSE_PROJECT="${slug}"

  note "container smoke: building & bringing up project=${slug} image=${image_tag}"
  local up_out
  if ! up_out="$( cd "$cwd" && IMAGE_TAG="${image_tag}" docker compose -p "${slug}" up -d --build 2>&1 )"; then
    failures+=("container:smoke-up")
    fail_logs+=$'\n--- container:smoke-up ---\n'"${up_out}"$'\n'
    return
  fi

  # Probe URLs come from env (so a project can declare the right routes) with
  # sensible defaults that match scaffold-project's nginx + FastAPI templates.
  local health_url="${SMOKE_HEALTH_URL:-http://localhost:8000/healthz}"
  local spa_url="${SMOKE_SPA_URL:-http://localhost:5173/}"
  local api_url="${SMOKE_API_URL:-}"  # optional — only probed if set

  # Poll /healthz with a real backoff: 30 attempts * 2s = up to 60s for the
  # backend's first-boot migration + uvicorn warmup.
  local i
  local probe_ok=0
  for i in $(seq 1 30); do
    if curl -fsS --max-time 5 "${health_url}" >/dev/null 2>&1; then
      probe_ok=1; break
    fi
    sleep 2
  done
  if [ "$probe_ok" -ne 1 ]; then
    failures+=("container:smoke-health")
    fail_logs+=$'\n--- container:smoke-health ---\nhealth probe at '"${health_url}"$' did not return 200 within 60s.\nLast 80 lines of compose logs:\n'
    fail_logs+="$( cd "$cwd" && docker compose -p "${slug}" logs --tail=80 2>&1 || true )"$'\n'
    return
  fi

  # SPA root must return 200 and contain an HTML shell (smoke check that the
  # build artifacts copied in correctly).
  local spa_out
  if ! spa_out="$( curl -fsS --max-time 10 "${spa_url}" 2>&1 )" \
     || ! printf '%s' "$spa_out" | grep -qi '<html'; then
    failures+=("container:smoke-spa")
    fail_logs+=$'\n--- container:smoke-spa ---\nSPA root probe at '"${spa_url}"$' did not return an HTML shell. Output (first 400 chars):\n'
    fail_logs+="${spa_out:0:400}"$'\n'
  fi

  # API probe through the frontend proxy. If the proxy block is missing the
  # response will be HTML (the SPA catch-all), not JSON — flag that
  # specifically so the engineer sees the actual symptom from PR #165.
  if [ -n "${api_url}" ]; then
    local api_out api_ctype
    api_out="$( curl -fsS --max-time 10 "${api_url}" 2>&1 )" || true
    api_ctype="$( curl -fsS --max-time 10 -o /dev/null -w '%{content_type}' "${api_url}" 2>&1 )" || true
    if printf '%s' "${api_ctype}" | grep -qi 'text/html'; then
      failures+=("container:smoke-api-proxy")
      fail_logs+=$'\n--- container:smoke-api-proxy ---\nAPI probe at '"${api_url}"$' returned text/html — the SPA catch-all is intercepting the request. Add `location /api/ { proxy_pass ... }` BEFORE the `try_files` fallback in the frontend nginx config.\n'
    fi
  fi

  note "container smoke OK"
}

run_e2e_checks() {
  # Run the Playwright suite against the smoke stack. Gated on:
  #   - e2e/ directory present with at least one *.spec.ts
  #   - container smoke succeeded (no point running E2E against a dead stack)
  # The hook does NOT bring its own stack up — it reuses the one
  # `run_container_smoke` brought up, then tears it down via the EXIT trap.

  if [ ! -d "$cwd/e2e" ]; then
    note "no e2e/ directory — skipping E2E run"
    return
  fi

  local specs
  specs="$( find "$cwd/e2e" -type f \( -name '*.spec.ts' -o -name '*.spec.js' \) 2>/dev/null )"
  if [ -z "$specs" ]; then
    note "no E2E specs found under e2e/ — skipping E2E run"
    return
  fi

  # If smoke already failed, don't compound the noise — the engineer fixes
  # the stack first, then re-pushes and gets an E2E signal.
  local f
  for f in ${failures[@]+"${failures[@]}"}; do
    case "$f" in
      container:smoke-*) note "skipping E2E run — container smoke failed; fix the stack first"; return ;;
    esac
  done

  if [ -z "${SMOKE_COMPOSE_PROJECT}" ]; then
    note "skipping E2E run — no smoke stack is up (compose file missing or docker absent)"
    return
  fi

  pushd "$cwd/e2e" >/dev/null
  run_step "e2e:playwright" npx --no-install playwright test
  popd >/dev/null
}

run_container_presence_checks() {
  # Unconditional presence gate for container artifacts. The engineer agent's
  # spec (Mode A step 6 / step 8, Mode B & C step 5) requires every deployable
  # application surface to have a Dockerfile and a .dockerignore, plus a
  # top-level compose file if any deployable surface exists. The "task did not
  # change the runtime surface" loophole does NOT exempt a slice from this —
  # the first slice that touches the surface owns creating these files, and
  # every downstream slice inherits them.
  #
  # Detection rules:
  #   - `backend/`     → requires `backend/Dockerfile` AND `backend/.dockerignore`.
  #   - `frontend/`    → requires `frontend/Dockerfile` AND `frontend/.dockerignore`.
  #   - Neither, but a root-level `pyproject.toml` or `package.json` exists
  #     (single-package layout)            → requires `Dockerfile` AND `.dockerignore`
  #                                          at the worktree root.
  #
  # If any deployable surface is found, a top-level `compose.yaml` or
  # `docker-compose.yaml` (`.yml` variants also accepted) is required at the
  # worktree root to wire the services.
  #
  # Missing files are reported individually so the engineer sees the full list
  # at once instead of one-by-one.

  local missing=()
  local surface_found=0

  if [ -d "$cwd/backend" ]; then
    surface_found=1
    [ -f "$cwd/backend/Dockerfile"     ] || missing+=("backend/Dockerfile")
    [ -f "$cwd/backend/.dockerignore"  ] || missing+=("backend/.dockerignore")
  fi

  if [ -d "$cwd/frontend" ]; then
    surface_found=1
    [ -f "$cwd/frontend/Dockerfile"    ] || missing+=("frontend/Dockerfile")
    [ -f "$cwd/frontend/.dockerignore" ] || missing+=("frontend/.dockerignore")
  fi

  if [ "$surface_found" -eq 0 ] && { [ -f "$cwd/pyproject.toml" ] || [ -f "$cwd/package.json" ]; }; then
    surface_found=1
    [ -f "$cwd/Dockerfile"    ] || missing+=("Dockerfile")
    [ -f "$cwd/.dockerignore" ] || missing+=(".dockerignore")
  fi

  if [ "$surface_found" -eq 1 ]; then
    if [ ! -f "$cwd/compose.yaml" ] && [ ! -f "$cwd/compose.yml" ] \
       && [ ! -f "$cwd/docker-compose.yaml" ] && [ ! -f "$cwd/docker-compose.yml" ]; then
      missing+=("compose.yaml (or docker-compose.yaml) at worktree root")
    fi
  fi

  if [ "${#missing[@]}" -gt 0 ]; then
    note "container presence check FAILED — missing: ${missing[*]}"
    local list=""
    for m in "${missing[@]}"; do list+=$'\n  - '"${m}"; done
    deny \
      "engineer-pre-push: blocking git push for ${slice_branch} — missing required container artifacts: ${missing[*]}" \
      "Every deployable surface in the worktree must ship with a Dockerfile + .dockerignore, plus a top-level compose file. See agents/engineer.md (Best Practices → 'Container setup is a pre-push gate') and skills/pattern-engineer-container/SKILL.md for the multi-stage / pinned / non-root template. Missing now:${list}

Scaffold the missing files (multi-stage, pinned tags, non-root user, secrets via env, no .venv inside images), commit via operation-git as chore(scaffold): <what>, and retry the push."
  fi

  note "container presence check OK"
}

run_container_presence_checks
run_lockfile_tracked_check
run_worktree_committed_check
run_dep_bootstrap
run_stack_checks
run_security_scans
run_container_smoke
run_e2e_checks

# --- verdict -----------------------------------------------------------------

coverage_gaps=""
if [ "${#missing_scanners[@]}" -gt 0 ]; then
  coverage_gaps+="
NOTE: the following security scanners were not on PATH and contributed no coverage to this run: ${missing_scanners[*]}. Install them locally (or in the engineer's container image) to close the gap."
fi
if [ "${#missing_toolchains[@]}" -gt 0 ]; then
  coverage_gaps+="
NOTE: the following toolchains were not on PATH, so their stack checks were skipped: ${missing_toolchains[*]}. Install them (or ship a scripts/ci-checks.sh that provides equivalent gating) to close the gap."
fi

if [ "${#failures[@]}" -gt 0 ]; then
  reason="engineer-pre-push: blocking git push for ${slice_branch} — ${#failures[@]} check(s) failed: ${failures[*]}"
  context="Failed checks: ${failures[*]}. Fix every failure before pushing again — re-run the failing command(s) locally to see full output, commit the fix, then retry the push.${fail_logs}${coverage_gaps}"
  deny "$reason" "$context"
fi

if [ "${#missing_scanners[@]}" -gt 0 ] || [ "${#missing_toolchains[@]}" -gt 0 ]; then
  note "all enforced checks passed, but coverage gaps exist:${coverage_gaps}"
else
  note "all pre-push checks passed — allowing git push"
fi

if [ -n "${ADVISORIES}" ]; then
  # Unfixable HIGH/CRITICAL CVEs: the push proceeds, but each advisory must
  # get a tracking issue so the debt is visible and revisited — never fixed
  # ad hoc in this slice, never silently suppressed.
  allow_with_context "engineer-pre-push: push ALLOWED, but the dependency scan found HIGH/CRITICAL CVEs with no released fix. They do not block this push and you must NOT try to fix them in this slice. AFTER the push completes, create one tracking issue per finding: \`gh issue create --label kind:enhancement --title \"chore(security): track <CVE-id> in <package>\"\` with the affected package@version, why no fix exists yet, and the upgrade trigger to watch. Do not suppress the scanner.${ADVISORIES}${coverage_gaps}"
fi
exit 0
