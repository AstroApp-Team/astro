# Rigging animations in Theatre.js

The Studio is a dev-only desktop editor. What ships is the **exported state
JSON**. So the job is never "make the animation in code" — it is: put the right
things in the outliner, keyframe them, export, land the export on the right sheet
id.

```
code: scene as data + editable prefabs
  → /rig/<scene> in dev, desktop browser
  → Studio: keyframe
  → Export state
  → pnpm run theatre:state -- import <the.json> --to <SheetId>
  → play it
```

## Start a new animation

**1. Give the scene a sheet, in both tables.**

`src/infrastructure/theatre/project.ts`:

```ts
export const SHEET_IDS = {
  // ...
  sting: "StingScene", // a word, >3 chars — Theatre rejects short ids
} as const;

export const SCENE_SHEET_IDS: Record<SceneId, SheetId> = {
  // ...
  sting: SHEET_IDS.sting, // missing entry here is a compile error, on purpose
};
```

The string on the right is the key the exported state must land on. Pick it once
and never change it — every export you already made is keyed by it.

**2. Add the scene id.**

`src/core/models/scene.ts`: add to `SCENE_IDS`, and add the node array the scene
renders:

```ts
export const MY_NODES: SceneNode[] = [
  { theatreKey: "My-Thing", label: "Thing", status: "active", position: [0, 0.7, 0] },
];
export const MY_AUTOPLAY: [from: number, to: number] = [0, 4]; // module constant
```

**3. Write the scene.** Copy `src/presentation/canvas/scenes/StingScene.tsx`.
Keep the shape: `SheetProvider` → `TheatreCameraRig` → `SceneLights` →
`NODES.map(EditableNodePrefab)`. Register it in `sceneRegistry.tsx`.

Every animatable thing must be an `editable.*` with a **stable `theatreKey`** —
that key is the address the exported state writes into. Rename it later and the
clip stops applying, silently.

**4. Decide who owns each prop.** JSX `position` is Theatre's _initial value_.
A keyframed prop overrides it; an unkeyframed one falls through to the JSX. One
prop, one owner. Keyframe `position.y` and `scale` in the Studio, leave `x`/`z`
to the data array.

**5. Rig it.** `vp dev`, open `http://localhost:5173/rig/my-scene` on a desktop
browser, **Toggle Studio**.

- Select an object → click the **stopwatch** on a prop → a clip appears.
- `Space` play/pause · `N` new clip · `P` position keyframe.
- Right-click a keyframe for **easing** — that is where "floaty" vs "snappy" lives.
- Rig the **camera last**: keyframe `My Camera`'s `position` and `fov`. Everything
  else is authored against the framing you settle on at the end.
- Keep it short. Four seconds is a sting; ten is a scene you have to scrub.

Studio edits live in **localStorage**, not in git. Export is the only persistence.

**6. Export and land it.**

Studio → right-click the project → **Export state** → you get
`PortfolioProject.state.json`. Then:

```bash
pnpm run theatre:state -- import ~/Downloads/PortfolioProject.state.json --to MyScene
pnpm run theatre:state -- list
```

The script renames the export's sheet key onto `MyScene`, merges it into
`src/infrastructure/theatre/states/portfolio-project.state.json`, and warns you if
that id is not in `SHEET_IDS`. `states/index.ts` already imports the whole file —
no code edit needed to register a new rig.

**7. Play it.** Nothing plays a sequence by itself:

```ts
const playback = useSheetPlayback(getSheet(SCENE_SHEET_IDS["my-scene"]), MY_AUTOPLAY);
playback.play([0, 4]); // in an event handler
playback.loop([0, 4]); // for an idle loop
```

**8. Verify.** `vp check` · `vp test` · `vp build`, then:

```bash
grep -c "studio.initialize" dist/client/assets/index-*.js   # must be 0
grep -c "MyScene" dist/client/assets/index-*.js             # must be >= 1
```

Then look at it on a phone — `dpr={[1, 1.5]}` and `antialias: false` mean a
desktop-perfect clip reads differently there.

## Which bench to use

