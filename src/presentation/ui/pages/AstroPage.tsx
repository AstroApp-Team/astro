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
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  RefObject,
  WheelEvent,
} from "react";
import { useNavigate } from "react-router-dom";

import { ASTRO_COLOURS, ASTRO_STATES } from "@core/models/astro.ts";
import { ASTRO_AUTOPLAY } from "@core/models/scene.ts";
import {
  ASTRO_REACTION_MS,
  isAstroNode,
  isTransient,
  lookTowards,
} from "@core/usecases/astroExpression.ts";
import {
  EMPTY_ASTRO_HIT_LOG,
  appendAstroHit,
  astroHitSummary,
  hitReaction,
  nextAstroSeek,
  rollAstroAccent,
  type AstroHitLog,
} from "@core/usecases/astroInteraction.ts";

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
import { useAstroStore } from "@presentation/state/useAstroStore.ts";
import { useSceneStore } from "@presentation/state/useSceneStore.ts";
import { useShapeStore } from "@presentation/state/useShapeStore.ts";

import "@presentation/ui/styles/astro.css";

/**
 * Playhead readout, rounded to a tenth of a second.
 *
 * Theatre ticks the position atom every frame; a page that re-rendered on each tick
 * would repaint the log 30 times a second to animate one digit. Rounding first means
 * the write happens only when the number shown changes.
 */
const PLAYHEAD_STEP = 0.1;

const playheadStep = (position: number) => {
  const units = 1 / PLAYHEAD_STEP;
  const step = Math.round(position * units) / units;
  return Number.isFinite(step) ? step : 0;
};

/**
 * The expressions the mouse may overwrite.
 *
 * "Eyes follow the pointer" is a *resting* behaviour: it belongs to `idle` and the
 * three `look-*` placements. A character the user has put to sleep, or a reaction
 * that is playing, is not following anything — and letting the pointer win there
 * would make `doze` unreachable with a mouse, because the first `pointermove` after
 * the click would replace it.
 */
const POINTER_FOLLOW_STATES: ReadonlySet<string> = new Set([
  "idle",
  "look-left",
  "look-right",
  "look-right-shifted",
]);

/**
 * Astro over a React page — the character version of the `/float` demonstration.
 *
 * The arrangement is `/float`'s, unchanged, because that wiring is the whole point
 * of the route and this page exists to prove it generalises:
 *
 *   - the **page** is the content: hero, expression picker, tap log, table, bar;
 *   - the **canvas is a transparent overlay** (`AstroScene` draws the character and
 *     nothing else, so every pixel it does not draw is this text);
 *   - `eventSource` + `eventPrefix="client"` + a `position: fixed; inset: 0`
 *     overlay, in that combination, is what makes the raycast work while the page
 *     keeps its own clicks;
 *   - the **page owns playback** — the scene does not autoplay, this page seeks and
 *     loops the drift, and "move the character" means seek the playhead.
 *
 * What is different from `/float` is where the character's *face* lives. A sphere
 * is one prop, so the rig could own it. A face is a texture swap across 12 states,
 * and a keyframed face plus a store-driven one is two owners of one prop — the clip
 * would win, silently, and the expression buttons would appear to do nothing. So
 * the rig owns `position` and the store owns `expression`, and neither file mentions
 * the other's prop.
 *
 * The consequence of the overlay, stated again because it is the one thing that
 * looks like a bug: the canvas is not a hit target, so a tap on Astro also reaches
 * the element under it. Making the canvas a hit target would eat the page's clicks —
 * the worse bug. The inverse direction is gated: `isMeshPressTarget` in
 * `AstroScene.tsx` rejects any press that starts inside a button, a link, a form
 * control, the bar, the table or the expression picker.
 */
