import { JobTypeValidationError } from "../errors.js";
import { type BaseJobTypeDefinitions } from "./job-type.js";

/** Symbol used to carry phantom job type definitions on a registry. */
export const definitionsSymbol: unique symbol = Symbol("queuert.definitions");

/** Extract the job type definitions from a {@link JobTypeRegistry}. */
export type JobTypeRegistryDefinitions<T extends JobTypeRegistry<any>> =
  T[typeof definitionsSymbol];

export const noopRegistries = new WeakSet<JobTypeRegistry<any>>();

/**
 * Reference object for continuation and blocker validation.
 * Contains both typeName (for nominal validation) and input (for structural validation).
 */
export type ResolvedJobTypeReference = {
  readonly typeName: string;
  readonly input: unknown;
};

/**
 * Configuration for createJobTypeRegistry.
 * Adapters implement these functions to provide validation logic.
 * Functions should throw on validation failure (any error type).
 */
export type JobTypeRegistryConfig = {
  /** Returns the known job type names. Used for runtime duplicate detection in {@link mergeJobTypeRegistries}. */
  getTypeNames: () => readonly string[];
  /** Validate that a job type can start a chain. Throw on failure. */
  validateEntry: (typeName: string) => void;
  /** Parse and validate input. Return transformed value or throw on failure. */
  parseInput: (typeName: string, input: unknown) => unknown;
  /** Parse and validate output. Return transformed value or throw on failure. */
  parseOutput: (typeName: string, output: unknown) => unknown;
  /** Validate continuation target. Receives { typeName, input } for nominal/structural validation. Throw on failure. */
  validateContinueWith: (typeName: string, target: ResolvedJobTypeReference) => void;
  /** Validate blocker references. Receives array of { typeName, input } objects. Throw on failure. */
  validateBlockers: (typeName: string, blockers: readonly ResolvedJobTypeReference[]) => void;
};

/**
 * Runtime registry for job type validation.
 *
 * Methods are split by return type:
 * - validate* → throws JobTypeValidationError or returns void (pure validation)
 * - parse* → throws JobTypeValidationError or returns transformed value (validation + transformation)
 */
export type JobTypeRegistry<TJobTypeDefinitions = unknown> = {
  /** Validate that a job type can start a chain (is an entry point). Throws JobTypeValidationError on failure. */
  validateEntry: (typeName: string) => void;

  /** Parse and validate input. Returns transformed value. Throws JobTypeValidationError on failure. */
  parseInput: (typeName: string, input: unknown) => unknown;

  /** Parse and validate output. Returns transformed value. Throws JobTypeValidationError on failure. */
  parseOutput: (typeName: string, output: unknown) => unknown;

  /** Validate continuation target. Throws JobTypeValidationError on failure. */
  validateContinueWith: (typeName: string, target: ResolvedJobTypeReference) => void;

  /** Validate blocker references. Throws JobTypeValidationError on failure. */
  validateBlockers: (typeName: string, blockers: readonly ResolvedJobTypeReference[]) => void;

  /** Known type names. Returns the type names registered with this registry. */
  readonly getTypeNames: () => readonly string[];

  /** Phantom property for TypeScript type inference. */
  readonly [definitionsSymbol]: TJobTypeDefinitions;
};

/**
 * Create a noop registry that passes all values through without validation.
 * Used by defineJobTypes for compile-time-only type checking.
 */
export const createNoopJobTypeRegistry = <
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
>(): JobTypeRegistry<TJobTypeDefinitions> => {
  const registry: JobTypeRegistry<TJobTypeDefinitions> = {
    validateEntry: () => {},
    parseInput: (_, input) => input,
    parseOutput: (_, output) => output,
    validateContinueWith: () => {},
    getTypeNames: () => [],
    validateBlockers: () => {},
    [definitionsSymbol]: undefined as unknown as TJobTypeDefinitions,
  };
  noopRegistries.add(registry);
  return registry;
};

/**
 * Create a job type registry with runtime validation.
 * Wraps adapter errors in JobTypeValidationError.
 *
 * @example
 * // Adapters throw their native errors (e.g., ZodError)
 * const registry = createJobTypeRegistry<MyJobTypes>({
 *   getTypeNames: () => Object.keys(schemas),
 *   validateEntry: (typeName) => {
 *     if (!entryTypes.has(typeName)) throw new Error('Not an entry point');
 *   },
 *   parseInput: (typeName, input) => schemas[typeName].input.parse(input),
 *   parseOutput: (typeName, output) => schemas[typeName].output.parse(output),
 *   validateContinueWith: (typeName, target) => schemas[typeName].continueWith.parse(target),
 *   validateBlockers: (typeName, blockers) => schemas[typeName].blockers.parse(blockers),
 * });
 */
export const createJobTypeRegistry = <TJobTypeDefinitions>(
  config: JobTypeRegistryConfig,
): JobTypeRegistry<TJobTypeDefinitions> => ({
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
  parseInput: (typeName, input) => {
    try {
      return config.parseInput(typeName, input);
    } catch (cause) {
      throw new JobTypeValidationError(`Invalid input for job type "${typeName}"`, {
        code: "invalid_input",
        typeName,
        details: { input },
        cause,
      });
    }
  },
  parseOutput: (typeName, output) => {
    try {
      return config.parseOutput(typeName, output);
    } catch (cause) {
      throw new JobTypeValidationError(`Invalid output for job type "${typeName}"`, {
        code: "invalid_output",
        typeName,
        details: { output },
        cause,
      });
    }
  },
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
});
