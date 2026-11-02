# 02 — Typography

The sheet's type panel prints both the family and the scale, so nothing here is
inferred:

```
Urbanist            (panel title, wordmark)
Aa                  (the specimen, set in the family at display size)
Urbanist / Bold / 48          H1
Urbanist / SemiBold / 40      H2
Urbanist / Medium / 36        H3
Urbanist / Regular / 24       Body
Urbanist / Light / 20         Caption
```

Weights listed beside the specimen, in order: **Thin, ExtraLight, Light, Regular,
Medium, Semibold, Bold, ExtraBold, Black** (9 weights, the full Urbanist family).

## The scale

| step    | family   | weight         | size | tracking   | line-height | use                                  |
| ------- | -------- | -------------- | ---- | ---------- | ----------- | ------------------------------------ |
| H1      | Urbanist | Bold (700)     | 48   | `-0.02em`  | 1.05        | page title, hero on `/float`         |
| H2      | Urbanist | SemiBold (600) | 40   | `-0.015em` | 1.1         | section title, route header          |
| H3      | Urbanist | Medium (500)   | 36   | `-0.01em`  | 1.15        | card title, panel heading            |
| Body    | Urbanist | Regular (400)  | 24   | `0`        | 1.45        | everything readable                  |
| Caption | Urbanist | Light (300)    | 20   | `0.01em`   | 1.4         | labels under icons, meta, timestamps |

The sizes are **CSS px**. They are printed on a sheet whose spheres are 833 units
across; if you instead scaled everything by the sheet's 1:1 ratio you would get 7 px
H1 — the sheet is a style board, not a phone mock. Use the numbers as-is, and treat
them as a _ratio_ (48 : 40 : 36 : 24 : 20) if you must rescale.

Letterspacing and line-height are not printed; the values above are the ones that make
the rendered panel look like the sheet (the specimen has generous side bearings and
tight leading). Marked as judgement.

## Rules

- **One family, no exceptions.** No second font for numbers, code or buttons. If you
  need contrast, change weight and size, not family.
- **Weight is semantic.** Light is caption-only; Medium is the default for UI labels;
  Bold is reserved for H1 and the primary button caption. Never Bold a caption.
- **Uppercase only on the primary button** (the sheet shows `COMEÇAR` in caps, ~20 %
  of the button height). Everything else is sentence case. The sheet's own panel
  titles are Title Case (`Paleta de Cores`, `Tipografia`).
- **Text colour never comes from the gradient.** `#1A152C` on light, `#FEFBF5` on
  dark, `#EDCA99` for secondary on dark. See `01-colour.md`.
- **Do not outline or shadow text.** The sheet's only text effects are none.

## Loading

Urbanist is on Google Fonts (variable, 100–900). In this app add it in
`index.html` as a normal `<link>` with `display=swap`, or self-host the variable
`.woff2` under `src/presentation/ui/assets/fonts/`. Because the app is also packaged
by Capacitor, **self-hosting is preferred** — a phone with no network would otherwise
render a fallback and the whole brand collapses to system sans.

```
@font-face {
  font-family: "Urbanist";
  src: url("./assets/fonts/Urbanist-Variable.woff2") format("woff2-variations");
  font-weight: 100 900;
  font-display: swap;
}
```

Fallback stack while it loads: `"Urbanist", "Avenir Next", "Segoe UI", system-ui, sans-serif`.

## Where the type lives in the app today

Per `AGENTS.md`, Ionic owns global CSS and the app imports `core.css`/`structure.css`
in `main.tsx`. Typography tokens should therefore be **CSS custom properties on
`:root`** (or on `.ion-page`), not a second stylesheet reset:

```css
:root {
  --astro-font: "Urbanist", "Avenir Next", system-ui, sans-serif;
  --astro-h1: 700 48px/1.05 var(--astro-font);
  --astro-h2: 600 40px/1.1 var(--astro-font);
  --astro-h3: 500 36px/1.15 var(--astro-font);
  --astro-body: 400 24px/1.45 var(--astro-font);
  --astro-caption: 300 20px/1.4 var(--astro-font);
}
```

Anything that sets `font-family` outside these tokens is a bug, not a variation.
