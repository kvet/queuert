import { JobTypeValidationError } from "../queuert-helper.js";
import type { BaseJobTypeDefinitions, NominalReference } from "./job-type.js";

/**
 * Parser function type - takes unknown input and returns typed output.
 * Compatible with validation libraries like Zod, Valibot, ArkType, etc.
 *
 * @example
 * // With Zod
 * const parser: Parser<{ name: string }> = z.object({ name: z.string() }).parse;
 *
 * // With Valibot
 * const parser: Parser<{ name: string }> = (input) => v.parse(v.object({ name: v.string() }), input);
 */
export type Parser<T = unknown> = (input: unknown) => T;

/**
 * Schema definition for a single job type with runtime validation.
 * Use with createJobTypeRegistry for runtime validation.
 */
export type JobTypeSchemaDefinition = {
  entry?: boolean; // true = entry point (default: false)
  input: Parser; // Validates input data
  output?: Parser; // Validates output data, undefined = must continue
  continuesTo?: Parser<string>; // Validates continuation target (union): z.literal('a').or(z.literal('b'))
  blockers?: Parser<readonly string[]>; // Validates blocker types (tuple/array): z.tuple([...]) or z.array(...)
};

/**
 * Runtime registry for job type validation.
 *
 * Methods are split by return type:
 * - validate* → throws or returns void (pure validation)
 * - parse* → throws or returns transformed value (validation + transformation)
 */
export interface JobTypeRegistry<TJobTypeDefinitions = unknown> {
  /**
   * Validate job type access.
   * - validate(typeName) → can this type start a sequence?
   * - validate(typeName, fromTypeName) → can fromTypeName continue to typeName?
   */
  validate(typeName: string, fromTypeName?: string): void;

  /** Validate blocker types match declarations. */
  validateBlockers(typeName: string, blockerTypeNames: readonly string[]): void;

  /** Parse and validate input. Returns transformed value. */
  parseInput(typeName: string, input: unknown): unknown;

  /** Parse and validate output. Returns transformed value. */
  parseOutput(typeName: string, output: unknown): unknown;

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
  validate: () => {},
  validateBlockers: () => {},
  parseInput: (_, input) => input,
  parseOutput: (_, output) => output,
  $definitions: undefined as unknown as TJobTypeDefinitions,
});

// Helper to map string tuple/array to NominalReference tuple/array
type MapToNominalReferences<T extends readonly string[]> = T extends readonly [
  infer First extends string,
  ...infer Rest extends string[],
]
  ? readonly [NominalReference<First>, ...MapToNominalReferences<Rest>]
  : T extends readonly (infer U extends string)[]
    ? readonly NominalReference<U>[]
    : readonly NominalReference[];

/**
 * Infer BaseJobTypeDefinitions from schema definitions.
 * Maps Parser return types to the corresponding type definition fields.
 * Wraps continuesTo and blockers in NominalReference to match BaseJobTypeDefinition.
 */
export type InferJobTypeDefinitions<T extends Record<string, JobTypeSchemaDefinition>> = {
  [K in keyof T & string]: {
    entry: T[K]["entry"] extends true ? true : false;
    input: ReturnType<T[K]["input"]>;
    output: T[K]["output"] extends Parser ? ReturnType<T[K]["output"]> : undefined;
    continuesTo: T[K]["continuesTo"] extends Parser<infer U extends string>
      ? NominalReference<U>
      : undefined;
    blockers: T[K]["blockers"] extends Parser<infer U extends readonly string[]>
      ? MapToNominalReferences<U>
      : undefined;
  };
};

export const createJobTypeRegistry = <T extends Record<string, JobTypeSchemaDefinition>>(
  definitions: T,
): JobTypeRegistry<InferJobTypeDefinitions<T>> => ({
  validate: (typeName, fromTypeName) => {
    if (fromTypeName === undefined) {
      // Validating sequence start
      if (definitions[typeName]?.entry !== true) {
        throw new JobTypeValidationError({
          code: "not_entry_point",
          message: `Job type "${typeName}" is not an entry point and cannot start a sequence`,
          typeName,
        });
      }
    } else {
      // Validating continuation - use parser to validate target
      const continuesTo = definitions[fromTypeName]?.continuesTo;
      if (continuesTo) {
        try {
          continuesTo(typeName);
        } catch (cause) {
          throw new JobTypeValidationError({
            code: "invalid_continuation",
            message: `Job type "${fromTypeName}" cannot continue to "${typeName}"`,
            typeName: fromTypeName,
            details: { fromTypeName, toTypeName: typeName, cause },
          });
        }
      }
    }
  },
  validateBlockers: (typeName, blockerTypeNames) => {
    const blockers = definitions[typeName]?.blockers;
    if (blockers) {
      try {
        blockers(blockerTypeNames);
      } catch (cause) {
        throw new JobTypeValidationError({
          code: "invalid_blockers",
          message: `Invalid blockers for job type "${typeName}"`,
          typeName,
          details: { blockerTypeNames, cause },
        });
      }
    }
  },
  parseInput: (typeName, input) => {
    const parser = definitions[typeName]?.input;
    if (!parser) return input;
    try {
      return parser(input);
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
    const parser = definitions[typeName]?.output;
    if (!parser) return output;
    try {
      return parser(output);
    } catch (cause) {
      throw new JobTypeValidationError({
        code: "invalid_output",
        message: `Invalid output for job type "${typeName}"`,
        typeName,
        details: { output, cause },
      });
    }
  },
  $definitions: undefined as unknown as InferJobTypeDefinitions<T>,
});
