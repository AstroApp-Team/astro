<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

# Astro

Cloudflare Worker serving a Hono API and a React 19 SPA (Ionic) from static
assets. The same client bundle is packaged natively by Capacitor. Server state
is TanStack Query, validation is Zod.

The app is a voice-to-voice conversation with xAI's Grok voice model, over the
AI SDK's experimental realtime API routed through the Vercel AI Gateway. The
browser holds the WebSocket; the Worker only mints short-lived client secrets.
Drizzle + D1 is wired up and migrated but nothing reads it yet — it stays so the
migrations keep working.

Single package: `src/` is the SPA, `worker/` is the API, `shared/` holds code
both sides import (`realtime.ts` constants, `schemas.ts` Zod). Three tsconfig
projects (`app`, `worker`, `node`) share strict settings from
`tsconfig.strict.json`.

`src/` is layered, and imports only point inward (`presentation` → `infrastructure`
→ `core`):

- `core/` — pure TypeScript. Models, ports (`interfaces/`), usecases. Zero imports
  from `react`, `three`, `@react-three/*`, `@capacitor/*`, `@theatre/*`, zustand,
  Ionic, `window`, timers, or `Date.now`. It has no framework and no runtime.
- `infrastructure/` — adapters behind those ports: `api/` (HTTP client, query
  client, credentials, storage + clock adapters, the usage tracker composition
  root), `native/` (Capacitor platform, haptics, status bar), `theatre/` (project
  singleton, dev-only Studio loader, exported animation state).
- `presentation/` — `state/` (zustand stores), `ui/` (Ionic pages, components,
  hooks, styles), `canvas/` (R3F: `MainCanvas`, cameras, elements, scenes, studio).

Aliases `@core/*`, `@infra/*`, `@presentation/*`, `@shared/*` are declared twice:
`compilerOptions.paths` in `tsconfig.app.json` and `resolve.alias` in
`vite.config.ts`. Keep both in sync — tsc and the bundler are not reading each
other.

## Things that will bite you

- **React Compiler is on** (native Oxc, `react({ compiler: true })`). Do not add
  `useMemo`/`useCallback`/`React.memo` for performance — the compiler does it,
  and manual memoization can defeat it. Verified working: the dev transform
  emits `_c` cache slots from `react/compiler-runtime`.
- **Hono routes must stay chained.** Splitting the `.get().post()` chain in
  `worker/index.ts` into separate statements silently degrades RPC types to
  `any` — the client still compiles, it just stops type-checking.
- **Import test helpers from `vite-plus/test`, never `vitest`.** Vite+ re-exports
  its bundled Vitest 4.1.10; `vitest` is pinned in the catalog to that exact
  version because `@cloudflare/vitest-plugin` needs to resolve one copy.
- **`cloudflare()` is disabled under Vitest** (see the `isVitest` guard in
  `vite.config.ts`). Vite+ injects `resolve.external` into every environment and
  the Cloudflare plugin rejects that on Worker environments, so `vp test` cannot
  start with it loaded. The workers test project uses `cloudflareTest()` instead.
- **Vitest needs the aliases declared a second time.** Root `resolve.alias` does
  not reach a Vitest _project_ environment: Vite+ injects `resolve.external` into
  every environment, a non-entry module goes straight to Node's resolver, and Node
  has never heard of `@core/*`. Each entry in `test.projects` carries its own
  `resolve: { alias: aliases }`. A test that imports an alias and fails with
  "Cannot find package" is this, not a broken path.
- **`@theatre/studio` stays inside the `import.meta.env.DEV` guard** in
  `infrastructure/theatre/studioInit.ts`. It is a devDependency reached only by a
  dynamic import inside that guard, so the production transform folds the branch
  away and the ~770 KB editor never ships to the phone. Hoist the import to the
  top of the file and it ships. Verified by grepping the built bundle for
  `studio.initialize` — it is absent in prod, present in dev.
- **`@theatre/r3f@0.7.2` declares a peer of `@react-three/fiber@^8`.** Do not
  "fix" this by downgrading R3F: R3F 8 cannot run on the React 19 this app ships,
  and `@theatre/r3f` only touches `useThree`/`useFrame`, which are unchanged in v9.
  The allowance is a `peerDependencyRules.allowedVersions` entry in
  `pnpm-workspace.yaml`.
- **Theatre.js sheets are created at module scope** (`getSheet()` in
  `infrastructure/theatre/project.ts`). Same identity rule as the realtime hook's
  `model`/`sessionConfig`: a `project.sheet()` call in a component body builds a
  new sheet per render.
- **Mobile canvas settings are not cosmetic.** `dpr={[1, 1.5]}` (a 3x DPR is a 9x
  fragment load and phones thermal-throttle), `antialias: false` (MSAA is the most
  expensive thing a mobile GL context does), `failIfMajorPerformanceCaveat: false`
  (Android WebView often reports a software GL driver, and with the default the
  context is refused — a black rectangle, no error), and `touch-action: none` on
  the container (otherwise a drag in the scene is a page scroll, and an iOS
  left-edge swipe is the native back gesture). All four are in `MainCanvas`.
