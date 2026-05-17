---
description: Deep-dive a new feature end-to-end — product discovery with `product-owner`, optional design discovery with `ui-ux-designer`, then technical discovery with `architect`. Orchestrator creates a feature branch in a worktree after product lock-in; each teammate writes and commits its own artifacts in that worktree; orchestrator opens a single PR at the end.
argument-hint: [optional: short description of the feature]
---

# deep-dive-feature

Orchestrate a deep-dive on a new feature, in up to three sequential phases. Phase 1 is product discovery, owned by the `product-owner` teammate. Phase 2 is **conditional** design discovery, owned by the `ui-ux-designer` teammate — engaged on greenfield projects and on features that introduce create/edit user flows or change visual style. Phase 3 is technical discovery, owned by the `architect` teammate. The final phase records every decision in git as a single labeled lock-in PR.

You (the orchestrator) coordinate the phases, gate on explicit user confirmation between them, and ferry messages between the user and the active teammate. Do **not** answer product, design, or architectural questions yourself — route them to the right teammate. Equally important: do **not** answer on behalf of the user when a teammate asks the user a question — always wait for the human's actual reply.

Git flow at a glance: orchestrator creates a milestone and a worktree-backed feature branch after Phase 1 lock-in (Step 5). `product-owner` writes and commits its artifacts inside that worktree (Step 6). If the design gate engages, `ui-ux-designer` writes and commits its design-system artifacts inside the same worktree (Steps 7–10). `architect` writes and commits its docs artifacts inside the same worktree, then runs the structural scaffold gate (`scaffold-project`) which lands one `chore(scaffold): <surface>` commit per greenfield/first-time-needed surface on the same branch (Steps 11–14). Orchestrator pushes the branch and opens a `feature-lockin`-labeled PR linked to the milestone at the very end (Step 15).

## Initial input

The user may have provided a short description of the feature in the slash-command arguments: `$ARGUMENTS`. Treat that as the seed for `product-owner`. If empty, ask the user one sentence about what they want to build before spawning the team.

---

## Step 1 — Spin up the team

Use `TeamCreate` to create a team with exactly three teammates. All teammates' `name` field MUST match their `subagent_type` field verbatim:

- teammate A: `name = "product-owner"`, `subagent_type = "product-owner"`
- teammate B: `name = "ui-ux-designer"`, `subagent_type = "ui-ux-designer"`
- teammate C: `name = "architect"`, `subagent_type = "architect"`

This naming is load-bearing — the agents reference each other by name (e.g. `architect` may message `product-owner` when a technical question depends on product intent, or `ui-ux-designer` may message `product-owner` when a design decision needs product-intent clarification), and identical name/subagent_type makes that addressing unambiguous.

Spin up all three teammates even when the design phase may not engage — it's cheap, and the gate decision (Step 7) is made after `product-owner` writes its artifacts, so the teammate must already exist by then. If the design gate skips, `ui-ux-designer` simply stays idle for the run.

Tell the user once, in a single short sentence, that the team is up and Phase 1 is starting.

---

## Step 2 — Brief `product-owner`

Send the initial brief to `product-owner` via `SendMessage`. The brief MUST cover:

- The user's seed description (whatever you have from `$ARGUMENTS` or the one-sentence reply).
- The instruction: **lead a product discovery conversation with the user**. Grill them until you have a clear view of all six axes:
  1. **User / persona** — who specifically experiences the problem
  2. **Problem** — what hurts today, in the user's words
  3. **Success criteria** — how we'll know this worked, measurably
  4. **Scope (in)** — what this feature does
  5. **Scope (out) / non-goals** — what it explicitly does NOT do
  6. **Edge cases** — boundary conditions, failure paths, weird inputs
- The instruction: **do not write artifacts yet**. The interview comes first.
- The instruction: when you believe the picture is clear on all six axes, **explicitly ask the user to "lock requirements"** before moving on. Do not generate any documents until the user confirms lock-in.
- **Do not dictate interview cadence.** Let `product-owner` choose how to pace questions (one per turn, batched, depth-first, etc.) — that is a product-discovery judgment call, not the orchestrator's. Do not tell it to "group questions" or "ask one at a time"; trust its default.

