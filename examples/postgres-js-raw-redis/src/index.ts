import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer } from "@testcontainers/redis";
import { createQrtWorker } from "./qrt-worker.js";
import { createQrt } from "./qrt.js";
import { createRedis } from "./redis.js";
import { User } from "./sql-schema.js";
import { createSql, TransactionSql } from "./sql.js";

// 1. Start infrastructure using testcontainers
const pgContainer = await new PostgreSqlContainer("postgres:14").withExposedPorts(5432).start();
const redisContainer = await new RedisContainer("redis:6").withExposedPorts(6379).start();

// 2. Create database and Redis connections
const sql = await createSql({
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
const qrt = await createQrt({ sql, redis, redisSubscription });

// 4. Create and start a worker to process jobs
const qrtWorker = await createQrtWorker({ qrt });
const stopQrtWorker = await qrtWorker.start();

// 5. Create a user and queue a job atomically in the same transaction
//    withNotify() batches notifications and dispatches them after the transaction commits
const jobSequence = await qrt.withNotify(async () =>
  sql.begin(async (_sql) => {
    const sql = _sql as TransactionSql;
    const [user] = await sql<User[]>`
      INSERT INTO users (name)
      VALUES ('Alice')
      RETURNING *
    `;

    return qrt.startJobSequence({
      sql,
      typeName: "add_pet_to_user",
      input: { userId: user.id, petName: "Fluffy" },
    });
  }),
);

// 6. Wait for the job sequence to complete
await qrt.waitForJobSequenceCompletion(jobSequence, { timeoutMs: 1000 });

// 7. Cleanup
await stopQrtWorker();
await redis.close();
await redisSubscription.close();
await sql.end();
await redisContainer.stop();
await pgContainer.stop();
