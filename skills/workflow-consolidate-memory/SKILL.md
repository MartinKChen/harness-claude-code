---
name: workflow-consolidate-memory
description: "Distill accumulated per-dispatch signal under `.claude/memory/signals/` into curated rule additions under `.claude/memory/patterns/<skill>.md` in the consuming project. Reads every signal row newer than the last entry in `.claude/memory/consolidation-log.md`, groups by `pattern_skill`, derives four kinds of candidate overlay edits (false-positive carve-outs from high reject rate, new rules from missed catches, sharpened triggers from repeated fixes, BAD/GOOD clarifications from high cycles-to-resolve), presents each edit as a diff for user approval, writes the approved overlays, appends the consolidation-log entry, and optionally archives consumed signals. Never edits baseline pattern skills in this plugin. Activate on '/workflow-consolidate-memory' or 'consolidate the memory for <skill-name>'."
---

# workflow-consolidate-memory

The only skill in the memory system with agent thinking. Signal capture (in workflow-engineer-fix-task, workflow-reviewer-review-task, etc.) is dumb append. Overlay loading (in pattern skills) is just a file read. This skill turns the dumb signal into curated overlay rules — and gates every change on the user's explicit confirmation.

It runs in the consuming project, on demand. It never edits the baseline pattern skills shipped by this plugin. It never sends anything upstream.

## When to activate

Activate this skill whenever:

- The user types `/workflow-consolidate-memory` or "consolidate the memory" / "consolidate memory for <pattern-skill-name>".
- The user runs `/loop /workflow-consolidate-memory` to evolve overlays autonomously on an interval.

Do NOT activate when:

- The consuming project has not opted in (`$MAIN_ROOT/.claude/memory/` does not exist) — halt and surface "no memory directory; opt in with `mkdir -p .claude/memory/{signals,patterns}`".
- The signal store has nothing new since the last consolidation — halt and surface "nothing to consolidate; signals are caught up".

## Workflow

### 1. Resolve memory root and verify opt-in

```bash
MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
MEMORY_ROOT="$MAIN_ROOT/.claude/memory"
```

If `$MEMORY_ROOT` does not exist, halt and surface the opt-in instruction. Do not create it.

### 2. Determine the consumption window

The cutoff is the most recent entry in `$MEMORY_ROOT/consolidation-log.md`. Each log entry's first line carries the ISO-8601 timestamp of when consolidation ran. Signal rows with `ts` strictly greater than the latest log timestamp are in scope.

If `consolidation-log.md` does not exist, every signal row is in scope (first-run consolidation).

### 3. Gather in-scope signals

Walk all four signal directories under `$MEMORY_ROOT/signals/`:

- `reviews/*.jsonl` — every finding emitted by a reviewer dispatch.
- `fixes/*.jsonl` — every engineer response to a finding.
- `missed/*.jsonl` — every downstream catch attributed to an earlier-stage miss.
- `cycles/*.json` — per-task time-to-green summaries (whole file in scope if its `ts` is newer).

Filter to rows / files newer than the cutoff. If no rows survive the filter, halt with "nothing to consolidate".

Group by `pattern_skill`. Any skill with zero in-scope rows is out of scope for this run.

If the user specified `<skill-name>` in the dispatch, further filter to that one skill.

### 4. Per `pattern_skill`, derive candidate overlay edits

Four candidate types, derived independently per skill:

**A. Project-specific carve-out candidates (from high reject rate)**

For each `(pattern_skill, category)` pair in `fixes/*.jsonl`, compute:

- `rejected` count among in-scope rows.
- `fixed` count among in-scope rows.
- `reject_ratio = rejected / (rejected + fixed + modified)`.

A pair is a carve-out candidate when `rejected ≥ 2` AND `reject_ratio ≥ 0.5`. Pull the `note` field from each `rejected` row — it explains the false-positive context. The carve-out's text comes from clustering those notes into one prose paragraph.

Output: a bulleted entry under the overlay's `## Project-specific carve-outs` section, naming the category and the context in which the baseline rule does NOT apply.

**B. New rule candidates (from missed catches)**

For each row in `missed/*.jsonl`, group by `(pattern_skill, category)`. A `(skill, category)` pair with `≥ 1` missed-catch row is a new-rule candidate. Pull `location` + `title` from each row — those are concrete instances the baseline did not flag.

Output: a bulleted entry under the overlay's `## New rules` section, with the rule statement, severity (default MEDIUM unless every missed catch was severity HIGH or above), and a BAD code snippet pulled from one of the cited `location`s if readable.

**C. Sharpened-trigger candidates (from repeated fixes)**

For each `(pattern_skill, category)` pair across ALL `fixes/*.jsonl` (not just in-scope — repeated-fix detection looks at lifetime), compute `fixed_count`. A pair with `fixed_count ≥ 3` AND with `≥ 1` in-scope `fixed` row is a sharpened-trigger candidate.

