import { IonApp, IonRouterOutlet } from "@ionic/react";
import { IonReactRouter } from "@ionic/react-router";
import { Navigate, Route } from "react-router-dom";

import StudioCornerPage from "@presentation/canvas/studio/StudioCornerPage.tsx";
import RigPage from "@presentation/canvas/studio/RigPage.tsx";
import FloatPage from "@presentation/ui/pages/FloatPage.tsx";
import ShowcasePage from "@presentation/ui/pages/ShowcasePage.tsx";
import SurfacePage from "@presentation/ui/pages/SurfacePage.tsx";
import VoicePage from "@presentation/ui/pages/VoicePage.tsx";

/**
 * App shell: Ionic's router over the page stack, one route per screen.
 *
 * `/voice` is the product. `/showcase` is the end-user view of a rigged scene —
 * a scrolling page over the canvas, no Studio. `/float` is the inversion of that:
 * a plain React page with a transparent canvas over *it*, so the sphere is drawn
 * on top of the text. `/surface` is the third arrangement: React pages used as
 * mesh textures, so the scene is drawn out of the page. `/studio-corner` is the rigging
 * sandbox, `/rig/:sceneId` the bench that rigs a production sheet directly. The
 * redirect from `/` is a plain `<Navigate>` — Ionic 9 runs React Router v6, so
 * `element=` and `<Navigate>`, not `component=` and `<Redirect>`.
 */
export default function AppLayout() {
  return (
    <IonApp>
      <IonReactRouter>
        <IonRouterOutlet>
          <Route path="/voice" element={<VoicePage />} />
          <Route path="/showcase" element={<ShowcasePage />} />
          <Route path="/showcase/:sceneId" element={<ShowcasePage />} />
          <Route path="/float" element={<FloatPage />} />
          <Route path="/surface" element={<SurfacePage />} />
          <Route path="/studio-corner" element={<StudioCornerPage />} />
          <Route path="/rig/:sceneId" element={<RigPage />} />
          <Route path="/rig" element={<RigPage />} />
          <Route path="/" element={<Navigate to="/voice" replace />} />
        </IonRouterOutlet>
      </IonReactRouter>
    </IonApp>
  );
}
