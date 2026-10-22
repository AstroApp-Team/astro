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
- **SPA deep links only fall back with a real navigation request.** `curl /voice`
  returns 404; a browser (or `-H "Sec-Fetch-Mode: navigate"`) gets index.html.
  That is expected, not a routing bug.

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

Full rigging workflow, including the export/land step, is in `THEATRE.md`.

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

## Commands

`vp dev` · `vp check` · `vp test` · `vp build` · `pnpm run cf-typegen` ·
`pnpm run db:generate` then `pnpm run db:migrate:local` · `pnpm run cap:sync` ·
`pnpm run theatre:state -- import <exported.json> --to <SheetId>` (then `list`).

Use `pnpx` rather than `npx` — `npx` fails on this repo's pnpm `devEngines` pin.
