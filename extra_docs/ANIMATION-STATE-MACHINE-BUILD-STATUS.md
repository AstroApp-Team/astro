# Animation state machine — build status (handoff)

Snapshot for a fresh agent picking up the implementation of
`extra_docs/ANIMATION-STATE-MACHINE-IMPLEMENTATION-PLAN.md`. Read that plan first; this
file records only where the work actually stands and what the compiler is complaining
about right now.

## PARKED (as of this edit)

**The whole feature has been moved out of `src/` to `parking/animation-state-machine/`**
(`core/models/animationStateMachine.ts`, `core/interfaces/animationAssets.ts`,
`core/usecases/animationStateMachine/` — same relative layout). It is untracked in git,
nothing in the app imports it, and `tsconfig.app.json` includes `src`, so it is outside
`tsc`, Vitest and the bundler. The app's `vp check` / `vp test` / `vp build` are green
without it. To unpark: `mv` the three paths back and reconcile the divergence below.

**The error count in this doc is stale.** At the time of writing the tree had 50 errors
in the six groups listed below. Since then the type surface was reworked (`types.ts`
`InputSnapshot` is now `numbers`/`booleans`/`triggers`/`derived` — the implementation
still reads `.values`/`.time`/`.triggerTimes` — and `StateDef`/`LayerRuntime`/
`TransitionRecord`/`MachineRuntime` were redesigned), `seekResolver.ts` was deleted but
`transitionEngine.ts:38` still imports `resolveSeek` from it, and the live count is
**244 errors** — a rewrite-scale reconciliation, not the six mechanical groups below.
Treat the list below as a historical floor, not the current state.

## State of the tree

Branch `clean-refactor`. The core module is written but **does not typecheck**. Nothing
outside `src/core/usecases/animationStateMachine/` imports it yet, so the rest of the repo
is unaffected: the app still builds and every pre-existing test passes.

Run this to get the live list (50 errors at the time of writing, all in that folder):

```bash
pnpm exec tsc -p tsconfig.app.json --noEmit 2>&1 | grep -E "^src/.*error TS"
```

`vp check --fix` has already been run, so formatting is clean and every remaining item is
a real TypeScript error.

## Files that exist

`src/core/models/animationStateMachine.ts` — the complete type surface: `MachineDefinition`,
`LayerDef`, `StateDef` (clip / direct / blend1d / blend2d / exit), `TransitionDef`,
`Condition`, `InputDef`, `MaskDef`, `ConstraintDef` (follow / aim / copy / limit /
proportional), `ListenerDef`, `TimelineDef`, `MachineOutput`, `SCHEMA_VERSION`.

`src/core/interfaces/animationAssets.ts` — `AssetResolver`, `ClipAsset`, `BoneChannelAsset`,
`MorphChannelAsset`, `MorphCurveAsset`, `CHANNEL_STRIDE`, `staticResolver`.

`src/core/usecases/animationStateMachine/` — `easing.ts`, `mathUtil.ts`, `timelineCursor.ts`,
`inputStore.ts`, `maskResolver.ts`, `conditionEval.ts`, `sampleState.ts`,
`transitionEngine.ts`, `blendPoses.ts`, `applyConstraints.ts`, `pointerListeners.ts`,
`validateDefinition.ts`, `createMachine.ts`, `types.ts` (internal runtime shapes), and
`index.ts` (the only module `infrastructure/` and `presentation/` may import).

Not yet written: the R3F adapter, the Studio extension, the runtime store, the test suite,
and the documentation bullet.

## The 50 errors, grouped by root cause

Fix in this order — the first group cascades.

**1. Missing exports / wrong import paths (5 errors).**

- `ClipAsset` is imported from `@core/models/animationStateMachine.ts` in
  `createMachine.ts:28` and `validateDefinition.ts`, but it lives in
  `@core/interfaces/animationAssets.ts`.
- `ConstraintTarget` is imported from the model file in `validateDefinition.ts:21`; it does
  not exist. Either declare it in the model (it is the `channel` union) or drop the import.
