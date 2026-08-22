import { join } from "node:path";

import { createAsyncRwLock, createSqliteStateAdapter } from "@queuert/sqlite";
import Database from "better-sqlite3";
import { createBetterSqlite3StateProvider } from "example-state-sqlite-better-sqlite3/provider";
import { createClient, createInProcessNotifyAdapter, defineJobTypes } from "queuert";

const DB_PATH = join(import.meta.dirname, "..", "data.db");

const createDatabase = (): Database.Database => {
  const db = new Database(DB_PATH);
  db.pragma("auto_vacuum = INCREMENTAL");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
};

export const jobTypes = defineJobTypes<{
  /*
   * Scenario 1 - Single Job:
   *   greet → "Hello, {name}!"
   */
  greet: { entry: true; input: { name: string }; output: { greeting: string } };

  /*
   * Scenario 2 - Continuations:
   *   order:validate → order:process → order:complete
   */
  "order:validate": {
    entry: true;
    input: { orderId: string };
    output: { orderId: string; validated: true };
    continueWith: { typeName: "order:process" };
  };
  "order:process": {
    input: { orderId: string; validated: true };
    output: { orderId: string; processed: true };
    continueWith: { typeName: "order:complete" };
  };
  "order:complete": {
    input: { orderId: string; processed: true };
    output: { orderId: string; status: "completed" };
  };

  /*
   * Scenario 3 - Blockers (fan-out):
   *   fetch-user -------+
   *                     +--> process-with-blockers
   *   fetch-permissions-+
   */
  "fetch-user": {
    entry: true;
    input: { userId: string };
    output: { userId: string; name: string };
  };
  "fetch-permissions": {
    entry: true;
    input: { userId: string };
    output: { userId: string; permissions: string[] };
  };
  "process-with-blockers": {
    entry: true;
    input: { taskId: string };
    output: { taskId: string; result: string };
    blockers: [{ typeName: "fetch-user" }, { typeName: "fetch-permissions" }];
  };

  /*
   * Scenario 4 - Retries:
   *   might-fail (attempt #1: fail) → (attempt #2: success)
   */
  "might-fail": { entry: true; input: { shouldFail: boolean }; output: { success: true } };

  /*
   * Scenario 5 - Scheduled Job:
   *   scheduled-report (scheduled 1 hour in the future — use "Reschedule" in the dashboard)
   */
  "scheduled-report": {
    entry: true;
    input: { reportType: string };
    output: { generatedAt: string };
  };

  /*
   * Scenario 6 - Long chain (pagination volume):
   *   count-step continues to itself until it reaches `total`, producing a single
   *   chain with many jobs — exercises the chain-detail job-list pagination.
   */
  "count-step": {
    entry: true;
    input: { n: number; total: number };
    output: { total: number };
    continueWith: { typeName: "count-step" };
  };

  /*
   * Scenario 7 - Blocker fan-in (pagination volume):
   *   one `signal` chain (left pending) blocks many `blocked-task` chains —
   *   exercises the chain-detail "Blocking" pagination.
   */
  signal: {
    entry: true;
    input: { name: string };
    output: { fired: true };
  };
  "blocked-task": {
    entry: true;
    input: { index: number };
    output: { index: number; done: true };
    blockers: [{ typeName: "signal" }];
  };
}>();

export const db = createDatabase();
const lock = createAsyncRwLock();
const stateProvider = createBetterSqlite3StateProvider({ db, lock });

export const stateAdapter = await createSqliteStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();

export const notifyAdapter = await createInProcessNotifyAdapter();

export const client = await createClient({ stateAdapter, notifyAdapter, jobTypes });
