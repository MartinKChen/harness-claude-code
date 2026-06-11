---
name: workflow-writer-publish-design
description: "Materialize and commit every artifact for an approved design system: `docs/design-system/{overview,tokens,components,accessibility}.md`, the surface + navigation inventory at `docs/design-system/surfaces.md`, the per-surface UI interaction contracts at `docs/ui-contract/*.yaml`, the optional `## Design taste` section of `CLAUDE.md`, plus — when the dispatch names a sample-page winner — moving the winning designer's plain-HTML candidates into `docs/design-system/samples/` and deleting `sample-candidates/`. Commits on the current branch; no PR. Activate on '/workflow-writer-publish-design'."
---

# workflow-writer-publish-design

Materialize every output of an approved design discovery interview and commit them on the current branch. Owns: the design-system overview, tokens, component patterns, accessibility posture, the **surface + navigation inventory** (`surfaces.md`), the optional `CLAUDE.md` `## Design taste` section, and the inline commit on the current branch.

This skill **assumes the design system is already locked and approved** with the user via a prior `design-lead` discovery interview (or an equivalent explicit lock-in). It does not run a discovery interview, does not push, and does not open a PR.

## When to activate

Activate this skill whenever:

- The dispatch prompt opens with `Publish design system for <feature-name>` and the conversation history (or referenced interview notes) already carries a locked, approved design-system decision set plus a surface + navigation inventory.
- The user has explicitly approved a locked design system in this conversation and asks to write it out.
- The user types `/workflow-writer-publish-design`, or phrases like 'generate the design-system docs', 'write the design artifacts', 'commit the design system we just locked'.

Do NOT activate when:

- The design system is not yet locked — stop and surface that the `design-lead` interview must run first; do not begin generating artifacts from a half-formed design.
- The user wants to revisit a decision — stop and surface that the design itself needs to change first.
- The unit of work is product framing (PRD, critical path, glossary) or technical architecture (ADRs, data model, API contracts) — different lanes.
- The user asks to open a PR — that is the orchestrator's job. This skill commits only.

## Workflow

Inputs from the dispatching orchestrator: a `<feature-name>` (kebab-case), the **trigger phrase** (`Publish design system for <feature-name>`), the **working directory** of the worktree on the feature branch, and — when the sample-page phase ran — the **winner's candidate directory** (`docs/design-system/sample-candidates/<winner-name>/`, voted by the human). The substantive content (locked visual language, the surface + navigation inventory, optional `CLAUDE.md` design-taste update) is **not** in the dispatch prompt — you pull it from `design-lead` in step 1.

Everything else (an existing `docs/design-system/` that may need editing in place, current `CLAUDE.md` shape) you read from disk.

### 1. Request artifact-publishing info from `design-lead`

The `design-lead` agent ran the discovery interview and composed the full artifact-publishing payload in the final step of `workflow-design-interview`. It is waiting on the team for your request — it will not send the payload unsolicited.

Send a `SendMessage(to=design-lead)` with:

- An identifying line stating you are the writer dispatched to publish the design-system artifacts (name yourself, e.g. `design-writer`).
- The `<feature-name>` and your `<worktree_path>` so `design-lead` can resolve any `{worktree_path}` placeholder in its composed prompt.
- An explicit ask for the artifact-publishing info: the locked visual language (taste prose, color philosophy, typography, spatial rhythm, motion, platform priority — enough to fill `overview.md`; the full token set for `tokens.md`; component patterns + states for `components.md`; accessibility targets for `accessibility.md`), the **surface + navigation inventory** (full per-surface table + global nav model) for `surfaces.md` with its `extend` / `brand new` classification, the **per-surface UI interaction contract skeletons** (regions + primary role/accessible-name actions + accessibility baseline, one per surface and reused component) for `docs/ui-contract/*.yaml`, and whether the `CLAUDE.md` `## Design taste` section warrants creation/update (and if so, the proposed wording).

Wait for `design-lead`'s reply. If `design-lead` does not respond, or responds with anything other than the structured artifact-publishing payload, STOP and surface the gap — do not improvise content (especially do not invent token values, fabricate a surface inventory, or invent UI-contract actions for a surface). If a piece of context is unclear once the payload arrives, send a follow-up `SendMessage(to=design-lead)` for clarification before generating artifacts.

### 2. Generate artifacts

Write or update each of the following under `docs/design-system/`. Create the directory if it does not exist. Read each template from this skill's `templates/` directory (see the **Templates** section below). Replace every `<…>` placeholder with content from the locked design; delete sections that genuinely don't apply rather than leaving them blank.

- `docs/design-system/overview.md` — from `templates/overview.md`. The taste prose, color philosophy, typography character, spatial rhythm, motion philosophy, interaction principles, and platform priority.
- `docs/design-system/tokens.md` — from `templates/tokens.md`. **Every** color, font, spacing, radius, shadow, motion, and breakpoint token, each with its `category/role/step` name and concrete value. This file is the source `scaffold-project` compiles into `frontend/src/styles/tokens.css` and `tailwind.config` mirrors — no token may be missing.
- `docs/design-system/components.md` — from `templates/components.md`. The recurring component patterns and their states, including the **Navigation** pattern (the app-shell nav container).
- `docs/design-system/accessibility.md` — from `templates/accessibility.md`. The locked contrast / focus / target / motion / semantics commitments.
- `docs/design-system/surfaces.md` — from `templates/surfaces.md`. **The linchpin.** Every routed surface with its kind, entry source(s), global-nav membership, and auth posture, plus the global navigation model. Enforce the reachability rules: no surface may have an empty entry-source cell. If the payload classifies the system as **extend** (an existing `surfaces.md` is present), edit it in place — append new surfaces to the table, update the global-nav model, and add a one-line History entry — rather than overwriting locked surfaces. If **brand new**, create the file from the template.
- `docs/ui-contract/<screen-slug>.yaml` — from `templates/ui-contract.yaml`. **One file per routed surface in `surfaces.md`** (plus one per cross-screen reused component the payload names). Each declares the surface's stable semantic interface — `regions`, primary `actions` (role + accessible name), the accessibility baseline — the **skeleton** `design-lead` locked; `states` are filled in per slice downstream (e2e-author locks E2E-asserted states; engineers add frontend-only ones). Author only the elements the payload establishes — never invent a control to fill the file. Accessible names MUST match the component patterns in `components.md`. On **extend**, add a `ui-contract/*.yaml` only for surfaces newly added to `surfaces.md`; leave existing contract files untouched.

