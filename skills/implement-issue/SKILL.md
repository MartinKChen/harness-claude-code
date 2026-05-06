---
name: implement-issue
description: "Drive the end-to-end implementation of a GitHub issue: fetch the main issue along with its typed sub-issues (e2e/backend/frontend) produced by `create-issues`, derive a branch name, create a worktree-backed feature branch, register each sub-issue as a tracked task with the sub-issue body copied verbatim into the task body, then dispatch each unblocked task as a one-shot `Agent` sub-agent — `subagent_type=e2e-runner` for e2e tasks, `subagent_type=engineer` (instructed as backend or frontend) for the others — driving tasks to green and opening a PR that closes the issue. After the PR is open, run a validation phase that dispatches another set of one-shot sub-agents — an `e2e-runner` to validate the E2E suite, then a `security-reviewer`, and `engineer` sub-agents (instructed as backend or frontend) for any fixes — pushing them to the same PR. Activate whenever the user asks to implement, build, ship, work on, or pick up an issue — phrases like 'implement issue 42', 'implement #42', 'work on issue 42', 'pick up #42', 'build out the feature in issue 42', 'ship issue 42', 'start implementation of issue 42', 'implement the issue', or any request that supplies a `gh` issue number / URL as the unit of work to implement. Triggers on verbs (implement, build, ship, deliver, develop, work on, pick up, start, kick off) paired with nouns (issue, ticket, #<n>, GitHub issue, story). Do NOT activate for issue *creation* (use `create-issues`), issue triage, or generic coding tasks without a referenced issue."
---

# implement-issue

Take a single GitHub issue from "ready" to "merged PR" by orchestrating one-shot sub-agents per task. The skill fetches the main issue along with the typed sub-issues (`e2e` / `backend` / `frontend`) that `create-issues` already laid down — the sub-issues ARE the work plan; this skill does not invent its own. It isolates the work in a worktree-backed feature branch, dispatches each unblocked task as a one-shot sub-agent (an `e2e-runner` for e2e tasks, an `engineer` instructed as backend or frontend for the others), opens a PR that closes the issue, then runs a validation phase that dispatches another set of one-shot sub-agents — an `e2e-runner` to gate on a green E2E run, a `security-reviewer` to gate on a clean review, and `engineer` sub-agents (instructed as backend or frontend) for any fixes.

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

