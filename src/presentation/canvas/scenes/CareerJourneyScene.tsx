import { SheetProvider } from "@theatre/r3f";

import type { SceneNode } from "@core/models/scene.ts";
import { SHEET_IDS, getSheet } from "@infra/theatre/project.ts";
import { TheatreCameraRig } from "@presentation/canvas/cameras/TheatreCameraRig.tsx";
import EditableNodePrefab from "@presentation/canvas/elements/EditableNodePrefab.tsx";
import { SceneLights } from "@presentation/canvas/elements/SceneLights.tsx";

/**
 * Career journey: a path walked left to right, the one scene meant to be
 * *played* rather than orbited.
 *
 * The nodes are evenly spaced on a line so a camera fly-through is a single
 * position track with a handful of keyframes — the shape Theatre.js is good at
 * and `useFrame` is not.
 */
const NODES: SceneNode[] = [
  { theatreKey: "Journey-Start", label: "Start", status: "done", position: [-6, 0.6, 0] },
  { theatreKey: "Journey-Ship", label: "Shipping", status: "done", position: [-2, 0.6, 0] },
  { theatreKey: "Journey-Lead", label: "Leading", status: "active", position: [2, 0.6, 0] },
  { theatreKey: "Journey-Next", label: "Next", status: "open", position: [6, 0.6, 0] },
];

export default function CareerJourneyScene() {
  return (
    <SheetProvider sheet={getSheet(SHEET_IDS.careerJourney)}>
      <TheatreCameraRig theatreKey="Journey Camera" position={[-8, 3, 8]} fov={55} />
      <SceneLights keyPosition={[-6, 8, 6]} />
      <gridHelper args={[30, 16, "#334155", "#1e293b"]} />
      {NODES.map((node) => (
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
