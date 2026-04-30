import { type KV, type NatsConnection } from "nats";
import { type NotifyAdapter } from "queuert";
import { createSharedListener, type SharedListenerOpen } from "queuert/internal";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

const natsSubjectOpen =
  (nc: NatsConnection, subject: string): SharedListenerOpen =>
  async (dispatch) => {
    const subscription = nc.subscribe(subject, {
      callback: (_error, message) => {
        const payload = decoder.decode(message.data);
        dispatch(payload, payload);
      },
    });
    return async () => {
      subscription.unsubscribe();
    };
  };

const tryAddToHint = async (kv: KV, key: string, count: number): Promise<void> => {
  const maxRetries = 5;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const entry = await kv.get(key);
    if (!entry) {
      try {
        await kv.create(key, encoder.encode(String(count)));
        return;
      } catch (err) {
        if (err instanceof Error && err.message.includes("wrong last sequence")) continue;
        throw err;
      }
    }
    const current = parseInt(decoder.decode(entry.value), 10) || 0;
    try {
      await kv.update(key, encoder.encode(String(current + count)), entry.revision);
      return;
    } catch (err) {
      if (err instanceof Error && err.message.includes("wrong last sequence")) continue;
      throw err;
    }
  }
};

const tryDecrementHint = async (kv: KV, key: string): Promise<boolean> => {
  const maxRetries = 5;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const entry = await kv.get(key);
    if (!entry) return true;

    const current = parseInt(decoder.decode(entry.value), 10);
    if (current <= 0) return false;

    try {
      await kv.update(key, encoder.encode(String(current - 1)), entry.revision);
      return true;
    } catch (err) {
      if (err instanceof Error && err.message.includes("wrong last sequence")) continue;
      throw err;
    }
  }
  return false;
};

/**
 * Create a notify adapter backed by NATS.
 *
 * When `kv` is provided, `provideWakeHint`/`consumeWakeHint` use a JetStream
 * KV bucket for atomic CAS-based wake-fan-out gating. When `kv` is omitted,
 * the hint methods are no-ops and every listener wakes on every notification.
 *
 * @experimental
 */
export const createNatsNotifyAdapter = async ({
  nc,
  kv,
  subjectPrefix = "queuert",
}: {
  nc: NatsConnection;
  kv?: KV;
  subjectPrefix?: string;
}): Promise<NotifyAdapter> => {
  const jobScheduledSubject = `${subjectPrefix}.sched`;
  const chainCompletedSubject = `${subjectPrefix}.chainc`;
  const ownershipLostSubject = `${subjectPrefix}.owls`;
  const hintKeyPrefix = `${subjectPrefix}_hint_`;

  const jobScheduledListener = createSharedListener(natsSubjectOpen(nc, jobScheduledSubject));
  const chainCompletedListener = createSharedListener(natsSubjectOpen(nc, chainCompletedSubject));
  const ownershipLostListener = createSharedListener(natsSubjectOpen(nc, ownershipLostSubject));

  let closed = false;
  const assertOpen = (): void => {
    if (closed) throw new Error("NotifyAdapter is closed");
  };

  return {
    notifyJobScheduled: async (typeName) => {
      assertOpen();
      nc.publish(jobScheduledSubject, encoder.encode(typeName));
      await nc.flush();
    },

    listenJobScheduled: async (typeNames, onNotification) => {
      assertOpen();
      const unsubs = await Promise.all(
        typeNames.map(async (typeName) =>
          jobScheduledListener.subscribe(typeName, () => {
            onNotification(typeName);
          }),
        ),
      );
      return async () => {
        await Promise.all(unsubs.map(async (u) => u()));
      };
    },

    provideWakeHint: async (typeName, count) => {
      assertOpen();
      if (!kv) return;
      await tryAddToHint(kv, `${hintKeyPrefix}${typeName}`, count);
    },

    consumeWakeHint: async (typeName) => {
      assertOpen();
      if (!kv) return true;
      return tryDecrementHint(kv, `${hintKeyPrefix}${typeName}`);
    },

    notifyChainCompleted: async (chainId) => {
      assertOpen();
      nc.publish(chainCompletedSubject, encoder.encode(chainId));
      await nc.flush();
    },

    listenChainCompleted: async (chainId, onNotification) => {
      assertOpen();
      return chainCompletedListener.subscribe(chainId, () => {
        onNotification();
      });
    },

    notifyJobOwnershipLost: async (jobId) => {
      assertOpen();
      nc.publish(ownershipLostSubject, encoder.encode(jobId));
      await nc.flush();
    },

    listenJobOwnershipLost: async (jobId, onNotification) => {
      assertOpen();
      return ownershipLostListener.subscribe(jobId, () => {
        onNotification();
      });
    },

    close: async () => {
      if (closed) return;
      closed = true;
      await Promise.all([
        jobScheduledListener.dispose(),
        chainCompletedListener.dispose(),
        ownershipLostListener.dispose(),
      ]);
    },
  };
};
