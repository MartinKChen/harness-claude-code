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

1. **Fetch and validate the main issue.** Resolve the issue number from the user's request. Via `git-workflow`, run `gh issue view <n> --json number,title,body,labels,state,url` to pull the full main issue.

   Stop and surface back to the user — do not proceed — if any of the following hold:
   - The main issue is closed or missing.
   - The main issue does NOT carry the `status:reviewed` label. The label is set by `create-issues` only after the slice has been fully wired up (parent + every sub-issue created, blockers linked, parent-link set). Its absence means the slice is still in `status:draft`, so do NOT start implementation.

2. **Fetch and validate the sub-issues.** Fetch every sub-issue of `#<n>`. These are the typed task issues (`e2e` / `backend` / `frontend`) created by `create-issues`, and they ARE the work plan for this implementation — there is no separate planning step. Defer to `git-workflow` for the canonical sub-issue list invocation (typically `gh issue view <n> --json subIssues` or the equivalent GraphQL query when the CLI flag is unavailable). For each sub-issue, capture: number, title, body, labels, **type derived from the `type:<type>` label** (`e2e` | `backend` | `frontend`), and the GitHub issue numbers in its `Dependencies` / `Blocked by` section. The sub-issue body no longer carries a `## Type` section — the type comes from the label only.

   Stop and surface back to the user — do not proceed — if any of the following hold:
   - The main issue has zero sub-issues (it was not produced by `create-issues`, so there is no executable plan).
   - A sub-issue is missing a `type:<type>` label, or its label value is not one of `type:e2e` / `type:backend` / `type:frontend`.
   - A sub-issue body is missing the `Delivery` or `Done criteria` sections.
   - Any sub-issue does NOT carry the `status:ready` label. Same gate as the main issue — `create-issues` promotes parent and tasks together; a missing `status:ready` on any sub-issue means the slice is still draft.

3. **Derive a branch name.** From the main issue title, pick a kebab-case `<branch-name>` used for branch + worktree naming. Confirm the branch name with the user before proceeding. **Do not invent a task plan here** — the work plan is the set of sub-issues already fetched in steps 1–2, and their dependency graph is already final (`create-issues` resolved `Blocked by` to real issue numbers).

