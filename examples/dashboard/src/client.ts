import { createSqliteStateAdapter } from "@queuert/sqlite";
import { createClient, defineJobTypes } from "queuert";
import { createInProcessNotifyAdapter } from "queuert/internal";
import { createDatabase, createStateProvider } from "./db.js";

export const registry = defineJobTypes<{
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
   * Scenario 3 - Blockers (fan-out/fan-in):
   *   fetch-user ------+
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
}>();

export const db = createDatabase();
const stateProvider = createStateProvider(db);

export const stateAdapter = await createSqliteStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();

export const notifyAdapter = createInProcessNotifyAdapter();

export const client = await createClient({ stateAdapter, notifyAdapter, registry });
