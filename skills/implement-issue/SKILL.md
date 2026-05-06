---
name: implement-issue
description: "Drive the end-to-end implementation of a GitHub issue: fetch the issue, derive a branch name, plan backend/frontend/e2e tasks (with E2E tests bookending implementation), create a worktree-backed feature branch, spin up an `implementation-team` of one `backend-engineer` and one `frontend-engineer` (both `subagent_type=engineer`) per implementation task plus an `e2e-runner` for the failing-test scaffold, drive tasks to green, open a PR that closes the issue, then tear down the implementation team and create a separate `validation-team` (`e2e-runner`, `backend-engineer`, `frontend-engineer`, `security-reviewer`) that first validates the E2E suite end-to-end and then runs the security review, dispatching fixes to the engineer teammates and pushing them to the same PR. Activate whenever the user asks to implement, build, ship, work on, or pick up an issue — phrases like 'implement issue 42', 'implement #42', 'work on issue 42', 'pick up #42', 'build out the feature in issue 42', 'ship issue 42', 'start implementation of issue 42', 'implement the issue', or any request that supplies a `gh` issue number / URL as the unit of work to implement. Triggers on verbs (implement, build, ship, deliver, develop, work on, pick up, start, kick off) paired with nouns (issue, ticket, #<n>, GitHub issue, story). Do NOT activate for issue *creation* (use `create-issues`), issue triage, or generic coding tasks without a referenced issue."
---

# implement-issue

Take a single GitHub issue from "ready" to "merged PR" by orchestrating two purpose-built agent teams. The skill fetches the issue, plans a strictly-typed (backend XOR frontend) task graph, isolates the work in a worktree-backed feature branch, dispatches each implementation task to a dedicated engineer in the `implementation-team`, opens a PR that closes the issue, then hands the diff to a separate `validation-team` that gates merge on a green E2E run followed by a clean security review.

## When to activate

Activate this skill whenever the user:

- Asks to "implement issue <n>", "implement #<n>", "work on issue <n>", "pick up <n>", "ship issue <n>", "build out #<n>", or supplies a GitHub issue URL as the thing to implement.
- Hands over an issue number / URL with no further instruction (interpret as "implement it end-to-end").
- Asks to "kick off implementation" of a referenced issue.

Do NOT activate when the user is:

- Creating or slicing issues (route to `create-issues`).
- Asking to triage, comment on, or close an issue without implementing it.
- Asking for a one-off code change with no GitHub issue as the unit of work.

## Sub-skill routing

| Sub-skill | When to route to it |
|-----------|---------------------|
| `git-workflow` | All git/`gh` interaction: fetching the issue (`gh issue view`), creating the worktree-backed feature branch, commit cadence inside engineer tasks, opening the final PR with `Closes #<n>`, and any blocker/parent linking. |

## Workflow

### Implement a referenced issue end-to-end

1. **Fetch the issue.** Resolve the issue number from the user's request. Via `git-workflow`, run `gh issue view <n> --json number,title,body,labels,state,url` to pull the full issue. If the issue is closed or missing, stop and surface that — do not start work.

2. **Derive a branch name and task plan.** From the issue title and body:
   - Pick a kebab-case `<branch-name>` (used for branch + worktree naming).
   - Decompose the issue into discrete tasks. Every implementation task MUST be **either a backend implementation OR a frontend implementation — never a mix.** If a chunk of work would require both, split it into a backend task and a frontend task with an explicit dependency edge between them.
   - For each task, record: short title, type (`backend` | `frontend` | `e2e`), what it delivers, and which other task(s) it depends on (`blockBy`).
   - Always add the following `e2e` task to the plan, owned by `e2e-runner`:
     - **Create/modify E2E test cases** — `type=e2e`, no blockers. Every backend/frontend implementation task MUST list this task in its `blockBy` so implementation cannot start until the failing E2E suite exists.
   - Do NOT add a "validate E2E test cases" task here — that task is created later in step 9 by the validation team, not by the implementation team.
   - Surface the plan back to the user before locking — confirm the feature name, the task list, and the dependency edges. Iterate until they approve.

