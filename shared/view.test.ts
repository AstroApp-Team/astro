import { describe, expect, it } from "vite-plus/test";

import {
  checkViewHtml,
  MAX_VIEW_HTML_BYTES,
  MAX_VIEW_STATE_BYTES,
  parseViewEvent,
  parseViewState,
  sealViewHtml,
  VIEW_CSP,
  VIEW_EVENT_TYPE,
  VIEW_STATE_TYPE,
  viewTitle,
} from "./view.ts";

/**
 * These three functions are the whole boundary around model-written code, and
 * every one of them is reached by something that cannot be trusted: the agent
 * writes the HTML, the published page writes the postMessage.
 */
describe("checkViewHtml", () => {
  const page = "<!doctype html><html><head></head><body>hi</body></html>";

  it("passes a self-contained document", () => {
    expect(checkViewHtml(page)).toEqual([]);
  });

  it("catches every way out to the network", () => {
    const escapes = [
      '<script src="https://cdn.example.com/x.js"></script>',
      '<link href="//fonts.example.com/f.css" rel="stylesheet">',
      "<style>body { background: url(https://example.com/bg.png) }</style>",
      "<style>@import 'x.css';</style>",
      "<script>fetch('/x')</script>",
      "<script>new WebSocket('wss://x')</script>",
      "<script>new EventSource('/x')</script>",
      "<script>navigator.sendBeacon('/x')</script>",
      '<iframe src="data:text/html,x"></iframe>',
    ];

    for (const escape of escapes) {
      expect(checkViewHtml(page + escape), escape).not.toEqual([]);
    }
  });

  it("rejects an oversize document", () => {
    const huge = `<!doctype html><p>${"x".repeat(MAX_VIEW_HTML_BYTES)}</p>`;
    expect(checkViewHtml(huge).join(" ")).toContain("limit");
  });

  it("catches escaped template placeholders", () => {
    // Runs without erroring and renders "${day}" as text, so nothing else
    // would catch it before the user saw it on screen.
    const escaped = String.raw`${page}<script>el.textContent = \`\${day}\`</script>`;
    expect(checkViewHtml(escaped).join(" ")).toContain("escapes template placeholders");
    // The correct form must stay clean.
    expect(checkViewHtml(page + "<script>el.textContent = `${day}`</script>")).toEqual([]);
  });

  it("leaves inline data URIs alone — they are the sanctioned way to embed", () => {
    expect(checkViewHtml(`${page}<img src="data:image/gif;base64,R0lGOD">`)).toEqual([]);
  });

  it("catches browser storage, which throws on the sandbox's opaque origin", () => {
    // Found live: asked for a high score that "survives restarts", the model
    // reached for localStorage — a SecurityError that stops the whole script.
    const uses = [
      "<script>localStorage.setItem('high', 3)</script>",
      "<script>const s = window.sessionStorage</script>",
      "<script>indexedDB.open('x')</script>",
      "<script>document.cookie = 'a=1'</script>",
    ];

    for (const use of uses) {
      expect(checkViewHtml(page + use).join(" "), use).toContain(VIEW_STATE_TYPE);
    }
  });
});

describe("viewTitle", () => {
  it("reads the page's own <title>", () => {
    expect(viewTitle("<head><title> Snake </title></head>")).toBe("Snake");
  });

  it("falls back for a page with none, or one still streaming in", () => {
    expect(viewTitle("<body>x</body>")).toBe("Page");
    expect(viewTitle("<head><title>Sna")).toBe("Page");
  });
});

