---
name: pattern-reviewer-code-quality
description: "Code-quality review patterns for a `type:backend`/`type:frontend` diff: Security (CRITICAL), Code Quality (HIGH), React/Next.js (HIGH, frontend), Node.js/Backend (HIGH, backend), Performance (MEDIUM), Best Practices (LOW), AI-generated-code addendum. Each finding is >80% confidence-filtered, severity-graded, cited as `file:line` with BAD/GOOD snippets, named with a non-numeric handle (never `#N`). Comment shape in `templates/review-comment.md` under `# Code Review`. Skip for `type:e2e`."
---

# pattern-reviewer-code-quality

Encodes the canonical patterns for reviewing production-code quality on a scoped diff — security, framework conventions, performance, and code hygiene. This skill describes **what to flag and how to format the finding**. Driving the review (fetch issue, set up worktree, scope commits, post the comment, flip the gate) belongs to the dispatched caller (the `reviewer` agent). Computing the overall verdict (APPROVE / BLOCK) also lives with the agent.

Test-coverage review (AC / scenario / edge-case coverage) lives in `pattern-reviewer-test-coverage`. Security-only review (the `security-patterns` catalogue) lives in `pattern-reviewer-security`. This skill does not duplicate either.

## When to activate

- The dispatched caller is reviewing a `type:backend` or `type:frontend` task's production-code diff.
- A user says "review this diff for quality", "look for bugs in this code", "audit the change".
- Do NOT activate for `type:e2e` test code (the implementation here *is* the test — use `pattern-reviewer-test-coverage` for coverage and skip code-quality patterns entirely).

## References

| Reference | When to read |
|-----------|--------------|
| `templates/review-comment.md` | Always read before composing the comment body. The finding rows must match this shape verbatim so downstream skills (`workflow-engineer-fix-task`) can parse them. |

## Iron rules for every finding

These govern *how* a finding is formed and reported. Severity choice and citation style are non-negotiable — the engineer's fix flow depends on them.

- **>80% confidence filter.** Report a finding only when you are >80% confident it is real. Skip stylistic preferences unless they violate a documented project convention. Skip issues in unchanged code unless they are CRITICAL security. Consolidate similar findings ("5 functions missing error handling") into one entry.
- **Cite `path/to/file.ext:line` for every finding.** "Looks risky" is not a finding. Quote the offending snippet in a fenced BAD block; show the fix in a fenced GOOD block (or a one-sentence fix when a snippet is overkill).
- **Read surrounding code, not just the diff.** Open the full file, follow imports, check call sites. If you cannot understand the change without more context, say so rather than guessing.
- **Severity is load-bearing.** CRITICAL and HIGH block the gate; MEDIUM and LOW are reported but informational. Never inflate severity to draw attention; never deflate it to avoid friction. Use the per-pattern severity assigned below.
- **Never refer to a finding as `#N` (N a number).** GitHub auto-links `#1`, `#2`, … to issues. Use a non-numeric handle: the quoted finding title (e.g., 'see "Missing auth check on /admin"'), or `F1` / `F2` / `Finding 1` / `Finding 2`.
- **Match project conventions.** Read `CLAUDE.md` and every ADR in `docs/ADRs/`. A diff that contradicts an active ADR is a finding, not a stylistic call. Promote the ADR's hard limits (file size, naming, immutability, error classes, RLS, migration patterns) into CRITICAL / HIGH bars for this review.
- **AI-generated code gets a sharper lens.** Prioritize behavioral regressions, edge-case handling, hidden coupling / architecture drift, trust-boundary assumptions, and cost-inducing complexity.
- **Never suggest destructive actions.** If a fix would require `git reset --hard`, `--no-verify`, or rewriting published history, surface the underlying problem and let the caller decide — do not prescribe the destructive shortcut.

## Patterns to review

Walk the patterns in order. Apply the >80% confidence filter as you go. Consolidate duplicates. Collect findings as `{title, severity, file:line, evidence (BAD), fix (GOOD)}` records — the agent composes the final comment.

### Security (CRITICAL)

Flag any of:

- **Hardcoded credentials** — API keys, passwords, tokens, connection strings in source.
- **SQL injection** — string concatenation in queries instead of parameterized queries.
- **XSS** — unescaped user input rendered in HTML/JSX.
- **Path traversal** — user-controlled file paths without sanitization.
- **CSRF** — state-changing endpoints without CSRF protection (when cookie-authed).
- **Auth bypass** — missing auth checks on protected routes.
- **Insecure dependencies** — known-vulnerable packages.
- **Secrets in logs** — logging tokens, passwords, PII.

```typescript
// BAD: SQL injection via string concatenation
const query = `SELECT * FROM users WHERE id = ${userId}`;

// GOOD: parameterized query
const query = `SELECT * FROM users WHERE id = $1`;
const result = await db.query(query, [userId]);
```

```tsx
// BAD: rendering raw user HTML without sanitization
<div dangerouslySetInnerHTML={{ __html: userComment }} />

// GOOD: text content (or sanitize with DOMPurify if HTML is required)
<div>{userComment}</div>
```

For depth on a security pattern's exact bar (CVE policy, cookie flags, CSP, rate limits, log redaction), defer to `security-patterns` — the catalogue is authoritative. If the project's `security-patterns` is invoked, do not duplicate its findings here.

