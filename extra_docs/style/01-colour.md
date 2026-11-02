# 01 — Colour

Six colours, and that is the whole palette. Everything else in `assets/astro-stylesheet.svg`
is one of these six, a gradient between them, or a translucent white/black overlay
used as a component fill. The hex values below are **printed on the sheet itself**
under each swatch, so they are exact, not sampled.

## The six

| token                | hex       | role                                         | where it appears                                                                                   |
| -------------------- | --------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `--astro-orange`     | `#FF8B00` | light pole of the body gradient, top-left    | gradient stop 0 of every body; icon light stop; project-card gradient                              |
| `--astro-orange-mid` | `#FA6B2F` | mid pole, the "flat" brand orange            | body gradient stop at 54.38 %; **the glow disc** `circle r=501 fill=#FB5F25`… see note; panel chip |
| `--astro-red`        | `#FE3402` | hot pole, bottom-right                       | gradient stop 1 of every body; icon dark stop; primary button                                      |
| `--astro-sand`       | `#EDCA99` | warm neutral                                 | secondary swatch; muted text on dark; disabled fills                                               |
| `--astro-cream`      | `#FEFBF5` | the eyes, and the **light theme background** | eye ellipses (`fill="#FEFBF5"`); light section page fill                                           |
| `--astro-ink`        | `#1A152C` | near-black with a violet cast                | dark swatch; text on light; dark theme surfaces                                                    |

**Note on the glow.** The glow disc is authored as `#FB5F25`, which is _not_ one of the
six printed swatches — it is one step between `#FA6B2F` and `#FE3402`, picked so that a
125-unit blur lands on the page at roughly `#FA6B2F` brightness. Use `#FB5F25` for the
glow layer itself, and treat `#FA6B2F` as its "flattened" equivalent if you only get one
colour (e.g. a WebGL point light, a `box-shadow`, an SVG filter that cannot be
expensive).

**Note on the feature shadow.** Facial features get a hard shadow copy filled
`#995F48` — measured as the body colour at ~55 % over itself. It is not a printed
swatch either; take the literal `#995F48` when building a duplicate shape, or
`#FA6B2F` at `0.55` alpha if you are shading.

## Themes

The sheet is two sections of the same content:

| theme                             | page background | body reads as                                                                          | eyes read as                                                         |
| --------------------------------- | --------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **dark** (left half of the sheet) | `#3A3A3A`       | a lamp: the body is the brightest thing, the glow bleeds into the grey                 | cream, high contrast                                                 |
| **light** (right half)            | `#FEFBF5`       | a sun: the body sits _on_ cream, the glow becomes a soft warm halo that tints the page | cream, low contrast against the page, high contrast against the body |

`#3A3A3A` is the dark section's background; it is not a printed swatch but it is the
value every dark crop samples to, and it is what the sheet's own panels are drawn on.
On the app's dark surfaces use `#1A152C` for text-bearing surfaces and `#3A3A3A` for
"a neutral dark page behind Astro".

**Do not** put the cream body on `#FEFBF5` with no glow: the silhouette disappears and
only the eyes float. The glow is what separates it (see `03-astro-form.md`).

## Derived values (computed, safe to use)

Derived from the six by mixing in sRGB — treat as suggestions, not as sheet-sourced
constants:

| use                         | value             | derivation                                                          |
| --------------------------- | ----------------- | ------------------------------------------------------------------- |
| warm surface tint on light  | `#FFF4EC`         | `#FEFBF5` + 8 % `#FA6B2F`                                           |
| muted text on light         | `#6B5C6E`         | `#1A152C` at 60 % over `#FEFBF5`                                    |
| muted text on dark          | `#EDCA99` at 70 % | the sheet's own labels use sand on `#3A3A3A`                        |
| hairline / divider on dark  | `#FFFFFF` at 14 % | the panels' dashed frames are white at ~20 %                        |
| hairline / divider on light | `#1A152C` at 10 % |                                                                     |
| glow at 40 %                | `#FB5F25` at 40 % | for halos that must not overpower text                              |
| accent text on light        | `#C85626`         | `#FA6B2F` at 80 % over `#1A152C` — the accent itself fails on cream |

## Contrast rules

- Cream `#FEFBF5` on the body is **not** text; it is a shape. Do not try to make
  cream text legible on orange — put text on `#1A152C` or on the page, never on Astro.
- Text on `#3A3A3A` should be `#FEFBF5` (primary) or `#EDCA99` (secondary). White
  `#FFFFFF` is only used for the glyph flourishes (`z`, `!`, `?`) where it is a shape.
- The primary button is a `#FF8B00 → #FE3402` gradient with `#FEFBF5` caption text —
  that is the one place cream sits on orange, and it is always ≥ 14 px bold.

## Gradients that exist in the file

Every body gradient is **the same** three-stop linear gradient (`paint168`…`paint196`,
one definition per frame so that each can be transformed independently):

```
linear-gradient(137deg, #FF8B00 0%, #FA6B2F 54.3802%, #FE3402 100%)
```

Axis: from `(-284, -324)` to `(+290, +296.5)` relative to the sphere centre, i.e. a
574 × 620.5 vector — down and to the right, `845` units long (`1.014 R`). In CSS the
equivalent angle is `137deg`; in SVG `gradientUnits="userSpaceOnUse"` with those
absolute endpoints. `54.3802 %` is the authored stop offset — keep it if you want the
mid-tone where the sheet puts it.

Icon tiles use a _two-stop_ version of the same axis: `#FF8B00 → #FE3402`.
Project cards use it as a background wash behind a card title.
