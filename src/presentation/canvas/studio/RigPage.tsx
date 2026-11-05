/**
 * `/rig/:sceneId` — the rig studio.
 *
 * The page is now a frame around `StudioShell`: this file owns the things that are *route* facts
 * (which scene, the Studio's lifecycle, the sheet the shape tools spawn into, the status-bar
 * style) and the shell owns everything about the workspace. Splitting it that way is what let the
 * same shell be reused by `/editor`'s panels without this page growing a second layout.
 *
 * The route is registered in production like every other route — a route nobody has seen fail in
 * prod is a route with a bug nobody has seen. The Studio panel itself stays behind the
 * `import.meta.env.DEV && !native` gate in `studioInit.ts`, so on a phone this is a read-only rig
 * viewer: the shell renders, the panels are read-only, and the preview still plays.
 *
 * `setSelectionVisuals(true)` is stated on mount, not inherited: `IonRouterOutlet` keeps the page
 * you navigated away from mounted, so coming from `/showcase` the *other* page's flag is what is
 * current, and a bench that inherits it shows nothing selected.
 */

import { IonContent, IonPage } from "@ionic/react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useParams } from "react-router-dom";

import type { IStudio } from "@theatre/studio";

import { SCENE_IDS, type SceneId, isSceneId } from "@core/models/scene.ts";
import { StatusBarService } from "@infra/native/StatusBarService.ts";
import { SCENE_SHEET_IDS } from "@infra/theatre/project.ts";
import { ensureStudio, hideStudioUi, showStudioUi } from "@infra/theatre/studioInit.ts";
import { useAppStore } from "@presentation/state/useAppStore.ts";
import { useSceneStore } from "@presentation/state/useSceneStore.ts";
import { useShapeStore } from "@presentation/state/useShapeStore.ts";
import { StudioShell } from "@presentation/ui/studio/StudioShell.tsx";

import "@presentation/ui/editor/editor.css";
import "@presentation/ui/studio/studio.css";

export default function RigPage() {
  const { sceneId } = useParams<{ sceneId?: string }>();
  const [studioUiVisible, setStudioUiVisible] = useState(false);
  const [studioReady, setStudioReady] = useState(false);
  /** The instance, not just a boolean: the tools panel mounts panes into it. */
  const [studio, setStudio] = useState<IStudio | null>(null);

  const scene: SceneId | null = isSceneId(sceneId) ? sceneId : null;

  const setActiveScene = useSceneStore((state) => state.setActiveScene);
  const setScreen = useAppStore((state) => state.setScreen);

  useEffect(() => {
    if (scene == null) return;
    setActiveScene(scene);
    setScreen("rig");

    /* The shape tools spawn into this scene's own sheet, so "Add Shape" lands where you are. */
    useShapeStore.getState().setSheetId(SCENE_SHEET_IDS[scene]);
    useSceneStore.getState().setSelectionVisuals(true);

    StatusBarService.setStyle("dark");

    return () => {
      setActiveScene("hub");
      setScreen("voice");
      StatusBarService.setStyle("default");
    };
  }, [scene, setActiveScene, setScreen]);

  /**
   * Studio readiness is state, not a render-time poll — `isStudioAvailable()` reads a module
   * variable, so the button would sit disabled for the whole session.
   */
  useEffect(() => {
    let cancelled = false;

    void ensureStudio().then((studio) => {
      if (cancelled || studio == null) {
        return;
      }
      setStudio(studio);
      setStudioReady(true);
      /*
       * Hidden on arrival, and that is a layout fact rather than a preference: the Studio's root is a
       * `position: fixed; inset: 0` overlay at `z-index: 100` that takes pointer events across the
       * whole viewport, so a shell underneath it is visible but dead — every click lands on the
       * Studio root. The panel is a mode: the header's Studio button turns it on, and the Studio's
       * own close button turns it off.
       */
      setStudioUiVisible(hideStudioUi());
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
    <IonPage>
      <IonContent className="st-content" scrollY={false}>
        <StudioShell
          scene={scene}
          studio={studio}
          studioUi={studioUiVisible}
          studioAvailable={studioReady}
          onToggleStudio={() => {
            setStudioUiVisible((visible) => (visible ? hideStudioUi() : showStudioUi()));
          }}
        />
      </IonContent>
    </IonPage>
  );
}
