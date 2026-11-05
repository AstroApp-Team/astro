import { setupIonicReact } from "@ionic/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

/* Ionic core styles — core.css is required, the rest are recommended. */
import "@ionic/react/css/core.css";
import "@ionic/react/css/normalize.css";
import "@ionic/react/css/structure.css";
import "@ionic/react/css/typography.css";
import "./theme/variables.css";
import "./theme/voice.css";
/* The hero character's own palette; it is a closed box, not part of the Ionic theme. */
import "./theme/astro.css";

import App from "./App.tsx";
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
