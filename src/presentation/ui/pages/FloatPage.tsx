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
import { arrowBackOutline, locationOutline, refreshOutline } from "ionicons/icons";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject, WheelEvent } from "react";
import { useNavigate } from "react-router-dom";

import { FLOAT_AUTOPLAY } from "@core/models/scene.ts";
import {
  EMPTY_HIT_LOG,
  appendHit,
  hitSummary,
  isFloatSphere,
  nextSeekTime,
  type FloatHitLog,
} from "@core/usecases/floatInteraction.ts";
import {
  DEFAULT_ACCENT,
  randomAccentColor,
  replayRange,
} from "@core/usecases/showcaseInteraction.ts";
import { StatusBarService } from "@infra/native/StatusBarService.ts";
import { SCENE_SHEET_IDS, getSheet } from "@infra/theatre/project.ts";
import { ensureStudio, hideStudioUi, showStudioUi } from "@infra/theatre/studioInit.ts";
import {
  loopSequence,
  pauseSequence,
  seekSequence,
  sequenceLength,
  useSheetPlayback,
} from "@infra/theatre/useSheetPlayback.ts";
import MainCanvas from "@presentation/canvas/MainCanvas.tsx";
import { useAppStore } from "@presentation/state/useAppStore.ts";
import { useSceneStore } from "@presentation/state/useSceneStore.ts";
import { useShapeStore } from "@presentation/state/useShapeStore.ts";

import "@presentation/ui/styles/float.css";

/**
 * The playhead readout is rounded to a tenth of a second.
 *
 * Theatre ticks the position atom every frame (30 sub-units per second on this
 * sheet), and a page that re-rendered on each tick would repaint a chat log 30
 * times a second to animate one number. Rounding first means the write happens
 * only when the digit shown changes.
 */
const PLAYHEAD_STEP = 0.1;

const playheadStep = (position: number) => {
  const units = 1 / PLAYHEAD_STEP;
  const step = Math.round(position * units) / units;
  return Number.isFinite(step) ? step : 0;
};

/**
 * The reverse demonstration: a React page with a Theatre.js sphere laid over it.
 *
 * `/showcase` is a page laid over a rigged scene. This route is the inversion, and
 * every layer is inverted with it:
 *
 *   - The **page** is the content. It scrolls, it has a header, a chat log, a
 *     table, buttons. It is a normal React page and nothing about it knows a
 *     canvas exists.
 *   - The **canvas is the overlay**, and it is transparent: `FloatScene` draws a
 *     sphere and nothing else — no floor, no grid, no background, no `<Html>`
 *     cards. Every pixel the WebGL layer does not draw is a pixel of the page
 *     showing through, which is what "floating in front of the page" means. There
 *     is no cutout, no sandbox, no letterboxed box around the 3D.
 *   - The **interactions run both ways**. Tapping the sphere appends a row to the
 *     page's log ("you got me!") and seeks the playhead, which moves the sphere.
 *     The page's own Nudge button seeks the same playhead. Both directions go
 *     through `useSceneStore` and `ISheet`; the mesh never imports the page and the
 *     page never imports a mesh.
 *
 * ## The three props that make an overlay canvas behave
 *
 * A transparent canvas over a live page has one problem a canvas-under-a-page does
 * not: it must be *see-through to the pointer* and *hit-testable by the raycast* at
 * the same time. R3F solves this with three props, and all three are load-bearing:
 *
 *   1. `eventSource={rootRef}` — R3F sets `pointer-events: none` on the canvas and
 *      attaches its listeners to the page root instead. Without it the canvas is a
 *      full-bleed invisible sheet over the user's buttons and the page is dead.
 *      The source must be an **ancestor of everything under the pointer**, because
 *      that is where the events bubble to.
 *   2. `eventPrefix="client"` — R3F's default compute reads `event.offsetX`, which
 *      is relative to the event's *target*: with an event source, the target is the
 *      card the user meant to click, and the raycast lands two hundred pixels off
 *      where the finger was. `client` reads `clientX`, and R3F divides it by the
 *      canvas's size with no origin subtraction — which is exactly right only
 *      because the overlay is `position: fixed; inset: 0`, so the canvas's box
 *      *is* the viewport.
 *   3. `touch-action: pan-y` on the host — the default `none` on `MainCanvas` is
 *      right on a rig bench, where a drag is a camera gesture. Here a drag must
 *      scroll the page, and on iOS a left-edge swipe must stay the system back
 *      gesture.
 *
 * The consequence of (1) is worth stating plainly: the canvas does not swallow
 * clicks, so a tap that hits the sphere also hits whatever DOM element is under it.
 * That is the price of a transparent overlay, and it is the honest one — the
 * alternative is a canvas that eats the page's clicks, which is a worse bug.
 *
 * The same wiring runs the other way, and that half *is* fixable: every pointerdown
 * in the page also runs the mesh handlers, so a tap on the bar's "Replay" that happens
 * to sit over the sphere would select it — and this page logs a row per select, so the
 * button would add hits. `isMeshPressTarget` in `FloatScene.tsx` rejects a press whose
 * event target is inside a button, a link, a form control, the bar or the table, and
 * accepts everything else. It is not a gap-only test: the sphere crosses the full
 * viewport width, so it stands on the hero and the cards, and tapping text it is
 * standing on has to press it.
 */
