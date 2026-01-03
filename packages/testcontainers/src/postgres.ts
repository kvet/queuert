import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createHash } from "crypto";
import { Client } from "pg";
import { beforeAll, TestAPI } from "vitest";
import { withContainerLock } from "./with-container-lock.js";

const CONTAINER_NAME = "queuert-postgres-test";

export const extendWithPostgres = <T>(
  api: TestAPI<T>,
  reuseId: string,
): TestAPI<
  T & {
    postgresConnectionString: string;
  }
> => {
  const normalizedReuseId = createHash("sha1").update(reuseId).digest("hex");

  let container: StartedPostgreSqlContainer;

  beforeAll(async () => {
    container = await withContainerLock({
      containerName: CONTAINER_NAME,
      start: async () =>
        new PostgreSqlContainer("postgres:14")
          .withName(CONTAINER_NAME)
          .withDatabase("base_database_for_tests")
          .withLabels({
            label: CONTAINER_NAME,
          })
          .withExposedPorts(5432)
          .withReuse()
          .start(),
    });
  }, 60_000);

  return api.extend<{
    postgresConnectionString: string;
  }>({
    postgresConnectionString: [
      // eslint-disable-next-line no-empty-pattern
      async ({}, use) => {
        const client = new Client({
          connectionString: container.getConnectionUri(),
        });

        await client.connect();

        await client.query(`DROP DATABASE IF EXISTS "${normalizedReuseId}";`);
        await client.query(
          `CREATE DATABASE "${normalizedReuseId}" WITH OWNER "${container.getUsername()}" TEMPLATE template0`,
        );

        await client.end();

        await use(
          container.getConnectionUri().replace("base_database_for_tests", normalizedReuseId),
        );
      },
      { scope: "worker" },
    ],
  }) as unknown as TestAPI<
    T & {
      postgresConnectionString: string;
    }
  >;
};
