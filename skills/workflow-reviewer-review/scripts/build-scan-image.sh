#!/usr/bin/env bash
# Build the worktree's compose image(s) with a deterministic slug tag derived
# from the slice branch so the security gate's vulnerability scans target
# exactly this PR's artifact (never `:latest`, never a base image).
#
# Prints the resulting image tag on stdout. Exits non-zero if the build fails
# — the caller MUST stop the security gate and post a blocked-review comment
# rather than scanning a previous artifact.
#
# Run inside the worktree (the compose file lives there). Image cleanup is
# the caller's responsibility — invoke `cleanup-scan-image.sh <slug>` after
# every pattern has been scanned.
#
# Usage:
#   build-scan-image.sh <slice-branch>
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <slice-branch>" >&2
  exit 1
fi

slice_branch="$1"
repo_name="$(basename "$(git rev-parse --show-toplevel)")"
slug="$(printf '%s' "$slice_branch" | tr '/' '-' | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._-]/-/g')"
image_tag="${repo_name}:${slug}"

IMAGE_TAG="$image_tag" docker compose build >&2

printf '%s\n' "$image_tag"
