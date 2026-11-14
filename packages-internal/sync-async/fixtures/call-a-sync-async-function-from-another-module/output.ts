import { syncStep as __syncStep } from "@queuert/sync-async";

import { findRow } from "./find-row.ts";

export const findTwo = {
  sync: function findTwoSync(db, a, b) {
    return [__syncStep(findRow.sync(db, a)), __syncStep(findRow.sync(db, b))];
  },
  async: async function findTwoAsync(db, a, b) {
    return [await findRow.async(db, a), await findRow.async(db, b)];
  },
};
