---
name: dream-summary-memory
description: "The 'dreaming' pass over a consuming project's recent history. Reads GitHub issues AND PRs closed since the last dream run (the cutoff recorded in `dream-log.md`, not a fixed time window — so it can run on demand at any cadence) — review/fix comment threads and fix commits (issues), plus CI-failure and merge-conflict history (PRs) — distills the recurring, pattern-wise mistakes engineers and reviewers keep making, and writes them as additive rule overlays under `.claude/memory/patterns/<skill>.md`. Maps each improvement to the relevant `pattern-engineer-*` / `pattern-reviewer-*` skill, honors overlay precedence from `memory-convention`, appends an audit entry to `.claude/memory/dream-log.md`, and reports a summary. Writes autonomously (no per-edit approval) so it can run unattended on a schedule. Never edits baseline pattern skills in this plugin. Activate on '/dream-summary-memory', 'dream the memory', or 'summarize recent issues into memory'."
---

# dream-summary-memory

Once a day (or on demand), the project "dreams": it replays what just happened — which findings reviewers raised, which mistakes engineers repeated across fix cycles, which CI checks kept failing, where parallel slices kept colliding — and consolidates the *patterns* into memory so the next dispatch starts smarter. It reads GitHub history (closed issues **and** closed PRs), not the runtime telemetry signals. Its only output is curated, additive overlay rules plus an audit log.

It runs in the consuming project. It **never** edits the baseline pattern skills shipped by this plugin, and it **never** sends anything upstream.

## When to activate

Activate this skill whenever:

- The user types `/dream-summary-memory`, "dream the memory", or "summarize recent issues into memory".
- A scheduled routine (`/schedule`) or `/loop /dream-summary-memory` fires it unattended.

It is **autonomous**: it writes overlays without asking for per-edit approval (so it works when scheduled). It always reports what it wrote, and the `dream-log.md` is the audit trail.

## Workflow

### 1. Resolve and auto-create the memory root

```bash
MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
MEMORY_ROOT="$MAIN_ROOT/.claude/memory"
mkdir -p "$MEMORY_ROOT/patterns"
```

Memory is always-on (see `memory-convention`); never gate on the directory pre-existing.

### 2. Determine the cutoff

There is **no fixed time window**. The cutoff is the timestamp of the last dream run, recorded in `dream-log.md` — process every in-scope issue and PR closed **after** that point, however long ago it was. This lets the dream run on demand at any cadence (hourly, daily, after a long gap) without missing or reprocessing history.

```bash
# The last run's timestamp is the most recent `## <ISO-8601>` heading.
# Entries are appended, so the newest is the LAST such heading in the file.
if [ -f "$MEMORY_ROOT/dream-log.md" ]; then
  SINCE="$(grep '^## ' "$MEMORY_ROOT/dream-log.md" | tail -1 | sed 's/^## //')"
fi

# Bootstrap (no prior run / no parseable heading): default to the last 24h so
# the very first pass stays bounded instead of scanning all history.
SINCE="${SINCE:-$(date -u -v-24H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ)}"
```

`$SINCE` is the only cutoff — do not intersect it with a 24h floor. List both candidate sets:

```bash
# Closed feature issues (review→fix history).
gh issue list --state closed --search "closed:>=$SINCE" \
  --json number,title,labels,closedAt --limit 200

# Closed PRs, merged or not (CI-failure + merge-conflict history).
gh pr list --state all --search "closed:>=$SINCE" \
  --json number,title,labels,closedAt,mergedAt --limit 200
