---
description: Deep-dive a new feature end-to-end — product discovery with `product-owner`, then technical discovery with `architect`. Orchestrator creates a feature branch in a worktree after product lock-in; each teammate writes and commits its own artifacts in that worktree; orchestrator opens a single PR at the end.
argument-hint: [optional: short description of the feature]
---

# deep-dive-feature

Orchestrate a two-phase deep-dive on a new feature. Phase 1 is product discovery, owned by the `product-owner` teammate. Phase 2 is technical discovery, owned by the `architect` teammate. Phase 3 records both decisions in git as a single labeled lock-in PR.

You (the orchestrator) coordinate the phases, gate on explicit user confirmation between them, and ferry messages between the user and the active teammate. Do **not** answer product or architectural questions yourself — route them to the right teammate. Equally important: do **not** answer on behalf of the user when a teammate asks the user a question — always wait for the human's actual reply.

Git flow at a glance: orchestrator creates a milestone and a worktree-backed feature branch after Phase 1 lock-in (Step 5). `product-owner` writes and commits its artifacts inside that worktree (Step 6). `architect` writes and commits its artifacts inside the same worktree (Step 10). Orchestrator pushes the branch and opens a `feature-lockin`-labeled PR linked to the milestone at the very end (Step 11).

## Initial input

The user may have provided a short description of the feature in the slash-command arguments: `$ARGUMENTS`. Treat that as the seed for `product-owner`. If empty, ask the user one sentence about what they want to build before spawning the team.

---

## Step 1 — Spin up the team

Use `TeamCreate` to create a team with exactly two teammates. Both teammates' `name` field MUST match their `subagent_type` field verbatim:

- teammate A: `name = "product-owner"`, `subagent_type = "product-owner"`
- teammate B: `name = "architect"`, `subagent_type = "architect"`

This naming is load-bearing — the agents reference each other by name (e.g. `architect` may message `product-owner` when a technical question depends on product intent), and identical name/subagent_type makes that addressing unambiguous.

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

The orchestrator MUST respect this gate: when `product-owner` asks the user to confirm the commit, surface the question and **wait for the human's actual yes** — do not approve on the user's behalf. When `product-owner` reports the commit is done, surface the file list and commit hash to the user in one short message and move on to Phase 2.

---

## Step 7 — Brief `architect`

Send the initial brief to `architect` via `SendMessage`. The brief MUST cover:

- The path to the requirement file `product-owner` just wrote (typically `docs/PRDs/{feature-name}/requirement.md`) and the sibling Critical Path / Glossary files. `architect` should read those before asking anything.
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

## Step 8 — Hand control to `architect` for the interview

Same protocol as Step 3, but with `architect`. Forward user messages to `architect`, forward `architect`'s replies back. Do not answer architectural questions yourself. **Do NOT answer on behalf of the user** — when `architect` poses a question to the user (e.g. acceptable p95, target scale, security posture, rollout risk tolerance), surface it and stop until the human replies. Do not infer answers from the PRD, codebase, prior architecture, memory, or "reasonable assumptions"; auto mode does not authorize you to make these calls for the user. If `architect` messages `product-owner`, let that exchange happen between teammates — you don't need to mediate teammate-to-teammate messages, but do surface to the user any product-side change that comes out of it.

---

## Step 9 — Wait at the lock-decisions gate

Same protocol as Step 4. When `architect` asks the user to lock decisions, **stop and wait for explicit user confirmation**. Anything short of a clear yes means keep iterating.

---

## Step 10 — `architect` writes artifacts and commits in the same worktree

Once the user confirms lock-in, send `architect` a short message instructing it to:
- **Work inside the worktree** at `{worktree_path}` — same one `product-owner` used. Every file path, every `git` invocation must target that directory (e.g. `git -C {worktree_path} ...`). Do not touch the main repo checkout.
- Generate its artifacts: ADR (next zero-padded number, supersede set if any), `docs/ARDs/README.md` index update, `docs/PRDs/{feature-name}/implement-detail.md`, per-entity `data-models/` and `api-contracts/` files, and CLAUDE.md architecture-context update if warranted. If any ADR is being superseded, the superseded `.md` file must be deleted per the agent's own rules.
- After writing, list the changed/deleted files to the user and **explicitly ask for user confirmation before committing**. Wait for an unambiguous yes ("commit", "approved", "yes go"); on any other reply (questions, edits, "wait"), iterate on the artifacts and ask again.
- On user confirmation, commit on the current branch (`docs/{feature-name}`). Do not create a new branch, do not push, do not open a PR. Suggested commit message: `docs(adr): ADR-{NNNN} <short decision title>`. Concretely:

  ```
  git -C {worktree_path} add <changed-and-deleted-files>
  git -C {worktree_path} commit -m "docs(adr): ADR-{NNNN} <short decision title>"
  ```

