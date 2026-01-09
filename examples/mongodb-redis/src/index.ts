import { MongoDBContainer } from "@testcontainers/mongodb";
import { RedisContainer } from "@testcontainers/redis";
import { createDb } from "./db.js";
import { createQrtWorker } from "./qrt-worker.js";
import { createQrt } from "./qrt.js";
import { createRedis } from "./redis.js";

// 1. Start infrastructure using testcontainers
const mongoContainer = await new MongoDBContainer("mongo:7").withExposedPorts(27017).start();
const redisContainer = await new RedisContainer("redis:6").withExposedPorts(6379).start();

// 2. Create database and Redis connections
const dbConnection = await createDb({
  connectionString: mongoContainer.getConnectionString() + "?directConnection=true",
});
const redis = await createRedis({
  url: redisContainer.getConnectionUrl(),
});
// Separate Redis client for subscriptions (node-redis requires dedicated clients for pub/sub)
const redisSubscription = await createRedis({
  url: redisContainer.getConnectionUrl(),
});

// 3. Create Queuert instance with MongoDB state adapter and Redis notify adapter
const qrt = await createQrt({ dbConnection, redis, redisSubscription });

// 4. Create and start a worker to process jobs
const qrtWorker = await createQrtWorker({ qrt, dbConnection });
const stopQrtWorker = await qrtWorker.start();

// 5. Create a user and queue a job atomically in the same transaction
//    withNotify() batches notifications and dispatches them after the transaction commits
const jobSequence = await qrt.withNotify(async () => {
  const session = dbConnection.client.startSession();
  try {
    return await session.withTransaction(async () => {
      const userResult = await dbConnection.users.insertOne({ name: "Alice" }, { session });

      return qrt.startJobSequence({
        session,
        typeName: "add_pet_to_user",
        input: { userId: userResult.insertedId.toHexString(), petName: "Fluffy" },
      });
    });
  } finally {
    await session.endSession();
  }
});

// 6. Wait for the job sequence to complete
await qrt.waitForJobSequenceCompletion(jobSequence, { timeoutMs: 1000 });

// 7. Cleanup
await stopQrtWorker();
await redis.close();
await redisSubscription.close();
await dbConnection.client.close();
await redisContainer.stop();
await mongoContainer.stop();
