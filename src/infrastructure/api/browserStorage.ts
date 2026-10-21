import type { StorageGateway } from "@core/interfaces/storage.ts";

/**
 * `localStorage` adapter.
 *
 * Every access is guarded: it throws outright in some privacy modes, is absent
 * in workerd and in a node test run, and is quota-limited on a phone that is
 * running out of room. A storage failure means the value lives for this page
 * load only — never an exception the UI has to survive.
 */
export function createBrowserStorage(): StorageGateway {
  return {
    read(key) {
      try {
        return globalThis.localStorage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    write(key, value) {
      try {
        globalThis.localStorage?.setItem(key, value);
      } catch {
        /* non-fatal */
      }
    },
    remove(key) {
      try {
        globalThis.localStorage?.removeItem(key);
      } catch {
        /* non-fatal */
      }
    },
  };
}

export const browserStorage: StorageGateway = createBrowserStorage();

/**
 * An in-memory gateway with the same shape.
 *
 * Exported for tests: the repository's contract includes "a corrupt payload is
 * not an exception", and the only way to test that is a gateway you can poison
 * by hand. It is also the gateway a Capacitor file-plugin adapter would be
 * swapped in behind, later, without touching the usecase.
 */
export function createMemoryStorage(initial: Record<string, string> = {}): StorageGateway {
  const entries = new Map<string, string>(Object.entries(initial));

  return {
    read(key) {
      return entries.get(key) ?? null;
    },
    write(key, value) {
      entries.set(key, value);
    },
    remove(key) {
      entries.delete(key);
    },
  };
}
