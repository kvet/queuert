import type { NatsConnection } from "@nats-io/nats-core";
import { createSharedListener, type SharedListenerOpen, createLatch } from "@queuert/helpers";
import type { NotifyAdapter } from "queuert";

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
export const createNatsNotifyAdapter = ({
  nc,
  subjectPrefix = "queuert",
}: {
  /** A `NatsConnection` from `@nats-io/nats-core`, e.g. created with `connect` from `@nats-io/transport-node`. */
  nc: NatsConnection;
  /** Prefix for all NATS subject names. @defaultValue `"queuert"` */
  subjectPrefix?: string;
}): NotifyAdapter => {
  const jobScheduledSubject = `${subjectPrefix}.sched`;
  const chainCompletedSubject = `${subjectPrefix}.chainc`;
  const attemptLostSubject = `${subjectPrefix}.atls`;

  const jobScheduledListener = createSharedListener(natsSubjectOpen(nc, jobScheduledSubject));
  const chainCompletedListener = createSharedListener(natsSubjectOpen(nc, chainCompletedSubject));
  const attemptLostListener = createSharedListener(natsSubjectOpen(nc, attemptLostSubject));

  const closed = createLatch("NotifyAdapter is closed");

  return {
    notifyJobsScheduled: async (typeNames) => {
      closed.throwIfTripped();
      for (const typeName of typeNames) {
        nc.publish(jobScheduledSubject, encoder.encode(typeName));
      }
      await nc.flush();
    },

    listenJobScheduled: async (typeNames, onNotification) => {
      closed.throwIfTripped();
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
      closed.throwIfTripped();
      for (const chainId of chainIds) {
        nc.publish(chainCompletedSubject, encoder.encode(chainId));
      }
      await nc.flush();
    },

    listenChainCompleted: async (chainId, onNotification) => {
      closed.throwIfTripped();
      return chainCompletedListener.subscribe(chainId, () => {
        onNotification();
      });
    },

    notifyJobAttemptsLost: async (jobIds) => {
      closed.throwIfTripped();
      for (const jobId of jobIds) {
        nc.publish(attemptLostSubject, encoder.encode(jobId));
      }
      await nc.flush();
    },

    listenJobAttemptLost: async (jobId, onNotification) => {
      closed.throwIfTripped();
      return attemptLostListener.subscribe(jobId, () => {
        onNotification();
      });
    },

    close: async () => {
      if (!closed.trip()) return;
      await Promise.all([
        jobScheduledListener.dispose(),
        chainCompletedListener.dispose(),
        attemptLostListener.dispose(),
      ]);
    },
  };
};
