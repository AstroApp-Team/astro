# RESUME — handoff brief

Written at the end of the session that landed: `/float`, per-scene shape storage,
the Astro style guide, the `/astro` character overlay, and the parking of the
animation state machine.
**Everything in "Done" is green and verified. Do not redo it.**

Read in this order before touching anything:

1. `AGENTS.md` — repo rules (React Compiler, chained Hono routes, aliases declared
   twice, Vitest needs per-project aliases, formatter quirks, canvas/overlay facts).
2. `extra_docs/THEATRE.md` — rigging workflow, export/land, `/showcase` notes.
3. `extra_docs/style/README.md` → `03-astro-form.md` → `04-astro-expressions.md` →
   `08-layout-and-themes.md` → `09-do-and-dont.md` — Astro's visual language, as
   numbers. `refs/` is for humans/multimodal models; nothing in the markdown needs it.
4. `extra_docs/ANIMATION-STATE-MACHINE-BUILD-STATUS.md` only if the parked feature is
   back in scope — not otherwise.

---

## Done (verified, leave alone)

### 1. `/float` — the reverse demonstration page

Normal React page with a **transparent** Theatre canvas overlaid on it; one sphere
orbits in front of the text; tapping it appends `"you got me!"` to the page's log and
seeks the playhead.

- `src/presentation/ui/pages/FloatPage.tsx` — page; owns playback
  (`playback.seek(FLOAT_AUTOPLAY[0])` + `playback.loop(FLOAT_AUTOPLAY)`, pause on
  cleanup, effect keyed on `sequence`).
- `src/presentation/canvas/scenes/FloatScene.tsx` — no autoplay, no grid, no `<Html>`;
  pointer-down writes `selectNode` and `lastEvent`.
- `src/presentation/canvas/MainCanvas.tsx` — accepts `eventPrefix?: "offset" | "client"`
  and forwards it only when non-null (mirrors `eventSource`; `exactOptionalPropertyTypes`
  is on).
- `src/presentation/ui/styles/float.css` — `.float-content { --overflow: hidden }`,
  `.float__scroll` is the scroller, `.float__overlay { position: fixed; inset: 0 }`,
  `.float-canvas` pins `.canvas-host` into the overlay.
- `src/presentation/ui/layouts/AppLayout.tsx` — `<Route path="/float" … />`
  (registered in production on purpose).
- `src/presentation/state/useAppStore.ts` — `AppScreen` includes `"float"`.
- `src/presentation/ui/components/StudioDevButton.tsx` — link to `/float`.
- `src/core/usecases/floatInteraction.ts` + test — `isFloatSphere`,
  `nextSeekTime(length, from, random, minGap)`, `appendHit`, `hitSummary`,
  `MAX_HITS = 40`, `EMPTY_HIT_LOG`.
- Rig is landed in `src/infrastructure/theatre/states/portfolio-project.state.json`
  (sheet `FloatScene`, 6 s, object `"Float Sphere"`, 4 tracks: position x/y/z + rotation.y;
  radius 2.2 XZ, y 1.05→2.15).

Non-obvious rules, all load-bearing:
`eventSource` must be an ancestor of everything under the pointer; `eventPrefix="client"`
without `inset: 0` makes the raycast silent; the canvas is deliberately not a hit target
(a tap reaches the DOM underneath); the log is driven by `lastEvent`, never
`selectedNodeId` (a repeat tap writes the same value); `selectionVisuals` is set **on
mount** per route because `IonRouterOutlet` keeps pages mounted.

### 2. Per-scene saved geometry

Spawned shapes are now partitioned by sheet id. `useShapeStore.shapes` is
`Record<sheetId, SpawnedShape[]>`; `spawn`/`removeNode`/etc. take the sheet id;
`SpawnedShapes` reads `sheet.address.sheetId`; `ShowcasePage` and `StudioCornerPage`
read their own bucket (`EMPTY_SHAPES` fallback, `noUncheckedIndexedAccess` is on);
`ShapePalettePane` counts only its sheet; `migrateLegacyShapes` (exported from
`states/index.ts`, tested in `shapesMigration.test.ts`) upgrades the old flat file;
`shared/studio-save.ts` writes `shapesBySheet` and `scripts/studio-save-plugin.ts`
persists it. Files: `useShapeStore.ts`, `SpawnedShapes.tsx`, `ShowcasePage.tsx`,
`StudioCornerPage.tsx`, `shapeTools/{ShapePalettePane,aimService,extension,saveService}.ts(x)`,
`shared/studio-save{,.test}.ts`, `states/index.ts`, `states/astro.local.shapes.json`.

### 3. Astro style guide

