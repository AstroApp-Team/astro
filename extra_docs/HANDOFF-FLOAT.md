# Prompt for a fresh agent: finish the `/float` route

Repo: `/home/eugenio/repos/astro`. Read `AGENTS.md` and `THEATRE.md` before touching
anything. Vite+ toolchain: `vp check`, `vp test`, `vp build`, `vp dev` (already running
on `http://localhost:5173`). Use `pnpx`, never `npx`.

## Goal

Finish the **reverse demonstration** page: a normal React page with a **transparent
Theatre.js canvas overlaid on top of it** — one sphere orbiting in front of the text,
no cutout, no sandbox box, no background. Tapping the sphere appends a row
(`"you got me!"`) to a log/table **in the React page** and seeks the playhead, which
moves the sphere to a new point on its circuit. It is a new scene (`float`) on a new
sheet (`FloatScene`) on a new route (`/float`), fully independent of the existing
`/showcase` page (which is the inverse: a page laid over a scene).

## Already done — do not redo, do not "fix"

- `src/core/models/scene.ts` — `SCENE_IDS` includes `"float"`; `FLOAT_NODES` (one node,
  `theatreKey: "Float Sphere"`), `FLOAT_CAMERA` (`[0, 1.6, 7.5]`, fov 45),
  `FLOAT_AUTOPLAY` (`[0, 6]`).
- `src/infrastructure/theatre/project.ts` — `SHEET_IDS.float = "FloatScene"` and the
  `SCENE_SHEET_IDS.float` entry.
- `src/presentation/canvas/scenes/FloatScene.tsx` — transparent scene: Theatre camera,
  `SceneLights`, one `editable.mesh` sphere (`theatreKey="Float Sphere"`, writes
  `selectNode` on pointer down), `SpawnedShapes`. **No grid, no background, no `<Html>`
  cards, no `useSheetPlayback` autoplay** — the page owns playback on purpose.
- `src/presentation/canvas/scenes/sceneRegistry.tsx` — `float: FloatScene`.
- `src/infrastructure/theatre/useSheetPlayback.ts` — `SheetPlayback` now exposes
  `seek(at)` (module-scope `seek` helper, so the React Compiler stays quiet).
- `src/core/usecases/floatInteraction.ts` + `floatInteraction.test.ts` — pure logic:
  `FLOAT_SPHERE_KEY`, `HIT_MESSAGE`, `MAX_HITS = 40`, `FloatHit`, `FloatHitLog`,
  `EMPTY_HIT_LOG`, `isFloatSphere`, `nextSeekTime(length, from, random, minGap)`
  (mirrors a draw that lands within `minGap` of the current position), `appendHit`,
  `hitSummary`.
- `src/presentation/ui/pages/FloatPage.tsx` — **written, 428 lines, complete.** It
  imports `@presentation/ui/styles/float.css`, which does not exist yet.
- The rig is **already landed**: canonical state
  `src/infrastructure/theatre/states/portfolio-project.state.json` has sheet
  `FloatScene`, length 6s, one object named exactly `"Float Sphere"`, 4 tracks
  (`position.x`, `position.y`, `position.z`, `rotation.y`): radius 2.2 in XZ, y bob
  1.05→2.15, `rotation.y` 0→2π. The `theatreKey` matches the JSX. Do not re-import it.
- `vite.config.ts` — `fmt.ignorePatterns` now also ignores
  `src/infrastructure/theatre/states/portfolio-project.state.json`, because
  `scripts/theatre-state.mjs` writes with `JSON.stringify(…, 2)` and the formatter
  collapses every `handles` array (same reason as the two `astro.local.*` files).

## Remaining work, in order

1. **`src/presentation/canvas/MainCanvas.tsx`** — add the prop `FloatPage` already
   passes: `eventPrefix?: "offset" | "client"`, forwarded to `<Canvas>`
   (`{...(eventPrefix == null ? {} : { eventPrefix })}`, mirroring how `eventSource`
   is passed — `exactOptionalPropertyTypes` is on). This is currently a type error.
2. **Create `src/presentation/ui/styles/float.css`.** It must style exactly these
   classes used by `FloatPage.tsx`: `.float-content`, `.float`, `.float__scroll`,
   `.float__hero`, `.float__panel`, `.float__hint`, `.float__chat`,
   `.float__chat__swatch`, `.float__chat__id`, `.float__chat__text`,
   `.float__chat__at`, `.float__chat__empty`, `.float__table`, `.float__foot`,
   `.float__card`, `.float__overlay`, `.float-canvas`, `.float__bar`, `.float__btn`,
   `.float__btn--accent`, `.float__readout`, `.float__swatch`. Hard requirements:
   - `.float-content { --overflow: hidden }` — IonContent must not own a scrollbar;
     `.float__scroll` is the scroller (see `styles/showcase.css` for the same pattern
     and for the Ionic height chain notes).
   - `.float` is the R3F **event source**: `position: relative; height: 100%`.
   - `.float__overlay { position: fixed; inset: 0; pointer-events: none; z-index: 2 }`.
     `inset: 0` is load-bearing, see the `eventPrefix` fact below.
   - `.float-canvas` pins `.canvas-host` (already `position: relative`, 100%×100%) to
     the overlay: `position: absolute; inset: 0`.
   - `.float__bar` pinned to the bottom, above the overlay (`z-index: 3`), with
     `padding-bottom: env(safe-area-inset-bottom, 0px)`, and the accent read from
     `var(--float-accent)` (the page sets it inline).
   - `.float__chat__swatch` gets its colour inline from `row.hue`.
