import { describe, expect, it } from "vite-plus/test";
import { Object3D, Vector3 } from "three";

import {
  computeAim,
  eulerToDegrees,
  forwardFor,
  orbitPositionFor,
} from "@infra/theatre/cameraAim.ts";

import type { Vec3 } from "@core/models/scene.ts";

/**
 * The contract "Aim Camera" has to keep: after the Euler we hand Theatre is put
 * on a camera, the camera's `-Z` axis passes through the target.
 *
 * The check is done with a real `Object3D`, not with the helper's own
 * `forwardFor`, on purpose. `@theatre/r3f` applies the `rotation` prop as
 * `object.rotation.set(x, y, z)` — a three `Euler` in the object's own order,
 * `"XYZ"` — so the only assertion that predicts what the app does is one that
 * goes through `Object3D`. A test that only uses `forwardFor` would pass even if
 * the helper returned a `YXZ` decomposition, because both use the same order.
 * That is the bug this file exists to catch.
 */
function forwardOf(from: Vec3, eulerAngles: Vec3): Vector3 {
  const node = new Object3D();
  node.position.set(from[0], from[1], from[2]);
  node.rotation.set(eulerAngles[0], eulerAngles[1], eulerAngles[2]);
  node.updateMatrixWorld();
  return new Vector3(0, 0, -1).transformDirection(node.matrixWorld);
}

/** How far a given Euler points from a given target, in radians. */
function angleBetween(from: Vec3, eulerAngles: Vec3, to: Vec3): number {
  const forward = forwardOf(from, eulerAngles);
  const desired = new Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]).normalize();
  return forward.angleTo(desired);
}

/** How far `computeAim`'s answer points from the target it was asked for. */
function aimError(from: Vec3, to: Vec3): number {
  const solution = computeAim(from, to);
  if (solution == null) return Number.NaN;
  return angleBetween(from, solution.euler, to);
}

describe("computeAim", () => {
  it("points the camera's -Z at the target for a level shot", () => {
    const solution = computeAim([0, 2, 10], [0, 0, 0]);
    expect(solution).not.toBeNull();
    expect(aimError([0, 2, 10], [0, 0, 0])).toBeLessThan(1e-9);
  });

  it("points at the target for a yawed-and-pitched shot, where hand-rolled yaw/pitch does not", () => {
    // The shot the naive formula gets wrong: pitched *and* yawed at once.
    // `atan2(-dx, -dz)` + `asin(dy/len)` is a YXZ decomposition; three applies
    // XYZ, and the two disagree as soon as both angles are non-zero.
    const from: Vec3 = [4.5, 6.25, 11.75];
    const to: Vec3 = [-2.5, 1.2, -3.4];

    expect(aimError(from, to)).toBeLessThan(1e-9);
  });

  it("is not the hand-rolled yaw/pitch formula, and shows what that formula gets wrong", () => {
    const from: Vec3 = [4.5, 6.25, 11.75];
    const to: Vec3 = [-2.5, 1.2, -3.4];

    // The formula a person writes on a whiteboard: yaw = atan2(-dx, -dz),
    // pitch = asin(dy/len). It is a YXZ decomposition of the same rotation.
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const dz = to[2] - from[2];
    const length = Math.hypot(dx, dy, dz);
    const naive: Vec3 = [Math.asin(dy / length), Math.atan2(-dx, -dz), 0];

    // Applied the way three applies it (XYZ), it misses by degrees, and the miss
    // grows with the pitch. `computeAim` does not miss.
    expect(angleBetween(from, naive, to)).toBeGreaterThan(0.01);
    expect(angleBetween(from, naive, to)).toBeLessThan(0.2);

    const solution = computeAim(from, to);
    if (solution == null) throw new Error("expected a solution");
    expect(aimError(from, solution.euler)).toBeLessThan(1e-9);
  });

  it("keeps the horizon level for a shot with no vertical offset", () => {
    const solution = computeAim([5, 0, 0], [0, 0, 0]);
    if (solution == null) throw new Error("expected a solution");

    // Looking down -X from +X: `Ry(θ)·(0,0,-1) = (-sinθ, 0, -cosθ)`, so θ = +90°.
    // The sign is the thing to remember: a camera's yaw is the *negative* of the
    // compass heading you would read off the target's position.
    expect(eulerToDegrees(solution.euler)).toEqual([0, 90, 0]);
  });

  it("reports the distance it will dolly", () => {
    const solution = computeAim([0, 0, 5], [0, 0, 0]);
    expect(solution?.distance).toBeCloseTo(5);
  });

  it("has no answer for a camera standing on its target", () => {
    expect(computeAim([1, 2, 3], [1, 2, 3])).toBeNull();
  });

  it("refuses a NaN coordinate instead of writing one into a prop", () => {
    expect(computeAim([Number.NaN, 2, 3], [0, 0, 0])).toBeNull();
  });

  it("survives a target straight overhead, where `up` is parallel to the view", () => {
    const solution = computeAim([0, 0, 0], [0, 6, 0]);
    expect(solution).not.toBeNull();
    if (solution == null) return;

    const forward = forwardOf([0, 0, 0], solution.euler);
    expect(forward.y).toBeCloseTo(1);
  });

  it("agrees with the forward vector it publishes", () => {
    const from: Vec3 = [3, 4, 5];
    const to: Vec3 = [-1, 0, 2];
    const solution = computeAim(from, to);
    if (solution == null) throw new Error("expected a solution");

    const viaObject = forwardOf(from, solution.euler);
    const viaHelper = new Vector3(...forwardFor(solution.euler));
    expect(viaObject.distanceTo(viaHelper)).toBeLessThan(1e-9);
  });
});

describe("orbitPositionFor", () => {
  it("places the camera the requested distance from the target", () => {
    const target: Vec3 = [1, 0.5, -2];
    const position = orbitPositionFor(target, 8, 35, 20);
    const distance = new Vector3(...position).distanceTo(new Vector3(...target));

    expect(distance).toBeCloseTo(8);
  });

  it("puts the camera above the target for a positive elevation", () => {
    const position = orbitPositionFor([0, 0, 0], 6, 0, 30);
    expect(position[1]).toBeCloseTo(3);
  });
});
