#!/usr/bin/env node
/**
 * Visual + behavioural probe for an overlay route (`/astro`, `/float`, …).
 *
 * The toolchain ships no browser harness, so this is a throwaway driver rather
 * than a test: it is not in `vp test`'s projects and nothing imports it. It exists
 * because the interesting bugs on these routes are invisible to a type check —
 * a raycast landing 200 px from the finger, an overlay that is not `inset: 0`, a
 * fixed bar eating the last row of content, a reaction that never settles.
 *
 * ## Setup (once per machine, needs no root)
 *
 *     mkdir -p /tmp/pw && cd /tmp/pw && npm init -y && npm i playwright-core
 *     # Chromium from the playwright cache, plus the shared libs it wants. If the
 *     # distro has no sudo, unpack the .debs into a prefix instead of installing:
 *     mkdir -p /tmp/chromedeps/root && cd /tmp/chromedeps
 *     apt-get download <each package from `ldd chrome | grep 'not found'`>
 *     for d in *.deb; do dpkg-deb -x "$d" root; done
 *     printf '%s' "/tmp/chromedeps/root/usr/lib/x86_64-linux-gnu" > ldpath.txt
 *
 * `FONTCONFIG_FILE` matters: without a font config Chromium finds no fonts and every
 * glyph in page text renders as a tofu box, which reads as "the layout exploded".
 *
 * Then, with `vp dev` running:
 *
 *     LD_LIBRARY_PATH="$(cat /tmp/chromedeps/ldpath.txt)" \
 *     FONTCONFIG_FILE=/tmp/chromedeps/fonts.conf \
 *     CHROME_PATH=~/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome \
 *     PLAYWRIGHT_CORE=/tmp/pw/node_modules/playwright-core \
 *     node scripts/visual-probe.mjs /astro --tap 195,340 --out /tmp/astro.png
 *
 * ## What it reports
 *
 * - the height chain (`ion-content` → the event source → the overlay → the canvas
 *   box), because a canvas in a zero-height strip reads as a black screen;
 * - the canvas's pixel size against its CSS size, which is what makes
 *   `eventPrefix="client"` correct only when the overlay starts at the viewport
 *   origin;
 * - the dev-server console, so a silent raycast miss at least shows up as silence;
 * - with `--tap x,y`: the tap count, the first log row, the expression, the
 *   playhead and the last seek, before and after the taps.
 */

import { createRequire } from "node:module";

const chromePath =
  process.env.CHROME_PATH ??
  `${process.env.HOME}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`;
const require = createRequire(process.env.PLAYWRIGHT_CORE ?? "/tmp/pw/node_modules/");
const { chromium } = require("playwright-core");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};

const route = args[0] ?? "/astro";
const width = Number(flag("width", 390));
const height = Number(flag("height", 688));
const origin = flag("origin", "http://localhost:5173");
const out = flag("out", `/tmp/shot-${route.replaceAll("/", "_") || "root"}.png`);
const tap = flag("tap", null);

const browser = await chromium.launch({
  executablePath: chromePath,
  // SwiftShader: there is no GPU in a headless container, and without these the
  // WebGL context is refused and the canvas stays transparent.
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

const page = await browser.newPage({
  viewport: { width, height },
  deviceScaleFactor: 1,
  hasTouch: true,
  isMobile: true,
});

const logs = [];
page.on("console", (message) => {
  if (message.type() === "error" || message.type() === "warning") {
    logs.push(`${message.type()}: ${message.text().split("\n")[0]}`);
  }
});
page.on("pageerror", (error) => logs.push(`pageerror: ${error.message}`));

await page.goto(`${origin}${route}`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

const measure = () =>
  page.evaluate(() => {
    const rect = (selector) => {
      const node = document.querySelector(selector);
      if (node == null) return null;
      const box = node.getBoundingClientRect();
      return {
        w: Math.round(box.width),
        h: Math.round(box.height),
        top: Math.round(box.top),
        left: Math.round(box.left),
      };
    };
    const canvas = document.querySelector(".astro-canvas canvas, .float-canvas canvas");
    return {
      screen: window.location.pathname,
      ionContent: rect("ion-content"),
      eventSource: rect(".astro") ?? rect(".float"),
      scroll: rect(".astro__scroll") ?? rect(".float__scroll"),
      overlay: rect(".astro__overlay") ?? rect(".float__overlay"),
      canvasBox: rect(".astro-canvas canvas, .float-canvas canvas"),
      canvasPixels: canvas == null ? null : { w: canvas.width, h: canvas.height },
      bar: rect(".astro__bar") ?? rect(".float__bar"),
      logRows: document.querySelectorAll(".astro__chat li:not(.astro__chat__empty)").length,
      expression: document.querySelector(".astro__table tbody tr td:nth-child(2)")?.textContent,
      taps: document.querySelector(".astro__table tbody tr td")?.textContent,
      playhead: document.querySelector(".astro__readout span")?.textContent,
    };
  });

const report = { before: await measure() };

if (tap != null) {
  const [x, y] = tap.split(",").map(Number);
  for (let index = 0; index < 3; index += 1) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(400);
  }
  report.duringReaction = await measure();
  await page.waitForTimeout(2200);
  report.afterSettle = await measure();
  report.firstRow = await page.evaluate(
    () => document.querySelector(".astro__chat li")?.textContent ?? null,
  );
}

await page.screenshot({ path: out });
console.log(JSON.stringify({ route, out, report, logs }, null, 2));
await browser.close();
