import { extendWithMongodb } from "@queuert/testcontainers";
import { MongoClient } from "mongodb";
import { createClient, createInProcessWorker, defineJobTypes } from "queuert";
import { createInProcessNotifyAdapter } from "queuert/internal";
import { withWorkers } from "queuert/testing";
import { it as baseIt, expectTypeOf, vi } from "vitest";
import { createMongoStateAdapter } from "../state-adapter/state-adapter.mongodb.js";
import { createMongoProvider } from "./state-provider.mongodb.js";

const it = extendWithMongodb(baseIt, import.meta.url);

it("should infer types correctly with custom ID", async ({ mongoConnectionString }) => {
  const mongoClient = new MongoClient(mongoConnectionString);
  await mongoClient.connect();

  const dbName = new URL(mongoConnectionString).pathname.slice(1).split("?")[0];
  const db = mongoClient.db(dbName);
  const collectionName = "queuert_jobs";

  const stateProvider = createMongoProvider({
    client: mongoClient,
    db,
    collectionName,
  });

  const stateAdapter = await createMongoStateAdapter({
    stateProvider,
    idGenerator: () => `job.${crypto.randomUUID()}` as `job.${string}`,
  });

  await stateAdapter.migrateToLatest();

  const notifyAdapter = createInProcessNotifyAdapter();
  const log = vi.fn();
  const registry = defineJobTypes<{
    test: {
      entry: true;
      input: { foo: string };
      output: { bar: number };
    };
  }>();

  const client = await createClient({
    stateAdapter,
    notifyAdapter,
    log,
    registry,
  });
  const worker = await createInProcessWorker({
    stateAdapter,
    notifyAdapter,
    log,
    registry,
    processors: {
      test: {
        attemptHandler: async ({ job, complete }) => {
          expectTypeOf(job.id).toEqualTypeOf<`job.${string}`>();

          return complete(async () => ({ bar: 42 }));
        },
      },
    },
  });

  const jobChain = await client.withNotify(async () => {
    const session = mongoClient.startSession();
    try {
      return await session.withTransaction(async () => {
        return client.startJobChain({
          session,
          typeName: "test",
          input: { foo: "hello" },
        });
      });
    } finally {
      await session.endSession();
    }
  });
  expectTypeOf(jobChain.id).toEqualTypeOf<`job.${string}`>();

  await withWorkers([await worker.start()], async () => {
    await client.waitForJobChainCompletion(jobChain, { timeoutMs: 1000 });
  });

  await mongoClient.close();
});
