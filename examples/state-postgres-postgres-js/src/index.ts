import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { createQrtWorker } from "./qrt-worker.js";
import { createQrt } from "./qrt.js";
import { User } from "./sql-schema.js";
import { createSql, TransactionSql } from "./sql.js";

// 1. Start PostgreSQL using testcontainers
const pgContainer = await new PostgreSqlContainer("postgres:14").withExposedPorts(5432).start();

// 2. Create database connection
const sql = await createSql({
  connectionString: pgContainer.getConnectionUri(),
});

// 3. Create Queuert instance with PostgreSQL state adapter
const qrt = await createQrt({ sql });

// 4. Create and start a worker to process jobs
const qrtWorker = await createQrtWorker({ qrt });
const stopQrtWorker = await qrtWorker.start();

// 5. Create a user and queue a job atomically in the same transaction
//    withNotify() batches notifications and dispatches them after the transaction commits
const jobChain = await qrt.withNotify(async () =>
  sql.begin(async (_sql) => {
    const sql = _sql as TransactionSql;
    const [user] = await sql<User[]>`
      INSERT INTO users (name)
      VALUES ('Alice')
      RETURNING *
    `;

    return qrt.startJobChain({
      sql,
      typeName: "add_pet_to_user",
      input: { userId: user.id, petName: "Fluffy" },
    });
  }),
);

// 6. Wait for the job chain to complete
await qrt.waitForJobChainCompletion(jobChain, { timeoutMs: 1000 });

// 7. Cleanup
await stopQrtWorker();
await sql.end();
await pgContainer.stop();
