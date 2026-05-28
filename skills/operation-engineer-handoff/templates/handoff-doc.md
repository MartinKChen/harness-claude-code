# Handoff: <unit> — <one-line title>

## Dispatch
- Verb: <Implement GitHub task issue #<n> | Fix the review feedback on GitHub task issue #<n> | Fix the review feedback on GitHub slice issue #<n> | Fix PR #<n>>
- Issue / PR: #<n> — <title>
- Slice issue: #<slice-#>
- Slice branch: <branch>
- Worktree: /tmp/harness-claude-code/<repo>/worktrees/<slice-branch>

## What's been done
- <sha-short> <commit subject>
- <sha-short> <commit subject>
- ...

## Where I stopped
- Current TDD step: <RED | GREEN | REFACTOR | scaffold | merge-main>
- Last test added: <path:line> (<pass | fail | not-yet-run>)
- Working tree state: <clean | <list dirty paths>>

## Where to pick up next
- Next behavior to drive: <one sentence>
- Acceptance criteria still open: <list of remaining `Done criteria` bullets>
- Open threads / blockers: <anything I left unresolved>

## Files touched (with line refs)
- <path:line> — <what changed>
- ...

## Surprises / decisions
- <non-obvious choice the next agent needs to know — e.g. "mirrored sibling X at path/to/file.py:42 because Y", "deferred refactor of Z to keep scope tight">

## Verification I ran
- `<command>` → <result>
- ...
