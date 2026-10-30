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

## Commands

`vp dev` · `vp check` · `vp test` · `vp build` · `pnpm run cf-typegen` ·
`pnpm run db:generate` then `pnpm run db:migrate:local` · `pnpm run cap:sync` ·
`pnpm run theatre:state -- import <exported.json> --to <SheetId>` (then `list`).

Use `pnpx` rather than `npx` — `npx` fails on this repo's pnpm `devEngines` pin.
