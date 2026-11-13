import assert from "node:assert/strict";

import { assertRejects } from "@queuert/helpers/assert-rejects";
import { caseBody, resource, wait } from "@queuert/helpers/case-body";
import { all } from "@queuert/helpers/maybe-promise";
import { raceWithSleep, sleep } from "@queuert/helpers/sleep";
import { step } from "@queuert/helpers/steps";

import { retryUntilPasses } from "../conformance/retry-until-passes.ts";
import type { ConformanceGroup } from "../conformance/runner.ts";
import type { NotifyAdapterConformanceContext } from "./types.ts";

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
        run: caseBody(function* ({ createNotifyAdapter }) {
          const notifyAdapter = yield* resource(createNotifyAdapter());

          const received: string[] = [];
          const unsubscribe = yield* step(
            notifyAdapter.listenJobScheduled(["type-a", "type-b", "type-c"], (typeName) => {
              received.push(typeName);
            }),
          );

          yield* step(notifyAdapter.notifyJobsScheduled(["type-a", "type-b", "type-c"]));

          yield* wait(
            retryUntilPasses(
              async () => {
                assert.deepEqual([...received].sort(), ["type-a", "type-b", "type-c"]);
              },
              { timeoutMs: DELIVERY_TIMEOUT_MS },
            ),
          );
          yield* step(unsubscribe());
        }),
      },
      {
        name: "multiple notifications all reach the listener",
        run: caseBody(function* ({ createNotifyAdapter }) {
          const notifyAdapter = yield* resource(createNotifyAdapter());

          let count = 0;
          const unsubscribe = yield* step(
            notifyAdapter.listenJobScheduled(["type-a"], () => {
              count++;
            }),
          );

          yield* step(notifyAdapter.notifyJobsScheduled(["type-a"]));
          yield* step(notifyAdapter.notifyJobsScheduled(["type-a"]));
          yield* step(notifyAdapter.notifyJobsScheduled(["type-a"]));

          yield* wait(
            retryUntilPasses(
              async () => {
                assert.equal(count, 3);
              },
              { timeoutMs: DELIVERY_TIMEOUT_MS },
            ),
          );
          yield* step(unsubscribe());
        }),
      },
      {
        name: "listener does not receive notification for non-matching type name",
        run: caseBody(function* ({ createNotifyAdapter }) {
          const notifyAdapter = yield* resource(createNotifyAdapter());

          let callCount = 0;
          const unsubscribe = yield* step(
            notifyAdapter.listenJobScheduled(["type-a"], () => {
              callCount++;
            }),
          );

          yield* step(notifyAdapter.notifyJobsScheduled(["type-b"]));
          yield* wait(sleep(NEGATIVE_ASSERTION_DELAY_MS));

          assert.equal(callCount, 0);
          yield* step(unsubscribe());
        }),
      },
      {
        name: "multi-type listener receives matching types",
        run: caseBody(function* ({ createNotifyAdapter }) {
          const notifyAdapter = yield* resource(createNotifyAdapter());

          const received = Promise.withResolvers<string>();
          const unsubscribe = yield* step(
            notifyAdapter.listenJobScheduled(["type-a", "type-b"], (typeName) => {
              received.resolve(typeName);
            }),
          );

          yield* step(notifyAdapter.notifyJobsScheduled(["type-b"]));

          const result = yield* wait(waitFor(received.promise, "notification"));

          assert.equal(result, "type-b");
          yield* step(unsubscribe());
        }),
      },
      {
        name: "every listener for a type receives each notification",
        run: caseBody(function* ({ createNotifyAdapter }) {
          const notifyAdapter = yield* resource(createNotifyAdapter());

          const received1 = Promise.withResolvers<void>();
          const received2 = Promise.withResolvers<void>();

          const unsubscribe1 = yield* step(
            notifyAdapter.listenJobScheduled(["type-multi"], () => {
              received1.resolve();
            }),
          );
          const unsubscribe2 = yield* step(
            notifyAdapter.listenJobScheduled(["type-multi"], () => {
              received2.resolve();
            }),
          );

          yield* step(notifyAdapter.notifyJobsScheduled(["type-multi"]));

          yield* wait(
            waitFor(Promise.all([received1.promise, received2.promise]), "notifications"),
          );

          yield* step(unsubscribe1());
          yield* step(unsubscribe2());
        }),
      },
      {
        name: "unsubscribe stops job scheduled notifications",
        run: caseBody(function* ({ createNotifyAdapter }) {
          const notifyAdapter = yield* resource(createNotifyAdapter());

          let callCount = 0;
          const unsubscribe = yield* step(
            notifyAdapter.listenJobScheduled(["type-a"], () => {
              callCount++;
            }),
          );

          yield* step(unsubscribe());
          yield* step(notifyAdapter.notifyJobsScheduled(["type-a"]));
          yield* wait(sleep(NEGATIVE_ASSERTION_DELAY_MS));

          assert.equal(callCount, 0);
        }),
      },
      {
        name: "publish without listeners does not error",
        run: caseBody(function* ({ createNotifyAdapter }) {
          const notifyAdapter = yield* resource(createNotifyAdapter());

          yield* step(notifyAdapter.notifyJobsScheduled(["unheard-type"]));
          yield* step(notifyAdapter.notifyChainsCompleted(["unheard-chain"]));
          yield* step(notifyAdapter.notifyJobAttemptsLost(["unheard-job"]));
        }),
      },
    ],
  },
  {
    name: "notifyChainsCompleted / listenChainCompleted",
    cases: [
      {
        name: "listener receives chain completion for each chain ID in the batch",
        run: caseBody(function* ({ createNotifyAdapter }) {
          const notifyAdapter = yield* resource(createNotifyAdapter());

          const chainIds = ["chain-1", "chain-2", "chain-3"];
          const received: string[] = [];
          const unsubscribes = yield* step(
            all(
              chainIds.map((chainId) =>
                notifyAdapter.listenChainCompleted(chainId, () => {
                  received.push(chainId);
                }),
              ),
            ),
          );

          yield* step(notifyAdapter.notifyChainsCompleted(chainIds));

          yield* wait(
            retryUntilPasses(
              async () => {
                assert.deepEqual([...received].sort(), chainIds);
              },
              { timeoutMs: DELIVERY_TIMEOUT_MS },
            ),
          );
          yield* step(all(unsubscribes.map((unsubscribe) => unsubscribe())));
        }),
      },
      {
        name: "listener does not receive chain completion for different chain ID",
        run: caseBody(function* ({ createNotifyAdapter }) {
          const notifyAdapter = yield* resource(createNotifyAdapter());

          let callCount = 0;
          const unsubscribe = yield* step(
            notifyAdapter.listenChainCompleted("chain-123", () => {
              callCount++;
            }),
          );

          yield* step(notifyAdapter.notifyChainsCompleted(["chain-456"]));
          yield* wait(sleep(NEGATIVE_ASSERTION_DELAY_MS));

          assert.equal(callCount, 0);
          yield* step(unsubscribe());
        }),
      },
      {
        name: "multiple listeners for same chain ID both receive notification",
        run: caseBody(function* ({ createNotifyAdapter }) {
          const notifyAdapter = yield* resource(createNotifyAdapter());

          const received1 = Promise.withResolvers<void>();
          const received2 = Promise.withResolvers<void>();

          const unsubscribe1 = yield* step(
            notifyAdapter.listenChainCompleted("chain-multi", () => {
              received1.resolve();
            }),
          );
          const unsubscribe2 = yield* step(
            notifyAdapter.listenChainCompleted("chain-multi", () => {
              received2.resolve();
            }),
          );

          yield* step(notifyAdapter.notifyChainsCompleted(["chain-multi"]));

          yield* wait(
            waitFor(Promise.all([received1.promise, received2.promise]), "notifications"),
          );

          yield* step(unsubscribe1());
          yield* step(unsubscribe2());
        }),
      },
      {
        name: "unsubscribe stops chain completion notifications",
        run: caseBody(function* ({ createNotifyAdapter }) {
          const notifyAdapter = yield* resource(createNotifyAdapter());

          let callCount = 0;
          const unsubscribe = yield* step(
            notifyAdapter.listenChainCompleted("chain-unsubscribe", () => {
              callCount++;
            }),
          );

          yield* step(unsubscribe());
          yield* step(notifyAdapter.notifyChainsCompleted(["chain-unsubscribe"]));
          yield* wait(sleep(NEGATIVE_ASSERTION_DELAY_MS));

          assert.equal(callCount, 0);
        }),
      },
    ],
  },
  {
    name: "notifyJobAttemptsLost / listenJobAttemptLost",
    cases: [
      {
        name: "listener receives attempt lost for each job ID in the batch",
        run: caseBody(function* ({ createNotifyAdapter }) {
          const notifyAdapter = yield* resource(createNotifyAdapter());

          const jobIds = ["job-1", "job-2", "job-3"];
          const received: string[] = [];
          const unsubscribes = yield* step(
            all(
              jobIds.map((jobId) =>
                notifyAdapter.listenJobAttemptLost(jobId, () => {
                  received.push(jobId);
                }),
              ),
            ),
          );

          yield* step(notifyAdapter.notifyJobAttemptsLost(jobIds));

          yield* wait(
            retryUntilPasses(
              async () => {
                assert.deepEqual([...received].sort(), jobIds);
              },
              { timeoutMs: DELIVERY_TIMEOUT_MS },
            ),
          );
          yield* step(all(unsubscribes.map((unsubscribe) => unsubscribe())));
        }),
      },
      {
        name: "listener does not receive attempt lost for different job ID",
        run: caseBody(function* ({ createNotifyAdapter }) {
          const notifyAdapter = yield* resource(createNotifyAdapter());

          let callCount = 0;
          const unsubscribe = yield* step(
            notifyAdapter.listenJobAttemptLost("job-123", () => {
              callCount++;
            }),
          );

          yield* step(notifyAdapter.notifyJobAttemptsLost(["job-456"]));
          yield* wait(sleep(NEGATIVE_ASSERTION_DELAY_MS));

          assert.equal(callCount, 0);
          yield* step(unsubscribe());
        }),
      },
      {
        name: "multiple listeners for same job ID both receive attempt lost",
        run: caseBody(function* ({ createNotifyAdapter }) {
          const notifyAdapter = yield* resource(createNotifyAdapter());

          const received1 = Promise.withResolvers<void>();
          const received2 = Promise.withResolvers<void>();

          const unsubscribe1 = yield* step(
            notifyAdapter.listenJobAttemptLost("job-multi", () => {
              received1.resolve();
            }),
          );
          const unsubscribe2 = yield* step(
            notifyAdapter.listenJobAttemptLost("job-multi", () => {
              received2.resolve();
            }),
          );

          yield* step(notifyAdapter.notifyJobAttemptsLost(["job-multi"]));

          yield* wait(
            waitFor(Promise.all([received1.promise, received2.promise]), "notifications"),
          );

          yield* step(unsubscribe1());
          yield* step(unsubscribe2());
        }),
      },
      {
        name: "unsubscribe stops attempt lost notifications",
        run: caseBody(function* ({ createNotifyAdapter }) {
          const notifyAdapter = yield* resource(createNotifyAdapter());

          let callCount = 0;
          const unsubscribe = yield* step(
            notifyAdapter.listenJobAttemptLost("job-unsubscribe", () => {
              callCount++;
            }),
          );

          yield* step(unsubscribe());
          yield* step(notifyAdapter.notifyJobAttemptsLost(["job-unsubscribe"]));
          yield* wait(sleep(NEGATIVE_ASSERTION_DELAY_MS));

          assert.equal(callCount, 0);
        }),
      },
    ],
  },
  {
    name: "delivery timeliness",
    cases: [
      {
        name: "notifications dispatch during publish loop, not batched at end",
        run: caseBody(function* ({ createNotifyAdapter }) {
          const notifyAdapter = yield* resource(createNotifyAdapter());

          const count = 50;
          const half = count / 2;
          let received = 0;
          const chainIds = Array.from({ length: count }, (_, i) => `chain-flush-${i}`);

          const unsubscribes = yield* step(
            all(
              chainIds.map((id) =>
                notifyAdapter.listenChainCompleted(id, () => {
                  received++;
                }),
              ),
            ),
          );

          for (let i = 0; i < half; i++) {
            yield* step(notifyAdapter.notifyChainsCompleted([chainIds[i]]));
          }
          // Let fire-and-forget transports drain already-published messages.
          // A batch-at-end impl would show 0 here; an incremental impl makes progress.
          yield* wait(sleep(100));
          const receivedMidLoop = received;

          for (let i = half; i < count; i++) {
            yield* step(notifyAdapter.notifyChainsCompleted([chainIds[i]]));
          }

          yield* wait(
            retryUntilPasses(
              async () => {
                assert.equal(received, count);
              },
              { timeoutMs: 2000 },
            ),
          );
          assert.ok(receivedMidLoop > 0);

          yield* step(all(unsubscribes.map((unsubscribe) => unsubscribe())));
        }),
      },
    ],
  },
  {
    name: "cross-cutting behavior",
    cases: [
      {
        name: "a notification reaches only the listeners of its own kind",
        run: caseBody(function* ({ createNotifyAdapter }) {
          const notifyAdapter = yield* resource(createNotifyAdapter());

          const sharedId = "shared-id";
          const received: string[] = [];
          const unsubscribeScheduled = yield* step(
            notifyAdapter.listenJobScheduled([sharedId], () => {
              received.push("scheduled");
            }),
          );
          const unsubscribeCompleted = yield* step(
            notifyAdapter.listenChainCompleted(sharedId, () => {
              received.push("completed");
            }),
          );
          const unsubscribeLost = yield* step(
            notifyAdapter.listenJobAttemptLost(sharedId, () => {
              received.push("lost");
            }),
          );

          yield* step(notifyAdapter.notifyJobsScheduled([sharedId]));
          yield* wait(
            retryUntilPasses(
              async () => {
                assert.deepEqual(received, ["scheduled"]);
              },
              { timeoutMs: DELIVERY_TIMEOUT_MS },
            ),
          );
          yield* step(notifyAdapter.notifyChainsCompleted([sharedId]));
          yield* wait(
            retryUntilPasses(
              async () => {
                assert.deepEqual(received, ["scheduled", "completed"]);
              },
              { timeoutMs: DELIVERY_TIMEOUT_MS },
            ),
          );
          yield* step(notifyAdapter.notifyJobAttemptsLost([sharedId]));
          yield* wait(
            retryUntilPasses(
              async () => {
                assert.deepEqual(received, ["scheduled", "completed", "lost"]);
              },
              { timeoutMs: DELIVERY_TIMEOUT_MS },
            ),
          );
          yield* wait(sleep(NEGATIVE_ASSERTION_DELAY_MS));
          assert.deepEqual(received, ["scheduled", "completed", "lost"]);

          yield* step(unsubscribeScheduled());
          yield* step(unsubscribeCompleted());
          yield* step(unsubscribeLost());
        }),
      },
      {
        name: "listen methods return unsubscribe functions",
        run: caseBody(function* ({ createNotifyAdapter }) {
          const notifyAdapter = yield* resource(createNotifyAdapter());

          const unsubscribe1 = yield* step(notifyAdapter.listenJobScheduled(["type-a"], () => {}));
          const unsubscribe2 = yield* step(notifyAdapter.listenChainCompleted("chain-1", () => {}));
          const unsubscribe3 = yield* step(notifyAdapter.listenJobAttemptLost("job-1", () => {}));

          assert.equal(typeof unsubscribe1, "function");
          assert.equal(typeof unsubscribe2, "function");
          assert.equal(typeof unsubscribe3, "function");

          assert.equal(yield* step(unsubscribe1()), undefined);
          assert.equal(yield* step(unsubscribe2()), undefined);
          assert.equal(yield* step(unsubscribe3()), undefined);
        }),
      },
      {
        name: "can resubscribe after unsubscribe",
        run: caseBody(function* ({ createNotifyAdapter }) {
          const notifyAdapter = yield* resource(createNotifyAdapter());

          const unsubscribe1 = yield* step(notifyAdapter.listenJobScheduled(["type-a"], () => {}));
          yield* step(unsubscribe1());

          const received = Promise.withResolvers<string>();
          const unsubscribe2 = yield* step(
            notifyAdapter.listenJobScheduled(["type-a"], (typeName) => {
              received.resolve(typeName);
            }),
          );

          yield* step(notifyAdapter.notifyJobsScheduled(["type-a"]));

          const result = yield* wait(waitFor(received.promise, "notification"));

          assert.equal(result, "type-a");
          yield* step(unsubscribe2());
        }),
      },
      {
        name: "unsubscribe one of two listeners, remaining still receives",
        run: caseBody(function* ({ createNotifyAdapter }) {
          const notifyAdapter = yield* resource(createNotifyAdapter());

          let count1 = 0;
          const received2 = Promise.withResolvers<void>();

          const unsubscribe1 = yield* step(
            notifyAdapter.listenChainCompleted("chain-partial", () => {
              count1++;
            }),
          );
          const unsubscribe2 = yield* step(
            notifyAdapter.listenChainCompleted("chain-partial", () => {
              received2.resolve();
            }),
          );

          yield* step(unsubscribe1());

          yield* step(notifyAdapter.notifyChainsCompleted(["chain-partial"]));

          yield* wait(waitFor(received2.promise, "notification"));

          assert.equal(count1, 0);
          yield* step(unsubscribe2());
        }),
      },
    ],
  },
  {
    name: "listener fault isolation",
    cases: [
      {
        name: "throwing callback does not break peer callback or surface to publisher",
        run: caseBody(function* ({ createNotifyAdapter }) {
          const notifyAdapter = yield* resource(createNotifyAdapter());

          const peerCalled = Promise.withResolvers<void>();
          const unsubBad = yield* step(
            notifyAdapter.listenChainCompleted("chain-throw", () => {
              throw new Error("bad listener");
            }),
          );
          const unsubGood = yield* step(
            notifyAdapter.listenChainCompleted("chain-throw", () => {
              peerCalled.resolve();
            }),
          );

          yield* step(notifyAdapter.notifyChainsCompleted(["chain-throw"]));
          yield* wait(waitFor(peerCalled.promise, "peer notification"));

          yield* step(unsubBad());
          yield* step(unsubGood());
        }),
      },
    ],
  },
  {
    name: "no unhandled rejections",
    cases: [
      {
        name: "normal subscribe/notify/unsubscribe cycle does not produce unhandled rejections",
        run: caseBody(function* ({ createNotifyAdapter }) {
          const notifyAdapter = yield* resource(createNotifyAdapter());

          const unhandled: unknown[] = [];
          const handler = (reason: unknown): void => {
            unhandled.push(reason);
          };
          process.on("unhandledRejection", handler);
          try {
            const u1 = yield* step(notifyAdapter.listenJobScheduled(["type-a"], () => {}));
            const u2 = yield* step(notifyAdapter.listenChainCompleted("chain-1", () => {}));
            const u3 = yield* step(notifyAdapter.listenJobAttemptLost("job-1", () => {}));

            yield* step(notifyAdapter.notifyJobsScheduled(["type-a"]));
            yield* step(notifyAdapter.notifyChainsCompleted(["chain-1"]));
            yield* step(notifyAdapter.notifyJobAttemptsLost(["job-1"]));

            yield* wait(sleep(NEGATIVE_ASSERTION_DELAY_MS));

            yield* step(u1());
            yield* step(u2());
            yield* step(u3());

            yield* wait(sleep(NEGATIVE_ASSERTION_DELAY_MS));

            assert.deepEqual(unhandled, []);
          } finally {
            process.off("unhandledRejection", handler);
          }
        }),
      },
    ],
  },
  {
    name: "close",
    cases: [
      {
        name: "close is idempotent, rejects subsequent calls, and previously returned unsubscribes remain safe",
        run: caseBody(function* ({ createNotifyAdapter }) {
          const notifyAdapter = yield* resource(createNotifyAdapter());

          const unsubscribe = yield* step(notifyAdapter.listenChainCompleted("chain-1", () => {}));

          yield* step(notifyAdapter.close());
          yield* step(notifyAdapter.close());

          yield* step(unsubscribe());

          yield* step(assertRejects(() => notifyAdapter.notifyJobsScheduled(["type-a"])));
          yield* step(assertRejects(() => notifyAdapter.listenJobScheduled(["type-a"], () => {})));
          yield* step(assertRejects(() => notifyAdapter.notifyChainsCompleted(["chain-1"])));
          yield* step(assertRejects(() => notifyAdapter.listenChainCompleted("chain-1", () => {})));
          yield* step(assertRejects(() => notifyAdapter.notifyJobAttemptsLost(["job-1"])));
          yield* step(assertRejects(() => notifyAdapter.listenJobAttemptLost("job-1", () => {})));
        }),
      },
    ],
  },
];
