---
name: workflow-reviewer-review-slice
description: "Single-context reviewer FALLBACK for a slice (the real fan-out is `runReviewSlice()` inside workflows/implement-slice.mjs, which spawns one `axis-reviewer` agent per pattern). Read the slice body and parse its `## Tasks` checklist, set up the slice worktree (read-only), run the loaded reviewer pattern set, compose one `# Slice Review` comment, post it, and RETURN the verdict — flip no label, open no PR. Runs in a `test-coverage` scope (spec/test-coverage dimensions over authored E2E specs) or a `production-code` scope (all dimensions over implemented code). Activate when dispatched with `Review slice #<n>` or '/workflow-reviewer-review-slice'."
---

# workflow-reviewer-review-slice

The single-context reviewer **fallback** for a slice. The production path is the inlined fan-out `runReviewSlice()` inside `workflows/implement-slice.mjs` — it spawns one `axis-reviewer` agent per applicable pattern and runs for both the coverage gate (Phase B) and the slice review (Phase F). This skill documents the same review substance for when a single reviewer agent runs it directly (applying every applicable pattern in one context) — it reviews the slice (cross-task integration, contract coverage, seams between tasks), composes one structured `# Slice Review` comment, posts it, and **returns the verdict**. It flips no label and opens no PR.

The reviewer agent loads its own pattern set at kickoff. This skill owns workflow primitives only.

## When to activate

Activate this skill whenever:

- The dispatch prompt opens with `Review slice #<n>`.
- The user types `/workflow-reviewer-review-slice`.

A `scope` qualifier in the dispatch (or the default `production-code`) selects the review mode — see below.

## Input contract

Read the slice issue #<n> body and parse its `## Tasks` checklist (each entry is `[ ] \`<id>\` · **<type>** · blocked-by: … · "<delivery>"` with a `covers:`/`contract:`/`entry-source:`/`done:` pointer line). The checklist is the durable task ledger — the set of `[x]` tasks is what was built. Read the slice's Acceptance criteria (EARS + Gherkin) — that is the spec the slice is judged against; each task's pointer (api-contract / data-model / Gherkin scenario / design tokens) is the unit spec for that task.

## The Scope Manifest bounds every finding

This fallback applies the SAME bound the fan-out path enforces in `agents/axis-reviewer.md`. Derive a **Scope Manifest** from the slice issue body before reviewing — the closed authority for this slice:

- **Acceptance criteria** (the enumerated `AC1, AC2, …` ids) — the canonical, CLOSED acceptance set. **Never synthesize an AC** from prose, a heading, a comment, or a Gherkin line with no id. If it is not in the list, the slice does not owe it — and because the set is closed, round one must enumerate every gap in it (there is no "find one more next round").
- **Don't-break** (`## Don't break`) — regression guards on EXISTING behavior; "don't regress the current path," NOT a mandate to backfill the coverage that path always lacked.

Every `I:H` (blocking) finding must ground in either a declared AC id or a touched-path catalogue rule on a surface in the diff (for `pattern-reviewer-contract`, a clause violated by code that exists in the diff). A would-be blocker that rests on a prose-inferred AC, a reviewer-judgement edge no spec clause names, or a pre-existing gap on an untouched surface is itself the error — score it `I:M`/`I:L` (Defer/Nit) or drop it; it must never BLOCK.

## Scope (one skill, two modes)

- **`test-coverage`** — runs pre-implementation, judging the **authored E2E specs** against the slice AC + pattern-mandated non-happy-paths. Run only the Spec-phase dimensions (test-coverage, and contract if a sibling contract exists). Skip the Code-quality phase — there is no production code yet. **Wrinkle:** the dimension prompt's usual "test files are out of scope" rule *inverts* here — the E2E specs ARE the deliverable under review, so coverage mode explicitly targets them.
- **`production-code`** (default) — the two-phase walk (Spec compliance → Code quality) against the implemented code, as below.

## Workflow

### 1. Fetch the slice issue and parse the checklist

Fetch the slice issue (number, title, body, labels, url, milestone) via `bash skills/operation-git/scripts/issue-body.sh <n> number,title,body,labels,url,milestone` — the helper wraps `gh issue view --json` (skipping comment chrome). Parse the `## Tasks` checklist from the body: the `[x]` tasks are the implemented set under review; their pointers name the unit specs.