3. **Create a worktree-backed feature branch.** Defer to `git-workflow` for the canonical worktree-creation flow. Use branch name `feature/<branch-name>` cut from up-to-date `origin/main`, and place the worktree at `../<repo>-<branch-name>` (or the repo's conventional sibling path). All subsequent steps run inside that worktree. **Capture the absolute worktree path** — every teammate spawned in step 4 must be told to operate inside it.

4. **Spin up the implementation team.** Use `TeamCreate` to provision a team named **`implementation-team`**. Spawn one engineer teammate per implementation task plus a single `e2e-runner` for the failing-test scaffold task — every teammate is created with `mode=auto` so they execute their assigned task autonomously without prompting back on routine decisions:
   - For every task with `type=backend`, spawn one `backend-engineer-<i>` (`subagent_type=engineer`, `mode=auto`). The count of `backend-engineer-*` teammates MUST equal the count of `backend` tasks from step 2.
   - For every task with `type=frontend`, spawn one `frontend-engineer-<i>` (`subagent_type=engineer`, `mode=auto`). The count of `frontend-engineer-*` teammates MUST equal the count of `frontend` tasks from step 2.
   - Spawn one `e2e-runner` (`subagent_type=e2e-runner`, `mode=auto`) to own the **Create/modify E2E test cases** task from step 2.

   **One task per agent.** Each `backend-engineer-<i>` / `frontend-engineer-<i>` is assigned exactly one task — do not batch multiple tasks onto the same engineer teammate. The `<i>` suffix (`-1`, `-2`, …) makes each teammate addressable by name so `SendMessage` can dispatch the right task to the right agent.

   Keep every teammate addressable by name (`SendMessage`) for the rest of the implementation phase.

   **Brief every teammate on the worktree.** In the initial `SendMessage` to each `backend-engineer-<i>`, `frontend-engineer-<i>`, and `e2e-runner`, include:
   - The absolute worktree path created in step 3 (e.g. `/Users/.../<repo>-<branch-name>`).
   - An explicit instruction that all work — file reads, edits, commands, commits — MUST happen inside that worktree, not in the main repo checkout.
   - The branch name `feature/<branch-name>` so they commit on the correct branch.
   - The single task title + ID they own (so each engineer knows their one task).
   - An instruction that **any further sub-agents they spawn must also be spawned with `mode=auto`**, since `mode` does not propagate to nested `Agent` calls automatically.

   Example briefing line to prepend to each teammate's first message:

   ```
   You are working inside a Git worktree at <absolute-worktree-path> on branch feature/<branch-name>.
   Do not cd out of this path; all reads, edits, tests, and commits must happen here.
   ```

5. **Create tasks for tracking and assignment.** For each task in the approved plan, call `TaskCreate` with the task title, description (incl. acceptance criteria pulled from the issue body), and the dependency hints noted in step 2. Capture the returned task IDs — they're needed for the next step.

6. **Update each task with owner and blockers.** For every created task, call `TaskUpdate` to set:
   - `owner` → the specific teammate that will run it: `backend-engineer-<i>` for the i-th backend task, `frontend-engineer-<i>` for the i-th frontend task, or `e2e-runner` for the create-E2E task.
   - `blockBy` → the task IDs of its dependencies determined in step 2 (omit / empty when the task has none).
   This is what unblocks the teammates to start picking up work in the right order: the **Create/modify E2E test cases** task runs first (no blockers), and every backend/frontend task blocks on it.

7. **Drive tasks to completion.** Let the engineer agents execute their assigned tasks (each engineer follows its own TDD-driven workflow per the `engineer` agent definition). Monitor for blocked / failed tasks. Do NOT advance to step 8 until **every task** is reported complete with passing tests.

8. **Open the PR that closes the issue.** Once every task is green, defer to `git-workflow` to open the PR from `feature/<branch-name>` into `main`. PR title uses Conventional Commits (`feat(<scope>): …` or the verb that matches the issue intent). PR body MUST include `Closes #<n>` so the issue auto-closes on merge. Report the PR URL back to the user.

   **Tear down `implementation-team`.** Immediately after the PR is open, stop every teammate spawned in step 4 (`backend-engineer-*`, `frontend-engineer-*`, `e2e-runner`) via `TaskStop`, then delete the team with `TeamDelete` against `implementation-team`. The implementation phase is over — the validation phase in step 9 spins up its own team. The worktree and remote branch stay intact; only the team goes away.

9. **Spin up the validation team and gate merge on E2E → security.** Use `TeamCreate` to provision a new team named **`validation-team`** with the following teammates, all `mode=auto`, all briefed on the same worktree path and `feature/<branch-name>` from step 3 using the briefing line in step 4:
   - `e2e-runner` (`subagent_type=e2e-runner`, `mode=auto`) — owns the validation E2E run against the full stack.
   - `backend-engineer` (`subagent_type=engineer`, `mode=auto`) — applies any backend fixes surfaced by E2E or security.
   - `frontend-engineer` (`subagent_type=engineer`, `mode=auto`) — applies any frontend fixes surfaced by E2E or security.
   - `security-reviewer` (`subagent_type=security-reviewer`, `mode=auto`) — validates the diff against `security-patterns` and dispatches fixes; never edits code itself.

   Then run validation in two ordered phases — **E2E first, security second**. Do not start phase B until phase A is green:

   - **a. Validate E2E test cases (first).** Call `TaskCreate` for a new `type=e2e` task titled "Validate E2E test cases" with `owner=e2e-runner` and `blockBy=[]` (the implementation tasks already merged in step 8 — no in-team blockers remain). `SendMessage` `e2e-runner` to run the E2E suite against the full stack on `feature/<branch-name>`. If it fails, the runner reports which scenario broke; dispatch the fix to `backend-engineer` or `frontend-engineer` (whichever layer owns the regression) via `SendMessage`. After fixes land in the worktree, re-message `e2e-runner` to re-run. Loop until the E2E suite is green. Mark the task `completed` only when the suite passes end-to-end.

   - **b. Security review (second, only after E2E is green).** `SendMessage` `security-reviewer` with the PR URL and diff scope. It validates the implemented changes against the `security-patterns` checklist, dispatches any failing-pattern fixes back to `backend-engineer` / `frontend-engineer` via `SendMessage`, and re-validates until every pattern passes (or it escalates an unfixable finding to the user). The security reviewer is read-only — all code changes during this loop are made by the engineer teammates inside the same worktree on `feature/<branch-name>`.
     - If the security review surfaces fixes, after the engineers land them, re-message `e2e-runner` to re-run the validation E2E suite against the patched code. The PR is not "ready" until **both** the E2E run is green **and** the security review is clean against the same commit.

10. **Update the PR with the post-validation code.** Once both the validation E2E run and the security review are clean, defer to `git-workflow` to push the new commits made during step 9 to the existing remote branch `feature/<branch-name>` so the open PR picks them up automatically. Then update the PR description (e.g. `gh pr edit <pr-number> --body …`) so the **Test plan** and **Implementation notes** sections reflect both the green validation E2E run and any security-review fixes. Re-share the PR URL with the user with a one-line note that validation and security review are complete.

11. **Tear down the local workspace and agent team.** Once the PR is open, up to date, and both validation E2E and the security review are clean:
    - **a. Delete the local branch and remove the worktree directory.** From the main repo checkout, defer to `git-workflow` to run `git worktree remove <absolute-worktree-path>` (use `--force` only if the worktree has uncommitted state the user has already approved discarding) and then `git branch -D feature/<branch-name>` to delete the local branch. The remote branch `origin/feature/<branch-name>` stays — the PR still needs it. Confirm both succeeded before continuing; if either fails (e.g. uncommitted changes, worktree locked), surface the error to the user instead of forcing.
    - **b. Terminate the validation team.** Stop every teammate spawned in step 9 (`e2e-runner`, `backend-engineer`, `frontend-engineer`, `security-reviewer`) via `TaskStop`, then delete the team with `TeamDelete` against `validation-team`. (`implementation-team` was already torn down at the end of step 8.) After this, no teammate is reachable via `SendMessage` — any further work on the issue requires re-running this skill.

## Pattern

### Tasks are backend XOR frontend — never both

Bad — a task that mixes layers cannot be cleanly assigned to one engineer:

```
Task: "Add user profile endpoint and the page that displays it"
```

Good — split along the layer boundary, with an explicit dependency:

```
Task A (backend): "Add GET /users/:id profile endpoint"
Task B (frontend): "Render user profile page consuming /users/:id"
  blockBy: [A]
```

### Iron rules

- **One issue → one feature branch → one PR.** Never bundle multiple issues into one implementation run; never merge directly without a PR.
- **Backend XOR frontend XOR e2e per task.** A task is owned by exactly one teammate. Mixed-layer implementation tasks must be split before `TaskCreate` is called.
- **One task per engineer teammate in `implementation-team`.** Spawn one `backend-engineer-<i>` per `backend` task and one `frontend-engineer-<i>` per `frontend` task — never batch multiple tasks onto the same engineer instance.
- **Two teams, two phases.** `implementation-team` (steps 4–8) ships the code and opens the PR; `validation-team` (step 9) gates merge on E2E + security. The teams never overlap — `implementation-team` is torn down at the end of step 8 before `validation-team` is created.
- **E2E bookends implementation across teams.** The "Create/modify E2E test cases" task in step 2 (owned by `e2e-runner` in `implementation-team`) blocks every implementation task; the "Validate E2E test cases" task in step 9 (owned by `e2e-runner` in `validation-team`) gates the security review. No implementation task starts without failing E2E tests in place, and the security review does not start until the validation E2E suite is green.
- **Validation order is fixed: E2E first, then security.** In step 9, `security-reviewer` is only messaged after `e2e-runner` reports the validation suite green. If the security review surfaces fixes, re-run validation E2E after fixes land — both must be clean against the same commit before the PR is "ready".
- **Dependencies are explicit.** Every cross-layer handoff (e.g. frontend consumes a new backend endpoint) appears as a `blockBy` edge — implicit ordering is not allowed.
- **Worktree, not in-place checkout.** The feature branch lives in its own worktree directory so `main` and any sibling work stay untouched.
- **Plan approval before task creation.** Do not call `TaskCreate` until the user has explicitly approved the feature name and task graph.
- **PR closes the issue.** The PR body must contain `Closes #<n>` (or `Fixes #<n>`) so GitHub auto-closes on merge.
- **Security review is mandatory before declaring done.** The PR is not "ready" until `security-reviewer` reports a clean pass and any fixes have been pushed to the PR branch.
- **`security-reviewer` is read-only.** All code changes during the security loop are made by the engineer teammates in `validation-team`; the reviewer only validates and dispatches.
- **Engineer agents own implementation details.** This skill orchestrates; it does not write production code itself. Hand each task to the right teammate and let them run their TDD loop.
- **All teammates run in `mode=auto`.** Every teammate spawned by this skill (engineers in either team, `e2e-runner`, `security-reviewer`) is created with `mode=auto` so they execute autonomously without prompting back on routine decisions. Each teammate is also instructed to pass `mode=auto` to any sub-agent they spawn, since the permission mode does not propagate down nested `Agent` calls.
- **Tear down each team at its phase boundary.** `implementation-team` is terminated at the end of step 8 (right after the PR opens); `validation-team` is terminated in step 11 (after E2E + security are clean and the worktree is removed). The remote branch and PR remain — the local workspaces and teams do not.

## Template

### Task plan presented to the user before locking (step 2)

```markdown
## Implementation plan for issue #<n> — <issue title>

**Feature name:** `<branch-name>`
**Branch:** `feature/<branch-name>` (worktree at `../<repo>-<branch-name>`)

**Tasks (implementation-team, step 4–7):**

1. **Create/modify E2E test cases**
   - Type: e2e (owner: `e2e-runner`)
   - Delivers: failing Playwright suite covering this issue's acceptance criteria
   - Blocked by: none — blocks every implementation task below

2. **<Backend or frontend task title>**
   - Type: backend | frontend (owner: `backend-engineer-1` | `frontend-engineer-1`)
   - Delivers: <one-line outcome>
   - Blocked by: task #1 (and any other implementation tasks it depends on)

3. **<Backend or frontend task title>**
   - Type: ... (owner: `backend-engineer-2` | `frontend-engineer-2` | …)
   - Delivers: ...
   - Blocked by: ...

(…)

**Created later by `validation-team` (step 9), not now:**

- **Validate E2E test cases** — owner: `e2e-runner` in `validation-team`. Runs after the PR opens; gates the security review.

Confirm the feature name, task split, and dependency edges. Reply with explicit approval ("approved" / "ship it") to lock — once locked I'll create the worktree, the `implementation-team`, and the tracked tasks.
```

### Final PR body (step 8)

```markdown
## Summary

<1–3 bullets describing what changed in behavior terms — pulled from `tdd-workflow`'s "Scope delivered">

Closes #<issue-number>

## Test plan

<bulleted checklist from `tdd-workflow`'s "Module + contract tests" + "E2E coverage" + "Verification run" — what was tested and how to re-verify locally>

## Implementation notes

<the "Modules touched" list and any "Open questions / follow-ups" `tdd-workflow` flagged for reviewer attention>
```
