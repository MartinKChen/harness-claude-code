---
name: create-draft-pr
description: "Open a draft pull request for every open slice issue (`level:slice` + `kind:feature` + `status:in-progress`) whose task sub-issues have all closed. For each remaining slice: resolve its slice branch (already linked via `gh issue develop` from `create-issues`), build a PR body from the `git-workflow` skill's PR-body template (soft reference through the skill — never a hard-coded path), append `Closes #<slice-#>` first and `Closes #<task-#>` for each task sub-issue so all show up in the PR's Linked Issues / Development sidebar, and inherit the milestone from the slice. Activate on phrases like 'open the draft PRs', 'create draft PRs for ready slices', 'scaffold PRs for the closed-out slices', '/create-draft-pr', or whenever the orchestrator needs to materialize draft PRs for slices whose work is finished and ready for `close-pr` to merge. Do NOT activate to open a PR for a slice that still has open task sub-issues, to merge a PR (use `close-pr`), to fix a failing PR (use `fix-pr`), or to open a PR for a `kind:bug` / `kind:enhancement` slice."
---

# create-draft-pr

Open a draft slice PR once every task sub-issue under a slice has closed, so `close-pr` has a PR to merge. With `e2e-author` no longer creating the slice PR, this is the canonical place draft PRs come into existence: pick the slice issues whose work is complete (all sub-issues closed), resolve the slice branch already attached to each one, compose a PR body from `git-workflow`'s template, and link the slice + all task sub-issues into the PR's `Closes #` set so they appear in the PR's Linked Issues / Development sidebar.

## When to activate

Activate this skill whenever the user:

- Types `/create-draft-pr` (with or without a numeric cap argument).
- Asks to "open draft PRs for the ready slices", "create draft PRs for slices whose tasks are done", "scaffold PRs for the closed-out slices", or "prepare draft PRs for `close-pr` to land".

Do NOT activate when the user wants to merge a PR (use `close-pr`), wants to fix a failing PR (use `fix-pr`), wants to open a PR for a slice whose task sub-issues are still open, or wants to open PRs for `kind:bug` / `kind:enhancement` slices (this skill is `kind:feature` only).

## Arguments

The skill accepts an optional positive integer cap on how many draft PRs to open this run. Empty / unset → process every eligible slice. A positive integer N → stop after N draft PRs have been opened; remaining eligible slices are picked up on the next invocation.

## Workflow

### 1. Resolve the repo

```bash
repo_slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"   # owner/repo
owner="${repo_slug%/*}"; repo="${repo_slug#*/}"
```

If the working dir isn't a GitHub repo, surface and stop.

### 2. List candidate slice issues

A slice is in scope when it is **open**, carries `level:slice` + `kind:feature` + `status:in-progress`:

```bash
gh issue list \
  --state open \
  --label "level:slice" \
  --label "kind:feature" \
  --label "status:in-progress" \
  --json number,title,url,milestone \
  --limit 200
```

If empty, report "nothing to pick up" and stop.

### 3. Filter to slices whose sub-issues are all closed

For each candidate, pull the sub-issue list with state in one GraphQL call. Drop any slice with even one open sub-issue — that means task work is still mid-flight and the PR isn't ready yet.

```bash
gh api graphql \
  -F number=<slice-#> -F owner="${owner}" -F repo="${repo}" \
  -f query='
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $number) {
          subIssues(first: 100) {
            nodes { number state labels(first: 20) { nodes { name } } }
          }
        }
      }
    }
  '
```

Local decision on the response JSON:

- `open_subissues = subIssues.nodes | map(select(.state == "OPEN")) | length`
- `open_subissues > 0` → log `skipped slice #<n> — <count> open sub-issue(s)` and continue.
- `open_subissues == 0` → keep the slice. Record the list of **task sub-issue numbers** (every sub-issue whose labels include both `level:task` and `kind:feature`) for use in step 5.

### 4. Resolve the slice branch and skip if a PR is already open

The slice branch is attached to the slice issue (set by `create-issues` via `gh issue develop --create`). Pull it; skip the slice if no branch is attached.

```bash
slice_branch="$(gh issue develop --list "${slice_number}" | head -1 | awk '{print $1}')"
if [ -z "${slice_branch}" ]; then
  echo "skipped slice #${slice_number} — no linked branch"
  continue
fi
```

This skill is idempotent. If a PR (draft or ready) already exists for the slice branch, skip — don't open a duplicate, don't mutate the existing PR's body or milestone:

```bash
existing_pr="$(gh pr list --head "${slice_branch}" --state all --json number,state \
  --jq '.[0].number // empty')"
if [ -n "${existing_pr}" ]; then
  echo "skipped slice #${slice_number} — PR #${existing_pr} already exists"
  continue
fi
```

### 5. Compose the PR body

Defer to the **`git-workflow` skill's PR body template** for the structure of the body — invoke `git-workflow` and use whatever PR-body template it ships. Do NOT hard-code a filesystem path to the template: this skill lives in a plugin and the installed location of `git-workflow`'s assets is environment-dependent (`git-workflow` knows where its own template lives; resolve through the skill, not through `$(git rev-parse --show-toplevel)/skills/...`).

The template ends with a `Closes #<issue-number>` placeholder line. Replace that single line with a fully-rendered linked-issues block. Order is load-bearing: **`Closes #<slice-#>` MUST be the first closing-keyword reference in the body** so `close-pr`'s `closingIssuesReferences[0]` reads the slice issue (and not a task) when it later strips `status:in-progress` and closes the slice.

