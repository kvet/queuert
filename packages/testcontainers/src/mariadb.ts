import { MySqlContainer, type StartedMySqlContainer } from "@testcontainers/mysql";
import { createHash } from "node:crypto";
import mysql from "mysql2/promise";
import { type TestAPI, beforeAll } from "vitest";
import { withContainerLock } from "./with-container-lock.js";

const CONTAINER_NAME = "queuert-mariadb-test";

export const extendWithMariadb = <T>(
  api: TestAPI<T>,
  reuseId: string,
): TestAPI<
  T & {
    mariadbConnectionString: string;
  }
> => {
  const normalizedReuseId = createHash("sha1").update(reuseId).digest("hex").slice(0, 20);

  let container: StartedMySqlContainer;

  beforeAll(async () => {
    container = await withContainerLock({
      containerName: CONTAINER_NAME,
      start: async () =>
        new MySqlContainer("mariadb:10.6")
          .withName(CONTAINER_NAME)
          .withDatabase("base_database_for_tests")
          .withLabels({
            label: CONTAINER_NAME,
          })
          .withExposedPorts(3306)
          .withReuse()
          .start(),
    });
  }, 60_000);

  return api.extend<{
    mariadbConnectionString: string;
  }>({
    mariadbConnectionString: [
      // eslint-disable-next-line no-empty-pattern
      async ({}, use) => {
        // Use root to create database and grant permissions
        const rootConnection = await mysql.createConnection({
          host: container.getHost(),
          port: container.getPort(),
          user: "root",
          password: container.getRootPassword(),
        });

        await rootConnection.query(`DROP DATABASE IF EXISTS \`${normalizedReuseId}\``);
        await rootConnection.query(`CREATE DATABASE \`${normalizedReuseId}\``);
        await rootConnection.query(
          `GRANT ALL PRIVILEGES ON \`${normalizedReuseId}\`.* TO '${container.getUsername()}'@'%'`,
        );
        await rootConnection.query(`FLUSH PRIVILEGES`);

        await rootConnection.end();

        const connectionString = `mysql://${container.getUsername()}:${container.getUserPassword()}@${container.getHost()}:${container.getPort()}/${normalizedReuseId}`;

        await use(connectionString);
      },
      { scope: "worker" },
    ],
  }) as unknown as TestAPI<
    T & {
      mariadbConnectionString: string;
    }
  >;
};
