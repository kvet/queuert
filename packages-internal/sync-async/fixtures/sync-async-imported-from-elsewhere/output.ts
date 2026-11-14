import { syncAsync } from "./my-sync-async.ts";
import { step } from "@queuert/sync-async";

export const findRow = syncAsync(function* (db, key) {
  const [row] = yield* step(db.query(key));
  return row;
});
