# 07 — The icon set

The sheet draws **20 icons**, 5 per row × 4 rows, each in a white tile (see
`06-components.md` for the tile spec). Row-major order, and these are the names to use
in code — `Icon` props, store keys, Figma layers:

| #   | name           | what it is                                                                                        |
| --- | -------------- | ------------------------------------------------------------------------------------------------- |
| 1   | `cloud`        | a cloud: two overlapping lobes over a flat base                                                   |
| 2   | `home`         | a house: triangular roof over a square body, a small door hole punched in the body                |
| 3   | `share`        | three circles at 10 / 2 / 6 o'clock joined by two thick diagonal bars                             |
| 4   | `user`         | a bust: circle head over a rounded shoulder block, a pale hole in the head                        |
| 5   | `bell`         | a bell: dome, flared skirt, small round clapper below                                             |
| 6   | `mail`         | an envelope: rounded rect, a heavy chevron flap, two pale rules (the "letter")                    |
| 7   | `pencil`       | a pencil at 45°: sharp point lower-left, body with two pale bands (the ferrule)                   |
| 8   | `lock`         | a padlock: shackle arc (pale) over a rounded body with a pale keyhole                             |
| 9   | `search`       | a magnifier: circle lens (pale) with a short handle at 7 o'clock                                  |
| 10  | `cart`         | a shopping cart in side view: basket wedge, two wheels, a handle at the top right                 |
| 11  | `shield-check` | a shield with a pale checkmark inside, point at the bottom                                        |
| 12  | `calendar`     | a calendar: body with a pale header band, two binding tabs on top, a row of three pale slots      |
| 13  | `folder`       | a folder: a pale back sheet with a tab, a saturated front flap                                    |
| 14  | `camera`       | a camera body with a lens ring (pale centre), a small flash bump at the top right                 |
| 15  | `sliders`      | three vertical sliders with knobs at different heights (pale + saturated tracks)                  |
| 16  | `trash`        | a bin: lid + body with two pale vertical ribs                                                     |
| 17  | `wallet`       | a wallet: rounded body, pale inner card, a clasp circle on the right                              |
| 18  | `briefcase`    | a case: pale handle arc, body with a pale latch band                                              |
| 19  | `photos`       | two stacked photos: a pale back card and a saturated front card with a mountain shape knocked out |
| 20  | `chat`         | two overlapping speech bubbles, the front one with three pale dots                                |

## The drawing system

These are **fills, not strokes**. Every icon is a set of solid filled paths with no
outline, drawn on a `24 × 24` grid with a 2-unit safe margin (the glyph occupies `20`
of the tile's `36.7` visible units proportionally — glyph side ≈ **0.545 × tile side**).

**Two tones, always.** Each icon uses a saturated mass and a pale mass of the same hue:

| role      | colour                                                               | where                                                         |
| --------- | -------------------------------------------------------------------- | ------------------------------------------------------------- |
| saturated | `#FE3402` / `#FA6B2F` / `#FF8B00`                                    | the front/primary shape — the thing the icon _is_             |
| pale      | the same hue at ~12–18 % alpha over white (`#FED8C4`-ish for orange) | the back/secondary shape, inner counters, "holes", highlights |

Which end of the ramp an icon uses is not systematic — `cloud` and `mail` are amber
(`#FF8B00`), `lock` and `bell` are red-orange (`#FE3402`), `share` and `cart` sit in
between. When adding an icon, pick the ramp stop that matches its **meaning weight**:
destructive/hot (`trash`, `bell`, `lock`) = `#FE3402`; neutral/utility (`folder`,
`mail`, `wallet`) = `#FF8B00`; everything else = `#FA6B2F`.

**Soft highlight.** Most icons carry a diagonal light band across the upper-left
(`pencil`, `cart`, `lock`, `camera` show it plainly) — a white overlay at 15–25 %,
running top-left → bottom-right, clipped to the shape. It is what stops the flat fills
from looking like a glyph dump. Apply with a single overlay path over the whole icon
group, not per shape.

**Radii inside the glyphs are generous**: outer corners `3–4` on the 24 grid, inner
cut-outs `2`. Nothing in the set is sharper than a `2`-unit corner except the
magnifier handle and the pencil point.

**Optical size, not stroke weight.** `sliders` is the odd one: its tracks are thin
(~`1.5` units) because three knobs at a heavier weight would fill the tile. Thin parts
are allowed _inside_ an icon, never as the outline of one.

## Sizes

| context                   | tile     | glyph | radius  |
| ------------------------- | -------- | ----- | ------- |
| sheet (reference)         | `183.57` | `100` | `47.41` |
| app tile (in a grid)      | `88`     | `48`  | `22.7`  |
| inline in a row / button  | —        | `20`  | —       |
| celebration / empty state | `160`    | `88`  | `41`    |

Never render the glyph below `16` — at that size the duotone collapses into a blur and
you should switch to a text label instead. Above `200`, add the highlight overlay or
the icon reads as a flat sticker.

## Where the icons are **not** a style guide

- The sheet's icons are **not** a UI kit for every action. Use them for navigation and
  for conceptual actions (share, save, search, delete). Do not invent a `cloud-upload`
  in this style for a spinner — spinners and progress use the accent ramp, not duotone.
- Do not recolour an icon to signal state. State is carried by the tile (raised vs
  flat) or by a label; a `trash` that turns grey means nothing in this system.
- Do not rotate, flip or mirror them for emphasis, except the deliberate `z`/`?` glyphs
  of the character (`04-astro-expressions.md`), which are character props, not icons.

## Recovering the source artwork

The 20 icons are `<path>` elements with `fill="#FEFBF5"` or a gradient inside the
`astro-icons.png` band of the sheet, and they are NOT labelled (no `id`), so the order
above is the only handle on them. If you need exact geometry, crop the sheet with the
recipe in `README.md` at `(1030, 2760)` and trace, or export the 20 frames from Figma
in the original file. Regenerating them by hand from this table is intended to be
possible — that is why the table describes each shape rather than only naming it.
