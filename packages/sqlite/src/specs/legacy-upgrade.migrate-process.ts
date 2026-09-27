// Runs `migrateToLatest()` against the database file in argv[2] from its own process, so
// `legacy-upgrade.spec.ts` can race two migrators on real SQLite locks. better-sqlite3 blocks the
// thread while it waits on a lock, so two connections in one process cannot contend fairly.
import { createInterface } from "node:readline";

import Database from "better-sqlite3";

import { createSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.js";
import { createBetterSqlite3Provider } from "../state-provider/state-provider.better-sqlite3.js";

const db = new Database(process.argv[2], { timeout: 30_000 });
const adapter = await createSqliteStateAdapter({
  stateProvider: createBetterSqlite3Provider({ db }),
});

const lines = createInterface({ input: process.stdin });
process.stdout.write("ready\n");
for await (const line of lines) {
  if (line === "go") break;
}
lines.close();

try {
  const result = await adapter.migrateToLatest();
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  db.close();
}
