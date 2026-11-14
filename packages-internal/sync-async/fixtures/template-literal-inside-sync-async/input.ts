import { syncAsync, step } from "@queuert/sync-async";

export const createTables = syncAsync(function* (db) {
  yield* step(
    db.execute(`
CREATE TABLE job (
  id TEXT PRIMARY KEY
)`),
  );
});
