import { Window } from "happy-dom";
import { describe, expect, it } from "vite-plus/test";

import { sealViewHtml, VIEW_CSP } from "./seal-view.ts";

const COUNTER = `<!doctype html><title>Counter</title>
<!-- spec
- Shows a count with a + button
-->
<script>Astro.state({ count: 0, log: [] })</script>
<script>Astro.view((s, a) => html\`<p id="n">\${s.count}</p><button onClick=\${a.inc}>+</button>\`)</script>
<script>Astro.actions({ inc(s) { s.count++ }, add(s, n) { s.count += n } })</script>`;

/**
 * Loads a sealed page into a real (happy-dom) document with scripts on, and
 * collects everything it posts to its parent — which, in a top-level window,
 * is itself.
 */
async function load(
  html: string,
  { check = false, saved }: { check?: boolean; saved?: unknown } = {},
) {
  const window = new Window({ settings: { enableJavaScriptEvaluation: true } });
  const posted: { type: string; [key: string]: unknown }[] = [];
  window.addEventListener("message", (event) => {
    const data = (event as unknown as MessageEvent).data as { type: string };
    if (typeof data?.type === "string") posted.push(data);
  });

  window.document.write(sealViewHtml(html, { check }));
  await window.happyDOM.waitUntilComplete();
  if (saved !== undefined) {
    // What the app's `onFrameLoad` sends. Dispatched from inside the page because
    // happy-dom's script globals are proxies: only there does `source === parent` hold.
    const script = window.document.createElement("script");
    script.textContent = `dispatchEvent(new MessageEvent("message", { source: parent, data: ${JSON.stringify(
      { type: "astro:state", state: saved },
    )} }))`;
    window.document.body.append(script);
    await window.happyDOM.waitUntilComplete();
  }
  return { window, document: window.document, posted };
}

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

describe("sealViewHtml", () => {
  it("adds the CSP once, even when sealed twice", () => {
    const once = sealViewHtml(COUNTER);
    expect(once.split(VIEW_CSP).length - 1).toBe(1);
    expect(sealViewHtml(once)).toBe(once);
  });

  it("does not let the injected runtime end its own script tag early", () => {
    expect(sealViewHtml("<p>x</p>")).not.toMatch(/<\/script(?!>)/);
  });
});

describe("the Astro runtime", () => {
  it("renders the view from state and re-renders after an action", async () => {
    const { document } = await load(COUNTER);
    expect(document.querySelector("#n")?.textContent).toBe("0");

    (document.querySelector("button") as unknown as HTMLButtonElement).click();
    await tick();
    expect(document.querySelector("#n")?.textContent).toBe("1");
  });

  it("posts state after an action, so the next version of the page can resume", async () => {
    const { document, posted } = await load(COUNTER);
    (document.querySelector("button") as unknown as HTMLButtonElement).click();
    await tick(300);

    expect(posted.filter((m) => m.type === "astro:state").at(-1)).toEqual({
      type: "astro:state",
      state: { count: 1, log: [] },
    });
  });

  it("restores saved state, keeping only keys whose kind still matches", async () => {
    const { document } = await load(COUNTER, { saved: { count: 7, log: "wrong", stray: 1 } });
    await tick();
    expect(document.querySelector("#n")?.textContent).toBe("7");
  });

  it("passes the check for a working page", async () => {
    const { posted } = await load(COUNTER, { check: true });
    expect(posted.find((m) => m.type === "astro:check")).toEqual({
      type: "astro:check",
      problems: [],
    });
  });

  it("reports an action that throws from the starting state, but skips ones that take arguments", async () => {
    const page = COUNTER.replace("inc(s) { s.count++ }", "inc(s) { s.missing.push(1) }");
    const { posted } = await load(page, { check: true });
    const problems = posted.find((m) => m.type === "astro:check")?.["problems"] as string[];

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("action inc()");
  });

  it("reports a view that throws", async () => {
    const page = COUNTER.replace("${s.count}", "${s.nope.count}");
    const { posted } = await load(page, { check: true });
    const problems = posted.find((m) => m.type === "astro:check")?.["problems"] as string[];

    expect(problems.join(" ")).toContain("Astro.view");
  });

  it("reports a page that scripts the DOM without Astro.view", async () => {
    const page = `<title>x</title><p id="a"></p><script>document.getElementById("a").append("hi")</script>`;
    const { posted } = await load(page, { check: true });
    const problems = posted.find((m) => m.type === "astro:check")?.["problems"] as string[];

    expect(problems.join(" ")).toContain("never calls Astro.view");
  });

  it("stays quiet towards the voice assistant while checking", async () => {
    const page = COUNTER.replace("inc(s) { s.count++ }", 'inc(s) { s.count++; Astro.emit("inc") }');
    const { posted } = await load(page, { check: true });
    expect(posted.map((m) => m.type)).toEqual(["astro:check"]);
  });
});
