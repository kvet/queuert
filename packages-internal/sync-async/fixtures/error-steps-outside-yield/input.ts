import { syncAsync, step } from "@queuert/sync-async";

const findRow = syncAsync(function* (db, key) {
  const [row] = yield* step(db.query(key));
  return row;
});

export const findRowSteps = findRow.steps;
