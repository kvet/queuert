import { type BaseJobTypeDefinitions } from "../entities/job-type.js";
import { DuplicateJobTypeError } from "../errors.js";
import {
  type ExternalJobTypeProcessorRegistryDefinitions,
  type JobTypeProcessorRegistry,
  type JobTypeProcessorRegistryDefinitions,
  processorDefinitionsSymbol,
  processorExternalDefinitionsSymbol,
} from "./job-type-processor-registry.js";

/** Collect definitions from a tuple of processor registries as a UNION (4-at-a-time to avoid TS2589). */
type MergedDefinitions<T extends readonly JobTypeProcessorRegistry[]> = T extends readonly [
  infer A extends JobTypeProcessorRegistry,
  infer B extends JobTypeProcessorRegistry,
  infer C extends JobTypeProcessorRegistry,
  infer D extends JobTypeProcessorRegistry,
  ...infer Rest extends readonly JobTypeProcessorRegistry[],
]
  ?
      | JobTypeProcessorRegistryDefinitions<A>
      | JobTypeProcessorRegistryDefinitions<B>
      | JobTypeProcessorRegistryDefinitions<C>
      | JobTypeProcessorRegistryDefinitions<D>
      | MergedDefinitions<Rest>
  : T extends readonly [
        infer First extends JobTypeProcessorRegistry,
        ...infer Rest extends readonly JobTypeProcessorRegistry[],
      ]
    ? JobTypeProcessorRegistryDefinitions<First> | MergedDefinitions<Rest>
    : never;

/** Collect external definitions from a tuple of processor registries as a UNION (4-at-a-time). */
type MergedExternalDefinitions<T extends readonly JobTypeProcessorRegistry[]> = T extends readonly [
  infer A extends JobTypeProcessorRegistry,
  infer B extends JobTypeProcessorRegistry,
  infer C extends JobTypeProcessorRegistry,
  infer D extends JobTypeProcessorRegistry,
  ...infer Rest extends readonly JobTypeProcessorRegistry[],
]
  ?
      | ExternalJobTypeProcessorRegistryDefinitions<A>
      | ExternalJobTypeProcessorRegistryDefinitions<B>
      | ExternalJobTypeProcessorRegistryDefinitions<C>
      | ExternalJobTypeProcessorRegistryDefinitions<D>
      | MergedExternalDefinitions<Rest>
  : T extends readonly [
        infer First extends JobTypeProcessorRegistry,
        ...infer Rest extends readonly JobTypeProcessorRegistry[],
      ]
    ? ExternalJobTypeProcessorRegistryDefinitions<First> | MergedExternalDefinitions<Rest>
    : never;

/**
 * Merge processor registries from multiple slices into a single registry.
 *
 * Each slice defines processors using {@link createJobTypeProcessorRegistry}, typed against
 * its own job type definitions. This function merges them with runtime
 * duplicate detection — overlapping processor keys throw {@link DuplicateJobTypeError}.
 *
 * @example
 * const worker = await createInProcessWorker({
 *   client,
 *   jobTypeProcessorRegistry: mergeJobTypeProcessorRegistries({
 *     slices: [orderJobTypeProcessorRegistry, notificationJobTypeProcessorRegistry],
 *   }),
 * });
 */
export const mergeJobTypeProcessorRegistries = <
  const TSlices extends readonly [
    JobTypeProcessorRegistry,
    JobTypeProcessorRegistry,
    ...JobTypeProcessorRegistry[],
  ],
>(options: {
  slices: TSlices;
}): JobTypeProcessorRegistry<MergedDefinitions<TSlices>, MergedExternalDefinitions<TSlices>> => {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const slice of options.slices as unknown as object[]) {
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
  return Object.assign({}, ...(options.slices as unknown as object[]), {
    [processorDefinitionsSymbol]: undefined as unknown as MergedDefinitions<TSlices> &
      BaseJobTypeDefinitions,
    [processorExternalDefinitionsSymbol]:
      undefined as unknown as MergedExternalDefinitions<TSlices> & BaseJobTypeDefinitions,
  }) as JobTypeProcessorRegistry<
    MergedDefinitions<TSlices> & BaseJobTypeDefinitions,
    MergedExternalDefinitions<TSlices> & BaseJobTypeDefinitions
  >;
};
