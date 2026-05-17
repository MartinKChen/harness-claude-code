#!/usr/bin/env bash
# Pre-push gate for the `engineer` agent.
#
# Wired as a PreToolUse / Bash hook (see hooks/hooks.json). Fires on every Bash
# call but no-ops unless:
#   1. the command contains `git push`, AND
#   2. the cwd is an engineer worktree under `/tmp/git-worktree/`.
#
# When it fires, it runs the **fullstack** check set — backend AND frontend —
# regardless of which mode (A/B/C) the engineer is in. The engineer is
# fullstack by spec: even a Mode A task that nominally touches one side may
# cross the boundary, and the hook is the last gate before the slice branch
# leaves the worktree. Each stack's checks are guarded on the directory
# actually existing in this worktree, so a backend-only or frontend-only
# project still runs cleanly.
#
# Checks (matching skills/tdd-workflow/references/{python,frontend,docker}-patterns.md):
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
#   bootstrap: deps must be installed before any --no-install / uv run check
#              fires. Missing .venv → `uv sync`; missing node_modules →
#              `npm ci` (falls back to `npm install` if no lockfile yet).
#              Without this, `npx --no-install biome ...` and `uv run ruff ...`
#              fail with "command not found" rather than running the check —
#              an engineer who skipped local `npm ci` would have green hook
#              output and red CI.
#   backend:   uv run ruff check . / uv run ruff format --check . / uv run mypy . /
#              uv run bandit -r . / uv run pytest
#   frontend:  biome check . / tsc --noEmit / npm audit / jest
#   container-smoke: presence ≠ correctness. `docker compose up -d --build`
#              the worktree's stack with a slug-tagged image + slug-named
#              project, poll `/health` (and the SPA root, and a sample
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
#   security:  gitleaks (secrets) / trivy fs (CVE + IaC) / semgrep (SAST).
#              Behavior: when the scanner binary is present, it MUST pass;
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
# user-driven push and we let it through untouched.
case "$cwd" in
  /tmp/git-worktree/*) ;;
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
    for f in "${untracked[@]}"; do list+=$'\n  - untracked: '"${f}"; done
    for f in "${modified[@]}"; do list+=$'\n  - modified:  '"${f}"; done
    deny \
      "engineer-pre-push: blocking git push for ${slice_branch} — lockfile drift detected (untracked or uncommitted)" \
      "Every lockfile in the worktree must be tracked in git and free of uncommitted changes — CI workflows that cache against \`cache-dependency-path\` will fail if the lockfile they reference is missing or stale on the pushed tree. PR #165 hit exactly this with \`e2e/package-lock.json\` generated but never staged. Files flagged now:${list}

Stage and commit the lockfile(s) (\`chore(deps): commit <name>\` or fold into the same scaffold commit that introduced the package), then retry the push."
  fi

  note "lockfile-tracked check OK"
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

run_backend_checks() {
  local backend_dir="$cwd/backend"
  if [ ! -d "${backend_dir}" ]; then
    note "backend/ not found under '$cwd' — skipping backend checks"
    return
  fi
  pushd "${backend_dir}" >/dev/null

  run_step "backend:lint"     uv run ruff check .
  run_step "backend:format"   uv run ruff format --check .
  run_step "backend:type"     uv run mypy .
  run_step "backend:security" uv run bandit -r .
  run_step "backend:test"     uv run pytest

  popd >/dev/null
}

run_frontend_checks() {
  local frontend_dir="$cwd/frontend"
  if [ ! -d "${frontend_dir}" ]; then
    note "frontend/ not found under '$cwd' — skipping frontend checks"
    return
  fi
  pushd "${frontend_dir}" >/dev/null

  run_step "frontend:lint"     npx --no-install biome check .
  run_step "frontend:format"   npx --no-install biome check .
  run_step "frontend:type"     npx --no-install tsc --noEmit
  run_step "frontend:security" npm audit
  run_step "frontend:test"     npx --no-install jest

  popd >/dev/null
}

run_security_scans() {
  # Cross-language static security scans. Each scanner runs when its binary
  # is on PATH. When a binary is absent the hook still flags the coverage
  # gap in the deny-context (via `missing_scanners`) so the engineer / user
  # can't mistake "scanner not installed" for "no findings."
  missing_scanners=()

  if command -v gitleaks >/dev/null 2>&1; then
    run_step "security:gitleaks" gitleaks detect --source "$cwd" --no-banner --redact
  else
    note "security:gitleaks — binary not on PATH; coverage gap"
    missing_scanners+=("gitleaks")
  fi

  if command -v trivy >/dev/null 2>&1; then
    run_step "security:trivy-fs" trivy fs \
      --severity HIGH,CRITICAL \
      --skip-dirs node_modules \
      --skip-dirs .venv \
      --skip-dirs .git \
      --exit-code 1 \
      "$cwd"
  else
    note "security:trivy-fs — binary not on PATH; coverage gap"
    missing_scanners+=("trivy")
  fi

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
  #   - GET /health (any host port the backend or its proxy publishes) →
  #     verifies the backend is listening AND that an alembic upgrade ran on
  #     boot (a backend whose ENTRYPOINT forgot `alembic upgrade head` will
  #     /health-fail the moment it touches the DB) AND that
  #     `_secure_cookies()`-style env-driven knobs resolve (Settings()-eager
  #     crashes show up here, not in pytest).
  #   - SPA root + a synthetic deep route (e.g. /signup) → if `try_files
  #     $uri $uri/ /index.html` is missing, the deep route returns nginx's
  #     404 instead of the SPA shell.
  #   - One backend API path through the proxy (e.g. `GET /api/v1/health` or
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
  local health_url="${SMOKE_HEALTH_URL:-http://localhost:8000/health}"
  local spa_url="${SMOKE_SPA_URL:-http://localhost:5173/}"
  local api_url="${SMOKE_API_URL:-}"  # optional — only probed if set

  # Poll /health with a real backoff: 30 attempts * 2s = up to 60s for the
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
  for f in "${failures[@]}"; do
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
      "Every deployable surface in the worktree must ship with a Dockerfile + .dockerignore, plus a top-level compose file. See agents/engineer.md (Best Practices → 'Container setup is a pre-push gate') and skills/tdd-workflow/references/docker-patterns.md for the multi-stage / pinned / non-root template. Missing now:${list}

Scaffold the missing files (multi-stage, pinned tags, non-root user, secrets via env, no .venv inside images), commit via git-workflow as chore(scaffold): <what>, and retry the push."
  fi

  note "container presence check OK"
}

run_container_presence_checks
run_lockfile_tracked_check
run_dep_bootstrap
run_backend_checks
run_frontend_checks
run_security_scans
run_container_smoke
run_e2e_checks

# --- verdict -----------------------------------------------------------------

if [ "${#failures[@]}" -gt 0 ]; then
  reason="engineer-pre-push: blocking git push for ${slice_branch} — ${#failures[@]} check(s) failed: ${failures[*]}"
  context="Failed checks: ${failures[*]}. Fix every failure before pushing again — re-run the failing command(s) locally to see full output, commit the fix, then retry the push.${fail_logs}"
  if [ "${#missing_scanners[@]}" -gt 0 ]; then
    context="${context}

NOTE: the following security scanners were not on PATH and contributed no coverage to this run: ${missing_scanners[*]}. Install them locally (or in the engineer's container image) to close the gap."
  fi
  deny "$reason" "$context"
fi

if [ "${#missing_scanners[@]}" -gt 0 ]; then
  note "all enforced checks passed, but ${#missing_scanners[@]} scanner(s) were skipped (not on PATH): ${missing_scanners[*]}"
else
  note "all pre-push checks passed — allowing git push"
fi
exit 0
