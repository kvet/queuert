import { JobTypeValidationError } from "../errors.js";
import { type BaseJobTypeDefinitions, type ResolvedJobTypeReference } from "./job-type.js";
import { isJsonSerializable } from "./json-serializable.js";

/** Symbol used to carry phantom job type definitions on a registry. */
export const definitionsSymbol: unique symbol = Symbol("queuert.definitions");

/** Symbol used to carry phantom external job type definitions on a registry. */
export const externalDefinitionsSymbol: unique symbol = Symbol("queuert.externalDefinitions");

/** Extract the job type definitions from a {@link JobTypes}. */
export type JobTypeDefinitions<T extends JobTypes<any>> = T[typeof definitionsSymbol];

/** Extract the external job type definitions from a {@link JobTypes}. */
export type ExternalJobTypeDefinitions<T extends JobTypes<any>> =
  T[typeof externalDefinitionsSymbol];

/**
 * Set of registries produced by {@link createNoopJobTypes} (i.e. via
 * {@link defineJobTypes}). Consulted by {@link mergeJobTypes} to decide
 * whether to fall back to no-op codec routing when a type name is not
 * owned by any validated slice.
 */
export const noopRegistries: WeakSet<JobTypes<any>> = new WeakSet<JobTypes<any>>();

/**
 * A value tagged with the job type it belongs to and whether it represents an
 * input or output. Both fields are always populated by the runtime — analogous
 * to {@link ResolvedJobTypeReference} for codec items.
 */
export type ResolvedJobTypeValue = {
  readonly typeName: string;
  readonly direction: "input" | "output";
  readonly value: unknown;
};

/**
 * Configuration for {@link createJobTypes}. Adapters implement these functions
 * to provide validation and codec logic. Functions should throw on failure
 * (any error type) — the wrapper translates them into
 * {@link JobTypeValidationError}.
 */
export type JobTypesOptions = {
  /** Returns the known job type names. Used for runtime duplicate detection when {@link createClient} merges slices. */
  getTypeNames: () => readonly string[];
  /** Validate that a job type can start a chain. Throw on failure. */
  validateEntry: (typeName: string) => void;

  /**
   * Encode runtime values into their JSON-safe storage form.
   * Heterogeneous batch: items may carry mixed `typeName`s and mixed
   * `direction`s (input/output). Throw on validation failure.
   */
  encode: (items: readonly ResolvedJobTypeValue[]) => Promise<unknown[]>;
  /**
   * Decode persisted values back into their runtime form.
   * Heterogeneous batch: items may carry mixed `typeName`s and mixed
   * `direction`s (input/output). Throw on validation failure
   * (e.g. corruption / schema drift).
   */
  decode: (items: readonly ResolvedJobTypeValue[]) => Promise<unknown[]>;

  /** Validate continuation target. Receives `{ typeName, input }` (runtime form) for nominal/structural validation. Throw on failure. */
  validateContinueWith: (typeName: string, target: ResolvedJobTypeReference) => void;
  /** Validate blocker references. Receives array of `{ typeName, input }` (runtime form). Throw on failure. */
  validateBlockers: (typeName: string, blockers: readonly ResolvedJobTypeReference[]) => void;
};

/**
 * Runtime registry for job type validation and codec.
 *
 * Methods split by purpose:
 * - validate* → throws {@link JobTypeValidationError} or returns void.
 * - encode / decode → batch async; throw on failure; encoded values are
 *   additionally checked against {@link isJsonSerializable} by the wrapper.
 */
export type JobTypes<
  TJobTypeDefinitions = unknown,
  TExternalJobTypeDefinitions = Record<never, never>,
> = {
  /** Validate that a job type can start a chain (is an entry point). Throws JobTypeValidationError on failure. */
  validateEntry: (typeName: string) => void;

  /** Encode a heterogeneous batch of runtime values to their JSON-safe storage form. */
  encode: (items: readonly ResolvedJobTypeValue[]) => Promise<unknown[]>;
  /** Decode a heterogeneous batch of stored values back to their runtime form. */
  decode: (items: readonly ResolvedJobTypeValue[]) => Promise<unknown[]>;

  /** Validate continuation target. Throws JobTypeValidationError on failure. */
  validateContinueWith: (typeName: string, target: ResolvedJobTypeReference) => void;

  /** Validate blocker references. Throws JobTypeValidationError on failure. */
  validateBlockers: (typeName: string, blockers: readonly ResolvedJobTypeReference[]) => void;

  /** Known type names. Returns the type names registered with this registry. */
  readonly getTypeNames: () => readonly string[];

  /** Phantom property for TypeScript type inference. */
  readonly [definitionsSymbol]: TJobTypeDefinitions;

  /** Phantom property for external (cross-slice) type inference. */
  readonly [externalDefinitionsSymbol]: TExternalJobTypeDefinitions;
};

const codeFor = (direction: "input" | "output") =>
  direction === "input" ? "invalid_input" : "invalid_output";

