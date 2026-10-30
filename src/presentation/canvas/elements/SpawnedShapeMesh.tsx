import { editable } from "@theatre/r3f";
import type { ThreeEvent } from "@react-three/fiber";
import { DoubleSide } from "three";

import type { SpawnedShape } from "@core/models/shapes.ts";
import { SHAPE_SPECS } from "@core/models/shapes.ts";
import { showsSelectionHighlight } from "@core/usecases/showcaseInteraction.ts";
import { useSceneStore } from "@presentation/state/useSceneStore.ts";

/**
 * One spawned shape, as a Theatre.js editable object.
 *
 * `editable.mesh` is the whole requirement: the moment this mounts, Theatre
 * registers `theatreKey` on the current `SheetProvider`'s sheet with props
 * `position.xyz`, `rotation.xyz`, `scale.xyz`, and the row shows up in the
 * Studio outliner with a stopwatch on every one of them. Nothing here keyframes
 * anything — spawning makes the shape *keyframeable*, which is the split this
 * rig already lives by (code owns the object, the Studio owns the motion).
 *
 * The JSX `position`/`rotation`/`scale` are Theatre's **initial values**, not a
 * standing truth: a keyframed prop overrides them, exactly like every other
 * editable in this project.
 */
export default function SpawnedShapeMesh({ shape }: { shape: SpawnedShape }) {
  const spec = SHAPE_SPECS[shape.kind];
  /**
   * Drawn-as-selected, not selected — same split as in `EditableNodePrefab`.
   *
   * The pointer handler below still writes the selection on pointer down, and on
   * `/showcase` that write is the feature. What the flag suppresses is the colour
   * change, so a tappable sphere on an end-user page does not light up like a
   * rigging target.
   */
  const isSelected = useSceneStore((state) =>
    showsSelectionHighlight(state.selectionVisuals, state.selectedNodeId, shape.theatreKey),
  );
  const selectNode = useSceneStore((state) => state.selectNode);
  const hoverNode = useSceneStore((state) => state.hoverNode);

  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    // R3F raycasts the whole scene; without this a click on a shape also hits
    // everything behind it, and the selection lands on the last thing hit.
    event.stopPropagation();
    selectNode(shape.theatreKey);
  };

  return (
    <editable.mesh
      theatreKey={shape.theatreKey}
      position={shape.position}
      rotation={shape.rotation}
      scale={shape.scale}
      onPointerDown={handlePointerDown}
      onPointerOver={() => hoverNode(shape.theatreKey)}
      onPointerOut={() => hoverNode(null)}
    >
      {shapeGeometry(shape)}
      <meshStandardMaterial
        color={isSelected ? "#38bdf8" : "#818cf8"}
        roughness={0.35}
        metalness={0.2}
        /* Flat shapes are single triangles' worth of quads. Without DoubleSide a
           camera that drops below the grid sees nothing at all — an invisible
           object with a live outliner row is the worst possible failure mode.
           Spread, not `side={cond ? DoubleSide : undefined}`: with
           `exactOptionalPropertyTypes`, passing `undefined` to an optional prop
           is a type error, not a way to leave it alone. */
        {...(spec.flat ? { side: DoubleSide } : {})}
      />
    </editable.mesh>
  );
}

/**
 * The geometry switch.
 *
 * `args` come straight from `SHAPE_SPECS`, so a shape added to the catalogue in
 * `core/` is spawnable, renderable and keyframeable without touching this file —
 * the only thing that would break is a `geometry` name this switch has never
 * heard of, and that is a compile error, not a black mesh.
 */
function shapeGeometry(shape: SpawnedShape) {
  const { geometry, args } = SHAPE_SPECS[shape.kind];

  switch (geometry) {
    case "box":
      return <boxGeometry args={[args[0] ?? 1, args[1] ?? 1, args[2] ?? 1]} />;
    case "sphere":
      return <sphereGeometry args={[args[0] ?? 0.7, args[1] ?? 32, args[2] ?? 16]} />;
    case "plane":
      return <planeGeometry args={[args[0] ?? 1, args[1] ?? 1]} />;
    case "circle":
      return <circleGeometry args={[args[0] ?? 0.8, args[1] ?? 48]} />;
  }
}