The orchestrator MUST respect this gate: when `architect` asks the user to confirm the commit, surface the question and **wait for the human's actual yes** — do not approve on the user's behalf. When `architect` reports the commit is done, surface the file list and commit hash to the user in one short message and move on to Step 11.

---

## Step 11 — Orchestrator: push and open the lock-in PR

The branch already exists (created in Step 5) and both teammates' commits already landed on it (Steps 6 and 10). All that's left is to push and open the PR.

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
- ADR-{NNNN}: ...
- Implementation detail: `docs/PRDs/{feature-name}/implement-detail.md`
- Per-entity data-models / api-contracts: ...
- CLAUDE.md updates: ...
- Superseded ADRs: ...

## Test plan
- [ ] documentation-only — no code changes
EOF
)
```

PR title: **human-readable** (e.g. `docs({feature-name}): lock requirements + architecture`). Do **not** use the literal string `feature lockin` — the lock-in marker is the **`feature-lockin` label**, not the title. Downstream skills (`create-issues`) query by that label.

The milestone (`{feature-name}`) was created in Step 5 — gh resolves it by title.

Confirm the PR URL back to the user in one short sentence and stop.

---

## Guardrails

- **Never answer for a teammate.** If the user asks a product question while `architect` is active, route it to `product-owner`. If they ask a technical question while `product-owner` is active, note it for Phase 2 — don't answer it yourself.
- **Never answer for the human.** When a teammate asks the user a question, your job is to surface it and wait. Do not simulate, infer, fabricate, or "best-guess" the user's answer from `$ARGUMENTS`, the seed sentence, prior turns, the codebase, memory files, or your own intuition. If you don't have a literal reply from the human in the most recent user turn, you do not have an answer — pause and let the user respond. This rule overrides auto mode: auto mode applies to *your* execution decisions, not to product or architectural decisions that belong to the user.
- **Never skip a lock gate.** Both "lock requirements" and "lock decisions" require explicit user confirmation from the human — not your inference of consent. No silent advancement.
- **Never invoke the `git-workflow` skill from this command.** Every `git` / `gh` action in this flow — sync, milestone, worktree creation, agent commits, push, PR — is run inline as shown in the relevant step, by the orchestrator or the agent. Neither orchestrator nor agents delegate to `git-workflow` anywhere in `/deep-dive-feature`.
- **Commits land on the feature branch in the worktree, never on `main`.** The orchestrator creates the `docs/{feature-name}` branch as a worktree in Step 5 *before* either agent writes a file. Both agents work and commit inside that worktree (Steps 6, 10) using inline `git` commands. Never let either agent commit before the worktree exists, and never let either agent push or open a PR — the push and PR are the orchestrator's job in Step 11.
- **Pass-through, don't paraphrase.** Forwarding teammate messages: keep the substance. The user is in the loop and reading every turn.
- **Don't nudge on idle alone.** A bare `idle_notification` from a teammate is normal turn-end behavior, NOT a "no output" signal. Check for an actual message in the same turn-cycle before assuming silence; nudging on idle alone causes teammates to re-send and re-bundle prior questions, polluting the interview. If the teammate's last substantive message is unanswered, the next move belongs to the user — not to you.
- **Don't dictate teammate working style.** Briefs should set goals and constraints, not micro-manage cadence (e.g. "group questions", "ask one at a time"). Each teammate's defaults are tuned for its role; trust them.
- **Stop on user dissent.** If the user says "stop", "abort", or otherwise withdraws, halt cleanly — do not write artifacts, do not commit, do not open a PR. Report what was discussed and exit.
