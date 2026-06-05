# Design Tokens — <Product / Feature Name>

> Source of truth for every design value. Token names use the `category/role/step` convention. `scaffold-project` compiles each token here into a CSS custom property in `frontend/src/styles/tokens.css` (e.g. `color/brand/500` → `--color-brand-500`), and `tailwind.config` mirrors these rows. Every color, font, spacing, radius, shadow, and motion value the frontend uses MUST appear here — no hard-coded values downstream.

## Color

| Token | Value | Usage |
|-------|-------|-------|
| `color/brand/500` | `#______` | <primary brand action> |
| `color/brand/600` | `#______` | <hover/active of brand> |
| `color/surface/base` | `#______` | <app background> |
| `color/surface/raised` | `#______` | <cards, sheets> |
| `color/text/primary` | `#______` | <body text> |
| `color/text/muted` | `#______` | <secondary text> |
| `color/border/default` | `#______` | <dividers, input borders> |
| `color/feedback/danger` | `#______` | <errors, destructive> |
| `color/feedback/success` | `#______` | <success states> |

## Typography

| Token | Value | Usage |
|-------|-------|-------|
| `font/family/display` | `"<Font>", <fallback>` | <headings> |
| `font/family/body` | `"<Font>", <fallback>` | <body, UI> |
| `font/size/xs` … `font/size/3xl` | `<rem>` | <type scale> |
| `font/weight/regular` / `medium` / `bold` | `400 / 500 / 700` | <weight contrast> |
| `font/leading/tight` / `normal` / `relaxed` | `<unitless>` | <line height> |

## Spacing

| Token | Value | Usage |
|-------|-------|-------|
| `space/1` … `space/12` | `<rem, e.g. 0.25rem step>` | <spacing scale> |

## Radius

| Token | Value | Usage |
|-------|-------|-------|
| `radius/sm` / `md` / `lg` / `full` | `<rem / 9999px>` | <corner rounding> |

## Shadow

| Token | Value | Usage |
|-------|-------|-------|
| `shadow/sm` / `md` / `lg` | `<box-shadow>` | <elevation> |

## Motion

| Token | Value | Usage |
|-------|-------|-------|
| `motion/duration/fast` | `120ms` | <hover, focus> |
| `motion/duration/base` | `200ms` | <UI transitions> |
| `motion/easing/standard` | `cubic-bezier(...)` | <default easing> |

## Breakpoints

| Token | Value |
|-------|-------|
| `breakpoint/sm` / `md` / `lg` / `xl` | `<px>` |
