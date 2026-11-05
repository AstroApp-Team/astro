import { describe, expect, it } from "vite-plus/test";

import { isTransient } from "./expression.ts";
import { faceForSession } from "./interaction.ts";
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

describe("the expression store", () => {
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
