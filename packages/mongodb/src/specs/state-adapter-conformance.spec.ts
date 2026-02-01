import { extendWithMongodb } from "@queuert/testcontainers";
import { MongoClient } from "mongodb";
import { type StateAdapter } from "queuert";
import { stateAdapterConformanceTestSuite } from "queuert/testing";
import { it as baseIt, describe } from "vitest";
import { createMongoStateAdapter } from "../state-adapter/state-adapter.mongodb.js";
import { createMongoProvider } from "./state-provider.mongodb.js";

const it = extendWithMongodb(baseIt, import.meta.url);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

it("index");

describe("MongoDB State Adapter Conformance - Default Config", () => {
  const collectionName = "queuert_jobs";

  const conformanceIt = it.extend<{
    mongoClient: MongoClient;
    stateAdapter: StateAdapter<{ $test: true }, string>;
    validateId: (id: string) => boolean;
  }>({
    mongoClient: [
      async ({ mongoConnectionString }, use) => {
        const client = new MongoClient(mongoConnectionString);
        await client.connect();
        await use(client);
        await client.close();
      },
      { scope: "test" },
    ],
    stateAdapter: [
      async ({ mongoClient, mongoConnectionString }, use) => {
        const dbName = new URL(mongoConnectionString).pathname.slice(1).split("?")[0];
        const db = mongoClient.db(dbName);
        await db.collection(collectionName).deleteMany({});

        const stateProvider = createMongoProvider({ client: mongoClient, db, collectionName });
        const adapter = await createMongoStateAdapter({ stateProvider });
        await adapter.migrateToLatest();
        return use(adapter as unknown as StateAdapter<{ $test: true }, string>);
      },
      { scope: "test" },
    ],
    validateId: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => use((id: string) => UUID_PATTERN.test(id)),
      { scope: "test" },
    ],
  });

  stateAdapterConformanceTestSuite({ it: conformanceIt as any });
});

describe("MongoDB State Adapter Conformance - Custom Collection Name", () => {
  const collectionName = "myapp_jobs";

  const conformanceIt = it.extend<{
    mongoClient: MongoClient;
    stateAdapter: StateAdapter<{ $test: true }, string>;
    validateId: (id: string) => boolean;
  }>({
    mongoClient: [
      async ({ mongoConnectionString }, use) => {
        const client = new MongoClient(mongoConnectionString);
        await client.connect();
        await use(client);
        await client.close();
      },
      { scope: "test" },
    ],
    stateAdapter: [
      async ({ mongoClient, mongoConnectionString }, use) => {
        const dbName = new URL(mongoConnectionString).pathname.slice(1).split("?")[0];
        const db = mongoClient.db(dbName);
        await db.collection(collectionName).deleteMany({});

        const stateProvider = createMongoProvider({ client: mongoClient, db, collectionName });
        const adapter = await createMongoStateAdapter({ stateProvider });
        await adapter.migrateToLatest();
        return use(adapter as unknown as StateAdapter<{ $test: true }, string>);
      },
      { scope: "test" },
    ],
    validateId: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => use((id: string) => UUID_PATTERN.test(id)),
      { scope: "test" },
    ],
  });

  stateAdapterConformanceTestSuite({ it: conformanceIt as any });
});

describe("MongoDB State Adapter Conformance - Custom ID Generator", () => {
  const collectionName = "queuert_jobs_custom_id";
  let idCounter = 0;
  const idGenerator = () => `custom-${Date.now()}-${idCounter++}`;

  const conformanceIt = it.extend<{
    mongoClient: MongoClient;
    stateAdapter: StateAdapter<{ $test: true }, string>;
    validateId: (id: string) => boolean;
  }>({
    mongoClient: [
      async ({ mongoConnectionString }, use) => {
        const client = new MongoClient(mongoConnectionString);
        await client.connect();
        await use(client);
        await client.close();
      },
      { scope: "test" },
    ],
    stateAdapter: [
      async ({ mongoClient, mongoConnectionString }, use) => {
        const dbName = new URL(mongoConnectionString).pathname.slice(1).split("?")[0];
        const db = mongoClient.db(dbName);
        await db.collection(collectionName).deleteMany({});

        const stateProvider = createMongoProvider({ client: mongoClient, db, collectionName });
        const adapter = await createMongoStateAdapter({ stateProvider, idGenerator });
        await adapter.migrateToLatest();
        return use(adapter as unknown as StateAdapter<{ $test: true }, string>);
      },
      { scope: "test" },
    ],
    validateId: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => use((id: string) => id.startsWith("custom-")),
      { scope: "test" },
    ],
  });

  stateAdapterConformanceTestSuite({ it: conformanceIt as any });
});
