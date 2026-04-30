/**
 * PostgreSQL State Adapter Memory Measurement
 */

import { createPgStateAdapter } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { createPostgresJsStateProvider } from "example-state-postgres-postgres-js/provider";
import postgres from "postgres";
import {
  createClient,
  createInProcessNotifyAdapter,
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

printHeader("POSTGRESQL STATE ADAPTER");

type Infra = {
  sql: ReturnType<typeof postgres>;
  stateProvider: ReturnType<typeof createPostgresJsStateProvider>;
};

await runDoubleRunBenchmark<Infra>({
  name: "state-postgres",
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

    const stateProvider = createPostgresJsStateProvider({ sql });

    return {
      infra: { sql, stateProvider },
      teardown: async () => {
        await sql.end();
        await pgContainer.stop();
      },
    };
  },
  runLifecycle: async ({ stateProvider }, { step, processStep }) => {
    const notifyAdapter = await step("After creating notify adapter", async () =>
      createInProcessNotifyAdapter(),
    );

    const stateAdapter = await step("After creating state adapter (with migrations)", async () => {
      const adapter = await createPgStateAdapter({ stateProvider, schema: "public" });
      await adapter.migrateToLatest();
      return adapter;
    });

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
          stateProvider.withTransaction(async (ctx) =>
            setup.client.startChain({
              ...ctx,
              transactionHooks,
              typeName: "test-job",
              input: { message: `Test message ${i}` },
            }),
          ),
        );
        promises.push(setup.client.awaitChain(chain, { timeoutMs: 30000 }));
      }
      await Promise.all(promises);
    });

    await setup.stopWorker();
    await stateAdapter.close();
    await notifyAdapter.close();
  },
});
