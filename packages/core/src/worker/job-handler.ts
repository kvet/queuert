import { randomUUID } from "crypto";
import {
  BaseDbProviderContext,
  GetDbProviderContext,
  QueuertDbProvider,
} from "../db-provider/db-provider.js";
import { BaseChainDefinitions } from "../entities/chain.js";
import { EnqueuedJob, Job, RunningJob } from "../entities/job.js";
import { FinishedJobChain, JobChain } from "../entities/job_chain.js";
import { BaseQueueDefinitions } from "../entities/queue.js";
import { Branded } from "../helpers/typescript.js";
import {
  ProcessHelper,
  ResolvedQueueJobs,
  ResolveQueueDefinitions,
} from "../process-helper.js";
import { DbJob } from "../sql.js";

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
  TDbProvider extends QueuertDbProvider<BaseDbProviderContext>,
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
      } & GetDbProviderContext<TDbProvider>
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
          } & GetDbProviderContext<TDbProvider>
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
      } & GetDbProviderContext<TDbProvider>
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
    QueuertDbProvider<BaseDbProviderContext>,
    BaseChainDefinitions,
    string,
    BaseQueueDefinitions,
    string,
    readonly JobChain<string, unknown, unknown>[]
  >;
  context: GetDbProviderContext<QueuertDbProvider<BaseDbProviderContext>>;
  job: DbJob;
  pollIntervalMs: number;
}): Promise<{ execute: Promise<void> }> => {
  const workerId = randomUUID(); // TODO?

  const firstHeartbeat = createSignal<void>();

  const runInTransaction = async <T>(
    cb: (
      context: GetDbProviderContext<QueuertDbProvider<BaseDbProviderContext>>
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

  const startProcessing = async (job: DbJob) => {
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
