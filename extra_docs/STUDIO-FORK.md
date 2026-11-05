# Astro Studio — the forked, made-to-order editor

This is the guiding spec for `studio/`, our own animation + scene editor. It is written to be
read top-to-bottom before touching the code, and it is the document that decides arguments.

It exists because the Theatre.js Studio cannot be extended far enough for what Astro needs, and
every earlier attempt to stretch it from the outside hit the same three walls:

1. **No seam for the sequence editor.** `@theatre/studio`'s `IStudioUI` exposes `hide()`,
   `restore()`, `renderToolset()` and nothing else. `DopeSheet`, `CurveEditor` and `SequenceEditor`
   are internal modules; the editor is one body-level React tree in `#theatrejs-studio-root`,
   `z-index: 100`. It cannot be embedded, resized into a panel, or opened for one track.
2. **Only sheet props animate.** `setKeyframeOfPath` resolves against the sheet. A material colour,
   a shader uniform, `visible`, a shader id — none of them are props, so `◆` on them writes nothing
   and the UI has no honest way to say so.
3. **One playhead per sheet.** A sheet is one sequence with one time. Two things happening on
   different clocks is not expressible, so "timelines" were always going to be a lie told in UI.

The fork is not a patch of the npm package: `@theatre/*` ships built JS with no sources and its
public API was never meant to grow channels, formulas or multiple clocks. We keep its **data
semantics** (bezier handle units, hold keys, `ObjectKey.prop.subprop` paths, exported state JSON)
and write the runtime, the binder and the editor ourselves, in this repo, under our own tests.
Stage-1 compatibility is a hard requirement: an existing `states/*.json` must load and reproduce
the same poses, because every rig in `presentation/canvas/scenes/**` was authored against it.

---

## 1. Goals

- **Curve editing that matches or beats the Studio**: bezier handles per key, hold keys, per-key
  easing presets, dragging keys and handles, multi-select, snapping, per-track zoom.
- **Timelines are sequences.** A timeline owns a set of props and a window of time, with its own
  clock, speed and play style. Several can run at once; they do not share a playhead.
- **Any prop is keyframeable**: numbers, colours, booleans (visibility), strings (shader id),
  shader uniforms, and per-object material assignment.
- **Formulas on props**: `mouseX`, `mouseY`, `breath` … as inputs, and a prop can be
  `default → formula → clip`, with the clip winning only where a key exists.
- **The scene is editable**: hierarchy, spawn/remove/reparent, lights, per-object shader, imported
  glTF as first-class nodes (keyframeable like anything else).
- **The machine is part of the editor**, not a separate page: states and transitions are graph
  nodes; a transition is edited in a deck with duration, condition, clip and speed clamp.
- **One editor shell for every rig route** (`/rig/:sceneId`), dark, resizable, no text selection
  while dragging, keyboard-driven, and correct at phone width.
- **The editor never ships.** Like the Studio today: everything behind `import.meta.env.DEV` and a
  dynamic import, verified by grepping the built bundle.

## 2. Non-goals

