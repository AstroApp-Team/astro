import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

/**
 * The wrangler config is the only place the SPA's deep links are declared, and
 * the failure mode is silent: with `not_found_handling` alone, the asset worker
 * serves index.html for `/rig/sting` only when the request carries
 * `Sec-Fetch-Mode: navigate`, and answers a plain 404 to everything else. The
 * in-app links feel fine, so the breakage shows up solely as a 404 on a typed
 * or bookmarked URL.
 *
 * `run_worker_first` is what flips that: a static-routing rule makes the asset
 * worker apply `not_found_handling` to every unmatched path, and it is also
 * what keeps `/api/*` on the Worker. This test is the guard on both halves.
 *
 * The file is JSONC, and no JSONC parser is a dependency. Asserting on the
 * config as text is the honest version of this test — a regex that agrees with
 * the Worker's own parser is less machinery than adding a parser for three
 * assertions.
 */

const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const worker = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

/** The inside of the `assets` block, as text. */
function assetsBlock(): string | undefined {
  return /"assets"\s*:\s*\{([\s\S]*?)\n  \}/u.exec(config)?.[1];
}

/** The `run_worker_first` array, as text; empty when the key is absent. */
function workerFirstRules(): string {
  return /"run_worker_first"\s*:\s*\[([^\]]*)\]/u.exec(assetsBlock() ?? "")?.[1] ?? "";
}

/** The value of a top-level key inside the `assets` block, quoted string only. */
function assetOption(name: string): string | undefined {
  const block = assetsBlock();
  if (block === undefined) return undefined;
  return new RegExp(`"${name}"\\s*:\\s*"([^"]*)"`, "u").exec(block)?.[1];
}

describe("wrangler assets config", () => {
  it("declares SPA fallback for unmatched paths", () => {
    expect(assetOption("not_found_handling")).to.equal("single-page-application");
  });

  it("turns on static routing, without which deep links 404 outside a navigate request", () => {
    expect(assetsBlock(), "no `assets` block in wrangler.jsonc").to.be.a("string");
    const rules = workerFirstRules();
    expect(rules, "run_worker_first must be an array of rules, not a boolean").to.not.equal("");
    expect(rules).to.include('"/api/*"');
  });

  it("covers the Worker's mount point, where every route is registered", () => {
    // Routes are chained onto one Hono and mounted once. Reading the mount is
    // the contract; a per-route regex would miss the chain this file warns about.
    const mounts = [...worker.matchAll(/\.route\(\s*"([^"]+)"/gu)];
    expect(mounts.length, "no app.route() mount found").to.equal(1);
    const mount = mounts[0]![1];
    expect(mount).to.match(/^\/(api|api\/)/u);
    expect(workerFirstRules()).to.include(`"${mount}/*"`);
  });
});
