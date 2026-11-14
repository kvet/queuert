import { syncAsync, step } from "@queuert/sync-async";

export const close = syncAsync(function /* closes the connection */ * (db) {
  yield* step(db.close());
});
