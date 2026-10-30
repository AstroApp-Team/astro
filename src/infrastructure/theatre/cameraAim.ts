import { Euler, Matrix4, Quaternion, Vector3 } from "three";

import type { Vec3 } from "@core/models/scene.ts";

/**
 * The math behind "Aim Camera".
 *
 * Why it is written with `Matrix4.lookAt` and not with `Math.atan2`:
 *
 * `@theatre/r3f`'s editable props for a camera are `position.xyz`,
 * `rotation.xyz`, `scale.xyz`, `near`, `far`, `fov`, `zoom`, and the `rotation`
 * prop is applied as `object.rotation.set(x, y, z)` — a three `Euler` in the
 * object's **own** order, which for a fresh `Object3D` is `"XYZ"`. So the
 * numbers written into Theatre's `rotation.x/y/z` must be the XYZ-Euler of the
 * desired orientation, not the yaw/pitch a human would write by hand.
 *
 * Hand-rolled yaw/pitch (`atan2(-dx, -dz)`, `asin(dy/len)`) is the **YXZ**
 * decomposition. It agrees with XYZ only when one of the two is zero, so it
 * looks correct on a level shot and quietly tilts the frame the moment the
 * camera is both pitched and yawed — the classic "aim worked in the sandbox,
 * broke on the rig" bug. Going through `Matrix4.lookAt` → `Quaternion` →
 * `Euler(…, 'XYZ')` is the same computation three itself runs inside
 * `Object3D.lookAt()` for a camera, so the value we hand Theatre is the value
 * the camera would have if we called `lookAt()` on it.
 *
 * `three` is imported here on purpose: this file is a canvas concern. `core/`
 * stays free of it, which is why the vectors in and out are plain tuples.
 */
export type AimSolution = {
  /** Euler in the order three applies it (`XYZ`), radians. Keyframe this. */
  euler: Vec3;
  /** The same orientation as a quaternion, for anyone interpolating. */
  quaternion: [x: number, y: number, z: number, w: number];
  /** Camera→target distance, metres. Useful for picking `fov` and `near`. */
  distance: number;
};

const UP: Vec3 = [0, 1, 0];

/** Reused scratch objects: this runs on a button click, not per frame. */
const eye = new Vector3();
const target = new Vector3();
const up = new Vector3();
const matrix = new Matrix4();
const quaternion = new Quaternion();
const euler = new Euler();

/**
 * The orientation that puts the camera's `-Z` axis on the target.
 *
 * Returns `null` for the two cases that have no answer, rather than a
 * half-rotation that reads as a bug:
 *
 *   - camera and target in the same place (no direction to look),
 *   - a non-finite coordinate (a NaN that came from a prop nobody keyframed).
 *
 * The degenerate "target straight above the camera" case *is* handled: three's
 * `lookAt` nudges the basis when `up` is parallel to the view direction, and
 * the result is a valid orientation, so it is a solution, not a failure.
 */
export function computeAim(from: Vec3, to: Vec3, viewUp: Vec3 = UP): AimSolution | null {
  if (![...from, ...to, ...viewUp].every((n) => Number.isFinite(n))) {
    return null;
  }

  eye.set(from[0], from[1], from[2]);
  target.set(to[0], to[1], to[2]);
  up.set(viewUp[0], viewUp[1], viewUp[2]);

  const distance = eye.distanceTo(target);
  if (distance < 1e-6) return null;

  // Same call three's Object3D.lookAt() makes for `isCamera` objects: the
  // camera looks down -Z, so the basis is built eye→target, not target→eye.
  matrix.lookAt(eye, target, up);
  quaternion.setFromRotationMatrix(matrix);
  euler.setFromQuaternion(quaternion, "XYZ");

  return {
    euler: [euler.x, euler.y, euler.z],
    quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
    distance,
  };
}

/**
 * The camera's forward vector for a given Euler — `(0, 0, -1)` rotated by it.
 *
 * This is the assertion a test writes: apply the Euler, read the direction, and
 * check it lands on the target. It is also the one-liner that explains a shot
 * that aims at the sky.
 */
export function forwardFor(eulerAngles: Vec3): Vec3 {
  euler.set(eulerAngles[0], eulerAngles[1], eulerAngles[2], "XYZ");
  quaternion.setFromEuler(euler);
  return new Vector3(0, 0, -1).applyQuaternion(quaternion).toArray() as Vec3;
}

/** Radians → degrees, rounded for the Studio readout. */
export function eulerToDegrees(eulerAngles: Vec3): Vec3 {
  const toDeg = (rad: number): number => Math.round(((rad * 180) / Math.PI) * 100) / 100;
  return [toDeg(eulerAngles[0]), toDeg(eulerAngles[1]), toDeg(eulerAngles[2])];
}

/**
 * A `lookAt`-style target expressed as an orbit: keep the camera at `radius`
 * from the target, at a given azimuth and elevation.
 *
 * The Studio workflow wants a *position* and a *rotation* pair — a camera that
 * is `n` metres out on the same heading is a shot you can keyframe as a dolly,
 * while a rotation alone moves the frame without moving the rig.
 */
export function orbitPositionFor(
  target: Vec3,
  radius: number,
  azimuthDeg: number,
  elevationDeg: number,
): Vec3 {
  const azimuth = (azimuthDeg * Math.PI) / 180;
  const elevation = (elevationDeg * Math.PI) / 180;
  const horizontal = radius * Math.cos(elevation);
  return [
    target[0] + horizontal * Math.sin(azimuth),
    target[1] + radius * Math.sin(elevation),
    target[2] + horizontal * Math.cos(azimuth),
  ];
}
