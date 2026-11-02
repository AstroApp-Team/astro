# 06 — Components

Sheet coordinates → real sizes: the sheet is drawn at roughly **1 unit = 0.5 px** for
UI components (a 124-unit pill is a 62 px pill). Convert by dividing by 2, then round
to the 4 px grid. Sizes below are given both ways so you can sanity-check.

## Pills / chips

| property | sheet units                  | real                      |
| -------- | ---------------------------- | ------------------------- |
| size     | `124 × 48`                   | `62 × 24` — use `64 × 26` |
| radius   | `24` = fully round (`h / 2`) | `13`                      |
| padding  | ≈ `20` horizontal            | `10`                      |

Three treatments, each shown twice on the sheet (dark section + light section):

| treatment | dark theme                                 | light theme | text                                 |
| --------- | ------------------------------------------ | ----------- | ------------------------------------ |
| accent    | `linear-gradient(90deg, #FE3402, #FF8B00)` | same        | `#FEFBF5`, Medium, ~20 units (10 px) |
| raised    | `#333333`                                  | `#E6E6E6`   | theme text                           |
| inverse   | `#171717`                                  | `#8C8C8C`   | `#FEFBF5` / `#1A152C`                |

Note the accent pill's gradient runs **`#FE3402 → #FF8B00`** — the reverse of the
sphere's body gradient. Buttons are lit from the left, the sphere from the top-left.

Uppercase is used **only** on the primary call-to-action (`COMEÇAR` on the sheet),
set at ~20 units with ~2 % letterspacing. Every other pill label is sentence case.

## Icon tiles (the 20-icon grid)

| property | sheet units                      | real                                         |
| -------- | -------------------------------- | -------------------------------------------- |
| tile     | `183.57 × 183.57`                | `92 × 92` — use `88`                         |
| radius   | `47.4086`                        | `23.7` → **radius = 0.258 × side**           |
| fill     | `#FFFFFF`                        |                                              |
| shadow   | soft, ~`0 4 12 rgba(0,0,0,0.06)` | (sheet uses a 4-layer Figma stack)           |
| grid gap | `335.95 − 183.57 = 152.4` pitch  | 76 pitch, i.e. `16` gap at 60 side… use `12` |

The tiles are **white on a near-white page**. If your page is already white, the tile
must earn its place with the shadow, or drop the tile and let the icon sit on the page.
Do not tint the tile.

## Circular buttons (the "glass" trio)

| property       | sheet units                                                                                   | real                    |
| -------------- | --------------------------------------------------------------------------------------------- | ----------------------- |
| diameter       | `150`                                                                                         | `48`                    |
| fill           | white @ ~10 % (`fill-opacity` on the sheet)                                                   | `rgba(255,255,255,0.1)` |
| hairline       | `1` unit, `149` inset                                                                         | `1 px`                  |
| hairline paint | `linear-gradient(180deg, #fff, rgba(255,255,255,0.05) 25%, rgba(255,255,255,0.05) 75%, #fff)` | same                    |
| icon           | centred, cream `#FEFBF5`, ~`56` units                                                         | `20 px`                 |

That gradient stroke is the whole "glass" trick: the ring is **bright at the top and
bottom, almost invisible at the sides**. A flat `1px solid rgba(255,255,255,0.2)` ring
reads as a grey circle; this one reads as glass. In CSS:

```css
.glass-btn::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 50%;
  padding: 1px;
  background: linear-gradient(
    180deg,
    #fff,
    rgba(255, 255, 255, 0.05) 25%,
    rgba(255, 255, 255, 0.05) 75%,
    #fff
  );
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
}
```

The circular **photo thumbs** on the sheet (`182.59` diameter, `rx 91.13`) are Figma
image fills and export as red placeholders — they carry no style of their own. They are
`0.99 ×` the icon tile side; treat them as "avatar at 92 px, circular".

## Project cards

