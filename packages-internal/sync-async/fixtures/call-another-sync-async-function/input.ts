import { syncAsync, step } from "@queuert/sync-async";

const findRow = syncAsync(function* (db, key) {
  const [row] = yield* step(db.query(key));
  return row;
});

export const findRows = syncAsync(function* (db, keys) {
  const rows = [];
  for (const key of keys) {
    rows.push(yield* findRow.steps(db, key));
  }
  return rows;
});
