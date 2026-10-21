import { Link } from "react-router-dom";

import { isDesktopBrowser } from "@infra/native/PlatformService.ts";

/**
 * Dev-only link to the Studio Corner.
 *
 * Rendered when `import.meta.env.DEV`, so the production transform removes the
 * whole component from the Capacitor bundle. The route itself is registered in
 * production as well — a route that only exists in dev is a route nobody has
 * seen fail.
 *
 * On a phone the label says so: the route works, the Theatre.js panel does not
 * load there, and a button that promises a panel it will never show is worse
 * than a button that admits it.
 */
export default function StudioDevButton() {
  if (!import.meta.env.DEV) return null;

  return (
    <Link className="studio-dev-button" to="/studio-corner">
      {isDesktopBrowser() ? "Studio Corner" : "Studio Corner (desktop)"}
    </Link>
  );
}
