# Accessibility Posture — <Product / Feature Name>

> The locked accessibility targets every surface and component must meet. These are
> commitments, not aspirations — the reviewer gates against them.

## Contrast

- Body text and essential UI meet **<WCAG AA / AAA>** — minimum contrast ratio **<4.5:1 / 7:1>** against their background.
- Large text (≥ <size>) may use the relaxed **<3:1>** floor.

## Focus

- Every interactive element has a visible `:focus-visible` style; `outline: none` without a replacement is forbidden.
- Focus is trapped inside modals and restored to the opener on close.

## Targets

- Minimum tap-target size **<44×44px / per platform>** on touch surfaces.

## Motion

- `prefers-reduced-motion` is honored: <which animations are reduced/removed; via `useReducedMotion()`>.

## Semantics & keyboard

- Native semantic elements over `role` on generic tags.
- Full keyboard operability: every flow completable without a pointer; logical tab order.
- One `<main>` landmark per page; empty/loading/error states render inside it.

## Language

- `<html lang>` is set; `dir="rtl"` when the active locale requires it.
