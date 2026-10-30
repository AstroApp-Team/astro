import { QueryClientProvider } from "@tanstack/react-query";
import { setupIonicReact } from "@ionic/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { queryClient } from "@infra/api/queryClient.ts";
import { StatusBarService } from "@infra/native/StatusBarService.ts";
import { initTheatreStudio } from "@infra/theatre/studioInit.ts";
import AppLayout from "@presentation/ui/layouts/AppLayout.tsx";

import "@ionic/react/css/normalize.css";
import "@ionic/react/css/structure.css";
import "@ionic/react/css/core.css";
import "@ionic/react/css/typography.css";

import "@presentation/ui/styles/variables.css";
import "@presentation/ui/styles/voice.css";

/**
 * Ionic's global CSS is not optional, and `setupIonicReact()` does not load it.
 *
 * Without it `html`/`body` have no height and `.ion-page` — the class `ion-app`
 * carries — has no `position: absolute; top:0; bottom:0; display:flex`. Every
 * element stays `display: inline` with `height: auto`, so the whole app collapses
 * to zero and `ion-content` gets 0px. `ion-content`'s `.inner-scroll` is
 * `position: absolute; top: calc(var(--offset-top) * -1)`, which against a 0px
 * containing block measures exactly the header's height, and a `height: 100%`
 * canvas host inside it measures 56px.
 *
 * `structure.css` is the file that gives `html` and `body` their 100%;
 * `core.css` is the one with `.ion-page`. Neither is in any component bundle.
 */
setupIonicReact();

/**
 * Native shell, once, before the first paint.
 *
 * The status bar is the one piece of chrome the WebView does not own, and on a
 * dark app a black bar with black icons is what the default gives you. The
 * service no-ops on web, so this line is a no-op in the browser and a real call
 * in the Capacitor shell.
 */
StatusBarService.setStyle("default");

/**
 * Dev-only, desktop-only, and a no-op on a phone — see
 * `infrastructure/theatre/studioInit.ts`. Awaiting it here would delay first
 * paint on the app's hottest path for a tool that only exists in dev, so it is
 * fire-and-forget.
 */
void initTheatreStudio();

const container = document.getElementById("root");

if (container == null) {
  throw new Error("#root is missing from index.html");
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppLayout />
    </QueryClientProvider>
  </StrictMode>,
);