| property    | sheet units                                                                              | real                   |
| ----------- | ---------------------------------------------------------------------------------------- | ---------------------- |
| card        | `564 × 477`                                                                              | `282 × 239`            |
| radius      | `30`                                                                                     | `15`                   |
| fill        | `#FFFFFF` (light section)                                                                |                        |
| border      | `2.64` inset `1.32`, gradient `#fff → #fff @ 0`                                          | `1.3 px` fading border |
| shadow      | `filter167`: erode `11.63`, offset `(8, 24)`, blur `44.7`, `rgba(21.6, 51.8, 79.7, 0.1)` | see below              |
| inner thumb | `226.5 × 236.4`, rotated a few degrees                                                   | —                      |

The card's drop shadow is a single big soft one, **not** a stack: erode + offset +
blur, 10 % of a desaturated navy. That navy (`#16334F` at 10 %) rather than black is
what keeps the shadow from looking dirty on cream:

```css
box-shadow: 0 12px 22px rgba(22, 51, 80, 0.1);
```

The inner thumb is deliberately **rotated** (a few degrees, alternating) inside the
card. That tilt is part of the look: a card with a perfectly square thumb reads as a
table row.

### Multi-layer "smooth" shadow (when you need depth over cream)

The sheet uses the classic 4-step Figma stack for elevated surfaces. Reproduce it
literally rather than inventing a blur:

```
0  1 2   rgba(0,0,0,0.01)
0  2 4   rgba(0,0,0,0.02)
0  4 8   rgba(0,0,0,0.04)
0  8 16  rgba(0,0,0,0.08)
+ inset 0  1 2 rgba(255,255,255,0.15)     ← top highlight
+ inset 0 -1 2 rgba(255,255,255,0.15)     ← bottom reflection
```

`filter9_ddddiif_0_1` in the SVG is exactly this, with `dy` doubling at each step
(6.74 / 13.48 / 26.96 / 53.92) and `σ` half of `dy`. The two inner shadows are what
give the surface a hairline of light at the rim.

## Chat bubbles

Two bubble styles on the sheet, both rounded rectangles with one corner tightened:

- **user** — accent gradient (`#FF8B00 → #FE3402`), radius `18` with the bottom-right
  at `6`, text `#FEFBF5`, max width `78 %` of the column.
- **assistant** — `#1A152C` on dark / `#F2EAE0` on light, radius `18` with the
  bottom-left at `6`, text `#EDCA99` on dark / `#1A152C` on light.
- Line-height 1.45, and the bubble's vertical padding is **larger than its horizontal**
  (`14` vertical / `16` horizontal) — that is what makes the sheet's bubbles look calm
  rather than wordy.
- Markdown inside a bubble: `code` is `#EDCA99` on `#0F0C1A` with `4 px` radius and no
  border; blockquotes get a `2 px` `#FA6B2F` left rule, not a background.

## Section frames (the panels on the sheet itself)

The guides are drawn as **dashed** hairline rounded rectangles:

```
stroke      rgba(255,255,255,0.35)      (light: rgba(26,21,44,0.25))
width       2 units ≈ 1 px
dash        6 units on / 6 off  (≈ 3 px / 3 px)
radius      24 units ≈ 12 px
fill        none
label       inside top-left, 12 px from the corners, caption size, 60 % opacity
```

Panels are for the design sheet, not for the app. In the app, use a real surface
(card with the shadow above) or nothing.

## Rules that keep components coherent

1. **Radius comes from the size**, not from taste: pills `h/2`, tiles `0.258 × side`,
   cards `15`, bubbles `18`. Two components with the same role never differ.
2. **One accent per screen.** Accent gradient = the thing to press. Everything else is
   the raised/inverse treatments.
3. **Hairlines are 1 px and gradient**, never flat grey (see the glass button).
4. **Nothing is outlined in the accent colour.** The sheet has no orange rings.
5. **No two shadows on one element.** Pick the card shadow or the 4-layer stack.
