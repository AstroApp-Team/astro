import { SheetProvider } from "@theatre/r3f";

import { SANDBOX_NODES } from "@core/models/scene.ts";
import { studioSheet } from "@infra/theatre/project.ts";
import { TheatreCameraRig } from "@presentation/canvas/cameras/TheatreCameraRig.tsx";
import EditableNodePrefab from "@presentation/canvas/elements/EditableNodePrefab.tsx";
import { SceneLights } from "@presentation/canvas/elements/SceneLights.tsx";
import { useSceneStore } from "@presentation/state/useSceneStore.ts";

/**
 * The Studio Corner's sandbox.
 *
 * Isolated on purpose: it has its own sheet (`StudioSandbox`), so a clip rigged
 * here cannot touch a production scene's timeline, and a scene rigged here can be
 * copied into `scenes/` with only the sheet id changed.
 *
 * The three prefabs come from `SANDBOX_NODES` in the domain model, not from
 * hand-written JSX. That is the demonstration: a data-driven array populates the
 * Studio outliner with three editable objects, so the rigging surface scales
 * with the data and not with the number of components someone writes.
 */
export default function StudioSandboxScene() {
  const emit = useSceneStore((state) => state.emit);

  return (
    <SheetProvider sheet={studioSheet}>
      {/** An explicit scene background. The stage div behind the canvas is the
          same near-black as this one, so "the canvas is painting" and "the canvas
          is a black rectangle" are otherwise the same picture — and a 0-height
          canvas is invisible, not black. This makes the two distinguishable. */}
      <color attach="background" args={["#141b2d"]} />

      <TheatreCameraRig theatreKey="Camera" position={[0, 5, 10]} fov={50} />

      <SceneLights theatreKey="MainLight" ambientIntensity={0.7} keyPosition={[5, 8, 6]} />

      {/** Spatial reference: 1 unit per cell, so a position keyframe read in the
          Studio is a distance you can eyeball. */}
      <gridHelper args={[20, 20, "#475569", "#1e293b"]} />
      <axesHelper args={[3]} />

      {SANDBOX_NODES.map((node) => (
        <EditableNodePrefab
          key={node.theatreKey}
          theatreKey={node.theatreKey}
          label={node.label}
          status={node.status}
          position={node.position}
          onSelect={() => {
            // The prefab already wrote `selectedNodeId`; this is the second hop,
            // the 3D → 2D one. The toolbar readout below renders it, so a click
            // that selects a cube and does not move the readout is a broken
            // bridge, not a broken renderer.
            emit("node-focus-requested", node.theatreKey);
          }}
        />
      ))}
    </SheetProvider>
  );
}
