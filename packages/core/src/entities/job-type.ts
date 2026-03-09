/** Reference to a job type by its type name. */
export type NominalJobTypeReference<T extends string = string> = { typeName: T };
/** Reference to a job type by its input shape. */
export type StructuralJobTypeReference<T = unknown> = { input: T };
/** Reference to another job type — either nominal (by name) or structural (by input shape). */
export type JobTypeReference = NominalJobTypeReference | StructuralJobTypeReference;

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

/** Identity type helper for better IntelliSense when defining job types separately from {@link defineJobTypeRegistry}. */
export type DefineJobTypes<T extends BaseJobTypeDefinitions> = T;

/**
 * Reference object for continuation and blocker validation.
 * Contains both typeName (for nominal validation) and input (for structural validation).
 */
export type ResolvedJobTypeReference = {
  readonly typeName: string;
  readonly input: unknown;
};