3. **`src/presentation/ui/layouts/AppLayout.tsx`** — add
   `<Route path="/float" element={<FloatPage />} />` (import the page). Routes stay
   registered in production; the dev-only bits are inside the pages, not the routes.
4. **`src/presentation/state/useAppStore.ts`** — add `"float"` to `AppScreen`.
5. **`src/presentation/ui/components/StudioDevButton.tsx`** — add a link to `/float`.
6. **Run the checks:** `vp check --fix`, `vp check`, `vp test`, `vp build`. Expect 13
   test files (the new `floatInteraction.test.ts` is included).
7. **Verify routes:** `curl -i -o /dev/null -w "%{http_code}\n" http://localhost:5173/float`
   → 200, and `/showcase/sting` → 200.
8. **Verify the production bundle:** `grep -c "studio.initialize" dist/client/assets/index-*.js`
   → 0, `grep -c "astro.scene-tools" dist/client/assets/index-*.js` → 0.
9. **Docs:** add a bullet to `THEATRE.md` and one to `AGENTS.md` for the float route:
   the `eventSource` + `eventPrefix="client"` rule, "the page owns playback", and the
   canonical-state formatter ignore.

## Facts that will bite you

- **R3F 9.8.2 `eventSource`**: when set, R3F puts `pointer-events: none` on the canvas
  and attaches its listeners to that element. It must be an **ancestor of everything
  under the pointer** — events reach it by bubbling from the DOM element the pointer
  landed on. `FloatPage` passes `rootRef` (the `.float` div).
- **`eventPrefix="client"` is not optional.** R3F's default compute reads
  `event.offsetX/offsetY`, which are relative to the event's **target** — with an
  event source, the target is the card the user meant to click, so the raycast lands
  hundreds of pixels from the finger. `"client"` reads `clientX/clientY` and divides
  by the canvas size with **no origin subtraction**, which is only correct because the
  overlay is `position: fixed; inset: 0`, i.e. the canvas box _is_ the viewport. If
  you change the overlay geometry, the raycast goes silent.
- **Consequence, and do not "fix" it:** the canvas is not a hit target, so a tap that
  hits the sphere also reaches the DOM element under it. Making the canvas a hit
  target would eat the page's clicks, which is the worse bug. It is documented in
  `FloatPage`'s header comment.
- **Sphere framing** (measured, camera `[0, 1.6, 7.5]`, fov 45, orbit radius 2.2,
  y 1.05–2.15): the sphere crosses the full viewport width and sits in roughly the
  35–65% vertical band on a 390×688 phone. Keep the hero text in the top ~30% and the
  log panel below the band so the sphere is visible and taps are unambiguous.
- **Playback ownership:** `FloatScene` does not autoplay; `FloatPage` calls
  `playback.seek(FLOAT_AUTOPLAY[0])` + `playback.loop(FLOAT_AUTOPLAY)` in an effect
  keyed on `sequence`, and pauses on cleanup. `FLOAT_AUTOPLAY` must stay a module
  constant (it is an effect dependency).
- **"Move the sphere" = seek the playhead.** Never write `position.x` from the page:
  the rig owns that prop, the clip wins silently, and nothing warns you.
- **Sphere → page signal is `lastEvent`, not `selectedNodeId`.** A second tap on the
  same sphere writes the same string, so a selector on it does not re-render and the
  log records one row for ten taps.
- `selectionVisuals` is `false` on `/float`, stated **on mount** (every canvas page
  states it; `IonRouterOutlet` keeps the outgoing page mounted, so cleanups are not a
  mechanism). The sphere is tappable and does not light up.
- `/rig/float` already works — `RigPage` reads `SCENE_SHEET_IDS.float`, so the Studio
  rigs this exact sheet and `pnpm run theatre:state -- import <export> --to FloatScene`
  lands it.
- **React Compiler is on.** No `useMemo` / `useCallback` / `React.memo`.
- **Tests import from `vite-plus/test`, never `vitest`.** The `node` test project has
  no DOM: test pure logic only, never render a component.
- `noUncheckedIndexedAccess` is on — indexing yields `T | undefined`; use `??`
  fallbacks (see `JourneyPanel.tsx`).
- Formatter quirks that fail `vp check`: no `cond && <jsx>` (use a ternary), no
  trailing comma after the last JSX attribute. Run `vp check --fix`.
- The sting camera aim the user made in the Studio lives in
  `states/astro.local.state.json` (dev-only Save file), **not** in the canonical
  file. Never hand-edit either.
- There is **no headless browser** in this environment. Visual verification is manual;
  say so in your report instead of claiming you saw it.

## Report back

Files changed, the exact output of `vp check` / `vp test` / `vp build`, the two
bundle greps, the `/float` status code, and anything you could not verify.