describe("sealViewHtml", () => {
  it("puts the policy inside head, ahead of anything head contains", () => {
    const sealed = sealViewHtml("<!doctype html><html><head><title>x</title></head></html>");
    expect(sealed).toContain('<head><meta http-equiv="Content-Security-Policy"');
    // Ahead of the title, or the title parses under no policy at all.
    expect(sealed.indexOf("Content-Security-Policy")).toBeLessThan(sealed.indexOf("<title>"));
  });

  it("falls back to just after the doctype when there is no head", () => {
    const sealed = sealViewHtml("<!doctype html><body>x</body>");
    expect(sealed.startsWith("<!doctype html><meta http-equiv=")).toBe(true);
  });

  it("still seals a bare fragment", () => {
    expect(sealViewHtml("<p>x</p>").startsWith("<meta http-equiv=")).toBe(true);
  });

  it("is idempotent — a sealed document round-trips unchanged", () => {
    // The edit loop starts from the sealed html the client sent back, so a
    // non-idempotent seal would stack one meta tag per edit.
    const sealed = sealViewHtml("<!doctype html><html><head></head><body>x</body></html>");
    expect(sealViewHtml(sealed)).toBe(sealed);
  });

  it("still adds our policy to a page that wrote its own", () => {
    // The browser enforces every CSP present, so a model-written `default-src *`
    // cannot loosen ours — but only if writing one does not skip the seal.
    const sealed = sealViewHtml(
      '<head><meta http-equiv="Content-Security-Policy" content="default-src *"></head>',
    );
    expect(sealed).toContain(`content="${VIEW_CSP}"`);
  });

  it("puts the base styles ahead of the page's own, so the page wins", () => {
    const sealed = sealViewHtml("<head><style>body{background:red}</style></head>");
    expect(sealed.indexOf("color-scheme:dark")).toBeLessThan(sealed.indexOf("background:red"));
  });

  it("seals a half-written document streamed mid-run", () => {
    expect(sealViewHtml("<!doctype html><html><he")).toContain(`content="${VIEW_CSP}"`);
  });
});

describe("parseViewState", () => {
  it("accepts the reserved shape and hands the state back opaquely", () => {
    const state = { score: 12, board: [1, 2, 3] };
    expect(parseViewState({ type: VIEW_STATE_TYPE, state })).toEqual({ state });
  });

  it("accepts falsy but real states", () => {
    // A score of 0 or `false` is still state; only a missing one is not.
    expect(parseViewState({ type: VIEW_STATE_TYPE, state: 0 })).toEqual({ state: 0 });
    expect(parseViewState({ type: VIEW_STATE_TYPE, state: null })).toEqual({ state: null });
  });

  it("drops anything that is not the reserved shape", () => {
    expect(parseViewState({ type: VIEW_EVENT_TYPE, state: 1 })).toBeNull();
    expect(parseViewState({ type: VIEW_STATE_TYPE })).toBeNull();
    expect(parseViewState(null)).toBeNull();
    expect(parseViewState("astro:state")).toBeNull();
  });

  it("drops state that cannot round-trip through JSON or is oversized", () => {
    expect(parseViewState({ type: VIEW_STATE_TYPE, state: () => 1 })).toBeNull();
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(parseViewState({ type: VIEW_STATE_TYPE, state: cyclic })).toBeNull();
    expect(
      parseViewState({ type: VIEW_STATE_TYPE, state: "x".repeat(MAX_VIEW_STATE_BYTES + 1) }),
    ).toBeNull();
  });
});

describe("parseViewEvent", () => {
  it("accepts the reserved shape", () => {
    expect(parseViewEvent({ type: VIEW_EVENT_TYPE, name: "select", value: "Q3" })).toEqual({
      name: "select",
      value: "Q3",
    });
  });

  it("keeps numbers and booleans, and allows a bare name", () => {
    expect(parseViewEvent({ type: VIEW_EVENT_TYPE, name: "score", value: 42 })).toEqual({
      name: "score",
      value: 42,
    });
    expect(parseViewEvent({ type: VIEW_EVENT_TYPE, name: "done", value: true })).toEqual({
      name: "done",
      value: true,
    });
    expect(parseViewEvent({ type: VIEW_EVENT_TYPE, name: "tick" })).toEqual({ name: "tick" });
  });

  it("drops anything that is not the reserved shape", () => {
    // A sandboxed page shares the window with everything else that posts
    // messages, so the type tag is the only thing separating them.
    expect(parseViewEvent({ type: "webpack-hmr", name: "x" })).toBeNull();
    expect(parseViewEvent({ name: "select" })).toBeNull();
    expect(parseViewEvent({ type: VIEW_EVENT_TYPE, name: "" })).toBeNull();
    expect(parseViewEvent("astro:event")).toBeNull();
    expect(parseViewEvent(null)).toBeNull();
  });

  it("truncates rather than rejecting an over-long value", () => {
    const event = parseViewEvent({ type: VIEW_EVENT_TYPE, name: "note", value: "x".repeat(9_000) });
    expect(event?.value).toHaveLength(500);
  });

  it("drops a value it cannot forward as a scalar", () => {
    expect(parseViewEvent({ type: VIEW_EVENT_TYPE, name: "x", value: { a: 1 } })).toEqual({
      name: "x",
    });
    expect(parseViewEvent({ type: VIEW_EVENT_TYPE, name: "x", value: Number.NaN })).toEqual({
      name: "x",
    });
  });
});
