/** Reference to a job type by its type name. */
export type NominalReference<T extends string = string> = { typeName: T };
/** Reference to a job type by its input shape. */
export type StructuralReference<T = unknown> = { input: T };
/** Reference to another job type — either nominal (by name) or structural (by input shape). */
export type JobTypeReference = NominalReference | StructuralReference;

/**
 * Base shape for a single job type definition.
 *
 * - `entry` — Whether this type can start a chain.
 * - `input` — The input payload type.
 * - `output` — The output type when completing the chain (omit for continuation-only types).
 * - `continueWith` — Reference to the next job type in the chain.
 * - `blockers` — References to chain types that must complete before this job can run.
 */
export type BaseJobTypeDefinition = {
  entry?: boolean;
  input: unknown;
  output?: unknown;
  continueWith?: JobTypeReference;
  blockers?: readonly JobTypeReference[];
};

/** Record mapping job type names to their definitions. */
export type BaseJobTypeDefinitions = Record<string, BaseJobTypeDefinition>;

/** Identity type helper for better IntelliSense when defining job types separately from {@link defineJobTypes}. */
export type DefineJobTypes<T extends BaseJobTypeDefinitions> = T;

import { createNoopJobTypeRegistry, type JobTypeRegistry } from "./job-type-registry.js";
import { type ValidatedJobTypeDefinitions } from "./job-type.validation.js";

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