4. **Create a worktree-backed feature branch.** Defer to `git-workflow` for the canonical worktree-creation flow. Use branch name `feature/<branch-name>` cut from up-to-date `origin/main`, and place the worktree at `../<repo>-<branch-name>` (or the repo's conventional sibling path). All subsequent steps run inside that worktree. **Capture the absolute worktree path** — every sub-agent dispatched in steps 8 and 10 must be told to operate inside it.

5. **Define the per-task dispatch contract.** There is no persistent agent team in this skill — instead, every unblocked task is dispatched as a one-shot, unnamed sub-agent via the `Agent` tool. The `subagent_type` is selected from the originating sub-issue's **`type:<type>` label** (captured in step 2), and the role for `engineer` sub-agents is passed explicitly in the dispatch prompt (the `engineer` agent does not infer its role from a name):

   | Sub-issue label | `subagent_type` | Role passed in the dispatch prompt |
   |-----------------|-----------------|-------------------------------------|
   | `type:e2e`      | `e2e-runner`    | n/a (the agent is already E2E-scoped) |
   | `type:backend`  | `engineer`      | "Your role is **backend engineer**." |
   | `type:frontend` | `engineer`      | "Your role is **frontend engineer**." |

   Every sub-agent is spawned with `mode=auto` so it executes its assigned task autonomously without prompting back on routine decisions.

   The dispatch prompt for **every** sub-agent (regardless of type) MUST include:
   - The absolute parent feature-worktree path created in step 4 (e.g. `/Users/.../<repo>-<branch-name>`).
   - The branch name `feature/<branch-name>` of that parent worktree.
   - The local task ID (from step 6) and the sub-issue number + title the agent owns, plus the **full sub-issue body verbatim** (so the agent has `Delivery`, `Done criteria`, `Dependencies` without needing to re-fetch). The agent can still re-fetch via `gh issue view <sub-issue-#>` if it needs labels / comments / attachments.
   - For `engineer` sub-agents only: the explicit role line from the table above, **plus the explicit line `Mode: sub-issue task.`** — this tells the engineer it is implementing one sub-issue and triggers its per-task-worktree workflow defined in `agents/engineer.md` (cut a fresh worktree+branch at `../<repo>-<branch-name>-<task-id>` from the tip of `feature/<branch-name>`, do all work there, then merge back into `feature/<branch-name>` and clean up). The orchestrator does NOT cut the per-task worktree — the engineer does.
   - For `e2e-runner` sub-agents (no `engineer` role): an instruction that all work MUST happen inside the parent feature worktree on `feature/<branch-name>` — they do NOT cut a nested worktree.
   - An instruction that **any further sub-agents the dispatched agent spawns must also be spawned with `mode=auto`**, since `mode` does not propagate to nested `Agent` calls automatically.
   - An instruction to call `TaskUpdate` to mark its assigned task `completed` when its acceptance criteria are met (the orchestrator watches the task list to decide when to dispatch the next unblocked task in step 8).

   Example briefing line to prepend to each sub-agent's prompt:

   ```
   The feature worktree is at <absolute-worktree-path> on branch feature/<branch-name>.
   For e2e-runner: all work happens directly in this worktree on this branch.
   For engineer (Mode: sub-issue task): cut your own per-task worktree+branch off feature/<branch-name>
     per agents/engineer.md, do your work there, then merge back and clean up.
   ```

   **One task per sub-agent.** Each dispatched sub-agent owns exactly one task — never batch multiple tasks into one `Agent` call. Independent unblocked tasks are dispatched as separate `Agent` calls in the same message so they run in parallel.

6. **Create tasks from the sub-issues.** For each sub-issue fetched in step 2, call `TaskCreate` to register a tracked task. Pass:
   - `title` → the sub-issue title, prefixed with the sub-issue number for traceability, e.g. `[#<sub-issue>] <sub-issue title>`.
   - `body` / description → the **full body of the GitHub sub-issue verbatim** (the `Delivery`, `Done criteria`, `Dependencies`, and any other sections written by `create-issues`). Do not paraphrase or summarize — the sub-issue body is what `create-issues` produced for the assigned agent to execute against, and the agent reads this directly to know what to deliver and what "done" looks like. Optionally prepend a one-line header pointing back at the sub-issue URL so the agent can re-fetch via `gh issue view` if it needs labels / comments / attachments not captured in the body.

   Capture a mapping of `<sub-issue number> → <returned local task ID>` for every sub-issue — step 7 needs it to translate the cross-sub-issue blocker references into local task-ID `blockBy` edges.

7. **Update each task with blockers.** For every created task, call `TaskUpdate` to set:
   - `blockBy` → translate the GitHub issue numbers from the originating sub-issue's `Dependencies` / `Blocked by` section into local task IDs using the `<sub-issue number> → <task ID>` mapping captured in step 6. Omit / empty when the sub-issue has no `Blocked by` entries.

   This reproduces the dependency graph as it was approved during `create-issues`. Per the E2E-first rule baked in there, the e2e task runs first (no blockers) and every backend/frontend task lists the e2e task as a blocker — so the orchestrator dispatches work in the correct order. Tasks are not pre-assigned to a named teammate; the originating sub-issue's `type:<type>` label is what determines the `subagent_type` and role used at dispatch time per the contract in step 5.

8. **Drive tasks to completion.** Loop until every task is `completed`:
   - Find every task whose `blockBy` list is satisfied (all blocking tasks already `completed`) and that has not yet been dispatched.
   - For each such task, spawn one one-shot sub-agent via `Agent` per the dispatch contract in step 5 — independent unblocked tasks go out in parallel as multiple `Agent` calls in the same message. Each engineer sub-agent receives its role (backend or frontend) explicitly in the prompt; each `e2e-runner` is dispatched without role text.
   - When a sub-agent reports back, verify its task is marked `completed` via `TaskUpdate`. If the sub-agent failed or surfaced a blocker, surface it to the user — do not silently re-dispatch.
   - Repeat until **every task** is `completed` with passing tests. Do NOT advance to step 9 while any task is still pending or failing.

9. **Open the PR that closes the issue.** Once every task is green, defer to `git-workflow` to open the PR from `feature/<branch-name>` into `main`. PR title uses Conventional Commits (`feat(<scope>): …` or the verb that matches the issue intent). PR body MUST include `Closes #<n>` so the issue auto-closes on merge. Report the PR URL back to the user.

10. **Spin up a validation Agent Team and gate merge on E2E → security.** Validation runs as a persistent Agent Team — created via `TeamCreate` — with four **named** members so they can hand off to each other via `SendMessage` rather than routing every round-trip through the orchestrator. **Do NOT call `TaskCreate` for this phase.** The orchestrator pings `e2e-runner` to run the E2E suite, then pings `security-reviewer` to review the PR, and only advances to step 11 once **both** members have reported clean.

    Team members — each spawned with `mode=auto` and the standard worktree briefing line from step 5:

    | Name                 | `subagent_type`     | Role line in the spawn prompt                |
    |----------------------|---------------------|----------------------------------------------|
    | `e2e-runner`         | `e2e-runner`        | n/a (already E2E-scoped)                     |
    | `backend-engineer`   | `engineer`          | "Your role is **backend engineer**."         |
    | `frontend-engineer`  | `engineer`          | "Your role is **frontend engineer**."        |
    | `security-reviewer`  | `security-reviewer` | n/a (read-only — never edits code itself)    |

    Every member's spawn prompt MUST also include: the names of the other three teammates, an explicit instruction that they can address each other directly via `SendMessage` (e.g. `e2e-runner` hands a regression to `backend-engineer` without going through the orchestrator), the parent feature-worktree path + `feature/<branch-name>`, and the PR URL.

    Member-specific additions to the spawn prompts:

    - `backend-engineer` and `frontend-engineer` MUST receive their explicit role line ("Your role is **backend engineer**." / "Your role is **frontend engineer**.") because the `engineer` subagent does NOT infer role from the team-member name — **plus the explicit line `Mode: post-implementation task.`** This tells the engineer to **stay on `feature/<branch-name>` inside the existing parent feature worktree at `../<repo>-<branch-name>`** when teammates hand them a fix to land — they do NOT cut their own per-task worktree in this mode (that's the implementation-phase behavior). See `agents/engineer.md`.
    - `e2e-runner` and `security-reviewer` work directly in the parent feature worktree on `feature/<branch-name>`.

    Run validation in two ordered phases — **E2E first, security second**. Do NOT advance to step 11 until BOTH `e2e-runner` and `security-reviewer` have reported clean to the orchestrator against the same commit.

    - **a. Validate E2E (first).** From the orchestrator, `SendMessage` to `e2e-runner` asking it to run the full E2E suite against the stack on `feature/<branch-name>`. If the suite fails, `e2e-runner` is responsible for handing the regression off to `backend-engineer` or `frontend-engineer` (whichever layer owns the fix) via `SendMessage`, waiting for the engineer to commit the fix on the worktree branch, then re-running the suite. The orchestrator does NOT broker each round-trip — it just waits for `e2e-runner` to report back that the suite is green. Do NOT proceed to phase b until then.

    - **b. Security review (second, only after E2E is green).** From the orchestrator, `SendMessage` to `security-reviewer` with the PR URL and diff scope; ask it to validate the implemented changes against the `security-patterns` checklist. For every failing pattern, `security-reviewer` hands the fix off to `backend-engineer` or `frontend-engineer` via `SendMessage` (the reviewer is read-only and never edits code itself). After fixes land, `security-reviewer` re-validates, and — if any code changed — also pings `e2e-runner` via `SendMessage` to re-run the E2E suite so both gates remain clean against the same commit. The orchestrator waits for `security-reviewer` to report a final clean pass; if `e2e-runner` had to re-run, also wait for it to report green again. Only when **both** members have reported clean does control return to step 11.

11. **Push the post-validation code and comment on the PR.** Once both the validation E2E run and the security review are clean, defer to `git-workflow` to push the new commits made during step 10 to the existing remote branch `feature/<branch-name>` so the open PR picks them up automatically. **Do NOT edit the PR description.** Instead, post a comment on the PR (e.g. `gh pr comment <pr-number> --body …`) recording the validation outcome — at minimum: the green E2E run, any security findings + their fix commits, and the head commit SHA both gates were clean against. The comment is the durable audit trail; the PR body stays as it was opened in step 9. Re-share the PR URL with the user with a one-line note that validation and security review are complete.

12. **Tear down the validation team and the local workspace.** Once the PR is open, up to date, and both `e2e-runner` and `security-reviewer` have reported clean: first call `TeamDelete` to stop the validation team created in step 10 (`e2e-runner`, `backend-engineer`, `frontend-engineer`, `security-reviewer`). Next, from inside the parent feature worktree at `<absolute-worktree-path>`, run `docker compose down -v` to stop the validation stack and drop its volumes so no leftover containers, networks, or named volumes linger after the worktree is gone. Then, from the main repo checkout, defer to `git-workflow` to run `git worktree remove <absolute-worktree-path>` (use `--force` only if the worktree has uncommitted state the user has already approved discarding) and then `git branch -D feature/<branch-name>` to delete the local branch. The remote branch `origin/feature/<branch-name>` stays — the PR still needs it. Confirm each step succeeded before continuing; if any fails (e.g. uncommitted changes, worktree locked, compose teardown errors), surface the error to the user instead of forcing.

    The implementation-phase sub-agents (steps 5–9) were one-shot `Agent` calls and have already returned, so nothing else is left to stop. After the team is deleted and the worktree removed, any further work on the issue requires re-running this skill.

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
- **`status:ready` is the gate.** The main issue and every sub-issue MUST carry the `status:ready` label before this skill starts work. `create-issues` promotes both parent and tasks from `status:draft` → `status:ready` only after the full slice is wired up. A missing label on either side stops the skill in steps 1–2.
- **Type comes from the label, not the body.** The originating sub-issue's `type:<type>` label is the single source of truth for whether a task is `e2e`, `backend`, or `frontend`. The sub-issue body no longer carries a `## Type` section — never parse type out of the body.
- **Sub-issues are the work plan — do not invent one.** The set of typed sub-issues (`e2e` / `backend` / `frontend`) attached to the main issue by `create-issues` is the canonical task graph; their `Dependencies` section is the canonical edge list. This skill faithfully executes that graph. If the main issue has no sub-issues, stop and tell the user — `create-issues` has not been run.
- **Sub-issue body → Task body, verbatim.** When `TaskCreate` is called in step 6, the GitHub sub-issue body is copied into the Task description as-is so the dispatched sub-agent has everything (`Delivery`, `Done criteria`, `Dependencies`) without paraphrasing.
- **Backend XOR frontend XOR e2e per task.** A task is executed by exactly one sub-agent. The sub-issue's `type:<type>` label decides the `subagent_type` (and, for `engineer`, the role passed in the dispatch prompt).
- **One task per dispatched sub-agent.** Each `Agent` call owns exactly one task — never batch multiple tasks into a single sub-agent run.
- **Implementation is one-shot; validation is a named team.** The implementation phase (steps 5–9) dispatches each task as an unnamed, one-shot `Agent` call — no team, no cross-talk. The validation phase (step 10) is the opposite: a named `TeamCreate` of `e2e-runner` / `backend-engineer` / `frontend-engineer` / `security-reviewer` so members can hand off via `SendMessage` without the orchestrator brokering each round-trip. The team is torn down with `TeamDelete` in step 12.
- **No tasks for the validation team.** Step 10 does NOT call `TaskCreate`. The orchestrator drives validation by sending `SendMessage` directly to `e2e-runner` first, then to `security-reviewer`, and step 11 only starts after BOTH have reported clean to the orchestrator against the same commit.
- **Engineer role is passed in the prompt, not in the agent name.** The `engineer` subagent does NOT infer "backend" vs. "frontend" from a teammate name — even when the team-member name is literally `backend-engineer` / `frontend-engineer`. The orchestrator MUST include an explicit role line — "Your role is **backend engineer**." or "Your role is **frontend engineer**." — in the spawn prompt for every `engineer` sub-agent / team member, in both the implementation phase and the validation phase.
- **E2E bookends implementation.** The `e2e` sub-issue (dispatched as an `e2e-runner` in step 8) blocks every implementation task — `create-issues` already encoded this via the E2E-first rule. The validation team's `e2e-runner` (step 10) gates the security review. For backend-only main issues with no `e2e` sub-issue, the implementation-side `e2e-runner` dispatch is skipped.
- **Validation order is fixed: E2E first, then security.** In step 10, the orchestrator pings `security-reviewer` only after `e2e-runner` reports the suite green. If the security review surfaces fixes, `e2e-runner` re-runs after the engineer-team fixes land — BOTH `e2e-runner` and `security-reviewer` must be clean against the same commit before step 11 starts.
- **Dependencies come from the sub-issues.** Every `blockBy` edge in step 7 is the translation of a real GitHub issue number from a sub-issue's `Dependencies` section into a local task ID. No implicit ordering, and no edges that weren't in the source sub-issue graph.
- **Worktree, not in-place checkout.** The feature branch lives in its own worktree directory so `main` and any sibling work stay untouched. Every dispatched sub-agent is briefed on the absolute worktree path so all work stays inside it.
- **PR closes the issue.** The PR body must contain `Closes #<n>` (or `Fixes #<n>`) so GitHub auto-closes on merge.
- **Security review is mandatory before declaring done.** The PR is not "ready" until a `security-reviewer` sub-agent reports a clean pass and any fixes have been pushed to the PR branch.
- **`security-reviewer` is read-only.** All code changes during the security loop are made by `engineer` sub-agents dispatched per fix; the reviewer only validates and reports findings.
- **Engineer agents own implementation details.** This skill orchestrates; it does not write production code itself. Dispatch each task to the right sub-agent type (with the right role for `engineer`) and let it run its TDD loop.
- **All sub-agents run in `mode=auto`.** Every sub-agent dispatched by this skill (`engineer`, `e2e-runner`, `security-reviewer`) is spawned with `mode=auto` so it executes autonomously without prompting back on routine decisions. Each sub-agent is also instructed to pass `mode=auto` to any nested `Agent` calls it makes, since the permission mode does not propagate down nested `Agent` calls automatically.

## Template

### Sub-issue roster + branch confirmation (step 3)

Surface the sub-issues fetched in steps 1–2 alongside the proposed branch name so the user can sanity-check both before the worktree is cut. The roster is read-only confirmation — do not edit / re-plan the graph; if it looks wrong, the right move is to fix the sub-issues via `create-issues` and re-invoke this skill.

```markdown
## Ready to implement issue #<n> — <issue title>

**Branch name:** `feature/<branch-name>` (worktree will be cut at `../<repo>-<branch-name>`)

**Sub-issues that will be executed (sourced from `gh`, not re-planned):**

1. `#<sub-issue>` — type from `type:<type>` label — <sub-issue title>
   - Dispatched as: `subagent_type=e2e-runner` | `subagent_type=engineer` (role: backend engineer) | `subagent_type=engineer` (role: frontend engineer)
   - Blocked by: <list of GitHub sub-issue numbers from this sub-issue's Dependencies section, or "none">

2. `#<sub-issue>` — type from `type:<type>` label — <sub-issue title>
   - Dispatched as: ...
   - Blocked by: ...

(…)

**Validation phase (step 10):** spins up a named Agent Team — `e2e-runner`, `backend-engineer`, `frontend-engineer`, `security-reviewer` — that runs after the PR opens. No tasks are created for it. The orchestrator pings `e2e-runner` first via `SendMessage`, then pings `security-reviewer`, and proceeds to step 11 only when both report clean. The team is torn down via `TeamDelete` in step 12.

Confirm the branch name. Reply with explicit approval ("approved" / "ship it") to lock — once locked I'll create the worktree, register each sub-issue as a tracked task, and start dispatching unblocked tasks as one-shot sub-agents.
```

### Final PR body (step 9)

```markdown
## Summary

<1–3 bullets describing what changed in behavior terms — pulled from `tdd-workflow`'s "Scope delivered">

Closes #<issue-number>

## Test plan

<bulleted checklist from `tdd-workflow`'s "Module + contract tests" + "E2E coverage" + "Verification run" — what was tested and how to re-verify locally>

## Implementation notes

<the "Modules touched" list and any "Open questions / follow-ups" `tdd-workflow` flagged for reviewer attention>
```
