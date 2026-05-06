---
name: implement-issue
description: "Drive the end-to-end implementation of a GitHub issue: fetch the main issue along with its typed sub-issues (e2e/backend/frontend) produced by `create-issues`, derive a branch name, create a worktree-backed feature branch, spin up an `implementation-team` of one `backend-engineer` / `frontend-engineer` (both `subagent_type=engineer`) per matching sub-issue plus an `e2e-runner` for the e2e sub-issue when one exists, register each sub-issue as a tracked task with the sub-issue body copied verbatim into the task body, drive tasks to green, open a PR that closes the issue, then tear down the implementation team and create a separate `validation-team` (`e2e-runner`, `backend-engineer`, `frontend-engineer`, `security-reviewer`) that first validates the E2E suite end-to-end and then runs the security review, dispatching fixes to the engineer teammates and pushing them to the same PR. Activate whenever the user asks to implement, build, ship, work on, or pick up an issue — phrases like 'implement issue 42', 'implement #42', 'work on issue 42', 'pick up #42', 'build out the feature in issue 42', 'ship issue 42', 'start implementation of issue 42', 'implement the issue', or any request that supplies a `gh` issue number / URL as the unit of work to implement. Triggers on verbs (implement, build, ship, deliver, develop, work on, pick up, start, kick off) paired with nouns (issue, ticket, #<n>, GitHub issue, story). Do NOT activate for issue *creation* (use `create-issues`), issue triage, or generic coding tasks without a referenced issue."
---

# implement-issue

Take a single GitHub issue from "ready" to "merged PR" by orchestrating two purpose-built agent teams. The skill fetches the main issue along with the typed sub-issues (`e2e` / `backend` / `frontend`) that `create-issues` already laid down — the sub-issues ARE the work plan; this skill does not invent its own. It isolates the work in a worktree-backed feature branch, dispatches each sub-issue to a dedicated engineer in the `implementation-team`, opens a PR that closes the issue, then hands the diff to a separate `validation-team` that gates merge on a green E2E run followed by a clean security review.

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

1. **Fetch the main issue and its sub-issues.** Resolve the issue number from the user's request. Via `git-workflow`:
   - Run `gh issue view <n> --json number,title,body,labels,state,url` to pull the full main issue.
   - Fetch every sub-issue of `#<n>`. These are the typed task issues (`e2e` / `backend` / `frontend`) created by `create-issues`, and they ARE the work plan for this implementation — there is no separate planning step. Defer to `git-workflow` for the canonical sub-issue list invocation (typically `gh issue view <n> --json subIssues` or the equivalent GraphQL query when the CLI flag is unavailable). For each sub-issue, capture: number, title, body, parsed `Type` (`e2e` | `backend` | `frontend`), and the GitHub issue numbers in its `Dependencies` / `Blocked by` section.

   Stop and surface back to the user — do not start work — if any of the following hold:
   - The main issue is closed or missing.
   - The main issue has zero sub-issues (it was not produced by `create-issues`, so there is no executable plan).
   - A sub-issue has a `Type` that is not one of `e2e` / `backend` / `frontend`, or its body is missing the `Type` / `Delivery` / `Done criteria` sections.

2. **Derive a branch name.** From the main issue title, pick a kebab-case `<branch-name>` used for branch + worktree naming. Confirm the branch name with the user before proceeding. **Do not invent a task plan here** — the work plan is the set of sub-issues already fetched in step 1, and their dependency graph is already final (`create-issues` resolved `Blocked by` to real issue numbers).

