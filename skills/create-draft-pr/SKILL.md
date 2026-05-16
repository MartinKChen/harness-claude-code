---
name: create-draft-pr
description: "For every open slice issue (`level:slice` + `kind:feature` + `status:in-progress`) whose task sub-issues have all closed and which is not already carrying `status:prepare-pr` or `status:need-attention`: confirm a slice branch is linked, confirm no PR already exists on the branch, lock the slice with `status:prepare-pr`, then dispatch a one-shot `engineer` sub-agent (in its `prepare-slice-pr` mode) to run the slice's touched E2E specs in a worktree, fix any production-code regressions surfaced, and either open the draft PR (success path — engineer removes `status:prepare-pr`) or flip the slice to `status:need-attention` when the failure points at an E2E-spec bug the human must rewrite. Activate on phrases like 'open the draft PRs', 'create draft PRs for ready slices', 'scaffold PRs for the closed-out slices', '/create-draft-pr', or whenever the orchestrator needs to materialize draft PRs for slices whose work is finished and ready for `close-pr` to merge. Do NOT activate to open a PR for a slice that still has open task sub-issues, to merge a PR (use `close-pr`), to fix a failing PR (use `fix-pr`), or to open a PR for a `kind:bug` / `kind:enhancement` slice."
---

# create-draft-pr

Pick every slice issue whose task work is complete and dispatch an `engineer` (in its `prepare-slice-pr` mode) to verify the slice's E2E coverage, fix any production-code regressions surfaced, and open the draft PR. The orchestrator (this skill) owns candidate selection, the `status:prepare-pr` lock flip, and the dispatch handshake; everything else — worktree setup, E2E run, production-code fixes, PR body composition, `gh pr create`, terminal label flip — is the engineer's responsibility under `prepare-slice-pr`.

This skill never checks out, edits, or pushes any branch; code-touching work and PR creation are delegated to the dispatched engineer.

## When to activate

Activate this skill whenever the user:

- Types `/create-draft-pr` (with or without a numeric cap argument).
- Asks to "open draft PRs for the ready slices", "create draft PRs for slices whose tasks are done", "scaffold PRs for the closed-out slices", or "prepare draft PRs for `close-pr` to land".

Do NOT activate when the user wants to merge a PR (use `close-pr`), wants to fix a failing PR (use `fix-pr`), wants to open a PR for a slice whose task sub-issues are still open, or wants to open PRs for `kind:bug` / `kind:enhancement` slices (this skill is `kind:feature` only).

## Arguments

Up to two optional positional arguments: `[<milestone-name>] [<cap>]`.

- `<milestone-name>` — when set, scope the slice scan to issues attached to that GitHub milestone (the feature name passed by `/implement-feature <feature-name>`, which matches the milestone used by `create-issues`). Empty / unset → scan every milestone.
- `<cap>` — optional positive integer; stop after N engineers have been dispatched. Empty / unset → process every eligible slice.

When both args are passed, `<milestone-name>` comes first and `<cap>` second. When only one arg is passed and it parses as a positive integer, treat it as `<cap>` with no milestone filter; otherwise treat it as `<milestone-name>` with no cap.

## Scripts and templates

Every gh / shell operation below is factored into `scripts/`. Invoke each via `bash scripts/<name>.sh ...` (or directly — they are executable). The dispatch-prompt skeleton lives under `templates/`. The PR body template, the open-PR script, and the worktree / E2E run logic now live with the engineer in `prepare-slice-pr` (its skill owns PR creation end-to-end).

| Asset | Purpose |
|-------|---------|
| `scripts/list-candidates.sh [--milestone <name>]` | List open in-progress feature slice issues that are NOT already labeled `status:prepare-pr` or `status:need-attention`. |
| `scripts/inspect-subissues.sh <slice-#>` | GraphQL: sub-issue states + labels for the slice. |
| `scripts/resolve-branch.sh <slice-#>` | Print the linked slice branch name (empty if none). |
| `scripts/find-existing-pr.sh <head-branch>` | Print an existing PR # for the branch (empty if none). |
| `scripts/lock-slice.sh <slice-#>` | Add the `status:prepare-pr` lock label to the slice. |
| `scripts/unlock-slice.sh <slice-#>` | Remove `status:prepare-pr` (rollback on synchronous dispatch failure). |
| `templates/dispatch-prompt.md` | Skeleton for the `engineer` `prepare-slice-pr` dispatch prompt; fill placeholders and pass as the `Agent` call's `prompt`. |

## Workflow

### 1. Resolve the repo

```bash
repo_slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"   # owner/repo
```

