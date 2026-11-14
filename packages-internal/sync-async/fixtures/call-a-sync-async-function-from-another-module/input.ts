import { syncAsync } from "@queuert/sync-async";

import { findRow } from "./find-row.ts";

export const findTwo = syncAsync(function* (db, a, b) {
  return [yield* findRow.steps(db, a), yield* findRow.steps(db, b)];
});
