---
name: workflow-e2e-author
description: "Author Playwright E2E specs for the named E2E task ids on a slice branch. Read the slice body, locate the task block(s) in the `## Tasks` checklist, set up the slice worktree, translate the mapped Gherkin scenarios into specs, tick the authored tasks' checkboxes, commit with `Refs #<slice#>` + `Task: <id>` trailers, push, post a summary comment. Activate when dispatched with `Author E2E for slice #<n> tasks <ids>`, or on '/workflow-e2e-author'."
---

# workflow-e2e-author

Translate the named `e2e` tasks on a slice into Playwright specs. Dispatched with a (slice #, task ids) pair — the agent reads the slice body's `## Tasks` checklist for the named ids, the slice branch, the worktree path, and the slice's Acceptance criteria.

The agent loads its own pattern set (E2E conventions, semantic selectors, fixture isolation, etc.) at kickoff. This skill owns only the workflow: read → worktree → write → tick → commit → push → comment.

## When to activate

Activate this skill whenever:

- The dispatch prompt opens with `Author E2E for slice #<n> tasks <ids>`.
- The user types `/workflow-e2e-author`, or phrases like "author the E2E specs for slice #<n> tasks e2e.1,e2e.2".

Do NOT activate to address coverage-gate findings on a slice (use `workflow-e2e-fix`), or to write production code (engineer's lane).

## Input contract

Read the slice issue #<n> body. Locate the task block(s) for <ids> in the `## Tasks` checklist (each entry is `[ ] \`<id>\` · **<type>** · blocked-by: … · "<delivery>"` with a follow-on line tagging `covers:` (AC clause ids) + `scenario:` (the journey scenario to walk) plus the realized critical-path Journey step / `entry-source:` / `done:`). The checklist is the durable task ledger — a box already checked `[x]` means that task is DONE; skip it (resume safety). Read the slice's Acceptance criteria (EARS) plus the e2e task's own `scenario:` Gherkin for behavior; follow the pointer for the unit spec. An e2e task exists only because the slice closes a cross-surface journey segment — assert **user-visible** state through the UI, never a backend internal (those are proven at the backend layer).

## Workflow

Input from the caller: the slice # and the task ids. Discover everything else.

### 1. Read the slice body and locate the named tasks

Fetch the slice issue (number, title, body, labels, url) via `bash skills/operation-git/scripts/issue-body.sh <n>` — skips comment chrome. Parse the `## Tasks` checklist; locate each id in <ids>. Drop any already checked `[x]` (resume safety). If every named id is already `[x]`, exit cleanly — nothing to author. Confirm each remaining id is `**e2e**`; a non-e2e id is a routing bug → halt and surface.

### 2. Resolve the slice branch and set up the worktree

- Resolve the slice's attached branch (`gh issue develop <n> --list`, or `resolve-slice-branch.sh`).
- Create-or-reuse the slice-scoped worktree on that branch (do **not** integrate `origin/main` — authoring happens on the slice branch as-is; main is integrated once, later, at the Pass-E2E phase via `workflow-engineer-diagnose-e2e`).
- Before authoring, check the slice branch for prior `Refs #<slice#>` WIP commits — a killed earlier run may have already landed specs for some named ids; reconcile against the checklist (`[x]` = done) and resume from the first un-authored task.
- `cd` into the worktree path.

### 3. Author / extend Playwright specs from the slice AC

For each named e2e task, translate its own `scenario:` Gherkin block (the task carries the Given/When/Then it walks; `covers:` names the AC clause it discharges) into a Playwright spec inside the worktree — plus the pattern-mandated non-happy-paths (`pattern-test-coverage`). The agent's loaded pattern set owns the conventions (semantic selectors, fixture identity, extend-vs-fragment, what to assert). Read the slice's Acceptance criteria (EARS) plus the task's `scenario:` Gherkin for the behavior under test.

Smoke-run touched specs (`npx playwright test <files>`) and confirm each spec reaches a real assertion. Parse / load / locator-API errors → fix and re-run. Assertion failures (production code missing) → expected; don't patch production code.

### 4. Tick the authored tasks' checkboxes

For each id whose specs are authored and smoke-clean, flip its checklist box `[ ]` → `[x]` in the slice body (edit the slice body via `gh issue edit <n> --body-file`, or the operation-git helper). The checklist is the durable task ledger — ticking it is what lets a fresh dispatch skip the done task on resume.

### 5. Commit with `Refs` + `Task` trailers

Use the project's Conventional Commits format. Every commit body MUST end with:

```
Refs #<slice#>
Task: <static-id>
```

`<static-id>` is the checklist id the commit advances (e.g. `Task: e2e.1`). Commits land directly on the slice branch inside the worktree. Never use `Closes`.

### 6. Push and post a summary comment

Push the slice branch to `origin`, then post a comment on the slice issue summarizing what was authored (spec files, the task ids covered, the scenarios walked) via `bash skills/operation-git/scripts/post-comment.sh <n> <file>`.

Terminal action. Exit. Do NOT flip any label (the calling workflow owns gating). Do NOT close the slice, do NOT open a PR, do NOT message reviewers.

## Iron rules

- **E2E specs run against the full stack and start from the UI.** Never call backend HTTP endpoints directly from a spec's assertions.
- **Every commit carries `Refs #<slice#>` + `Task: <id>`.** The `Task:` trailer is the commit→checklist mapping the recovery story relies on.
- **Tick the box you authored.** The checklist is the durable ledger; an authored-but-unticked task looks un-done to the next dispatch.
- **Scope strictly to the named task ids and their mapped scenarios.** Anything outside the slice AC / the named tasks' `covers:` pointers is out of scope.
- **Red is expected; broken is not.** A test that fails on a missing implementation is correct output. A test that fails to load / parse / locate is not.
- **Never patch production code from this lane.** Production fixes are engineer's lane.
- **Resume from the checklist + WIP commits.** On a fresh dispatch, skip already-`[x]` tasks and pick up from the first unchecked one; reconcile against prior `Refs #<slice#>` commits on the branch.
- **Bail with `status:need-attention`** on unrecoverable blockers (slice branch missing, unfixable smoke-run parse error). Post a diagnostic comment before flipping the label.
- **Truth is in Git, the checklist, and the comment.** No structured summaries returned to the caller — the push, the ticked boxes, and the summary comment are the outputs.
