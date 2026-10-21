import { SheetProvider } from "@theatre/r3f";

import type { SceneNode } from "@core/models/scene.ts";
import { SHEET_IDS, getSheet } from "@infra/theatre/project.ts";
import { TheatreCameraRig } from "@presentation/canvas/cameras/TheatreCameraRig.tsx";
import EditableNodePrefab from "@presentation/canvas/elements/EditableNodePrefab.tsx";
import { SceneLights } from "@presentation/canvas/elements/SceneLights.tsx";

/**
 * The landing scene: the entry hall the app opens on.
 *
 * Every scene has the same shape — a `SheetProvider` bound to its own Theatre.js
 * sheet, an editable camera rig, editable lights, and a data-driven array of
 * prefabs. Keeping the shape identical is what lets a scene be lifted into the
 * Studio Corner for rigging and moved back unchanged.
 *
 * The node array is data, not JSX: whatever is mapped here shows up in the Studio
 * outliner as editable objects, so rigging a scene is a timeline edit and a data
 * edit, not a code edit.
 */
const NODES: SceneNode[] = [
  { theatreKey: "Hub-Entry", label: "Entry", status: "active", position: [0, 0.7, 0] },
  { theatreKey: "Hub-Voice", label: "Voice", status: "idle", position: [-3, 0.7, -1.5] },
  { theatreKey: "Hub-Archive", label: "Archive", status: "idle", position: [3, 0.7, -1.5] },
];

export default function HubScene() {
  return (
    <SheetProvider sheet={getSheet(SHEET_IDS.hub)}>
      <TheatreCameraRig theatreKey="Hub Camera" position={[0, 4, 9]} fov={55} />
      <SceneLights />
      <gridHelper args={[24, 24, "#334155", "#1e293b"]} />
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
