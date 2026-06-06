# Surface + Navigation Inventory — <Product Name>

> The canonical list of every routed surface and how a user reaches it. This is the contract `create-feature-issues` reads to emit the **foundation/shell slice** (which owns the global nav container + authenticated layout + landing/dashboard) and to enforce the **page-reachability gate**: every page task declares an entry source from this table, and the reviewer verifies that inbound path actually exists in code. `architect` reads this file too — the app shell / nav container is modeled as a real C4 component, not an incidental page.

> **The invariant is reachability, not menu-membership.** Most surfaces are reached from *other* surfaces; the global nav is only for top-level destinations.

## Surfaces

| Route | Kind | Entry source(s) | In global nav? | Auth |
|-------|------|-----------------|----------------|------|
| `/` | `redirect-system` | redirect → `/dashboard` (authed) / `/login` (anon) | no | public |
| `/login` | `external-entry` | URL typed / logout redirect | no | public |
| `/dashboard` | `top-level` | global-nav · redirect from `/` | yes | protected |
| `/<entities>` | `top-level` | global-nav | yes | protected |
| `/<entities>/:id` | `detail-child` | parent: `/<entities>` (list row) | no | protected |
| `/<entities>/new` | `contextual` | control: "New" button on `/<entities>` | no | protected |
| `/settings` | `top-level` | global-nav (account menu) | yes | protected |
| `*` (404) | `redirect-system` | unmatched route → not-found view | no | public |

**Kinds** — `top-level` (parentless section, reached from global nav or a redirect) · `detail-child` (reached from a row/link on its parent) · `contextual` (new/edit/dialog reached from a control on a parent) · `external-entry` (login / magic-link, entered via URL or email) · `redirect-system` (`/` → home, 404, system routes).

**Reachability rules** (the gate `create-feature-issues` and the reviewer enforce):

- A **top-level (parentless)** surface MUST be in the global nav **or** be an explicit redirect target.
- A surface **with a parent** MUST be linked from that parent (a row, card, or control).
- An **external-entry** surface declares "entered via URL / email" and is exempt from in-app linking.
- A **redirect/system** surface declares its redirect or error trigger.
- No surface may have an empty entry-source cell — that is an orphan, and the inventory is incomplete until it is resolved.

## Global navigation model

- **Top-level items (ordered):** `<Dashboard>`, `<Entities>`, … — exactly the rows marked "In global nav? yes" above, in display order.
- **Account menu:** `<Settings>`, `<Profile>`, `<Log out>`, …
- **Mobile behavior:** <hamburger sheet / bottom bar> at `breakpoint/md`; <open/close + active-item behavior>. Consistent with the platform-priority decision in `overview.md`.

## History

- <YYYY-MM-DD> — Created. Reason: <one-line reason, e.g. "initial surface inventory for <feature-name>">
