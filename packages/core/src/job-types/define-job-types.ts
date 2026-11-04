import { type BaseJobTypeDefinitions } from "./job-type.js";
import { type ValidatedJobTypeDefinitions } from "./job-type.validation.js";
import { type JobTypes, createNoopJobTypes } from "./job-types.js";
import { type FindNonJsonValue } from "./json-serializable.js";

type JsonSerializableJobTypeDefinitions<T extends BaseJobTypeDefinitions> = {
  [K in keyof T]: [FindNonJsonValue<T[K]["input"]>] extends [never]
    ? T[K] extends { output: infer O }
      ? [FindNonJsonValue<O>] extends [never]
        ? T[K]
        : `Error: output of job type "${K & string}" must be JSON-serializable. Use a validator adapter with codec for non-JSON runtime types.`
      : T[K]
    : `Error: input of job type "${K & string}" must be JSON-serializable. Use a validator adapter with codec for non-JSON runtime types.`;
};

/**
 * Define job types with compile-time type checking only (no runtime validation).
 * Returns a JobTypes that passes all values through (identity codec).
 *
 * `input` and `output` must be JSON-serializable types, since the value a
 * handler sees is the value that gets stored.
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
 */
export const defineJobTypes = <
  TJobTypeDefinitions extends BaseJobTypeDefinitions &
    ValidatedJobTypeDefinitions<TJobTypeDefinitions, TExternalJobTypeDefinitions> &
    JsonSerializableJobTypeDefinitions<TJobTypeDefinitions>,
  TExternalJobTypeDefinitions extends BaseJobTypeDefinitions = Record<never, never>,
>(): JobTypes<TJobTypeDefinitions, TExternalJobTypeDefinitions> => {
  return createNoopJobTypes<TJobTypeDefinitions, TExternalJobTypeDefinitions>();
};
