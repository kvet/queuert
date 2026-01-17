import { JobTypeValidationError } from "../queuert-helper.js";
import type { BaseJobTypeDefinitions } from "./job-type.js";

/**
 * Reference object for continuation and blocker validation.
 * Contains both typeName (for nominal validation) and input (for structural validation).
 */
export type JobTypeReference = {
  readonly typeName: string;
  readonly input: unknown;
};

/**
 * Configuration for createJobTypeRegistry.
 * Adapters implement these functions to provide validation logic.
 * Functions should throw on validation failure (any error type).
 */
export type JobTypeRegistryConfig = {
  /** Validate that a job type can start a chain. Throw on failure. */
  validateEntry: (typeName: string) => void;
  /** Parse and validate input. Return transformed value or throw on failure. */
  parseInput: (typeName: string, input: unknown) => unknown;
  /** Parse and validate output. Return transformed value or throw on failure. */
  parseOutput: (typeName: string, output: unknown) => unknown;
  /** Validate continuation target. Receives { typeName, input } for nominal/structural validation. Throw on failure. */
  validateContinueWith: (typeName: string, target: JobTypeReference) => void;
  /** Validate blocker references. Receives array of { typeName, input } objects. Throw on failure. */
  validateBlockers: (typeName: string, blockers: readonly JobTypeReference[]) => void;
};

/**
 * Runtime registry for job type validation.
 *
 * Methods are split by return type:
 * - validate* → throws JobTypeValidationError or returns void (pure validation)
 * - parse* → throws JobTypeValidationError or returns transformed value (validation + transformation)
 */
export interface JobTypeRegistry<TJobTypeDefinitions = unknown> {
  /** Validate that a job type can start a chain (is an entry point). Throws JobTypeValidationError on failure. */
  validateEntry: (typeName: string) => void;

  /** Parse and validate input. Returns transformed value. Throws JobTypeValidationError on failure. */
  parseInput: (typeName: string, input: unknown) => unknown;

  /** Parse and validate output. Returns transformed value. Throws JobTypeValidationError on failure. */
  parseOutput: (typeName: string, output: unknown) => unknown;

  /** Validate continuation target. Throws JobTypeValidationError on failure. */
  validateContinueWith: (typeName: string, target: JobTypeReference) => void;

  /** Validate blocker references. Throws JobTypeValidationError on failure. */
  validateBlockers: (typeName: string, blockers: readonly JobTypeReference[]) => void;

  /** Phantom property for TypeScript type inference. */
  readonly $definitions: TJobTypeDefinitions;
}

/**
 * Create a noop registry that passes all values through without validation.
 * Used by defineJobTypes for compile-time-only type checking.
 */
export const createNoopJobTypeRegistry = <
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
>(): JobTypeRegistry<TJobTypeDefinitions> => ({
  validateEntry: () => {},
  parseInput: (_, input) => input,
  parseOutput: (_, output) => output,
  validateContinueWith: () => {},
  validateBlockers: () => {},
  $definitions: undefined as unknown as TJobTypeDefinitions,
});

/**
 * Create a job type registry with runtime validation.
 * Wraps adapter errors in JobTypeValidationError.
 *
 * @example
 * // Adapters throw their native errors (e.g., ZodError)
 * const registry = createJobTypeRegistry<MyJobTypes>({
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
  validateEntry: (typeName) => {
    try {
      config.validateEntry(typeName);
    } catch (cause) {
      throw new JobTypeValidationError({
        code: "not_entry_point",
        message: `Job type "${typeName}" is not an entry point`,
        typeName,
        details: { cause },
      });
    }
  },
  parseInput: (typeName, input) => {
    try {
      return config.parseInput(typeName, input);
    } catch (cause) {
      throw new JobTypeValidationError({
        code: "invalid_input",
        message: `Invalid input for job type "${typeName}"`,
        typeName,
        details: { input, cause },
      });
    }
  },
  parseOutput: (typeName, output) => {
    try {
      return config.parseOutput(typeName, output);
    } catch (cause) {
      throw new JobTypeValidationError({
        code: "invalid_output",
        message: `Invalid output for job type "${typeName}"`,
        typeName,
        details: { output, cause },
      });
    }
  },
  validateContinueWith: (typeName, target) => {
    try {
      config.validateContinueWith(typeName, target);
    } catch (cause) {
      throw new JobTypeValidationError({
        code: "invalid_continuation",
        message: `Job type "${typeName}" cannot continue to "${target.typeName}"`,
        typeName,
        details: { target, cause },
      });
    }
  },
  validateBlockers: (typeName, blockers) => {
    try {
      config.validateBlockers(typeName, blockers);
    } catch (cause) {
      throw new JobTypeValidationError({
        code: "invalid_blockers",
        message: `Invalid blockers for job type "${typeName}"`,
        typeName,
        details: { blockers, cause },
      });
    }
  },
  $definitions: undefined as unknown as TJobTypeDefinitions,
});
