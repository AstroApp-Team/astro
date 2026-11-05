import { describe, expect, it } from "vite-plus/test";

import { ASTRO_DEFAULT_EXPRESSION, type AstroExpression } from "./astro.ts";
import { isTransient } from "./expression.ts";
import { faceForSession, hitReaction } from "./interaction.ts";
import { useAstroStore } from "./store.ts";

/**
 * These are the two rules the hero depends on, and neither is observable without a
 * browser: the face the session implies, and what a tap does to it. Both are pure
 * functions over the store, so the store can be exercised in Node.
 */
describe("faceForSession", () => {
  it("shows a resting face for a closed session, so it does not hold a reaction forever", () => {
    const face = faceForSession({
      status: "disconnected",
      isCapturing: false,
      isPlaying: false,
      hasError: false,
    });
    expect(face.expression).toBe("doze");
    expect(face.sustained).toBe(true);
  });

  it("marks the momentary states as transient", () => {
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

    /* Every momentary face must be a reaction, or it never exits. */
    for (const face of [connecting, speaking, broken]) {
      expect(isTransient(face.expression)).toBe(true);
      expect(face.sustained).toBe(false);
    }
  });

  it("shows a resting face while listening, not while merely connected", () => {
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
    expect(idle.expression).toBe(ASTRO_DEFAULT_EXPRESSION);
    expect(isTransient(listening.expression)).toBe(false);
  });
});

describe("the expression store", () => {
  it("a tap on an awake character is a greeting that returns to what it was doing", () => {
    useAstroStore.getState().syncSession("idle", true);
    expect(hitReaction("idle")).toBe("happy");

    useAstroStore.getState().react();
    expect(useAstroStore.getState().expression).toBe("happy");
    /* `resting` is untouched by a transient reaction, so settle() lands on `idle`. */
    expect(useAstroStore.getState().resting).toBe("idle");

    useAstroStore.getState().settle();
    expect(useAstroStore.getState().expression).toBe("idle");
  });

  it("a tap during a reaction is a no-op, so poking cannot hold one face forever", () => {
    useAstroStore.getState().syncSession("idle", true);
    useAstroStore.getState().react();
    expect(hitReaction(useAstroStore.getState().expression)).toBe("happy");
  });

  it("a tap wakes a sleeping character one notch at a time", () => {
    expect(hitReaction("deep-sleep")).toBe("sleep");
    expect(hitReaction("sleep")).toBe("doze");
    expect(hitReaction("doze")).toBe(ASTRO_DEFAULT_EXPRESSION);
  });

  it("a sustained session state becomes the return target; a momentary one does not", () => {
    useAstroStore.getState().syncSession("look-right", true);
    useAstroStore.getState().syncSession("happy", false);
    expect(useAstroStore.getState().expression).toBe("happy");
    expect(useAstroStore.getState().resting).toBe("look-right");
    useAstroStore.getState().settle();
    expect(useAstroStore.getState().expression).toBe("look-right");

    const back = faceForSession({
      status: "disconnected",
      isCapturing: false,
      isPlaying: false,
      hasError: false,
    });
    useAstroStore.getState().syncSession(back.expression as AstroExpression, back.sustained);
    expect(useAstroStore.getState().resting).toBe("doze");
  });
});
