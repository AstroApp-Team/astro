import htmPreact from "htm/preact/standalone.umd.js?raw";

import runtime from "./view-runtime.js?raw";

/**
 * Sealing happens here, in the browser, right before a document becomes an
 * iframe's `srcdoc` — not on the Worker. The agent and the request body only
 * ever carry the page's own source, so ~17 KB of runtime never rides along as
 * `currentHtml` into the next prompt, and drafts stream at their real size.
 */

/**
 * What a page may do. Deliberately wide open: a page is the user's own app,
 * asked for out loud, and anything it cannot do is a feature the voice
 * assistant promised and could not deliver. So it can load libraries from a
 * CDN, call public APIs, use storage, open dialogs, popups and downloads, go
 * fullscreen, and ask for the camera, microphone or location.
 *
 * The one thing held back is `allow-top-navigation`: a page that navigates the
 * app away ends the voice session it is part of.
 */
export const VIEW_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-modals allow-popups " +
  "allow-popups-to-escape-sandbox allow-downloads allow-pointer-lock allow-presentation";

/** Permissions policy for the frame (`allow=`). The OS still asks the user. */
export const VIEW_ALLOW =
  "camera; microphone; geolocation; fullscreen; clipboard-read; clipboard-write; autoplay; " +
  "display-capture; screen-wake-lock; web-share; accelerometer; gyroscope; magnetometer; " +
  "midi; xr-spatial-tracking";

/**
 * The check frame gets the same powers, minus the ones that would surface in
 * front of the user from a frame they cannot see: dialogs and popups.
 */
export const VIEW_CHECK_SANDBOX = "allow-scripts allow-same-origin allow-forms";

/**
 * A few lines of classless defaults, injected ahead of the page's own styles
 * so the agent can skip styling entirely and still get a page that is legible,
 * fills the frame, has finger-sized controls and sits on the app's own ink
 * background. Anything the page writes overrides it. The agent's prompt tells
 * it what is here — keep the two in step.
 */
export const VIEW_BASE_CSS =
  ":root{color-scheme:dark;font:18px/1.4 'Urbanist',system-ui,sans-serif}" +
  "*{box-sizing:border-box}" +
  "html,body{margin:0;min-height:100%}" +
  "body{padding:16px;background:#1a152c;color:#fefbf5}" +
  "button,input,select,textarea{font:inherit;color:inherit;padding:.5em .8em;" +
  "border:1px solid rgba(254,251,245,0.18);border-radius:12px;background:#252036}" +
  "button{cursor:pointer}button:active{background:#302a48}" +
  "canvas,svg{max-width:100%}";

/** `</script` inside the injected source would end the tag early. */
const inline = (source: string) => source.replaceAll("</script", "<\\/script");

/**
 * Adds the base stylesheet and the `Astro` runtime (htm + Preact, then
 * `view-runtime.js`), as early as the document allows: inside `<head>` if
 * there is one, otherwise ahead of everything — the page's own scripts call
 * `Astro`, so the runtime has to have run first.
 *
 * `check: true` builds the hidden copy that `runViewCheck` loads: the runtime
 * then exercises the page on load and reports instead of running it.
 *
 * Runs on half-written documents streamed mid-run too: everything that
 * reaches an iframe goes through here.
 */
export function sealViewHtml(html: string, { check = false } = {}): string {
  const style = `<style data-astro>${VIEW_BASE_CSS}</style>`;

  /** Idempotent, keyed on our exact tag, so sealing twice never stacks a second copy. */
  if (html.includes(style)) return html;

  const seal =
    style +
    (check ? "<script data-astro>window.__astroCheck=true</script>" : "") +
    // The UMD build registers on `this`; a classic script's `this` is the
    // window in browsers but not in every DOM, so it is passed explicitly.
    `<script data-astro>(function(){${inline(htmPreact)}\n}).call(self)</script>` +
    `<script data-astro>${inline(runtime)}</script>`;

  const head = /<head\b[^>]*>/i.exec(html);
  if (head != null) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + seal + html.slice(at);
  }

  const doctype = /<!doctype html>/i.exec(html);
  if (doctype != null) {
    const at = doctype.index + doctype[0].length;
    return html.slice(0, at) + seal + html.slice(at);
  }

  return seal + html;
}
