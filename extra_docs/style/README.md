# Astro style guide — start here

`assets/astro-stylesheet.svg` is the design source of truth for the Astro character,
its expression states, the palette, the type scale and a set of components. It is a
**10949 × 9532** Figma export with no `<text>` elements — every label, glyph and
icon is an outline path, so it cannot be grepped for wording. This directory is the
textual transcription of it: the numbers, the geometry and the rules, separated so a
model or a person with no image input can still build on-brand work.

Every number in these files was measured from the SVG (element coordinates, gradient
stops, filter `stdDeviation`, palette labels printed on the sheet) — not eyeballed.
Where something is a judgement call it says so.

## The files

| file                                                 | what it pins down                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------- |
| [`01-colour.md`](01-colour.md)                       | the six palette colours, their roles, the two themes, derived tints       |
| [`02-typography.md`](02-typography.md)               | Urbanist, the 9 weights, the 5-step scale and its printed sizes           |
| [`03-astro-form.md`](03-astro-form.md)               | how the sphere is constructed: body, gradient, glow, eyes, feature shadow |
| [`04-astro-expressions.md`](04-astro-expressions.md) | all 17 frames → 12 named states, with exact geometry per state            |
| [`05-motion.md`](05-motion.md)                       | how Astro is allowed to move; the `/float` rig; what the page owns        |
| [`06-components.md`](06-components.md)               | buttons, cards, chips, tiles, dots, panels — sizes and treatments         |
| [`07-icons.md`](07-icons.md)                         | the 20-icon set, the 3 circular glass buttons, stroke/fill style          |
| [`08-layout-and-themes.md`](08-layout-and-themes.md) | dark vs light section, panel grammar, spacing, glow on light              |
| [`09-do-and-dont.md`](09-do-and-dont.md)             | the checklist to run before calling any Astro work done                   |

## Reference renders

`refs/` holds PNGs rendered from the SVG at known scales. They exist for humans and
for multimodal models; the markdown above never depends on them.

| file                            | what it is                                                                                                                                                                                | how it was made                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `refs/astro-states.png`         | the 17 expression frames, cropped to ±620 units around each sphere, **5 per row in the same order as the table in `04-astro-expressions.md`** (row-major: #0–#4, #5–#9, #10–#14, #15–#16) | `assets/astro-stylesheet.svg` scaled to 0.34 |
| `refs/astro-sheet-overview.png` | the whole sheet with a coordinate grid every 1000 units, at 0.14                                                                                                                          | same file, whole canvas                      |
| `refs/astro-identity-dark.png`  | palette + typography panels, dark section                                                                                                                                                 | 1:1 crop at (880, 40) 2220×1010              |
| `refs/astro-typography.png`     | the type scale panel, 1:1 crop at (2200, 40)                                                                                                                                              |
| `refs/astro-components.png`     | buttons, circular buttons, project cards, icon tiles — 0.45 crop at (700, 1600)                                                                                                           |
| `refs/astro-icons.png`          | the 20-icon grid — 0.85 crop at (1030, 2760)                                                                                                                                              |
| `refs/astro-panels.png`         | the two dashed section frames (palette + typography), the panel grammar in `08-layout-and-themes.md`                                                                                      | 1:1 crop at (1000, 20) 1500×520              |
| `refs/astro-idle-detail.png`    | one `idle` sphere at 1.4× — glow falloff, gradient, eye geometry                                                                                                                          | crop at (3000, 1100) 1400×1150               |
| `refs/astro-light-theme.png`    | the light-theme frame: the cream page, the sun reading                                                                                                                                    | crop around frame #6                         |
| `refs/astro-chat-dark.png`      | chat bubbles on dark                                                                                                                                                                      | crop at (7900, 6000)-ish                     |
| `refs/astro-chat-markdown.png`  | a markdown bubble (code + quote)                                                                                                                                                          | same, right column                           |

## Re-rendering a region (no headless browser in this repo's toolchain)

There is no Playwright/Puppeteer dependency and none should be added. Rendering is a
one-off with a local Chromium, used only to _look_ at the sheet:

```bash
CHROME=~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome
cat > /tmp/crop.html <<'HTML'
<!doctype html><html><head><style>
html,body{margin:0;background:#3a3a3a;overflow:hidden}
img{position:absolute;left:-2419px;top:-476px;width:10949px;max-width:none}
</style></head><body>
<img src="file:///home/eugenio/repos/astro/assets/astro-stylesheet.svg">
</body></html>
HTML
"$CHROME" --headless --no-sandbox --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=1 --virtual-time-budget=4000 \
  --screenshot=/tmp/crop.png --window-size=2400,2400 file:///tmp/crop.html
```

`left/top` are `-(x * scale)`, `width` is `10949 * scale`, `--window-size` is the
crop size in device pixels. On a machine where headless Chromium is missing shared
libraries the launch fails silently (exit 0, no file) — check for the output file.

## Coordinate system

All sheet geometry below is in **SVG user units**, origin top-left of the sheet.
"Relative to the sphere centre" (abbreviated `rel`) means: subtract the sphere's own
`cx, cy`. A sphere is identified by its centre; the 17 frames are at

```
#0  (3619.5, 1676.5)   #1  (3619.5, 5040.5)   #2  (3619.5, 6187.5)
#3  (3619.5, 7334.5)   #4  (3619.5, 8481.5)   #5  (4994.5, 8487.5)
#6  (7585.5, 1676.5)   #7  ( 750.5, 5637.5)   #8  (6065.5, 5737.5)
#9  (6035.5, 7214.5)   #10 (3619.5, 3125.5)   #11 (7581.5, 7251.5)
#12 (7585.5, 3125.5)   #13 (7536.5, 5737.5)   #14 (9148.5, 8780.5)
#15 (9148.5, 5752.5)   #16 (9148.5, 7251.5)
```

## How to use this if you cannot see images

Every file is written so that the render is optional:

- Sizes and offsets are **numbers with a unit story** (SVG units = 1/833 of the body
  diameter; divide by 833 to get a fraction, multiply a target diameter to get px).
- Shapes are described by **construction** ("the area between an upper arc of `94` and a
  lower arc meeting at two points, open side down"), not by "looks like".
- Where a CSS/regex recipe reproduces the effect without SVG filters (the glow, the
  glass hairline, the 4-step shadow), the recipe is inline and self-contained.
- Colour is always **hex + role + theme**, never "the orange one".

Quoting rule for review comments: cite the file and the number (`03-astro-form.md`:
"eye shadow `0.022 D`"), not the render. If a number here disagrees with the SVG, the
SVG wins and the guide is a bug — say so instead of silently following either.

**The sheet has no motion** — it is 17 stills. `05-motion.md` is derived: it states
which constraints follow from the geometry, then documents the `/float` rig that
actually exists in this repo. Do not quote it as if the designer wrote it.

## The one-paragraph summary

Astro is a **soft orange sphere with two cream oval eyes** and a heavy orange glow.
It is not a planet, not a mascot with limbs, not a face on a head: it is a glowing
ball whose whole body is the face. One body, two eyes, optional punctuation glyph
(`!`, `?`, `z`), and an offset shadow copy of the eyes when they move. On dark
backgrounds it reads as a lamp; on the cream background it reads as a sun. Both are
correct — see `08-layout-and-themes.md`.
