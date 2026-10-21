import { Html } from "@react-three/drei";
import { editable } from "@theatre/r3f";
import type { ThreeEvent } from "@react-three/fiber";

import type { Vec3 } from "@core/models/scene.ts";
import { useSceneStore } from "@presentation/state/useSceneStore.ts";

/**
 * The reusable 3D + HTML prefab.
 *
 * The point of the wrapper is that the mesh and the `<Html>` card are *children*
 * of one `editable.group`. Theatre.js animates the group's transform, drei's
 * `Html` re-projects the child's world position every frame, and so a keyframed
 * position, a dragged group and a played sequence move the geometry and its
 * label together — which is the whole reason this is a prefab and not two
 * components kept in sync by hand.
 *
 * `theatreKey` doubles as the node id in `useSceneStore`. One string, so the
 * outliner entry, the raycast target and the toolbar readout cannot drift apart.
 */
export type EditableNodePrefabProps = {
  theatreKey: string;
  label: string;
  status: string;
  position?: Vec3;
  onSelect?: () => void;
};

export default function EditableNodePrefab({
  theatreKey,
  label,
  status,
  position = [0, 0, 0],
  onSelect,
}: EditableNodePrefabProps) {
  const isSelected = useSceneStore((state) => state.selectedNodeId === theatreKey);
  const selectNode = useSceneStore((state) => state.selectNode);
  const hoverNode = useSceneStore((state) => state.hoverNode);

  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    // Without this, a click that hits a prefab also hits everything behind it:
    // R3F raycasts the whole scene and every intersected object gets the event.
    event.stopPropagation();
    selectNode(theatreKey);
    onSelect?.();
  };

  return (
    <editable.group
      theatreKey={theatreKey}
      position={position}
      onPointerDown={handlePointerDown}
      onPointerOver={() => hoverNode(theatreKey)}
      onPointerOut={() => hoverNode(null)}
    >
      <mesh castShadow>
        <boxGeometry args={[1.4, 1.4, 1.4]} />
        <meshStandardMaterial
          color={isSelected ? "#38bdf8" : status === "active" ? "#818cf8" : "#64748b"}
          roughness={0.35}
          metalness={0.25}
        />
      </mesh>

      {/**
       * `center` anchors the card on its own centre rather than its top-left, so
       * it stays over the cube as the camera orbits. `zIndexRange` keeps it under
       * the Studio Corner's toolbar (z-index 50) and above the canvas.
       */}
      <Html position={[0, 1.35, 0]} center zIndexRange={[20, 0]} className="node-card-wrapper">
        <div className={`node-card${isSelected ? " node-card--selected" : ""}`}>
          <strong>{label}</strong>
          <span>{status}</span>
        </div>
      </Html>
    </editable.group>
  );
}
