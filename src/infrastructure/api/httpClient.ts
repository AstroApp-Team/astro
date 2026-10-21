import { hc } from "hono/client";

import type { AppType } from "../../../worker/index.ts";
import { PASSWORD_QUERY_PARAM } from "@shared/realtime.ts";

/**
 * On the web the SPA is served by the same Worker, so a relative base works.
 * Bundled into Capacitor there is no Worker on the origin, so the native build
 * sets VITE_API_BASE_URL to the deployed Worker URL (see .env.capacitor).
 */
const baseUrl = import.meta.env.VITE_API_BASE_URL || "/";

/**
 * Instantiating `hc<AppType>` at every call site makes tsserver re-expand the
 * whole route tree and gets slow fast. Naming the type once here is Hono's
 * documented fix: `tsc` does the expansion a single time.
 */
export type Client = ReturnType<typeof hc<AppType>>;

export const client: Client = hc<AppType>(baseUrl);

export const api = client.api;

/**
 * `experimental_useRealtime` fetches this URL itself, so it bypasses the RPC
 * client and carries the password as a query parameter. Built by concatenation
 * rather than `$url()` because the web base is the relative `/`, which
 * `new URL()` rejects.
 */
export function realtimeSetupUrl(password: string): string {
  const params = new URLSearchParams({ [PASSWORD_QUERY_PARAM]: password });
  return `${baseUrl.replace(/\/$/, "")}/api/realtime/setup?${params.toString()}`;
}

/**
 * `/api/view` streams NDJSON, so it is read with a raw `fetch` rather than the
 * RPC client — `hc` would resolve the whole body before the first progress
 * line ever reached the UI, which is the entire point of the endpoint.
 */
export function viewUrl(): string {
  return `${baseUrl.replace(/\/$/, "")}/api/view`;
}
