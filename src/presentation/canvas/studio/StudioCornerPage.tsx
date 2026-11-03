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
import { arrowBackOutline, playOutline, squareOutline } from "ionicons/icons";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { IStudio } from "@theatre/studio";

import { SANDBOX_NODES } from "@core/models/scene.ts";
import { StatusBarService } from "@infra/native/StatusBarService.ts";
import { ensureStudio, hideStudioUi, showStudioUi } from "@infra/theatre/studioInit.ts";
import { SHEET_IDS, studioSheet } from "@infra/theatre/project.ts";
import MainCanvas from "@presentation/canvas/MainCanvas.tsx";
import ToolsDock from "@presentation/canvas/studio/tools/ToolsDock.tsx";
import { aimCameraAt } from "@presentation/canvas/studio/shapeTools/aimService.ts";
import { openShapeMenuFromElement } from "@presentation/canvas/studio/shapeTools/shapeMenuController.tsx";
import { useAppStore } from "@presentation/state/useAppStore.ts";
import { useSceneStore } from "@presentation/state/useSceneStore.ts";
import { EMPTY_SHAPES, useShapeStore } from "@presentation/state/useShapeStore.ts";

import "@presentation/ui/styles/studio.css";

/**
 * The Studio Corner.
 *
 * A development route, not a product screen: `/studio-corner` on desktop in dev,
 * where the Theatre.js panel can be opened, a clip can be rigged against the
 * sandbox sheet, and the result can be exported to
 * `infrastructure/theatre/states/`.
 *
 * The toolbar is deliberately minimal HTML rather than Ionic chrome. It sits over
 * a WebGL canvas at `z-index: 50`, and every button here is a call into the
 * Theatre.js sequence API — the point is to be able to read exactly what the
 * button does, not to look like the rest of the app.
 */
