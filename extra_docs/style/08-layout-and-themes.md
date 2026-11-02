# 08 — Layout and themes

## The two themes are one palette

| role                         | dark theme                        | light theme                         | notes                                                               |
| ---------------------------- | --------------------------------- | ----------------------------------- | ------------------------------------------------------------------- |
| page background              | `#1A152C`                         | `#FEFBF5`                           | the palette's two neutral ends                                      |
| surface (card, tile, bubble) | `#241E38` (`#1A152C` + 6 % white) | `#FFFFFF`                           | never pure `#000` / `#F2F2F2`                                       |
| board canvas (guides only)   | `#3A3A3A`                         | —                                   | what `01-colour.md`'s "dark theme" column samples; not an app token |
| primary text                 | `#FEFBF5`                         | `#1A152C`                           | the two neutrals, swapped                                           |
| secondary text               | `#EDCA99`                         | `#6B5C6E` (derived, `01-colour.md`) | cream-on-dark / cool grey-on-light                                  |
| accent                       | `#FA6B2F`                         | `#FA6B2F`                           | **identical** in both themes                                        |
| accent gradient              | `#FF8B00 → #FE3402`               | same                                |                                                                     |
| hairline                     | `rgba(255,255,255,0.10)`          | `rgba(26,21,44,0.10)`               |                                                                     |

`#EDCA99` is the palette's "warm sand". It is a **text** colour on dark and a
**surface tint** on light (a 6 % wash behind a highlight row). It is never a
background for body copy.

## What the sphere does on each theme

The same asset reads two ways, and both are intended:

- **on `#1A152C` (dark)** — the `#FB5F25` halo has somewhere to land, the body glows,
  the cream eyes pop. Astro reads as **a lamp**.
- **on `#FEFBF5` (light)** — the halo almost disappears into the cream page, the
  silhouette is carried by the orange body alone, and the cream eyes read as holes in
  it. Astro reads as **a sun / a sticker**.

Consequences:

- On light, **do not** add a shadow under the sphere to compensate; the sheet's light
  frames have none. The gradient edge is enough.
- On light, the halo needs a _slightly_ wider ramp or it bands against `#FEFBF5`.
  The measured falloff in `03-astro-form.md` already ends at alpha 0, so it is fine —
  just don't crop it inside a container with `overflow: hidden`.
- On light, an eye at 43 % `#995F48` (the feature shadow) is much less visible than on
  dark. That is correct — the shifted-eye states read as pure cream there.

## Section grammar (this is what the board is actually teaching)

The sheet is a **style board**: slabs of colour, each framed by a dashed hairline
(`06-components.md`), each with a caption inside its top-left corner. It repeats the
same column twice (around `x ≈ 2.1k` and `x ≈ 6.1k`) over dark and over light, and in
the export both themes' fills are stacked at identical coordinates. **Do not read the
export's z-order as a statement about which theme wins** — the board shows both, and
the app decides per route.

For the app, translate the grammar rather than the coordinates:

| board habit                           | app equivalent                                                       |
| ------------------------------------- | -------------------------------------------------------------------- |
| dashed frame around a group           | don't draw it. Group with spacing and a section title                |
| caption 12 units inside the corner    | section label, `Caption` size, 60 % opacity, 16 px above the content |
| 200-unit gutters between panels       | `clamp(16px, 5vw, 40px)` page padding                                |
| 2 columns inside a panel              | 1 column on phone, 2 above `720px`                                   |
| panel title (`Paleta de Cores`)       | `H3`, sentence case, never uppercase                                 |
| a full-bleed colour slab as a divider | a `4px` accent gradient rule, or nothing                             |

## Spacing scale

`4 · 8 · 12 · 16 · 24 · 32 · 48 · 64` — powers of two from 4, plus 12 and 24 for text
rhythm. Nothing between. The board's own rhythm is `~50 units ≈ 25 px`, which lands on
`24`.

## The hero pattern (text over Astro) — as used by `/float`

This is the one layout the board implies but does not draw, and it is the layout
`src/presentation/ui/pages/FloatPage.tsx` implements:

```
┌─────────────────────────────┐  ← safe-area top
│  hero text                  │  top ~30 % of the viewport
│  H1 + one body line         │
│                             │
│        (  Astro  )          │  35–65 % band: the sphere crosses the full width here
│                             │
│  ┌───────────────────────┐  │  ← log / panel below the band
│  │ rows                  │  │
│  └───────────────────────┘  │
│  [ bar with the accent ]    │  bottom, safe-area padding
└─────────────────────────────┘
```

Rules:

- **Keep the 35–65 % band clear of interactive text.** The sphere passes in front of
  it; a button there is a button you cannot press reliably.
- **Hero text stays in the top 30 %**, both so the sphere does not cross it and so the
  page still reads before the canvas paints.
- **The sphere's overlay canvas must be `position: fixed; inset: 0`** and
  `pointer-events: none`. On `/float` this is not cosmetic: the R3F `eventPrefix="client"`
  raycast divides `clientX/clientY` by the canvas box with no origin subtraction, so it
  is only correct when the canvas box _is_ the viewport (see `AGENTS.md`).
- **The page scrolls; the canvas does not.** The scroller is the inner `.float__scroll`
  with `ion-content` `--overflow: hidden`. If `ion-content` owns the scroll, the fixed
  overlay and the scrolled content disagree by the scroll offset, and the raycast drifts
  as you scroll — silently.

## Mobile vs desktop

- Phone (390 × 688 reference): hero 30 %, band 35–65 %, panel below, bottom bar pinned.
- Tablet: the sphere moves to the right third, text to the left; keep it in front of
  one column, never straddling the gutter.
- Desktop: max content width `720px` for prose, `1120px` for grids. The sphere scales
  with the viewport but its **y band stays proportional** (35–65 %), because the camera
  framing in the rig is authored for that band.

## Contrast floor

- `#FEFBF5` on `#1A152C` → ≥ 15 : 1 (fine).
- `#EDCA99` on `#1A152C` → ≈ 9 : 1 (fine for body, not for large display type in
  practice — the sheet uses it at caption/spec size).
- `#1A152C` on `#FEFBF5` → ≈ 15 : 1.
- **`#FA6B2F` text on `#FEFBF5` fails.** The accent is a _surface_ colour: use it for
  fills, gradients and rules; for accent-coloured text on light use `#C85626`
  (`#FA6B2F` at 80 % over `#1A152C`, listed in `01-colour.md`), which passes at body size.
- Cream on accent gradient (`#FEFBF5` on `#FA6B2F`) ≈ 3.1 : 1 — acceptable for the
  uppercase CTA at 15 px+ bold only.
