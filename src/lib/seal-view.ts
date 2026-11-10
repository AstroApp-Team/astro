import htmPreact from "htm/preact/standalone.umd.js?raw";

import runtime from "./view-runtime.js?raw";

/**
 * Sealing happens here, in the browser, right before a document becomes an
 * iframe's `srcdoc` — not on the Worker. The agent and the request body only
 * ever carry the page's own source, so ~17 KB of runtime never rides along as
 * `currentHtml` into the next prompt, and drafts stream at their real size.
 */

/**
 * Injected rather than written by the agent — one less rule for the model to
 * get right, and it cannot be talked out of it. `'unsafe-inline'` looks
 * alarming and is not: inline script *is* the artifact, and `default-src
 * 'none'` means that script can reach nothing outside its own document.
 *
 * `'unsafe-eval'` for the same reason: eval only runs more code inside the same
 * jail. Without it `Function(expr)()` throws — and that is how a model writes
 * every calculator, which then answers "Error" to 7×12 with nothing wrong in
 * the page to point at.
 */
export const VIEW_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval'; " +
  "img-src data:; font-src data:";

/**
 * A few lines of classless defaults, injected ahead of the page's own styles
 * so the agent can skip styling entirely and still get a page that is legible,
 * fills the frame, has finger-sized controls and sits on the app's own ink
 * background. Anything the page writes overrides it. The agent's prompt tells
 * it what is here — keep the two in step.
 */
export const VIEW_BASE_CSS =
  ":root{color-scheme:dark;font:18px/1.4 system-ui,sans-serif}" +
  "*{box-sizing:border-box}" +
  "html,body{margin:0;min-height:100%}" +
  "body{padding:16px;background:#1a152c;color:#f3effa}" +
  "button,input,select,textarea{font:inherit;color:inherit;padding:.5em .8em;" +
  "border:1px solid #4a4266;border-radius:10px;background:#2a2344}" +
  "button{cursor:pointer}button:active{background:#3a3159}" +
  "canvas,svg{max-width:100%}";

/** `</script` inside the injected source would end the tag early. */
const inline = (source: string) => source.replaceAll("</script", "<\\/script");

/**
 * Adds the CSP the sandbox cannot set on its own, the base stylesheet, and the
 * `Astro` runtime (htm + Preact, then `view-runtime.js`). A `<meta
 * http-equiv>` policy only applies to content that parses after it, so it goes
 * as early as the document allows: inside `<head>` if there is one, otherwise
 * ahead of everything, where the parser will hoist it into the implied head.
 *
 * `check: true` builds the hidden copy that `runViewCheck` loads: the runtime
 * then exercises the page on load and reports instead of running it.
 *
 * Runs on half-written documents streamed mid-run too: everything that
 * reaches an iframe goes through here.
 */
export function sealViewHtml(html: string, { check = false } = {}): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${VIEW_CSP}">`;

  /** Idempotent, keyed on our exact tag, so sealing twice never stacks a second copy. */
  if (html.includes(meta)) return html;

  const seal =
    `${meta}<style>${VIEW_BASE_CSS}</style>` +
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
