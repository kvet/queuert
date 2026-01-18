import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { User } from "./db-schema.js";
import { createDb } from "./db.js";
import { createQrtWorker } from "./qrt-worker.js";
import { createQrt } from "./qrt.js";

// 1. Start PostgreSQL using testcontainers
const pgContainer = await new PostgreSqlContainer("postgres:14").withExposedPorts(5432).start();

// 2. Create database connection
const db = await createDb({
  connectionString: pgContainer.getConnectionUri(),
});

// 3. Create Queuert instance with PostgreSQL state adapter
const qrt = await createQrt({ db });

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
await db.end();
await pgContainer.stop();
