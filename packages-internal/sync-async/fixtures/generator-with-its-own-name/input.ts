import { syncAsync, step } from "@queuert/sync-async";

export const findRow = syncAsync(function* lookup(db, key) {
  return yield* step(db.query(key));
});
