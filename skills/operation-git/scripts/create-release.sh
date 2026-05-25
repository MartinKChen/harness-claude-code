#!/usr/bin/env bash
# Cut a release: tag main and publish a GitHub release with auto-generated notes.
#
# Usage:
#   create-release.sh <version> [--prerelease] [--notes-file <path>]
#
# Example:
#   create-release.sh v1.2.0
#   create-release.sh v1.2.0-rc.1 --prerelease
#   create-release.sh v1.2.0 --notes-file CHANGELOG-v1.2.0.md
#
# Before running this script:
#   1. Decide the bump per ../references/versioning.md (major/minor/patch).
#   2. Update version files (package.json / pyproject.toml / Cargo.toml) and
#      CHANGELOG.md, then commit on main as `chore(release): vX.Y.Z` and push.
set -euo pipefail

version=""
prerelease=""
notes_file=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prerelease) prerelease="--prerelease"; shift ;;
    --notes-file) notes_file="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,15p' "$0"
      exit 0
      ;;
    *)
      if [[ -z "$version" ]]; then
        version="$1"
      else
        echo "unexpected arg: $1" >&2
        exit 1
      fi
      shift
      ;;
  esac
done

if [[ -z "$version" ]]; then
  echo "usage: $0 <version> [--prerelease] [--notes-file <path>]" >&2
  exit 1
fi

if [[ ! "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$ ]]; then
  echo "version must look like vX.Y.Z (see references/versioning.md): got $version" >&2
  exit 1
fi

if [[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ]]; then
  echo "refusing to release from a non-main branch" >&2
  exit 1
fi

git fetch origin
git pull --ff-only

create_args=("$version" --target main --title "$version")
if [[ -n "$notes_file" ]]; then
  create_args+=(--notes-file "$notes_file")
else
  create_args+=(--generate-notes)
fi
if [[ -n "$prerelease" ]]; then
  create_args+=("$prerelease")
fi

gh release create "${create_args[@]}"
