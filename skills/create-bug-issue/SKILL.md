---
name: create-bug-issue
description: "Create one kind:bug GitHub issue with a Zone-A (symptom) body — the reporter's record of what's broken: Summary, Environment, Steps to reproduce, Expected vs. actual, Evidence, Severity, Regression anchor. Helps the user fill the bug-issue.md template (without inventing facts), confirms it, then creates the issue (kind:bug, NO status, NO branch) via create-bug.sh so /ship analyze picks it up. Activate on '/create-bug-issue', 'file/report a bug', or 'create a bug issue for <x>'."
---

# create-bug-issue

File a single `kind:bug` issue capturing **only the symptom** (Zone A). This is deliberately the lightest of the three issue-creation skills — it has no tasks, no acceptance criteria, and no linked branch, because a bug's *spec* is produced later by the read-only analyze step (`workflow-engineer-analyze-bug`), which reproduces the symptom, root-causes it, and posts a `# Bug Analysis` comment for a human to approve. This skill's job is to capture a clean, reproducible symptom so that analyze can do its work.

Sibling skills: `create-feature-issues` (decompose a PRD into many slices) and `create-enhancement-issue` (one feature-shaped enhancement). All three set `kind:*` at creation.

## When to activate

- The user types `/create-bug-issue`, or phrases like "file / report a bug", "create a bug issue for <x>", "something's broken: <symptom>".

Do NOT activate to diagnose or fix a bug (the analyze step + `fix-bug.mjs`, both driven by `/ship`, own that), or to file an enhancement / feature.

## Input

The symptom information the user has — error text, screenshots, steps, where it happened. If the request is just "file a bug" with no detail, ask for the essentials (what's broken, how to reproduce, what you expected) before drafting.

## Workflow

### Step 0 — Resolve the repo

`gh repo view --json nameWithOwner --jq .nameWithOwner`. If not a GitHub repo, surface and stop.

### Step 1 — Gather the symptom (do not invent)

Fill `operation-git/templates/bug-issue.md` from what the user provides — this is Zone A, a record of observed reality, so **never fabricate** logs, environments, or repro steps. Where a field is genuinely unknown, write `unknown` rather than guessing. Invest most in the two fields that make a bug actionable for the analyze step:

- **Steps to reproduce** — numbered, deterministic. For a UI bug, start from the entry URL + exact clicks (this is the path the browser-driven analyze step will replay).
- **Evidence** — paste, don't paraphrase: stack traces, error messages, request IDs, timestamps, the failing request/response, and any screenshot/recording.

Also capture Summary (observed vs. expected), Environment (where / version-commit / browser-OS / role), Severity + who's affected, and the Regression anchor (used to work? last-known-good).

> **Do NOT diagnose.** Root cause, the proposed fix, and the regression-test plan are the analyze step's output, posted as a `# Bug Analysis` comment — not part of this issue body. If the user already has a theory, drop it into the Evidence/Notes as *their* hypothesis, clearly marked, not as a root-cause claim.

### Step 2 — Confirm with the user

Show the drafted title + the full Zone-A body. Creating a GitHub issue is outward-facing — get explicit approval (and iterate) before Step 3. If it belongs to a milestone, ask whether to attach one (default: none — bugs run in `/ship`'s repo-wide maintenance lane).

### Step 3 — Create the issue

Write the approved body to a temp file, then:

```
bash skills/operation-git/scripts/create-bug.sh \
  --title "<title>" \
  --body-file <tmp-body-file> \
  [--milestone "<name>"]
```

The script creates the issue with `kind:bug` and **no `status:*` label and no branch** — exactly the analyze-eligible state.

### Step 4 — Report

Report the created issue number/URL. State plainly what happens next: the bug carries `kind:bug` with no status, so the next `/ship` pass's **analyze stage** dispatches a read-only engineer that reproduces it (browser MCP / Playwright), posts a `# Bug Analysis` comment, and flips it to `status:ready-to-review`; a human then approves the approach (→ `status:ready-to-implement`) and `/ship` drives the fix via `fix-bug.mjs`.

## Iron rules

- **Zone A only — the symptom, never the diagnosis.** Root cause / fix / regression plan belong to the analyze step's `# Bug Analysis` comment, not this body.
- **Never fabricate observed facts.** Logs, environment, and repro steps are a record of reality; `unknown` beats a guess.
- **No status label, no branch.** A freshly-filed bug is `kind:bug` and nothing else — that is the analyze-eligible state the `/ship` analyze stage keys off. The fix branch is created later by `fix-bug.mjs`.
- **Confirm before creating.** Creating the issue is outward-facing — get explicit user approval on the draft first.
- **Mechanical gh work goes through `create-bug.sh`**, never hand-rolled `gh issue create`.
