import { syncAsync, step } from "@queuert/sync-async";

export const createTables = syncAsync(function* (
  db,
  prefix = `
job_`,
) {
  const sql = "CREATE TABLE \
job (id TEXT PRIMARY KEY)";
  yield* step(db.execute(prefix + sql));
});
