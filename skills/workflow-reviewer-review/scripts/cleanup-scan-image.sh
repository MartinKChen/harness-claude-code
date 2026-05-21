#!/usr/bin/env bash
# Remove every image whose tag matches the slug derived from the slice branch.
# The slug-tagged artifact built by `build-scan-image.sh` is single-use — the
# security gate scans it once and the image is discarded so concurrent slice
# worktrees on the same host don't accumulate stale build state.
#
# If `docker rmi` fails (e.g. the image is still in use by another container)
# the script logs the error to stderr but exits 0 — the verdict does not
# depend on cleanup succeeding.
#
# Usage:
#   cleanup-scan-image.sh <slice-branch>
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <slice-branch>" >&2
  exit 1
fi

slice_branch="$1"
slug="$(printf '%s' "$slice_branch" | tr '/' '-' | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._-]/-/g')"

if ! docker images --filter "reference=*:${slug}" --format "{{.ID}}" \
  | sort -u \
  | xargs -r docker rmi -f >&2; then
  echo "cleanup-scan-image: docker rmi failed for slug ${slug} — continuing" >&2
fi
