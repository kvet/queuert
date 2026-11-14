import { syncAsync, step } from "@queuert/sync-async";

export const countRows = syncAsync(function* (db, keys) {
  const countOne = syncAsync(function* (key) {
    const rows = yield* step(db.query(key));
    return rows.length;
  });
  let total = 0;
  for (const key of keys) total += yield* countOne.steps(key);
  return total;
});
