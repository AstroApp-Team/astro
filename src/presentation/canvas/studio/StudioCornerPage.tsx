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
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { SANDBOX_NODES } from "@core/models/scene.ts";
import { StatusBarService } from "@infra/native/StatusBarService.ts";
import {
  hideStudioUi,
  initTheatreStudio,
  isStudioAvailable,
  showStudioUi,
} from "@infra/theatre/studioInit.ts";
import { studioSheet } from "@infra/theatre/project.ts";
import MainCanvas from "@presentation/canvas/MainCanvas.tsx";
import { useAppStore } from "@presentation/state/useAppStore.ts";
import { useSceneStore } from "@presentation/state/useSceneStore.ts";

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

  const selectedNodeId = useSceneStore((state) => state.selectedNodeId);
  const hoveredNodeId = useSceneStore((state) => state.hoveredNodeId);
  const lastEvent = useSceneStore((state) => state.lastEvent);
  const setActiveScene = useSceneStore((state) => state.setActiveScene);
  const emit = useSceneStore((state) => state.emit);
  const setScreen = useAppStore((state) => state.setScreen);

  /**
   * The Studio is loaded here rather than at app start: it is a devDependency, it
   * is desktop-only, and a panel that appears over the voice screen on a phone is
   * a bug users cannot dismiss.
   */
  useEffect(() => {
    void initTheatreStudio();
  }, []);

  /** The canvas reads the active scene from the store, so the route owns it. */
  useEffect(() => {
    setActiveScene("studio-sandbox");
    setScreen("studio-corner");
    // A full-bleed dark stage: dark *content* on the status bar, so the icons do
    // not vanish into the canvas on a phone.
    StatusBarService.setStyle("dark");

    return () => {
      setActiveScene("hub");
      setScreen("voice");
      StatusBarService.setStyle("default");
    };
  }, [setActiveScene, setScreen]);

  const playSequence = () => {
    void studioSheet.sequence.play({ range: [0, 3] });
    emit("sequence-played", `range 0→3 @ ${studioSheet.sequence.position.toFixed(2)}s`);
  };

  const resetPlayhead = () => {
    studioSheet.sequence.position = 0;
    emit("sequence-played", "playhead 0s");
  };

  const toggleStudioUi = () => {
    if (!isStudioAvailable()) return;

    if (studioUiVisible) {
      hideStudioUi();
      setStudioUiVisible(false);
      return;
    }

    showStudioUi();
    setStudioUiVisible(true);
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
                onClick={toggleStudioUi}
                disabled={!isStudioAvailable()}
                title={
                  isStudioAvailable()
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
            </dl>
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
}