The signal here is: the engineer keeps making the same mistake. The overlay's job is to sharpen *when* the baseline rule fires so the agent internalizes it preemptively — typically by adding a project-specific code-shape pattern that should always trigger the rule.

Output: a bulleted entry under the overlay's `## Sharpened triggers` section, naming the category, the occurrence count, and the project-specific code shape that should always trigger the baseline rule.

**D. Clarification candidates (from high cycles-to-resolve)**

For each `pattern_skill` in `cycles/*.json`, compute the median `by_pattern.<skill>.cycles_to_resolve` across in-scope tasks. A skill with median `≥ 2` is a clarification candidate — findings from that skill take multiple cycles to land, which usually means the BAD / GOOD examples in the baseline are ambiguous in this project's idioms.

Output: a bulleted entry under the overlay's `## Examples worth pinning` section, asking the user for a real BAD / GOOD pair from this project's history that makes the rule unambiguous here. The agent does NOT invent the BAD / GOOD snippet — only flags the need.

### 5. Present each candidate as a diff for user approval

For each `pattern_skill` with candidates, compose the proposed overlay file:

- Read the existing `$MEMORY_ROOT/patterns/<pattern-skill-name>.md` if it exists; start from a blank scaffold per `memory-convention` if it does not.
- Insert each approved candidate into the matching section.
- Show the diff (added / changed lines only, with surrounding context).

For each individual candidate (not the whole file at once), ask the user: **accept / reject / edit**. On `edit`, accept the user's revised text. On `reject`, drop the candidate but record it in the consolidation log under "rejected" so it does not resurface next run unless new signal arrives.

This is the only blocking step in the workflow. Every other step is mechanical.

### 6. Write approved overlays

For each `pattern_skill` with ≥ 1 accepted candidate, write the merged overlay to `$MEMORY_ROOT/patterns/<pattern-skill-name>.md`. Create the `patterns/` directory if it does not exist.

If an overlay file already exists, **merge** — do not overwrite. Preserve hand-edited sections the user added manually. Conflict (overlay change contradicts a manually-edited section): surface the conflict, let the user reconcile.

### 7. Append a consolidation-log entry

Append to `$MEMORY_ROOT/consolidation-log.md`:

```markdown
## <ISO-8601 timestamp>

**Consumed:** <count> review rows, <count> fix rows, <count> missed rows, <count> cycles files
**Window:** <cutoff-ts> → <now-ts>
**Skill filter:** <skill-name or "all">

**Overlays touched:**
- `patterns/<skill>.md` — <N> candidates accepted, <N> rejected, <N> edited

**Accepted:**
- [<skill>] [<category>] <one-line summary of the change>
- ...

**Rejected:**
- [<skill>] [<category>] <one-line summary of why the user rejected>
- ...
```

The log is the source of truth for "what has consolidation already seen?" — the next run's cutoff comes from the most recent `## <ts>` heading.

### 8. Optionally archive consumed signals

Ask the user: **archive consumed signals?**

If yes, move every signal file whose entire contents are older than the cutoff into `$MEMORY_ROOT/signals/.archive/<YYYY-MM>/`. Files with partially in-scope rows stay in place (don't split files; let the next run skip the already-consumed rows by timestamp).

If no, leave signals in place — consolidation always uses the log's cutoff to scope its window, so accumulated history does not cause duplicate work.

Terminal action. Exit.

## Iron rules

- **The user confirms every overlay edit.** No silent rule writes, ever. The user reviews each candidate's diff and accepts / rejects / edits before the overlay file is written.
- **Overlay severity cannot exceed baseline severity.** An overlay can downgrade a baseline LOW finding to "not applicable in context X" via a carve-out; it cannot upgrade a baseline LOW to CRITICAL. That requires either a new rule (under `## New rules`) or sending the rule upstream to the plugin.
- **Baseline pattern skills in this plugin are never edited.** All writes target `$MEMORY_ROOT/patterns/` in the consuming project. Anything that feels like "the baseline is wrong, fix the baseline" is out of scope here — surface that to the user as "consider opening a PR upstream", do not act on it.
- **Overlay-vs-baseline conflicts must be surfaced, not reconciled.** If the agent's candidate would directly contradict a baseline rule (same situation, opposite verdict), do not propose the overlay edit. Instead, raise the conflict to the user with both rules quoted, and let them decide whether to carve out, downgrade, or escalate upstream.
- **`consolidation-log.md` is the cutoff source.** Never re-derive the window from filesystem mtimes or from the signals themselves — the log's most recent `## <ts>` heading is canonical.
- **Repeated-fix detection is lifetime, not in-scope.** Carve-outs and new rules use only in-scope signal; sharpened triggers look across all-time fixes because the threshold (≥ 3) is about cumulative pattern, not recency.
- **Archive only with user confirmation.** Signals are cheap to keep; losing them is irreversible. Default to "no archive" if the user does not respond.
- **This skill is the only signal *interpreter*.** Workflow skills append rows; pattern skills read overlays; this skill is the bridge. Do not push interpretation logic into the capture or load steps — keep them dumb.
