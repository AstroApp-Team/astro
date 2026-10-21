import { SheetProvider } from "@theatre/r3f";

import type { SceneNode } from "@core/models/scene.ts";
import { SHEET_IDS, getSheet } from "@infra/theatre/project.ts";
import { TheatreCameraRig } from "@presentation/canvas/cameras/TheatreCameraRig.tsx";
import EditableNodePrefab from "@presentation/canvas/elements/EditableNodePrefab.tsx";
import { SceneLights } from "@presentation/canvas/elements/SceneLights.tsx";

/**
 * Archive: a grid of past work, browsed rather than played.
 *
 * The grid is generated, not hand-placed. A generated layout is the stress test
 * for the prefab: if the outliner is going to choke on a data-driven scene, it
 * chokes here first, and it is cheaper to find out in a scene nobody ships than
 * in the one that is the landing page.
 */
const COLUMNS = 3;
const ROWS = 2;
const SPACING = 3.2;

const NODES: SceneNode[] = Array.from({ length: COLUMNS * ROWS }, (_, index) => {
  const column = index % COLUMNS;
  const row = Math.floor(index / COLUMNS);

  return {
    theatreKey: `Archive-${String(index + 1).padStart(2, "0")}`,
    label: `Piece ${String(index + 1).padStart(2, "0")}`,
    status: row === 0 ? "archived" : "draft",
    position: [(column - 1) * SPACING, 0.5, (row - 0.5) * SPACING],
  } satisfies SceneNode;
});

export default function ArchiveScene() {
  return (
    <SheetProvider sheet={getSheet(SHEET_IDS.archive)}>
      <TheatreCameraRig theatreKey="Archive Camera" position={[0, 6, 10]} fov={55} />
      <SceneLights keyPosition={[0, 10, 8]} />
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
