/**
 * superjson Codec Adapter for Queuert
 *
 * One codec for every job type: superjson lowers `Date`, `Map`, `Set`, `bigint`
 * and friends to JSON on write and restores them on read, so job types are
 * declared with plain TypeScript types and need no per-type schema.
 *
 * Each stored input and output is superjson's envelope — `{ json, meta }` —
 * rather than the bare value. Every client and worker reading the same database
 * must use this adapter.
 *
 * The adapter takes the job type names at runtime, listed as an object so the
 * compiler rejects a missing one. Queuert decodes only values of type names the
 * registry reports, which keeps rows of removed job types readable as stored.
 */

import {
  type BaseJobTypeDefinitions,
  type JobTypeDefinitionErrors,
  type JobTypes,
  type ValidatedJobTypeDefinitions,
  createJobTypes,
} from "queuert";
import superjson, { type SuperJSONResult } from "superjson";

/**
 * Create a job type registry that stores every input and output through
 * superjson. Validates job type structure at compile time only, like
 * `defineJobTypes`.
 *
 * @example
 * const jobTypes = createSuperjsonJobTypes<{
 *   remind: { entry: true; input: { sendAt: Date }; output: { sentAt: Date } };
 * }>({ remind: true });
 */
export const createSuperjsonJobTypes = <T extends BaseJobTypeDefinitions>(
  typeNames: [T] extends [ValidatedJobTypeDefinitions<T, Record<never, never>>]
    ? { readonly [K in keyof T]: true }
    : JobTypeDefinitionErrors<T>,
): JobTypes<T> => {
  const names = Object.keys(typeNames);
  const encode = (_typeName: string, value: unknown) => superjson.serialize(value);
  const decode = (_typeName: string, stored: unknown) =>
    superjson.deserialize(stored as SuperJSONResult);

  return createJobTypes<T>({
    getTypeNames: () => names,
    validateEntry: () => {},
    encodeInput: encode,
    decodeInput: decode,
    encodeOutput: encode,
    decodeOutput: decode,
    validateContinueWith: () => {},
    validateBlockers: () => {},
  });
};
