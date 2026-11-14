import { syncAsync, step } from "@queuert/sync-async";

const findRowSync = (db, key) => db.query(key);

export const findRow = syncAsync(function* (db, key) {
  return yield* step(findRowSync(db, key));
});