### 2. Set up a read-only worktree on the slice branch

Resolve the slice's attached branch, create-or-reuse the slice-scoped worktree on that branch (read-only), then `cd` into the worktree path.

### 3. Walk the loaded reviewer pattern set

**In `test-coverage` scope:** walk only the Spec-phase dimensions — the test-coverage gate (the shared `pattern-test-coverage` catalogue through the `pattern-reviewer-test-coverage` lens) plus `pattern-reviewer-contract` if a sibling contract file exists — targeting the **authored E2E specs**. Judge whether the specs cover every AC and every pattern-mandated non-happy-path. Skip Phase 2. Then jump to step 4.

**In `production-code` scope:** walk the loaded pattern set in **two phases**, bucketed by what the pattern is asking about (the reviewer agent's pattern table labels each row with its phase):

- **Phase 1 — Spec compliance**: the test-coverage gate — `pattern-test-coverage` read through the `pattern-reviewer-test-coverage` lens (both always loaded; walks the slice AC + Gherkin scenarios against the diff) — and `pattern-reviewer-contract` (loaded if a sibling contract file exists). These answer *"did this slice build what was asked?"* — missing AC tests, missing scenarios, endpoint paths that don't match the contract, ORM columns that don't match the data model.
- **Phase 2 — Code quality**: every other loaded pattern (coding standard, observability, security, language- and framework-specific patterns, container, database). These answer *"is what was built well-built?"* — quality, security, and maintainability issues regardless of whether the spec was met.

Each pattern emits raw findings as `{title, severity, location, evidence, fix}` records. Tag every Phase 1 finding `phase: spec` and every Phase 2 finding `phase: quality`.

#### 3a. Walk Phase 1 patterns, score, and decide (full scope)

Walk Phase 1 patterns to completion. Collect their findings. Score each on Impact × Effort/Risk per step 4 below. Then:

- **If any Phase 1 finding scores `I:H` (spec-broken)**: SKIP Phase 2 entirely. Compose the verdict comment with the Phase 1 findings only and a Phase-2-skipped note. The engineer's fix loop will rework the implementation; re-running quality patterns over code that's about to change wastes reviewer context.
- **If no Phase 1 finding scores `I:H`**: proceed to step 3b.

#### 3b. Walk Phase 2 patterns (full scope)

Walk every loaded Phase 2 pattern to completion. Collect their findings. Score per step 4. Carry the Phase 1 findings forward — they still appear in the verdict, just no longer block.

### 4. Score each finding on Impact × Effort/Risk and derive its fix-now class

- **Impact** is derived mechanically from pattern severity: CRITICAL/HIGH → `I:H`, MEDIUM → `I:M`, LOW → `I:L`.
- **Effort/Risk** is the reviewer's judgement of cost-to-fix-now: `E:L` (localized, ≲ 30 min), `E:M` (multi-file or new tests), `E:H` (design rework, schema/contract change, or unknown blast radius).
- **Fix-class** is the deterministic projection: `I:H × any` and `I:M × E:L` → `Fix`; `I:M × E:M/H` and `I:L × E:M/H` → `Defer`; `I:L × E:L` → `Nit`; the rest are `Drop` and never reach the comment.

Slice-level findings tend toward higher Effort (cross-task integration fixes often require touching multiple tasks' code or the slice's seams), so expect a heavier `Defer` column.

### 5. Compose the verdict comment and compute APPROVE / BLOCK

Header: `# Slice Review` (single literal — downstream flows may grep for it).

Compose, in order:

1. **Summary matrix** — a 3×3 count of `(Impact, Effort)` cells over all reported findings (Drop excluded).
2. **Disposition line** — `Fix now: <n>  •  Deferred: <n>  •  Nits: <n>`.
3. **Phase 1 — Spec compliance findings** (subhead). Print every Phase 1 finding with the bracketed prefix `### [<class> · I:<x>/E:<y>] <title>` followed by `**Impact (<x>):**`, `**Effort/Risk (<y>):**`, `**Fix:**`, and the BAD / GOOD snippets per the pattern's template. If none, write `_No spec-compliance findings._`
4. **Phase 2 — Code quality findings** (subhead). Same format. In `test-coverage` scope OR when Phase 2 was skipped per step 3a, replace this section with the matching note (`_Phase 2 (code quality) skipped: coverage scope — no production code yet._` or `_Phase 2 (code quality) skipped: Phase 1 produced at least one I:H finding. Re-review will run both phases after the engineer fix._`). If Phase 2 ran but produced no findings, write `_No code-quality findings._`
5. **Verdict** line.

Verdict is computed from Impact alone — Effort never blocks:

- **APPROVE** — no `I:H` finding remains.
- **BLOCK** — at least one `I:H` finding. (A Phase-1 `I:H` survivor that triggered the Phase-2 skip is still the BLOCK reason.)

The downstream engineer / e2e-author pickup uses the per-finding `Fix` / `Defer` / `Nit` class, not the verdict.

Write to `/tmp/review-slice-<slice#>.md`.

### 6. Post the verdict comment and return the verdict

Post the verdict comment on the slice issue via `bash skills/operation-git/scripts/post-comment.sh <n> /tmp/review-slice-<slice#>.md`, then **return the verdict object** (`APPROVE` / `BLOCK` + the findings) to the caller.

Terminal action. Exit. Flip NO label. Open NO draft PR. (Draft-PR creation moved to the `implement-slice` workflow's terminal phase; label gating is the calling workflow's job.)

### Blocked-run branch

If something prevents the review (worktree setup failed, slice branch missing), post a single diagnostic comment on the slice and surface the blocker to the caller. Flip no label.

## Iron rules

- **Read-only on code.** No edits, no pushes, no `git reset --hard` outside the worktree setup. The only write is one verdict comment.
- **One review, one comment, return the verdict.** Single-shot. No loop, no re-validation. Flip no label, open no PR.
- **Parse the checklist from the slice body** for the implemented set — never list closed sub-issues (there are none; tasks live in the checklist).
- **Every finding carries `(I:<x>, E:<y>, <class>)`.** Impact is derived mechanically from pattern severity; Effort is the reviewer's judgement; class is the matrix projection onto Fix / Defer / Nit / Drop. `Drop` findings never reach the comment.
- **APPROVE / BLOCK is computed from Impact alone — Effort never blocks.** Any `I:H` survivor → BLOCK; otherwise APPROVE.
- **The Scope Manifest is a hard boundary on what may be `I:H`.** Only a gap mapping to a declared AC / Gherkin / contract clause on a touched surface earns `I:H`. Reviewer-judgement edge breadth (boundary, special-char, stand-in assertions) the spec never names, and any pre-existing gap on a surface this slice did not change, are `I:M`/`I:L` at most — surfaced as advice, never a BLOCK. Block on tests that are *missed for spec'd behavior* and code that *violates its contract*; everything else is a Nit.
- **`test-coverage` scope inverts the test-files rule.** The authored E2E specs are the deliverable under review in coverage mode — target them, judge them against the slice AC + non-happy-paths, and skip the code-quality phase.
- **The reviewer pattern set is owned by the agent.**
- **GitHub + the returned verdict are the outputs.** The verdict comment is the only GitHub write; the returned verdict object is the caller's signal.
