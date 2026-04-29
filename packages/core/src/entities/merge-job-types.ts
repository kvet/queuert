import { DuplicateJobTypeError, UnknownJobTypeError } from "../errors.js";
import { type BaseJobTypeDefinitions } from "./job-type.js";
import {
  type JobTypes,
  createNoopJobTypes,
  definitionsSymbol,
  externalDefinitionsSymbol,
  noopRegistries,
} from "./job-types.js";

/** Extract the definitions phantom type from a {@link JobTypes} slice. @internal */
type ExtractDefinitions<T> = T extends JobTypes<infer D> ? D : never;

/** Recursively merge definitions from a tuple of {@link JobTypes} slices as a UNION (4-at-a-time to avoid TS2589). @internal */
export type MergeDefinitions<T extends readonly JobTypes<any>[]> = T extends readonly [
  infer A extends JobTypes<any>,
  infer B extends JobTypes<any>,
  infer C extends JobTypes<any>,
  infer D extends JobTypes<any>,
  ...infer Rest extends readonly JobTypes<any>[],
]
  ?
      | ExtractDefinitions<A>
      | ExtractDefinitions<B>
      | ExtractDefinitions<C>
      | ExtractDefinitions<D>
      | MergeDefinitions<Rest>
  : T extends readonly [
        infer First extends JobTypes<any>,
        ...infer Rest extends readonly JobTypes<any>[],
      ]
    ? ExtractDefinitions<First> | MergeDefinitions<Rest>
    : never;

/** Distributive keyof that works on unions — returns all keys, not just common ones. @internal */
type AllKeys<T> = T extends any ? keyof T & string : never;

/** Identity when no duplicates; error string when duplicates exist. @internal */
type AssertNoDuplicates<Existing, New, Success> = [AllKeys<Existing> & AllKeys<New>] extends [never]
  ? Success
  : `Duplicate job type: ${AllKeys<Existing> & AllKeys<New>}`;

/** Recursively validate each slice against accumulated definitions (4-at-a-time). @internal */
export type ValidatedSlices<
  T extends readonly JobTypes<any>[],
  Acc = Record<never, never>,
> = T extends readonly [
  infer A extends JobTypes<any>,
  infer B extends JobTypes<any>,
  infer C extends JobTypes<any>,
  infer D extends JobTypes<any>,
  ...infer Rest extends readonly JobTypes<any>[],
]
  ? readonly [
      AssertNoDuplicates<Acc, ExtractDefinitions<A>, A>,
      AssertNoDuplicates<Acc & ExtractDefinitions<A>, ExtractDefinitions<B>, B>,
      AssertNoDuplicates<
        Acc & ExtractDefinitions<A> & ExtractDefinitions<B>,
        ExtractDefinitions<C>,
        C
      >,
      AssertNoDuplicates<
        Acc & ExtractDefinitions<A> & ExtractDefinitions<B> & ExtractDefinitions<C>,
        ExtractDefinitions<D>,
        D
      >,
      ...ValidatedSlices<
        Rest,
        Acc &
          ExtractDefinitions<A> &
          ExtractDefinitions<B> &
          ExtractDefinitions<C> &
          ExtractDefinitions<D>
      >,
    ]
  : T extends readonly [
        infer First extends JobTypes<any>,
        ...infer Rest extends readonly JobTypes<any>[],
      ]
    ? readonly [
        AssertNoDuplicates<Acc, ExtractDefinitions<First>, First>,
        ...ValidatedSlices<Rest, Acc & ExtractDefinitions<First>>,
      ]
    : readonly [];

/**
 * Merge multiple JobTypes slices into one. Routes calls to the owning slice
 * so per-slice validation errors propagate correctly; falls back to a noop
 * when any slice is noop (from {@link defineJobTypes}).
 *
 * When every slice is validated (built with {@link createJobTypes}) and the
 * caller references an unknown type name, throws {@link UnknownJobTypeError}.
 * Mixed merges that include at least one noop slice keep noop semantics for
 * unknown types — silently passing inputs/outputs through.
 *
 * @internal — invoked by {@link createClient} when users pass an array of slices.
 */
export const mergeJobTypes = <const TSlices extends readonly [JobTypes<any>, ...JobTypes<any>[]]>(
  slices: ValidatedSlices<TSlices> & TSlices,
): JobTypes<MergeDefinitions<TSlices>> => {
  const regs = slices as unknown as JobTypes<any>[];
  const allNoop = regs.every((r) => noopRegistries.has(r));

  if (allNoop) {
    return createNoopJobTypes<
      MergeDefinitions<TSlices> & BaseJobTypeDefinitions
    >() as unknown as JobTypes<MergeDefinitions<TSlices>>;
  }

  const validated = regs.filter((r) => !noopRegistries.has(r));
  const hasNoop = validated.length < regs.length;

  const typeNameMap = new Map<string, JobTypes<any>>();
  const duplicates: string[] = [];
  for (const registry of validated) {
    for (const typeName of registry.getTypeNames()) {
      if (typeNameMap.has(typeName)) {
        duplicates.push(typeName);
      } else {
        typeNameMap.set(typeName, registry);
      }
    }
  }
  if (duplicates.length > 0) {
    throw new DuplicateJobTypeError(
      `Duplicate job type names across slices: ${duplicates.join(", ")}`,
      { duplicateTypeNames: duplicates },
    );
  }

  const route = <TResult>(
    typeName: string,
    fn: (registry: JobTypes<any>) => TResult,
    fallback: () => TResult,
  ): TResult => {
    const mapped = typeNameMap.get(typeName);
    if (mapped) return fn(mapped);
    if (hasNoop) return fallback();
    throw new UnknownJobTypeError(
      `Unknown job type "${typeName}" — not registered by any merged slice`,
      { typeName, registeredTypeNames: [...typeNameMap.keys()] },
    );
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
    [definitionsSymbol]: undefined as unknown as MergeDefinitions<TSlices>,
    [externalDefinitionsSymbol]: undefined as unknown as Record<never, never>,
  };
};
