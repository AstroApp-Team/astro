import { SheetProvider } from "@theatre/r3f";
import type { ThreeEvent } from "@react-three/fiber";

import { ASTRO_V2_CAMERA, ASTRO_V2_NODES } from "@core/models/scene.ts";
import { SHEET_IDS, getSheet } from "@infra/theatre/project.ts";
import { TheatreCameraRig } from "@presentation/canvas/cameras/TheatreCameraRig.tsx";
import { SpawnedShapes } from "@presentation/canvas/elements/SpawnedShapes.tsx";
import { AstroV2Character } from "@presentation/canvas/astroV2/AstroV2Character.tsx";
import { useSceneStore } from "@presentation/state/useSceneStore.ts";

/**
 * Astro v2, on a transparent canvas over a React page.
 *
 * The same arrangement as `AstroScene` and `FloatScene` — no floor, no grid, no
 * background, no `<Html>` cards — with the subject rebuilt as geometry. The
 * structural difference from v1 is that there is nothing to paint the character *on*:
 * v1 was a plane wearing a canvas texture, v2 is a sphere, two prisms and a shell,
 * each with a `ShaderMaterial` (see `canvas/astroV2/materials.ts`). Nothing here
 * touches a light, and that is deliberate — the stylesheet's character *emits* its
 * colour, and a standard material would need a rig of lights to look like anything and
 * would then contradict the gradient.
 *
 * Ownership, stated once because it is the file's whole contract:
 *
 *   - the **rig** owns the group's transform (a landed clip can drift the character;
 *     nothing is keyframed yet, so the motion is the shaders');
 *   - the **store** owns the face — `useAstroStore.expression` selects which morph
 *     weights the frame loop damps toward, so a keyframed face would silently win over
 *     the page's buttons;
 *   - the **page** owns playback. No `useSheetPlayback` here: a scene that started the
 *     clip would be a second owner of the playhead the page seeks.
 */
const sheet = getSheet(SHEET_IDS.astroV2);

const character = ASTRO_V2_NODES[0];

export default function AstroV2Scene() {
  return (
    <SheetProvider sheet={sheet}>
      <TheatreCameraRig
        theatreKey="Astro V2 Camera"
        position={ASTRO_V2_CAMERA.position}
        fov={ASTRO_V2_CAMERA.fov}
      />

      {character != null ? (
        <AstroV2Character
          theatreKey={character.theatreKey}
          position={character.position}
          onPress={handlePress}
        />
      ) : null}

      <SpawnedShapes />
    </SheetProvider>
  );
}

/**
 * Elements whose press is not a press on the character.
 *
 * The canvas is not a hit target — `eventSource` puts `pointer-events: none` on it and
 * moves R3F's listeners to the page root — so *every* pointerdown in the page also runs
 * the mesh handlers. A tap on a Zz button, a slider, or the bar that happens to sit
 * over the sphere must not poke the character, so the gate is on controls: the bar, the
 * expression picker, the tuner, buttons, links and form controls. Everything else is
 * the character's, including the paragraph it floats in front of.
 *
 * This cannot be a gap-only test: the shell is 2.3 world units across and crosses most
 * of the page's width, so "did anything else get hit" is always yes.
 */
const PRESS_BLOCKING_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "select",
  "textarea",
  "summary",
  "[role='button']",
  ".astro__bar",
  ".astro__states",
  ".astro__sliders",
  ".astro__tuner",
].join(", ");

/**
 * Is this pointerdown a press on the character?
 *
 * Read the element off `nativeEvent`, never off `event.target`: R3F replaces `target` on
 * every mesh event with a pointer-capture shim typed as `EventTarget`, so
 * `event.target instanceof HTMLElement` is always false and compiles clean. A gate
 * written against `event.target` rejects every press, silently.
 */
function isMeshPressTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest(PRESS_BLOCKING_SELECTOR) == null;
}

/**
 * A press that reached the body.
 *
 * Two writes, and they are different channels on purpose:
 *
 *   - `selectNode` is what the outliner and the cursor read — *which* mesh the pointer
 *     is on. Subscribing to it for "did the user poke the character" would work once:
 *     a second poke writes the same node id, React sees no change, and the page
 *     records nothing.
 *   - `emit` is that signal. It carries a fresh event object, so the second poke is a
 *     new value the page can act on (append a row, react, seek).
 *
 * `selectionVisuals` is off for this route, so nothing lights up; the selection is
 * still recorded for the bench at `/rig/astro-v2`.
 */
function handlePress(event: ThreeEvent<PointerEvent>): void {
  // The raycast reaches every object behind the shell; without this the last one wins.
  event.stopPropagation();
  if (!isMeshPressTarget(event.nativeEvent.target)) return;

  useSceneStore.getState().selectNode("Astro V2");

  /*
   * `node-pressed` with the node id, because that is what the page's effect matches
   * (`lastEvent.name === "node-pressed" && lastEvent.nodeId === "Astro V2"`). A bespoke
   * event name is a poke that increments nothing, with no error. Each `emit` also builds
   * a **new** event object with a fresh `at`, so a second press on the same node is a new
   * value React re-renders on.
   *
   * The reaction is the page's (`AstroV2Page` runs `react()` and its counter); a
   * `react()` here would make one poke react twice.
   */
  useSceneStore.getState().emit("node-pressed", "Astro V2");
}
