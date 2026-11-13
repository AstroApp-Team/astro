import { IonApp, IonRouterOutlet } from "@ionic/react";
import { IonReactRouter } from "@ionic/react-router";
import { Navigate, Route } from "react-router-dom";

import AstroOverlay from "./components/astro/AstroOverlay.tsx";
import { useGlassLight } from "./lib/use-glass-light.ts";
import Settings from "./pages/Settings.tsx";
import Voice from "./pages/Voice.tsx";

/**
 * React Router v6 syntax (`element=`, `<Navigate>`) — Ionic 9 requires
 * react-router >=6.4 <7. The v5 `component=`/`<Redirect>` form is gone.
 *
 * IonReactRouter replaces BrowserRouter; without it Ionic page transitions and
 * the native view stack do not work.
 */
export default function App() {
  /* The light every glass control catches, moving with the phone. */
  useGlassLight();

  return (
    <IonApp>
      <IonReactRouter>
        <IonRouterOutlet>
          <Route path="/voice" element={<Voice />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/" element={<Navigate to="/voice" replace />} />
        </IonRouterOutlet>
      </IonReactRouter>
      {/*
       * Astro, drawn over every page and under Ionic's modals. Outside the router so a
       * page transition never remounts his WebGL context, and whether or not the password
       * is in place: a phone can be handed over and the WebGL path checked in the WebView
       * with no Gateway key and no socket.
       */}
      <AstroOverlay />
    </IonApp>
  );
}