For `CLAUDE.md` — **only if** `design-lead` flagged the `## Design taste` section as warranting creation/update:

- Start from `templates/claude-md-design-taste.md` for the section shape.
- Append the section if `CLAUDE.md` already exists without one; edit the existing section in place if present; create the file with just this section if it does not exist.
- The taste description MUST be verbose and evocative (multiple sentences, not a one-liner). The reference paths MUST be machine-greppable backticked relative paths on their own lines under a `### References` sub-heading.

**Only if the dispatch names a sample-page winner** (the human-voted designer-duel result — skip entirely otherwise):

- Move the winner's `.html` pages (including `index.html` if present, excluding any `proposal.md`) from `docs/design-system/sample-candidates/<winner-name>/` into `docs/design-system/samples/`.
- Delete the entire `docs/design-system/sample-candidates/` directory — losing candidates included.
- The samples are moved verbatim — do not redesign or edit them; they are the human-voted record of the winning direction.

### 3. Hand artifacts back for iteration

Tell the user which files were written and whether `CLAUDE.md` was updated. Then ask whether to iterate or confirm.

Do **NOT** summarize the contents — the user can read the files.

If the user asks to iterate, treat each request as a localized rewrite of the affected file(s). If the user's edit invalidates a locked decision (i.e. is a *design* change, not a wording or formatting fix), STOP and surface that the design itself needs to change first — do not silently re-litigate the design in this skill.

### 4. On confirmation, commit on the current branch with inline `git`

Do **NOT** create a new branch, do **NOT** push, do **NOT** open a PR.

The caller (typically the orchestrator running `/deep-dive-feature`) has already created and checked out the feature branch (typically inside a worktree) before handing control to you — your job is just to stage and commit.

Run, in the working directory you were briefed with:

```bash
git add docs/design-system/ docs/ui-contract/ CLAUDE.md   # CLAUDE.md only if the design-taste section changed; docs/design-system/ also picks up samples/ + the sample-candidates/ deletion when the duel ran
git commit -m "docs(design): <feature-name> design system + surface inventory"
```

Capture the commit hash — step 5 reports it.

### 5. Report final status

One or two sentences. Include:

- The commit hash.
- The artifact paths written.

Do **NOT** summarize the design — the artifacts are on disk and the user can read them.

## Templates

Each artifact has a template under `templates/` in this skill's directory. Copy the template, replace every `<…>` placeholder, and delete sections that genuinely don't apply rather than leaving them blank.

| Asset | Target path on disk | Purpose |
|-------|---------------------|---------|
| `templates/overview.md` | `docs/design-system/overview.md` | The product's visual language in prose: taste, color philosophy, typography character, spatial rhythm, motion philosophy, interaction principles, platform priority. The taste-defining narrative. |
| `templates/tokens.md` | `docs/design-system/tokens.md` | Source-of-truth tokens (color / typography / spacing / radius / shadow / motion / breakpoints), each named `category/role/step` with a concrete value. `scaffold-project` compiles these into `frontend/src/styles/tokens.css`; `tailwind.config` mirrors them. Every value the frontend uses must appear here. |
| `templates/components.md` | `docs/design-system/components.md` | Recurring component patterns and their interaction states, including the app-shell **Navigation** pattern. Prefer native semantic elements. |
| `templates/accessibility.md` | `docs/design-system/accessibility.md` | The locked accessibility commitments: contrast floor, focus treatment, tap-target minimum, reduced-motion stance, semantics, keyboard operability. The reviewer gates against these. |
| `templates/surfaces.md` | `docs/design-system/surfaces.md` | **The surface + navigation inventory** — every routed surface (route, kind, entry source(s), global-nav membership, auth) plus the global navigation model. The contract `create-feature-issues` reads to emit the foundation/shell slice and enforce the reachability gate, and `architect` reads to model the app shell as a C4 component. Edited in place when extending; created fresh when brand new. |
| `templates/ui-contract.yaml` | `docs/ui-contract/<screen-slug>.yaml` | **The per-surface UI interaction contract** — the stable semantic interface (regions, role+accessible-name actions, outcome states) the frontend guarantees and E2E specs drive/assert through. The UI analogue of `api-contract`: decouples frontend impl from E2E driving. One file per `surfaces.md` row (+ reused cross-screen components). `design-lead` locks the skeleton; `states` land per slice (e2e-author locks E2E-asserted states, engineers add frontend-only ones). |
| `templates/claude-md-design-taste.md` | `CLAUDE.md` (the `## Design taste` section) | **Only when** the design warrants recording the visual intent in `CLAUDE.md` so future agents inherit it. A verbose, evocative taste description plus machine-greppable backticked reference paths. Edit the section in place; never append a per-feature changelog. |