export default function FloatPage() {
  const navigate = useNavigate();

  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const sheet = getSheet(SCENE_SHEET_IDS.float);
  const playback = useSheetPlayback(sheet);
  const sequence = playback.sequence;

  const [log, setLog] = useState<FloatHitLog>(EMPTY_HIT_LOG);
  const [accent, setAccent] = useState(DEFAULT_ACCENT);
  const [playhead, setPlayhead] = useState(0);
  const [lastSeek, setLastSeek] = useState<number | null>(null);

  const lastEvent = useSceneStore((state) => state.lastEvent);
  const selectedNodeId = useSceneStore((state) => state.selectedNodeId);

  const setActiveScene = useSceneStore((state) => state.setActiveScene);
  const setSelectionVisuals = useSceneStore((state) => state.setSelectionVisuals);
  const setScreen = useAppStore((state) => state.setScreen);
  const setSheetId = useShapeStore((state) => state.setSheetId);

  /**
   * The page owns playback.
   *
   * `FloatScene` deliberately does not call `useSheetPlayback` with an autoplay
   * range: on `/showcase` the scene owns its clip and the page borrows it, and a
   * scene that started the clip on its own here would be a second owner of the same
   * playhead — the page's seek would be racing a clip it did not start.
   *
   * `loop()` alternates, so the circuit runs forever in both directions and the
   * sphere is never yanked back to the start of a loop. `FLOAT_AUTOPLAY` is a module
   * constant: an array literal in a component body is a new array every render.
   *
   * The writes go through `useSheetPlayback`'s exported module-scope helpers, not
   * through the adapter object, and that is what keeps the dependency list honest:
   * `playback` is a fresh object of closures on every render, so it cannot be a
   * dependency, and suppressing `exhaustive-deps` over it costs this whole page its
   * React Compiler pass. `sequence` is the sheet's own object and never changes.
   */
  useEffect(() => {
    seekSequence(sequence, FLOAT_AUTOPLAY[0]);
    loopSequence(sequence, FLOAT_AUTOPLAY);

    return () => {
      pauseSequence(sequence);
    };
  }, [sequence]);

  /**
   * The running playhead, subscribed rather than polled.
   *
   * This is the number the log rows are stamped with, and the reason the Nudge
   * button is legible: the sphere is somewhere on its circuit, and the readout says
   * where.
   */
  useEffect(() => {
    let shown = -1;

    const stop = onChange(sequence.pointer.position, (position) => {
      const step = playheadStep(position);
      if (step === shown) return;
      shown = step;
      setPlayhead(step);
    });

    return stop;
  }, [sequence]);

  /**
   * Sphere → a row in the page's log, and a new position.
   *
   * `lastEvent`, not `selectedNodeId`, for the same reason as on `/showcase`:
   * `selectNode()` writes a fresh `lastEvent` object on every pointer down, while
   * `selectedNodeId` for a second tap on the same sphere is the same string, and a
   * selector on it does not re-render. Tapping the sphere twice has to log twice.
   *
   * The row is stamped with the playhead *before* the seek, so the log says where
   * the sphere was when it was hit, and `lastSeek` says where it went.
   *
   * `lastEvent` is the dependency, and it is the whole dependency: it is a fresh
   * object per pointer down, so the effect runs exactly once per tap. Adding the
   * playback adapter here would run it on every render instead, and this page
   * re-renders ten times a second off the playhead subscription — one tap would
   * append ten rows. The seek goes through `seekSequence` for the same reason the
   * effect above does: a dependency list with `playback` in it is a list that has
   * to be suppressed, and a suppression costs the page its compiler pass.
   */
  useEffect(() => {
    if (lastEvent == null || lastEvent.name !== "node-selected") return;
    if (!isFloatSphere(lastEvent.nodeId)) return;

    const from = sequence.position;
    const hue = randomAccentColor();
    const at = nextSeekTime(sequenceLength(sequence), from);

    setAccent(hue);
    setLog((current) => appendHit(current, from, hue));
    setLastSeek(at);
    seekSequence(sequence, at);
  }, [lastEvent, sequence]);

  /**
   * The Studio panel is hidden for this route, same as every end-user page.
   *
   * `ensureStudio()` is awaited: the panel is shown *by* `initialize()`, so a page
   * that never resolves the studio cannot hide it, and a page that hides it before
   * the import lands loses the race. The cleanup restores visibility rather than
   * force-showing, so `/rig/float` gets the panel back in whatever state it had.
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
    setActiveScene("float");
    setScreen("float");
    setSheetId(SCENE_SHEET_IDS.float);
    StatusBarService.setStyle("dark");

    /**
     * The sphere is a thing you can hit, not rigging furniture, so it does not
     * light up when you hit it. Selection is still recorded — that write *is* the
     * page's input — only the drawing is switched off. Stated on mount, not
     * inherited: `IonRouterOutlet` keeps the page you navigate away from mounted, so
     * coming from `/rig/float` this page would otherwise inherit the bench's flag.
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
   * Wheel over the sphere scrolls the page.
   *
   * The overlay is fixed and the scroller is its sibling, so a wheel that lands on
   * the sphere has no scrollable ancestor and the page sits still. Forwarding
   * `deltaY` is the whole fix.
   */
  const forwardWheel = (event: WheelEvent<HTMLDivElement>) => {
    const host = scrollRef.current;
    if (host == null) return;
    host.scrollTop += event.deltaY;
  };

  const length = playback.length();
  const hasRig = replayRange(length) != null;

  /** Replay from the top: seek first, because `play({range})` starts at the playhead. */
  const replay = () => {
    playback.reset();
    const range = replayRange(playback.length());
    if (range != null) playback.loop(range);
  };

  /** React → 3D: the page moves the sphere, with no mesh in sight. */
  const nudge = () => {
    const at = nextSeekTime(playback.length(), sequence.position);
    setLastSeek(at);
    playback.seek(at);
  };

  const accentStyle = { "--float-accent": accent } as CSSProperties;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={() => navigate("/voice")}>
              <IonIcon slot="icon-only" icon={arrowBackOutline} />
            </IonButton>
          </IonButtons>
          <IonTitle>Float</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent fullscreen className="float-content">
        {/** The event source. R3F attaches its listeners here, so the raycast
            works while the canvas stays transparent to the pointer. */}
        <div className="float" ref={rootRef} onWheel={forwardWheel}>
          {/** Layer 1: the page. Real React content, scrollable, clickable. */}
          <div className="float__scroll" ref={scrollRef}>
            <header className="float__hero">
              <h1>The sphere is on top of this page.</h1>
              <p>
                Not behind it, not in a box cut out of it. The WebGL layer is a fixed, transparent
                overlay over the whole viewport, and <code>FloatScene</code> draws a sphere and
                nothing else — no floor, no grid, no background — so every pixel it does not draw is
                this text.
              </p>
            </header>

            {/** Layer 1a: the log the sphere writes into. */}
            <section className="float__panel">
              <h2>Log</h2>
              <p className="float__hint">
                Tap the sphere. It appends a row here and jumps to a new point on its circuit.
              </p>

              <ul className="float__chat">
                {log.rows.map((row) => (
                  <li key={row.id}>
                    <span className="float__chat__swatch" style={{ background: row.hue }} />
                    <span className="float__chat__id">#{row.id}</span>
                    <span className="float__chat__text">{row.text}</span>
                    <span className="float__chat__at">t {row.playhead.toFixed(2)}s</span>
                  </li>
                ))}
                {log.rows.length === 0 ? (
                  <li className="float__chat__empty">
                    Nothing yet. The sphere is orbiting above this list.
                  </li>
                ) : null}
              </ul>

              <table className="float__table">
                <thead>
                  <tr>
                    <th>Hits</th>
                    <th>Playhead</th>
                    <th>Last seek</th>
                    <th>Selected key</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{log.count}</td>
                    <td>{playhead.toFixed(2)}s</td>
                    <td>{lastSeek == null ? "—" : `${lastSeek.toFixed(2)}s`}</td>
                    <td>{selectedNodeId ?? "—"}</td>
                  </tr>
                </tbody>
              </table>

              <p className="float__foot">{hitSummary(log)}</p>
            </section>

            <article className="float__card">
              <h2>Both directions, one channel</h2>
              <p>
                The sphere writes its <code>theatreKey</code> into <code>useSceneStore</code> on
                pointer down; this page reads <code>lastEvent</code> out of that store, appends a
                row, and calls <code>seek()</code> on the sheet&apos;s sequence. The mesh does not
                know a log exists and this page does not know a mesh exists — the store is the 2D
                channel, the sequence is the 3D one.
              </p>
              <p>
                &ldquo;Move the sphere&rdquo; is <em>seek the playhead</em>, not set a position. The
                orbit is the rig&apos;s property, keyframed on <code>FloatScene</code>, and a page
                that also wrote <code>position.x</code> would be a second owner of the same prop —
                the clip wins, silently, and nothing warns you.
              </p>
            </article>

            <article className="float__card">
              <h2>Why the canvas does not eat your clicks</h2>
              <p>
                A transparent full-bleed canvas is an invisible sheet over the user&apos;s buttons.
                R3F fixes that with <code>eventSource</code>: the canvas gets{" "}
                <code>pointer-events: none</code> and the listeners move to the page root, so the
                raycast runs and the page keeps its own clicks.{" "}
                <code>eventPrefix=&quot;client&quot;</code> is the second half — R3F&apos;s default
                reads <code>offsetX</code>, which is relative to the element the pointer landed on,
                not the canvas.
              </p>
              <p>
                The trade: a tap that hits the sphere also reaches the element under it, because the
                canvas is not a hit target. That is the honest price of an overlay.
              </p>
            </article>

            <article className="float__card">
              <h2>Rig it</h2>
              <p>
                <code>/rig/float</code> mounts this same sheet with the Studio on top of it. The
                orbit is four tracks on one object — <code>position.x</code>,{" "}
                <code>position.y</code>, <code>position.z</code>, <code>rotation.y</code> — landed
                from an export with{" "}
                <code>pnpm run theatre:state -- import &lt;export&gt; --to FloatScene</code>. Change
                the radius, press Save, and this page is flying a different circle on reload.
              </p>
            </article>
          </div>

          {/** Layer 2: the transparent canvas, fixed to the viewport. `inset: 0`
              is what makes `eventPrefix="client"` correct, and `pointer-events:
              none` is what keeps the page alive under it. */}
          <div className="float__overlay">
            <MainCanvas
              scene="float"
              className="float-canvas"
              eventSource={rootRef as RefObject<HTMLElement | null>}
              eventPrefix="client"
              style={{ touchAction: "pan-y" }}
            />
          </div>

          {/** Layer 3: the control bar. */}
          <div className="float__bar" style={accentStyle}>
            <button type="button" className="float__btn" onClick={replay} disabled={!hasRig}>
              <IonIcon icon={refreshOutline} />
              Replay
            </button>
            <button
              type="button"
              className="float__btn float__btn--accent"
              onClick={nudge}
              disabled={!hasRig}
            >
              <IonIcon icon={locationOutline} />
              Nudge
            </button>
            <div className="float__readout">
              <span>
                t {playhead.toFixed(1)} / {length.toFixed(1)}s
              </span>
              <span className="float__swatch" />
              <span>{lastSeek == null ? "no seek yet" : `→ ${lastSeek.toFixed(2)}s`}</span>
            </div>
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
}
