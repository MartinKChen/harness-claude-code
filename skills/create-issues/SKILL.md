---
name: create-issues
description: "Decompose a requirement, enhancement description, or PRD into thin vertical-slice GitHub issues. Activate when the user asks to create issues, turn a PRD into issues, slice work into tickets, generate issues from a feature spec, or break down a requirement into GitHub issues. Triggers on verbs like create, generate, scaffold, draft, slice, break down, decompose paired with nouns like issue, ticket, slice, work item, backlog. Triggers on phrases like 'create issues for X', 'turn this PRD into issues', 'break this down into tickets', 'create issues based on docs/PRDs/<feature-name>', 'slice this requirement', 'open issues for the <feature-name> feature'. Also activates when a `docs/PRDs/<feature-name>/requirement.md` or `docs/PRDs/<feature-name>/implement-detail.md` path is referenced as the source. Produces one GitHub issue per vertical slice via `gh issue create`, with EARS + Gherkin acceptance criteria, RFC 2119 keywords, blocker links, and a parent link to the PRD PR."
---

# create-issues

Turn a feature/enhancement context into a set of release-safe **vertical slice** GitHub issues. The context is either a free-form requirement description or a `<feature-name>` that points at `docs/PRDs/<feature-name>/`. The skill decomposes the work, quizzes the user for explicit approval, then creates one `gh` issue per slice with EARS + Gherkin acceptance criteria.

## When to activate

Activate this skill whenever the user:

- Asks to "create issues", "open issues", "scaffold tickets", or "generate the backlog" for a feature or requirement.
- Hands over a `<feature-name>` and asks for issues — interpret as "read the PRD under `docs/PRDs/<feature-name>/` and slice it".
- Hands over a free-form requirement / enhancement description and asks for issues.
- References `docs/PRDs/<feature-name>/requirement.md` or `docs/PRDs/<feature-name>/implement-detail.md` as the source for ticket creation.
- Asks to "break this down into vertical slices" or "slice this work into tracer bullets".

Do NOT activate when the user is asking for a single one-off issue with no decomposition needed (just use `gh issue create` via `git-workflow`), when they want to update an existing issue, or when they are asking for a roadmap/PRD instead of issues.

## Sub-skill routing

| Sub-skill | When to route to it |
|-----------|---------------------|
| `git-workflow` | All `gh` invocations (issue create, blocker linking, parent linking) — defer to it for the canonical command shape, label conventions, and any auth / repo-detection concerns. |

## Workflow

### 1. Analyze the context

- If the user supplied a free-form requirement/enhancement description, treat that text as the source.
- If the user supplied a `<feature-name>`, read both:
  - `docs/PRDs/<feature-name>/requirement.md`
  - `docs/PRDs/<feature-name>/implement-detail.md`
  Both files together are the source. If either is missing, surface that and ask the user how to proceed before slicing.
- Also scan the repo for a domain glossary (e.g. `docs/glossary.md`, `GLOSSARY.md`) and any ADRs under `docs/adr/` that touch the affected areas. Slice titles and issue bodies MUST use glossary vocabulary and respect ADR decisions.
- Note any user stories present in the source — they will be carried into the slice breakdown.

### 2. Draft the slice breakdown

Decompose the source into thin vertical slices following these rules:

<vertical-slice-rules>
- Each slice delivers a narrow but COMPLETE path through every layer (schema, API, UI, tests).
- A completed slice is demoable or verifiable on its own.
- Prefer many thin slices over few thick ones.
- Each slice must be release-safe: merging it on its own does not break the product.
</vertical-slice-rules>

For each slice, decide:

- **Title** — short, descriptive, uses glossary vocabulary.
- **Blocked by** — which slices (if any) must complete first. Most slices should have ≤1 blocker; a long blocker chain usually means the slices are too thick.
- **User stories covered** — which user stories from the source this addresses, if the source has them. Omit if the source has no user stories.

### 3. Quiz the user

Present the breakdown as a numbered list. For each slice show: **Title**, **Type**, **Blocked by**, **User stories covered**.

Then ask the user explicitly:

- Does the granularity feel right? (too coarse / too fine)
- Are the dependency relationships correct?
- Should any slices be merged or split further?

Iterate. Re-present the updated breakdown each round. Do not move on until the user gives an explicit approval ("looks good", "ship it", "approved", etc.). Soft acknowledgments ("ok", "sure") don't count — confirm.

### 4. Create the issues

Once approved, create one issue per slice via `gh issue create` (defer to the `git-workflow` skill for the canonical invocation and labels). For each issue:

