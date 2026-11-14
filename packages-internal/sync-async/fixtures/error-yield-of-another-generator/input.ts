import { syncAsync } from "@queuert/sync-async";

export const findRows = syncAsync(function* (db, keys) {
  return yield* keys.map((key) => db.query(key));
});
