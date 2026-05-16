#!/usr/bin/env bash
# Static, read-only check of the current worktree against each scaffolded surface.
#
# Per surface, decide whether the worktree is missing structural pieces that
# scaffold-project should materialize. Print a single JSON object on stdout:
#
#   {"surfaces":["backend","frontend","compose","e2e"]}
#
# `surfaces` lists only the surfaces that still need scaffolding (empty means
# the stack is already bootable). Exits 0 always; the caller reads the JSON
# and decides whether to invoke scaffold-project.
#
# Surfaces:
#   backend  — framework entry file present AND a framework instance is
#              instantiated AND a sibling Dockerfile exists.
#   frontend — framework entry file present AND package.json present AND a
#              sibling Dockerfile exists.
#   compose  — top-level compose.yaml or docker-compose.yaml present (presence
#              only; topology completeness vs. the ADR is left to the human or
#              the scaffold skill itself, which DOES read the ADR).
#   e2e      — e2e/package.json AND e2e/package-lock.json AND
#              e2e/playwright.config.ts AND e2e/tests/smoke.spec.ts all present.
#
# Defaults to looking at backend/ and frontend/ — the conventional layout.
# Callers in single-package layouts can pass --backend-dir / --frontend-dir
# overrides; absent flags default to backend/ and frontend/ respectively.
#
# Usage:
#   check-scaffold-needed.sh [--backend-dir <path>] [--frontend-dir <path>]
set -euo pipefail

backend_dir="backend"
frontend_dir="frontend"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backend-dir)
      backend_dir="$2"
      shift 2
      ;;
    --frontend-dir)
      frontend_dir="$2"
      shift 2
      ;;
    -h|--help)
      sed -n '2,/^set -euo/p' "$0" | sed 's/^# \{0,1\}//' >&2
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

flagged=()

# --- backend -----------------------------------------------------------------
backend_needs_scaffold() {
  # Look for either a FastAPI/Flask-style entry (app/main.py with an `app = `
  # assignment) or a Django manage.py. Both shapes count as "framework entry
  # exists." If we find neither, backend needs scaffolding.
  local entry_found=0
  if [[ -f "${backend_dir}/app/main.py" ]] \
      && grep -qE '^\s*app\s*=\s*[A-Za-z_][A-Za-z0-9_]*\(' "${backend_dir}/app/main.py" 2>/dev/null; then
    entry_found=1
  fi
  if [[ -f "${backend_dir}/manage.py" ]]; then
    entry_found=1
  fi
  if [[ "${entry_found}" -eq 0 ]]; then
    return 0  # needs scaffold
  fi
  # Dockerfile is mandatory.
  if [[ ! -f "${backend_dir}/Dockerfile" ]]; then
    return 0
  fi
  return 1  # already scaffolded
}

if backend_needs_scaffold; then
  flagged+=("backend")
fi

# --- frontend ----------------------------------------------------------------
frontend_needs_scaffold() {
  # Look for a JS/TS entry: src/main.tsx, src/main.ts, src/main.jsx, src/main.js,
  # or pages/_app.tsx (Next.js). Plus package.json plus Dockerfile.
  local entry_found=0
  for entry in src/main.tsx src/main.ts src/main.jsx src/main.js pages/_app.tsx app/page.tsx; do
    if [[ -f "${frontend_dir}/${entry}" ]]; then
      entry_found=1
      break
    fi
  done
  if [[ "${entry_found}" -eq 0 ]]; then
    return 0
  fi
  if [[ ! -f "${frontend_dir}/package.json" ]]; then
    return 0
  fi
  if [[ ! -f "${frontend_dir}/Dockerfile" ]]; then
    return 0
  fi
  return 1
}

if frontend_needs_scaffold; then
  flagged+=("frontend")
fi

# --- compose -----------------------------------------------------------------
# Presence only — the scaffold skill itself reads the ADR to confirm topology
# completeness. The detector just asks "is there a compose file at all?"
compose_needs_scaffold() {
  if [[ -f "compose.yaml" || -f "compose.yml" || -f "docker-compose.yaml" || -f "docker-compose.yml" ]]; then
    return 1
  fi
  return 0
}

if compose_needs_scaffold; then
  flagged+=("compose")
fi

# --- e2e ---------------------------------------------------------------------
e2e_needs_scaffold() {
  for required in e2e/package.json e2e/package-lock.json e2e/playwright.config.ts e2e/tests/smoke.spec.ts; do
    if [[ ! -f "${required}" ]]; then
      return 0
    fi
  done
  return 1
}

if e2e_needs_scaffold; then
  flagged+=("e2e")
fi

# --- emit JSON ---------------------------------------------------------------
if [[ ${#flagged[@]} -eq 0 ]]; then
  printf '{"surfaces":[]}\n'
  exit 0
fi

# Build a JSON array of quoted strings.
joined=""
for s in "${flagged[@]}"; do
  if [[ -z "${joined}" ]]; then
    joined="\"${s}\""
  else
    joined="${joined},\"${s}\""
  fi
done
printf '{"surfaces":[%s]}\n' "${joined}"
