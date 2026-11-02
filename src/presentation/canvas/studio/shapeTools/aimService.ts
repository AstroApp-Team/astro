import type { ISheet } from "@theatre/core";
import type { IStudio } from "@theatre/studio";

import type { Vec3 } from "@core/models/scene.ts";
import { computeAim } from "@infra/theatre/cameraAim.ts";
import { getSheet } from "@infra/theatre/project.ts";
import { useSceneStore } from "@presentation/state/useSceneStore.ts";
import { useShapeStore, type AimRecord } from "@presentation/state/useShapeStore.ts";

/**
 * "Aim Camera", end to end.
 *
 * The whole feature is a read and a write on Theatre's own data:
 *
 *   read  `sheet.__experimental_getExistingObject(cameraKey).value.position`
 *   math  `computeAim(from, to)` → Euler in three's `XYZ` order
 *   write `studio.transaction(({set}) => set(camera.props.rotation, {x, y, z}))`
 *
 * Nothing reaches into the R3F tree, and that is the point. The camera in this
 * project is `editable(PerspectiveCamera, "perspectiveCamera")`, so its
 * transform is *owned by Theatre*: the editable proxy applies `rotation.xyz`
 * from Theatre's values every frame. Set `camera.rotation` behind Theatre's back
 * and the next value change overwrites it — the move looks like it took, then
 * snaps back. Writing through `studio.transaction()` is the only write that
 * sticks, and it is undoable, and it is what the Studio's own TransformControls
 * do (`scrub.capture(({set}) => set(sheetObject.props.rotation, {...}))`).
 *
 * And the keyframing comes free. From Theatre's own `ITransactionAPI.set` docs:
 *
 *   "Set the value of a prop by its pointer. **If the prop is sequenced, the
 *   value will be a keyframe at the current sequence position.**"
 *
 * So: park the playhead where you want the new angle and click — `rotation`
 * already has a clip and this lands as a keyframe on it. `rotation` is static
 * and this lands as a static override, and the stopwatch on the prop turns it
 * into a clip with this value as the first key. Same call, both cases.
 */

/**
 * The prop shape a camera registered by `editable.perspectiveCamera` has.
 *
 * Declaring only `position` and `rotation` is deliberate: `set()` is typed off
 * this shape, so `props.rotations` is a compile error rather than a silent no-op
 * on a prop Theatre never had.
 */
type CameraProps = {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
};

/**
 * The structural slice of a Theatre sheet object this module reads.
 *
 * Structural on purpose. `ISheetObject<P>` types `value` off the prop config the
 * object was created with, and those prop-config generics do not widen: an
 * `ISheetObject<{position: …}>` is not an `ISheetObject<{fov: number}>`, so a
 * helper typed against one of them can only be called on objects created with
 * exactly that config. Matching the two members actually touched — `value` and
 * `address.objectKey` — lets one reader take a light, a group, a mesh or a
 * camera, with no cast in the body.
 */
type TheatreObject = {
  readonly type: "Theatre_SheetObject_PublicAPI";
  readonly value: unknown;
  readonly address: { readonly objectKey: string };
};

export type AimOutcome =
  | { ok: true; record: AimRecord }
  /** `reason` is user-facing: it goes straight to the toolbar readout. */
  | { ok: false; reason: string };

/**
 * A Theatre object's `position` as a tuple.
 *
 * Read defensively, because `__experimental_getExistingObject` hands back
 * whatever is registered under a key — an `ambientLight` has `{intensity,
 * color}` and no position at all. Pretending otherwise writes `undefined` into a
 * camera prop, and the camera lands at NaN with a live outliner row.
 */
export function readObjectPosition(object: TheatreObject | undefined): Vec3 | null {
  if (object == null) return null;

  const value: unknown = object.value;
  if (typeof value !== "object" || value === null) return null;

  const position: unknown = (value as { position?: unknown }).position;
  if (typeof position !== "object" || position === null) return null;

  const { x, y, z } = position as { x: unknown; y: unknown; z: unknown };
  if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;

  return [x, y, z];
}

/** Every object in the Studio's current selection, sheets dropped. */
function selectedObjects(studio: IStudio): TheatreObject[] {
  return studio.selection.filter(
    (item): item is Extract<typeof item, { type: "Theatre_SheetObject_PublicAPI" }> =>
      item.type === "Theatre_SheetObject_PublicAPI",
  );
}

/**
 * What to aim at, in priority order.
 *
 * 1. an explicit `theatreKey` (the palette pane's row, a menu pick),
 * 2. the Studio's own selection — the row the user just clicked in the outliner,
 * 3. the canvas selection — the prefab the user just clicked in the viewport,
 *    which is the same string because `theatreKey` is the node id in
 *    `useSceneStore`,
 * 4. `useSceneStore.cameraTarget`, a raw coordinate.
 *
 * Each step is a real thing a user can point at, and the last one is the only
 * one that works with an empty scene.
 */
