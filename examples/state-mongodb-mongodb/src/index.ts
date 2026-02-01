import { type MongoStateProvider, createMongoStateAdapter } from "@queuert/mongodb";
import { MongoDBContainer } from "@testcontainers/mongodb";
import { MongoClient } from "mongodb";
import { createClient, createInProcessWorker, defineJobTypes } from "queuert";
import { createInProcessNotifyAdapter } from "queuert/internal";

// 1. Start MongoDB using testcontainers
const mongoContainer = await new MongoDBContainer("mongo:7").withExposedPorts(27017).start();

// 2. Create database connection
const mongoClient = new MongoClient(mongoContainer.getConnectionString(), {
  directConnection: true,
});
await mongoClient.connect();
const db = mongoClient.db("queuert_example");

// 3. Define job types
const registry = defineJobTypes<{
  send_welcome_email: {
    entry: true;
    input: { odUserId: string; email: string; name: string };
    output: { sentAt: string };
  };
}>();

// 4. Create state provider for native MongoDB driver
type DbContext = { session: ReturnType<MongoClient["startSession"]> };

const stateProvider: MongoStateProvider<DbContext> = {
  getCollection: () => db.collection("queuert_jobs"),
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

// 5. Create adapters and queuert client/worker
const stateAdapter = await createMongoStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();

const notifyAdapter = createInProcessNotifyAdapter();

const qrtClient = await createClient({
  stateAdapter,
  notifyAdapter,
  registry,
});

// 6. Create and start qrtWorker
const qrtWorker = await createInProcessWorker({
  stateAdapter,
  notifyAdapter,
  registry,
  processors: {
    send_welcome_email: {
      attemptHandler: async ({ job, complete }) => {
        console.log(`Sending welcome email to ${job.input.email} for ${job.input.name}`);

        return complete(async () => ({
          sentAt: new Date().toISOString(),
        }));
      },
    },
  },
});

const stopWorker = await qrtWorker.start();

// 7. Register a new user and queue welcome email atomically
const jobChain = await qrtClient.withNotify(async () => {
  const session = mongoClient.startSession();
  try {
    return await session.withTransaction(async () => {
      const userResult = await db
        .collection("users")
        .insertOne({ name: "Alice", email: "alice@example.com" }, { session });

      return qrtClient.startJobChain({
        session,
        typeName: "send_welcome_email",
        input: {
          odUserId: userResult.insertedId.toString(),
          email: "alice@example.com",
          name: "Alice",
        },
      });
    });
  } finally {
    await session.endSession();
  }
});

// 8. Wait for the job chain to complete
const result = await qrtClient.waitForJobChainCompletion(jobChain, { timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// 9. Cleanup
await stopWorker();
await mongoClient.close();
await mongoContainer.stop();
