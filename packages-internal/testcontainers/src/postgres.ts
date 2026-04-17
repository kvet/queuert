import { createHash } from "node:crypto";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { type TestAPI, beforeAll } from "vitest";

import { withContainerLock } from "./with-container-lock.js";

export type AcquiredPostgres = {
  connectionString: string;
} & AsyncDisposable;

const containerNameFromImage = (image: string): string =>
  `queuert-postgres-${image.replace(/[^a-z0-9]/gi, "-")}-test`;

const containerPromises = new Map<string, Promise<StartedPostgreSqlContainer>>();

const startContainer = async (image: string): Promise<StartedPostgreSqlContainer> => {
  let promise = containerPromises.get(image);
  if (!promise) {
    const containerName = containerNameFromImage(image);
    promise = withContainerLock({
      containerName,
      start: async () =>
        new PostgreSqlContainer(image)
          .withName(containerName)
          .withDatabase("base_database_for_tests")
          .withLabels({ label: containerName })
          .withExposedPorts(5432)
          .withReuse()
          .start(),
    });
    containerPromises.set(image, promise);
  }
  return promise;
};

export const acquirePostgres = async (
  image: string,
  callerId: string,
): Promise<AcquiredPostgres> => {
  const normalizedId = createHash("sha1").update(callerId).digest("hex");
  const container = await startContainer(image);

  const baseUri = container.getConnectionUri();
  const username = container.getUsername();

  const withAdminClient = async (fn: (client: Client) => Promise<void>): Promise<void> => {
    const client = new Client({ connectionString: baseUri });
    await client.connect();
    try {
      await fn(client);
    } finally {
      await client.end();
    }
  };

  await withAdminClient(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${normalizedId}" WITH (FORCE);`);
    await client.query(
      `CREATE DATABASE "${normalizedId}" WITH OWNER "${username}" TEMPLATE template0`,
    );
  });

  return {
    connectionString: baseUri.replace("base_database_for_tests", normalizedId),
    [Symbol.asyncDispose]: async () => {
      await withAdminClient(async (client) => {
        await client.query(`DROP DATABASE IF EXISTS "${normalizedId}" WITH (FORCE);`);
      });
    },
  };
};

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
    container = await startContainer("postgres:14");
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

        await client.query(`DROP DATABASE IF EXISTS "${normalizedReuseId}" WITH (FORCE);`);
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