| Route               | Sheet                     | Use it when                                                                                                                                                                 |
| ------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/rig/<scene>`      | the scene's **own** sheet | the rig is going to production. Export needs no rename.                                                                                                                     |
| `/studio-corner`    | `StudioSandbox`           | an experiment that must not touch a production timeline. Export needs `--from StudioSandbox --to <SheetId>`.                                                                |
| `/showcase/<scene>` | the scene's **own** sheet | seeing the rig as an end user does. Read-only: no Studio, no toolbar, scrolling React over the canvas.                                                                      |
| `/float`            | `FloatScene`              | the inversion: a React page with a transparent canvas **over** it. See "The overlay page (`/float`)".                                                                       |
| `/astro`            | `AstroScene`              | the same inversion as `/float` with a **character** instead of a sphere: a flat vector drawing on a plane, face owned by the store. See "The character overlay (`/astro`)". |
| `/surface`          | `SurfaceScene`            | React pages used **as** mesh textures, and presses that go through a texture. See "The texture page (`/surface`)".                                                          |

## The integrated page (`/showcase`)

`presentation/ui/pages/ShowcasePage.tsx` is the read-only side of the same rig: the
production scene component, on the production sheet, under a React page that scrolls
over it. `/showcase` defaults to the sting; `/showcase/<sceneId>` takes any scene in
`SCENE_IDS`.

It is the check that the rig is actually shippable, so keep it working when you change
the scene layer:

- **It mounts the scene, it does not re-implement it.** `MainCanvas` →
  `SCENE_COMPONENTS[scene]`, so the JSX, the sheet and the spawned shapes are the ones
  `/rig/<scene>` edits. Nothing in the page owns a transform.
- **Replay is a sequence call, not an animation.** `useSheetPlayback(getSheet(...))`
  returns the same cached `ISheet` the scene mounted. Seek to `0` first —
  `sequence.play({range})` starts from the _current_ playhead when it is inside the
  range, so replaying a finished clip without seeking starts at the end.
- **The sphere → button hook goes through the stores.** `SpawnedShapeMesh` writes its
  `theatreKey` into `useSceneStore`; the page reads `lastEvent` and asks
  `findDynamicShape(shapes, nodeId)` (pure, `core/usecases/showcaseInteraction.ts`,
  tested) whether the key belongs to a shape the Studio spawned. Prefab keys are
  deliberately not matched.
- **It subscribes to `lastEvent`, not `selectedNodeId`.** A second click on the same
  sphere writes the same string, so a selector on it does not re-render and the colour
  changes once. `lastEvent` is a fresh object per pointer down.
- **The selection highlight is off here; the selection is not.**
  `useSceneStore.selectionVisuals` gates only the drawing — the sky-coloured material
  and `.node-card--selected` — through `showsSelectionHighlight()` in
  `core/usecases/showcaseInteraction.ts`. `selectNode()` still runs on every pointer
  down, because that write is what the sphere hook reads; clearing the selection to hide
  the highlight would delete the page's signal. Both benches state `true` and the
  showcase states `false` **on mount**, and that is not redundancy: `IonRouterOutlet`
  keeps the page you navigate away from mounted, so an outgoing page's cleanup does not
  run on a forward navigation, and a bench that inherited the flag would open with
  nothing highlighted.
- **A panel is named after the cube that opens it.** `SHOWCASE_PANELS` in
  `src/presentation/ui/components/showcasePanels/registry.ts` maps the four `sting` satellites'
  `theatreKey`s to four panel components, and each entry's `title` is that node's `label` in
  `STING_NODES` — the word the drei `<Html>` card paints on top of the cube. Rename a label and the
  card says one thing while the sheet that opens says another, with nothing in the app to notice;
  `registry.test.ts` fails on exactly that drift. Each panel is its own component with its own state
  and its own stylesheet (`styles/panel-*.css`); the page hands it one prop, `onClose`, and knows
  nothing about what is inside. `ShowcasePanelHost` owns the chrome — title, close, Escape, scrim.
  `Sting-Core` is absent on purpose: it is what the ring is arranged around, so a panel for it means
  a tap near the middle of the frame drops a sheet over the scene. Panels open off `lastEvent` for
  the same reason as the sphere hook — a second tap on the same cube is the same string, so a
  selector on `selectedNodeId` would open a panel that could never close.
- **The Studio panel is hidden for the whole route,** via `ensureStudio()` →
  `hideStudioUi()`, restored on unmount. `initialize()` is what _shows_ the panel, so a
  page that never resolves the studio cannot hide it — same reason the benches await it.
- **Shapes are dev-only.** The sphere exists because the Save file seeds
  `useShapeStore`; a production build seeds none. A rig that must ship with its shapes
  moves them into the scene's node array.

## The overlay page (`/float`)

`presentation/ui/pages/FloatPage.tsx` is the inversion of `/showcase`: a normal React
page — header, chat log, table, buttons — with a **transparent Theatre.js canvas laid
over it**. One sphere, `FloatScene`, drawn on top of the text. `/showcase` is a page
over a scene; `/float` is a scene over a page, and every layer is inverted with it.

- **The scene draws nothing but the sphere.** No floor, no grid, no background, no
  `<Html>` cards: every pixel the WebGL layer does not draw is a pixel of the page
  showing through. A `gridHelper` on this route is not a reference, it is an opaque
  rectangle over the user's text.
- **`eventSource` + `eventPrefix="client"` are a pair, and both are load-bearing.**
  A full-bleed transparent canvas is an invisible sheet over the user's buttons, so
  `MainCanvas` gets `eventSource={rootRef}` (the `.float` div): R3F puts
  `pointer-events: none` on the canvas and attaches its listeners to that element.
  The source must be an **ancestor of everything under the pointer** — that is where
  events arrive by bubbling. And `eventPrefix="client"` is not cosmetic: R3F's
  default compute reads `offsetX/offsetY`, which are relative to the event's
  **target**, and with an event source the target is the card the user meant to
  click, so the raycast lands hundreds of pixels from the finger. `client` reads
  `clientX/clientY` and divides by the canvas's size with **no origin subtraction**,
  which is only correct because `.float__overlay` is `position: fixed; inset: 0` —
  the canvas's box _is_ the viewport. Move the overlay off the origin and the
  raycast goes silently silent: taps append nothing, no error is logged.
- **The consequence is accepted, not fixed.** The canvas is not a hit target, so a
  tap that hits the sphere also reaches the DOM element under it. Making the canvas
  a hit target would eat the page's clicks, which is the worse bug. It is documented
  in `FloatPage`'s header comment.
- **The inverse half needs a gate, and the gate is on controls.** The same wiring runs
  the other way: every pointerdown in the page also runs the mesh handlers, so a tap on
  a card, a log row or a bar button that happens to sit over a mesh is a press the user
  did not make — on `/float` it appends a row, on `/surface` it paints the colour
  sphere. It cannot be a gap-only test, because the meshes cross the whole page (the
  sphere page's own button sits over the log panel). `isMeshPressTarget` in
  `FloatScene.tsx` and `SurfaceScene.tsx` rejects a press whose event target is inside
  a button, a link, a form control, the bar or the table, and accepts everything else.
  Tapping text a mesh is standing on presses that mesh, which is what a mesh in front
  of the page means. It reads **`event.nativeEvent.target`**: R3F replaces `event.target`
  on every mesh event with a pointer-capture shim, so a gate on `event.target` rejects
  every press and compiles clean.
- **The page owns playback.** `FloatScene` calls no `useSheetPlayback` autoplay: a
  scene that started the clip on its own would be a second owner of the same
  playhead, racing the page's seeks. `FloatPage` seeks to `FLOAT_AUTOPLAY[0]` and
  loops `FLOAT_AUTOPLAY` in an effect keyed on `sequence`, and pauses on cleanup.
  `FLOAT_AUTOPLAY` is a module constant because it is an effect dependency.
- **"Move the sphere" is seek the playhead, never write `position.x`.** The orbit is
  keyframed on `FloatScene`; a page that wrote the prop would be a second owner of
  it, the clip wins silently, and nothing warns you.
- **Effects that move the sequence take a `sequence`, not the adapter object.**
  `useSheetPlayback` exports `seekSequence` / `loopSequence` / `pauseSequence` /
  `sequenceLength` for exactly this. `playback` is a fresh object of closures every
  render, so it cannot sit in a dependency array: leave it out and
  `react-hooks/exhaustive-deps` fires, and suppressing that costs the whole page its
  React Compiler pass; put it in and the effect re-runs every render — this page
  re-renders ten times a second off its playhead subscription, so one tap logs ten
  rows. A `sequence` is the sheet's own object and is stable for the sheet's
  lifetime, so the deps are honest and nothing is suppressed.
- **Sphere → page is `lastEvent`, not `selectedNodeId`.** A second tap on the same
  sphere writes the same string, so a selector on it does not re-render and the log
  records one row for ten taps. `lastEvent` is a fresh object per pointer down, and
  it is the effect's only dependency, which is what makes it run once per tap.
- **`selectionVisuals` is `false` here, stated on mount.** The sphere is a thing you
  can hit, not rigging furniture: it is tappable and does not light up.
- **Rig it on `/rig/float`.** `RigPage` reads `SCENE_IDS` and `SCENE_SHEET_IDS.float`,
  so the bench mounts this exact sheet and
  `pnpm run theatre:state -- import <exported.json> --to FloatScene` lands it with no
  rename. The rig is four tracks on one object (`position.x`, `position.y`,
  `position.z`, `rotation.y`): radius 2.2 in XZ, y bob 1.05 → 2.15, `rotation.y`
  0 → 2π, six seconds. `FLOAT_CAMERA` (`[0, 1.6, 7.5]`, fov 45) frames it so the
  sphere crosses the full viewport width and stays in roughly the 35–65% vertical
  band on a 390×688 phone — which is why the hero text is in the top ~30% and the
  log panel starts below the band.

## The character overlay (`/astro`)

`presentation/ui/pages/AstroPage.tsx` is `/float`'s arrangement with Astro in place of the
sphere: hero, expression picker, tap log, table and bar are the page, and `AstroScene`
draws one thing over them. The wiring — `eventSource`, `eventPrefix="client"`, a
`position: fixed; inset: 0` overlay, the control gate on mesh presses, `lastEvent` as the
mesh → page signal, `selectionVisuals: false` on mount — is copied wholesale, because that
wiring is the part that is easy to get silently wrong and there was no reason to rediscover
it. What differs is what the character _is_:

- **The character is a plane wearing a canvas texture, not a mesh.**
  `infrastructure/astro/astroTexture.ts` draws each of the 12 states of the stylesheet into
  a 2D canvas (halo, rim bloom, body gradient, features, glyph) and caches the
  `CanvasTexture` per state, so the scene is `<planeGeometry>` +
  `<meshBasicMaterial map transparent depthWrite={false} toneMapped={false}>` and a
  re-render costs a `Map.get`. `ASTRO_PLANE_SIZE` is exactly the halo (`2 D = 1.8 R`):
  smaller crops the glow into a visible edge, larger makes empty corners part of the tap
  target.
- **There is no light rig on this scene, on purpose.** The stylesheet's whole lighting
  model is the halo plus the flush blurred `#FF8B00` rim bloom, and both are baked into the
  texture. A `meshStandardMaterial` would add a second, contradictory lighting model on top
  of them.
