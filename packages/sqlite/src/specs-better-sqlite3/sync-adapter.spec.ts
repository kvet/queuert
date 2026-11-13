import Database from "better-sqlite3";
import {
  createClient,
  createProcessors,
  createWorkerRunner,
  defineJobTypes,
  withTxHooks,
} from "queuert";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { createSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.ts";
import { withBetterSqlite3Savepoint } from "../state-provider/state-provider.better-sqlite3.spec-helper.ts";
import { createBetterSqlite3Provider } from "../state-provider/state-provider.better-sqlite3.ts";

const jobTypes = defineJobTypes<{
  "send-email": {
    entry: true;
    input: { userId: number };
    output: { sentAt: string };
  };
  approval: {
    entry: true;
    input: { amount: number };
    continueWith: { typeName: "process-approved" };
  };
  "process-approved": {
    input: { amount: number };
    output: { processed: boolean };
  };
}>();

const createTestStateAdapter = (db: Database.Database) =>
  createSqliteStateAdapter({ stateProvider: createBetterSqlite3Provider({ db, mode: "sync" }) });

type TestStateAdapter = ReturnType<typeof createTestStateAdapter>;

const createTestClient = (stateAdapter: TestStateAdapter) =>
  createClient({ stateAdapter, jobTypes });

const syncIt = it.extend<{
  db: Database.Database;
  stateAdapter: TestStateAdapter;
  client: ReturnType<typeof createTestClient>;
}>({
  db: [
    // oxlint-disable-next-line no-empty-pattern -- vitest fixtures must destructure their context
    async ({}, use) => {
      const db = new Database(":memory:");
      db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL)");
      await use(db);
      db.close();
    },
    { scope: "test" },
  ],
  stateAdapter: [
    async ({ db }, use) => {
      const stateAdapter = createTestStateAdapter(db);
      stateAdapter.migrateToLatest();
      await use(stateAdapter);
    },
    { scope: "test" },
  ],
  client: [
    async ({ stateAdapter }, use) => {
      await use(createTestClient(stateAdapter));
    },
    { scope: "test" },
  ],
});