- `ResolvedMask` is imported from `types.ts` in `createMachine.ts:104`; it is exported by
  `maskResolver.ts`.

**2. `exactOptionalPropertyTypes` (7 errors).** `applyConstraints.ts:299,344,353,408`,
`blendPoses.ts:239`, `pointerListeners.ts:135`, `createMachine.ts:340`. Every one is an
object literal passing `key: undefined` to a property typed `key?: T`. Either add
`| undefined` to the target property or omit the key when the value is undefined. Do not
turn the flag off.

**3. `noUncheckedIndexedAccess` (5 errors).** `applyConstraints.ts:494-497` index a tuple;
`sampleState.ts:514` indexes an array. Use `?? 0` / a length check — see `JourneyPanel.tsx`
for the house style.

**4. Unused declarations (13 errors, all `TS6133`/`TS6196`).** Prefixed-out imports and
parameters. Delete them, or prefix the parameter with `_` if it documents the shape.

**5. Narrowing (§ the real work, 9 errors).**

- `conditionEval.ts:85,102,104` — `LeafCondition` is a union; `consume`, `value` and
  `hysteresis` only exist on some members. Switch on `.kind` (or on the count of keys) and
  narrow before reading.
- `createMachine.ts:577` — `state.clip` is read without proving `state.type === "clip"`.
  The plan's `resolveDuration` already does this correctly a few lines above; copy it.
- `maskResolver.ts:93` — a mask `extends` entry typed `string` is read for `.mesh` /
  `.target`. The union is `string | { mesh, target }`; narrow first.
- `createMachine.ts:241` — `transitionContext.emit` is passed a bare `string` where
  `"queue" | "interruption"` is expected. Type the parameter as the union.
- `createMachine.ts:296,313,315,334` — the object literal passed as `TransitionContext`
  does not satisfy the interface. Compare it with the `TransitionContext` declaration in
  `types.ts` and align field-by-field; it is almost certainly a missing member or a
  `sample`/`durationOf` signature mismatch.
- `createMachine.ts:412` — `Map<number, PointerState>` vs the `ReadonlyMap` shape
  `ConstraintContext` declares (optional keys, again).
- `createMachine.ts:543` — `createLayerRuntime` must set `frozenFromPose: null`.

## Design decisions already made (do not re-litigate)

- **Frame order** is documented at the top of `createMachine.ts`: listener actions queued
  last frame land first, constraints publish into the _next_ frame's inputs, cursors
  advance before sampling, sampling before blending. A listener that fires on
  `pointerDown` must never change an input a transition already evaluated this frame.
- **`Math.random` is banned in `core/`.** `mulberry32(seed)` lives in `createMachine.ts` and
  is injected; a machine that starts at a random phase has to reproduce.
- **Blend fraction is `blendFraction(sourceProgress, fadeEasing)`, never
  `elapsed / duration`.** That is the §8.3 bug the module exists to prevent.
- **Duration resolution** is timeline → clip duration → `morphCurve` duration → 1 second.
  A stateless state has no time axis, so `1` makes normalized time equal seconds.
- **A mask weight is per channel**, not per state: 0.5 on `spine.rotationQuat` leaves
  `spine.position` at full weight.
- `resolveMaskRef`'s third argument is a plain `Record<string, MaskDef>`, not a `Map` — the
  inline-mask branch was already fixed for this. Keep it that way.

## Remaining phases

Phases 1–7 of the plan are on disk. Still to do, in the plan's order: the R3F adapter
behind a port, the Studio extension (constraint authoring + the timeline editor), the
runtime store, the test suite (pure logic only — the `node` project has no DOM, import
from `vite-plus/test`, never `vitest`), and the `AGENTS.md` / `THEATRE.md` bullets.

## Verification that will have to be run

`vp check --fix`, `vp check`, `vp test`, `vp build`. There is no headless browser here, so
anything visual is manual — say so rather than claiming you saw it.
