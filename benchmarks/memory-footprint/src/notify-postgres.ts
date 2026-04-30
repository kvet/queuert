/**
 * PostgreSQL Notify Adapter Memory Measurement
 */

import { createPgNotifyAdapter } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { createPostgresJsNotifyProvider } from "example-notify-postgres-postgres-js/provider";
import postgres from "postgres";
import {
  createClient,
  createInProcessStateAdapter,
  createInProcessWorker,
  createProcessors,
  withTransactionHooks,
} from "queuert";

import {
  diffMemory,
  jobTypes,
  measureMemory,
  printHeader,
  runDoubleRunBenchmark,
} from "./utils.js";

printHeader("POSTGRESQL NOTIFY ADAPTER");

type Infra = {
  sql: ReturnType<typeof postgres>;
};

await runDoubleRunBenchmark<Infra>({
  name: "notify-postgres",
  setupInfrastructure: async () => {
    console.log("\nStarting PostgreSQL container...");
    const [beforeContainer, afterContainer, pgContainer] = await measureMemory(async () =>
      new PostgreSqlContainer("postgres:18").withExposedPorts(5432).start(),
    );
    console.log("\nAfter starting container (testcontainers overhead):");
    diffMemory(beforeContainer, afterContainer);

    const [beforeConnection, afterConnection, sql] = await measureMemory(async () =>
      postgres(pgContainer.getConnectionUri(), { max: 10 }),
    );
    console.log("\nAfter creating postgres.js connection:");
    diffMemory(beforeConnection, afterConnection);

    return {
      infra: { sql },
      teardown: async () => {
        await sql.end();
        await pgContainer.stop();
      },
    };
  },
  runLifecycle: async ({ sql }, { step, processStep }) => {
    const stateAdapter = await step("After creating state adapter", async () =>
      createInProcessStateAdapter(),
    );

    const notifyAdapter = await step("After creating notify adapter", async () =>
      createPgNotifyAdapter({ notifyProvider: createPostgresJsNotifyProvider({ sql }) }),
    );

    const setup = await step("After creating client + worker", async () => {
      const client = await createClient({ stateAdapter, notifyAdapter, jobTypes });
      const worker = await createInProcessWorker({
        client,
        processors: createProcessors({
          client,
          jobTypes,
          processors: {
            "test-job": {
              attemptHandler: async ({ complete }) => complete(async () => ({ processed: true })),
            },
          },
        }),
      });
      const stopWorker = await worker.start();
      return { client, stopWorker };
    });

    await processStep("After processing 100 jobs", async () => {
      const promises = [];
      for (let i = 0; i < 100; i++) {
        const chain = await withTransactionHooks(async (transactionHooks) =>
          stateAdapter.withTransaction(async (ctx) =>
            setup.client.startChain({
              ...ctx,
              transactionHooks,
              typeName: "test-job",
              input: { message: `Test message ${i}` },
            }),
          ),
        );
        promises.push(setup.client.awaitChain(chain, { timeoutMs: 5000 }));
      }
      await Promise.all(promises);
    });

    await setup.stopWorker();
    await notifyAdapter.close();
    await stateAdapter.close();
  },
});