const wrapBatch = async (
  fn: () => Promise<unknown[]>,
  items: readonly ResolvedJobTypeValue[],
  mode: "encode" | "decode",
): Promise<unknown[]> => {
  let result: unknown[];
  try {
    result = await fn();
  } catch (cause) {
    const first = items[0];
    throw new JobTypeValidationError(
      `Failed to ${mode} (${items.length} item${items.length === 1 ? "" : "s"})`,
      {
        code: first ? codeFor(first.direction) : "invalid_input",
        typeName: first?.typeName ?? "",
        details: {
          items: items.map((i) => ({
            typeName: i.typeName,
            direction: i.direction,
            value: i.value,
          })),
        },
        cause,
      },
    );
  }
  if (mode === "encode") {
    for (let i = 0; i < result.length; i++) {
      const check = isJsonSerializable(result[i]);
      if (check !== true) {
        const item = items[i];
        throw new JobTypeValidationError(
          `Encoded ${item.direction} for job type "${item.typeName}" is not JSON-serializable at "${check.path}"`,
          {
            code: codeFor(item.direction),
            typeName: item.typeName,
            details: { path: check.path, direction: item.direction, value: result[i] },
          },
        );
      }
    }
  }
  return result;
};

/**
 * Create a job type registry with runtime validation and codec.
 * Wraps adapter errors in {@link JobTypeValidationError} and enforces
 * {@link isJsonSerializable} on every encoded value.
 *
 * @example
 * const registry = createJobTypes<MyJobTypes>({
 *   getTypeNames: () => Object.keys(schemas),
 *   validateEntry: (typeName) => {
 *     if (!entryTypes.has(typeName)) throw new Error('Not an entry point');
 *   },
 *   encode: async (items) =>
 *     items.map((i) => {
 *       const schema = i.direction === "input"
 *         ? schemas[i.typeName].input
 *         : schemas[i.typeName].output;
 *       if (!schema) throw new Error(...);
 *       return z.encode(schema, i.value);
 *     }),
 *   decode: async (items) =>
 *     items.map((i) => {
 *       const schema = i.direction === "input"
 *         ? schemas[i.typeName].input
 *         : schemas[i.typeName].output;
 *       if (!schema) throw new Error(...);
 *       return z.decode(schema, i.value);
 *     }),
 *   validateContinueWith: (typeName, target) => schemas[typeName].continueWith.parse(target),
 *   validateBlockers: (typeName, blockers) => schemas[typeName].blockers.parse(blockers),
 * });
 */
export const createJobTypes = <
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TExternalJobTypeDefinitions extends BaseJobTypeDefinitions = Record<never, never>,
>(
  config: JobTypesOptions,
): JobTypes<TJobTypeDefinitions, TExternalJobTypeDefinitions> => ({
  getTypeNames: () => config.getTypeNames(),
  validateEntry: (typeName) => {
    try {
      config.validateEntry(typeName);
    } catch (cause) {
      throw new JobTypeValidationError(`Job type "${typeName}" is not an entry point`, {
        code: "not_entry_point",
        typeName,
        cause,
      });
    }
  },
  encode: async (items) => wrapBatch(async () => config.encode(items), items, "encode"),
  decode: async (items) => wrapBatch(async () => config.decode(items), items, "decode"),
  validateContinueWith: (typeName, target) => {
    try {
      config.validateContinueWith(typeName, target);
    } catch (cause) {
      throw new JobTypeValidationError(
        `Job type "${typeName}" cannot continue to "${target.typeName}"`,
        { code: "invalid_continuation", typeName, details: { target }, cause },
      );
    }
  },
  validateBlockers: (typeName, blockers) => {
    try {
      config.validateBlockers(typeName, blockers);
    } catch (cause) {
      throw new JobTypeValidationError(`Invalid blockers for job type "${typeName}"`, {
        code: "invalid_blockers",
        typeName,
        details: { blockers },
        cause,
      });
    }
  },
  [definitionsSymbol]: undefined as unknown as TJobTypeDefinitions,
  [externalDefinitionsSymbol]: undefined as unknown as TExternalJobTypeDefinitions,
});

/**
 * Create a noop registry that passes all values through (identity codec).
 * Used by {@link defineJobTypes} for compile-time-only type checking.
 *
 * Despite being identity, the registry still routes through the same wrapper
 * as {@link createJobTypes}, so encoded values are checked against
 * {@link isJsonSerializable} — protecting `defineJobTypes` users from
 * silent `Date` / `Map` / `Set` corruption at write time.
 */
export const createNoopJobTypes = <
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TExternalJobTypeDefinitions extends BaseJobTypeDefinitions = Record<never, never>,
>(): JobTypes<TJobTypeDefinitions, TExternalJobTypeDefinitions> => {
  const identity = async (items: readonly ResolvedJobTypeValue[]): Promise<unknown[]> =>
    items.map((i) => i.value);
  const registry = createJobTypes<TJobTypeDefinitions, TExternalJobTypeDefinitions>({
    getTypeNames: () => [],
    validateEntry: () => {},
    encode: identity,
    decode: identity,
    validateContinueWith: () => {},
    validateBlockers: () => {},
  });
  noopRegistries.add(registry);
  return registry;
};
