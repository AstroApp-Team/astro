import { create } from "zustand";

import { ASTRO_DEFAULT_EXPRESSION, type AstroExpression } from "@core/models/astro.ts";
import { isTransient } from "@core/usecases/astroExpression.ts";
import { hitReaction } from "@core/usecases/astroInteraction.ts";

/**
 * Astro's expression, and the state it returns to.
 *
 * This is the ONLY channel between the page and the character's face, and it is
 * deliberately one-directional in each half:
 *
 *   - the **page** writes an expression (`setExpression`, `react`), because the
 *     character has no face of its own — `AstroScene` paints whatever this says;
 *   - the **scene** never writes here. A tap comes back to the page as
 *     `useSceneStore.lastEvent` (the same channel `/float` uses), so the page
 *     decides what a tap means and this store only holds the answer.
 *
 * Why the face is here and not on the sheet: a keyframed expression and a
 * store-driven one are two owners of one prop, and the clip wins silently. The rig
 * owns `position`; the face is app state. There is no expression track on
 * `AstroScene`, and adding one would make the buttons below stop working.
 *
 * `resting` is what a reaction returns to. It is tracked separately from
 * `expression` because `isTransient("happy")` is true and a reaction that returns
 * to itself never ends — `returnExpression` in `astroExpression.ts` is the same
 * rule stated as a pure function.
 */
export type AstroStore = {
  expression: AstroExpression;
  resting: AstroExpression;
  /**
   * Where the pointer is, as attention: `(0, 0)` centred, `±1` at the rim.
   *
   * v1 quantises this into a placement (`lookTowards`) and ignores the continuous
   * value; v2's eyes are geometry and interpolate it. It is written on every mouse
   * move and read inside the scene's frame loop via `getState()`, not through a
   * selector — a subscription here would re-render the mesh 60 times a second to
   * move two prisms the frame loop is moving anyway.
   */
  look: { x: number; y: number };
  setLook(x: number, y: number): void;
  /** Show a state because the user picked it. A resting state becomes the return target. */
  setExpression(expression: AstroExpression): void;
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

  react() {
    const { expression, resting } = get();
    const next = hitReaction(expression);
    set({ expression: next, resting: isTransient(next) ? resting : next });
  },

  settle() {
    set((state) => ({ expression: state.resting }));
  },
}));
