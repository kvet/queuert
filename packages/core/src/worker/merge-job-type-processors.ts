import { DuplicateJobTypeError } from "../errors.js";
import { type ValidatedProcessors } from "../in-process-worker.js";

/** Identity when no duplicate keys; error string when duplicates exist. */
type AssertNoDuplicateKeys<AccKeys extends string, NewKeys extends string, Success> = [
  AccKeys & NewKeys,
] extends [never]
  ? Success
  : `Duplicate processor: ${AccKeys & NewKeys}`;

/** Recursively validate each processor map against accumulated keys. */
type ValidatedSlices<
  T extends readonly object[],
  AccKeys extends string = never,
> = T extends readonly [infer First extends object, ...infer Rest extends readonly object[]]
  ? readonly [
      AssertNoDuplicateKeys<AccKeys, keyof First & string, First>,
      ...ValidatedSlices<Rest, AccKeys | (keyof First & string)>,
    ]
  : readonly [];

/** Collect all keys from a tuple of objects. */
type MergedKeys<T extends readonly object[]> = T extends readonly [
  infer First,
  ...infer Rest extends readonly object[],
]
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
): ValidatedProcessors<MergedKeys<TSlices>> => {
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
  return Object.assign({}, ...(slices as unknown as object[])) as ValidatedProcessors<
    MergedKeys<TSlices>
  >;
};
