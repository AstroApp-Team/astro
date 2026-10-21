/**
 * Port for durable key/value storage.
 *
 * `localStorage` is not available in every environment this code lands in —
 * not in workerd, not in a node test run, and it throws outright in some
 * privacy modes. The adapter owns those failure modes; callers get three
 * methods that never throw.
 */
export interface StorageGateway {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
}
