---
description: Find every open `level:slice` + `status:ready-to-implement` + `kind:feature` issue with no open `Blocked by` and no remote branch yet, then create `feature/<issue-#>-<slug>` off the latest `origin/main` for each.
argument-hint: "[optional: max number of branches to create this run; default: all eligible]"
---

# prepare-slice-branch

Scan open slice issues, keep the ones that are ready, unblocked, and have no development branch linked yet, and cut a remote feature branch off the current `origin/main` for each. The command is the agent-side implementation of "Loop 1 — Pickup slice" from `i-am-planning-to-twinkling-rose.md` §4. Invoke it directly with `/prepare-slice-branch`, or schedule it via `/loop /prepare-slice-branch`.

The command never checks out, edits, or pushes to `main` — branches are created via `gh issue develop`, which both creates the remote branch off `main` AND links it to the issue (visible under the issue's "Development" sidebar), so the local working tree stays untouched.

## Arguments

`$ARGUMENTS` — optional cap on how many branches to create in one run. Empty / unset → process every eligible issue. A positive integer N → stop after N branches are created; remaining eligible issues are picked up on the next invocation.

## Workflow

### 1. Resolve the repo

Capture `<owner>/<repo>` for every subsequent `gh api` call. If the working dir isn't a GitHub repo, surface the error and stop.

```bash
repo_slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"   # owner/repo
```

### 2. Pull eligible candidates

List open slice issues that are ready to implement and tagged as features:

```bash
gh issue list \
  --state open \
  --label "level:slice" \
  --label "status:ready-to-implement" \
  --label "kind:feature" \
  --json number,title,url \
  --limit 200
```

If the result is empty, report "nothing to prepare" and stop.

### 3. Drop candidates with open blockers

`gh issue view --json` does not expose dependency counts, so query GraphQL. Use `issueDependenciesSummary.blockedBy` — that field returns the count of **open** blockers (closed blockers don't count, which is exactly what we want):

```bash
gh api graphql \
  -F number=<n> -F owner=<owner> -F repo=<repo> \
  -f query='
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $number) {
          issueDependenciesSummary { blockedBy }
        }
      }
    }
  ' --jq '.data.repository.issue.issueDependenciesSummary.blockedBy'
```

Keep the candidate only when the returned count is `0`. Anything ≥ 1 means at least one open blocker — skip with a "blocked by N open issue(s)" line in the summary.

### 4. Drop candidates that already have a linked development branch

Use `gh issue develop --list <issue-#>` to check whether the issue already has any branch linked to it on GitHub (the "Development" relationship shown in the issue sidebar). The command prints one line per linked branch on stdout, and nothing when there are none — so emptiness of stdout is the signal:

```bash
linked="$(gh issue develop --list "${issue_number}" 2>/dev/null)"
if [ -n "$linked" ]; then
  echo "skip #${issue_number} — already has linked branch(es): ${linked}"
  continue
fi
```

This check is the source of truth for "has a branch yet?" — do NOT also probe `git/ref/heads/...` separately. A linked branch can be named anything (`feature/...`, `fix/...`, hand-named, etc.); the link, not the name, decides whether the slice is already in flight.

### 5. Create the branch off the latest `origin/main` and link it to the issue

`gh issue develop` does both in one call: it creates the remote branch off the specified base AND records the GitHub-native development link on the issue. No local checkout, no `git push`, no separate ref-creation API call.

Branch name format: `feature/<issue-#>-<kebab-of-title>`. The leading issue number guarantees uniqueness even when two slices have similar titles, and lets you reverse-look up the issue from any branch name.

Slugification: lowercase, collapse any non-`[a-z0-9]` run into a single `-`, trim leading/trailing `-`, cap at ~50 chars to keep refs sane:

```bash
slug() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' \
    | cut -c1-50 \
    | sed -E 's/-+$//'
}
branch="feature/${issue_number}-$(slug "$title")"

gh issue develop "${issue_number}" \
  --base main \
  --name "${branch}"
```

Error handling:
- **"a branch already exists for this issue"** (or any signal that another fire raced in and linked one first) → benign. Log and continue.
- **Anything else** (auth, base ref missing, name conflict with an unlinked existing branch) → surface the error verbatim, stop processing further candidates for this run. Do NOT retry blindly.

### 6. Honor the cap and report

If `$ARGUMENTS` parses as a positive integer N, stop creating new branches once N have been created in this run. Already-skipped issues (blocked or branch-exists) do **not** count toward N.

Print a one-line-per-issue summary, one of these forms per candidate:

- `created  feature/<n>-<slug>  for #<n> "<title>"`
- `skipped  #<n> "<title>" — already has linked branch(es): <branch-list>`
- `skipped  #<n> "<title>" — blocked by <count> open issue(s)`
- `skipped  #<n> "<title>" — cap reached (created N this run)`

End with a single sentence: `Created <X> branch(es); skipped <Y>; <Z> remaining eligible.` (where `Z` is non-zero only if a cap was hit).

## Iron rules

- **Read-only on `main`.** This command never checks out, modifies, or pushes to `main`. The new branch is created off the current `origin/main` head by `gh issue develop --base main`, which goes through the GitHub API.
- **`gh`, never raw `git push`.** Per repo convention (`MEMORY.md` → "Prefer gh over git"), GitHub-side ops — issue listing, dependency queries, branch creation + linking — all go through `gh` / `gh api`.
- **The "has a branch?" check is the GitHub development link, not a ref probe.** Step 4 uses `gh issue develop --list`; do NOT substitute a `git/ref/heads/...` lookup. The link is what downstream loops/automation key off, and a branch can exist without being linked (or vice versa during a race).
- **Idempotent.** Re-running on the same set is a no-op for issues that already have a linked branch; only the candidate list is re-scanned.
- **Skip, don't fail, on benign outcomes.** "Already has linked branch", "issue blocked", "no eligible issues", "cap reached" are all expected — log them and continue, never abort the whole run.
- **`kind:feature` only.** This command does not handle `kind:bug` (`fix/<slug>`) or `kind:enhancement` (`enh/<slug>`). Add those as separate commands or extend this one explicitly when the bug/enhancement fast-track is wired up — do NOT silently widen the label filter.
- **No issue mutation.** Scope is strictly: list → filter → create branch. It does not flip `status:in-progress`, post comments, or assign anyone. Those belong to the full Loop 1 (see `i-am-planning-to-twinkling-rose.md` §4) and can be layered on later without changing this command's contract.
