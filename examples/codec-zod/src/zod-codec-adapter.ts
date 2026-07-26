/**
 * Zod Codec Adapter for Queuert
 *
 * Where `examples/validation-zod` validates a value that is already JSON-safe,
 * this adapter *transforms* it: `encode` turns the runtime form into the stored
 * form, `decode` turns it back. That is what lets a job input hold a `Date`
 * while the database still holds an ISO string.
 *
 * Two type-level pieces make the split explicit:
 * - `z.output<schema>` is the runtime form — what handlers and client reads see.
 * - `z.input<schema>` is the stored form — constrained to `JsonSerializable`,
 *   so a schema that would persist a `Date` is a compile error, not a silent
 *   round-trip bug.
 */

import {
  type BaseJobTypeDefinitions,
  type JobTypeDefinitionErrors,
  type JobTypeReference,
  type JobTypes,
  type JobTypesDefinitions,
  type JsonSerializable,
  type ValidatedJobTypeDefinitions,
  createJobTypes,
} from "queuert";
import { z } from "zod";

/** Schema definition for a single job type. */
export type ZodCodecJobTypeSchema = {
  /** Whether this job type can start a chain (entry point). Default: false */
  entry?: boolean;
  /** Codec for job input. `z.output` is the runtime form, `z.input` the stored form. */
  input: z.ZodType;
  /** Codec for job output. Omit if the job must continue. */
  output?: z.ZodType;
  /** Schema for validating continuation targets, applied to the runtime form. */
  continueWith?: z.ZodType<JobTypeReference>;
};

/** Runtime form — the types handlers and client reads work with. */
type InferRuntimeJobTypes<T extends Record<string, ZodCodecJobTypeSchema>> = {
  [K in keyof T & string]: {
    entry: T[K]["entry"] extends true ? true : undefined;
    input: z.output<T[K]["input"]>;
    output: T[K]["output"] extends z.ZodType ? z.output<T[K]["output"]> : undefined;
    continueWith: T[K]["continueWith"] extends z.ZodType<infer U>
      ? U extends JobTypeReference
        ? U
        : JobTypeReference
      : undefined;
    blockers: undefined;
  };
};

/** Stored form — what `encode` produces and the state adapter persists. */
type InferStoredJobTypes<T extends Record<string, ZodCodecJobTypeSchema>> = {
  [K in keyof T & string]: {
    input: z.input<T[K]["input"]>;
    output: T[K]["output"] extends z.ZodType ? z.input<T[K]["output"]> : null;
  };
};

/**
 * Create a Zod codec-based job type registry.
 *
 * @example
 * const jobTypes = createZodCodecJobTypes({
 *   "send-reminder": {
 *     entry: true,
 *     input: z.object({
 *       sendAt: z.codec(z.iso.datetime(), z.date(), {
 *         decode: (iso) => new Date(iso),
 *         encode: (date) => date.toISOString(),
 *       }),
 *     }),
 *     output: z.object({ sent: z.boolean() }),
 *   },
 * });
 */
export const createZodCodecJobTypes = <
  const T extends Record<string, ZodCodecJobTypeSchema>,
  const TExternal extends
    | JobTypes<BaseJobTypeDefinitions>
    | readonly JobTypes<BaseJobTypeDefinitions>[] = readonly [],
>(
  schemas: [InferRuntimeJobTypes<T>] extends [
    ValidatedJobTypeDefinitions<InferRuntimeJobTypes<T>, JobTypesDefinitions<TExternal>>,
  ]
    ? [InferStoredJobTypes<T>] extends [JsonSerializable]
      ? T
      : "Error: the encoded form of at least one schema is not JSON-serializable. Add a z.codec that lowers it to a JSON type."
    : JobTypeDefinitionErrors<InferRuntimeJobTypes<T>, JobTypesDefinitions<TExternal>>,
  _externalDefinitions?: TExternal,
) => {
  const _schemas = schemas as Record<string, ZodCodecJobTypeSchema>;
  const getSchema = (typeName: string, direction: "input" | "output"): z.ZodType => {
    const schema = _schemas[typeName];
    if (!schema) throw new Error(`Unknown job type: ${typeName}`);
    const target = direction === "input" ? schema.input : schema.output;
    if (!target) throw new Error(`Job type "${typeName}" does not have an output schema`);
    return target;
  };

  return createJobTypes<InferRuntimeJobTypes<T>, JobTypesDefinitions<TExternal>>({
    getTypeNames: () => Object.keys(_schemas),
    validateEntry: (typeName) => {
      if (_schemas[typeName]?.entry !== true) {
        throw new Error(`Job type "${typeName}" is not an entry point`);
      }
    },

    // One batch call per write / per read page. Items are heterogeneous in both
    // `typeName` and `direction`, so each is dispatched to its own schema.
    encode: async (items) =>
      items.map((item) => z.encode(getSchema(item.typeName, item.direction), item.value)),
    decode: async (items) =>
      items.map((item) => z.decode(getSchema(item.typeName, item.direction), item.value)),

    validateContinueWith: (typeName, continuation) => {
      const schema = _schemas[typeName]?.continueWith;
      if (!schema) throw new Error(`Job type "${typeName}" does not support continuations`);
      schema.parse(continuation);
    },

    validateBlockers: (typeName, blockers) => {
      if (blockers.length > 0) {
        throw new Error(`Job type "${typeName}" does not support blockers`);
      }
    },
  });
};
