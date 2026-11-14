import { syncAsync, step } from "@queuert/sync-async";

export const createFind = (db) =>
  syncAsync(function* (key) {
    return yield* step(db.query(key));
  });
