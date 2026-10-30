import SpawnedShapeMesh from "@presentation/canvas/elements/SpawnedShapeMesh.tsx";
import { useShapeStore } from "@presentation/state/useShapeStore.ts";

/**
 * Everything the "Add Shape" menu has spawned.
 *
 * Mount this **inside** a `<SheetProvider>` — `editable.mesh` resolves its sheet
 * out of that context, and outside one it has nowhere to register.
 *
 * The store is the only input. The Studio toolbar writes to `useShapeStore`,
 * this reads it, and that is the entire 2D → 3D path: the extension never
 * touches a mesh, the mesh never touches the toolbar. It is also why the shapes
 * survive a Studio panel that opens, hides and restores — the toolbar is a
 * consumer of the store, not the owner of the scene.
 */
export function SpawnedShapes() {
  const shapes = useShapeStore((state) => state.shapes);

  return shapes.map((shape) => <SpawnedShapeMesh key={shape.id} shape={shape} />);
}