```

Keep only `kind:feature` task/slice issues (`level:task` or `level:slice`) and their PRs. If neither set has anything, append a "nothing to dream" entry to `dream-log.md` and exit.

### 3. Gather the history

Two evidence streams, gathered independently.

**3a. Each closed issue's review→fix loop.** For every in-scope issue, collect what went wrong and how it was fixed:

- **Issue comments** — `gh issue view <n> --comments`. Focus on reviewer verdict comments (`# Review` / `# Code Review`) and their findings, especially rounds that came back `review:need-fix`.
- **Linked PR review threads** — resolve the PR (`gh pr list --search "<n> in:body" --state all` or the issue's timeline) and read `gh pr view <pr> --comments` and review comments.
- **Fix commits** — `git log --grep="Refs #<n>" --oneline` and the diffs they introduced, which show what the engineer actually changed in response to each finding.

The unit of interest is the **review→fix loop**: a finding raised, then the code change that resolved it. Multiple loops per issue are common.

**3b. Each closed PR's CI-failure + merge-conflict history.** For every in-scope PR, collect what blocked the merge and how it was unblocked (this is the surface the `workflow-engineer-fix-pr` lane handles):

- **CI failures** — `gh pr view <pr> --json statusCheckRollup,number` for the check states, then for each failed run pull the failing output (`gh run view <run-id> --log-failed`, or `gh pr checks <pr>` for the summary). Cross-reference the `Refs #<pr-#>` fix commits (`git log --grep="Refs #<pr-#>"`) to see what the engineer changed to turn CI green. The pattern-wise signal is a **CI check that fails the same way across multiple PRs** — the same lint rule, the same type error, the same class of failing/flaky test.
- **Merge conflicts** — the fix-pr lane resolves conflicts by merging `main` into the slice branch; inspect those merge/fix commits and the PR comment thread for **which files conflicted**. ⚠️ Conflicts are largely **inherent to parallel feature development** — most are one-off and carry no lesson. The only pattern-wise signal is a **recurring hotspot**: the same shared file conflicting across many parallel slices (a central route registry, a barrel/`index` file, a migration chain, a DI container, a shared constants file). A single conflict is noise — drop it.

### 4. Summarize — pattern-wise only

Distill the gathered history into improvement rules. The bar is **recurring and generalizable**:

- **Keep** a finding/mistake when it is categorical — a class of error that will recur (e.g. "broad `except Exception` swallowing DB errors", "missing ownership check before mutation", "mutable default argument"). These map cleanly onto a pattern skill's domain.
- **Drop** one-off, instance-specific bugs (a typo'd constant, a single wrong copy string) — they are not patterns and must not become memory.

For each kept pattern, decide the overlay edit type and the target pattern skill:

| Signal in the history | Overlay section | Target skill |
|-----------------------|-----------------|--------------|
| Reviewer repeatedly flags the same code shape across issues | `## Sharpened triggers` | the pattern skill that owns the rule |
| Engineer repeatedly pushes back and the reviewer concedes (false positive in this project) | `## Project-specific carve-outs` | the pattern skill that emitted it |
| A defect surfaced late (slice/PR review or human) that task-level review never raised | `## New rules` | the reviewer pattern skill that should have caught it |
| A finding took many fix cycles to land — the rule was understood but the fix kept missing | `## Examples worth pinning` (cite a real BAD/GOOD from the diffs) | the relevant pattern skill |
| The same CI check fails the same way across multiple PRs (lint rule, type error, test class) | `## Sharpened triggers` (or `## Examples worth pinning`) | the pattern skill that owns that check — e.g. `pattern-engineer-python` for ruff/mypy, `pattern-engineer-typescript` for `tsc`, the relevant standard skill for a failing test class |
| The same shared file conflicts across multiple parallel slices (recurring hotspot, not a one-off) | `## New rules` / `## Sharpened triggers` | the pattern skill governing that file's structure — e.g. `pattern-engineer-frontend-standard` for a route-registry / barrel collision, `pattern-engineer-database` for a migration-chain collision |
| A class of **test-coverage gap** the engineer keeps authoring AND the reviewer keeps catching (an undriven branch, a missing off-by-one boundary, a pre-seeded single-use test, a coarse-proxy assertion) | `## Sharpened triggers` / `## New rules` | **`pattern-test-coverage`** — the shared catalogue. File it here, NOT on `pattern-reviewer-test-coverage`: this skill is loaded by *both* the engineer (TDD red phase) and the reviewer (gate), so the rule reaches the side that *makes* the miss, not only the side that catches it. |
| A reviewer-**reporting** habit that over-flags or mis-cites coverage in this project (a false-positive finding shape, a severity carve-out) | `## Project-specific carve-outs` | `pattern-reviewer-test-coverage` — the reviewer lens. Reporting carve-outs are reviewer-only and must not dilute the shared catalogue. |

Map by category to a concrete skill name (`pattern-engineer-python`, `pattern-reviewer-security`, `pattern-engineer-fastapi`, …). If a pattern does not map to any existing pattern skill, record it under a `## New rules` entry on the closest reviewer skill and note the gap in the log.

> **Filing-side discipline.** A coverage rule filed on a reviewer-only skill is read only by the catcher — the engineer keeps re-authoring the miss and the fix loop recurs every slice. Test-coverage *substance* belongs on `pattern-test-coverage` (both roles load it); only reviewer-*reporting* adjustments belong on `pattern-reviewer-test-coverage`. The same principle generalizes: when a rule's mistake is *made* by one agent but *caught* by another, file it on a skill the **maker** loads, not just the catcher.

**On conflicts specifically:** because slices are implemented in parallel, most merge conflicts are expected friction, not a mistake to learn from. Only promote a conflict to a rule when the *same file* is a repeat collision point — and frame the rule as a structural fix that removes the contention (e.g. "register routes via an auto-discovered directory instead of editing a central list", "append migrations rather than editing a shared head"). Never write a rule that just says "avoid conflicts".

### 5. Write the overlays

For each target skill with ≥ 1 improvement, merge into `$MEMORY_ROOT/patterns/<skill>.md`:

- If the file does not exist, scaffold it from `memory-convention`'s `templates/pattern-overlay.md`.
- If it exists, **merge** — append new bullets under the matching section; never clobber sections a human hand-edited.
- Each bullet states the rule plus, where the history supplies one, a fenced BAD/GOOD snippet pulled from an actual diff.
- Honor overlay precedence (`memory-convention`): additive only; an overlay may downgrade a baseline severity via a carve-out but never upgrade it. If a proposed rule would **directly contradict** a baseline rule (same situation, opposite verdict), do NOT write it — record the conflict in `dream-log.md` for a human to reconcile.

### 6. Append the audit entry and report

Append a new entry to `$MEMORY_ROOT/dream-log.md` using [`templates/dream-log-entry.md`](templates/dream-log-entry.md) (this heading's timestamp is the next run's cutoff source). Append at the **end** of the file so the newest heading is last — §2 reads the cutoff with `grep '^## ' | tail -1`.

Then print a concise summary to the user: issues + PRs consumed, overlays touched, rule count, conflict hotspots, and any overlay conflicts skipped. Terminal action. Exit.

## Iron rules

- **Pattern-wise only.** A single-instance bug never becomes memory. Only a recurring, generalizable class of mistake earns an overlay rule. When in doubt, drop it and log it under "Dropped as one-off".
- **Conflicts are parallelism friction, not mistakes — by default.** Slices are built in parallel, so merge conflicts are expected and most carry no lesson. Promote a conflict to a rule ONLY when the same file is a repeat collision point across slices, and frame it as a structural de-contention fix — never "avoid conflicts". Lone conflicts are dropped.
- **Reads GitHub, not telemetry.** The dreaming input is closed-issue review/fix history plus closed-PR CI-failure and merge-conflict history. Runtime telemetry (`signals/runtime/*`) is for ad-hoc operational analysis and is out of scope here.
- **Autonomous, but auditable.** Write overlays without prompting (so scheduled runs work), but every run appends a `dream-log.md` entry and prints a summary. The most recent `dream-log.md` heading is the *sole* cutoff — there is no fixed time window. Never re-derive the cutoff from filesystem mtimes or fall back to a rolling 24h once the log exists.
- **Additive overlays only; never override baseline.** Follow `memory-convention` precedence. A proposed rule that contradicts a baseline rule is logged as a conflict, not written.
- **Baseline pattern skills in this plugin are never edited.** All writes target `$MAIN_ROOT/.claude/memory/patterns/` in the consuming project. "The baseline is wrong" → note it in the log as an upstream-PR candidate; do not act on it here.
- **Merge, don't clobber.** Preserve hand-edited overlay sections; append under the matching section.
- **Fire-and-forget on errors.** A failure gathering one issue's or PR's history must not abort the whole pass — skip that item, note it in the log, continue.
