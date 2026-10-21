import { browserStorage } from "@infra/api/browserStorage.ts";

/**
 * The shared password, remembered across page loads.
 *
 * It gates a public URL against crawlers; it is not a user account. The Worker
 * re-checks it on every request, so this is a convenience cache and nothing
 * more — which is why losing it is always safe.
 *
 * A plain module store (get / set / subscribe), not a React hook: the domain
 * layer, the API layer and the Studio toolbar all need to read it, and a hook
 * can only be called by a component.
 */

const STORAGE_KEY = "astro.password.v1";

function read(): string {
  return browserStorage.read(STORAGE_KEY) ?? "";
}

let password = read();

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function setPassword(next: string): void {
  password = next;

  if (next === "") browserStorage.remove(STORAGE_KEY);
  else browserStorage.write(STORAGE_KEY, next);

  emit();
}

export function getPassword(): string {
  return password;
}

export function subscribeToPassword(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