function resolveTarget(
  studio: IStudio,
  sheet: ISheet,
  cameraKey: string,
  explicitKey: string | null,
): { key: string | null; position: Vec3 } | null {
  if (explicitKey != null && explicitKey !== cameraKey) {
    const position = readObjectPosition(sheet.__experimental_getExistingObject(explicitKey));
    if (position != null) return { key: explicitKey, position };
  }

  for (const object of selectedObjects(studio)) {
    if (object.address.objectKey === cameraKey) continue;
    const position = readObjectPosition(object);
    if (position != null) return { key: object.address.objectKey, position };
  }

  const canvasKey = useSceneStore.getState().selectedNodeId;
  if (canvasKey != null && canvasKey !== cameraKey) {
    const position = readObjectPosition(sheet.__experimental_getExistingObject(canvasKey));
    if (position != null) return { key: canvasKey, position };
  }

  return { key: null, position: useSceneStore.getState().cameraTarget };
}

/**
 * Rotate the sheet's camera so its `-Z` axis points at the target.
 *
 * `targetKey: null` means "resolve it myself" — see `resolveTarget`.
 */
export function aimCameraAt(studio: IStudio, targetKey: string | null = null): AimOutcome {
  const { sheetId, cameraKey } = useShapeStore.getState();
  const sheet = getSheet(sheetId);

  const camera = sheet.__experimental_getExistingObject<CameraProps>(cameraKey);
  if (camera == null) {
    return {
      ok: false,
      reason: `"${cameraKey}" is not in sheet "${sheetId}". Check the camera's theatreKey, and that this route mounts it.`,
    };
  }

  const from = readObjectPosition(camera);
  if (from == null) {
    return { ok: false, reason: `"${cameraKey}" has no numeric position prop to rotate from.` };
  }

  const target = resolveTarget(studio, sheet, cameraKey, targetKey);
  if (target == null) {
    return { ok: false, reason: "Nothing to aim at: the scene has no positioned object." };
  }

  const solution = computeAim(from, target.position);
  if (solution == null) {
    return {
      ok: false,
      reason: `Camera and target are in the same place — there is no direction to look.`,
    };
  }

  const [x, y, z] = solution.euler;

  studio.transaction(({ set }) => {
    set(camera.props.rotation, { x, y, z });
  });

  // Select the camera so the new numbers are the ones on screen. Without this the
  // user clicks "Aim Camera", the camera moves, and the prop panel still shows
  // whatever row was selected before — which reads as the button doing nothing.
  studio.setSelection([camera]);

  const record: AimRecord = {
    at: Date.now(),
    sheetId,
    cameraKey,
    targetKey: target.key,
    from,
    to: target.position,
    euler: solution.euler,
    distance: solution.distance,
  };

  useShapeStore.getState().recordAim(record);

  return { ok: true, record };
}

/**
 * Aim at a shape the menu spawned, by its id.
 *
 * The palette pane's per-row button: "look at the thing I just made".
 */
export function aimCameraAtShapeId(studio: IStudio, shapeId: string): AimOutcome {
  // Shapes are partitioned by sheet, and the id is global (its ordinal is), so
  // the search is a pass over every bucket.
  const shapes = useShapeStore.getState().shapes;
  const shape =
    Object.values(shapes)
      .flatMap((entries) => entries)
      .find((candidate) => candidate.id === shapeId) ?? null;

  if (shape == null) {
    return { ok: false, reason: `No spawned shape with id "${shapeId}".` };
  }

  return aimCameraAt(studio, shape.theatreKey);
}

/**
 * Put the camera's rotation back to identity.
 *
 * A rigging tool needs an escape hatch: aiming is a rotation, and a rotation
 * written at the playhead is a keyframe on a clip you are about to scrub. This is
 * the undo that does not require the user to find the keyframe first.
 */
export function resetCameraRotation(studio: IStudio): AimOutcome {
  const { sheetId, cameraKey } = useShapeStore.getState();
  const sheet = getSheet(sheetId);
  const camera = sheet.__experimental_getExistingObject<CameraProps>(cameraKey);

  if (camera == null) {
    return { ok: false, reason: `"${cameraKey}" is not in sheet "${sheetId}".` };
  }

  const from = readObjectPosition(camera);
  if (from == null) {
    return { ok: false, reason: `"${cameraKey}" has no numeric position prop.` };
  }

  studio.transaction(({ set }) => {
    set(camera.props.rotation, { x: 0, y: 0, z: 0 });
  });
  studio.setSelection([camera]);

  const record: AimRecord = {
    at: Date.now(),
    sheetId,
    cameraKey,
    targetKey: null,
    from,
    to: from,
    euler: [0, 0, 0],
    distance: 0,
  };

  useShapeStore.getState().recordAim(record);

  return { ok: true, record };
}
