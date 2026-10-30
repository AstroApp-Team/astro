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
import { arrowBackOutline, refreshOutline } from "ionicons/icons";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, WheelEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";

import type { SceneId } from "@core/models/scene.ts";
import { isSceneId } from "@core/models/scene.ts";
import {
  DEFAULT_ACCENT,
  findDynamicShape,
  randomAccentColor,
  replayRange,
} from "@core/usecases/showcaseInteraction.ts";
import { StatusBarService } from "@infra/native/StatusBarService.ts";
import { SCENE_SHEET_IDS, getSheet } from "@infra/theatre/project.ts";
import { ensureStudio, hideStudioUi, showStudioUi } from "@infra/theatre/studioInit.ts";
import { useSheetPlayback } from "@infra/theatre/useSheetPlayback.ts";
import MainCanvas from "@presentation/canvas/MainCanvas.tsx";
import { useAppStore } from "@presentation/state/useAppStore.ts";
import { useSceneStore } from "@presentation/state/useSceneStore.ts";
import { useShapeStore } from "@presentation/state/useShapeStore.ts";
import ShowcasePanelHost from "@presentation/ui/components/showcasePanels/ShowcasePanelHost.tsx";
import {
  SHOWCASE_PANELS,
  showcasePanelFor,
} from "@presentation/ui/components/showcasePanels/registry.ts";

/**
 * `studio.css` is imported for one rule: `.node-card`, the card drei's `<Html>`
 * renders inside `EditableNodePrefab`. The sting scene mounts five of them, and
 * a page that deep-links straight to `/showcase` has never loaded the bench that
 * normally pulls this file in — without it the labels are unstyled text floating
 * at the default font size, which reads as a layout bug in the scene.
 */
import "@presentation/ui/styles/studio.css";
import "@presentation/ui/styles/showcase.css";

/**
 * The integrated page: a production Theatre.js scene under a scrolling React page.
 *
 * This is the "what an end user sees" surface. It mounts the *same* scene
 * component the rig bench mounts — same sheet, same exported state, same spawned
 * shapes — and shows none of the editing chrome: no Studio panel, no outliner, no
 * Add Shape, no Save, no playhead readout.
 *
 * Two integrations, both going through the channels the project already has:
 *
 *   **Replay** — `useSheetPlayback(getSheet(SCENE_SHEET_IDS[scene]))` hands the
 *   page the same `ISheet` the scene itself mounted (sheets are cached at module
 *   scope in `project.ts`), so the button drives the sequence the Studio keyframed.
 *
 *   **Sphere → colour** — `SpawnedShapeMesh` writes its `theatreKey` into
 *   `useSceneStore` on pointer down. The page reads `lastEvent` out of that store
 *   and asks `findDynamicShape` whether the key belongs to a shape the Studio
 *   *spawned*. If it does, the button gets a new random hue. The page never
 *   touches a mesh, and the mesh never touches the button — the store is the
 *   2D ↔ 3D channel, exactly as in `StudioCornerPage`.
 *
 * Because it reads the sheet and the shape store, it reflects whatever the Studio
 * page saved: keyframes from `states/astro.local.state.json` (dev) merged over the
 * landed `states/portfolio-project.state.json`, shapes from
 * `astro.local.shapes.json`. Save on `/rig/sting`, come here, reload, and the
 * animation and the sphere are the ones you just saved.
 *
 * Route: `/showcase` (defaults to the sting) and `/showcase/:sceneId` for any
 * scene in `SCENE_IDS`.
 */
