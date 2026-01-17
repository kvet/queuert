/**
 * TypeBox Adapter for Queuert Runtime Validation
 *
 * This is a user-land adapter that shows how to integrate TypeBox with Queuert's
 * runtime validation system. The same pattern applies to Zod, Valibot, ArkType,
 * or any other validation library.
 */

import { createJobTypeRegistry } from "queuert";
import { type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

/**
 * Partial reference for validation schemas.
 * Allows validating by typeName (nominal), input (structural), or both.
 */
type PartialJobTypeReference = { typeName?: string; input?: unknown };

/**
 * Schema definition for a single job type using TypeBox.
 */
export type TypeBoxJobTypeSchema = {
  /** Whether this job type can start a chain (entry point). Default: false */
  entry?: boolean;
  /** TypeBox schema for validating job input */
  input: TSchema;
  /** TypeBox schema for validating job output. Omit if job must continue. */
  output?: TSchema;
  /**
   * TypeBox schema for validating continuation targets.
   * Receives { typeName, input } object at runtime.
   * Schema can validate typeName (nominal), input (structural), or both.
   *
   * @example
   * // Nominal: validate by type name only
   * continueWith: Type.Object({ typeName: Type.Literal("step2") })
   *
   * // Structural: validate by input shape only
   * continueWith: Type.Object({ input: Type.Object({ payload: Type.Unknown() }) })
   *
   * // Both: validate type name and input shape
   * continueWith: Type.Object({ typeName: Type.Literal("step2"), input: Type.Object({ data: Type.String() }) })
   */
  continueWith?: TSchema;
  /**
   * TypeBox schema for validating blocker references.
   * Receives array of { typeName, input } objects at runtime.
   * Schema can validate typeName (nominal), input (structural), or both.
   *
   * @example
   * // Fixed blockers by name (tuple)
   * blockers: Type.Tuple([
   *   Type.Object({ typeName: Type.Literal("auth") }),
   *   Type.Object({ typeName: Type.Literal("config") }),
   * ])
   *
   * // Variable blockers by name (array)
   * blockers: Type.Array(Type.Object({ typeName: Type.Literal("processor") }))
   *
   * // Structural validation: any blocker with matching input shape
   * blockers: Type.Array(Type.Object({ input: Type.Object({ token: Type.String() }) }))
   */
  blockers?: TSchema;
};

/**
 * Infer BaseJobTypeDefinitions from TypeBox schemas.
 * This enables compile-time type safety for the job types.
 */
type InferTypeBoxJobTypes<T extends Record<string, TypeBoxJobTypeSchema>> = {
  [K in keyof T & string]: {
    entry: T[K]["entry"] extends true ? true : false;
    input: Static<T[K]["input"]>;
    output: T[K]["output"] extends TSchema ? Static<T[K]["output"]> : undefined;
    continueWith: T[K]["continueWith"] extends TSchema
      ? Static<T[K]["continueWith"]> & PartialJobTypeReference
      : undefined;
    blockers: T[K]["blockers"] extends TSchema
      ? Static<T[K]["blockers"]> & readonly PartialJobTypeReference[]
      : undefined;
  };
};

/**
 * Validation error thrown when TypeBox validation fails.
 */
class TypeBoxValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: ReturnType<typeof Value.Errors>,
  ) {
    super(message);
    this.name = "TypeBoxValidationError";
  }
}

/**
 * Parse and validate data using a TypeBox schema.
 * Throws TypeBoxValidationError if validation fails.
 * Uses Value.Decode to apply transforms (like Type.Transform).
 */
const parse = <T extends TSchema>(schema: T, data: unknown): Static<T> => {
  // First decode (which applies transforms)
  const decoded = Value.Decode(schema, data);
  // Then validate the decoded value
  const errors = [...Value.Errors(schema, decoded)];
  if (errors.length > 0) {
    const messages = errors.map((e) => `${e.path}: ${e.message}`).join(", ");
    throw new TypeBoxValidationError(`Validation failed: ${messages}`, Value.Errors(schema, data));
  }
  return decoded;
};

/**
 * Create a TypeBox-based job type registry.
 *
 * This adapter:
 * 1. Accepts TypeBox schemas for each job type
 * 2. Infers TypeScript types from the schemas
 * 3. Validates at runtime using TypeBox's Value.Check() method
 *
 * Errors thrown by TypeBox are caught by the core registry and wrapped
 * in JobTypeValidationError with the appropriate error code.
 *
 * @example
 * const registry = createTypeBoxJobTypeRegistry({
 *   "process-data": {
 *     entry: true,
 *     input: Type.Object({ dataId: Type.String() }),
 *     output: Type.Object({ result: Type.Number() }),
 *   },
 *   "send-notification": {
 *     entry: true,
 *     input: Type.Object({ userId: Type.String(), message: Type.String() }),
 *     output: Type.Object({ sent: Type.Boolean() }),
 *   },
 * });
 */
export const createTypeBoxJobTypeRegistry = <T extends Record<string, TypeBoxJobTypeSchema>>(
  schemas: T,
) => {
  const getSchema = (typeName: string): TypeBoxJobTypeSchema => {
    const schema = schemas[typeName];
    if (!schema) {
      throw new Error(`Unknown job type: ${typeName}`);
    }
    return schema;
  };

  return createJobTypeRegistry<InferTypeBoxJobTypes<T>>({
    validateEntry: (typeName) => {
      const schema = getSchema(typeName);
      if (schema.entry !== true) {
        throw new Error(`Job type "${typeName}" is not an entry point`);
      }
    },

    parseInput: (typeName, input) => {
      return parse(getSchema(typeName).input, input);
    },

    parseOutput: (typeName, output) => {
      const schema = getSchema(typeName);
      if (schema.output) {
        return parse(schema.output, output);
      } else {
        throw new Error(`Job type "${typeName}" does not have an output schema`);
      }
    },

    validateContinueWith: (typeName, continuation) => {
      const schema = getSchema(typeName);
      if (schema.continueWith) {
        parse(schema.continueWith, continuation);
      } else {
        throw new Error(`Job type "${typeName}" does not support continuations`);
      }
    },

    validateBlockers: (typeName, blockers) => {
      const schema = getSchema(typeName);
      if (schema.blockers) {
        parse(schema.blockers, blockers);
      } else if (blockers.length > 0) {
        throw new Error(`Job type "${typeName}" does not support blockers`);
      }
    },
  });
};
