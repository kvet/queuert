import { DuplicateJobTypeError, UnknownJobTypeError } from "../errors.js";
import { type BaseJobTypeDefinitions } from "./job-type.js";
import {
  type JobTypes,
  createNoopJobTypes,
  definitionsSymbol,
  externalDefinitionsSymbol,
  noopRegistries,
} from "./job-types.js";

/** @internal Recursively union the definitions of each slice in a tuple, 4-at-a-time to avoid TS2589. */
type SliceUnion<T> = T extends readonly [
  infer A extends JobTypes<BaseJobTypeDefinitions>,
  infer B extends JobTypes<BaseJobTypeDefinitions>,
  infer C extends JobTypes<BaseJobTypeDefinitions>,
  infer D extends JobTypes<BaseJobTypeDefinitions>,
  ...infer Rest extends readonly JobTypes<BaseJobTypeDefinitions>[],
]
  ?
      | (A extends JobTypes<infer DA extends BaseJobTypeDefinitions> ? DA : never)
      | (B extends JobTypes<infer DB extends BaseJobTypeDefinitions> ? DB : never)
      | (C extends JobTypes<infer DC extends BaseJobTypeDefinitions> ? DC : never)
      | (D extends JobTypes<infer DD extends BaseJobTypeDefinitions> ? DD : never)
      | SliceUnion<Rest>
  : T extends readonly [
        infer First extends JobTypes<BaseJobTypeDefinitions>,
        ...infer Rest extends readonly JobTypes<BaseJobTypeDefinitions>[],
      ]
    ?
        | (First extends JobTypes<infer D extends BaseJobTypeDefinitions> ? D : never)
        | SliceUnion<Rest>
    : never;

/**
 * Resolve the definitions for a value that is either a single {@link JobTypes}
 * slice or a `readonly` array of slices. Returns a union of each slice's
 * definitions; the empty-tuple case maps to `Record<never, never>` so adapter
 * generics can default the parameter and omit it cleanly.
 */
export type JobTypesDefinitions<
  T extends JobTypes<BaseJobTypeDefinitions> | readonly JobTypes<BaseJobTypeDefinitions>[],
> = T extends readonly []
  ? Record<never, never>
  : T extends readonly JobTypes<BaseJobTypeDefinitions>[]
    ? SliceUnion<T>
    : T extends JobTypes<infer D extends BaseJobTypeDefinitions>
      ? D
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
      AssertNoDuplicates<Acc, JobTypesDefinitions<A>, A>,
      AssertNoDuplicates<Acc & JobTypesDefinitions<A>, JobTypesDefinitions<B>, B>,
      AssertNoDuplicates<
        Acc & JobTypesDefinitions<A> & JobTypesDefinitions<B>,
        JobTypesDefinitions<C>,
        C
      >,
      AssertNoDuplicates<
        Acc & JobTypesDefinitions<A> & JobTypesDefinitions<B> & JobTypesDefinitions<C>,
        JobTypesDefinitions<D>,
        D
      >,
      ...ValidatedSlices<
        Rest,
        Acc &
          JobTypesDefinitions<A> &
          JobTypesDefinitions<B> &
          JobTypesDefinitions<C> &
          JobTypesDefinitions<D>
      >,
    ]
  : T extends readonly [
        infer First extends JobTypes<any>,
        ...infer Rest extends readonly JobTypes<any>[],
      ]
    ? readonly [
        AssertNoDuplicates<Acc, JobTypesDefinitions<First>, First>,
        ...ValidatedSlices<Rest, Acc & JobTypesDefinitions<First>>,
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
): JobTypes<JobTypesDefinitions<TSlices>> => {
  const regs = slices as unknown as JobTypes<any>[];
  const allNoop = regs.every((r) => noopRegistries.has(r));

  if (allNoop) {
    return createNoopJobTypes<
      JobTypesDefinitions<TSlices> & BaseJobTypeDefinitions
    >() as unknown as JobTypes<JobTypesDefinitions<TSlices>>;
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
    [definitionsSymbol]: undefined as unknown as JobTypesDefinitions<TSlices>,
    [externalDefinitionsSymbol]: undefined as unknown as Record<never, never>,
  };
};
