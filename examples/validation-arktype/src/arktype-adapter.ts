/**
 * ArkType Adapter for Queuert Runtime Validation
 *
 * This is a user-land adapter that shows how to integrate ArkType with Queuert's
 * runtime validation system. The same pattern applies to Zod, Valibot,
 * or any other validation library.
 */

import { createJobTypeRegistry } from "queuert";
import { type Type } from "arktype";

/**
 * Partial reference for validation schemas.
 * Allows validating by typeName (nominal), input (structural), or both.
 */
type PartialJobTypeReference = { typeName?: string; input?: unknown };

/**
 * Schema definition for a single job type using ArkType.
 */
export type ArkTypeJobTypeSchema = {
  /** Whether this job type can start a chain (entry point). Default: false */
  entry?: boolean;
  /** ArkType schema for validating job input */
  input: Type;
  /** ArkType schema for validating job output. Omit if job must continue. */
  output?: Type;
  /**
   * ArkType schema for validating continuation targets.
   * Receives { typeName, input } object at runtime.
   * Schema can validate typeName (nominal), input (structural), or both.
   *
   * @example
   * // Nominal: validate by type name only
   * continueWith: type({ typeName: "'step2'" })
   *
   * // Structural: validate by input shape only
   * continueWith: type({ input: { payload: "unknown" } })
   *
   * // Both: validate type name and input shape
   * continueWith: type({ typeName: "'step2'", input: { data: "string" } })
   */
  continueWith?: Type<PartialJobTypeReference>;
  /**
   * ArkType schema for validating blocker references.
   * Receives array of { typeName, input } objects at runtime.
   * Schema can validate typeName (nominal), input (structural), or both.
   *
   * @example
   * // Fixed blockers by name (tuple)
   * blockers: type([{ typeName: "'auth'" }, { typeName: "'config'" }])
   *
   * // Variable blockers by name (array)
   * blockers: type({ typeName: "'processor'" }).array())
   *
   * // Structural validation: any blocker with matching input shape
   * blockers: type({ input: { token: "string" } }).array())
   */
  blockers?: Type<readonly PartialJobTypeReference[]>;
};

/**
 * Infer BaseJobTypeDefinitions from ArkType schemas.
 * This enables compile-time type safety for the job types.
 */
type InferArkTypeJobTypes<T extends Record<string, ArkTypeJobTypeSchema>> = {
  [K in keyof T & string]: {
    entry: T[K]["entry"] extends true ? true : false;
    input: T[K]["input"]["infer"];
    output: T[K]["output"] extends Type ? T[K]["output"]["infer"] : undefined;
    continueWith: T[K]["continueWith"] extends Type<infer U> ? U : undefined;
    blockers: T[K]["blockers"] extends Type<infer U> ? U : undefined;
  };
};

/**
 * Create an ArkType-based job type registry.
 *
 * This adapter:
 * 1. Accepts ArkType schemas for each job type
 * 2. Infers TypeScript types from the schemas
 * 3. Validates at runtime using ArkType's .assert() method
 *
 * Errors thrown by ArkType are caught by the core registry and wrapped
 * in JobTypeValidationError with the appropriate error code.
 *
 * @example
 * const registry = createArkTypeJobTypeRegistry({
 *   "process-data": {
 *     entry: true,
 *     input: type({ dataId: "string" }),
 *     output: type({ result: "number" }),
 *   },
 *   "send-notification": {
 *     entry: true,
 *     input: type({ userId: "string", message: "string" }),
 *     output: type({ sent: "boolean" }),
 *   },
 * });
 */
export const createArkTypeJobTypeRegistry = <T extends Record<string, ArkTypeJobTypeSchema>>(
  schemas: T,
) => {
  const getSchema = (typeName: string): ArkTypeJobTypeSchema => {
    const schema = schemas[typeName];
    if (!schema) {
      throw new Error(`Unknown job type: ${typeName}`);
    }
    return schema;
  };

  return createJobTypeRegistry<InferArkTypeJobTypes<T>>({
    validateEntry: (typeName) => {
      const schema = getSchema(typeName);
      if (schema.entry !== true) {
        throw new Error(`Job type "${typeName}" is not an entry point`);
      }
    },

    parseInput: (typeName, input) => {
      return getSchema(typeName).input.assert(input);
    },

    parseOutput: (typeName, output) => {
      const schema = getSchema(typeName);
      if (schema.output) {
        return schema.output.assert(output);
      } else {
        throw new Error(`Job type "${typeName}" does not have an output schema`);
      }
    },

    validateContinueWith: (typeName, continuation) => {
      const schema = getSchema(typeName);
      if (schema.continueWith) {
        schema.continueWith.assert(continuation);
      } else {
        throw new Error(`Job type "${typeName}" does not support continuations`);
      }
    },

    validateBlockers: (typeName, blockers) => {
      const schema = getSchema(typeName);
      if (schema.blockers) {
        schema.blockers.assert(blockers);
      } else if (blockers.length > 0) {
        throw new Error(`Job type "${typeName}" does not support blockers`);
      }
    },
  });
};
