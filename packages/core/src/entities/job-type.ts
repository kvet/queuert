// Reference types for job type relationships
export type NominalReference<T extends string = string> = { typeName: T };
export type StructuralReference<T = unknown> = { input: T };
export type JobTypeReference = NominalReference | StructuralReference;

export type BaseJobTypeDefinition = {
  entry?: boolean;
  input: unknown;
  output?: unknown;
  continueWith?: JobTypeReference;
  blockers?: readonly JobTypeReference[];
};

export type BaseJobTypeDefinitions = Record<string, BaseJobTypeDefinition>;

export type DefineJobTypes<T extends BaseJobTypeDefinitions> = T;

import { createNoopJobTypeRegistry, JobTypeRegistry } from "./job-type-registry.js";
import { ValidatedJobTypeDefinitions } from "./job-type.validation.js";

/**
 * Define job types with compile-time type checking only (no runtime validation).
 * Returns a JobTypeRegistry that passes all values through without validation.
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
 * // With DefineJobTypes for better IntelliSense
 * type MyJobDefinitions = DefineJobTypes<{
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
  T extends BaseJobTypeDefinitions & ValidatedJobTypeDefinitions<T>,
>(): JobTypeRegistry<T> => {
  return createNoopJobTypeRegistry<T>();
};

export * from "./job-type.navigation.js";