- **Ionic's global CSS is imported in `main.tsx`, and it is what gives the app a
  height.** `setupIonicReact()` does not load it. Without `structure.css`, `html`
  and `body` have no height; without `core.css`, `.ion-page` — the class `ion-app`
  carries — has no `position: absolute; top:0; bottom:0; display:flex`, so every
  Ionic element computes `display: inline; height: auto`. `ion-content` gets 0px,
  its shadow `.inner-scroll` (`position: absolute; top: calc(var(--offset-top) *
-1)`) measures exactly the header's 56px, and a `height: 100%` canvas host
  inside it collapses to its `min-height`. A WebGL canvas in that strip reads as a
  black screen, not as a layout bug. Check the computed height chain
  (`html → body → ion-app → ion-content → .inner-scroll`) before blaming the
  canvas.
- **The Studio Corner route ships in production; the Studio panel does not.**
  `/studio-corner` is registered unconditionally — a route that only exists in dev
  is a route nobody has seen fail. `initTheatreStudio()` gates on
  `import.meta.env.DEV && !Capacitor.isNativePlatform()`, so on a phone the route
  renders the sandbox and the toolbar, with the Studio button disabled.
- **Ionic 9 uses React Router v6** — `element=` and `<Navigate>`, not `component=`
  or `<Redirect>`. Parent routes with nested children need a `/*` suffix.
- **D1 has no BOOLEAN or DATETIME.** Use `integer({ mode: "boolean" })` and
  `integer({ mode: "timestamp" })`. Foreign keys are always enforced, and a
  query is capped at 100 bound parameters.
- **Never hand-edit `worker-configuration.d.ts`.** Run `pnpm run cf-typegen`
  after any binding change. The interface is `CloudflareBindings`, named
  explicitly so it does not collide with Hono's own `Env`.
- **The microphone needs two Android permissions, not one.**
  `BridgeWebChromeClient.onPermissionRequest` asks for `MODIFY_AUDIO_SETTINGS`
  _and_ `RECORD_AUDIO` together for an `AUDIO_CAPTURE` request, then grants the
  WebView only if every permission in that batch came back granted.
  `MODIFY_AUDIO_SETTINGS` is a normal permission — granted at install, but only
  if declared. Leave it out and the user taps Allow on the mic prompt and
  `getUserMedia` is refused anyway. Both are declared in
  `android/app/src/main/AndroidManifest.xml`, which is why `android/` is
  committed rather than regenerated. iOS will want
  `NSMicrophoneUsageDescription` in `Info.plist` for the same reason.
- **`cap sync` ships whatever last wrote `dist/client`.** `vp build` bakes a
  relative API base and `vp build --mode capacitor` bakes the deployed Worker
  URL, into the same directory `webDir` points at. Always go through
  `pnpm run cap:sync`; a bare `cap sync` after a web build produces an app that
  resolves `/api/*` against `https://localhost`, which the local asset server
  answers with `index.html` — it reads as a backend outage, not a build slip.
