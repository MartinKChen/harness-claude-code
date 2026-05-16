# Commit messages — Conventional Commits

Scaffold-produced commits use the same format the rest of the plugin uses
(see `skills/git-workflow/` for the canonical reference):

```
<type>(<scope>): <subject>
```

Scaffold writes exactly these subjects, one per surface, in this order:

| Subject template | When it fires |
|---|---|
| `chore(scaffold): backend (<stack>) — framework entry, manifests, Dockerfile` | The `backend` surface was flagged by the detector. |
| `chore(scaffold): frontend (<stack>) — entry, manifests, Dockerfile` | The `frontend` surface was flagged. |
| `chore(scaffold): compose topology (<services>)` | The `compose` surface was flagged. |
| `chore(scaffold): e2e (playwright + smoke spec)` | The `e2e` surface was flagged. |

`<stack>` and `<services>` are filled in from the ADR — never invented.

Scaffold never produces `feat:` commits. Feature behavior lands later via
`implement-feature-task` and its pattern skills.
