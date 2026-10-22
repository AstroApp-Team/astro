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

| Route            | Sheet                     | Use it when                                                                                                  |
| ---------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `/rig/<scene>`   | the scene's **own** sheet | the rig is going to production. Export needs no rename.                                                      |
| `/studio-corner` | `StudioSandbox`           | an experiment that must not touch a production timeline. Export needs `--from StudioSandbox --to <SheetId>`. |

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

## The example

`scenes/StingScene.tsx` + `states/portfolio-project.state.json` is a rigged,
playing four-second sting: five prefabs rise from under the floor with an
overshoot, staggered 0.3s apart; the camera arcs back and tightens 62° → 48°;
the key light swings behind the ring. Copy those two files and change the names.
