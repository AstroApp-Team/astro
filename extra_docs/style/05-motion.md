# 05 — Motion

**The sheet contains no motion.** It is 17 static frames. Everything in this file is
either (a) a constraint that follows from the geometry in `03-astro-form.md`, or
(b) the rig that already exists in this repo for `/float`. Marked accordingly.

## (a) Constraints that follow from the form

These are not taste — they follow from how Astro is built:

1. **The body never squashes or stretches.** It is a circle in all 17 frames; the
   gradient is a fixed world-space diagonal (`137deg`). A scaled circle drags a
   gradient that is not supposed to rotate, and the lighting instantly looks wrong.
   If you need weight, move the body; do not deform it.
2. **The glow moves with the body, rigidly.** The halo is a blurred disc centred on
   the body. Animate them as one node. If the glow lags (a "trail"), the halo detaches
   from the silhouette and looks like a separate light source behind the page.
3. **Eyes move as a pair, by translation.** All 12 states translate the pair, none
   scales it. Interpolating between two states is therefore a `transform: translate()`
   tween on a group — never a tween of `cx`/`cy` per eye, which can desynchronise.
4. **The feature shadow trails the movement** (it is offset _in the direction of
   travel_, `0.02–0.03 D`). If you tween features over more than ~120 ms, tween the
   shadow too, or the eyes slide out of their own shadow.
5. **State changes are cuts, not morphs, when the shape changes.** Open ellipse →
   crescent → dash are different shapes; cross-fading them produces a grey smear at
   50 % opacity. Cut on a 1-frame boundary, or animate a lid closing (a mask sweep
   over the ellipse) and cut when the lid is shut.

## (b) The `/float` rig, as it exists today

This is the production example of Astro in motion, and it is already landed in
`src/infrastructure/theatre/states/portfolio-project.state.json` as sheet
`FloatScene`, 6 s long:

| track        | range                        | what it does         |
| ------------ | ---------------------------- | -------------------- |
| `position.x` | orbit radius `2.2` in XZ     | the circuit          |
| `position.z` | same orbit, 90° out of phase |                      |
| `position.y` | `1.05 → 2.15`                | the bob              |
| `rotation.y` | `0 → 2π`                     | the body's slow turn |

Camera `[0, 1.6, 7.5]`, fov `45`, sphere diameter such that it crosses the full
viewport width and sits in the **35–65 % vertical band** on a 390 × 688 phone.

Rules the rig encodes — copy them for any new Astro scene:

- **The circuit is an orbit in XZ plus a bob in Y.** Not a sine on one axis: a
  single-axis sine reads as a pendulum, and a circle read from the front reads as a
  _sweep_, which is what the sheet's "orbiting sphere in front of the text" idea wants.
- **`rotation.y` is a full `2π` over the clip**, so the gradient never comes to rest at
  a noticeable angle and the loop has no seam.
- **The clip length is 6 s and it loops.** Faster than 4 s reads as agitation; slower
  than 10 s stops reading as "alive" and starts reading as a drifting background.
- **No easing pile-up.** One lightweight ease per track; the bob is the only track
  that should be eased noticeably, because it is the one the eye tracks.

### Who owns playback

`FloatScene` does **not** autoplay. `FloatPage` owns the playhead:

```ts
useEffect(() => {
  seekSequence(sequence, FLOAT_AUTOPLAY[0]);
  loopSequence(sequence, FLOAT_AUTOPLAY);
  return () => pauseSequence(sequence);
}, [sequence]);
```

- `FLOAT_AUTOPLAY` (`[0, 6]`) must stay a **module constant** — it is an effect
  dependency; an array literal re-runs the effect every render and restarts the clip.
- **"Move the sphere" always means seek the playhead.** Never write `position.x` from
  a page: the rig owns that prop, the clip wins silently, and nothing warns you.
- The page seeks to a point on the circuit when the sphere is tapped
  (`nextSeekTime` in `src/core/usecases/floatInteraction.ts` draws a new playhead at
  least `minGap` away from the current one). That is the _only_ sanctioned way for UI
  to move Astro in this app.

## Timing vocabulary

For everything that is not the rig (UI transitions, state changes):

| duration      | use                                                           |
| ------------- | ------------------------------------------------------------- |
| `90 ms`       | press feedback (scale `0.97` on a pill/tile)                  |
| `160 ms`      | hover/press colour, glass-button ring brightening             |
| `240 ms`      | state change cut + fade of a glyph (`!`, `?`, `z`)            |
| `400 ms`      | panel/card enter, staggered `40 ms` per child                 |
| `900–1600 ms` | lifetime of a transient expression before returning to `idle` |

Easing: `cubic-bezier(0.2, 0, 0.2, 1)` for movement, `linear` for the playhead. No
springs, no bounce, no overshoot — the character is calm, and a bouncy Astro is a
different brand.

## What is explicitly forbidden

- a blinking loop on a timer (`idle` → `happy` → `idle` every 3 s): reads as a
  loading indicator
- squash & stretch, cartoon anticipation, character turnaround
- parallax on the glow, coloured glow variants, glow pulsing
- dragging Astro around the screen, throwing it with inertia
- more than one Astro on screen at once at different scales
- the `z`s animating as a permanent ambient loop (`sleep` is a state, not a screensaver)
