import { type Client } from "../client.js";
import { type JobTypeRegistry, mergedRegistrySymbol } from "../entities/job-type-registry.js";
import { type BaseJobTypeDefinitions } from "../entities/job-type.js";
import { type StateAdapter } from "../state-adapter/state-adapter.js";
import {
  type InProcessWorkerProcessor,
  type JobTypeProcessorRegistry,
  processorDefinitionsSymbol,
  processorExternalDefinitionsSymbol,
} from "./job-type-processor-registry.js";

/** Merged definitions: union of own + external defs for use as TJobTypeDefinitions in processors. */
type MergedDefs<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TExternalJobTypeDefinitions extends BaseJobTypeDefinitions,
> = [keyof TExternalJobTypeDefinitions & string] extends [never]
  ? TJobTypeDefinitions
  : TJobTypeDefinitions | TExternalJobTypeDefinitions;

/**
 * Define a processor registry for a job type slice with full type inference.
 * Returns a {@link JobTypeProcessorRegistry} that carries the slice's type
 * definitions via phantom symbol properties, enabling lightweight compatibility
 * checks when passed to `createInProcessWorker`.
 *
 * @example
 * const orderJobTypeProcessorRegistry = createJobTypeProcessorRegistry({
 *   client,
 *   jobTypeRegistry: orderJobTypeRegistry,
 *   processors: {
 *     "orders.create": {
 *       attemptHandler: async ({ complete }) => complete(async () => ({ orderId: "1" })),
 *     },
 *   },
 * });
 */
export const createJobTypeProcessorRegistry = <
  TClientJobTypeDefinitions extends BaseJobTypeDefinitions,
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TExternalJobTypeDefinitions extends BaseJobTypeDefinitions,
  TProcessors extends keyof TJobTypeDefinitions & string,
  TMergedJobTypeDefinitions extends BaseJobTypeDefinitions = MergedDefs<
    TJobTypeDefinitions,
    TExternalJobTypeDefinitions
  >,
>(options: {
  client: [TJobTypeDefinitions] extends [TClientJobTypeDefinitions]
    ? Client<TClientJobTypeDefinitions, TStateAdapter>
    : `Error: client is missing required job types: ${Exclude<keyof TJobTypeDefinitions & string, keyof TClientJobTypeDefinitions & string>}`;
  jobTypeRegistry: JobTypeRegistry<TJobTypeDefinitions, TExternalJobTypeDefinitions, false>;
  processors: {
    [K in TProcessors]: InProcessWorkerProcessor<TStateAdapter, TMergedJobTypeDefinitions, K>;
  } & Record<Exclude<TProcessors, keyof TJobTypeDefinitions & string>, never>;
}): JobTypeProcessorRegistry<TJobTypeDefinitions, TExternalJobTypeDefinitions> => {
  if ((options.jobTypeRegistry as JobTypeRegistry)[mergedRegistrySymbol]) {
    throw new TypeError(
      "createJobTypeProcessorRegistry does not accept a merged registry. " +
        "Create a processor registry per slice, then merge them with mergeJobTypeProcessorRegistries.",
    );
  }
  return Object.assign({}, options.processors, {
    [processorDefinitionsSymbol]: undefined as unknown as TJobTypeDefinitions,
    [processorExternalDefinitionsSymbol]: undefined as unknown as TExternalJobTypeDefinitions,
  }) as JobTypeProcessorRegistry<TJobTypeDefinitions, TExternalJobTypeDefinitions>;
};
