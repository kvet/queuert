import { raceWithSleep, sleep } from "../helpers/sleep.js";
import { type NotifyAdapter } from "../notify-adapter/notify-adapter.js";
import { type ConformanceGroup } from "./runner.js";

export type NotifyAdapterConformanceContext = {
  notifyAdapter: NotifyAdapter;
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

export const notifyAdapterConformanceGroups: ConformanceGroup<NotifyAdapterConformanceContext>[] = [
  {
    name: "notifyJobScheduled / listenJobScheduled",
    cases: [
      {
        name: "listener receives notification for matching type name",
        run: async ({ notifyAdapter }, expect) => {
          const received = Promise.withResolvers<string>();
          const unsubscribe = await notifyAdapter.listenJobScheduled(["type-a"], (typeName) => {
            received.resolve(typeName);
          });

          await notifyAdapter.notifyJobScheduled("type-a");

          const result = await waitFor(received.promise, "notification");

          expect(result).toBe("type-a");
          await unsubscribe();
        },
      },
      {
        name: "multiple notifications all reach the listener",
        run: async ({ notifyAdapter }, expect) => {
          let count = 0;
          const unsubscribe = await notifyAdapter.listenJobScheduled(["type-a"], () => {
            count++;
          });

          await notifyAdapter.notifyJobScheduled("type-a");
          await notifyAdapter.notifyJobScheduled("type-a");
          await notifyAdapter.notifyJobScheduled("type-a");

          await expect.poll(() => count, { timeout: DELIVERY_TIMEOUT_MS }).toBe(3);
          await unsubscribe();
        },
      },
      {
        name: "listener does not receive notification for non-matching type name",
        run: async ({ notifyAdapter }, expect) => {
          let callCount = 0;
          const unsubscribe = await notifyAdapter.listenJobScheduled(["type-a"], () => {
            callCount++;
          });

          await notifyAdapter.notifyJobScheduled("type-b");
          await sleep(NEGATIVE_ASSERTION_DELAY_MS);

          expect(callCount).toBe(0);
          await unsubscribe();
        },
      },
      {
        name: "multi-type listener receives matching types",
        run: async ({ notifyAdapter }, expect) => {
          const received = Promise.withResolvers<string>();
          const unsubscribe = await notifyAdapter.listenJobScheduled(
            ["type-a", "type-b"],
            (typeName) => {
              received.resolve(typeName);
            },
          );

          await notifyAdapter.notifyJobScheduled("type-b");

          const result = await waitFor(received.promise, "notification");

          expect(result).toBe("type-b");
          await unsubscribe();
        },
      },
      {
        name: "unsubscribe stops job scheduled notifications",
        run: async ({ notifyAdapter }, expect) => {
          let callCount = 0;
          const unsubscribe = await notifyAdapter.listenJobScheduled(["type-a"], () => {
            callCount++;
          });

          await unsubscribe();
          await notifyAdapter.notifyJobScheduled("type-a");
          await sleep(NEGATIVE_ASSERTION_DELAY_MS);

          expect(callCount).toBe(0);
        },
      },
      {
        name: "publish without listeners does not error",
        run: async ({ notifyAdapter }) => {
          await notifyAdapter.notifyJobScheduled("type-a");
          await notifyAdapter.notifyJobChainCompleted("chain-1");
          await notifyAdapter.notifyJobOwnershipLost("job-1");
        },
      },
    ],
  },
  {
    name: "provideWakeHint / consumeWakeHint",
    cases: [
      {
        name: "consumeWakeHint returns true when no budget is tracked (graceful degradation)",
        run: async ({ notifyAdapter }, expect) => {
          const typeName = `type-untracked-${crypto.randomUUID()}`;
          const result = await notifyAdapter.consumeWakeHint(typeName);
          expect(result).toBe(true);
        },
      },
      {
        name: "consumeWakeHint claims slots up to the provided budget",
        run: async ({ notifyAdapter }, expect) => {
          const typeName = `type-budget-${crypto.randomUUID()}`;
          await notifyAdapter.provideWakeHint(typeName, 2);

          const first = await notifyAdapter.consumeWakeHint(typeName);
          const second = await notifyAdapter.consumeWakeHint(typeName);
          const third = await notifyAdapter.consumeWakeHint(typeName);

          expect(first).toBe(true);
          expect(second).toBe(true);
          // Adapters without hint support always return true; honoring adapters return false.
          // Both behaviors are valid per the contract.
          expect([true, false]).toContain(third);
        },
      },
      {
        name: "provideWakeHint composes additively across calls",
        run: async ({ notifyAdapter }, expect) => {
          const typeName = `type-additive-${crypto.randomUUID()}`;
          await notifyAdapter.provideWakeHint(typeName, 2);
          await notifyAdapter.provideWakeHint(typeName, 3);

          const claims = await Promise.all(
            Array.from({ length: 6 }, async () => notifyAdapter.consumeWakeHint(typeName)),
          );
          const claimed = claims.filter((c) => c).length;

          // Honoring adapters: exactly 5 of the 6 attempts succeed (budget = 2 + 3 = 5).
          // No-op adapters: all 6 succeed.
          expect([5, 6]).toContain(claimed);
        },
      },
    ],
  },
  {
    name: "notifyJobChainCompleted / listenJobChainCompleted",
    cases: [
      {
        name: "listener receives chain completion for matching chain ID",
        run: async ({ notifyAdapter }) => {
          const received = Promise.withResolvers<void>();
          const unsubscribe = await notifyAdapter.listenJobChainCompleted("chain-123", () => {
            received.resolve();
          });

          await notifyAdapter.notifyJobChainCompleted("chain-123");

          await waitFor(received.promise, "notification");

          await unsubscribe();
        },
      },
      {
        name: "listener does not receive chain completion for different chain ID",
        run: async ({ notifyAdapter }, expect) => {
          let callCount = 0;
          const unsubscribe = await notifyAdapter.listenJobChainCompleted("chain-123", () => {
            callCount++;
          });

          await notifyAdapter.notifyJobChainCompleted("chain-456");
          await sleep(NEGATIVE_ASSERTION_DELAY_MS);

          expect(callCount).toBe(0);
          await unsubscribe();
        },
      },
      {
        name: "multiple listeners for same chain ID both receive notification",
        run: async ({ notifyAdapter }) => {
          const received1 = Promise.withResolvers<void>();
          const received2 = Promise.withResolvers<void>();

          const unsubscribe1 = await notifyAdapter.listenJobChainCompleted("chain-multi", () => {
            received1.resolve();
          });
          const unsubscribe2 = await notifyAdapter.listenJobChainCompleted("chain-multi", () => {
            received2.resolve();
          });

          await notifyAdapter.notifyJobChainCompleted("chain-multi");

          await waitFor(Promise.all([received1.promise, received2.promise]), "notifications");

          await unsubscribe1();
          await unsubscribe2();
        },
      },
      {
        name: "unsubscribe stops chain completion notifications",
        run: async ({ notifyAdapter }, expect) => {
          let callCount = 0;
          const unsubscribe = await notifyAdapter.listenJobChainCompleted(
            "chain-unsubscribe",
            () => {
              callCount++;
            },
          );

          await unsubscribe();
          await notifyAdapter.notifyJobChainCompleted("chain-unsubscribe");
          await sleep(NEGATIVE_ASSERTION_DELAY_MS);

          expect(callCount).toBe(0);
        },
      },
    ],
  },
  {
    name: "notifyJobOwnershipLost / listenJobOwnershipLost",
    cases: [
      {
        name: "listener receives ownership lost for matching job ID",
        run: async ({ notifyAdapter }) => {
          const received = Promise.withResolvers<void>();
          const unsubscribe = await notifyAdapter.listenJobOwnershipLost("job-123", () => {
            received.resolve();
          });

          await notifyAdapter.notifyJobOwnershipLost("job-123");

          await waitFor(received.promise, "notification");

          await unsubscribe();
        },
      },
      {
        name: "listener does not receive ownership lost for different job ID",
        run: async ({ notifyAdapter }, expect) => {
          let callCount = 0;
          const unsubscribe = await notifyAdapter.listenJobOwnershipLost("job-123", () => {
            callCount++;
          });

          await notifyAdapter.notifyJobOwnershipLost("job-456");
          await sleep(NEGATIVE_ASSERTION_DELAY_MS);

          expect(callCount).toBe(0);
          await unsubscribe();
        },
      },
      {
        name: "multiple listeners for same job ID both receive ownership lost",
        run: async ({ notifyAdapter }) => {
          const received1 = Promise.withResolvers<void>();
          const received2 = Promise.withResolvers<void>();

          const unsubscribe1 = await notifyAdapter.listenJobOwnershipLost("job-multi", () => {
            received1.resolve();
          });
          const unsubscribe2 = await notifyAdapter.listenJobOwnershipLost("job-multi", () => {
            received2.resolve();
          });

          await notifyAdapter.notifyJobOwnershipLost("job-multi");

          await waitFor(Promise.all([received1.promise, received2.promise]), "notifications");

          await unsubscribe1();
          await unsubscribe2();
        },
      },
      {
        name: "unsubscribe stops ownership lost notifications",
        run: async ({ notifyAdapter }, expect) => {
          let callCount = 0;
          const unsubscribe = await notifyAdapter.listenJobOwnershipLost("job-unsubscribe", () => {
            callCount++;
          });

          await unsubscribe();
          await notifyAdapter.notifyJobOwnershipLost("job-unsubscribe");
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
        run: async ({ notifyAdapter }, expect) => {
          const count = 50;
          const half = count / 2;
          let received = 0;
          const chainIds = Array.from({ length: count }, (_, i) => `chain-flush-${i}`);

          const unsubscribes = await Promise.all(
            chainIds.map(async (id) =>
              notifyAdapter.listenJobChainCompleted(id, () => {
                received++;
              }),
            ),
          );

          for (let i = 0; i < half; i++) {
            await notifyAdapter.notifyJobChainCompleted(chainIds[i]);
          }
          // Let fire-and-forget transports drain already-published messages.
          // A batch-at-end impl would show 0 here; an incremental impl makes progress.
          await sleep(100);
          const receivedMidLoop = received;

          for (let i = half; i < count; i++) {
            await notifyAdapter.notifyJobChainCompleted(chainIds[i]);
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
        name: "listen methods return async unsubscribe functions",
        run: async ({ notifyAdapter }, expect) => {
          const unsubscribe1 = await notifyAdapter.listenJobScheduled(["type-a"], () => {});
          const unsubscribe2 = await notifyAdapter.listenJobChainCompleted("chain-1", () => {});
          const unsubscribe3 = await notifyAdapter.listenJobOwnershipLost("job-1", () => {});

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
        run: async ({ notifyAdapter }, expect) => {
          const unsubscribe1 = await notifyAdapter.listenJobScheduled(["type-a"], () => {});
          await unsubscribe1();

          const received = Promise.withResolvers<string>();
          const unsubscribe2 = await notifyAdapter.listenJobScheduled(["type-a"], (typeName) => {
            received.resolve(typeName);
          });

          await notifyAdapter.notifyJobScheduled("type-a");

          const result = await waitFor(received.promise, "notification");

          expect(result).toBe("type-a");
          await unsubscribe2();
        },
      },
      {
        name: "unsubscribe one of two listeners, remaining still receives",
        run: async ({ notifyAdapter }, expect) => {
          let count1 = 0;
          const received2 = Promise.withResolvers<void>();

          const unsubscribe1 = await notifyAdapter.listenJobChainCompleted("chain-partial", () => {
            count1++;
          });
          const unsubscribe2 = await notifyAdapter.listenJobChainCompleted("chain-partial", () => {
            received2.resolve();
          });

          await unsubscribe1();

          await notifyAdapter.notifyJobChainCompleted("chain-partial");

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
        run: async ({ notifyAdapter }) => {
          const peerCalled = Promise.withResolvers<void>();
          const unsubBad = await notifyAdapter.listenJobChainCompleted("chain-throw", () => {
            throw new Error("bad listener");
          });
          const unsubGood = await notifyAdapter.listenJobChainCompleted("chain-throw", () => {
            peerCalled.resolve();
          });

          await notifyAdapter.notifyJobChainCompleted("chain-throw");
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
        run: async ({ notifyAdapter }, expect) => {
          const unhandled: unknown[] = [];
          const handler = (reason: unknown): void => {
            unhandled.push(reason);
          };
          process.on("unhandledRejection", handler);
          try {
            const u1 = await notifyAdapter.listenJobScheduled(["type-a"], () => {});
            const u2 = await notifyAdapter.listenJobChainCompleted("chain-1", () => {});
            const u3 = await notifyAdapter.listenJobOwnershipLost("job-1", () => {});

            await notifyAdapter.notifyJobScheduled("type-a");
            await notifyAdapter.notifyJobChainCompleted("chain-1");
            await notifyAdapter.notifyJobOwnershipLost("job-1");

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
        run: async ({ notifyAdapter }, expect) => {
          const unsubscribe = await notifyAdapter.listenJobChainCompleted("chain-1", () => {});

          await notifyAdapter.close();
          await notifyAdapter.close();

          await unsubscribe();

          await expect(notifyAdapter.notifyJobScheduled("type-a")).rejects.toThrow();
          await expect(notifyAdapter.listenJobScheduled(["type-a"], () => {})).rejects.toThrow();
          await expect(notifyAdapter.notifyJobChainCompleted("chain-1")).rejects.toThrow();
          await expect(
            notifyAdapter.listenJobChainCompleted("chain-1", () => {}),
          ).rejects.toThrow();
          await expect(notifyAdapter.notifyJobOwnershipLost("job-1")).rejects.toThrow();
          await expect(notifyAdapter.listenJobOwnershipLost("job-1", () => {})).rejects.toThrow();
        },
      },
    ],
  },
];
