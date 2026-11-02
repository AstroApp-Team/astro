# 03 — The Astro form

Everything here is measured from `assets/astro-stylesheet.svg`. Each of the 17 frames
is built from **the same four elements**, stacked bottom to top:

```
1  glow disc     circle  r = 501        fill #FB5F25   feGaussianBlur σ = 125
2  body          circle  r = 416.5      fill linear-gradient(#FF8B00 → #FA6B2F → #FE3402)
                 (plus a flush blurred #FF8B00 copy, σ = 50, behind it — see "rim bloom")
3  features      eyes / arcs / dashes   fill #FEFBF5   (+ a #995F48 shadow copy when they move)
4  punctuation   "!" "?" "z"            fill #FEFBF5 or #FFFFFF, outside the body
```

Units are SVG user units. `R = 416.5`, diameter `D = 833`. Express any size you build
as a fraction of `D` so it survives being rendered at 32 px or 833 px.

## 1. The glow

| property    | value                               | as a fraction of D        |
| ----------- | ----------------------------------- | ------------------------- |
| disc radius | 501                                 | `1.203 R` = `0.601 D`     |
| fill        | `#FB5F25`                           |                           |
| blur        | `feGaussianBlur stdDeviation="125"` | `σ = 0.300 R` = `0.150 D` |

Measured falloff of that disc, as effective alpha of `#FB5F25` over `#3A3A3A`, at
radius `r` from the centre (96-angle average):

| r   | as fraction of R | effective alpha |
| --- | ---------------- | --------------- |
| 424 | 1.02             | 0.83            |
| 465 | 1.12             | 0.64            |
| 505 | 1.21             | 0.45            |
| 545 | 1.31             | 0.32            |
| 585 | 1.40             | 0.21            |
| 625 | 1.50             | 0.13            |
| 665 | 1.60             | 0.07            |
| 705 | 1.69             | 0.03            |
| 745 | 1.79             | 0.01            |

So: **the halo is gone by 1.8 R** (0.9 D). Reserve that much empty space around the
body or the glow will be cropped into a visible disc edge. Nothing else in the sheet
occupies that ring.

Two build recipes that reproduce it without an SVG filter:

```css
/* A: two-layer CSS, cheapest, works in DOM */
.astro-glow {
  position: absolute;
  inset: -20.3%; /* 1.203R / 0.5D  */
  border-radius: 50%;
  background: #fb5f25;
  filter: blur(calc(var(--astro-d) * 0.15));
}

/* B: radial gradient, no filter, GPU-friendly, works in canvas/WebGL */
background: radial-gradient(
  circle closest-side,
  rgba(251, 95, 37, 0.83) 56.7%,
  /* 1.02R / 1.80R */ rgba(251, 95, 37, 0.64) 62.2%,
  rgba(251, 95, 37, 0.45) 67.2%,
  rgba(251, 95, 37, 0.32) 72.8%,
  rgba(251, 95, 37, 0.21) 77.8%,
  rgba(251, 95, 37, 0.13) 83.3%,
  rgba(251, 95, 37, 0.07) 88.9%,
  rgba(251, 95, 37, 0.03) 93.9%,
  rgba(251, 95, 37, 0) 100%
);
```

In three.js: `Sprite` with a canvas texture from recipe B, `AdditiveBlending` off
(additive oversaturates on a light page), `depthWrite: false`.

## 2. The body

```
circle  cx cy  r = 416.5   fill = url(#paintN_linear)
gradientUnits = userSpaceOnUse
  x1 y1 = centre + (-284, -324)
  x2 y2 = centre + (+290, +296.5)
stops  #FF8B00 0 / #FA6B2F 0.543802 / #FE3402 1
```

- **The gradient is a fixed world-space diagonal, not a radial or `objectBoundingBox`
  gradient.** Both endpoints move with the body, the angle never changes: `137deg` in
  CSS. If the body rotates, the lighting rotates with it — that is intentional, Astro
  is lit from the top-left at all times, like a sticker rather than a 3D object.
- The body is a **perfect circle**: `w === h` in all 17 frames. There is no squash,
  no drop, no tail. See `09-do-and-dont.md`.

### Rim bloom

Behind the body sits a **second, blurred copy of the body in solid `#FF8B00`**:

