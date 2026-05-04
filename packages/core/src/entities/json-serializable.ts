/** A JSON-safe primitive: string, number, boolean, or null. */
export type JsonPrimitive = string | number | boolean | null;

/**
 * A value that survives a JSON round-trip without coercion or loss.
 *
 * Plain objects, arrays, and JSON primitives are allowed. `undefined` is
 * permitted only in object value positions (so optional properties such as
 * `{ label?: string }` typecheck).
 *
 * Class instances (Date, Map, Set, custom classes) are rejected by the runtime
 * `isJsonSerializable` check, but TypeScript can't always distinguish them from
 * plain objects structurally — see {@link EnsureJsonSerializable} for the type
 * level enforcement and rely on the runtime check for the rest.
 */
export type JsonSerializable =
  | JsonPrimitive
  | readonly JsonSerializable[]
  | { readonly [key: string]: JsonSerializable | undefined };

/**
 * Compile-time helper: resolves to `T` when `T` is JSON-serializable, otherwise
 * to a descriptive error string that surfaces at the call site of the consumer.
 */
export type EnsureJsonSerializable<T> = [T] extends [JsonSerializable]
  ? T
  : "Error: type must be JSON-serializable (no Date, Map, Set, class instances, bigint, functions, NaN, or Infinity)";

/** Result of {@link isJsonSerializable}. `true` on success; a path on failure. */
export type IsJsonSerializableResult = true | { path: string };

const checkValue = (
  value: unknown,
  visited: WeakSet<object>,
  path: string,
): IsJsonSerializableResult => {
  if (value === null) return true;

  switch (typeof value) {
    case "string":
    case "boolean":
      return true;
    case "number":
      return Number.isFinite(value) ? true : { path: path || "(root)" };
    case "object": {
      const obj = value;
      if (visited.has(obj)) return { path: `${path || "(root)"} [cycle]` };
      visited.add(obj);

      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          const result = checkValue(value[i], visited, `${path}[${i}]`);
          if (result !== true) return result;
        }
        return true;
      }

      const proto = Object.getPrototypeOf(obj);
      if (proto !== null && proto !== Object.prototype) {
        return { path: path || "(root)" };
      }

      for (const key of Object.keys(obj)) {
        const child = (obj as Record<string, unknown>)[key];
        if (child === undefined) continue;
        const result = checkValue(child, visited, path === "" ? key : `${path}.${key}`);
        if (result !== true) return result;
      }
      return true;
    }
    case "undefined":
    case "bigint":
    case "function":
    case "symbol":
      return { path: path || "(root)" };
    default:
      return { path: path || "(root)" };
  }
};

/**
 * Recursive runtime check that `value` is JSON-serializable.
 *
 * Returns `true` when the value is safe to round-trip through JSON. On failure
 * returns `{ path }` pointing at the first offending node — useful for error
 * messages that explain *which* field is invalid rather than just *that* the
 * payload is invalid. Detects cycles via a `WeakSet`.
 *
 * Rejects: `Date`, `Map`, `Set`, class instances (any prototype other than
 * `Object.prototype` or `null`), `NaN`/`Infinity`/`-Infinity`, `bigint`,
 * functions, symbols, `undefined` outside of object value positions.
 */
export const isJsonSerializable = (value: unknown): IsJsonSerializableResult =>
  checkValue(value, new WeakSet(), "");