- **The rig owns `position`; the store owns the face.** `useAstroStore.expression` is a
  texture swap, and a keyframed expression on the sheet would win over the page's picker
  silently. `scripts/astro-rig-export.mjs` therefore keyframes `Astro.position.{x,y,z}`
  only — 8 s, five keys per axis, ±0.7 in x, ±0.22 in y, ±0.3 in z — and deliberately no
  `rotation` track: the character is a flat plane, and a keyframed turn shows the page its
  edge and the drawing disappears. Land it with
  `node scripts/astro-rig-export.mjs --out /tmp/astro.export.json` then
  `node scripts/theatre-state.mjs import /tmp/astro.export.json --to AstroScene`.
- **`ASTRO_CAMERA` is measured, not chosen.** `astroTexture.ts` pins the body at 1.1 world
  units so that at `fov 45`, `z 7.5` it is ~120 px of body on a 390×688 phone — the
  reference size in `extra_docs/style/03-astro-form.md`. Moving the camera rescales the one
  number that was measured, so the two files change together.
- **A reaction needs an exit, and the predicate lives in core.** `isTransient`
  (`core/usecases/astroExpression.ts`) is the single list of states that end on their own;
  the page arms one `setTimeout` keyed on `expression` for `ASTRO_REACTION_MS.max` and the
  store's `settle()` returns to `resting`. `resting` is tracked separately because
  `isTransient("happy")` is true and a reaction that returns to itself never ends.
- **The pointer only moves a resting character.** `POINTER_FOLLOW_STATES` in `AstroPage.tsx`
  is `idle` plus the three `look-*` placements: `lookTowards` snaps to one of the sheet's
  seven eye placements rather than interpolating (the sheet has no in-between drawings), and
  a mouse must not overwrite `doze` or an in-flight reaction or those states become
  unreachable with a pointer. Touch is excluded — on a phone every scroll is a pointer move.
- **Rig it on `/rig/astro`.** `RigPage` reads `SCENE_SHEET_IDS.astro`, so the bench mounts
  this exact sheet and the import needs no rename.
- **The bar's accent rolls over Astro's own poles, not the hue wheel.** `rollAstroAccent`
  (`core/usecases/astroInteraction.ts`) draws from `ASTRO_ACCENTS` — `bodyTop`, `bodyMid`,
  `bodyBottom`, `glow`. Reusing `/showcase`'s `randomAccentColor` here paints a cyan Nudge
  button, which is a colour the stylesheet does not print; the Nudge button and the active
  chip keep the sheet's `137deg` body gradient with a cream caption.
- **`.astro__hero` is `min-height: 58vh`, not `%`.** Its parent is the scroller's content
  box, so a percentage resolves against a content-driven height and collapses to `auto`
  (measured: 292 px instead of 399 px). 58vh puts the panel's top edge at ~66% of the
  viewport, just under the band the drift covers, so the halo does not cross the text.
- **Verify with `scripts/visual-probe.mjs`.** It is not in `vp test`; it launches headless
  Chromium and prints the height chain, the canvas backing-store size, and the tap →
  log → seek loop. `/tmp/chromedeps` + `/tmp/pw` (playwright-core) are rebuildable; the
  script's header has the commands.

