/**
 * MongoDB State Adapter Memory Measurement
 */

import { type MongoStateProvider, createMongoStateAdapter } from "@queuert/mongodb";
import { MongoDBContainer } from "@testcontainers/mongodb";
import { MongoClient } from "mongodb";
import { createClient, createInProcessWorker } from "queuert";
import { createInProcessNotifyAdapter } from "queuert/internal";
import {
  diffMemory,
  measureBaseline,
  measureMemory,
  printHeader,
  printSummary,
  registry,
} from "./utils.js";

printHeader("MONGODB STATE ADAPTER");

const baseline = await measureBaseline();

console.log("\nStarting MongoDB container...");
const [beforeContainer, afterContainer, mongoContainer] = await measureMemory(async () =>
  new MongoDBContainer("mongo:7").withExposedPorts(27017).start(),
);
console.log("\nAfter starting container (testcontainers overhead):");
diffMemory(beforeContainer, afterContainer);

const [beforeConnection, afterConnection, { mongoClient, db }] = await measureMemory(async () => {
  const mongoClient = new MongoClient(mongoContainer.getConnectionString(), {
    directConnection: true,
  });
  await mongoClient.connect();
  const db = mongoClient.db("queuert_perf");
  return { mongoClient, db };
});
console.log("\nAfter creating MongoDB connection:");
diffMemory(beforeConnection, afterConnection);

type DbContext = { session: ReturnType<MongoClient["startSession"]> };
const stateProvider: MongoStateProvider<DbContext> = {
  getCollection: () => db.collection("jobs"),
  getSession: (txContext) => txContext?.session,
  runInTransaction: async (fn) => {
    const session = mongoClient.startSession();
    try {
      return await session.withTransaction(async () => fn({ session }));
    } finally {
      await session.endSession();
    }
  },
};

const notifyAdapter = createInProcessNotifyAdapter();
const [beforeAdapter, afterAdapter, stateAdapter] = await measureMemory(async () => {
  const stateAdapter = await createMongoStateAdapter({
    stateProvider,
    idGenerator: () => crypto.randomUUID(),
  });
  await stateAdapter.migrateToLatest();
  return stateAdapter;
});
console.log("\nAfter creating MongoStateAdapter (with migrations):");
diffMemory(beforeAdapter, afterAdapter);

const [beforeSetup, afterSetup, { qrtClient, stopWorker }] = await measureMemory(async () => {
  const qrtClient = await createClient({
    stateAdapter,
    notifyAdapter,
    registry,
  });

  const qrtWorker = await createInProcessWorker({
    stateAdapter,
    notifyAdapter,
    registry,
    processors: {
      "test-job": {
        attemptHandler: async ({ complete }) => complete(async () => ({ processed: true })),
      },
    },
  });

  const stopWorker = await qrtWorker.start();
  return { qrtClient, stopWorker };
});
console.log("\nAfter creating client + worker:");
diffMemory(beforeSetup, afterSetup);

console.log("\nProcessing 100 jobs...");
const [beforeProcessing, afterProcessing] = await measureMemory(async () => {
  const promises = [];
  for (let i = 0; i < 100; i++) {
    const chain = await qrtClient.withNotify(async () =>
      stateProvider.runInTransaction(async (ctx) =>
        qrtClient.startJobChain({
          ...ctx,
          typeName: "test-job",
          input: { message: `Test message ${i}` },
        }),
      ),
    );
    promises.push(qrtClient.waitForJobChainCompletion(chain, { timeoutMs: 30000 }));
  }
  await Promise.all(promises);
});
console.log("\nAfter processing 100 jobs:");
diffMemory(beforeProcessing, afterProcessing);

await stopWorker();
await mongoClient.close();
await mongoContainer.stop();

const [, afterCleanup] = await measureMemory(async () => {});
console.log("\nAfter cleanup (delta from baseline):");
diffMemory(baseline, afterCleanup);

printSummary([
  ["Container + driver:", afterConnection.heapUsed - baseline.heapUsed],
  ["State adapter:", afterAdapter.heapUsed - beforeAdapter.heapUsed],
  ["Client + worker:", afterSetup.heapUsed - beforeSetup.heapUsed],
]);
