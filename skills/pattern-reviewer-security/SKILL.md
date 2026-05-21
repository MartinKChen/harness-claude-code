---
name: pattern-reviewer-security
description: "Security review patterns for a diff + freshly built image — iterates the `security-patterns` catalogue one pattern at a time across backend / frontend / dependencies / image, never test files. Each finding cites `file:line` or `image:<tag>`, quotes the catalogue's exact bar as `Required end state`, includes evidence + fix, uses a non-numeric handle (never `#N`). Comment shape in `templates/review-comment.md` under `# Security Review` with a per-image CVE table. Skip for `type:e2e`."
---

# pattern-reviewer-security

Encodes the canonical patterns for security-reviewing a scoped diff plus a freshly built container image. This skill describes **what to validate and how to format the finding**. Driving the review (fetch issue, build the image, scope commits, post the comment, flip the gate, remove the built image) belongs to the dispatched caller (the `reviewer` agent). Computing the overall verdict (APPROVE / BLOCK) also lives with the agent.

The pattern *catalogue* (CVE policy, secrets handling, input validation, parameterized queries, cookie flags, auth-before-action, CSP, CSRF, rate limits, log redaction, lock-file hygiene) lives in `security-patterns` — this skill iterates it, never improvises additional patterns, and never redefines a pattern's bar.

## When to activate

- The dispatched caller is security-reviewing a `type:backend` or `type:frontend` task's diff + built image.
- A user says "security-review this PR", "audit secrets / cookies / SQL injection / CSP / rate limits", "scan the image for CVEs".
- Do NOT activate for `type:e2e` — test code skips the security gate by design (fixtures contain placeholder secrets; flagging them is noise).

## References

| Reference | When to read |
|-----------|--------------|
| `templates/review-comment.md` | Always read before composing the comment body. The finding rows + the per-image CVE table must match this shape verbatim so downstream skills (`workflow-engineer-fix-task`) can parse them. |

| Skill | Why it's required |
|-------|-------------------|
| `security-patterns` | The catalogue of *what* to check and each pattern's exact bar. This skill iterates that catalogue; the catalogue defines the `Required end state` quoted on every finding. |

## Iron rules for every finding

These govern *how* a finding is formed and reported. Severity choice, citation, and the `Required end state` quotation are non-negotiable — the engineer's fix flow depends on them.

- **`security-patterns` is the source of truth.** Follow its patterns in order. Do not improvise additional patterns. Do not skip patterns. Do not redefine what "fail" means — if a pattern's bar shifts, update `security-patterns`, not this skill.
- **One pattern at a time.** Validate a single pattern fully — across backend, frontend, infra, and the built image where applicable — before moving to the next. Interleaving patterns produces missed findings and unstructured reports.
- **Evidence over intuition.** Every finding must cite `path/to/file.ext:line` (or `image:<tag>` + scanner output) plus the offending snippet or command output. "Looks risky" / "probably exposes" is not a finding.
- **Severity follows the catalogue's CVE policy.** CRITICAL / HIGH / MEDIUM = always reported. LOW = reported with counts; flagged as actionable findings only when the catalogue prescribes a fix or the fix is trivial. Never inflate or deflate.
- **`Required end state` quotes the catalogue verbatim.** Every finding includes a `**Required end state:**` line that quotes the exact bar from `security-patterns` (e.g. "session cookie must be `HttpOnly; Secure; SameSite=Strict`", "image CRITICAL/HIGH count must be 0"). The engineer's fix flow fixes to the quoted bar, not to a paraphrase.
- **Never refer to a finding as `#N` (N a number).** GitHub auto-links `#1`, `#2`, … to issues. Use a non-numeric handle: the pattern name (`secrets-handling`, `image-cve`, `parameterized-queries`), the quoted finding title, or `F1` / `F2` / `Finding 1` / `Finding 2`.
- **Test code is out of scope.** Skip every file that belongs to the test surface — `backend/tests/`, `frontend/src/**/__tests__/`, `e2e/`, `test_*.py`, `*_test.py`, `conftest.py`, `*.test.ts`, `*.test.tsx`, `*.spec.ts`, `*.spec.tsx`, Playwright / Vitest / pytest fixtures and helpers, test-only Docker Compose overrides. Test fixtures intentionally contain placeholder secrets — flagging them produces noise. When restricting checks to changed files, exclude these paths up front:

  ```bash
  git diff --name-only <base>...HEAD -- . \
    ':(exclude)backend/tests' \
    ':(exclude)e2e' \
    ':(exclude)**/__tests__/**' \
    ':(exclude)**/*.test.*' \
    ':(exclude)**/*.spec.*' \
    ':(exclude)**/conftest.py' \
    ':(exclude)**/test_*.py' \
    ':(exclude)**/*_test.py'
  ```

  Narrow exception: a *non-test* file importing from a test file (a structural bug) is reported against the non-test file, not the test file.
