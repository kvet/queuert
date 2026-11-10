import { raceWithSleep, sleep } from "@queuert/helpers";

import type { NotifyAdapter } from "../notify-adapter/notify-adapter.ts";
import type { ConformanceGroup } from "./runner.ts";

/**
 * The context the notify adapter conformance cases run against. Create it once, before the cases.
 * Each case creates the adapters it needs from it, and they are closed when the case ends.
 */
export type NotifyAdapterConformanceContext = {
  /**
   * Creates a notify adapter. The adapters a case creates are closed when it ends, so closing one
   * must not release resources the next one needs.
   */
  createNotifyAdapter: () => Promise<NotifyAdapter>;
};

const NEGATIVE_ASSERTION_DELAY_MS = 200;
const DELIVERY_TIMEOUT_MS = 2000;

/**
 * Wait for `promise` to resolve or reject within `DELIVERY_TIMEOUT_MS`.
 * Throws with `label` on timeout. Timer is cleaned up via `raceWithSleep`.
 */
const waitFor = async <T>(promise: Promise<T>, label: string): Promise<T> => {
  let captured: { value: T } | undefined;
  await raceWithSleep(
    promise.then((v) => {
      captured = { value: v };
    }),
    DELIVERY_TIMEOUT_MS,
  );
  if (!captured) {
    throw new Error(`timeout waiting for ${label} after ${DELIVERY_TIMEOUT_MS}ms`);
  }
  return captured.value;
};

