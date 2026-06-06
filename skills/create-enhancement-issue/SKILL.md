---
name: create-enhancement-issue
description: "Create one kind:enhancement GitHub issue against an EXISTING codebase — the lightweight single-issue analog of /deep-dive-feature (no interview, no doc-lock). Reads context read-only to draft a feature-shaped body, guards that the change needs NO contract/data-model edit (if it does, it's a feature — stop), confirms with the user, then creates it via create-enhancement.sh. Activate on '/create-enhancement-issue', 'create/file an enhancement issue for <x>', or 'enhance <existing behavior>'."
---

# create-enhancement-issue

Turn a one-off enhancement request into a single, ready-to-review GitHub issue that the `/ship` lifecycle can pick up and drive through `implement-slice.mjs` — the same cycle a feature slice runs (author E2E → implement → review → PR), without the `/deep-dive-feature` interview or PRD doc-lock. This skill is the enhancement-kind sibling of `create-feature-issues` (which decomposes a PRD into many slices) and `create-bug-issue` (Zone-A symptom only).

An enhancement modifies an **existing** surface. The codebase already has its contracts, design system, and architecture docs, so this skill **reads** those for context but never changes them. The defining guard: **an enhancement never changes an API contract or data model** — if it would, it is a feature, and this skill stops and points you at `/deep-dive-feature`.

## When to activate

- The user types `/create-enhancement-issue`, or phrases like "create / file an enhancement issue for <x>", "enhance <existing behavior>", "add <small change> to the existing <feature>".

Do NOT activate to decompose a whole feature/PRD (that is `create-feature-issues`), to file a bug (that is `create-bug-issue`), or to drive implementation (that is `/ship`).

## Input

A short description of the enhancement. If none was given, ask the user what they want to enhance before doing anything else.

## Workflow

### Step 0 — Resolve the repo

`gh repo view --json nameWithOwner --jq .nameWithOwner`. If not a GitHub repo, surface and stop.

### Step 1 — Understand the request

From the request (and a brief clarifying exchange only if genuinely ambiguous — this is NOT a full interview), pin down: the existing behavior being changed, the new/changed behavior, and **whether it closes a cross-surface journey segment worth walking** (which earns an `e2e` task) versus being a backend-only / pure-layout change (no e2e task — its ACs are discharged at the backend/frontend owning layer). Note that "has UI" ≠ "needs an e2e task": classify by whether a journey is walked, not by whether a component renders. Keep it light; the user filed this because they already know what they want.

### Step 2 — Read context (read-only) + the contract guard

Read only what shapes the issue:

- `docs/GLOSSARY.md` — vocabulary for the body.
- The existing critical path / feature this extends (if it maps to one — a standalone enhancement may not), and the relevant `docs/api-contract/<entity>.yaml` / `docs/data-model/<entity>.yaml` / `docs/design-system/surfaces.md` for the surface(s) touched.

**Contract guard.** Decide whether the enhancement can be implemented by conforming to the existing contracts, or whether it would require **changing** `docs/api-contract/*` or `docs/data-model/*` (a new endpoint shape, a new/changed column, a new resource). If it requires a contract change, STOP and tell the user: *"This needs an API-contract / data-model change, which is an architecture decision — file it as a feature via `/deep-dive-feature`, not `/create-enhancement-issue`."* Do not create an issue.

### Step 3 — Draft the issue body

Fill `operation-git/templates/enhancement-issue.md`:

- **Context** — what this enhances, in glossary vocabulary.
- **Modifies** — the contract(s) it conforms to (read-only) and the surfaces/pages touched. The **Critical path / feature** pointer is *optional*: include it when the enhancement clearly extends one named feature; omit the line for a standalone / cross-cutting enhancement that doesn't map to a single feature. Never block or pester the user for a feature name — leave it out if there isn't an obvious one.
- **Scope** — in / out.
- **Acceptance criteria (EARS)** — **always present** (an AC is a specification, not a test). EARS only at the issue level; the Gherkin scenarios live **per task** (each task's `scenario:` block). A backend-only enhancement's ACs are backend invariants with a backend owning layer — write them; do not omit. Classify each AC clause by owning layer. ACs are ticked checkboxes ticked by the reviewer at end-of-slice review.
- **Tasks** — the durable checklist `implement-slice` parses. Use the slice-body format exactly: short static IDs (`e2e.1` / `be.1` / `fe.1`), a `blocked-by:` field (1-up DAG, `—` for none), and a follow-on line tagging `covers:` (AC clause ids) + `scenario:` (walked at its owning layer) uniformly, plus the type-specific pointer (`contract:` / `design:` / `entry-source:` + `reached-from:` for pages / `done:` for a contract-less utility). Emit an `e2e` task ONLY when the enhancement closes a cross-surface journey segment — there is no mandatory e2e prerequisite. An enhancement may have a single task or several.
- **Don't break** — the existing E2E specs / flows that must still pass.
- **Notes** — read-only ADRs, flags, caveats.

**Pick the branch intent** — a short kebab-case noun-phrase (≤40 chars) summarizing the behavioral change, in glossary vocabulary; do NOT mechanically slugify the title. (Same guidance as `create-feature-issues`' branch intent.)

### Step 4 — Confirm with the user

Show the drafted title, the full body, and the chosen intent. Creating a GitHub issue + branch is an outward-facing action — get explicit approval (and iterate on the draft) before Step 5. If the repo has a milestone this enhancement belongs to, ask whether to attach it (default: none — enhancements run in `/ship`'s repo-wide maintenance lane).

### Step 5 — Create the issue + linked branch

Write the approved body to a temp file, then:

```
bash skills/operation-git/scripts/create-enhancement.sh \
  --title "<title>" \
  --body-file <tmp-body-file> \
  --intent "<kebab-intent>" \
  [--milestone "<name>"]
```

The script creates the issue (`kind:enhancement` + `status:ready-to-review`) and links an `enhancement/<n>-<intent>` branch off `main` via `gh issue develop`. It prints `issue:<n>` and `branch:<...>`.

### Step 6 — Report

Report the created issue number/URL, the linked branch, and the task count. State plainly that the issue is at **`status:ready-to-review`** — the next step is the user's: **review it and flip `status:ready-to-review` → `status:ready-to-implement`** to release it, after which `/ship` (repo-wide, or scoped to the milestone) picks it up at kickoff and routes it to `implement-slice.mjs`.

## Iron rules

- **Enhancement = one feature-shaped issue against existing code.** Same `implement-slice` cycle as a feature slice; no interview, no PRD doc-lock.
- **Never changes a contract.** If the change needs an api-contract / data-model edit, it is a feature → `/deep-dive-feature`. Stop; do not create the issue.
- **The `## Tasks` checklist must match the slice-body format** (static IDs + `blocked-by:` + pointer line) — it is the ledger `implement-slice` parses.
- **Read context, never mutate it.** This skill only reads docs/contracts/glossary; the only writes are the new issue + its linked branch.
- **Confirm before creating.** Creating the issue + branch is outward-facing — get explicit user approval on the draft first.
- **Ships at `status:ready-to-review`.** The human approval flip to `status:ready-to-implement` is the release gate, identical to a create-feature-issues slice — this skill never auto-releases.
- **Mechanical gh work goes through `create-enhancement.sh`**, never hand-rolled `gh issue create` / `gh issue develop`.
