import { editable, SheetProvider } from "@theatre/r3f";
import type { ThreeEvent } from "@react-three/fiber";

import { FLOAT_CAMERA, FLOAT_NODES } from "@core/models/scene.ts";
import { showsSelectionHighlight } from "@core/usecases/showcaseInteraction.ts";
import { SHEET_IDS, getSheet } from "@infra/theatre/project.ts";
import { TheatreCameraRig } from "@presentation/canvas/cameras/TheatreCameraRig.tsx";
import { SceneLights } from "@presentation/canvas/elements/SceneLights.tsx";
import { SpawnedShapes } from "@presentation/canvas/elements/SpawnedShapes.tsx";
import { useSceneStore } from "@presentation/state/useSceneStore.ts";

/**
 * The reverse demonstration: a Theatre.js scene with no page of its own.
 *
 * `StingScene` is a world the UI is laid over — a floor, a grid, a camera that
 * arcs through a shot, node cards rendered by drei's `<Html>`. This scene is the
 * opposite: one sphere, no floor, no grid, no background, no cards. It draws
 * nothing that is not the sphere, because it is mounted on a transparent canvas
 * that sits *above* a React page, and every pixel this scene does not draw is a
 * pixel of the page showing through. A `gridHelper` here is not a neutral
 * reference, it is an opaque rectangle laid over the user's text.
 *
 * The split is the same as every other scene in the project:
 *
 *   - **JSX owns the object.** The sphere's `position` below is Theatre's initial
 *     value, and the camera's framing is the orbit's framing.
 *   - **The exported state owns the motion.** `FloatScene.state.json` keyframes
 *     `position.xyz` (the circuit and the bob) and `rotation.y` (the spin).
 *
 * No `useSheetPlayback` call here, deliberately: on `/showcase` the scene owns the
 * clip and the page borrows it. Here the *page* owns playback — it loops the
 * circuit, it seeks the playhead when the sphere is tapped, and a scene component
 * that started the clip on its own would be a second owner of the same playhead.
 * `/rig/float` drives the same sheet from the bench.
 */
const sheet = getSheet(SHEET_IDS.float);

const sphere = FLOAT_NODES[0];

export default function FloatScene() {
  return (
    <SheetProvider sheet={sheet}>
      <TheatreCameraRig
        theatreKey="Float Camera"
        position={FLOAT_CAMERA.position}
        fov={FLOAT_CAMERA.fov}
      />

      {/** Lights shade the sphere; they paint nothing, so they are free to keep.
          The ambient floor is higher than the sting's because a sphere over a light
          page is lit by the page, and a single directional light leaves the side
          facing the reader a flat silhouette. */}
      <SceneLights
        theatreKey="MainLight"
        ambientIntensity={0.7}
        keyIntensity={1.3}
        keyPosition={[3, 5, 6]}
      />

      {sphere != null && <FloatSphere theatreKey={sphere.theatreKey} position={sphere.position} />}

      <SpawnedShapes />
    </SheetProvider>
  );
}

export type FloatSphereProps = {
  theatreKey: string;
  position: [number, number, number];
};

/**
 * The sphere itself.
 *
 * It writes its `theatreKey` into `useSceneStore` on pointer down and nothing
 * else — no callback prop, no store read beyond the highlight predicate. That is
 * the project's rule for the 2D ↔ 3D boundary: the mesh does not know a chat log
 * exists, the page does not know a mesh exists, and the store is the only channel
 * between them.
 *
 * The highlight predicate is shared with the rig benches, and this page states
 * `selectionVisuals: false`, so the sphere does not light up when tapped. It is
 * not rigging furniture on an end-user page; it is a thing you can hit.
 */
const PRESS_BLOCKING_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "select",
  "textarea",
  "summary",
  "[role='button']",
  ".float__bar",
  ".float__table",
].join(", ");

/**
 * Is this pointerdown a mesh press?
 *
 * The canvas is not a hit target — `eventSource` puts `pointer-events: none` on it and
 * moves R3F's listeners to the page root — so every pointerdown in the page also runs
 * this handler. Without a gate, a tap on the bar's "Replay" that happens to sit over
 * the sphere selects it, and this page logs a row per select, so the button would add
 * hits. The sphere crosses the full viewport width, so the gate is on controls, not on
 * gaps: a press is anything outside a button, a link, a form control, the bar and the
 * table. Tapping a paragraph the sphere is standing on presses the sphere, which is
 * exactly what a sphere in front of the page means. This is the inverse half of the
 * consequence documented in `FloatPage`'s header.
 */
function isMeshPressTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest(PRESS_BLOCKING_SELECTOR) == null;
}

/**
 * The DOM element the pointer actually landed on.
 *
 * Read it off `nativeEvent`, never off `event.target`: R3F replaces `target` on every
 * mesh event with a pointer-capture shim (`{ hasPointerCapture, setPointerCapture,
 * releasePointerCapture }`), and its type still says `EventTarget`, so
 * `event.target instanceof HTMLElement` is *always* false and compiles clean. A gate
 * written against `event.target` rejects every mesh press, silently, on every page.
 */
function pressDomTarget(event: ThreeEvent<PointerEvent>): EventTarget | null {
  return event.nativeEvent.target;
}

function FloatSphere({ theatreKey, position }: FloatSphereProps) {
  const isSelected = useSceneStore((state) =>
    showsSelectionHighlight(state.selectionVisuals, state.selectedNodeId, theatreKey),
  );
  const selectNode = useSceneStore((state) => state.selectNode);
  const hoverNode = useSceneStore((state) => state.hoverNode);

  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    // R3F raycasts the whole scene; without this the hit continues through to
    // every object behind the sphere and the last one wins.
    event.stopPropagation();
    if (!isMeshPressTarget(pressDomTarget(event))) return;
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
      <sphereGeometry args={[0.62, 48, 32]} />
      <meshStandardMaterial
        color={isSelected ? "#38bdf8" : "#a78bfa"}
        roughness={0.22}
        metalness={0.35}
        emissive={isSelected ? "#0ea5e9" : "#4c1d95"}
        emissiveIntensity={0.35}
      />
    </editable.mesh>
  );
}
