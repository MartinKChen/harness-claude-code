---
description: Find every open PR with a `review:code-pending` or `review:security-pending` label, flip the pending gate(s) to `-running` (leaving any other gate's label untouched), and dispatch the matching one-shot reviewer sub-agent (`review:code-running` → `code-reviewer`, `review:security-running` → `security-reviewer`) in `mode=auto` with just the PR number.
argument-hint: "[optional: max number of PR-gate pairs to dispatch this run; default: all eligible]"
---

# pickup-pr-for-review

Scan open PRs, keep the ones with at least one `review:<gate>-pending` label (where `<gate>` is `code` or `security`), flip each pending gate to `-running` so concurrent fires don't double-pick the same gate, then dispatch the matching reviewer sub-agent. Handles the security and code gates only — the e2e gate is owned by a GitHub Actions workflow on the PR and is not picked up here.

The command never checks out, edits, or pushes to any branch; the dispatched sub-agent runs the review and flips the gate to its terminal `-passed` / `-need-fix` state.

## Arguments

`$ARGUMENTS` — optional positive integer cap on how many `(PR, gate)` pairs to dispatch this run. Empty / unset → process every eligible pair. A positive integer N → stop after N pairs have been locked + dispatched; remaining eligible pairs are picked up on the next invocation. A PR with both gates pending counts as **two** pairs against the cap.

## Workflow

### 1. Resolve the repo

Capture `<owner>/<repo>` for every subsequent `gh` call. If the working dir isn't a GitHub repo, surface the error and stop.

```bash
repo_slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"   # owner/repo
```

### 2. Pull eligible PRs per gate

List open PRs that have either gate's `-pending` label. Run one `gh pr list` per gate so a PR with both pending labels appears in both lists; merge and dedupe by PR number on the orchestrator side.

```bash
gh pr list \
  --state open \
  --label "review:code-pending" \
  --json number,title,labels,url \
  --limit 200

gh pr list \
  --state open \
  --label "review:security-pending" \
  --json number,title,labels,url \
  --limit 200
```

If both lists are empty, report "nothing to pick up" and stop.

### 3. Build the (PR, gate) work list

For each unique PR returned by step 2, derive the set of pending gates from its current `labels` array — every label whose name matches `review:<gate>-pending` for `<gate>` in `{code, security}`. Each `(PR, gate)` pair becomes one unit of work.

Skip a pair (and log the skip reason) when:
- The PR is in a draft state — log `skipped PR #<n> — draft`. (Drafts opt out of review.)
- The same gate is already in `review:<gate>-running` on this PR — log `skipped PR #<n> <gate> — already running`. (A concurrent fire picked it up.)

### 4. Flip just the pending gate(s) to running — preserve every other label

For each `(PR, gate)` pair, flip `review:<gate>-pending` → `review:<gate>-running` in one atomic `gh` call. Pass only the labels you are removing/adding; do NOT touch any other label on the PR. Concretely, if a PR carries `review:security-pending` + `review:code-passed`, the security flip removes only `review:security-pending` and adds only `review:security-running`, leaving `review:code-passed` exactly as it was.

```bash
gh pr edit "${pr_number}" \
  --remove-label "review:${gate}-pending" \
  --add-label "review:${gate}-running"
```

If the call fails because the pending label was already removed by a concurrent fire (`422`), treat it as benign and skip this pair. Anything else: surface the error verbatim, stop processing further pairs for this run.

The flip MUST happen **before** the sub-agent dispatch in step 5. If the dispatch itself fails synchronously (bad `subagent_type`, missing tool, etc.), roll the flip back so the next fire can retry:

```bash
gh pr edit "${pr_number}" \
  --remove-label "review:${gate}-running" \
  --add-label "review:${gate}-pending"
```

Do NOT roll back on internal sub-agent failure — once the sub-agent is running, it owns the lifecycle (it flips to `-passed` / `-need-fix` on completion, or a later sweep clears stale `-running` on aborted runs).

### 5. Dispatch the matching reviewer sub-agent

Map gate to `subagent_type`:

| Running gate label         | `subagent_type`     |
|----------------------------|---------------------|
| `review:code-running`      | `code-reviewer`     |
| `review:security-running`  | `security-reviewer` |

Spawn each pair with the `Agent` tool, `mode=auto`. Independent pairs within the same fire are dispatched in parallel as multiple `Agent` calls in the same response — including the two gates of the same PR when both were pending (each gate runs as its own one-shot sub-agent).

The spawn prompt is deliberately minimal — pass only the **PR number**. The dispatched agent fetches everything else it needs (PR body, commit history, linked issue, slice branch, worktree path) from `gh` + `git` using the PR number.

Skeleton for the dispatch prompt:

```
Review PR #<pr-number> for the <code|security> gate.

Fetch any further context you need (PR body, commit history, linked issue, slice branch, worktree path) yourself via `gh` and `git` — you have the PR number.
```

### 6. Honor the cap and report

If `$ARGUMENTS` parses as a positive integer N, stop locking + dispatching new pairs once N have been dispatched in this run. Already-skipped pairs (draft / already-running / lock-race) do **not** count toward N.

Print a one-line-per-pair summary, one of these forms:

- `dispatched  PR #<n> <gate> "<title>" → <subagent_type>`
- `skipped     PR #<n> <gate> "<title>" — draft`
- `skipped     PR #<n> <gate> "<title>" — already running`
- `skipped     PR #<n> <gate> "<title>" — lock race`
- `skipped     PR #<n> <gate> "<title>" — cap reached (dispatched N this run)`

End with a single sentence: `Dispatched <X> pair(s); skipped <Y>; <Z> remaining eligible.` (`Z` is non-zero only if a cap was hit.)

## Iron rules

- **Lock before dispatch.** The label flip in step 4 happens before the `Agent` call in step 5. The flip is the lock that prevents concurrent fires from picking up the same `(PR, gate)` pair.
- **Roll back the flip only on synchronous dispatch failure.** Once the sub-agent is running, ownership transfers — the agent flips the gate to its terminal state (`-passed` / `-need-fix`) on completion, and a later sweep (out of scope for this command) clears stale `-running` on aborted runs. Do NOT speculatively unflip.
- **Touch only the pending gate's labels.** When flipping, pass only the `--remove-label` / `--add-label` for the one gate being moved. Never re-add or remove labels for the other gate, the `status:*` family, the `kind:*` family, or anything else on the PR.
- **One `(PR, gate)` per dispatched sub-agent.** Each `Agent` call owns exactly one gate of one PR. Independent pairs go out as parallel `Agent` calls in the same response — including both gates of a single PR when both were pending.
- **Code and security only.** This command does not handle the `review:e2e-*` labels — the E2E gate is flipped by a GitHub Actions workflow against the PR, not by an in-loop reviewer agent. Do NOT widen the gate set without updating the workflow contract.
- **Skip, don't fail, on benign outcomes.** "Draft", "already running", "lock race", "cap reached" are all expected — log them and continue, never abort the whole run.
- **No PR-state changes beyond the label flip.** This command does not comment, request reviewers, change merge settings, or close PRs. Code-changing work and the terminal label flip belong to the dispatched reviewer sub-agent.