## The texture page (`/surface`)

`presentation/ui/pages/SurfacePage.tsx` is the third arrangement. `/showcase` lays a page
over a scene, `/float` lays a scene over a page, and `/surface` builds the scene **out of
the page**: two React pages are rasterized into textures and mapped onto a plane and a
sphere. Each page carries one button, and each button drives the _other_ object — the
square page paints the colour sphere, the sphere page spins the square page. Pressing a
button **on the mesh** and pressing the same button on the page behind are two routes to
one store action, and the log records which one came through the texture.

- **The pages are parked, not hidden.** `.surface-hosts` is `position: fixed`
  at `left: -10000px`. `display: none` and `opacity: 0` both look like the right
  answer and both are wrong: a subtree the browser does not lay out has no boxes, so
  `getBoundingClientRect` returns 0×0, every published rect is empty, and every
  raycast through the texture misses with no error. Off screen is laid out, measured
  and invisible at the same time.
- **The raster is clone → inline styles → SVG `foreignObject` → `Image` → canvas**
  (`infrastructure/surface/rasterizeSurface.ts`, no new dependencies). Three
  consequences: `backdrop-filter` renders as nothing (an image has no backdrop),
  external images never load (an image document cannot fetch sub-resources), and the
  page must be sized in pixels — the raster measures the root element, so the CSS
  sizes in `surface.css` _are_ the texture dimensions (512×512, 640×320).
- **A texture page renders only press-derived state.** The host is watched by a
  `MutationObserver`, and one mutation is a style walk, an SVG encode, an image decode
  and a ~1 MB texture upload. A clock, a playhead readout or any per-frame value
  inside a surface page is a raster per frame. That is why the playhead is read out on
  the page and never inside `SquareSurface` / `SphereSurface`.
- **A sphere page is 2:1, not square.** A sphere's UV sweeps the texture around the
  whole circumference horizontally and only pole-to-pole vertically, so a square page
  on a sphere is squeezed into the middle band of the visible side and its buttons
  land near the poles. `SURFACE_SPECS` in `core/models/surface.ts` carries the box.
- **UV → page pixel must flip `v`.** three uploads a canvas with `flipY`, so UV
  `v = 1` is the **top** row of the page. `uvToSurfacePoint` in
  `core/usecases/surfaceInteraction.ts` does the flip; skip it and every hit is
  mirrored — the button at the bottom answers taps at the top, which reads as "the
  buttons are a bit off" rather than as a missing `1 - v`.
- **The store is the only 2D ↔ 3D channel, and here that is load-bearing rather than
  polite.** A button inside a texture _cannot_ be clicked and a mesh _must not_ know a
  table exists. The page publishes the box of every `data-surface-action` element
  through `publishSurfaceRects`; the mesh raycast resolves a UV to one of those rects
  and writes the same `press()` the DOM button calls. The log's `source` field is
  `texture` or `page`.
- **`eventSource` + `eventPrefix="client"` apply here exactly as on `/float`** — see
  the bullets above. `.surface__overlay` is `position: fixed; inset: 0`, the canvas is
  not a hit target, and mesh presses are gated to non-control taps by `isMeshPressTarget`.
- **The page owns playback, and the spin is a clip.** `SurfaceScene` calls no
  `useSheetPlayback`. `SurfacePage` parks the playhead at `SPIN_RANGE[0]`, and a spin
  request rewinds to `SPIN_RANGE[0]` and plays the range out, stopping at
  `SPIN_RANGE[1]` from the position subscription — always from the start, because the
  request is "spin it **once**" and a mid-clip start turns it partway. `SPIN_RANGE` is a module constant for the usual reason (it is
  an effect dependency and a play range) and one more: **the rig's keyframes are
  authored for exactly that window**, so changing it without re-landing the rig makes
  the button seek to a playhead the clip does not cover.
- **The plane is `DoubleSide`.** The spin is a full revolution, and a default
  single-sided plane vanishes for half of it — the animation reads as broken when the
  geometry is fine. The back shows the page mirrored, which is what a printed card does.
- **"Spin the square page" is a seek, never a write to `rotation.y`.** The rig owns
  that prop; a page that wrote it would be a second owner, the clip wins silently, and
  nothing warns you.
- **The colour sphere's colour is app state, not a rig track.** Same rule, one notch
  sharper: a rig colour track and a store colour on one prop means the clip wins and
  the button appears to do nothing. The sheet has no colour track on that object.
- **The rig is one track.** `SurfaceScene` is 3 s with `Surface Plane.rotation.y` only:
  0 → 2π sampled as a smoothstep at five points, so the turn leaves rest and arrives at
  rest — a linear ramp has a corner at each end and snaps into the spin. Rig it on
  `/rig/surface` and land it with `pnpm run theatre:state -- import <exported.json>
--to SurfaceScene`. Because there is no headless browser in this environment, the
  landed curve came from `scripts/surface-rig-export.mjs`, which emits the same
  Studio-shaped JSON (`definitionVersion`, `sheetsById` → `sequence.tracksByObject` →
  `trackData`) as a Studio export, so the land step is the normal one:
  `node scripts/surface-rig-export.mjs --out /tmp/surface.export.json` then
  `node scripts/theatre-state.mjs import /tmp/surface.export.json --to SurfaceScene`.
- **A sphere shows the middle half of its texture.** With `SPHERE_SURFACE_ROTATION_Y =
-π/2` the page's centre faces the camera, and the front hemisphere is texture x
  160–480 of 640. Controls in a sphere page must be centred in the page — a
  left-aligned button starts at x 34, wraps around the far side, and the part the user
  can see is a sliver that almost never matches a published rect.
- **A surface page is styled with elements only.** The raster copies used styles onto a
  clone; pseudo-elements are not copied, and an image document cannot load
  sub-resources. So inside `.surface-page`: no `::before` / `::after` styling, no
  `backdrop-filter` (no backdrop in an image — it renders as nothing), no `url()`, no
  `<img>`. `surface.css` keeps that split by construction: everything above the
  "pages" marker is page chrome and uses all three freely; nothing below it does.
