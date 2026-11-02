# 04 — Astro expressions

The sheet contains **17 frames**, which resolve to **12 distinct states** (three
`idle`s and four `look-left`s are literal duplicates). Every frame is built from the
same four elements — glow, body, features, optional punctuation — documented in
`03-astro-form.md`.

All coordinates below are **relative to the sphere's own centre** (`rel`), in SVG
units, with **y down**. `R = 416.5`. Convert to a fraction of the body diameter `D`
by dividing by 833; convert to a fraction of the radius by dividing by 416.5.

All numbers here come from element coordinates in `assets/astro-stylesheet.svg`
(circle `cx/cy`, ellipse `cx/cy`, path bounding boxes), not from looking at it.

## What actually differs between states

Only three things ever change:

1. **where the eye pair sits** (the pair never splits — spacing stays 148 for open
   eyes, 172 for happy arcs, 180 for sleep dashes),
2. **which feature shape is used** — open ellipse, happy crescent, sleep dash,
3. **whether a `#995F48` shadow copy is drawn under the features, and by how much it
   is offset**, plus an optional glyph outside the body.

Nothing else. The body circle, its gradient and the glow are identical in all 17
frames.

## The 12 states

Open eyes are ellipses `58 × 111` (`rx 29`, `ry 55.5`), fill `#FEFBF5`.
Shadow copies are the same shape, fill `#995F48`, **opacity 0.43**.

| state                | frames | eyes / features (rel)                                        | feature shadow                           | glyph  |
| -------------------- | ------ | ------------------------------------------------------------ | ---------------------------------------- | ------ |
| `idle`               | 3      | ellipses at `(-73.5, -49)` and `(+74.5, -49)`                | —                                        | —      |
| `look-left`          | 4      | ellipses at `(-29.5, -49)` and `(-177.5, -49)`               | —                                        | —      |
| `look-right`         | 1      | ellipses at `(+44.5, -49)` and `(+192.5, -49)`               | —                                        | —      |
| `look-right-shifted` | 1      | ellipses at `(+151.5, -55)` and `(+299.5, -55)`              | `(+12, 0)`                               | —      |
| `alert`              | 1      | ellipses at `(-52.5, -214)` and `(-200.5, -214)`             | `(-9, -7)`                               | `!`    |
| `wonder`             | 1      | ellipses at `(-52.5, -214)` and `(-200.5, -214)`             | `(-9, -7)`                               | —      |
| `happy`              | 1      | crescents `94 × 52` at `(-85.5, -98.5)` and `(+86.5, -98.5)` | `(0, -5)`                                | —      |
| `doze`               | 1      | dashes `90 × 28.7` at `(-89.5, -51.8)` and `(+90.5, -51.8)`  | `(∓6, -4.7)` (wider copies, `96 × 29.5`) | —      |
| `sleep`              | 1      | dashes as `doze`                                             | —                                        | `z` ×2 |
| `deep-sleep`         | 1      | dashes as `doze`                                             | —                                        | `z` ×3 |
| `think-right`        | 1      | ellipses at `(+151.5, -55)` and `(+299.5, -55)`              | `(+12, 0)`                               | `?`    |
| `think-left`         | 1      | ellipses at `(-52.5, -214)` and `(-200.5, -214)`             | `(-9, -7)`                               | `?`    |

The **pair midpoint** is the single number to reason with:

| midpoint (rel)   | reads as                              | states                              |
| ---------------- | ------------------------------------- | ----------------------------------- |
| `(0, -49)`       | straight at you                       | `idle`                              |
| `(-103.5, -49)`  | attention off to the left             | `look-left`                         |
| `(+118.5, -49)`  | attention off to the right            | `look-right`                        |
| `(+225.5, -55)`  | looking hard right, nearly at the rim | `look-right-shifted`, `think-right` |
| `(-126.5, -214)` | up and away — startled / recalling    | `alert`, `wonder`, `think-left`     |
| `(0, -98.5)`     | closed, content                       | `happy`                             |
| `(0, -51.8)`     | closed, asleep                        | `doze`, `sleep`, `deep-sleep`       |

`+299.5` puts the right eye at `0.72 R` — that is the extreme, and it only works
because of the shadow copy. Do not push further.

Note that `look-left` is mirrored at a **smaller** amplitude than `look-right`
(`-103.5` vs `+118.5`) and the raised states sit at `-126.5` horizontally. These are
the sheet's own asymmetries; reproducing them is cheaper than inventing a rule.

## Per-state construction

### `idle`

Two ellipses, no shadow, no glyph. The default. Return here after any transient state.

### `look-left`, `look-right`, `look-right-shifted`

Same ellipses, pair translated as a unit. Shadow only appears in
`look-right-shifted`, offset `(+12, 0)` — i.e. **in the direction the eyes moved**.

### `alert`, `wonder`

Eyes rise to `y = -214` (0.51 R above centre) and move left. Shadow at `(-9, -7)` —
offset up-left, again in the direction of travel.