export default function AstroPage() {
  const navigate = useNavigate();

  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const sheet = getSheet(SCENE_SHEET_IDS.astro);
  const playback = useSheetPlayback(sheet);
  const sequence = playback.sequence;

  const expression = useAstroStore((state) => state.expression);
  const resting = useAstroStore((state) => state.resting);
  const setExpression = useAstroStore((state) => state.setExpression);
  const settle = useAstroStore((state) => state.settle);

  const [log, setLog] = useState<AstroHitLog>(EMPTY_ASTRO_HIT_LOG);
  const [accent, setAccent] = useState<string>(ASTRO_COLOURS.bodyMid);
  const [playhead, setPlayhead] = useState(0);
  const [lastSeek, setLastSeek] = useState<number | null>(null);

  const lastEvent = useSceneStore((state) => state.lastEvent);
  const selectedNodeId = useSceneStore((state) => state.selectedNodeId);

  const setActiveScene = useSceneStore((state) => state.setActiveScene);
  const setSelectionVisuals = useSceneStore((state) => state.setSelectionVisuals);
  const setScreen = useAppStore((state) => state.setScreen);
  const setSheetId = useShapeStore((state) => state.setSheetId);

  /**
   * The page owns the clip.
   *
   * `palette.sequence`-level writes go through the module-scope helpers and the deps
   * are `[sequence]`: `playback` is a fresh object of closures every render, so it
   * cannot be a dependency without re-running the effect every render, and
   * suppressing `exhaustive-deps` over it would cost this page its React Compiler
   * pass. `ASTRO_AUTOPLAY` is a module constant for the same reason.
   */
  useEffect(() => {
    seekSequence(sequence, ASTRO_AUTOPLAY[0]);
    loopSequence(sequence, ASTRO_AUTOPLAY);

    return () => {
      pauseSequence(sequence);
    };
  }, [sequence]);

  /** The running playhead, subscribed rather than polled. */
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
   * A tap on the character: a row, a new face, and a new place to stand.
   *
   * `lastEvent`, not `selectedNodeId` — a second tap writes the same string there, so
   * a selector on it does not re-render and the log records one row for ten taps.
   * The effect reads the store's actions with `getState()` rather than subscribing:
   * `expression` changes constantly (the reaction, the pointer, the picker), and a
   * dependency on it would re-run this effect and append a row per expression change.
   *
   * The row is stamped with the playhead *before* the seek, so the log says where
   * the character was when it was tapped and `lastSeek` says where it went.
   */
  useEffect(() => {
    if (lastEvent == null || lastEvent.name !== "node-selected") return;
    if (!isAstroNode(lastEvent.nodeId)) return;

    const { expression: current, react } = useAstroStore.getState();
    const from = sequence.position;
    const at = nextAstroSeek(sequenceLength(sequence), from);

    setAccent(rollAstroAccent());
    setLog((logNow) => appendAstroHit(logNow, from, hitReaction(current)));
    setLastSeek(at);
    react();
    seekSequence(sequence, at);
  }, [lastEvent, sequence]);

  /**
   * End a reaction after its hold.
   *
   * `isTransient` is the model's own predicate, so the set of states that need an
   * exit is stated once, in `core/`. The timer is keyed on `expression`: a new
   * reaction replaces the timer instead of racing it.
   */
  useEffect(() => {
    if (!isTransient(expression)) return;

    const timer = window.setTimeout(() => settle(), ASTRO_REACTION_MS.max);
    return () => window.clearTimeout(timer);
  }, [expression, settle]);

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
    setActiveScene("astro");
    setScreen("astro");
    setSheetId(SCENE_SHEET_IDS.astro);
    StatusBarService.setStyle("dark");

    /**
     * The character is a thing you can tap, not rigging furniture, so it does not
     * light up. Selection is still recorded — that write is the page's input.
     * Stated on mount, not inherited: `IonRouterOutlet` keeps the outgoing page
     * mounted, so coming from `/rig/astro` this page would otherwise inherit the
     * bench's highlight flag.
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
   * Eyes follow a mouse, quantised.
   *
   * The stylesheet has seven eye placements and no continuous movement, so "look at
   * the pointer" is a choice between states, not an interpolation — interpolating
   * produces positions the sheet never draws, which is how a character stops looking
   * like itself. The store only changes when the placement changes, so this is a
   * few writes per screen-width of mouse travel, not one per event.
   *
   * Mouse only: on a phone every scroll is a pointer move, and a character that
   * stares at your thumb mid-scroll is not a character that is paying attention.
   */
  const followPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse") return;

    const store = useAstroStore.getState();
    if (!POINTER_FOLLOW_STATES.has(store.expression)) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const width = rect.width > 0 ? rect.width : 1;
    const height = rect.height > 0 ? rect.height : 1;
    const dx = ((event.clientX - rect.left) / width - 0.5) * 0.5;
    const dy = ((event.clientY - rect.top) / height - 0.5) * 0.5;

    const next = lookTowards(dx, dy);
    if (next !== store.expression) store.setExpression(next);
  };

  /** Wheel over the character scrolls the page: the overlay has no scrollable ancestor. */
  const forwardWheel = (event: WheelEvent<HTMLDivElement>) => {
    const host = scrollRef.current;
    if (host == null) return;
    host.scrollTop += event.deltaY;
  };

  const length = playback.length();

  /** Replay the drift from the top. Seeking first, because `play` starts at the playhead. */
  const replay = () => {
    playback.reset();
    seekSequence(sequence, ASTRO_AUTOPLAY[0]);
    loopSequence(sequence, ASTRO_AUTOPLAY);
  };

  /** React → 3D: the page moves the character, with no mesh in sight. */
  const nudge = () => {
    const at = nextAstroSeek(length, sequence.position);
    setLastSeek(at);
    playback.seek(at);
  };

  const accentStyle = { "--astro-accent": accent } as CSSProperties;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={() => navigate("/voice")}>
              <IonIcon slot="icon-only" icon={arrowBackOutline} />
            </IonButton>
          </IonButtons>
          <IonTitle>Astro</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent fullscreen className="astro-content">
        {/** The event source. R3F attaches its listeners here, so the raycast works
            while the canvas stays transparent to the pointer. */}
        <div className="astro" ref={rootRef} onWheel={forwardWheel} onPointerMove={followPointer}>
          {/** Layer 1: the page. */}
          <div className="astro__scroll" ref={scrollRef}>
            <header className="astro__hero">
              <h1>
                Astro is <em>on top of</em> this page.
              </h1>
              <p>
                Not drawn in a box cut out of the text, and not a background image. The WebGL layer
                is a fixed, transparent overlay over the whole viewport, and <code>AstroScene</code>{" "}
                draws one plane — the character — and nothing else. Every pixel it does not draw is
                this sentence.
              </p>
            </header>

            {/** Layer 1a: the expression picker. The face is app state, not a clip. */}
            <section className="astro__panel">
              <h2>The face</h2>
              <p className="astro__hint">
                Twelve states, transcribed from the stylesheet. Pick one; a reaction returns to it.
                Move a mouse and the eyes follow, in the sheet&apos;s own placements.
              </p>

              <div className="astro__states">
                {ASTRO_STATES.map((state) => (
                  <button
                    key={state}
                    type="button"
                    className={
                      state === expression ? "astro__state astro__state--active" : "astro__state"
                    }
                    onClick={() => setExpression(state)}
                  >
                    {state.replaceAll("-", " ")}
                  </button>
                ))}
              </div>

              <p className="astro__foot">
                showing <strong>{expression}</strong> · returns to <strong>{resting}</strong>
                {isTransient(expression) ? " · reaction, ending on its own" : ""}
              </p>
            </section>

            {/** Layer 1b: the log the character writes into. */}
            <section className="astro__panel">
              <h2>Log</h2>
              <p className="astro__hint">
                Tap Astro. It appends a row here, greets you, and drifts a quarter-turn along its
                clip.
              </p>

              <ul className="astro__chat">
                {log.rows.map((row) => (
                  <li key={row.id}>
                    <span className="astro__chat__id">#{row.id}</span>
                    <span className="astro__chat__text">{row.text}</span>
                    <span className="astro__chat__face">{row.expression}</span>
                    <span className="astro__chat__at">t {row.playhead.toFixed(2)}s</span>
                  </li>
                ))}
                {log.rows.length === 0 ? (
                  <li className="astro__chat__empty">
                    Nothing yet. The character is drifting over this list.
                  </li>
                ) : null}
              </ul>

              <table className="astro__table">
                <thead>
                  <tr>
                    <th>Taps</th>
                    <th>Expression</th>
                    <th>Playhead</th>
                    <th>Last seek</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{log.count}</td>
                    <td>{expression}</td>
                    <td>{playhead.toFixed(2)}s</td>
                    <td>{lastSeek == null ? "—" : `${lastSeek.toFixed(2)}s`}</td>
                  </tr>
                </tbody>
              </table>

              <p className="astro__foot">{astroHitSummary(log)}</p>
              <p className="astro__foot">selected key: {selectedNodeId ?? "—"}</p>
            </section>

            <article className="astro__card">
              <h2>One owner per prop</h2>
              <p>
                The rig owns <code>position</code> — <code>AstroScene</code> keyframes a slow drift
                on the sheet, and the page only ever <em>seeks</em> it. The store owns{" "}
                <code>expression</code>, because a face is a texture swap and a keyframed face would
                silently win over the picker above. Two owners of one prop is the bug this page is
                built to avoid, not a style preference.
              </p>
              <p>
                Taps travel one way and expressions the other, through{" "}
                <code>useSceneStore.lastEvent</code> and <code>useAstroStore</code>. The mesh does
                not know a log exists; this page does not know a plane exists.
              </p>
            </article>

            <article className="astro__card">
              <h2>Rig it</h2>
              <p>
                <code>/rig/astro</code> mounts this same sheet with the Studio on top of it. The
                drift is three tracks on one object — <code>position.x</code>,{" "}
                <code>position.y</code>, <code>position.z</code> — landed with{" "}
                <code>pnpm run theatre:state -- import &lt;export&gt; --to AstroScene</code>. Add a
                track for the face and the picker stops mattering, so do not.
              </p>
            </article>
          </div>

          {/** Layer 2: the transparent canvas, fixed to the viewport. `inset: 0` is what
              makes `eventPrefix="client"` correct; `pointer-events: none` is what keeps
              the page alive under it. */}
          <div className="astro__overlay">
            <MainCanvas
              scene="astro"
              className="astro-canvas"
              eventSource={rootRef as RefObject<HTMLElement | null>}
              eventPrefix="client"
              style={{ touchAction: "pan-y" }}
            />
          </div>

          {/** Layer 3: the control bar. */}
          <div className="astro__bar" style={accentStyle}>
            <button type="button" className="astro__btn" onClick={replay}>
              <IonIcon icon={refreshOutline} />
              Replay
            </button>
            <button
              type="button"
              className="astro__btn astro__btn--accent"
              onClick={nudge}
              disabled={length <= 0}
            >
              <IonIcon icon={locationOutline} />
              Nudge
            </button>
            <div className="astro__readout">
              <span>
                t {playhead.toFixed(1)} / {length.toFixed(1)}s
              </span>
              <span className="astro__swatch" />
              {/* Short by necessity: the bar is a single row inside 366 px, and
                  a longer caption pushes the readout out of the viewport. */}
              <span>{lastSeek == null ? "—" : `→ ${lastSeek.toFixed(2)}s`}</span>
            </div>
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
}
