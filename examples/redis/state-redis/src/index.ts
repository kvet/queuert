import { createRedisStateAdapter } from "@queuert/redis";
import { acquireRedis } from "@queuert/testcontainers";
import { createClient, createProcessors, createWorkerRunner, defineJobTypes } from "queuert";
import { createClient as createRedisClient } from "redis";

import { createNodeRedisStateProvider } from "./provider.ts";

console.log("Starting Redis...");
await using redisContainer = await acquireRedis("redis:8");

const jobTypes = defineJobTypes<{
  "send-welcome-email": {
    entry: true;
    input: { email: string };
    output: { sentAt: string };
  };
}>();

// #region adapter
await using drivers = new AsyncDisposableStack();
const redis = drivers.adopt(
  await createRedisClient({ url: redisContainer.connectionUrl }).connect(),
  async (redis) => {
    await redis.close();
  },
);
await using stateAdapter = createRedisStateAdapter({
  stateProvider: createNodeRedisStateProvider({ client: redis }),
  keyPrefix: "{queuert}:",
});
await stateAdapter.migrateToLatest();
// #endregion

// #region process
const client = createClient({ stateAdapter, jobTypes });

await using workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "send-welcome-email": {
        attemptHandler: async ({ job, applyJobOutcome }) => {
          console.log(`Sending welcome email to ${job.input.email}`);
          await stateAdapter.withTransaction(async (txCtx) =>
            applyJobOutcome({ ...txCtx, output: { sentAt: new Date().toISOString() } }),
          );
        },
      },
    },
  }),
});

await workerRunner.start();
// #endregion

// #region transaction
const chain = await stateAdapter.withTransaction(async (txCtx) => {
  const created = await client.createChain({
    ...txCtx,
    typeName: "send-welcome-email",
    input: { email: "alice@example.com" },
  });
  stateAdapter.onTransactionCommit(txCtx, () => {
    console.log(`Queued chain ${created.id}`);
  });
  return created;
});
// #endregion

const result = await client.awaitChain({ chain, timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);