- **The raster must continue itself.** A raster in flight cannot see the DOM as it is
  now, so `useSurfaceRaster.ts` re-dirties and returns — and the frame that continues it
  must be scheduled by the raster that just finished, not by the mutation that
  re-dirtied. Polling per frame busy-loops at 60 Hz for the length of a raster;
  scheduling nothing leaves the last commit of a burst undrawn, and the texture sits
  one step behind the page. A `disposed` flag keeps a raster that resolves after
  teardown from publishing rects for a host that is gone.

### Scrolling a page inside a texture

The pages under the textures are parked 10 000 px off screen with `pointer-events: none`.
They have no scrollbar and nothing native to scroll, so a scroll command has to be built
out of the channels the page already has. It is a **store offset the page translates
itself**, not a rotation of the mesh — spinning a plane to fake a scroll moves the whole
page, including the button the user is aiming at, and it does nothing at all to the
sphere's list, because the sphere's UV wraps the texture around the mesh: rotating it only
slides the seam.

- **The offset lives in `useSurfaceStore.scroll`** (`{ square, sphere }`, px, wrapped).
  `scrollSurface(surfaceId, delta)` is the only writer, and it wraps with
  `advanceLoopScroll(offset, delta, LOOP_TILE_HEIGHT)`.
- **The loop is a duplicated tile.** The tile is a whole copy of the page — heading, the
  spin button, the copy, the rows — stacked twice and translated by `-offset`, so the
  button travels with the page and appears and disappears as it scrolls. A fixed header
  with a looping list inside it loops a list and parks the button, which is not the page
  looping. The tile's height and every row's height are inline, from
  `LOOP_HEADER_HEIGHT` / `LOOP_ROWS` / `LOOP_ROW_HEIGHT` / `LOOP_TILE_HEIGHT` — the wrap
  point and the layout must be the same number, and a stylesheet that drifts from a
  constant is a seam nobody can see in a diff. `LOOP_TILE_HEIGHT` must also stay divisible
  by `MAX_WHEEL_DELTA`: 150 for the header made the tile 750, and the test that walks one
  tile forward and back stopped landing on the start.
- **Both copies of the loop publish rects. The window clip is what decides what is
  hittable.** `measureSurfaceRects` walks `[data-surface-action]` in the host, and the loop
  renders the page twice, so both copies are measured. Skipping the duplicate — by
  `aria-hidden`, or by the `data-surface-ghost` marker — is what makes a visible button
  unhittable: as the offset grows, the first tile's copy walks out of the window's top, and
  the copy the user is looking at _is_ the duplicate. Drawn, publishing nothing, and the tap
  lands on empty texture — which reads as "the button works in the top half of the sphere
  and dies below the middle". Two copies can never be in the window at once
  (`LOOP_TILE_HEIGHT` 840 against `LOOP_STRIP_HEIGHT` 300; a test guards it), so there is no
  phantom rect to skip. The skip cannot be keyed on `aria-hidden` either: the parked hosts
  are `aria-hidden` themselves (off-screen decoration, out of the tab order), so an
  `aria-hidden` walk skips every button on every surface page, the measurer returns nothing,
  every texture press misses, and the base page's own buttons keep working — which is
  exactly how that bug presents. `SURFACE_GHOST_ATTR` stays on the duplicate as a label of
  what it is; the measurer does not read it.
- **A looped page clips what is drawn, so it must clip what is hittable.**
  `getBoundingClientRect` reports an element's full box wherever the translation has
  carried it, clipped or not. Without the intersection with the loop window
  (`SURFACE_WINDOW_ATTR`, marked on the window, not looked up by class name), a button
  that has scrolled out of the texture — invisible, not drawn — keeps a rect reaching into
  the window, and a tap on a row that _is_ drawn fires it. `clipRectToWindow` returns null
  below `MIN_VISIBLE_SIZE`, so a button clipped to a sliver at the window's edge is not a
  target either. A moving button that is on screen is correct and is the point: its rect is
  measured at raster time, so it travels with the translation.
- **Three inputs, one command.** A wheel over a mesh (`onWheel` on the mesh, gated to the
  mesh under the pointer by `wheelTarget`), a drag on a mesh (`onPointerDown/Move/Up`), and
  a drag on the real page (`SurfacePage`'s root pointer handlers, scaled by
  `SCROLL_DRAG_FACTOR`). All three call `scrollSurface`. A finger never produces a
  `WheelEvent`, so the drag paths are not a nicety — without them the loop is mouse-only.
- **Convert `deltaMode` before clamping.** `wheelDeltaToPixels(deltaY, deltaMode)` turns a
  line-mode notch (Firefox + mouse reports `deltaMode: 1`, so a notch arrives as `3`) into
  pixels, then clamps one event's travel to `MAX_WHEEL_DELTA`. Clamp first and a Firefox
  notch scrolls 3 px, which reads as a wheel that barely moves on one browser and works on
  the other.
- **`wheelTarget` is the gate, and it is the raycast's answer.** The mesh's `onPointerDown`
  sets it and `onPointerOut` clears it. Without it every wheel on the route scrolls both
  texture pages and the real page at once, and a wheel over the square plane scrolls a list
  the user cannot see.
- **The page's wheel listener is native with `{ passive: false }`.** React registers wheel
  delegates with the passive flag, and `preventDefault` is a no-op inside a passive listener
  — the page scrolls anyway. R3F's own wheel listener is passive for the same reason
  (`DOM_EVENTS.onWheel = ['wheel', true]` in R3F 9.8.2), so the mesh cannot cancel the
  page's scroll either. `SurfacePage` registers its own listener on the event source after
  R3F connects, and it is the only place on the route that can cancel: when `wheelTarget`
  is set it calls `preventDefault()` and does not forward the delta, so the texture page
  scrolls and this one does not.
- **`touch-action` is read at `touchstart`, so the touch region must exist before the
  gesture.** `.surface--over-mesh .surface__scroll { touch-action: none }` looks right and
  cannot work: the class is applied by a React commit, one frame after the pointerdown that
  started the gesture, and by then the browser has already committed to panning
  `.surface__scroll` and answers with `pointercancel` — the drag on the texture page never
  happens, with no error. The mechanism is `SurfaceTouchShield.tsx`, a `position: fixed` div
  at `z-index: 2` (above the story, below the bar; the hero is raised to `z-index: 4` so its
  own button stays a button) whose box the scene publishes per frame through
  `infrastructure/surface/surfaceFootprints.ts`: the mesh's geometry projected into NDC by
  `Vector3.project`, boxed by `core/usecases/surfaceFootprint.ts`, clamped to the viewport.
  The registry drops notifications below `FOOTPRINT_EPSILON`, because the sphere bobs every
  frame and a DOM write per frame for a third of a pixel is the bug. The shield is invisible
  to the raycast — it is not an R3F event source, and its events bubble to the page root,
  which is. The overlay cannot do this job: it is `pointer-events: none`, so it never
  participates in a gesture.
