import { useCurrentSheet } from "@theatre/r3f";

import SpawnedShapeMesh from "@presentation/canvas/elements/SpawnedShapeMesh.tsx";
import { EMPTY_SHAPES, useShapeStore } from "@presentation/state/useShapeStore.ts";

/**
 * Everything "Add Shape" has spawned **for the sheet this component is mounted
 * in**.
 *
 * Mount this **inside** a `<SheetProvider>` — `editable.mesh` resolves its sheet
 * out of that context, and outside one it has nowhere to register. The same
 * context is what selects the bucket to render: `useCurrentSheet()` reads the
 * provider this tree sits under, and the store's `shapes` are keyed by sheet id.
 * That is the whole per-scene fix — a shape saved for `SurfaceScene` is a bucket
 * no other scene's provider ever asks for.
 *
 * The store is still the only input. The Studio toolbar writes to `useShapeStore`,
 * this reads it, and that is the entire 2D → 3D path: the extension never
 * touches a mesh, the mesh never touches the toolbar. It is also why the shapes
 * survive a Studio panel that opens, hides and restores — the toolbar is a
 * consumer of the store, not the owner of the scene.
 *
 * Outside any provider (a mount mistake) there is no sheet to ask for, and the
 * component renders nothing rather than every bucket at once — the old bug, as a
 * no-op, instead of a flood.
 */
export function SpawnedShapes() {
  const sheet = useCurrentSheet();
  const shapes = useShapeStore((state) =>
    sheet == null ? EMPTY_SHAPES : (state.shapes[sheet.address.sheetId] ?? EMPTY_SHAPES),
  );

  return shapes.map((shape) => <SpawnedShapeMesh key={shape.id} shape={shape} />);
}