### Code Quality (HIGH)

- **Large functions** (>50 lines) — split into smaller, focused units.
- **Large files** (>800 lines) — extract modules by responsibility.
- **Deep nesting** (>4 levels) — early returns, extract helpers.
- **Missing error handling** — unhandled rejections, empty catch blocks.
- **Mutation patterns** — prefer immutable ops (spread, map, filter).
- **`console.log` left behind** — remove debug logging before merge.
- **Dead code** — commented-out code, unused imports, unreachable branches.

```typescript
// BAD: deep nesting + mutation
function processUsers(users) {
  if (users) {
    for (const user of users) {
      if (user.active) {
        if (user.email) {
          user.verified = true;
          results.push(user);
        }
      }
    }
  }
  return results;
}

// GOOD: early returns + immutability + flat
function processUsers(users) {
  if (!users) return [];
  return users
    .filter(user => user.active && user.email)
    .map(user => ({ ...user, verified: true }));
}
```

### React/Next.js Patterns (HIGH) — frontend only

- **Missing dependency arrays** — `useEffect`/`useMemo`/`useCallback` with incomplete deps.
- **State updates in render** — calling `setState` during render causes infinite loops.
- **Missing keys in lists** — array index as key when items can reorder.
- **Prop drilling** — props passed through 3+ levels (use context or composition).
- **Unnecessary re-renders** — missing memoization for expensive computations.
- **Client/server boundary** — `useState`/`useEffect` in Server Components.
- **Missing loading/error states** — data fetching without fallback UI.
- **Stale closures** — handlers capturing stale state values.

```tsx
// BAD: missing dependency, stale closure
useEffect(() => {
  fetchData(userId);
}, []); // userId missing from deps

// GOOD: complete dependencies
useEffect(() => {
  fetchData(userId);
}, [userId]);
```

```tsx
// BAD: index as key with reorderable list
{items.map((item, i) => <ListItem key={i} item={item} />)}

// GOOD: stable unique key
{items.map(item => <ListItem key={item.id} item={item} />)}
```

### Node.js/Backend Patterns (HIGH) — backend only

- **Unvalidated input** — request body/params used without schema validation.
- **Missing rate limiting** — public endpoints without throttling.
- **Unbounded queries** — `SELECT *` or queries without `LIMIT` on user-facing endpoints.
- **N+1 queries** — fetching related data in a loop instead of join/batch.
- **Missing timeouts** — external HTTP calls without timeout.
- **Error message leakage** — internal error details sent to clients.
- **Missing CORS configuration** — APIs accessible from unintended origins.

```typescript
// BAD: N+1
const users = await db.query('SELECT * FROM users');
for (const user of users) {
  user.posts = await db.query('SELECT * FROM posts WHERE user_id = $1', [user.id]);
}

// GOOD: single query with JOIN/aggregation
const usersWithPosts = await db.query(`
  SELECT u.*, json_agg(p.*) as posts
  FROM users u
  LEFT JOIN posts p ON p.user_id = u.id
  GROUP BY u.id
`);
```

### Performance (MEDIUM)

- **Inefficient algorithms** — O(n²) when O(n log n) or O(n) is possible.
- **Unnecessary re-renders** — missing `React.memo` / `useMemo` / `useCallback` on hot paths.
- **Large bundle imports** — importing entire libraries when tree-shakeable alternatives exist.
- **Missing caching** — repeated expensive computations without memoization.
- **Unoptimized images** — large images without compression or lazy loading.
- **Synchronous I/O** — blocking ops in async contexts.

### Best Practices (LOW)

- **TODO/FIXME without tickets** — TODOs should reference issue numbers.
- **Missing JSDoc on public APIs** — exported functions undocumented.
- **Poor naming** — single-letter vars (`x`, `tmp`, `data`) in non-trivial contexts.
- **Magic numbers** — unexplained numeric constants.
- **Inconsistent formatting** — mixed semicolons, quote styles, indentation.

### AI-generated code addendum

When reviewing AI-authored changes, prioritize:

1. Behavioral regressions and edge-case handling.
2. Security assumptions and trust boundaries.
3. Hidden coupling or accidental architecture drift.
4. Unnecessary model-cost-inducing complexity.

Cost-awareness check:

- Flag workflows that escalate to higher-cost models without a clear reasoning need.
- Recommend defaulting to lower-cost tiers for deterministic refactors.

## Constructing the finding

Every finding emitted by this skill matches this shape (the template under `templates/review-comment.md` shows the full comment wrapper the agent will compose around it):

```markdown
### [SEVERITY] <one-line title — no leading `#N`>
**File:** `path/to/file.ext:42`
**Issue:** <what is wrong and why it matters, one or two sentences>
**Fix:** <concrete corrective action>

```<lang>
// BAD
<offending snippet>
```

```<lang>
// GOOD
<corrected snippet>
```
```

- `[SEVERITY]` is exactly one of `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, per the pattern's bar above.
- The title is non-numeric — if you cross-reference another finding in the same comment, quote its title or use `F1` / `F2`.
- For LOW findings the BAD/GOOD snippet block is optional when a one-line `**Fix:**` is enough.

Hand the collected list of findings back to the dispatching `reviewer` agent — it owns the comment composition, severity-count summary table, verdict line, scope note, and posting.
