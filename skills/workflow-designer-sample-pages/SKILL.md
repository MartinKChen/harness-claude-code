---
name: workflow-designer-sample-pages
description: "Generate self-contained plain-HTML sample pages for a feature from the locked requirement and the design-lead interview results, using exactly one external design toolbox (`ui-ux-pro-max` or `taste-skill`). Duel scope (`samples`) writes candidate pages only; solo scope (`full`) also writes a design-system + token proposal. Output lands under `docs/design-system/sample-candidates/<designer-name>/` in the worktree; never commits. Activate on a dispatch opening with 'Generate sample pages for <feature-name>' or 'Generate design system and sample pages for <feature-name>'."
---

# workflow-designer-sample-pages

Turn a locked requirement plus the design-lead's interview results into browsable, self-contained plain-HTML sample pages a human can open from disk and judge. Run by a `designer` teammate dispatched from `/deep-dive-feature` after the design interview lands — either as one of two duelling designers (the human votes the winner) or as a solo designer (no vote).

This skill **never commits and never pushes** — it writes candidate files only, inside the designer's own directory under `docs/design-system/sample-candidates/`. Moving the winner into `docs/design-system/samples/` and committing is the `design-writer`'s job downstream.

## When to activate

Activate this skill whenever:

- The dispatch prompt opens with `Generate sample pages for <feature-name>` — **duel scope `samples`**: candidate pages only.
- The dispatch prompt opens with `Generate design system and sample pages for <feature-name>` — **solo scope `full`**: candidate pages plus a design-system + token proposal (`proposal.md`).

Do NOT activate when:

- The unit of work is the design interview itself (`workflow-design-interview` — `design-lead`'s lane).
- The unit of work is publishing `docs/design-system/*` artifacts or moving the winning samples (`workflow-writer-publish-design` — the writer's lane).
- The dispatch asks for production frontend code (the `engineer`'s lane).

## Inputs from the dispatch

- `<feature-name>` — resolves the requirement path.
- `{worktree_path}` — every read and write targets this directory.
- The **toolbox** — exactly one of `ui-ux-pro-max:ui-ux-pro-max` / `taste-skill:taste-skill` (fully-qualified, they live in separate plugins).
- Your **teammate name** (e.g. `designer-pro-max`, `designer-taste`) — names your output directory.
- The **scope** — `samples` (duel) or `full` (solo), implied by the trigger phrase.

## Workflow

### 1. Load the named toolbox

Load the single toolbox skill the dispatch names. If it is not installed/available, **HALT** and surface the missing plugin to whoever dispatched you — do not improvise a direction from your own taste (the no-toolbox fallback is `design-lead`'s, not yours).

### 2. Read the requirement

Read `docs/product-requirement-document/<feature-name>/requirement.md` in the worktree, plus the sibling critical-path and glossary files. Note the entities, flows, and user-visible labels — your pages use the product's real content, never lorem ipsum.

### 3. Pull the interview results from `design-lead`

Send `SendMessage(to=design-lead)` requesting the locked interview results: the visual-language decisions (brand/tone, color philosophy, typography, spatial rhythm, motion posture, platform priority, accessibility targets) and the surface + navigation inventory. Wait for the reply before designing — these are constraints your toolbox expresses within, not suggestions. Also read any existing `docs/design-system/` in the worktree; an extension honors the locked system.

### 4. Pick 1–3 representative surfaces

From the surface inventory and critical paths, pick the 1–3 surfaces most central to the requirement's critical path (typically the primary working surface, plus the app shell / nav context it sits in). A duel is judged on direction, not coverage — do not build every page.

### 5. Generate the sample pages

Write one self-contained `.html` file per sampled surface under:

```
{worktree_path}/docs/design-system/sample-candidates/<your-teammate-name>/
```

Hard constraints per file:

- Plain HTML with one inline `<style>` block — no build step, no framework, no external CSS file. A Google Fonts `<link>` is acceptable; the page must still be legible without it.
- Renders correctly opened directly via `file://`.
- Semantic elements and the accessibility floor from the interview (contrast, visible focus, tap-target minimum) — non-negotiable.
- At most a few lines of vanilla JS, only to demo an interaction state.
- If more than one page, add an `index.html` linking the set with a one-line note on what each page demonstrates.

Stay strictly inside your own directory — never touch another designer's candidates, the design-system docs, or production code.

### 6. Solo scope only: write the proposal

At scope `full`, also write `proposal.md` in the same directory: the design-system + token proposal your pages embody — style family, palette with concrete values, font pairing, type scale, spacing scale, radius / shadow / motion tokens, and a short rationale per group. This is input for `design-lead` to review with the user and fold into the `design-writer` payload; it is a proposal, not a published artifact.

### 7. Report and stop

Report back to whoever dispatched you: the absolute file paths written (so the human can open them in a browser) and a one-paragraph statement of the design direction (what the toolbox led you to and why it fits this product). Do **not** commit, push, tick any checklist, or message the user directly — the orchestrator surfaces the candidates and runs the vote.

## Best practices

- **One coherent direction per run.** Commit to a single direction rather than hedging across variants — the duel exists so the human compares two committed directions.
- **Real content is the demo.** Use the requirement's actual entities, labels, empty-state copy, and numbers; a sample page with fake content tests nothing.
- **Show state, not just layout.** Where the critical path implies it, include a filled state, an empty state, or a validation state — cheap in plain HTML, decisive in a vote.
- **Tokens visible in the source.** Express colors / spacing / type as CSS custom properties at the top of the `<style>` block, named like design tokens — it makes the winning direction trivially liftable into `tokens.md`.
