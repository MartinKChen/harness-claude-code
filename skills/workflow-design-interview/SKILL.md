---
name: workflow-design-interview
description: "Drive a depth-first design discovery interview against a single requirement. Read `docs/product-requirement-document/<feature-name>/requirement.md` and any existing `docs/design-system/`, walk a one-question-per-turn conversation, lock the product's visual language, platform priority, accessibility targets, a surface + navigation inventory, and a per-surface UI interaction contract skeleton (the semantic interface E2E specs drive against), request approval, then compose a dispatch prompt for a separate publisher agent. Writes nothing. Activate on '/workflow-design-interview'."
---

# workflow-design-interview

Drive a depth-first design discovery interview against a single requirement. Read the requirement and any existing design system, then walk a one-question-at-a-time conversation with the user until the product's **visual language** and **information architecture** are both locked. Once the user approves, compose a dispatch prompt for the publisher agent that will materialize the artifacts.

This skill **writes nothing** — no `overview.md`, no `tokens.md`, no `components.md`, no `accessibility.md`, no `surfaces.md`, no `docs/ui-contract/*.yaml`, no `CLAUDE.md` edit, no commit. The lock (step 7) and approval request (step 8) are bookkeeping in conversation context only; the artifacts themselves are written downstream by a separate publisher agent (the `doc-writer`, named by the orchestrator at invocation time).

`ui-ux-pro-max` is the **toolbox** for this interview, not a replacement: its 50+ styles, 161 palettes, font pairings, UX guidelines, and product-type patterns are the option-space you draw on when presenting visual-language recommendations. Load it before the style / palette / typography / component questions.

## When to activate

Activate this skill whenever:

- A requirement at `docs/product-requirement-document/<feature-name>/requirement.md` (or a greenfield product seed) needs its visual language and information architecture locked before any design artifact is written.
- The user types `/workflow-design-interview`, or phrases like 'lock the design system for this feature', 'interview me on the design for <feature>', 'design the look and the navigation for this product', 'what are the surfaces and how do they connect'.
- A re-entry: the user wants to extend or revise an in-flight design decision before approval has been given.

Do NOT activate when:

- The user wants to write or commit design artifacts (`docs/design-system/*`) — that is downstream artifact-publishing work, not interview work.
- The unit of work is product framing (PRD, critical path, glossary) — that is the product owner's lane.
- The unit of work is technical architecture (ADRs, data model, API contracts, stack) — that is the architect's lane.
- The unit of work is a feature task (backend / frontend / e2e) — different lane.

## Best practices

- **One question per turn.** Never batch questions. If multiple things are unclear, pick the most blocking one, ask it, wait for the answer, then move on.
- **Always recommend, then offer alternatives.** Each question must include the recommended answer (labeled `(Recommended)`) plus 1–2 viable alternatives where they exist, with a one-line "why I prefer the recommendation" rationale grounded in the product's users and platform.
- **Do NOT use the AskUserQuestion tool.** Print the question and options as plain text in the conversation. The user is in the loop and will reply directly.
- **No mid-loop summaries.** While interviewing, do not recap what's been said — the user is reading every turn. Save synthesis for the artifacts (which the publisher writes).
- **Draw on `ui-ux-pro-max` for the option-space.** When presenting a style family, palette, font pairing, or component pattern, pull concrete named options from the toolbox rather than inventing from memory — show the user real candidates with a recommendation.
- **Surface assumptions.** When the user's answer implies an unstated assumption (about platform, density, dark-mode, brand maturity, accessibility floor), name it and confirm before proceeding.
- **Explore instead of asking, whenever possible.** If a question can be answered by reading the requirement, an existing `docs/design-system/`, the critical paths, or the codebase, do that first. Only ask the user questions that require their judgment, taste, or knowledge that isn't on disk.
- **Walk the design tree depth-first.** Settle the root decisions (platform priority, brand personality) before drilling into the dependencies they unlock (spacing scale, motion durations, breakpoint behavior). Don't jump branches until the current one is settled.
- **Treat the surface/nav inventory as mandatory.** It is the linchpin (step 6). A routed page with no entry source is an orphan — force a decision (global nav, parent link, redirect target, or external entry) before locking. Do not let "navigation later" slide.
- **Right-size the system.** Reject a fifth accent color, a bespoke component where a native element works, or gratuitous motion the product can't justify — name what would justify adding it later.
- **Be concise.** One question, one recommendation, one short rationale. No filler.

## Workflow

Inputs from the caller: a `<feature-name>` (so the requirement file path can be resolved) and the working directory of the worktree the caller already set up. Everything else (the requirement, existing design system, existing surfaces, critical paths) you discover yourself.

### 1. Read the requirement

