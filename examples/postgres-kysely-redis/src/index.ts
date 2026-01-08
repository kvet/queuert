import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer } from "@testcontainers/redis";
import { createDb } from "./db.js";
import { createQrtWorker } from "./qrt-worker.js";
import { createQrt } from "./qrt.js";
import { createRedis } from "./redis.js";

// 1. Start infrastructure using testcontainers
const pgContainer = await new PostgreSqlContainer("postgres:14").withExposedPorts(5432).start();
const redisContainer = await new RedisContainer("redis:6").withExposedPorts(6379).start();

// 2. Create database and Redis connections
const db = await createDb({
  connectionString: pgContainer.getConnectionUri(),
});
const redis = await createRedis({
  url: redisContainer.getConnectionUrl(),
});
// Separate Redis client for subscriptions (node-redis requires dedicated clients for pub/sub)
const redisSubscription = await createRedis({
  url: redisContainer.getConnectionUrl(),
});

// 3. Create Queuert instance with PostgreSQL state adapter and Redis notify adapter
const qrt = await createQrt({ db, redis, redisSubscription });

// 4. Create and start a worker to process jobs
const qrtWorker = await createQrtWorker({ qrt });
const stopQrtWorker = await qrtWorker.start();

// 5. Create a user and queue a job atomically in the same transaction
//    withNotify() batches notifications and dispatches them after the transaction commits
const jobSequence = await qrt.withNotify(async () =>
  db.transaction().execute(async (db) => {
    const user = await db
      .insertInto("users")
      .values({ name: "Alice" })
      .returningAll()
      .executeTakeFirstOrThrow();

    return qrt.startJobSequence({
      db,
      typeName: "add_pet_to_user",
      input: { userId: user.id, petName: "Fluffy" },
    });
  }),
);

// 6. Wait for the job sequence to complete
await qrt.waitForJobSequenceCompletion({ ...jobSequence, timeoutMs: 1000 });

// 7. Cleanup
await stopQrtWorker();
await redis.close();
await redisSubscription.close();
await db.destroy();
await redisContainer.stop();
await pgContainer.stop();

process.exit(0);
