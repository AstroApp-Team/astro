# Animation & Mesh State Machine — Implementation Plan

Status: **implementation plan**. The behaviour, data model and consumer API are specified in
`extra_docs/ANIMATION-STATE-MACHINE.md` (referred to below as **the spec**). This document
says _where the code goes_, _what each file owns_, _what the repo needs changed_, and _in
what order to build it_ so a fresh agent with no prior context can deliver a working result.

Read `AGENTS.md` first — it is the always-loaded brief and every rule below assumes it.
Read the spec's §4 (runtime loop), §5 (timelines), §6 (constraints) and §11 (schema) before
writing code; they are the normative behaviour.

---

## 0. Ground rules that will bite a fresh agent

These are not optional style notes. Each one has cost real debugging time in this repo.

1. **Layer direction is inward only: `presentation` → `infrastructure` → `core`.**
   `core/` imports nothing from React, three, `@react-three/*`, `@theatre/*`, zustand,
   Ionic, `window`, timers or `Date.now`. The evaluator is pure TypeScript; if a file in
   `core/` needs a clock, it takes one as a parameter or behind a port.
2. **The evaluator must be a pure function of (definition, inputs, time).** Same definition,
   same input history, same `dt` sequence → same pose and events. No hidden clocks, no
   module-level mutable state, no `Math.random()` without an injected RNG.
3. **React Compiler is on.** No `useMemo`, `useCallback`, `React.memo`. The compiler bails
   out on a component that calls a hook which mutates its argument — that is why
   `useSheetPlayback` keeps its writes in module-scope helpers.
4. **Tests import from `vite-plus/test`, never `vitest`.** The `node` test project has no
   DOM: test pure logic only, never render a component. `presentation/` is covered by
   types and by `vp build`, not by the node suite.
5. **`noUncheckedIndexedAccess` is on.** Indexing yields `T | undefined`; use `??`
   fallbacks. A `Map.get()` without a fallback is a type error.
6. **Formatter quirks that fail `vp check`:** no `cond && <jsx>` (use a ternary); no
   trailing comma after the last JSX attribute; `JSON.stringify(…, 2)` writers and the
   formatter fight over short arrays — a state file written that way must be added to
   `fmt.ignorePatterns` in `vite.config.ts`.
7. **`exactOptionalPropertyTypes` is on.** `{ prop: undefined }` is not assignable to
   `{ prop?: T }`; spread conditionally (`...(x == null ? {} : { x })`) as `MainCanvas`
   does for `eventSource`/`eventPrefix`.
8. **A prop is owned by JSX or by the rig, never both.** Theatre.js keyframes override a
   JSX prop's initial value silently. If the machine drives a prop, the sheet must not
   keyframe it. This is the `/float` lesson and applies to every machine output channel.

---

## 1. Architecture in one picture

```
src/core/                                  ← pure TS, no runtime imports
  models/animationStateMachine.ts          types only (the spec's schema, verbatim)
  interfaces/animationAssets.ts            AssetResolver port
  usecases/animationStateMachine/
    validateDefinition.ts                  load-time validation (§11.1)
    evaluateMachine.ts                     the frame loop (§4) — the façade's engine
    resolveTransitions.ts                  candidate selection (§4.3, §8)
    conditions.ts                          condition trees + hysteresis (§7.1)
    timelines.ts                           cursor arithmetic + play styles (§5)
    sampleStates.ts                        clip / 1D / 2D / direct sampling (§4.4)
    compositeLayers.ts                     layer + mask compositing (§4.5)
    constraints.ts                         constraint pass (§6)
    events.ts                              event queue + dispatch order (§4.7)
    types.ts                               internal accumulator/output types
  *.test.ts                                one test file per module, headless

src/infrastructure/                        ← adapters
  theatre/animationStateMachine/
    theatreAssetResolver.ts                clip id → Theatre.js sequence data
    gltfAssetResolver.ts                   clip id → three.js AnimationClip (second kind)
    composeAssetResolver.ts                tries both, reports a clear miss
    machineDefinitionStore.ts              load/save definition JSON (Studio save)
    applyMachineOutput.ts                  pose + morphs → three.js objects
    pointerBridge.ts                       R3F pointer hits → machine.pointer()
  theatre/useSheetPlayback.ts              unchanged — sequences still own whole-scene play

src/presentation/
  state/useMachineStore.ts                 zustand: active machine, inputs, introspection
  canvas/machine/
    MachineCanvas.tsx                      R3F host; owns the update loop via useFrame
    useAnimationMachine.ts                 hook: create/reset/dispose the machine
    MachineScene.tsx                       the demo scene's meshes + rig bindings
    MachineDebugPanel.tsx                  Studio-side sliders/triggers/state readout
  ui/pages/MachinePage.tsx                 demo route
  ui/styles/machine.css                    debug panel + page layout
```