`extra_docs/style/` — 10 files + 11 renders. Colour (6 swatches + derivations),
Urbanist type scale, the sphere's construction (gradient stops, glow falloff, eye
geometry), **12 expression states** with measured offsets, motion (derived — the sheet
has no motion), components (radii, shadow stacks, glass ring), 20 duotone icons,
layout/themes, and a do/don't checklist. Plus a `## Astro's visual language` section in
`AGENTS.md`.

### 4. Animation state machine — PARKED

`parking/animation-state-machine/`, excluded from fmt+lint via `parking/**` in
`vite.config.ts`. It had 244 type errors (`types.ts` diverged from its consumers,
`seekResolver.ts` missing). Unpark only if the user asks; follow the status doc.

---

## Done: Astro on an overlayable scene (`/astro`)

Shipped: a normal React page (hero, 12-state expression picker, tap log, table, control
bar) with a **transparent canvas over it** drawing Astro — the `/float` geometry with a
character instead of a sphere. Tapping the character appends a row (`"you found me!"`),
plays a reaction and seeks the drift.

- `src/core/models/astro.ts` — `ASTRO_STATES` (12), `ASTRO_EXPRESSIONS` specs (halo,
  body gradient, feature pair, glyph, all as fractions of `D`), `ASTRO_COLOURS`,
  `ASTRO_GEOMETRY`, `ASTRO_NODE_KEY = "Astro"`, `ASTRO_DEFAULT_EXPRESSION`.
- `src/core/usecases/astroExpression.ts` — `isTransient`, `lookTowards`, `lookUp`,
  `directionOf`, `wakeUp`, `returnExpression`, `expressionSpec`, `isAstroNode`,
  `ASTRO_REACTION_MS = { min: 900, max: 1600 }`.
- `src/core/usecases/astroInteraction.ts` + test — `ASTRO_HIT_MESSAGE`,
  `appendAstroHit`, `astroHitSummary`, `hitReaction`, `nextAstroSeek`, `MAX_HITS = 40`.
- `src/infrastructure/astro/astroTexture.ts` — draws each state to a canvas and caches a
  `CanvasTexture`; `ASTRO_PLANE_SIZE = 2` (exactly the halo), `ASTRO_BODY_DIAMETER = 1.1`.
- `src/presentation/canvas/scenes/AstroScene.tsx` — plane + `meshBasicMaterial`, no light
  rig, no `<Html>`, no autoplay, press gate on controls.
- `src/presentation/state/useAstroStore.ts` — `expression` / `resting` / `setExpression`
  / `react` / `settle`.
- `src/presentation/ui/pages/AstroPage.tsx` + `styles/astro.css`; route `/astro` in
  `AppLayout`, `AppScreen` includes `"astro"`, `StudioDevButton` links to it.
- Rig landed: sheet `AstroScene`, 8 s, object `"Astro"`, 3 tracks (`position.x/y/z`),
  authored by `scripts/astro-rig-export.mjs` and imported with `theatre-state.mjs`.

Two owners, one prop each: the **rig** owns `position` (never write it from the page),
and the **store** owns the face (no expression track — a clip would win silently). No
`rotation` track on purpose: a flat plane turned edge-on disappears.

Not verified by eye (no headless browser here): the character's framing on a phone, the
halo edge against the page, and the tap→log→seek loop. Check those on `/astro` and
`/rig/astro` before trusting them.

---

## Before you finish anything

```bash
vp check --fix && vp check      # 177 files formatted; 0 warnings/lint/type errors
vp test                         # 19 files / 216 tests, all passing
vp build                        # ✓ built
grep -c "studio.initialize" dist/client/assets/index-*.js   # must be 0
grep -c "astro.scene-tools" dist/client/assets/index-*.js   # must be 0
curl -i -o /dev/null -w "%{http_code}\n" http://localhost:5173/float           # 200
curl -i -o /dev/null -w "%{http_code}\n" http://localhost:5173/astro           # 200
curl -i -o /dev/null -w "%{http_code}\n" http://localhost:5173/rig/astro       # 200
curl -i -o /dev/null -w "%{http_code}\n" http://localhost:5173/showcase/sting  # 200
```

### Visual checks — there is a probe now

`scripts/visual-probe.mjs` drives a real headless Chromium against the dev server. It is
**not** part of `vp test` (no browser project, and these assertions are about pixels);
run it by hand after touching an overlay route:

```bash
export LD_LIBRARY_PATH="$(cat /tmp/chromedeps/ldpath.txt)"   # libs unpacked from .debs;
export CHROME_PATH=~/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome
export PLAYWRIGHT_CORE=/tmp/pw/node_modules/playwright-core  # npm i playwright-core there
node scripts/visual-probe.mjs /astro --tap 195,340 --out /tmp/astro.png
node scripts/visual-probe.mjs /rig/astro --out /tmp/rig.png
```

The script's header documents rebuilding `/tmp/chromedeps` and `/tmp/pw` from scratch
(`apt-get download` + `dpkg-deb -x`; no root needed). It prints the height chain, the
canvas's pixel size, the console, and — with `--tap` — the tap count, first log row,
expression, playhead and seek, before/during/after the reaction.

Verified that way on a 390×688 viewport: the overlay is `390×688` at `0,0` and the canvas
backing store matches it; a tap on the character appends a row, plays `happy` and seeks;
the row settles back to `idle`; a mouse move left gives `look-left`; a tap on a picker
chip logs nothing; wheel over the character scrolls the page; a touch drag scrolls the
page; and at max scroll the last chips clear the fixed bar.

Still eyeball-only: how the halo reads on a real OLED phone, and whether the tap target
(one plane, `2 D`) feels right with a thumb. Say so; do not overclaim.

## Untracked — commit before handing off

`assets/astro-stylesheet.svg` (1.06 MB, the source of truth the guide transcribes),
`extra_docs/style/` (3.9 MB with renders), `parking/`,
`extra_docs/ANIMATION-STATE-MACHINE-BUILD-STATUS.md`. The `refs/*.png` are regenerable
from the SVG; the SVG itself is not.

## Known traps (do not "fix")

- `eventPrefix="client"` divides by canvas size with **no origin subtraction** — correct
  only because the overlay is `position: fixed; inset: 0`. Any other geometry → silent
  raycast miss.
- Making the canvas a hit target eats the page's clicks. The double-hit is accepted.
- Never write `position.x` from a page: the rig owns it, the clip wins silently.
- `FLOAT_AUTOPLAY` and `playback.sequence` are effect dependencies; `playback` itself must
  not be (fresh object of closures each render).
- Theatre state files are formatter-ignored on purpose (`portfolio-project.state.json` and
  both `astro.local.*`); "not correctly formatted" there is the formatter, not the rig.
- `vp check` failing on `parking/**` means the ignore pattern was lost, not that the code
  came back.
