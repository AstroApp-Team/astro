import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonPage,
  IonTitle,
  IonToolbar,
} from "@ionic/react";
import { arrowBackOutline, refreshOutline } from "ionicons/icons";
import { useEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  RefObject,
  WheelEvent,
} from "react";
import { useNavigate } from "react-router-dom";

import { ASTRO_STATES } from "@core/models/astro.ts";
import { ASTRO_V2_PALETTE, type AstroV2Tunables } from "@core/models/astroV2.ts";
import { ASTRO_V2_AUTOPLAY } from "@core/models/scene.ts";

import { StatusBarService } from "@infra/native/StatusBarService.ts";
import { SCENE_SHEET_IDS, getSheet } from "@infra/theatre/project.ts";
import { ensureStudio, hideStudioUi, showStudioUi } from "@infra/theatre/studioInit.ts";
import {
  loopSequence,
  pauseSequence,
  seekSequence,
  useSheetPlayback,
} from "@infra/theatre/useSheetPlayback.ts";
import MainCanvas from "@presentation/canvas/MainCanvas.tsx";
import { useAppStore } from "@presentation/state/useAppStore.ts";
import { useAstroStore } from "@presentation/state/useAstroStore.ts";
import { useAstroV2Store } from "@presentation/state/useAstroV2Store.ts";
import { useSceneStore } from "@presentation/state/useSceneStore.ts";
import { useShapeStore } from "@presentation/state/useShapeStore.ts";

import "@presentation/ui/styles/astro-v2.css";

/**
 * Astro v2 — the character as geometry, over the same kind of page as v1.
 *
 * v1 (`/astro`) is kept, untouched, as the backup: it is a plane wearing a 12-state
 * canvas texture, which is the right model for a *drawing* and the wrong one for a
 * character. v2 replaces the drawing with a sphere, a pair of sunken eye prisms and a
 * halo shell, each drawn by a `ShaderMaterial` that ignores lights (see
 * `canvas/astroV2/materials.ts`). The page is the look-dev bench for that: the face
 * is still app state, and the numbers behind the wave and the halo are sliders here
 * rather than constants in GLSL, because "does this match the stylesheet" is a
 * question you answer by moving a knob.
 *
 * The overlay wiring is `/float`'s and `/astro`'s, and is not described again in
 * detail — `eventSource` + `eventPrefix="client"` + a `position: fixed; inset: 0`
 * overlay, the canvas not being a hit target, the press gate inside
 * `AstroV2Scene.tsx`. What is *new* here is the look: a continuous pointer
 * follow (`setLook`, damped in the scene) instead of v1's seven quantised placements,
 * because the eyes are geometry now and can be anywhere.
 */
