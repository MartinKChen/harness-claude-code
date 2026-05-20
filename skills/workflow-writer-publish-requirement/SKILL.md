---
name: workflow-writer-publish-requirement
description: "Materialize and commit every artifact for an approved product requirement: the PRD at `docs/product-requirement-document/<feature-name>/requirement.md`, the critical-path file under `docs/critical-path/` (extend / supersede / new), glossary updates in `docs/GLOSSARY.md`, and the optional product-context section of `CLAUDE.md`. Commits on the current branch; no PR. Activate on '/workflow-writer-publish-requirement'."
---

# workflow-writer-publish-requirement

Materialize every output of an approved product-requirement interview and commit them on the current branch. Owns: the feature's PRD, the critical-path file (newly created, edited-in-place, or written-and-superseded), glossary updates, the optional `CLAUDE.md` product-context update, and the inline commit on the current branch.

This skill **assumes the requirement is already clarified and approved** with the user via `workflow-product-owner-interview` (or an equivalent explicit lock-in). It does not run a discovery interview, does not push, and does not open a PR.

## When to activate

Activate this skill whenever:

- The dispatch prompt opens with `Publish product requirement for <feature-name>` and the conversation history (or referenced interview notes) already carries a clarified, approved requirement plus a critical-path classification.
- The user has explicitly approved a clarified requirement in this conversation and asks to write it out.
- The user types `/workflow-writer-publish-requirement`, or phrases like 'generate the PRD and critical-path for this requirement', 'write the product artifacts', 'commit the requirement we just clarified'.

Do NOT activate when:

- The requirement is not yet clarified — stop and surface that the interview must run first; do not begin generating artifacts from a half-formed requirement.
- The user wants to revisit a decision — stop and surface that the requirement itself needs to change first.
- The unit of work is architectural design (ADRs, data model, API contracts) — different lane.
- The user asks to open a PR — that is the orchestrator's job. This skill commits only.

## Workflow

Inputs from the caller (typically forwarded from the interviewer's hand-off): a `<feature-name>` (kebab-case), the **clarified requirement** content, the **critical-path classification** (extend / supersede / brand new, plus the target file name and — if superseding — the file to delete), the **list of glossary terms** collected during the interview, and whether the **product-context section of `CLAUDE.md`** warrants an update. The working directory is the worktree on the feature branch.

Everything else (sibling PRD files, current `CLAUDE.md` shape, existing critical-path or glossary entries that may need editing in place) you read from disk.

### 1. Generate artifacts

Write, update, or delete each of the following. Create parent directories as needed. Read each template from this skill's `templates/` directory (see the **Templates** section below for the full table).

For the PRD (`docs/product-requirement-document/{feature-name}/requirement.md`):

- Start from `templates/requirement.md`.
- `{feature-name}` is kebab-case derived from the feature.
- Replace every `<…>` placeholder with content from the clarified requirement.
- The User Stories section must be extensive — cover all aspects of the feature in `As an <actor>, I want a <feature>, so that <benefit>` form.
- Delete sections that genuinely don't apply rather than leaving them blank.

For the critical-path file (`docs/critical-path/{critical-path-name}.md`):

Apply the classification from the interviewer's hand-off:

- **Extend** — edit the named file in place; append a History entry with today's date and a one-line reason.
- **Supersede** — write the new file from `templates/critical-path.md`, AND delete the named superseded `.md` file. The superseded file's content does not migrate — it lives only in the new file's History entry (e.g. "superseded `<old-path-name>` after pivot").
- **Brand new** — create the new file from `templates/critical-path.md`.

Always update the History section with a one-line entry: reason only, never the diff or implementation detail. Newest at the bottom.

For glossary updates (`docs/GLOSSARY.md`):

- For each new domain term collected during the interview, append an entry following `templates/glossary-entry.md`.
- Do not overwrite existing terms unless the user explicitly reframed them. If a term already exists, edit its existing entry in place rather than creating a duplicate.
- Create `docs/GLOSSARY.md` if it does not yet exist.

For `CLAUDE.md` — **only if** the requirement reveals a product pivot, scope expansion, new core user, or shift in success criteria (i.e. things future agents need to know to make sense of the project):

- Start from `templates/claude-md-product-context.md` for the section shape.
- Edit `CLAUDE.md`'s product-context section in place; **do not** append a per-feature changelog.
- Goal: a new agent reading this should know what the product is, who it's for, and the current strategic focus at a glance.

### 2. Hand artifacts back for iteration

Tell the user which files were written, which were deleted (superseded critical paths), and whether `docs/GLOSSARY.md` and `CLAUDE.md` were updated. Then ask whether to iterate or confirm.

Do **NOT** summarize the contents — the user can read the files.

If the user asks to iterate, treat each request as a localized rewrite of the affected file(s). If the user's edit invalidates a settled requirement (i.e. is a *requirement* change, not a wording or formatting fix), STOP and surface that the requirement itself needs to change first — do not silently re-litigate the product in this skill.

### 3. On confirmation, commit on the current branch with inline `git`

Do **NOT** create a new branch, do **NOT** push, do **NOT** open a PR.

The caller (typically the orchestrator running `/deep-dive-feature`) has already created and checked out the feature branch (typically inside a worktree) before handing control to you — your job is just to stage and commit.

Run, in the working directory you were briefed with:

```bash
git add <changed-and-deleted-files>      # include any deleted superseded critical-path .md files
git commit -m "docs(prd): <feature-name> requirements"
```

Capture the commit hash — step 4 reports it.

### 4. Report final status

One or two sentences. Include:

- The commit hash.
- The artifact paths written (and deleted — superseded critical paths).

Do **NOT** summarize the requirement — the artifacts are on disk and the user can read them.

## Templates

Each artifact has a template under `templates/` in this skill's directory. Copy the template, replace every `<…>` placeholder, and delete sections that genuinely don't apply rather than leaving them blank.

| Asset | Target path on disk | Purpose |
|-------|---------------------|---------|
| `templates/requirement.md` | `docs/product-requirement-document/{feature-name}/requirement.md` | The PRD. Problem from the user's perspective, solution from the user's perspective, an extensive numbered list of user stories, explicit out-of-scope section, and any further notes. One per feature. |
| `templates/critical-path.md` | `docs/critical-path/{critical-path-name}.md` | A single critical user flow. Summary justifies the "critical" label, then entry point, steps, exit/success state, failure modes, and a History section. Edited in place when extending; written-new-and-deleted-old when superseding; created fresh when brand new. |
| `templates/glossary-entry.md` | `docs/GLOSSARY.md` (appended) | One entry per domain term: definition in the project's voice plus disambiguation notes. Append; never overwrite an existing term unless the user explicitly reframed it. |
| `templates/claude-md-product-context.md` | `CLAUDE.md` (the `## Product context` section) | **Only when** the requirement reveals a product pivot, scope expansion, new core user, or shift in success criteria. Edit the product-context section in place; never append a per-feature changelog. The goal: a new agent reading this should know what the product is, who it's for, and the current strategic focus at a glance. |