export const notifyAdapterBaseGroups: ConformanceGroup<NotifyAdapterConformanceContext>[] = [
  {
    name: "notifyJobsScheduled / listenJobScheduled",
    cases: [
      {
        name: "listener receives a notification for each type name in the batch",
        run: async ({ createNotifyAdapter }, expect) => {
          await using notifyAdapter = await createNotifyAdapter();

          const received: string[] = [];
          const unsubscribe = await notifyAdapter.listenJobScheduled(
            ["type-a", "type-b", "type-c"],
            (typeName) => {
              received.push(typeName);
            },
          );

          await notifyAdapter.notifyJobsScheduled(["type-a", "type-b", "type-c"]);

          await expect
            .poll(() => [...received].sort(), { timeout: DELIVERY_TIMEOUT_MS })
            .toEqual(["type-a", "type-b", "type-c"]);
          await unsubscribe();
        },
      },
      {
        name: "multiple notifications all reach the listener",
        run: async ({ createNotifyAdapter }, expect) => {
          await using notifyAdapter = await createNotifyAdapter();

          let count = 0;
          const unsubscribe = await notifyAdapter.listenJobScheduled(["type-a"], () => {
            count++;
          });

          await notifyAdapter.notifyJobsScheduled(["type-a"]);
          await notifyAdapter.notifyJobsScheduled(["type-a"]);
          await notifyAdapter.notifyJobsScheduled(["type-a"]);

          await expect.poll(() => count, { timeout: DELIVERY_TIMEOUT_MS }).toBe(3);
          await unsubscribe();
        },
      },
      {
        name: "listener does not receive notification for non-matching type name",
        run: async ({ createNotifyAdapter }, expect) => {
          await using notifyAdapter = await createNotifyAdapter();

          let callCount = 0;
          const unsubscribe = await notifyAdapter.listenJobScheduled(["type-a"], () => {
            callCount++;
          });

          await notifyAdapter.notifyJobsScheduled(["type-b"]);
          await sleep(NEGATIVE_ASSERTION_DELAY_MS);

          expect(callCount).toBe(0);
          await unsubscribe();
        },
      },
      {
        name: "multi-type listener receives matching types",
        run: async ({ createNotifyAdapter }, expect) => {
          await using notifyAdapter = await createNotifyAdapter();

          const received = Promise.withResolvers<string>();
          const unsubscribe = await notifyAdapter.listenJobScheduled(
            ["type-a", "type-b"],
            (typeName) => {
              received.resolve(typeName);
            },
          );

          await notifyAdapter.notifyJobsScheduled(["type-b"]);

          const result = await waitFor(received.promise, "notification");

          expect(result).toBe("type-b");
          await unsubscribe();
        },
      },
      {
        name: "every listener for a type receives each notification",
        run: async ({ createNotifyAdapter }) => {
          await using notifyAdapter = await createNotifyAdapter();

          const received1 = Promise.withResolvers<void>();
          const received2 = Promise.withResolvers<void>();

          const unsubscribe1 = await notifyAdapter.listenJobScheduled(["type-multi"], () => {
            received1.resolve();
          });
          const unsubscribe2 = await notifyAdapter.listenJobScheduled(["type-multi"], () => {
            received2.resolve();
          });

          await notifyAdapter.notifyJobsScheduled(["type-multi"]);

          await waitFor(Promise.all([received1.promise, received2.promise]), "notifications");

          await unsubscribe1();
          await unsubscribe2();
        },
      },
      {
        name: "unsubscribe stops job scheduled notifications",
        run: async ({ createNotifyAdapter }, expect) => {
          await using notifyAdapter = await createNotifyAdapter();

          let callCount = 0;
          const unsubscribe = await notifyAdapter.listenJobScheduled(["type-a"], () => {
            callCount++;
          });

          await unsubscribe();
          await notifyAdapter.notifyJobsScheduled(["type-a"]);
          await sleep(NEGATIVE_ASSERTION_DELAY_MS);

          expect(callCount).toBe(0);
        },
      },
      {
        name: "publish without listeners does not error",
        run: async ({ createNotifyAdapter }) => {
          await using notifyAdapter = await createNotifyAdapter();

          await notifyAdapter.notifyJobsScheduled(["unheard-type"]);
          await notifyAdapter.notifyChainsCompleted(["unheard-chain"]);
          await notifyAdapter.notifyJobAttemptsLost(["unheard-job"]);
        },
      },
    ],
  },
  {
    name: "notifyChainsCompleted / listenChainCompleted",
    cases: [
      {
        name: "listener receives chain completion for each chain ID in the batch",
        run: async ({ createNotifyAdapter }, expect) => {
          await using notifyAdapter = await createNotifyAdapter();

          const chainIds = ["chain-1", "chain-2", "chain-3"];
          const received: string[] = [];
          const unsubscribes = await Promise.all(
            chainIds.map(async (chainId) =>
              notifyAdapter.listenChainCompleted(chainId, () => {
                received.push(chainId);
              }),
            ),
          );

          await notifyAdapter.notifyChainsCompleted(chainIds);

          await expect
            .poll(() => [...received].sort(), { timeout: DELIVERY_TIMEOUT_MS })
            .toEqual(chainIds);
          await Promise.all(unsubscribes.map(async (unsubscribe) => unsubscribe()));
        },
      },
      {
        name: "listener does not receive chain completion for different chain ID",
        run: async ({ createNotifyAdapter }, expect) => {
          await using notifyAdapter = await createNotifyAdapter();

          let callCount = 0;
          const unsubscribe = await notifyAdapter.listenChainCompleted("chain-123", () => {
            callCount++;
          });

          await notifyAdapter.notifyChainsCompleted(["chain-456"]);
          await sleep(NEGATIVE_ASSERTION_DELAY_MS);

          expect(callCount).toBe(0);
          await unsubscribe();
        },
      },
      {
        name: "multiple listeners for same chain ID both receive notification",
        run: async ({ createNotifyAdapter }) => {
          await using notifyAdapter = await createNotifyAdapter();

          const received1 = Promise.withResolvers<void>();
          const received2 = Promise.withResolvers<void>();

          const unsubscribe1 = await notifyAdapter.listenChainCompleted("chain-multi", () => {
            received1.resolve();
          });
          const unsubscribe2 = await notifyAdapter.listenChainCompleted("chain-multi", () => {
            received2.resolve();
          });

          await notifyAdapter.notifyChainsCompleted(["chain-multi"]);

          await waitFor(Promise.all([received1.promise, received2.promise]), "notifications");

          await unsubscribe1();
          await unsubscribe2();
        },
      },
      {
        name: "unsubscribe stops chain completion notifications",
        run: async ({ createNotifyAdapter }, expect) => {
          await using notifyAdapter = await createNotifyAdapter();

          let callCount = 0;
          const unsubscribe = await notifyAdapter.listenChainCompleted("chain-unsubscribe", () => {
            callCount++;
          });

          await unsubscribe();
          await notifyAdapter.notifyChainsCompleted(["chain-unsubscribe"]);
          await sleep(NEGATIVE_ASSERTION_DELAY_MS);

          expect(callCount).toBe(0);
        },
      },
    ],
  },
  {
    name: "notifyJobAttemptsLost / listenJobAttemptLost",
    cases: [
      {
        name: "listener receives attempt lost for each job ID in the batch",
        run: async ({ createNotifyAdapter }, expect) => {
          await using notifyAdapter = await createNotifyAdapter();

          const jobIds = ["job-1", "job-2", "job-3"];
          const received: string[] = [];
          const unsubscribes = await Promise.all(
            jobIds.map(async (jobId) =>
              notifyAdapter.listenJobAttemptLost(jobId, () => {
                received.push(jobId);
              }),
            ),
          );

          await notifyAdapter.notifyJobAttemptsLost(jobIds);

          await expect
            .poll(() => [...received].sort(), { timeout: DELIVERY_TIMEOUT_MS })
            .toEqual(jobIds);
          await Promise.all(unsubscribes.map(async (unsubscribe) => unsubscribe()));
        },
      },
      {
        name: "listener does not receive attempt lost for different job ID",
        run: async ({ createNotifyAdapter }, expect) => {
          await using notifyAdapter = await createNotifyAdapter();

          let callCount = 0;
          const unsubscribe = await notifyAdapter.listenJobAttemptLost("job-123", () => {
            callCount++;
          });

          await notifyAdapter.notifyJobAttemptsLost(["job-456"]);
          await sleep(NEGATIVE_ASSERTION_DELAY_MS);

          expect(callCount).toBe(0);
          await unsubscribe();
        },
      },
      {
        name: "multiple listeners for same job ID both receive attempt lost",
        run: async ({ createNotifyAdapter }) => {
          await using notifyAdapter = await createNotifyAdapter();

          const received1 = Promise.withResolvers<void>();
          const received2 = Promise.withResolvers<void>();

          const unsubscribe1 = await notifyAdapter.listenJobAttemptLost("job-multi", () => {
            received1.resolve();
          });
          const unsubscribe2 = await notifyAdapter.listenJobAttemptLost("job-multi", () => {
            received2.resolve();
          });

          await notifyAdapter.notifyJobAttemptsLost(["job-multi"]);

          await waitFor(Promise.all([received1.promise, received2.promise]), "notifications");

          await unsubscribe1();
          await unsubscribe2();
        },
      },
      {
        name: "unsubscribe stops attempt lost notifications",
        run: async ({ createNotifyAdapter }, expect) => {
          await using notifyAdapter = await createNotifyAdapter();

          let callCount = 0;
          const unsubscribe = await notifyAdapter.listenJobAttemptLost("job-unsubscribe", () => {
            callCount++;
          });

          await unsubscribe();
          await notifyAdapter.notifyJobAttemptsLost(["job-unsubscribe"]);
          await sleep(NEGATIVE_ASSERTION_DELAY_MS);

          expect(callCount).toBe(0);
        },
      },
    ],
  },
  {
    name: "delivery timeliness",
    cases: [
      {
        name: "notifications dispatch during publish loop, not batched at end",
        run: async ({ createNotifyAdapter }, expect) => {
          await using notifyAdapter = await createNotifyAdapter();

          const count = 50;
          const half = count / 2;
          let received = 0;
          const chainIds = Array.from({ length: count }, (_, i) => `chain-flush-${i}`);

          const unsubscribes = await Promise.all(
            chainIds.map(async (id) =>
              notifyAdapter.listenChainCompleted(id, () => {
                received++;
              }),
            ),
          );

          for (let i = 0; i < half; i++) {
            await notifyAdapter.notifyChainsCompleted([chainIds[i]]);
          }
          // Let fire-and-forget transports drain already-published messages.
          // A batch-at-end impl would show 0 here; an incremental impl makes progress.
          await sleep(100);
          const receivedMidLoop = received;

          for (let i = half; i < count; i++) {
            await notifyAdapter.notifyChainsCompleted([chainIds[i]]);
          }

          await expect.poll(() => received, { timeout: 2000 }).toBe(count);
          expect(receivedMidLoop).toBeGreaterThan(0);

          await Promise.all(unsubscribes.map(async (u) => u()));
        },
      },
    ],
  },
  {
    name: "cross-cutting behavior",
    cases: [
      {
        name: "a notification reaches only the listeners of its own kind",
        run: async ({ createNotifyAdapter }, expect) => {
          await using notifyAdapter = await createNotifyAdapter();

          const sharedId = "shared-id";
          const received: string[] = [];
          const unsubscribeScheduled = await notifyAdapter.listenJobScheduled([sharedId], () => {
            received.push("scheduled");
          });
          const unsubscribeCompleted = await notifyAdapter.listenChainCompleted(sharedId, () => {
            received.push("completed");
          });
          const unsubscribeLost = await notifyAdapter.listenJobAttemptLost(sharedId, () => {
            received.push("lost");
          });

          await notifyAdapter.notifyJobsScheduled([sharedId]);
          await expect
            .poll(() => received, { timeout: DELIVERY_TIMEOUT_MS })
            .toEqual(["scheduled"]);
          await notifyAdapter.notifyChainsCompleted([sharedId]);
          await expect
            .poll(() => received, { timeout: DELIVERY_TIMEOUT_MS })
            .toEqual(["scheduled", "completed"]);
          await notifyAdapter.notifyJobAttemptsLost([sharedId]);
          await expect
            .poll(() => received, { timeout: DELIVERY_TIMEOUT_MS })
            .toEqual(["scheduled", "completed", "lost"]);
          await sleep(NEGATIVE_ASSERTION_DELAY_MS);
          expect(received).toEqual(["scheduled", "completed", "lost"]);

          await unsubscribeScheduled();
          await unsubscribeCompleted();
          await unsubscribeLost();
        },
      },
      {
        name: "listen methods return async unsubscribe functions",
        run: async ({ createNotifyAdapter }, expect) => {
          await using notifyAdapter = await createNotifyAdapter();

          const unsubscribe1 = await notifyAdapter.listenJobScheduled(["type-a"], () => {});
          const unsubscribe2 = await notifyAdapter.listenChainCompleted("chain-1", () => {});
          const unsubscribe3 = await notifyAdapter.listenJobAttemptLost("job-1", () => {});

          expect(typeof unsubscribe1).toBe("function");
          expect(typeof unsubscribe2).toBe("function");
          expect(typeof unsubscribe3).toBe("function");

          const result1 = unsubscribe1();
          const result2 = unsubscribe2();
          const result3 = unsubscribe3();

          expect(result1).toBeInstanceOf(Promise);
          expect(result2).toBeInstanceOf(Promise);
          expect(result3).toBeInstanceOf(Promise);

          await result1;
          await result2;
          await result3;
        },
      },
      {
        name: "can resubscribe after unsubscribe",
        run: async ({ createNotifyAdapter }, expect) => {
          await using notifyAdapter = await createNotifyAdapter();

          const unsubscribe1 = await notifyAdapter.listenJobScheduled(["type-a"], () => {});
          await unsubscribe1();

          const received = Promise.withResolvers<string>();
          const unsubscribe2 = await notifyAdapter.listenJobScheduled(["type-a"], (typeName) => {
            received.resolve(typeName);
          });

          await notifyAdapter.notifyJobsScheduled(["type-a"]);

          const result = await waitFor(received.promise, "notification");

          expect(result).toBe("type-a");
          await unsubscribe2();
        },
      },
      {
        name: "unsubscribe one of two listeners, remaining still receives",
        run: async ({ createNotifyAdapter }, expect) => {
          await using notifyAdapter = await createNotifyAdapter();

          let count1 = 0;
          const received2 = Promise.withResolvers<void>();

          const unsubscribe1 = await notifyAdapter.listenChainCompleted("chain-partial", () => {
            count1++;
          });
          const unsubscribe2 = await notifyAdapter.listenChainCompleted("chain-partial", () => {
            received2.resolve();
          });

          await unsubscribe1();

          await notifyAdapter.notifyChainsCompleted(["chain-partial"]);

          await waitFor(received2.promise, "notification");

          expect(count1).toBe(0);
          await unsubscribe2();
        },
      },
    ],
  },
  {
    name: "listener fault isolation",
    cases: [
      {
        name: "throwing callback does not break peer callback or surface to publisher",
        run: async ({ createNotifyAdapter }) => {
          await using notifyAdapter = await createNotifyAdapter();

          const peerCalled = Promise.withResolvers<void>();
          const unsubBad = await notifyAdapter.listenChainCompleted("chain-throw", () => {
            throw new Error("bad listener");
          });
          const unsubGood = await notifyAdapter.listenChainCompleted("chain-throw", () => {
            peerCalled.resolve();
          });

          await notifyAdapter.notifyChainsCompleted(["chain-throw"]);
          await waitFor(peerCalled.promise, "peer notification");

          await unsubBad();
          await unsubGood();
        },
      },
    ],
  },
  {
    name: "no unhandled rejections",
    cases: [
      {
        name: "normal subscribe/notify/unsubscribe cycle does not produce unhandled rejections",
        run: async ({ createNotifyAdapter }, expect) => {
          await using notifyAdapter = await createNotifyAdapter();

          const unhandled: unknown[] = [];
          const handler = (reason: unknown): void => {
            unhandled.push(reason);
          };
          process.on("unhandledRejection", handler);
          try {
            const u1 = await notifyAdapter.listenJobScheduled(["type-a"], () => {});
            const u2 = await notifyAdapter.listenChainCompleted("chain-1", () => {});
            const u3 = await notifyAdapter.listenJobAttemptLost("job-1", () => {});

            await notifyAdapter.notifyJobsScheduled(["type-a"]);
            await notifyAdapter.notifyChainsCompleted(["chain-1"]);
            await notifyAdapter.notifyJobAttemptsLost(["job-1"]);

            await sleep(NEGATIVE_ASSERTION_DELAY_MS);

            await u1();
            await u2();
            await u3();

            await sleep(NEGATIVE_ASSERTION_DELAY_MS);

            expect(unhandled).toEqual([]);
          } finally {
            process.off("unhandledRejection", handler);
          }
        },
      },
    ],
  },
  {
    name: "close",
    cases: [
      {
        name: "close is idempotent, rejects subsequent calls, and previously returned unsubscribes remain safe",
        run: async ({ createNotifyAdapter }, expect) => {
          await using notifyAdapter = await createNotifyAdapter();

          const unsubscribe = await notifyAdapter.listenChainCompleted("chain-1", () => {});

          await notifyAdapter.close();
          await notifyAdapter.close();

          await unsubscribe();

          await expect(notifyAdapter.notifyJobsScheduled(["type-a"])).rejects.toThrow();
          await expect(notifyAdapter.listenJobScheduled(["type-a"], () => {})).rejects.toThrow();
          await expect(notifyAdapter.notifyChainsCompleted(["chain-1"])).rejects.toThrow();
          await expect(notifyAdapter.listenChainCompleted("chain-1", () => {})).rejects.toThrow();
          await expect(notifyAdapter.notifyJobAttemptsLost(["job-1"])).rejects.toThrow();
          await expect(notifyAdapter.listenJobAttemptLost("job-1", () => {})).rejects.toThrow();
        },
      },
    ],
  },
];
