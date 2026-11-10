import { create } from "zustand";

import { ASTRO_DEFAULT_EXPRESSION, type AstroExpression } from "./astro.ts";
import { ASTRO_V2_TUNABLES, type AstroV2Tunables } from "./astroV2.ts";
import { hitReaction, isTransient } from "./expression.ts";

/**
 * Astro's expression, and the state it returns to.
 *
 * This is the ONLY channel between the page and the character's face, and it is
 * deliberately one-directional in each half:
 *
 *   - the **page** writes an expression (`setExpression`, `syncSession`),
 *     because the character has no face of its own — `AstroCharacter` draws whatever
 *     this says;
 *   - the **scene** never writes here. The pointer is the only other writer, and it
 *     writes `look`, not the face.
 *
 * On the refactor branch the face was app state rather than a Theatre track for the
 * same reason: a keyframed expression and a store-driven one are two owners of one
 * prop and the clip wins silently. Here there is no sheet at all, and that reason
 * still holds.
 *
 * `resting` is what the face returns to after a momentary state. It is tracked separately from
 * `expression` because `isTransient("happy")` is true and a reaction that returns
 * to itself never ends.
 */
export type AstroStore = {
  expression: AstroExpression;
  resting: AstroExpression;
  /**
   * Where the pointer is, as attention: `(0, 0)` centred, `±1` at the rim.
   *
   * Written on every pointer move and read inside the frame loop via `getState()`,
   * not through a selector — a subscription here would re-render the mesh 60 times
   * a second to move two prisms the frame loop is moving anyway.
   */
  look: { x: number; y: number };
  /**
   * Where the character is, as the same `[-1, 1]` viewport space the pointer is written
   * in. Set from inside the canvas, where the corner position is known.
   */
  lookOrigin: { x: number; y: number };
  /**
   * His radius in CSS pixels, alongside `lookOrigin`.
   *
   * The canvas is `pointer-events: none`, so a tap on him is hit-tested arithmetically —
   * and in pixels, not in the normalised space: a disc drawn in `[-1, 1]` coordinates is an
   * ellipse on a phone, so a tap that looks like it lands on him misses by the aspect ratio.
   */
  lookRadius: number;
  /**
   * Where he was dragged to, in `[-1, 1]` viewport space, or `null` for the shipping corner.
   *
   * Normalised on purpose: the same anchor survives a rotation, a window resize and the
   * jump from a browser to a phone, while a pixel or world-unit anchor does not.
   */
  anchor: { x: number; y: number } | null;
  /** True between `pointerdown` and `pointerup` on his handle. */
  dragging: boolean;
  /**
   * Is a conversation open (or opening)?
   *
   * The overlay needs this to decide what a tap on him means — start, or a greeting —
   * and the answer lives in `VoiceSession`, so it is published here rather than
   * duplicated as a second source of truth.
   */
  live: boolean;
  /**
   * The session's own start/stop, published by `VoiceSession` while it is mounted.
   *
   * The character is the start button, but the microphone permission and the socket
   * belong to that component, so a tap sends a command through here instead of reaching
   * over it. `null` while the gate is up: with no password there is nothing to start.
   */
  voice: { start(): void; stop(): void } | null;
  setLook(x: number, y: number): void;
  setLookOrigin(x: number, y: number, radius: number): void;
  setAnchor(anchor: { x: number; y: number } | null): void;
  setDragging(dragging: boolean): void;
  setLive(live: boolean): void;
  setVoice(voice: { start(): void; stop(): void } | null): void;
  /**
   * Show a state the session implies.
   *
   * `sustained` decides whether it becomes the return target: a momentary state
   * (`wonder` while connecting, `happy` while speaking) must not become what the
   * character does forever.
   */
  syncSession(expression: AstroExpression, sustained: boolean): void;
  /** Show a state outright, and make it the return target unless it is momentary. */
  setExpression(expression: AstroExpression): void;
  /**
   * A press on him.
   *
   * `resting` is deliberately left alone: a greeting is a moment, not a new baseline, so
   * `settle()` returns him to whatever the session was doing. See `hitReaction` — a press
   * during a reaction is a no-op, and a press on a sleeping character wakes him one notch.
   */
  react(): void;
  /** End a momentary face: back to `resting`. */
  settle(): void;
};

export const useAstroStore = create<AstroStore>((set, get) => ({
  expression: ASTRO_DEFAULT_EXPRESSION,
  resting: ASTRO_DEFAULT_EXPRESSION,
  look: { x: 0, y: 0 },
  lookOrigin: { x: 0, y: 0 },
  lookRadius: 0,
  anchor: null,
  dragging: false,
  live: false,
  voice: null,

  setLook(x, y) {
    set({ look: { x, y } });
  },

  setLookOrigin(x, y, radius) {
    set({ lookOrigin: { x, y }, lookRadius: radius });
  },

  setAnchor(anchor) {
    set({ anchor });
  },

  setDragging(dragging) {
    set({ dragging });
  },

  setLive(live) {
    set({ live });
  },

  setVoice(voice) {
    set({ voice });
  },

  setExpression(expression) {
    set({ expression, resting: isTransient(expression) ? get().resting : expression });
  },

  syncSession(expression, sustained) {
    set({ expression, resting: sustained ? expression : get().resting });
  },

  react() {
    /* `hitReaction` is the rule, not this method: it knows that a transient face must not be
       interrupted and that sleep wakes one notch at a time. */
    set({ expression: hitReaction(get().expression) });
  },

  settle() {
    set({ expression: get().resting });
  },
}));

/**
 * The look-dev numbers behind the shaders.
 *
 * The appearance is a small set of uniforms — wave frequency, wave amplitude, halo
 * edge angles, halo opacity — and those are exactly the values a human tunes by
 * sliding until the render matches the stylesheet. Baking them into the GLSL would
 * mean a shader rebuild per degree. So they live here: `materials.applyTunables`
 * writes them into the uniform maps, and nothing else reads them.
 */
export type AstroV2Store = {
  tunables: AstroV2Tunables;
  setTunable<K extends keyof AstroV2Tunables>(key: K, value: AstroV2Tunables[K]): void;
  reset(): void;
};

/*
 * A handle for the dev overlay's own rigging: the expression store is otherwise unreachable
 * from outside React, which made checking a face by eye — "show me `sleep` and let me look at
 * the dash" — a code edit. Dev-only, so it cannot be poked at in a build.
 */
if (import.meta.env.DEV) {
  (globalThis as { __astro?: typeof useAstroStore }).__astro = useAstroStore;
}

export const useAstroV2Store = create<AstroV2Store>((set) => ({
  tunables: ASTRO_V2_TUNABLES,

  setTunable(key, value) {
    set((state) => ({ tunables: { ...state.tunables, [key]: value } }));
  },

  reset() {
    set({ tunables: ASTRO_V2_TUNABLES });
  },
}));
