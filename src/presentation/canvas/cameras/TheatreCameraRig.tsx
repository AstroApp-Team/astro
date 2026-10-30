import { PerspectiveCamera } from "@react-three/drei";
import { editable } from "@theatre/r3f";
import { useEffect } from "react";

import { SANDBOX_CAMERA, type Vec3 } from "@core/models/scene.ts";
import { useShapeStore } from "@presentation/state/useShapeStore.ts";

/**
 * Theatre.js's own `editable.perspectiveCamera` wraps three's `PerspectiveCamera`,
 * which has no `makeDefault` — that prop is a drei/R3F convention. Passing it to
 * Theatre's component is accepted by the type and ignored at runtime, so the rig
 * is built, animated, and never used to render. Theatre says so at boot:
 * "This alone won't make r3f use it for rendering."
 *
 * The fix Theatre itself prescribes is to make drei's component editable, which
 * keeps `makeDefault` alive.
 */
const EditableCamera = editable(PerspectiveCamera, "perspectiveCamera");

/**
 * A Theatre.js-editable camera rig.
 *
 * `makeDefault` hands the camera to R3F as the render camera; `theatreKey` puts
 * it in the Studio outliner, where its position and fov become keyframeable
 * properties. That combination is what makes a camera move a *clip* rather than
 * a `useFrame` loop written by hand.
 *
 * `fov` is exposed because on a phone the vertical field of view is the thing
 * that decides whether a scene fits: the same rig on a 16:9 desktop and a 19.5:9
 * phone frames completely different amounts of the world.
 */
export type TheatreCameraRigProps = {
  theatreKey?: string;
  position?: Vec3;
  fov?: number;
  lookAt?: Vec3;
};

export function TheatreCameraRig({
  theatreKey = "Camera",
  position = SANDBOX_CAMERA.position,
  fov = SANDBOX_CAMERA.fov,
  lookAt,
}: TheatreCameraRigProps) {
  const setCameraKey = useShapeStore((state) => state.setCameraKey);
  const aimCount = useShapeStore((state) => state.aimCount);

  /**
   * Publish the key the "Aim Camera" tool rotates.
   *
   * The tool lives outside the canvas and cannot ask R3F which camera is
   * `makeDefault`. The rig writes its own `theatreKey` into the store, so the
   * tool aims the camera that is actually rendering — including a scene that
   * names it something other than `Camera`.
   */
  useEffect(() => {
    setCameraKey(theatreKey);
  }, [theatreKey, setCameraKey]);

  /**
   * `lookAt` and a keyframed rotation are the same prop with two owners.
   *
   * drei's `lookAt` recomputes the camera's quaternion on every render, so a
   * rotation written into Theatre's `rotation.xyz` is overwritten the next frame
   * — the aim lands, then snaps back. Once anyone has aimed, the JSX `lookAt`
   * steps aside and the rotation prop is Theatre's alone. A scene that wants a
   * hard-locked target should not also be aiming.
   */
  const useLookAt = lookAt != null && aimCount === 0;
  return (
    <EditableCamera
      theatreKey={theatreKey}
      makeDefault
      position={position}
      fov={fov}
      near={0.1}
      far={200}
      {...(useLookAt && lookAt != null ? { lookAt } : {})}
    />
  );
}