- Morph-target and bone animation (Theatre's paid/beta surface). Spawned shape transforms only.
- Video/audio editing, timeline compositing, particle systems.
- A general-purpose DCC. The editor edits **this** app's scenes.
- Backwards compatibility with Theatre's _authoring_ UI: once stage 3 lands, `@theatre/*` leaves
  `package.json`. The state-file format stays readable forever (import only).

## 3. Shape of the project

```
studio/                       # a workspace package, `@astro/studio`
  src/core/                   # framework-free: no react, no three, no window
    bezier.ts                 # Theatre-compatible handle units + easing presets
    track.ts                  # Track, Keyframe, sampling, handle edits
    doc.ts                    # SceneDoc: nodes, tracks, sequences, formulas, inputs
    sequence.ts               # clocks, windows, play styles, multi-timeline scheduling
    formula.ts                # expression AST, parse, compile, evaluate (cycle-guarded)
    resolve.ts                # ONE resolver per prop: default → formula → clip
    ops.ts                    # commands + inverse (undo/redo), validation
    importTheatre.ts          # `states/*.json` → SceneDoc (stage 1, read-only)
    exportState.ts            # SceneDoc → Theatre-shaped JSON (stage 1/2 escape hatch)
    machine/                  # the existing state-machine core, moved in unchanged
  src/three/                  # binder: three objects ← resolved values (imports three)
  src/react/                  # editor UI (imports react) — shell, panels, curve editor
  package.json, tsconfig.json
```

Dependency direction is the same rule the app already follows: `core` imports nothing from
`react`, `three`, or the DOM; `three` imports `core` + `three`; `react` imports all three. The app
imports `@astro/studio` through its public entry points only.

### Why a workspace package and not `src/studio/`

It is a second project with its own vocabulary, its own tests, and its own release rhythm. Keeping
it in `studio/` means `vp check` type-checks it as a unit, its tests run in the node project, and
deleting it is one `rm -rf` plus one dependency line — which is also the rollback story.

## 4. Data model

### 4.1 Addresses

`path` strings are Theatre-compatible: `Sheet.ObjectKey.prop.subprop`, e.g. `Astro.position.x`,
`Astro.expression`, `Spotlight.intensity`, `Astro.material.shader`. The object key is the stable
name the scene mounts (`theatreKey` today); it is also the registry key the binder uses, because
uuids die on every route change.

### 4.2 Track

```ts
type ChannelKind = "number" | "colour" | "boolean" | "string";
type KeyType = "bezier" | "hold";

interface Keyframe {
  time: number; // seconds, absolute in the doc's timeline
  value: number; // numbers in SI; colours as 0xRRGGBB
  type: KeyType;
  handles: [number, number, number, number]; // leftX, leftY, rightX, rightY — Theatre units
}

interface Track {
  path: string;
  kind: ChannelKind;
  keys: Keyframe[]; // sorted, unique times
}
```

Handle units are Theatre's and must not be "fixed": `x` is a fraction of the segment, `y` a
multiple of the segment's value delta, so a handle survives a retime and a copy between tracks
(`bezierEase` in `core/usecases/animationStateMachine/theatreTracks.ts` is the reference for
sampling; the fork moves that maths rather than re-deriving it).

### 4.3 Sequence and timelines

```ts
interface Timeline {
  id: string;
  name: string;
  props: string[]; // patterns: "Astro.position.*", "*.intensity"; empty = whole sheet
  window: { start: number; end: number }; // the sheet range this timeline plays
  speed: number;
  playStyle: "once" | "loop" | "pingPong" | "hold";
}
```

A **timeline is a sequence**: it plays `window` on its own clock, samples only `props`, and
composes onto the doc's value map in `order`. Two timelines can own disjoint props and overlap in
time — that is the whole point. Overlap on the _same_ prop is resolved by `order` (last wins) with
a validation warning, because silent double-writes are the class of bug this project keeps paying
for.

### 4.4 Inputs and formulas

```ts
interface Input {
  name: string;
  kind: "number" | "boolean" | "trigger";
  value: number | boolean;
}
```

Inputs are written by the app (pointer, scroll, machine parameters) and read by formulas. The AST
is deliberately small — `const`, `input("mouseX")`, `prop("Astro.position.x")`, `+ - * /`,
`sin cos lerp clamp remap smoothstep`, comparison, ternary. No host access, no functions, no
assignment: evaluation must be total, deterministic and cheap (it runs per frame per prop).

**Resolution order is `default → formula → clip`.** The clip wins only at a time where a keyframe
exists; a formula overrides the authored default everywhere else. This is the single-writer rule
that Theatre could not give us: exactly one value per prop per frame, computed in one place.

### 4.5 SceneDoc

Nodes (name, parent, kind `mesh|group|light|camera|imported`, transform, geometry descriptor,
material id, uniforms, source for imports) plus `tracks`, `timelines`, `inputs`, `formulas`, and
a `machine` (the existing definition, with timelines by id). Serialised as one JSON file
(`states/<scene>.studio.json`), with `imported` assets referenced by name, not blob.

## 5. Evaluation

```
inputs ─┐
        ├─ formula eval ─→ base values ─┐
doc ────┘                               ├─ timeline sample (per timeline, own clock) ─→ final
                                        │
machine ── state → timeline, weights ───┘
```

`resolveFrame(doc, { clocks, inputs, weights })` returns `Map<path, number|colour|bool|string>`.
Pure, no allocation beyond the map, benchmarked at 60 fps × 2 000 tracks in the node tests. The
three binder applies the map to registered objects; it never reads three state back.

## 6. Editor UX

The shell that exists today survives, with the walls removed:

- **Header**: scene dropdown (real sheets), transport, Studio-free (no Theatre), keyframe, save.
- **Left**: Scene (hierarchy, add/remove/reparent, import glTF), Timelines (one row per sequence:
  props picker, window, speed, play style, `+`, delete-on-hover), Inputs (`+` number/bool/trigger),
  State machines (`+`, drag a timeline onto the canvas → state, onto a link → split).
- **Centre**: viewport (R3F) + machine graph (straight links, circle badge with arrow → transition
  deck) with a draggable boundary between them.
- **Right**: Inspector — transform, material/shader swap, uniforms (each with `◆` and
  "→ input"), formulas (`f(x)` per prop), plus the existing Machine/Character/Tools panels.
- **Bottom**: dope sheet for the _selected timeline_ — only its props, its window, its keys, with
  an inline **curve editor** (handles, hold, presets), and a second deck half for the selected
  state/transition.
- Every boundary draggable; every panel remembers its size; `user-select: none` on chrome.

## 7. Integration with the app

- Aliases: `@studio/*` in `tsconfig.app.json` `paths` **and** `vite.config.ts` `resolve.alias` (the
  repo's doubled-alias rule), plus the Vitest project aliases.
- `presentation/canvas/**` swaps `editable.mesh` etc. for `<StudioNode name=… />` from the binder.
- Scenes declare nodes as data (`STING_NODES`-shaped, extended with material/uniform descriptors);
  `SHEET_IDS`/`SCENE_SHEET_IDS` remain the compile-time scene registry.
- The dev-only gate is one module (`studio/src/react/DevStudioBoundary.tsx`) so the production
  bundle check stays a single grep.
- `states/*.json` are imported at module scope and converted once; the Studio panel is not loaded
  in production (dynamic import inside `import.meta.env.DEV`).

## 8. Milestones

| #   | Deliverable                                                                    | Acceptance                                                                  |
| --- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| M0  | Package skeleton, `bezier` + `track` + tests ported from `theatreTracks` maths | body-pose parity for the float/astfo states in a node test                  |
| M1  | `importTheatre` + `SceneDoc` + `resolveFrame` with clips only                  | a state file renders the same camera-frame poses as today                   |
| M2  | three binder + `<StudioNode>` for all scenes; formulas                         | `mouseX/mouseY → Astro.rotation.y` works with inputs written from the app   |
| M3  | Multi-timeline clocks + machine integration                                    | two timelines on disjoint props run at once; machine transitions drive them |
| M4  | Dope sheet v2 (per timeline, values, window) + **curve editor**                | handle drag/hold/preset change the sampled value, tested in the browser     |
| M5  | Inspector: material swap, uniforms, colour/bool/string tracks, `→ input`       | colour keyframes animate a material                                         |
| M6  | Hierarchy editing + glTF as doc nodes                                          | import, reparent, keyframe an imported node                                 |
| M7  | Editor parity shell (panels, resize, keyboard, phone) on `/rig/:sceneId`       | all rig routes use the fork; no Theatre UI                                  |
| M8  | Remove `@theatre/*`; docs; bundle greps                                        | `grep -c @theatre` in the built bundle is 0                                 |

Each milestone lands with tests (node for core, browser probes for UI) and green `vp check` /
`vp test` / `vp build`. No milestone leaves the working tree broken.

## 9. Invariants

- **One writer per prop per frame.** Everything funnels through `resolveFrame`.
- **One clock per timeline.** No global playhead; the machine owns scheduling, not time.
- **Handles are data, not UI state.** A curve edit is a command with an inverse.
- **No identity churn.** Sheets/docs/objects are module-scope or store-held; never rebuilt in a
  component body (the repo's oldest lesson).
- **The editor never ships.** Verified by bundle grep in CI-parity checks.
- **Phone-width first.** Every panel has a collapsed state; no control is hover-only.
- **Formatter-ignored generated files** stay `JSON.stringify(…, 2)` writers.

## 10. Migration and rollback

`importTheatre` reads `sheetsById`, walks each sheet's `sequence.tracks`, and converts keys with
their handles into `Track`s. Until M8 the reverse (`exportState`) exists so the app can keep
landing state files for `/showcase`; after M8 it is deleted with the dependency.

Rollback is: delete `studio/`, restore the alias lines, and the app compiles against `@theatre/*`
again — which is only true while `presentation/canvas/**` still passes `theatreKey`s, so that
contract is deliberately kept through M7.

## 11. Open questions

- Colour interpolation space (sRGB linear vs gamma) — pick sRGB blend to match CSS expectations,
  document it, and let a track opt into linear.
- Whether formula evaluation belongs before or after machine weight blending for additive layers
  (current answer: before; weights blend the clip only).
- Undo granularity for handle drags (one command per drag, not per pointermove).
