import { type BaseJobTypeDefinitions } from "../entities/job-type.js";
import { DuplicateJobTypeError } from "../errors.js";
import {
  type ProcessorDefinitions,
  type Processors,
  processorsDefinitionsSymbol,
} from "./processors.js";

/** Collect definitions from a tuple of processor slices as a UNION (4-at-a-time to avoid TS2589). @internal */
export type MergedProcessorDefinitions<T extends readonly Processors[]> = T extends readonly [
  infer A extends Processors,
  infer B extends Processors,
  infer C extends Processors,
  infer D extends Processors,
  ...infer Rest extends readonly Processors[],
]
  ?
      | ProcessorDefinitions<A>
      | ProcessorDefinitions<B>
      | ProcessorDefinitions<C>
      | ProcessorDefinitions<D>
      | MergedProcessorDefinitions<Rest>
  : T extends readonly [infer First extends Processors, ...infer Rest extends readonly Processors[]]
    ? ProcessorDefinitions<First> | MergedProcessorDefinitions<Rest>
    : never;

/** Distributive `keyof T & string` — returns processor keys across a union of slices. @internal */
type _AllProcessorKeys<T> = T extends any ? keyof T & string : never;

/** Identity when no duplicates; error string when duplicates exist. @internal */
type AssertNoDuplicateProcessors<Existing, New, Success> = [
  _AllProcessorKeys<Existing> & _AllProcessorKeys<New>,
] extends [never]
  ? Success
  : `Duplicate job type: ${_AllProcessorKeys<Existing> & _AllProcessorKeys<New>}`;

/**
 * Recursively validate each slice's processor keys against accumulated keys
 * (4-at-a-time to avoid TS2589). Flags overlaps at the merge call signature.
 * @internal
 */
export type ValidatedProcessorSlices<
  T extends readonly Processors[],
  Acc = Record<never, never>,
> = T extends readonly [
  infer A extends Processors,
  infer B extends Processors,
  infer C extends Processors,
  infer D extends Processors,
  ...infer Rest extends readonly Processors[],
]
  ? readonly [
      AssertNoDuplicateProcessors<Acc, A, A>,
      AssertNoDuplicateProcessors<Acc | A, B, B>,
      AssertNoDuplicateProcessors<Acc | A | B, C, C>,
      AssertNoDuplicateProcessors<Acc | A | B | C, D, D>,
      ...ValidatedProcessorSlices<Rest, Acc | A | B | C | D>,
    ]
  : T extends readonly [infer First extends Processors, ...infer Rest extends readonly Processors[]]
    ? readonly [
        AssertNoDuplicateProcessors<Acc, First, First>,
        ...ValidatedProcessorSlices<Rest, Acc | First>,
      ]
    : readonly [];

/**
 * Merge Processors slices into a single registry. Internal — invoked by
 * {@link createInProcessWorker} when users pass an array of slices.
 *
 * Detects duplicate job-type names at compile time via {@link ValidatedProcessorSlices}
 * and at runtime via overlapping keys across slices.
 *
 * @internal
 */
export const mergeProcessors = <const TSlices extends readonly [Processors, ...Processors[]]>(
  slices: ValidatedProcessorSlices<TSlices> & TSlices,
): Processors<MergedProcessorDefinitions<TSlices>> => {
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
  return Object.assign({}, ...(slices as unknown as object[]), {
    [processorsDefinitionsSymbol]: undefined as unknown as MergedProcessorDefinitions<TSlices> &
      BaseJobTypeDefinitions,
  }) as Processors<MergedProcessorDefinitions<TSlices> & BaseJobTypeDefinitions>;
};