---

## Step 3 — Hand control to `product-owner` for the interview

While `product-owner` is interviewing the user:

- Forward each user message to `product-owner` via `SendMessage`.
- Forward each `product-owner` reply back to the user verbatim (or as a thin pass-through — do not paraphrase or shortcut its questions).
- Do NOT answer product questions yourself. Do NOT skip ahead to architecture.
- **Do NOT answer on behalf of the user.** When `product-owner` asks the user a question, surface it and **stop** — wait for the human's actual reply. Do not infer, guess, or fill in answers from `$ARGUMENTS`, prior conversation, memory, codebase context, or "reasonable assumptions". Auto mode does NOT authorize you to answer product-discovery questions for the user. Only the human can speak to user/persona, problem, success criteria, scope, non-goals, and edge cases.
- If `product-owner` asks for information that is genuinely architectural (rare in this phase), note it for Phase 2 and tell `product-owner` it will be addressed later — do not derail the product interview.
- **Idle notifications are not action signals.** A teammate goes idle at the end of every turn — that is normal. A bare `idle_notification` arriving by itself does NOT mean the teammate failed to produce output; check whether a message from that teammate already arrived in the same turn-cycle (typically rendered immediately above the idle notification). **Do not nudge, ping, or re-prompt a teammate on the basis of an idle notification alone.** If their last substantive message is unanswered, the next move belongs to the user, not to you. Re-prompting in this state causes the teammate to re-send and often re-bundle its previous message, polluting the interview.

---

## Step 4 — Wait at the lock-requirements gate

When `product-owner` asks the user to lock requirements, **stop and wait for the user's explicit confirmation**. Acceptable signals: "lock", "lock it in", "approved", "yes go", or similar unambiguous yes. Anything else (questions, hedging, "maybe", new requirements) means **keep iterating** — forward the message back to `product-owner` and continue the interview loop.

Do not proceed to Step 5 without an explicit yes from the user.

---

## Step 5 — Orchestrator: feature name + branch preparation

By the end of this step you'll have a feature name, a milestone, and a clean worktree on a fresh branch off the latest `main`, ready for both teammates to write into.

**1. Get the feature name from `product-owner`.**

Send `product-owner` a short message: "User locked requirements. Propose the kebab-case `{feature-name}` we'll use for `docs/PRDs/{feature-name}/` and the git branch. Reply with just the name." Do not write any files yet, do not commit.

When `product-owner` replies, surface the name to the user in one short sentence (e.g. "product-owner proposes `payment-retry-flow` — proceeding") and move on. If the name looks malformed (spaces, capitals, special chars), normalize it to kebab-case before using it.

**2. Ensure `main` is up to date.**

```
gh repo sync                 # fast-forward local main from origin (no-op if already current)
git fetch origin             # ensure remote refs are current locally
```

If `gh repo sync` is unavailable in this repo (no remote default branch), fall back to `git checkout main && git pull --ff-only origin main`. If the working tree is dirty in a way that would block branching, stop and surface the issue to the user — don't try to clean it up unilaterally.

**3. Create the milestone.**

```
gh api --method POST repos/:owner/:repo/milestones -f title="{feature-name}"
```

Set only the title — leave description, due_on, and state at their defaults. The milestone is the umbrella for the lock-in PR (Step 11) and downstream slice/task issues created later by `create-issues`.

**4. Create the feature branch as a worktree off latest `origin/main`.**

The worktree always lives at `/tmp/git-worktree/<repo-name>/<feature-name>` — predictable, outside the repo, and easy to clean up.

```
repo_root="$(git rev-parse --show-toplevel)"
repo_name="$(basename "$repo_root")"
worktree_path="/tmp/git-worktree/${repo_name}/{feature-name}"
mkdir -p "/tmp/git-worktree/${repo_name}"
git -C "$repo_root" worktree add "$worktree_path" -b "docs/{feature-name}" origin/main
```

Record `{worktree_path}` — both teammates will write and commit inside it, and you will push from it in Step 11. Branch is `docs/{feature-name}`. No commit, no push, no PR yet.

