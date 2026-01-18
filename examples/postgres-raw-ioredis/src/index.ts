import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer } from "@testcontainers/redis";
import { User } from "./db-schema.js";
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
const redis = createRedis({
  url: redisContainer.getConnectionUrl(),
});
// Separate Redis client for subscriptions (ioredis requires dedicated clients for pub/sub)
const redisSubscription = createRedis({
  url: redisContainer.getConnectionUrl(),
});

// 3. Create Queuert instance with PostgreSQL state adapter and Redis notify adapter
const qrt = await createQrt({ db, redis, redisSubscription });

// 4. Create and start a worker to process jobs
const qrtWorker = await createQrtWorker({ qrt });
const stopQrtWorker = await qrtWorker.start();

// 5. Create a user and queue a job atomically in the same transaction
//    withNotify() batches notifications and dispatches them after the transaction commits
const jobChain = await qrt.withNotify(async () => {
  const poolClient = await db.connect();
  try {
    await poolClient.query("BEGIN");

    const userResult = await poolClient.query<User>(
      "INSERT INTO users (name) VALUES ($1) RETURNING *",
      ["Alice"],
    );
    const user = userResult.rows[0];

    const result = await qrt.startJobChain({
      poolClient,
      typeName: "add_pet_to_user",
      input: { userId: user.id, petName: "Fluffy" },
    });

    await poolClient.query("COMMIT");
    return result;
  } catch (error) {
    await poolClient.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    poolClient.release();
  }
});

// 6. Wait for the job chain to complete
await qrt.waitForJobChainCompletion(jobChain, { timeoutMs: 1000 });

// 7. Cleanup
await stopQrtWorker();
await redis.quit();
await redisSubscription.quit();
await db.end();
await redisContainer.stop();
await pgContainer.stop();
