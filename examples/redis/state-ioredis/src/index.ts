import { createRedisStateAdapter } from "@queuert/redis";
import { acquireRedis } from "@queuert/testcontainers";
import { Redis } from "ioredis";
import { createClient, createProcessors, createWorkerRunner, defineJobTypes } from "queuert";

import { createIoredisStateProvider } from "./provider.ts";

console.log("Starting Redis...");
await using redisContainer = await acquireRedis("redis:8");

const jobTypes = defineJobTypes<{
  send_welcome_email: {
    entry: true;
    input: { email: string };
    output: { sentAt: string };
  };
}>();

// #region adapter
await using drivers = new AsyncDisposableStack();
const redis = drivers.adopt(new Redis(redisContainer.connectionUrl), async (redis) => {
  await redis.quit();
});
await using stateAdapter = createRedisStateAdapter({
  stateProvider: createIoredisStateProvider({ client: redis }),
  keyPrefix: "{queuert}:",
});
await stateAdapter.migrateToLatest();
// #endregion

const client = createClient({ stateAdapter, jobTypes });

await using workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      send_welcome_email: {
        attemptHandler: async ({ job, complete }) => {
          console.log(`Sending welcome email to ${job.input.email}`);
          return stateAdapter.withTransaction(async (txCtx) =>
            complete({ ...txCtx, output: { sentAt: new Date().toISOString() } }),
          );
        },
      },
    },
  }),
});

await workerRunner.start();

// #region transaction
const chain = await stateAdapter.withTransaction(async (txCtx) => {
  const created = await client.createChain({
    ...txCtx,
    typeName: "send_welcome_email",
    input: { email: "alice@example.com" },
  });
  stateAdapter.onTransactionCommit(txCtx, () => {
    console.log(`Queued chain ${created.id}`);
  });
  return created;
});
// #endregion

const result = await client.awaitChain(chain, { timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);
