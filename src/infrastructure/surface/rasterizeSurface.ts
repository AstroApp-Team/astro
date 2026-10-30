/**
 * Draws a live DOM subtree into a canvas, with no new dependencies.
 *
 * The pipeline is: read every used style off the live tree, clone the tree, paste
 * those styles onto the clone as inline `style`, wrap the clone in an SVG
 * `foreignObject`, and draw the resulting SVG image into the canvas.
 *
 * Why inline styles and not a stylesheet: the SVG is loaded as an **image**, in its
 * own document. It has no access to the app's stylesheets, to `document`, to
 * scripts, or to any relative URL — so the only styling that survives is what is
 * written inside the string. `getComputedStyle` gives the used values (resolved
 * lengths, resolved colours), which is exactly what a page that has already laid
 * itself out needs to look the same somewhere else.
 *
 * What does not survive, and why the surface pages are written to avoid it:
 *   - `backdrop-filter`: there is no backdrop in an image. It renders as nothing.
 *   - external images (`url()`, `<img src>`): an image cannot load sub-resources.
 *     A surface page draws with CSS, gradients and system fonts only.
 *   - `canvas`, `video`, `iframe`: cloned as empty boxes. Stripped.
 *   - `content-visibility` / `contain`: the clone is a standalone tree in an image,
 *     where both mean "render nothing". Cleared on the clone — defensive, since a
 *     host inside a subtree the browser is skipping measures 0×0 and paints nothing.
 *   - the host's off-screen position: the clone's root is forced to `static`, so
 *     the page is drawn at the canvas origin, not 10 000 px to the left of it.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const XHTML_NS = "http://www.w3.org/1999/xhtml";

/**
 * The properties copied from the live tree onto the clone.
 *
 * A list, not `cssText`: `getComputedStyle` returns a *resolved* value per property,
 * while `cssText` on a computed style object is empty in Chromium. The list is long
 * because the properties are independent — missing `flexShrink` collapses a flex
 * row, missing `borderTopWidth` erases one edge of a card, missing `fontKerning`
 * shifts text by a pixel — and the failure is silent either way.
 */
const COPIED_PROPERTIES: readonly string[] = [
  // layout + box
  "display",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "box-sizing",
  "gap",
  "row-gap",
  "column-gap",
  "aspect-ratio",
  "overflow",
  "overflow-x",
  "overflow-y",
  "z-index",
  "opacity",
  "visibility",
  "transform",
  "transform-origin",
  "filter",
  "mix-blend-mode",
  "isolation",
  "float",
  "clear",
  "vertical-align",
  // flex + grid
  "flex-direction",
  "flex-wrap",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "justify-content",
  "align-items",
  "align-content",
  "align-self",
  "justify-self",
  "order",
  "grid-template-columns",
  "grid-template-rows",
  "grid-auto-flow",
  "grid-column",
  "grid-row",
  // text
  "color",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "font-variant",
  "font-stretch",
  "font-kerning",
  "font-feature-settings",
  "font-variation-settings",
  "font-optical-sizing",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "text-align",
  "text-indent",
  "text-transform",
  "text-decoration-line",
  "text-decoration-color",
  "text-decoration-style",
  "text-shadow",
  "text-rendering",
  "white-space",
  "word-break",
  "overflow-wrap",
  "hyphens",
  "direction",
  "unicode-bidi",
  "tab-size",
  // background
  "background-color",
  "background-image",
  "background-size",
  "background-position",
  "background-repeat",
  "background-origin",
  "background-clip",
  // border + outline + shadow
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-top-style",
  "border-right-style",
  "border-bottom-style",
  "border-left-style",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
  "border-collapse",
  "border-spacing",
  "outline-width",
  "outline-style",
  "outline-color",
  "box-shadow",
  // list + table
  "list-style-type",
  "list-style-position",
  "list-style-image",
  "table-layout",
  "caption-side",
  // svg paint (for inline icons)
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-opacity",
  "fill-opacity",
  "paint-order",
];

/** Elements that cannot be represented in an image document. */
const STRIPPED_SELECTORS = "canvas, video, iframe, object, embed, audio, source, track";

export type RasterOutcome =
  | { ok: true; width: number; height: number }
  | { ok: false; reason: string };

/**
 * Copies the used styles of `source`'s subtree onto a deep clone of it.
 *
 * The pairing is positional: `cloneNode(true)` preserves document order, so the
 * `n`-th element of `querySelectorAll("*")` on the source is the `n`-th on the
 * clone. No ids, no data attributes, no bookkeeping — just two walks in the same
 * order.
 */
