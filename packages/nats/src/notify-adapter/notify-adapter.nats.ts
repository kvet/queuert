import { createSharedListener, type SharedListenerOpen } from "@queuert/helpers";
import { type NatsConnection } from "nats";
import { type NotifyAdapter } from "queuert";

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

/**
 * Create a notify adapter backed by NATS.
 *
 * @param options - NATS notify adapter configuration.
 * @experimental
 */
export const createNatsNotifyAdapter = async ({
  nc,
  subjectPrefix = "queuert",
}: {
  /** The NATS connection. */
  nc: NatsConnection;
  /** Prefix for all NATS subject names. @defaultValue `"queuert"` */
  subjectPrefix?: string;
}): Promise<NotifyAdapter> => {
  const jobScheduledSubject = `${subjectPrefix}.sched`;
  const chainCompletedSubject = `${subjectPrefix}.chainc`;
  const attemptLostSubject = `${subjectPrefix}.atls`;

  const jobScheduledListener = createSharedListener(natsSubjectOpen(nc, jobScheduledSubject));
  const chainCompletedListener = createSharedListener(natsSubjectOpen(nc, chainCompletedSubject));
  const attemptLostListener = createSharedListener(natsSubjectOpen(nc, attemptLostSubject));

  let closed = false;
  const assertOpen = (): void => {
    if (closed) throw new Error("NotifyAdapter is closed");
  };

  return {
    notifyJobsScheduled: async (typeNames) => {
      assertOpen();
      for (const typeName of typeNames) {
        nc.publish(jobScheduledSubject, encoder.encode(typeName));
      }
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

    notifyChainsCompleted: async (chainIds) => {
      assertOpen();
      for (const chainId of chainIds) {
        nc.publish(chainCompletedSubject, encoder.encode(chainId));
      }
      await nc.flush();
    },

    listenChainCompleted: async (chainId, onNotification) => {
      assertOpen();
      return chainCompletedListener.subscribe(chainId, () => {
        onNotification();
      });
    },

    notifyJobAttemptsLost: async (jobIds) => {
      assertOpen();
      for (const jobId of jobIds) {
        nc.publish(attemptLostSubject, encoder.encode(jobId));
      }
      await nc.flush();
    },

    listenJobAttemptLost: async (jobId, onNotification) => {
      assertOpen();
      return attemptLostListener.subscribe(jobId, () => {
        onNotification();
      });
    },

    close: async () => {
      if (closed) return;
      closed = true;
      await Promise.all([
        jobScheduledListener.dispose(),
        chainCompletedListener.dispose(),
        attemptLostListener.dispose(),
      ]);
    },
  };
};
