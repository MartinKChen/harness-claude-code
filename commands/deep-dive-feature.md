---
description: Deep-dive a new feature end-to-end — product discovery with `product-owner` (read-only), then architecture discovery with `architect` (read-only). Each interviewer composes scoped dispatch prompts and the orchestrator invites writer teammates accordingly: `product-owner` dispatches `requirement-writer` (`subagent_type = doc-writer`); `architect` dispatches 4 architecture writers (`implement-detail-writer`, `adr-writer`, `api-contract-writer`, `data-model-writer` — all `subagent_type = doc-writer`); each writer publishes and commits its scoped artifacts. Orchestrator creates a feature branch in a worktree after Phase 1 interview-finished; every writer's commits land there; orchestrator opens a single lock-in PR at the end.
argument-hint: [optional: short description of the feature]
---

# deep-dive-feature

Orchestrate a deep-dive on a new feature, in two sequential phases. Phase 1 is product discovery, owned by the `product-owner` teammate (read-only); when its interview lands, the orchestrator brings the `requirement-writer` teammate (`subagent_type = doc-writer`) into the team, and `product-owner` dispatches it to publish and commit the PRD, critical-path file, glossary updates, and any `CLAUDE.md` product-context update. Phase 2 is technical discovery, owned by the `architect` teammate (read-only); when its interview lands, the orchestrator brings 4 architecture writer teammates into the team (all `subagent_type = doc-writer`, scoped by name to implement-detail / ADR / API contracts / data model), then `architect` messages each one directly to publish and commit its scoped artifacts. The final phase records every decision in git as a single labeled lock-in PR.

You (the orchestrator) coordinate the phases, gate on explicit user confirmation at the lock points, and grow the team one teammate at a time as each phase opens. Do **not** answer product or architectural questions yourself — route them to the right teammate. Equally important: do **not** answer on behalf of the user when a teammate asks the user a question — always wait for the human's actual reply.

Git flow at a glance: `product-owner` interviews the user directly until the requirement is locked and a kebab-case `<feature-name>` is proposed (Steps 1–4). Orchestrator creates a milestone and a worktree-backed feature branch off latest `main` (Step 5), then invites `requirement-writer` (`subagent_type = doc-writer`) and tells `product-owner` the writer is ready; `product-owner` dispatches the prompt and `requirement-writer` runs the `agent-product-owner-publish` skill to write and commit the PRD, critical-path file, glossary, and any `CLAUDE.md` product-context update inside the worktree (Step 6). `architect` is invited into the team for technical discovery (Step 7); when its interview lands and it composes 4 scoped dispatch prompts, the orchestrator invites 4 architecture writer teammates (`implement-detail-writer`, `adr-writer`, `api-contract-writer`, `data-model-writer` — all `subagent_type = doc-writer`) and tells the interviewer they are ready; the interviewer messages each writer in turn, and each writer runs the `agent-architect-publish` skill at its dispatched scope to write and commit its scoped artifacts (Steps 7–10). Orchestrator pushes the branch and opens a `feature-lockin`-labeled PR linked to the milestone at the very end (Step 11). **No scaffold step.** Design-system generation is intentionally out of scope for this command — run the design flow separately when needed.

## Initial input

The user may have provided a short description of the feature in the slash-command arguments: `$ARGUMENTS`. Treat that as the seed for `product-owner`. If empty, ask the user one sentence about what they want to build before spawning the team.

---

## Step 1 — Spin up the team with `product-owner` only

Use `TeamCreate` to start a team with exactly one teammate. Name + subagent_type match verbatim:

- teammate A: `name = "product-owner"`, `subagent_type = "product-owner"`

Naming is load-bearing — agents reference each other by name (e.g. `architect` may message `product-owner` when its decision depends on product intent; `architect` messages each of the 4 writer teammates by name at Step 10 to dispatch the publish). Use the names exactly as listed in this command — do not abbreviate, do not pluralize, do not rename.

Tell the user once, in a single short sentence, that `product-owner` is up and Phase 1 is starting.

---

## Step 2 — Brief `product-owner`

Send the initial brief to `product-owner` via `SendMessage`. The brief MUST cover:

- The user's seed description (whatever you have from `$ARGUMENTS` or the one-sentence reply).
- The instruction: **talk to the user directly**. The orchestrator will not forward messages during the interview phase (see Step 3) — `product-owner`'s questions land in front of the human and the human responds directly.
- The instruction: **lead a product discovery conversation with the user**. Grill them until you have a clear view of all six axes:
  1. **User / persona** — who specifically experiences the problem
  2. **Problem** — what hurts today, in the user's words
  3. **Success criteria** — how we'll know this worked, measurably
  4. **Scope (in)** — what this feature does
  5. **Scope (out) / non-goals** — what it explicitly does NOT do
  6. **Edge cases** — boundary conditions, failure paths, weird inputs