Read `docs/product-requirement-document/<feature-name>/requirement.md` in full. Then list the sibling files in the same directory and read anything related — critical path, glossary. Do not respond with a summary; the user already knows what's there.

Identify the product's users, the surfaces the requirement implies (every page/screen the user stories touch), and what's already decided.

### 2. Survey the existing design system

Read in this order, stopping as soon as you have enough context:

- `docs/design-system/` — `overview.md` (taste + style rationale), `tokens.md` (the source-of-truth tokens), `components.md`, `accessibility.md`, and especially `surfaces.md` (the surface + navigation inventory) if they exist. A feature added to an existing product **extends** the locked system rather than re-litigating it — only re-open a locked decision when the requirement genuinely forces it.
- `docs/critical-path/` — the locked user flows. Each flow's entry point and steps are evidence for which surfaces exist and how a user reaches them; the inventory you build must stay consistent with these flows.
- `CLAUDE.md` `## Design taste` section (if present) — the prose statement of the product's visual intent.
- The frontend codebase (`frontend/src/` route registration, existing pages, any nav component) — existing surfaces are answers, not questions.

Note what already exists vs. what this feature adds. If the existing system already locks a decision, carry it forward verbatim; do not present it as an open question.

### 3. Identify the most blocking design unknown

Rank gaps by how much downstream design they block. Root-level decisions, roughly in dependency order:

