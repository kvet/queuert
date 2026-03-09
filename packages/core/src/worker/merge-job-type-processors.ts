import { type BaseJobTypeDefinitions } from "../entities/job-type.js";
import { DuplicateJobTypeError } from "../errors.js";
import {
  type ExternalJobTypeProcessorRegistryDefinitions,
  type JobTypeProcessorRegistry,
  type JobTypeProcessorRegistryDefinitions,
  type JobTypeProcessorRegistryNavigation,
  processorDefinitionsSymbol,
  processorExternalDefinitionsSymbol,
  processorNavigationSymbol,
} from "./job-type-processor-registry.js";

/** Collect definitions from a tuple of processor registries (4-at-a-time to avoid TS2589). */
type MergedDefinitions<T extends readonly JobTypeProcessorRegistry[]> = T extends readonly [
  infer A extends JobTypeProcessorRegistry,
  infer B extends JobTypeProcessorRegistry,
  infer C extends JobTypeProcessorRegistry,
  infer D extends JobTypeProcessorRegistry,
  ...infer Rest extends readonly JobTypeProcessorRegistry[],
]
  ? JobTypeProcessorRegistryDefinitions<A> &
      JobTypeProcessorRegistryDefinitions<B> &
      JobTypeProcessorRegistryDefinitions<C> &
      JobTypeProcessorRegistryDefinitions<D> &
      MergedDefinitions<Rest>
  : T extends readonly [
        infer First extends JobTypeProcessorRegistry,
        ...infer Rest extends readonly JobTypeProcessorRegistry[],
      ]
    ? JobTypeProcessorRegistryDefinitions<First> & MergedDefinitions<Rest>
    : Record<never, never>;

/** Collect external definitions from a tuple of processor registries (4-at-a-time). */
type MergedExternalDefinitions<T extends readonly JobTypeProcessorRegistry[]> = T extends readonly [
  infer A extends JobTypeProcessorRegistry,
  infer B extends JobTypeProcessorRegistry,
  infer C extends JobTypeProcessorRegistry,
  infer D extends JobTypeProcessorRegistry,
  ...infer Rest extends readonly JobTypeProcessorRegistry[],
]
  ? ExternalJobTypeProcessorRegistryDefinitions<A> &
      ExternalJobTypeProcessorRegistryDefinitions<B> &
      ExternalJobTypeProcessorRegistryDefinitions<C> &
      ExternalJobTypeProcessorRegistryDefinitions<D> &
      MergedExternalDefinitions<Rest>
  : T extends readonly [
        infer First extends JobTypeProcessorRegistry,
        ...infer Rest extends readonly JobTypeProcessorRegistry[],
      ]
    ? ExternalJobTypeProcessorRegistryDefinitions<First> & MergedExternalDefinitions<Rest>
    : Record<never, never>;

/** Merge pre-computed navigation maps from a tuple of processor registries (4-at-a-time).
 *  Base case is `unknown` (not `Record<never, never>`) because `unknown` is the identity element for `&` intersection. */
type MergedProcessorNavigation<T extends readonly JobTypeProcessorRegistry[]> = T extends readonly [
  infer A extends JobTypeProcessorRegistry,
  infer B extends JobTypeProcessorRegistry,
  infer C extends JobTypeProcessorRegistry,
  infer D extends JobTypeProcessorRegistry,
  ...infer Rest extends readonly JobTypeProcessorRegistry[],
]
  ? JobTypeProcessorRegistryNavigation<A> &
      JobTypeProcessorRegistryNavigation<B> &
      JobTypeProcessorRegistryNavigation<C> &
      JobTypeProcessorRegistryNavigation<D> &
      MergedProcessorNavigation<Rest>
  : T extends readonly [
        infer First extends JobTypeProcessorRegistry,
        ...infer Rest extends readonly JobTypeProcessorRegistry[],
      ]
    ? JobTypeProcessorRegistryNavigation<First> & MergedProcessorNavigation<Rest>
    : unknown;

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
 *   processorRegistry: mergeJobTypeProcessorRegistries(orderProcessorRegistry, notificationProcessorRegistry),
 * });
 */
export const mergeJobTypeProcessorRegistries = <
  const TSlices extends readonly [
    JobTypeProcessorRegistry,
    JobTypeProcessorRegistry,
    ...JobTypeProcessorRegistry[],
  ],
>(
  ...slices: TSlices
): JobTypeProcessorRegistry<
  MergedDefinitions<TSlices> & BaseJobTypeDefinitions,
  MergedExternalDefinitions<TSlices> & BaseJobTypeDefinitions,
  MergedProcessorNavigation<TSlices>
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
    [processorDefinitionsSymbol]: undefined as unknown as MergedDefinitions<TSlices> &
      BaseJobTypeDefinitions,
    [processorExternalDefinitionsSymbol]:
      undefined as unknown as MergedExternalDefinitions<TSlices> & BaseJobTypeDefinitions,
    [processorNavigationSymbol]: undefined as unknown as MergedProcessorNavigation<TSlices>,
  }) as JobTypeProcessorRegistry<
    MergedDefinitions<TSlices> & BaseJobTypeDefinitions,
    MergedExternalDefinitions<TSlices> & BaseJobTypeDefinitions,
    MergedProcessorNavigation<TSlices>
  >;
};
