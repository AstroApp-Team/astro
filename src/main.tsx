import { QueryClientProvider } from "@tanstack/react-query";
import { setupIonicReact } from "@ionic/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { queryClient } from "@infra/api/queryClient.ts";
import { StatusBarService } from "@infra/native/StatusBarService.ts";
import { initTheatreStudio } from "@infra/theatre/studioInit.ts";
import AppLayout from "@presentation/ui/layouts/AppLayout.tsx";

import "@presentation/ui/styles/variables.css";
import "@presentation/ui/styles/voice.css";

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