---

## Step 6 — `product-owner` writes artifacts and commits in the worktree

Now send `product-owner` a message instructing it to:
- **Work inside the worktree** at `{worktree_path}` — every file path, every `git` invocation must target that directory (e.g. `git -C {worktree_path} ...`). Do not touch the main repo checkout.
- Generate its artifacts: PRD at `docs/PRDs/{feature-name}/requirement.md`, Critical Path (with the extend/supersede/new classification it already settled), Glossary updates, and CLAUDE.md product-context update if warranted.
- After writing, list the changed/deleted files to the user and **explicitly ask for user confirmation before committing**. Wait for an unambiguous yes ("commit", "approved", "yes go"); on any other reply (questions, edits, "wait"), iterate on the artifacts and ask again.
- On user confirmation, commit on the current branch (`docs/{feature-name}`). Do not create a new branch, do not push, do not open a PR. Suggested commit message: `docs(prd): {feature-name} requirements`. Concretely:

  ```
  git -C {worktree_path} add <changed-and-deleted-files>
  git -C {worktree_path} commit -m "docs(prd): {feature-name} requirements"
  ```

The orchestrator MUST respect this gate: when `product-owner` asks the user to confirm the commit, surface the question and **wait for the human's actual yes** — do not approve on the user's behalf. When `product-owner` reports the commit is done, surface the file list and commit hash to the user in one short message and move on to Step 7 — the design-phase gate.

---

## Step 7 — Design-phase gate

Decide whether to engage `ui-ux-designer` for this feature. The phase engages when **either** of the following is true:

- **(a) Greenfield design.** `docs/DESIGNs/` is empty or does not exist in the worktree. This is the first time any feature in this project locks in a visual language, so the design system must be established before architecture is settled.
- **(b) Create/edit user flow or styling change.** The locked-in PRD introduces at least one screen where a user creates or edits data (forms, multi-step flows, configuration UIs, etc.), OR it changes the visual style of an existing flow (new look-and-feel, palette refresh, density change, motion change, new component shape).

Procedure:

1. **Detect greenfield deterministically.** From `{worktree_path}`, run:

    ```
    ls "{worktree_path}/docs/DESIGNs" 2>/dev/null | head -1
    ```

    If the directory is missing or the listing is empty, treat the project as greenfield-for-design and engage `ui-ux-designer` without asking — Phase 2 starts at Step 8. Tell the user one short sentence (e.g. "No design system on disk — engaging `ui-ux-designer` for greenfield lock-in.").

2. **Otherwise, classify (b) by reading the locked PRD.** Read `{worktree_path}/docs/PRDs/{feature-name}/requirement.md` (and the just-touched Critical Path). Look specifically for:
   - User stories that introduce a new screen, new form, new modal, or multi-step flow where the user creates or edits data.
   - Language indicating a visual style shift — "redesign", "new look", "refresh palette", "change density", "new component look", etc.
   - User stories that introduce a new top-level surface (landing page, dashboard, admin screen) the existing system has not styled before.

3. **If criterion (b) clearly applies**, engage `ui-ux-designer` without asking — Phase 2 starts at Step 8. Tell the user in one short sentence which criterion triggered the engagement (e.g. "Feature introduces a new checkout form flow — engaging `ui-ux-designer`.").

4. **If criterion (b) does NOT clearly apply** (read-only feature, backend-only feature, API/data-pipeline change with no UI implication, pure bug-fix-shaped feature), tell the user in one short sentence that the design phase is skipping (e.g. "Feature has no UI surface — skipping design phase, going straight to `architect`.") and **jump to Step 11**. Do not write any `docs/DESIGNs/` files in this run.

5. **If the trigger is ambiguous** — e.g. the PRD mentions a screen but isn't clear whether it's new or existing, or the styling change is implied not stated — ask the user, plain text:

    > Design phase looks borderline for this feature: `<one-sentence reason>`. Engage `ui-ux-designer` to lock in the design system before architecture? (Recommended: yes if the user-facing surface is non-trivial.)

   Wait for an unambiguous yes/no. On yes, proceed to Step 8. On no, jump to Step 11.

