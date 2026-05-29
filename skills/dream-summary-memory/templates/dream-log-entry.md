## <ISO-8601 timestamp>

**Window:** <cutoff-ts> → <now-ts>
**Issues consumed:** #<n>, #<m>, … (<count> total)
**PRs consumed:** #<p>, #<q>, … (<count> total)

**Overlays touched:**
- `patterns/<skill>.md` — <N> rules added (<sharpened|carve-out|new-rule|example> × …)

**Patterns captured:**
- [<skill>] [<category>] <one-line summary of the rule>
- ...

**Conflict hotspots noted:**
- `<path>` — conflicted across slices #<a>, #<b>, … → <structural fix proposed, or "watch, not yet pattern-wise">

**Overlay conflicts skipped (need human reconciliation):**
- [<skill>] [<category>] <baseline says X, history suggests Y>

**Dropped as one-off (not pattern-wise):**
- #<n>/PR #<p> <one-line> — instance-specific (or a lone merge conflict), not generalized