- **Platform priority** — mobile-first vs desktop-first (drives the entire spatial and navigation model).
- **Brand personality / tone** — the emotional register that anchors color, type, and motion.
- **The surface set** — which pages exist (derived from the requirement's user stories), before deciding how they connect.

Pick the single highest-leverage question to ask first.

### 4. Ask one question, with recommendation + alternatives

Plain text, not AskUserQuestion. For each question:

- Phrase the question concretely.
- Provide the recommended answer first, labeled `(Recommended)`, with a one-line rationale.
- Provide 1–2 viable alternatives where they exist, each with its own one-line "why not this one" note. Pull named candidates from `ui-ux-pro-max` (style family, palette, font pairing) where applicable.
- If the question surfaces an unstated assumption, name it explicitly so the user can confirm or reject it.

### 5. Iterate across the visual-language axes

After each answer, re-rank remaining unknowns and ask the next single most-blocking question. Continue until **all** of these are locked:

- **Brand / personality / tone** — the product's voice and emotional register.
- **Color philosophy** — dominant hues, accent role, contrast posture, dark-mode stance (and the concrete token values they imply: `color/brand/*`, `color/surface/*`, `color/text/*`, etc.).
- **Typography** — display vs body voice, the font pairing, weight contrast, the type scale.
- **Spatial rhythm** — the spacing scale, density, breathing room, alignment posture.
- **Motion posture** — snappy / soft / restrained / expressive, default durations, and the `prefers-reduced-motion` stance.
- **Platform priority** — mobile-first vs desktop-first, and the breakpoint set.
- **Accessibility targets** — contrast ratio floor, visible focus treatment, tap-target minimum, `prefers-reduced-motion` behavior.

When the user's answer triggers a need to revisit an earlier decision, name the dependency and re-open the earlier branch — do not silently change a prior settlement.

### 6. Lock the surface + navigation inventory (the linchpin)

This is the part that closes the orphan-page gap. Before requesting approval, build a canonical inventory the publisher will materialize at `docs/design-system/surfaces.md`.

Enumerate **every routed surface** the requirement implies (cross-check against the critical paths from step 2). For each surface, settle:

| Field | Example |
|---|---|
| route | `/students/:id` |
| kind | `top-level` / `detail-child` / `contextual` / `external-entry` / `redirect-system` |
| entry source(s) | `parent: /students (list row)` · `global-nav` · `email magic-link` · `redirect from /` |
| in global nav? | yes / no |
| auth | public / protected |

Then settle the **global navigation model**:

- The ordered list of top-level nav items.
- The account / user menu contents.
- Mobile navigation behavior (e.g. hamburger sheet at `breakpoint/md`), consistent with the platform-priority decision from step 5.

**Enforce reachability while you build it.** Every surface must have at least one real entry source:

- A **top-level (parentless)** surface MUST be in the global nav OR be an explicit redirect target.
- A surface **with a parent** MUST be linked from that parent (a row, card, or control).
- An **external-entry** surface (login, magic-link landing) declares "entered via URL / email" and is exempt from in-app linking.
- A **redirect/system** surface (`/` → home, 404) declares its redirect or error trigger.

If any surface has no entry source, surface it to the user and force a decision before moving on. Do not lock an inventory with an orphan in it.

### 6b. Lock the per-surface UI interaction contract skeleton

For **every routed surface** in the inventory from step 6 (and any cross-screen reused component — a shared table, date-picker, etc.), lock the **skeleton** of its UI interaction contract — the publisher materializes one `docs/ui-contract/<screen-slug>.yaml` per surface. This is the UI analogue of the architect's `api-contract`: it declares the stable semantic interface (roles + accessible names + outcome states) the frontend guarantees and the E2E specs drive/assert through, so the E2E author is decoupled from whatever DOM the engineer emits.

For each surface, settle the **skeleton only**:

- `regions` — the landmark roles + accessible names an E2E scopes to (`main` "…", `navigation` "…", `toolbar` "…").
- `actions` — the **primary** user-actionable elements, each as `role` + accessible `name` (`button` "Publish", `textbox` "Title"), plus any behavioral promise the IA already establishes (`required`, `options`, `disabled_when`).
- the accessibility baseline carried from step 5 (contrast / focus / target / reduced-motion).

Hold three lines firmly:

- **Declare interface, not coverage or build order.** What gets tested is the slice's Gherkin + `pattern-test-coverage`; when a surface ships is slice ordering. Neither belongs here.
- **Surface-level complete, element-level only where known.** Every surface gets an entry; populate `actions` only with controls the requirement and critical paths genuinely establish — never invent a control to fill the file. The behavioral `states` block is left downstream: the e2e-author locks each state its specs assert at spec-authoring time, and engineers add the frontend-only states no E2E covers as each slice adds behavior.
- **Accessible names are the contract.** Names must match the component patterns you're locking; querying by CSS/DOM structure is out of scope by construction.

Don't interview this as a separate ceremony — derive it from the surfaces and components you just locked, and only ask the user where a surface's primary controls are genuinely ambiguous.

### 7. Request approval to proceed

Once the visual language and the surface/nav inventory are both locked, ask the user — in plain text, not a summary — for explicit approval. Use phrasing along these lines:

> Ready to lock the design system — visual language (overview, tokens, components, accessibility), the surface + navigation inventory (`docs/design-system/surfaces.md`), and the per-surface UI interaction contracts (`docs/ui-contract/*.yaml`). Approve?

Do **NOT** recap the decisions; the user has been in the loop.

If the user does not approve and asks to revisit, treat it as a return to step 5 or step 6 — re-rank, ask the next single most-blocking question. **Only when the user explicitly approves does the interview proceed to step 8.**

### 8. Compose one scoped dispatch prompt and dispatch the writer

The interview ends here. The design-system artifacts get written by **one writer teammate** named by the orchestrator at invocation time (typically `design-writer`, `subagent_type = doc-writer`).

Compose **one dispatch prompt** as plain text. It must include:

- The trigger phrase the writer's routing table will match (use exactly):
  - `Publish design system for <feature-name>`
- The `<feature-name>`.
- The working directory of the worktree (the orchestrator surfaces this at readiness-signal time — leave it as a `{worktree_path}` placeholder until then).
- The **locked visual language** — enough content to fill `overview.md` (taste prose, style family, emotional register, color philosophy, typography character, spatial rhythm, motion philosophy, interaction principles), `tokens.md` (every color / font / spacing / radius / shadow / motion token with its name and value), `components.md` (the component patterns and their states), and `accessibility.md` (contrast floor, focus treatment, tap-target minimum, reduced-motion stance).
- The **surface + navigation inventory** — the full per-surface table from step 6 plus the global navigation model — for `surfaces.md`. Flag whether the system is `extend` (an existing `surfaces.md` is being added to) or `brand new`.
- The **per-surface UI interaction contract skeletons** from step 6b — for every surface (and reused component), its `regions`, primary `actions` (role + accessible name + any known behavioral promise), and accessibility baseline — one `docs/ui-contract/<screen-slug>.yaml` each. On an `extend`, name only the surfaces newly added in this pass; existing contract files stay untouched.
- Whether the **`CLAUDE.md` `## Design taste` section** warrants creation/update (a verbose, evocative statement of the visual intent plus machine-greppable reference paths) — and if so, the proposed wording.

**Output and wait.** Surface the dispatch prompt in the same turn, then stop. The orchestrator will invite the writer teammate and message back to confirm it is ready, naming it explicitly (typically `design-writer`) and providing the worktree path.

**On readiness signal, send.** When the orchestrator confirms readiness, replace the `{worktree_path}` placeholder with the orchestrator-provided path and send the dispatch prompt to the named writer via `SendMessage(to=<writer-name>)` — otherwise verbatim, do not modify.

**Do not** assume a default name, do not pick a name yourself, do not send to the user. If the orchestrator never confirms readiness, leave the prompt on screen and stop — the orchestrator's flow has stalled and surfacing it is the right response.

The skill **never spawns a new agent** — the orchestrator owns invites; this skill only messages teammates the orchestrator already invited.
