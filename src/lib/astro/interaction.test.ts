import { describe, expect, it } from "vite-plus/test";

import { isTransient } from "./expression.ts";
import { gazeDirection, faceForSession } from "./interaction.ts";
import { useAstroStore } from "./store.ts";

/**
 * The one rule the overlay depends on: which face the session implies, and whether that
 * face is a state the character holds or a moment it returns from. It is not observable
 * without a voice session, so it is tested as the pure function it is.
 */
describe("faceForSession", () => {
  it("shows a resting face for a closed session", () => {
    const face = faceForSession({
      status: "disconnected",
      isCapturing: false,
      isPlaying: false,
      hasError: false,
    });
    expect(face.expression).toBe("doze");
    expect(face.sustained).toBe(true);
  });

  it("marks the momentary states as transient, so they always have an exit", () => {
    const connecting = faceForSession({
      status: "connecting",
      isCapturing: false,
      isPlaying: false,
      hasError: false,
    });
    const speaking = faceForSession({
      status: "connected",
      isCapturing: true,
      isPlaying: true,
      hasError: false,
    });
    const broken = faceForSession({
      status: "connected",
      isCapturing: false,
      isPlaying: false,
      hasError: true,
    });

    expect(connecting.expression).toBe("wonder");
    expect(speaking.expression).toBe("happy");
    expect(broken.expression).toBe("alert");

    /* A sustained state written as a transient expression would never return. */
    for (const face of [connecting, speaking, broken]) {
      expect(isTransient(face.expression)).toBe(true);
      expect(face.sustained).toBe(false);
    }
  });

  it("shows attention while listening, and nothing while merely connected", () => {
    const listening = faceForSession({
      status: "connected",
      isCapturing: true,
      isPlaying: false,
      hasError: false,
    });
    const idle = faceForSession({
      status: "connected",
      isCapturing: false,
      isPlaying: false,
      hasError: false,
    });
    expect(listening.expression).toBe("look-right");
    expect(idle.expression).toBe("idle");
    expect(isTransient(listening.expression)).toBe(false);
  });
});

describe("gazeDirection", () => {
  /* He lives in the bottom-right corner, so his origin is never the viewport's centre. */
  const corner = { x: 0.74, y: -0.78 };

  it("points at the cursor instead of at the corner he sits in", () => {
    /* With absolute viewport coordinates, a cursor parked next to him read as (1, -1) and
       he stared at the corner rather than at the cursor. Subtracting his origin is the fix. */
    expect(gazeDirection(corner, corner)).toEqual({ x: 0, y: 0 });

    const upperLeft = gazeDirection({ x: -1, y: 1 }, corner);
    expect(upperLeft.x).toBeLessThan(0);
    expect(upperLeft.y).toBeGreaterThan(0);

    /* Reaching him from above-left and going past him both point the other way. */
    const lowerRight = gazeDirection({ x: 1, y: -1 }, corner);
    expect(lowerRight.x).toBeGreaterThan(0);
    expect(lowerRight.y).toBeLessThan(0);
  });

  it("caps a far cursor at length 1 without changing its direction", () => {
    /* `followPointer` adds this to the resting look and clamps the sum radially, so a
       vector longer than 1 would erase the resting look instead of pulling it to the rim. */
    const far = gazeDirection({ x: 1, y: 1 }, corner);
    expect(Math.hypot(far.x, far.y)).toBeCloseTo(1, 5);
    expect(far.x / far.y).toBeCloseTo((1 - corner.x) / (1 - corner.y), 5);

    const near = gazeDirection({ x: 0.8, y: -0.7 }, corner);
    expect(Math.hypot(near.x, near.y)).toBeLessThan(1);
  });
});

describe("the expression store", () => {
  it("the character's own position is written separately from the gaze", () => {
    /* The pointer handler needs his position to turn "where the cursor is" into "which way
       the cursor is from him", and it reads it outside the canvas — so it has to be store
       state, not a prop on the mesh. */
    useAstroStore.getState().setLookOrigin(0.74, -0.78);
    expect(useAstroStore.getState().lookOrigin).toEqual({ x: 0.74, y: -0.78 });
    expect(useAstroStore.getState().look).toEqual({ x: 0, y: 0 });
  });

  it("a sustained session state becomes the return target; a momentary one does not", () => {
    useAstroStore.getState().syncSession("look-right", true);
    useAstroStore.getState().syncSession("happy", false);

    expect(useAstroStore.getState().expression).toBe("happy");
    expect(useAstroStore.getState().resting).toBe("look-right");

    /* The next sustained write is what ends the momentary one — no timer involved. */
    useAstroStore.getState().syncSession("idle", true);
    expect(useAstroStore.getState().expression).toBe("idle");
    expect(useAstroStore.getState().resting).toBe("idle");
  });

  it("the pointer writes attention, not the face", () => {
    useAstroStore.getState().syncSession("idle", true);
    useAstroStore.getState().setLook(0.8, -0.4);

    expect(useAstroStore.getState().look).toEqual({ x: 0.8, y: -0.4 });
    expect(useAstroStore.getState().expression).toBe("idle");
  });
});
