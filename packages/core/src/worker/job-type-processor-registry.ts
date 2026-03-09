import { type BaseJobTypeDefinitions } from "../entities/job-type.js";
import { type BaseNavigationMap } from "../entities/job-type-registry.navigation.js";
import { type BackoffConfig } from "../helpers/backoff.js";
import { type StateAdapter } from "../state-adapter/state-adapter.js";
import { type AttemptHandler } from "./job-process.js";
import { type LeaseConfig } from "./lease.js";

/** Configuration for processing a single job type. */
export type InProcessWorkerProcessor<
  TStateAdapter extends StateAdapter<any, any>,
  TNavigationMap extends BaseNavigationMap,
  TJobTypeName extends keyof TNavigationMap & string,
> = {
  /** Handler function called for each job attempt */
  attemptHandler: AttemptHandler<TStateAdapter, TNavigationMap, TJobTypeName>;
  /** Per-job-type backoff configuration (overrides processDefaults) */
  backoffConfig?: BackoffConfig;
  /** Per-job-type lease configuration (overrides processDefaults) */
  leaseConfig?: LeaseConfig;
};

/** Symbol used to carry phantom job type definitions on a processor registry. */
export const processorDefinitionsSymbol: unique symbol = Symbol("queuert.processor.definitions");

/** Symbol used to carry phantom external job type definitions on a processor registry. */
export const processorExternalDefinitionsSymbol: unique symbol = Symbol(
  "queuert.processor.externalDefinitions",
);

/** Symbol used to carry phantom pre-computed navigation map on a processor registry. */
export const processorNavigationSymbol: unique symbol = Symbol("queuert.processor.navigation");

/** Extract the job type definitions from a {@link JobTypeProcessorRegistry}. */
export type JobTypeProcessorRegistryDefinitions<T extends JobTypeProcessorRegistry> =
  T[typeof processorDefinitionsSymbol];

/** Extract the external job type definitions from a {@link JobTypeProcessorRegistry}. */
export type ExternalJobTypeProcessorRegistryDefinitions<T extends JobTypeProcessorRegistry> =
  T[typeof processorExternalDefinitionsSymbol];

/** Extract the pre-computed navigation map from a {@link JobTypeProcessorRegistry}. */
export type JobTypeProcessorRegistryNavigation<T extends JobTypeProcessorRegistry> =
  T[typeof processorNavigationSymbol];

/**
 * A processor registry that bundles processor implementations with their
 * type definitions via phantom symbol properties.
 *
 * Created via {@link createJobTypeProcessorRegistry}. Merged via {@link mergeJobTypeProcessorRegistries}.
 */
export type JobTypeProcessorRegistry<
  TJobTypeDefinitions extends BaseJobTypeDefinitions = BaseJobTypeDefinitions,
  TExternalJobTypeDefinitions extends BaseJobTypeDefinitions = Record<never, never>,
  TNavigationMap extends BaseNavigationMap = BaseNavigationMap,
> = {
  readonly [key: string]: InProcessWorkerProcessor<any, any, any>;
} & {
  readonly [processorDefinitionsSymbol]: TJobTypeDefinitions;
  readonly [processorExternalDefinitionsSymbol]: TExternalJobTypeDefinitions;
  readonly [processorNavigationSymbol]: TNavigationMap;
};
