import type { NotifyAdapter } from "queuert";
import type { Listener, ListenResult } from "queuert/internal";
import type { RedisNotifyProvider } from "../notify-provider/notify-provider.redis.js";

export type CreateRedisNotifyAdapterOptions<TContext> = {
  provider: RedisNotifyProvider<TContext>;
  keyPrefix?: string;
};

const createPubSubListener = async <TContext>(
  provider: RedisNotifyProvider<TContext>,
  channel: string,
): Promise<Listener<void>> => {
  let resolve: ((result: ListenResult<void>) => void) | null = null;
  let disposed = false;
  let unsubscribe: (() => Promise<void>) | null = null;

  const onMessage = (): void => {
    if (resolve) {
      resolve({ received: true, value: undefined as void });
      resolve = null;
    }
  };

  await provider.provideContext("subscribe", async (ctx) => {
    unsubscribe = await provider.subscribe(ctx, channel, onMessage);
  });

  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    if (resolve) {
      resolve({ received: false });
      resolve = null;
    }
    if (unsubscribe) {
      await unsubscribe();
    }
  };

  return {
    wait: async (opts?: { signal?: AbortSignal }): Promise<ListenResult<void>> => {
      if (disposed) {
        return { received: false };
      }

      return new Promise<ListenResult<void>>((res) => {
        if (opts?.signal?.aborted) {
          res({ received: false });
          return;
        }

        resolve = res;

        const onAbort = (): void => {
          if (resolve === res) {
            resolve = null;
            res({ received: false });
          }
        };

        opts?.signal?.addEventListener("abort", onAbort, { once: true });
      });
    },
    dispose,
    [Symbol.asyncDispose]: dispose,
  };
};

export const createRedisNotifyAdapter = async <TContext>({
  provider,
  keyPrefix = "queuert",
}: CreateRedisNotifyAdapterOptions<TContext>): Promise<NotifyAdapter> => {
  return {
    notifyJobScheduled: async (typeName) => {
      await provider.provideContext("command", async (ctx) => {
        const queue = `${keyPrefix}:job-scheduled:${typeName}`;
        await provider.lpush(ctx, queue, "");
      });
    },
    listenJobScheduled: async (typeNames) => {
      const queues = typeNames.map((t) => `${keyPrefix}:job-scheduled:${t}`);
      let resolve: ((result: ListenResult<string>) => void) | null = null;
      let disposed = false;
      let polling = false;

      const startPolling = (): void => {
        if (polling || disposed) return;
        polling = true;

        const pollBrpop = async (): Promise<void> => {
          while (!disposed && resolve) {
            try {
              await provider.provideContext("brpop", async (ctx) => {
                const result = await provider.brpop(ctx, queues, 5000);
                if (result && !disposed && resolve) {
                  const typeName = typeNames[queues.indexOf(result.queue)] ?? result.queue;
                  resolve({ received: true, value: typeName });
                  resolve = null;
                }
              });
            } catch {
              if (!disposed) {
                break;
              }
            }
          }
          polling = false;
        };

        void pollBrpop();
      };

      const dispose = async (): Promise<void> => {
        if (disposed) return;
        disposed = true;
        if (resolve) {
          resolve({ received: false });
          resolve = null;
        }
      };

      return {
        wait: async (opts?: { signal?: AbortSignal }): Promise<ListenResult<string>> => {
          if (disposed) {
            return { received: false };
          }

          return new Promise<ListenResult<string>>((res) => {
            if (opts?.signal?.aborted) {
              res({ received: false });
              return;
            }

            resolve = res;

            const onAbort = (): void => {
              if (resolve === res) {
                resolve = null;
                res({ received: false });
              }
            };

            opts?.signal?.addEventListener("abort", onAbort, { once: true });
            startPolling();
          });
        },
        dispose,
        [Symbol.asyncDispose]: dispose,
      };
    },
    notifyJobSequenceCompleted: async (sequenceId) => {
      await provider.provideContext("command", async (ctx) => {
        await provider.publish(ctx, `${keyPrefix}:sequence-completed:${sequenceId}`, "");
      });
    },
    listenJobSequenceCompleted: async (sequenceId) =>
      createPubSubListener(provider, `${keyPrefix}:sequence-completed:${sequenceId}`),
    notifyJobOwnershipLost: async (jobId) => {
      await provider.provideContext("command", async (ctx) => {
        await provider.publish(ctx, `${keyPrefix}:job-ownership-lost:${jobId}`, "");
      });
    },
    listenJobOwnershipLost: async (jobId) =>
      createPubSubListener(provider, `${keyPrefix}:job-ownership-lost:${jobId}`),
  };
};
