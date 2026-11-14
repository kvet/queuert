import * as syncAsyncExports from "@queuert/sync-async";
import { syncAsync, step } from "@queuert/sync-async";

export const findRow = syncAsync(function* (db, key) {
  const [row] = yield* step(db.query(key));
  return syncAsyncExports.isPromise(row) ? undefined : row;
});