```
feOffset dx=0 dy=0
feGaussianBlur stdDeviation="50"      (σ = 0.12 R)
colour matrix → R=1, G=0.545098, B=0   i.e. #FF8B00 at full alpha
```

Flush, not offset. It brightens the last ~0.1 R of the silhouette so the body reads as
_emitting_ rather than as a flat disc pasted on a glow. Cheap equivalent in CSS:
`box-shadow: 0 0 calc(var(--astro-d) * 0.12) #FF8B00`.

Together, bloom (σ 50, `#FF8B00`) + halo (σ 125, `#FB5F25`) is the whole lighting
model — there is no specular highlight, no rim light and no shadow cast onto the page.

## 3. The eyes

Open eyes are a plain ellipse, no stroke:

| property          | value                            | fraction of D          |
| ----------------- | -------------------------------- | ---------------------- |
| size              | 58 × 111 (so `rx 29`, `ry 55.5`) | `0.070 D × 0.133 D`    |
| fill              | `#FEFBF5`                        |                        |
| centre, left eye  | `centre + (-74, -49)`            | `(-0.089 D, -0.059 D)` |
| centre, right eye | `centre + (+74, -49)`            | `(+0.089 D, -0.059 D)` |
| eye separation    | 148 centre-to-centre             | `0.178 D`              |
| gap between eyes  | 90                               | `0.108 D`              |

The eyes sit **slightly above the equator** (`-49 = -0.118 R`) and are **taller than
they are wide** (ratio 1 : 1.91). They are not circles and they never rotate with the
body's rotation in the sheet — they are 90° upright in every frame that uses ellipses.

### Feature shadow

When the eyes are **not** in the neutral position the sheet adds a duplicate of each
feature, filled `#995F48`, offset from the cream copy. Measured offsets:

| state                               | shadow offset                            | what it does                      |
| ----------------------------------- | ---------------------------------------- | --------------------------------- |
| eyes shifted up-left (#8, #14, #15) | `(-9, -7)`                               | grounds the eyes against the body |
| happy arcs (#9)                     | `(+1, -5)`                               | thin dark line under each arc     |
| doze dashes (#11)                   | `(±5, 0)` — the copy is wider (96 vs 90) | makes the dash read as a lid      |
| eyes shifted right (#13, #16)       | `(+12, 0)`                               | grounds the eyes on their right   |

Rule of thumb: the shadow is offset **in the direction the feature moved**, roughly
`0.02–0.03 D`. Use `#995F48` literally (`#FA6B2F` at 0.55 is the shade-equivalent).
Never give the neutral eyes a shadow — the sheet does not.

## 4. Punctuation

The glyphs are drawn, not typeset: they are outline paths with `#FEFBF5` / `white`
fill, sitting **outside the body** in the halo. Sizes are in `04-astro-expressions.md`
because they belong to the states, but the placement rule is here:

- The glyph never overlaps the body silhouette. Its inner edge clears the rim by
  ~20–40 units (`0.02–0.05 D`).
- It sits in the **upper** half, at 8 o'clock or 2 o'clock — never directly above.
- It is drawn in the same cream as the eyes; the `z`s and the `!` dot use pure
  `white` in a couple of frames, which is a Figma artefact, not a second colour.
  Use `#FEFBF5` everywhere.

## Sizing the whole thing

Given a target diameter `D` (CSS px or world units):

```
body radius     0.5    D      glow radius   0.601 D    glow blur σ  0.15 D
eye            0.070 D wide × 0.133 D tall
eye centres    ±0.089 D horizontally, -0.059 D vertically (y down)
eye shadow     0.022 D offset toward the movement
clear space    0.9 D radius from centre (glow fades out at 1.8 R)
```

Reference sizes used in the app: a 120 px sphere on a phone (`/float`), 260 px in the
`/studio-corner` sandbox, 833 px only when rendering the sheet itself.

## Anti-patterns

- A sphere with a visible edge (no glow) — reads as a ball, not as Astro.
- Eyes centred on the equator — reads as a robot; the sheet always puts them high.
- Round eyes — reads as a generic smiley; the ellipse ratio is the character.
- Radial gradient on the body — reads as a lit sphere; the sheet's body is flat-lit.
- Glow _behind_ the page background — the halo must composite over the page, or on a
  light theme it disappears and the cream body loses its silhouette.
