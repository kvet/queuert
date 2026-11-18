import assert from "node:assert/strict";

import {
  createClient,
  createInProcessStateAdapter,
  createProcessors,
  createWorkerRunner,
  defineJobTypes,
} from "queuert";

const CLEANUP_RETENTION_MS = 0;
const CLEANUP_BATCH_SIZE = 2;
const CLEANUP_INTERVAL_MS = 60_000;

// #region job-types
const cleanupJobTypes = defineJobTypes<{
  /*
   * queuert.cleanup --(schedules the next run)--> queuert.cleanup
   */
  "queuert.cleanup": {
    entry: true;
    input: null;
    output: null;
  };
}>();
// #endregion

const userJobTypes = defineJobTypes<{
  "send-welcome-email": {
    entry: true;
    input: { userId: string };
    output: { sentAt: string };
  };
}>();

await using stateAdapter = createInProcessStateAdapter({ mode: "async" });

// #region merge-client
const client = createClient({ stateAdapter, jobTypes: [cleanupJobTypes, userJobTypes] });
// #endregion

// #region processor
const cleanupProcessors = createProcessors({
  client,
  jobTypes: cleanupJobTypes,
  processors: {
    "queuert.cleanup": {
      attemptHandler: async ({ job, signal, complete, fence }) => {
        const cutoffDate = new Date(Date.now() - CLEANUP_RETENTION_MS);
        const typeNames = await client.getChainTypeNames();
        let roundDeletedCount: number;

        do {
          roundDeletedCount = 0;

          for (const typeName of typeNames) {
            let cursor: string | undefined;

            do {
              if (signal.aborted) {
                return stateAdapter.withTransaction(async (txCtx) =>
                  complete({ ...txCtx, reschedule: { afterMs: 0 } }),
                );
              }

              const page = await client.listChains({
                typeName,
                status: "completed",
                orderBy: "completedAt",
                blocking: false,
                to: cutoffDate,
                orderDirection: "asc",
                limit: CLEANUP_BATCH_SIZE,
                ...(cursor != null ? { cursor } : {}),
              });

              const chainsToDelete = page.items.filter(
                (chain) => chain.id !== job.chainId && chain.status === "completed",
              );

              if (chainsToDelete.length > 0) {
                const deletedChains = await stateAdapter.withTransaction(async (txCtx) => {
                  await fence({ ...txCtx });
                  return client.deleteChains({
                    ...txCtx,
                    ids: chainsToDelete.map((chain) => chain.id),
                  });
                });
                roundDeletedCount += deletedChains.length;
              }

              cursor = page.nextCursor ?? undefined;
            } while (cursor);
          }
        } while (!signal.aborted && roundDeletedCount > 0);

        return stateAdapter.withTransaction(async (txCtx) => {
          const completedJob = await complete({ ...txCtx, output: null });

          await client.createChain({
            ...txCtx,
            typeName: "queuert.cleanup",
            input: null,
            schedule: { afterMs: CLEANUP_INTERVAL_MS },
            deduplication: { key: "queuert.cleanup", scope: "running" },
          });

          return completedJob;
        });
      },
    },
  },
});
// #endregion

const userProcessors = createProcessors({
  client,
  jobTypes: userJobTypes,
  processors: {
    "send-welcome-email": {
      attemptHandler: async ({ complete }) =>
        stateAdapter.withTransaction(async (txCtx) =>
          complete({ ...txCtx, output: { sentAt: new Date().toISOString() } }),
        ),
    },
  },
});

// #region merge-worker
await using workerRunner = createWorkerRunner({
  client,
  processors: [cleanupProcessors, userProcessors],
});
// #endregion
await workerRunner.start();

const emailChains = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChains({
    ...txCtx,
    items: [
      { typeName: "send-welcome-email", input: { userId: "alice" } },
      { typeName: "send-welcome-email", input: { userId: "bob" } },
      { typeName: "send-welcome-email", input: { userId: "carol" } },
      { typeName: "send-welcome-email", input: { userId: "dave" }, schedule: { afterMs: 60_000 } },
    ],
  }),
);
await Promise.all(
  emailChains.slice(0, 3).map(async (chain) => client.awaitChain(chain, { timeoutMs: 5000 })),
);

// #region schedule-first-run
const scheduleCleanup = async () =>
  stateAdapter.withTransaction(async (txCtx) =>
    client.createChain({
      ...txCtx,
      typeName: "queuert.cleanup",
      input: null,
      deduplication: { key: "queuert.cleanup", scope: "running" },
    }),
  );
// #endregion

const cleanupChain = await scheduleCleanup();
const duplicateCleanupChain = await scheduleCleanup();
assert.equal(duplicateCleanupChain.deduplicated, true);
assert.equal(duplicateCleanupChain.id, cleanupChain.id);

await client.awaitChain(cleanupChain, { timeoutMs: 5000 });

const remainingEmailChains = await client.listChains({ typeName: "send-welcome-email" });
assert.deepEqual(
  remainingEmailChains.items.map((chain) => chain.id),
  [emailChains[3].id],
);

const nextCleanupJobs = await client.listJobs({ typeName: "queuert.cleanup", status: "pending" });
assert.equal(nextCleanupJobs.items.length, 1);