const countUsers = (db: Database.Database): number =>
  (db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count;

describe("client over a sync SQLite adapter on better-sqlite3", () => {
  syncIt(
    "creates a chain inside the driver's native transaction and reads it back",
    ({ client, db }) => {
      const insertUser = db.prepare("INSERT INTO users (email) VALUES (?) RETURNING id");

      const chain = withTxHooks((txHooks) =>
        db.transaction(() => {
          const user = insertUser.get("alice@example.com") as { id: number };
          return client.createChain({
            db,
            txHooks,
            typeName: "send-email",
            input: { userId: user.id },
          });
        })(),
      );

      expect(countUsers(db)).toBe(1);
      expect(client.getChain({ id: chain.id })).toMatchObject({
        id: chain.id,
        status: "running",
        input: { userId: 1 },
      });
    },
  );

  syncIt(
    "rolls back the app's writes and the chain together when the native transaction throws",
    ({ client, db }) => {
      const insertUser = db.prepare("INSERT INTO users (email) VALUES (?) RETURNING id");

      expect(() =>
        withTxHooks((txHooks) =>
          db.transaction(() => {
            const user = insertUser.get("bob@example.com") as { id: number };
            client.createChain({ db, txHooks, typeName: "send-email", input: { userId: user.id } });
            throw new Error("rollback");
          })(),
        ),
      ).toThrow("rollback");

      expect(countUsers(db)).toBe(0);
      expect(client.getJobTypeNames()).toEqual([]);
    },
  );

  syncIt(
    "throws on a read without a context inside the caller's own transaction",
    ({ client, db }) => {
      expect(() => db.transaction(() => client.getJobTypeNames())()).toThrow(
        "pass that transaction's context",
      );
      expect(db.transaction(() => client.getJobTypeNames({ db }))()).toEqual([]);
    },
  );

  syncIt("infers completeChain's result inside db.transaction", ({ client, db }) => {
    const chain = withTxHooks((txHooks) =>
      db.transaction(() =>
        client.createChain({ db, txHooks, typeName: "approval", input: { amount: 3 } }),
      )(),
    );

    const completed = withTxHooks((txHooks) =>
      db.transaction(() =>
        client.completeChain({
          db,
          txHooks,
          typeName: "approval",
          id: chain.id,
          handler: ({ job, completeJob }) => {
            if (job.typeName !== "approval") return;
            const continuation = completeJob(job, ({ complete }) =>
              complete({
                continueWith: { typeName: "process-approved", input: { amount: job.input.amount } },
              }),
            );
            return completeJob(continuation, ({ complete }) =>
              complete({ output: { processed: true } }),
            );
          },
        }),
      )(),
    );

    expectTypeOf(completed).not.toBeUnknown();
    expect(completed).toMatchObject({ status: "completed", output: { processed: true } });
  });

  syncIt(
    "runs a worker whose complete joins the driver's native transaction",
    async ({ client, stateAdapter, db }) => {
      const markSent = db.prepare("UPDATE users SET email = email || '!' WHERE id = ?");
      const processors = createProcessors({
        client,
        jobTypes,
        processors: {
          "send-email": {
            attemptHandler: async ({ job, complete }) => {
              await Promise.resolve();
              return withTxHooks((txHooks) =>
                db.transaction(() => {
                  markSent.run(job.input.userId);
                  return complete({ db, txHooks, output: { sentAt: "now" } });
                })(),
              );
            },
          },
        },
      });
      await using workerRunner = createWorkerRunner({
        client,
        processors,
        pollIntervalMs: 60_000,
      });

      await workerRunner.start();
      const chain = withTxHooks((txHooks) =>
        db.transaction(() => {
          const user = db
            .prepare("INSERT INTO users (email) VALUES (?) RETURNING id")
            .get("carol@example.com") as { id: number };
          return client.createChain({
            db,
            txHooks,
            typeName: "send-email",
            input: { userId: user.id },
          });
        })(),
      );

      await expect(client.awaitChain(chain, { timeoutMs: 5000 })).resolves.toMatchObject({
        output: { sentAt: "now" },
      });

      expect(db.prepare("SELECT email FROM users").get()).toEqual({
        email: "carol@example.com!",
      });
      await workerRunner.stop();
      expect(stateAdapter.countWorkers({})).toEqual({ live: 0, expired: 0 });
    },
  );

  syncIt(
    "reschedules the attempt when complete rolls back in a savepoint",
    async ({ client, db }) => {
      await using workerRunner = createWorkerRunner({
        client,
        processors: createProcessors({
          client,
          jobTypes,
          backoffConfig: { initialDelayMs: 60_000, multiplier: 1, maxDelayMs: 60_000 },
          processors: {
            "send-email": {
              attemptHandler: async ({ complete }) =>
                withTxHooks((txHooks) =>
                  db.transaction(() => {
                    let receipt: ReturnType<typeof complete> | undefined;
                    try {
                      withBetterSqlite3Savepoint({ db, txHooks }, (savepointCtx) => {
                        receipt = complete({ ...savepointCtx, output: { sentAt: "savepoint" } });
                        throw new Error("rollback to savepoint");
                      });
                    } catch {}
                    return receipt!;
                  })(),
                ),
            },
          },
        }),
        pollIntervalMs: 60_000,
      });
      const chain = withTxHooks((txHooks) =>
        db.transaction(() =>
          client.createChain({ db, txHooks, typeName: "send-email", input: { userId: 1 } }),
        )(),
      );

      await workerRunner.start();
      await vi.waitFor(
        () => {
          expect(client.getJob({ id: chain.id })).toMatchObject({ status: "pending", attempt: 1 });
        },
        { timeout: 5000 },
      );
      await workerRunner.close();

      expect(client.getJob({ id: chain.id })?.lastAttemptError).toContain(
        "Attempt handler returned without a committed `complete` call",
      );
    },
  );

  syncIt(
    "commits the complete call made after one rolled back in a savepoint",
    async ({ client, db }) => {
      await using workerRunner = createWorkerRunner({
        client,
        processors: createProcessors({
          client,
          jobTypes,
          processors: {
            "send-email": {
              attemptHandler: async ({ complete }) =>
                withTxHooks((txHooks) =>
                  db.transaction(() => {
                    try {
                      withBetterSqlite3Savepoint({ db, txHooks }, (savepointCtx) => {
                        complete({ ...savepointCtx, output: { sentAt: "savepoint" } });
                        throw new Error("rollback to savepoint");
                      });
                    } catch {}
                    return complete({ db, txHooks, output: { sentAt: "transaction" } });
                  })(),
                ),
            },
          },
        }),
        pollIntervalMs: 60_000,
      });
      const chain = withTxHooks((txHooks) =>
        db.transaction(() =>
          client.createChain({ db, txHooks, typeName: "send-email", input: { userId: 1 } }),
        )(),
      );

      await workerRunner.start();
      await expect(client.awaitChain(chain, { timeoutMs: 5000 })).resolves.toMatchObject({
        output: { sentAt: "transaction" },
      });
      await workerRunner.close();

      expect(client.getJob({ id: chain.id })).toMatchObject({ attempt: 1 });
    },
  );

  syncIt(
    "retries the attempt when the transaction around complete rolls back, keeping none of its writes",
    async ({ client, db }) => {
      const markSent = db.prepare("UPDATE users SET email = email || '!' WHERE id = ?");
      let attempts = 0;
      await using workerRunner = createWorkerRunner({
        client,
        processors: createProcessors({
          client,
          jobTypes,
          backoffConfig: { initialDelayMs: 10, multiplier: 1, maxDelayMs: 10 },
          processors: {
            "send-email": {
              attemptHandler: async ({ job, complete }) => {
                attempts++;
                return withTxHooks((txHooks) =>
                  db.transaction(() => {
                    markSent.run(job.input.userId);
                    const receipt = complete({
                      db,
                      txHooks,
                      output: { sentAt: `attempt ${attempts}` },
                    });
                    if (attempts === 1) throw new Error("rollback after complete");
                    return receipt;
                  })(),
                );
              },
            },
          },
        }),
        pollIntervalMs: 50,
      });
      const chain = withTxHooks((txHooks) =>
        db.transaction(() => {
          const user = db
            .prepare("INSERT INTO users (email) VALUES (?) RETURNING id")
            .get("dave@example.com") as { id: number };
          return client.createChain({
            db,
            txHooks,
            typeName: "send-email",
            input: { userId: user.id },
          });
        })(),
      );

      await workerRunner.start();
      await expect(client.awaitChain(chain, { timeoutMs: 5000 })).resolves.toMatchObject({
        output: { sentAt: "attempt 2" },
      });
      await workerRunner.close();

      expect(client.getJob({ id: chain.id })).toMatchObject({ attempt: 2 });
      expect(db.prepare("SELECT email FROM users").get()).toEqual({ email: "dave@example.com!" });
    },
  );
});
