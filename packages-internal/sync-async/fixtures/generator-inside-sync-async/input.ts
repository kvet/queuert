import { syncAsync, step } from "@queuert/sync-async";

export const insertAll = syncAsync(function* (db, items) {
  const rows = function* () {
    for (const item of items) yield [item.id, item.name];
  };
  yield* step(db.insertMany(rows()));
});
