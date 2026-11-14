import { syncAsync, step } from "@queuert/sync-async";

const __syncStep = "taken";

export const findRow = syncAsync(function* (db, key) {
  const [row] = yield* step(db.query(key, __syncStep));
  return row;
});
