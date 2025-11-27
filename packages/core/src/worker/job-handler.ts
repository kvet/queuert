import { randomUUID } from "crypto";
import {
  CompatibleQueueTargets,
  FinishedJobChain,
  JobChain,
} from "../entities/job-chain.js";
import { EnqueuedJob, Job, RunningJob } from "../entities/job.js";
import { BaseQueueDefinitions } from "../entities/queue.js";
import { Branded } from "../helpers/typescript.js";
import { ProcessHelper, ResolvedQueueJobs } from "../queuert-helper.js";
import { StateJob } from "../state-adapter/state-adapter.js";
import {
  BaseStateProviderContext,
  GetStateProviderContext,
  StateProvider,
} from "../state-provider/state-provider.js";

const createSignal = <T = void>() => {
  const { promise, resolve } = Promise.withResolvers<T>();
  let resolved = false;
  return {
    onSignal: promise,
    get signalled() {
      return resolved;
    },
    signalOnce: (value: T) => {
      if (!resolved) {
        resolve(value);
        resolved = true;
      }
    },
  };
};

export type JobHandler<
  TStateProvider extends StateProvider<BaseStateProviderContext>,
  TQueueDefinitions extends BaseQueueDefinitions,
  TQueueName extends keyof TQueueDefinitions & string,
  TDependencies extends readonly JobChain<any, any, any>[]
> = (handlerOptions: {
  claim: <T>(
    claimCallback: (
      claimCallbackOptions: {
        job: RunningJob<
          Job<TQueueName, TQueueDefinitions[TQueueName]["input"]>
        >;
        dependencies: {
          [K in keyof TDependencies]: FinishedJobChain<TDependencies[K]>;
        };
      } & GetStateProviderContext<TStateProvider>
    ) => Promise<T>
  ) => Promise<T>;
  heartbeat: (options: { leaseMs: number }) => Promise<void>;
  withHeartbeat: <T>(
    cb: () => Promise<T>,
    options: { intervalMs: number; leaseMs: number }
  ) => Promise<T>;
  finalize: (
    finalizeCallback: (
      finalizeOptions: {
        enqueueJob: <
          TEnqueueQueueName extends CompatibleQueueTargets<
            TQueueDefinitions,
            TQueueName
          > &
            string
        >(
          options: {
            queueName: TEnqueueQueueName;
            input: TQueueDefinitions[TEnqueueQueueName]["input"];
          } & GetStateProviderContext<TStateProvider>
        ) => Promise<
          EnqueuedJob<
            TEnqueueQueueName,
            TQueueDefinitions[TEnqueueQueueName]["input"]
          >
        >;
      } & GetStateProviderContext<TStateProvider>
    ) => Promise<
      | TQueueDefinitions[TQueueName]["output"]
      | ResolvedQueueJobs<TQueueDefinitions, TQueueName>
    >
  ) => Promise<
    Branded<
      | TQueueDefinitions[TQueueName]["output"]
      | ResolvedQueueJobs<TQueueDefinitions, TQueueName>,
      "finalize_result"
    >
  >;
}) => Promise<
  Branded<
    | TQueueDefinitions[TQueueName]["output"]
    | ResolvedQueueJobs<TQueueDefinitions, TQueueName>,
    "finalize_result"
  >
>;

export const processJobHandler = async ({
  helper,
  handler,
  context,
  job,
  pollIntervalMs,
}: {
  helper: ProcessHelper;
  handler: JobHandler<
    StateProvider<BaseStateProviderContext>,
    BaseQueueDefinitions,
    string,
    readonly JobChain<string, unknown, unknown>[]
  >;
  context: GetStateProviderContext<StateProvider<BaseStateProviderContext>>;
  job: StateJob;
  pollIntervalMs: number;
}): Promise<() => Promise<void>> => {
  const workerId = randomUUID(); // TODO?

  const firstHeartbeatSent = createSignal<void>();
  const claimTransactionClosed = createSignal<void>();

  const runInGuardedTransaction = async <T>(
    cb: (
      context: GetStateProviderContext<StateProvider<BaseStateProviderContext>>
    ) => Promise<T>
  ): Promise<T> => {
    if (!firstHeartbeatSent.signalled) {
      return cb(context);
    }

    return helper.runInTransaction(async (context) => {
      await helper.refetchJobForUpdate({
        context,
        job,
        allowEmptyWorker: !firstHeartbeatSent.signalled,
        workerId,
      });

      return cb(context);
    });
  };

  const commitHeartbeat = async (leaseMs: number) => {
    await runInGuardedTransaction(async (context) => {
      await helper.commitHeartbeat({
        context,
        job,
        leaseMs,
        workerId,
      });
    });

    firstHeartbeatSent.signalOnce();
    await claimTransactionClosed.onSignal;
  };

  const startProcessing = async (job: StateJob) => {
    try {
      await handler({
        claim: async (claimCallback) => {
          const jobInput = await helper.getJobHandlerInput({
            job,
            context,
          });

          return await claimCallback({
            ...jobInput,
            ...context,
          });
        },
        heartbeat: async ({ leaseMs }) => commitHeartbeat(leaseMs),
        withHeartbeat: async (cb, { intervalMs, leaseMs }) => {
          let commitHeartbeatPromise: Promise<void>;
          let timeout: NodeJS.Timeout;
          const sendHeartbeat = async () => {
            commitHeartbeatPromise = commitHeartbeat(leaseMs);
            await commitHeartbeatPromise;
            timeout = setTimeout(sendHeartbeat, intervalMs);
          };
          await sendHeartbeat();

          return cb().finally(async () => {
            await commitHeartbeatPromise;
            clearTimeout(timeout);
          });
        },
        finalize: async (finalizeCallback) => {
          return runInGuardedTransaction(async (context) => {
            const output = await finalizeCallback({
              enqueueJob: async ({ queueName, input, ...context }) =>
                helper.enqueueJob({
                  queueName,
                  input,
                  context,
                }),
              ...context,
            });

            await helper.finishJob({
              job,
              output,
              context,
            });
          });
        },
      });
    } catch (error) {
      await runInGuardedTransaction(async (context) =>
        helper.handleJobHandlerError({
          job,
          error,
          context,
          pollIntervalMs,
        })
      );
    }
  };

  const processingPromise = startProcessing(job);

  await Promise.any([firstHeartbeatSent.onSignal, processingPromise]);

  return async () => {
    claimTransactionClosed.signalOnce();
    await processingPromise;
  };
};