export default function AstroV2Page() {
  const navigate = useNavigate();

  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const sheet = getSheet(SCENE_SHEET_IDS["astro-v2"]);
  const playback = useSheetPlayback(sheet);
  const sequence = playback.sequence;

  const expression = useAstroStore((state) => state.expression);
  const setExpression = useAstroStore((state) => state.setExpression);
  const tunables = useAstroV2Store((state) => state.tunables);
  const setTunable = useAstroV2Store((state) => state.setTunable);
  const resetTunables = useAstroV2Store((state) => state.reset);

  const [pokes, setPokes] = useState(0);
  const [showTuner, setShowTuner] = useState(true);

  const lastEvent = useSceneStore((state) => state.lastEvent);
  const setActiveScene = useSceneStore((state) => state.setActiveScene);
  const setSelectionVisuals = useSceneStore((state) => state.setSelectionVisuals);
  const setScreen = useAppStore((state) => state.setScreen);
  const setSheetId = useShapeStore((state) => state.setSheetId);

  /**
   * The page owns the clip.
   *
   * Same contract as `/float` and `/astro`: module-scope helpers, `[sequence]` as the
   * only dependency, `ASTRO_V2_AUTOPLAY` a module constant. `playback` is a fresh object
   * of closures every render, so it cannot be a dependency — leaving it out and
   * suppressing the lint rule would cost this page its React Compiler pass, and putting
   * it in would re-run the effect every render.
   *
   * The sheet is empty today (no landed clip for v2), so this plays nothing visible on
   * purpose: the motion comes from the shaders. It is wired anyway so that landing a rig
   * on `AstroV2Scene` animates the page with no change here.
   */
  useEffect(() => {
    seekSequence(sequence, ASTRO_V2_AUTOPLAY[0]);
    loopSequence(sequence, ASTRO_V2_AUTOPLAY);

    return () => {
      pauseSequence(sequence);
    };
  }, [sequence]);

  /** A poke on the character: a reaction, a counter. The face is the page's to decide. */
  useEffect(() => {
    if (lastEvent == null || lastEvent.name !== "node-pressed" || lastEvent.nodeId !== "Astro V2")
      return;

    useAstroStore.getState().react();
    setPokes((count) => count + 1);
  }, [lastEvent]);

  /** The Studio panel is hidden for this route, same as every end-user page. */
  useEffect(() => {
    let cancelled = false;
    let restoreAfterUnmount = false;

    void ensureStudio().then((studio) => {
      if (cancelled || studio == null) return;
      restoreAfterUnmount = !studio.ui.isHidden;
      hideStudioUi();
    });

    return () => {
      cancelled = true;
      if (restoreAfterUnmount) showStudioUi();
    };
  }, []);

  useEffect(() => {
    setActiveScene("astro-v2");
    setScreen("astro-v2");
    setSheetId(SCENE_SHEET_IDS["astro-v2"]);
    StatusBarService.setStyle("dark");

    /**
     * The character is something you poke, not rigging furniture, so it does not light
     * up. Selection is still recorded. Stated *on mount* rather than inherited:
     * `IonRouterOutlet` keeps the outgoing page mounted, so coming from `/rig/astro-v2`
     * this page would otherwise inherit the bench's highlight flag.
     */
    setSelectionVisuals(false);

    return () => {
      setActiveScene("hub");
      setScreen("voice");
      StatusBarService.setStyle("default");
      setSelectionVisuals(true);
    };
  }, [setActiveScene, setScreen, setSheetId, setSelectionVisuals]);

  /**
   * Continuous attention.
   *
   * v1 quantised this because it was moving a picture between seven drawn placements.
   * The eyes here are geometry, so the pointer becomes a vector in `[-1, 1]` and the
   * scene damps it — that damping is the whole difference between "looking" and
   * "snapping". Mouse only: on a phone every scroll is a pointer move, and a character
   * that stares at your thumb mid-scroll is not paying attention.
   *
   * `setLook` is read with `getState()` inside the frame loop, so this write does not
   * re-render the page.
   */
  const followPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse") return;

    const rect = event.currentTarget.getBoundingClientRect();
    const width = rect.width > 0 ? rect.width : 1;
    const height = rect.height > 0 ? rect.height : 1;

    useAstroStore
      .getState()
      .setLook(
        ((event.clientX - rect.left) / width - 0.5) * 2,
        -((event.clientY - rect.top) / height - 0.5) * 2,
      );
  };

  /** Wheel over the character scrolls the page: the overlay has no scrollable ancestor. */
  const forwardWheel = (event: WheelEvent<HTMLDivElement>) => {
    const host = scrollRef.current;
    if (host == null) return;
    host.scrollTop += event.deltaY;
  };

  const accentStyle = { "--astro-accent": ASTRO_V2_PALETTE.haloInner } as CSSProperties;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={() => navigate("/voice")}>
              <IonIcon slot="icon-only" icon={arrowBackOutline} />
            </IonButton>
          </IonButtons>
          <IonTitle>Astro v2</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={() => navigate("/astro")}>v1</IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent fullscreen className="astro-content">
        {/** The event source. R3F attaches its listeners here, so the raycast works
            while the canvas stays transparent to the pointer. */}
        <div
          className="astro astro--v2"
          ref={rootRef}
          onWheel={forwardWheel}
          onPointerMove={followPointer}
        >
          {/** Layer 1: the page. */}
          <div className="astro__scroll" ref={scrollRef}>
            <header className="astro__hero">
              <h1>
                Astro, <em>not a drawing</em>.
              </h1>
              {/**
                One line, not the essay: the character's band is the middle of the viewport
                and is fixed there (the overlay does not scroll), so copy that reaches it is
                copy behind a glowing sphere. The explanation lives in a panel below the band,
                where it has a background to sit on.
              */}
              <p>Move a mouse, tap the body. The rest is a shader.</p>
            </header>

            <section className="astro__panel">
              <h2>The face</h2>
              <p className="astro__hint">
                Twelve states. <code>happy</code> is a crescent, <code>doze</code> a flattened dash
                — both are morph targets baked into the eye prism&apos;s geometry, blended by a
                uniform, so the change is an expression rather than a new drawing.
              </p>

              <div className="astro__states">
                {ASTRO_STATES.map((state) => (
                  <button
                    key={state}
                    type="button"
                    className={
                      state === expression ? "astro__state astro__state--active" : "astro__state"
                    }
                    onClick={() => {
                      setExpression(state);
                    }}
                  >
                    {state}
                  </button>
                ))}
              </div>

              <p className="astro__readout">
                pokes: <strong>{pokes}</strong> · face: <strong>{expression}</strong> · blink:{" "}
                <strong>{expression === "doze" ? "closed" : "open"}</strong>
              </p>
            </section>

            {/** Layer 1b: the look-dev panel. These are the uniforms, not baked constants. */}
            <section
              className="astro__panel astro__tuner"
              data-collapsed={showTuner ? "false" : "true"}
            >
              <h2>
                The numbers
                <button
                  type="button"
                  className="astro__state"
                  onClick={() => {
                    setShowTuner((open) => !open);
                  }}
                >
                  {showTuner ? "hide" : "show"}
                </button>
              </h2>
              <p className="astro__hint">
                Every one of these is a uniform on one of the three materials. The defaults are what
                the stylesheet looks like; <code>0</code> wave amount is the sheet&apos;s clean
                gradient, <code>0</code> colour travel its exact palette. Colour travel slides the
                gradient along the sheet&apos;s own ramp instead of rotating hue, so no setting can
                name a colour the stylesheet does not print.
              </p>

              {showTuner ? (
                <div className="astro__sliders">
                  <Slider
                    label="wave freq"
                    value={tunables.waveFreq}
                    min={0.5}
                    max={9}
                    step={0.1}
                    onChange={(value) => {
                      setTunable("waveFreq", value);
                    }}
                  />
                  <Slider
                    label="wave amount"
                    value={tunables.waveAmp}
                    min={0}
                    max={0.6}
                    step={0.01}
                    onChange={(value) => {
                      setTunable("waveAmp", value);
                    }}
                  />
                  <Slider
                    label="wave speed"
                    value={tunables.waveSpeed}
                    min={0}
                    max={2}
                    step={0.05}
                    onChange={(value) => {
                      setTunable("waveSpeed", value);
                    }}
                  />
                  <Slider
                    label="colour period (s)"
                    value={tunables.colorPeriod}
                    min={4}
                    max={90}
                    step={1}
                    onChange={(value) => {
                      setTunable("colorPeriod", value);
                    }}
                  />
                  <Slider
                    label="colour travel"
                    value={tunables.colorAmount}
                    min={0}
                    max={0.5}
                    step={0.01}
                    onChange={(value) => {
                      setTunable("colorAmount", value);
                    }}
                  />
                  <Slider
                    label="gradient width"
                    value={tunables.gradientScale}
                    min={0.4}
                    max={2}
                    step={0.05}
                    onChange={(value) => {
                      setTunable("gradientScale", value);
                    }}
                  />
                  <Slider
                    label="brightness"
                    value={tunables.brightness}
                    min={0.6}
                    max={1.4}
                    step={0.02}
                    onChange={(value) => {
                      setTunable("brightness", value);
                    }}
                  />
                  <Slider
                    label="halo size"
                    value={tunables.haloSize}
                    min={1.2}
                    max={2.6}
                    step={0.05}
                    onChange={(value) => {
                      setTunable("haloSize", value);
                    }}
                  />
                  <Slider
                    label="halo full at"
                    value={tunables.haloEdgeStart}
                    min={0}
                    max={0.9}
                    step={0.01}
                    onChange={(value) => {
                      setTunable("haloEdgeStart", value);
                    }}
                  />
                  <Slider
                    label="halo gone at"
                    value={tunables.haloEdgeEnd}
                    min={0.2}
                    max={1}
                    step={0.01}
                    onChange={(value) => {
                      setTunable("haloEdgeEnd", value);
                    }}
                  />
                  <Slider
                    label="halo opacity"
                    value={tunables.haloOpacity}
                    min={0}
                    max={1}
                    step={0.02}
                    onChange={(value) => {
                      setTunable("haloOpacity", value);
                    }}
                  />

                  <button type="button" className="astro__btn" onClick={resetTunables}>
                    <IonIcon icon={refreshOutline} /> reset to the sheet
                  </button>
                </div>
              ) : null}
            </section>

            <section className="astro__panel">
              <h2>Why v2</h2>
              <p>
                v1 is a plane wearing a 12-state canvas texture: the right model for a drawing, the
                wrong one for a character. Here the body is a sphere with a{" "}
                <code>ShaderMaterial</code>, the eyes are two sunken prisms with their own morph
                targets, and the halo is a larger shell rendered additively behind the body.
              </p>
              <p>
                No light touches any of them — the character <em>emits</em> its colour, so a lit
                surface would need a rig of lights to look like anything and would then contradict
                the gradient. The gradient comes from each fragment&apos;s position in space, not
                from its uv, so it does not seam at the back or squeeze at the poles; a wave of
                three incommensurate sines slides it, and the palette turns slowly behind it.
              </p>
              <p>
                The eyes follow the pointer continuously instead of snapping between the
                sheet&apos;s placements — that is why v2 exists: <code>happy</code> and{" "}
                <code>doze</code> are morph weights, so expressions and attention blend rather than
                swap.
              </p>
            </section>

            <p className="astro__foot">
              v1 is still at <code>/astro</code> — the drawing, unchanged, as the backup.
            </p>
          </div>

          {/** Layer 2: the character. `rootRef` is the event source, so this is not a hit target. */}
          <div className="astro__overlay">
            <MainCanvas
              scene="astro-v2"
              eventSource={rootRef as RefObject<HTMLElement>}
              eventPrefix="client"
              className="astro-canvas"
            />
          </div>

          {/** Layer 3: the bar, above the overlay so its buttons are reachable. */}
          <div className="astro__bar" style={accentStyle}>
            <button
              type="button"
              className="astro__btn"
              onClick={() => {
                playback.reset();
                seekSequence(sequence, ASTRO_V2_AUTOPLAY[0]);
                loopSequence(sequence, ASTRO_V2_AUTOPLAY);
              }}
            >
              replay
            </button>
            <button
              type="button"
              className="astro__btn astro__btn--accent"
              onClick={() => {
                useAstroStore.getState().setLook(0, 0);
              }}
            >
              look centre
            </button>
            <button
              type="button"
              className="astro__btn"
              onClick={() => {
                useAstroStore.getState().react();
              }}
            >
              react
            </button>
            <span className="astro__swatch" aria-hidden="true" />
            <span className="astro__readout">
              <TunableChip tunables={tunables} />
            </span>
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
}

/** A labelled range input. One component so the eleven sliders cannot drift apart. */
function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="astro__slider">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          if (Number.isFinite(next)) onChange(next);
        }}
      />
      <code>{value.toFixed(2)}</code>
    </label>
  );
}

/** The bar's readout: the two numbers that are most often being balanced. */
function TunableChip({ tunables }: { tunables: AstroV2Tunables }) {
  return (
    <>
      wave {tunables.waveFreq.toFixed(1)} · halo {tunables.haloOpacity.toFixed(2)}
    </>
  );
}
