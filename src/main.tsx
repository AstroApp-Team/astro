import { setupIonicReact } from "@ionic/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

/* Ionic core styles — core.css is required, the rest are recommended. */
import "@ionic/react/css/core.css";
import "@ionic/react/css/normalize.css";
import "@ionic/react/css/structure.css";
import "@ionic/react/css/typography.css";
/* `ion-padding` and friends live here; without it the class is a no-op. */
import "@ionic/react/css/padding.css";
import "./theme/variables.css";
import "./theme/voice.css";
/* Astro's overlay. The character paints over the page, so the file has no Ionic theme
   variables in it — the only sheet colours in the app are here and in the shaders. */
import "./theme/astro.css";
/* Light theme overrides, scoped to `<html data-theme="light">`; dark needs nothing. */
import "./theme/theme-light.css";

import App from "./App.tsx";
/* Sets `<html data-theme>` on import, before anything paints. */
import "./lib/theme.ts";
import { queryClient } from "./lib/query.ts";

/* Must run before any Ionic component renders. */
setupIonicReact();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found in index.html");
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
