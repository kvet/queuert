import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { createPrisma } from "./prisma.js";
import { createQrtWorker } from "./qrt-worker.js";
import { createQrt } from "./qrt.js";

// 1. Start PostgreSQL using testcontainers
const pgContainer = await new PostgreSqlContainer("postgres:14").withExposedPorts(5432).start();

// 2. Create Prisma connection
const prisma = await createPrisma({
  connectionString: pgContainer.getConnectionUri(),
});

// 3. Create Queuert instance with PostgreSQL state adapter
const qrt = await createQrt({ prisma });

// 4. Create and start a worker to process jobs
const qrtWorker = await createQrtWorker({ qrt });
const stopQrtWorker = await qrtWorker.start();

// 5. Create a user and queue a job atomically in the same transaction
//    withNotify() batches notifications and dispatches them after the transaction commits
const jobChain = await qrt.withNotify(async () =>
  prisma.$transaction(async (prisma) => {
    const user = await prisma.user.create({
      data: { name: "Alice" },
    });

    return qrt.startJobChain({
      prisma,
      typeName: "add_pet_to_user",
      input: { userId: user.id, petName: "Fluffy" },
    });
  }),
);

// 6. Wait for the job chain to complete
await qrt.waitForJobChainCompletion(jobChain, { timeoutMs: 1000 });

// 7. Cleanup
await stopQrtWorker();
await prisma.$disconnect();
await pgContainer.stop();
