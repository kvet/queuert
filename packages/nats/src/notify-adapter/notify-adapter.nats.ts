import type { NatsConnection } from "@nats-io/nats-core";
import { createLatch } from "@queuert/helpers/latch";
import { createSharedListener, type SharedListenerOpen } from "@queuert/helpers/shared-listener";
import type { NotifyAdapter } from "queuert";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

const natsSubjectOpen =
  (nc: NatsConnection, subject: string): SharedListenerOpen =>
  async (dispatch) => {
    const subscription = nc.subscribe(subject, {
      callback: (_error, message) => {
        const payload = decoder.decode(message.data);
        dispatch(payload);
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
}): NotifyAdapter<"async"> => {
  const jobScheduledSubject = `${subjectPrefix}.sched`;
  const chainCompletedSubject = `${subjectPrefix}.chainc`;
  const attemptLostSubject = `${subjectPrefix}.atls`;

  const jobScheduledListener = createSharedListener(natsSubjectOpen(nc, jobScheduledSubject));
  const chainCompletedListener = createSharedListener(natsSubjectOpen(nc, chainCompletedSubject));
  const attemptLostListener = createSharedListener(natsSubjectOpen(nc, attemptLostSubject));

  const closed = createLatch("NotifyAdapter is closed");

  const close = async (): Promise<void> => {
    if (!closed.trip()) return;
    await Promise.all([
      jobScheduledListener.dispose(),
      chainCompletedListener.dispose(),
      attemptLostListener.dispose(),
    ]);
  };

  return {
    notifyJobsScheduled: async (typeNames) => {
      closed.throwIfTripped();
      for (const typeName of typeNames) {
        nc.publish(jobScheduledSubject, encoder.encode(typeName));
      }
      await nc.flush();
    },

    listenJobsScheduled: async (typeNames, onNotification) => {
      closed.throwIfTripped();
      return jobScheduledListener.subscribe(typeNames, (typeName) => {
        onNotification(typeName);
      });
    },

    notifyChainsCompleted: async (chainIds) => {
      closed.throwIfTripped();
      for (const chainId of chainIds) {
        nc.publish(chainCompletedSubject, encoder.encode(chainId));
      }
      await nc.flush();
    },

    listenChainsCompleted: async (chainIds, onNotification) => {
      closed.throwIfTripped();
      return chainCompletedListener.subscribe(chainIds, (chainId) => {
        onNotification(chainId);
      });
    },

    notifyJobAttemptsLost: async (jobIds) => {
      closed.throwIfTripped();
      for (const jobId of jobIds) {
        nc.publish(attemptLostSubject, encoder.encode(jobId));
      }
      await nc.flush();
    },

    listenJobAttemptsLost: async (jobIds, onNotification) => {
      closed.throwIfTripped();
      return attemptLostListener.subscribe(jobIds, (jobId) => {
        onNotification(jobId);
      });
    },

    close,
    [Symbol.asyncDispose]: close,
  };
};
