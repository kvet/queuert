/**
 * Valibot Adapter for Queuert Runtime Validation
 *
 * This is a user-land adapter that shows how to integrate Valibot with Queuert's
 * runtime validation system. The same pattern applies to Zod, ArkType,
 * or any other validation library.
 */

import { createJobTypeRegistry } from "queuert";
import * as v from "valibot";

/**
 * Partial reference for validation schemas.
 * Allows validating by typeName (nominal), input (structural), or both.
 */
type PartialJobTypeReference = { typeName?: string; input?: unknown };

/**
 * Schema definition for a single job type using Valibot.
 */
export type ValibotJobTypeSchema = {
  /** Whether this job type can start a chain (entry point). Default: false */
  entry?: boolean;
  /** Valibot schema for validating job input */
  input: v.GenericSchema;
  /** Valibot schema for validating job output. Omit if job must continue. */
  output?: v.GenericSchema;
  /**
   * Valibot schema for validating continuation targets.
   * Receives { typeName, input } object at runtime.
   * Schema can validate typeName (nominal), input (structural), or both.
   *
   * @example
   * // Nominal: validate by type name only
   * continueWith: v.object({ typeName: v.literal("step2") })
   *
   * // Structural: validate by input shape only
   * continueWith: v.object({ input: v.object({ payload: v.unknown() }) })
   *
   * // Both: validate type name and input shape
   * continueWith: v.object({ typeName: v.literal("step2"), input: v.object({ data: v.string() }) })
   */
  continueWith?: v.GenericSchema<PartialJobTypeReference>;
  /**
   * Valibot schema for validating blocker references.
   * Receives array of { typeName, input } objects at runtime.
   * Schema can validate typeName (nominal), input (structural), or both.
   *
   * @example
   * // Fixed blockers by name (tuple)
   * blockers: v.tuple([
   *   v.object({ typeName: v.literal("auth") }),
   *   v.object({ typeName: v.literal("config") }),
   * ])
   *
   * // Variable blockers by name (array)
   * blockers: v.array(v.object({ typeName: v.literal("processor") }))
   *
   * // Structural validation: any blocker with matching input shape
   * blockers: v.array(v.object({ input: v.object({ token: v.string() }) }))
   */
  blockers?: v.GenericSchema<readonly PartialJobTypeReference[]>;
};

/**
 * Infer BaseJobTypeDefinitions from Valibot schemas.
 * This enables compile-time type safety for the job types.
 */
type InferValibotJobTypes<T extends Record<string, ValibotJobTypeSchema>> = {
  [K in keyof T & string]: {
    entry: T[K]["entry"] extends true ? true : false;
    input: v.InferOutput<T[K]["input"]>;
    output: T[K]["output"] extends v.GenericSchema ? v.InferOutput<T[K]["output"]> : undefined;
    continueWith: T[K]["continueWith"] extends v.GenericSchema<infer U> ? U : undefined;
    blockers: T[K]["blockers"] extends v.GenericSchema<infer U> ? U : undefined;
  };
};

/**
 * Create a Valibot-based job type registry.
 *
 * This adapter:
 * 1. Accepts Valibot schemas for each job type
 * 2. Infers TypeScript types from the schemas
 * 3. Validates at runtime using Valibot's parse() function
 *
 * Errors thrown by Valibot are caught by the core registry and wrapped
 * in JobTypeValidationError with the appropriate error code.
 *
 * @example
 * const registry = createValibotJobTypeRegistry({
 *   "process-data": {
 *     entry: true,
 *     input: v.object({ dataId: v.string() }),
 *     output: v.object({ result: v.number() }),
 *   },
 *   "send-notification": {
 *     entry: true,
 *     input: v.object({ userId: v.string(), message: v.string() }),
 *     output: v.object({ sent: v.boolean() }),
 *   },
 * });
 */
export const createValibotJobTypeRegistry = <T extends Record<string, ValibotJobTypeSchema>>(
  schemas: T,
) => {
  const getSchema = (typeName: string): ValibotJobTypeSchema => {
    const schema = schemas[typeName];
    if (!schema) {
      throw new Error(`Unknown job type: ${typeName}`);
    }
    return schema;
  };

  return createJobTypeRegistry<InferValibotJobTypes<T>>({
    validateEntry: (typeName) => {
      const schema = getSchema(typeName);
      if (schema.entry !== true) {
        throw new Error(`Job type "${typeName}" is not an entry point`);
      }
    },

    parseInput: (typeName, input) => {
      return v.parse(getSchema(typeName).input, input);
    },

    parseOutput: (typeName, output) => {
      const schema = getSchema(typeName);
      if (schema.output) {
        return v.parse(schema.output, output);
      } else {
        throw new Error(`Job type "${typeName}" does not have an output schema`);
      }
    },

    validateContinueWith: (typeName, continuation) => {
      const schema = getSchema(typeName);
      if (schema.continueWith) {
        v.parse(schema.continueWith, continuation);
      } else {
        throw new Error(`Job type "${typeName}" does not support continuations`);
      }
    },

    validateBlockers: (typeName, blockers) => {
      const schema = getSchema(typeName);
      if (schema.blockers) {
        v.parse(schema.blockers, blockers);
      } else if (blockers.length > 0) {
        throw new Error(`Job type "${typeName}" does not support blockers`);
      }
    },
  });
};
