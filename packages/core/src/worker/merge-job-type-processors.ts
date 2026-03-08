import { type BaseJobTypeDefinitions } from "../entities/job-type.js";
import { DuplicateJobTypeError } from "../errors.js";
import {
  type JobTypeProcessorsRegistry,
  type ProcessorsRegistryDefinitions,
  type ProcessorsRegistryExternalDefinitions,
  processorsDefinitionsSymbol,
  processorsExternalDefinitionsSymbol,
} from "./job-type-processors-registry.js";

/** Collect definitions from a tuple of processors registries. */
type MergedDefinitions<T extends readonly JobTypeProcessorsRegistry[]> = T extends readonly [
  infer First extends JobTypeProcessorsRegistry,
  ...infer Rest extends readonly JobTypeProcessorsRegistry[],
]
  ? ProcessorsRegistryDefinitions<First> & MergedDefinitions<Rest>
  : Record<never, never>;

/** Collect external definitions from a tuple of processors registries. */
type MergedExternalDefinitions<T extends readonly JobTypeProcessorsRegistry[]> =
  T extends readonly [
    infer First extends JobTypeProcessorsRegistry,
    ...infer Rest extends readonly JobTypeProcessorsRegistry[],
  ]
    ? ProcessorsRegistryExternalDefinitions<First> & MergedExternalDefinitions<Rest>
    : Record<never, never>;

/**
 * Merge processors registries from multiple slices into a single registry.
 *
 * Each slice defines processors using {@link defineJobTypeProcessorRegistry}, typed against
 * its own job type definitions. This function merges them with runtime
 * duplicate detection — overlapping processor keys throw {@link DuplicateJobTypeError}.
 *
 * @example
 * const worker = await createInProcessWorker({
 *   client,
 *   processorRegistry: mergeJobTypeProcessorRegistries(orderProcessors, notificationProcessors),
 * });
 */
export const mergeJobTypeProcessorRegistries = <
  const TSlices extends readonly [
    JobTypeProcessorsRegistry,
    JobTypeProcessorsRegistry,
    ...JobTypeProcessorsRegistry[],
  ],
>(
  ...slices: TSlices
): JobTypeProcessorsRegistry<
  MergedDefinitions<TSlices> & BaseJobTypeDefinitions,
  MergedExternalDefinitions<TSlices> & BaseJobTypeDefinitions
> => {
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
    [processorsDefinitionsSymbol]: undefined as unknown as MergedDefinitions<TSlices> &
      BaseJobTypeDefinitions,
    [processorsExternalDefinitionsSymbol]:
      undefined as unknown as MergedExternalDefinitions<TSlices> & BaseJobTypeDefinitions,
  }) as JobTypeProcessorsRegistry<
    MergedDefinitions<TSlices> & BaseJobTypeDefinitions,
    MergedExternalDefinitions<TSlices> & BaseJobTypeDefinitions
  >;
};
