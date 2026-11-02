import { IonApp, IonRouterOutlet } from "@ionic/react";
import { IonReactRouter } from "@ionic/react-router";
import { Navigate, Route } from "react-router-dom";

import StudioCornerPage from "@presentation/canvas/studio/StudioCornerPage.tsx";
import RigPage from "@presentation/canvas/studio/RigPage.tsx";
import AstroPage from "@presentation/ui/pages/AstroPage.tsx";
import AstroV2Page from "@presentation/ui/pages/AstroV2Page.tsx";
import MachineEditorPage from "@presentation/ui/pages/MachineEditorPage.tsx";
import MachinePage from "@presentation/ui/pages/MachinePage.tsx";
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
 * on top of the text. `/astro` is the same arrangement with a character instead of
 * a sphere — a flat vector drawing on a plane, with its face owned by the store.
 * `/astro-v2` is that character rebuilt as geometry (sphere, eye prisms, halo shell,
 * all shader-lit) and kept beside v1 rather than replacing it: the drawing is the
 * backup, and the route pair is the comparison.
 * `/surface` is the third arrangement: React pages used as
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
          <Route path="/astro" element={<AstroPage />} />
          <Route path="/astro-v2" element={<AstroV2Page />} />
          <Route path="/machine" element={<MachinePage />} />
          <Route path="/editor" element={<MachineEditorPage />} />
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