- **SPA deep links need `run_worker_first`, not just `not_found_handling`.** Assets + a Worker with _no_ static routing makes the asset worker set `not_found_handling: "none"` for every request, so an unmatched path goes to Hono and Hono answers 404; the SPA fallback only fires on a `Sec-Fetch-Mode: navigate` request. That is why `/rig/sting` 404s from the address bar while `/voice` looks fine — `/` is a real asset and React Router pushes `/voice` with no network request at all. `run_worker_first: ["/api/*"]` in `wrangler.jsonc` flips `has_static_routing` true, which applies the fallback to every non-asset path with no header required, and keeps the Worker first on the routes it owns. Check with a plain `curl -i /rig/sting` → 200.
- **`.dev.vars` is gitignored, so a fresh checkout has no `APP_PASSWORD`.** `passwordMatches` reads `undefined.length` and throws, and a 500 with nothing naming the cause reads exactly like a backend outage. `appPassword()` in `worker/index.ts` resolves the binding to a non-empty string first, and all three guarded routes answer 500 naming `APP_PASSWORD`, mirroring the existing Gateway-key check. Run `vp dev` with a `.dev.vars` before concluding the API is broken.
- **A transparent overlay canvas needs `eventSource` and `eventPrefix="client"` together, and the overlay must be `position: fixed; inset: 0`.** `/float` is a React page with a Theatre.js canvas over it. `eventSource` (the page root) makes R3F set `pointer-events: none` on the canvas and move its listeners to that element — it must be an **ancestor of everything under the pointer**, because that is where events arrive by bubbling. `eventPrefix="client"` is the half that is easy to drop: R3F's default compute reads `offsetX/offsetY`, relative to the event's **target**, and with an event source the target is the card the user meant to click, so the raycast lands hundreds of pixels from the finger. `client` divides `clientX/clientY` by the canvas's size with **no origin subtraction**, which is only correct when the canvas's box starts at the viewport origin. Give `.float__overlay` a non-zero `top` and the raycast goes silent: taps append nothing to the log and no error is logged. Accepted consequence, do not "fix": the canvas is not a hit target, so a tap on the sphere also reaches the DOM element under it — making the canvas a hit target eats the page's clicks, which is the worse bug. The inverse direction needs a gate, and it gates on **controls**: the same wiring makes every pointerdown in the page run the mesh handlers, so a tap on a card, a log row or a bar button that happens to sit over a mesh is a press the user did not make. It cannot be a gap-only test — these meshes cross the whole page. `isMeshPressTarget` in `FloatScene.tsx` / `SurfaceScene.tsx` rejects a press whose event target is inside a button, a link, a form control, the bar or the table, and accepts everything else.
- **On `/float` the page owns playback, and "move the sphere" is seek the playhead.** `FloatScene` calls no `useSheetPlayback` autoplay on purpose: a scene that started the clip would be a second owner of the same playhead, racing the page's seeks. `FloatPage` seeks `FLOAT_AUTOPLAY[0]` and loops `FLOAT_AUTOPLAY` (module constant, it is an effect dependency) and pauses on cleanup. Never write `position.x` from a page — the rig owns that prop, the clip wins silently, nothing warns you. Effects that move the sequence take the exported module-scope helpers (`seekSequence`, `loopSequence`, `pauseSequence`, `sequenceLength` in `infrastructure/theatre/useSheetPlayback.ts`) and a `sequence` in the dependency array, **not** the adapter object: `playback` is a fresh object of closures every render, so it cannot be a dependency — leave it out and `react-hooks/exhaustive-deps` fires, and suppressing that costs the whole page its React Compiler pass; put it in and the effect re-runs every render, which on a page subscribed to the playhead means one tap logging ten rows.
- **`/astro` is `/float` with a character instead of a sphere, and the two props that differ are the point.** `presentation/ui/pages/AstroPage.tsx` + `scenes/AstroScene.tsx` reuse the whole overlay wiring (`eventSource`, `eventPrefix="client"`, `position: fixed; inset: 0`, the press gate on controls, `lastEvent` as the mesh → page signal, `selectionVisuals: false` on mount) because those are the silently-wrong parts. What is new: the character is a **plane wearing a canvas texture**, not a shaded mesh — `infrastructure/astro/astroTexture.ts` draws each of the 12 stylesheet states (halo, rim bloom, body gradient, features, glyph) and caches a `CanvasTexture` per state, so `ASTRO_PLANE_SIZE` is exactly the halo (`2 D = 1.8 R`) and there is **no light rig** on the scene (the stylesheet's lighting is the halo + baked rim bloom; a `meshStandardMaterial` would add a second, contradictory one). And the two props have two different owners, on purpose: the rig owns `position` (`scripts/astro-rig-export.mjs` lands `Astro.position.{x,y,z}` on `AstroScene`, 8 s, and **no `rotation` track** — the plane is flat, a keyframed turn shows the page its edge and the drawing vanishes), while the face is `useAstroStore.expression`, a texture swap. Keyframe an expression track and the page's picker stops working silently. Reactions end via `isTransient` + one `setTimeout` on `ASTRO_REACTION_MS.max` → `settle()` back to `resting`; `resting` is separate because `isTransient("happy")` is true and a reaction that returns to itself never ends. The pointer only moves a resting character (`POINTER_FOLLOW_STATES` = `idle` + the three `look-*`), because `lookTowards` snaps to the sheet's seven eye placements rather than interpolating, and a mouse overwriting `doze` would make sleep unreachable.
- **`/astro-v2` is the same overlay as `/astro`, with the character rebuilt as glowing geometry and with no lights at all.** `scenes/AstroV2Scene.tsx` mounts `canvas/astroV2/AstroV2Character.tsx`: a sphere body, two sunken eye prisms and a halo shell, each a `ShaderMaterial` from `canvas/astroV2/materials.ts`. v1 stays on `/astro` untouched (`AstroScene.tsx` + `infrastructure/astro/astroTexture.ts`, the plane wearing a rasterized drawing).
  - **Body** — unlit, colour from a _diagonal gradient sampled in object space_ (`position`, not `uv`, so a sphere's UV seam cannot show), plus two travelling waves keyed on `uTime`. Look-dev uniforms: `uWaveFreq` (spatial granularity), `uWaveSpeed`, `uWaveAmp`, `uColorPeriod`, `uColorAmount`, `uBrightness`, `uGradientScale`, all written by `applyTunables(tunables)` from `useAstroStore.tunables`. The slow colour change is a **slide along the sheet's ramp**, not a hue rotation: `t` is clamped to `0..1` and the ends are `#FF8B00`/`#FE3402`, so no setting can produce a colour the stylesheet does not print. A Rodrigues hue rotation (the first version) walks `#FF8B00` to yellow and `#FE3402` to pink within a few degrees, and clamping the _output_ cannot recover a colour the ramp no longer contains.
  - **Eyes** — `eyeGeometry.ts` builds one elliptical prism (`CylinderGeometry` rotated onto z, `radial` scale for the oval) and bakes two _plain vec3 attributes_ `aHappy`/`aSleepy` instead of `geometry.morphAttributes`, with `uHappy`/`uSleepy` weight uniforms — a `ShaderMaterial` only sees three's built-in morphs if its GLSL includes the `morphtarget_*` chunks, and that makes the page's animation depend on chunk names. Drawn `side: BackSide` (what a sunken eye shows is the _inside_ of its well, and the front plate is the body's hole), `depthTest: false` + `depthWrite: false` so the eyes shine through the body, `renderOrder={2}` so they are the character's top layer. The interior is **two flat colours with a hard edge, and the split is geometric, not angular**: the wall (`uInner` = `ASTRO_V2_PALETTE.eyeWell`, the sheet's `#FA6B2F` lifted 22 % toward the cream) and the far plate (`uCore`, `#FEFBF5`) are chosen by `step(0.5, abs(normal.z))` on the **object-space** normal — the prism is a `CylinderGeometry` rotated onto z, so the cap's normal is exactly `±z` and the barrel's is exactly `0`, and nothing interpolates between the two. This replaced `abs(dot(normal, viewDir))`, which is a _view_ quantity: across the barrel it varies with the angle, so the wall shaded light-to-dark like the side of a cylinder and broke the "hole in the body" reading. `ASTRO_V2_EYE.depth` (0.039, halved) is the parallax knob; the sheet's 2 : 1 oval height is deliberately _not_ shortened — it is what makes the pair read as eyes rather than dots.
  - **Halo** — a second sphere at `ASTRO_V2_HALO_RADIUS` (`ASTRO_V2_BODY_RADIUS * 1.9`), `renderOrder={1}`, `AdditiveBlending`, `depthTest: false`. Opacity **decays outward** — `pow(1 - smoothstep(uEdgeStart, uEdgeEnd, shallow), uPower)`, full strength where the glow meets the body and nothing at the shell's rim — times a feather `uInnerFade` wide around the body's own silhouette, computed in the shader from `uBodyRatio` so it tracks `haloSize`. Inverted (full at the rim) the halo reads as a bright ring floating off the disc with a dark gap against it. Uniforms: `uSize`, `uOpacity`, `uColorInner`, `uColorOuter`, `uDrift`, `uEdgeStart`/`uEdgeEnd`/`uPower`/`uInnerFade`/`uBodyRatio`. Both colour stops are printed sheet colours and `uDrift` only slides between them. The alpha has to do the hiding: the shell is in front of the body, so depth cannot cut it, and `shallow` (facing away from the camera) is exactly "the band where the surface turns away".
  - **Ownership** — the rig owns the group's `position` only; the face is `useAstroStore.expression` and the look is `useAstroStore.tunables`. A keyframed face or `waveAmp` would win over the page silently.
  - **Two constraints that bite** — a `ShaderMaterial`'s `uniforms` object is created once at module scope (`bodyUniforms`, `eyeUniforms`, `haloUniforms`); build it in a component body and every per-frame write goes to a dead map, the shader recompiles, and every slider reads as dead. And the morph attributes must be on the geometry before the material's shader references them.
- **`/surface` renders React pages as mesh textures, and the three rules that make it work are all silent when broken.** `presentation/ui/pages/SurfacePage.tsx` rasterizes two live DOM subtrees into canvas textures mapped on a plane and a sphere. (1) The hosts are **parked, not hidden** — `.surface-hosts` is `position: fixed; left: -10000px`. `display: none` and `opacity: 0` both look right and both are wrong: a subtree the browser does not lay out has no boxes, so `getBoundingClientRect` returns 0×0, every published button rect is empty, and every raycast through a texture misses with no error. (2) A surface page renders **only press-derived state** — the host is watched by a `MutationObserver`, and one mutation is a style walk, an SVG encode, an image decode and a ~1 MB texture upload, so a clock or playhead inside a texture page is a raster per frame. The playhead is read out on the page, never inside `SquareSurface`/`SphereSurface`. (3) UV → page pixel **flips `v`**: three uploads a canvas with `flipY`, so UV `v = 1` is the top row (`uvToSurfacePoint` in `core/usecases/surfaceInteraction.ts`). Skip the flip and hits are mirrored, which reads as "the buttons are a bit off". The raster itself is clone → inline styles → SVG `foreignObject` → `Image` → canvas (`infrastructure/surface/rasterizeSurface.ts`, no new deps), so `backdrop-filter` renders as nothing, external images never load, and the CSS sizes in `styles/surface.css` _are_ the texture dimensions. **Scrolling a page inside a texture is a store offset the page translates itself** (`useSurfaceStore.scroll` → `SurfaceLoop` → `MutationObserver` → raster), never a rotation of the mesh: spinning a plane moves the whole page including the button being aimed at, and rotating the sphere only slides its seam because the UV wraps the texture around the mesh. The loop is a duplicated tile of the **whole page** translated by `-offset` and wrapped at `LOOP_TILE_HEIGHT`, with the tile and row heights set inline from the same constants the wrap uses — a stylesheet that drifts from a constant is a seam. The page is the tile, not a list inside it: heading, button and rows all travel, so the button scrolls off the sphere and comes back. A fixed header with a looping list inside it loops a list and parks the button. Two consequences: `LOOP_TILE_HEIGHT` includes `LOOP_HEADER_HEIGHT` and must stay divisible by `MAX_WHEEL_DELTA` (150 made the tile 750, 750/120 is 6.25, and the full-tile walk test stopped landing on the start), and **both copies of the loop publish rects** — the duplicate is marked `SURFACE_GHOST_ATTR` as a label of what it is, and the measurer must not filter on it (nor on `aria-hidden`, which the parked hosts themselves carry): as the offset grows the first tile's copy walks out of the window's top and the copy the user sees _is_ the duplicate, so a measurer that skips it publishes no rect for the button on screen, and a drawn button becomes unhittable, which reads as "works in the top half of the sphere, dies below the middle". Two copies are never in the window at once (`LOOP_TILE_HEIGHT` 840 vs `LOOP_STRIP_HEIGHT` 300, guarded by a test), so there is no phantom rect to skip. The window is marked `SURFACE_WINDOW_ATTR` and rects are clipped to it with `clipRectToWindow` (`MIN_VISIBLE_SIZE`), because `getBoundingClientRect` reports the full box of a translated element whether it is drawn or not — a button scrolled out of the texture keeps a rect that reaches into the window and fires on a tap meant for a row that is on screen. The gate is `wheelTarget` (the mesh under the pointer, written by the mesh's own pointer handlers), and the page's wheel listener must be registered natively with `{ passive: false }`: React registers wheel delegates as passive, `preventDefault` is a no-op there, and R3F's own wheel listener is passive too (`DOM_EVENTS.onWheel = ['wheel', true]`), so a texture scroll that does not cancel the page's scroll scrolls both. Touch needs its **own region**: `touch-action` is read at `touchstart`, so a class React applies after a mesh hover handler is a frame too late — the browser has already committed to panning `.surface__scroll` and answers with `pointercancel`, and the drag on the texture page never happens, silently. `SurfaceTouchShield.tsx` is a `position: fixed; touch-action: none` div at `z-index: 2` whose box the scene publishes per frame from `Vector3.project` through `infrastructure/surface/surfaceFootprints.ts` (notifications below `FOOTPRINT_EPSILON` are dropped — the sphere bobs every frame, and a DOM write per frame for a third of a pixel is the bug). The overlay cannot carry the flag: it is `pointer-events: none`, so it never participates in a gesture.
- **`SPIN_RANGE` is authored into the rig, not just read by the page.** The `/surface` spin is `Surface Plane.rotation.y` keyframed 0 → 2π across exactly `[0, 3]` on `SurfaceScene`. Change the range without re-landing the rig and the sphere page's button seeks to a playhead the clip does not cover — the plane turns partway, and nothing says why. The colour sphere's colour is app state with **no** colour track on the sheet: a rig track and a store write on one prop means the clip wins and the button appears to do nothing.
- **R3F's `ThreeEvent.target` is not a DOM node, and a press gate written against it is
  dead.** Every mesh event carries `target: { hasPointerCapture, setPointerCapture,
releasePointerCapture }` (R3F 9.8.2, `dist/events-*.esm.js`), typed as `EventTarget`, so
  `event.target instanceof HTMLElement` is always false and compiles clean. The element the
  pointer landed on is `event.nativeEvent.target`. `isMeshPressTarget` in `FloatScene.tsx`
  and `SurfaceScene.tsx` reads `nativeEvent.target`; against `event.target` it rejects every
  mesh press with no error — textures render, the page's own buttons work, the mesh is deaf.
- **All three Theatre state files are formatter-ignored** (`fmt.ignorePatterns` in `vite.config.ts`): `states/portfolio-project.state.json` (written by `scripts/theatre-state.mjs`) and the two `states/astro.local.*` files (written by the Studio's Save button, `scripts/studio-save-plugin.ts`). Both writers use `JSON.stringify(…, 2)`, and the formatter collapses every short array — every keyframe `handles` array — onto one line, so a `vp check --fix` after an import or a Save rewrites the file the tool just wrote and the two fight forever. `vp check` calling a state file "not correctly formatted" is this, not a rig that changed.

### Realtime voice

- **The server's model id is the one that counts.** `getToken()` bakes it into
  the WebSocket URL it returns (`?ai-model-id=...`). The id passed to
  `gateway.experimental_realtime()` in the browser only names the session — if
  the two ever drift, the server silently wins.
- **`model` and `sessionConfig` must be module constants.** `experimental_useRealtime`
  compares them by identity; an object literal in the component body rebuilds
  the session store on every render, which reads as a reconnect loop.
- **Start audio capture on `status === "connected"`, not after `connect()`.**
  `connect()` resolves when the token fetch does; events sent before the socket
  opens are dropped on the floor.
- **The hook owns the setup fetch**, so no custom headers are possible — that is
  why the shared password rides in the query string on `/api/realtime/setup`.
- **Realtime bills by wall-clock session time, not by speech.** The Gateway's
  `/v1/models` entry publishes `realtime_session_duration_cost_per_second`, so
  an idle open socket costs the same as a conversation. The footer meter is a
  clock for that reason, and `VoiceSession` hangs up on its own when the tab is
  hidden or two minutes pass with no speech — that is the billing guard, not a
  bug to "fix".
- **The AI Gateway needs a card on file** before it services any request, and
  `getSpendReport()` (the real invoice) is a paid-plan feature — which is why
  the cost is metered client-side against the published rate.
- **Set both audio formats explicitly.** Leave them out and the provider picks
  its own while the browser captures/plays at `sampleRate` — a mismatch is
  garbled audio, not an error.
- **The coding agent edits a draft; `publish_view` takes no HTML.** The loop in
  `worker/view-agent.ts` holds the document in a mutable `draft` the tools
  mutate (`write_view`/`edit_view`), and publishing publishes the draft. The
  client's `view.html` is the source of truth _between_ requests — it comes
  back as `currentHtml`, already sealed, which is why `sealViewHtml` must stay
  idempotent.
- **`astro:state` is what keeps a game alive across an edit.** The page posts
  its state to the parent whenever it changes; the parent keeps only the latest
  and posts it back into the new frame on `load`. The parent never inspects the
  state, so rejecting a stale or foreign state is the page's own job.

### 3D scenes and the Studio Corner

Full rigging workflow, including the export/land step, is in `extra_docs/THEATRE.md`.

- **The rig bench's tools live in an app-level dock, not in the Studio's chrome.** Every
  authoring tool used to be reachable only through the Theatre.js panel — a floating overlay
  you have to toggle, dev-and-desktop only, whose chrome is a shadow root no app stylesheet
  can reach — so `/studio-corner` and `/rig/:sceneId` showed a canvas and a play button.
  `presentation/canvas/studio/tools/ToolsDock.tsx` fixes that: a rail of panels (Scene tools,
  Machine, Character) that mounts **the same pane components** the Studio extension registers,
  into windows the app owns. Two details are load-bearing and both are silent when wrong:
  the dock is **portalled to `document.body`** because `IonContent` is its own stacking
  context while `#theatrejs-studio-root` is a body-level fixed overlay at `z-index: 100` — a
  `position: fixed` dock rendered inside the page is visible and unclickable, with the empty
  Studio root swallowing every press; and each window body needs an **opaque background**
  because the panes are transparent by design (they were built to sit inside the Studio's
  dark chrome). The rail sits at `z-index: 110`, above the Studio on purpose.

- **`/studio-corner` is the rigging sandbox.** `StudioSandboxScene` mounts three
  `EditableNodePrefab`s against its own sheet (`StudioSandbox`), so a clip rigged
  there cannot touch a production scene's timeline. Rig a scene by copying it into
  the sandbox, animating it, and moving it back with only the sheet id changed.
- **Animation state crosses into production as an export, not as the Studio.**
  Studio → right-click the project → Export state → drop the JSON in
  `src/infrastructure/theatre/states/`, register it in `states/index.ts`
  (`resolveJsonModule` is on in `tsconfig.app.json`). `getProject` only accepts
  state at construction, which is why the map is read at module scope in
  `theatre/project.ts`.
- **A prefab is one `editable.group` with a mesh and a drei `<Html>` inside it.**
  Theatre animates the group's transform and `Html` re-projects the child's world
  position each frame, so geometry and label move together. Splitting them into
  two components is how they start drifting.
- **`theatreKey` is also the node id in `useSceneStore`.** One string for the
  outliner entry, the raycast target and the toolbar readout, so the three cannot
  disagree.
- **The store is the only 2D ↔ 3D channel.** An HTML button never reaches into a
  mesh and a mesh never renders into a toolbar; both sides read and write
  `useSceneStore`. Subscribe with a selector — a bare `useSceneStore()` re-renders
  on every field, including the camera target the canvas writes 60 times a second.
- **Exported state is keyed by sheet id, and a missing key is silent.** Core looks
  up `sheetsById["StingScene"]`, finds nothing, and plays the scene at its initial
  values with no error. Rig on `/rig/:sceneId` (it mounts the production sheet),
  then `pnpm run theatre:state -- import <exported.json> --to <SheetId>` renames
  and merges into the one canonical file `states/index.ts` imports. Rigging in
  `/studio-corner` means that rename is on you.
- **A prop is owned by JSX or by the rig, never both.** `position` in the JSX is
  Theatre's _initial value_; a keyframed prop overrides it. Keyframe `position.x`
  in the Studio and also move the node in the data array, and the data edit stops
  mattering with nothing to tell you.
- **`useSheetPlayback` is the only place a scene starts a clip.** `SheetProvider`
  in `@theatre/r3f@0.7.2` takes only `sheet` — no `autoPlay`. Its `autoPlay`
  argument is an effect dependency, so it must be a module constant; an array
  literal restarts the clip every render. Its writes live in module-scope helpers
  because the React Compiler skips a hook that mutates its argument.
- **`SHEET_IDS` has a partner table.** `SCENE_SHEET_IDS` in `project.ts` is a
  `Record<SceneId, SheetId>`, so adding a scene to `SCENE_IDS` without a sheet is
  a compile error rather than a scene that mounts a sheet nobody rigs.

- **`studio.extend()` runs before `studio.initialize()`, and it is the one
  outward-pointing import in `infrastructure/`.** `studioInit.ts` dynamically
  imports `presentation/canvas/studio/shapeTools/extension.ts` inside the same
  `import.meta.env.DEV` guard as `@theatre/studio` — a late `extend()` lands one
  toolbar paint late, and a hoisted import ships the Studio UI to the phone.
  Verify with `grep -c "astro.scene-tools" dist/client/assets/index-*.js` → 0.
- **`<SpawnedShapes />` mounts inside every scene's `<SheetProvider>`, not just the sandbox.** Spawned shapes live in `useShapeStore` and render as Theatre-editable meshes under the sheet they are mounted in. Mount it only in `/studio-corner` and Add Shape writes to a store that no production scene renders — the shape exists, and shows up neither on screen nor in the outliner.
- **The Studio's toolbar is data, not React.** `toolbars.global` is a
  subscription that pushes `Icon`/`Switch`/`Flyout` configs through `set()`; a
  label like `Shapes (n)` freezes unless a store subscription re-`set`s it. That
  is why the Add Shape menu is a light-DOM portal at `z-index: 10001` (the
  Studio root is 100, its own flyouts are scoped inside it) and why the pane's
  CSS is injected with the pane — app CSS cannot cross the shadow root.
- **The Studio's Save button is the persistence, so Theatre's autosave is off.**
  `studio.initialize({ usePersistentStorage: false })` in `studioInit.ts`. Theatre's
  default autosave writes `localStorage` and restores it _after_ `getProject()` has
  read the state file, so it silently overwrites a hand-edit of
  `states/astro.local.state.json` on every reload. Save writes that file plus
  `states/astro.local.shapes.json` through a dev-only middleware
  (`scripts/studio-save-plugin.ts`, `/__astro-studio/*`, `apply: "serve"` — a build
  has no endpoint). Nothing saves itself: rig, press Save. The local sheets are
  merged over the canonical file **per sheet**, so a saved `StudioSandbox` cannot
  hide a `StingScene` landed from the CLI. The middleware never checks `Host` — the
  dev server is meant to be reachable over the LAN and Tailscale — it requires the
  `x-astro-studio-save: 1` header, which a cross-origin page cannot send without a
  preflight. Full workflow is in `extra_docs/THEATRE.md`.
- **Spawned shapes are app state, not Theatre state.** Theatre holds the tracks for
  `Cube-0`; it does not hold that `Cube-0` should be mounted at all — that is
  `useShapeStore`, which `<SpawnedShapes />` renders from. So Save writes two files,
  and the shapes file carries the spawn ordinal: restart the counter at zero and
  the next spawn reissues a live `theatreKey`, and Theatre binds both meshes to one
  set of props, one outliner row, one set of keyframes.
- **`/showcase` scrolls React over the canvas, and the scroller must not own the
  pointer.** The story layer is `pointer-events: none` with `auto` on its cards; that
  split is what lets a tap in a gap fall through to the canvas and be raycast. Give the
  scroller `pointer-events: auto` and the 3D half of the page silently becomes
  decoration. The same page overrides `MainCanvas`'s inline `touch-action: none` with
  `pan-y` (a drag there is a scroll), hides the Studio panel for the whole route via
  `ensureStudio()` → `hideStudioUi()`, and seeks the playhead to `0` before every
  replay — `sequence.play({range})` starts from the current playhead when it is inside
  the range, so replaying a finished clip without seeking plays nothing. The selection
  highlight is a store flag too — `useSceneStore.selectionVisuals` gates the mesh colour
  and the node card, off on `/showcase` and on on both benches, and every page states its
  value **on mount**: `IonRouterOutlet` keeps the page you navigate away from mounted, so
  an outgoing cleanup is not a guarantee. The four satellite cubes each open their own
  panel — `showcasePanels/registry.ts` maps `theatreKey` → component, and the panel's title
  is that node's `label` in `STING_NODES`, the word its `<Html>` card paints, so the card
  you tap and the sheet that opens say the same word. `registry.test.ts` is the only thing
  that checks the two lists still agree. Full notes in `extra_docs/THEATRE.md`.

### Animation state machine

- **`/machine` is the bench, and the definition is data.** `createMachine(definition)`
  reads a JSON file (`src/infrastructure/theatre/animationStateMachine/definitions/`)
  and owns the rig's bones outright; the page writes _inputs_ only — `fire`,
  `setNumber`, `setBoolean` — and no clip id, bone name or morph index appears in it.
  `loadShippedDefinition` validates on load and **throws** naming the path, so a typo in
  the JSON is a red page, not a silent no-op. The interruption enum is
  `"ignore" | "interrupt" | "interruptKeepPlaying" | "queue"` — `"immediate"` is the
  name a human reaches for and the validator rejects it.
- **The frame loop order is the contract**: `machine.step(dt)` → `applyMachineOutput`
  → publish a snapshot. `step` returns a **sparse** output (`toMachineOutput` filters
  per-channel), so the adapter's counters are per-frame writes, not a running total —
  a panel that calls the number "writes" and accumulates it reads as a stalled rig.
  Register the scene's bones in `useLayoutEffect`, not a ref callback: R3F's loop runs
  before the first ref pass in the other order and one frame throws "the scene does not
  provide bone root".
- **A morph target is named by its `BufferAttribute`, not by the dictionary.**
  `mesh.morphTargetDictionary = { blink: 0 }` is wiped by the next
  `updateMorphTargets()`, which rebuilds the dictionary from
  `geometry.morphAttributes[*].name` — so the attribute's `name` is the contract with
  the clip's morph track, and a target registered only in the dictionary fails at
  runtime with `mesh "head" has no morph target "blink"`.
- **The store throttles to what a human can see.** `setSnapshot` rejects a frame whose
  active states and 1 %-rounded progress are unchanged, so anything read from that store
  (a frame counter included) must be published on a tick — the raw `frames % 60` rule
  made a healthy loop read as a dead one between ticks.
- **A Theatre timeline becomes a machine layer through the Studio pane, not by hand.**
  `presentation/canvas/studio/machineTools/extension.ts` registers a `Machine (n)` flyout
  and a `Machine · timelines as layers` pane (dev guard, same as the scene tools). Each row
  is one `"<SheetId>/<ObjectKey>"` clip read out of the _exported_ project state, and
  **Add as layer** writes `withClipLayer(definition, { clipId })` into
  `localStorage["astro.machine.definition"]`; `/machine` reads that override instead of the
  shipped JSON, so the loop is rig → Save → reload → Add as layer → reload. The pane is not
  a node graph: transitions stay in the JSON, where a typo is a load error with a path.
- **`combinedResolver` must treat a falsy answer as "not mine".** A static resolver returns
  `undefined` for an id it does not know rather than throwing, so the first version
  forwarded that `undefined` and every Theatre clip behind a static primary failed
  validation with "the resolver cannot produce <id>" — pointing at a clip that was right
  there. Both a throw and a falsy result fall through to the next resolver now
  (`resolvers.test.ts` pins it). For the same reason `theatreAssetResolver` reads
  `projectStates[PROJECT_ID]` **per call**: a resolver built at a page's module scope can
  run before that map is populated, and the failure names the clip, not the timing.
- **`withoutLayer` throws rather than emptying `layers`.** The loader requires at least one
  layer, so a "remove" that produced `layers: []` would write an override `/machine` then
  silently refuses. The pane hides Remove on the last layer; the core throws so any other
  caller cannot make the same mistake.
- **`createMachine`'s second argument is `options`, not the resolver.**
  `createMachine(def, resolver)` type-checks — the resolver is structurally one property of
  an object whose others are optional — and then samples `EMPTY_RESOLVER`, so every bone is
  missing and the machine plays nothing. A test that "has no bones" is usually this. Pass
  `{ resolver }`.
- **A smoothed number input must lag its target; a clamp used to make it teleport.**
  `smoothToward` in `inputStore.ts` clamped the change to `smoothTime * velocity`, which is
  0 at rest, so the first frame after `setNumber` jumped to the target and `smoothed` was
  never observably different from `value`. The closed form is non-overshooting on its own;
  do not reintroduce a clamp without a `maxSpeed` to clamp to. `getSmoothedNumber` (what
  conditions read) vs `getNumber` (the raw target) is the readout that catches it.
- **`MachineOutput.rootMotion` is a delta, and it must not hold a reference.** The sampler
  hands back the same position array every frame, so keeping `previousRootPosition` by
  reference makes every delta zero — copy the three numbers. The first frame after the root
  bone appears publishes zero on purpose: a delta against "no previous position" would
  teleport the model to wherever the clip starts. A cut that moves the root between two clips
  _is_ a delta, so keep both clips' roots parked in the same place when measuring travel.
- **`transitionComplete` is not `stateEnter`.** `stateEnter` fires when a cut _starts_;
  `transitionComplete` fires when the fade reaches its end, and also on a `duration: 0` cut
  (which builds no transition record, so nothing would ever complete it). A queued cut that
  replaces an unfinished fade does not complete the fade it interrupted.

- **`/editor?editor` is the authoring workspace, and it is the only writer of a definition.**
  The route is registered unconditionally; the gate is `import.meta.env.DEV && ?editor` inside
  `MachineEditorPage.tsx`, because a production build has no write endpoint and the page must
  refuse rather than load a workspace whose Save silently does nothing. The workspace file is
  `<id>.machine.editor.json` (node positions, splits, solo/mute — git-ignored, `fmt` ignored),
  the document is `definitions/<id>.definition.json`, and Save POSTs both through
  `scripts/studio-save-plugin.ts`'s `/__astro-editor/save` (atomic rename, same header guard as
  the Studio's). **Every command is a validator**: `useEditorStore.apply` runs
  `validateDefinition` and refuses the write, because the preview builds a machine from the
  draft and an invalid draft takes the whole shell down — the crash reads as "the editor
  vanished", with the loader's message only in the console. `addState` therefore inherits a
  clip reference from the layer; `{ type: "clip" }` with no `clip` is a load error.
- **The selection is in the URL and the layout is in a file, and neither is the source of
  truth for the other.** `encodeSelection`/`decodeSelection` are the one format (the graph's
  node keys, the editor file's keys and the URL all agree); the URL is written on every change
  and read once at mount, so a reload reopens the same card without a back-button gesture
  changing what is selected. A node's position comes from `EditorFile.layout.nodes[key]` if it
  exists and from `layoutLayer`'s deterministic rank/row otherwise — which is why deleting a
  state cannot leave a card behind (cards render from the definition) and why a fresh
  definition is readable before anyone arranges it.
- **The preview rebuilds on a new _shape_, not on every keystroke.** `structuralHash` (numbers
  dropped, keys sorted) is the trigger: a structural edit while playing adopts immediately and
  raises the rebuild banner; a numeric edit waits for the pause and the header says the preview
  is behind. `createMachine` has no hot-swap, so "apply a numeric edit live" is not a thing the
  runtime can do — pretending it does is how a test run gets yanked out from under a finger.

## Astro's visual language

- **`assets/astro-stylesheet.svg` is the source of truth, and `extra_docs/style/` is its
  textual transcription.** That directory is ten short files — colour, typography, the
  form of the sphere, the 12 expression states, motion, components, the 20 icons,
  layout/themes, and a do/don't checklist — written so a model with no image input can
  build on-brand work from numbers alone. Read `extra_docs/style/README.md` before
  inventing a colour, a radius, a state or an icon: every value there was measured from
  the SVG (coordinates, gradient stops, filter `stdDeviation`), and the guide is the bug
  if it disagrees with the file. `extra_docs/style/refs/` holds renders of the sheet for
  humans and multimodal models; nothing in the markdown depends on them.
- **The character has no mouth, limbs, blush or colour variants, and its body is never
  squashed.** 12 states differ only in where the eye _pair_ sits, which feature shape is
  used (ellipse / crescent / dash), whether a `#995F48 @ 0.43` shadow copy is offset
  in the direction of travel, and which single glyph (`!`, `?`, `z`) hangs outside the
  rim. A new emotion is a composition of those four, not a new drawing.
- **The sheet has no motion** — `05-motion.md` is derived, and it is where the `/float`
  rig facts live (orbit in XZ + bob in Y, `rotation.y 0→2π`, 6 s loop, page owns the
  playhead).

## Commands

`vp dev` · `vp check` · `vp test` · `vp build` · `pnpm run cf-typegen` ·
`pnpm run db:generate` then `pnpm run db:migrate:local` · `pnpm run cap:sync` ·
`pnpm run theatre:state -- import <exported.json> --to <SheetId>` (then `list`).

Use `pnpx` rather than `npx` — `npx` fails on this repo's pnpm `devEngines` pin.
