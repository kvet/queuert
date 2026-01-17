/**
 * Zod Adapter for Queuert Runtime Validation
 *
 * This is a user-land adapter that shows how to integrate Zod with Queuert's
 * runtime validation system. The same pattern applies to Valibot, ArkType,
 * or any other validation library.
 */

import { createJobTypeRegistry } from "queuert";
import { z } from "zod";

/**
 * Partial reference for validation schemas.
 * Allows validating by typeName (nominal), input (structural), or both.
 */
type PartialJobTypeReference = { typeName?: string; input?: unknown };

/**
 * Schema definition for a single job type using Zod.
 */
export type ZodJobTypeSchema = {
  /** Whether this job type can start a sequence (entry point). Default: false */
  entry?: boolean;
  /** Zod schema for validating job input */
  input: z.ZodType;
  /** Zod schema for validating job output. Omit if job must continue. */
  output?: z.ZodType;
  /**
   * Zod schema for validating continuation targets.
   * Receives { typeName, input } object at runtime.
   * Schema can validate typeName (nominal), input (structural), or both.
   *
   * @example
   * // Nominal: validate by type name only
   * continueWith: z.object({ typeName: z.literal("step2") })
   *
   * // Structural: validate by input shape only
   * continueWith: z.object({ input: z.object({ payload: z.unknown() }) })
   *
   * // Both: validate type name and input shape
   * continueWith: z.object({ typeName: z.literal("step2"), input: z.object({ data: z.string() }) })
   */
  continueWith?: z.ZodType<PartialJobTypeReference>;
  /**
   * Zod schema for validating blocker references.
   * Receives array of { typeName, input } objects at runtime.
   * Schema can validate typeName (nominal), input (structural), or both.
   *
   * @example
   * // Fixed blockers by name (tuple)
   * blockers: z.tuple([
   *   z.object({ typeName: z.literal("auth") }),
   *   z.object({ typeName: z.literal("config") }),
   * ])
   *
   * // Variable blockers by name (array)
   * blockers: z.array(z.object({ typeName: z.literal("processor") }))
   *
   * // Structural validation: any blocker with matching input shape
   * blockers: z.array(z.object({ input: z.object({ token: z.string() }) }))
   */
  blockers?: z.ZodType<readonly PartialJobTypeReference[]>;
};

/**
 * Infer BaseJobTypeDefinitions from Zod schemas.
 * This enables compile-time type safety for the job types.
 */
type InferZodJobTypes<T extends Record<string, ZodJobTypeSchema>> = {
  [K in keyof T & string]: {
    entry: T[K]["entry"] extends true ? true : false;
    input: z.infer<T[K]["input"]>;
    output: T[K]["output"] extends z.ZodType ? z.infer<T[K]["output"]> : undefined;
    continueWith: T[K]["continueWith"] extends z.ZodType<infer U> ? U : undefined;
    blockers: T[K]["blockers"] extends z.ZodType<infer U> ? U : undefined;
  };
};

/**
 * Create a Zod-based job type registry.
 *
 * This adapter:
 * 1. Accepts Zod schemas for each job type
 * 2. Infers TypeScript types from the schemas
 * 3. Validates at runtime using Zod's .parse() method
 *
 * Errors thrown by Zod are caught by the core registry and wrapped
 * in JobTypeValidationError with the appropriate error code.
 *
 * @example
 * const registry = createZodJobTypeRegistry({
 *   "process-data": {
 *     entry: true,
 *     input: z.object({ dataId: z.string() }),
 *     output: z.object({ result: z.number() }),
 *   },
 *   "send-notification": {
 *     entry: true,
 *     input: z.object({ userId: z.string(), message: z.string() }),
 *     output: z.object({ sent: z.boolean() }),
 *   },
 * });
 */
export const createZodJobTypeRegistry = <T extends Record<string, ZodJobTypeSchema>>(
  schemas: T,
) => {
  const getSchema = (typeName: string): ZodJobTypeSchema => {
    const schema = schemas[typeName];
    if (!schema) {
      throw new Error(`Unknown job type: ${typeName}`);
    }
    return schema;
  };

  return createJobTypeRegistry<InferZodJobTypes<T>>({
    validateEntry: (typeName) => {
      const schema = getSchema(typeName);
      if (schema.entry !== true) {
        throw new Error(`Job type "${typeName}" is not an entry point`);
      }
    },

    parseInput: (typeName, input) => {
      return getSchema(typeName).input.parse(input);
    },

    parseOutput: (typeName, output) => {
      const schema = getSchema(typeName);
      if (schema.output) {
        return schema.output.parse(output);
      } else {
        throw new Error(`Job type "${typeName}" does not have an output schema`);
      }
    },

    validateContinueWith: (typeName, continuation) => {
      const schema = getSchema(typeName);
      if (schema.continueWith) {
        schema.continueWith.parse(continuation);
      } else {
        throw new Error(`Job type "${typeName}" does not support continuations`);
      }
    },

    validateBlockers: (typeName, blockers) => {
      const schema = getSchema(typeName);
      if (schema.blockers) {
        schema.blockers.parse(blockers);
      } else if (blockers.length > 0) {
        throw new Error(`Job type "${typeName}" does not support blockers`);
      }
    },
  });
};
