import { syncAsync, step } from "@queuert/sync-async";

export const createClient = (db, runInMode) => ({
  findRow: (key) =>
    runInMode(
      syncAsync(function* () {
        return yield* step(db.query(key));
      }),
    ),
});