If the working dir isn't a GitHub repo, surface and stop.

### 2. List candidate slice issues

```bash
bash scripts/list-candidates.sh ${milestone:+--milestone "${milestone}"}
```

The script already excludes slices carrying `status:prepare-pr` (a sibling fire's engineer owns them) or `status:need-attention` (a prior fire flagged them for human review). If the result is empty, report "nothing to pick up" and stop. When a milestone filter was applied, include it: `nothing to pick up (milestone: <milestone-name>)`.

### 3. Filter to slices whose sub-issues are all closed

For each candidate, pull the sub-issue list with state in one GraphQL call. Drop any slice with even one open sub-issue — that means task work is still mid-flight and the PR isn't ready yet.

```bash
slice_response="$(bash scripts/inspect-subissues.sh <slice-#>)"
```

Local decision on the response JSON:

- `open_subissues = subIssues.nodes | map(select(.state == "OPEN")) | length`
- `open_subissues > 0` → track as skipped (`<count>` open sub-issues) and continue.
- `open_subissues == 0` → keep the slice. The engineer will re-read the sub-issues itself in step 1 of `prepare-slice-pr` (for the linked-issues block in the PR body) — the orchestrator does not need to pass the task numbers in the dispatch prompt.

### 4. Resolve the slice branch and skip if a PR is already open

The slice branch is attached to the slice issue (set by `create-issues` via `gh issue develop --create`). Pull it; skip the slice if no branch is attached.

```bash
slice_branch="$(bash scripts/resolve-branch.sh "${slice_number}")"
if [ -z "${slice_branch}" ]; then
  # internally count as skipped (no linked branch); do not print per-slice
  continue
fi
```

This skill is idempotent. If a PR (draft or ready) already exists for the slice branch, skip — don't dispatch an engineer, don't lock the slice:

```bash
existing_pr="$(bash scripts/find-existing-pr.sh "${slice_branch}")"
if [ -n "${existing_pr}" ]; then
  # internally count as skipped (PR already exists); do not print per-slice
  continue
fi
```

### 5. Lock with `status:prepare-pr` (only after pre-checks pass)

Only slices that survived step 3 (every sub-issue closed) and step 4 (slice branch linked, no PR yet) reach this step. Add the lock label in one atomic `gh` call BEFORE dispatching the engineer — the label is the lock that prevents concurrent fires of this skill from double-picking the same slice:

```bash
bash scripts/lock-slice.sh <slice-#>
```

`status:prepare-pr` must exist in the repo's label set as a prerequisite (the plugin's `init-flow-labels.sh` script creates it; if a host repo predates that, `gh label create status:prepare-pr` once).

If the call fails because the label was just added by a concurrent fire (`422` / lock race), treat as benign and skip this slice. Anything else: surface the error verbatim, stop processing further candidates for this run.

The lock MUST happen **before** the `Agent` dispatch in step 6. If the dispatch itself fails synchronously (bad `subagent_type`, missing tool, etc.), roll the lock back:

```bash
bash scripts/unlock-slice.sh <slice-#>
```

