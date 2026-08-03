import { createHash } from "node:crypto";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { type TestAPI, beforeAll } from "vitest";

import { withContainerLock } from "./with-container-lock.js";

export type AcquiredPostgres = {
  connectionString: string;
  // --disable-triggers lets the dump reload regardless of row order despite self-referential FKs
  dumpData: (tables: string[]) => Promise<string>;
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
    dumpData: async (tables: string[]): Promise<string> => {
      const result = await container.exec(
        [
          "pg_dump",
          "-h",
          "127.0.0.1",
          "-U",
          username,
          "-d",
          normalizedId,
          "--data-only",
          "--inserts",
          "--disable-triggers",
          ...tables.flatMap((t) => ["-t", t]),
        ],
        { env: { PGPASSWORD: container.getPassword() } },
      );
      if (result.exitCode !== 0) {
        throw new Error(`pg_dump exited ${result.exitCode}: ${result.stderr}`);
      }
      return result.stdout;
    },
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
  // `it.extend()` gives every derived API its own worker fixture context, so a spec whose suites
  // extend the API resolve this fixture once per context. Each resolution gets its own database so a
  // later one never force-drops a database an earlier one still holds connections to. Dropping is
  // left to the next run's provisioning: a drop on teardown would race the pools closing alongside
  // it and reintroduce the very termination this avoids.
  let contextCount = 0;

  const provisionDatabase = async (databaseName: string): Promise<string> => {
    const client = new Client({
      connectionString: container.getConnectionUri(),
    });

    await client.connect();

    try {
      await client.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE);`);
      await client.query(
        `CREATE DATABASE "${databaseName}" WITH OWNER "${container.getUsername()}" TEMPLATE template0`,
      );
    } finally {
      await client.end();
    }

    return container.getConnectionUri().replace("base_database_for_tests", databaseName);
  };

  beforeAll(async () => {
    container = await startContainer("postgres:14");
  }, 60_000);

  return api.extend<{
    postgresConnectionString: string;
  }>({
    postgresConnectionString: [
      // eslint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await use(await provisionDatabase(`${normalizedReuseId}_${contextCount++}`));
      },
      { scope: "worker" },
    ],
  }) as unknown as TestAPI<
    T & {
      postgresConnectionString: string;
    }
  >;
};
