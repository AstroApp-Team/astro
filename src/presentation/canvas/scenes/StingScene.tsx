import { SheetProvider } from "@theatre/r3f";

import { STING_AUTOPLAY, STING_CAMERA, STING_NODES } from "@core/models/scene.ts";
import { SHEET_IDS, getSheet } from "@infra/theatre/project.ts";
import { useSheetPlayback } from "@infra/theatre/useSheetPlayback.ts";
import { TheatreCameraRig } from "@presentation/canvas/cameras/TheatreCameraRig.tsx";
import EditableNodePrefab from "@presentation/canvas/elements/EditableNodePrefab.tsx";
import { SceneLights } from "@presentation/canvas/elements/SceneLights.tsx";

/**
 * The example rig: a four-second sting, rigged in the Studio and shipped as
 * exported state. This file is the template to copy for a new scene.
 *
 * The split that makes the Studio workflow work:
 *
 *   - **JSX owns the layout.** Each prefab's `position` here is its *final* x/z
 *     on the ring, and the camera's `position`/`fov` here are the starting
 *     framing. Those are Theatre's initial values for those props.
 *   - **The exported state owns the motion.** `StingScene.state.json` keyframes
 *     `position.y`, `scale`, `rotation.y`, the camera's arc and the light's
 *     intensity. A keyframed prop overrides the initial value; an unkeyframed
 *     one falls through to the JSX.
 *
 * So a prop must be owned by exactly one side. Keyframe `position.x` in the
 * Studio *and* move the node in `STING_NODES` and the data edit silently stops
 * mattering — the clip wins, and nothing warns you.
 *
 * To rig your own: copy this file, copy the `SHEET_IDS` entry, copy the
 * `STING_NODES`-shaped array, then rig `/rig/your-scene` in the Studio.
 */
const sheet = getSheet(SHEET_IDS.sting);

export default function StingScene() {
  useSheetPlayback(sheet, STING_AUTOPLAY);

  return (
    <SheetProvider sheet={sheet}>
      <TheatreCameraRig
        theatreKey="Sting Camera"
        position={STING_CAMERA.position}
        fov={STING_CAMERA.fov}
      />

      <SceneLights theatreKey="MainLight" keyPosition={[6, 9, 5]} />

      {/** The floor the rise lands on. `gridHelper` is not editable — it is a
          reference, and putting a reference in the outliner is how it ends up
          keyframed by accident. */}
      <gridHelper args={[20, 20, "#334155", "#1e293b"]} />

      {STING_NODES.map((node) => (
        <EditableNodePrefab
          key={node.theatreKey}
          theatreKey={node.theatreKey}
          label={node.label}
          status={node.status}
          position={node.position}
        />
      ))}
    </SheetProvider>
  );
}
