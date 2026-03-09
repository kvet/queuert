import { type BaseJobTypeDefinitions } from "./job-type.js";
import { type JobTypeRegistry, createNoopJobTypeRegistry } from "./job-type-registry.js";
import { type NavigationMap } from "./job-type-registry.navigation.js";
import { type ValidatedJobTypeDefinitions } from "./job-type.validation.js";

/**
 * Define job types with compile-time type checking only (no runtime validation).
 * Returns a JobTypeRegistry that passes all values through without validation.
 *
 * @example
 * // Inline definition
 * const jobTypeRegistry = defineJobTypeRegistry<{
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
 * // With DefineJobTypes for better IntelliSense
 * type MyJobDefinitions = DefineJobTypes<{
 *   'process': {
 *     entry: true;
 *     input: { id: string };
 *     output: { result: string };
 *   };
 * }>;
 *
 * const jobTypeRegistry = defineJobTypeRegistry<MyJobDefinitions>();
 */
export const defineJobTypeRegistry = <
  TJobTypeDefinitions extends BaseJobTypeDefinitions &
    ValidatedJobTypeDefinitions<TJobTypeDefinitions, TExternalJobTypeDefinitions>,
  TExternalJobTypeDefinitions extends BaseJobTypeDefinitions = Record<never, never>,
>(): JobTypeRegistry<
  TJobTypeDefinitions,
  TExternalJobTypeDefinitions,
  NavigationMap<TJobTypeDefinitions>
> => {
  return createNoopJobTypeRegistry<TJobTypeDefinitions, TExternalJobTypeDefinitions>();
};
