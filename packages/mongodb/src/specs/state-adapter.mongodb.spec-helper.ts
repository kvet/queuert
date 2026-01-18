import { type Collection, MongoClient } from "mongodb";
import { type StateAdapter } from "queuert";
import { createSeededRandom } from "queuert/testing";
import { type TestAPI } from "vitest";
import { createMongoStateAdapter } from "../state-adapter/state-adapter.mongodb.js";
import { createMongoProvider, MongoContext, MongoProvider } from "./state-provider.mongodb.js";

/**
 * Creates a flaky batch generator optimized for MongoDB's async operations.
 * MongoDB operations are slower than SQLite's sync operations, so we use shorter
 * error batches (max 2) to work reliably with 3 retry attempts.
 */
const createMongoFlakyBatchGenerator = (seed: number = 12345): (() => boolean) => {
  const random = createSeededRandom(seed);
  let inErrorBatch = false;
  let batchRemaining = Math.floor(random() * 6) + 3; // First success batch: 3-8

  return () => {
    batchRemaining--;

    if (batchRemaining <= 0) {
      inErrorBatch = !inErrorBatch;
      batchRemaining = inErrorBatch
        ? Math.floor(random() * 2) + 1 // Error batch: 1-2 (fits within 3 retries)
        : Math.floor(random() * 6) + 3; // Success batch: 3-8
    }

    return inErrorBatch;
  };
};

// Creates a proxy that wraps MongoDB collection methods to inject errors
const createFlakyCollection = (
  collection: Collection,
  shouldError: () => boolean,
  onQuery: () => void,
  onError: () => void,
): Collection => {
  const createFlakyMethod = <T extends (...args: unknown[]) => Promise<unknown>>(method: T): T =>
    (async (...args: Parameters<T>) => {
      onQuery();
      if (shouldError()) {
        onError();
        const error = new Error("connection reset") as Error & { code: string };
        error.code = "ECONNRESET";
        throw error;
      }
      return method.apply(collection, args);
    }) as T;

  return new Proxy(collection, {
    get(target, prop) {
      const value = target[prop as keyof Collection];
      if (typeof value === "function") {
        // Wrap async methods that interact with the database
        if (
          [
            "findOne",
            "findOneAndUpdate",
            "findOneAndDelete",
            "findOneAndReplace",
            "find",
            "insertOne",
            "insertMany",
            "updateOne",
            "updateMany",
            "deleteOne",
            "deleteMany",
            "createIndex",
          ].includes(prop as string)
        ) {
          return createFlakyMethod(value.bind(target) as (...args: unknown[]) => Promise<unknown>);
        }
        return value.bind(target);
      }
      return value;
    },
  });
};

export type MongoStateAdapter = StateAdapter<MongoContext, string>;

export const extendWithStateMongodb = <
  T extends {
    mongoConnectionString: string;
  },
>(
  api: TestAPI<T>,
): TestAPI<
  T & {
    mongoClient: MongoClient;
    stateAdapter: StateAdapter<{ $test: true }, string>;
    flakyStateAdapter: StateAdapter<{ $test: true }, string>;
  }
> => {
  const collectionName = "queuert_jobs";

  return api.extend<{
    mongoClient: MongoClient;
    _dbMigrateToLatest: void;
    _dbCleanup: void;
    stateProvider: MongoProvider;
    flakyStateProvider: MongoProvider;
    stateAdapter: MongoStateAdapter;
    flakyStateAdapter: MongoStateAdapter;
  }>({
    mongoClient: [
      async ({ mongoConnectionString }, use) => {
        const client = new MongoClient(mongoConnectionString);
        await client.connect();

        await use(client);

        await client.close();
      },
      { scope: "worker" },
    ],
    _dbMigrateToLatest: [
      async ({ mongoClient, mongoConnectionString }, use) => {
        const dbName = new URL(mongoConnectionString).pathname.slice(1).split("?")[0];
        const db = mongoClient.db(dbName);

        const stateProvider = createMongoProvider({
          client: mongoClient,
          db,
          collectionName,
        });
        const stateAdapter = await createMongoStateAdapter({ stateProvider });

        await stateAdapter.migrateToLatest();

        await use();
      },
      { scope: "worker" },
    ],
    _dbCleanup: [
      async ({ mongoClient, mongoConnectionString }, use) => {
        await use();

        const dbName = new URL(mongoConnectionString).pathname.slice(1).split("?")[0];
        const db = mongoClient.db(dbName);
        await db.collection(collectionName).deleteMany({});
      },
      { scope: "test" },
    ],
    stateProvider: [
      async ({ mongoClient, mongoConnectionString, _dbMigrateToLatest, _dbCleanup }, use) => {
        // oxlint-disable-next-line no-unused-expressions
        _dbMigrateToLatest;
        // oxlint-disable-next-line no-unused-expressions
        _dbCleanup;

        const dbName = new URL(mongoConnectionString).pathname.slice(1).split("?")[0];
        const db = mongoClient.db(dbName);

        return use(createMongoProvider({ client: mongoClient, db, collectionName }));
      },
      { scope: "test" },
    ],
    flakyStateProvider: [
      async ({ stateProvider, expect }, use) => {
        let queryCount = 0;
        let errorCount = 0;
        let enabled = true;
        const shouldErrorBatch = createMongoFlakyBatchGenerator();
        const shouldError = () => enabled && shouldErrorBatch();

        const originalGetCollection = stateProvider.getCollection.bind(stateProvider);
        const flakyStateProvider: typeof stateProvider = {
          ...stateProvider,
          getCollection: (txContext) => {
            const collection = originalGetCollection(txContext);
            return createFlakyCollection(
              collection,
              shouldError,
              () => queryCount++,
              () => errorCount++,
            );
          },
        };

        await use(flakyStateProvider);

        // Disable error generation during cleanup to avoid unhandled rejections
        // from background workers that are still finishing up
        enabled = false;

        // Allow any in-flight MongoDB operations to settle before cleanup continues
        // This prevents unhandled rejections from operations that started before enabled was set to false
        await new Promise((resolve) => setTimeout(resolve, 50));

        if (queryCount > 5) {
          expect(errorCount).toBeGreaterThan(0);
        }
      },
      { scope: "test" },
    ],
    stateAdapter: [
      async ({ stateProvider }, use) => {
        return use(await createMongoStateAdapter({ stateProvider }));
      },
      { scope: "test" },
    ],
    flakyStateAdapter: [
      async ({ flakyStateProvider }, use) => {
        return use(
          await createMongoStateAdapter({
            stateProvider: flakyStateProvider,
            connectionRetryConfig: {
              maxAttempts: 3,
              initialDelayMs: 1,
              multiplier: 1,
              maxDelayMs: 1,
            },
          }),
        );
      },
      { scope: "test" },
    ],
  }) as ReturnType<typeof extendWithStateMongodb<T>>;
};
