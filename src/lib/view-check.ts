import { VIEW_CHECK_TYPE } from "../../shared/view.ts";
import { sealViewHtml, VIEW_CHECK_SANDBOX } from "./seal-view.ts";

/**
 * Long enough for any page that is not stuck — including one that pulls a
 * library off a CDN first — short enough that a stuck one does not hold the
 * build open. A page that never reports is itself a problem.
 */
const CHECK_TIMEOUT_MS = 10_000;

/**
 * Runs a finished page once, out of sight, and returns what broke.
 *
 * The Worker cannot do this — it has no DOM, and model-written code must never
 * run next to the Gateway key — so the browser does, in a second sandboxed
 * frame that the user never sees. The runtime in check mode renders the page,
 * runs every action that takes no arguments from the starting state, then runs
 * `Astro.start` and lets it go for a moment, and posts the problems — scripts
 * that failed to load included. Check mode mutes `Astro.emit` and state saving,
 * so nothing here reaches the voice model or the live page.
 */
export function runViewCheck(html: string): Promise<string[]> {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", VIEW_CHECK_SANDBOX);
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    // Laid out (so canvas and layout code behave as on screen) but invisible.
    frame.style.cssText =
      "position:fixed;left:-10000px;top:0;width:400px;height:700px;visibility:hidden;border:0";

    const finish = (problems: string[]) => {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      frame.remove();
      resolve(problems);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow) return;
      const data = event.data as { type?: unknown; problems?: unknown } | null;
      if (data?.type !== VIEW_CHECK_TYPE || !Array.isArray(data.problems)) return;

      finish(
        data.problems
          .filter((problem): problem is string => typeof problem === "string")
          .map((problem) => problem.slice(0, 300))
          .slice(0, 10),
      );
    };

    const timer = setTimeout(
      () =>
        finish([
          `The page did not finish loading within ${CHECK_TIMEOUT_MS / 1000} s — look for a ` +
            "loop that never ends at startup or in a no-argument action.",
        ]),
      CHECK_TIMEOUT_MS,
    );

    window.addEventListener("message", onMessage);
    frame.srcdoc = sealViewHtml(html, { check: true });
    document.body.appendChild(frame);
  });
}