function cloneWithComputedStyles(host: HTMLElement): HTMLElement {
  const clone = host.cloneNode(true) as HTMLElement;

  const sourceElements: Element[] = [host, ...host.querySelectorAll("*")];
  const cloneElements: Element[] = [clone, ...clone.querySelectorAll("*")];

  for (const element of clone.querySelectorAll(STRIPPED_SELECTORS)) {
    element.remove();
  }

  const count = Math.min(sourceElements.length, cloneElements.length);
  for (let index = 0; index < count; index += 1) {
    const source = sourceElements[index];
    const target = cloneElements[index];
    // `style` is on `HTMLElement` and `SVGElement`, not on `Element`, so both sides
    // are narrowed here rather than cast: the clone is a detached tree, and a node
    // in it with no style has nothing to copy.
    if (!(source instanceof HTMLElement) || !(target instanceof HTMLElement)) continue;

    const computed = window.getComputedStyle(source);
    const style = target.style;
    for (const property of COPIED_PROPERTIES) {
      const value = computed.getPropertyValue(property);
      if (value !== "") style.setProperty(property, value);
    }

    // Defensive: `contain` and `content-visibility` are the two properties whose
    // value in an ancestor makes a subtree render nothing, and a clone inside an
    // image document has no ancestor that can skip it. Cleared so a host that ever
    // lands inside a skipped subtree rasterizes as its content, not as 0×0 nothing.
    style.setProperty("contain", "none");
    style.setProperty("content-visibility", "visible");
  }

  // The host is parked off screen so the user never sees it. The clone must be
  // drawn at the origin of the canvas, so the root loses its position entirely.
  clone.style.setProperty("position", "static");
  clone.style.setProperty("top", "auto");
  clone.style.setProperty("left", "auto");
  clone.style.setProperty("right", "auto");
  clone.style.setProperty("bottom", "auto");
  clone.style.setProperty("transform", "none");
  clone.style.setProperty("margin", "0");
  clone.style.setProperty("outline", "none");
  clone.setAttribute("xmlns", XHTML_NS);

  return clone;
}

function buildSvgDocument(clone: HTMLElement, width: number, height: number): string {
  // `XMLSerializer`, not `outerHTML`. The payload is parsed as **XML**, and the HTML
  // serializer does not produce XML: it leaves void elements open (`<br>` is a
  // fatal parse error, not a line break) and it writes named entities
  // (`&nbsp;`, `&mdash;`) that no XML document declares — also fatal. Both failures
  // land in `image.onerror`, which surfaces as "the raster payload did not decode"
  // on a page that looked fine a moment ago. XMLSerializer self-closes void
  // elements, escapes text properly, and writes non-ASCII as literal UTF-8.
  const body = new XMLSerializer().serializeToString(clone);

  return (
    `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<foreignObject x="0" y="0" width="100%" height="100%">${body}</foreignObject>` +
    "</svg>"
  );
}

/**
 * A `data:` URL for a blob, read as base64.
 *
 * `FileReader` rather than hand-encoded UTF-8: the page's text is arbitrary (emoji,
 * accented glyphs), and a percent-encoded UTF-8 SVG is both slower and the classic
 * place for a mojibake bug.
 */
async function blobToDataUrl(blob: Blob): Promise<string> {
  const reader = new FileReader();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("surface: could not read the raster payload"));
    reader.readAsDataURL(blob);
  });
  return dataUrl;
}

async function decodeDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  const image = new Image();

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("surface: the raster payload did not decode"));
    image.src = dataUrl;
  });

  return image;
}

/**
 * Rasterizes `host` into `canvas` at `width`×`height` CSS pixels.
 *
 * The canvas backing store is set to exactly `width`×`height` — no device pixel
 * ratio. The texture is mapped onto a mesh that occupies a fraction of the
 * viewport, so a 2× raster doubles the bytes uploaded to the GPU every frame for
 * pixels the display never shows.
 *
 * Returns an outcome, not a thrown error: a failed raster must leave the previous
 * texture in place and say why, because the alternative is a mesh that goes black
 * mid-session with nothing naming the cause.
 */
export async function rasterizeHost(
  host: HTMLElement,
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): Promise<RasterOutcome> {
  if (width <= 0 || height <= 0) return { ok: false, reason: "surface host has no size" };

  const context = canvas.getContext("2d");
  if (context == null) return { ok: false, reason: "surface canvas has no 2d context" };

  try {
    const clone = cloneWithComputedStyles(host);
    const svg = buildSvgDocument(clone, width, height);
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const dataUrl = await blobToDataUrl(blob);
    const image = await decodeDataUrl(dataUrl);

    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    return { ok: true, width, height };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "surface raster failed" };
  }
}
