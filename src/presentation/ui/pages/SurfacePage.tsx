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
import { onChange } from "@theatre/core";
import { arrowBackOutline, colorPaletteOutline, refreshOutline } from "ionicons/icons";
import { useEffect, useRef } from "react";
import type { CSSProperties, PointerEvent, RefObject } from "react";
import { useNavigate } from "react-router-dom";

import { SPIN_RANGE } from "@core/models/scene.ts";
import type { SurfaceId } from "@core/models/surface.ts";
import {
  describeAction,
  SCROLL_DRAG_FACTOR,
  surfaceSummary,
  wheelDeltaToPixels,
  type SurfaceActionLog,
} from "@core/usecases/surfaceInteraction.ts";
import { StatusBarService } from "@infra/native/StatusBarService.ts";
import { SCENE_SHEET_IDS, getSheet } from "@infra/theatre/project.ts";
import { ensureStudio, hideStudioUi, showStudioUi } from "@infra/theatre/studioInit.ts";
import {
  pauseSequence,
  playRange,
  seekSequence,
  useSheetPlayback,
} from "@infra/theatre/useSheetPlayback.ts";
import MainCanvas from "@presentation/canvas/MainCanvas.tsx";
import { useAppStore } from "@presentation/state/useAppStore.ts";
import { useSceneStore } from "@presentation/state/useSceneStore.ts";
import { useShapeStore } from "@presentation/state/useShapeStore.ts";
import { useSurfaceStore } from "@presentation/state/useSurfaceStore.ts";
import { SphereSurface } from "@presentation/ui/components/SphereSurface.tsx";
import { SquareSurface } from "@presentation/ui/components/SquareSurface.tsx";
import { SurfaceHost } from "@presentation/ui/components/SurfaceHost.tsx";
import SurfaceTouchShield from "@presentation/ui/components/SurfaceTouchShield.tsx";
import { pressSurfaceFromPage } from "@presentation/ui/components/surfacePress.ts";

import "@presentation/ui/styles/surface.css";

/**
 * The playhead readout is rounded to a tenth of a second.
 *
 * Theatre ticks the position atom every frame, and this page writes the playhead
 * into `useSurfaceStore` for the readout. A page that re-rendered on every tick
 * re-renders the log, the table and both surface hosts 30 times a second — and the
 * hosts are watched by a MutationObserver, so an unrounded readout is a raster per
 * frame. Rounding first means the write happens when the digit shown changes.
 */
const PLAYHEAD_STEP = 0.1;

const playheadStep = (position: number) => {
  const units = 1 / PLAYHEAD_STEP;
  const step = Math.round(position * units) / units;
  return Number.isFinite(step) ? step : 0;
};

/**
 * `/surface` — React pages used as mesh textures.
 *
 * Two pages are rendered twice. Once as DOM, off screen, where they are laid out
 * and measured like any other content. Once as pixels: the DOM subtree is drawn
 * into a canvas (`infrastructure/surface/rasterizeSurface.ts`), uploaded as a
 * texture, and mapped onto a plane and a sphere in `SurfaceScene`.
 *
 * Each page carries one button, and each button drives the *other* object:
 *
 *   - the square page paints the colour sphere,
 *   - the sphere page spins the square page.
 *
 * Both buttons are pressable two ways, which is the whole demonstration. Press the
 * button on the page behind the canvas and it is a normal click. Press the button
 * **on the mesh** and it is a raycast: the hit carries a UV, the core helper turns
 * the UV into a page pixel (flipping `v`, because three uploads the canvas
 * vertically), the page's published rects say which button that pixel is inside,
 * and the press lands on the same store action. The log records which route it took.
 *
 * ## The rules this page is built on
 *
 *   - **The store is the only 2D ↔ 3D channel.** A mesh never reaches into a DOM
 *     node and a button never reaches into a mesh. That rule is usually polite;
 *     here it is load-bearing, because a button inside a texture *cannot* be
 *     clicked and a mesh *must not* know a table exists.
 *   - **"Spin the square page" = seek the playhead.** The page never writes
 *     `rotation.y`. The rig owns that prop, the clip wins silently, and nothing
 *     warns you — the same rule as every other scene, with the added twist that
 *     the object being spun is a page.
 *   - **The page owns playback.** `SurfaceScene` does not call `useSheetPlayback`.
 *     A scene component that started the spin clip on its own would be a second
 *     owner of the same playhead.
 *   - **The overlay canvas is transparent to the pointer.** `eventSource` +
 *     `eventPrefix="client"` + a `position: fixed; inset: 0` overlay, exactly as on
 *     `/float`. The canvas is not a hit target, so a press on the mesh also lands on
 *     the DOM element under it — the honest price of an overlay.
 *   - **A surface page renders only press-derived state.** The hosts are watched by
 *     a MutationObserver, and a mutation is a full style walk, an SVG encode, an
 *     image decode and a 1 MB texture upload. A clock inside a texture page is a
 *     raster per frame, which is why the playhead is read out here and not there.
 */