`alert` adds the exclamation mark, drawn as two shapes:

```
stem   path, bbox 45.3 × 140.7, centre rel (-317, -384.5)   tapered bar, cream
dot    circle r = 19.5 (Ø 39), centre rel (-317, -283)      cream
```

The `!` hangs at roughly 8 o'clock, its dot clearing the rim by ~40 units. The dot is
**below** the stem in y, 101 units apart centre-to-centre.

`wonder` is `alert` with the glyph removed: use it when the moment is internal.

### `happy`

Features are replaced, not moved: two **crescents**, bbox `94 × 52` (`0.113 D ×
0.062 D`), an upward bow (∧) with thickness ~22 units at the crown, tapering to points
at the tips. Shadow copies sit `5` units higher (`(0, -5)`), not to the side.

Reconstruction without the path: quadratic from `(-36, 0)` to `(+36, 0)`, control
`(0, -30)`, `stroke-width 22`, `stroke-linecap: round` — indistinguishable below 200 px.

The pair is 172 apart, i.e. **wider** than the open-eye pair (148), because the
crescent's visual mass is its outer edge, not its centre.

### `doze`, `sleep`, `deep-sleep`

Features are **dashes**: bbox `90 × 28.7` (`0.108 D × 0.034 D`), a very shallow bow,
centred at `y = -51.8` — ~3 units _lower_ than the open eyes. They read as closed lids
because they are 3.1× wider than tall and sit on the eye line.

- `doze` has shadow copies that are **wider than the cream shapes** (`96 × 29.5`,
  offset `∓6` outward and `-4.7` up). Crop a dash and you lose the lid weight.
- `sleep` adds two `z`s, `deep-sleep` three. Geometry, all outside the rim to the
  upper right:

```
z1   29 × 45   bbox top-left rel (+268.0, -439.0)
z2   36 × 55   bbox top-left rel (+316.5, -372.0)
z3   44 × 67   bbox top-left rel (+351.5, -497.0)      ← deep-sleep only, largest
```

The `z`s ascend and grow. They are static in the sheet; if animated, stagger ~400 ms
and fade at the top of the arc — never send the same `z` up twice in a row.

### `think-right`

Eyes at the extreme right (`+151.5`, `+299.5`), shadow `(+12, 0)`. The `?` is composed
of **five** pieces, all cream except one:

```
dot      circle r = 24 (Ø 48)      rel (+429.1, -123.8)
bar      stroked line, stroke 39   rel (+442.5, -179.7) → up-left
folder   small filled quad         rel (+484.7, -218.6)
inner    ellipse 18 × 19.5         rel (+416.2, -307.8)
hook     large filled path         rel (+460.1, -366.8)  ← the body of the "?"
```

The glyph leans **toward the body** (~14°). Its outer edge reaches ≈`+550` rel ≈ `1.32 R`
from centre — outside the body, inside the halo. Leave room.

### `think-left`

Same eye position as `alert` (`y = -214`, shadow `(-9, -7)`) with the `?` mirrored to
the left, leaning ~12° the other way:

```
dot      circle r = 24       rel (-316.4, -252.4)
bar      stroked line        rel (-328.8, -308.5)
folder   small filled quad   rel (-308.0, -362.0)
inner    ellipse 18 × 19.5   rel (-408.6, -412.2)
hook     large filled path   (top-left corner of its bbox)
```

## Choosing a state in code

```ts
type AstroState =
  | "idle"
  | "look-left"
  | "look-right"
  | "look-right-shifted"
  | "alert"
  | "wonder"
  | "happy"
  | "doze"
  | "sleep"
  | "deep-sleep"
  | "think-right"
  | "think-left";
```

- **Transient states need an exit.** `alert`, `wonder`, `happy`, `think-*` are
  reactions: return to the previous state after 900–1600 ms.
- `sleep` / `deep-sleep` are states, not reactions. They persist until interrupted.
- **Never cycle states on a timer for decoration.** The sheet is a mood board, not a
  loop; a sphere that blinks on a clock reads as a loading indicator.
- **One glyph at a time.** No frame combines `!` with `z`, or `?` with a crescent.
- **`look-left` / `look-right` point at something in the UI** — the state should be
  driven by layout (eyes follow what the user should notice), not by a click.

## What the sheet does not contain

State this in review, because inventing these breaks the look:

- no mouth, brows, blush, hands, limbs or ears
- no tear/sweat-drop/blush variants
- no squash, stretch, tilt or bounce of the body
- no pupil or highlight inside the eye — the eye is a solid cream shape
- no colour variants (green "sick" Astro, blue "cold" Astro)
- no `z`/`!`/`?` in any other colour than cream (`white` in a few frames is a Figma
  artefact, not a second colour)

If a feature needs a new emotion, compose it from this vocabulary: an eye offset from
the table plus an existing glyph. That is what the sheet itself does 12 times.
