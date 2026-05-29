#!/usr/bin/env bash
# Single source of truth for the frontend's CI checks.
#
# This ONE script is invoked from two places, so local and CI run byte-identical
# checks and never drift apart:
#   - GitHub Actions  — .github/workflows/pr-validation.yml (working-directory: frontend)
#   - local pre-push  — .githooks/pre-push (the committed core.hooksPath hook)
#
# Requirements: dependencies already installed (`npm ci`); `npx` on PATH.
set -euo pipefail

echo "==> [frontend] biome ci (lint + format-check + import-organize)"
npx biome ci .

echo "==> [frontend] tsc --noEmit (vite build does not type-check)"
npx tsc --noEmit

echo "==> [frontend] vitest run"
# --passWithNoTests so an empty test set is not a failure at scaffold time.
npx vitest run --passWithNoTests

echo "==> [frontend] ci-checks passed"
