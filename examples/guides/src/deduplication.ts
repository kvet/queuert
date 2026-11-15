import assert from "node:assert/strict";

import {
  createClient,
  createInProcessStateAdapter,
  createProcessors,
  createWorkerRunner,
  defineJobTypes,
} from "queuert";

const jobTypes = defineJobTypes<{
  /*
   * sync-user (one running chain per user)
   */
  "sync-user": {
    entry: true;
    input: { userId: string };
    output: { syncedAt: string };
  };

  /*
   * send-welcome-email (once per user, ever)
   */
  "send-welcome-email": {
    entry: true;
    input: { userId: string };
    output: { sentAt: string };
  };

  /*
   * health-check #1 --> creates health-check #2, scheduled 5 minutes later --> ...
   */
  "health-check": {
    entry: true;
    input: { serviceId: string };
    output: { checkedAt: string };
  };
}>();

await using stateAdapter = createInProcessStateAdapter({ mode: "async" });
const client = createClient({ stateAdapter, jobTypes });

// #region deduplicate
const firstSync = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChain({
    ...txCtx,
    typeName: "sync-user",
    input: { userId: "123" },
    deduplication: { key: "sync:user:123", scope: "running" },
  }),
);

const secondSync = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChain({
    ...txCtx,
    typeName: "sync-user",
    input: { userId: "123" },
    deduplication: { key: "sync:user:123", scope: "running" },
  }),
);
// #endregion
assert.equal(firstSync.deduplicated, false);
assert.equal(secondSync.deduplicated, true);
assert.equal(secondSync.id, firstSync.id);

await using workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "sync-user": {
        attemptHandler: async ({ complete }) =>
          stateAdapter.withTransaction(async (txCtx) =>
            complete({ ...txCtx, output: { syncedAt: new Date().toISOString() } }),
          ),
      },
      "send-welcome-email": {
        attemptHandler: async ({ complete }) =>
          stateAdapter.withTransaction(async (txCtx) =>
            complete({ ...txCtx, output: { sentAt: new Date().toISOString() } }),
          ),
      },
      // #region self-scheduling
      "health-check": {
        attemptHandler: async ({ job, complete }) =>
          stateAdapter.withTransaction(async (txCtx) => {
            const completedJob = await complete({
              ...txCtx,
              output: { checkedAt: new Date().toISOString() },
            });

            await client.createChain({
              ...txCtx,
              typeName: "health-check",
              input: { serviceId: job.input.serviceId },
              schedule: { afterMs: 5 * 60 * 1000 },
              deduplication: { key: `health:${job.input.serviceId}`, scope: "running" },
            });

            return completedJob;
          }),
      },
      // #endregion
    },
  }),
});
await workerRunner.start();

await client.awaitChain(firstSync, { timeoutMs: 5000 });
const syncAfterCompletion = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChain({
    ...txCtx,
    typeName: "sync-user",
    input: { userId: "123" },
    deduplication: { key: "sync:user:123", scope: "running" },
  }),
);
assert.equal(syncAfterCompletion.deduplicated, false);
assert.notEqual(syncAfterCompletion.id, firstSync.id);

// #region scope-any
const sendWelcomeEmail = async (userId: string) =>
  stateAdapter.withTransaction(async (txCtx) =>
    client.createChain({
      ...txCtx,
      typeName: "send-welcome-email",
      input: { userId },
      deduplication: { key: `welcome:${userId}`, scope: "any" },
    }),
  );
// #endregion
const welcomeEmail = await sendWelcomeEmail("123");
await client.awaitChain(welcomeEmail, { timeoutMs: 5000 });
const repeatedWelcomeEmail = await sendWelcomeEmail("123");
assert.equal(repeatedWelcomeEmail.deduplicated, true);
assert.equal(repeatedWelcomeEmail.id, welcomeEmail.id);

const startHealthCheck = async () =>
  stateAdapter.withTransaction(async (txCtx) =>
    client.createChain({
      ...txCtx,
      typeName: "health-check",
      input: { serviceId: "api-server" },
      deduplication: { key: "health:api-server", scope: "running" },
    }),
  );
const firstHealthCheck = await startHealthCheck();
await client.awaitChain(firstHealthCheck, { timeoutMs: 5000 });
const nextHealthCheck = await startHealthCheck();
assert.equal(nextHealthCheck.deduplicated, true);
assert.notEqual(nextHealthCheck.id, firstHealthCheck.id);
