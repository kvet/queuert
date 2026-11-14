import { syncAsync, step } from "@queuert/sync-async";

export const readCached = syncAsync(function* (db, key) {
  const rows = yield* step(cache.get(key) ?? db.query(key));
  return (yield* step(db.count(key))) + rows.length;
});
