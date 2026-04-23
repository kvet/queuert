import { type BaseJobTypeDefinitions } from "./job-type.js";
import { type ValidatedJobTypeDefinitions } from "./job-type.validation.js";
import { type JobTypes, createNoopJobTypes } from "./job-types.js";

/**
 * Define job types with compile-time type checking only (no runtime validation).
 * Returns a JobTypes that passes all values through without validation.
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
    ValidatedJobTypeDefinitions<TJobTypeDefinitions, TExternalJobTypeDefinitions>,
  TExternalJobTypeDefinitions extends BaseJobTypeDefinitions = Record<never, never>,
>(): JobTypes<TJobTypeDefinitions, TExternalJobTypeDefinitions> => {
  return createNoopJobTypes<TJobTypeDefinitions, TExternalJobTypeDefinitions>();
};