- The instruction: when you believe the picture is clear on all six axes, **explicitly ask the user to "lock requirements"** before composing the dispatch prompt.
- The instruction: **do not write artifacts**. `product-owner` is read-only on disk. Artifact writing happens via a writer teammate (`name = "requirement-writer"`, `subagent_type = "doc-writer"`) that the orchestrator will invite at Step 6. `product-owner`'s job is to compose **one scoped dispatch prompt** at the end of `agent-product-owner-interview`, propose the kebab-case `<feature-name>`, report that the interview is finished, and then — once the orchestrator confirms the writer is ready at Step 6 — send the dispatch prompt to `requirement-writer` via `SendMessage`.
- **Do not dictate interview cadence.** Let `product-owner` choose how to pace questions (one per turn, batched, depth-first, etc.) — that is a product-discovery judgment call, not the orchestrator's.

---

## Step 3 — User talks to `product-owner` directly

Hand the conversation over to `product-owner`. **The orchestrator does not forward messages during this phase.** The user converses with `product-owner` directly; replies surface verbatim. The orchestrator's role here is purely passive:

- Do not interpose, paraphrase, or interpret either side.
- Do not answer product questions yourself. Do not skip ahead to architecture.
- Do not answer on behalf of the user — `product-owner`'s questions land in front of the human and the human responds directly.
- Resume an active role only at Step 4, when `product-owner` reports the interview is finished and the dispatch prompt is composed.

---

## Step 4 — Wait for `product-owner` to report the interview is finished

The `agent-product-owner-interview` skill ends with `product-owner`:

1. Receiving an explicit "lock requirements" approval from the user.
2. Classifying the new flow against existing critical paths (extend / supersede / brand new).
3. Proposing the kebab-case `<feature-name>` to be used for `docs/product-requirement-document/<feature-name>/` and the git branch.
4. Composing **one scoped dispatch prompt** for `requirement-writer` (`subagent_type = doc-writer`) covering the PRD, critical-path file, glossary updates, and the optional `CLAUDE.md` product-context update.
5. Surfacing the dispatch prompt and the proposed feature name in one turn and reporting that the interview is finished and the prompt is composed and ready to send.

This is the signal that the interview is done and the user has approved the requirement. **Do not advance to Step 5 until `product-owner` reports "interview finished, dispatch prompt composed".** If `product-owner` is still asking the user questions or has not yet reached the dispatch-prompt composition, keep waiting.

`product-owner` is now waiting on the orchestrator to confirm the writer is ready before it sends any `SendMessage`.

---

## Step 5 — Orchestrator: milestone + branch preparation

`product-owner`'s Step 4 report already includes the proposed kebab-case `{feature-name}`. By the end of this step you'll have a milestone and a clean worktree on a fresh branch off the latest `main`, ready for `requirement-writer` (and every downstream writer) to commit into.

**1. Normalize the feature name.**

If the name `product-owner` proposed looks malformed (spaces, capitals, special chars), normalize it to kebab-case before using it. Surface the chosen name to the user in one short sentence (e.g. "Using `payment-retry-flow` — proceeding") and move on.

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

Record `{worktree_path}` — every teammate writes and commits inside it, and you push from it in Step 11. Branch is `docs/{feature-name}`. No commit, no push, no PR yet.

---

## Step 6 — Invite `requirement-writer`, then tell `product-owner` they are ready

Invite the writer teammate into the team. `name = "requirement-writer"`, `subagent_type = "doc-writer"`. The name is the addressable identifier `product-owner` will use with `SendMessage`; the subagent_type is the underlying agent that routes by inspecting the dispatch trigger phrase.

Then send a short message to `product-owner` (substituting the actual `{worktree_path}` value from Step 5):

> Writer is ready: `requirement-writer`. The worktree is `{worktree_path}`. Send the scoped dispatch prompt you composed at the end of `agent-product-owner-interview` to `requirement-writer` via `SendMessage` — replace the `{worktree_path}` placeholder in your prompt with the path above, then send the rest verbatim. Do not modify any other content; do not send to any other teammate.

`product-owner` sends one `SendMessage(to=requirement-writer)` call with the dispatch prompt. The writer then:

1. Generates its artifacts inside the worktree at `{worktree_path}` — every file path, every `git` invocation targets that directory (e.g. `git -C {worktree_path} ...`).
2. **Asks the user to confirm the file list** (the publish skill's hand-back step). The user replies directly to the writer; the orchestrator does not interpose.
3. On user confirmation, commits on `docs/{feature-name}` with the Conventional Commits subject `docs(prd): {feature-name} requirements`:

   ```
   git -C {worktree_path} add <changed-and-deleted-files>
   git -C {worktree_path} commit -m "docs(prd): {feature-name} requirements"
   ```

4. Reports final status (commit hash, file paths written and deleted).

The orchestrator MUST respect the writer's user-confirmation gate: do not approve commits on the user's behalf. The orchestrator owns invites + signaling readiness; `product-owner` owns dispatching; `requirement-writer` owns contents and the commit.

When `requirement-writer` reports the commit is done, surface the file list and commit hash to the user in one short message and move on to Step 7.

---

## Step 7 — Invite `architect` and brief

Invite `architect` into the team. Name + subagent_type match verbatim (`name = "architect"`, `subagent_type = "architect"`). This agent runs in **plan mode** and is **read-only on disk** — it conducts the interview, partitions the settled decisions into ADR IDs, and composes **4 scoped dispatch prompts** for the 4 writer teammates the orchestrator will invite at Step 10.

Then send the initial brief via `SendMessage`. The brief MUST cover:

- The requirement file the architect should read first: `docs/product-requirement-document/{feature-name}/requirement.md` (and the sibling Critical Path / Glossary files).
- The architecture context the architect should survey: `docs/architecture-decision-record/README.md` (ADR index) and the existing C4 diagrams under `docs/architecture/`.
- The instruction: **work inside the worktree** at `{worktree_path}` — every read must target that directory.
- The instruction: **lead a technical discovery conversation with the user directly**. The orchestrator will not forward messages during the interview (see Step 8). The architect should expect to hear from the user directly.
- The instruction: if any technical question depends on product intent, message `product-owner` directly via `SendMessage`.
- The instruction: **do not write artifacts**. The architect is read-only. Artifact writing happens via **4 writer teammates** (all `subagent_type = doc-writer`, distinct names: `implement-detail-writer`, `adr-writer`, `api-contract-writer`, `data-model-writer`) that the orchestrator will invite at Step 10. The architect's job is to compose 4 scoped dispatch prompts at the end of `agent-architect-interview`, report that the interview is finished, and then — once the orchestrator confirms the writers are ready — send each scoped prompt to its matching writer via `SendMessage`.

Tell the user in one short sentence that `architect` is up and Phase 2 is starting.

---

## Step 8 — User talks to `architect` directly

Hand the conversation over to `architect`. **The orchestrator does not forward messages during this phase.** The user converses with `architect` directly; replies surface verbatim. The orchestrator's role here is purely passive:

- Do not interpose, paraphrase, or interpret either side.
- Do not answer architectural questions yourself.
- Do not answer on behalf of the user — the architect's questions land in front of the human and the human responds directly.
- Resume an active role only at Step 9, when the architect reports the interview is finished.

If the architect messages `product-owner` (e.g. when a technical decision depends on product intent), let that exchange happen between teammates; you do not need to mediate teammate-to-teammate messages.

---

## Step 9 — Wait for the architect to report the interview is finished

The `agent-architect-interview` skill ends with the architect:

1. Partitioning the settled decisions into ADR IDs.
2. Composing **4 scoped dispatch prompts** (one per writer scope: `implement-detail`, `adr`, `api-contract`, `data-model`).
3. Surfacing all 4 prompts in one turn and reporting that the interview is finished and the prompts are composed and ready to send.

This is the signal that the interview is done and the user has approved the architecture. **Do not advance to Step 10 until the architect reports "interview finished, dispatch prompts composed".** If the architect is still asking the user questions or has not yet reached the partition + 4-prompt composition, keep waiting.

The architect is now waiting on the orchestrator to confirm the 4 writers are ready before it sends any `SendMessage`.

---

## Step 10 — Invite the 4 writers, then tell the architect they are ready

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

The 4 writers are independent and may run concurrently — they touch disjoint files. As each writer reports back, surface its commit hash (or no-op note) to the user. When **all 4 writers have reported**, surface a consolidated commit list and move on to Step 11.

The orchestrator MUST respect each writer's user-confirmation gate: do not approve commits on the user's behalf. The orchestrator owns invites + signaling readiness; the architect owns dispatching; the writers own contents and commits.

---

## Step 11 — Orchestrator: push and open the lock-in PR

The branch already exists (created in Step 5) and every writer teammate's commits already landed on it (Step 6 for `requirement-writer`, Step 10 for each of the 4 architecture writer teammates that had artifacts to write). All that's left is to push and open the PR.

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
- ADR-{NNNN}: ... (under `docs/architecture-decision-record/`)
- Implementation detail: `docs/product-requirement-document/{feature-name}/implement-detail.md`
- C4 diagrams (any updated): `docs/architecture/c4-*.puml`
- API contracts (any updated): `docs/api-contract/*.yaml`
- Data models (any updated): `docs/data-model/*.yaml`
- CLAUDE.md updates: ...
- Superseded ADRs (if any): ...

## Test plan
- [ ] documentation only — no feature code changes
EOF
)
```

PR title: **human-readable** (e.g. `docs({feature-name}): lock requirements + architecture`). Do **not** use the literal string `feature lockin` — the lock-in marker is the **`feature-lockin` label**, not the title. Downstream skills (`create-issues`) query by that label.

The milestone (`{feature-name}`) was created in Step 5 — gh resolves it by title.

Confirm the PR URL back to the user in one short sentence and stop.

---

## Guardrails

- **Grow the team one phase at a time.** Step 1 spins up `product-owner` only. `requirement-writer` (`subagent_type = doc-writer`) joins at Step 6. `architect` joins at Step 7. The 4 architecture writer teammates (`implement-detail-writer`, `adr-writer`, `api-contract-writer`, `data-model-writer` — all `subagent_type = doc-writer`) join at Step 10. Do not pre-create teammates; do not skip an invite; do not collapse multiple writers into one.
- **Name = subagent_type, except for the writers.** Every non-writer teammate has `name` equal to `subagent_type`. The writers are the exception: all share `subagent_type = "doc-writer"` but have distinct names (`requirement-writer` for Phase 1, and `implement-detail-writer`, `adr-writer`, `api-contract-writer`, `data-model-writer` for Phase 2). The name is the addressable identifier the dispatching interviewer uses with `SendMessage`; the subagent_type is the underlying agent that routes by inspecting the dispatch trigger phrase.
- **Design system is out of scope.** This command intentionally does not invite `ui-ux-designer` or write anything under `docs/DESIGNs/`. Design-system generation is isolated from the feature flow — if the feature warrants it, run the dedicated design flow separately, before or after this command.
- **`product-owner` is read-only and runs in plan mode.** It never writes files, never commits. It composes one scoped dispatch prompt at the end of `agent-product-owner-interview`, proposes the kebab-case `<feature-name>`, reports the interview is finished, then — once the orchestrator confirms `requirement-writer` is ready at Step 6 — sends the prompt to the writer via `SendMessage`. Artifact writing and committing is done by `requirement-writer` via the `agent-product-owner-publish` skill.
- **`architect` is read-only and runs in plan mode.** It never writes files, never commits. It composes 4 scoped dispatch prompts at the end of `agent-architect-interview`, reports the interview is finished, then — once the orchestrator confirms writers are ready at Step 10 — sends each prompt to its matching writer via `SendMessage`. Artifact writing and committing is done by the 4 writers via the `agent-architect-publish` skill (one scoped invocation per writer).
- **Step 3 and Step 8 are direct.** During `product-owner`'s and `architect`'s interviews, the orchestrator does not forward messages — the user talks to the active teammate directly. The orchestrator resumes an active role only at the interview-finished signal (Step 4 / Step 9) and at writer-invite time (Step 6 / Step 10).
- **Never answer for a teammate.** Route product questions to `product-owner`, technical questions to `architect`. If a question comes in for an agent whose phase is over, note it for the active phase or surface it back as out-of-scope for this run — don't answer it yourself.
- **Never answer for the human.** When a teammate asks the user a question, your job is to surface it and wait. Do not simulate, infer, fabricate, or best-guess from `$ARGUMENTS`, the seed sentence, prior turns, the codebase, memory files, or your own intuition. If you don't have a literal reply from the human in the most recent user turn, you do not have an answer — pause and let the user respond. This rule overrides auto mode: auto mode applies to *your* execution decisions, not to product or architectural decisions that belong to the user.
- **Never skip a lock gate.** The implicit "lock requirements" gate inside `agent-product-owner-interview` and the implicit lock-decisions gate inside `agent-architect-interview` each require explicit user confirmation from the human — not your inference of consent.
- **Commits land on the feature branch in the worktree, never on `main`.** The orchestrator creates the `docs/{feature-name}` branch as a worktree in Step 5 *before* any agent writes a file. Every agent that engages works and commits inside that worktree.
- **Don't nudge on idle alone.** A bare `idle_notification` from a teammate is normal turn-end behavior, NOT a "no output" signal.
- **Don't dictate teammate working style.** Briefs should set goals and constraints, not micro-manage cadence.
- **Stop on user dissent.** If the user says "stop", "abort", or otherwise withdraws, halt cleanly — do not write artifacts, do not commit, do not open a PR.