Everything in `infrastructure/` and `presentation/` is an **adapter**: replacing the whole
state machine with another library must not require touching `core/`.

---

## 2. File-by-file plan

### 2.1 `src/core/models/animationStateMachine.ts`

**What it owns.** Every type in the spec's §11 schema, exported as TypeScript types plus the
runtime constants that go with them. This file has **no logic** — no validation, no
evaluation. It is the contract.

Contents, in order:

1. `MachineDefinition`, `MachineOptions`, `InputDef`/`NumberInputDef`/`BooleanInputDef`/
   `TriggerInputDef`, `MaskDef`, `MorphRef`, `LayerDef`, `EntryDef`, `StateDef`
   (`ClipState`, `Blend1DState`, `Blend2DState`, `DirectState`, `ExitState`),
   `BlendChild`, `DirectEntry`, `MarkerDef`, `TransitionDef`, `InterruptionPolicy`,
   `Condition`, `Easing`, `ListenerDef`, `ListenerAction`.
2. `TimelineDef`, `PlayStyle`, `PingPongOptions` from the spec's §5.
3. `ConstraintDef`, `ConstraintTarget`, `ConstraintKind`, `Ref`, `Measure`, `PointerRef`
   from §6.
4. `MachineOutput`, `BoneTransform`, `Quat`, `Vec3`, `PointerHit`, `MachineEvents`,
   `InputInfo`, `StateInfo`, `TransitionInfo`.
5. Constants: `SCHEMA_VERSION = 1`, defaults from `MachineOptions`
   (`DEFAULT_MAX_CHAIN_DEPTH = 4`, `DEFAULT_EPSILON = 1e-4`,
   `DEFAULT_INTERRUPTION = "ignore"`, `DEFAULT_ROTATION_BLEND = "nlerp"`,
   `DEFAULT_MORPH_RANGE = [0, 1]`).

**Rules.** Types must be JSON-serializable (no `Map`, no class instances). Use discriminated
unions with a literal `type` field, as the spec does. Export a `satisfies` check or a small
type-level assertion so a change to one union breaks the validator's exhaustiveness.

**Tests.** None here — types only. A compile error is the test.

### 2.2 `src/core/interfaces/animationAssets.ts`

**What it owns.** The port the evaluator uses to fetch animation data. Kept separate from
the model so a host can supply Theatre.js sequences, GLTF clips or test stubs without the
core knowing which.

```ts
export interface ClipData {
  readonly id: string;
  readonly duration: number;
  readonly boneTracks: readonly BoneTrack[]; // sampled by time
  readonly morphTracks: readonly MorphTrack[];
  readonly markers: readonly MarkerDef[];
}
export interface MorphCurveData {
  readonly id: string;
  readonly duration: number;
  readonly targets: readonly MorphTrack[];
  readonly markers: readonly MarkerDef[];
}
export interface AssetResolver {
  clip(id: string): ClipData | undefined;
  morphCurve(id: string): MorphCurveData | undefined;
}
```

A `MissingAssetResolver` that returns `undefined` for everything is the test stub; the
evaluator must fail loudly when a state references an id the resolver cannot produce
(spec §11.1: "every reference resolves … asset ids via a provided resolver").

**Rules.** No three.js types. A bone track is `{ bone: string; channel; keys: [time, value] }`
plus an interpolation hint; quaternion tracks are keyed as four-component values so the core
never needs a quaternion library — slerp lives in `core/usecases/…/sampleStates.ts`.

### 2.3 `src/core/usecases/animationStateMachine/types.ts`

**What it owns.** The internal mutable types the modules pass around: the frame snapshot,
the layer accumulator, the transition-in-flight record, the event queue entry. These are
**not** the public schema; they exist so the modules do not each redeclare them.

Key types:

- `FrameSnapshot` — frozen inputs, smoothed values, pointer snapshot, `dt`, `elapsed`.
- `LayerRuntime` — active state id, local time, direction, transition in flight, layer
  weight, enabled flag.
