import { isThenable } from "@queuert/helpers";

import { JobTypeValidationError } from "../errors.ts";
import type { BaseJobTypeDefinitions, ResolvedJobTypeReference } from "./job-type.ts";
import { MAX_JSON_DEPTH, findNonJsonPath } from "./json-serializable.ts";

/** Symbol used to carry phantom job type definitions on a registry. */
export const definitionsSymbol: unique symbol = Symbol("queuert.definitions");

/** Symbol used to carry phantom external job type definitions on a registry. */
export const externalDefinitionsSymbol: unique symbol = Symbol("queuert.externalDefinitions");

/** Extract the job type definitions from a {@link JobTypes} slice. */
export type JobTypeDefinitions<T extends JobTypes<any>> = T[typeof definitionsSymbol];

export const noopRegistries: WeakSet<JobTypes<any>> = new WeakSet<JobTypes<any>>();

/**
 * Runtime registry for job type validation and codec.
 *
 * Methods split by purpose:
 * - validate* → throws {@link JobTypeValidationError} or returns void.
 * - encodeInput / encodeOutput → run on every write; throw
 *   {@link JobTypeValidationError} when the value is invalid or its encoded form
 *   is not JSON-serializable.
 * - decodeInput / decodeOutput → run on every read; return the value unchanged
 *   for a type name the registry does not know, so rows of removed job types
 *   stay readable.
 */
export type JobTypes<
  TJobTypeDefinitions = unknown,
  TExternalJobTypeDefinitions = Record<never, never>,
