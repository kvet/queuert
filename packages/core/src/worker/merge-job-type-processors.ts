import { DuplicateJobTypeError } from "../errors.js";
import { type InProcessWorkerProcessor } from "../in-process-worker.js";

type AssertNoDuplicateKeys<AccKeys extends string, NewKeys extends string, Success> = [
  AccKeys & NewKeys,
] extends [never]
  ? Success
  : `Duplicate processor: ${AccKeys & NewKeys}`;

/** Tail-recursive validation: each slice is checked against accumulated keys (up to 20 slices). */
type ValidatedSlices<
  T extends readonly object[],
  _AccKeys extends string = never,
  _Acc extends readonly any[] = readonly [],
  _Depth extends any[] = [],
> = _Depth["length"] extends 20
  ? readonly [..._Acc, ...T]
  : T extends readonly [infer First extends object, ...infer Rest extends readonly object[]]
    ? ValidatedSlices<
        Rest,
        _AccKeys | (keyof First & string),
        readonly [..._Acc, AssertNoDuplicateKeys<_AccKeys, keyof First & string, First>],
        [..._Depth, any]
      >
    : _Acc;

type MergedKeys<T extends readonly object[]> = T[number] extends infer U
  ? U extends object
    ? keyof U & string
    : never
  : never;

export const mergedProcessorsSymbol: unique symbol = Symbol("queuert.mergedProcessors");

/**
 * Brand carried by the return value of {@link mergeJobTypeProcessors}.
 * Used by `createInProcessWorker` overloads to skip expensive per-key
 * constraint evaluation for pre-validated merged processor maps.
 */
export type MergedProcessorsBrand<TKeys extends string = string> = {
  [mergedProcessorsSymbol]: TKeys;
};

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
): MergedProcessorsBrand<MergedKeys<TSlices>> &
  Record<MergedKeys<TSlices>, InProcessWorkerProcessor<any, any, any>> => {
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
  return Object.assign({}, ...(slices as unknown as object[])) as MergedProcessorsBrand<
    MergedKeys<TSlices>
  > &
    Record<MergedKeys<TSlices>, InProcessWorkerProcessor<any, any, any>>;
};