Do NOT roll back on internal sub-agent failure — once the engineer is running, it owns the lifecycle and removes `status:prepare-pr` as part of its terminal action (either step 7 success of `prepare-slice-pr` or step 5c's bail-out into `status:need-attention`).

### 6. Create an orchestrator tracking task, then dispatch one `engineer` per slice

Each dispatched engineer gets a unique addressable name and a matching orchestrator-side `Task` (via `TaskCreate`) so the user can see prep progress in the harness task list.

Pick a unique agent name of the form `engineer-prep-<slice-#>` (e.g. `engineer-prep-142`). The same string is used as the `Agent`'s `name` field AND the tracking task's `owner` so spinner, task row, and spawned agent line up.

**6a. Create the orchestrator tracking task**

Call `TaskCreate` with:

- `subject`: `Prepare draft PR for slice #<slice-#>: <slice-title>`
- `description`: one short paragraph — the slice URL, that the engineer will run the touched E2E specs in a worktree, fix any production-code regressions, and either open the draft PR (clearing `status:prepare-pr`) or flip the slice to `status:need-attention` when an E2E spec itself needs editing.
- `activeForm`: `Preparing draft PR for slice #<slice-#>`

Capture the returned `taskId`.

If `TaskCreate` fails synchronously, roll back the slice lock (per step 5) and track as skipped (TaskCreate failed).

**6b. Dispatch the engineer and assign the tracking task**

Spawn each slice with the `Agent` tool, passing:

- `subagent_type` — `engineer`
- `mode` — `auto`
- `name` — the chosen agent name (e.g. `engineer-prep-142`)
- `run_in_background` — `true` (mandatory; see below)
- `prompt` — minimal; only the **slice number and the orchestrator `taskId`** (the engineer's `prepare-slice-pr` skill resolves the slice branch, milestone, and task sub-issues itself).

`run_in_background: true` is non-negotiable. A foreground `Agent` call blocks the orchestrator turn until the engineer fully terminates, which (a) serializes slices that were supposed to fan out in parallel and (b) lets the engineer's own terminal `TaskUpdate({ status: "completed" })` land before the orchestrator's `TaskUpdate({ owner })` — at which point the owner assignment races a finalized task and the harness UI never shows who owned the row.

Immediately follow the `Agent` call — in the **same batched response** — with `TaskUpdate({ taskId, owner: <agent-name> })` so the task row reflects the assignment before the backgrounded engineer makes meaningful progress. Never split the `Agent` and `TaskUpdate(owner)` calls across turns.

Independent slices fan out in parallel: emit all the `Agent` calls AND their matching `TaskUpdate(owner)` calls together in one batched response. `TaskCreate` calls in step 6a may be batched the same way per fire.

If the `Agent` dispatch fails synchronously (bad `subagent_type`, missing tool, etc.), roll back BOTH the slice lock (per step 5) and the tracking task via `TaskUpdate({ taskId, status: "deleted" })`. Once the engineer is running, ownership transfers — it owns the terminal `status:prepare-pr` removal and the tracking task's `completed` flip.

Use `templates/dispatch-prompt.md` as the prompt skeleton. Fill placeholders (`<slice-#>`, `<taskId>`) — never edit the verbs in the opening line; the engineer routes on `Prepare draft PR for slice issue #<n>`.

### 7. Honor the cap and report

If the user passed a positive integer N, stop dispatching once N engineers have been dispatched in this run. Already-skipped slices do **not** count toward N.

Track dispatched / skipped counts internally per slice; do **not** print per-slice decisions to the user. After every candidate has been processed (or the cap is hit), emit exactly one line:

`Dispatched <X>; skipped <Y>; <Z> remaining eligible.` (`Z` is non-zero only if a cap was hit.)

## Iron rules

- **Only fire when every sub-issue under the slice is closed.** A slice with even one open sub-issue is skipped — task work is still mid-flight and the PR is not ready.
- **Skip slices already labeled `status:prepare-pr` or `status:need-attention`.** The first means a sibling fire's engineer is mid-prep; the second means a prior fire flagged the slice for human review. `list-candidates.sh` filters both out at the GitHub side.
- **Lock the slice with `status:prepare-pr` BEFORE dispatching the engineer.** The label is the lock that prevents concurrent fires from double-picking the same slice. The engineer removes it on both terminal paths (success → `push-create-pr-clear-prepare.sh`; bail → `mark-slice-need-attention.sh`).
- **Idempotent on the PR.** If a PR (draft or ready) already exists for the slice branch, this skill is a no-op for that slice — never dispatch a duplicate engineer.
- **No PR creation, no commits, no branch creation in this skill.** The orchestrator only picks candidates, locks the slice, and dispatches. Worktree setup, E2E run, production-code fixes, PR body composition, `gh pr create`, and the terminal label flip all live in `prepare-slice-pr`.
- **One orchestrator tracking task per dispatched engineer.** Every dispatched slice gets exactly one `TaskCreate` row, and the same agent `name` is used as the task `owner`. Never reuse a `taskId` across slices and never spawn an `Agent` without a paired tracking task.
- **Roll back lock AND tracking task on synchronous dispatch failure.** If `Agent` errors synchronously, remove `status:prepare-pr` from the slice and call `TaskUpdate({ taskId, status: "deleted" })`. Once the agent is running, ownership transfers (engineer removes the lock label and flips the tracking task to `completed`).
- **Background dispatch + same-message owner assignment.** Every `Agent` call MUST set `run_in_background: true` and MUST be emitted in the same response as its `TaskUpdate({ taskId, owner: <agent-name> })`. Same rationale as `fix-pr` — foreground dispatch serializes parallel slices and races the orchestrator's owner assignment against the engineer's terminal task update.
- **`kind:feature` only.** Bugs / enhancements are out of scope; if a fast-track flow is added later, give it its own skill rather than widening the label filter here.
- **Skip, don't fail, on benign outcomes.** "Open sub-issues remain", "no linked branch", "PR already exists", "slice already locked", "cap reached", "TaskCreate failed" are all expected — track internally and continue, never surface per-slice or abort the whole run.
