import { type Client } from "../client.js";
import { type JobTypeRegistry } from "../entities/job-type-registry.js";
import { type BaseJobTypeDefinitions } from "../entities/job-type.js";
import { type BackoffConfig } from "../helpers/backoff.js";
import { type StateAdapter } from "../state-adapter/state-adapter.js";
import { type AttemptHandler } from "./job-process.js";
import { type LeaseConfig } from "./lease.js";

/** Configuration for processing a single job type. */
export type InProcessWorkerProcessor<
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions & string,
> = {
  /** Handler function called for each job attempt */
  attemptHandler: AttemptHandler<TStateAdapter, TJobTypeDefinitions, TJobTypeName>;
  /** Per-job-type backoff configuration (overrides processDefaults) */
  backoffConfig?: BackoffConfig;
  /** Per-job-type lease configuration (overrides processDefaults) */
  leaseConfig?: LeaseConfig;
};

/** Symbol used to carry phantom job type definitions on a processors registry. */
export const processorsDefinitionsSymbol: unique symbol = Symbol("queuert.processors.definitions");

/** Symbol used to carry phantom external job type definitions on a processors registry. */
export const processorsExternalDefinitionsSymbol: unique symbol = Symbol(
  "queuert.processors.externalDefinitions",
);

/** Extract the job type definitions from a {@link JobTypeProcessorsRegistry}. */
export type ProcessorsRegistryDefinitions<T extends JobTypeProcessorsRegistry> =
  T[typeof processorsDefinitionsSymbol];

/** Extract the external job type definitions from a {@link JobTypeProcessorsRegistry}. */
export type ProcessorsRegistryExternalDefinitions<T extends JobTypeProcessorsRegistry> =
  T[typeof processorsExternalDefinitionsSymbol];

/**
 * A processors registry that bundles processor implementations with their
 * type definitions via phantom symbol properties.
 *
 * Created via {@link defineJobTypeProcessorRegistry}. Merged via {@link mergeJobTypeProcessorRegistries}.
 */
export type JobTypeProcessorsRegistry<
  TJobTypeDefinitions extends BaseJobTypeDefinitions = BaseJobTypeDefinitions,
  TExternalJobTypeDefinitions extends BaseJobTypeDefinitions = Record<never, never>,
> = {
  readonly [key: string]: InProcessWorkerProcessor<any, any, any>;
} & {
  readonly [processorsDefinitionsSymbol]: TJobTypeDefinitions;
  readonly [processorsExternalDefinitionsSymbol]: TExternalJobTypeDefinitions;
};

/**
 * Define a processors registry for a job type slice with full type inference.
 * Returns a {@link JobTypeProcessorsRegistry} that carries the slice's type
 * definitions via phantom symbol properties, enabling lightweight compatibility
 * checks when passed to `createInProcessWorker`.
 *
 * @example
 * const orderProcessors = defineJobTypeProcessorRegistry(client, orderJobTypes, {
 *   "orders.create": {
 *     attemptHandler: async ({ complete }) => complete(async () => ({ orderId: "1" })),
 *   },
 * });
 */
export const defineJobTypeProcessorRegistry = <
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TExternalJobTypeDefinitions extends BaseJobTypeDefinitions,
  TProcessors extends keyof TJobTypeDefinitions & string,
>(
  _client: Client<any, TStateAdapter>,
  _jobTypeRegistry: JobTypeRegistry<TJobTypeDefinitions, TExternalJobTypeDefinitions>,
  processors: {
    [K in TProcessors]: InProcessWorkerProcessor<
      TStateAdapter,
      TJobTypeDefinitions & TExternalJobTypeDefinitions,
      K
    >;
  } & Record<Exclude<TProcessors, keyof TJobTypeDefinitions & string>, never>,
): JobTypeProcessorsRegistry<TJobTypeDefinitions, TExternalJobTypeDefinitions> => {
  return Object.assign({}, processors, {
    [processorsDefinitionsSymbol]: undefined as unknown as TJobTypeDefinitions,
    [processorsExternalDefinitionsSymbol]: undefined as unknown as TExternalJobTypeDefinitions,
  }) as JobTypeProcessorsRegistry<TJobTypeDefinitions, TExternalJobTypeDefinitions>;
};