3. **Create a worktree-backed feature branch.** Defer to `git-workflow` for the canonical worktree-creation flow. Use branch name `feature/<branch-name>` cut from up-to-date `origin/main`, and place the worktree at `../<repo>-<branch-name>` (or the repo's conventional sibling path). All subsequent steps run inside that worktree. **Capture the absolute worktree path** — every teammate spawned in step 4 must be told to operate inside it.

4. **Spin up the implementation team.** Use `TeamCreate` to provision a team named **`implementation-team`**. The teammate roster is derived directly from the sub-issues fetched in step 1 — every teammate is created with `mode=auto` so they execute their assigned sub-issue autonomously without prompting back on routine decisions:
   - For every sub-issue with `Type: backend`, spawn one `backend-engineer-<i>` (`subagent_type=engineer`, `mode=auto`). The count of `backend-engineer-*` teammates MUST equal the count of backend sub-issues from step 1.
   - For every sub-issue with `Type: frontend`, spawn one `frontend-engineer-<i>` (`subagent_type=engineer`, `mode=auto`). The count of `frontend-engineer-*` teammates MUST equal the count of frontend sub-issues from step 1.
   - If step 1 found a sub-issue with `Type: e2e`, spawn one `e2e-runner` (`subagent_type=e2e-runner`, `mode=auto`) to own it. For backend-only / data-model-only main issues with no `e2e` sub-issue, do NOT spawn an `e2e-runner` in `implementation-team`.

   **One sub-issue per agent.** Each `backend-engineer-<i>` / `frontend-engineer-<i>` is assigned exactly one sub-issue — do not batch multiple sub-issues onto the same engineer teammate. The `<i>` suffix (`-1`, `-2`, …) makes each teammate addressable by name so `SendMessage` can dispatch the right work to the right agent.

   Keep every teammate addressable by name (`SendMessage`) for the rest of the implementation phase.

   **Brief every teammate on the worktree.** In the initial `SendMessage` to each `backend-engineer-<i>`, `frontend-engineer-<i>`, and `e2e-runner`, include:
   - The absolute worktree path created in step 3 (e.g. `/Users/.../<repo>-<branch-name>`).
   - An explicit instruction that all work — file reads, edits, commands, commits — MUST happen inside that worktree, not in the main repo checkout.
   - The branch name `feature/<branch-name>` so they commit on the correct branch.
   - The sub-issue number + title they own (so each teammate knows their one piece of work and can re-read the full sub-issue body via `gh issue view <sub-issue-#>` if needed).
   - An instruction that **any further sub-agents they spawn must also be spawned with `mode=auto`**, since `mode` does not propagate to nested `Agent` calls automatically.

   Example briefing line to prepend to each teammate's first message:

   ```
   You are working inside a Git worktree at <absolute-worktree-path> on branch feature/<branch-name>.
   Do not cd out of this path; all reads, edits, tests, and commits must happen here.
   ```

5. **Create tasks from the sub-issues.** For each sub-issue fetched in step 1, call `TaskCreate` to register a tracked task. Pass:
   - `title` → the sub-issue title, prefixed with the sub-issue number for traceability, e.g. `[#<sub-issue>] <sub-issue title>`.
   - `body` / description → the **full body of the GitHub sub-issue verbatim** (the `Type`, `Delivery`, `Done criteria`, `Dependencies`, and any other sections written by `create-issues`). Do not paraphrase or summarize — the sub-issue body is what `create-issues` produced for the assigned agent to execute against, and the agent reads this directly to know what to deliver and what "done" looks like. Optionally prepend a one-line header pointing back at the sub-issue URL so the agent can re-fetch via `gh issue view` if it needs labels / comments / attachments not captured in the body.

   Capture a mapping of `<sub-issue number> → <returned local task ID>` for every sub-issue — step 6 needs it to translate the cross-sub-issue blocker references into local task-ID `blockBy` edges.

6. **Update each task with owner and blockers.** For every created task, call `TaskUpdate` to set:
   - `owner` → the specific teammate matching the originating sub-issue's `Type`: `backend-engineer-<i>` for the i-th backend sub-issue, `frontend-engineer-<i>` for the i-th frontend sub-issue, or `e2e-runner` for the (at most one) e2e sub-issue.
   - `blockBy` → translate the GitHub issue numbers from the originating sub-issue's `Dependencies` / `Blocked by` section into local task IDs using the `<sub-issue number> → <task ID>` mapping captured in step 5. Omit / empty when the sub-issue has no `Blocked by` entries.

   This reproduces the dependency graph as it was approved during `create-issues`. Per the E2E-first rule baked in there, the e2e task runs first (no blockers) and every backend/frontend task lists the e2e task as a blocker — so the teammates pick up work in the correct order.

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
- **Sub-issues are the work plan — do not invent one.** The set of typed sub-issues (`e2e` / `backend` / `frontend`) attached to the main issue by `create-issues` is the canonical task graph; their `Dependencies` section is the canonical edge list. This skill faithfully executes that graph. If the main issue has no sub-issues, stop and tell the user — `create-issues` has not been run.
- **Sub-issue body → Task body, verbatim.** When `TaskCreate` is called in step 5, the GitHub sub-issue body is copied into the Task description as-is so the assigned engineer agent has everything (`Type`, `Delivery`, `Done criteria`, `Dependencies`) without paraphrasing.
- **Backend XOR frontend XOR e2e per task.** A task is owned by exactly one teammate. The sub-issue's `Type` field decides which.
- **One sub-issue per engineer teammate in `implementation-team`.** Spawn one `backend-engineer-<i>` per backend sub-issue and one `frontend-engineer-<i>` per frontend sub-issue — never batch multiple sub-issues onto the same engineer instance.
- **Two teams, two phases.** `implementation-team` (steps 4–8) ships the code and opens the PR; `validation-team` (step 9) gates merge on E2E + security. The teams never overlap — `implementation-team` is torn down at the end of step 8 before `validation-team` is created.
- **E2E bookends implementation across teams (when an `e2e` sub-issue exists).** The `e2e` sub-issue (owned by `e2e-runner` in `implementation-team`) blocks every implementation task — `create-issues` already encoded this via the E2E-first rule. The "Validate E2E test cases" task in step 9 (owned by `e2e-runner` in `validation-team`) gates the security review. For backend-only main issues with no `e2e` sub-issue, no `e2e-runner` is spawned in `implementation-team` and the bookend on the implementation side is skipped.
- **Validation order is fixed: E2E first, then security.** In step 9, `security-reviewer` is only messaged after `e2e-runner` reports the validation suite green. If the security review surfaces fixes, re-run validation E2E after fixes land — both must be clean against the same commit before the PR is "ready".
- **Dependencies come from the sub-issues.** Every `blockBy` edge in step 6 is the translation of a real GitHub issue number from a sub-issue's `Dependencies` section into a local task ID. No implicit ordering, and no edges that weren't in the source sub-issue graph.
- **Worktree, not in-place checkout.** The feature branch lives in its own worktree directory so `main` and any sibling work stay untouched.
- **PR closes the issue.** The PR body must contain `Closes #<n>` (or `Fixes #<n>`) so GitHub auto-closes on merge.
- **Security review is mandatory before declaring done.** The PR is not "ready" until `security-reviewer` reports a clean pass and any fixes have been pushed to the PR branch.
- **`security-reviewer` is read-only.** All code changes during the security loop are made by the engineer teammates in `validation-team`; the reviewer only validates and dispatches.
- **Engineer agents own implementation details.** This skill orchestrates; it does not write production code itself. Hand each task to the right teammate and let them run their TDD loop.
- **All teammates run in `mode=auto`.** Every teammate spawned by this skill (engineers in either team, `e2e-runner`, `security-reviewer`) is created with `mode=auto` so they execute autonomously without prompting back on routine decisions. Each teammate is also instructed to pass `mode=auto` to any sub-agent they spawn, since the permission mode does not propagate down nested `Agent` calls.
- **Tear down each team at its phase boundary.** `implementation-team` is terminated at the end of step 8 (right after the PR opens); `validation-team` is terminated in step 11 (after E2E + security are clean and the worktree is removed). The remote branch and PR remain — the local workspaces and teams do not.

## Template

### Sub-issue roster + branch confirmation (step 2)

Surface the sub-issues fetched in step 1 alongside the proposed branch name so the user can sanity-check both before the worktree is cut. The roster is read-only confirmation — do not edit / re-plan the graph; if it looks wrong, the right move is to fix the sub-issues via `create-issues` and re-invoke this skill.

```markdown
## Ready to implement issue #<n> — <issue title>

**Branch name:** `feature/<branch-name>` (worktree will be cut at `../<repo>-<branch-name>`)

**Sub-issues that will be executed (sourced from `gh`, not re-planned):**

1. `#<sub-issue>` — `<Type>` — <sub-issue title>
   - Owner: `e2e-runner` | `backend-engineer-<i>` | `frontend-engineer-<i>`
   - Blocked by: <list of GitHub sub-issue numbers from this sub-issue's Dependencies section, or "none">

2. `#<sub-issue>` — `<Type>` — <sub-issue title>
   - Owner: ...
   - Blocked by: ...

(…)

**Created later by `validation-team` (step 9), not from the sub-issues:**

- **Validate E2E test cases** — owner: `e2e-runner` in `validation-team`. Runs after the PR opens; gates the security review. Skipped when there is no `e2e` sub-issue (backend-only main issue).

Confirm the branch name. Reply with explicit approval ("approved" / "ship it") to lock — once locked I'll create the worktree, the `implementation-team`, and register each sub-issue as a tracked task.
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
