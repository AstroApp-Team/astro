import type { CapacitorConfig } from "@capacitor/cli";

/**
 * `webDir` points at the Cloudflare Vite plugin's client output, which contains
 * no Worker code — exactly the Worker-free static bundle Capacitor needs.
 *
 * Note there is deliberately no `server.url`: that is a live-reload mechanism
 * for development, not a way to ship. The bundled app talks to the deployed
 * Worker over plain fetch using VITE_API_BASE_URL, which is why the Hono app
 * allows the capacitor://localhost and https://localhost origins in CORS.
 */
const config: CapacitorConfig = {
  appId: "dev.astro.app",
  appName: "Astro",
  webDir: "dist/client",
  server: {
    androidScheme: "http",
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
