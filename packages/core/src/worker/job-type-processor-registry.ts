import { type JobTypeReachingEntry } from "../entities/job-type-registry.resolvers.js";
import { type BaseJobTypeDefinitions } from "../entities/job-type.js";
import { type BackoffConfig } from "../helpers/backoff.js";
import { type StateAdapter } from "../state-adapter/state-adapter.js";
import { type AttemptHandler } from "./job-process.js";
import { type LeaseConfig } from "./lease.js";

/** Configuration for processing a single job type. */
export type InProcessWorkerProcessor<
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
> = {
  /** Handler function called for each job attempt */
  attemptHandler: AttemptHandler<
    TStateAdapter,
    TJobTypeDefinitions,
    TJobTypeName,
    JobTypeReachingEntry<TJobTypeDefinitions, TJobTypeName>
  >;
  /** Per-job-type backoff configuration (overrides jobTypeProcessorDefaults) */
  backoffConfig?: BackoffConfig;
  /** Per-job-type lease configuration (overrides jobTypeProcessorDefaults) */
  leaseConfig?: LeaseConfig;
};

/**
 * Symbol used to carry phantom job type definitions on a processor registry.
 * @internal
 */
export const processorDefinitionsSymbol: unique symbol = Symbol("queuert.processor.definitions");

/**
 * Symbol used to carry phantom external job type definitions on a processor registry.
 * @internal
 */
export const processorExternalDefinitionsSymbol: unique symbol = Symbol(
  "queuert.processor.externalDefinitions",
);

/** Extract the job type definitions from a {@link JobTypeProcessorRegistry}. */
export type JobTypeProcessorRegistryDefinitions<T extends JobTypeProcessorRegistry> =
  T[typeof processorDefinitionsSymbol];

/** Extract the external job type definitions from a {@link JobTypeProcessorRegistry}. */
export type ExternalJobTypeProcessorRegistryDefinitions<T extends JobTypeProcessorRegistry> =
  T[typeof processorExternalDefinitionsSymbol];

/**
 * A processor registry that bundles processor implementations with their
 * type definitions via phantom symbol properties.
 *
 * Created via {@link createJobTypeProcessorRegistry}. Merged via {@link mergeJobTypeProcessorRegistries}.
 */
export type JobTypeProcessorRegistry<
  TJobTypeDefinitions extends BaseJobTypeDefinitions = BaseJobTypeDefinitions,
  TExternalJobTypeDefinitions extends BaseJobTypeDefinitions = Record<never, never>,
> = {
  readonly [key: string]: InProcessWorkerProcessor<any, any, any>;
} & {
  readonly [processorDefinitionsSymbol]: TJobTypeDefinitions;
  readonly [processorExternalDefinitionsSymbol]: TExternalJobTypeDefinitions;
};
