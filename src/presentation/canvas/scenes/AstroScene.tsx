import { editable, SheetProvider } from "@theatre/r3f";
import type { ThreeEvent } from "@react-three/fiber";

import { ASTRO_NODES, ASTRO_CAMERA } from "@core/models/scene.ts";
import { ASTRO_PLANE_SIZE, astroTexture } from "@infra/astro/astroTexture.ts";
import { SHEET_IDS, getSheet } from "@infra/theatre/project.ts";
import { TheatreCameraRig } from "@presentation/canvas/cameras/TheatreCameraRig.tsx";
import { SpawnedShapes } from "@presentation/canvas/elements/SpawnedShapes.tsx";
import { useAstroStore } from "@presentation/state/useAstroStore.ts";
import { useSceneStore } from "@presentation/state/useSceneStore.ts";

/**
 * Astro, on a transparent canvas over a React page.
 *
 * The same arrangement as `FloatScene` — no floor, no grid, no background, no
 * `<Html>` cards — with one structural difference: the subject is a flat vector
 * drawing, so it is a **plane wearing a canvas texture**, not a shaded mesh. There
 * is no light rig here on purpose. The stylesheet's lighting model is a halo plus a
 * rim bloom, both baked into the texture (`infrastructure/astro/astroTexture.ts`);
 * a `meshStandardMaterial` would add a second, contradictory lighting model on top
 * of them.
 *
 * Ownership, stated once because it is the file's whole contract:
 *
 *   - the **rig** owns `position` (a slow drift, landed as `AstroScene`);
 *   - the **store** owns the face (`useAstroStore.expression`), because the 12
 *     states are a texture swap and a keyframed face would silently win over the
 *     page's buttons;
 *   - the **page** owns playback. No `useSheetPlayback` call here: a scene that
 *     started the clip would be a second owner of the playhead the page seeks.
 */
const sheet = getSheet(SHEET_IDS.astro);

const character = ASTRO_NODES[0];

export default function AstroScene() {
  return (
    <SheetProvider sheet={sheet}>
      <TheatreCameraRig
        theatreKey="Astro Camera"
        position={ASTRO_CAMERA.position}
        fov={ASTRO_CAMERA.fov}
      />

      {character != null && (
        <AstroCharacter theatreKey={character.theatreKey} position={character.position} />
      )}

      <SpawnedShapes />
    </SheetProvider>
  );
}

export type AstroCharacterProps = {
  theatreKey: string;
  position: [number, number, number];
};

/**
 * Elements whose press is not a press on the character.
 *
 * The canvas is not a hit target — `eventSource` puts `pointer-events: none` on it
 * and moves R3F's listeners to the page root — so every pointerdown in the page also
 * runs this handler. A tap on a Zz button or a log row that happens to sit under the
 * character must not append a row, so the gate is on controls: the bar, the table,
 * the expression picker, buttons, links and form controls. Everything else is the
 * character's, including the paragraph it is floating in front of.
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
  ".astro__table",
  ".astro__states",
].join(", ");

/**
 * Is this pointerdown a mesh press?
 *
 * Read the element off `nativeEvent`, never off `event.target`: R3F replaces `target`
 * on every mesh event with a pointer-capture shim typed as `EventTarget`, so
 * `event.target instanceof HTMLElement` is always false and compiles clean. A gate
 * written against `event.target` rejects every press, silently.
 */
function isMeshPressTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest(PRESS_BLOCKING_SELECTOR) == null;
}

function AstroCharacter({ theatreKey, position }: AstroCharacterProps) {
  const expression = useAstroStore((state) => state.expression);
  const selectNode = useSceneStore((state) => state.selectNode);
  const hoverNode = useSceneStore((state) => state.hoverNode);

  /**
   * A cached lookup, not a raster.
   *
   * `astroTexture` draws each state once and caches the `CanvasTexture`, so a
   * re-render costs a `Map.get` and a material `map` assignment. Twelve states at
   * 512² is the worst case, and a session that showed all twelve earned it.
   */
  const texture = astroTexture(expression);

  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    // The raycast reaches every object behind the plane; without this the last
    // one wins and a sandbox shape under the character would swallow the tap.
    event.stopPropagation();
    if (!isMeshPressTarget(event.nativeEvent.target)) return;
    selectNode(theatreKey);
  };

  return (
    <editable.mesh
      theatreKey={theatreKey}
      position={position}
      onPointerDown={handlePointerDown}
      onPointerOver={() => hoverNode(theatreKey)}
      onPointerOut={() => hoverNode(null)}
    >
      {/** `ASTRO_PLANE_SIZE` is exactly the halo: `2 D = 1.8 R`. Smaller crops the
          glow into a visible edge; larger makes empty corners part of the tap target. */}
      <planeGeometry args={[ASTRO_PLANE_SIZE, ASTRO_PLANE_SIZE]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
    </editable.mesh>
  );
}
