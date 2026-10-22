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
import { arrowBackOutline, playOutline, squareOutline, syncOutline } from "ionicons/icons";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { SCENE_IDS, type SceneId, isSceneId } from "@core/models/scene.ts";
import { StatusBarService } from "@infra/native/StatusBarService.ts";
import { SCENE_SHEET_IDS, getSheet } from "@infra/theatre/project.ts";
import { ensureStudio, hideStudioUi, showStudioUi } from "@infra/theatre/studioInit.ts";
import { useSheetPlayback } from "@infra/theatre/useSheetPlayback.ts";
import MainCanvas from "@presentation/canvas/MainCanvas.tsx";
import { useAppStore } from "@presentation/state/useAppStore.ts";
import { useSceneStore } from "@presentation/state/useSceneStore.ts";

import "@presentation/ui/styles/studio.css";

/**
 * The rig bench: a production scene, mounted on its own sheet, with the Studio
 * loaded over it.
 *
 * This route is why the sandbox round trip exists at all. `/studio-corner` rigs
 * the `StudioSandbox` sheet, and moving a rig out of it means renaming the
 * `sheetsById` key in the exported JSON to the production sheet id — a hand edit
 * of a file nobody should hand edit, and the failure mode is silent (core finds
 * no sheet, the scene plays at its initial values, no error).
 *
 * Here the sheet under the canvas *is* the production sheet, so the export is
 * already keyed correctly:
 *
 *   1. `/rig/sting` on a desktop browser in dev
 *   2. Toggle Studio → rig → right-click the project → Export state
 *   3. `pnpm run theatre:state -- import <the.json> --to StingScene`
 *
 * No rename, no mirroring the node array into `SANDBOX_NODES`, and the
 * theatreKeys you keyframe are literally the ones the shipped scene renders.
 *
 * The route is registered in production like every other route — a route nobody
 * has seen fail in prod is a route with a bug nobody has seen. The Studio panel
 * itself stays behind the `import.meta.env.DEV && !native` gate in
 * `studioInit.ts`, so on a phone this is a plain scene viewer with a play button.
 */
export default function RigPage() {
  const navigate = useNavigate();
  const { sceneId } = useParams<{ sceneId?: string }>();
  const [studioUiVisible, setStudioUiVisible] = useState(false);
  const [studioReady, setStudioReady] = useState(false);

  const scene: SceneId | null = isSceneId(sceneId) ? sceneId : null;

  const setActiveScene = useSceneStore((state) => state.setActiveScene);
  const setScreen = useAppStore((state) => state.setScreen);

  useEffect(() => {
    if (scene == null) return;
    setActiveScene(scene);
    setScreen("rig");
    StatusBarService.setStyle("dark");

    return () => {
      setActiveScene("hub");
      setScreen("voice");
      StatusBarService.setStyle("default");
    };
  }, [scene, setActiveScene, setScreen]);

  /**
   * Studio readiness is state, not a render-time poll — see the same note in
   * `StudioCornerPage`. `isStudioAvailable()` reads a module variable, so the
   * button would sit disabled for the whole session.
   */
  useEffect(() => {
    let cancelled = false;

    void ensureStudio().then((studio) => {
      if (cancelled || studio == null) {
        return;
      }
      setStudioReady(true);
      setStudioUiVisible(showStudioUi());
    });

    return () => {
      cancelled = true;
      setStudioUiVisible(false);
      hideStudioUi();
    };
  }, []);

  if (scene == null) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonButtons slot="start">
              <IonButton onClick={() => navigate("/voice")}>
                <IonIcon slot="icon-only" icon={arrowBackOutline} />
              </IonButton>
            </IonButtons>
            <IonTitle>Rig bench</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent fullscreen>
          <div className="rig-picker">
            <p>
              <code>/rig/:sceneId</code> — pick a scene. The canvas mounts that scene&apos;s own
              Theatre.js sheet, so what you keyframe here is what ships.
            </p>
            <ul>
              {SCENE_IDS.map((id) => (
                <li key={id}>
                  <Link to={`/rig/${id}`}>{id}</Link>
                  <span>{SCENE_SHEET_IDS[id]}</span>
                </li>
              ))}
            </ul>
          </div>
        </IonContent>
      </IonPage>
    );
  }

  return (
    <RigBench
      scene={scene}
      studioReady={studioReady}
      studioUiVisible={studioUiVisible}
      onToggleStudio={() => {
        setStudioUiVisible((visible) => (visible ? hideStudioUi() : showStudioUi()));
      }}
    />
  );
}

type RigBenchProps = {
  scene: SceneId;
  studioReady: boolean;
  studioUiVisible: boolean;
  onToggleStudio(): void;
};

function RigBench({ scene, studioReady, studioUiVisible, onToggleStudio }: RigBenchProps) {
  const sheet = getSheet(SCENE_SHEET_IDS[scene]);
  const playback = useSheetPlayback(sheet);
  /** Read on button clicks only — a live playhead readout re-renders 60 times a second. */
  const [playhead, setPlayhead] = useState(0);
  const length = playback.length();
  const sheetId = SCENE_SHEET_IDS[scene];

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <Link className="rig-back" to="/voice">
              <IonIcon icon={arrowBackOutline} />
            </Link>
          </IonButtons>
          <IonTitle>Rig · {scene}</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent fullscreen>
        <div className="studio-stage">
          <MainCanvas scene={scene} className="studio-canvas" />

          <div className="studio-toolbar">
            <div className="studio-toolbar__buttons">
              <button
                type="button"
                onClick={() => {
                  playback.play([0, length]);
                  setPlayhead(playback.position());
                }}
              >
                <IonIcon icon={playOutline} />
                Play 0 → {length}
              </button>
              <button
                type="button"
                onClick={() => {
                  playback.loop([0, length]);
                  setPlayhead(playback.position());
                }}
              >
                <IonIcon icon={syncOutline} />
                Loop
              </button>
              <button
                type="button"
                onClick={() => {
                  playback.reset();
                  setPlayhead(0);
                }}
              >
                <IonIcon icon={squareOutline} />
                Reset
              </button>
              <button
                type="button"
                onClick={onToggleStudio}
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

            <dl className="studio-toolbar__readout">
              <div>
                <dt>Sheet</dt>
                <dd>{sheetId}</dd>
              </div>
              <div>
                <dt>Sequence</dt>
                <dd>{length === 0 ? "empty — nothing rigged yet" : `${length}s`}</dd>
              </div>
              <div>
                <dt>Playhead</dt>
                <dd>{playhead.toFixed(2)}s</dd>
              </div>
              <div>
                <dt>Export</dt>
                <dd>
                  Studio → right-click the project → Export state, then:
                  <br />
                  <code>pnpm run theatre:state -- import &lt;file&gt; --to {sheetId}</code>
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
}