- **No false positives.** If a snippet looks like a hardcoded secret but is a fixture, test placeholder, or doc example, mark it as such — do not waste engineer cycles. Confidence over volume.
- **Read surrounding code, not just the diff.** Open the full file, follow imports, check call sites.
- **Project context translates the catalogue's examples.** The catalogue's snippets are generic; translate them to the project's actual stack (FastAPI + SQLAlchemy + Postgres / React + Vite / server-set httpOnly cookies / `slowapi` rate limits / `structlog` redaction — whatever `CLAUDE.md` and the ADRs declare). A finding cited against a generic example but inapplicable to this stack is a false positive.
- **Never suggest destructive actions.** If a fix would require `git reset --hard`, `--no-verify`, or rewriting published history, surface the underlying problem and let the caller decide.

## Patterns to validate

Iterate every pattern in `security-patterns` in order. For each pattern:

1. Identify which surfaces the pattern covers (backend code, frontend code, dependency manifests, infra/compose, the built image).
2. Restrict file-scoped patterns to the touched-path set the dispatching agent provides; apply the test-code exclusion list. Dependency and image patterns target the whole tree regardless.
3. Quote the pattern's exact bar from `security-patterns` — that string becomes the finding's `**Required end state:**`.

For the **image-CVE pattern** specifically, run the scanner against the slug-tagged image(s) the agent built — never against `:latest` or a base image. Capture per-image counts at every severity band so the per-image CVE-count table can be filled in:

```bash
trivy image --severity CRITICAL,HIGH,MEDIUM --exit-code 0 "${image_tag}"
trivy image --severity LOW                  --exit-code 0 "${image_tag}"
```

Collect findings as `{pattern, severity, location (file:line OR image:<tag>), evidence (snippet OR scanner output), required_end_state (quoted from the catalogue), fix}` records. Pass results don't appear in the comment — only counts and findings do.

## Constructing the finding

Every finding emitted by this skill matches this shape (the template under `templates/review-comment.md` shows the full comment wrapper the agent will compose around it):

```markdown
### [SEVERITY] <pattern-name> — <one-line title — no leading `#N`>
**Location:** `path/to/file.ext:42`   (or `image: <repo>:<slug>`)
**Required end state:** <quote the `security-patterns` bar verbatim>
**Evidence:**

```<lang>
<offending snippet, or scanner output for image findings>
```

**Fix:**

```<lang>
<corrected snippet, or remediation step — e.g., "bump base image alpine:3.18 → 3.20">
```
```

- `[SEVERITY]` is exactly one of `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, per the catalogue's CVE / pattern bar.
- `<pattern-name>` is the catalogue's slug for the pattern (`secrets-handling`, `image-cve`, `parameterized-queries`, …).
- The title is non-numeric; cross-references use the pattern name, quoted title, or `F1` / `F2`.
- For LOW image-CVE findings the fix may collapse to a one-line remediation (e.g., "bump base image"); the per-image CVE-count table in the template still carries the counts.

Hand the collected list of findings (plus the per-image CVE counts) back to the dispatching `reviewer` agent — it owns the comment composition, severity-count summary, per-image CVE-count table, verdict line, scope note, `Left unfixed (LOW only)` line, and posting.
