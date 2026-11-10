import { z } from "zod";

import { MAX_VIEW_HTML_BYTES } from "./view.ts";

/**
 * Zod lives here rather than in realtime.ts so the SPA can import the shared
 * constants without pulling the whole validation library into the client
 * bundle — these schemas only ever run on the Worker.
 */

export const PasswordSchema = z.object({
  password: z.string().min(1).max(200),
});

/**
 * The browser owns the current document — it is what is literally on screen —
 * so a revision request carries it back up rather than the Worker keeping
 * session state. That keeps the coding agent stateless and makes "make it
 * blue" an edit instead of a rewrite.
 */
export const ViewRequestSchema = PasswordSchema.extend({
  request: z.string().min(1).max(2000),
  currentHtml: z.string().max(MAX_VIEW_HTML_BYTES).optional(),
  /** `rebuild` hands the page to the strong model for a rewrite from its spec. */
  mode: z.enum(["edit", "rebuild"]).default("edit"),
  /** What the page on screen threw while in use — the bugs no static check sees. */
  pageErrors: z.array(z.string().max(300)).max(5).optional(),
});

/**
 * What the Gateway hands back from `getToken()`, which is most of what
 * `experimental_useRealtime` destructures out of the setup endpoint — the
 * route adds `tools` itself. `url` matters as much as `token`: without it the
 * hook calls `new WebSocket(undefined, ...)`, which fails looking like an auth
 * problem. Validating server-side turns that into an honest 502.
 */
export const RealtimeSetupSchema = z.object({
  token: z.string().min(1),
  url: z.url(),
  expiresAt: z.number().optional(),
});

export type RealtimeSetup = z.infer<typeof RealtimeSetupSchema>;
