import { afterEach, describe, expect, it } from "vite-plus/test";

import { isTransient } from "./expression.ts";
import {
  faceForSession,
  gazeDirection,
  hitsCharacter,
  pixelsToViewport,
  tapIntent,
  viewportToPixels,
} from "./interaction.ts";
import { useAstroStore } from "./store.ts";

/**
 * The one rule the overlay depends on: which face the session implies, and whether that
 * face is a state the character holds or a moment it returns from. It is not observable
 * without a voice session, so it is tested as the pure function it is.
 */
describe("faceForSession", () => {
  it("puts him to sleep while no conversation is open", () => {
    /* Sustained, so a tap's reaction settles back to sleep instead of to `idle`. */
    const face = faceForSession({
      status: "disconnected",
      isCapturing: false,
      isPlaying: false,
      hasError: false,
    });
    expect(face.expression).toBe("sleep");
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

describe("the press hit test", () => {
  /* `lookOrigin` is written in the canvas's `[-1, 1]` space with y **up**; pointer events are
     in CSS pixels with y **down**. That flip is the bug this guards: miss it and the tap
     target sits in the top-right of the window while the character sits in the bottom-right,
     which reads as a character that ignores every touch. */
  it("maps the store's up-positive origin onto pointer pixels", () => {
    expect(viewportToPixels({ x: 0, y: 0 }, 400, 800)).toEqual({ x: 200, y: 400 });

    const bottomRight = viewportToPixels({ x: 0.74, y: -0.78 }, 400, 800);
    expect(bottomRight.x).toBeCloseTo(348, 5);
    expect(bottomRight.y).toBeCloseTo(712, 5);

    /* A press on his centre is on him; the mirrored point in the top-right is not. */
    expect(hitsCharacter(bottomRight, bottomRight, 50)).toBe(true);
    expect(hitsCharacter({ x: 348, y: 88 }, bottomRight, 50)).toBe(false);
  });

  it("is a disc, not a box, so the area outside the glow stays the page's", () => {
    const centre = { x: 200, y: 400 };
    expect(hitsCharacter({ x: 240, y: 430 }, centre, 50)).toBe(true);
    /* 40 across and 40 down is a 56px diagonal: inside the bounding box, outside the disc. */
    expect(hitsCharacter({ x: 240, y: 440 }, centre, 50)).toBe(false);
  });
});

describe("the expression store", () => {
  it("the character's own position is written separately from the gaze", () => {
    /* The pointer and press handlers need his position to turn "where the cursor is" into
       "which way the cursor is from him", and they read it outside the canvas — so it has to
       be store state, not a prop on the mesh. */
    useAstroStore.getState().setLookOrigin(0.74, -0.78, 78);
    expect(useAstroStore.getState().lookOrigin).toEqual({ x: 0.74, y: -0.78 });
    expect(useAstroStore.getState().lookRadius).toBe(78);
    expect(useAstroStore.getState().look).toEqual({ x: 0, y: 0 });
  });

  it("a press greets, then returns to what the session was doing", () => {
    useAstroStore.getState().syncSession("look-right", true);

    useAstroStore.getState().react();
    expect(useAstroStore.getState().expression).toBe("happy");
    expect(useAstroStore.getState().resting).toBe("look-right");

    useAstroStore.getState().settle();
    expect(useAstroStore.getState().expression).toBe("look-right");
  });

  it("a press on a sleeping character wakes him one notch", () => {
    useAstroStore.getState().syncSession("sleep", true);
    useAstroStore.getState().react();
    expect(useAstroStore.getState().expression).toBe("doze");
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

/**
 * The coordinate pair has to be exact inverses, because a drag reads the pointer once and the
 * renderer reads the anchor in the opposite direction: an error here moves him against the
 * finger, which is the classic sign of a y flip applied twice (or skipped).
 */
describe("pointer coordinates", () => {
  const width = 390;
  const height = 844;

  it("round-trips pixels through viewport space", () => {
    for (const point of [
      { x: 0, y: 0 },
      { x: 195, y: 422 },
      { x: 389, y: 843 },
    ]) {
      const back = viewportToPixels(pixelsToViewport(point, width, height), width, height);
      expect(back.x).toBeCloseTo(point.x, 6);
      expect(back.y).toBeCloseTo(point.y, 6);
    }
  });

  it("puts the top of the screen at +1, because the canvas has y up", () => {
    expect(pixelsToViewport({ x: 0, y: 0 }, width, height).y).toBeCloseTo(1, 10);
    expect(pixelsToViewport({ x: 0, y: height }, width, height).y).toBeCloseTo(-1, 10);
    expect(pixelsToViewport({ x: 0, y: 0 }, width, height).x).toBeCloseTo(-1, 10);
  });
});

describe("a press on the character", () => {
  it("starts a conversation when there is none", () => {
    expect(tapIntent(false)).toBe("start");
  });

  it("greets while a session is open and Astro is silent", () => {
    expect(tapIntent(true)).toBe("greet");
    expect(tapIntent(true, false)).toBe("greet");
  });

  it("interrupts when a session is open and Astro is speaking", () => {
    expect(tapIntent(true, true)).toBe("interrupt");
  });
});

describe("the drag and voice fields", () => {
  afterEach(() => {
    useAstroStore.getState().setSpeaking(false);
    useAstroStore.getState().setVoice(null);
  });

  it("publishes a drag anchor and clears it back to the corner", () => {
    useAstroStore.getState().setAnchor({ x: 0.2, y: -0.3 });
    expect(useAstroStore.getState().anchor).toEqual({ x: 0.2, y: -0.3 });

    useAstroStore.getState().setAnchor(null);
    expect(useAstroStore.getState().anchor).toBeNull();
  });

  it("publishes the session's start/stop/interrupt and speaking state while mounted", () => {
    const voice = { start: () => {}, stop: () => {}, interrupt: () => {} };
    useAstroStore.getState().setVoice(voice);
    expect(useAstroStore.getState().voice).toBe(voice);

    useAstroStore.getState().setSpeaking(true);
    expect(useAstroStore.getState().speaking).toBe(true);

    /* The gate replaces the session, so the handle must go with it: a press with no key
       behind it would ask for the microphone and then fail to connect. */
    useAstroStore.getState().setVoice(null);
    expect(useAstroStore.getState().voice).toBeNull();
  });
});

describe("fullscreen and hero visibility state", () => {
  afterEach(() => {
    useAstroStore.getState().setHidden(false);
    useAstroStore.getState().setHeroSpot(null);
  });

  it("hides Astro while fullscreen is active and reveals him again on exit", () => {
    expect(useAstroStore.getState().hidden).toBe(false);

    useAstroStore.getState().setHidden(true);
    expect(useAstroStore.getState().hidden).toBe(true);

    useAstroStore.getState().setHidden(false);
    expect(useAstroStore.getState().hidden).toBe(false);
  });

  it("tracks the centered hero slot for the initial welcome screen", () => {
    expect(useAstroStore.getState().heroSpot).toBeNull();

    useAstroStore.getState().setHeroSpot({ x: 0, y: 0.14 });
    expect(useAstroStore.getState().heroSpot).toEqual({ x: 0, y: 0.14 });

    useAstroStore.getState().setHeroSpot(null);
    expect(useAstroStore.getState().heroSpot).toBeNull();
  });
});
