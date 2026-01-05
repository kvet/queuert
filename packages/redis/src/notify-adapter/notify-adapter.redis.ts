import type { NotifyAdapter } from "queuert";
import type { Listener, ListenResult } from "queuert/internal";
import type { RedisNotifyProvider } from "../notify-provider/notify-provider.redis.js";
import { DECR_IF_POSITIVE_SCRIPT, SET_AND_PUBLISH_SCRIPT } from "./lua.js";

export type CreateRedisNotifyAdapterOptions<TContext> = {
  provider: RedisNotifyProvider<TContext>;
  keyPrefix?: string;
};

const createPubSubListener = async <TContext, TValue>(
  provider: RedisNotifyProvider<TContext>,
  channels: string[],
  parseValue: (channel: string) => TValue,
): Promise<Listener<TValue>> => {
  let resolve: ((result: ListenResult<TValue>) => void) | null = null;
  let disposed = false;
  const unsubscribes: Array<() => Promise<void>> = [];

  const onMessage = (channel: string): void => {
    if (resolve) {
      resolve({ received: true, value: parseValue(channel) });
      resolve = null;
    }
  };

  await provider.provideContext("subscribe", async (ctx) => {
    for (const channel of channels) {
      const unsubscribe = await provider.subscribe(ctx, channel, () => {
        onMessage(channel);
      });
      unsubscribes.push(unsubscribe);
    }
  });

  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    if (resolve) {
      resolve({ received: false });
      resolve = null;
    }
    for (const unsubscribe of unsubscribes) {
      await unsubscribe();
    }
  };

  return {
    wait: async (opts?: { signal?: AbortSignal }): Promise<ListenResult<TValue>> => {
      if (disposed) {
        return { received: false };
      }

      return new Promise<ListenResult<TValue>>((res) => {
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
  };
};

const createJobScheduledListener = async <TContext>(
  provider: RedisNotifyProvider<TContext>,
  channels: string[],
  hintKeyPrefix: string,
  jobScheduledPrefix: string,
): Promise<Listener<string>> => {
  let resolve: ((result: ListenResult<string>) => void) | null = null;
  let disposed = false;
  const unsubscribes: Array<() => Promise<void>> = [];

  const onMessage = async (channel: string, hintId: string): Promise<void> => {
    if (!resolve || disposed) return;

    const hintKey = `${hintKeyPrefix}${hintId}`;
    const success = await provider.provideContext("command", async (ctx) => {
      const result = await provider.eval(ctx, DECR_IF_POSITIVE_SCRIPT, [hintKey], []);
      return result === 1;
    });

    if (success && resolve && !disposed) {
      const typeName = channel.slice(jobScheduledPrefix.length);
      resolve({ received: true, value: typeName });
      resolve = null;
    }
  };

  await provider.provideContext("subscribe", async (ctx) => {
    for (const channel of channels) {
      const unsubscribe = await provider.subscribe(ctx, channel, (message) => {
        void onMessage(channel, message);
      });
      unsubscribes.push(unsubscribe);
    }
  });

  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    if (resolve) {
      resolve({ received: false });
      resolve = null;
    }
    for (const unsubscribe of unsubscribes) {
      await unsubscribe();
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
      });
    },
    dispose,
  };
};

export const createRedisNotifyAdapter = async <TContext>({
  provider,
  keyPrefix = "queuert",
}: CreateRedisNotifyAdapterOptions<TContext>): Promise<NotifyAdapter> => {
  const jobScheduledPrefix = `${keyPrefix}:job-scheduled:`;
  const hintKeyPrefix = `${keyPrefix}:job-hint:`;

  return {
    notifyJobScheduled: async (typeName, count) => {
      const hintId = crypto.randomUUID();
      const hintKey = `${hintKeyPrefix}${hintId}`;
      const channel = `${jobScheduledPrefix}${typeName}`;

      await provider.provideContext("command", async (ctx) => {
        await provider.eval(
          ctx,
          SET_AND_PUBLISH_SCRIPT,
          [hintKey, channel],
          [String(count), hintId],
        );
      });
    },
    listenJobScheduled: async (typeNames) => {
      const channels = typeNames.map((t) => `${jobScheduledPrefix}${t}`);
      return createJobScheduledListener(provider, channels, hintKeyPrefix, jobScheduledPrefix);
    },
    notifyJobSequenceCompleted: async (sequenceId) => {
      await provider.provideContext("command", async (ctx) => {
        await provider.publish(ctx, `${keyPrefix}:sequence-completed:${sequenceId}`, "");
      });
    },
    listenJobSequenceCompleted: async (sequenceId) =>
      createPubSubListener(
        provider,
        [`${keyPrefix}:sequence-completed:${sequenceId}`],
        () => undefined as void,
      ),
    notifyJobOwnershipLost: async (jobId) => {
      await provider.provideContext("command", async (ctx) => {
        await provider.publish(ctx, `${keyPrefix}:job-ownership-lost:${jobId}`, "");
      });
    },
    listenJobOwnershipLost: async (jobId) =>
      createPubSubListener(
        provider,
        [`${keyPrefix}:job-ownership-lost:${jobId}`],
        () => undefined as void,
      ),
  };
};