export default function StudioCornerPage() {
  const navigate = useNavigate();
  const [studioUiVisible, setStudioUiVisible] = useState(false);
  const [studioReady, setStudioReady] = useState(false);
  const [studio, setStudio] = useState<IStudio | null>(null);

  const selectedNodeId = useSceneStore((state) => state.selectedNodeId);
  const hoveredNodeId = useSceneStore((state) => state.hoveredNodeId);
  const lastEvent = useSceneStore((state) => state.lastEvent);
  const setActiveScene = useSceneStore((state) => state.setActiveScene);
  const emit = useSceneStore((state) => state.emit);
  const setScreen = useAppStore((state) => state.setScreen);

  const addShape = useShapeStore((state) => state.addShape);
  const toolStatus = useShapeStore((state) => state.toolStatus);
  // The sandbox bucket: this page states its sheet on mount, so the readout
  // counts the shapes the sandbox route renders.
  const shapeCount = useShapeStore((state) => (state.shapes[state.sheetId] ?? EMPTY_SHAPES).length);
  const lastAim = useShapeStore((state) => state.lastAim);
  const setSheetId = useShapeStore((state) => state.setSheetId);

  const addShapeButtonRef = useRef<HTMLButtonElement | null>(null);

  /**
   * The Studio is loaded here rather than at app start: it is a devDependency, it
   * is desktop-only, and a panel that appears over the voice screen on a phone is
   * a bug users cannot dismiss.
   *
   * Readiness is state, not a poll. `isStudioAvailable()` is a plain function
   * reading a module-level variable: calling it in render is false on the first
   * paint and nothing re-renders when the dynamic import lands, so the Studio
   * button stays disabled for the whole session. Awaiting `ensureStudio()` and
   * storing the result is what makes the button come alive.
   */
  useEffect(() => {
    let cancelled = false;

    void ensureStudio().then((studio) => {
      if (cancelled || studio == null) {
        return;
      }
      setStudioReady(true);
      setStudio(studio);
      setStudioUiVisible(showStudioUi());
    });

    return () => {
      cancelled = true;
      setStudioUiVisible(false);
      hideStudioUi();
    };
  }, []);

  /** The canvas reads the active scene from the store, so the route owns it. */
  useEffect(() => {
    setActiveScene("studio-sandbox");
    setScreen("studio-corner");

    /**
     * Tell the Studio tools which sheet they are editing. The extension lives
     * outside the canvas and cannot see the mounted `SheetProvider`; a tool that
     * guesses writes to a sheet nobody is looking at, and the write succeeds.
     */
    setSheetId(SHEET_IDS.studioSandbox);

    /** The sandbox is a bench, so the selection highlight is on. Stated on mount,
     * not inherited: `/showcase` leaves its own flag behind on a forward
     * navigation because `IonRouterOutlet` keeps the outgoing page mounted. */
    useSceneStore.getState().setSelectionVisuals(true);

    // A full-bleed dark stage: dark *content* on the status bar, so the icons do
    // not vanish into the canvas on a phone.
    StatusBarService.setStyle("dark");

    return () => {
      setActiveScene("hub");
      setScreen("voice");
      StatusBarService.setStyle("default");
    };
  }, [setActiveScene, setScreen, setSheetId]);

  const playSequence = () => {
    void studioSheet.sequence.play({ range: [0, 3] });
    emit("sequence-played", `range 0→3 @ ${studioSheet.sequence.position.toFixed(2)}s`);
  };

  const resetPlayhead = () => {
    studioSheet.sequence.position = 0;
    emit("sequence-played", "playhead 0s");
  };

  const toggleStudioUi = () => {
    if (studioUiVisible) {
      hideStudioUi();
      setStudioUiVisible(false);
      return;
    }

    setStudioUiVisible(showStudioUi());
  };

  const selectedNode = SANDBOX_NODES.find((node) => node.theatreKey === selectedNodeId) ?? null;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={() => navigate("/voice")}>
              <IonIcon slot="icon-only" icon={arrowBackOutline} />
            </IonButton>
          </IonButtons>
          <IonTitle>Studio Corner</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent fullscreen>
        <div className="studio-stage">
          <MainCanvas scene="studio-sandbox" className="studio-canvas" />

          <div className="studio-toolbar">
            <div className="studio-toolbar__buttons">
              <button type="button" onClick={playSequence}>
                <IonIcon icon={playOutline} />
                Play 0 → 3
              </button>
              <button type="button" onClick={resetPlayhead}>
                <IonIcon icon={squareOutline} />
                Reset playhead
              </button>
              <button
                type="button"
                ref={addShapeButtonRef}
                title="Open the shape menu — spawns an editable.mesh"
                onClick={() => {
                  const anchor = addShapeButtonRef.current;
                  if (anchor == null) return;
                  openShapeMenuFromElement(anchor, addShape);
                }}
              >
                Add Shape ▾
              </button>
              <button
                type="button"
                disabled={studio == null}
                title={
                  studio == null
                    ? "Aim needs the Studio: it writes through studio.transaction()"
                    : "Rotate the Theatre camera onto the selected object"
                }
                onClick={() => {
                  if (studio == null) return;
                  const outcome = aimCameraAt(studio, null);
                  if (!outcome.ok) useShapeStore.getState().setToolStatus(outcome.reason);
                }}
              >
                Aim Camera
              </button>
              <button
                type="button"
                onClick={toggleStudioUi}
                disabled={!studioReady}
                title={
                  studioReady
                    ? "Show or hide the Theatre.js Studio panel"
                    : "The Studio only loads in dev, on a desktop browser"
                }
              >
                {studioUiVisible ? "Hide Studio" : "Toggle Studio"}
              </button>
            </div>

            {/**
             * The 2D side of the bridge. Click a cube in the canvas and this is
             * what changes — if it does not, the store write is broken and not
             * the renderer.
             */}
            <dl className="studio-toolbar__readout">
              <div>
                <dt>Selected</dt>
                <dd>
                  {selectedNode == null
                    ? "—"
                    : `${selectedNode.theatreKey} · ${selectedNode.label}`}
                </dd>
              </div>
              <div>
                <dt>Hovered</dt>
                <dd>{hoveredNodeId ?? "—"}</dd>
              </div>
              <div>
                <dt>Last event</dt>
                <dd>
                  {lastEvent == null ? "—" : `${lastEvent.name} (${lastEvent.nodeId ?? "n/a"})`}
                </dd>
              </div>
              <div>
                <dt>Shapes</dt>
                <dd>{shapeCount === 0 ? "—" : `${shapeCount} spawned`}</dd>
              </div>
              <div>
                <dt>Tool</dt>
                <dd>{toolStatus}</dd>
              </div>
              <div>
                <dt>Last aim</dt>
                <dd>
                  {lastAim == null
                    ? "—"
                    : `${lastAim.cameraKey} → ${lastAim.targetKey ?? "target"} @ ${lastAim.distance.toFixed(2)}m`}
                </dd>
              </div>
            </dl>
          </div>
          <ToolsDock studio={studio} />
        </div>
      </IonContent>
    </IonPage>
  );
}
