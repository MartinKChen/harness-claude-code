#!/usr/bin/env bash
# Single source of truth for the backend's CI checks.
#
# This ONE script is invoked from two places, so local and CI run byte-identical
# checks and never drift apart:
#   - GitHub Actions  — .github/workflows/pr-validation.yml (working-directory: backend)
#   - local pre-push  — .githooks/pre-push (the committed core.hooksPath hook)
#
# It runs the full quality gate AND spins up an ephemeral Postgres so DB-backed /
# integration tests actually execute (a pytest run with no database silently skips
# exactly the tests most likely to catch a cross-slice break). DATABASE_URL is
# exported to point at the throwaway container; the container is always torn down.
#
# Requirements: `uv` on PATH and a working Docker daemon (both present on the CI
# runner and assumed on a dev machine that can `docker compose up` the stack).
set -euo pipefail

echo "==> [backend] ruff check"
uv run ruff check .

echo "==> [backend] ruff format --check"
uv run ruff format --check .

echo "==> [backend] mypy app"
uv run mypy app

# ---- ephemeral Postgres so DB/integration tests run (not silently skipped) ----
PG_CONTAINER="ci-checks-postgres-$$"
PG_PORT="${CI_PG_PORT:-55432}"
# Pinned to the same image the compose topology uses, so the DB the tests hit
# locally and in CI matches the DB the product runs against.
PG_IMAGE="postgres:16.3-alpine"

cleanup() { docker rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> [backend] starting ephemeral Postgres (${PG_CONTAINER} on 127.0.0.1:${PG_PORT})"
docker run -d --rm \
  --name "$PG_CONTAINER" \
  -e POSTGRES_USER=ci \
  -e POSTGRES_PASSWORD=ci \
  -e POSTGRES_DB=ci \
  -p "127.0.0.1:${PG_PORT}:5432" \
  "$PG_IMAGE" >/dev/null

echo "==> [backend] waiting for Postgres to accept connections"
for _ in $(seq 1 30); do
  if docker exec "$PG_CONTAINER" pg_isready -U ci -d ci >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$PG_CONTAINER" pg_isready -U ci -d ci >/dev/null 2>&1 \
  || { echo "Postgres did not become ready" >&2; exit 1; }

export DATABASE_URL="postgresql://ci:ci@127.0.0.1:${PG_PORT}/ci"

echo "==> [backend] pytest (full suite — DB-backed/integration tests included)"
# Tolerate exit 5 (no tests collected) — a fresh scaffold ships no feature tests yet.
uv run pytest || [ $? -eq 5 ]

echo "==> [backend] ci-checks passed"
