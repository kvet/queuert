import { type Client } from "../client.js";
import { type JobTypeRegistry } from "../entities/job-type-registry.js";
import { type BaseJobTypeDefinitions } from "../entities/job-type.js";
import {
  type BaseNavigationMap,
  type NavigationMap,
} from "../entities/job-type-registry.navigation.js";
import { type StateAdapter } from "../state-adapter/state-adapter.js";
import {
  type InProcessWorkerProcessor,
  type JobTypeProcessorRegistry,
  processorDefinitionsSymbol,
  processorExternalDefinitionsSymbol,
  processorNavigationSymbol,
} from "./job-type-processor-registry.js";

type MergedNavigationMap<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TExternalJobTypeDefinitions extends BaseJobTypeDefinitions,
> = [keyof TExternalJobTypeDefinitions & string] extends [never]
  ? NavigationMap<TJobTypeDefinitions>
  : {
      [K in
        | (keyof TJobTypeDefinitions & string)
        | (keyof TExternalJobTypeDefinitions &
            string)]: K extends keyof NavigationMap<TJobTypeDefinitions>
        ? NavigationMap<TJobTypeDefinitions>[K]
        : K extends keyof NavigationMap<TExternalJobTypeDefinitions>
          ? NavigationMap<TExternalJobTypeDefinitions>[K]
          : never;
    };

/**
 * Define a processor registry for a job type slice with full type inference.
 * Returns a {@link JobTypeProcessorRegistry} that carries the slice's type
 * definitions via phantom symbol properties, enabling lightweight compatibility
 * checks when passed to `createInProcessWorker`.
 *
 * @example
 * const orderProcessorRegistry = createJobTypeProcessorRegistry(client, orderJobTypeRegistry, {
 *   "orders.create": {
 *     attemptHandler: async ({ complete }) => complete(async () => ({ orderId: "1" })),
 *   },
 * });
 */
export const createJobTypeProcessorRegistry = <
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TExternalJobTypeDefinitions extends BaseJobTypeDefinitions,
  TProcessors extends keyof TJobTypeDefinitions & string,
  TNavigationMap extends BaseNavigationMap = MergedNavigationMap<
    TJobTypeDefinitions,
    TExternalJobTypeDefinitions
  >,
>(
  _client: Client<any, TStateAdapter>,
  _jobTypeRegistry: JobTypeRegistry<TJobTypeDefinitions, TExternalJobTypeDefinitions>,
  processors: {
    [K in TProcessors]: InProcessWorkerProcessor<TStateAdapter, TNavigationMap, K>;
  } & Record<Exclude<TProcessors, keyof TJobTypeDefinitions & string>, never>,
): JobTypeProcessorRegistry<TJobTypeDefinitions, TExternalJobTypeDefinitions, TNavigationMap> => {
  return Object.assign({}, processors, {
    [processorDefinitionsSymbol]: undefined as unknown as TJobTypeDefinitions,
    [processorExternalDefinitionsSymbol]: undefined as unknown as TExternalJobTypeDefinitions,
    [processorNavigationSymbol]: undefined as unknown as TNavigationMap,
  }) as JobTypeProcessorRegistry<TJobTypeDefinitions, TExternalJobTypeDefinitions, TNavigationMap>;
};