- **The raster is the render step.** The translation mutates the parked host, the
  `MutationObserver` fires, the page is rasterized, the texture uploads. A scroll is
  therefore ~1 MB of texture upload per step — which is why the strip is 100 px of a 600 px
  tile and the rows are 50 px, and why nothing else in a texture page is allowed to tick.

## Studio tools: Add Shape, Aim Camera and Save

`studio.extend()` registers one extension, `astro.scene-tools`, from
`presentation/canvas/studio/shapeTools/extension.ts`. It puts four icons and a
flyout in the Studio's global toolbar and contributes one dockable pane
(`astro-shape-palette`).

- **Add Shape** opens a menu (Cube, Sphere, Flat Square, Flat Circle). A pick
  writes a `SpawnedShape` into `useShapeStore`; `<SpawnedShapes />`, mounted
  inside the sandbox's `SheetProvider`, renders each one as an `editable.mesh`,
  so it lands in the outliner under its `theatreKey` (`Cube-0`, `FlatCircle-3`)
  and is keyframeable like any prefab. Flat shapes spawn rotated `-90°` on X so
  they lie on the grid.
- **Aim Camera** resolves a target — Studio selection, then the canvas
  selection, then `useSceneStore.cameraTarget` — computes the Euler that puts
  the camera's `-Z` on it, and writes it with `studio.transaction()`. Because
  the write goes through the transaction API, it becomes a keyframe at the
  playhead if `rotation.xyz` is already sequenced, and the first key of a new
  clip if it is not.

The tools act on `useShapeStore.sheetId`, which the bench sets on mount: the
sandbox sets `StudioSandbox`, `/rig/<scene>` sets that scene's sheet. The pane
exposes both, plus the camera `theatreKey`, for when a scene names its camera
something else.

- **Save to disk** writes the whole project — every sheet, every keyframe — plus
  the spawn list, to two files. See the next section; this is the one that decides
  whether an afternoon of rigging survives a reload.

```text
studio.extend(config)                        // 1. register — before initialize()
studio.initialize({ usePersistentStorage: false })  // 2. paint the toolbar; the files are the persistence
```

## The tools dock

`/studio-corner`, `/rig/:sceneId` and `/machine` carry a **Tools** rail on the right edge
(`presentation/canvas/studio/tools/ToolsDock.tsx`). It is the app-level door to every
authoring panel:

| Panel       | What it does                             | Where the code lives                            |
| ----------- | ---------------------------------------- | ----------------------------------------------- |
| Scene tools | spawn/aim/save, sheet picker, shape list | `canvas/studio/shapeTools/ShapePalettePane.tsx` |
| Machine     | layers, clip assignment, input writes    | `canvas/studio/machineTools/MachinePane.tsx`    |
| Character   | 12 expressions + the v2 look uniforms    | `canvas/studio/tools/AstroPane.tsx`             |
| Editor ↗    | the machine editor, new tab              | `/editor?editor`                                |
| Demo ↗      | the machine demo, new tab                | `/machine`                                      |

The panels are the _same components_ the Studio extension registers as `panes[]`; the dock
mounts them into nodes it owns, with the same `mount(node) → teardown` contract. That means
they work even when the Theatre.js panel is closed, not initialised, or unusable at a
phone-sized window, and a closed window holds no subscriptions.

Two things about this file are not cosmetic:

1. **It portals to `document.body`.** `IonContent` establishes a stacking context, so a
   `position: fixed` dock rendered inside the page competes at the page's z-index — and
   `#theatrejs-studio-root` is a body-level fixed overlay at `z-index: 100`. The rail was
   visible and every press was swallowed by the empty Studio root. Body is the only stacking
   context the two share, and the rail is `z-index: 110` so the Studio cannot cover it.
