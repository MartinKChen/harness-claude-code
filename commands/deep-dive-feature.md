---
description: Deep-dive a new feature end-to-end — product discovery with `product-owner`, design discovery with `ui-ux-designer` only when `product-owner` calls for it, then architecture discovery with `architect`. The architect composes 4 scoped dispatch prompts; the orchestrator invites 4 writer teammates (`implement-detail-writer`, `adr-writer`, `api-contract-writer`, `data-model-writer` — all `subagent_type = doc-writer`); the architect messages each one to publish and commit its scoped artifacts. Orchestrator creates a feature branch in a worktree after product lock-in; every teammate's commits land there; orchestrator opens a single lock-in PR at the end.
argument-hint: [optional: short description of the feature]
---

# deep-dive-feature

Orchestrate a deep-dive on a new feature, in up to three sequential phases. Phase 1 is product discovery, owned by the `product-owner` teammate. Phase 2 is **conditional** design discovery, owned by the `ui-ux-designer` teammate — engaged only when `product-owner` recommends it. Phase 3 is technical discovery, owned by the `architect` teammate; when the interview lands, the orchestrator brings 4 writer teammates into the team (all `subagent_type = doc-writer`, scoped by name to implement-detail / ADR / API contracts / data models), then the interviewer messages each one directly to publish and commit its scoped artifacts. The final phase records every decision in git as a single labeled lock-in PR.

You (the orchestrator) coordinate the phases, gate on explicit user confirmation at the lock points, and grow the team one teammate at a time as each phase opens. Do **not** answer product, design, or architectural questions yourself — route them to the right teammate. Equally important: do **not** answer on behalf of the user when a teammate asks the user a question — always wait for the human's actual reply.

Git flow at a glance: orchestrator creates a milestone and a worktree-backed feature branch after Phase 1 lock-in (Step 5). `product-owner` writes and commits its artifacts inside that worktree (Step 6). If `product-owner` calls for the design phase, `ui-ux-designer` is invited into the team and writes / commits its design-system artifacts inside the same worktree (Steps 7–10). `architect` is invited into the team for technical discovery (Step 11); when its interview lands and it composes 4 scoped dispatch prompts, the orchestrator invites 4 writer teammates (`implement-detail-writer`, `adr-writer`, `api-contract-writer`, `data-model-writer` — all `subagent_type = doc-writer`) and tells the interviewer they are ready; the interviewer messages each writer in turn, and each writer runs the `agent-architect-publish` skill at its dispatched scope to write and commit its scoped artifacts (Steps 11–14). Orchestrator pushes the branch and opens a `feature-lockin`-labeled PR linked to the milestone at the very end (Step 15). **No scaffold step.**

## Initial input

The user may have provided a short description of the feature in the slash-command arguments: `$ARGUMENTS`. Treat that as the seed for `product-owner`. If empty, ask the user one sentence about what they want to build before spawning the team.

---

## Step 1 — Spin up the team with `product-owner` only

Use `TeamCreate` to start a team with exactly one teammate. Name + subagent_type match verbatim:

- teammate A: `name = "product-owner"`, `subagent_type = "product-owner"`

Naming is load-bearing — agents reference each other by name (e.g. `ui-ux-designer` and `architect` may message `product-owner` when their decision depends on product intent; `architect` messages each of the 4 writer teammates by name at Step 14 to dispatch the publish). Use the names exactly as listed in this command — do not abbreviate, do not pluralize, do not rename.

Tell the user once, in a single short sentence, that `product-owner` is up and Phase 1 is starting.

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
- A heads-up: after the requirements artifacts are committed, the orchestrator will ask you (PO) whether the feature warrants engaging `ui-ux-designer` (greenfield design system, create/edit user flows, visual-style shifts, etc.). Keep that decision in mind as the interview progresses; you do not need to surface it during the interview itself.
- **Do not dictate interview cadence.** Let `product-owner` choose how to pace questions (one per turn, batched, depth-first, etc.) — that is a product-discovery judgment call, not the orchestrator's.

---

## Step 3 — Hand control to `product-owner` for the interview

While `product-owner` is interviewing the user:

- Forward each user message to `product-owner` via `SendMessage`.
- Forward each `product-owner` reply back to the user verbatim (or as a thin pass-through — do not paraphrase or shortcut its questions).
- Do NOT answer product questions yourself. Do NOT skip ahead to design or architecture.
- **Do NOT answer on behalf of the user.** When `product-owner` asks the user a question, surface it and **stop** — wait for the human's actual reply. Auto mode does NOT authorize you to answer product-discovery questions for the user. Only the human can speak to user/persona, problem, success criteria, scope, non-goals, and edge cases.
- **Idle notifications are not action signals.** A teammate goes idle at the end of every turn — that is normal. A bare `idle_notification` arriving by itself does NOT mean the teammate failed to produce output; check whether a message from that teammate already arrived in the same turn-cycle. **Do not nudge, ping, or re-prompt a teammate on the basis of an idle notification alone.**

---

## Step 4 — Wait at the lock-requirements gate

When `product-owner` asks the user to lock requirements, **stop and wait for the user's explicit confirmation**. Acceptable signals: "lock", "lock it in", "approved", "yes go", or similar unambiguous yes. Anything else (questions, hedging, "maybe", new requirements) means **keep iterating** — forward the message back to `product-owner` and continue the interview loop.

Do not proceed to Step 5 without an explicit yes from the user.

---

## Step 5 — Orchestrator: feature name + branch preparation

By the end of this step you'll have a feature name, a milestone, and a clean worktree on a fresh branch off the latest `main`, ready for every teammate to write into.

**1. Get the feature name from `product-owner`.**

Send `product-owner` a short message: "User locked requirements. Propose the kebab-case `{feature-name}` we'll use for `docs/product-requirement-document/{feature-name}/` and the git branch. Reply with just the name." Do not write any files yet, do not commit.

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

Set only the title — leave description, due_on, and state at their defaults. The milestone is the umbrella for the lock-in PR (Step 15) and downstream slice/task issues created later by `create-issues`.

**4. Create the feature branch as a worktree off latest `origin/main`.**

The worktree always lives at `/tmp/git-worktree/<repo-name>/<feature-name>` — predictable, outside the repo, and easy to clean up.

```
repo_root="$(git rev-parse --show-toplevel)"
repo_name="$(basename "$repo_root")"
worktree_path="/tmp/git-worktree/${repo_name}/{feature-name}"
mkdir -p "/tmp/git-worktree/${repo_name}"
git -C "$repo_root" worktree add "$worktree_path" -b "docs/{feature-name}" origin/main
```

Record `{worktree_path}` — every teammate writes and commits inside it, and you push from it in Step 15. Branch is `docs/{feature-name}`. No commit, no push, no PR yet.

---

## Step 6 — `product-owner` writes artifacts and commits in the worktree

Now send `product-owner` a message instructing it to:

- **Work inside the worktree** at `{worktree_path}` — every file path, every `git` invocation must target that directory (e.g. `git -C {worktree_path} ...`). Do not touch the main repo checkout.
- Generate its artifacts under the new repo layout:
  - PRD at `docs/product-requirement-document/{feature-name}/requirement.md`
  - Critical Path (with the extend/supersede/new classification it already settled) under `docs/CRITICALPATHs/`
  - Glossary updates at `docs/GLOSSARY.md`
  - `CLAUDE.md` product-context update if warranted
- After writing, list the changed/deleted files to the user and **explicitly ask for user confirmation before committing**. Wait for an unambiguous yes ("commit", "approved", "yes go"); on any other reply, iterate on the artifacts and ask again.
- On user confirmation, commit on the current branch (`docs/{feature-name}`). Do not create a new branch, do not push, do not open a PR. Suggested commit message: `docs(prd): {feature-name} requirements`.

  ```
  git -C {worktree_path} add <changed-and-deleted-files>
  git -C {worktree_path} commit -m "docs(prd): {feature-name} requirements"
  ```

The orchestrator MUST respect this gate: when `product-owner` asks the user to confirm the commit, surface the question and **wait for the human's actual yes** — do not approve on the user's behalf. When `product-owner` reports the commit is done, surface the file list and commit hash to the user in one short message and move on to Step 7.

---

## Step 7 — Ask `product-owner` whether to engage `ui-ux-designer`

Right after the Phase 1 commit lands, send `product-owner` a short message asking it to decide whether the design phase should engage. The decision belongs to `product-owner` — not the orchestrator. Use phrasing close to:

> Requirements are committed. Based on the locked PRD, should we engage `ui-ux-designer` to lock in the design system before architecture? Consider: greenfield design (no `docs/DESIGNs/` yet), create/edit user flows, new top-level surfaces, or a visual-style shift. Reply with `engage` or `skip`, plus one short sentence of reasoning.

Surface `product-owner`'s answer to the user verbatim, then act on it:

- **`engage`** → continue to Step 8 (invite `ui-ux-designer`).
- **`skip`** → jump to Step 11 (invite `architect`). Do not write any `docs/DESIGNs/` files in this run.

If `product-owner`'s answer is ambiguous, ask it to clarify with a clean `engage` / `skip`; do not interpret on the user's behalf.

The decision is **sticky** — once `product-owner` answers, do not revisit it mid-run.

---

## Step 8 — Invite `ui-ux-designer` and brief

(Only when Step 7 returned `engage`. Otherwise jump to Step 11.)

Invite `ui-ux-designer` into the team. Name + subagent_type match verbatim (`name = "ui-ux-designer"`, `subagent_type = "ui-ux-designer"`).

Then send the initial brief via `SendMessage`. The brief MUST cover:

- The path to the artifacts `product-owner` just wrote and the exact files to read **first, before asking anything**:
  - `{worktree_path}/docs/product-requirement-document/{feature-name}/requirement.md`
  - the sibling Critical Path file under `{worktree_path}/docs/CRITICALPATHs/` (name it explicitly — orchestrator already knows which one from `product-owner`'s final-status message)
  - `{worktree_path}/docs/GLOSSARY.md`
- The instruction: **read those files in full, then list `{worktree_path}/docs/DESIGNs/`** to detect greenfield-vs-extension mode. Greenfield: design language is being established for the first time; pick a coherent direction and anchor every token to a reason. Extension: propose token/component reuse first, new tokens only when the existing palette/scale can't express the requirement.
- The instruction: **work inside the worktree** at `{worktree_path}` — every file path, every `git` invocation must target that directory.
- The instruction: **lead a design discovery conversation with the user**. Grill until the picture is clear across:
  1. **Product framing** — kind of product, primary user, dominant interaction pattern
  2. **Visual style direction** — referenced by name from `ui-ux-pro-max:ui-ux-pro-max` (minimalism, glassmorphism, bento, etc.)
  3. **Palette and contrast floor** — primary brand, surfaces, state colors; every interactive pair must declare WCAG contrast
  4. **Type system** — display / body / mono families, scale, fluid-scaling rule
  5. **Spacing scale, radii, shadows, motion** — including reduced-motion fallback
  6. **Component inventory** — only the components this feature's user stories actually need
  7. **Sample pages** — at least one screen-level sample drawn from this feature's user stories, plus a token/component overview page (`sample/index.html`)
- The instruction: **make recommendations** on every decision (recommendation + 1–2 alternatives + rationale, grounded in `ui-ux-pro-max:ui-ux-pro-max` references where applicable).
- The instruction: if any design question depends on **product intent**, message `product-owner` directly via `SendMessage` rather than asking the user.
- The instruction: **do not write artifacts yet**. The interview comes first.
- The instruction: when the design is ship-ready, **explicitly ask the user to "lock design"** before moving on.

---

## Step 9 — Hand control to `ui-ux-designer` for the interview

Same protocol as Step 3, but with `ui-ux-designer`. Forward user messages to `ui-ux-designer`, forward `ui-ux-designer`'s replies back. Do not answer design questions yourself. **Do NOT answer on behalf of the user** — when `ui-ux-designer` poses a question to the user, surface it and stop until the human replies. If `ui-ux-designer` messages `product-owner`, let that exchange happen between teammates.

---

## Step 10 — Wait at the lock-design gate, then `ui-ux-designer` writes and commits

When `ui-ux-designer` asks the user to lock design, **stop and wait for explicit user confirmation**. Anything short of a clear yes means keep iterating.

Once the user confirms lock-in, send `ui-ux-designer` a short message instructing it to:

- **Work inside the worktree** at `{worktree_path}` — same one `product-owner` committed in.
- Generate its artifacts under `docs/DESIGNs/` (overview, tokens, components, accessibility, sample pages), plus a `CLAUDE.md` design-context update if and only if this is the project's first design lock-in or a project-level token genuinely shifted.
- After writing, list the changed files to the user and **explicitly ask for user confirmation before committing**.
- On user confirmation, commit on the current branch (`docs/{feature-name}`). Suggested message: `docs(design): {feature-name} design system` (or `docs(design): establish design system for {feature-name}` for a greenfield design lock-in).

  ```
  git -C {worktree_path} add <changed-files>
  git -C {worktree_path} commit -m "docs(design): {feature-name} design system"
  ```

When `ui-ux-designer` reports the commit is done, surface the file list and commit hash to the user in one short message and move on to Phase 3.

---

## Step 11 — Invite `architect` and brief

Invite `architect` into the team. Name + subagent_type match verbatim (`name = "architect"`, `subagent_type = "architect"`). This agent runs in **plan mode** and is **read-only on disk** — it conducts the interview, partitions the settled decisions into ADR IDs, and composes **4 scoped dispatch prompts** for the 4 writer teammates the orchestrator will invite at Step 14.

Then send the initial brief via `SendMessage`. The brief MUST cover:

- The requirement file the architect should read first: `docs/product-requirement-document/{feature-name}/requirement.md` (and the sibling Critical Path / Glossary files).
- The architecture context the architect should survey: `docs/architecture-decision-record/README.md` (ADR index) and the existing C4 diagrams under `docs/architecture/`.
- The instruction: **work inside the worktree** at `{worktree_path}` — every read must target that directory.
- The instruction: **lead a technical discovery conversation with the user directly**. The orchestrator will not forward messages during the interview (see Step 12). The architect should expect to hear from the user directly.
- The instruction: if any technical question depends on product intent, message `product-owner` directly via `SendMessage`.
- The instruction: **do not write artifacts**. The architect is read-only. Artifact writing happens via **4 writer teammates** (all `subagent_type = doc-writer`, distinct names: `implement-detail-writer`, `adr-writer`, `api-contract-writer`, `data-model-writer`) that the orchestrator will invite at Step 14. The architect's job is to compose 4 scoped dispatch prompts at the end of `agent-architect-interview`, report that the interview is finished, and then — once the orchestrator confirms the writers are ready — send each scoped prompt to its matching writer via `SendMessage`.

Tell the user in one short sentence that `architect` is up and Phase 3 is starting.

---

## Step 12 — User talks to `architect` directly

Hand the conversation over to `architect`. **The orchestrator does not forward messages during this phase.** The user converses with `architect` directly; replies surface verbatim. The orchestrator's role here is purely passive:

- Do not interpose, paraphrase, or interpret either side.
- Do not answer architectural questions yourself.
- Do not answer on behalf of the user — the architect's questions land in front of the human and the human responds directly.
- Resume an active role only at Step 13, when the architect reports the interview is finished.

If the architect messages `product-owner` (e.g. when a technical decision depends on product intent), let that exchange happen between teammates; you do not need to mediate teammate-to-teammate messages.

---

## Step 13 — Wait for the architect to report the interview is finished

The `agent-architect-interview` skill ends with the architect:

1. Partitioning the settled decisions into ADR IDs.
2. Composing **4 scoped dispatch prompts** (one per writer scope: `implement-detail`, `adr`, `api-contract`, `data-model`).
3. Surfacing all 4 prompts in one turn and reporting that the interview is finished and the prompts are composed and ready to send.

This is the signal that the interview is done and the user has approved the design. **Do not advance to Step 14 until the architect reports "interview finished, dispatch prompts composed".** If the architect is still asking the user questions or has not yet reached the partition + 4-prompt composition, keep waiting.

The architect is now waiting on the orchestrator to confirm the 4 writers are ready before it sends any `SendMessage`.

---

## Step 14 — Invite the 4 writers, then tell the architect they are ready

Invite the four publisher teammates into the team. All four have `subagent_type = "doc-writer"` but **distinct names** — the name is the addressable identifier, the subagent_type is the underlying agent:

- `name = "implement-detail-writer"`, `subagent_type = "doc-writer"` — owns `implement-detail.md`.
- `name = "adr-writer"`, `subagent_type = "doc-writer"` — owns ADR files + ADR index + C4 diagrams + the optional `CLAUDE.md` architecture-context update.
- `name = "api-contract-writer"`, `subagent_type = "doc-writer"` — owns the OpenAPI 3.1 contract files.
- `name = "data-model-writer"`, `subagent_type = "doc-writer"` — owns the ODCS v3.1 data-model files.

Then send a short message to `architect`:

> Writers are ready: `implement-detail-writer`, `adr-writer`, `api-contract-writer`, `data-model-writer`. Send each of the 4 scoped dispatch prompts you composed at the end of `agent-architect-interview` to its matching writer via `SendMessage`. Use the names exactly as listed; do not modify the prompts — send them verbatim. The worktree is `{worktree_path}`.

`architect` sends 4 separate `SendMessage` calls, one per writer. Each writer receives its scoped dispatch prompt, inspects the trigger phrase, and routes it to the `agent-architect-publish` skill — which runs **only** the artifact sub-block(s) belonging to the dispatched scope:

- `implement-detail-writer` writes `docs/product-requirement-document/{feature-name}/implement-detail.md` and commits `docs(prd): {feature-name} implement-detail`.
- `adr-writer` writes the ADRs under `docs/architecture-decision-record/`, updates the index, updates the C4 diagrams under `docs/architecture/`, and updates `CLAUDE.md` if the architect flagged topology shift. Commits `docs(adr): ADR-{NNNN} <title>` (or `docs(adr): ADR-{NNNN}..{MMMM} {feature-name} architecture` for a batch).
- `api-contract-writer` writes/updates the OpenAPI files under `docs/api-contract/` (`_shared.yaml` if missing, plus per-resource files) and commits `docs(api): {feature-name} api contracts`.
- `data-model-writer` writes/updates the ODCS files under `docs/data-model/` and commits `docs(data): {feature-name} data models`.

Each writer:

1. Generates its scoped artifacts.
2. **Asks the user to confirm the file list** (the publish skill's hand-back step). The user replies directly to the writer; the orchestrator does not interpose.
3. On user confirmation, commits its scoped changes on `docs/{feature-name}` with the scope-appropriate Conventional Commits subject above.
4. Reports final status (commit hash, file paths written and deleted).

If a writer's scope has nothing to write (e.g. the feature exposes no API surface, so `api-contract-writer`'s dispatch tells it so), that writer reports "scope no-op" and produces no commit — that is expected; the orchestrator surfaces the no-op without trying to fix it.

The 4 writers are independent and may run concurrently — they touch disjoint files. As each writer reports back, surface its commit hash (or no-op note) to the user. When **all 4 writers have reported**, surface a consolidated commit list and move on to Step 15.

The orchestrator MUST respect each writer's user-confirmation gate: do not approve commits on the user's behalf. The orchestrator owns invites + signaling readiness; the architect owns dispatching; the writers own contents and commits.

---

## Step 15 — Orchestrator: push and open the lock-in PR

The branch already exists (created in Step 5) and every engaged teammate's commits already landed on it (Step 6 for `product-owner`, Step 10 for `ui-ux-designer` if it engaged, Step 14 for each of the 4 writer teammates that had artifacts to write). All that's left is to push and open the PR.

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
- PRD: `docs/product-requirement-document/{feature-name}/requirement.md`
- Critical Path update: ...
- Glossary update: ...
- Design system (if design phase ran): `docs/DESIGNs/overview.md`, `docs/DESIGNs/tokens.md`, `docs/DESIGNs/components.md`, `docs/DESIGNs/accessibility.md`, and sample pages under `docs/DESIGNs/sample/` — list whichever were written/updated; omit this bullet if the design phase was skipped at Step 7.
- ADR-{NNNN}: ... (under `docs/architecture-decision-record/`)
- Implementation detail: `docs/product-requirement-document/{feature-name}/implement-detail.md`
- C4 diagrams (any updated): `docs/architecture/c4-*.puml`
- API contracts (any updated): `docs/api-contract/*.yaml`
- Data models (any updated): `docs/data-model/*.yaml`
- CLAUDE.md updates: ...
- Superseded ADRs (if any): ...

## Test plan
- [ ] documentation only — no feature code changes
- [ ] (if design commits landed) sample HTML pages under `docs/DESIGNs/sample/` open in a browser and visually mirror `docs/DESIGNs/tokens.md` / `components.md`
EOF
)
```

PR title: **human-readable** (e.g. `docs({feature-name}): lock requirements + architecture`). Do **not** use the literal string `feature lockin` — the lock-in marker is the **`feature-lockin` label**, not the title. Downstream skills (`create-issues`) query by that label.

The milestone (`{feature-name}`) was created in Step 5 — gh resolves it by title.

Confirm the PR URL back to the user in one short sentence and stop.

---

## Guardrails

- **Grow the team one phase at a time.** Step 1 spins up `product-owner` only. `ui-ux-designer` joins at Step 8 (and only when `product-owner` calls for it at Step 7). `architect` joins at Step 11. The 4 writer teammates (`implement-detail-writer`, `adr-writer`, `api-contract-writer`, `data-model-writer` — all `subagent_type = doc-writer`) join at Step 14. Do not pre-create teammates; do not skip an invite; do not collapse the 4 writers into one.
- **Name = subagent_type, except for the writers.** Every non-writer teammate has `name` equal to `subagent_type`. The 4 writers are the exception: all share `subagent_type = "doc-writer"` but have distinct names (`implement-detail-writer`, `adr-writer`, `api-contract-writer`, `data-model-writer`). The name is the addressable identifier the architect uses with `SendMessage`; the subagent_type is the underlying agent that routes by inspecting the dispatch trigger phrase.
- **`product-owner` owns the design-phase decision.** Step 7 asks `product-owner` for an `engage` / `skip` verdict; the orchestrator does not apply deterministic rules. Once `product-owner` answers, the decision is sticky.
- **`architect` is read-only and runs in plan mode.** It never writes files, never commits. It composes 4 scoped dispatch prompts at the end of `agent-architect-interview`, reports the interview is finished, then — once the orchestrator confirms writers are ready at Step 14 — sends each prompt to its matching writer via `SendMessage`. Artifact writing and committing is done by the 4 writers via the `agent-architect-publish` skill (one scoped invocation per writer).
- **Step 12 is direct.** During the architect's interview, the orchestrator does not forward messages — the user talks to `architect` directly. The orchestrator resumes an active role only at Step 13 (interview-finished signal) and Step 14 (invite writers + signal readiness).
- **No scaffold step.** This command does not run any scaffold gate, does not invoke `scaffold-project`, and does not produce `chore(scaffold): <surface>` commits. Scaffold is a different lane.
- **Never answer for a teammate.** Route product questions to `product-owner`, design questions to `ui-ux-designer`, technical questions to `architect`. If a question comes in for an agent whose phase is over, note it for the active phase or surface it back as out-of-scope for this run — don't answer it yourself.
- **Never answer for the human.** When a teammate asks the user a question, your job is to surface it and wait. Do not simulate, infer, fabricate, or best-guess from `$ARGUMENTS`, the seed sentence, prior turns, the codebase, memory files, or your own intuition. If you don't have a literal reply from the human in the most recent user turn, you do not have an answer — pause and let the user respond. This rule overrides auto mode: auto mode applies to *your* execution decisions, not to product, design, or architectural decisions that belong to the user.
- **Never skip a lock gate.** "lock requirements" (Step 4), "lock design" (Step 10, if engaged), and the implicit lock-decisions gate inside `agent-architect-interview` each require explicit user confirmation from the human — not your inference of consent.
- **Never invoke the `git-workflow` skill from this command.** Every `git` / `gh` action in this flow — sync, milestone, worktree creation, agent commits, push, PR — is run inline as shown, by the orchestrator or the agent.
- **Commits land on the feature branch in the worktree, never on `main`.** The orchestrator creates the `docs/{feature-name}` branch as a worktree in Step 5 *before* any agent writes a file. Every agent that engages works and commits inside that worktree.
- **Pass-through, don't paraphrase** (Steps 3 and 9). Forwarding teammate messages: keep the substance. Step 12 is different — there's no forwarding at all there; the user talks directly.
- **Don't nudge on idle alone.** A bare `idle_notification` from a teammate is normal turn-end behavior, NOT a "no output" signal.
- **Don't dictate teammate working style.** Briefs should set goals and constraints, not micro-manage cadence.
- **Stop on user dissent.** If the user says "stop", "abort", or otherwise withdraws, halt cleanly — do not write artifacts, do not commit, do not open a PR.
