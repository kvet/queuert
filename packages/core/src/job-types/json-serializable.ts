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

type NonJsonValue =
  | Date
  | RegExp
  | Map<unknown, unknown>
  | Set<unknown>
  | WeakMap<object, unknown>
  | WeakSet<object>
  | Promise<unknown>
  | ArrayBuffer
  | ArrayBufferView
  | bigint
  | symbol
  // oxlint-disable-next-line typescript/no-unsafe-function-type -- matching any function shape is the point
  | Function;

export type FindNonJsonValue<T> = [T] extends [JsonSerializable] ? never : FindNonJsonValueDeep<T>;

type FindNonJsonValueDeep<T, TSeen = never> = [T] extends [never]
  ? never
  : 0 extends 1 & T
    ? never
    : [unknown] extends [T]
      ? never
      : T extends NonJsonValue
        ? T
        : [T] extends [TSeen]
          ? never
          : T extends readonly (infer TItem)[]
            ? FindNonJsonValueDeep<TItem, TSeen | T>
            : T extends object
              ? { [K in keyof T]-?: FindNonJsonValueDeep<T[K], TSeen | T> }[keyof T]
              : never;

/**
 * Compile-time helper: resolves to `T` when `T` carries nothing that would be
 * lost in a JSON round-trip, otherwise to a descriptive error string that
 * surfaces at the call site of the consumer.
 *
 * Validator adapters use this to constrain their **encoded** type — the form
 * their encoders return — while leaving the runtime type free:
 *
 * ```ts
 * schemas: EnsureJsonSerializable<EncodedFormOf<T>> extends string ? never : T
 * ```
 *
 * It shares {@link FindNonJsonValue}'s rules, so `unknown` and `any` pass here
 * exactly as they do for `defineJobTypes`.
 */
export type EnsureJsonSerializable<T> = [FindNonJsonValue<T>] extends [never]
  ? T
  : "Error: type must be JSON-serializable (no Date, Map, Set, bigint, functions, symbols, or class instances)";

const MAX_DEPTH = 1000;

const isJsonValue = (value: unknown, depth: number): boolean => {
  if (value === null) return true;
  switch (typeof value) {
    case "string":
    case "boolean":
      return true;
    case "number":
      return Number.isFinite(value);
    case "object": {
      if (depth >= MAX_DEPTH) return false;
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          if (!isJsonValue(value[i], depth + 1)) return false;
        }
        return true;
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== null && proto !== Object.prototype) return false;
      const keys = Object.keys(value);
      for (let i = 0; i < keys.length; i++) {
        const child = (value as Record<string, unknown>)[keys[i]];
        if (child !== undefined && !isJsonValue(child, depth + 1)) return false;
      }
      return true;
    }
    case "undefined":
    case "bigint":
    case "function":
    case "symbol":
    default:
      return false;
  }
};

/**
 * Runtime check that `value` survives a JSON round-trip without coercion or loss.
 *
 * Rejects: `Date`, `Map`, `Set`, class instances (any prototype other than
 * `Object.prototype` or `null`), `NaN`/`Infinity`/`-Infinity`, `bigint`,
 * functions, symbols, `undefined` outside of object value positions, and
 * values nested deeper than 1000 levels, which includes every cycle.
 */
export const isJsonSerializable = (value: unknown): boolean => isJsonValue(value, 0);
