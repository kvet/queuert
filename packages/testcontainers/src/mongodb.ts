import { MongoDBContainer, type StartedMongoDBContainer } from "@testcontainers/mongodb";
import { createHash } from "node:crypto";
import { MongoClient } from "mongodb";
import { type TestAPI, beforeAll } from "vitest";
import { withContainerLock } from "./with-container-lock.js";

const CONTAINER_NAME = "queuert-mongodb-test";

export const extendWithMongodb = <T>(
  api: TestAPI<T>,
  reuseId: string,
): TestAPI<
  T & {
    mongoConnectionString: string;
  }
> => {
  const normalizedReuseId = createHash("sha1").update(reuseId).digest("hex").slice(0, 16);

  let container: StartedMongoDBContainer;

  beforeAll(async () => {
    container = await withContainerLock({
      containerName: CONTAINER_NAME,
      start: async () =>
        new MongoDBContainer("mongo:7")
          .withName(CONTAINER_NAME)
          .withLabels({
            label: CONTAINER_NAME,
          })
          .withExposedPorts(27017)
          .withReuse()
          .start(),
    });
  }, 60_000);

  return api.extend<{
    mongoConnectionString: string;
  }>({
    mongoConnectionString: [
      // eslint-disable-next-line no-empty-pattern
      async ({}, use) => {
        // Create a unique database for this worker
        const dbName = `queuert_test_${normalizedReuseId}`;
        // Use directConnection=true to avoid replica set member resolution issues
        const connectionString = `mongodb://127.0.0.1:${container.getMappedPort(27017)}/${dbName}?directConnection=true`;

        // Clean up the database before use
        const client = new MongoClient(connectionString);
        await client.connect();
        await client.db(dbName).dropDatabase();
        await client.close();

        await use(connectionString);
      },
      { scope: "worker" },
    ],
  }) as unknown as TestAPI<
    T & {
      mongoConnectionString: string;
    }
  >;
};
