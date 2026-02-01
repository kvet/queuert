import { type MongoStateProvider, createMongoStateAdapter } from "@queuert/mongodb";
import { MongoDBContainer } from "@testcontainers/mongodb";
import mongoose, { Schema } from "mongoose";
import { createQueuertClient, createQueuertInProcessWorker, defineJobTypes } from "queuert";
import { createInProcessNotifyAdapter } from "queuert/internal";

// 1. Start MongoDB using testcontainers
const mongoContainer = await new MongoDBContainer("mongo:7").withExposedPorts(27017).start();

// 2. Connect via Mongoose
await mongoose.connect(mongoContainer.getConnectionString(), {
  directConnection: true,
  dbName: "queuert_example",
});

// 3. Define Mongoose model for application data
const userSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
});

const User = mongoose.model("User", userSchema);

// 4. Define job types
const registry = defineJobTypes<{
  send_welcome_email: {
    entry: true;
    input: { odUserId: string; email: string; name: string };
    output: { sentAt: string };
  };
}>();

// 5. Create state provider for Mongoose
// Key: Use mongoose.connection.collection() and getSession for type bridging
// This allows full feature parity (aggregation pipelines with $$NOW)
type DbContext = { session: mongoose.ClientSession };

const stateProvider: MongoStateProvider<DbContext> = {
  getCollection: () =>
    mongoose.connection.collection("queuert_jobs") as unknown as ReturnType<
      MongoStateProvider<DbContext>["getCollection"]
    >,
  getSession: (txContext) => txContext?.session as any,
  runInTransaction: async (fn) => {
    const session = await mongoose.connection.startSession();
    try {
      return await session.withTransaction(async () => fn({ session }));
    } finally {
      await session.endSession();
    }
  },
};

// 6. Create adapters and queuert client/worker
const stateAdapter = await createMongoStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();

const notifyAdapter = createInProcessNotifyAdapter();

const qrtClient = await createQueuertClient({
  stateAdapter,
  notifyAdapter,
  registry,
});

// 7. Create and start qrtWorker
const qrtWorker = await createQueuertInProcessWorker({
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

// 8. Register a new user (via Mongoose) and queue welcome email atomically
const jobChain = await qrtClient.withNotify(async () => {
  const session = await mongoose.connection.startSession();
  try {
    return await session.withTransaction(async () => {
      // Use Mongoose model for application data
      const [user] = await User.create([{ name: "Alice", email: "alice@example.com" }], {
        session,
      });

      // Queue job within same transaction
      return qrtClient.startJobChain({
        session,
        typeName: "send_welcome_email",
        input: {
          odUserId: user._id.toString(),
          email: user.email,
          name: user.name,
        },
      });
    });
  } finally {
    await session.endSession();
  }
});

// 9. Wait for the job chain to complete
const result = await qrtClient.waitForJobChainCompletion(jobChain, { timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// 10. Cleanup
await stopWorker();
await mongoose.disconnect();
await mongoContainer.stop();