- Title uses glossary vocabulary.
- Body follows the [Issue body template](#template).
- Acceptance criteria use **EARS notation**, with non-trivial criteria expanded into 1+ **Gherkin** scenarios. RFC 2119 keywords (MUST, SHALL, SHOULD, MAY, MUST NOT, SHOULD NOT) appear in UPPERCASE in `Then` / `And` outcome lines. `Given` / `When` lines state facts and do not need RFC 2119 keywords.

After creation, do two passes:

1. **Update blockers.** Blocker references can only be filled in once every slice has a real issue number. Walk the created issues and edit each to link its blockers (e.g. `Blocked by #123`) using `gh` (route via `git-workflow` for the exact command).
2. **Update parent.** Set each issue's parent to the PR where the PRD was created (the user will provide the PR number, or it can be inferred from the PRD branch's open PR). Use the GitHub sub-issue / parent linking mechanism via `gh`.

Report the created issue numbers/URLs back to the user as a final summary.

## Pattern

### Vertical slices, not horizontal layers

Bad — horizontal split, none of these is independently shippable:

```
#1 Build the schema for <feature>
#2 Build the API for <feature>
#3 Build the UI for <feature>
#4 Write the tests for <feature>
```

Good — vertical tracer bullets, each merge leaves the product working:

```
#1 Show empty <feature> page behind a flag (schema stub + API stub + UI shell + smoke test)
#2 Persist a single <entity> end-to-end (schema column + POST endpoint + form + integration test)
#3 List <entities> with pagination (read endpoint + list view + e2e test)
```

### Iron rules

- **One GitHub issue per slice.** Issues are created with `gh issue create`. Title is short, descriptive, and uses glossary vocabulary.
- **Vertical slices only.** Each issue is a tracer bullet that cuts through every integration layer (schema, API, UI, tests) end-to-end. No horizontal "build the schema" / "build the API" splits.
- **Release safe.** Each merged slice must leave the product in a working state. If a slice can't be merged independently without breaking the product, it's wrong — re-slice it (feature flags, no-op stubs, dark-launch, etc.).
- **Use the project's vocabulary.** Issue titles and descriptions must use terms from the project's domain glossary (if present). Respect ADRs in any area you touch.
- **Quiz before locking.** Never create issues until the user explicitly approves the breakdown.
- **EARS + Gherkin for acceptance criteria.** Each criterion uses EARS notation. Non-trivial criteria add 1+ Gherkin scenarios with `Given` / `When` / `Then` steps. RFC 2119 keywords (MUST, SHALL, SHOULD, MAY, MUST NOT, SHOULD NOT) MUST appear in UPPERCASE in `Then` / `And` outcome lines. `Given` / `When` lines state facts and do not need RFC 2119 keywords.

### EARS notation cheat sheet

| Pattern | Form |
|---------|------|
| Ubiquitous | The `<system>` SHALL `<response>`. |
| Event-driven | WHEN `<trigger>`, the `<system>` SHALL `<response>`. |
| State-driven | WHILE `<state>`, the `<system>` SHALL `<response>`. |
| Unwanted behavior | IF `<condition>`, THEN the `<system>` SHALL `<response>`. |
| Optional feature | WHERE `<feature is included>`, the `<system>` SHALL `<response>`. |

## Template

### Slice breakdown (presented to user during step 3)

```markdown
## Proposed slice breakdown for <feature-name>

1. **<Slice title>**
   - Type: <feature | enhancement | chore>
   - Blocked by: <none | slice #N>
   - User stories covered: <story id(s) or "—">

2. **<Slice title>**
   - Type: ...
   - Blocked by: ...
   - User stories covered: ...

(…)

Does the granularity feel right? Are dependencies correct? Should any slices be merged or split? Reply with explicit approval ("approved" / "ship it") to lock.
```

### Issue body (used in step 4)

````markdown
## Context
<1–3 sentence summary tying this slice to the source requirement / PRD. Use glossary vocabulary.>

## User stories covered
- <story id / quoted line> — <short paraphrase>
<!-- omit this section entirely if the source has no user stories -->

## Scope
**In scope**
- <bullet>
- <bullet>

**Out of scope**
- <bullet>

## Acceptance criteria (EARS)
- AC1 — The `<system>` SHALL `<response>`.
- AC2 — WHEN `<trigger>`, the `<system>` SHALL `<response>`.
- AC3 — IF `<condition>`, THEN the `<system>` SHALL `<response>`.

### Scenarios (Gherkin)
```gherkin
Scenario: <name tied to AC2>
  Given <fact>
  And <fact>
  When <trigger>
  Then the <system> MUST <response>
  And it SHOULD <secondary response>
```

## Dependencies
- Blocked by: #<issue> <!-- filled in during the post-creation blocker pass -->
- Parent: #<PRD PR number> <!-- filled in during the post-creation parent pass -->

## Notes
<Any relevant ADRs, glossary terms, feature-flag names, or rollout caveats.>
````
