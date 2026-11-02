import { create } from "zustand";

import { ASTRO_V2_TUNABLES, type AstroV2Tunables } from "@core/models/astroV2.ts";

/**
 * The look-dev numbers behind Astro v2's shaders.
 *
 * v2's appearance is a small set of uniforms — wave frequency, wave amplitude, halo
 * edge angles, halo opacity — and those are exactly the values a human tunes by
 * sliding until the render matches the stylesheet. Baking them into the GLSL would
 * mean a rebuild per degree; putting them on the sheet would make them an animation
 * channel, which they are not (they are the look, not a clip). So they live here: the
 * page owns sliders, `materials.applyTunables` writes them onto the uniforms, and
 * nothing else reads them.
 *
 * `reset` exists because a slider panel with no way back to the fitted values is a
 * panel that ends every session subtly wrong.
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
