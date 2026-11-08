/**
 * TypeBox Adapter for Queuert Runtime Validation
 *
 * This is a user-land adapter that shows how to integrate TypeBox with Queuert's
 * runtime validation system. The same pattern applies to Zod, Valibot, ArkType,
 * or any other validation library.
 *
 * Each schema is compiled once with `TypeCompiler.Compile`, so the check that runs
 * on every job read and write is generated code rather than TypeBox's interpreter.
 *
 * The stored form equals the runtime form, so one check serves as both encoder and
 * decoder and returns the value unchanged; transforms (`Type.Transform`) are not
 * applied. Use a codec adapter such as `examples/codec-zod` when the two forms differ.
 */

import type { Static, TSchema } from "@sinclair/typebox";
import { type TypeCheck, type ValueErrorIterator, TypeCompiler } from "@sinclair/typebox/compiler";
import {
  type BaseJobTypeDefinitions,
  type JobTypesDefinitions,
  type JobTypeDefinitionErrors,
  type JobTypeReference,
  type JobTypes,
  type ValidatedJobTypeDefinitions,
  createJobTypes,
} from "queuert";

/**
 * Schema definition for a single job type using TypeBox.
 */
type TypeBoxSchemaFor<T> = TSchema & { static: T };

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
  continueWith?: TypeBoxSchemaFor<JobTypeReference>;
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
  blockers?: TypeBoxSchemaFor<readonly JobTypeReference[]>;
};

/**
 * Infer BaseJobTypeDefinitions from TypeBox schemas.
 * This enables compile-time type safety for the job types.
 */
type InferTypeBoxJobTypes<T extends Record<string, TypeBoxJobTypeSchema>> = {
  [K in keyof T & string]: {
    entry: T[K]["entry"] extends true ? true : undefined;
    input: Static<T[K]["input"]>;
    output: T[K]["output"] extends TSchema ? Static<T[K]["output"]> : undefined;
    continueWith: T[K]["continueWith"] extends TSchema
      ? Static<T[K]["continueWith"]> extends infer U extends JobTypeReference
        ? U
        : JobTypeReference
      : undefined;
    blockers: T[K]["blockers"] extends TSchema
      ? Static<T[K]["blockers"]> extends infer U extends readonly JobTypeReference[]
        ? U
        : readonly JobTypeReference[]
      : undefined;
  };
};

/**
 * Validation error thrown when TypeBox validation fails.
 */
class TypeBoxValidationError extends Error {
  readonly errors: ValueErrorIterator;

  constructor(message: string, errors: ValueErrorIterator) {
    super(message);
    this.errors = errors;
    this.name = "TypeBoxValidationError";
  }
}

/** A job type's schemas, each compiled once. */
type CompiledJobTypeSchema = {
  entry?: boolean;
  input: TypeCheck<TSchema>;
  output?: TypeCheck<TSchema>;
  continueWith?: TypeCheck<TSchema>;
  blockers?: TypeCheck<TSchema>;
};

/**
 * Validate data with a compiled schema and return it unchanged.
 * Throws TypeBoxValidationError listing every error if validation fails.
 */
const parse = (check: TypeCheck<TSchema>, data: unknown): unknown => {
  if (check.Check(data)) return data;
  const messages = [...check.Errors(data)].map((e) => `${e.path}: ${e.message}`).join(", ");
  throw new TypeBoxValidationError(`Validation failed: ${messages}`, check.Errors(data));
};

/**
 * Create a TypeBox-based job type registry.
 *
 * This adapter:
 * 1. Accepts TypeBox schemas for each job type
 * 2. Infers TypeScript types from the schemas
 * 3. Validates at runtime with schemas compiled by TypeBox's TypeCompiler
 *
 * Errors thrown by TypeBox are caught by the core registry and wrapped
 * in JobTypeValidationError with the appropriate error code.
 *
 * @example
 * const jobTypes = createTypeBoxJobTypes({
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
export const createTypeBoxJobTypes = <
  const T extends Record<string, TypeBoxJobTypeSchema>,
  const TExternal extends
    | JobTypes<BaseJobTypeDefinitions>
    | readonly JobTypes<BaseJobTypeDefinitions>[] = readonly [],
>(
  schemas: [InferTypeBoxJobTypes<T>] extends [
    ValidatedJobTypeDefinitions<InferTypeBoxJobTypes<T>, JobTypesDefinitions<TExternal>>,
  ]
    ? T
    : JobTypeDefinitionErrors<InferTypeBoxJobTypes<T>, JobTypesDefinitions<TExternal>>,
  _externalDefinitions?: TExternal,
) => {
  const _schemas = Object.fromEntries(
    Object.entries(schemas as Record<string, TypeBoxJobTypeSchema>).map(
      ([typeName, schema]): [string, CompiledJobTypeSchema] => [
        typeName,
        {
          entry: schema.entry,
          input: TypeCompiler.Compile(schema.input),
          output: schema.output && TypeCompiler.Compile(schema.output),
          continueWith: schema.continueWith && TypeCompiler.Compile(schema.continueWith),
          blockers: schema.blockers && TypeCompiler.Compile(schema.blockers),
        },
      ],
    ),
  );
  const getSchema = (typeName: string): CompiledJobTypeSchema => {
    const schema = _schemas[typeName];
    if (!schema) {
      throw new Error(`Unknown job type: ${typeName}`);
    }
    return schema;
  };

  const parseInput = (typeName: string, input: unknown): unknown =>
    parse(getSchema(typeName).input, input);

  const parseOutput = (typeName: string, output: unknown): unknown => {
    const schema = getSchema(typeName).output;
    if (!schema) throw new Error(`Job type "${typeName}" does not have an output schema`);
    return parse(schema, output);
  };

  return createJobTypes<InferTypeBoxJobTypes<T>, JobTypesDefinitions<TExternal>>({
    getTypeNames: () => Object.keys(_schemas),
    validateEntry: (typeName) => {
      const schema = getSchema(typeName);
      if (schema.entry !== true) {
        throw new Error(`Job type "${typeName}" is not an entry point`);
      }
    },

    encodeInput: parseInput,
    decodeInput: parseInput,
    encodeOutput: parseOutput,
    decodeOutput: parseOutput,

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
