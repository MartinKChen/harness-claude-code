# Component Patterns — <Product / Feature Name>

> How the product's recurring UI parts look and behave. Each pattern names the tokens it consumes (from `tokens.md`) and its interaction states. Prefer native semantic elements (`<button>`, `<a>`, `<dialog>`, `<nav>`) over `role` on a generic tag. Components implemented downstream MUST match these patterns and pull from the token scale — no ad-hoc values.

## Navigation

> The global navigation container — the app shell's primary surface. This is the component the foundation/shell slice (see `surfaces.md`) owns. Spell out the desktop and mobile forms.

- **Desktop:** <top bar / side rail — placement, contents, active-item treatment>
- **Mobile:** <hamburger sheet / bottom bar at `breakpoint/md` — open/close behavior>
- **Account menu:** <contents, where it lives>
- States: default / hover / active (current route) / focus-visible.

## Buttons

- Variants: primary / secondary / ghost / destructive.
- States: default / hover / active / focus-visible / disabled / loading.
- Tokens: `color/brand/*`, `radius/md`, `space/*`, `motion/duration/fast`.

## Inputs & forms

- Text input, select, checkbox, radio — native elements.
- Validation: `aria-invalid` + `role="alert"` error message; error color `color/feedback/danger`.
- Disabled-while-submitting posture.

## Cards / surfaces

- Elevation via `shadow/*`, background `color/surface/raised`, radius `radius/lg`.

## Feedback

- Toasts / inline alerts / empty states / loading skeletons.
- Empty and loading states render inside the same semantic landmark (`<main>`) as the loaded state.

## Modals / dialogs

- Native `<dialog>`; focus trapped while open, restored to the opener on close.
- Exit animation respects `prefers-reduced-motion`.

## Data display

- Tables / lists — row affordances, how a row links to its detail surface (ties to `surfaces.md` entry sources).