> = {
  /**
   * Validate that a job type can start a chain (is an entry point). Throws
   * JobTypeValidationError on failure.
   */
  validateEntry: (typeName: string) => void;

  /** Encode a runtime input to its JSON-safe stored form. */
  encodeInput: (typeName: string, input: unknown) => unknown;

  /** Decode a stored input back to its runtime form. */
  decodeInput: (typeName: string, input: unknown) => unknown;

  /** Encode a runtime output to its JSON-safe stored form. */
  encodeOutput: (typeName: string, output: unknown) => unknown;

  /** Decode a stored output back to its runtime form. */
  decodeOutput: (typeName: string, output: unknown) => unknown;

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

type Codec = (typeName: string, value: unknown) => unknown;

const REPORTED_PATH_LENGTH = 20;

const rejectNonJson = (
  field: "input" | "output",
  code: "invalid_input" | "invalid_output",
  typeName: string,
  encoded: unknown,
  path: (string | number)[],
): JobTypeValidationError => {
  if (path.length >= MAX_JSON_DEPTH) {
    return new JobTypeValidationError(
      `Encoded ${field} for job type "${typeName}" is nested deeper than ${MAX_JSON_DEPTH} levels`,
      { code, typeName, details: { path: path.slice(0, REPORTED_PATH_LENGTH) } },
    );
  }
  const location =
    path.length === 0 ? "the root" : path.map((key) => `[${JSON.stringify(key)}]`).join("");
  return new JobTypeValidationError(
    `Encoded ${field} for job type "${typeName}" is not JSON-serializable at ${location}`,
    { code, typeName, details: { [field]: encoded, path } },
  );
};

const rejectThenable = (
  role: "Encoder" | "Decoder",
  field: "input" | "output",
  code: "invalid_input" | "invalid_output",
  typeName: string,
): JobTypeValidationError =>
  new JobTypeValidationError(
    `${role} for the ${field} of job type "${typeName}" returned a promise; it must return the value`,
    { code, typeName },
  );

const wrapCodec = (
  field: "input" | "output",
  encode: Codec,
  decode: Codec,
  knownTypeNames: ReadonlySet<string>,
): { encode: Codec; decode: Codec } => {
  const code = field === "input" ? "invalid_input" : "invalid_output";
  return {
    encode: (typeName, value) => {
      let encoded: unknown;
      try {
        encoded = encode(typeName, value);
      } catch (cause) {
        throw new JobTypeValidationError(`Invalid ${field} for job type "${typeName}"`, {
          code,
          typeName,
          details: { [field]: value },
          cause,
        });
      }
      if (isThenable(encoded)) throw rejectThenable("Encoder", field, code, typeName);
      const path = findNonJsonPath(encoded);
      if (path !== undefined) throw rejectNonJson(field, code, typeName, encoded, path);
      return encoded;
    },
    decode: (typeName, value) => {
      if (!knownTypeNames.has(typeName)) return value;
      let decoded: unknown;
      try {
        decoded = decode(typeName, value);
      } catch (cause) {
        throw new JobTypeValidationError(
          `Stored ${field} for job type "${typeName}" cannot be decoded`,
          { code, typeName, details: { [field]: value }, cause },
        );
      }
      if (isThenable(decoded)) throw rejectThenable("Decoder", field, code, typeName);
      return decoded;
    },
  };
};

/**
 * Create a job type registry with runtime validation and codec.
 * Wraps adapter errors in {@link JobTypeValidationError} and enforces
 * JSON-serializability on every encoded value.
 *
 * @param options - Adapter-supplied validation and codec callbacks. Functions should throw on validation failure (any error type).
 *
 * @example
 * const outputSchema = (typeName: string) => {
 *   const schema = schemas[typeName].output;
 *   if (!schema) throw new Error(`Job type "${typeName}" has no output schema`);
 *   return schema;
 * };
 *
 * const registry = createJobTypes<MyJobTypes>({
 *   getTypeNames: () => Object.keys(schemas),
 *   validateEntry: (typeName) => {
 *     if (!entryTypes.has(typeName)) throw new Error('Not an entry point');
 *   },
 *   encodeInput: (typeName, input) => z.encode(schemas[typeName].input, input),
 *   decodeInput: (typeName, input) => z.decode(schemas[typeName].input, input),
 *   encodeOutput: (typeName, output) => z.encode(outputSchema(typeName), output),
 *   decodeOutput: (typeName, output) => z.decode(outputSchema(typeName), output),
 *   validateContinueWith: (typeName, target) => schemas[typeName].continueWith.parse(target),
 *   validateBlockers: (typeName, blockers) => schemas[typeName].blockers.parse(blockers),
 * });
 */
export const createJobTypes = <
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TExternalJobTypeDefinitions extends BaseJobTypeDefinitions = Record<never, never>,
>(options: {
  /**
   * Returns the known job type names. Used for runtime duplicate detection when
   * {@link createClient} merges slices, and to pass values of unknown types
   * through `decodeInput` / `decodeOutput` unchanged. Read once, when the
   * registry is created.
   */
  getTypeNames: () => readonly string[];
  /** Validate that a job type can start a chain. Throw on failure. */
  validateEntry: (typeName: string) => void;
  /**
   * Validate a runtime input and return its stored form, which must be
   * JSON-serializable. Throw on validation failure.
   */
  encodeInput: (typeName: string, input: unknown) => unknown;
  /**
   * Turn a stored input back into its runtime form. Called only for type names
   * returned by `getTypeNames`. Throw when the stored value cannot be decoded
   * (e.g. corruption / schema drift).
   */
  decodeInput: (typeName: string, input: unknown) => unknown;
  /**
   * Validate a runtime output and return its stored form, which must be
   * JSON-serializable. Throw on validation failure.
   */
  encodeOutput: (typeName: string, output: unknown) => unknown;
  /**
   * Turn a stored output back into its runtime form. Called only for type names
   * returned by `getTypeNames`. Throw when the stored value cannot be decoded
   * (e.g. corruption / schema drift).
   */
  decodeOutput: (typeName: string, output: unknown) => unknown;
  /**
   * Validate continuation target. Receives `{ typeName, input }` (runtime form)
   * for nominal/structural validation. Throw on failure.
   */
  validateContinueWith: (typeName: string, target: ResolvedJobTypeReference) => void;
  /**
   * Validate blocker references. Receives `{ typeName, input }` of each stored blocker chain, read
   * under lock (not the object the caller passed), with `input` decoded to its runtime form.
   * Throw on failure.
   */
  validateBlockers: (typeName: string, blockers: readonly ResolvedJobTypeReference[]) => void;
}): JobTypes<TJobTypeDefinitions, TExternalJobTypeDefinitions> => {
  const knownTypeNames = new Set(options.getTypeNames());
  const input = wrapCodec("input", options.encodeInput, options.decodeInput, knownTypeNames);
  const output = wrapCodec("output", options.encodeOutput, options.decodeOutput, knownTypeNames);

  return {
    getTypeNames: () => options.getTypeNames(),
    validateEntry: (typeName) => {
      try {
        options.validateEntry(typeName);
      } catch (cause) {
        throw new JobTypeValidationError(`Job type "${typeName}" is not an entry point`, {
          code: "not_entry_point",
          typeName,
          cause,
        });
      }
    },
    encodeInput: input.encode,
    decodeInput: input.decode,
    encodeOutput: output.encode,
    decodeOutput: output.decode,
    validateContinueWith: (typeName, target) => {
      try {
        options.validateContinueWith(typeName, target);
      } catch (cause) {
        throw new JobTypeValidationError(
          `Job type "${typeName}" cannot continue to "${target.typeName}"`,
          { code: "invalid_continuation", typeName, details: { target }, cause },
        );
      }
    },
    validateBlockers: (typeName, blockers) => {
      try {
        options.validateBlockers(typeName, blockers);
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
  };
};

/**
 * Create a noop registry that passes all values through (identity codec, no
 * runtime checks). Used by {@link defineJobTypes} for compile-time-only type
 * checking.
 */
export const createNoopJobTypes = <
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TExternalJobTypeDefinitions extends BaseJobTypeDefinitions = Record<never, never>,
>(): JobTypes<TJobTypeDefinitions, TExternalJobTypeDefinitions> => {
  const identity: Codec = (_typeName, value) => value;
  const registry: JobTypes<TJobTypeDefinitions, TExternalJobTypeDefinitions> = {
    getTypeNames: () => [],
    validateEntry: () => {},
    encodeInput: identity,
    decodeInput: identity,
    encodeOutput: identity,
    decodeOutput: identity,
    validateContinueWith: () => {},
    validateBlockers: () => {},
    [definitionsSymbol]: undefined as unknown as TJobTypeDefinitions,
    [externalDefinitionsSymbol]: undefined as unknown as TExternalJobTypeDefinitions,
  };
  noopRegistries.add(registry);
  return registry;
};
