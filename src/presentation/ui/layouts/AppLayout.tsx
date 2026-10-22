import { IonApp, IonRouterOutlet } from "@ionic/react";
import { IonReactRouter } from "@ionic/react-router";
import { Navigate, Route } from "react-router-dom";

import StudioCornerPage from "@presentation/canvas/studio/StudioCornerPage.tsx";
import RigPage from "@presentation/canvas/studio/RigPage.tsx";
import VoicePage from "@presentation/ui/pages/VoicePage.tsx";

/**
 * App shell: Ionic's router over the page stack, one route per screen.
 *
 * `/voice` is the product. `/studio-corner` is the rigging sandbox, `/rig/:sceneId`
 * the bench that rigs a production sheet directly. The redirect
 * from `/` is a plain `<Navigate>` — Ionic 9 runs React Router v6, so
 * `element=` and `<Navigate>`, not `component=` and `<Redirect>`.
 */
export default function AppLayout() {
  return (
    <IonApp>
      <IonReactRouter>
        <IonRouterOutlet>
          <Route path="/voice" element={<VoicePage />} />
          <Route path="/studio-corner" element={<StudioCornerPage />} />
          <Route path="/rig/:sceneId" element={<RigPage />} />
          <Route path="/rig" element={<RigPage />} />
          <Route path="/" element={<Navigate to="/voice" replace />} />
        </IonRouterOutlet>
      </IonReactRouter>
    </IonApp>
  );
}
