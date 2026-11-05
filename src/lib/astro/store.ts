import { create } from "zustand";

import { ASTRO_DEFAULT_EXPRESSION, type AstroExpression } from "./astro.ts";
import { ASTRO_V2_TUNABLES, type AstroV2Tunables } from "./astroV2.ts";
import { isTransient } from "./expression.ts";
import { hitReaction } from "./interaction.ts";

/**
 * Astro's expression, and the state it returns to.
 *
 * This is the ONLY channel between the page and the character's face, and it is
 * deliberately one-directional in each half:
 *
 *   - the **page** writes an expression (`setExpression`, `react`, `syncSession`),
 *     because the character has no face of its own — `AstroCharacter` draws whatever
 *     this says;
 *   - the **scene** never writes here. A tap comes back to the hero as a callback,
 *     so the page decides what a tap means and this store only holds the answer.
 *
 * On the refactor branch the face was app state rather than a Theatre track for the
 * same reason: a keyframed expression and a store-driven one are two owners of one
 * prop and the clip wins silently. Here there is no sheet at all, and that reason
 * still holds for the two writers this page has — the tap and the session lifecycle.
 *
 * `resting` is what a reaction returns to. It is tracked separately from
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
  setLook(x: number, y: number): void;
  /** Show a state because the user picked it or the session changed. */
  setExpression(expression: AstroExpression): void;
  /**
   * Show a state the session implies.
   *
   * `sustained` decides whether it becomes the return target: a momentary state
   * (`wonder` while connecting, `happy` while speaking) must not become what the
   * character does forever.
   */
  syncSession(expression: AstroExpression, sustained: boolean): void;
  /** A tap: the greeting in `hitReaction`, with `resting` left alone. */
  react(): void;
  /** End a reaction: back to whatever the character was doing before it. */
  settle(): void;
};

export const useAstroStore = create<AstroStore>((set, get) => ({
  expression: ASTRO_DEFAULT_EXPRESSION,
  resting: ASTRO_DEFAULT_EXPRESSION,
  look: { x: 0, y: 0 },

  setLook(x, y) {
    set({ look: { x, y } });
  },

  setExpression(expression) {
    set({ expression, resting: isTransient(expression) ? get().resting : expression });
  },

  syncSession(expression, sustained) {
    set({ expression, resting: sustained ? expression : get().resting });
  },

  react() {
    const { expression, resting } = get();
    const next = hitReaction(expression);
    set({ expression: next, resting: isTransient(next) ? resting : next });
  },

  settle() {
    set((state) => ({ expression: state.resting }));
  },
}));

/**
 * The look-dev numbers behind the shaders.
 *
 * The appearance is a small set of uniforms — wave frequency, wave amplitude, halo
 * edge angles, halo opacity — and those are exactly the values a human tunes by
 * sliding until the render matches the stylesheet. Baking them into the GLSL would
 * mean a shader rebuild per degree. So they live here: the hero writes them through
 * `materials.applyTunables`, and nothing else reads them.
 */
export type AstroV2Store = {
  tunables: AstroV2Tunables;
  setTunable<K extends keyof AstroV2Tunables>(key: K, value: AstroV2Tunables[K]): void;
  reset(): void;
};

export const useAstroV2Store = create<AstroV2Store>((set) => ({
  tunables: ASTRO_V2_TUNABLES,

  setTunable(key, value) {
    set((state) => ({ tunables: { ...state.tunables, [key]: value } }));
  },

  reset() {
    set({ tunables: ASTRO_V2_TUNABLES });
  },
}));
