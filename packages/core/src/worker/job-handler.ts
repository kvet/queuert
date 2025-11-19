import { randomUUID } from "crypto";
import { BaseChainDefinitions } from "../entities/chain.js";
import { FinishedJobChain, JobChain } from "../entities/job-chain.js";
import { EnqueuedJob, Job, RunningJob } from "../entities/job.js";
import { BaseQueueDefinitions } from "../entities/queue.js";
import { Branded } from "../helpers/typescript.js";
import {
  ProcessHelper,
  ResolvedQueueJobs,
  ResolveQueueDefinitions,
} from "../queuert-helper.js";
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
    signalled: resolved,
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
  TChainDefinitions extends BaseChainDefinitions,
  TChainName extends keyof TChainDefinitions,
  TQueueDefinitions extends BaseQueueDefinitions,
  TQueueName extends keyof ResolveQueueDefinitions<
    TChainDefinitions,
    TChainName,
    TQueueDefinitions
  >,
  TDependencies extends readonly JobChain<any, any, any>[]
> = (handlerOptions: {
  claim: <T>(
    claimCallback: (
      claimCallbackOptions: {
        job: RunningJob<
          Job<
            TQueueName,
            ResolveQueueDefinitions<
              TChainDefinitions,
              TChainName,
              TQueueDefinitions
            >[TQueueName]["input"]
          >
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
          TEnqueueQueueName extends keyof ResolveQueueDefinitions<
            TChainDefinitions,
            TChainName,
            TQueueDefinitions
          >
        >(
          options: {
            queueName: TEnqueueQueueName;
            input: ResolveQueueDefinitions<
              TChainDefinitions,
              TChainName,
              TQueueDefinitions
            >[TEnqueueQueueName]["input"];
          } & GetStateProviderContext<TStateProvider>
        ) => Promise<
          EnqueuedJob<
            TEnqueueQueueName,
            ResolveQueueDefinitions<
              TChainDefinitions,
              TChainName,
              TQueueDefinitions
            >[TEnqueueQueueName]["input"]
          >
        >;
      } & GetStateProviderContext<TStateProvider>
    ) => Promise<
      | TChainDefinitions[TChainName]["output"]
      | ResolvedQueueJobs<TChainDefinitions, TChainName, TQueueDefinitions>
    >
  ) => Promise<
    Branded<
      | TChainDefinitions[TChainName]["output"]
      | ResolvedQueueJobs<TChainDefinitions, TChainName, TQueueDefinitions>,
      "finalize_result"
    >
  >;
}) => Promise<
  Branded<
    | TChainDefinitions[TChainName]["output"]
    | ResolvedQueueJobs<TChainDefinitions, TChainName, TQueueDefinitions>,
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
    BaseChainDefinitions,
    string,
    BaseQueueDefinitions,
    string,
    readonly JobChain<string, unknown, unknown>[]
  >;
  context: GetStateProviderContext<StateProvider<BaseStateProviderContext>>;
  job: StateJob;
  pollIntervalMs: number;
}): Promise<{ execute: Promise<void> }> => {
  const workerId = randomUUID(); // TODO?

  const firstHeartbeat = createSignal<void>();

  const runInTransaction = async <T>(
    cb: (
      context: GetStateProviderContext<StateProvider<BaseStateProviderContext>>
    ) => Promise<T>
  ): Promise<T> => {
    if (!firstHeartbeat.signalled) {
      return cb(context);
    }

    return helper.runInTransaction(cb);
  };

  const commitHeartbeat = async (leaseMs: number) => {
    await runInTransaction(async (context) => {
      await helper.commitHeartbeat({
        context,
        job,
        leaseMs,
        allowEmptyWorker: !firstHeartbeat.signalled,
        workerId,
      });
    });

    firstHeartbeat.signalOnce();
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
          return runInTransaction(async (context) => {
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
      await runInTransaction(async (context) =>
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

  await Promise.any([firstHeartbeat.onSignal, processingPromise]);

  return {
    execute: processingPromise,
  };
};
