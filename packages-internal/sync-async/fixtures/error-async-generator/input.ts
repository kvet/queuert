import { syncAsync, step } from "@queuert/sync-async";

export const findRow = syncAsync(async function* (db, key) {
  const [row] = yield* step(db.query(key));
  return row;
});
