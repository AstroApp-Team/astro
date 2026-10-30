import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { PASSWORD_QUERY_PARAM, RENDER_VIEW_TOOL_NAME, VOICE_MODEL_ID } from "../shared/realtime.ts";
import app from "./index.ts";

/**
 * Node-project tests: routes that need no binding, driven through
 * `app.request()` — Hono's documented testing path, no server and no workerd.
 * Anything that touches D1 lives in index.workers.test.ts instead.
 *
 * The Gateway provider calls the global `fetch`, so stubbing it keeps these
 * tests offline and deterministic.
 */
describe("worker routing", () => {
  const PASSWORD = "hunter2-hunter2";

  const env = { APP_PASSWORD: PASSWORD, AI_GATEWAY_API_KEY: "vck_test" };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const setup = (password: string, overrides: Partial<typeof env> = {}) =>
    app.request(
      `/api/realtime/setup?${PASSWORD_QUERY_PARAM}=${encodeURIComponent(password)}`,
      { method: "POST" },
      { ...env, ...overrides },
    );

  const auth = (password: string) =>
    app.request(
      "/api/auth",
      {
        method: "POST",
        body: JSON.stringify({ password }),
        headers: { "Content-Type": "application/json" },
      },
      env,
    );

  it("serves /api/health", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("404s an unknown api route", async () => {
    const res = await app.request("/api/nope");
    expect(res.status).toBe(404);
  });

  it("accepts the right password and rejects a wrong one", async () => {
    expect((await auth(PASSWORD)).status).toBe(200);
    expect((await auth("nope")).status).toBe(401);
    // Same length as the real one — the compare must not be prefix-based.
    expect((await auth("x" + PASSWORD.slice(1))).status).toBe(401);
  });

  it("will not mint a realtime token without the password", async () => {
    expect((await setup("")).status).toBe(401);
    expect((await setup("wrong")).status).toBe(401);
  });

  it("checks the password before it looks at the Gateway key", async () => {
    const res = await setup("wrong", { AI_GATEWAY_API_KEY: "" });
    expect(res.status).toBe(401);
  });

  it("reports a missing Gateway key as a 500", async () => {
    const res = await setup(PASSWORD, { AI_GATEWAY_API_KEY: "" });
    expect(res.status).toBe(500);
  });

  it("returns the token and a model-pinned socket url", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ token: "vcst_abc", expiresAt: 1_700_000_000 })),
    );

    const res = await setup(PASSWORD);
    expect(res.status).toBe(200);

    const body = await res.json<{ token: string; url: string }>();
    expect(body.token).toBe("vcst_abc");
    // The server's model id is the one that counts: it rides on the URL, and
    // the browser opens exactly this socket.
    expect(body.url).toContain(`ai-model-id=${encodeURIComponent(VOICE_MODEL_ID)}`);
    expect(body.url.startsWith("wss://")).toBe(true);
  });

  it("ships the tool definitions with the token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ token: "vcst_abc" })),
    );

    const res = await setup(PASSWORD);
    const body = await res.json<{ tools: { name: string }[] }>();

    /**
     * This response is the *only* place tool definitions reach the model —
     * `connect()` reads them here and folds them into the session-update it
     * sends on open. Drop them and the voice agent silently loses its screen.
     */
    expect(body.tools.map((tool) => tool.name)).toContain(RENDER_VIEW_TOOL_NAME);
  });

  it("reports an upstream rejection as 502 rather than throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("payment required", { status: 402 })),
    );

    const res = await setup(PASSWORD);
    expect(res.status).toBe(502);
  });

  /**
   * The one seam the unit tests cannot see: `prepareSendMessagesRequest` in
   * use-view-builder.ts builds this body, and `ViewRequestSchema` has to accept
   * it. If they drift, every render fails with a Zod dump that the voice then reads
   * out loud.
   */
  const view = (body: object) =>
    app.request(
      "/api/view",
      {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      },
      env,
    );

  it("accepts the body the view transport builds", async () => {
    // Rejected on the password, which means it got past validation — the point
    // here is the schema, not the agent, which no test should be paying for.
    expect((await view({ password: "nope", request: "draw a spiral" })).status).toBe(401);
    expect(
      (await view({ password: "nope", request: "make it red", currentHtml: "<!doctype html><p>x" }))
        .status,
    ).toBe(401);
  });

  it("rejects a view request with nothing in it", async () => {
    expect((await view({ password: PASSWORD, request: "" })).status).toBe(400);
  });

  it("checks the view password before it looks at the Gateway key", async () => {
    const res = await app.request(
      "/api/view",
      {
        method: "POST",
        body: JSON.stringify({ password: PASSWORD, request: "draw a spiral" }),
        headers: { "Content-Type": "application/json" },
      },
      { ...env, AI_GATEWAY_API_KEY: "" },
    );
    expect(res.status).toBe(500);
  });

  it("allows the Capacitor native origin through CORS", async () => {
    const res = await app.request("/api/health", {
      headers: { Origin: "capacitor://localhost" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("capacitor://localhost");
  });
});
