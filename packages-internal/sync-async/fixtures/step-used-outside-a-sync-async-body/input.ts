import { syncAsync, step } from "@queuert/sync-async";

export const findRow = syncAsync(function* (db, key) {
  const [row] = yield* step(db.query(key));
  return row;
});

export function* findRowSteps(db, key) {
  const [row] = yield* step(db.query(key));
  return row;
}
