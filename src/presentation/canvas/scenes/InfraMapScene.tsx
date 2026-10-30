import { SheetProvider } from "@theatre/r3f";

import type { SceneNode } from "@core/models/scene.ts";
import { SHEET_IDS, getSheet } from "@infra/theatre/project.ts";
import { TheatreCameraRig } from "@presentation/canvas/cameras/TheatreCameraRig.tsx";
import EditableNodePrefab from "@presentation/canvas/elements/EditableNodePrefab.tsx";
import { SceneLights } from "@presentation/canvas/elements/SceneLights.tsx";
import { SpawnedShapes } from "@presentation/canvas/elements/SpawnedShapes.tsx";

/**
 * Infrastructure map: services laid out as a floor plan, read from above.
 *
 * The camera looks down at a shallow angle rather than straight down, so the
 * cards stay legible — a pure top-down camera turns every `<Html>` label into a
 * trapezoid.
 */
const NODES: SceneNode[] = [
  { theatreKey: "Infra-Worker", label: "Worker", status: "active", position: [-4, 0.5, -2] },
  { theatreKey: "Infra-D1", label: "D1", status: "active", position: [0, 0.5, 0] },
  { theatreKey: "Infra-Gateway", label: "AI Gateway", status: "idle", position: [4, 0.5, -2] },
  { theatreKey: "Infra-Realtime", label: "Realtime", status: "active", position: [0, 0.5, 3] },
];

export default function InfraMapScene() {
  return (
    <SheetProvider sheet={getSheet(SHEET_IDS.infraMap)}>
      <TheatreCameraRig theatreKey="InfraMap Camera" position={[0, 9, 11]} fov={50} />
      <SceneLights keyPosition={[4, 12, 6]} />
      <gridHelper args={[28, 28, "#334155", "#1e293b"]} />
      {NODES.map((node) => (
        <EditableNodePrefab
          key={node.theatreKey}
          theatreKey={node.theatreKey}
          label={node.label}
          status={node.status}
          position={node.position}
        />
      ))}

      {/** Shapes spawned by the Studio's "Add Shape" tool. Inside the
          SheetProvider on purpose: `editable.mesh` resolves its sheet out of
          that context, so mounted outside it there is nothing to register into,
          and the spawn silently produces a store entry and no object. */}
      <SpawnedShapes />
    </SheetProvider>
  );
}
