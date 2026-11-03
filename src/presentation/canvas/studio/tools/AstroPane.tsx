import { ASTRO_EXPRESSIONS, ASTRO_STATES } from "@core/models/astro.ts";
import { ASTRO_V2_TUNABLES, type AstroV2Tunables } from "@core/models/astroV2.ts";
import { useAstroStore } from "@presentation/state/useAstroStore.ts";
import { useAstroV2Store } from "@presentation/state/useAstroV2Store.ts";

/**
 * The character panel: the face and the look, in one window.
 *
 * Both halves are store writes, not rig writes — that is the whole point of the two
 * astro routes. `expression` is a texture state on v1 and an eye-morph weight on v2,
 * and `tunables` are the v2 shaders' uniforms. Nothing here touches a Theatre track:
 * a keyframed expression, wave or halo would win over these controls silently, which is
 * why the two scenes carry the character's `position` and nothing else.
 *
 * The panel works on any route (the stores are global), so it is the one tool in the
 * dock that is still meaningful on a scene with no astro character in it: it is where
 * you demonstrate that the store is the only 2D ↔ 3D channel.
 */

type Knob = {
  key: keyof AstroV2Tunables;
  label: string;
  min: number;
  max: number;
  step: number;
  hint: string;
};

/**
 * Ranges, not secrets.
 *
 * `waveFreq` stops at 9 because past it the ribbons are finer than the pixel grid on a
 * 390pt phone and the body reads as noise; `colorAmount` stops at 0.5 because a ramp
 * slide of half a width is already the far end of the palette.
 */
const KNOBS: Knob[] = [
  {
    key: "waveFreq",
    label: "Wave density",
    min: 0,
    max: 9,
    step: 0.1,
    hint: "ribbons per world unit",
  },
  {
    key: "waveAmp",
    label: "Wave depth",
    min: 0,
    max: 0.6,
    step: 0.01,
    hint: "gradient-widths of travel",
  },
  { key: "waveSpeed", label: "Wave speed", min: 0, max: 2, step: 0.01, hint: "phase per second" },
  {
    key: "colorPeriod",
    label: "Colour breath",
    min: 2,
    max: 60,
    step: 0.5,
    hint: "seconds per slide",
  },
  { key: "colorAmount", label: "Colour travel", min: 0, max: 0.5, step: 0.01, hint: "ramp-widths" },
  {
    key: "brightness",
    label: "Brightness",
    min: 0.6,
    max: 1.4,
    step: 0.01,
    hint: "body multiplier",
  },
  {
    key: "gradientScale",
    label: "Gradient width",
    min: 0.4,
    max: 1.6,
    step: 0.01,
    hint: "body diagonals",
  },
  { key: "haloSize", label: "Halo radius", min: 1.2, max: 2.6, step: 0.01, hint: "body radii" },
  {
    key: "haloEdgeStart",
    label: "Halo edge start",
    min: 0,
    max: 1,
    step: 0.01,
    hint: "full strength from",
  },
  {
    key: "haloEdgeEnd",
    label: "Halo edge end",
    min: 0,
    max: 1,
    step: 0.01,
    hint: "decayed to nothing at",
  },
  { key: "haloOpacity", label: "Halo opacity", min: 0, max: 1.5, step: 0.01, hint: "shell alpha" },
];

export default function AstroPane() {
  const expression = useAstroStore((state) => state.expression);
  const setExpression = useAstroStore((state) => state.setExpression);
  const tunables = useAstroV2Store((state) => state.tunables);
  const setTunable = useAstroV2Store((state) => state.setTunable);
  const reset = useAstroV2Store((state) => state.reset);

  return (
    <div className="tools-astro">
      <section>
        <h3 className="tools-astro__title">
          Face
          <span className="tools-astro__hint">{expression}</span>
        </h3>
        <div className="tools-astro__chips">
          {ASTRO_STATES.map((state) => {
            const spec = ASTRO_EXPRESSIONS[state];
            return (
              <button
                key={state}
                type="button"
                className="tools-chip"
                data-active={state === expression}
                data-transient={spec.transient}
                onClick={() => {
                  setExpression(state);
                }}
                title={
                  spec.transient
                    ? `${spec.feature} / ${spec.glyph} — a reaction: it settles back on its own`
                    : `${spec.feature} / ${spec.glyph}`
                }
              >
                {state}
              </button>
            );
          })}
        </div>
        <p className="tools-astro__note">
          A reaction returns to the last resting state; the picker never does. `resting` is tracked
          separately because returning to a transient state is a reaction that never ends.
        </p>
      </section>

      <section>
        <h3 className="tools-astro__title">
          Look
          <button type="button" className="tools-btn tools-btn--tiny" onClick={reset}>
            Reset
          </button>
        </h3>
        <div className="tools-astro__knobs">
          {KNOBS.map((knob) => {
            const value = tunables[knob.key];
            const fallback = ASTRO_V2_TUNABLES[knob.key];
            return (
              <label key={knob.key} className="tools-knob">
                <span className="tools-knob__label">
                  {knob.label}
                  <span className="tools-knob__value">{value.toFixed(2)}</span>
                </span>
                <input
                  type="range"
                  min={knob.min}
                  max={knob.max}
                  step={knob.step}
                  value={value}
                  onChange={(event) => {
                    setTunable(knob.key, Number(event.target.value));
                  }}
                />
                <span className="tools-knob__hint">
                  {knob.hint} · default {fallback.toFixed(2)}
                </span>
              </label>
            );
          })}
        </div>
        <p className="tools-astro__note">
          Uniforms, not constants: every number here is what the shader reads this frame. The
          colours are not sliders — they are the sheet&apos;s printed stops, and the wave slides
          along them instead of rotating hue.
        </p>
      </section>
    </div>
  );
}
