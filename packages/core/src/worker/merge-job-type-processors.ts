import { DuplicateJobTypeError } from "../errors.js";
import { type InProcessWorkerProcessor } from "../in-process-worker.js";

/** Identity when no duplicate keys; error string when duplicates exist. */
type AssertNoDuplicateKeys<AccKeys extends string, NewKeys extends string, Success> = [
  AccKeys & NewKeys,
] extends [never]
  ? Success
  : `Duplicate processor: ${AccKeys & NewKeys}`;

/** Recursively validate each processor map against accumulated keys. Processes 10 at a time to avoid TS depth limits. */
type ValidatedSlices<
  T extends readonly object[],
  AccKeys extends string = never,
> = T extends readonly [
  infer T0 extends object,
  infer T1 extends object,
  infer T2 extends object,
  infer T3 extends object,
  infer T4 extends object,
  infer T5 extends object,
  infer T6 extends object,
  infer T7 extends object,
  infer T8 extends object,
  infer T9 extends object,
  ...infer Rest extends readonly object[],
]
  ? readonly [
      AssertNoDuplicateKeys<AccKeys, keyof T0 & string, T0>,
      AssertNoDuplicateKeys<AccKeys | (keyof T0 & string), keyof T1 & string, T1>,
      AssertNoDuplicateKeys<
        AccKeys | (keyof T0 & string) | (keyof T1 & string),
        keyof T2 & string,
        T2
      >,
      AssertNoDuplicateKeys<
        AccKeys | (keyof T0 & string) | (keyof T1 & string) | (keyof T2 & string),
        keyof T3 & string,
        T3
      >,
      AssertNoDuplicateKeys<
        | AccKeys
        | (keyof T0 & string)
        | (keyof T1 & string)
        | (keyof T2 & string)
        | (keyof T3 & string),
        keyof T4 & string,
        T4
      >,
      AssertNoDuplicateKeys<
        | AccKeys
        | (keyof T0 & string)
        | (keyof T1 & string)
        | (keyof T2 & string)
        | (keyof T3 & string)
        | (keyof T4 & string),
        keyof T5 & string,
        T5
      >,
      AssertNoDuplicateKeys<
        | AccKeys
        | (keyof T0 & string)
        | (keyof T1 & string)
        | (keyof T2 & string)
        | (keyof T3 & string)
        | (keyof T4 & string)
        | (keyof T5 & string),
        keyof T6 & string,
        T6
      >,
      AssertNoDuplicateKeys<
        | AccKeys
        | (keyof T0 & string)
        | (keyof T1 & string)
        | (keyof T2 & string)
        | (keyof T3 & string)
        | (keyof T4 & string)
        | (keyof T5 & string)
        | (keyof T6 & string),
        keyof T7 & string,
        T7
      >,
      AssertNoDuplicateKeys<
        | AccKeys
        | (keyof T0 & string)
        | (keyof T1 & string)
        | (keyof T2 & string)
        | (keyof T3 & string)
        | (keyof T4 & string)
        | (keyof T5 & string)
        | (keyof T6 & string)
        | (keyof T7 & string),
        keyof T8 & string,
        T8
      >,
      AssertNoDuplicateKeys<
        | AccKeys
        | (keyof T0 & string)
        | (keyof T1 & string)
        | (keyof T2 & string)
        | (keyof T3 & string)
        | (keyof T4 & string)
        | (keyof T5 & string)
        | (keyof T6 & string)
        | (keyof T7 & string)
        | (keyof T8 & string),
        keyof T9 & string,
        T9
      >,
      ...ValidatedSlices<
        Rest,
        | AccKeys
        | (keyof T0 & string)
        | (keyof T1 & string)
        | (keyof T2 & string)
        | (keyof T3 & string)
        | (keyof T4 & string)
        | (keyof T5 & string)
        | (keyof T6 & string)
        | (keyof T7 & string)
        | (keyof T8 & string)
        | (keyof T9 & string)
      >,
    ]
  : T extends readonly [infer First extends object, ...infer Rest extends readonly object[]]
    ? readonly [
        AssertNoDuplicateKeys<AccKeys, keyof First & string, First>,
        ...ValidatedSlices<Rest, AccKeys | (keyof First & string)>,
      ]
    : readonly [];

/** Collect all keys from a tuple of objects. Processes 10 at a time to avoid TS depth limits. */
type MergedKeys<T extends readonly object[]> = T extends readonly [
  infer T0,
  infer T1,
  infer T2,
  infer T3,
  infer T4,
  infer T5,
  infer T6,
  infer T7,
  infer T8,
  infer T9,
  ...infer Rest extends readonly object[],
]
  ?
      | (keyof T0 & string)
      | (keyof T1 & string)
      | (keyof T2 & string)
      | (keyof T3 & string)
      | (keyof T4 & string)
      | (keyof T5 & string)
      | (keyof T6 & string)
      | (keyof T7 & string)
      | (keyof T8 & string)
      | (keyof T9 & string)
      | MergedKeys<Rest>
  : T extends readonly [infer First, ...infer Rest extends readonly object[]]
    ? (keyof First & string) | MergedKeys<Rest>
    : never;

/**
 * Merge processor maps from multiple slices into a single processors object.
 *
 * Each slice defines processors using {@link defineJobTypeProcessors}, typed against
 * its own job type definitions. This function merges them with compile-time
 * duplicate detection — overlapping processor keys produce a type error.
 *
 * The return type preserves the specific processor keys from each slice while
 * widening the handler types so the result is assignable to
 * `InProcessWorkerProcessors` expected by `createInProcessWorker`.
 *
 * @example
 * const worker = await createInProcessWorker({
 *   client,
 *   processors: mergeJobTypeProcessors(orderProcessors, notificationProcessors),
 * });
 */
export const mergeJobTypeProcessors = <
  const TSlices extends readonly [object, object, ...object[]],
>(
  ...slices: ValidatedSlices<TSlices> & TSlices
): { [K in MergedKeys<TSlices>]: InProcessWorkerProcessor<any, any, K> } => {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const slice of slices as unknown as object[]) {
    for (const key of Object.keys(slice)) {
      if (seen.has(key)) {
        duplicates.push(key);
      }
      seen.add(key);
    }
  }
  if (duplicates.length > 0) {
    throw new DuplicateJobTypeError(`Duplicate processor keys: ${duplicates.join(", ")}`, {
      duplicateTypeNames: duplicates,
    });
  }
  return Object.assign({}, ...(slices as unknown as object[])) as {
    [K in MergedKeys<TSlices>]: InProcessWorkerProcessor<any, any, K>;
  };
};