export default function SurfacePage() {
  const navigate = useNavigate();

  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ surfaceId: SurfaceId; lastY: number } | null>(null);
  const spinningRef = useRef(false);

  const sheet = getSheet(SCENE_SHEET_IDS.surface);
  const playback = useSheetPlayback(sheet);
  const sequence = playback.sequence;

  const log: SurfaceActionLog = useSurfaceStore((state) => state.log);
  const sphereColor = useSurfaceStore((state) => state.sphereColor);
  const spinRequest = useSurfaceStore((state) => state.spinRequest);
  const playhead = useSurfaceStore((state) => state.playhead);
  const setPlayhead = useSurfaceStore((state) => state.setPlayhead);

  const setActiveScene = useSceneStore((state) => state.setActiveScene);
  const setScreen = useAppStore((state) => state.setScreen);
  const setSheetId = useShapeStore((state) => state.setSheetId);

  /**
   * The page owns playback: park the playhead at the start of the spin clip and
   * stay paused. The plane is a page, and a page that animates itself while the
   * user is reading it is a screensaver.
   */
  useEffect(() => {
    seekSequence(sequence, SPIN_RANGE[0]);
    pauseSequence(sequence);

    return () => {
      pauseSequence(sequence);
    };
  }, [sequence]);

  /**
   * A spin request rewinds to the start of the clip and plays it through.
   *
   * Always from `SPIN_RANGE[0]`, never from a draw. The request is "spin the square
   * page **once**", and the clip is one revolution: start mid-clip and the plane
   * turns partway, which is the bug the float page's draw exists to prevent and this
   * page does not have — a tap there must move the sphere *somewhere new*, a tap
   * here must complete the same turn every time. A press mid-spin is a rewind, not a
   * second turn.
   *
   * `spinRequest` is a counter, not a boolean: a boolean is the same value the
   * second time the button is pressed, and a selector on it does not re-render.
   */
  useEffect(() => {
    if (spinRequest === 0) return;

    spinningRef.current = true;
    seekSequence(sequence, SPIN_RANGE[0]);
    playRange(sequence, SPIN_RANGE);
  }, [sequence, spinRequest]);

  /**
   * The running playhead, subscribed rather than polled, and the stop at the end of
   * the spin.
   *
   * The stop is here rather than in the spin effect because the spin is a clip: it
   * ends when the playhead reaches `SPIN_RANGE[1]`, and only the subscription knows
   * when that is. Without it the plane loops forever and the next press starts a
   * spin that is already mid-turn.
   */
  useEffect(() => {
    let shown = -1;

    const stop = onChange(sequence.pointer.position, (position) => {
      const step = playheadStep(position);
      if (step >= SPIN_RANGE[1] - 1e-3 && spinningRef.current) {
        spinningRef.current = false;
        pauseSequence(sequence);
      }
      if (step === shown) return;
      shown = step;
      setPlayhead(step);
    });

    return stop;
  }, [sequence, setPlayhead]);

  /**
   * The Studio panel is hidden for this route, same as every end-user page.
   *
   * `ensureStudio()` is awaited: the panel is shown *by* `initialize()`, so a page
   * that never resolves the studio cannot hide it. The cleanup restores visibility
   * rather than force-showing, so `/rig/surface` gets the panel back as it had it.
   */
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
    setActiveScene("surface");
    setScreen("surface");
    setSheetId(SCENE_SHEET_IDS.surface);
    StatusBarService.setStyle("dark");

    return () => {
      setActiveScene("hub");
      setScreen("voice");
      StatusBarService.setStyle("default");
    };
  }, [setActiveScene, setScreen, setSheetId]);

  /**
   * Wheel over the page, routed.
   *
   * Registered natively with `{ passive: false }`, not as React's `onWheel`: React
   * registers wheel delegates with the passive flag, and inside a passive listener
   * `preventDefault` is a no-op — the page scrolls anyway. R3F's own wheel listener is
   * passive for the same reason (`DOM_EVENTS.onWheel = ['wheel', true]`), so the mesh
   * cannot cancel the page's scroll either. This listener is the only place on the page
   * that can, and it is registered after R3F connects, on the same element, so the
   * mesh's handler has already stamped `wheelTarget` by the time this runs.
   *
   * Two outcomes: a wheel the 3D scene consumed scrolls the page *inside the texture*
   * and must not scroll this one, and a wheel it did not consume scrolls this page —
   * including over the bar and the header, which have no scrollable ancestor, which is
   * why the delta is forwarded rather than left to the browser.
   */
  useEffect(() => {
    const root = rootRef.current;
    const host = scrollRef.current;
    if (root == null || host == null) return;

    const onWheel = (event: WheelEvent) => {
      if (useSurfaceStore.getState().wheelTarget != null) {
        event.preventDefault();
        return;
      }

      host.scrollTop += wheelDeltaToPixels(event.deltaY, event.deltaMode);
    };

    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, []);

  /**
   * A drag on the real page, sent to the page inside the texture under the finger.
   *
   * This is the touch half of the same command as the wheel above, and it is the half a
   * phone actually uses: `deltaY` never fires for a finger, so without this the loop is
   * mouse-only. The drag is keyed on `wheelTarget` — the mesh the raycast says is under
   * the pointer — so a drag over the hero text scrolls the real page and a drag over the
   * sphere scrolls the page inside it. The sign is `lastY - clientY`: a finger moving down
   * moves the content down, and the content is translated by `-offset`.
   *
   * The mesh's own pointer handlers do the same job when the pointer is on the mesh, and
   * both paths write one store offset, so a drag that starts on the mesh and leaves it
   * keeps scrolling the same list.
   */
  const beginTextureDrag = (event: PointerEvent<HTMLDivElement>) => {
    const surfaceId = useSurfaceStore.getState().wheelTarget;
    if (surfaceId == null) return;
    dragRef.current = { surfaceId, lastY: event.clientY };
  };

  const stepTextureDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag == null) return;

    const delta = (drag.lastY - event.clientY) * SCROLL_DRAG_FACTOR;
    drag.lastY = event.clientY;
    if (delta === 0) return;

    useSurfaceStore.getState().scrollSurface(drag.surfaceId, delta);
  };

  const endTextureDrag = () => {
    dragRef.current = null;
  };

  const spins = log.rows.filter((row) => row.action === "spin-square").length;
  const paints = log.rows.filter((row) => row.action === "paint-sphere").length;

  const accentStyle = { "--surface-accent": sphereColor } as CSSProperties;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={() => navigate("/voice")}>
              <IonIcon slot="icon-only" icon={arrowBackOutline} />
            </IonButton>
          </IonButtons>
          <IonTitle>Surface</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent fullscreen className="surface-content">
        {/** The event source. R3F attaches its listeners here, so the raycast works
            while the canvas stays transparent to the pointer. */}
        <div
          className="surface"
          ref={rootRef}
          onPointerDown={beginTextureDrag}
          onPointerMove={stepTextureDrag}
          onPointerUp={endTextureDrag}
          onPointerCancel={endTextureDrag}
          onPointerLeave={endTextureDrag}
        >
          {/** Layer 1: the page. */}
          <div className="surface__scroll" ref={scrollRef}>
            <header className="surface__hero">
              <h1>These pages are textures.</h1>
              <p>
                The plane and the sphere are drawing two React pages. Each page is laid out off
                screen, drawn into a canvas, and uploaded as a mesh texture — and each carries one
                button that drives the other object.
              </p>
            </header>

            <section className="surface__panel">
              <h2>Press log</h2>
              <p className="surface__hint">
                Press a button on a mesh, then the same button on the page behind. The log says
                which route each press took: <code>texture</code> is a raycast that found a
                button&apos;s rect, <code>page</code> is a click.
              </p>

              <ul className="surface__chat">
                {log.rows.map((row) => (
                  <li key={row.id}>
                    <span
                      className={`surface__chat__swatch surface__chat__swatch--${row.action}`}
                    />
                    <span className="surface__chat__id">#{row.id}</span>
                    <span className="surface__chat__text">{describeAction(row.action)}</span>
                    <span className="surface__chat__source">{row.source}</span>
                    <span className="surface__chat__at">
                      {row.point == null
                        ? `t ${(row.from ?? 0).toFixed(2)}s`
                        : `${Math.round(row.point.x)},${Math.round(row.point.y)}`}
                    </span>
                  </li>
                ))}
                {log.rows.length === 0 ? (
                  <li className="surface__chat__empty">
                    Nothing pressed yet. The square page is on the left, the sphere page on the
                    right.
                  </li>
                ) : null}
              </ul>

              <table className="surface__table">
                <thead>
                  <tr>
                    <th>Presses</th>
                    <th>Paints</th>
                    <th>Spins</th>
                    <th>Playhead</th>
                    <th>Colour</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{log.count}</td>
                    <td>{paints}</td>
                    <td>{spins}</td>
                    <td>{playhead.toFixed(2)}s</td>
                    <td>{sphereColor}</td>
                  </tr>
                </tbody>
              </table>

              <p className="surface__foot">{surfaceSummary(log)}</p>
            </section>

            <article className="surface__card">
              <h2>How a pixel becomes a click</h2>
              <p>
                A raycast hit reports the UV it hit. The page publishes the box of every button
                marked <code>data-surface-action</code>, measured in its own CSS pixels, and{" "}
                <code>uvToSurfacePoint</code> converts the UV into a page pixel — including the
                vertical flip, because three uploads a canvas with <code>flipY</code>, so UV{" "}
                <code>v = 1</code> is the <em>top</em> row of the page.
              </p>
              <p>
                Skip the flip and every hit is mirrored: the button at the bottom answers taps at
                the top, which reads as &ldquo;the buttons are a bit off&rdquo; rather than as a
                flip.
              </p>
            </article>

            <article className="surface__card">
              <h2>Why the pages are off screen, not hidden</h2>
              <p>
                A subtree the browser does not lay out has no boxes to measure.{" "}
                <code>display: none</code> and <code>opacity: 0</code> both look like the right
                answer and both give <code>getBoundingClientRect</code> a 0×0 rect, so every raycast
                misses. The hosts are parked 10 000 px to the left: laid out, measured, invisible.
              </p>
            </article>

            <article className="surface__card">
              <h2>The spin is a clip, not a rotation</h2>
              <p>
                &ldquo;Spin the square page&rdquo; rewinds the playhead to the start of{" "}
                <code>SPIN_RANGE</code> and plays it through, so every press is the same full turn.
                The rig owns <code>Surface Plane.rotation.y</code> — 0 → 2π over three seconds with
                eased tangents — and the page never writes that prop, because a keyframed prop
                written from the page loses to the clip with no warning.
              </p>
              <p>
                Rig it on <code>/rig/surface</code>, then land it with{" "}
                <code>pnpm run theatre:state -- import &lt;export&gt; --to SurfaceScene</code>.
              </p>
            </article>
          </div>

          {/** Layer 2a: the mesh's own touch region, above the story. `touch-action` is
              read at touchstart, so it has to exist before the gesture — see
              `SurfaceTouchShield.tsx`. The sphere page is the loop-scrollable one, so
              the shield covers the sphere and nothing else. */}
          <SurfaceTouchShield surfaceId="sphere" />

          {/** Layer 2: the canvas. `inset: 0` is what makes `eventPrefix="client"`
              correct; `pointer-events: none` is what keeps the page alive under it. */}
          <div className="surface__overlay">
            <MainCanvas
              scene="surface"
              className="surface-canvas"
              eventSource={rootRef as RefObject<HTMLElement | null>}
              eventPrefix="client"
              style={{ touchAction: "pan-y" }}
            />
          </div>

          {/** Layer 3: the control bar — the same two presses, from the page. */}
          <div className="surface__bar" style={accentStyle}>
            <div className="surface__bar__buttons">
              <button
                type="button"
                className="surface__btn surface__btn--accent"
                onClick={() => pressSurfaceFromPage("paint-sphere")}
              >
                <IonIcon icon={colorPaletteOutline} />
                Paint sphere
              </button>
              <button
                type="button"
                className="surface__btn"
                onClick={() => pressSurfaceFromPage("spin-square")}
              >
                <IonIcon icon={refreshOutline} />
                Spin square
              </button>
              <button
                type="button"
                className="surface__btn"
                onClick={() => {
                  spinningRef.current = false;
                  playback.reset();
                  useSurfaceStore.getState().reset();
                }}
              >
                Reset
              </button>
            </div>
            <p className="surface__readout">
              <span className="surface__swatch" style={{ background: sphereColor }} />
              {playhead.toFixed(2)}s · {spins} spins
            </p>
          </div>
        </div>

        {/** Layer 4: the pages themselves. Off screen, laid out, measured, rasterized. */}
        <div className="surface-hosts">
          <SurfaceHost surfaceId="square">
            <SquareSurface />
          </SurfaceHost>
          <SurfaceHost surfaceId="sphere">
            <SphereSurface />
          </SurfaceHost>
        </div>
      </IonContent>
    </IonPage>
  );
}
