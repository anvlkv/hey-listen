/**
 * Deep-clone a value into a detached, plain copy.
 *
 * All the state this is used on (graph nodes/edges, shared params, per-tool
 * options, dockview layout) is JSON-serializable, so a JSON round-trip is a
 * correct and dependency-free clone. It works on both plain data and Solid store
 * proxies: `JSON.stringify` reads every own enumerable property, so if it is
 * called inside a reactive scope it still tracks the store's leaves (see
 * `state/uiState.ts`), and it always returns a fresh plain object rather than a
 * proxy.
 */
export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