The gate is sticky: once you decide to engage (or skip), do not revisit the decision mid-run. If the design phase produces an unexpected gap, surface it to the user — don't try to roll it back yourself.

---

## Step 8 — Brief `ui-ux-designer`

(Only when Step 7 engaged the design phase. Otherwise jump to Step 11.)

Send the initial brief to `ui-ux-designer` via `SendMessage`. The brief MUST cover:

- The path to the artifacts `product-owner` just wrote and the exact files to read **first, before asking anything**:
  - `{worktree_path}/docs/PRDs/{feature-name}/requirement.md`
  - the sibling Critical Path file under `{worktree_path}/docs/CRITICALPATHs/` (name it explicitly — orchestrator already knows which one from `product-owner`'s final-status message)
  - `{worktree_path}/docs/GLOSSARY.md`
- The instruction: **read those files in full, then list `{worktree_path}/docs/DESIGNs/`** to detect greenfield-vs-extension mode. Greenfield: design language is being established for the first time; pick a coherent direction and anchor every token to a reason. Extension: propose token/component reuse first, new tokens only when the existing palette/scale can't express the requirement.
- The instruction: **work inside the worktree** at `{worktree_path}` — every file path, every `git` invocation must target that directory. Same worktree `product-owner` just committed in.
- The instruction: **lead a design discovery conversation with the user**. Grill until the picture is clear across:
  1. **Product framing** — kind of product, primary user, dominant interaction pattern
  2. **Visual style direction** — referenced by name from `ui-ux-pro-max:ui-ux-pro-max` (minimalism, glassmorphism, bento, etc.)
  3. **Palette and contrast floor** — primary brand, surfaces, state colors; every interactive pair must declare WCAG contrast
  4. **Type system** — display / body / mono families, scale, fluid-scaling rule
  5. **Spacing scale, radii, shadows, motion** — including reduced-motion fallback
  6. **Component inventory** — only the components this feature's user stories actually need
  7. **Sample pages** — at least one screen-level sample drawn from this feature's user stories, plus a token/component overview page (`sample/index.html`)
- The instruction: **make recommendations** on every decision (per the agent's own principles — recommendation + 1–2 alternatives + rationale, grounded in `ui-ux-pro-max:ui-ux-pro-max` references where applicable).
- The instruction: if any design question depends on **product intent** (target persona's environment, tone, accessibility floor, density tolerance), **message `product-owner` directly** via `SendMessage` rather than asking the user. That's what teammates are for. Do not derail the user with product re-litigation.
- The instruction: **do not write artifacts yet**. The interview comes first.
- The instruction: when the design is ship-ready (style direction, palette, type pairing, spacing, radii, shadows, motion, the component inventory the feature needs, accessibility floors, and the sample-page set are all settled or explicitly deferred-with-trigger), **explicitly ask the user to "lock design"** before moving on.

---

## Step 9 — Hand control to `ui-ux-designer` for the interview

Same protocol as Step 3, but with `ui-ux-designer`. Forward user messages to `ui-ux-designer`, forward `ui-ux-designer`'s replies back. Do not answer design questions yourself. **Do NOT answer on behalf of the user** — when `ui-ux-designer` poses a question to the user (e.g. preferred visual style direction, density, brand palette family, motion appetite, accessibility floor), surface it and stop until the human replies. Do not infer answers from the PRD, codebase, prior design, memory, or "reasonable assumptions"; auto mode does not authorize you to make these calls for the user. If `ui-ux-designer` messages `product-owner`, let that exchange happen between teammates — you don't need to mediate teammate-to-teammate messages, but do surface to the user any product-side change that comes out of it.

---

## Step 10 — Wait at the lock-design gate, then `ui-ux-designer` writes and commits

When `ui-ux-designer` asks the user to lock design, **stop and wait for explicit user confirmation**. Anything short of a clear yes means keep iterating.

Once the user confirms lock-in, send `ui-ux-designer` a short message instructing it to:
- **Work inside the worktree** at `{worktree_path}` — same one `product-owner` committed in.
- Generate its artifacts: `docs/DESIGNs/overview.md`, `docs/DESIGNs/tokens.md`, `docs/DESIGNs/components.md`, `docs/DESIGNs/accessibility.md`, the sample pages under `docs/DESIGNs/sample/` (at minimum `sample/index.html` plus one screen-level sample drawn from this feature's user stories), and a CLAUDE.md design-context update if (and only if) this is the project's first design lock-in or a project-level token genuinely shifted.
- After writing, list the changed files to the user and **explicitly ask for user confirmation before committing**. Wait for an unambiguous yes ("commit", "approved", "yes go"); on any other reply (questions, edits, "wait"), iterate on the artifacts and ask again.
- On user confirmation, commit on the current branch (`docs/{feature-name}`). Do not create a new branch, do not push, do not open a PR. Suggested commit message: `docs(design): {feature-name} design system` (or `docs(design): establish design system for {feature-name}` if this is the project's greenfield design lock-in). Concretely:

  ```
  git -C {worktree_path} add <changed-files>
  git -C {worktree_path} commit -m "docs(design): {feature-name} design system"
  ```

The orchestrator MUST respect the commit-confirmation gate: when `ui-ux-designer` asks the user to confirm the commit, surface the question and **wait for the human's actual yes** — do not approve on the user's behalf. When `ui-ux-designer` reports the commit is done, surface the file list and commit hash to the user in one short message and move on to Phase 3.

---

## Step 11 — Brief `architect`

Send the initial brief to `architect` via `SendMessage`. The brief MUST cover:

- The path to the requirement file `product-owner` just wrote (typically `docs/PRDs/{feature-name}/requirement.md`) and the sibling Critical Path / Glossary files. `architect` should read those before asking anything.
- **If the design phase ran** (Step 10 produced a commit), the brief MUST also point `architect` at the design artifacts under `docs/DESIGNs/` — `overview.md`, `tokens.md`, `components.md`, `accessibility.md`, and the sample pages — and instruct it to treat the design system as a hard constraint on stack/component-library choices (e.g. don't pick a component library that fights the locked-in design tokens; the frontend stack must be able to consume CSS custom properties cleanly). If the design phase was skipped at Step 7, omit this bullet.
- The instruction: **lead a technical discovery conversation with the user**. Grill until the picture is clear across:
  1. **Architecture** — where this feature lives (existing service vs new), sync vs async, module shape
  2. **Data model** — tables/collections/types added or changed, indexes, migrations
  3. **Integrations** — external systems, internal services, contracts, rate limits
  4. **Failure modes** — what can break, how the system responds, what the user sees
  5. **Performance** — expected scale, p95 targets, when (if ever) to add caching/queues
  6. **Security** — authn/authz, data sensitivity, threat model relevant to this feature
  7. **Rollout** — migration order, feature flags, backfill, rollback path
- The instruction: **make recommendations** on every decision (per the agent's own principles — recommendation + 1–2 alternatives + rationale).
- The instruction: if any technical question depends on product intent, **message the `product-owner` teammate directly** via SendMessage rather than asking the user — that's what teammates are for. Do not derail the user with product re-litigation.
- The instruction: **do not write artifacts yet**.
- The instruction: when the design is ship-ready (data model, API surface, integration points, failure handling, observability, rollout all settled or explicitly deferred-with-trigger), **explicitly ask the user to "lock decisions"** before moving on.

---

## Step 12 — Hand control to `architect` for the interview

Same protocol as Step 3, but with `architect`. Forward user messages to `architect`, forward `architect`'s replies back. Do not answer architectural questions yourself. **Do NOT answer on behalf of the user** — when `architect` poses a question to the user (e.g. acceptable p95, target scale, security posture, rollout risk tolerance), surface it and stop until the human replies. Do not infer answers from the PRD, codebase, prior architecture, memory, or "reasonable assumptions"; auto mode does not authorize you to make these calls for the user. If `architect` messages `product-owner` or `ui-ux-designer`, let that exchange happen between teammates — you don't need to mediate teammate-to-teammate messages, but do surface to the user any product- or design-side change that comes out of it.

---

## Step 13 — Wait at the lock-decisions gate

Same protocol as Step 4. When `architect` asks the user to lock decisions, **stop and wait for explicit user confirmation**. Anything short of a clear yes means keep iterating.

---

## Step 14 — `architect` writes artifacts and commits in the same worktree

Once the user confirms lock-in, send `architect` a short message instructing it to:
- **Work inside the worktree** at `{worktree_path}` — same one `product-owner` (and `ui-ux-designer`, if it ran) used. Every file path, every `git` invocation must target that directory (e.g. `git -C {worktree_path} ...`). Do not touch the main repo checkout.
- Generate its artifacts: ADR (next zero-padded number, supersede set if any), `docs/ADRs/README.md` index update, `docs/PRDs/{feature-name}/implement-detail.md`, per-entity `data-models/` and `api-contracts/` files, and CLAUDE.md architecture-context update if warranted. If any ADR is being superseded, the superseded `.md` file must be deleted per the agent's own rules.
- After writing, list the changed/deleted files to the user and **explicitly ask for user confirmation before committing**. Wait for an unambiguous yes ("commit", "approved", "yes go"); on any other reply (questions, edits, "wait"), iterate on the artifacts and ask again.
- On user confirmation, commit on the current branch (`docs/{feature-name}`). Do not create a new branch, do not push, do not open a PR. Suggested commit message: `docs(adr): ADR-{NNNN} <short decision title>`. Concretely:

  ```
  git -C {worktree_path} add <changed-and-deleted-files>
  git -C {worktree_path} commit -m "docs(adr): ADR-{NNNN} <short decision title>"
  ```

- **After the docs commit lands, run the scaffold gate** (architect.md Workflow step 12). Invoke the detector that ships with the `scaffold-project` skill from inside `{worktree_path}`; on flagged surfaces, dispatch the `scaffold-project` skill, which materializes templates from `docs/ADRs/*.md` stack/topology choices and commits one `chore(scaffold): <surface>` per flagged surface on the same `docs/{feature-name}` branch. On a brand-new project this typically produces four scaffold commits (backend, frontend, compose, e2e); on a non-greenfield lockin the detector usually returns empty and the scaffold gate is a no-op. Report the scaffold result (surfaces scaffolded or "scaffold no-op") in the same final-status message as the docs commit hash.

The orchestrator MUST respect the commit-confirmation gate: when `architect` asks the user to confirm the docs commit, surface the question and **wait for the human's actual yes** — do not approve on the user's behalf. The scaffold gate that fires *after* the docs commit does NOT require a separate user confirmation — it is structural, derives entirely from the locked-in ADR, and ships in the same lock-in PR. When `architect` reports both the docs commit and the scaffold outcome, surface the full file/commit list to the user in one short message and move on to Step 15.

---

## Step 15 — Orchestrator: push and open the lock-in PR

The branch already exists (created in Step 5) and every engaged teammate's commits already landed on it (Step 6 for `product-owner`, Step 10 for `ui-ux-designer` if it ran, Step 14 for `architect`). All that's left is to push and open the PR.

```
git -C {worktree_path} push -u origin docs/{feature-name}

gh pr create \
  --head "docs/{feature-name}" \
  --base main \
  --milestone "{feature-name}" \
  --label "feature-lockin" \
  --title "<readable PR title>" \
  --body-file <(cat <<'EOF'
## Summary
- PRD: `docs/PRDs/{feature-name}/requirement.md`
- Critical Path update: ...
- Glossary update: ...
- Design system (if design phase ran): `docs/DESIGNs/overview.md`, `docs/DESIGNs/tokens.md`, `docs/DESIGNs/components.md`, `docs/DESIGNs/accessibility.md`, and sample pages under `docs/DESIGNs/sample/` — list whichever were written/updated; omit this bullet if the design phase was skipped at Step 7.
- ADR-{NNNN}: ...
- Implementation detail: `docs/PRDs/{feature-name}/implement-detail.md`
- Per-entity data-models / api-contracts: ...
- CLAUDE.md updates: ...
- Superseded ADRs: ...
- Scaffold commits (if any): `chore(scaffold): backend (...)`, `chore(scaffold): frontend (...)`, `chore(scaffold): compose topology (...)`, `chore(scaffold): e2e (...)` — list whichever surfaces were materialized; omit this bullet if the scaffold gate was a no-op.

## Test plan
- [ ] documentation + structural scaffold only — no feature code changes
- [ ] (if design commits landed) sample HTML pages under `docs/DESIGNs/sample/` open in a browser and visually mirror `docs/DESIGNs/tokens.md` / `components.md`
- [ ] (if scaffold commits landed) `docker compose up` brings every declared service online and the `e2e/tests/smoke.spec.ts` smoke test passes against the served frontend
EOF
)
```

PR title: **human-readable** (e.g. `docs({feature-name}): lock requirements + architecture`). Do **not** use the literal string `feature lockin` — the lock-in marker is the **`feature-lockin` label**, not the title. Downstream skills (`create-issues`) query by that label.

The milestone (`{feature-name}`) was created in Step 5 — gh resolves it by title.

Confirm the PR URL back to the user in one short sentence and stop.

---

## Guardrails

- **Never answer for a teammate.** Route product questions to `product-owner`, design questions to `ui-ux-designer`, technical questions to `architect`. If a question comes in for an agent whose phase is over, note it for the active phase or surface it back as out-of-scope for this run — don't answer it yourself.
- **Never answer for the human.** When a teammate asks the user a question, your job is to surface it and wait. Do not simulate, infer, fabricate, or "best-guess" the user's answer from `$ARGUMENTS`, the seed sentence, prior turns, the codebase, memory files, or your own intuition. If you don't have a literal reply from the human in the most recent user turn, you do not have an answer — pause and let the user respond. This rule overrides auto mode: auto mode applies to *your* execution decisions, not to product, design, or architectural decisions that belong to the user.
- **Never skip a lock gate.** "lock requirements" (Step 4), "lock design" (Step 10, if engaged), and "lock decisions" (Step 13) each require explicit user confirmation from the human — not your inference of consent. No silent advancement.
- **The design-phase gate is decided ONCE.** Step 7 is the only place the orchestrator decides whether `ui-ux-designer` engages. The greenfield branch (no `docs/DESIGNs/`) auto-engages without asking; criterion (b) auto-engages when the PRD clearly introduces a create/edit user flow or a styling change; only an ambiguous read asks the user. Once decided, don't revisit mid-run.
- **Never invoke the `git-workflow` skill from this command.** Every `git` / `gh` action in this flow — sync, milestone, worktree creation, agent commits, push, PR — is run inline as shown in the relevant step, by the orchestrator or the agent. Neither orchestrator nor agents delegate to `git-workflow` anywhere in `/deep-dive-feature`.
- **Commits land on the feature branch in the worktree, never on `main`.** The orchestrator creates the `docs/{feature-name}` branch as a worktree in Step 5 *before* any agent writes a file. Every agent that engages works and commits inside that worktree (Steps 6, 10, 14) using inline `git` commands. Never let any agent commit before the worktree exists, and never let any agent push or open a PR — the push and PR are the orchestrator's job in Step 15.
- **Pass-through, don't paraphrase.** Forwarding teammate messages: keep the substance. The user is in the loop and reading every turn.
- **Don't nudge on idle alone.** A bare `idle_notification` from a teammate is normal turn-end behavior, NOT a "no output" signal. Check for an actual message in the same turn-cycle before assuming silence; nudging on idle alone causes teammates to re-send and re-bundle prior questions, polluting the interview. If the teammate's last substantive message is unanswered, the next move belongs to the user — not to you.
- **Don't dictate teammate working style.** Briefs should set goals and constraints, not micro-manage cadence (e.g. "group questions", "ask one at a time"). Each teammate's defaults are tuned for its role; trust them.
- **Stop on user dissent.** If the user says "stop", "abort", or otherwise withdraws, halt cleanly — do not write artifacts, do not commit, do not open a PR. Report what was discussed and exit.