- `MachineRuntime` — `FrameSnapshot`, `LayerRuntime[]`, event queue, RNG state (if a
  `startAt: "random"` is used, the RNG is a parameter, not `Math.random`).
- `PoseAccumulator` — sparse `Map<string, BoneTransform>` plus sparse morph map.
- `PendingEvent` — discriminated union matching `MachineEvents`.

**Rules.** These types may be mutated by the evaluator; they never escape the core. The
public `MachineOutput` is a read-only view over the accumulator (spec §4.6: "reused across
frames — no per-frame allocation").

### 2.4 `src/core/usecases/animationStateMachine/validateDefinition.ts`

**What it owns.** Every check in spec §11.1 plus the timeline/constraint checks added in
§5/§6 of the spec. Signature:

```ts
export function validateDefinition(
  def: unknown,
  rig?: RigDescription,
  resolver?: AssetResolver,
): ValidationReport;

export interface ValidationReport {
  readonly ok: boolean;
  readonly errors: readonly ValidationIssue[]; // { path, code, message }
  readonly warnings: readonly ValidationIssue[];
}
```

**Rules.**

- Every error names a **JSON path** (`layers[2].states[1].clip`), not an array index alone.
  The spec requires it and it is what makes Studio authoring tolerable.
- Structural checks run before semantic ones so a malformed definition reports shape errors
  first.
- Warnings vs errors: unreachable states and unknown bone names without a rig description
  are warnings; cycles, duplicate ids and unresolvable references are errors.
- **Zero-duration unconditional cycles** are errors (spec §11.1) — walk the transition
  graph and detect a cycle whose every edge has `duration: 0` and no condition.
- **Constraint cycles** are errors when `breakOnCycle` is true: build a dependency graph
  from each constraint's `Ref`s and its target channel.
- Two enabled constraints writing the same channel is an error (§6.3).
- `exposeAs` must name a declared `number` input and the constraint must not read it.
- Timelines: unique ids, `duration > 0`, markers inside `[0, duration]`, `pingPong.count ≥ 1`.
- Do not validate against a rig when none is supplied — defer to bind time, as the spec says.

**Tests** (`validateDefinition.test.ts`): a valid definition from the spec's §11.2 example;
one test per error class (duplicate id, dangling reference, cycle, type mismatch, unknown
asset, constraint cycle, double-write channel); one test that warnings do not set `ok:false`.

### 2.5 `src/core/usecases/animationStateMachine/conditions.ts`

**What it owns.** `Condition` tree evaluation against a `FrameSnapshot`, including
hysteresis (spec §7.1). Pure, no state.

```ts
export function evaluateCondition(c: Condition, frame: FrameSnapshot): boolean;
export function triggerNames(c: Condition): string[]; // for consuming on a winning edge
```

**Rules.**

- `hysteresis` applies to `greaterThan`/`lessThan` comparisons only; a threshold with
  hysteresis is satisfied when moving _past_ the threshold in the direction of travel and
  only released when crossing the band back. Model hysteresis as "compare against
  `value ± hysteresis` depending on whether the condition was true last frame" — that
  requires the last-frame result to live in `LayerRuntime`, not in the condition object.
- `fired` on a trigger reads the frame's trigger set; a trigger not yet consumed by any
  transition stays pending until `ttl`.
- `not`, `all`, `any` recurse; an empty `all` is true, an empty `any` is false.

**Tests.** Truth tables for each operator; hysteresis band behaviour across three frames
(below → inside → above); trigger consumption is _not_ done here (that is
`resolveTransitions`), so the evaluator stays pure.

### 2.6 `src/core/usecases/animationStateMachine/timelines.ts`

**What it owns.** Timeline cursor arithmetic and play-style semantics (spec §5).

```ts
export interface Cursor {
  readonly timelineId: string;
  time: number; // seconds
  direction: 1 | -1;
  loops: number; // completed loops / round trips
}

export interface CursorStep {
  cursor: Cursor;
  wrapped: boolean;
  reversed: boolean;
  markers: readonly MarkerDef[]; // crossed this step, in crossing order
}

export function stepCursor(cursor: Cursor, def: TimelineDef, dt: number, speed: number): CursorStep;
```

**Rules.**

- Normalised time = `time / duration`; the cursor stores seconds and converts at the edges.
- `once`: forward to `duration`, clamp. With negative speed, run to 0 and clamp.
- `loop`: wrap modulo `duration`; negative speed wraps downward.
- `pingPong`: reverse at each end; `count` bounds round trips; after the count, clamp.
  `mirror` is a **pose** flag, not a cursor flag — the cursor only reverses; the sampler
  applies the mirror.
- Marker crossing uses the half-open interval `(prev, now]` so a marker at the loop boundary
  fires once per loop. On a reversal, crossing is still detected in the direction of travel.
- Return `wrapped`/`reversed` so the sampler knows whether to reset a blend-space child's
  phase synchronisation.
- **No `Math.random()`.** `startAt: "random"` takes an `rng: () => number` parameter; the
  caller owns the seed.

**Tests.** Each play style over a full duration; wrap at exactly the boundary; negative
speed; `pingPong.count` exhaustion; marker fired once at a boundary; marker fired on the
reverse leg; large `dt` crossing multiple loops fires all markers in order.

### 2.7 `src/core/usecases/animationStateMachine/resolveTransitions.ts`

**What it owns.** Candidate ordering and the one-transition-per-layer rule (spec §4.3,
§8). Pure function over `(layer, frame, runtime, def, resolver)` returning either a chosen
transition or `null`.

**Rules.**

- Order: Any State first (declaration order), then the current state's transitions, then
  the Entry transition when the layer just started. `priority` reorders within a group,
  higher first.
- A candidate is eligible iff `from` matches (or `*`), it is not a self-transition unless
  `allowSelf`, `exitTime` is satisfied, and its condition tree is true.
- The **first eligible wins**; the winning edge's referenced triggers are consumed.
- **Never more than one new transition per layer per frame**, except a zero-duration chain
  bounded by `maxChainDepth`. The chain runs _after_ the first choice, re-evaluating from
  the new state.
- A `queue` interruption policy appends to a bounded queue; the queue is drained on the next
  frame that can accept a transition.
- Return the trigger names consumed so the façade can mark them used on the frame snapshot.

**Tests.** Any-State outranks a normal edge; priority reorders; self-transition ignored;
exit time gate; zero-duration chain bounded and warns at the cap; queue policy.

### 2.8 `src/core/usecases/animationStateMachine/sampleStates.ts`

**What it owns.** Turning a state into a layer sample at a time (spec §4.4, §8). Pure.

```ts
export interface StateSample {
  readonly bones: ReadonlyMap<string, BoneTransform>;
  readonly morphs: ReadonlyMap<string, number>;
  readonly markers: readonly MarkerDef[];
}

export function sampleState(
  state: StateDef,
  time: number,
  direction: 1 | -1,
  frame: FrameSnapshot,
  resolver: AssetResolver,
): StateSample;
```

**Rules.**

- `clip`: sample the bone tracks and the morph tracks at `time`; apply `mirror` by flipping
  the sagittal axis of each bone's local transform.
- `blend1d`: find the two children bracketing the input, compute the weight, sample both
  and combine. Children's normalised times are synchronised to the leader when
  `syncTime` (spec §10.2) — do that in the layer loop, not per child.
- `blend2d`: inverse-distance or barycentric weights per `algorithm`; sample and combine.
- `direct`: for each entry, map the input through the range/curve/gain to the target
  morph/pose, then combine per `combine` (`sum`/`max`/`multiply`).
- Missing asset → throw a `MachineDefinitionError` with the state's id and the asset id.
- Crossfade blending is the **caller's** job (`evaluateMachine`); this module samples one
  state.

**Tests.** A stub resolver with two clips of different durations; blend weights at the
endpoints and midpoint; 2D weight sums to 1; direct combine modes; mirror flips the axis;
missing asset throws with a useful message.

### 2.9 `src/core/usecases/animationStateMachine/compositeLayers.ts`

**What it owns.** The layer accumulator (spec §4.5, §3.2). Pure.

**Rules.**

- Start from the bind pose + morph defaults (`basePose` argument, supplied by the adapter or
  the definition's rig description).
- Apply layers in **priority order**. `override` replaces; `additive` adds the delta from
  the layer's `additiveRef`.
- Per bone: translation/scale lerp by effective weight; rotation nlerp/slerp per
  `options.rotationBlend`.
- Per morph: linear lerp by weight.
- Effective weight = `layer.weight × maskWeight(channel)`; skip a layer with weight 0
  (spec §13: "Additive layer with weight 0 — skipped entirely").
- Mask resolution: `extends`/`subtract` compose; bone subtree includes descendants when
  asked; per-bone falloff weight multiplies.
- The accumulator is a working copy — constraints mutate it in place.

**Tests.** Override replaces a lower layer's channel; additive adds only the delta; mask
zeroes an excluded bone; layer weight 0 contributes nothing; subtree mask includes
descendants; subtract mask removes a bone.

### 2.10 `src/core/usecases/animationStateMachine/constraints.ts`

**What it owns.** The constraint pass (spec §6). Pure.

```ts
export function evaluateConstraints(
  constraints: readonly ConstraintDef[],
  pose: PoseAccumulator,
  frame: FrameSnapshot,
  rig: RigDescription,
): void;
```

**Rules.**

- Run after `compositeLayers`, before final output. Sort by `order` then declaration; the
  load-time dependency graph guarantees independent constraints cannot change each other's
  result.
- `proportional`: `value = offset + factor × measure(source, reference)`; measures
  `distance`, `axisDelta`, `angle`, `heightAbovePlane`.
- `aim`: build a quaternion from the target bone's position toward the source, with `up`
  and a cone clamp.
- `follow`: offset in the source's local space, damped by `damping`/`stiffness`.
- `limit`: clamp the target channel to `[min, max]` or to `source ± epsilon`.
- `copy`: copy a channel with per-axis scale/offset/mirror.
- `pointer`: resolve `PointerRef` from the frame's pointer snapshot; on miss follow
  `onMiss` (`hold`/`release`/`snapToRest`); `behaviour` decides which of the above applies.
- A cycle with `breakOnCycle: false` keeps the last-good value and emits a `warning`.
- `exposeAs` writes the computed value into the frame's derived-input map so conditions in
  the next frame read it.
- Never allocate per frame — mutate the accumulator's maps.

**Tests.** "x = 80% of distance to that bone" exactly; aim quaternion within epsilon; cone
clamp; limit clamp; copy/mirror; pointer miss fallbacks; cycle warning; exposeAs feeds a
condition next frame.

### 2.11 `src/core/usecases/animationStateMachine/events.ts`

**What it owns.** The event queue and its deterministic dispatch order (spec §4.7).

**Rules.**

- Order per layer priority: `onExit`, `onEnter`, markers in timeline order,
  `onTransitionComplete`.
- Dispatch synchronously after the output is complete; a throwing listener is isolated and
  reported as an `error` event, and it does not abort the frame.
- `setInput` inside a callback applies next frame — the façade's frame snapshot is frozen
  before dispatch.
- `machine.on()` filters (`layer`, `state`, `name`, `minWeight`) are applied here, not in
  each module.
- Unsubscribe removes the handler immediately; a handler removed during dispatch is not
  called again in the same drain.

**Tests.** Order across two layers; throwing listener isolation; unsubscribe mid-drain;
marker filter by name and `minWeight`.

### 2.12 `src/core/usecases/animationStateMachine/evaluateMachine.ts`

**What it owns.** The frame loop that composes the modules above, in the spec's §4 order.
This is the engine behind the façade; it takes and returns plain data.

```ts
export interface MachineRuntimeState {
  readonly definition: MachineDefinition;
  readonly options: MachineOptions;
  readonly runtime: MachineRuntime;
  readonly basePose: PoseAccumulator;
}

export function stepMachine(
  state: MachineRuntimeState,
  dt: number,
  resolver: AssetResolver,
): { output: MachineOutput; events: readonly PendingEvent[]; warnings: readonly ValidationIssue[] };
```

**Rules.**

- Order strictly: ingest inputs (incl. pointer snapshot) → advance time → resolve
  transitions → sample states → composite layers → **constraint pass** → final output →
  dispatch events. A step that needs the previous step's result takes it as an argument.
- `dt` is clamped to `maxDt` (default 0.1 s) before anything else.
- Trigger consumption happens on the winning transition only; consumed triggers are
  removed from the frame snapshot after resolution.
- Zero-duration chains: loop up to `maxChainDepth`, then warn.
- Re-entrancy: `stepMachine` must throw if called while already running. Implement with a
  module-level guard **inside the façade**, not in the pure module — keep `stepMachine`
  reentrant-safe by construction (it takes all state as arguments).
- Output is written into the caller's reusable buffers; return the same object each frame
  with updated fields (spec §4.6).

**Tests.** End-to-end headless scenarios using a stub resolver:

- a locomotion clip and a jump trigger crossing a transition;
- an Any-State interrupt while mid-fade with `interrupt` policy;
- a two-layer additive blend with a mask;
- a timeline pingPong with markers on both legs;
- a constraint driven by a pointer hit;
- determinism: same input history → identical output across two runs.

### 2.13 `src/core/usecases/animationStateMachine/index.ts`

**What it owns.** The public façade from spec §12: `createMachine`, `validateDefinition`
re-export, and the `Machine` interface implementation. It holds the mutable runtime and the
subscriber list; it delegates every frame to `stepMachine`.

**Rules.**

- **Loud errors.** Unknown input name or wrong type throws in dev and returns `false` plus
  an `error` event in production (spec §2).
- **Idempotent writes.** Setting the same value is cheap and does not re-trigger anything.
- **Order independence within a frame.** Inputs set before `update` produce the same result
  in any order.
- **No hidden clocks.** All time flows through `update(dt)`.
- **`dispose()`** unsubscribes everything and drops the runtime.
- **`reset({ keepInputs })`** restarts each layer at its Entry state; `keepInputs` keeps the
  current input values, otherwise defaults.
- The `Machine` object is stable across frames (no per-frame allocation); its methods read
  the current runtime.

**Tests.** API contract tests against the façade (idempotence, order independence,
re-entrancy throw, unknown input behaviour, reset semantics, dispose).

### 2.14 `src/infrastructure/theatre/animationStateMachine/theatreAssetResolver.ts`

**What it owns.** `AssetResolver` over Theatre.js sequences.

- Resolve a clip id to the sheet's sequence, read its tracks and markers.
- Theatre.js exposes sequences through `ISheet.sequence`; the adapter converts keyframes into
  the core's `BoneTrack`/`MorphTrack` shape (time in seconds, values as numbers or
  four-component quaternions).
- Cache resolved `ClipData` per id; the sheet's state does not change while the app runs
  (a Studio Save reloads the page).
- If the id names a sheet rather than a sequence, report a clear error naming both.

**Tests.** None in the node project if Theatre.js cannot be imported without a DOM; if it
can, a smoke test that an empty sheet produces an empty clip. Otherwise this module is
covered by `vp build` and by the demo scene.

### 2.15 `src/infrastructure/theatre/animationStateMachine/gltfAssetResolver.ts`

**What it owns.** `AssetResolver` over three.js `AnimationClip`s loaded from GLTF, for
skeletal rigs. Optional in the first pass — the spec leaves "what is a clip" open
(§14 question 9). Implement it only after the Theatre resolver works end to end.

### 2.16 `src/infrastructure/theatre/animationStateMachine/machineDefinitionStore.ts`

**What it owns.** Load/save the definition JSON, mirroring `shapeTools/saveService.ts`.

- `loadDefinition(id): MachineDefinition` — fetch from the canonical JSON file in
  `states/` or from a route's static import.
- `saveDefinition(def)` — dev-only, writes through the Studio's save plugin. The file must be
  added to `fmt.ignorePatterns` in `vite.config.ts` because it is written with
  `JSON.stringify(…, 2)` and the formatter collapses short arrays.

### 2.17 `src/infrastructure/theatre/animationStateMachine/applyMachineOutput.ts`

**What it owns.** The only module that knows three.js objects.

```ts
export function applyMachineOutput(
  output: MachineOutput,
  targets: {
    bones: Map<string, THREE.Object3D>;
    morphs: Map<string, THREE.Mesh>; // key `${mesh}:${target}`
  },
): void;
```

**Rules.**

- Write only the sparse entries in `output`; the spec's output is "sparse list of changed
  bones plus a dirty flag".
- Never call `matrixAutoUpdate = false` here — the `/surface` lesson: disabling it makes
  writes invisible until a `updateMatrix()` call the adapter forgot.
- Quaternion writes go through `Object3D.quaternion` (already normalized by the core).
- Morph writes go through `mesh.morphTargetInfluences[index]`; resolve the index once and
  cache it.
- Root motion: the adapter applies it or ignores it, per the scene's ownership rule.

### 2.18 `src/infrastructure/theatre/animationStateMachine/pointerBridge.ts`

**What it owns.** Forwarding R3F pointer hits to `machine.pointer()`.

- R3F's `ThreeEvent` gives `nativeEvent` (the DOM event) and the intersected object; build a
  `PointerHit` with the mesh's name, submesh, UV and point.
- **R3F's `ThreeEvent.target` is not a DOM node** (the `/float`/`/surface` lesson): read
  `nativeEvent.target`, never `event.target`.
- Do not forward a press whose target is a button/link/control unless the definition asks
  for it — the same `isMeshPressTarget` gate the scenes already use.
- A pointer constraint does not consume the pointer; the bridge forwards and the mesh's own
  listeners still fire.

### 2.19 `src/presentation/state/useMachineStore.ts`

**What it owns.** The zustand bridge between the machine instance and React.

- Holds the active machine id, the last `MachineOutput`'s summary, and the last events for
  the debug panel.
- **Do not** put the machine instance in the store — it is mutable and not React state. Hold
  it in a ref/module singleton and expose actions.
- Subscribe with selectors; a bare `useMachineStore()` re-renders on every field.
- The update loop calls a module-scope `stepMachine` helper and writes the summary; the
  panel reads it.

### 2.20 `src/presentation/canvas/machine/MachineCanvas.tsx`

**What it owns.** The R3F host for the machine demo.

- Owns the frame loop with `useFrame((_, dt) => …)`; calls the machine's `update(dt)` and the
  adapter's `applyMachineOutput`.
- Registers `pointerBridge` on the meshes that carry listeners.
- Unmounts by disposing the machine and removing listeners.
- **Do not autoplay a Theatre sequence here** — a scene that starts a clip and a machine that
  also drives props are two owners. If the machine drives transforms, the sheet must not
  keyframe them.

### 2.21 `src/presentation/canvas/machine/MachineScene.tsx`

**What it owns.** The demo geometry and the bone-name mapping the adapter needs. Keep it
small: two or three meshes, a rigged subtree, one morph target.

### 2.22 `src/presentation/canvas/machine/useAnimationMachine.ts`

**What it owns.** Create/reset/dispose the machine in an effect; expose inputs setters.

- `useEffect` creates the machine and returns `dispose`; no `useMemo`.
- Inputs are set from React state in an event handler, not during render.
- The hook returns stable setter functions — the React Compiler handles stability; do not
  wrap in `useCallback`.

### 2.23 `src/presentation/ui/pages/MachinePage.tsx` + `ui/styles/machine.css`

**What it owns.** A demo route that mounts `MachineCanvas`, a debug panel with sliders for
number inputs, toggles for booleans, buttons for triggers, and a readout of active states,
layer weights and the last events.

- Register the route in `ui/layouts/AppLayout.tsx` and add the screen to `AppScreen` in
  `ui/state/useAppStore.ts` (the `/float` precedent).
- The CSS must not fight the canvas: `--overflow: hidden` on the page content, a fixed
  overlay only if the canvas is transparent, and a `touch-action` decision stated on mount.

### 2.24 `src/presentation/canvas/machine/MachineDebugPanel.tsx`

**What it owns.** The Studio-side authoring surface: sliders bound to `machine.setNumber`,
toggles to `setBoolean`, buttons to `fire`, a live state readout, and a constraint list with
enable/disable. Dev-only rendering (`import.meta.env.DEV`), like `StudioDevButton`.

---

## 3. Assorted repo changes

1. **`src/core/models/scene.ts`** — add the demo scene's id to `SCENE_IDS` and its node
   constants; **`src/infrastructure/theatre/project.ts`** — add the sheet to `SHEET_IDS` and
   `SCENE_SHEET_IDS` (a `Record`, so a missing entry is a compile error).
2. **`src/presentation/canvas/scenes/sceneRegistry.tsx`** — register the demo scene.
3. **`src/presentation/ui/layouts/AppLayout.tsx`** — add the route; **`useAppStore.ts`** — add
   the screen.
4. **`src/presentation/ui/components/StudioDevButton.tsx`** — add the dev link.
5. **`vite.config.ts`** — add any machine definition JSON written by the Studio save plugin
   to `fmt.ignorePatterns`; keep the three Theatre state files already there.
6. **`scripts/theatre-state.mjs`** — no change unless the definition is exported from the
   Studio as a Theatre state; if so, the import command must accept a definition file too.
7. **Tests** — `core/usecases/animationStateMachine/*.test.ts` in the `node` project. Do not
   add DOM tests; the presentation layer is covered by types and `vp build`.
8. **`AGENTS.md`** — one section on the machine: the pure-function rule, the layer direction,
   the "prop owned by JSX or rig" rule for machine-driven channels, the pointer bridge's
   `nativeEvent.target` rule, and the definition file's formatter exemption.
9. **`extra_docs/THEATRE.md`** — the rigging workflow for a machine demo: rig on `/rig/:id`,
   export, `pnpm run theatre:state -- import <export> --to <SheetId>`, and the ownership rule.
10. **No new dependencies.** The core needs no library; three.js is already a dependency;
    the pointer bridge uses R3F's existing events. If a quaternion helper is needed, write it
    in `core/` — do not add `three` to core.

---

## 4. Order of work (each step ends with a green `vp check` + `vp test`)

**Phase 1 — contract.** `models/animationStateMachine.ts`, `interfaces/animationAssets.ts`,
`usecases/animationStateMachine/types.ts`, `validateDefinition.ts` + tests. No runtime yet.
Ship a definition JSON in the spec's §11.2 shape as a fixture.

**Phase 2 — time and conditions.** `timelines.ts`, `conditions.ts` + tests. Play styles and
condition trees are the two places the spec is most precise; getting them right first avoids
re-testing them through the façade.

**Phase 3 — sampling and compositing.** `sampleStates.ts`, `compositeLayers.ts` + tests. Use a
stub resolver. Verify mask maths and the additive delta formula.

**Phase 4 — constraints.** `constraints.ts` + tests. The proportional example from the spec
("80% of the distance") is the acceptance test.

**Phase 5 — the loop and the façade.** `resolveTransitions.ts`, `events.ts`,
`evaluateMachine.ts`, `index.ts` + end-to-end headless tests. This is the point where the
public API from spec §12 exists and can be used without a renderer.

**Phase 6 — infrastructure.** `theatreAssetResolver.ts`, `applyMachineOutput.ts`,
`pointerBridge.ts`, `machineDefinitionStore.ts`. Verify against a real Theatre sheet on the
demo scene. This is where "what is a clip" gets decided; start with Theatre sequences.

**Phase 7 — presentation.** `useMachineStore.ts`, `MachineCanvas.tsx`, `MachineScene.tsx`,
`useAnimationMachine.ts`, `MachinePage.tsx`, `MachineDebugPanel.tsx`, `machine.css`. Register
the route and the dev link. State the `selectionVisuals` and `touch-action` choices on mount.

**Phase 8 — docs and polish.** `AGENTS.md`, `extra_docs/THEATRE.md`, the edge cases you hit.
Run the full verification set.

---

## 5. Verification (the definition of done)

```
vp check --fix
vp check
vp test
vp build
```

Plus these greps on the production bundle, which must stay at 0 for anything dev-only:

```
grep -c "studio.initialize" dist/client/assets/index-*.js
grep -c "astro.scene-tools" dist/client/assets/index-*.js
```

And the route, with `vp dev` running:

```
curl -i -o /dev/null -w "%{http_code}\n" http://localhost:5173/machine
```

Acceptance criteria, in the spec's words:

- A definition loads and validates; a bad definition throws with a JSON path.
- Inputs are the only control surface: no clip, bone or morph index appears in consumer code.
- One layer overrides another; an additive layer adds only its delta; a mask excludes a bone
  subtree.
- A trigger fires a transition, is consumed, and does not re-fire from the same press.
- A crossfade blends skeleton and morphs simultaneously; interruption policies behave as
  §8.2 says.
- A timeline plays once, loops and ping-pongs; negative speed plays backwards; markers fire on
  both legs.
- A constraint "x is 80% of the distance to that bone" computes exactly that; a pointer
  constraint follows a drag and holds or releases on a miss.
- The evaluator runs headless: no DOM, no renderer, same output for the same input history.
- `core/` imports no framework; the adapter can be swapped without touching the evaluator.

---

## 6. What NOT to do

- Do not put three.js, React or Theatre imports in `core/`. If a module needs one, it belongs
  in `infrastructure/`.
- Do not read `Math.random()`, `Date.now()` or `performance.now()` in the core. Pass time and
  an RNG in.
- Do not keyframe in Theatre.js a prop the machine drives, and do not drive a prop Theatre.js
  keyframes. Pick one owner per channel.
- Do not make the machine's `update` depend on a clock it did not receive. A tab pause must not
  teleport the animation; the `dt` clamp is the only defence.
- Do not filter pointer hits on `event.target` — R3F's `ThreeEvent.target` is not a DOM node.
- Do not write the definition with a formatter-active JSON file. Add it to `fmt.ignorePatterns`
  or the formatter and the Studio's save will fight forever.
- Do not "fix" a silent no-op by adding a default. The spec's whole point is that an unknown
  input, an unresolvable asset or a duplicate channel is a loud error.