export default function ShowcasePage() {
  const navigate = useNavigate();
  const { sceneId } = useParams<{ sceneId?: string }>();
  const scene: SceneId = isSceneId(sceneId) ? sceneId : "sting";

  const setActiveScene = useSceneStore((state) => state.setActiveScene);
  const setSelectionVisuals = useSceneStore((state) => state.setSelectionVisuals);
  const setScreen = useAppStore((state) => state.setScreen);
  const setSheetId = useShapeStore((state) => state.setSheetId);

  /**
   * The Studio panel is hidden for as long as this page is mounted.
   *
   * In dev, `main.tsx` initialises the Studio on every route, and its panel is a
   * `position: fixed` overlay at `z-index: 100` — left alone it would sit over the
   * end-user page. `ensureStudio()` is awaited rather than skipped: the panel is
   * shown *by* `initialize()`, so a page that never resolves the studio cannot
   * hide it, and a page that hides it before the import lands loses the race
   * (same reason `RigPage` and `StudioCornerPage` await it).
   *
   * The cleanup restores visibility rather than force-showing, so walking back to
   * `/rig/sting` returns the panel to whatever state the rig bench had it in.
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

  /** The canvas reads the active scene from the store, so the route owns it. */
  useEffect(() => {
    setActiveScene(scene);
    setScreen("showcase");
    /**
     * The sheet the Studio tools act on, kept pointing at what is on screen.
     * This page edits nothing, and the write is still worth making: a page that
     * leaves it pointing at the sandbox means the next bench you open aims its
     * tools at a sheet nobody is rendering.
     */
    setSheetId(SCENE_SHEET_IDS[scene]);
    StatusBarService.setStyle("dark");

    /**
     * No selection highlight on this page. The scene is a stage, not a bench: a
     * sphere that lights up on tap is telling the user these objects are
     * selectable, which is the rigging side's promise, not this page's. The tap
     * itself still writes the selection — that write is the page's own hook — only
     * the drawing is switched off. See `showsSelectionHighlight` in
     * `core/usecases/showcaseInteraction.ts`.
     *
     * The rig benches state the other value on their own mount rather than
     * trusting this cleanup: `IonRouterOutlet` keeps the page you navigate away
     * from mounted, so on a forward navigation the outgoing page's cleanup does not
     * run and the flag would follow the user into `/rig/<scene>`.
     */
    setSelectionVisuals(false);

    return () => {
      setActiveScene("hub");
      setScreen("voice");
      StatusBarService.setStyle("default");
      setSelectionVisuals(true);
    };
  }, [scene, setActiveScene, setScreen, setSheetId, setSelectionVisuals]);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={() => navigate("/voice")}>
              <IonIcon slot="icon-only" icon={arrowBackOutline} />
            </IonButton>
          </IonButtons>
          <IonTitle>Showcase</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent fullscreen className="showcase-content">
        <ShowcaseStage scene={scene} />
      </IonContent>
    </IonPage>
  );
}

type ShowcaseStageProps = { scene: SceneId };

/**
 * The playhead readout is rounded to a tenth of a second.
 *
 * Theatre ticks the position atom every frame of playback — this sheet is 30
 * sub-units per second — and a page that re-rendered on each tick would repaint
 * the whole story 30 times a second to animate one number. Rounding first means
 * the state write happens only when the digit shown actually changes.
 */
const PLAYHEAD_STEP = 0.1;

const playheadStep = (position: number) => {
  const units = 1 / PLAYHEAD_STEP;
  const step = Math.round(position * units) / units;
  return Number.isFinite(step) ? step : 0;
};

/**
 * The stage + story + control bar.
 *
 * Split out of the page so the playback hooks sit on a component whose only props
 * are the scene, and whose renders are driven by the accent colour and the
 * selection — not by the router.
 */
