import { type BaseJobTypeDefinitions } from "./job-type.js";
import { type ValidatedJobTypeDefinitions } from "./job-type.validation.js";
import { type JobTypes, createNoopJobTypes } from "./job-types.js";
import { type JsonSerializable } from "./json-serializable.js";

/**
 * Compile-time check: each job type's `input`/`output` is JSON-serializable.
 *
 * `defineJobTypes` provides no codec, so the runtime form is also the storage
 * form — both must be JSON-safe. Anyone who needs `Date` (or another non-JSON
 * runtime type) on a handler's input/output should use a validator adapter
 * with a codec (e.g. `createZodJobTypes` with `z.codec`) instead.
 */
type JsonSerializableJobTypeDefinitions<T extends BaseJobTypeDefinitions> = {
  [K in keyof T]: [T[K]["input"]] extends [JsonSerializable]
    ? T[K] extends { output: infer O }
      ? [O] extends [JsonSerializable | undefined]
        ? T[K]
        : `Error: output of job type "${K & string}" must be JSON-serializable. Use a validator adapter with codec for non-JSON runtime types.`
      : T[K]
    : `Error: input of job type "${K & string}" must be JSON-serializable. Use a validator adapter with codec for non-JSON runtime types.`;
};

/**
 * Define job types with compile-time type checking only (no runtime validation).
 * Returns a JobTypes that passes all values through (identity codec).
 *
 * The runtime registry still enforces JSON-serializability on every encoded
 * value, so a `Date`/`Map`/`Set` slipping past TS (e.g. via `any`) is caught
 * at the first write rather than corrupting state silently.
 *
 * @example
 * // Inline definition
 * const jobTypes = defineJobTypes<{
 *   'fetch': {
 *     entry: true;
 *     input: { url: string };
 *     output: { data: unknown };
 *   };
 *   'process': {
 *     entry: true;
 *     input: { id: string };
 *     continueWith: { typeName: 'finalize' };
 *     blockers: [{ typeName: 'fetch' }];
 *   };
 *   'finalize': {
 *     input: { result: string };
 *     output: { done: boolean };
 *   };
 * }>();
 *
 * @example
 * // With JobTypeDefs for better IntelliSense
 * type MyJobDefinitions = JobTypeDefs<{
 *   'process': {
 *     entry: true;
 *     input: { id: string };
 *     output: { result: string };
 *   };
 * }>;
 *
 * const jobTypes = defineJobTypes<MyJobDefinitions>();
 */
export const defineJobTypes = <
  TJobTypeDefinitions extends BaseJobTypeDefinitions &
    ValidatedJobTypeDefinitions<TJobTypeDefinitions, TExternalJobTypeDefinitions> &
    JsonSerializableJobTypeDefinitions<TJobTypeDefinitions>,
  TExternalJobTypeDefinitions extends BaseJobTypeDefinitions = Record<never, never>,
>(): JobTypes<TJobTypeDefinitions, TExternalJobTypeDefinitions> => {
  return createNoopJobTypes<TJobTypeDefinitions, TExternalJobTypeDefinitions>();
};
