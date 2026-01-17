import { extendWithMongodb } from "@queuert/testcontainers";
import { MongoClient } from "mongodb";
import { createQueuert, defineJobTypes } from "queuert";
import { createInProcessNotifyAdapter } from "queuert/internal";
import { it as baseIt, expectTypeOf, vi } from "vitest";
import { createMongoStateAdapter } from "../state-adapter/state-adapter.mongodb.js";
import { createMongoProvider } from "./state-provider.mongodb.js";

const it = extendWithMongodb(baseIt, import.meta.url);

it("should infer types correctly with custom ID", async ({ mongoConnectionString }) => {
  const client = new MongoClient(mongoConnectionString);
  await client.connect();

  const dbName = new URL(mongoConnectionString).pathname.slice(1).split("?")[0];
  const db = client.db(dbName);
  const collectionName = "queuert_jobs";

  const stateProvider = createMongoProvider({
    client,
    db,
    collectionName,
  });

  const stateAdapter = await createMongoStateAdapter({
    stateProvider,
    idGenerator: () => `job.${crypto.randomUUID()}` as `job.${string}`,
  });

  await stateAdapter.migrateToLatest();

  const queuert = await createQueuert({
    stateAdapter,
    notifyAdapter: createInProcessNotifyAdapter(),
    log: vi.fn(),
    jobTypeRegistry: defineJobTypes<{
      test: {
        entry: true;
        input: { foo: string };
        output: { bar: number };
      };
    }>(),
  });

  const jobSequence = await queuert.withNotify(async () => {
    const session = client.startSession();
    try {
      return await session.withTransaction(async () => {
        return queuert.startJobSequence({
          session,
          typeName: "test",
          input: { foo: "hello" },
        });
      });
    } finally {
      await session.endSession();
    }
  });
  expectTypeOf(jobSequence.id).toEqualTypeOf<`job.${string}`>();

  const worker = queuert.createWorker().implementJobType({
    typeName: "test",
    process: async ({ job, complete }) => {
      expectTypeOf(job.id).toEqualTypeOf<`job.${string}`>();

      return complete(async () => ({ bar: 42 }));
    },
  });

  const stopWorker = await worker.start();

  await queuert.waitForJobSequenceCompletion(jobSequence, { timeoutMs: 1000 });

  await stopWorker();

  await client.close();
});