function ShowcaseStage({ scene }: ShowcaseStageProps) {
  const sheet = getSheet(SCENE_SHEET_IDS[scene]);
  const playback = useSheetPlayback(sheet);
  const sheetId = SCENE_SHEET_IDS[scene];

  const [accent, setAccent] = useState(DEFAULT_ACCENT);
  const [lastHit, setLastHit] = useState<string | null>(null);
  const [panelKey, setPanelKey] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);

  const sequence = playback.sequence;

  const shapes = useShapeStore((state) => state.shapes);
  const lastEvent = useSceneStore((state) => state.lastEvent);
  const selectedNodeId = useSceneStore((state) => state.selectedNodeId);

  /**
   * Sphere → random colour.
   *
   * Keyed on `lastEvent`, not on `selectedNodeId`: `selectNode` writes a fresh
   * `lastEvent` object on every pointer down, while `selectedNodeId` for a
   * second click on the *same* sphere is the same string — a selector on it
   * would not re-render, and tapping the sphere twice would change the colour
   * once.
   */
  useEffect(() => {
    if (lastEvent == null || lastEvent.name !== "node-selected") return;

    const shape = findDynamicShape(shapes, lastEvent.nodeId);
    if (shape == null) return;

    setAccent(randomAccentColor());
    setLastHit(shape.theatreKey);
  }, [lastEvent, shapes]);

  /**
   * Satellite cube → panel.
   *
   * The same `lastEvent` subscription as the sphere hook, for the same reason: a
   * second tap on the *same* cube has to be a second event, and a selector on
   * `selectedNodeId` cannot deliver that — the string is unchanged, the component
   * does not re-render, and the panel would never close.
   *
   * Toggling on the key is what a card sitting on top of a cube invites: the card
   * is the panel's tab, so tapping the cube that is already open closes it. Keys
   * the registry does not know — the core, the spawned sphere, any shape the Studio
   * adds — open nothing.
   */
  useEffect(() => {
    if (lastEvent == null || lastEvent.name !== "node-selected") return;

    const nodeId = lastEvent.nodeId;
    if (nodeId == null || showcasePanelFor(nodeId) == null) return;

    setPanelKey((open) => (open === nodeId ? null : nodeId));
  }, [lastEvent]);

  /**
   * A panel belongs to the scene that owns its cube.
   *
   * Changing `/showcase/:sceneId` re-points the canvas at a different sheet, and
   * the four keys are `sting`'s. Without this, navigating to another scene leaves a
   * sheet open for a cube that is no longer mounted.
   */
  useEffect(() => {
    setPanelKey(null);
  }, [scene]);

  const closePanel = () => setPanelKey(null);
  const panelEntry = showcasePanelFor(panelKey);

  const length = playback.length();
  const hasRig = replayRange(length) != null;

  /**
   * The playhead, read off the sequence itself.
   *
   * This is the page's only read of live Theatre state, and it is a subscription
   * rather than a poll: `onChange()` on the position pointer fires with the live
   * value, so the number in the bar is the sheet's playhead and not a timer the
   * page started. It is also what makes the replay button legible — the number
   * runs while the clip runs, and stops where the clip stops.
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
   * Wheel over the scene scrolls the story.
   *
   * The story is its own scroller (`.showcase__scroll`), and the canvas is its
   * sibling — so a wheel that lands on the exposed band of scene has no
   * scrollable ancestor and the page sits still. Forwarding `deltaY` is the
   * whole fix; `preventDefault` is not needed and React registers `wheel`
   * passively anyway, and nothing else can scroll here because IonContent's own
   * overflow is switched off in `showcase.css`.
   */
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const forwardWheel = (event: WheelEvent<HTMLDivElement>) => {
    const host = scrollRef.current;
    if (host == null) return;
    host.scrollTop += event.deltaY;
  };

  /**
   * Replay from the top.
   *
   * `reset()` first, deliberately: `sequence.play({range})` starts from the
   * *current* playhead whenever that playhead is inside the range, so pressing
   * replay on a finished clip (playhead parked on `to`) would start at `to` and
   * end immediately, and pressing it after scrubbing would pick up mid-clip.
   * Seek, then play.
   */
  const replay = () => {
    const range = replayRange(playback.length());
    playback.reset();
    if (range != null) playback.play(range);
  };

  const accentStyle = { "--showcase-accent": accent } as CSSProperties;

  return (
    <div className="showcase">
      {/**
       * Layer 0: the scene, full-bleed. `touchAction: "pan-y"` overrides
       * `MainCanvas`'s inline `none`, which is right on the rig benches (a drag
       * there is a camera gesture) and wrong on a page the user scrolls: with
       * `none`, a drag that starts on the scene is swallowed by the canvas and an
       * iOS left-edge swipe becomes the native back gesture. `pan-y` keeps the tap
       * R3F raycasts and hands the vertical axis back to the browser.
       */}
      <div className="showcase__stage" onWheel={forwardWheel}>
        <MainCanvas scene={scene} className="showcase-canvas" style={{ touchAction: "pan-y" }} />
        <p className="showcase__stage-label">
          {sheetId} · {hasRig ? `${length}s rig` : "no rig on this sheet yet"}
        </p>
      </div>

      {/**
       * Layer 1: the story, scrolling over the scene.
       *
       * `pointer-events: none` on the scroller and `auto` on its blocks is the
       * whole reason the sphere is clickable: the gaps between cards are
       * transparent to the pointer, so a tap there lands on the canvas and R3F
       * raycasts it. A scroller that owned the pointer would swallow every tap
       * and the 3D half of this page would be decorative.
       */}
      <div className="showcase__scroll" ref={scrollRef}>
        {/** The band of bare scene at the top. A child's `height: %` resolves
            against the scroller's height; a `padding-top: %` would resolve
            against its *width* and land far too high on a phone. */}
        <div className="showcase__spacer" />

        <div className="showcase__cue">
          <span>Scroll · the scene keeps playing behind you</span>
        </div>

        <article className="showcase__card">
          <h2>{scene}</h2>
          <p>
            The canvas is the production scene component — the same JSX, the same Theatre.js sheet{" "}
            <code>{sheetId}</code>, the same exported keyframes the rig bench writes. This page adds
            no animation code of its own.
          </p>
        </article>

        <article className="showcase__card">
          <h2>Replay</h2>
          <p>
            The bar below seeks the sheet&apos;s sequence to <code>0</code> and plays it to{" "}
            <code>{length}s</code>. It is a plain call into the same sequence the Studio scrubs —
            nothing here owns the animation, it only asks for it.
          </p>
        </article>

        <article className="showcase__card">
          <h2>Tap the sphere</h2>
          <p>
            The sphere is not in the scene&apos;s data array. It exists because it was spawned in
            the Studio with <em>Add Shape</em> and saved, and it is mounted from the shape store.
            Tapping it writes its <code>theatreKey</code> into the scene store; this page reads that
            and rolls a new hue onto the replay button. The mesh itself does not light up — the
            selection highlight is rigging furniture, and this page switches it off with
            <code>setSelectionVisuals(false)</code>.
          </p>
          <p>
            Spawned shapes are dev-only: the Studio&apos;s Save file is what mounts them, and a
            production build seeds none. A rig that has to ship with a sphere moves it into the
            scene&apos;s own node array.
          </p>
          <p className="showcase__card__meta">
            {shapes.length === 0
              ? `Nothing is mounted here from the shape store — spawn one on /rig/${scene} and press Save.`
              : `${shapes.length} spawned shape${shapes.length === 1 ? "" : "s"} mounted: ${shapes
                  .map((shape) => shape.theatreKey)
                  .join(", ")}`}
            <br />
            Last shape hit: <code>{lastHit ?? "—"}</code>
            <br />
            Selected in scene, unhighlighted: <code>{selectedNodeId ?? "—"}</code>
          </p>
        </article>

        <article className="showcase__card">
          <h2>Four satellites, four panels</h2>
          <p>
            Each satellite cube opens a panel of its own, and each panel is its own component with
            its own state and its own stylesheet. The page resolves a cube&apos;s{" "}
            <code>theatreKey</code> through a registry and mounts what it finds; it knows a title,
            and nothing about what is inside any of them.
          </p>
          <p>
            A panel is named after the label its cube paints, so the card you tap and the sheet that
            opens say the same word. Tap the cube again to close it, or use its Done, the ✕, the
            sheet&apos;s background, or Escape.
          </p>
          <p>
            The core opens nothing on purpose: it is what the ring is arranged around, and a panel
            for it means a tap anywhere near the middle of the frame drops a sheet over the scene.
          </p>
          <p className="showcase__card__meta">
            {Object.entries(SHOWCASE_PANELS)
              .map(([key, entry]) => `${entry.title} ← ${key}`)
              .join(" · ")}
            <br />
            Open panel: <code>{panelEntry?.title ?? "none"}</code>
          </p>
        </article>

        <article className="showcase__card">
          <h2>What you cannot do here</h2>
          <p>
            There is no Studio panel, no outliner, no stopwatch, no Save. Rig on{" "}
            <code>/rig/{scene}</code>, press Save, and this page shows the result on reload —
            keyframes and spawned shapes both come from the files the Studio writes.
          </p>
        </article>
      </div>

      {/**
       * Layer 1.5: the panel a satellite cube opened. Its own layer with its own
       * stylesheet, and short by construction — the satellites sit at 42–50% of the
       * canvas height at the end of the rig, so a sheet that grew past the lower
       * half of the frame would cover the cubes that open it. See
       * `styles/showcase-panels.css`.
       */}
      <ShowcasePanelHost entry={panelEntry} onClose={closePanel} />

      {/**
       * Layer 2: the control bar. Absolute inside the page, so it stays put
       * while the story scrolls under it.
       */}
      <div className="showcase__bar" style={accentStyle}>
        <button type="button" className="showcase__replay" onClick={replay} disabled={!hasRig}>
          <IonIcon icon={refreshOutline} />
          Replay {scene}
        </button>
        <div className="showcase__bar__readout">
          <span>
            t {playhead.toFixed(1)} / {length.toFixed(1)}s
          </span>
          <span className="showcase__swatch" />
          <span>{accent}</span>
        </div>
      </div>
    </div>
  );
}
