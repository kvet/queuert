import { syncAsync as m, "step" as s } from "@queuert/sync-async";

export const close = m(function* (db) {
  yield* s(db.close());
});
