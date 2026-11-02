# 09 — Do and don't

The checklist to run before calling any Astro work done. Each line is decidable by
reading code or by looking at one screenshot — none of them are "use good taste".

## The character

| ✅ do                                                                            | ❌ don't                                                       |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| one circle body, `1 : 1`, at every size                                          | squash, stretch, tilt or bounce it                             |
| gradient `137deg`, `#FF8B00 → #FA6B2F 54 % → #FE3402`                            | a radial gradient, a highlight dot, a second light source      |
| glow disc at `1.203 R`, blurred `σ = 0.15 D`, `#FB5F25`                          | a hard silhouette edge; a glow that lags the body              |
| cream eyes `#FEFBF5`, `58 × 111` (`1 : 1.91`), 148 apart, `0.118 R` above centre | round eyes, eyes on the equator, eyes with pupils              |
| move the eye **pair**, never one eye                                             | winking, blinking with one lid, cross-eyed                     |
| feature shadow `#995F48` at `0.43`, offset **in the direction of travel**        | a shadow on the neutral `idle` eyes; a shadow with no movement |
| one punctuation glyph at a time, outside the body                                | `!` and `z` at once; a glyph overlapping the silhouette        |

## Colour

| ✅ do                                                                     | ❌ don't                                               |
| ------------------------------------------------------------------------- | ------------------------------------------------------ |
| the six palette values, verbatim                                          | new oranges; a "slightly warmer" accent                |
| `#EDCA99` as text on dark, tint on light                                  | `#EDCA99` behind body copy                             |
| accent gradient `#FF8B00 → #FE3402`, buttons inverted `#FE3402 → #FF8B00` | an accent that is the same gradient in both directions |
| `#1A152C` / `#FEFBF5` as the theme pair                                   | pure `#000` / `#FFF` as page background                |
| accent as fill, rule or gradient                                          | accent-coloured **text** on `#FEFBF5`                  |

## Type

| ✅ do                                              | ❌ don't                                                                     |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| Urbanist everywhere, 9 weights available           | a second family for numbers, code or UI                                      |
| `48 / 40 / 36 / 24 / 20` with the matching weights | an arbitrary `32px` heading                                                  |
| uppercase **only** on the CTA                      | uppercase section titles or labels                                           |
| sentence case for everything else                  | Title Case In UI Copy (the board's panel titles are board furniture, not UI) |
| `Light` weight for captions only                   | `Bold` captions, `Light` buttons                                             |

## Components

| ✅ do                                                        | ❌ don't                                          |
| ------------------------------------------------------------ | ------------------------------------------------- |
| radius derived from size (`h/2`, `0.258 × side`, `15`, `18`) | one radius for everything                         |
| one accent element per screen                                | three gradient buttons competing                  |
| `1px` **gradient** hairline (`white → 5 % → white`)          | flat grey `1px` borders                           |
| the 4-step shadow stack, or the single card shadow           | both on one element                               |
| icons as duotone fills, `0.545 ×` the tile                   | stroke icons, single-tone icons, recoloured icons |
| white tiles with a soft shadow on a near-white page          | tinted tiles, outlined tiles                      |

## Motion

| ✅ do                                            | ❌ don't                                               |
| ------------------------------------------------ | ------------------------------------------------------ |
| seek the playhead to move Astro                  | write `position.x` from a page — the rig wins silently |
| `90 / 160 / 240 / 400 ms`                        | a spring, a bounce, an overshoot                       |
| cut between feature shapes                       | cross-fade an ellipse into a crescent                  |
| transient states return to `idle` in `0.9–1.6 s` | a state loop on a timer                                |
| `FLOAT_AUTOPLAY` as a module constant            | an array literal in an effect dependency               |

## Canvas / overlay work (this repo specifically)

| ✅ do                                                                         | ❌ don't                                                        |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `eventSource` = an **ancestor of everything under the pointer**               | pass the canvas itself or a sibling                             |
| `eventPrefix="client"` **and** `position: fixed; inset: 0` on the overlay     | a fixed overlay with a non-zero `top` — the raycast goes silent |
| keep the 35–65 % band free of interactive text                                | put the primary button where the sphere passes                  |
| let the tap reach the DOM underneath the canvas                               | make the canvas a hit target — it eats the page's clicks        |
| drive the log from `lastEvent`                                                | select on `selectedNodeId` — a repeat tap writes the same value |
| state `selectionVisuals` **on mount** per route                               | rely on a cleanup — `IonRouterOutlet` keeps pages mounted       |
| the inner `.float__scroll` as scroller, `--overflow: hidden` on `ion-content` | scroll the page under a fixed overlay                           |

## Review questions (answer all five)

1. Which of the 12 states is on screen, and what makes it that state (eye midpoint,
   feature shape, glyph)?
2. Does the glow extend past `0.9 D` from the body centre with no crop?
3. Is every colour one of the six, or a documented derivation of one?
4. Is the accent used once, as the thing to press?
5. If the body moved this frame, did it move because the **clip** moved?

If any answer is "not sure", the work is not done — the sheet has an explicit answer
for all five.
