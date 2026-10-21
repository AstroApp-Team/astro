import { editable } from "@theatre/r3f";

import { SANDBOX_CAMERA, type Vec3 } from "@core/models/scene.ts";

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
  return (
    <editable.perspectiveCamera
      theatreKey={theatreKey}
      makeDefault
      position={position}
      fov={fov}
      near={0.1}
      far={200}
      {...(lookAt == null ? {} : { lookAt })}
    />
  );
}
