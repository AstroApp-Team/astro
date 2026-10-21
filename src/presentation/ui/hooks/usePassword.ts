import { useSyncExternalStore } from "react";

import { getPassword, subscribeToPassword } from "@infra/api/credentialStore.ts";

/**
 * React's view of the shared password.
 *
 * The store itself lives in `infrastructure/api/` — the API client, the realtime
 * session and the Studio toolbar all need it, and a hook can only be called by a
 * component. This is the thin `useSyncExternalStore` bridge on top of it.
 */
export function usePassword(): string {
  return useSyncExternalStore(subscribeToPassword, getPassword, getPassword);
}
