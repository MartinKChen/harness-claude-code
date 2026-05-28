# Edge cases every module test file must cover

Companion to `SKILL.md` — load when authoring or reviewing the module-test file for a behavior, to make sure "probably works" coverage hasn't crept in.

"Probably works" is the most common way TDD silently degrades. For each public behavior, walk this checklist and add tests for every item that applies:

- **Null / undefined input** — every parameter, every prop, every query param.
- **Empty arrays / empty strings / empty objects** — including the empty-result branch of any list query.
- **Invalid types at trust boundaries** — wrong-shape input from API request bodies, user input, external API responses.
- **Boundary values** — min, max, off-by-one (`0`, `1`, `n`, `n+1`, `MAX_INT`).
- **Error paths** — network failures, DB errors, third-party 5xx, timeouts, validation failures. Not just the happy path.
- **Race conditions** — concurrent operations on the same resource, double-submits, parallel writes.
- **Large data** — performance and correctness at 10k+ items where relevant.
- **Special characters** — Unicode, emoji, SQL chars (`'`, `;`, `--`), HTML/script chars, RTL text.

If a category genuinely doesn't apply (e.g. no string inputs → no special-character tests), say so out loud in the PR description rather than silently skipping.