3. **Create a worktree-backed feature branch.** Defer to `git-workflow` for the canonical worktree-creation flow. Use branch name `feature/<branch-name>` cut from up-to-date `origin/main`, and place the worktree at `../<repo>-<branch-name>` (or the repo's conventional sibling path). All subsequent steps run inside that worktree. **Capture the absolute worktree path** — every sub-agent dispatched in steps 7 and 9 must be told to operate inside it.

4. **Define the per-task dispatch contract.** There is no persistent agent team in this skill — instead, every unblocked task is dispatched as a one-shot, unnamed sub-agent via the `Agent` tool. The `subagent_type` is selected from the originating sub-issue's `Type`, and the role for `engineer` sub-agents is passed explicitly in the dispatch prompt (the `engineer` agent does not infer its role from a name):

   | Sub-issue `Type` | `subagent_type` | Role passed in the dispatch prompt |
   |------------------|-----------------|-------------------------------------|
   | `e2e`            | `e2e-runner`    | n/a (the agent is already E2E-scoped) |
   | `backend`        | `engineer`      | "Your role is **backend engineer**." |
   | `frontend`       | `engineer`      | "Your role is **frontend engineer**." |

   Every sub-agent is spawned with `mode=auto` so it executes its assigned task autonomously without prompting back on routine decisions.

   The dispatch prompt for **every** sub-agent (regardless of type) MUST include:
   - The absolute worktree path created in step 3 (e.g. `/Users/.../<repo>-<branch-name>`).
   - An explicit instruction that all work — file reads, edits, commands, commits — MUST happen inside that worktree, not in the main repo checkout.
   - The branch name `feature/<branch-name>` so the agent commits on the correct branch.
   - The local task ID (from step 5) and the sub-issue number + title the agent owns, plus the **full sub-issue body verbatim** (so the agent has `Type`, `Delivery`, `Done criteria`, `Dependencies` without needing to re-fetch). The agent can still re-fetch via `gh issue view <sub-issue-#>` if it needs labels / comments / attachments.
   - For `engineer` sub-agents only: the explicit role line from the table above.
   - An instruction that **any further sub-agents the dispatched agent spawns must also be spawned with `mode=auto`**, since `mode` does not propagate to nested `Agent` calls automatically.
   - An instruction to call `TaskUpdate` to mark its assigned task `completed` when its acceptance criteria are met (the orchestrator watches the task list to decide when to dispatch the next unblocked task in step 7).

   Example briefing line to prepend to each sub-agent's prompt:

   ```
   You are working inside a Git worktree at <absolute-worktree-path> on branch feature/<branch-name>.
   Do not cd out of this path; all reads, edits, tests, and commits must happen here.
   ```

   **One task per sub-agent.** Each dispatched sub-agent owns exactly one task — never batch multiple tasks into one `Agent` call. Independent unblocked tasks are dispatched as separate `Agent` calls in the same message so they run in parallel.

5. **Create tasks from the sub-issues.** For each sub-issue fetched in step 1, call `TaskCreate` to register a tracked task. Pass:
   - `title` → the sub-issue title, prefixed with the sub-issue number for traceability, e.g. `[#<sub-issue>] <sub-issue title>`.
   - `body` / description → the **full body of the GitHub sub-issue verbatim** (the `Type`, `Delivery`, `Done criteria`, `Dependencies`, and any other sections written by `create-issues`). Do not paraphrase or summarize — the sub-issue body is what `create-issues` produced for the assigned agent to execute against, and the agent reads this directly to know what to deliver and what "done" looks like. Optionally prepend a one-line header pointing back at the sub-issue URL so the agent can re-fetch via `gh issue view` if it needs labels / comments / attachments not captured in the body.

   Capture a mapping of `<sub-issue number> → <returned local task ID>` for every sub-issue — step 6 needs it to translate the cross-sub-issue blocker references into local task-ID `blockBy` edges.

6. **Update each task with blockers.** For every created task, call `TaskUpdate` to set:
   - `blockBy` → translate the GitHub issue numbers from the originating sub-issue's `Dependencies` / `Blocked by` section into local task IDs using the `<sub-issue number> → <task ID>` mapping captured in step 5. Omit / empty when the sub-issue has no `Blocked by` entries.

   This reproduces the dependency graph as it was approved during `create-issues`. Per the E2E-first rule baked in there, the e2e task runs first (no blockers) and every backend/frontend task lists the e2e task as a blocker — so the orchestrator dispatches work in the correct order. Tasks are not pre-assigned to a named teammate; the `Type` of the originating sub-issue is what determines the `subagent_type` and role used at dispatch time per the contract in step 4.

7. **Drive tasks to completion.** Loop until every task is `completed`:
   - Find every task whose `blockBy` list is satisfied (all blocking tasks already `completed`) and that has not yet been dispatched.
   - For each such task, spawn one one-shot sub-agent via `Agent` per the dispatch contract in step 4 — independent unblocked tasks go out in parallel as multiple `Agent` calls in the same message. Each engineer sub-agent receives its role (backend or frontend) explicitly in the prompt; each `e2e-runner` is dispatched without role text.
   - When a sub-agent reports back, verify its task is marked `completed` via `TaskUpdate`. If the sub-agent failed or surfaced a blocker, surface it to the user — do not silently re-dispatch.
   - Repeat until **every task** is `completed` with passing tests. Do NOT advance to step 8 while any task is still pending or failing.

8. **Open the PR that closes the issue.** Once every task is green, defer to `git-workflow` to open the PR from `feature/<branch-name>` into `main`. PR title uses Conventional Commits (`feat(<scope>): …` or the verb that matches the issue intent). PR body MUST include `Closes #<n>` so the issue auto-closes on merge. Report the PR URL back to the user.

9. **Run validation as one-shot sub-agents and gate merge on E2E → security.** Validation also dispatches one-shot, unnamed sub-agents per the dispatch contract in step 4 — there is no persistent team. Every sub-agent is briefed on the same worktree path and `feature/<branch-name>` from step 3 using the briefing line in step 4, and is spawned with `mode=auto`. Use these `subagent_type` + role combinations:

   | Purpose                                | `subagent_type`     | Role passed in the dispatch prompt          |
   |----------------------------------------|---------------------|---------------------------------------------|
   | Run the validation E2E suite           | `e2e-runner`        | n/a                                         |
   | Apply backend fixes surfaced by E2E or security | `engineer`  | "Your role is **backend engineer**."        |
   | Apply frontend fixes surfaced by E2E or security | `engineer` | "Your role is **frontend engineer**."       |
   | Run the security review                | `security-reviewer` | n/a (read-only — never edits code itself)   |

   Run validation in two ordered phases — **E2E first, security second**. Do not start phase B until phase A is green:

   - **a. Validate E2E test cases (first).** Call `TaskCreate` for a new `type=e2e` task titled "Validate E2E test cases" with `blockBy=[]` (the implementation tasks already merged in step 8 — no remaining blockers). Dispatch a one-shot `e2e-runner` sub-agent (`subagent_type=e2e-runner`, `mode=auto`) to run the E2E suite against the full stack on `feature/<branch-name>`. If it fails, the runner reports which scenario broke; dispatch a one-shot `engineer` sub-agent for the fix — `subagent_type=engineer`, `mode=auto`, with the role line "Your role is **backend engineer**." or "Your role is **frontend engineer**." per whichever layer owns the regression. After the fix lands in the worktree, dispatch a fresh `e2e-runner` sub-agent to re-run. Loop until the E2E suite is green. Mark the task `completed` only when the suite passes end-to-end.

   - **b. Security review (second, only after E2E is green).** Dispatch a one-shot `security-reviewer` sub-agent (`subagent_type=security-reviewer`, `mode=auto`) with the PR URL and diff scope. It validates the implemented changes against the `security-patterns` checklist and reports any failing patterns. For every failing pattern, dispatch a one-shot `engineer` sub-agent — `subagent_type=engineer`, `mode=auto`, with the explicit role line ("Your role is **backend engineer**." or "Your role is **frontend engineer**.") for whichever layer owns the fix — to land the change inside the worktree on `feature/<branch-name>`. The `security-reviewer` is read-only; it never edits code. Once fixes land, dispatch a fresh `security-reviewer` sub-agent to re-validate. Repeat until every pattern passes (or escalate an unfixable finding to the user).
     - If the security review surfaces fixes, after the engineers land them, dispatch a fresh `e2e-runner` sub-agent to re-run the validation E2E suite against the patched code. The PR is not "ready" until **both** the E2E run is green **and** the security review is clean against the same commit.

10. **Update the PR with the post-validation code.** Once both the validation E2E run and the security review are clean, defer to `git-workflow` to push the new commits made during step 9 to the existing remote branch `feature/<branch-name>` so the open PR picks them up automatically. Then update the PR description (e.g. `gh pr edit <pr-number> --body …`) so the **Test plan** and **Implementation notes** sections reflect both the green validation E2E run and any security-review fixes. Re-share the PR URL with the user with a one-line note that validation and security review are complete.

11. **Tear down the local workspace.** Once the PR is open, up to date, and both validation E2E and the security review are clean, delete the local branch and remove the worktree directory: from the main repo checkout, defer to `git-workflow` to run `git worktree remove <absolute-worktree-path>` (use `--force` only if the worktree has uncommitted state the user has already approved discarding) and then `git branch -D feature/<branch-name>` to delete the local branch. The remote branch `origin/feature/<branch-name>` stays — the PR still needs it. Confirm both succeeded before continuing; if either fails (e.g. uncommitted changes, worktree locked), surface the error to the user instead of forcing.

    No team teardown is needed: every sub-agent dispatched in steps 7 and 9 was a one-shot `Agent` call that returned its result before the orchestrator moved on, so nothing persistent is left to stop. After the worktree is removed, any further work on the issue requires re-running this skill.

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
- **Sub-issue body → Task body, verbatim.** When `TaskCreate` is called in step 5, the GitHub sub-issue body is copied into the Task description as-is so the dispatched sub-agent has everything (`Type`, `Delivery`, `Done criteria`, `Dependencies`) without paraphrasing.
- **Backend XOR frontend XOR e2e per task.** A task is executed by exactly one sub-agent. The sub-issue's `Type` field decides the `subagent_type` (and, for `engineer`, the role passed in the dispatch prompt).
- **One task per dispatched sub-agent.** Each `Agent` call owns exactly one task — never batch multiple tasks into a single sub-agent run.
- **No persistent team — one-shot `Agent` calls only.** Both the implementation phase (steps 4–8) and the validation phase (step 9) dispatch unnamed, one-shot sub-agents via `Agent`. There is no `TeamCreate` / `SendMessage` / `TaskStop` / `TeamDelete` flow — every sub-agent runs to completion and returns, then the orchestrator decides what to dispatch next based on task state.
- **Engineer role is passed in the prompt, not in the agent name.** The `engineer` subagent does NOT infer "backend" vs. "frontend" from a teammate name. The orchestrator MUST include an explicit role line — "Your role is **backend engineer**." or "Your role is **frontend engineer**." — in the dispatch prompt for every `engineer` sub-agent, in both the implementation phase and the validation phase.
- **E2E bookends implementation (when an `e2e` sub-issue exists).** The `e2e` sub-issue (dispatched as an `e2e-runner` in step 7) blocks every implementation task — `create-issues` already encoded this via the E2E-first rule. The "Validate E2E test cases" task in step 9 (dispatched as a fresh `e2e-runner` per run) gates the security review. For backend-only main issues with no `e2e` sub-issue, the implementation-side `e2e-runner` dispatch is skipped.
- **Validation order is fixed: E2E first, then security.** In step 9, the `security-reviewer` sub-agent is only dispatched after the `e2e-runner` sub-agent reports the validation suite green. If the security review surfaces fixes, re-dispatch a fresh `e2e-runner` after fixes land — both must be clean against the same commit before the PR is "ready".
- **Dependencies come from the sub-issues.** Every `blockBy` edge in step 6 is the translation of a real GitHub issue number from a sub-issue's `Dependencies` section into a local task ID. No implicit ordering, and no edges that weren't in the source sub-issue graph.
- **Worktree, not in-place checkout.** The feature branch lives in its own worktree directory so `main` and any sibling work stay untouched. Every dispatched sub-agent is briefed on the absolute worktree path so all work stays inside it.
- **PR closes the issue.** The PR body must contain `Closes #<n>` (or `Fixes #<n>`) so GitHub auto-closes on merge.
- **Security review is mandatory before declaring done.** The PR is not "ready" until a `security-reviewer` sub-agent reports a clean pass and any fixes have been pushed to the PR branch.
- **`security-reviewer` is read-only.** All code changes during the security loop are made by `engineer` sub-agents dispatched per fix; the reviewer only validates and reports findings.
- **Engineer agents own implementation details.** This skill orchestrates; it does not write production code itself. Dispatch each task to the right sub-agent type (with the right role for `engineer`) and let it run its TDD loop.
- **All sub-agents run in `mode=auto`.** Every sub-agent dispatched by this skill (`engineer`, `e2e-runner`, `security-reviewer`) is spawned with `mode=auto` so it executes autonomously without prompting back on routine decisions. Each sub-agent is also instructed to pass `mode=auto` to any nested `Agent` calls it makes, since the permission mode does not propagate down nested `Agent` calls automatically.

## Template

### Sub-issue roster + branch confirmation (step 2)

Surface the sub-issues fetched in step 1 alongside the proposed branch name so the user can sanity-check both before the worktree is cut. The roster is read-only confirmation — do not edit / re-plan the graph; if it looks wrong, the right move is to fix the sub-issues via `create-issues` and re-invoke this skill.

```markdown
## Ready to implement issue #<n> — <issue title>

**Branch name:** `feature/<branch-name>` (worktree will be cut at `../<repo>-<branch-name>`)

**Sub-issues that will be executed (sourced from `gh`, not re-planned):**

1. `#<sub-issue>` — `<Type>` — <sub-issue title>
   - Dispatched as: `subagent_type=e2e-runner` | `subagent_type=engineer` (role: backend engineer) | `subagent_type=engineer` (role: frontend engineer)
   - Blocked by: <list of GitHub sub-issue numbers from this sub-issue's Dependencies section, or "none">

2. `#<sub-issue>` — `<Type>` — <sub-issue title>
   - Dispatched as: ...
   - Blocked by: ...

(…)

**Created later in the validation phase (step 9), not from the sub-issues:**

- **Validate E2E test cases** — dispatched as `subagent_type=e2e-runner`. Runs after the PR opens; gates the security review. Skipped when there is no `e2e` sub-issue (backend-only main issue).

Confirm the branch name. Reply with explicit approval ("approved" / "ship it") to lock — once locked I'll create the worktree, register each sub-issue as a tracked task, and start dispatching unblocked tasks as one-shot sub-agents.
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