2. **Window bodies are opaque.** The panes are transparent by design (they were built for the
   Studio's dark chrome), so without a background the outline tree behind reads through and
   two texts look like one broken pane.

The Character panel is a store consumer, not a rig editor: `expression` and the v2 tunables
are app state, and a keyframed expression or wave would win over these controls silently —
which is why the two astro scenes carry only the character's `position` on their sheets.

## Rigging a clip for the state machine

The machine's clips are Theatre timelines. The bridge is a second dev-only extension,
`astro.machine-tools` (`presentation/canvas/studio/machineTools/extension.ts`), registered
beside the scene tools inside the same `import.meta.env.DEV` guard — hoisting its import
ships the pane to the phone.

1. **Rig the timeline.** `/rig/<scene>` mounts the scene's production sheet, so the
   keyframes land where the scene will read them. A cycle is what the machine wants: a
   `position` orbit, a bob, a `rotation` turn — the same tracks any scene animates.
2. **Press Save to disk**, then reload. The pane reads the _exported_ project state, not the
   live Studio session, because that is the state the app ships; a Save is what makes a new
   track visible to it.
3. **Open the Machine pane** (the graph icon in the global toolbar). Every
   `"<SheetId>/<ObjectKey>"` clip the state contains is one row, with its duration, its
   channels, and the bone it will write to.
4. **Add as layer.** The pane writes `withClipLayer(definition, { clipId })` into
   `localStorage["astro.machine.definition"]` — an _override_, not the shipped file — and
   `/machine` prefers it on the next load. Pressing add twice edits one layer instead of
   stacking two that fight over the same bones; **Remove** deletes it, and the last layer
   cannot be removed because the loader requires one.
5. **Reload `/machine`.** The clip layer is listed in the readout with its progress; the
   character is now driven by the timeline, not by the demo clip.
6. **Download definition** when it is right, and move the JSON into
   `src/infrastructure/theatre/animationStateMachine/definitions/`. That is the durable
   copy; the override is the fast loop.

Two limits worth knowing before hunting a bug:

- **The bone map is in the app, not in the pane.** `THEATRE_BONE_MAP`
  (`presentation/canvas/machine/machineAuthoring.ts`) maps a Theatre object onto the rig's
  bone — `"Float Sphere" → head`, and so on. An unmapped object writes under its own key and
  the rig reports "no bone", which is the honest failure, not a silent one.
- **The pane is not a graph editor.** Transitions, conditions and additive blends stay in
  the JSON. The pane's job is only the part that needs a timeline: turning a rig into a
  playable layer. A typo in the JSON is still a red `/machine` naming the path.

## The machine editor

`/editor?editor` (dev builds only) is the graphical authoring surface for the state machine.
It edits `src/infrastructure/theatre/animationStateMachine/definitions/machine-demo.definition.json`
— the same file `/machine` plays — and it is the only place a definition is written from the UI.

- **Four zones**: header (layers, stage mode, transport, save/discard, undo/redo), left sidebar
  (inputs, listeners, layers with solo/mute), centre (viewport over stage), right inspector
  (one deck per selection: state, transition, layer, input, listener, timeline, markers). The
  timeline strip and the telemetry lane sit under the stage.
- **The graph is deterministic before it is arranged.** `layoutLayer` ranks states by longest
  path from the entries and stacks siblings by id, so a definition loaded from disk is readable
  without anyone having placed it; dragging writes a point into
  `definitions/machine-demo.machine.editor.json` and that point wins. Drag from a card's output
  port onto another card to author a transition, click an edge to edit its condition, duration
  and easing.
- **One selection, one deck.** `encodeSelection` writes the selection into `?sel=`, and a reload
  reopens the same card. Deleting a state removes its edges with it and the button says how many
  (`stateLinkCounts`); renaming a state rewrites every reference (`renameState`), which is a
  refactor, not a field edit.
- **Invalid drafts are refused, not rendered.** `apply` validates every command, `addState`
  inherits a clip reference, and the keyboard is `Space` (play), `Delete` (delete selection),
  `Cmd/Ctrl+S` (save), `Cmd/Ctrl+Z` / `Shift` (undo/redo), `1/2/3` (graph / timeline / split).
- **Save posts both files** to `/__astro-editor/save` in `scripts/studio-save-plugin.ts`
  (atomic rename, `x-astro-editor-save: 1`). The workspace file is git-ignored; the definition
  file is formatter-ignored for the same reason the Theatre states are (it is written by
  `JSON.stringify(…, 2)`).
- **The preview is a machine, not a Theatre sequence**: it steps its own instance, paints the
  rig through `applyMachineOutput`, and a structural edit rebuilds it. A _numeric_ edit while
  playing is held back (the header says "preview is behind") because `createMachine` has no
  hot-swap — pause to apply it.

## Saving your work (dev) vs landing a rig

There are two state files, and they answer to different things.

| File                                  | Written by                                     | Read by            | Meaning                                    |
| ------------------------------------- | ---------------------------------------------- | ------------------ | ------------------------------------------ |
| `states/portfolio-project.state.json` | `pnpm run theatre:state -- import … --to <Id>` | production, always | a **landed** rig: a CLI step, a commit     |
| `states/astro.local.state.json`       | the **Save** button                            | dev only           | the rig **being edited**, today            |
| `states/astro.local.shapes.json`      | the **Save** button                            | dev only           | the spawn list, and the next spawn ordinal |

The two local files are merged over the canonical one **per sheet**, so a locally
saved `StudioSandbox` cannot hide a `StingScene` you landed from the CLI, and the
local copy of a sheet wins over the canonical copy of that sheet.

**Nothing saves itself.** `studio.initialize()` is called with
`usePersistentStorage: false` (see `infrastructure/theatre/studioInit.ts`).
Theatre's own autosave writes to `localStorage` and restores it _after_
`getProject()` has read the files, so left on it wins every argument — a
hand-edit of `astro.local.state.json` is overwritten the moment the page reloads,
and the file looks like it did nothing. With it off, the file is the only
persistence, and Save is the thing that writes it. Rig, press Save.

**The flow**

1. Rig on `/rig/<scene>` or `/studio-corner`. Spawn shapes, aim the camera,
   keyframe in the Studio.
2. Press **Save to disk**. The dev server writes both files
   (`scripts/studio-save-plugin.ts`, endpoints under `/__astro-studio/*`,
   `apply: "serve"` — a build has no endpoint to call). Vite watches those two
   files, so the write invalidates the modules that import them and the page
   reloads on its own. That is the apply step, not a bug: the state coming back is
   the state you just wrote.
3. Reload (the save already did it) to see it on screen. The shapes come back from
   `astro.local.shapes.json`, the keyframes from `astro.local.state.json`, and the
   spawn counter continues, so the next shape is `Cube-4`, not a second `Cube-0`.
4. Hand-edit either file, press **Reload** in the pane, see it on screen. The
   shapes file is the readable one; its `_how` key explains the fields in place.

**Works over the network, not just `localhost`.** The dev server binds every
interface (`server.host: true`) and accepts Tailscale MagicDNS names
(`server.allowedHosts: [".ts.net"]`), so `vp dev` is reachable from a phone on the
tailnet and the Save button works there — the endpoints are relative URLs, so they
follow whatever origin the page was loaded from. The middleware does **not** check
`Host`: on a tailnet "did this come from the server's own machine?" says nothing
about the request. It requires `x-astro-studio-save: 1`, which the app sends on
every call. A cross-origin page cannot attach a custom header to a `fetch` without
a CORS preflight, and this server does not answer preflights, so a drive-by write
from any webpage dies in the browser. That is a drive-by-write guard, not an
access-control list: anyone who can load this app can write these two files.

**Why the shapes are a second file.** Theatre holds the tracks for `Cube-0`; it
does not hold the fact that `Cube-0` should be mounted at all. That is
`useShapeStore`'s, and `<SpawnedShapes />` renders from it. Save one without the
other and a reload gives you keyframes with no mesh, or a mesh with no keyframes.

**Why the ordinal is saved.** `useShapeStore` hands out `<Kind>-<ordinal>` from a
module-scope counter. Restart it at zero and the next spawn reissues a key that is
already in the sheet; Theatre binds both meshes to the same props, the same
outliner row and the same keyframes — they overlap, and animating one animates
both.

**When the rig is good, land it.** Save is scratch. To put a rig in production,
export from the Studio (right-click the project → Export state) and land it with
`pnpm run theatre:state -- import <exported.json> --to <SheetId>`, then press
**Clear files** so the local copy stops shadowing the landed one. The local files
are dev-only: in a production build the state merge returns the canonical file
untouched and the shape seed is empty.

## Reference: what is keyframeable

From `@theatre/r3f`'s editable config:

- `editable.group` / `editable.mesh` — `position.xyz`, `rotation.xyz`, `scale.xyz`
- `editable.perspectiveCamera` — the above + `fov`, `zoom`, `near`, `far`
- `editable.directionalLight` — the above + `intensity`, `color.rgba`
- `editable.pointLight` / `spotLight` — the above + `intensity`, `distance`, `decay`, `color`
- `editable.ambientLight` / `hemisphereLight` — `intensity`, `color` **only** (no transform)

- **The Studio panel lives in a shadow root, not in `#theatrejs-studio-root`'s
  light DOM.** The host div Theatre appends to `document.body` reports
  `children === 0` even when the editor is fully up (the panel is 100+ elements
  under `el.shadowRoot`). "The Studio is broken" measured off the host div is a
  false positive — check `shadowRoot.children.length`.
- **`@theatre/studio`'s default export is double-wrapped under Vite.** The
  package is CJS whose `module.exports` is `{ ToolbarDropdownSelect, default }`,
  and `optimizeDeps` emits `export default require_dist()`. So `mod.default` is
  `module.exports`, and the studio is `mod.default.default` — under plain Node
  `require()` it is `mod.default`. `studioInit.ts` unwraps both shapes; a bare
  `studio.default.initialize()` throws in the browser and works in Node, which is
  the worst possible failure direction.
- **Studio readiness is state, never a render-time poll.** `isStudioAvailable()`
  reads a module variable set by an awaited dynamic import. Called in render it
  is false on the first paint and nothing re-renders when the import lands, so
  the Toggle Studio button stays disabled for the whole session. Both benches
  `await ensureStudio()` and store the result.
- **The camera rig is drei's `PerspectiveCamera` made editable, not
  `editable.perspectiveCamera`.** Theatre's own camera component wraps three's
  class, which has no `makeDefault`; the prop type-checks, is ignored at runtime,
  and the rig animates a camera R3F never renders with. Theatre logs exactly that
  at boot. `editable(PerspectiveCamera, "perspectiveCamera")` + `makeDefault` is
  the fix Theatre itself prescribes.
- **`showStudioUi()`/`hideStudioUi()` return the resulting visibility.** Theatre's
  `IStudioUI` has `hide()`, `restore()` and `isHidden` — there is no `show()`.
  Track the button label from the return value, not from a guess.

- **`studio.extend()` goes before `studio.initialize()`.** A late `extend()`
  does land, one paint of the toolbar later, with the chrome already laid out
  without it. `initTheatreStudio()` registers `astro.scene-tools` between the
  dynamic import of `@theatre/studio` and `initialize()`, inside the same
  `import.meta.env.DEV` guard, so the extension is dev-only for the same reason
  the Studio is: `grep -c "astro.scene-tools" dist/client/assets/index-*.js`
  must be 0.
- **The shape menu is a light-DOM portal, not a Studio component.**
  `IExtension.toolbars.global` hands over a click handler and a data-only
  toolset (`Icon` / `Switch` / `Flyout`) — there is no "render this component
  into the toolbar" entry point, and the Studio's shadow root blocks app CSS
  from anything rendered inside it. `shapeMenuController.tsx` appends a host to
  `document.body` at `z-index: 10001`; the Studio root is `z-index: 100`, so
  the menu sits over the whole editor. Its styles live in `studio.css`, which
  is why the host is not in the shadow root. The pane is the reverse case: the
  Studio hands over a node inside the shadow root, so React is fine there and
  the CSS has to travel with it (`paneStyles.ts`).
- **Aim writes rotation, so a drei `lookAt` on the same camera must step
  aside.** `lookAt` recomputes the camera quaternion every render and snaps the
  aimed rotation back on the next frame. `TheatreCameraRig` drops `lookAt` once
  `useShapeStore.aimCount` is non-zero.
- **Spawned shapes are store state, not Studio state.** They live in
  `useShapeStore`, so they survive a Studio reload and disappear on a page
  reload. They are not in the exported `.state.json`; a rig that must ship with
  them gets them moved into the scene's own data array.

## Traps

- **No `useFrame` for anything the Studio owns.** Theatre writes the group
  transform; a hand-written loop fights it and you get jitter.
- **No sheets in component bodies.** `getSheet()` is cached at module scope.
- **One `editable.group` per node**, mesh + drei `<Html>` as children — split
  them and the label drifts from the geometry.
- **`autoPlay` must be a module constant.** An array literal in a component body
  is a new array every render, and the clip restarts under the playhead.
- **No manual memoization.** React Compiler is on.
- **Don't hand-edit the state JSON** beyond what `theatre:state` does. Its shape
  (`sheetsById` → `tracksByObject` → `trackIdByPropPath`, keyframe `handles`,
  `definitionVersion: "0.4.0"`) is readable, and a wrong `definitionVersion`
  makes `getProject` throw before the app renders.
- **All three state files are formatter-ignored** (`fmt.ignorePatterns` in
  `vite.config.ts`). Both `scripts/studio-save-plugin.ts` and
  `scripts/theatre-state.mjs` serialise with `JSON.stringify(…, 2)`, and the
  formatter collapses every short array — every `handles` array — onto one line, so
  a `vp check --fix` after a Save or an import rewrites the file the tool just
  wrote, and the two of them fight forever. `vp check` reporting the state files as
  "not correctly formatted" is this, not a rig that changed.

## The example

`scenes/StingScene.tsx` + `states/portfolio-project.state.json` is a rigged,
playing four-second sting: five prefabs rise from under the floor with an
overshoot, staggered 0.3s apart; the camera arcs back and tightens 62° → 48°;
the key light swings behind the ring. Copy those two files and change the names.
