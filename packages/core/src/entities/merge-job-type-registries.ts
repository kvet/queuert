import { DuplicateJobTypeError } from "../errors.js";
import {
  type JobTypeRegistry,
  createNoopJobTypeRegistry,
  definitionsSymbol,
  noopRegistries,
} from "./job-type-registry.js";
import { type BaseJobTypeDefinitions } from "./job-type.js";

/** Extract the definitions phantom type from a registry. */
type ExtractDefinitions<T> = T extends JobTypeRegistry<infer D> ? D : never;

/** Recursively merge definitions from a tuple of registries. */
type MergeDefinitions<T extends readonly JobTypeRegistry<any>[]> = T extends readonly [
  infer First extends JobTypeRegistry<any>,
  ...infer Rest extends readonly JobTypeRegistry<any>[],
]
  ? ExtractDefinitions<First> & MergeDefinitions<Rest>
  : unknown;

/** Identity when no duplicates; error string when duplicates exist. */
type AssertNoDuplicates<Existing, New, Success> = [keyof Existing & keyof New & string] extends [
  never,
]
  ? Success
  : `Duplicate job type: ${keyof Existing & keyof New & string}`;

/** Recursively validate each registry against accumulated definitions. */
type ValidatedRegistries<
  T extends readonly JobTypeRegistry<any>[],
  Acc = Record<never, never>,
> = T extends readonly [
  infer First extends JobTypeRegistry<any>,
  ...infer Rest extends readonly JobTypeRegistry<any>[],
]
  ? readonly [
      AssertNoDuplicates<Acc, ExtractDefinitions<First>, First>,
      ...ValidatedRegistries<Rest, Acc & ExtractDefinitions<First>>,
    ]
  : readonly [];

/**
 * Merge multiple job type registries into one.
 *
 * Detects duplicate job type names at compile time via conditional types
 * and at runtime via {@link JobTypeRegistry.getTypeNames}.
 * When all registries are noop (from {@link defineJobTypes}), returns a new noop registry.
 * When validated registries are present, routes calls deterministically
 * so validation errors propagate correctly.
 *
 * @example
 * const ordersRegistry = defineJobTypes<OrderJobTypes>();
 * const notificationsRegistry = defineJobTypes<NotificationJobTypes>();
 * const registry = mergeJobTypeRegistries(ordersRegistry, notificationsRegistry);
 */
export const mergeJobTypeRegistries = <
  const TRegistries extends readonly [
    JobTypeRegistry<any>,
    JobTypeRegistry<any>,
    ...JobTypeRegistry<any>[],
  ],
>(
  ...registries: ValidatedRegistries<TRegistries> & TRegistries
): JobTypeRegistry<MergeDefinitions<TRegistries>> => {
  const regs = registries as unknown as JobTypeRegistry<any>[];
  const allNoop = regs.every((r) => noopRegistries.has(r));

  if (allNoop) {
    return createNoopJobTypeRegistry<MergeDefinitions<TRegistries> & BaseJobTypeDefinitions>();
  }

  const validated = regs.filter((r) => !noopRegistries.has(r));
  const hasNoop = validated.length < regs.length;

  // Build type-name-to-registry lookup for deterministic routing.
  const typeNameMap = new Map<string, JobTypeRegistry<any>>();
  const duplicates: string[] = [];
  for (const registry of validated) {
    for (const typeName of registry.getTypeNames()) {
      if (typeNameMap.has(typeName)) {
        duplicates.push(typeName);
      }
      typeNameMap.set(typeName, registry);
    }
  }
  if (duplicates.length > 0) {
    throw new DuplicateJobTypeError(
      `Duplicate job type names across registries: ${duplicates.join(", ")}`,
      { duplicateTypeNames: duplicates },
    );
  }

  /**
   * Route a call to the correct registry.
   * If the type is in the map, call it directly (errors propagate).
   * Otherwise fall through to noop passthrough (if noop registries are present).
   */
  const route = <TResult>(
    typeName: string,
    fn: (registry: JobTypeRegistry<any>) => TResult,
    fallback: () => TResult,
  ): TResult => {
    const mapped = typeNameMap.get(typeName);
    if (mapped) return fn(mapped);
    if (!hasNoop && validated.length > 0) {
      return fn(validated[validated.length - 1]);
    }
    return fallback();
  };

  return {
    getTypeNames: () => [...typeNameMap.keys()],
    validateEntry: (typeName) => {
      route(
        typeName,
        (r) => {
          r.validateEntry(typeName);
        },
        () => {},
      );
    },
    parseInput: (typeName, input) =>
      route(
        typeName,
        (r) => r.parseInput(typeName, input),
        () => input,
      ),
    parseOutput: (typeName, output) =>
      route(
        typeName,
        (r) => r.parseOutput(typeName, output),
        () => output,
      ),
    validateContinueWith: (typeName, target) => {
      route(
        typeName,
        (r) => {
          r.validateContinueWith(typeName, target);
        },
        () => {},
      );
    },
    validateBlockers: (typeName, blockers) => {
      route(
        typeName,
        (r) => {
          r.validateBlockers(typeName, blockers);
        },
        () => {},
      );
    },
    [definitionsSymbol]: undefined as unknown as MergeDefinitions<TRegistries>,
  };
};
