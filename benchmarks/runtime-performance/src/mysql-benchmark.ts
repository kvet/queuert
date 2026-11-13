/**
 * MySQL / MariaDB State Adapter Measurement, shared by state-mysql.ts and state-mariadb.ts
 */

import { createMysqlStateAdapter } from "@queuert/mysql";
import { createMysql2PoolStateProvider } from "example-state-mysql-mysql2/provider";
import { type Pool, createPool } from "mysql2/promise";
import { createClient, createWorkerRunner, createProcessors } from "queuert";
import { GenericContainer, Wait } from "testcontainers";

import {
  createCompletionCounter,
  diffMemory,
  jobTypes,
  measureMemory,
  printHeader,
  runDoubleRunBenchmark,
} from "./utils.ts";

type Infra = {
  pool: Pool;
  stateProvider: ReturnType<typeof createMysql2PoolStateProvider>;
};

export const runMysqlBenchmark = async ({
  name,
  image,
  dialect,
}: {
  name: string;
  image: string;
  dialect: "mysql" | "mariadb";
}): Promise<void> => {
  printHeader(`${dialect === "mysql" ? "MYSQL" : "MARIADB"} STATE ADAPTER`);

  await runDoubleRunBenchmark<Infra>({
    name,
    setupInfrastructure: async () => {
      console.log(`\nStarting ${image} container...`);
      const [beforeContainer, afterContainer, mysqlContainer] = await measureMemory(async () =>
        new GenericContainer(image)
          .withEnvironment({
            MYSQL_ROOT_PASSWORD: "bench",
            MYSQL_DATABASE: "bench",
            MARIADB_ROOT_PASSWORD: "bench",
            MARIADB_DATABASE: "bench",
          })
          .withCommand(["--log-bin=binlog", "--sync-binlog=1"])
          .withExposedPorts(3306)
          .withWaitStrategy(Wait.forLogMessage(/port: 3306/))
          .withStartupTimeout(180_000)
          .start(),
      );
      console.log("\nAfter starting container (testcontainers overhead):");
      diffMemory(beforeContainer, afterContainer);

      const [beforeConnection, afterConnection, pool] = await measureMemory(async () =>
        createPool({
          host: mysqlContainer.getHost(),
          port: mysqlContainer.getMappedPort(3306),
          user: "root",
          password: "bench",
          database: "bench",
          connectionLimit: 10,
        }),
      );
      console.log("\nAfter creating mysql2 pool:");
      diffMemory(beforeConnection, afterConnection);

      const stateProvider = createMysql2PoolStateProvider({ pool });

      return {
        infra: { pool, stateProvider },
        teardown: async () => {
          await pool.end();
          await mysqlContainer.stop();
        },
      };
    },
    runLifecycle: async ({ stateProvider }, { step, processStep, jobCount }) => {
      const completions = createCompletionCounter(jobCount);

      const stateAdapter = await step(
        "After creating state adapter (with migrations)",
        async () => {
          const adapter = createMysqlStateAdapter({ stateProvider, dialect });
          await adapter.migrateToLatest();
          return adapter;
        },
      );

      const setup = await step("After creating client + worker", async () => {
        const client = createClient({ stateAdapter, jobTypes });
        const workerRunner = createWorkerRunner({
          client,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              "test-job": {
                attemptHandler: async ({ complete }) => {
                  const result = await stateProvider.withTransaction(async (ctx) =>
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
          await stateProvider.withTransaction(async (ctx) =>
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
      await stateAdapter.close();
    },
  });
};