Linked-issues block (replaces the template's trailing `Closes #<issue-number>` line):

```
Closes #<slice-#>

Task sub-issues (closed before this PR was opened):
- Closes #<task-#-1>
- Closes #<task-#-2>
- Closes #<task-#-N>
```

Using `Closes` (not `Refs`) for tasks is safe here because every task sub-issue is already closed by the time this skill fires — the closing keyword is a no-op for them at merge time but is what GitHub needs to render them in the PR's Linked Issues / Development sidebar. Compose the final body once per slice and write it to a temp file for `gh pr create --body-file`:

```bash
body_file="$(mktemp)"
{
  printf '%s\n' "${body_template%Closes #*}"   # git-workflow's template minus its trailing placeholder
  printf 'Closes #%s\n\n' "${slice_number}"
  printf 'Task sub-issues (closed before this PR was opened):\n'
  for t in ${task_numbers}; do
    printf -- '- Closes #%s\n' "${t}"
  done
} > "${body_file}"
```

If `${task_numbers}` is empty (a slice with no `level:task` sub-issues — unusual but possible), omit the "Task sub-issues" section entirely; don't ship an empty bulleted list.

### 6. Open the draft PR with the milestone attached

Inherit the milestone from the slice issue (already captured in step 2's JSON). `gh pr create` accepts `--milestone <name-or-number>`; pass the milestone's `title` (display name) for stability:

```bash
gh pr create \
  --draft \
  --base main \
  --head "${slice_branch}" \
  --title "${slice_title}" \
  --body-file "${body_file}" \
  --milestone "${slice_milestone_title}"
```

If the slice has no milestone (`.milestone` is `null` in step 2's JSON), omit `--milestone` and log it in the per-slice summary — don't fabricate a milestone or stop the run.

If `gh pr create` fails:

- **Lock race / duplicate PR (`422` "A pull request already exists")** → benign; log `skipped slice #<n> — PR raced into existence` and continue (a concurrent fire opened it).
- **Missing milestone (`gh` rejects an unknown milestone name)** → re-run the create without `--milestone` and log `opened PR #<n> — slice milestone "<name>" not found, opened without milestone`; do not abort the run.
- **Anything else** → surface verbatim and stop processing further candidates for this run.

Clean up the temp body file once the create returns:

```bash
rm -f "${body_file}"
```

### 7. Honor the cap and report

If the user passed a positive integer N, stop opening new PRs once N have been opened in this run. Already-skipped slices do **not** count toward N.

Print a one-line-per-slice summary:

- `opened     slice #<n> "<title>" → PR #<pr-#> (milestone: <name>, tasks: <K>)`
- `opened     slice #<n> "<title>" → PR #<pr-#> (no milestone, tasks: <K>)`
- `skipped    slice #<n> "<title>" — <count> open sub-issue(s)`
- `skipped    slice #<n> "<title>" — no linked branch`
- `skipped    slice #<n> "<title>" — PR #<pr-#> already exists`
- `skipped    slice #<n> "<title>" — PR raced into existence`
- `skipped    slice #<n> "<title>" — cap reached (opened N this run)`

End with one sentence: `Opened <X>; skipped <Y>; <Z> remaining eligible.` (`Z` is non-zero only if a cap was hit.)

## Iron rules

- **Only fire when every sub-issue under the slice is closed.** A slice with even one open sub-issue is skipped — task work is still mid-flight and the PR is not ready. The "all tasks closed" signal is what tells this skill the slice has finished its review/fix cycles.
- **Idempotent on the PR.** If a PR (draft or ready) already exists for the slice branch, this skill is a no-op for that slice — it never mutates an existing PR's title, body, milestone, or labels. Re-running on a slice already PR'd is benign.
- **`Closes #<slice-#>` MUST be the first closing-keyword reference in the body.** `close-pr` reads `closingIssuesReferences[0]` to find the slice issue it strips `status:in-progress` from. Putting a task ahead of the slice would point `close-pr` at the wrong issue.
- **Use `Closes` for every linked issue, not `Refs`.** All task sub-issues are already closed when this skill fires, so the closing keyword is a no-op at merge time but is what populates the PR's Linked Issues / Development sidebar. Keep the linkage discoverable in the UI.
- **Body template comes from the `git-workflow` skill — soft reference only.** Resolve the template by invoking `git-workflow` and using its PR-body template; never hard-code a filesystem path (this is a plugin, and the installed location of another skill's assets is environment-dependent). Do not duplicate the template inline. The template's trailing `Closes #<issue-number>` placeholder is replaced wholesale by the rendered linked-issues block in step 5.
- **Milestone inherits from the slice issue.** If the slice has no milestone, open the PR without one and log it — never fabricate or pick a milestone heuristically. The slice is the source of truth for which release the work belongs to.
- **`kind:feature` only.** Bugs / enhancements are out of scope; if a fast-track flow is added later, give it its own skill rather than widening the label filter here.
- **No branch creation, no commits, no merge.** This skill only opens draft PRs. The slice branch was created by `create-issues`; commits land via the engineer / e2e-author; merge is owned by `close-pr`.
- **Skip, don't fail, on benign outcomes.** "Open sub-issues remain", "no linked branch", "PR already exists", "PR raced into existence", "milestone not found", "cap reached" are all expected — log and continue, never abort the whole run.
