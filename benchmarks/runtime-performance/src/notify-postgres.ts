/**
 * PostgreSQL Notify Adapter Memory Measurement
 */

import { createPgNotifyAdapter } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { createPostgresJsNotifyProvider } from "example-notify-postgres-postgres-js/provider";
import postgres from "postgres";
import {
  createClient,
  createWorkerRunner,
  createProcessors,
  createInProcessStateAdapter,
} from "queuert";

import {
  createCompletionCounter,
  diffMemory,
  jobTypes,
  measureMemory,
  printHeader,
  runDoubleRunBenchmark,
} from "./utils.ts";

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
  runLifecycle: async ({ sql }, { step, processStep, jobCount }) => {
    const completions = createCompletionCounter(jobCount);

    const stateAdapter = await step("After creating state adapter", async () =>
      createInProcessStateAdapter(),
    );

    const notifyAdapter = await step("After creating notify adapter", async () =>
      createPgNotifyAdapter({ notifyProvider: createPostgresJsNotifyProvider({ sql }) }),
    );

    const setup = await step("After creating client + worker", async () => {
      const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
      const workerRunner = createWorkerRunner({
        client,
        processors: createProcessors({
          client,
          jobTypes,
          processors: {
            "test-job": {
              attemptHandler: async ({ complete }) => {
                const result = await stateAdapter.withTransaction(async (ctx) =>
                  complete({ ...ctx, output: { processed: true } }),
                );
                completions.record();
                return result;
              },
            },
          },
        }),
      });
      await workerRunner.start();
      return { client, workerRunner };
    });

    await processStep(`After processing ${jobCount} jobs`, async () => {
      for (let i = 0; i < jobCount; i++) {
        await stateAdapter.withTransaction(async (ctx) =>
          setup.client.createChain({
            ...ctx,
            typeName: "test-job",
            input: { message: `Test message ${i}` },
          }),
        );
      }
      await completions.done;
    });

    await setup.workerRunner.close();
    await notifyAdapter.close();
    await stateAdapter.close();
  },
});
